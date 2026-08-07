import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RetryCrmInboxDeliveriesUseCase } from './retry-crm-inbox-deliveries.use-case';

const noopAudit = { log: async () => {} } as any;
const noopOutbox = { append: async () => {} } as any;
const config = { uploadMaxBytes: 5_000_000, crmAiOutboundAllowedDomains: [] } as any;
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const cleanScanner = { assertClean: async () => undefined } as any;
const secrets = { decrypt: () => ({ accessToken: 'tok' }) } as any;
const activeChannel = { status: 'ACTIVE', companyId: 'co-1' };

function baseRepo(over: Partial<any> = {}) {
  const repo: any = {
    findRetryableReplies: async () => [],
    findMediaFetchCandidates: async () => [],
    findProfileEnrichCandidates: async () => [],
    findChannelById: async () => activeChannel,
    findIdentityById: async () => ({ status: 'ACTIVE', providerUserId: 'U1' }),
    withLiveCustomerLock: async (_input: any, callback: (identity: any, consentStatus: string) => Promise<any>) => callback({ status: 'ACTIVE', providerUserId: 'U1' }, 'UNKNOWN'),
    updateMessageDelivery: async () => {},
    updateConversation: async () => {},
    updateMessageContentJson: async () => true,
    storeInboundMediaAttachment: async () => true,
    updateIdentity: async () => {},
    updateIdentityProfileUnlessErased: async () => true,
    ...over,
  };
  repo.processPendingReplyAttempt ??= async (input: any, callback: any) => {
    const live = await repo.withLiveCustomerLock(input, async (identity: any, consentStatus: string) => ({ identity, consentStatus }));
    if (!live) return null;
    const candidate = (await repo.findRetryableReplies()).find((row: any) => row.id === input.messageId);
    const attemptCountAfter = input.expectedAttemptCount + 1;
    const attempt = await callback({
      channel: await repo.findChannelById(input.companyId, candidate?.channelId),
      identity: live.identity,
      consentStatus: live.consentStatus,
      conversation: { status: candidate?.status ?? 'NEW', firstRespondedAt: candidate?.firstRespondedAt ?? null },
      message: { id: input.messageId, authorType: candidate?.authorType ?? 'STAFF', contentText: candidate?.contentText ?? null },
    }, attemptCountAfter);
    const message = await repo.updateMessageDelivery(input.messageId, { ...attempt.messageUpdate, deliveryAttemptCount: attemptCountAfter });
    return message === null ? null : { result: attempt.result, message, attemptCountAfter };
  };
  return repo;
}

