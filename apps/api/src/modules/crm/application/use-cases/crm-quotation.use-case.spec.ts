import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CreateCrmQuotationDraftUseCase } from './crm-quotation.use-case';
import { FEATURE_TEMPORARILY_UNAVAILABLE, featureTemporarilyUnavailable } from '../../../employee-access/application/entitlement.helper';

const noopAudit = { log: async () => undefined } as any;
const noopOutbox = { append: async () => undefined } as any;
const openLaunchGate = { assertLaunchRouteOpenInTransaction: async () => undefined } as any;

function ctx(overrides: Partial<any> = {}) {
  return {
    requestId: 'req-1',
    authSubject: 's',
    userId: 'sales-1',
    companyId: 'co-1',
    membershipId: 'm',
    roles: ['SALES'],
    permissions: ['crm.quotation.link', 'accounting.quotation.create'],
    scopes: {},
    authProvider: 'dev',
    ...overrides,
  } as any;
}

const openOpportunity = {
  id: 'opp-1',
  companyId: 'co-1',
  customerId: 'cust-1',
  ownerUserId: 'sales-1',
  title: 'New deal',
  branchId: 'branch-1',
  status: 'OPEN',
  currency: 'THB',
};

function makeLink(data: any) {
  return {
    id: 'ql-1',
    companyId: 'co-1',
    customerId: 'cust-1',
    opportunityId: 'opp-1',
    accountingDocumentId: 'doc-1',
    accountingDocumentType: 'QUOTATION',
    status: 'DRAFT',
    grandTotalAmount: '0',
    currency: 'THB',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...data,
  };
}

describe('CreateCrmQuotationDraftUseCase counterparty auto-link', () => {
  it('delegates counterparty+document+link creation to one idempotent bundle', async () => {
    let ensureCalls = 0;
    let bundleInput: any;
    const repo = {
      findOpportunityById: async () => openOpportunity,
      findActiveQuotationLink: async () => null,
      createQuotationDraftBundle: async (data: any) => { bundleInput = data; return makeLink({ accountingDocumentId: 'doc-1' }); },
    } as any;
    const createDocument = {
      execute: async () => { throw new Error('document creation must be inside the CRM bundle transaction'); },
    } as any;
    const ensureCounterparty = {
      execute: async (_ctx: any, input: any) => {
        ensureCalls += 1;
        return { id: 'cp-new' };
      },
    } as any;

    const uc = new CreateCrmQuotationDraftUseCase(repo, noopAudit, noopOutbox, createDocument, ensureCounterparty, openLaunchGate);
    const res = await uc.execute(ctx({ scopes: { branchIds: ['branch-1'] } }), 'opp-1', { idempotencyKey: ' quote-retry-1 ' });

    assert.equal(res.id, 'ql-1');
    assert.equal(ensureCalls, 0);
    assert.equal(bundleInput.requestKey, 'quote-retry-1');
    assert.equal(bundleInput.expectedCustomerId, 'cust-1');
    assert.deepEqual(bundleInput.scope.branchIds, ['branch-1']);
  });

  it('reuses an existing customer counterparty without creating another one', async () => {
    let ensureCalls = 0;
    let writeBackCalls = 0;
    let bundleInput: any;
    const repo = {
      findOpportunityById: async () => openOpportunity,
      findActiveQuotationLink: async () => null,
      createQuotationDraftBundle: async (data: any) => { bundleInput = data; return makeLink({ accountingDocumentId: 'doc-1' }); },
    } as any;
    const createDocument = {
      execute: async () => { throw new Error('document creation must be inside the CRM bundle transaction'); },
    } as any;
    const ensureCounterparty = {
      execute: async () => {
        ensureCalls++;
        return { id: 'cp-new' };
      },
    } as any;

    const uc = new CreateCrmQuotationDraftUseCase(repo, noopAudit, noopOutbox, createDocument, ensureCounterparty, openLaunchGate);
    await uc.execute(ctx(), 'opp-1', {});

    assert.equal(ensureCalls, 0);
    assert.equal(writeBackCalls, 0);
    assert.equal(bundleInput.requestKey, 'req-1');
  });

  it('requires crm.quotation.link before lookup', async () => {
    let lookedUp = false;
    const repo = {
      findOpportunityById: async () => {
        lookedUp = true;
        return openOpportunity;
      },
    } as any;
    const uc = new CreateCrmQuotationDraftUseCase(
      repo,
      noopAudit,
      noopOutbox,
      { execute: async () => ({}) } as any,
      { execute: async () => ({ id: 'cp-new' }) } as any,
      openLaunchGate,
    );

    await assert.rejects(() => uc.execute(ctx({ permissions: ['accounting.quotation.create'] }), 'opp-1', {}), /crm\.quotation\.link/);
    assert.equal(lookedUp, false);
  });

  it('requires an accounting document create permission', async () => {
    let lookedUp = false;
    const repo = {
      findOpportunityById: async () => {
        lookedUp = true;
        return openOpportunity;
      },
    } as any;
    const uc = new CreateCrmQuotationDraftUseCase(
      repo,
      noopAudit,
      noopOutbox,
      { execute: async () => ({}) } as any,
      { execute: async () => ({ id: 'cp-new' }) } as any,
      openLaunchGate,
    );

    await assert.rejects(() => uc.execute(ctx({ permissions: ['crm.quotation.link'] }), 'opp-1', {}), /accounting\.quotation\.create/);
    assert.equal(lookedUp, false);
  });

  it('blocks the atomic CRM counterparty+quotation bundle while the sales route is closed', async () => {
    let writes = 0;
    const repo = {
      findOpportunityById: async () => openOpportunity,
      findActiveQuotationLink: async () => null,
      createQuotationDraftBundle: async (_data: unknown, before: (db: unknown) => Promise<void>) => {
        await before({});
        writes += 1;
      },
    } as any;
    const useCase = new CreateCrmQuotationDraftUseCase(
      repo, noopAudit, noopOutbox, {} as any, {} as any,
      { assertLaunchRouteOpenInTransaction: async () => { throw featureTemporarilyUnavailable('sales_documents'); } } as any,
    );
    await assert.rejects(
      () => useCase.execute(ctx(), 'opp-1', {}),
      (error: any) => error.getResponse?.().code === FEATURE_TEMPORARILY_UNAVAILABLE,
    );
    assert.equal(writes, 0);
  });

  it('replays an already-created CRM quotation without requiring the route to reopen', async () => {
    let gateCalls = 0;
    const repo = {
      findOpportunityById: async () => openOpportunity,
      findActiveQuotationLink: async () => null,
      createQuotationDraftBundle: async () => makeLink({ accountingDocumentId: 'doc-existing' }),
    } as any;
    const useCase = new CreateCrmQuotationDraftUseCase(
      repo, noopAudit, noopOutbox, {} as any, {} as any,
      { assertLaunchRouteOpenInTransaction: async () => {
        gateCalls += 1;
        throw featureTemporarilyUnavailable('sales_documents');
      } } as any,
    );
    assert.equal((await useCase.execute(ctx(), 'opp-1', { idempotencyKey: 'existing' })).accountingDocumentId, 'doc-existing');
    assert.equal(gateCalls, 0);
  });
});
