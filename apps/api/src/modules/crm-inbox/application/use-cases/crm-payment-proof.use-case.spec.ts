import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CrmPaymentProofUseCase } from './crm-payment-proof.use-case';
import { CrmConversationController } from '../../presentation/http/crm-conversation.controller';
import { CrmPaymentProofQueueController } from '../../presentation/http/crm-conversation-actions.controller';

const ctx = { companyId: 'co-1', userId: 'staff-1', roles: ['ADMIN'], permissions: [], requestId: 'req-1' } as any;
const conversation = { id: 'conv-1', companyId: 'co-1', customerId: 'cust-1', assignedToUserId: 'staff-1' };

function imageMessage(over: Partial<any> = {}) {
  return { id: 'msg-1', companyId: 'co-1', conversationId: 'conv-1', direction: 'INBOUND', messageType: 'IMAGE', attachmentId: 'att-1', ...over };
}

function makeRepo(over: Partial<any> = {}) {
  const calls: any = { links: [], notes: [], proofContent: [] };
  return {
    calls,
    findConversationById: async () => conversation,
    findMessageInConversation: async () => imageMessage(),
    linkPaymentProof: async (input: any) => { calls.links.push(input); return { created: true }; },
    withLiveCustomerDataLock: async (_input: any, callback: () => Promise<unknown>) => callback(),
    findInboxManagerUserIds: async () => ['owner-1'],
    findCustomerDisplayNames: async () => new Map([['cust-1', 'คุณฝ้าย']]),
    appendOutboundMessage: async (data: any) => { calls.notes.push(data); return { id: 'note-1' }; },
    findPaymentProofAttachmentBlob: async (...args: any[]) => {
      calls.proofContent.push(args);
      return { data: Buffer.from('proof-bytes'), mimeType: 'image/jpeg', fileName: 'proof.jpg' };
    },
    ...over,
  } as any;
}

const noopAudit = { log: async () => {} } as any;

