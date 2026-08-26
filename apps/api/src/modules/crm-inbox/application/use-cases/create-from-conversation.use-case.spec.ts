import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CreateFromConversationUseCase } from './create-from-conversation.use-case';

const ctx = {
  companyId: 'co-1',
  userId: 'staff-1',
  requestId: 'req-1',
  roles: ['ADMIN'],
  permissions: ['crm.opportunity.create', 'crm.quotation.link', 'accounting.quotation.create'],
} as any;

const launchGate = { assertLaunchRouteOpenInTransaction: async () => undefined } as any;
const audit = { log: async () => undefined } as any;
const outbox = { append: async () => undefined } as any;

function makeSut(
  repo: any,
  opportunity: any = {},
  followUp: any = {},
  crmRepo: any = {},
  gate: any = launchGate,
) {
  return new CreateFromConversationUseCase(repo, opportunity, followUp, crmRepo, gate, audit, outbox);
}

function makeRepo(conversation: any = { id: 'conv-1', companyId: 'co-1', customerId: 'cust-1', assignedToUserId: 'staff-1' }) {
  const notes: any[] = [];
  return {
    notes,
    findConversationById: async () => conversation,
    appendOutboundMessage: async (data: any) => { notes.push(data); return { id: 'note-1' }; },
  } as any;
}

