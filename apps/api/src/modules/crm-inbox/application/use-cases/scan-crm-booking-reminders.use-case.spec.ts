import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ScanCrmBookingRemindersUseCase } from './scan-crm-booking-reminders.use-case';
import { lineReplyRetryKeyForMessage } from '../../domain/logic/crm-inbox.logic';

const secrets = { decrypt: () => ({ accessToken: 'tok' }) } as any;

function booking(over: Partial<any> = {}) {
  return { id: 'bk-1', companyId: 'co-1', customerId: 'cust-1', serviceName: 'ตัดผม', startAt: new Date(Date.now() + 30 * 60000), staffUserId: 'staff-1', reminderAttemptCount: 0, ...over };
}

function makeCrmRepo(due: any[], over: Partial<any> = {}) {
  const claimed: string[] = [];
  const completed: string[] = [];
  const released: string[] = [];
  return {
    claimed,
    completed,
    released,
    findDueBookingReminders: async () => due,
    claimBookingReminder: async (id: string) => { claimed.push(id); return true; },
    completeBookingReminder: async (id: string) => { completed.push(id); return true; },
    releaseBookingReminderForRetry: async (id: string) => { released.push(id); return true; },
    ...over,
  } as any;
}

function makeInboxRepo(over: Partial<any> = {}) {
  return {
    findActiveIdentityForCustomer: async () => ({ channelId: 'ch-1', providerUserId: 'U1' }),
    withLiveCustomerLock: async (_input: any, callback: (identity: any, consentStatus: string) => Promise<any>) => callback({ channelId: 'ch-1', providerUserId: 'U1' }, 'UNKNOWN'),
    withLiveCustomerDataLock: async (_input: any, callback: () => Promise<any>) => callback(),
    findChannelById: async () => ({ status: 'ACTIVE', companyId: 'co-1' }),
    findInboxManagerUserIds: async () => ['owner-1'],
    findCustomerDisplayNames: async () => new Map([['cust-1', 'คุณฝ้าย']]),
    ...over,
  } as any;
}

