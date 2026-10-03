import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MessagingChannelSecretsService } from './messaging-channel.use-case';
import {
  ListCrmConversationsUseCase,
  GetCrmConversationUseCase,
  GetCrmMessageContentUseCase,
  SendCrmInboxMessageUseCase,
  SetCrmConversationStatusUseCase,
  UpdateCrmConversationAutoReplyUseCase,
  SetCrmConversationPriorityUseCase,
  SetCrmConversationTagsUseCase,
  AssignCrmConversationUseCase,
  MarkCrmConversationReadUseCase,
} from './crm-conversation.use-case';
import { RetryCrmInboxDeliveriesUseCase } from './retry-crm-inbox-deliveries.use-case';
import { CrmConversationController } from '../../presentation/http/crm-conversation.controller';
import { REQUIRED_PERMISSIONS_KEY } from '../../../../common/security/permissions.decorator';

const KEY = Buffer.alloc(32, 7);
const fakeConfig = { credentialEncryptionKey: KEY, publicApiBaseUrl: 'https://api.example.com' } as any;
const secrets = new MessagingChannelSecretsService(fakeConfig);

function ctx(overrides: Partial<any> = {}) {
  return {
    requestId: 'req-1', authSubject: 's', userId: 'staff-1', companyId: 'co-1',
    membershipId: 'm', roles: ['ADMIN'],
    permissions: ['crm.inbox.read', 'crm.inbox.reply', 'crm.inbox.note', 'crm.inbox.assign', 'crm.inbox.resolve'],
    scopes: {}, authProvider: 'dev', ...overrides,
  } as any;
}

function makeAudit() {
  const entries: any[] = [];
  return { entries, log: async (entry: any) => { entries.push(entry); } } as any;
}
const noopOutbox = { append: async () => undefined } as any;

function conversationRecord(overrides: Partial<any> = {}) {
  return {
    id: 'conv-1', companyId: 'co-1', channelId: 'ch-1', customerId: 'cust-1', channelIdentityId: 'ident-1',
    status: 'NEW', priority: 'NORMAL', tags: [], assignedToUserId: null, unreadCount: 2,
    lastMessageAt: new Date(), lastInboundAt: new Date(), lastOutboundAt: null,
    lastMessagePreview: 'สวัสดีค่ะ', firstResponseDueAt: new Date(), firstRespondedAt: null,
    slaBreachedAt: null, resolvedAt: null, resolvedByUserId: null, reopenedCount: 0,
    autoReplyEnabled: true, autoReplyCount: 0, autoReplyCheckedAt: null,
    createdAt: new Date(), updatedAt: new Date(), ...overrides,
  } as any;
}

function channelRecord(overrides: Partial<any> = {}) {
  return {
    id: 'ch-1', companyId: 'co-1', provider: 'LINE_OA', displayName: 'ร้าน',
    lineChannelId: '1234567890',
    encryptedSecretJson: secrets.encrypt({ channelId: '1234567890', channelSecret: 'secret-secret', accessToken: 'token-token-1234' }),
    credentialLast4: '1234', secretVersion: 1, webhookKey: 'whk-abc',
    status: 'ACTIVE', lastWebhookAt: null, lastValidatedAt: null, lastErrorAt: null, lastErrorCode: null,
    connectedByUserId: 'admin-1', disabledAt: null, disabledByUserId: null, disableReason: null,
    createdAt: new Date(), updatedAt: new Date(), ...overrides,
  } as any;
}

function identityRecord(overrides: Partial<any> = {}) {
  return {
    id: 'ident-1', companyId: 'co-1', channelId: 'ch-1', customerId: 'cust-1',
    provider: 'LINE_OA', providerUserId: 'Uabc123', displayName: 'คุณฝ้าย', pictureUrl: null,
    followedAt: new Date(), unfollowedAt: null, status: 'ACTIVE',
    createdAt: new Date(), updatedAt: new Date(), ...overrides,
  } as any;
}

