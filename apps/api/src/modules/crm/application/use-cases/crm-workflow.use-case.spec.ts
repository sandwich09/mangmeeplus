import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AssignCrmLeadUseCase, ConvertCrmLeadUseCase, DisqualifyCrmLeadUseCase, ListCrmLeadsUseCase } from './crm-lead.use-case';
import { CloseCrmOpportunityUseCase, CreateCrmActivityUseCase, CreateCrmOpportunityUseCase, ListCrmActivitiesUseCase, ListCrmOpportunitiesUseCase, ReopenCrmOpportunityUseCase, UpdateCrmOpportunityUseCase } from './crm-opportunity.use-case';
import { CancelCrmFollowUpUseCase, CompleteCrmFollowUpUseCase, CreateCrmFollowUpUseCase, ListCrmFollowUpsUseCase } from './crm-follow-up.use-case';
import { CreateCrmQuotationDraftUseCase, ListCrmQuotationLinksUseCase } from './crm-quotation.use-case';
import { PrismaCrmRepository } from '../../infrastructure/prisma-crm.repository';
import {
  CreateCrmCustomerUseCase,
  ArchiveCrmCustomerUseCase,
  UpdateCrmCustomerUseCase,
  GetCrmCustomerUseCase,
  ListCrmCustomersUseCase,
  PreviewCrmCustomerMergeUseCase,
  MergeCrmCustomersUseCase,
  LinkCrmCustomerLineIdentityUseCase,
  CreateCrmContactUseCase,
  UpdateCrmContactUseCase,
  projectCustomerDetailForContext,
  projectCustomerSummaryForContext,
} from './crm-customer.use-case';

const noopAudit = { log: async () => undefined } as any;
const openLaunchGate = { assertLaunchRouteOpenInTransaction: async () => undefined } as any;
const noopOutbox = { append: async () => undefined } as any;
const noopEnsureCounterparty = { execute: async () => ({ id: 'cp-auto' }) } as any;

function ctx(overrides: Partial<any> = {}) {
  return {
    requestId: 'req-1', authSubject: 's', userId: 'sales-1', companyId: 'co-1',
    membershipId: 'm', roles: ['SALES'],
    permissions: [
      'crm.customer.create', 'crm.lead.convert', 'crm.opportunity.create', 'crm.opportunity.close',
      'crm.quotation.link', 'accounting.quotation.create',
    ],
    scopes: {}, authProvider: 'dev', ...overrides,
  } as any;
}

const STAGES = [
  { id: 'st-new', companyId: 'co-1', name: 'New lead', canonicalGroup: 'NEW_LEAD', sortOrder: 0, isTerminalWon: false, isTerminalLost: false, isActive: true, createdByUserId: 'u', createdAt: new Date(), updatedAt: new Date() },
  { id: 'st-won', companyId: 'co-1', name: 'Won', canonicalGroup: 'WON', sortOrder: 5, isTerminalWon: true, isTerminalLost: false, isActive: true, createdByUserId: 'u', createdAt: new Date(), updatedAt: new Date() },
  { id: 'st-lost', companyId: 'co-1', name: 'Lost', canonicalGroup: 'LOST', sortOrder: 6, isTerminalWon: false, isTerminalLost: true, isActive: true, createdByUserId: 'u', createdAt: new Date(), updatedAt: new Date() },
];

function customer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c-1', marketingRef: 'marketing-ref-1', companyId: 'co-1', displayName: 'Alice', displayNameNormalized: 'alice',
    customerType: 'PERSON', status: 'ACTIVE', consentStatus: 'UNKNOWN', originSource: 'MANUAL',
    createdByType: 'USER', tier: 'LEAD', engagementScore: 0, createdByUserId: 'sales-1',
    createdAt: new Date(), updatedAt: new Date(), ...overrides,
  } as any;
}

describe('CreateCrmCustomerUseCase', () => {
  it('blocks create on exact tax id duplicate with an active customer', async () => {
    const repo = {
      findDuplicateCustomers: async () => [{ id: 'c-9', displayName: 'Acme', status: 'ACTIVE', taxIdNormalized: '0105512345678', createdAt: new Date(), updatedAt: new Date() }],
      createCustomer: async () => { throw new Error('should not create'); },
    } as any;
    const uc = new CreateCrmCustomerUseCase(repo, noopAudit, noopOutbox);
    await assert.rejects(
      () => uc.execute(ctx(), { displayName: 'Acme 2', taxId: '0-1055-12345-67-8' }),
      (err: any) => err?.getResponse?.().code === 'duplicate_tax_id',
    );
  });

  it('blocks an exact phone candidate until an explicit override, then returns the evidence', async () => {
    const repo = {
      findDuplicateCustomers: async () => [{ id: 'c-9', displayName: 'Acme', status: 'ACTIVE', ownerUserId: 'sales-1', primaryPhoneNormalized: '812345678', createdAt: new Date(), updatedAt: new Date() }],
      createCustomer: async (data: any) => customer({ id: 'c-new', ...data }),
    } as any;
    const uc = new CreateCrmCustomerUseCase(repo, noopAudit, noopOutbox);
    await assert.rejects(
      () => uc.execute(ctx(), { displayName: 'Acme 2', primaryPhone: '+66 81 234 5678' }),
      (error: any) => error?.getResponse?.().code === 'duplicate_customer_candidate',
    );
    const res = await uc.execute(ctx(), { displayName: 'Acme 2', primaryPhone: '081-234-5678', duplicateOverride: true });
    assert.equal(res.duplicateWarnings.length, 1);
    assert.equal(res.duplicateWarnings[0].matchType, 'PHONE');
  });

  it('rejects raw LINE id, invalid runtime fields, and untrusted LINE provenance', async () => {
    const repo = { findDuplicateCustomers: async () => [], createCustomer: async () => customer() } as any;
    const uc = new CreateCrmCustomerUseCase(repo, noopAudit, noopOutbox);
    await assert.rejects(() => uc.execute(ctx(), { displayName: 'A', lineUserId: 'U1' } as any), /line_identity_link_required/);
    await assert.rejects(() => uc.execute(ctx(), { displayName: 123 } as any), /displayName_must_be_string/);
    await assert.rejects(() => uc.execute(ctx(), { displayName: 'A', primaryPhone: 123 } as any), /primaryPhone_must_be_string/);
    await assert.rejects(() => uc.execute(ctx(), { displayName: 'A', originSource: 'LINE' } as any), /trusted_ingestion/);
    await assert.rejects(() => uc.execute(ctx(), { displayName: 'A', originSource: 'MANUAL', source: 'LINE' } as any), /contradictory_customer_provenance/);
    await assert.rejects(() => uc.execute(ctx(), null as any), /invalid_customer_input/);
    await assert.rejects(() => uc.execute(ctx(), { displayName: 'A', customerType: 'ALIEN' } as any), /invalid_customerType/);
    await assert.rejects(() => uc.execute(ctx(), { displayName: 'A', code: 123 } as any), /code_must_be_string/);
    await assert.rejects(() => uc.execute(ctx(), { displayName: 'A', code: 'x'.repeat(65) }), /code_too_long/);
    await assert.rejects(() => uc.execute(ctx(), { displayName: 'A', status: 'MERGED' } as any), /status_not_allowed_on_create/);
    await assert.rejects(() => uc.execute(ctx(), { displayName: 'A', ownerUserId: 'other' }), /crm.customer.assign/);
  });

  it('blocks but redacts another owner duplicate and never lets SALES override it', async () => {
    const repo = {
      findDuplicateCustomers: async () => [customer({ id: 'secret-id', displayName: 'Secret Person', ownerUserId: 'other', primaryPhoneNormalized: '812345678' })],
      createCustomer: async () => { throw new Error('must not create'); },
    } as any;
    const uc = new CreateCrmCustomerUseCase(repo, noopAudit, noopOutbox);
    await assert.rejects(
      () => uc.execute(ctx(), { displayName: 'Probe', primaryPhone: '0812345678', duplicateOverride: true }),
      (error: any) => {
        const response = error?.getResponse?.();
        return response?.code === 'duplicate_candidate_requires_manager_review'
          && response.warnings[0].customerId === 'REDACTED'
          && response.warnings[0].displayName !== 'Secret Person';
      },
    );
  });
});

