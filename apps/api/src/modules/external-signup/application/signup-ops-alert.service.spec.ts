import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SIGNUP_OPS_ALERT_EVENT_TYPE,
  SignupOpsAlertService,
  signupOpsAlertEventKey,
  signupOpsAlertTitleTh,
} from './signup-ops-alert.service';

/** 2026-09-05 23:30 Bangkok — the same instant is still 16:30 UTC on the 5th. */
const EVENING = new Date('2026-09-05T16:30:00.000Z');
/** 2026-09-06 00:30 Bangkok. One hour later, a different Bangkok day. */
const AFTER_MIDNIGHT = new Date('2026-09-05T17:30:00.000Z');

function harness(options: {
  trials?: Array<{ companyId: string }>;
  stuckPushes?: number;
  usage?: Array<{ companyId: string; costSatang: number }>;
  overrides?: Array<{ companyId: string; monthlyBudgetSatang: number | null }>;
  threshold?: number;
  notificationSkipped?: boolean;
  admins?: Array<{ companyId: string; userId: string }>;
} = {}) {
  // A real key→row map, so "once per condition per Bangkok day" is proven by the same mechanism
  // production relies on (the outbox unique index) rather than by counting calls.
  const outboxRows = new Map<string, any>();
  const appended: any[] = [];
  const notifications: any[] = [];
  const pushes: Array<{ userIds: string[]; text: string }> = [];
  const planTermQueries: any[] = [];
  const outboxCounts: any[] = [];

  const prisma = {
    client: {
      companyPlanTerm: {
        findMany: async (args: any) => { planTermQueries.push(args); return options.trials ?? []; },
      },
      companyAiMonthlyUsage: { findMany: async () => options.usage ?? [] },
      outboxEvent: {
        count: async (args: any) => { outboxCounts.push(args); return options.stuckPushes ?? 0; },
      },
      companyAiConfiguration: { findMany: async () => options.overrides ?? [] },
    },
  } as any;

  const outbox = {
    append: async (input: any) => {
      appended.push(input);
      if (outboxRows.has(input.eventKey)) return outboxRows.get(input.eventKey);
      outboxRows.set(input.eventKey, input);
      return input;
    },
  } as any;

  const notificationUseCase = {
    execute: async (input: any) => {
      notifications.push(input);
      return options.notificationSkipped ? { skipped: true, reason: 'cooldown' } : { skipped: false, event: {} };
    },
  } as any;

  const adminNotify = {
    activeSystemAdmins: async () => options.admins ?? [{ companyId: 'sys', userId: 'admin-1' }],
    pushToLinkedAdmins: async (userIds: string[], text: string) => { pushes.push({ userIds, text }); },
  } as any;

  const config = {
    lineSignupAdminAlertBudgetExhaustedPerDay: options.threshold ?? 5,
    aiMonthlyBudgetSatang: 8000,
  } as any;

  const logs: any[] = [];
  const logger = { warn: (fields: any) => logs.push(fields), error: (fields: any) => logs.push(fields) } as any;

  return {
    service: new SignupOpsAlertService(prisma, outbox, notificationUseCase, adminNotify, config, logger),
    outboxRows, appended, notifications, pushes, planTermQueries, outboxCounts, logs,
  };
}

describe('SignupOpsAlertService.raise — one alert per condition per Bangkok day (§15.6)', () => {
  it('collapses a storm of the same condition into a single queued alert', async () => {
    const h = harness();
    for (let i = 0; i < 20; i += 1) await h.service.raise('line_push_failed', EVENING);

    assert.equal(h.appended.length, 20, 'every occurrence still asks');
    assert.equal(h.outboxRows.size, 1, 'but the day key is what the outbox stores');
    assert.equal([...h.outboxRows.keys()][0], signupOpsAlertEventKey('line_push_failed', '2026-09-05'));
  });

  it('starts a new alert once the Bangkok day rolls over, not the UTC day', async () => {
    const h = harness();
    // Both instants are 2026-09-05 in UTC. Only Asia/Bangkok separates them.
    await h.service.raise('provisioning_failed', EVENING);
    await h.service.raise('provisioning_failed', AFTER_MIDNIGHT);

    assert.deepEqual([...h.outboxRows.keys()], [
      signupOpsAlertEventKey('provisioning_failed', '2026-09-05'),
      signupOpsAlertEventKey('provisioning_failed', '2026-09-06'),
    ]);
  });

  it('keeps the four conditions apart, so one does not silence another', async () => {
    const h = harness();
    await h.service.raise('auto_cap_reached', EVENING);
    await h.service.raise('line_push_failed', EVENING);
    await h.service.raise('provisioning_failed', EVENING);
    await h.service.raise('trial_budget_exhausted', EVENING);
    assert.equal(h.outboxRows.size, 4);
  });

  it('carries no shop, person or LINE id into the payload', async () => {
    const h = harness();
    await h.service.raise('auto_cap_reached', EVENING);
    assert.deepEqual(h.appended[0].payloadJson.data, { kind: 'auto_cap_reached', dayKey: '2026-09-05' });
    assert.equal(h.appended[0].eventType, SIGNUP_OPS_ALERT_EVENT_TYPE);
  });

  // Every caller is on a path that matters more than the alert: a provisioning transaction, a
  // customer's push, a public submit. None of them may fail because ops could not be told.
  it('never throws when the outbox is down', async () => {
    const h = harness();
    (h.service as any).outbox = { append: async () => { throw new Error('db_down'); } };
    await h.service.raise('provisioning_failed', EVENING);
    assert.equal(h.logs[0].event, 'signup.ops_alert.enqueue_failed');
  });
});