/** Repo fake capturing mutations; names resolve for summary mapping. */
function makeRepo(state: { conversation?: any; channel?: any; identity?: any } = {}) {
  const conversation = state.conversation ?? conversationRecord();
  const calls: Record<string, any[]> = {
    appendOutboundMessage: [], updateMessageDelivery: [], updateConversation: [], updateConversationScopes: [],
    assignConversation: [], markConversationRead: [],
  };
  let messageSeq = 0;
  const repo = {
    calls,
    findConversationById: async (_co: string, id: string) => (id === conversation.id ? conversation : null),
    findChannelById: async () => state.channel ?? channelRecord(),
    findIdentityById: async () => state.identity ?? identityRecord(),
    hasActiveCompanyMember: async () => true,
    withLiveCustomerLock: async (_input: any, callback: (identity: any) => Promise<any>) => callback(state.identity ?? identityRecord()),
    listMessages: async () => [],
    customerDisplayNames: async () => new Map([[conversation.customerId, 'คุณฝ้าย']]),
    userDisplayNames: async () => new Map([['staff-1', 'พนักงานหนึ่ง']]),
    appendOutboundMessage: async (messageData: any, _convId: string, conversationUpdate: any, actorScope: any) => {
      calls['appendOutboundMessage'].push({ messageData, conversationUpdate, actorScope });
      messageSeq += 1;
      return {
        id: `msg-${messageSeq}`, companyId: 'co-1', conversationId: conversation.id,
        direction: messageData.direction, visibility: messageData.visibility,
        authorType: messageData.authorType, authorUserId: messageData.authorUserId,
        messageType: messageData.messageType, contentText: messageData.contentText,
        attachmentId: null, providerMessageId: null, webhookEventId: null,
        deliveryStatus: messageData.deliveryStatus, deliveryError: null,
        sentAt: messageData.sentAt ?? null, createdAt: new Date(),
      };
    },
    updateMessageDelivery: async (id: string, data: any) => {
      calls['updateMessageDelivery'].push({ id, data });
      return {
        id, companyId: 'co-1', conversationId: conversation.id,
        direction: 'OUTBOUND', visibility: 'CUSTOMER', authorType: 'STAFF', authorUserId: 'staff-1',
        messageType: 'TEXT', contentText: 'x', attachmentId: null, providerMessageId: null, webhookEventId: null,
        deliveryStatus: data.deliveryStatus, deliveryError: data.deliveryError ?? null,
        sentAt: data.sentAt ?? null, createdAt: new Date(),
      };
    },
    updateConversation: async (_co: string, _id: string, data: any, actorScope: any) => {
      calls['updateConversation'].push(data);
      calls['updateConversationScopes'].push(actorScope);
      return { ...conversation, ...data };
    },
    assignConversation: async (_co: string, _id: string, assignedToUserId: string | null, actorScope: any) => {
      calls['assignConversation'].push({ assignedToUserId, actorScope });
      return { ...conversation, assignedToUserId };
    },
    markConversationRead: async (...args: any[]) => { calls['markConversationRead'].push(args); },
  } as any;
  return repo;
}

