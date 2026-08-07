import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import {
  CrmAiFeedbackUseCase,
  CrmAiInsightsUseCase,
  CrmAiReplyDraftUseCase,
  CrmAiSummaryUseCase,
  CrmAiTrustReadUseCase,
} from './crm-ai-assist.use-case';

function ctx(overrides: Partial<any> = {}) {
  return {
    requestId: 'req-ctx', authSubject: 's', userId: 'staff-1', companyId: 'co-1',
    membershipId: 'm', roles: ['SALES'], permissions: ['crm.ai.assist'],
    scopes: {}, authProvider: 'dev', ...overrides,
  } as any;
}

function conversation(overrides: Partial<any> = {}) {
  return {
    id: 'conv-1', companyId: 'co-1', channelId: 'ch-1', customerId: 'cust-1', channelIdentityId: 'ident-1',
    status: 'OPEN', priority: 'NORMAL', tags: [], assignedToUserId: null, unreadCount: 0,
    lastMessageAt: null, lastInboundAt: null, lastOutboundAt: null, lastMessagePreview: null,
    firstResponseDueAt: null, firstRespondedAt: null, slaBreachedAt: null, resolvedAt: null,
    resolvedByUserId: null, reopenedCount: 0, createdAt: new Date('2026-07-09T00:00:00Z'),
    updatedAt: new Date('2026-07-09T00:00:00Z'), ...overrides,
  } as any;
}

function message(i: number, overrides: Partial<any> = {}) {
  return {
    id: `msg-${i}`, companyId: 'co-1', conversationId: 'conv-1',
    direction: i % 2 === 0 ? 'OUTBOUND' : 'INBOUND', visibility: 'CUSTOMER',
    authorType: i % 2 === 0 ? 'STAFF' : 'CUSTOMER', authorUserId: null,
    messageType: 'TEXT', contentText: `text-${i}`, contentJson: null,
    attachmentId: null, providerMessageId: null, webhookEventId: null,
    deliveryStatus: 'SENT', deliveryError: null, sentAt: null,
    createdAt: new Date(`2026-07-09T00:${String(i).padStart(2, '0')}:00Z`),
    ...overrides,
  } as any;
}

function makeRepo(state: Partial<any> = {}) {
  return {
    findConversationById: async (_companyId: string, id: string) => (id === 'conv-1' ? state.conversation ?? conversation() : null),
    findChannelById: async () => state.channel ?? { id: 'ch-1', displayName: 'LINE ร้าน' },
    withLiveCustomerDataLock: async (_input: any, callback: () => Promise<any>) => callback(),
  } as any;
}

function makeContext(state: Partial<any> = {}) {
  const calls: Record<string, any[]> = {
    listRecentWindowMessages: [],
    listActiveTemplateExamples: [],
    listCustomerVisibleCatalog: [],
    saveConversationSummary: [],
    updateCustomerAdvisory: [],
    saveLiveAssistFeedback: [],
    findCustomerTrustRead: [],
  };
  return {
    calls,
    findCompany: async () => state.company ?? { brandName: 'มั่งมี', name: 'WatchDog' },
    findCustomerConsent: async () => state.consent ?? 'GRANTED',
    findCustomerTrustRead: async (...args: any[]) => {
      calls.findCustomerTrustRead.push(args);
      return state.trustRead ?? {
        trustScore: 81,
        trustScoreFactorsJson: [{ key: 'base', points: 50 }],
        trustScoreComputedAt: new Date('2026-07-09T01:00:00Z'),
      };
    },
    listRecentWindowMessages: async (...args: any[]) => {
      calls.listRecentWindowMessages.push(args);
      return state.messages ?? [message(1)];
    },
    listActiveTemplateExamples: async (...args: any[]) => {
      calls.listActiveTemplateExamples.push(args);
      return state.templates ?? [{ title: 'ทักทาย', bodyText: 'สวัสดีค่ะ' }];
    },
    listCustomerVisibleCatalog: async (...args: any[]) => {
      calls.listCustomerVisibleCatalog.push(args);
      return state.catalog ?? [{ id: 'svc-1', sku: 'S1', name: 'นวดไทย', kind: 'SERVICE', unit: 'ครั้ง', salePrice: '500' }];
    },
    saveConversationSummary: async (...args: any[]) => { calls.saveConversationSummary.push(args); },
    updateCustomerAdvisory: async (...args: any[]) => { calls.updateCustomerAdvisory.push(args); },
    saveLiveAssistFeedback: async (input: any) => {
      calls.saveLiveAssistFeedback.push(input);
      if (state.saveFeedbackThrows) throw state.saveFeedbackThrows;
      return state.existingFeedback ?? { id: 'fb-1', createdAt: new Date('2026-07-09T01:00:00Z') };
    },
  } as any;
}