describe('CrmPaymentProofUseCase (A3)', () => {
  it('flags an inbound image, links it, notifies managers, and notes the thread', async () => {
    const repo = makeRepo();
    const notifier = { execute: async () => ({ skipped: false }) } as any;
    const sut = new CrmPaymentProofUseCase(repo, noopAudit, notifier);
    const result = await sut.flag(ctx, 'conv-1', 'msg-1');
    assert.deepEqual(result, { ok: true, attachmentId: 'att-1', alreadyFlagged: false });
    assert.equal(repo.calls.links[0].purpose, 'payment_proof');
    assert.equal(repo.calls.links[0].attachmentId, 'att-1');
    assert.equal(repo.calls.notes.length, 1);
  });

  it('is idempotent: re-flagging does not re-notify or re-note', async () => {
    const repo = makeRepo({ linkPaymentProof: async () => ({ created: false }) });
    let notified = 0;
    const notifier = { execute: async () => { notified += 1; return { skipped: false }; } } as any;
    const sut = new CrmPaymentProofUseCase(repo, noopAudit, notifier);
    const result = await sut.flag(ctx, 'conv-1', 'msg-1');
    assert.equal(result.alreadyFlagged, true);
    assert.equal(notified, 0);
    assert.equal(repo.calls.notes.length, 0);
  });

  it('does not create notification or note when erasure wins after the retention link commits', async () => {
    let notified = 0;
    const repo = makeRepo({
      withLiveCustomerDataLock: async () => null,
      appendOutboundMessage: async () => { throw new Error('customer_personal_data_erased'); },
    });
    const notifier = { execute: async () => { notified += 1; return { skipped: false }; } } as any;
    const sut = new CrmPaymentProofUseCase(repo, noopAudit, notifier);

    const result = await sut.flag(ctx, 'conv-1', 'msg-1');
    assert.equal(result.alreadyFlagged, false);
    assert.equal(notified, 0);
    assert.equal(repo.calls.notes.length, 0);
  });

  it('rejects when erasure wins before the finance-retention link is classified', async () => {
    const repo = makeRepo({ linkPaymentProof: async () => { throw new Error('customer_not_active'); } });
    const sut = new CrmPaymentProofUseCase(repo, noopAudit, { execute: async () => ({}) } as any);
    await assert.rejects(
      () => sut.flag(ctx, 'conv-1', 'msg-1'),
      (error: any) => error?.getResponse?.().code === 'customer_not_active',
    );
  });

  it('rejects a non-image / text message', async () => {
    const repo = makeRepo({ findMessageInConversation: async () => imageMessage({ messageType: 'TEXT', attachmentId: null }) });
    const sut = new CrmPaymentProofUseCase(repo, noopAudit, { execute: async () => ({}) } as any);
    await assert.rejects(() => sut.flag(ctx, 'conv-1', 'msg-1'), /not_a_payment_proof_candidate/);
  });

  it('rejects an outbound message', async () => {
    const repo = makeRepo({ findMessageInConversation: async () => imageMessage({ direction: 'OUTBOUND' }) });
    const sut = new CrmPaymentProofUseCase(repo, noopAudit, { execute: async () => ({}) } as any);
    await assert.rejects(() => sut.flag(ctx, 'conv-1', 'msg-1'), /not_a_payment_proof_candidate/);
  });

  it('404s a missing message', async () => {
    const repo = makeRepo({ findMessageInConversation: async () => null });
    const sut = new CrmPaymentProofUseCase(repo, noopAudit, { execute: async () => ({}) } as any);
    await assert.rejects(() => sut.flag(ctx, 'conv-1', 'nope'), /not found/i);
  });

  it('list returns the finance queue', async () => {
    const repo = makeRepo({ listPaymentProofs: async () => [{ attachmentId: 'att-1', conversationId: 'conv-1', customerName: 'คุณฝ้าย' }] });
    const sut = new CrmPaymentProofUseCase(repo, noopAudit, { execute: async () => ({}) } as any);
    const { items } = await sut.list({ ...ctx, permissions: ['accounting.document.read'] });
    assert.equal(items.length, 1);
    assert.equal(items[0].attachmentId, 'att-1');
  });

  it('does not expose the company finance queue to an ordinary SALES inbox reader', async () => {
    let queried = 0;
    const repo = makeRepo({ listPaymentProofs: async () => { queried += 1; return []; } });
    const sut = new CrmPaymentProofUseCase(repo, noopAudit, { execute: async () => ({}) } as any);
    await assert.rejects(
      () => sut.list({ ...ctx, roles: ['SALES'], permissions: ['crm.inbox.read', 'accounting.payment.read'] }),
      /accounting\.document\.read/,
    );
    assert.equal(queried, 0);
  });

  it('serves only the exact purpose-linked proof to accounting readers', async () => {
    const repo = makeRepo();
    const sut = new CrmPaymentProofUseCase(repo, noopAudit, { execute: async () => ({}) } as any);
    const result = await sut.content({ ...ctx, permissions: ['accounting.document.read'] }, 'conv-1', 'msg-1');
    assert.ok(result.data.equals(Buffer.from('proof-bytes')));
    assert.deepEqual(repo.calls.proofContent[0], ['co-1', 'conv-1', 'msg-1', 'crm_conversation', 'payment_proof']);
  });

  it('does not query retained proof bytes without accounting permission', async () => {
    const repo = makeRepo();
    const sut = new CrmPaymentProofUseCase(repo, noopAudit, { execute: async () => ({}) } as any);
    await assert.rejects(
      () => sut.content({ ...ctx, permissions: ['crm.inbox.read'] }, 'conv-1', 'msg-1'),
      /accounting\.document\.read/,
    );
    assert.equal(repo.calls.proofContent.length, 0);
  });

  it('404s media without the exact payment-proof purpose link', async () => {
    const repo = makeRepo({ findPaymentProofAttachmentBlob: async () => null });
    const sut = new CrmPaymentProofUseCase(repo, noopAudit, { execute: async () => ({}) } as any);
    await assert.rejects(
      () => sut.content({ ...ctx, permissions: ['accounting.document.read'] }, 'conv-1', 'msg-1'),
      /not found/i,
    );
  });
});

describe('CRM retained-media controllers', () => {
  function responseStub() {
    const headers = new Map<string, string>();
    return {
      headers,
      response: { setHeader: (name: string, value: string) => headers.set(name, value) } as any,
    };
  }

  it('marks ordinary inbox media as no-store', async () => {
    const controller = Object.assign(Object.create(CrmConversationController.prototype), {
      getMessageContent: { execute: async () => ({ data: Buffer.from('image'), mimeType: 'image/png', fileName: 'image.png' }) },
    }) as CrmConversationController;
    const res = responseStub();
    await controller.content({ ...ctx, permissions: ['crm.inbox.read'] }, 'conv-1', 'msg-1', res.response);
    assert.equal(res.headers.get('Cache-Control'), 'private, no-store, max-age=0');
  });

  it('marks finance purpose-linked media as no-store', async () => {
    const controller = Object.assign(Object.create(CrmPaymentProofQueueController.prototype), {
      paymentProof: { content: async () => ({ data: Buffer.from('proof'), mimeType: 'image/jpeg', fileName: 'proof.jpg' }) },
    }) as CrmPaymentProofQueueController;
    const res = responseStub();
    await controller.content({ ...ctx, permissions: ['accounting.document.read'] }, 'conv-1', 'msg-1', res.response);
    assert.equal(res.headers.get('Cache-Control'), 'private, no-store, max-age=0');
  });
});