describe('SendCrmInboxMessageUseCase — reply', () => {
  it('pushes to LINE, marks SENT, advances status, and sets firstRespondedAt', async () => {
    const repo = makeRepo();
    const pushes: any[] = [];
    const line = {
      pushTextMessage: async (token: string, to: string, text: string, retryKey: string) => {
        pushes.push({ token, to, text, retryKey });
        return { ok: true };
      },
    } as any;
    const audit = makeAudit();
    const uc = new SendCrmInboxMessageUseCase(repo, secrets, line, audit, noopOutbox);

    const result = await uc.execute(ctx(), 'conv-1', { text: ' สวัสดีค่ะ เดี๋ยวเช็คคิวให้นะคะ ' });

    assert.equal(pushes.length, 1);
    assert.equal(pushes[0].token, 'token-token-1234'); // decrypted channel token
    assert.equal(pushes[0].to, 'Uabc123'); // identity provider user id
    assert.equal(pushes[0].text, 'สวัสดีค่ะ เดี๋ยวเช็คคิวให้นะคะ'); // trimmed
    assert.match(pushes[0].retryKey, /^[0-9a-f-]{36}$/);
    // persisted PENDING first, finalized SENT
    assert.equal(repo.calls.appendOutboundMessage[0].messageData.deliveryStatus, 'PENDING');
    assert.equal(repo.calls.updateMessageDelivery[0].data.deliveryStatus, 'SENT');
    // conversation advanced per มั่งมี Flow A: ส่งข้อความ → รอลูกค้า
    const convUpdate = repo.calls.updateConversation[0];
    assert.equal(convUpdate.status, 'WAITING_CUSTOMER');
    assert.ok(convUpdate.firstRespondedAt instanceof Date);
    assert.equal(convUpdate.lastMessagePreview, 'สวัสดีค่ะ เดี๋ยวเช็คคิวให้นะคะ');
    assert.equal(result.message.deliveryStatus, 'SENT');
    assert.equal(audit.entries[0].action, 'crm.inbox.reply');
    assert.equal(audit.entries[0].result, 'SUCCESS');
  });

  it('keeps firstRespondedAt once set', async () => {
    const responded = new Date('2026-07-01T00:00:00Z');
    const repo = makeRepo({ conversation: conversationRecord({ status: 'OPEN', firstRespondedAt: responded }) });
    const line = { pushTextMessage: async () => ({ ok: true }) } as any;
    const uc = new SendCrmInboxMessageUseCase(repo, secrets, line, makeAudit(), noopOutbox);
    await uc.execute(ctx(), 'conv-1', { text: 'ตามนัดเลยนะคะ' });
    assert.equal(repo.calls.updateConversation[0].firstRespondedAt, undefined);
  });

  it('never starts a staff reply push when erasure wins the final customer lock', async () => {
    const repo = makeRepo();
    repo.withLiveCustomerLock = async () => null;
    let pushes = 0;
    const line = { pushTextMessage: async () => { pushes += 1; return { ok: true }; } } as any;
    const uc = new SendCrmInboxMessageUseCase(repo, secrets, line, makeAudit(), noopOutbox);

    await assert.rejects(() => uc.execute(ctx(), 'conv-1', { text: 'ห้ามส่งหลังลบ' }), /customer_unavailable/);
    assert.equal(pushes, 0);
  });

  it('terminally suppresses the pending reply when reassignment wins before final LINE egress', async () => {
    const repo = makeRepo();
    repo.withLiveCustomerLock = async () => { throw new Error('conversation_assignment_changed'); };
    let pushes = 0;
    const line = { pushTextMessage: async () => { pushes += 1; return { ok: true }; } } as any;
    const uc = new SendCrmInboxMessageUseCase(repo, secrets, line, makeAudit(), noopOutbox);

    await assert.rejects(() => uc.execute(ctx(), 'conv-1', { text: 'ห้าม retry ส่งภายหลัง' }), /out of scope/);
    assert.equal(pushes, 0);
    assert.deepEqual(repo.calls.updateMessageDelivery[0].data, {
      deliveryStatus: 'FAILED', deliveryError: 'conversation_out_of_scope', deliveryNextAttemptAt: null,
    });
  });

  it('A5: keeps a reply PENDING with a retry schedule on a transient push failure (429/5xx)', async () => {
    const repo = makeRepo();
    const line = { pushTextMessage: async () => ({ ok: false, error: 'line_api_500' }) } as any;
    const audit = makeAudit();
    const uc = new SendCrmInboxMessageUseCase(repo, secrets, line, audit, noopOutbox);

    const result = await uc.execute(ctx(), 'conv-1', { text: 'สวัสดีค่ะ' });

    // transient → queued for the reply-retry scanner, not silently lost
    assert.equal(result.message.deliveryStatus, 'PENDING');
    assert.equal(repo.calls.updateMessageDelivery[0].data.deliveryError, 'line_api_500');
    assert.equal(repo.calls.updateMessageDelivery[0].data.deliveryAttemptCount, 1);
    assert.ok(repo.calls.updateMessageDelivery[0].data.deliveryNextAttemptAt instanceof Date);
    assert.equal(repo.calls.updateConversation.length, 0); // no status advance, no firstRespondedAt
    assert.equal(audit.entries[0].result, 'FAILED');
  });

  it('uses the same LINE retry key for initial send and sweep retry of the same message row', async () => {
    const repo = makeRepo();
    const pushes: any[] = [];
    const line = {
      pushTextMessage: async (token: string, to: string, text: string, retryKey: string) => {
        pushes.push({ token, to, text, retryKey });
        return pushes.length === 1 ? { ok: false, error: 'line_api_500' } : { ok: true };
      },
    } as any;
    const send = new SendCrmInboxMessageUseCase(repo, secrets, line, makeAudit(), noopOutbox);

    await send.execute(ctx(), 'conv-1', { text: 'สวัสดีค่ะ' });

    const retryRepo = {
      findRetryableReplies: async () => [{
        id: 'msg-1',
        companyId: 'co-1',
        conversationId: 'conv-1',
        customerId: 'cust-1',
        channelId: 'ch-1',
        channelIdentityId: 'ident-1',
        status: 'NEW',
        firstRespondedAt: null,
        contentText: 'สวัสดีค่ะ',
        deliveryAttemptCount: 1,
      }],
      findChannelById: async () => channelRecord(),
      findIdentityById: async () => identityRecord(),
      withLiveCustomerLock: async (_input: any, callback: (identity: any) => Promise<any>) => callback(identityRecord()),
      processPendingReplyAttempt: async (_input: any, callback: any) => {
        const attempt = await callback({
          channel: channelRecord(),
          identity: identityRecord(),
          conversation: conversationRecord(),
          message: {
            id: 'msg-1', companyId: 'co-1', conversationId: 'conv-1', direction: 'OUTBOUND',
            visibility: 'CUSTOMER', authorType: 'STAFF', contentText: 'สวัสดีค่ะ', deliveryStatus: 'PENDING',
          },
          consentStatus: 'UNKNOWN',
        }, 2);
        return { result: attempt.result, message: { id: 'msg-1' }, attemptCountAfter: 2 };
      },
      updateMessageDelivery: async () => {},
      updateConversation: async () => {},
    } as any;
    const retry = new RetryCrmInboxDeliveriesUseCase(
      retryRepo,
      {} as any,
      secrets,
      line,
      makeAudit(),
      noopOutbox,
      { uploadMaxBytes: 5_000_000 } as any,
    );

    await retry.retryReplies(10);

    assert.equal(pushes.length, 2);
    assert.match(pushes[0].retryKey, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(pushes[0].retryKey, pushes[1].retryKey);
  });

  it('A5: marks FAILED (terminal) on a non-retryable push failure (401 bad token)', async () => {
    const repo = makeRepo();
    const line = { pushTextMessage: async () => ({ ok: false, error: 'invalid_access_token' }) } as any;
    const uc = new SendCrmInboxMessageUseCase(repo, secrets, line, makeAudit(), noopOutbox);

    const result = await uc.execute(ctx(), 'conv-1', { text: 'สวัสดีค่ะ' });

    assert.equal(result.message.deliveryStatus, 'FAILED');
    assert.equal(repo.calls.updateMessageDelivery[0].data.deliveryNextAttemptAt, null);
    assert.equal(repo.calls.updateConversation.length, 0);
  });

  it('rejects a reply without crm.inbox.reply', async () => {
    const uc = new SendCrmInboxMessageUseCase(makeRepo(), secrets, {} as any, makeAudit(), noopOutbox);
    await assert.rejects(
      () => uc.execute(ctx({ permissions: ['crm.inbox.read', 'crm.inbox.note'] }), 'conv-1', { text: 'x' }),
      /crm\.inbox\.reply/,
    );
  });

  it('blocks disabled channels and unfollowed customers', async () => {
    const line = { pushTextMessage: async () => { throw new Error('must not push'); } } as any;
    const disabled = new SendCrmInboxMessageUseCase(
      makeRepo({ channel: channelRecord({ status: 'DISABLED' }) }), secrets, line, makeAudit(), noopOutbox);
    await assert.rejects(() => disabled.execute(ctx(), 'conv-1', { text: 'x' }), /channel_disabled/);

    const unfollowed = new SendCrmInboxMessageUseCase(
      makeRepo({ identity: identityRecord({ status: 'UNFOLLOWED' }) }), secrets, line, makeAudit(), noopOutbox);
    await assert.rejects(() => unfollowed.execute(ctx(), 'conv-1', { text: 'x' }), /customer_unfollowed/);
  });

  it('rejects empty text', async () => {
    const uc = new SendCrmInboxMessageUseCase(makeRepo(), secrets, {} as any, makeAudit(), noopOutbox);
    await assert.rejects(() => uc.execute(ctx(), 'conv-1', { text: '   ' }), /text_required/);
  });
});

describe('SendCrmInboxMessageUseCase — internal note', () => {
  it('persists the note without ever touching the LINE adapter', async () => {
    const repo = makeRepo();
    // Structural send-rejection: the adapter fake throws on ANY call.
    const line = new Proxy({}, { get: () => () => { throw new Error('note path must not touch LINE'); } }) as any;
    const audit = makeAudit();
    const uc = new SendCrmInboxMessageUseCase(repo, secrets, line, audit, noopOutbox);

    const result = await uc.execute(ctx(), 'conv-1', { text: 'ลูกค้าขอคิวช่างแพรวเท่านั้น', visibility: 'INTERNAL_NOTE' });

    assert.equal(result.message.visibility, 'INTERNAL_NOTE');
    assert.equal(result.message.deliveryStatus, 'SENT');
    const appended = repo.calls.appendOutboundMessage[0];
    assert.equal(appended.messageData.visibility, 'INTERNAL_NOTE');
    // annotations do not change triage state or the customer-facing preview
    assert.equal(appended.conversationUpdate.status, undefined);
    assert.equal(appended.conversationUpdate.lastMessagePreview, undefined);
    assert.equal(repo.calls.updateConversation.length, 0);
    assert.equal(audit.entries[0].action, 'crm.inbox.note');
  });

  it('rejects a note without crm.inbox.note', async () => {
    const uc = new SendCrmInboxMessageUseCase(makeRepo(), secrets, {} as any, makeAudit(), noopOutbox);
    await assert.rejects(
      () => uc.execute(ctx({ permissions: ['crm.inbox.read', 'crm.inbox.reply'] }), 'conv-1', { text: 'x', visibility: 'INTERNAL_NOTE' }),
      /crm\.inbox\.note/,
    );
  });
});

describe('SetCrmConversationStatusUseCase', () => {
  it('resolving stamps resolvedAt/resolvedByUserId', async () => {
    const repo = makeRepo({ conversation: conversationRecord({ status: 'OPEN' }) });
    const uc = new SetCrmConversationStatusUseCase(repo, makeAudit(), noopOutbox);
    const summary = await uc.execute(ctx(), 'conv-1', { status: 'RESOLVED' });
    const update = repo.calls.updateConversation[0];
    assert.equal(update.status, 'RESOLVED');
    assert.ok(update.resolvedAt instanceof Date);
    assert.equal(update.resolvedByUserId, 'staff-1');
    assert.equal(summary.status, 'RESOLVED');
  });

  it('manual un-resolve clears the resolution stamp', async () => {
    const repo = makeRepo({ conversation: conversationRecord({ status: 'RESOLVED', resolvedAt: new Date(), resolvedByUserId: 'staff-9' }) });
    const uc = new SetCrmConversationStatusUseCase(repo, makeAudit(), noopOutbox);
    await uc.execute(ctx(), 'conv-1', { status: 'FOLLOW_UP' });
    const update = repo.calls.updateConversation[0];
    assert.equal(update.status, 'FOLLOW_UP');
    assert.equal(update.resolvedAt, null);
    assert.equal(update.resolvedByUserId, null);
  });

  it('same status is a no-op; unknown status is a 400; permission required', async () => {
    const repo = makeRepo({ conversation: conversationRecord({ status: 'OPEN' }) });
    const uc = new SetCrmConversationStatusUseCase(repo, makeAudit(), noopOutbox);
    await uc.execute(ctx(), 'conv-1', { status: 'OPEN' });
    assert.equal(repo.calls.updateConversation.length, 0);
    await assert.rejects(() => uc.execute(ctx(), 'conv-1', { status: 'NOT_A_STATUS' as any }), /Unknown conversation status/);
    await assert.rejects(
      () => uc.execute(ctx({ permissions: ['crm.inbox.read'] }), 'conv-1', { status: 'RESOLVED' }),
      /crm\.inbox\.resolve/,
    );
  });

  it('marking spam mutes the unread badge; other statuses leave it alone', async () => {
    const repo = makeRepo({ conversation: conversationRecord({ status: 'OPEN', unreadCount: 4 }) });
    const uc = new SetCrmConversationStatusUseCase(repo, makeAudit(), noopOutbox);
    await uc.execute(ctx(), 'conv-1', { status: 'SPAM' });
    assert.equal(repo.calls.updateConversation[0].unreadCount, 0);
    await uc.execute(ctx(), 'conv-1', { status: 'FOLLOW_UP' });
    assert.equal('unreadCount' in repo.calls.updateConversation[1], false);
  });
});

describe('UpdateCrmConversationAutoReplyUseCase', () => {
  it('requires crm.inbox.reply in both the route and the use case', async () => {
    assert.deepEqual(
      Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, CrmConversationController.prototype.autoReply),
      ['crm.inbox.reply'],
    );
    const uc = new UpdateCrmConversationAutoReplyUseCase(makeRepo(), makeAudit(), noopOutbox);
    await assert.rejects(
      () => uc.execute(ctx({ permissions: ['crm.inbox.read'] }), 'conv-1', { enabled: false }),
      (error: any) => error?.getStatus?.() === 403,
    );
  });

  it('returns 404 for a conversation id outside the caller company', async () => {
    const repo = {
      findConversationById: async (companyId: string, conversationId: string) => {
        assert.deepEqual([companyId, conversationId], ['co-1', 'conv-other-company']);
        return null;
      },
    } as any;
    const uc = new UpdateCrmConversationAutoReplyUseCase(repo, makeAudit(), noopOutbox);
    await assert.rejects(
      () => uc.execute(ctx(), 'conv-other-company', { enabled: false }),
      (error: any) => error?.getStatus?.() === 404,
    );
  });

  it('persists the flip and writes attributable audit and outbox records', async () => {
    const repo = makeRepo();
    const audit = makeAudit();
    const outboxEntries: any[] = [];
    const outbox = { append: async (...args: any[]) => { outboxEntries.push(args); } } as any;
    const uc = new UpdateCrmConversationAutoReplyUseCase(repo, audit, outbox);

    const result = await uc.execute(ctx(), 'conv-1', { enabled: false });

    assert.deepEqual(repo.calls.updateConversation[0], { autoReplyEnabled: false });
    assert.equal(result.autoReplyEnabled, false);
    assert.equal(audit.entries[0].action, 'crm.inbox.auto_reply_override');
    assert.equal(audit.entries[0].actorUserId, 'staff-1');
    assert.deepEqual(audit.entries[0].metadataJson, { enabled: false, previous: true });
    assert.equal(outboxEntries[0][0], 'crm.conversation.auto_reply_override_changed');
    assert.deepEqual(outboxEntries[0][3].data, { enabled: false, previous: true });
  });

  it('rejects a non-boolean payload without mutating', async () => {
    const repo = makeRepo();
    const uc = new UpdateCrmConversationAutoReplyUseCase(repo, makeAudit(), noopOutbox);
    await assert.rejects(() => uc.execute(ctx(), 'conv-1', { enabled: 'false' as any }), /enabled must be a boolean/);
    assert.equal(repo.calls.updateConversation.length, 0);
  });
});