function makeGateway(handlers: Partial<any> = {}) {
  const calls: Record<string, any[]> = { requestCrmSummary: [], requestCrmReplyDraft: [], requestCrmInsights: [] };
  return {
    calls,
    requestCrmSummary: async (input: any) => {
      calls.requestCrmSummary.push(input);
      return handlers.summary ? handlers.summary(input) : { requestId: input.requestId, status: 'ok', summaryText: 'สรุป', confidence: 0.9 };
    },
    requestCrmReplyDraft: async (input: any) => {
      calls.requestCrmReplyDraft.push(input);
      return handlers.reply ? handlers.reply(input) : { requestId: input.requestId, status: 'ok', draftText: 'ตอบกลับ', confidence: 0.8 };
    },
    requestCrmInsights: async (input: any) => {
      calls.requestCrmInsights.push(input);
      return handlers.insights ? handlers.insights(input) : {
        requestId: input.requestId, status: 'ok', intent: 'QUESTION', sentiment: 'POSITIVE',
        risk: 'LOW', leadScore: 88.6, nextBestAction: 'ตอบกลับ', confidence: 0.8,
      };
    },
  } as any;
}

describe('CRM AI assist shared access/context', () => {
  it('never sends cached customer text to any assist gateway after erasure', async () => {
    for (const kind of ['summary', 'reply', 'insights'] as const) {
      const repo = makeRepo();
      repo.withLiveCustomerDataLock = async () => null;
      const gateway = makeGateway();
      const useCase = kind === 'summary'
        ? new CrmAiSummaryUseCase(repo, makeContext(), gateway)
        : kind === 'reply'
          ? new CrmAiReplyDraftUseCase(repo, makeContext(), gateway)
          : new CrmAiInsightsUseCase(repo, makeContext(), gateway);

      await assert.rejects(() => useCase.execute(ctx(), 'conv-1'), UnprocessableEntityException);
      assert.equal(gateway.calls.requestCrmSummary.length, 0);
      assert.equal(gateway.calls.requestCrmReplyDraft.length, 0);
      assert.equal(gateway.calls.requestCrmInsights.length, 0);
    }
  });

  it('rejects missing permission', async () => {
    const uc = new CrmAiSummaryUseCase(makeRepo(), makeContext(), makeGateway());
    await assert.rejects(() => uc.execute(ctx({ permissions: [] }), 'conv-1'), ForbiddenException);
  });

  it('rejects out-of-scope conversations', async () => {
    const uc = new CrmAiSummaryUseCase(makeRepo({ conversation: conversation({ assignedToUserId: 'other-user' }) }), makeContext(), makeGateway());
    await assert.rejects(() => uc.execute(ctx(), 'conv-1'), ForbiddenException);
  });

  it('reauthorizes the assignee snapshot at the final AI gateway boundary', async () => {
    const repo = makeRepo();
    let guardedInput: any;
    repo.withLiveCustomerDataLock = async (input: any) => {
      guardedInput = input;
      throw new Error('conversation_assignment_changed');
    };
    const gateway = makeGateway();
    const uc = new CrmAiSummaryUseCase(repo, makeContext(), gateway);

    await assert.rejects(() => uc.execute(ctx(), 'conv-1'), ForbiddenException);
    assert.deepEqual(guardedInput.actorScope, {
      actorUserId: 'staff-1', canAccessAll: false, expectedAssignedToUserId: null,
    });
    assert.equal(gateway.calls.requestCrmSummary.length, 0);
  });

  it('excludes notes and empty messages, keeps last 20, oldest to newest, and maps AI role', async () => {
    const messages = [
      message(0, { visibility: 'INTERNAL_NOTE', contentText: 'private note' }),
      message(1, { contentText: '   ' }),
      ...Array.from({ length: 22 }, (_, idx) => message(idx + 2)),
      message(24, { direction: 'OUTBOUND', authorType: 'AI', contentText: 'ai text' }),
    ];
    const repo = makeRepo();
    const context = makeContext({ messages: messages.slice().reverse() });
    const gateway = makeGateway();
    const uc = new CrmAiSummaryUseCase(repo, context, gateway);
    await uc.execute(ctx(), 'conv-1');
    const window = gateway.calls.requestCrmSummary[0].window;
    assert.equal(window.length, 20);
    assert.equal(window[0].text, 'text-5');
    assert.equal(window[0].role, 'CUSTOMER');
    assert.equal(window.at(-1).text, 'ai text');
    assert.equal(window.at(-1).role, 'AI');
    assert.deepEqual(context.calls.listRecentWindowMessages[0], ['co-1', 'conv-1']);
  });

  it('excludes undelivered outbound and operational SYSTEM messages from AI context', async () => {
    const context = makeContext({
      messages: [
        message(4, { direction: 'OUTBOUND', authorType: 'AI', deliveryStatus: 'FAILED', contentText: 'ส่งไม่ถึงลูกค้า' }),
        message(3, { direction: 'OUTBOUND', authorType: 'SYSTEM', deliveryStatus: 'SENT', contentText: 'เจ้าหน้าที่จะติดต่อกลับ' }),
        message(2, { direction: 'OUTBOUND', authorType: 'AI', deliveryStatus: 'SENT', contentText: 'คำตอบที่ลูกค้าเห็น' }),
        message(1, { direction: 'INBOUND', authorType: 'CUSTOMER', contentText: 'ขายอะไรบ้าง' }),
      ],
    });
    const gateway = makeGateway();
    await new CrmAiSummaryUseCase(makeRepo(), context, gateway).execute(ctx(), 'conv-1');

    assert.deepEqual(
      gateway.calls.requestCrmSummary[0].window.map((item: any) => item.text),
      ['ขายอะไรบ้าง', 'คำตอบที่ลูกค้าเห็น'],
    );
  });

  it('caps each window message to 1000 code points', async () => {
    const context = makeContext({ messages: [message(1, { contentText: `${'🙂'.repeat(1000)}x` })] });
    const gateway = makeGateway();
    const uc = new CrmAiSummaryUseCase(makeRepo(), context, gateway);
    await uc.execute(ctx(), 'conv-1');
    const text = gateway.calls.requestCrmSummary[0].window[0].text;
    assert.equal([...text].length, 1000);
    assert.equal(text.endsWith('x'), false);
  });
});