describe('Customer update/list/identity management', () => {
  it('update excludes itself and blocks exact duplicate candidates until override', async () => {
    let excludeId: string | undefined;
    let updateCalls = 0;
    const repo = {
      findCustomerById: async () => customer({ ownerUserId: 'sales-1', primaryPhone: '0812345678', primaryPhoneNormalized: '812345678' }),
      findDuplicateCustomers: async (_companyId: string, _keys: unknown, exclude?: string) => {
        excludeId = exclude;
        return [customer({ id: 'c-2', displayName: 'Other', ownerUserId: 'sales-1', primaryPhoneNormalized: '891234567' })];
      },
      updateCustomer: async (_companyId: string, _id: string, data: any) => { updateCalls += 1; return customer({ ...data }); },
    } as any;
    const uc = new UpdateCrmCustomerUseCase(repo, noopAudit, noopOutbox);
    await assert.rejects(
      () => uc.execute(ctx({ permissions: ['crm.customer.update'] }), 'c-1', { primaryPhone: '089-123-4567' }),
      (error: any) => error?.getResponse?.().code === 'duplicate_customer_candidate',
    );
    assert.equal(excludeId, 'c-1');
    const result = await uc.execute(ctx({ permissions: ['crm.customer.update'] }), 'c-1', { primaryPhone: '089-123-4567', duplicateOverride: true });
    assert.equal(updateCalls, 1);
    assert.equal(result.duplicateWarnings[0].customerId, 'c-2');
    await assert.rejects(
      () => uc.execute(ctx({ permissions: ['crm.customer.update'] }), 'c-1', { ownerUserId: 'other', duplicateOverride: true }),
      /crm.customer.assign/,
    );
  });

  it('skips duplicate lookup when identity values are unchanged after normalization', async () => {
    let duplicateCalls = 0;
    const repo = {
      findCustomerById: async () => customer({
        ownerUserId: 'sales-1',
        displayName: 'Acme Co.',
        primaryPhone: '081-234-5678',
        primaryEmail: 'SALES@ACME.TEST',
        taxId: '01-23456',
      }),
      findDuplicateCustomers: async () => { duplicateCalls += 1; return []; },
      updateCustomer: async (_companyId: string, _id: string, data: any) => customer({ ...data }),
    } as any;
    const uc = new UpdateCrmCustomerUseCase(repo, noopAudit, noopOutbox);
    const result = await uc.execute(ctx({ permissions: ['crm.customer.update'] }), 'c-1', {
      displayName: '  ACME CO. ',
      primaryPhone: '+66 81 234 5678',
      primaryEmail: 'sales@acme.test',
      taxId: '0123456',
      notes: 'updated',
    });
    assert.equal(duplicateCalls, 0);
    assert.deepEqual(result.duplicateWarnings, []);
  });

  it('forces SALES list scope to self even when another owner is requested', async () => {
    let queriedOwner: string | undefined;
    const repo = { listCustomers: async (where: any) => { queriedOwner = where.ownerUserId; return { items: [], total: 0, page: 1, pageSize: 20 }; } } as any;
    await new ListCrmCustomersUseCase(repo).execute(ctx({ permissions: ['crm.customer.read'] }), { scope: 'all', ownerUserId: 'other' });
    assert.equal(queriedOwner, 'sales-1');
  });

  it('enforces selected-branch scope on customer list, detail, and mutation paths', async () => {
    let listWhere: any;
    const listRepo = {
      listCustomers: async (where: any) => { listWhere = where; return { items: [], total: 0, page: 1, pageSize: 20 }; },
    } as any;
    const branchCtx = ctx({ permissions: ['crm.customer.read', 'crm.customer.update'], scopes: { branchIds: ['branch-allowed'] } });
    await new ListCrmCustomersUseCase(listRepo).execute(branchCtx, {});
    assert.deepEqual(listWhere.branchIds, ['branch-allowed']);

    const outOfScopeRepo = {
      findCustomerById: async () => customer({ ownerUserId: 'sales-1', branchId: 'branch-denied' }),
    } as any;
    await assert.rejects(
      () => new GetCrmCustomerUseCase(outOfScopeRepo).execute(branchCtx, 'c-1'),
      /out of scope/,
    );
    await assert.rejects(
      () => new UpdateCrmCustomerUseCase(outOfScopeRepo, noopAudit, noopOutbox).execute(branchCtx, 'c-1', { notes: 'blocked' }),
      /branch scope/,
    );
  });

  it('forces MANAGER fallback to explicit assignment and rejects Marketing PII search', async () => {
    let queriedOwner: string | undefined;
    const repo = { listCustomers: async (where: any) => { queriedOwner = where.ownerUserId; return { items: [], total: 0, page: 1, pageSize: 20 }; } } as any;
    const uc = new ListCrmCustomersUseCase(repo);
    await uc.execute(ctx({ roles: ['MANAGER'], permissions: ['crm.customer.read'] }), { scope: 'all' });
    assert.equal(queriedOwner, 'sales-1');
    await assert.rejects(
      () => uc.execute(ctx({ roles: ['MARKETING'], permissions: ['crm.customer.read'] }), { search: 'Alice' }),
      /customer_search_not_permitted/,
    );
  });

  it('blocks owner/LTV inference unless every returned row has an operational projection', async () => {
    let queriedOwner: string | undefined;
    const repo = { listCustomers: async (where: any) => { queriedOwner = where.ownerUserId; return { items: [], total: 0, page: 1, pageSize: 20 }; } } as any;
    const uc = new ListCrmCustomersUseCase(repo);
    await assert.rejects(
      () => uc.execute(ctx({ roles: ['MARKETING'], permissions: ['crm.customer.read'] }), { ownerUserId: 'sales-1' }),
      /customer_owner_filter_not_permitted_for_projection/,
    );
    await assert.rejects(
      () => uc.execute(ctx({ roles: ['ACCOUNTANT'], permissions: ['crm.customer.read'] }), { sortBy: 'ltv' }),
      /customer_ltv_sort_not_permitted_for_projection/,
    );
    await assert.rejects(
      () => uc.execute(ctx({ roles: ['SALES', 'FINANCE'], permissions: ['crm.customer.read'] }), { sortBy: 'ltv' }),
      /customer_ltv_sort_not_permitted_for_projection/,
    );
    await uc.execute(ctx({ roles: ['SALES', 'FINANCE'], permissions: ['crm.customer.read'] }), { scope: 'own', sortBy: 'ltv' });
    assert.equal(queriedOwner, 'sales-1');
  });

  it('uses exact accounting/marketing DTOs and resolves mixed-role projection per row', async () => {
    const detail = {
      ...customer({ displayName: 'Alice Secret', primaryPhone: '0812345678', primaryEmail: 'a@example.test', taxId: '12345' }),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      lineIdentityCount: 1, lineIdentityStatus: 'ACTIVE', hasVerifiedLineIdentity: true,
      notes: 'private note', facebookId: 'fb-secret', source: 'legacy',
      lineIdentities: [{ id: 'identity-1', channelId: 'ch', provider: 'LINE_OA', maskedProviderUserId: '••••1234', status: 'ACTIVE' }],
      contacts: [{ id: 'contact-1', companyId: 'co-1', customerId: 'c-1', name: 'AP Person', phone: '089', email: 'ap@test', note: 'secret', consentStatus: 'GRANTED', isPrimary: true, status: 'ACTIVE', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
    } as any;
    const accounting = projectCustomerDetailForContext(detail, ctx({ roles: ['ACCOUNTANT'] }));
    assert.equal(accounting.projection, 'ACCOUNTING_CONTACT');
    assert.equal(accounting.customer.displayName, 'Alice Secret');
    assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(accounting.customer))).sort(), [
      'contacts', 'createdAt', 'customerType', 'displayName', 'id', 'primaryEmail', 'primaryPhone', 'status', 'taxId', 'updatedAt',
    ]);
    assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(accounting.customer.contacts[0]))).sort(), [
      'customerId', 'email', 'id', 'isPrimary', 'name', 'phone', 'status',
    ]);

    const marketing = projectCustomerSummaryForContext(detail, 'opaque-random-ref', ctx({ roles: ['MARKETING'] }));
    assert.equal(marketing.projection, 'MARKETING');
    assert.deepEqual(Object.keys(marketing.customer).sort(), ['consentStatus', 'customerRef', 'originSource', 'segmentIds', 'status', 'tier']);
    assert.equal(marketing.customer.customerRef, 'opaque-random-ref');
    assert.equal('id' in marketing.customer, false);
    assert.equal('lineIdentityCount' in marketing.customer, false);
    assert.throws(() => projectCustomerDetailForContext(detail, ctx({ roles: ['MARKETING'] })), /customer_detail_not_permitted/);

    const repo = {
      listCustomers: async () => ({
        items: [customer({ id: 'own', marketingRef: 'm-own', ownerUserId: 'sales-1' }), customer({ id: 'other', marketingRef: 'm-other', ownerUserId: 'other' })],
        total: 2, page: 1, pageSize: 20,
      }),
    } as any;
    const mixed = await new ListCrmCustomersUseCase(repo).execute(
      ctx({ roles: ['SALES', 'FINANCE'], permissions: ['crm.customer.read'] }),
      { scope: 'all' },
    );
    assert.deepEqual(mixed.items.map((item) => item.projection), ['OPERATIONAL', 'ACCOUNTING_CONTACT']);
  });

  it('merge preview rejects self/conflicting tax ids and commit retries the same completed pair idempotently', async () => {
    const primary = customer({ id: 'primary', taxIdNormalized: '111' });
    const secondary = customer({ id: 'secondary', status: 'MERGED', mergedIntoCustomerId: 'primary', taxIdNormalized: '222' });
    let mergeCalls = 0;
    let auditCalls = 0;
    const repo = {
      findCustomerById: async (_companyId: string, id: string) => id === 'primary' ? primary : secondary,
      customerMergeImpact: async () => { throw new Error('retry must not recount moved rows'); },
      mergeCustomers: async () => { mergeCalls += 1; return { customer: primary, impact: { bookings: 0, contacts: 0, opportunities: 0, activities: 0, followUps: 0, quotationLinks: 0, convertedLeads: 0, lineIdentities: 0, conversations: 0 }, alreadyMerged: true }; },
    } as any;
    const mergeCtx = ctx({ permissions: ['crm.customer.merge'], roles: ['OWNER'] });
    await assert.rejects(
      () => new PreviewCrmCustomerMergeUseCase(repo).execute(mergeCtx, { primaryCustomerId: 'primary', secondaryCustomerId: 'primary', reason: 'same' }),
      /cannot_merge_customer_into_itself/,
    );
    const conflictRepo = {
      findCustomerById: async (_companyId: string, id: string) => id === 'primary' ? primary : customer({ id: 'secondary', taxIdNormalized: '222' }),
      customerMergeImpact: async () => ({ bookings: 1, contacts: 0, opportunities: 0, activities: 0, followUps: 0, quotationLinks: 0, convertedLeads: 0, lineIdentities: 0, conversations: 0 }),
    } as any;
    const preview = await new PreviewCrmCustomerMergeUseCase(conflictRepo).execute(mergeCtx, { primaryCustomerId: 'primary', secondaryCustomerId: 'secondary', reason: 'review' });
    assert.equal(preview.canMerge, false);
    assert.ok(preview.conflicts.includes('tax_id_conflict'));
    const uc = new MergeCrmCustomersUseCase(repo, { log: async () => { auditCalls += 1; } } as any, noopOutbox);
    const result = await uc.execute(mergeCtx, { primaryCustomerId: 'primary', secondaryCustomerId: 'secondary', reason: 'confirmed duplicate' });
    assert.equal(result.mergedCustomerId, 'secondary');
    assert.equal(mergeCalls, 1);
    assert.equal(auditCalls, 0);
  });

  it('LINE link requires merge permission and returns only a masked identity', async () => {
    const repo = {
      findCustomerById: async (_companyId: string, id: string) => customer({ id }),
      linkLineIdentity: async () => ({
        customer: customer(), previousCustomerId: 'source',
        identity: { id: 'id-1', companyId: 'co-1', channelId: 'ch-1', customerId: 'c-1', provider: 'LINE_OA', providerUserId: 'U123456789', status: 'ACTIVE', verifiedLinkAt: new Date(), verifiedLinkVia: 'STAFF' },
      }),
    } as any;
    const uc = new LinkCrmCustomerLineIdentityUseCase(repo, noopAudit, noopOutbox);
    await assert.rejects(
      () => uc.execute(ctx({ permissions: ['crm.customer.update'] }), 'c-1', 'id-1', { expectedCurrentCustomerId: 'source', reason: 'same person' }),
      /crm.customer.merge/,
    );
    await assert.rejects(
      () => uc.execute(ctx({ permissions: ['crm.customer.merge'], roles: ['MANAGER'] }), 'c-1', 'id-1', { expectedCurrentCustomerId: 'source', reason: 'same person' }),
      /Owner or Admin/,
    );
    const result = await uc.execute(ctx({ permissions: ['crm.customer.merge'], roles: ['OWNER'] }), 'c-1', 'id-1', { expectedCurrentCustomerId: 'source', reason: 'same person' });
    assert.equal(result.identity.maskedProviderUserId, '••••6789');
    assert.equal('providerUserId' in result.identity, false);
  });
});