describe('conversation auto-reply contract mapping', () => {
  it('includes the flag in list and detail responses', async () => {
    const record = conversationRecord({ autoReplyEnabled: false });
    const listRepo = {
      listConversations: async () => ({ items: [record], total: 1 }),
      conversationCounts: async () => ({ statusCounts: {}, overdueCount: 0, mineCount: 0, unassignedCount: 1 }),
      customerDisplayNames: async () => new Map([['cust-1', 'คุณฝ้าย']]),
      userDisplayNames: async () => new Map(),
    } as any;
    const list = await new ListCrmConversationsUseCase(listRepo).execute(ctx({ permissions: ['crm.inbox.read'] }), {});
    const detail = await new GetCrmConversationUseCase(makeRepo({ conversation: record }))
      .execute(ctx({ permissions: ['crm.inbox.read'] }), 'conv-1');

    assert.equal(list.items[0].autoReplyEnabled, false);
    assert.equal(detail.autoReplyEnabled, false);
  });
});

describe('SetCrmConversationPriorityUseCase', () => {
  it('updates priority and audits the transition', async () => {
    const repo = makeRepo();
    const audit = makeAudit();
    const uc = new SetCrmConversationPriorityUseCase(repo, audit, noopOutbox);
    const summary = await uc.execute(ctx(), 'conv-1', { priority: 'URGENT' });
    assert.equal(repo.calls.updateConversation[0].priority, 'URGENT');
    assert.equal(summary.priority, 'URGENT');
    assert.equal(audit.entries[0].action, 'crm.inbox.priority_change');
    assert.deepEqual(audit.entries[0].metadataJson, { from: 'NORMAL', to: 'URGENT' });
  });

  it('same priority is a no-op; unknown value is a 400; permission required', async () => {
    const repo = makeRepo();
    const uc = new SetCrmConversationPriorityUseCase(repo, makeAudit(), noopOutbox);
    await uc.execute(ctx(), 'conv-1', { priority: 'NORMAL' });
    assert.equal(repo.calls.updateConversation.length, 0);
    await assert.rejects(() => uc.execute(ctx(), 'conv-1', { priority: 'CRAZY' as any }), /Unknown conversation priority/);
    await assert.rejects(
      () => uc.execute(ctx({ permissions: ['crm.inbox.read'] }), 'conv-1', { priority: 'HIGH' }),
      /crm\.inbox\.resolve/,
    );
    await assert.rejects(() => uc.execute(ctx(), 'conv-missing', { priority: 'HIGH' }), /not found/i);
  });
});

