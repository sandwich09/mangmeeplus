import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SIGNUP_OPS_ALERT_EVENT_TYPE,
  SignupOpsAlertService,
  signupOpsAlertBodyTh,
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
  overrides?: Array<{ companyId: string; monthlyBudgetSatang: number | null;
    /** Split policy (spec §12.4). Absent on every pre-SPLIT case, which resolves to SHARED. */
    budgetMode?: string; chatMonthlyBudgetSatang?: number; ocrMonthlyBudgetSatang?: number;
    salesDealChatCreditSatang?: number | null; salesDealChatCreditEndsAt?: Date | null;
    budgetConfigVersion?: number; pendingBudgetPolicy?: unknown }>;
  /** Per-bucket month-to-date spend. */
  buckets?: Array<{ companyId: string; bucket: string; costSatang: number }>;
  /** The platform settings ROW, which is what a company inherits when it has no override. */
  platformBudget?: { monthlyBudgetSatang: number; ceilingSatang: number } | null;
  threshold?: number;
  notificationSkipped?: boolean;
  admins?: Array<{ companyId: string; userId: string }>;
  /** Hold spec §5: the companies `groupBy(['companyId'])` finds with stranded credit. */
  holdCompanies?: Array<{ companyId: string; _count: { _all: number } }>;
  holdAlertAfterHours?: number;
} = {}) {
  // A real key→row map, so "once per condition per Bangkok day" is proven by the same mechanism
  // production relies on (the outbox unique index) rather than by counting calls.
  const outboxRows = new Map<string, any>();
  const appended: any[] = [];
  const notifications: any[] = [];
  const pushes: Array<{ userIds: string[]; text: string }> = [];
  const planTermQueries: any[] = [];
  const outboxCounts: any[] = [];
  const reservationQueries: any[] = [];

  const prisma = {
    client: {
      companyPlanTerm: {
        findMany: async (args: any) => { planTermQueries.push(args); return options.trials ?? []; },
      },
      companyAiMonthlyUsage: {
        findMany: async () => options.usage ?? [],
        findUnique: async (args: any) => options.usage?.find(
          (row) => row.companyId === args.where.companyId_monthKey.companyId) ?? null,
      },
      outboxEvent: {
        count: async (args: any) => { outboxCounts.push(args); return options.stuckPushes ?? 0; },
      },
      companyAiConfiguration: { findMany: async () => options.overrides ?? [] },
      // The sweep batch-reads CHAT usage before applying SHARED defaults/deal overrides or SPLIT policy.
      companyAiMonthlyBucketUsage: {
        findMany: async (args: any) => (options.buckets ?? []).filter((row) =>
          (args.where.companyId.in ?? [args.where.companyId]).includes(row.companyId)
          && (args.where.bucket === undefined || row.bucket === args.where.bucket)),
      },
      aiBudgetReservation: {
        groupBy: async (args: any) => { reservationQueries.push(args); return options.holdCompanies ?? []; },
        count: async () => 0,
      },
      platformAiBudgetConfig: { findUnique: async () => options.platformBudget ?? null },
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
    aiCreditHoldAlertAfterHours: options.holdAlertAfterHours ?? 24,
  } as any;

  const logs: any[] = [];
  const logger = { warn: (fields: any) => logs.push(fields), error: (fields: any) => logs.push(fields) } as any;

  return {
    service: new SignupOpsAlertService(prisma, outbox, notificationUseCase, adminNotify, config, logger),
    outboxRows, appended, notifications, pushes, planTermQueries, outboxCounts, reservationQueries, logs,
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

  // §11.4: the platform default a company inherits is the settings ROW, not the ENV value. Reading
  // ENV made this sweep disagree with the five enforcement seams the moment an operator moved it.
  it('inherits the platform default from the settings row, not from the environment', async () => {
    const shared = { threshold: 1, trials: trials(1), usage: [{ companyId: 'co-0', costSatang: 9000 }] };
    // ENV says 8000 (exhausted); the row an operator raised says 20000 (not exhausted).
    assert.deepEqual(
      await harness({ ...shared, platformBudget: { monthlyBudgetSatang: 20000, ceilingSatang: 100000 } })
        .service.sweepTrialBudgets(EVENING),
      { exhausted: 0, raised: false },
    );
    assert.deepEqual(
      await harness({ ...shared, platformBudget: { monthlyBudgetSatang: 8000, ceilingSatang: 100000 } })
        .service.sweepTrialBudgets(EVENING),
      { exhausted: 1, raised: true },
    );
  });

  it('counts a SHARED trial whose default CHAT credit is exhausted before the TOTAL cap', async () => {
    const h = harness({
      threshold: 1, trials: trials(1),
      usage: [{ companyId: 'co-0', costSatang: 8000 }],
      buckets: [{ companyId: 'co-0', bucket: 'CHAT', costSatang: 8000 }],
      platformBudget: { monthlyBudgetSatang: 200_000, ceilingSatang: 300_000 },
    });
    assert.deepEqual(await h.service.sweepTrialBudgets(EVENING), { exhausted: 1, raised: true });
  });

  it('uses the live SHARED sales-deal CHAT allowance in the trial exhaustion sweep', async () => {
    const deal = {
      companyId: 'co-0', monthlyBudgetSatang: null, budgetMode: 'SHARED',
      salesDealChatCreditSatang: 12_000, salesDealChatCreditEndsAt: new Date('2026-09-30T17:00:00.000Z'),
    };
    const platformBudget = { monthlyBudgetSatang: 200_000, ceilingSatang: 300_000 };
    const under = harness({ threshold: 1, trials: trials(1), overrides: [deal],
      usage: [{ companyId: 'co-0', costSatang: 10_000 }],
      buckets: [{ companyId: 'co-0', bucket: 'CHAT', costSatang: 10_000 }], platformBudget });
    assert.deepEqual(await under.service.sweepTrialBudgets(EVENING), { exhausted: 0, raised: false });

    const spent = harness({ threshold: 1, trials: trials(1), overrides: [deal],
      usage: [{ companyId: 'co-0', costSatang: 12_000 }],
      buckets: [{ companyId: 'co-0', bucket: 'CHAT', costSatang: 12_000 }], platformBudget });
    assert.deepEqual(await spent.service.sweepTrialBudgets(EVENING), { exhausted: 1, raised: true });
  });

  // The legacy domain, which the D2 rewrite briefly lost: the old loop walked the month's USAGE
  // rows, so a shop with no usage row was never counted. With a platform default of 0 satang a loop
  // over trials counts EVERY trial (`0 >= 0`) — a daily false alarm about shops that never used AI.
  it('never counts a trial with no usage row this month, even at a budget of 0', async () => {
    const zeroBudget = { platformBudget: { monthlyBudgetSatang: 0, ceilingSatang: 100000 } };
    assert.deepEqual(
      await harness({ ...zeroBudget, threshold: 1, trials: trials(3), usage: [] })
        .service.sweepTrialBudgets(EVENING),
      { exhausted: 0, raised: false },
    );
    // ...but a shop that DID spend against that budget is still counted, exactly as before.
    assert.deepEqual(
      await harness({ ...zeroBudget, threshold: 1, trials: trials(3), usage: [{ companyId: 'co-0', costSatang: 0 }] })
        .service.sweepTrialBudgets(EVENING),
      { exhausted: 1, raised: true },
    );
  });

  // An operator's own cap of 0 is a decision, not an incident: announcing it every day would train
  // them to ignore this alert.
  it('does not count a bucket the operator closed with a cap of 0', async () => {
    const h = harness({
      threshold: 1, trials: trials(1),
      overrides: [{
        companyId: 'co-0', monthlyBudgetSatang: 10000, budgetMode: 'SPLIT',
        chatMonthlyBudgetSatang: 10000, ocrMonthlyBudgetSatang: 0, budgetConfigVersion: 1,
      }],
      usage: [{ companyId: 'co-0', costSatang: 10 }],
      buckets: [{ companyId: 'co-0', bucket: 'CHAT', costSatang: 10 }],
    });
    assert.deepEqual(await h.service.sweepTrialBudgets(EVENING), { exhausted: 0, raised: false });
  });

  // R-10: a trial whose OCR share is gone has hit its AI budget, even though the total has money.
  it('counts a SPLIT trial whose bucket is gone while its total still has money', async () => {
    const splitRow = {
      companyId: 'co-0', monthlyBudgetSatang: 10000, budgetMode: 'SPLIT',
      chatMonthlyBudgetSatang: 3000, ocrMonthlyBudgetSatang: 7000, budgetConfigVersion: 1,
    };
    const h = harness({
      threshold: 1, trials: trials(1), overrides: [splitRow],
      usage: [{ companyId: 'co-0', costSatang: 7000 }],
      buckets: [{ companyId: 'co-0', bucket: 'OCR', costSatang: 7000 }],
    });
    assert.deepEqual(await h.service.sweepTrialBudgets(EVENING), { exhausted: 1, raised: true });

    // The same shop with money left in both buckets is not counted.
    const funded = harness({
      threshold: 1, trials: trials(1), overrides: [splitRow],
      usage: [{ companyId: 'co-0', costSatang: 10 }],
      buckets: [{ companyId: 'co-0', bucket: 'OCR', costSatang: 10 }],
    });
    assert.deepEqual(await funded.service.sweepTrialBudgets(EVENING), { exhausted: 0, raised: false });
  });

  it('counts a trial whose stored policy cannot be read — AI is refused, so it is exhausted', async () => {
    const h = harness({
      threshold: 1, trials: trials(1),
      overrides: [{ companyId: 'co-0', monthlyBudgetSatang: 10000, pendingBudgetPolicy: { mode: 'WAT' } }],
      usage: [{ companyId: 'co-0', costSatang: 10 }],
    });
    assert.deepEqual(await h.service.sweepTrialBudgets(EVENING), { exhausted: 1, raised: true });
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

describe('SignupOpsAlertService.sweepUnresolvedCreditHolds — hold spec §5', () => {
  it('stays quiet when no company is holding stranded credit', async () => {
    const h = harness({ holdCompanies: [] });
    assert.deepEqual(await h.service.sweepUnresolvedCreditHolds(EVENING), { companies: 0, raised: false });
    assert.equal(h.outboxRows.size, 0);
  });

  it('counts COMPANIES, not rows — one broken shop is one thing to look at', async () => {
    const h = harness({ holdCompanies: [
      { companyId: 'co-1', _count: { _all: 40 } },
      { companyId: 'co-2', _count: { _all: 1 } },
    ] });

    assert.deepEqual(await h.service.sweepUnresolvedCreditHolds(EVENING), { companies: 2, raised: true });
  });

  it('asks for UNRESOLVED holds past the configured age, or ANY unacknowledged breach', async () => {
    const h = harness({ holdCompanies: [{ companyId: 'co-1', _count: { _all: 1 } }], holdAlertAfterHours: 6 });
    await h.service.sweepUnresolvedCreditHolds(EVENING);

    const where = h.reservationQueries[0].where;
    assert.deepEqual(h.reservationQueries[0].by, ['companyId']);
    // Age from when the hold was TAKEN: the shop has been short of that credit since `createdAt`.
    assert.deepEqual(where.OR[0], { status: 'UNRESOLVED', createdAt: { lt: new Date(EVENING.getTime() - 6 * 60 * 60_000) } });
    // A breach closes a scope from the moment it happens, so it has no age threshold at all.
    assert.deepEqual(where.OR[1], { breach: true, breachAcknowledgedAt: null });
  });

  it('announces once per Bangkok day and keeps its own kind apart from the others', async () => {
    const h = harness({ holdCompanies: [{ companyId: 'co-1', _count: { _all: 1 } }] });
    await h.service.sweepUnresolvedCreditHolds(EVENING);
    await h.service.sweepUnresolvedCreditHolds(EVENING);
    await h.service.raise('trial_budget_exhausted', EVENING);
    await h.service.sweepUnresolvedCreditHolds(AFTER_MIDNIGHT);

    assert.deepEqual([...h.outboxRows.keys()], [
      signupOpsAlertEventKey('ai_credit_holds_unresolved', '2026-09-05'),
      signupOpsAlertEventKey('trial_budget_exhausted', '2026-09-05'),
      signupOpsAlertEventKey('ai_credit_holds_unresolved', '2026-09-06'),
    ]);
  });

  it('says what to open, with no shop name and no customer money figure', async () => {
    const h = harness({ holdCompanies: [{ companyId: 'co-1', _count: { _all: 3 } }] });
    await h.service.sweepUnresolvedCreditHolds(EVENING);
    await h.service.deliver('ai_credit_holds_unresolved', '2026-09-05');

    const title = signupOpsAlertTitleTh('ai_credit_holds_unresolved');
    const body = signupOpsAlertBodyTh('ai_credit_holds_unresolved');
    assert.match(title, /เครดิต AI ที่กันไว้ค้าง/);
    assert.match(body, /เครดิตที่กันไว้ค้าง/);
    for (const text of [title, body]) {
      assert.equal(/\d/.test(text), false, `no figure of any kind belongs in "${text}"`);
      assert.equal(/co-1/.test(text), false);
    }
    // It links to the partner list, not the signup queue: this is decided per company on that page.
    assert.equal(h.notifications[0].deepLinkHref, '/system/partners');
    assert.equal(h.notifications[0].periodKey, '2026-09-05');
    assert.equal(h.notifications[0].sourceId, 'ai_credit_holds_unresolved');
    assert.match(h.pushes[0]!.text, /system\/partners/);
  });
});