describe('RetryCrmInboxDeliveriesUseCase.retryReplies (A5)', () => {
  it('records retry candidates on the shared CRM inbox retry surface', async () => {
    const records: Array<[string, string]> = [];
    let surface = '';
    let flushed = false;
    const shadow = {
      startSweep: (value: string) => {
        surface = value;
        return {
          record: async (companyId: string, featureKey: string) => { records.push([companyId, featureKey]); },
          flush: async () => { flushed = true; return {}; },
        };
      },
    } as any;
    const repo = baseRepo({
      findRetryableReplies: async () => [{
        id: 'm-shadow', companyId: 'co-shadow', conversationId: 'conv-1', channelId: 'ch-1',
        channelIdentityId: 'id-1', status: 'NEW', firstRespondedAt: null,
        contentText: 'hello', deliveryAttemptCount: 1,
      }],
    });
    const line = { pushTextMessage: async () => ({ ok: true }) } as any;
    const sut = new RetryCrmInboxDeliveriesUseCase(
      repo, {} as any, secrets, line, noopAudit, noopOutbox, config, undefined, shadow,
    );

    await sut.retryReplies(10);

    assert.equal(surface, 'crm.inbox.retry');
    assert.deepEqual(records, [['co-shadow', 'crm']]);
    assert.equal(flushed, true);
  });

  it('re-pushes a pending reply and marks it SENT on success', async () => {
    const updates: any[] = [];
    const repo = baseRepo({
      findRetryableReplies: async () => [{ id: 'm1', companyId: 'co-1', conversationId: 'conv-1', channelId: 'ch-1', channelIdentityId: 'id-1', status: 'NEW', firstRespondedAt: null, contentText: 'สวัสดีค่ะ', deliveryAttemptCount: 1 }],
      updateMessageDelivery: async (_id: string, data: any) => { updates.push(data); },
    });
    const line = { pushTextMessage: async () => ({ ok: true }) } as any;
    const audits: any[] = [];
    const audit = { log: async (entry: any) => { audits.push(entry); } } as any;
    const sut = new RetryCrmInboxDeliveriesUseCase(repo, {} as any, secrets, line, audit, noopOutbox, config);
    assert.equal(await sut.retryReplies(10), 1);
    assert.equal(updates[0].deliveryStatus, 'SENT');
    assert.equal(updates[0].deliveryAttemptCount, 2);
    // CUST-01/CUST-11: system reply-retry audit carries the typed actor, never the User FK.
    assert.equal(audits[0].result, 'SUCCESS');
    assert.equal(audits[0].actorType, 'SYSTEM');
    assert.equal(audits[0].actorRefId, 'crm-retry-sweep');
    assert.equal(audits[0].actorUserId, undefined);
  });

  it('keeps a reply PENDING with backoff on a retryable failure', async () => {
    const updates: any[] = [];
    const repo = baseRepo({
      findRetryableReplies: async () => [{ id: 'm1', companyId: 'co-1', conversationId: 'conv-1', channelId: 'ch-1', channelIdentityId: 'id-1', status: 'NEW', firstRespondedAt: null, contentText: 'hi', deliveryAttemptCount: 1 }],
      updateMessageDelivery: async (_id: string, data: any) => { updates.push(data); },
    });
    const before = Date.now();
    const line = { pushTextMessage: async () => ({ ok: false, error: 'line_api_429', retryAfterSeconds: 90 }) } as any;
    const sut = new RetryCrmInboxDeliveriesUseCase(repo, {} as any, secrets, line, noopAudit, noopOutbox, config);
    assert.equal(await sut.retryReplies(10), 0);
    assert.equal(updates[0].deliveryStatus, 'PENDING');
    assert.ok(updates[0].deliveryNextAttemptAt instanceof Date);
    assert.ok(updates[0].deliveryNextAttemptAt.getTime() >= before + 90_000);
    assert.ok(updates[0].deliveryNextAttemptAt.getTime() < before + 92_000);
  });

  it('marks FAILED when the channel is disabled (never succeeds)', async () => {
    const updates: any[] = [];
    const repo = baseRepo({
      findRetryableReplies: async () => [{ id: 'm1', companyId: 'co-1', conversationId: 'conv-1', channelId: 'ch-1', channelIdentityId: 'id-1', status: 'NEW', firstRespondedAt: null, contentText: 'hi', deliveryAttemptCount: 1 }],
      findChannelById: async () => ({ status: 'DISABLED', companyId: 'co-1' }),
      updateMessageDelivery: async (_id: string, data: any) => { updates.push(data); },
    });
    const line = { pushTextMessage: async () => ({ ok: true }) } as any;
    const sut = new RetryCrmInboxDeliveriesUseCase(repo, {} as any, secrets, line, noopAudit, noopOutbox, config);
    assert.equal(await sut.retryReplies(10), 0);
    assert.equal(updates[0].deliveryStatus, 'FAILED');
    assert.equal(updates[0].deliveryError, 'channel_disabled');
  });

  it('never starts a retry push when erasure wins after candidate selection', async () => {
    let pushes = 0;
    const repo = baseRepo({
      findRetryableReplies: async () => [{
        id: 'm1', companyId: 'co-1', conversationId: 'conv-1', customerId: 'cust-1',
        channelId: 'ch-1', channelIdentityId: 'id-1', status: 'NEW', firstRespondedAt: null,
        contentText: 'hi', deliveryAttemptCount: 1,
      }],
      withLiveCustomerLock: async () => null,
    });
    const line = { pushTextMessage: async () => { pushes += 1; return { ok: true }; } } as any;
    const sut = new RetryCrmInboxDeliveriesUseCase(repo, {} as any, secrets, line, noopAudit, noopOutbox, config);

    assert.equal(await sut.retryReplies(10), 0);
    assert.equal(pushes, 0);
  });

  it('suppresses a pending AI reply when consent was revoked before the final retry lock', async () => {
    let pushes = 0;
    const updates: any[] = [];
    const audits: any[] = [];
    const repo = baseRepo({
      findRetryableReplies: async () => [{
        id: 'm-ai', companyId: 'co-1', conversationId: 'conv-1', customerId: 'cust-1',
        channelId: 'ch-1', channelIdentityId: 'id-1', status: 'NEW', firstRespondedAt: null,
        authorType: 'AI', contentText: 'ต้องไม่ส่ง', deliveryAttemptCount: 1,
      }],
      withLiveCustomerLock: async (_input: any, callback: (identity: any, consentStatus: string) => Promise<any>) =>
        callback({ status: 'ACTIVE', providerUserId: 'U1' }, 'REVOKED'),
      updateMessageDelivery: async (_id: string, data: any) => { updates.push(data); return { id: 'm-ai' }; },
    });
    const line = { pushTextMessage: async () => { pushes += 1; return { ok: true }; } } as any;
    const audit = { log: async (entry: any) => { audits.push(entry); } } as any;
    const sut = new RetryCrmInboxDeliveriesUseCase(repo, {} as any, secrets, line, audit, noopOutbox, config);

    assert.equal(await sut.retryReplies(10), 0);
    assert.equal(pushes, 0);
    assert.equal(updates[0].deliveryStatus, 'FAILED');
    assert.equal(updates[0].deliveryError, 'consent_revoked');
    assert.equal(audits[0].result, 'DENIED');
    assert.equal(audits[0].metadataJson.reason, 'consent_revoked');
    assert.equal(audits[0].actorType, 'SYSTEM');
    assert.equal(audits[0].actorRefId, 'crm-retry-sweep');
    assert.equal(audits[0].actorUserId, undefined);
  });

  it('fails closed before retrying a legacy AI draft that violates outbound policy', async () => {
    let pushes = 0;
    const updates: any[] = [];
    const audits: any[] = [];
    const repo = baseRepo({
      findRetryableReplies: async () => [{
        id: 'm-ai-risky', companyId: 'co-1', conversationId: 'conv-1', customerId: 'cust-1',
        channelId: 'ch-1', channelIdentityId: 'id-1', status: 'NEW', firstRespondedAt: null,
        authorType: 'AI', contentText: 'ยืนยันบัญชีที่ https://evil.example/login', deliveryAttemptCount: 1,
      }],
      updateMessageDelivery: async (_id: string, data: any) => { updates.push(data); return { id: 'm-ai-risky' }; },
    });
    const line = { pushTextMessage: async () => { pushes += 1; return { ok: true }; } } as any;
    const audit = { log: async (entry: any) => { audits.push(entry); } } as any;
    const sut = new RetryCrmInboxDeliveriesUseCase(repo, {} as any, secrets, line, audit, noopOutbox, config);

    assert.equal(await sut.retryReplies(10), 0);
    assert.equal(pushes, 0);
    assert.equal(updates[0].deliveryStatus, 'FAILED');
    assert.equal(updates[0].deliveryError, 'outbound_policy_unapproved_url');
    assert.equal(audits[0].result, 'DENIED');
    assert.equal(audits[0].riskLevel, 'HIGH');
    assert.equal(audits[0].metadataJson.reason, 'outbound_policy_unapproved_url');
  });
});