describe('SetCrmConversationTagsUseCase', () => {
  it('normalizes (trim/dedupe) and stores tagsJson', async () => {
    const repo = makeRepo();
    const audit = makeAudit();
    const outboxEntries: any[] = [];
    const outbox = { append: async (...args: any[]) => { outboxEntries.push(args); } } as any;
    const uc = new SetCrmConversationTagsUseCase(repo, audit, outbox);
    await uc.execute(ctx(), 'conv-1', { tags: [' VIP ', 'vip', 'สนใจสินค้า', ''] });
    assert.deepEqual(repo.calls.updateConversation[0].tagsJson, ['VIP', 'สนใจสินค้า']);
    assert.equal(audit.entries[0].action, 'crm.inbox.tags_change');
    assert.deepEqual(audit.entries[0].metadataJson, { changed: true, fromCount: 0, toCount: 2 });
    assert.deepEqual(outboxEntries[0][3].data, { tagCount: 2 });
    assert.equal(JSON.stringify({ audit: audit.entries, outbox: outboxEntries }).includes('สนใจสินค้า'), false);
  });

  it('identical tag set is a no-op', async () => {
    const repo = makeRepo({ conversation: conversationRecord({ tags: ['VIP'] }) });
    const uc = new SetCrmConversationTagsUseCase(repo, makeAudit(), noopOutbox);
    await uc.execute(ctx(), 'conv-1', { tags: ['VIP'] });
    assert.equal(repo.calls.updateConversation.length, 0);
  });

  it('rejects invalid payloads and missing permission', async () => {
    const repo = makeRepo();
    const uc = new SetCrmConversationTagsUseCase(repo, makeAudit(), noopOutbox);
    await assert.rejects(() => uc.execute(ctx(), 'conv-1', { tags: 'VIP' as any }), /tags_must_be_array/);
    await assert.rejects(() => uc.execute(ctx(), 'conv-1', { tags: [42] as any }), /tags_must_be_strings/);
    await assert.rejects(() => uc.execute(ctx(), 'conv-1', { tags: ['x'.repeat(41)] }), /tag_too_long/);
    await assert.rejects(
      () => uc.execute(ctx(), 'conv-1', { tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }),
      /too_many_tags/,
    );
    await assert.rejects(
      () => uc.execute(ctx({ permissions: ['crm.inbox.read'] }), 'conv-1', { tags: ['VIP'] }),
      /crm\.inbox\.resolve/,
    );
  });
});