describe('PrismaCrmRepository customer identity transactions', () => {
  it('rejects tombstoned customers at the shared lock before update, child, merge, or LINE-link writes', async () => {
    let writes = 0;
    const tx: any = {
      $queryRaw: async () => [],
      crmCustomer: { findFirst: async () => ({ id: 'c-erased', personalDataErasedAt: new Date(), status: 'ACTIVE' }) },
      crmChannelIdentity: { findFirst: async () => ({ id: 'idn-1', customerId: 'c-erased' }) },
      crmContactPerson: { create: async () => { writes += 1; } },
    };
    const repo = new PrismaCrmRepository({ client: { $transaction: async (fn: any) => fn(tx) } } as any);
    await assert.rejects(() => repo.updateCustomer('co-1', 'c-erased', { displayName: 'restored' }), /customer_not_active/);
    await assert.rejects(() => repo.createContact({ companyId: 'co-1', customerId: 'c-erased', name: 'restored' }), /customer_not_active/);
    await assert.rejects(() => repo.mergeCustomers({
      companyId: 'co-1', primaryCustomerId: 'c-erased', secondaryCustomerId: 'c-other', userId: 'admin-1',
      evidence: { requestId: 'req-merge', reason: 'test' },
    }), /customer_not_active/);
    await assert.rejects(() => repo.linkLineIdentity({
      companyId: 'co-1', customerId: 'c-target', identityId: 'idn-1', expectedCurrentCustomerId: 'c-erased', userId: 'admin-1',
      evidence: { requestId: 'req-link', reason: 'test' },
    }), /customer_not_active/);
    assert.equal(writes, 0);
  });

  it('rechecks exact duplicates and live ownership inside guarded customer writes', async () => {
    let createCalls = 0;
    let updateCalls = 0;
    const duplicateTx: any = {
      $queryRaw: async () => [],
      crmCustomer: {
        findMany: async () => [customer({ id: 'racing-customer', ownerUserId: 'sales-1', primaryPhoneNormalized: '812345678' })],
        create: async () => { createCalls += 1; return customer(); },
      },
    };
    const duplicateRepo = new PrismaCrmRepository({ client: { $transaction: async (fn: any) => fn(duplicateTx) } } as any);
    await assert.rejects(
      () => duplicateRepo.createCustomer(
        { companyId: 'co-1', displayName: 'Race', createdByUserId: 'sales-1' },
        { keys: { primaryPhoneNormalized: '812345678' }, actorUserId: 'sales-1', canReadAll: false },
      ),
      /duplicate_customer_candidate/,
    );
    assert.equal(createCalls, 0);

    const ownershipTx: any = {
      $queryRaw: async () => [],
      crmCustomer: {
        findFirst: async () => customer({ ownerUserId: 'new-owner' }),
        updateMany: async () => { updateCalls += 1; return { count: 1 }; },
      },
    };
    const ownershipRepo = new PrismaCrmRepository({ client: { $transaction: async (fn: any) => fn(ownershipTx) } } as any);
    await assert.rejects(
      () => ownershipRepo.updateCustomer('co-1', 'c-1', { notes: 'stale write' }, undefined, { actorUserId: 'sales-1', canManageAll: false }),
      /customer_out_of_scope/,
    );
    assert.equal(updateCalls, 0);
  });

  it('rechecks target owner membership inside the customer update transaction', async () => {
    let updateCalls = 0;
    const tx: any = {
      $queryRaw: async () => [],
      crmCustomer: {
        findFirst: async ({ where }: any) => where.personalDataErasedAt
          ? null
          : customer({ id: 'c-1', ownerUserId: 'owner-old', status: 'ACTIVE' }),
        updateMany: async () => { updateCalls += 1; return { count: 1 }; },
      },
      companyMembership: { findFirst: async () => null },
    };
    const repo = new PrismaCrmRepository({ client: { $transaction: async (fn: any) => fn(tx) } } as any);

    await assert.rejects(
      () => repo.updateCustomer(
        'co-1',
        'c-1',
        { ownerUserId: 'owner-revoked' },
        undefined,
        { actorUserId: 'owner-old', canManageAll: true, reassignedOwnerUserId: 'owner-revoked' },
      ),
      /owner_not_active_company_member/,
    );
    assert.equal(updateCalls, 0);
  });

  it('writes opportunity transition and timeline together using the locked canonical customer', async () => {
    let updated = false;
    let activityCustomerId: string | undefined;
    const tx: any = {
      $queryRaw: async () => [],
      crmOpportunity: {
        findFirst: async () => customer({ id: 'opp-1', customerId: 'c-1', ownerUserId: 'sales-1', status: updated ? 'WON' : 'OPEN', title: 'Deal', amountEstimate: '0', currency: 'THB', stageId: 'stage', canonicalStageGroup: updated ? 'WON' : 'NEW_LEAD' }),
        updateMany: async () => { updated = true; return { count: 1 }; },
      },
      crmCustomer: { findFirst: async () => customer({ id: 'c-1', status: 'ACTIVE' }) },
      crmActivity: { create: async ({ data }: any) => { activityCustomerId = data.customerId; return data; } },
    };
    const repo = new PrismaCrmRepository({ client: { $transaction: async (fn: any) => fn(tx) } } as any);
    const result = await repo.transitionOpportunity({
      companyId: 'co-1', opportunityId: 'opp-1', expectedCustomerId: 'c-1', expectedStatuses: ['OPEN'],
      scope: { actorUserId: 'sales-1', canManageAll: false }, data: { status: 'WON' },
      activity: { actorUserId: 'sales-1', type: 'STAGE_CHANGED', note: 'Won' },
    });
    assert.equal(result.status, 'WON');
    assert.equal(activityCustomerId, 'c-1');
  });

  it('aborts follow-up completion when merge changes its customer while waiting for the lock', async () => {
    let reads = 0;
    let activityCalls = 0;
    const tx: any = {
      $queryRaw: async () => [],
      crmFollowUpTask: {
        findFirst: async () => ({ id: 'fu-1', companyId: 'co-1', customerId: ++reads === 1 ? 'secondary' : 'primary', ownerUserId: 'sales-1', status: 'OPEN' }),
      },
      crmCustomer: { findFirst: async () => customer({ id: 'secondary', status: 'ACTIVE', ownerUserId: 'sales-1' }) },
      crmActivity: { create: async () => { activityCalls += 1; } },
    };
    const repo = new PrismaCrmRepository({ client: { $transaction: async (fn: any) => fn(tx) } } as any);
    await assert.rejects(
      () => repo.completeFollowUp({
        companyId: 'co-1', id: 'fu-1', userId: 'sales-1', scope: { actorUserId: 'sales-1', canManageAll: false },
        completeData: { status: 'DONE' }, activity: { actorUserId: 'sales-1', type: 'TASK_COMPLETED', note: 'Done' },
      }),
      /follow_up_customer_changed/,
    );
    assert.equal(activityCalls, 0);
  });

  it('resolves and locks the customer for a legacy opportunity-only follow-up before completion', async () => {
    let updateCalls = 0;
    const tx: any = {
      $queryRaw: async () => [],
      crmFollowUpTask: {
        findFirst: async () => ({
          id: 'fu-legacy', companyId: 'co-1', customerId: null, opportunityId: 'opp-1',
          ownerUserId: 'sales-1', status: 'OPEN',
        }),
        updateMany: async () => { updateCalls += 1; return { count: 1 }; },
      },
      crmOpportunity: {
        findFirst: async () => ({ customerId: 'customer-erased' }),
      },
      crmCustomer: {
        findFirst: async ({ where }: any) => where.personalDataErasedAt
          ? { id: 'customer-erased', personalDataErasedAt: new Date('2026-07-12T00:00:00.000Z') }
          : null,
      },
    };
    const repo = new PrismaCrmRepository({ client: { $transaction: async (fn: any) => fn(tx) } } as any);

    await assert.rejects(
      () => repo.completeFollowUp({
        companyId: 'co-1', id: 'fu-legacy', userId: 'sales-1', scope: { actorUserId: 'sales-1', canManageAll: false },
        completeData: { status: 'DONE' }, activity: { actorUserId: 'sales-1', type: 'TASK_COMPLETED', note: 'Done' },
      }),
      /customer_not_active/,
    );
    assert.equal(updateCalls, 0);
  });

  it('resolves a converted-lead-only activity to its canonical customer', async () => {
    let createdData: any;
    const locks: string[] = [];
    const tx: any = {
      $queryRaw: async (strings: TemplateStringsArray) => { locks.push(strings.join('?')); return []; },
      crmLead: {
        findFirst: async () => ({ id: 'lead-1', assignedToUserId: 'sales-1', convertedCustomerId: 'c-1' }),
      },
      crmCustomer: {
        findFirst: async ({ where }: any) => where.personalDataErasedAt ? null : customer({ id: 'c-1', status: 'ACTIVE' }),
      },
      crmActivity: {
        create: async ({ data }: any) => {
          createdData = data;
          return { id: 'act-1', actorUserId: 'sales-1', type: 'NOTE', note: 'Converted lineage', occurredAt: new Date(), createdAt: new Date(), ...data };
        },
      },
    };
    const repo = new PrismaCrmRepository({ client: { $transaction: async (fn: any) => fn(tx) } } as any);
    const result = await repo.createActivity(
      { companyId: 'co-1', leadId: 'lead-1', actorUserId: 'sales-1', type: 'NOTE', note: 'Converted lineage' },
      { actorUserId: 'sales-1', canManageAll: false },
    );
    assert.equal(result.customerId, 'c-1');
    assert.equal(createdData.customerId, 'c-1');
    assert.equal(locks[0].includes('crm-customer-identity-graph:'), true);
  });

  it('fails closed when opportunity and converted-lead lineage resolve different customers', async () => {
    let writes = 0;
    const tx: any = {
      $queryRaw: async () => [],
      crmOpportunity: { findFirst: async () => ({ customerId: 'customer-opportunity', ownerUserId: 'sales-1' }) },
      crmLead: { findFirst: async () => ({ assignedToUserId: 'sales-1', convertedCustomerId: 'customer-lead' }) },
      crmActivity: { create: async () => { writes += 1; } },
    };
    const repo = new PrismaCrmRepository({ client: { $transaction: async (fn: any) => fn(tx) } } as any);
    await assert.rejects(
      () => repo.createActivity(
        { companyId: 'co-1', opportunityId: 'opp-1', leadId: 'lead-1', actorUserId: 'sales-1', type: 'NOTE', note: 'Mismatch' },
        { actorUserId: 'sales-1', canManageAll: false },
      ),
      /child_target_mismatch/,
    );
    assert.equal(writes, 0);
  });

  it('rejects a manual opportunity whose lead belongs to another canonical customer', async () => {
    let writes = 0;
    const tx: any = {
      $queryRaw: async () => [],
      crmLead: {
        findFirst: async () => ({
          id: 'lead-other', companyId: 'co-1', assignedToUserId: 'sales-1',
          convertedCustomerId: 'customer-other', status: 'CONVERTED',
        }),
      },
      crmOpportunity: { create: async () => { writes += 1; return {}; } },
    };
    const repo = new PrismaCrmRepository({ client: { $transaction: async (fn: any) => fn(tx) } } as any);
    await assert.rejects(
      () => repo.createOpportunity({
        companyId: 'co-1', customerId: 'customer-owned', leadId: 'lead-other', ownerUserId: 'sales-1',
        title: 'Must not persist', stageId: 'stage-1', canonicalStageGroup: 'NEW_LEAD', createdByUserId: 'sales-1',
      }, { actorUserId: 'sales-1', canManageAll: false }),
      /child_target_mismatch/,
    );
    assert.equal(writes, 0);
  });

  it('rejects a chained next follow-up whose opportunity resolves to another customer', async () => {
    let taskWrites = 0;
    const currentTask = {
      id: 'fu-a', companyId: 'co-1', customerId: 'customer-a', opportunityId: null, leadId: null,
      ownerUserId: 'sales-1', status: 'OPEN', channel: 'PHONE',
    };
    const tx: any = {
      $queryRaw: async () => [],
      crmFollowUpTask: {
        findFirst: async () => currentTask,
        updateMany: async () => { taskWrites += 1; return { count: 1 }; },
        create: async () => { taskWrites += 1; return {}; },
      },
      crmOpportunity: {
        findFirst: async () => ({ id: 'opp-b', companyId: 'co-1', customerId: 'customer-b', ownerUserId: 'sales-1' }),
      },
      crmCustomer: {
        findFirst: async ({ where }: any) => customer({ id: where.id, status: 'ACTIVE', ownerUserId: 'sales-1' }),
      },
      companyMembership: { findFirst: async () => ({ id: 'membership-sales-1' }) },
    };
    const repo = new PrismaCrmRepository({ client: { $transaction: async (fn: any) => fn(tx) } } as any);
    await assert.rejects(
      () => repo.completeFollowUp({
        companyId: 'co-1', id: currentTask.id, userId: 'sales-1',
        scope: { actorUserId: 'sales-1', canManageAll: false },
        completeData: { status: 'DONE' },
        nextFollowUp: {
          companyId: 'co-1', opportunityId: 'opp-b', ownerUserId: 'sales-1', title: 'Wrong customer',
          dueAt: new Date(), timezone: 'Asia/Bangkok', priority: 'NORMAL', channel: 'PHONE', createdByUserId: 'sales-1',
        },
      }),
      /next_follow_up_customer_mismatch/,
    );
    assert.equal(taskWrites, 0);
  });

  it('backfills lead-only activities and follow-ups in the same conversion transaction', async () => {
    const operations: string[] = [];
    const tx: any = {
      $queryRaw: async () => [],
      crmLead: {
        findFirst: async () => ({ status: 'NEW', assignedToUserId: 'sales-1' }),
        updateMany: async () => { operations.push('claim'); return { count: 1 }; },
        update: async ({ data }: any) => {
          operations.push('lead-converted');
          return { id: 'lead-1', companyId: 'co-1', source: 'MANUAL', status: 'CONVERTED', assignedToUserId: 'sales-1', createdAt: new Date(), updatedAt: new Date(), ...data };
        },
      },
      crmCustomer: {
        findFirst: async ({ where }: any) => where.personalDataErasedAt ? null : customer({ id: 'c-1', status: 'ACTIVE', ownerUserId: 'sales-1' }),
      },
      crmActivity: {
        updateMany: async ({ where, data }: any) => { operations.push(`activity:${where.leadId}:${data.customerId}`); return { count: 1 }; },
      },
      crmFollowUpTask: {
        updateMany: async ({ where, data }: any) => { operations.push(`follow-up:${where.leadId}:${data.customerId}`); return { count: 1 }; },
      },
    };
    const repo = new PrismaCrmRepository({ client: { $transaction: async (fn: any) => fn(tx) } } as any);
    await repo.convertLead({
      companyId: 'co-1', leadId: 'lead-1', userId: 'sales-1', convertKey: 'convert-1',
      leadScope: { actorUserId: 'sales-1', canManageAll: false },
      existingCustomerId: 'c-1', existingCustomerScope: { actorUserId: 'sales-1', canManageAll: false },
    });
    assert.deepEqual(operations, [
      'claim', 'activity:lead-1:c-1', 'follow-up:lead-1:c-1', 'lead-converted',
    ]);
  });

  it('rejects a lead disqualified after the optimistic use-case read before conversion creates children', async () => {
    let writes = 0;
    const tx: any = {
      $queryRaw: async () => [],
      crmLead: {
        findFirst: async () => ({ status: 'DISQUALIFIED', assignedToUserId: 'sales-1' }),
        updateMany: async () => { writes += 1; return { count: 1 }; },
      },
      crmCustomer: { create: async () => { writes += 1; } },
      crmOpportunity: { create: async () => { writes += 1; } },
    };
    const repo = new PrismaCrmRepository({ client: { $transaction: async (fn: any) => fn(tx) } } as any);
    await assert.rejects(
      () => repo.convertLead({
        companyId: 'co-1', leadId: 'lead-1', userId: 'sales-1', convertKey: 'convert-race',
        leadScope: { actorUserId: 'sales-1', canManageAll: false },
        customerData: { companyId: 'co-1', displayName: 'No write', ownerUserId: 'sales-1' },
        customerDuplicateGuard: { keys: {}, actorUserId: 'sales-1', canReadAll: false },
      }),
      /lead_not_convertible/,
    );
    assert.equal(writes, 0);
  });

  it('rechecks the current lead assignee after locking and rejects a lost actor scope', async () => {
    let writes = 0;
    const tx: any = {
      $queryRaw: async () => [],
      crmLead: {
        findFirst: async () => ({ status: 'QUALIFIED', assignedToUserId: 'sales-2' }),
        updateMany: async () => { writes += 1; return { count: 1 }; },
      },
    };
    const repo = new PrismaCrmRepository({ client: { $transaction: async (fn: any) => fn(tx) } } as any);
    await assert.rejects(
      () => repo.convertLead({
        companyId: 'co-1', leadId: 'lead-1', userId: 'sales-1', convertKey: 'convert-scope-race',
        leadScope: { actorUserId: 'sales-1', canManageAll: false },
        existingCustomerId: 'c-1',
        existingCustomerScope: { actorUserId: 'sales-1', canManageAll: false },
      }),
      /lead_out_of_scope/,
    );
    assert.equal(writes, 0);
  });

  it('rejects a stale lead reassignment when conversion wins the row lock', async () => {
    let writes = 0;
    const tx: any = {
      $queryRaw: async () => [],
      crmLead: {
        findFirst: async () => ({ id: 'lead-1', companyId: 'co-1', status: 'CONVERTED', assignedToUserId: 'sales-1' }),
        updateMany: async () => { writes += 1; return { count: 1 }; },
      },
    };
    const repo = new PrismaCrmRepository({ client: { $transaction: async (fn: any) => fn(tx) } } as any);
    await assert.rejects(
      () => repo.updateLead('co-1', 'lead-1', { assignedToUserId: 'sales-2' }, {
        actorUserId: 'sales-1', canManageAll: false, expectedStatus: 'NEW', reassignedAssigneeUserId: 'sales-2',
      }),
      /lead_status_changed/,
    );
    assert.equal(writes, 0);
  });

  it('creates counterparty, official quotation, CRM link, and timeline once per request key', async () => {
    let customerRow: any = customer({ id: 'c-1', accountingCounterpartyId: undefined, status: 'ACTIVE' });
    let storedLink: any;
    let counterpartyCreates = 0;
    let documentCreates = 0;
    let activityCreates = 0;
    let documentCounterpartyId: string | undefined;
    const opportunity = { id: 'opp-1', companyId: 'co-1', customerId: 'c-1', ownerUserId: 'sales-1', status: 'OPEN', title: 'Deal', currency: 'THB' };
    const tx: any = {
      $queryRaw: async () => [],
      crmOpportunity: {
        findFirst: async () => opportunity,
        updateMany: async () => ({ count: 1 }),
      },
      crmCustomer: {
        findFirst: async () => customerRow,
        updateMany: async ({ data }: any) => { customerRow = { ...customerRow, ...data }; return { count: 1 }; },
      },
      crmQuotationLink: {
        findFirst: async ({ where }: any) => where.requestKey ? storedLink ?? null : storedLink ?? null,
        create: async ({ data }: any) => {
          storedLink = { id: 'link-1', ...data, createdAt: new Date(), updatedAt: new Date() };
          return storedLink;
        },
      },
      accountingCounterparty: {
        create: async () => { counterpartyCreates += 1; return { id: 'cp-1' }; },
      },
      accountingDocument: {
        create: async ({ data }: any) => {
          documentCreates += 1;
          documentCounterpartyId = data.counterpartyId;
          return { id: 'doc-1', documentNumber: null, grandTotalAmount: '0', currency: 'THB' };
        },
      },
      crmActivity: { create: async () => { activityCreates += 1; return {}; } },
      auditLog: { create: async () => ({}) },
    };
    const repo = new PrismaCrmRepository({ client: { $transaction: async (fn: any) => fn(tx) } } as any);
    const input = {
      companyId: 'co-1', opportunityId: 'opp-1', expectedCustomerId: 'c-1',
      scope: { actorUserId: 'sales-1', canManageAll: false }, userId: 'sales-1',
      requestId: 'req-quote', requestKey: 'req-quote', allowRevision: true,
    };
    const first = await repo.createQuotationDraftBundle(input);
    const retry = await repo.createQuotationDraftBundle(input);
    assert.equal(first.id, retry.id);
    assert.equal(counterpartyCreates, 1);
    assert.equal(documentCreates, 1);
    assert.equal(activityCreates, 1);
    assert.equal(customerRow.accountingCounterpartyId, 'cp-1');
    assert.equal(documentCounterpartyId, 'cp-1');
    assert.equal(storedLink.accountingDocumentId, 'doc-1');
  });

  it('creates LINE customer+identity atomically with trusted provenance and no legacy raw LINE field', async () => {
    let customerData: any;
    let identityData: any;
    const tx = {
      companyMessagingChannel: { findFirst: async () => ({ id: 'ch-1' }) },
      crmCustomer: {
        create: async ({ data }: any) => {
          customerData = data;
          return customer({ id: 'new', ...data });
        },
      },
      crmChannelIdentity: {
        create: async ({ data }: any) => { identityData = data; return { id: 'identity-new', ...data }; },
      },
    };
    const repo = new PrismaCrmRepository({ client: { $transaction: async (fn: any) => fn(tx) } } as any);
    const result = await repo.createLineCustomerAndIdentity({
      customer: { companyId: 'co-1', displayName: ' LINE User ', lineUserId: 'RAW-U1', createdByUserId: 'system', originSource: 'MANUAL', createdByType: 'USER' },
      identity: { channelId: 'ch-1', provider: 'LINE_OA', providerUserId: 'RAW-U1', status: 'ACTIVE' },
    });
    assert.equal(result.identityId, 'identity-new');
    assert.equal(customerData.displayNameNormalized, 'line user');
    assert.equal(customerData.originSource, 'LINE');
    assert.equal(customerData.createdByType, 'SYSTEM');
    assert.equal('lineUserId' in customerData, false);
    assert.equal(identityData.customerId, 'new');
  });

  it('queries exact duplicate keys separately so a common-name limit cannot hide a tax match', async () => {
    const calls: any[] = [];
    const repo = new PrismaCrmRepository({
      client: {
        crmCustomer: {
          findMany: async ({ where }: any) => {
            calls.push(where);
            if (where.taxIdNormalized) return [customer({ id: 'tax-match', taxIdNormalized: where.taxIdNormalized })];
            return Array.from({ length: 20 }, (_, index) => customer({ id: `name-${index}`, displayName: 'Common', displayNameNormalized: 'common' }));
          },
        },
      },
    } as any);
    const rows = await repo.findDuplicateCustomers('co-1', { taxIdNormalized: '0105512345678', nameNormalized: 'common' });
    assert.equal(calls.length, 2);
    assert.ok(rows.some((row) => row.id === 'tax-match'));
  });

  it('merge transaction re-points every customer relation, keeps a soft alias, and preserves restrictive consent', async () => {
    const relationUpdates: string[] = [];
    const customerUpdates: any[] = [];
    const relation = (name: string) => ({
      count: async () => 1,
      updateMany: async () => { relationUpdates.push(name); return { count: 1 }; },
    });
    const primary = customer({ id: 'primary', consentStatus: 'GRANTED', lineUserId: undefined });
    const revokedAt = new Date('2026-01-02T03:04:05.000Z');
    const secondary = customer({
      id: 'secondary', consentStatus: 'REVOKED', consentNote: 'Customer revoked via LINE', consentUpdatedAt: revokedAt,
      primaryPhone: '0812345678', primaryPhoneNormalized: '812345678', lineUserId: 'LEGACY-RAW',
    });
    const evidenceWrites: string[] = [];
    const tx: any = {
      $queryRaw: async () => [],
      crmCustomer: {
        findFirst: async ({ where }: any) => where.id === 'secondary' ? secondary : primary,
        findMany: async () => [],
        update: async ({ where, data }: any) => { customerUpdates.push({ id: where.id, data }); return where.id === 'primary' ? { ...primary, ...data } : { ...secondary, ...data }; },
      },
      crmBooking: relation('bookings'),
      crmContactPerson: relation('contacts'),
      crmOpportunity: relation('opportunities'),
      crmActivity: relation('activities'),
      crmFollowUpTask: relation('followUps'),
      crmQuotationLink: relation('quotationLinks'),
      crmLead: relation('convertedLeads'),
      crmChannelIdentity: relation('lineIdentities'),
      crmConversation: relation('conversations'),
      auditLog: { create: async () => { evidenceWrites.push('audit'); } },
      outboxEvent: {
        findUnique: async () => null,
        create: async ({ data }: any) => { evidenceWrites.push(data.eventKey); },
      },
    };
    const repo = new PrismaCrmRepository({ client: { $transaction: async (fn: any) => fn(tx) } } as any);
    const result = await repo.mergeCustomers({
      companyId: 'co-1', primaryCustomerId: 'primary', secondaryCustomerId: 'secondary', userId: 'owner',
      evidence: { requestId: 'req-merge', reason: 'same person' },
    });
    assert.deepEqual(new Set(relationUpdates), new Set(['bookings', 'contacts', 'opportunities', 'activities', 'followUps', 'quotationLinks', 'convertedLeads', 'lineIdentities', 'conversations']));
    assert.equal(result.impact.bookings, 1);
    const primaryUpdate = customerUpdates.find((update) => update.id === 'primary').data;
    assert.equal(primaryUpdate.primaryPhone, '0812345678');
    assert.equal(primaryUpdate.consentStatus, 'REVOKED');
    assert.equal(primaryUpdate.consentNote, 'Customer revoked via LINE');
    assert.equal(primaryUpdate.consentUpdatedAt, revokedAt);
    assert.equal('lineUserId' in primaryUpdate, false);
    const secondaryUpdate = customerUpdates.find((update) => update.id === 'secondary').data;
    assert.equal(secondaryUpdate.status, 'MERGED');
    assert.equal(secondaryUpdate.mergedIntoCustomerId, 'primary');
    assert.equal(evidenceWrites[0], 'audit');
    assert.match(evidenceWrites[1], /primary:secondary:req-merge$/);
  });

  it('rechecks opportunity ABAC and reassigned-owner membership under the customer lock', async () => {
    const locks: string[] = [];
    let membershipChecks = 0;
    let activeMember: { id: string } | null = { id: 'member-2' };
    const opportunity = { id: 'opp-1', companyId: 'co-1', customerId: 'c-1', ownerUserId: 'sales-1', status: 'OPEN' };
    const tx: any = {
      $queryRaw: async (strings: TemplateStringsArray) => { locks.push(strings.join('?')); return []; },
      crmOpportunity: {
        findFirst: async () => opportunity,
        updateMany: async () => ({ count: 1 }),
      },
      crmCustomer: { findFirst: async ({ where }: any) => where.personalDataErasedAt ? null : customer({ status: 'ACTIVE' }) },
      companyMembership: { findFirst: async () => { membershipChecks += 1; return activeMember; } },
    };
    const repo = new PrismaCrmRepository({ client: { $transaction: async (fn: any) => fn(tx) } } as any);
    await assert.rejects(
      () => repo.updateOpportunity('co-1', 'opp-1', { ownerUserId: 'sales-2' }, {
        scope: { actorUserId: 'other-user', canManageAll: false }, expectedStatuses: ['OPEN'], reassignedOwnerUserId: 'sales-2',
      }),
      /opportunity_out_of_scope/,
    );
    assert.equal(membershipChecks, 0);
    activeMember = null;
    await assert.rejects(
      () => repo.updateOpportunity('co-1', 'opp-1', { ownerUserId: 'sales-2' }, {
        scope: { actorUserId: 'sales-1', canManageAll: false }, expectedStatuses: ['OPEN'], reassignedOwnerUserId: 'sales-2',
      }),
      /owner_not_active_company_member/,
    );
    assert.equal(membershipChecks, 1);
    assert.equal(locks.some((sql) => sql.includes('crm-customer:')), true);
  });

  it('rechecks new customer ownership inside create and lead-conversion transactions', async () => {
    let customerCreates = 0;
    const createTx: any = {
      companyMembership: { findFirst: async () => null },
      crmCustomer: { create: async () => { customerCreates += 1; return customer(); } },
    };
    const createRepo = new PrismaCrmRepository({ client: { $transaction: async (fn: any) => fn(createTx) } } as any);
    await assert.rejects(
      () => createRepo.createCustomer({
        companyId: 'co-1', displayName: 'Race owner', ownerUserId: 'revoked-owner', createdByUserId: 'sales-1',
      }),
      /owner_not_active_company_member/,
    );

    const conversionTx: any = {
      $queryRaw: async () => [],
      crmLead: {
        findFirst: async () => ({ status: 'NEW', assignedToUserId: 'sales-1' }),
        updateMany: async () => ({ count: 1 }),
      },
      companyMembership: { findFirst: async () => null },
      crmCustomer: { create: async () => { customerCreates += 1; return customer(); } },
    };
    const conversionRepo = new PrismaCrmRepository({ client: { $transaction: async (fn: any) => fn(conversionTx) } } as any);
    await assert.rejects(
      () => conversionRepo.convertLead({
        companyId: 'co-1', leadId: 'lead-1', userId: 'sales-1', convertKey: 'convert-owner-race',
        leadScope: { actorUserId: 'sales-1', canManageAll: false },
        customerData: {
          companyId: 'co-1', displayName: 'Converted', ownerUserId: 'revoked-owner', createdByUserId: 'sales-1',
        },
        customerDuplicateGuard: {
          keys: {}, actorUserId: 'sales-1', canReadAll: false,
        },
      }),
      /owner_not_active_company_member/,
    );
    assert.equal(customerCreates, 0);
  });

  it('blocks a direct follow-up update when a legacy opportunity link resolves to a tombstoned customer', async () => {
    let writes = 0;
    const tx: any = {
      $queryRaw: async () => [],
      crmFollowUpTask: {
        findFirst: async () => ({ id: 'fu-1', companyId: 'co-1', customerId: null, opportunityId: 'opp-1', ownerUserId: 'sales-1', status: 'OPEN' }),
        updateMany: async () => { writes += 1; return { count: 1 }; },
      },
      crmOpportunity: { findFirst: async () => ({ id: 'opp-1', customerId: 'c-1' }) },
      crmCustomer: { findFirst: async ({ where }: any) => where.personalDataErasedAt ? { id: 'c-1', personalDataErasedAt: new Date() } : customer() },
    };
    const repo = new PrismaCrmRepository({ client: { $transaction: async (fn: any) => fn(tx) } } as any);
    await assert.rejects(
      () => repo.updateFollowUp('co-1', 'fu-1', { title: 'Must not persist' }, {
        scope: { actorUserId: 'sales-1', canManageAll: false }, expectedStatuses: ['OPEN'],
      }),
      /customer_not_active/,
    );
    assert.equal(writes, 0);
  });

  it('commits standard customer mutation evidence together and rolls back on outbox failure', async () => {
    const run = async (failOutbox: boolean) => {
      const committed = { customers: [] as any[], audits: [] as any[], outbox: [] as any[] };
      const client = {
        $transaction: async (fn: any) => {
          const staged = { customers: [] as any[], audits: [] as any[], outbox: [] as any[] };
          const tx = {
            crmCustomer: { create: async ({ data }: any) => { const row = customer({ ...data }); staged.customers.push(row); return row; } },
            auditLog: { create: async ({ data }: any) => { staged.audits.push(data); return { id: 'audit-1' }; } },
            outboxEvent: {
              findUnique: async () => null,
              create: async ({ data }: any) => {
                if (failOutbox) throw new Error('outbox_write_failed');
                staged.outbox.push(data);
                return { id: 'event-1' };
              },
            },
          };
          const result = await fn(tx);
          committed.customers.push(...staged.customers);
          committed.audits.push(...staged.audits);
          committed.outbox.push(...staged.outbox);
          return result;
        },
      };
      const repo = new PrismaCrmRepository({ client } as any);
      const write = () => repo.createCustomer({ companyId: 'co-1', displayName: 'Alice', createdByUserId: 'sales-1' }, undefined, {
        actorUserId: 'sales-1', requestId: 'req-create-1', action: 'crm.customer.create', eventType: 'crm.customer.created',
        operationKey: 'create', riskLevel: 'LOW', data: { originSource: 'MANUAL' },
      });
      if (failOutbox) await assert.rejects(write, /outbox_write_failed/);
      else await write();
      return committed;
    };
    const success = await run(false);
    assert.deepEqual([success.customers.length, success.audits.length, success.outbox.length], [1, 1, 1]);
    assert.equal(success.outbox[0].eventKey, 'crm.customer.created:crm_customer:c-1:create:req-create-1');
    const rolledBack = await run(true);
    assert.deepEqual([rolledBack.customers.length, rolledBack.audits.length, rolledBack.outbox.length], [0, 0, 0]);
  });

  it('keeps an archive reason only on the customer row and emits non-PII evidence', async () => {
    const secretReason = 'Customer disclosed a private diagnosis';
    let archiveInput: any;
    const repo = {
      findCustomerById: async () => customer({ ownerUserId: 'sales-1' }),
      archiveCustomer: async (input: any) => {
        archiveInput = input;
        return { customer: customer({ status: 'ARCHIVED', archiveReason: input.reason }) };
      },
    } as any;

    await new ArchiveCrmCustomerUseCase(repo, noopAudit, noopOutbox).execute(
      ctx({ permissions: ['crm.customer.archive'], roles: ['SALES'] }),
      'c-1',
      { reason: secretReason },
    );

    assert.equal(archiveInput.reason, secretReason);
    assert.deepEqual(archiveInput.evidence.data, { reasonProvided: true, override: false });
    assert.equal(JSON.stringify(archiveInput.evidence.data).includes(secretReason), false);
  });
});

