import 'reflect-metadata';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BillingNotificationsService } from './billing-notifications.service';
import { BILLING_RECIPIENT_CHANGED } from './billing-email-recipient';
import { PostmarkSendError } from '../../auth/infrastructure/postmark.client';

type Row = Record<string, any>;

/** Purchase without setup (R-A7/R-A8): mail follows the recipient column, and bounces flag it once. */
function fixture(options: { recipientEmail?: string | null; changeRow?: Row; companyName?: string } = {}) {
  const account: Row = { id: 'account-1', companyId: 'company-1', stripeAccountId: 'acct_1', livemode: false, version: 3,
    recipientEmail: options.recipientEmail === undefined ? 'docs@example.test' : options.recipientEmail, recipientBouncedAt: null, recipientBounceNotifiedAt: null };
  const invoice = { id: 'invoice-1', billingAccountId: 'account-1', appliedAt: new Date(), applyStatus: 'APPLIED', contractSnapshot: null, providerNumber: 'INV-1' };
  const company = { id: 'company-1', name: options.companyName ?? 'ร้านทดสอบ', status: 'ACTIVE', planTerm: null };
  const members = [{ id: 'm-1', userId: 'user-1', user: { email: 'owner@example.test', emailVerifiedAt: new Date(), displayName: 'Owner' } }];
  const upserts: Row[] = [], events: Row[] = [], sent: Row[] = [], prepared: Row[] = [], attemptUpdates: Row[] = [], audits: Row[] = [], issues: unknown[][] = [];
  const notice = { id: 'notice-1', intentKey: 'billing-recipient-notice:op-1', purpose: 'billing_status', status: 'READY', dispatchStartedAt: null,
    generation: 1, recipient: 'old@example.test' };
  const bounced = { id: 'attempt-9', recipient: 'docs@example.test', status: 'SUPPRESSED', suppressedAt: new Date('2026-09-28T01:00:00.000Z'),
    updatedAt: new Date('2026-09-28T01:00:00.000Z'), errorCode: null };
  let recipientReads = 0, changeRecipientOnRecheck = false;
  const client: Row = {
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('"EmailSendAttempt" a')) return account.recipientBouncedAt === null && account.recipientEmail === bounced.recipient
        ? [{ attemptId: bounced.id, accountId: account.id, companyId: account.companyId }] : [];
      if (sql.includes(`o."aggregateType" = 'BillingAccount'`)) return options.changeRow ? [options.changeRow] : [];
      return [];
    },
    outboxEvent: { findFirst: async ({ where }: Row) => ({ id: where.id }), upsert: async ({ create }: Row) => { upserts.push(create); return create; } },
    billingInvoice: { findUnique: async () => invoice, findFirst: async () => invoice },
    billingAccount: {
      findUnique: async () => account,
      findUniqueOrThrow: async () => { recipientReads++; return changeRecipientOnRecheck && recipientReads > 1 ? { ...account, recipientEmail: 'moved@example.test' } : account; },
      updateMany: async ({ where, data }: Row) => {
        if (account.recipientEmail !== where.recipientEmail || account.recipientBouncedAt !== null) return { count: 0 };
        Object.assign(account, data); return { count: 1 };
      },
      update: async ({ data }: Row) => Object.assign(account, data),
    },
    company: { findUniqueOrThrow: async () => company, findUnique: async () => company },
    companyMembership: { findMany: async () => members },
    emailSendAttempt: {
      findFirst: async ({ where }: Row) => where.id === notice.id && where.intentKey === notice.intentKey ? notice : null,
      findFirstOrThrow: async () => notice,
      findUniqueOrThrow: async () => bounced,
      updateMany: async (input: Row) => { attemptUpdates.push(input); return { count: 1 }; },
    },
    auditLog: { create: async ({ data }: Row) => { audits.push(data); return data; } },
  };
  client.$transaction = async (fn: (tx: unknown) => unknown) => fn(client);
  const billing = { stripe: { enabled: true, accountId: 'acct_1', livemode: false },
    settings: async () => ({ gates: { notification_delivery: true }, settings: { version: 1 } }),
    issue: async (...args: unknown[]) => { issues.push(args); } };
  const config = { postmarkServerId: 1, postmarkMessageStream: 'outbound', postmarkFromAddress: 'system@example.test', postmarkFromName: 'Mangmee',
    sesWebBaseUrl: 'https://app.example.test' };
  const email = { isPostmark: true,
    prepare: async (input: Row) => { const attempt = { id: `attempt-${prepared.length + 1}`, ...input, recipient: input.recipient.trim().toLowerCase() }; prepared.push(attempt); return attempt; },
    send: async (attempt: Row, content: Row) => { sent.push({ attempt, content }); return 'message'; } };
  const outbox = { reclaimStalledProcessing: async () => ({}), markPublished: async () => true, markFailed: async () => true };
  const notifications = { executeInTransaction: async (input: Row) => { events.push(input); return {}; } };
  const service = new BillingNotificationsService({} as any, { client } as any, config as any, billing as any, outbox as any, notifications as any, email as any, {} as any);
  const noticeRow = (data: unknown) => ({ id: 'outbox-1', companyId: 'company-1', aggregateId: 'invoice-1', eventType: 'billing.status.email', claimToken: 'claim',
    headersJson: null, payloadJson: { schemaVersion: 2, data } });
  return { service, account, upserts, events, sent, prepared, attemptUpdates, audits, issues, noticeRow, recheck: () => { changeRecipientOnRecheck = true; } };
}