describe('AssignCrmConversationUseCase', () => {
  it('assigns and unassigns; blank ids are rejected', async () => {
    const repo = makeRepo();
    const uc = new AssignCrmConversationUseCase(repo, makeAudit(), noopOutbox);
    await uc.execute(ctx(), 'conv-1', { assignedToUserId: 'staff-1' });
    assert.equal(repo.calls.assignConversation[0].assignedToUserId, 'staff-1');
    await uc.execute(ctx(), 'conv-1', { assignedToUserId: null });
    assert.equal(repo.calls.assignConversation[1].assignedToUserId, null);
    await assert.rejects(() => uc.execute(ctx(), 'conv-1', { assignedToUserId: '  ' }), /assignedToUserId/);
  });

  // Spec §13 pickup model: without crm.inbox.assign, reply-capable staff may
  // only claim an unassigned conversation for themselves or release their own.
  const sales = (userId = 'staff-1') =>
    ctx({ userId, roles: ['SALES'], permissions: ['crm.inbox.read', 'crm.inbox.reply', 'crm.inbox.note', 'crm.inbox.resolve'] });

  it('pickup: sales claims an unassigned conversation for themselves', async () => {
    const repo = makeRepo({ conversation: conversationRecord({ assignedToUserId: null }) });
    const uc = new AssignCrmConversationUseCase(repo, makeAudit(), noopOutbox);
    await uc.execute(sales(), 'conv-1', { assignedToUserId: 'staff-1' });
    assert.equal(repo.calls.assignConversation[0].assignedToUserId, 'staff-1');
  });

  it('release: sales returns their own conversation to the queue', async () => {
    const repo = makeRepo({ conversation: conversationRecord({ assignedToUserId: 'staff-1' }) });
    const uc = new AssignCrmConversationUseCase(repo, makeAudit(), noopOutbox);
    await uc.execute(sales(), 'conv-1', { assignedToUserId: null });
    assert.equal(repo.calls.assignConversation[0].assignedToUserId, null);
  });

  it('sales cannot hand a conversation to someone else or take over an assigned one', async () => {
    const unassigned = makeRepo({ conversation: conversationRecord({ assignedToUserId: null }) });
    await assert.rejects(
      () => new AssignCrmConversationUseCase(unassigned, makeAudit(), noopOutbox).execute(sales(), 'conv-1', { assignedToUserId: 'staff-2' }),
      /crm\.inbox\.assign/,
    );
    const taken = makeRepo({ conversation: conversationRecord({ assignedToUserId: 'staff-2' }) });
    await assert.rejects(
      () => new AssignCrmConversationUseCase(taken, makeAudit(), noopOutbox).execute(sales(), 'conv-1', { assignedToUserId: 'staff-1' }),
      /crm\.inbox\.assign/,
    );
  });

  it('read-only callers cannot pick up (auditors stay read-only)', async () => {
    const repo = makeRepo({ conversation: conversationRecord({ assignedToUserId: null }) });
    const uc = new AssignCrmConversationUseCase(repo, makeAudit(), noopOutbox);
    await assert.rejects(
      () => uc.execute(ctx({ roles: ['AUDITOR_READONLY'], permissions: ['crm.inbox.read'] }), 'conv-1', { assignedToUserId: 'staff-1' }),
      /crm\.inbox\.assign/,
    );
  });

  it('rejects an assignee outside the active company membership before writing', async () => {
    const repo = makeRepo();
    repo.hasActiveCompanyMember = async () => false;
    const uc = new AssignCrmConversationUseCase(repo, makeAudit(), noopOutbox);
    await assert.rejects(
      () => uc.execute(ctx(), 'conv-1', { assignedToUserId: 'outsider-1' }),
      /active company member/,
    );
    assert.equal(repo.calls.assignConversation.length, 0);
  });

  it('maps a membership revocation at the final locked write boundary to 400', async () => {
    const repo = makeRepo();
    repo.assignConversation = async () => { throw new Error('assignee_not_active_company_member'); };
    const uc = new AssignCrmConversationUseCase(repo, makeAudit(), noopOutbox);
    await assert.rejects(
      () => uc.execute(ctx(), 'conv-1', { assignedToUserId: 'staff-1' }),
      /active company member/,
    );
  });

  it('fails a stale pickup when assignment changed before the locked write', async () => {
    const repo = makeRepo({ conversation: conversationRecord({ assignedToUserId: null }) });
    repo.assignConversation = async () => { throw new Error('conversation_assignment_changed'); };
    const uc = new AssignCrmConversationUseCase(repo, makeAudit(), noopOutbox);
    await assert.rejects(
      () => uc.execute(sales(), 'conv-1', { assignedToUserId: 'staff-1' }),
      /out of scope/,
    );
  });
});