describe('CrmAiSummaryUseCase', () => {
  it('persists ok summaries', async () => {
    const context = makeContext();
    const uc = new CrmAiSummaryUseCase(makeRepo(), context, makeGateway());
    const result = await uc.execute(ctx(), 'conv-1');
    assert.equal(result.status, 'ok');
    assert.equal(context.calls.saveConversationSummary.length, 1);
    assert.equal(context.calls.saveConversationSummary[0][0], 'co-1');
    assert.equal(context.calls.saveConversationSummary[0][2], 'สรุป');
    assert.ok(context.calls.saveConversationSummary[0][3] instanceof Date);
  });

  it('does not persist uncertain summaries', async () => {
    const context = makeContext();
    const gateway = makeGateway({ summary: (input: any) => ({ requestId: input.requestId, status: 'uncertain' }) });
    const uc = new CrmAiSummaryUseCase(makeRepo(), context, gateway);
    const result = await uc.execute(ctx(), 'conv-1');
    assert.equal(result.status, 'uncertain');
    assert.equal(context.calls.saveConversationSummary.length, 0);
  });

  it('does not persist empty or non-string ok summaries', async () => {
    for (const summaryText of ['', '   ', null]) {
      const context = makeContext();
      const gateway = makeGateway({ summary: (input: any) => ({ requestId: input.requestId, status: 'ok', summaryText, confidence: 0.9 }) });
      const uc = new CrmAiSummaryUseCase(makeRepo(), context, gateway);
      const result = await uc.execute(ctx(), 'conv-1');
      assert.equal(result.status, 'ok');
      assert.equal(context.calls.saveConversationSummary.length, 0);
    }
  });

  it('degrades thrown gateway errors to unavailable', async () => {
    const gateway = makeGateway({ summary: () => { throw new Error('down'); } });
    const uc = new CrmAiSummaryUseCase(makeRepo(), makeContext(), gateway);
    const result = await uc.execute(ctx(), 'conv-1');
    assert.equal(result.status, 'unavailable');
    assert.equal(result.error.code, 'PROVIDER_UNKNOWN');
    assert.equal(result.error.message, 'gateway_unreachable');
  });
});