describe('CRM customer identity migration lineage repair', () => {
  it('fails closed before backfilling activity/follow-up customer lineage', () => {
    const sql = readFileSync(
      join(__dirname, '../../../../../prisma/migrations/20260712150000_crm_customer_identity_management/migration.sql'),
      'utf8',
    );
    const preflight = sql.indexOf('CrmActivity.lineage');
    const activityBackfill = sql.indexOf('UPDATE "CrmActivity" x');
    const followUpBackfill = sql.indexOf('UPDATE "CrmFollowUpTask" x');
    const constraints = sql.indexOf('ALTER TABLE "CrmActivity"\nADD CONSTRAINT');
    assert.ok(preflight >= 0 && preflight < activityBackfill);
    assert.ok(activityBackfill < followUpBackfill && followUpBackfill < constraints);
    assert.match(sql, /COALESCE\(o\."customerId", l\."convertedCustomerId"\)/);
    assert.match(sql, /CRM child customer lineage requires manual remediation/);
  });
});

describe('CRM contact LINE identity boundary', () => {
  const contactCtx = () => ctx({ permissions: ['crm.contact.manage'], roles: ['ADMIN'] });

  it('rejects raw LINE identity writes on contact create and update', async () => {
    const repo = {
      findCustomerById: async () => customer({ ownerUserId: 'sales-1' }),
      findContactById: async () => ({ id: 'contact-1', companyId: 'co-1', customerId: 'c-1' }),
      createContact: async () => { throw new Error('must not create'); },
      updateContact: async () => { throw new Error('must not update'); },
    } as any;
    await assert.rejects(
      () => new CreateCrmContactUseCase(repo, noopAudit).execute(contactCtx(), 'c-1', { name: 'Alice', lineUserId: 'U-raw' } as any),
      /line_identity_link_required/,
    );
    await assert.rejects(
      () => new UpdateCrmContactUseCase(repo, noopAudit).execute(contactCtx(), 'contact-1', { lineUserId: 'U-raw' } as any),
      /line_identity_link_required/,
    );
  });

  it('does not expose a legacy contact LINE id in API output', async () => {
    let createdData: any;
    const repo = {
      findCustomerById: async () => customer({ ownerUserId: 'sales-1' }),
      createContact: async (data: any) => ({
        ...(createdData = data),
        id: 'contact-1',
        ...data,
        lineUserId: 'legacy-secret',
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    } as any;
    const result = await new CreateCrmContactUseCase(repo, noopAudit).execute(contactCtx(), 'c-1', { name: 'Alice', phone: '+66 81 234 5678', email: 'A@EXAMPLE.TEST' });
    assert.equal('lineUserId' in result, false);
    assert.equal(createdData.phoneNormalized, '812345678');
    assert.equal(createdData.emailNormalized, 'a@example.test');
  });

  it('clears normalized contact fields with their display values', async () => {
    let updateData: any;
    const repo = {
      findContactById: async () => ({ id: 'contact-1', companyId: 'co-1', customerId: 'c-1' }),
      findCustomerById: async () => customer({ ownerUserId: 'sales-1' }),
      updateContact: async (_companyId: string, _id: string, data: any) => {
        updateData = data;
        return { id: 'contact-1', companyId: 'co-1', customerId: 'c-1', name: 'Alice', consentStatus: 'UNKNOWN', isPrimary: false, status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date(), ...data };
      },
    } as any;
    await new UpdateCrmContactUseCase(repo, noopAudit).execute(contactCtx(), 'contact-1', { phone: '', email: '' });
    assert.equal(updateData.phone, null);
    assert.equal(updateData.phoneNormalized, null);
    assert.equal(updateData.email, null);
    assert.equal(updateData.emailNormalized, null);
  });
});

describe('ConvertCrmLeadUseCase', () => {
  it('keeps a disqualification reason on the lead but not in audit or outbox evidence', async () => {
    const secretReason = 'Customer disclosed private medical details';
    const auditEntries: any[] = [];
    const outboxEntries: any[] = [];
    let persistedData: any;
    const lead = {
      id: 'lead-1', companyId: 'co-1', status: 'NEW', assignedToUserId: 'sales-1',
      source: 'MANUAL', createdAt: new Date(), updatedAt: new Date(),
    };
    const repo = {
      findLeadById: async () => lead,
      updateLead: async (_companyId: string, _id: string, data: any) => {
        persistedData = data;
        return { ...lead, ...data };
      },
    } as any;
    const audit = { log: async (entry: any) => { auditEntries.push(entry); } } as any;
    const outbox = { append: async (...args: any[]) => { outboxEntries.push(args); } } as any;

    await new DisqualifyCrmLeadUseCase(repo, audit, outbox).execute(
      ctx({ permissions: ['crm.lead.disqualify'] }),
      lead.id,
      { reason: secretReason },
    );

    assert.equal(persistedData.disqualifiedReason, secretReason);
    assert.deepEqual(auditEntries[0].metadataJson, { reasonProvided: true });
    assert.deepEqual(outboxEntries[0][3].data, { reasonProvided: true });
    assert.equal(JSON.stringify({ auditEntries, outboxEntries }).includes(secretReason), false);
  });

  it('does not allow a converted lead to be reassigned away from its canonical lineage', async () => {
    let writes = 0;
    const repo = {
      hasActiveCompanyMember: async () => true,
      findLeadById: async () => ({
        id: 'lead-converted', companyId: 'co-1', status: 'CONVERTED', assignedToUserId: 'sales-1',
        convertedCustomerId: 'c-1', source: 'MANUAL', createdAt: new Date(), updatedAt: new Date(),
      }),
      updateLead: async () => { writes += 1; },
    } as any;
    await assert.rejects(
      () => new AssignCrmLeadUseCase(repo, noopAudit, noopOutbox).execute(
        ctx({ permissions: ['crm.lead.assign'] }),
        'lead-converted',
        { assignedToUserId: 'sales-2' },
      ),
      /Cannot assign a converted lead/,
    );
    assert.equal(writes, 0);
  });

  it('is idempotent: an already-converted lead returns the existing result without re-converting', async () => {
    let convertCalls = 0;
    const lead = { id: 'l-1', companyId: 'co-1', status: 'CONVERTED', assignedToUserId: 'sales-1', convertedCustomerId: 'c-1', convertedOpportunityId: 'o-1', createdAt: new Date(), updatedAt: new Date(), source: 'MANUAL' };
    const repo = {
      findLeadById: async () => lead,
      findCustomerById: async () => ({ id: 'c-1', companyId: 'co-1', displayName: 'X', status: 'ACTIVE', ownerUserId: 'sales-1', customerType: 'UNKNOWN', consentStatus: 'UNKNOWN', createdByUserId: 'u', createdAt: new Date(), updatedAt: new Date() }),
      findOpportunityById: async () => ({ id: 'o-1', companyId: 'co-1', customerId: 'c-1', ownerUserId: 'sales-1', title: 'Deal', stageId: 'st-new', canonicalStageGroup: 'NEW_LEAD', status: 'OPEN', amountEstimate: '0', currency: 'THB', createdByUserId: 'u', createdAt: new Date(), updatedAt: new Date() }),
      convertLead: async () => { convertCalls++; throw new Error('should not convert'); },
    } as any;
    const uc = new ConvertCrmLeadUseCase(repo, noopAudit, noopOutbox);
    const res = await uc.execute(ctx(), 'l-1', {});
    assert.equal(convertCalls, 0);
    assert.equal(res.customer.id, 'c-1');
    assert.equal(res.opportunity?.id, 'o-1');
  });

  it('rejects reusing an idempotency key across a different lead', async () => {
    const repo = {
      findLeadById: async () => ({ id: 'l-2', companyId: 'co-1', status: 'NEW', assignedToUserId: 'sales-1', rawName: 'Bob', createdAt: new Date(), updatedAt: new Date(), source: 'MANUAL' }),
      findLeadByConvertKey: async () => ({ id: 'l-OTHER', companyId: 'co-1', status: 'CONVERTED', createdAt: new Date(), updatedAt: new Date(), source: 'MANUAL' }),
    } as any;
    const uc = new ConvertCrmLeadUseCase(repo, noopAudit, noopOutbox);
    await assert.rejects(() => uc.execute(ctx(), 'l-2', { idempotencyKey: 'dup-key' }), /idempotency_key_reused/);
  });

  it('does not let lead conversion assign a new customer owner without customer-assign permission', async () => {
    const repo = {
      findLeadById: async () => ({ id: 'l-3', companyId: 'co-1', status: 'NEW', assignedToUserId: 'sales-1', rawName: 'Bob', createdAt: new Date(), updatedAt: new Date(), source: 'MANUAL' }),
      findLeadByConvertKey: async () => null,
    } as any;
    const uc = new ConvertCrmLeadUseCase(repo, noopAudit, noopOutbox);
    await assert.rejects(
      () => uc.execute(ctx(), 'l-3', { customer: { displayName: 'Bob', ownerUserId: 'other' } }),
      /crm.customer.assign/,
    );
  });

  it('does not combine SALES mutation rights with FINANCE/AUDITOR company-wide read', async () => {
    const newLeadRepo = {
      findLeadById: async () => ({ id: 'l-4', companyId: 'co-1', status: 'NEW', assignedToUserId: 'sales-1', rawName: 'Bob', createdAt: new Date(), updatedAt: new Date(), source: 'MANUAL' }),
      findCustomerById: async () => customer({ id: 'other-customer', ownerUserId: 'other-sales', status: 'ACTIVE' }),
      findLeadByConvertKey: async () => null,
    } as any;
    await assert.rejects(
      () => new ConvertCrmLeadUseCase(newLeadRepo, noopAudit, noopOutbox).execute(
        ctx({ roles: ['SALES', 'FINANCE'], permissions: ['crm.lead.convert'] }),
        'l-4',
        { existingCustomerId: 'other-customer' },
      ),
      /out of scope/i,
    );

    const retryRepo = {
      findLeadById: async () => ({ id: 'l-5', companyId: 'co-1', status: 'CONVERTED', assignedToUserId: 'sales-1', convertedCustomerId: 'other-customer', createdAt: new Date(), updatedAt: new Date(), source: 'MANUAL' }),
      findCustomerById: async () => customer({ id: 'other-customer', ownerUserId: 'other-sales', status: 'ACTIVE' }),
      findOpportunityById: async () => null,
    } as any;
    await assert.rejects(
      () => new ConvertCrmLeadUseCase(retryRepo, noopAudit, noopOutbox).execute(
        ctx({ roles: ['SALES', 'AUDITOR_READONLY'], permissions: ['crm.lead.convert'] }),
        'l-5',
        {},
      ),
      /out of scope/i,
    );
  });
});

describe('CloseCrmOpportunityUseCase', () => {
  function repoWith(opp: any, updated: any = {}) {
    return {
      findOpportunityById: async () => opp,
      listStages: async () => STAGES,
      updateOpportunity: async (_c: string, _id: string, data: any) => ({ ...opp, ...data, ...updated }),
      createActivity: async () => undefined,
      transitionOpportunity: async ({ data }: any) => ({ ...opp, ...data, ...updated }),
    } as any;
  }
  const openOpp = { id: 'o-1', companyId: 'co-1', customerId: 'c-1', ownerUserId: 'sales-1', title: 'Deal', stageId: 'st-new', canonicalStageGroup: 'NEW_LEAD', status: 'OPEN', amountEstimate: '1000', currency: 'THB', createdByUserId: 'u', createdAt: new Date(), updatedAt: new Date(), quotationLinks: [] };

  it('requires a reason to close LOST', async () => {
    const uc = new CloseCrmOpportunityUseCase(repoWith(openOpp), noopAudit, noopOutbox);
    await assert.rejects(() => uc.execute(ctx(), 'o-1', { result: 'LOST' }), /lost_reason_required/);
  });

  it('requires quote or win reason to close WON', async () => {
    const uc = new CloseCrmOpportunityUseCase(repoWith(openOpp), noopAudit, noopOutbox);
    await assert.rejects(() => uc.execute(ctx(), 'o-1', { result: 'WON' }), /won_requires_quote_or_reason/);
  });

  it('closes WON with a manual win reason', async () => {
    const uc = new CloseCrmOpportunityUseCase(repoWith(openOpp), noopAudit, noopOutbox);
    const res = await uc.execute(ctx(), 'o-1', { result: 'WON', winReason: 'verbal agreement' });
    assert.equal(res.status, 'WON');
  });

  it('does not treat a VOIDED-only quotation link as a valid win link', async () => {
    const oppVoided = { ...openOpp, quotationLinks: [{ id: 'ql', status: 'VOIDED' }] };
    const uc = new CloseCrmOpportunityUseCase(repoWith(oppVoided), noopAudit, noopOutbox);
    await assert.rejects(() => uc.execute(ctx(), 'o-1', { result: 'WON' }), /won_requires_quote_or_reason/);
  });

  it('closes WON when an active (DRAFT) quotation link exists', async () => {
    const oppActive = { ...openOpp, quotationLinks: [{ id: 'ql', status: 'DRAFT' }] };
    const uc = new CloseCrmOpportunityUseCase(repoWith(oppActive), noopAudit, noopOutbox);
    const res = await uc.execute(ctx(), 'o-1', { result: 'WON' });
    assert.equal(res.status, 'WON');
  });

  it('keeps a reopen reason on the activity but emits only reasonProvided evidence', async () => {
    const secretReason = 'Customer disclosed private family details';
    const closed = { ...openOpp, status: 'LOST', canonicalStageGroup: 'LOST' };
    let transitionInput: any;
    const auditEntries: any[] = [];
    const outboxEntries: any[] = [];
    const repo = {
      findOpportunityById: async () => closed,
      listStages: async () => STAGES,
      transitionOpportunity: async (input: any) => {
        transitionInput = input;
        return { ...closed, ...input.data };
      },
    } as any;
    const audit = { log: async (entry: any) => { auditEntries.push(entry); } } as any;
    const outbox = { append: async (...args: any[]) => { outboxEntries.push(args); } } as any;

    await new ReopenCrmOpportunityUseCase(repo, audit, outbox).execute(
      ctx({ permissions: ['crm.opportunity.reopen'] }),
      closed.id,
      { reason: secretReason },
    );

    assert.equal(transitionInput.activity.note.includes(secretReason), true);
    assert.deepEqual(auditEntries[0].metadataJson, { reasonProvided: true });
    assert.deepEqual(outboxEntries[0][3].data, { reasonProvided: true });
    assert.equal(JSON.stringify({ auditEntries, outboxEntries }).includes(secretReason), false);
  });
});

describe('CancelCrmFollowUpUseCase evidence minimization', () => {
  it('keeps the reason on the linked task but not in audit metadata', async () => {
    const secretReason = 'Customer disclosed a private condition';
    let updateData: any;
    const auditEntries: any[] = [];
    const followUp = {
      id: 'fu-1', companyId: 'co-1', customerId: 'c-1', ownerUserId: 'sales-1', title: 'Call',
      dueAt: new Date(Date.now() + 60_000), timezone: 'Asia/Bangkok', priority: 'NORMAL', channel: 'PHONE',
      status: 'OPEN', createdByUserId: 'sales-1', createdAt: new Date(), updatedAt: new Date(),
    };
    const repo = {
      findFollowUpById: async () => followUp,
      updateFollowUp: async (_companyId: string, _id: string, data: any) => {
        updateData = data;
        return { ...followUp, ...data };
      },
    } as any;
    const audit = { log: async (entry: any) => { auditEntries.push(entry); } } as any;

    await new CancelCrmFollowUpUseCase(repo, audit).execute(
      ctx({ permissions: ['crm.follow_up.update'] }),
      followUp.id,
      { reason: secretReason },
    );

    assert.equal(updateData.cancelReason, secretReason);
    assert.deepEqual(auditEntries[0].metadataJson, { reasonProvided: true });
    assert.equal(JSON.stringify(auditEntries).includes(secretReason), false);
  });
});

describe('CompleteCrmFollowUpUseCase chained-task authorization', () => {
  it('requires assign permission before chaining a task to another owner', async () => {
    let writes = 0;
    const followUp = {
      id: 'fu-1', companyId: 'co-1', customerId: 'c-1', ownerUserId: 'sales-1', title: 'Call',
      dueAt: new Date(Date.now() + 60_000), timezone: 'Asia/Bangkok', priority: 'NORMAL', channel: 'PHONE',
      status: 'OPEN', createdByUserId: 'sales-1', createdAt: new Date(), updatedAt: new Date(),
    };
    const repo = {
      findFollowUpById: async () => followUp,
      completeFollowUp: async () => { writes += 1; },
    } as any;
    await assert.rejects(
      () => new CompleteCrmFollowUpUseCase(repo, noopAudit, noopOutbox).execute(
        ctx({ permissions: ['crm.follow_up.complete'] }),
        followUp.id,
        {
          nextFollowUp: {
            customerId: 'c-1', ownerUserId: 'sales-2', title: 'Next call',
            dueAt: new Date(Date.now() + 120_000).toISOString(),
          },
        },
      ),
      /crm\.customer\.assign/,
    );
    assert.equal(writes, 0);
  });
});

describe('ListCrmActivitiesUseCase (ABAC)', () => {
  it('blocks a SALES user from reading activities of an opportunity they do not own', async () => {
    const repo = {
      findOpportunityById: async () => ({ id: 'o-9', companyId: 'co-1', ownerUserId: 'other-sales' }),
      listActivities: async () => { throw new Error('should not query'); },
    } as any;
    const uc = new ListCrmActivitiesUseCase(repo);
    await assert.rejects(
      () => uc.execute(ctx({ roles: ['SALES'], permissions: ['crm.activity.read'] }), { opportunityId: 'o-9' }),
      /out of scope/i,
    );
  });

  it('restricts a SALES user with no target to their own activity', async () => {
    let queriedActor: string | undefined;
    const repo = { listActivities: async (w: any) => { queriedActor = w.actorUserId; return []; } } as any;
    const uc = new ListCrmActivitiesUseCase(repo);
    await uc.execute(ctx({ roles: ['SALES'], permissions: ['crm.activity.read'] }), {});
    assert.equal(queriedActor, 'sales-1');
  });

  it('lets a MANAGER read activity only for an explicitly assigned opportunity', async () => {
    let called = false;
    const repo = {
      findOpportunityById: async () => ({ id: 'o-9', companyId: 'co-1', ownerUserId: 'sales-1' }),
      listActivities: async () => { called = true; return []; },
    } as any;
    const uc = new ListCrmActivitiesUseCase(repo);
    await uc.execute(ctx({ roles: ['MANAGER'], permissions: ['crm.activity.read'] }), { opportunityId: 'o-9' });
    assert.ok(called);
  });

  it('blocks a SALES user from filtering activity by a lead after reassignment', async () => {
    const repo = {
      findLeadById: async () => ({ id: 'lead-9', companyId: 'co-1', assignedToUserId: 'other-sales' }),
      listActivities: async () => { throw new Error('should not query'); },
    } as any;
    await assert.rejects(
      () => new ListCrmActivitiesUseCase(repo).execute(
        ctx({ roles: ['SALES'], permissions: ['crm.activity.read'] }),
        { leadId: 'lead-9' },
      ),
      /out of scope/i,
    );
  });

  it('lets the current lead owner read the full lead activity timeline', async () => {
    let queriedActor: string | undefined = 'not-called';
    const repo = {
      findLeadById: async () => ({ id: 'lead-9', companyId: 'co-1', assignedToUserId: 'sales-1' }),
      listActivities: async (where: any) => { queriedActor = where.actorUserId; return []; },
    } as any;
    await new ListCrmActivitiesUseCase(repo).execute(
      ctx({ roles: ['SALES'], permissions: ['crm.activity.read'] }),
      { leadId: 'lead-9' },
    );
    assert.equal(queriedActor, undefined);
  });
});

describe('ListCrmQuotationLinksUseCase customer aggregate ABAC', () => {
  it('passes SALES owner scope into the customer quotation query', async () => {
    let captured: unknown[] = [];
    const repo = {
      listQuotationLinksByCustomer: async (...args: unknown[]) => { captured = args; return []; },
    } as any;
    await new ListCrmQuotationLinksUseCase(repo).executeForCustomer(
      ctx({ roles: ['SALES'], permissions: ['crm.opportunity.read'] }),
      'cust-1',
    );
    assert.deepEqual(captured, ['co-1', 'cust-1', 'sales-1']);
  });

  it('keeps company-wide quotation access for read-all roles', async () => {
    let captured: unknown[] = [];
    const repo = {
      listQuotationLinksByCustomer: async (...args: unknown[]) => { captured = args; return []; },
    } as any;
    await new ListCrmQuotationLinksUseCase(repo).executeForCustomer(
      ctx({ roles: ['OWNER'], permissions: ['crm.opportunity.read'] }),
      'cust-1',
    );
    assert.deepEqual(captured, ['co-1', 'cust-1', undefined]);
  });

  it('applies the opportunity-owner predicate in the repository query', async () => {
    let where: unknown;
    const repo = new PrismaCrmRepository({
      client: {
        crmQuotationLink: {
          findMany: async (args: any) => { where = args.where; return []; },
        },
      },
    } as any);
    await repo.listQuotationLinksByCustomer('co-1', 'cust-1', 'sales-1');
    assert.deepEqual(where, {
      companyId: 'co-1',
      customerId: 'cust-1',
      opportunity: { ownerUserId: 'sales-1' },
    });
  });
});

describe('CRM list and child-create ABAC', () => {
  it('does not let caller-supplied owner filters bypass SALES scope', async () => {
    const captured: Record<string, string | undefined> = {};
    await new ListCrmLeadsUseCase({ listLeads: async (where: any) => { captured.lead = where.assignedToUserId; return []; } } as any)
      .execute(ctx({ permissions: ['crm.lead.read'] }), { assignedToUserId: 'other', scope: 'all' });
    await new ListCrmOpportunitiesUseCase({ listOpportunities: async (where: any) => { captured.opportunity = where.ownerUserId; return []; } } as any)
      .execute(ctx({ permissions: ['crm.opportunity.read'] }), { ownerUserId: 'other', scope: 'all' });
    await new ListCrmFollowUpsUseCase({ listFollowUps: async (where: any) => { captured.followUp = where.ownerUserId; return []; } } as any)
      .execute(ctx({ permissions: ['crm.follow_up.read'] }), { ownerUserId: 'other', scope: 'all' });
    assert.deepEqual(captured, { lead: 'sales-1', opportunity: 'sales-1', followUp: 'sales-1' });
  });

  it('blocks out-of-scope opportunity, follow-up, and activity targets before write', async () => {
    let writes = 0;
    const targetRepo = {
      findCustomerById: async () => customer({ ownerUserId: 'other-sales', status: 'ACTIVE' }),
      findOpportunityById: async () => ({ id: 'opp-1', customerId: 'c-1', ownerUserId: 'other-sales', status: 'OPEN' }),
      findLeadById: async () => ({ id: 'lead-1', assignedToUserId: 'other-sales', status: 'NEW' }),
      createOpportunity: async () => { writes += 1; },
      createFollowUp: async () => { writes += 1; },
      createActivity: async () => { writes += 1; },
      ensureDefaultStages: async () => STAGES,
    } as any;
    await assert.rejects(
      () => new CreateCrmOpportunityUseCase(targetRepo, noopAudit, noopOutbox).execute(
        ctx({ permissions: ['crm.opportunity.create'] }),
        { customerId: 'c-1', title: 'No access' },
      ),
      /out of scope/i,
    );
    await assert.rejects(
      () => new CreateCrmFollowUpUseCase(targetRepo, noopAudit, noopOutbox).execute(
        ctx({ permissions: ['crm.follow_up.create'] }),
        { customerId: 'c-1', title: 'No access', dueAt: new Date(Date.now() + 60_000).toISOString() },
      ),
      /out of scope/i,
    );
    await assert.rejects(
      () => new CreateCrmActivityUseCase(targetRepo, noopAudit, noopOutbox).execute(
        ctx({ permissions: ['crm.activity.create'] }),
        { customerId: 'c-1', type: 'NOTE', note: 'No access' },
      ),
      /out of scope/i,
    );
    assert.equal(writes, 0);
  });
});

describe('CreateCrmQuotationDraftUseCase', () => {
  const openOpp = { id: 'o-1', companyId: 'co-1', customerId: 'c-1', ownerUserId: 'sales-1', title: 'Deal', stageId: 'st-new', canonicalStageGroup: 'QUOTATION', status: 'OPEN', amountEstimate: '1000', currency: 'THB', createdByUserId: 'u', createdAt: new Date(), updatedAt: new Date() };

  it('reuses the existing active link instead of creating a second draft', async () => {
    let created = 0;
    const activeLink = { id: 'ql-1', companyId: 'co-1', customerId: 'c-1', opportunityId: 'o-1', accountingDocumentId: 'doc-1', accountingDocumentType: 'QUOTATION', status: 'DRAFT', currency: 'THB', createdByUserId: 'u', createdAt: new Date(), updatedAt: new Date() };
    const repo = {
      findOpportunityById: async () => openOpp,
      findActiveQuotationLink: async () => activeLink,
      findCustomerById: async () => ({ id: 'c-1', accountingCounterpartyId: 'cp-1' }),
      createQuotationDraftBundle: async () => { created++; return activeLink; },
    } as any;
    const createDoc = { execute: async () => { created++; return { id: 'doc-2' }; } } as any;
    const uc = new CreateCrmQuotationDraftUseCase(repo, noopAudit, noopOutbox, createDoc, noopEnsureCounterparty, openLaunchGate);
    const res = await uc.execute(ctx(), 'o-1', {});
    assert.equal(created, 0, 'should not create a new draft or link');
    assert.equal(res.id, 'ql-1');
  });

  it('creates a new draft when a revision reason is provided', async () => {
    const activeLink = { id: 'ql-1', status: 'DRAFT', accountingDocumentId: 'doc-1' };
    let bundleCreated = false;
    const repo = {
      findOpportunityById: async () => openOpp,
      findActiveQuotationLink: async () => activeLink,
      findCustomerById: async () => ({ id: 'c-1', accountingCounterpartyId: 'cp-1' }),
      createQuotationDraftBundle: async (data: any) => {
        bundleCreated = true;
        return { id: 'ql-2', companyId: 'co-1', customerId: 'c-1', opportunityId: 'o-1', accountingDocumentId: 'doc-2', accountingDocumentType: 'QUOTATION', status: 'DRAFT', currency: 'THB', createdAt: new Date(), updatedAt: new Date(), ...data };
      },
    } as any;
    const createDoc = { execute: async () => { throw new Error('must not create outside bundle'); } } as any;
    const uc = new CreateCrmQuotationDraftUseCase(repo, noopAudit, noopOutbox, createDoc, noopEnsureCounterparty, openLaunchGate);
    const res = await uc.execute(ctx(), 'o-1', { revisionReason: 'price change' });
    assert.ok(bundleCreated);
    assert.equal(res.id, 'ql-2');
  });

  it('denies quotation link without accounting permission', async () => {
    const repo = { findOpportunityById: async () => openOpp } as any;
    const uc = new CreateCrmQuotationDraftUseCase(repo, noopAudit, noopOutbox, { execute: async () => ({}) } as any, noopEnsureCounterparty, openLaunchGate);
    await assert.rejects(() => uc.execute(ctx({ permissions: ['crm.quotation.link'] }), 'o-1', {}), /accounting\.quotation\.create/);
  });
});

describe('CreateCrmOpportunityUseCase', () => {
  it('rejects opportunities on an archived customer', async () => {
    const repo = {
      findCustomerById: async () => ({ id: 'c-1', status: 'ARCHIVED', ownerUserId: 'sales-1' }),
      ensureDefaultStages: async () => STAGES,
    } as any;
    const uc = new CreateCrmOpportunityUseCase(repo, noopAudit, noopOutbox);
    await assert.rejects(() => uc.execute(ctx(), { customerId: 'c-1', title: 'Deal' }), /not active/i);
  });
});

describe('UpdateCrmOpportunityUseCase owner reassignment', () => {
  const open = {
    id: 'opp-1', companyId: 'co-1', customerId: 'c-1', ownerUserId: 'sales-1', title: 'Deal',
    stageId: 'st-new', canonicalStageGroup: 'NEW_LEAD', status: 'OPEN', amountEstimate: '0',
    currency: 'THB', createdByUserId: 'sales-1', createdAt: new Date(), updatedAt: new Date(),
  } as any;

  it('requires assign permission and passes final scope/membership evidence to the atomic writer', async () => {
    let guard: any;
    let memberChecks = 0;
    const repo = {
      findOpportunityById: async () => open,
      hasActiveCompanyMember: async () => { memberChecks += 1; return true; },
      updateOpportunity: async (_companyId: string, _id: string, data: any, inputGuard: any) => {
        guard = inputGuard;
        return { ...open, ...data };
      },
    } as any;
    const uc = new UpdateCrmOpportunityUseCase(repo, noopAudit);
    await assert.rejects(
      () => uc.execute(ctx({ permissions: ['crm.opportunity.update'] }), 'opp-1', { ownerUserId: 'sales-2' }),
      /crm.customer.assign/,
    );
    const result = await uc.execute(
      ctx({ permissions: ['crm.opportunity.update', 'crm.customer.assign'] }),
      'opp-1',
      { ownerUserId: 'sales-2' },
    );
    assert.equal(result.ownerUserId, 'sales-2');
    assert.equal(memberChecks, 1);
    assert.deepEqual(guard, {
      scope: { actorUserId: 'sales-1', canManageAll: false },
      expectedStatuses: ['OPEN'],
      reassignedOwnerUserId: 'sales-2',
    });
  });
});