describe('assignment ABAC scope on reads/mutations', () => {
  const salesCtx = ctx({ roles: ['SALES'], permissions: ['crm.inbox.read', 'crm.inbox.reply', 'crm.inbox.note', 'crm.inbox.resolve'] });
  const otherAgents = conversationRecord({ assignedToUserId: 'staff-2' });

  it('sales cannot open another agent\'s conversation; unassigned stays visible', async () => {
    const uc = new GetCrmConversationUseCase(makeRepo({ conversation: otherAgents }));
    await assert.rejects(() => uc.execute(salesCtx, 'conv-1'), /out of scope/);
    const open = new GetCrmConversationUseCase(makeRepo({ conversation: conversationRecord({ assignedToUserId: null }) }));
    const detail = await open.execute(salesCtx, 'conv-1');
    assert.equal(detail.id, 'conv-1');
  });

  it('managers keep full visibility', async () => {
    const uc = new GetCrmConversationUseCase(makeRepo({ conversation: otherAgents }));
    const detail = await uc.execute(ctx({ roles: ['MANAGER'] }), 'conv-1');
    assert.equal(detail.assignedToUserId, 'staff-2');
  });

  it('scoped mutations and media reads on another agent\'s conversation are refused', async () => {
    await assert.rejects(
      () => new SetCrmConversationStatusUseCase(makeRepo({ conversation: otherAgents }), makeAudit(), noopOutbox)
        .execute(salesCtx, 'conv-1', { status: 'RESOLVED' }),
      /out of scope/,
    );
    await assert.rejects(
      () => new SendCrmInboxMessageUseCase(makeRepo({ conversation: otherAgents }), secrets, {} as any, makeAudit(), noopOutbox)
        .execute(salesCtx, 'conv-1', { text: 'สวัสดี', visibility: 'CUSTOMER' }),
      /out of scope/,
    );
    await assert.rejects(
      () => new MarkCrmConversationReadUseCase(makeRepo({ conversation: otherAgents })).execute(salesCtx, 'conv-1'),
      /out of scope/,
    );
  });
});