describe('CrmAiReplyDraftUseCase', () => {
  it('always requests STAFF_ASSIST and passes trimmed tone', async () => {
    const gateway = makeGateway();
    const uc = new CrmAiReplyDraftUseCase(makeRepo(), makeContext(), gateway);
    await uc.execute(ctx(), 'conv-1', { tone: ' สุภาพมาก ' });
    const request = gateway.calls.requestCrmReplyDraft[0];
    assert.equal(request.mode, 'STAFF_ASSIST');
    assert.equal(request.tone, 'สุภาพมาก');
    assert.equal(request.brand.brandName, 'มั่งมี');
    assert.equal(request.brand.channelDisplayName, 'LINE ร้าน');
    assert.deepEqual(request.templates, [{ title: 'ทักทาย', body: 'สวัสดีค่ะ' }]);
    assert.equal(request.catalog[0].id, 'svc-1');
    assert.deepEqual((uc as any).context.calls.listActiveTemplateExamples[0], ['co-1']);
    assert.deepEqual((uc as any).context.calls.listCustomerVisibleCatalog[0], ['co-1']);
  });

  it('rejects tone longer than 100 chars', async () => {
    const uc = new CrmAiReplyDraftUseCase(makeRepo(), makeContext(), makeGateway());
    await assert.rejects(() => uc.execute(ctx(), 'conv-1', { tone: 'x'.repeat(101) }), BadRequestException);
  });
});

describe('CrmAiInsightsUseCase', () => {
  it('writes advisory values with clamped integer lead score', async () => {
    const context = makeContext();
    const gateway = makeGateway({ insights: (input: any) => ({
      requestId: input.requestId, status: 'ok', intent: 'QUESTION', sentiment: 'NEGATIVE',
      risk: 'HIGH', leadScore: 120.4, nextBestAction: 'โทรกลับ', confidence: 0.7,
    }) });
    const uc = new CrmAiInsightsUseCase(makeRepo(), context, gateway);
    const result = await uc.execute(ctx(), 'conv-1');
    assert.equal(result.status, 'ok');
    assert.deepEqual(context.calls.updateCustomerAdvisory[0], ['co-1', 'cust-1', { leadScore: 100, sentiment: 'NEGATIVE', riskLevel: 'HIGH' }]);
  });

  it('does not write advisory values for invalid enum results but still returns them', async () => {
    const context = makeContext();
    const gateway = makeGateway({ insights: (input: any) => ({
      requestId: input.requestId, status: 'ok', intent: 'QUESTION', sentiment: 'BAD',
      risk: 'HIGH', leadScore: 50, nextBestAction: 'โทรกลับ', confidence: 0.7,
    }) });
    const uc = new CrmAiInsightsUseCase(makeRepo(), context, gateway);
    const result = await uc.execute(ctx(), 'conv-1');
    assert.equal(result.status, 'ok');
    assert.equal((result as any).sentiment, 'BAD');
    assert.equal(context.calls.updateCustomerAdvisory.length, 0);
  });

  it('does not persist advisory values when consent is revoked', async () => {
    const context = makeContext({ consent: 'REVOKED' });
    const uc = new CrmAiInsightsUseCase(makeRepo(), context, makeGateway());
    const result = await uc.execute(ctx(), 'conv-1');
    assert.equal(result.status, 'ok');
    assert.equal(context.calls.updateCustomerAdvisory.length, 0);
  });
});