describe('CreateFromConversationUseCase (A3)', () => {
  it('createDeal prefills the customer and drops a system note in the thread', async () => {
    const repo = makeRepo();
    const captured: any = {};
    const oppUC = { execute: async (_c: any, input: any) => { captured.opp = input; return { id: 'opp-1', title: input.title }; } } as any;
    const sut = makeSut(repo, oppUC);

    const result = await sut.createDeal(ctx, 'conv-1', { title: 'ดีลลูกค้า LINE', amountEstimate: '5000' });

    assert.equal(captured.opp.customerId, 'cust-1'); // prefilled from conversation
    assert.equal(captured.opp.amountEstimate, '5000');
    assert.equal(result.id, 'opp-1');
    assert.equal(repo.notes.length, 1);
    assert.equal(repo.notes[0].visibility, 'INTERNAL_NOTE');
    assert.equal(repo.notes[0].authorType, 'SYSTEM');
    assert.match(repo.notes[0].contentText, /สร้างดีล/);
  });

  it('createTask prefills the customer', async () => {
    const repo = makeRepo();
    const captured: any = {};
    const fuUC = { execute: async (_c: any, input: any) => { captured.task = input; return { id: 'task-1', title: input.title }; } } as any;
    const sut = makeSut(repo, {}, fuUC);

    await sut.createTask(ctx, 'conv-1', { title: 'โทรกลับ', dueAt: '2026-07-10T03:00:00Z', priority: 'HIGH' });
    assert.equal(captured.task.customerId, 'cust-1');
    assert.equal(captured.task.priority, 'HIGH');
    assert.equal(repo.notes.length, 1);
  });

  it('createQuotation commits one idempotent deal + quotation bundle', async () => {
    const repo = makeRepo();
    const captured: any = {};
    let bundleCalls = 0;
    const now = new Date('2026-08-27T00:00:00.000Z');
    const crmRepo = {
      findCustomerById: async () => ({ id: 'cust-1', status: 'ACTIVE' }),
      createConversationQuotationDraftBundle: async (input: any, beforeMutation: any) => {
        bundleCalls += 1;
        captured.input = input;
        await beforeMutation({});
        return {
          replayed: bundleCalls > 1,
          opportunity: {
            id: input.opportunityId, companyId: input.companyId, customerId: input.customerId,
            ownerUserId: input.userId, title: input.title, stageId: 'stage-1', canonicalStageGroup: 'NEW_LEAD',
            status: 'OPEN', amountEstimate: input.amountEstimate, currency: 'THB', createdByUserId: input.userId,
            createdAt: now, updatedAt: now,
          },
          quotation: {
            id: 'link-1', companyId: input.companyId, customerId: input.customerId,
            opportunityId: input.opportunityId, accountingDocumentId: 'doc-1', accountingDocumentType: 'QUOTATION',
            status: 'DRAFT', currency: 'THB', createdByUserId: input.userId, createdAt: now, updatedAt: now,
          },
        };
      },
    } as any;
    const sut = makeSut(repo, {}, {}, crmRepo);

    const result = await sut.createQuotation({ ...ctx, scopes: { branchIds: ['branch-1'] } }, 'conv-1', {
      title: 'ใบเสนอราคา A',
      amountEstimate: '5000',
      idempotencyKey: 'stable-key-1',
    });
    assert.equal(captured.input.requestKey, 'stable-key-1');
    assert.equal(captured.input.amountEstimate, '5000.0000');
    assert.deepEqual(captured.input.scope.branchIds, ['branch-1']);
    assert.match(captured.input.opportunityId, /^convq_[a-f0-9]{32}$/);
    assert.equal(result.opportunity.id, captured.input.opportunityId);
    assert.equal(result.quotation.id, 'link-1');
    await sut.createQuotation({ ...ctx, scopes: { branchIds: ['branch-1'] } }, 'conv-1', {
      title: 'ใบเสนอราคา A',
      amountEstimate: '5000',
      idempotencyKey: 'stable-key-1',
    });
    assert.equal(repo.notes.length, 1, 'an exact replay must not append a duplicate thread note');
  });

  it('denies missing accounting authority before any opportunity or quotation write', async () => {
    const repo = makeRepo();
    let writes = 0;
    const crmRepo = {
      findCustomerById: async () => ({ id: 'cust-1', status: 'ACTIVE' }),
      createConversationQuotationDraftBundle: async () => { writes += 1; },
    } as any;
    const sut = makeSut(repo, { execute: async () => { writes += 1; } }, {}, crmRepo);
    const denied = { ...ctx, permissions: ['crm.opportunity.create', 'crm.quotation.link'] };

    await assert.rejects(
      () => sut.createQuotation(denied, 'conv-1', { title: 'Q', idempotencyKey: 'key-1' }),
      /accounting\.quotation\.create/,
    );
    assert.equal(writes, 0);
    assert.equal(repo.notes.length, 0);
  });

  it('lets a CLOSED launch check abort the atomic bundle before its first write', async () => {
    const repo = makeRepo();
    let writes = 0;
    const crmRepo = {
      findCustomerById: async () => ({ id: 'cust-1', status: 'ACTIVE' }),
      createConversationQuotationDraftBundle: async (_input: any, beforeMutation: any) => {
        await beforeMutation({});
        writes += 1;
      },
    } as any;
    const gate = { assertLaunchRouteOpenInTransaction: async () => { throw new Error('sales_document_root_closed'); } } as any;
    const sut = makeSut(repo, {}, {}, crmRepo, gate);

    await assert.rejects(
      () => sut.createQuotation(ctx, 'conv-1', { title: 'Q', idempotencyKey: 'key-2' }),
    );
    assert.equal(writes, 0);
    assert.equal(repo.notes.length, 0);
  });

  it('rejects a missing conversation', async () => {
    const repo = { findConversationById: async () => null } as any;
    const sut = makeSut(repo);
    await assert.rejects(() => sut.createDeal(ctx, 'ghost', { title: 'x' }), /not found/i);
  });

  it('enforces conversation scope for scoped roles (SALES not owner/assignee)', async () => {
    const repo = makeRepo({ id: 'conv-1', companyId: 'co-1', customerId: 'cust-1', assignedToUserId: 'someone-else' });
    const sut = makeSut(repo);
    const salesCtx = { ...ctx, roles: ['SALES'], userId: 'staff-1' };
    await assert.rejects(() => sut.createDeal(salesCtx, 'conv-1', { title: 'x' }));
  });
});
