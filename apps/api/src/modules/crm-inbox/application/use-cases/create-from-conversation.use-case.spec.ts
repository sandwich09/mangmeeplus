import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CreateFromConversationUseCase } from './create-from-conversation.use-case';

const ctx = { companyId: 'co-1', userId: 'staff-1', roles: ['ADMIN'], permissions: [] } as any;

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
    const sut = new CreateFromConversationUseCase(repo, oppUC, {} as any, {} as any);

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
    const sut = new CreateFromConversationUseCase(repo, {} as any, fuUC, {} as any);

    await sut.createTask(ctx, 'conv-1', { title: 'โทรกลับ', dueAt: '2026-07-10T03:00:00Z', priority: 'HIGH' });
    assert.equal(captured.task.customerId, 'cust-1');
    assert.equal(captured.task.priority, 'HIGH');
    assert.equal(repo.notes.length, 1);
  });

  it('createQuotation creates the deal first, then a draft on it', async () => {
    const repo = makeRepo();
    const oppUC = { execute: async (_c: any, input: any) => ({ id: 'opp-9', title: input.title }) } as any;
    const captured: any = {};
    const quoUC = { execute: async (_c: any, oppId: string, input: any) => { captured.oppId = oppId; captured.input = input; return { id: 'link-1' }; } } as any;
    const sut = new CreateFromConversationUseCase(repo, oppUC, {} as any, quoUC);

    const result = await sut.createQuotation(ctx, 'conv-1', { title: 'ใบเสนอราคา A', revisionReason: 'rev' });
    assert.equal(captured.oppId, 'opp-9'); // draft attached to the freshly-created deal
    assert.equal(captured.input.revisionReason, 'rev');
    assert.equal(result.opportunity.id, 'opp-9');
    assert.equal(result.quotation.id, 'link-1');
  });

  it('rejects a missing conversation', async () => {
    const repo = { findConversationById: async () => null } as any;
    const sut = new CreateFromConversationUseCase(repo, {} as any, {} as any, {} as any);
    await assert.rejects(() => sut.createDeal(ctx, 'ghost', { title: 'x' }), /not found/i);
  });

  it('enforces conversation scope for scoped roles (SALES not owner/assignee)', async () => {
    const repo = makeRepo({ id: 'conv-1', companyId: 'co-1', customerId: 'cust-1', assignedToUserId: 'someone-else' });
    const sut = new CreateFromConversationUseCase(repo, {} as any, {} as any, {} as any);
    const salesCtx = { ...ctx, roles: ['SALES'], userId: 'staff-1' };
    await assert.rejects(() => sut.createDeal(salesCtx, 'conv-1', { title: 'x' }));
  });
});