describe('billing mail to the document recipient (R-A7)', () => {
  it('queues one recipient mail when the column is set, owner fan-out only while it is empty', async () => {
    const f = fixture();
    await (f.service as any).produce({ id: 'applied-1', companyId: 'company-1', aggregateId: 'invoice-1', claimToken: 'claim' });
    const mails = f.upserts.filter(u => u.eventType === 'billing.status.email');
    assert.deepEqual(mails.map(u => [u.eventKey, u.payloadJson]), [['billing:notice-email:invoice-1:recipient', { schemaVersion: 2, data: { recipientUserId: null } }]]);
    const legacy = fixture({ recipientEmail: null });
    await (legacy.service as any).produce({ id: 'applied-1', companyId: 'company-1', aggregateId: 'invoice-1', claimToken: 'claim' });
    assert.deepEqual(legacy.upserts.filter(u => u.eventType === 'billing.status.email').map(u => u.eventKey), ['billing:notice-email:invoice-1:user-1']);
  });

  it('sends to the column recipient whether or not an owner verified an email', async () => {
    const f = fixture();
    await (f.service as any).sendEmail(f.noticeRow({ recipientUserId: null }));
    assert.equal(f.prepared[0]!.recipient, 'docs@example.test'); assert.equal(f.prepared[0]!.intentKey, 'billing-notice:outbox-1');
    assert.equal(f.sent.length, 1); assert.equal(f.sent[0]!.attempt.recipient, 'docs@example.test');
  });

  // R-D1: the resend command queues this same event with `resend: true` (billing-document-resend.ts).
  // It must read as a resend, never as though the package itself changed.
  it('renders the resend copy, not the package-updated one, when the outbox event says resend', async () => {
    const f = fixture();
    await (f.service as any).sendEmail(f.noticeRow({ recipientUserId: null, resend: true }));
    assert.equal(f.sent.length, 1);
    assert.equal(f.sent[0]!.content.subject, 'ส่งเอกสารการชำระเงินอีกครั้ง');
    assert.match(f.sent[0]!.content.text, /ร้านทดสอบ/);
    assert.doesNotMatch(f.sent[0]!.content.text, /อัปเดตแพ็กเกจ/);
    // A plain (non-resend) notice keeps today's subject and template unchanged.
    const g = fixture();
    await (g.service as any).sendEmail(g.noticeRow({ recipientUserId: null }));
    assert.equal(g.sent[0]!.content.subject, 'อัปเดตแพ็กเกจมั่งมี');
  });

  it('rejects a malformed recipient and never sends to a recipient that changed before dispatch', async () => {
    const f = fixture();
    await assert.rejects((f.service as any).sendEmail(f.noticeRow({ recipientUserId: 7 })), /notification_recipient_missing/);
    f.recheck();
    await assert.rejects((f.service as any).sendEmail(f.noticeRow({ recipientUserId: null })),
      (e: unknown) => e instanceof PostmarkSendError && e.kind === 'SUPPRESSED' && e.code === 'recipient_changed');
    assert.equal(f.sent.length, 0); assert.equal(f.attemptUpdates[0]!.data.status, 'RETRY');
  });
});