describe('RetryCrmInboxDeliveriesUseCase.retryMedia (A5)', () => {
  it('re-fetches and stores media on success', async () => {
    let stored = false;
    const repo = baseRepo({
      findMediaFetchCandidates: async () => [{ id: 'm1', companyId: 'co-1', channelId: 'ch-1', providerMessageId: 'line-msg-1', contentJson: { fileName: 'a.jpg' } }],
      storeInboundMediaAttachment: async () => { stored = true; return true; },
    });
    const line = { getMessageContent: async () => ({ ok: true, data: JPEG_BYTES, mimeType: 'image/jpeg' }) } as any;
    const sut = new RetryCrmInboxDeliveriesUseCase(repo, {} as any, secrets, line, noopAudit, noopOutbox, config, cleanScanner);
    assert.equal(await sut.retryMedia(10), 1);
    assert.equal(stored, true);
  });

  it('does not persist a retry-fetched LINE file when security inspection rejects it', async () => {
    let stored = false;
    const marks: any[] = [];
    const audits: any[] = [];
    const repo = baseRepo({
      findMediaFetchCandidates: async () => [{ id: 'm1', companyId: 'co-1', channelId: 'ch-1', providerMessageId: 'line-msg-1', contentJson: { fileName: 'a.jpg', lineType: 'image' } }],
      storeInboundMediaAttachment: async () => { stored = true; return true; },
      updateMessageContentJson: async (_id: string, json: any) => { marks.push(json); return true; },
    });
    const line = { getMessageContent: async () => ({ ok: true, data: JPEG_BYTES, mimeType: 'image/jpeg' }) } as any;
    const scanner = { assertClean: async () => { throw new Error('MALWARE_DETECTED'); } } as any;
    const sut = new RetryCrmInboxDeliveriesUseCase(
      repo,
      {} as any,
      secrets,
      line,
      { log: async (entry: any) => { audits.push(entry); } } as any,
      noopOutbox,
      config,
      scanner,
    );

    assert.equal(await sut.retryMedia(10), 0);
    assert.equal(stored, false);
    assert.equal(marks[0].mediaError, 'media_security_rejected');
    assert.equal(audits[0].metadataJson.reason, 'MALWARE_DETECTED');
  });

  it('skips terminal media errors (content_too_large)', async () => {
    let fetched = false;
    const repo = baseRepo({
      findMediaFetchCandidates: async () => [{ id: 'm1', companyId: 'co-1', channelId: 'ch-1', providerMessageId: 'line-msg-1', contentJson: { mediaError: 'content_too_large' } }],
    });
    const line = { getMessageContent: async () => { fetched = true; return { ok: true, data: Buffer.from('x'), mimeType: 'image/jpeg' }; } } as any;
    const sut = new RetryCrmInboxDeliveriesUseCase(repo, {} as any, secrets, line, noopAudit, noopOutbox, config);
    assert.equal(await sut.retryMedia(10), 0);
    assert.equal(fetched, false); // never even attempted the fetch
  });

  it('persists a failure marker on a transient fetch error (no store)', async () => {
    const marks: any[] = [];
    const repo = baseRepo({
      findMediaFetchCandidates: async () => [{ id: 'm1', companyId: 'co-1', channelId: 'ch-1', providerMessageId: 'line-msg-1', contentJson: {} }],
      updateMessageContentJson: async (_id: string, json: any) => { marks.push(json); return true; },
    });
    const line = { getMessageContent: async () => ({ ok: false, error: 'line_api_unreachable' }) } as any;
    const sut = new RetryCrmInboxDeliveriesUseCase(repo, {} as any, secrets, line, noopAudit, noopOutbox, config);
    assert.equal(await sut.retryMedia(10), 0);
    assert.equal(marks[0].mediaError, 'line_api_unreachable');
  });

  it('never starts a media fetch when erasure wins after candidate selection', async () => {
    let fetches = 0;
    const repo = baseRepo({
      findMediaFetchCandidates: async () => [{
        id: 'm1', companyId: 'co-1', conversationId: 'conv-1', customerId: 'cust-1',
        channelId: 'ch-1', channelIdentityId: 'id-1', providerMessageId: 'line-msg-1', contentJson: {},
      }],
      withLiveCustomerLock: async () => null,
    });
    const line = { getMessageContent: async () => { fetches += 1; return { ok: true, data: Buffer.from('x'), mimeType: 'image/jpeg' }; } } as any;
    const sut = new RetryCrmInboxDeliveriesUseCase(repo, {} as any, secrets, line, noopAudit, noopOutbox, config);

    assert.equal(await sut.retryMedia(10), 0);
    assert.equal(fetches, 0);
  });
});