describe('SignupOpsAlertService.deliver — the SYSTEM_ADMIN rail', () => {
  it('opens one dashboard event per admin company and pushes once', async () => {
    const h = harness({ admins: [{ companyId: 'sys', userId: 'admin-1' }, { companyId: 'sys', userId: 'admin-2' }] });
    await h.service.deliver('auto_cap_reached', '2026-09-05');

    assert.equal(h.notifications.length, 1, 'both admins sit in one company');
    assert.deepEqual(h.notifications[0].recipientUserIds, ['admin-1', 'admin-2']);
    assert.equal(h.notifications[0].periodKey, '2026-09-05', 'the day IS the dedupe period');
    assert.equal(h.notifications[0].sourceId, 'auto_cap_reached');
    assert.equal(h.pushes.length, 1);
    assert.match(h.pushes[0]!.text, new RegExp(signupOpsAlertTitleTh('auto_cap_reached')));
    assert.match(h.pushes[0]!.text, /\/system\/signup-requests/);
  });

  it('sends no push when the notification rail says it is still cooling down', async () => {
    const h = harness({ notificationSkipped: true });
    await h.service.deliver('auto_cap_reached', '2026-09-05');
    assert.deepEqual(h.pushes, [], 'a redelivered outbox row must not become a second message');
  });

  it('does nothing at all when no active system admin exists', async () => {
    const h = harness({ admins: [] });
    await h.service.deliver('provisioning_failed', '2026-09-05');
    assert.deepEqual(h.notifications, []);
    assert.deepEqual(h.pushes, []);
  });
});

describe('SignupOpsAlertService.sweepTrialBudgets — §15.6 (d)', () => {
  const trials = (n: number) => Array.from({ length: n }, (_, i) => ({ companyId: `co-${i}` }));
  const spent = (n: number, costSatang: number) =>
    Array.from({ length: n }, (_, i) => ({ companyId: `co-${i}`, costSatang }));

  it('stays quiet below the threshold', async () => {
    const h = harness({ threshold: 5, trials: trials(10), usage: spent(4, 8000) });
    assert.deepEqual(await h.service.sweepTrialBudgets(EVENING), { exhausted: 4, raised: false });
    assert.equal(h.outboxRows.size, 0);
  });

  it('raises exactly once when the threshold is met', async () => {
    const h = harness({ threshold: 5, trials: trials(10), usage: spent(5, 8000) });
    assert.deepEqual(await h.service.sweepTrialBudgets(EVENING), { exhausted: 5, raised: true });
    // The sweep runs every 15 minutes; the day key is what stops it announcing 96 times.
    await h.service.sweepTrialBudgets(EVENING);
    assert.equal(h.outboxRows.size, 1);
  });

  it('counts a shop against ITS budget, not the platform default', async () => {
    const h = harness({
      threshold: 1,
      trials: trials(1),
      usage: [{ companyId: 'co-0', costSatang: 9000 }],
      // Raised by an operator: 9000 satang is not exhausted for this shop.
      overrides: [{ companyId: 'co-0', monthlyBudgetSatang: 20000 }],
    });
    assert.deepEqual(await h.service.sweepTrialBudgets(EVENING), { exhausted: 0, raised: false });
  });

  it('ignores a null override and falls back to the platform default', async () => {
    const h = harness({
      threshold: 1,
      trials: trials(1),
      usage: [{ companyId: 'co-0', costSatang: 8000 }],
      overrides: [{ companyId: 'co-0', monthlyBudgetSatang: null }],
    });
    assert.deepEqual(await h.service.sweepTrialBudgets(EVENING), { exhausted: 1, raised: true });
  });

  it('only looks at trial terms that have not already expired', async () => {
    const h = harness({ trials: [] });
    await h.service.sweepTrialBudgets(EVENING);
    assert.equal(h.planTermQueries[0].where.tierKey, 'FREE_TRIAL_15');
    assert.deepEqual(h.planTermQueries[0].where.termEndsAt, { gt: EVENING });
  });
});


describe('SignupOpsAlertService.sweepStuckPushes — L-B follow-up (a)', () => {
  it('stays quiet when every owed message went out', async () => {
    const h = harness({ stuckPushes: 0 });
    assert.deepEqual(await h.service.sweepStuckPushes(EVENING), { stuck: 0, raised: false });
    assert.equal(h.outboxRows.size, 0);
  });

  // A throttled push is DEFERRED, never terminalized, so it never becomes DEAD — and `countDead()`
  // is the only outbox alarm there is. Without this the shop simply never hears it is open.
  it('announces pushes that are still unsent, once for the day', async () => {
    const h = harness({ stuckPushes: 3 });
    assert.deepEqual(await h.service.sweepStuckPushes(EVENING), { stuck: 3, raised: true });
    await h.service.sweepStuckPushes(EVENING);
    assert.deepEqual([...h.outboxRows.keys()], [signupOpsAlertEventKey('line_push_stuck', '2026-09-05')]);
  });

  it('counts only signup pushes, and only ones that are old or repeatedly deferred', async () => {
    const h = harness({ stuckPushes: 1 });
    await h.service.sweepStuckPushes(EVENING);

    const where = h.outboxCounts[0].where;
    assert.equal(where.eventType, 'push.line_signup.requested');
    assert.deepEqual(where.status, { in: ['PENDING', 'FAILED'] });
    assert.deepEqual(where.OR[0].createdAt, { lt: new Date(EVENING.getTime() - 60 * 60_000) });
    assert.deepEqual(where.OR[1].attempts, { gte: 3 });
  });
});