describe('ListCrmConversationsUseCase — scope + assignee filter', () => {
  function makeListRepo() {
    const calls: { list: any[]; counts: any[] } = { list: [], counts: [] };
    return {
      calls,
      listConversations: async (companyId: string, filter: any) => {
        calls.list.push({ companyId, filter });
        return { items: [], total: 0 };
      },
      conversationCounts: async (companyId: string, meUserId: string, scopeUserId?: string) => {
        calls.counts.push({ companyId, meUserId, scopeUserId });
        return { statusCounts: {}, overdueCount: 0, mineCount: 3, unassignedCount: 2, unansweredCount: 4 };
      },
      customerDisplayNames: async () => new Map(),
      userDisplayNames: async () => new Map(),
    } as any;
  }

  it('narrows visibility for scoped roles and passes it to counts too', async () => {
    const repo = makeListRepo();
    const result = await new ListCrmConversationsUseCase(repo).execute(
      ctx({ roles: ['SALES'], permissions: ['crm.inbox.read'] }), {},
    );
    assert.equal(repo.calls.list[0].filter.scopeUserId, 'staff-1');
    assert.equal(repo.calls.counts[0].scopeUserId, 'staff-1');
    assert.equal(result.mineCount, 3);
    assert.equal(result.unassignedCount, 2);
  });

  it('manager-tier roles list company-wide', async () => {
    const repo = makeListRepo();
    await new ListCrmConversationsUseCase(repo).execute(ctx(), {});
    assert.equal(repo.calls.list[0].filter.scopeUserId, undefined);
  });

  it('maps assignee=me/none to the repo filter and rejects junk', async () => {
    const repo = makeListRepo();
    const uc = new ListCrmConversationsUseCase(repo);
    await uc.execute(ctx(), { assignee: 'me' });
    assert.equal(repo.calls.list[0].filter.assignedToUserId, 'staff-1');
    await uc.execute(ctx(), { assignee: 'none' });
    assert.equal(repo.calls.list[1].filter.assignedToUserId, null);
    await uc.execute(ctx(), {});
    assert.equal(repo.calls.list[2].filter.assignedToUserId, undefined);
    await assert.rejects(() => uc.execute(ctx(), { assignee: 'everyone' as any }), /assignee/);
  });

  // The dashboard card "ยังไม่ได้ตอบ" opens ?unanswered=true and shows the chip's count.
  it('passes the unanswered filter through and returns the count for its chip', async () => {
    const repo = makeListRepo();
    const result = await new ListCrmConversationsUseCase(repo).execute(ctx(), { unanswered: true } as any);
    assert.equal(repo.calls.list[0].filter.unanswered, true);
    assert.equal((result as any).unansweredCount, 4);
  });

  it('passes the customerId filter through for Customer 360 tabs', async () => {
    const repo = makeListRepo();
    await new ListCrmConversationsUseCase(repo).execute(ctx(), { customerId: ' cust-1 ' });
    assert.equal(repo.calls.list[0].filter.customerId, 'cust-1');
    await new ListCrmConversationsUseCase(repo).execute(ctx(), {});
    assert.equal(repo.calls.list[1].filter.customerId, undefined);
  });
});

describe('MarkCrmConversationReadUseCase', () => {
  it('clears the unread counter for readers', async () => {
    const repo = makeRepo();
    const uc = new MarkCrmConversationReadUseCase(repo);
    const result = await uc.execute(ctx({ permissions: ['crm.inbox.read'] }), 'conv-1');
    assert.deepEqual(result, { ok: true });
    assert.equal(repo.calls.markConversationRead.length, 1);
    await assert.rejects(() => uc.execute(ctx({ permissions: [] }), 'conv-1'), /crm\.inbox\.read/);
  });
});

describe('GetCrmMessageContentUseCase', () => {
  const bytes = Buffer.from('img-bytes');

  function makeContentRepo(overrides: Partial<any> = {}) {
    return {
      findConversationById: async (_co: string, id: string) => (id === 'conv-1' ? conversationRecord() : null),
      findMessageInConversation: async (companyId: string, conversationId: string, messageId: string) =>
        companyId === 'co-1' && conversationId === 'conv-1' && messageId === 'msg-1'
          ? { id: 'msg-1', attachmentId: 'att-1' }
          : null,
      findAttachmentBlob: async (companyId: string, attachmentId: string) =>
        companyId === 'co-1' && attachmentId === 'att-1'
          ? { data: bytes, mimeType: 'image/jpeg', fileName: 'photo.jpg' }
          : null,
      ...overrides,
    } as any;
  }

  it('streams stored bytes for an inbox reader', async () => {
    const uc = new GetCrmMessageContentUseCase(makeContentRepo());
    const result = await uc.execute(ctx({ permissions: ['crm.inbox.read'] }), 'conv-1', 'msg-1');
    assert.equal(result.mimeType, 'image/jpeg');
    assert.equal(result.fileName, 'photo.jpg');
    assert.ok(result.data.equals(bytes));
  });

  it('refuses without crm.inbox.read', async () => {
    const uc = new GetCrmMessageContentUseCase(makeContentRepo());
    await assert.rejects(() => uc.execute(ctx({ permissions: [] }), 'conv-1', 'msg-1'), /crm\.inbox\.read/);
  });

  it('404s the inbox media path after customer erasure', async () => {
    const uc = new GetCrmMessageContentUseCase(makeContentRepo({ findMessageInConversation: async () => null }));
    await assert.rejects(
      () => uc.execute(ctx({ permissions: ['crm.inbox.read'] }), 'conv-1', 'msg-1'),
      /not found/i,
    );
  });

  it('404s when the message is outside the conversation/company scope or has no stored media', async () => {
    const uc = new GetCrmMessageContentUseCase(makeContentRepo());
    // wrong conversation → the conversation-scoped lookup misses
    await assert.rejects(() => uc.execute(ctx(), 'conv-OTHER', 'msg-1'), /not found/i);
    // message exists but nothing was stored (fetch failed or still in flight)
    const noAttachment = makeContentRepo({
      findMessageInConversation: async () => ({ id: 'msg-1', attachmentId: null }),
    });
    await assert.rejects(() => new GetCrmMessageContentUseCase(noAttachment).execute(ctx(), 'conv-1', 'msg-1'), /not found/i);
    // dangling attachment id (blob missing) stays a 404, not a 500
    const noBlob = makeContentRepo({ findAttachmentBlob: async () => null });
    await assert.rejects(() => new GetCrmMessageContentUseCase(noBlob).execute(ctx(), 'conv-1', 'msg-1'), /not found/i);
  });
});