describe('CrmAiFeedbackUseCase', () => {
  it('inserts feedback with createdByUserId', async () => {
    const context = makeContext();
    const uc = new CrmAiFeedbackUseCase(makeRepo(), context);
    const result = await uc.execute(ctx(), 'conv-1', { kind: 'SUMMARY', rating: 'UP', comment: ' ดี ', requestId: ' req-ai ' });
    assert.equal(result.id, 'fb-1');
    assert.deepEqual(context.calls.saveLiveAssistFeedback[0], {
      companyId: 'co-1', conversationId: 'conv-1', kind: 'SUMMARY', rating: 'UP',
      comment: 'ดี', requestId: 'req-ai', createdByUserId: 'staff-1',
    });
  });

  it('delegates duplicate feedback idempotency to the locked repository save', async () => {
    const context = makeContext({ existingFeedback: { id: 'fb-existing', createdAt: new Date('2026-07-09T00:00:00Z') } });
    const uc = new CrmAiFeedbackUseCase(makeRepo(), context);
    const result = await uc.execute(ctx(), 'conv-1', { kind: 'INSIGHTS', rating: 'DOWN', comment: 'ใหม่', requestId: 'req-ai' });
    assert.equal(result.id, 'fb-existing');
    assert.equal(context.calls.saveLiveAssistFeedback.length, 1);
    assert.equal(context.calls.saveLiveAssistFeedback[0].requestId, 'req-ai');
  });

  it('rejects a feedback write when the locked repository reports erased customer data', async () => {
    const context = makeContext({ saveFeedbackThrows: new Error('customer_not_active') });
    const uc = new CrmAiFeedbackUseCase(makeRepo(), context);
    await assert.rejects(
      () => uc.execute(ctx(), 'conv-1', { kind: 'SUMMARY', rating: 'UP', requestId: 'req-ai' }),
      (error: any) => error?.getResponse?.().code === 'customer_not_active',
    );
  });

  it('rejects feedback validation failures', async () => {
    const uc = new CrmAiFeedbackUseCase(makeRepo(), makeContext());
    await assert.rejects(() => uc.execute(ctx(), 'conv-1', { kind: 'BAD', rating: 'UP' }), BadRequestException);
    await assert.rejects(() => uc.execute(ctx(), 'conv-1', { kind: 'SUMMARY', rating: 'BAD', requestId: 'req-ai' }), BadRequestException);
    await assert.rejects(() => uc.execute(ctx(), 'conv-1', { kind: 'SUMMARY', rating: 'UP', comment: 'x'.repeat(1001), requestId: 'req-ai' }), BadRequestException);
    await assert.rejects(() => uc.execute(ctx(), 'conv-1', { kind: 'SUMMARY', rating: 'UP', requestId: 'x'.repeat(101) }), BadRequestException);
    await assert.rejects(
      () => uc.execute(ctx(), 'conv-1', { kind: 'SUMMARY', rating: 'UP' }),
      /feedback_request_id_required/,
    );
  });
});

describe('CrmAiTrustReadUseCase', () => {
  it('rejects missing permission', async () => {
    const uc = new CrmAiTrustReadUseCase(makeRepo(), makeContext());
    await assert.rejects(() => uc.execute(ctx({ permissions: [] }), 'conv-1'), ForbiddenException);
  });

  it('rejects out-of-scope conversations', async () => {
    const uc = new CrmAiTrustReadUseCase(makeRepo({ conversation: conversation({ assignedToUserId: 'other-user' }) }), makeContext());
    await assert.rejects(() => uc.execute(ctx(), 'conv-1'), ForbiddenException);
  });

  it('maps null score to NEW', async () => {
    const context = makeContext({ trustRead: { trustScore: null, trustScoreFactorsJson: null, trustScoreComputedAt: null } });
    const uc = new CrmAiTrustReadUseCase(makeRepo(), context);
    const result = await uc.execute(ctx(), 'conv-1');
    assert.deepEqual(result, { trustScore: null, tier: 'NEW', factors: null, computedAt: null });
    assert.deepEqual(context.calls.findCustomerTrustRead[0], ['co-1', 'cust-1']);
  });

  it('maps score 80 to BUILDING', async () => {
    const uc = new CrmAiTrustReadUseCase(makeRepo(), makeContext({ trustRead: {
      trustScore: 80,
      trustScoreFactorsJson: [{ key: 'base', points: 50 }, { key: 'engagement', points: 30 }],
      trustScoreComputedAt: new Date('2026-07-09T01:00:00Z'),
    } }));
    const result = await uc.execute(ctx(), 'conv-1');
    assert.equal(result.tier, 'BUILDING');
    assert.equal(result.computedAt, '2026-07-09T01:00:00.000Z');
  });

  it('maps score 81 to TRUSTED', async () => {
    const uc = new CrmAiTrustReadUseCase(makeRepo(), makeContext({ trustRead: {
      trustScore: 81,
      trustScoreFactorsJson: [{ key: 'base', points: 50 }, { key: 'verified', points: 31 }],
      trustScoreComputedAt: new Date('2026-07-09T01:00:00Z'),
    } }));
    const result = await uc.execute(ctx(), 'conv-1');
    assert.equal(result.tier, 'TRUSTED');
  });
});