describe('ScanCrmBookingRemindersUseCase (A7)', () => {
  it('claims the booking, pushes to the customer, and notifies staff', async () => {
    const crmRepo = makeCrmRepo([booking()]);
    const inboxRepo = makeInboxRepo();
    const retryKeys: string[] = [];
    const line = { pushTextMessage: async (_token: string, _userId: string, _text: string, retryKey: string) => { retryKeys.push(retryKey); return { ok: true }; } } as any;
    const notifyCalls: any[] = [];
    const notifier = { execute: async (i: any) => { notifyCalls.push(i); return { skipped: false }; } } as any;
    const sut = new ScanCrmBookingRemindersUseCase(crmRepo, inboxRepo, secrets, line, notifier);

    const result = await sut.execute();
    assert.deepEqual(result, { due: 1, reminded: 1, pushed: 1 });
    assert.deepEqual(crmRepo.claimed, ['bk-1']);
    assert.deepEqual(crmRepo.completed, ['bk-1']);
    assert.deepEqual(retryKeys, [lineReplyRetryKeyForMessage('booking-reminder:bk-1')]);
    assert.equal(notifyCalls[0].triggerKey, 'crm_booking_reminder');
    assert.deepEqual([...notifyCalls[0].recipientUserIds].sort(), ['owner-1', 'staff-1']);
  });

  it('skips a booking already claimed by another sweep pass (no double send)', async () => {
    const crmRepo = makeCrmRepo([booking()], { claimBookingReminder: async () => false });
    const line = { pushTextMessage: async () => { throw new Error('must not push'); } } as any;
    const notifier = { execute: async () => { throw new Error('must not notify'); } } as any;
    const sut = new ScanCrmBookingRemindersUseCase(crmRepo, makeInboxRepo(), secrets, line, notifier);
    const result = await sut.execute();
    assert.deepEqual(result, { due: 1, reminded: 0, pushed: 0 });
  });

  it('still reminds staff when the customer has no LINE identity (no push)', async () => {
    const crmRepo = makeCrmRepo([booking()]);
    const inboxRepo = makeInboxRepo({ withLiveCustomerLock: async () => null });
    let notified = 0;
    const notifier = { execute: async () => { notified += 1; return { skipped: false }; } } as any;
    const sut = new ScanCrmBookingRemindersUseCase(crmRepo, inboxRepo, secrets, { pushTextMessage: async () => ({ ok: true }) } as any, notifier);
    const result = await sut.execute();
    assert.deepEqual(result, { due: 1, reminded: 1, pushed: 0 });
    assert.equal(notified, 1);
  });

  it('never starts a provider send when erasure wins after the due scan', async () => {
    const crmRepo = makeCrmRepo([booking()]);
    const inboxRepo = makeInboxRepo({
      withLiveCustomerLock: async () => null,
      withLiveCustomerDataLock: async () => null,
    });
    let lineCalls = 0;
    let notificationCalls = 0;
    const line = { pushTextMessage: async () => { lineCalls += 1; return { ok: true }; } } as any;
    const sut = new ScanCrmBookingRemindersUseCase(
      crmRepo,
      inboxRepo,
      secrets,
      line,
      { execute: async () => { notificationCalls += 1; return { skipped: false }; } } as any,
    );

    assert.deepEqual(await sut.execute(), { due: 1, reminded: 1, pushed: 0 });
    assert.equal(lineCalls, 0);
    assert.equal(notificationCalls, 0);
  });

  it('suppresses the customer provider send when consent is revoked after the due scan', async () => {
    let lineCalls = 0;
    let notificationCalls = 0;
    const inboxRepo = makeInboxRepo({
      withLiveCustomerLock: async (_input: any, callback: (identity: any, consentStatus: string) => Promise<any>) =>
        callback({ channelId: 'ch-1', providerUserId: 'U1' }, 'REVOKED'),
    });
    const sut = new ScanCrmBookingRemindersUseCase(
      makeCrmRepo([booking()]),
      inboxRepo,
      secrets,
      { pushTextMessage: async () => { lineCalls += 1; return { ok: true }; } } as any,
      { execute: async () => { notificationCalls += 1; return { skipped: false }; } } as any,
    );

    assert.deepEqual(await sut.execute(), { due: 1, reminded: 1, pushed: 0 });
    assert.equal(lineCalls, 0);
    assert.equal(notificationCalls, 1);
  });

  it('does not create a staff notification when erasure wins after the customer push', async () => {
    const inboxRepo = makeInboxRepo({ withLiveCustomerDataLock: async () => null });
    let lineCalls = 0;
    let notificationCalls = 0;
    const sut = new ScanCrmBookingRemindersUseCase(
      makeCrmRepo([booking()]),
      inboxRepo,
      secrets,
      { pushTextMessage: async () => { lineCalls += 1; return { ok: true }; } } as any,
      { execute: async () => { notificationCalls += 1; return { skipped: false }; } } as any,
    );

    assert.deepEqual(await sut.execute(), { due: 1, reminded: 1, pushed: 1 });
    assert.equal(lineCalls, 1);
    assert.equal(notificationCalls, 0);
  });

  it('a transient customer push failure notifies staff and releases the durable claim for retry', async () => {
    const crmRepo = makeCrmRepo([booking()]);
    const line = { pushTextMessage: async () => { throw new Error('LINE down'); } } as any;
    let notified = 0;
    const notifier = { execute: async () => { notified += 1; return { skipped: false }; } } as any;
    const sut = new ScanCrmBookingRemindersUseCase(crmRepo, makeInboxRepo(), secrets, line, notifier);
    const result = await sut.execute();
    assert.equal(result.reminded, 1);
    assert.equal(result.pushed, 0);
    assert.equal(notified, 1);
    assert.deepEqual(crmRepo.completed, []);
    assert.deepEqual(crmRepo.released, ['bk-1']);
  });

  it('empty due set is a no-op', async () => {
    const sut = new ScanCrmBookingRemindersUseCase(makeCrmRepo([]), makeInboxRepo(), secrets, {} as any, { execute: async () => ({}) } as any);
    assert.deepEqual(await sut.execute(), { due: 0, reminded: 0, pushed: 0 });
  });
});