describe('recipient change notice and bounce flag (R-A7/R-A8)', () => {
  it('drains a completed change: mails the old recipient without naming the new one and tells plan managers', async () => {
    const changeRow = { id: 'change-1', companyId: 'company-1', aggregateType: 'BillingAccount', aggregateId: 'account-1', eventType: BILLING_RECIPIENT_CHANGED,
      claimToken: 'claim', payloadJson: { schemaVersion: 1, data: { operationId: 'op-1', noticeAttemptId: 'notice-1' } } };
    const f = fixture({ recipientEmail: 'new@example.test', changeRow });
    const result = await f.service.drain();
    assert.equal(result.processed, 1); assert.equal(result.failed, 0);
    assert.equal(f.sent.length, 1); assert.equal(f.sent[0]!.attempt.recipient, 'old@example.test');
    assert.match(f.sent[0]!.content.text, /ร้านทดสอบ/); assert.doesNotMatch(f.sent[0]!.content.text + f.sent[0]!.content.html, /new@example\.test/);
    const event = f.events.find(e => e.periodKey === 'recipient-changed:op-1');
    assert.equal(event?.title, 'เปลี่ยนอีเมลรับเอกสารแล้ว'); assert.equal(event?.triggerKey, 'billing.package_updated'); assert.deepEqual(event?.recipientUserIds, ['user-1']);
  });

  // A shop literally named starting with "บริษัท" must not read "บริษัท บริษัท…" in the old-recipient notice.
  it('never doubles บริษัท when the company name already starts with it', async () => {
    const changeRow = { id: 'change-1', companyId: 'company-1', aggregateType: 'BillingAccount', aggregateId: 'account-1', eventType: BILLING_RECIPIENT_CHANGED,
      claimToken: 'claim', payloadJson: { schemaVersion: 1, data: { operationId: 'op-1', noticeAttemptId: 'notice-1' } } };
    const f = fixture({ recipientEmail: 'new@example.test', changeRow, companyName: 'บริษัท ทดสอบ จำกัด' });
    await f.service.drain();
    assert.equal(f.sent.length, 1);
    assert.doesNotMatch(f.sent[0]!.content.text, /บริษัท\s*บริษัท/);
    assert.match(f.sent[0]!.content.text, /ของ บริษัท ทดสอบ จำกัด/);
  });

  it('flags a suppressed recipient once, notifies once, and ignores a bounce of an address no longer in use', async () => {
    const f = fixture();
    await (f.service as any).observeRecipientBounces();
    assert.equal(f.account.recipientBouncedAt?.toISOString(), '2026-09-28T01:00:00.000Z'); assert.ok(f.account.recipientBounceNotifiedAt);
    assert.deepEqual(f.events.map(e => [e.periodKey, e.severity, e.title]), [['recipient-bounce:account-1:2026-09-28T01:00:00.000Z', 'action', 'อีเมลรับเอกสารส่งไม่ถึง']]);
    assert.equal(f.audits[0]!.action, 'billing.recipient.bounced'); assert.doesNotMatch(JSON.stringify(f.audits), /@/);
    await (f.service as any).observeRecipientBounces();
    assert.equal(f.events.length, 1); assert.equal(f.audits.length, 1);
    const moved = fixture({ recipientEmail: 'other@example.test' });
    await (moved.service as any).observeRecipientBounces();
    assert.equal(moved.account.recipientBouncedAt, null); assert.equal(moved.events.length, 0);
  });
});