describe('RetryCrmInboxDeliveriesUseCase.enrichProfiles (A5)', () => {
  it('updates the identity and replaces the customer placeholder name', async () => {
    const writes: any[] = [];
    const repo = baseRepo({
      findProfileEnrichCandidates: async () => [{ id: 'id-1', companyId: 'co-1', channelId: 'ch-1', providerUserId: 'U1', customerId: 'cust-1' }],
      updateIdentityProfileUnlessErased: async (input: any) => { writes.push(input); return true; },
    });
    const line = { getProfile: async () => ({ displayName: 'คุณฝ้าย', pictureUrl: 'http://x/p.jpg' }) } as any;
    const sut = new RetryCrmInboxDeliveriesUseCase(repo, {} as any, secrets, line, noopAudit, noopOutbox, config);
    assert.equal(await sut.enrichProfiles(10), 1);
    assert.equal(writes[0].displayName, 'คุณฝ้าย');
    assert.equal(writes[0].placeholderName, 'ลูกค้า LINE');
  });

  it('does not overwrite a staff-edited customer name', async () => {
    const writes: any[] = [];
    const repo = baseRepo({
      findProfileEnrichCandidates: async () => [{ id: 'id-1', companyId: 'co-1', channelId: 'ch-1', providerUserId: 'U1', customerId: 'cust-1' }],
      updateIdentityProfileUnlessErased: async (input: any) => { writes.push(input); return true; },
    });
    const line = { getProfile: async () => ({ displayName: 'คุณฝ้าย' }) } as any;
    const sut = new RetryCrmInboxDeliveriesUseCase(repo, {} as any, secrets, line, noopAudit, noopOutbox, config);
    assert.equal(await sut.enrichProfiles(10), 1);
    assert.equal(writes.length, 1); // atomic repository method preserves staff-edited names itself
  });

  it('never starts profile enrichment when erasure wins after candidate selection', async () => {
    let profileCalls = 0;
    const repo = baseRepo({
      findProfileEnrichCandidates: async () => [{ id: 'id-1', companyId: 'co-1', channelId: 'ch-1', providerUserId: 'U1', customerId: 'cust-1' }],
      withLiveCustomerLock: async () => null,
    });
    const line = { getProfile: async () => { profileCalls += 1; return { displayName: 'ต้องไม่ถูกเรียก' }; } } as any;
    const sut = new RetryCrmInboxDeliveriesUseCase(repo, {} as any, secrets, line, noopAudit, noopOutbox, config);

    assert.equal(await sut.enrichProfiles(10), 0);
    assert.equal(profileCalls, 0);
  });
});
