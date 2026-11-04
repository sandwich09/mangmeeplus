import { documentStateWords, waitingNoticeKey, finishedNoticeTitle } from './infrastructure/waiting-notification';
/**
 * Audit "dashboard/noti/reports": four defects that all look like nothing in review and all show up
 * as wrong data, missing data, or no data on the user's screen.
 *
 *  - the snapshot cache matched on freshness and module set but never on the period, so a "today"
 *    snapshot generated at 23:50 kept being served past midnight under today's heading
 *  - three cursor lists filtered on `id` while sorting by `createdAt`, so page two skipped rows
 *  - the unread badge fetched the whole unread backlog with a join and counted it in JS, every
 *    60 seconds per open tab
 *  - `report_ready` was emitted by Reports but classified as a future trigger, so the preference
 *    gate — which defaults to exactly the implemented list — dropped every LINE push, and the
 *    preferences screen only offers implemented keys, so nobody could opt in either
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { GenerateSnapshotUseCase } from './application/use-cases/generate-snapshot.use-case';
import { InventoryHealthProvider } from './application/providers/inventory-health.provider';
import { ExpenseSummaryProvider } from './application/providers/expense-summary.provider';
import {
  PrismaNotificationDeliveryRepository,
  PrismaNotificationEventRepository,
  PrismaNotificationRecipientRepository,
} from './infrastructure/prisma-notification.repository';
import { PrismaDashboardSnapshotRepository } from './infrastructure/prisma-dashboard.repository';
import { ALWAYS_DELIVERED_TRIGGER_KEYS, IMPLEMENTED_TRIGGER_KEYS, FUTURE_TRIGGER_KEYS } from './domain/models/notification.model';
import { completedDocumentNotificationIds, localizeReimbursementDecision, DOCUMENT_NOTIFICATION_STATES } from './infrastructure/document-notification-state';
import { WORKFLOW_TEMPLATE_CATALOG } from '../workflow/domain/workflow-template-catalog';
import type { RequestContext } from '../auth/domain/models/request-context.model';
import { ALL_FEATURE_ENTITLEMENT_KEYS, TIER_FEATURE_PRESETS } from '@watchdog-bms/contracts';
import * as notificationModel from './domain/models/notification.model';
import { CreateOrUpdateNotificationEventUseCase, ProcessQueuedDeliveryUseCase } from './application/use-cases/notification.use-cases';
import { StockLowScanUseCase } from './application/use-cases/stock-low-scan.use-case';
import { PrismaAlertStateRepository, PrismaNotificationRuleRepository } from './infrastructure/prisma-notification.repository';
import { lineMessagingCredentialsFixture } from '../../common/config/line-messaging-credentials.fixture';

const COMPANY = 'co-1';

it('registers certificate cancellation as an always-delivered expense notice, without a document task (A5)', () => {
  const key = 'expense.wht_certificate_cancelled';
  assert.ok(IMPLEMENTED_TRIGGER_KEYS.includes(key));
  assert.ok(ALWAYS_DELIVERED_TRIGGER_KEYS.includes(key));
  assert.deepEqual(notificationModel.NOTIFICATION_TRIGGER_FEATURE_KEYS[key], ['expenses']);
  assert.equal(DOCUMENT_NOTIFICATION_STATES[key], undefined);
});

const ctx: RequestContext = {
  requestId: 'r1', authSubject: 'u1', userId: 'u1', companyId: COMPANY, membershipId: 'm1',
  roles: [], permissions: ['dashboard.read', 'expense.read'], scopes: {}, authProvider: 'watchdog',
};

const YESTERDAY = { start: new Date('2026-08-09T00:00:00Z'), end: new Date('2026-08-09T23:59:59Z') };
const TODAY = { start: new Date('2026-08-10T00:00:00Z'), end: new Date('2026-08-10T23:59:59Z') };

function snapshotSut(seeded: { start: Date; end: Date }) {
  const prisma = {
    client: {
      companyFeatureEntitlement: { findMany: async () => [{ featureKey: 'expenses', enabled: true }] },
      expenseRecord: {
        aggregate: async (args: any) => (args._sum?.outstandingAmount
          ? { _sum: { outstandingAmount: 400 } }
          : { _sum: { grandTotalAmount: 1250 }, _count: { _all: 2 } }),
        count: async () => 3,
      },
    },
  } as any;
  const rows: any[] = [{
    id: 'yesterday', companyId: COMPANY, periodKind: 'today',
    periodStart: seeded.start, periodEnd: seeded.end,
    metricsJson: { widgets: [{ key: 'expense_summary', kind: 'metric_card', module: 'expenses', title: 'ค่าใช้จ่าย', metrics: [] }] },
    freshnessStatus: 'fresh',
    // Deliberately fresh by the clock: age alone was never the thing that went stale.
    generatedAt: new Date(),
  }];
  const snapshots = {
    rows,
    findLatest: async () => rows[rows.length - 1] ?? null,
    create: async (input: any) => { const row = { id: `snap-${rows.length}`, ...input }; rows.push(row); return row; },
  } as any;
  return {
    snapshots,
    useCase: new GenerateSnapshotUseCase(prisma, snapshots, new InventoryHealthProvider(prisma), new ExpenseSummaryProvider(prisma)),
  };
}

// `custom` is the one kind whose boundaries the caller supplies verbatim; every other kind derives
// them from the wall clock, which would make "the period rolled over" untestable without faking time.
const forPeriod = (period: { start: Date; end: Date }) =>
  ({ periodKind: 'custom' as const, periodStart: period.start, periodEnd: period.end });

describe('dashboard snapshot cache across a period rollover', () => {
  it('does not serve yesterday numbers under today heading', async () => {
    const { useCase, snapshots } = snapshotSut(YESTERDAY);

    await useCase.execute(ctx, COMPANY, forPeriod(TODAY));

    assert.equal(snapshots.rows.length, 2, 'a snapshot for a different period must not satisfy this read');
    assert.equal(snapshots.rows.at(-1).periodStart.getTime(), TODAY.start.getTime());
  });

  it('still reuses the cache within the same period, so the fix costs no extra generation', async () => {
    const { useCase, snapshots } = snapshotSut(TODAY);

    await useCase.execute(ctx, COMPANY, forPeriod(TODAY));

    assert.equal(snapshots.rows.length, 1, 'the matching cached period must still be served');
  });
});

describe('dashboard snapshot lookup scope', () => {
  // findLatest matched only companyId + periodKind, so the first branch-scoped row written could be
  // served to a company-wide read, or one branch's numbers to another branch. The use-case passing
  // the right arguments is not enough — the where clause has to carry them.
  it('keys the lookup on scope and scopeKey, matching company-wide on NULL', async () => {
    const wheres: any[] = [];
    const prisma = {
      client: { dashboardSnapshot: { findFirst: async (args: any) => { wheres.push(args.where); return null; } } },
    } as any;
    const repo = new PrismaDashboardSnapshotRepository(prisma);

    await repo.findLatest(COMPANY, 'today', 'branch', 'br-1');
    await repo.findLatest(COMPANY, 'today', 'company');

    assert.deepEqual(wheres[0], { companyId: COMPANY, periodKind: 'today', scope: 'BRANCH', scopeKey: 'br-1' });
    // null, not undefined: an undefined scopeKey drops the predicate entirely and lets a branch row
    // answer the company-wide read, which is the leak this key exists to prevent.
    assert.deepEqual(wheres[1], { companyId: COMPANY, periodKind: 'today', scope: 'COMPANY', scopeKey: null });
  });
});

/** Records what each list actually asked Prisma for. */
function capturingPrisma(captured: Record<string, any>) {
  const model = (name: string) => ({
    findMany: async (args: any) => { captured[name] = args; return []; },
    groupBy: async (args: any) => { captured[`${name}.groupBy`] = args; return []; },
    updateMany: async (args: any) => { captured[`${name}.updateMany`] = args; return { count: 0 }; },
  });
  return {
    client: {
      companyFeatureEntitlement: { findMany: async () => [] },
      notificationEvent: model('event'),
      notificationRecipient: model('recipient'),
      notificationDelivery: model('delivery'),
    },
  } as any;
}

describe('cursor pagination keys', () => {
  // A filter on one key and an order on another: any row that sorts after the cursor but carries a
  // larger id is skipped, and one that sorts before it with a smaller id comes back twice.
  it('never filters the page on a key it does not sort by', async () => {
    const captured: Record<string, any> = {};
    const prisma = capturingPrisma(captured);
    await new PrismaNotificationEventRepository(prisma).list(COMPANY, 'u1', { cursor: 'evt-9', pageSize: 10 } as any);
    await new PrismaNotificationRecipientRepository(prisma).listByUser(COMPANY, 'u1', { cursor: 'rec-9', pageSize: 10 });
    await new PrismaNotificationDeliveryRepository(prisma).listByCompany(COMPANY, { cursor: 'del-9', pageSize: 10 });

    for (const [name, cursor] of [['event', 'evt-9'], ['recipient', 'rec-9'], ['delivery', 'del-9']] as const) {
      const args = captured[name];
      assert.ok(args, `${name} list did not run`);
      assert.deepEqual(args.cursor, { id: cursor }, `${name} must page with a real cursor`);
      assert.equal(args.skip, 1, `${name} must step past the cursor row`);
      assert.equal(args.where.id, undefined, `${name} still filters on id while ordering by createdAt`);
      // createdAt is not unique - a batch of recipients lands in the same millisecond - so the id
      // tiebreaker is what makes the order total and the cursor meaningful.
      assert.deepEqual(args.orderBy, [{ createdAt: 'desc' }, { id: 'desc' }], name);
    }
  });

  it('asks for no cursor at all on the first page', async () => {
    const captured: Record<string, any> = {};
    await new PrismaNotificationEventRepository(capturingPrisma(captured)).list(COMPANY, 'u1', { pageSize: 10 } as any);
    assert.equal(captured['event'].cursor, undefined);
    assert.equal(captured['event'].skip, undefined);
  });
});

// Audit B15: notices stored before decisions were rendered in Thai still hold the code word. The
// list repairs the two notices that print a decision and leaves every other body as it was typed.
describe('decision code words in notices stored before the fix', () => {
  it('reads the requester result and the finance hold in plain Thai, and nothing else is rewritten', async () => {
    const row = (id: string, triggerKey: string, body: string) => ({
      id, companyId: COMPANY, triggerKey, severity: 'INFO', status: 'OPEN', title: 't', body,
      payloadJson: {}, sourceRefsJson: {}, recipients: [],
    });
    const prisma = {
      client: {
        companyFeatureEntitlement: { findMany: async () => [] },
        notificationEvent: {
          // The first read (a `select`) is the still-to-do projection; the second is the page.
          findMany: async (args: any) => (args.select ? [] : [
            row('n1', 'workflow.reimbursement_decision_requester', 'ผลการพิจารณา: BELOW_APPROVAL_THRESHOLD · ยอด 125 THB'),
            row('n2', 'workflow.reimbursement_finance_review', 'ผลตรวจสอบ: BLOCKED · ยอด 125 THB'),
            row('n3', 'workflow.reimbursement_correction_requester', 'ใบเสร็จเขียนว่า APPROVED · ยอด 125 THB'),
          ]),
        },
      },
    } as any;

    const { items } = await new PrismaNotificationEventRepository(prisma).list(COMPANY, 'u1', { pageSize: 10 } as any);

    assert.deepEqual(items.map((item) => item.body), [
      'ผลการพิจารณา: ไม่ต้องอนุมัติตามนโยบาย · ยอด 125 THB',
      'ผลตรวจสอบ: ระงับ · ยอด 125 THB',
      'ใบเสร็จเขียนว่า APPROVED · ยอด 125 THB',
    ]);
  });
});

describe('unread badge counting', () => {
  it('counts in the database instead of transferring the backlog', async () => {
    const captured: Record<string, any> = {};
    const prisma = capturingPrisma(captured);
    prisma.client.notificationEvent.groupBy = async (args: any) => {
      captured['event.groupBy'] = args;
      return [
        { severity: 'CRITICAL', _count: { _all: 2 } },
        { severity: 'INFO', _count: { _all: 5 } },
      ];
    };
    prisma.client.notificationRecipient.findMany = async () => assert.fail('the unread badge must not read the backlog row by row');

    const result = await new PrismaNotificationRecipientRepository(prisma).countUnread(COMPANY, 'u1');

    assert.deepEqual(result, { total: 7, bySeverity: { critical: 2, action: 0, insight: 0, info: 5 } });
    assert.deepEqual(captured['event.groupBy'].by, ['severity']);
    // Dismissed rows are not unread; keeping both conditions is what makes the badge match the list.
    assert.deepEqual(captured['event.groupBy'].where.recipients.some, { userId: 'u1', readAt: null, dismissedAt: null, supersededAt: null, finishedAt: null });
  });
});

/**
 * Trigger keys that some module emits but the preference gate will drop, because that gate defaults
 * to IMPLEMENTED_TRIGGER_KEYS. Recorded rather than silently allowed: every one of these is a
 * notification the product creates and can never deliver over LINE.
 *
 * The eleven below are workflow templates. They are left disabled deliberately - moving a key into
 * the implemented list turns its LINE push on by default for every company, which is a product
 * decision about what a shop owner's phone buzzes for, not a defect fix. Delete an entry here in
 * the same change that implements it.
 */
const EMITTED_BUT_NOT_DELIVERABLE = new Set([
  'workflow.daily_owner_summary',
  'workflow.low_stock_alert',
  'workflow.stockout_risk',
  'workflow.vendor_bill_pending',
  'workflow.vendor_bill_second_approval',
  'workflow.tax_due_soon',
  'workflow.bank_reconciliation_aging',
  'workflow.overdue_invoice',
  'workflow.crm_follow_up_due',
  'workflow.crm_opportunity_stuck',
  'workflow.sales_below_target',
]);

function apiSourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return apiSourceFiles(full);
    return entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [full] : [];
  });
}

describe('every emitted trigger can actually be delivered', () => {
  it('leaves no trigger emitted by a module but dropped by the preference gate', () => {
    const implemented = new Set(IMPLEMENTED_TRIGGER_KEYS);
    const undeliverable = new Set<string>();

    for (const file of apiSourceFiles(join(__dirname, '..'))) {
      if (file.endsWith('notification.model.ts')) continue;
      for (const match of readFileSync(file, 'utf8').matchAll(/triggerKey:\s*'([a-z][a-z0-9_.]+)'/g)) {
        const key = match[1]!;
        if (!implemented.has(key) && !EMITTED_BUT_NOT_DELIVERABLE.has(key)) undeliverable.add(key);
      }
    }

    assert.deepEqual([...undeliverable], [], `emitted but undeliverable: ${[...undeliverable].join(', ')}`);
  });

  it('keeps report_ready deliverable, and out of the future list that suppressed it', () => {
    assert.ok(IMPLEMENTED_TRIGGER_KEYS.includes('report_ready'));
    assert.ok(!FUTURE_TRIGGER_KEYS.includes('report_ready'));
  });

  it('never lets a key sit in both lists, which would make the gate depend on read order', () => {
    const both = IMPLEMENTED_TRIGGER_KEYS.filter((key) => FUTURE_TRIGGER_KEYS.includes(key));
    assert.deepEqual(both, []);
  });
});

// Payout spec §14, §17.3. A claim sent back to have its payout account corrected is PENDING_APPROVAL
// again. By its status alone the approval notice of its first round would come back as still to do
// while nobody can approve anything, and the two notices of the round would never be done.
describe('notices of a claim whose payout account is being corrected', () => {
  const at = (iso: string) => new Date(iso);
  const sentBackAt = at('2026-10-02T03:00:00.000Z');
  const accountGivenAt = at('2026-10-02T05:00:00.000Z');
  const notice = (id: string, triggerKey: string, createdAt: Date) => ({ id, triggerKey, sourceType: 'reimbursement_request', sourceId: 'claim1', createdAt });
  const notices = [
    notice('first-approval', 'workflow.reimbursement_pending_approval', at('2026-09-20T03:00:00.000Z')),
    notice('first-reminder', 'workflow.approval_sla_breach', at('2026-09-23T03:00:00.000Z')),
    notice('ready-to-pay', 'workflow.reimbursement_ready_for_payment', at('2026-09-24T03:00:00.000Z')),
    notice('payment-reminder', 'workflow.reimbursement_payment_sla_breach', at('2026-09-27T03:00:00.000Z')),
    notice('sent-back', 'workflow.reimbursement_payout_correction_requested', at('2026-10-02T03:00:05.000Z')),
    notice('new-account', 'workflow.reimbursement_payout_correction_submitted', at('2026-10-02T05:00:05.000Z')),
    notice('round-reminder', 'workflow.approval_sla_breach', at('2026-10-04T06:00:00.000Z')),
  ];
  const stillToDo = async (claim: Record<string, unknown>) => {
    const asked: any[] = [];
    const db: any = {
      notificationEvent: { findMany: async (query: any) => { asked.push(query); return notices; } },
      reimbursementRequest: { findMany: async () => [{ id: 'claim1', payoutCorrectionRequestedAt: null, payoutCorrectionSubmittedAt: null, ...claim }] },
    };
    const done = new Set(await completedDocumentNotificationIds(db, COMPANY, 'u1'));
    // The two notices of a round are among the ones whose state is read at all.
    assert.ok(['workflow.reimbursement_payout_correction_requested', 'workflow.reimbursement_payout_correction_submitted']
      .every((key) => asked[0].where.triggerKey.in.includes(key)));
    return notices.map((row) => row.id).filter((id) => !done.has(id));
  };

  it('keeps to do only the notice of the phase the claim is in', async () => {
    // With its requester: the one thing to do is theirs. The approver's old notices stay done.
    assert.deepEqual(await stillToDo({ status: 'PENDING_APPROVAL', payoutCorrectionRequestedAt: sentBackAt }), ['sent-back']);
    // The account is given: its approvers have a notice to act on, and a reminder once they are late with it.
    // The approval notice and the reminder of the first round are about a wait that ended, and stay done.
    assert.deepEqual(await stillToDo({ status: 'PENDING_APPROVAL', payoutCorrectionRequestedAt: sentBackAt, payoutCorrectionSubmittedAt: accountGivenAt }),
      ['new-account', 'round-reminder']);
    // Approved again: the claim waits for payment, and nothing of the round is left to do.
    assert.deepEqual(await stillToDo({ status: 'READY_FOR_PAYMENT' }), ['ready-to-pay', 'payment-reminder']);
    assert.deepEqual(await stillToDo({ status: 'PAID' }), []);
  });

  // Final review W4: a claim being cancelled takes no decision and no payment, so none of its notices
  // is something to do. Withdrawn, the cancellation gives them back as they were.
  it('keeps nothing to do for a claim that is being cancelled, in any status, and gives it back once the cancellation is withdrawn', async () => {
    const cancellationPendingAt = at('2026-10-05T03:00:00.000Z');
    for (const claim of [
      { status: 'PENDING_APPROVAL' },
      { status: 'PENDING_APPROVAL', payoutCorrectionRequestedAt: sentBackAt },
      { status: 'PENDING_APPROVAL', payoutCorrectionRequestedAt: sentBackAt, payoutCorrectionSubmittedAt: accountGivenAt },
      { status: 'READY_FOR_PAYMENT' },
    ]) {
      assert.notDeepEqual(await stillToDo(claim), [], claim.status);
      assert.deepEqual(await stillToDo({ ...claim, cancellationPendingAt }), [], `${claim.status} while being cancelled`);
    }
    // The state is read, not stored: the same notices are to do again as soon as the claim goes on.
    assert.deepEqual(await stillToDo({ status: 'READY_FOR_PAYMENT', cancellationPendingAt: null }), ['ready-to-pay', 'payment-reminder']);
  });

  it('leaves an ordinary claim waiting for approval as it was: its approval notice and its reminder are to do', async () => {
    assert.deepEqual(await stillToDo({ status: 'PENDING_APPROVAL' }), ['first-approval', 'first-reminder', 'round-reminder']);
  });

  it('delivers both notices whatever a member chose for optional notices, like the other claim notices', () => {
    for (const template of WORKFLOW_TEMPLATE_CATALOG.filter((entry) => entry.key.startsWith('reimbursement_payout_correction_'))) {
      const triggerKey = String(template.defaultActionJson[0]!.configJson['triggerKey']);
      assert.ok(IMPLEMENTED_TRIGGER_KEYS.includes(triggerKey), triggerKey);
      assert.ok(ALWAYS_DELIVERED_TRIGGER_KEYS.includes(triggerKey), triggerKey);
    }
    assert.equal(WORKFLOW_TEMPLATE_CATALOG.filter((entry) => entry.key.startsWith('reimbursement_payout_correction_')).length, 2);
  });
});


// Owner 2026-10-04: module availability, not a rule/preference, determines which notices exist.
function notificationStore(featureKeys: readonly string[] | null) {
  const events: any[] = [];
  const recipients: any[] = [];
  const deliveries: any[] = [];
  let entitlementRows = featureKeys?.map(featureKey => ({ featureKey, enabled: true })) ?? [];
  const matches = (row: any, where: any): boolean => {
    if (where.AND && !where.AND.every((clause: any) => matches(row, clause))) return false;
    for (const key of ['companyId', 'triggerKey', 'id', 'status']) {
      const value = where[key];
      if (value === undefined) continue;
      if (typeof value === 'string' && row[key] !== value) return false;
      if (value.in && !value.in.includes(row[key])) return false;
      if (value.notIn?.includes(row[key]) || value.not === row[key]) return false;
    }
    return true;
  };
  const prisma = { client: {
    $executeRaw: async () => 1,
    companyFeatureEntitlement: { findMany: async (q: any) => { assert.equal(q.where.companyId, COMPANY); return entitlementRows; } },
    notificationEvent: {
      findFirst: async ({ where }: any) => events.find(row => row.companyId === where.companyId && row.dedupKey === where.dedupKey) ?? null,
      create: async ({ data }: any) => { const row = { id: `event-${events.length}`, ...data }; events.push(row); return row; },
      update: async () => assert.fail('unentitled dedup must not update an old event'),
      findMany: async ({ where, select, take }: any) => select ? [] : events.filter(row => matches(row, where)).slice(0, take),
      groupBy: async ({ where }: any) => {
        const counts = new Map<string, number>();
        for (const row of events.filter(row => matches(row, where))) counts.set(row.severity, (counts.get(row.severity) ?? 0) + 1);
        return [...counts].map(([severity, total]) => ({ severity, _count: { _all: total } }));
      },
    },
    notificationRule: { findFirst: async () => null },
    alertState: { findUnique: async () => null, upsert: async ({ create }: any) => create },
    companyMembership: { findMany: async () => [{ userId: 'u1' }] },
    notificationRecipient: {
      findFirst: async ({ where }: any) => recipients.find(row => row.id === where.id && row.companyId === where.companyId && row.userId === where.userId),
      update: async ({ where, data }: any) => Object.assign(recipients.find(row => row.id === where.id), data),
      updateMany: async ({ where, data }: any) => {
        const matching = recipients.filter(row => Object.entries(where).every(([key, value]: any) => value === null ? row[key] == null : typeof value === 'object' && value.not !== undefined ? row[key] !== value.not : row[key] === value));
        matching.forEach(row => Object.assign(row, data)); return { count: matching.length };
      },
      findUnique: async () => null,
      create: async ({ data }: any) => { const row = { id: `recipient-${recipients.length}`, ...data }; recipients.push(row); return row; },
    },
    notificationDelivery: {
      findFirst: async () => null,
      create: async ({ data }: any) => { deliveries.push(data); return data; },
    },
  } } as any;
  const create = new CreateOrUpdateNotificationEventUseCase(
    new PrismaNotificationEventRepository(prisma), new PrismaNotificationRecipientRepository(prisma),
    new PrismaNotificationDeliveryRepository(prisma), new PrismaAlertStateRepository(prisma),
    new PrismaNotificationRuleRepository(prisma), prisma,
  );
  const input = (triggerKey: string) => ({ companyId: COMPANY, triggerKey, sourceModule: 'test', sourceType: 'record', sourceId: 'record-1',
    severity: 'action', title: 'รายการรอตรวจ', body: '', recipientUserIds: ['u1'] });
  return { prisma, create, input, events, recipients, deliveries,
    setRows: (rows: typeof entitlementRows) => { entitlementRows = rows; } };
}

it('creates separate cancellation notices per round and filters an inactive issuer (A5)', async () => {
  const h = notificationStore(['expenses']);
  let active = true;
  h.prisma.client.companyMembership.findMany = async ({ where }: any) => {
    assert.deepEqual(where, { companyId: COMPANY, userId: { in: ['issuer-1'] }, status: 'ACTIVE' });
    return active ? [{ userId: 'issuer-1' }] : [];
  };
  const input = { ...h.input('expense.wht_certificate_cancelled'), sourceModule: 'expenses', sourceType: 'expense_record',
    sourceId: 'expense-1', severity: 'info', recipientUserIds: ['issuer-1'] };
  await h.create.execute({ ...input, periodKey: '1' });
  await h.create.execute({ ...input, periodKey: '2' });
  assert.equal(h.events.length, 2); assert.notEqual(h.events[0].dedupKey, h.events[1].dedupKey);
  assert.deepEqual(h.recipients.map(row => row.userId), ['issuer-1', 'issuer-1']);
  assert.equal(h.deliveries.length, 4);
  active = false;
  await h.create.execute({ ...input, periodKey: '3' });
  assert.equal(h.recipients.length, 2); assert.equal(h.deliveries.length, 4);
});

describe('notifications only for owned modules', () => {
  it('classifies every listed, template and literal-emitted trigger using real feature keys', () => {
    const mapping = (notificationModel as any).NOTIFICATION_TRIGGER_FEATURE_KEYS;
    assert.ok(mapping, 'ownership mapping must live beside the trigger lists');
    const keys = new Set([...IMPLEMENTED_TRIGGER_KEYS, ...FUTURE_TRIGGER_KEYS, ...EMITTED_BUT_NOT_DELIVERABLE,
      'signup_pending_review', 'signup_ops_alert', 'crm_pdpa_erasure_completed', 'crm_pdpa_erasure_failed']);
    for (const file of apiSourceFiles(join(__dirname, '..'))) {
      if (file.endsWith('notification.model.ts')) continue;
      for (const match of readFileSync(file, 'utf8').matchAll(/triggerKey:\s*'([a-z][a-z0-9_.]+)'/g)) keys.add(match[1]!);
    }
    for (const template of WORKFLOW_TEMPLATE_CATALOG) {
      for (const action of template.defaultActionJson) {
        if (action.actionType === 'SEND_NOTIFICATION') keys.add(String(action.configJson['triggerKey']));
      }
    }
    for (const key of keys) {
      assert.ok(Object.hasOwn(mapping, key), `unclassified notification trigger: ${key}`);
      // No marketing feature exists yet: this future key is explicitly blocked pending the owner.
      if (key === 'campaign_opportunity') { assert.equal(mapping[key], null); continue; }
      assert.ok(Array.isArray(mapping[key]), key);
      for (const feature of mapping[key]) assert.ok(ALL_FEATURE_ENTITLEMENT_KEYS.includes(feature), `${key}: ${feature}`);
    }
  });

  for (const [triggerKey, feature] of [['crm_sla_breach', 'crm.inbox'], ['stock_low', 'inventory']] as const) {
    it(`${triggerKey}: STARTER creates no event or delivery; the purchased module and legacy company do`, async () => {
      const starter = notificationStore(TIER_FEATURE_PRESETS.STARTER_249);
      const result = await starter.create.execute(starter.input(triggerKey));
      assert.equal(starter.events.length, 0);
      assert.equal(result.skipped, true);
      assert.deepEqual([starter.recipients.length, starter.deliveries.length], [0, 0]);
      for (const keys of [[feature], null]) {
        const owned = notificationStore(keys);
        assert.equal((await owned.create.execute(owned.input(triggerKey))).skipped, false);
        assert.deepEqual([owned.events.length, owned.recipients.length, owned.deliveries.length], [1, 1, 2]);
      }
    });
  }

  it('blocks unregistered and unresolved future triggers instead of treating them as platform-wide', async () => {
    for (const triggerKey of ['workflow.custom_notice', 'campaign_opportunity']) {
      const store = notificationStore(null);
      assert.equal((await store.create.execute(store.input(triggerKey))).skipped, true);
      assert.equal(store.events.length, 0);
    }
  });

  it('does not repair dedup recipients or deliveries after a downgrade', async () => {
    const store = notificationStore(['crm']);
    await store.create.execute(store.input('crm_sla_breach'));
    store.setRows(TIER_FEATURE_PRESETS.STARTER_249.map(featureKey => ({ featureKey, enabled: true })));
    assert.equal((await store.create.execute(store.input('crm_sla_breach'))).skipped, true);
    assert.deepEqual([store.events.length, store.recipients.length, store.deliveries.length], [1, 1, 2]);
  });

  it('explicit submenu OFF beats parent CRM while platform notices remain available', async () => {
    const store = notificationStore(['crm']);
    store.setRows([{ featureKey: 'crm', enabled: true }, { featureKey: 'crm.inbox', enabled: false }]);
    assert.equal((await store.create.execute(store.input('crm_sla_breach'))).skipped, true);
    assert.equal(store.events.length, 0);
    assert.equal((await store.create.execute(store.input('plan_term_expiring'))).skipped, false);
    assert.equal(store.events.length, 1);
  });

  it('retained CRM/stock events disappear from lists, filtered pages, unread totals and severity badges, and return after purchase', async () => {
    const store = notificationStore(['crm', 'inventory']);
    for (const key of ['crm_sla_breach', 'stock_low', 'plan_term_expiring']) await store.create.execute(store.input(key));
    store.setRows(TIER_FEATURE_PRESETS.STARTER_249.map(featureKey => ({ featureKey, enabled: true })));
    const repo = new PrismaNotificationEventRepository(store.prisma);
    const counts = new PrismaNotificationRecipientRepository(store.prisma);
    for (const filter of [{}, { read: false }, { status: 'open' }]) {
      const page = await repo.list(COMPANY, 'u1', { ...filter, pageSize: 1 });
      assert.deepEqual(page.items.map(row => row.triggerKey), ['plan_term_expiring']);
      assert.equal(page.nextCursor, undefined, 'filter must run before page size/cursor');
    }
    assert.deepEqual((await repo.list(COMPANY, 'u1', { triggerKey: 'crm_sla_breach' })).items, []);
    assert.deepEqual(await counts.countUnread(COMPANY, 'u1'), { total: 1, bySeverity: { critical: 0, action: 1, insight: 0, info: 0 } });
    assert.equal(store.events.length, 3, 'history is retained');
    store.setRows([{ featureKey: 'crm', enabled: true }, { featureKey: 'inventory', enabled: true }]);
    assert.equal((await repo.list(COMPANY, 'u1', {})).items.length, 3);
    assert.equal((await counts.countUnread(COMPANY, 'u1')).total, 3);
  });

  it('counts only entitled retained events in total and each severity', async () => {
    const store = notificationStore(TIER_FEATURE_PRESETS.STARTER_249);
    store.events.push(
      { id: 'crm-old', companyId: COMPANY, triggerKey: 'crm_sla_breach', status: 'OPEN', severity: 'CRITICAL' },
      { id: 'stock-old', companyId: COMPANY, triggerKey: 'stock_low', status: 'OPEN', severity: 'ACTION' },
      { id: 'package', companyId: COMPANY, triggerKey: 'plan_term_expiring', status: 'OPEN', severity: 'INFO' },
    );
    assert.deepEqual(await new PrismaNotificationRecipientRepository(store.prisma).countUnread(COMPANY, 'u1'),
      { total: 1, bySeverity: { critical: 0, action: 0, insight: 0, info: 1 } });
  });

  for (const triggerKey of ['crm_sla_breach', 'stock_low', 'workflow.reimbursement_payment_voided']) {
    for (const channel of ['WEB', 'LINE']) it(`${triggerKey}: queued ${channel} delivery is suppressed after module loss, even mandatory notices`, async () => {
      const result = await deliverOwnedNotice(triggerKey, channel, ['company_settings']);
      assert.equal(result.last.status.toLowerCase(), 'suppressed');
      assert.equal(result.pushes, 0);
    });
  }

  for (const [triggerKey, feature] of [['crm_sla_breach', 'crm'], ['stock_low', 'inventory']] as const) {
    it(`${triggerKey}: a downgrade between the initial LINE read and transaction egress prevents the push`, async () => {
      const result = await deliverOwnedNotice(triggerKey, 'LINE', [feature], ['company_settings']);
      assert.equal(result.pushes, 0);
      assert.equal(result.last.status.toLowerCase(), 'suppressed');
      const entitled = await deliverOwnedNotice(triggerKey, 'LINE', [feature]);
      assert.equal(entitled.pushes, 1);
      assert.equal(entitled.last.status.toLowerCase(), 'sent');
    });
  }

  for (const [triggerKey, feature] of [['crm_sla_breach', 'crm'], ['stock_low', 'inventory']] as const) {
    it(`${triggerKey}: holds the shared company entitlement lock for the final LINE read and push`, async () => {
      const result = await deliverOwnedNotice(triggerKey, 'LINE', [feature], [feature], true);
      assert.equal(result.pushes, 1);
    });
  }

  it('filters the recipient read path by the same current module ownership', async () => {
    const store = notificationStore(TIER_FEATURE_PRESETS.STARTER_249);
    let query: any;
    store.prisma.client.notificationRecipient.findMany = async (q: any) => { query = q; return []; };
    await new PrismaNotificationRecipientRepository(store.prisma).listByUser(COMPANY, 'u1', { pageSize: 1 });
    assert.ok(query.where.event.triggerKey.in.includes('plan_term_expiring'));
    assert.ok(!query.where.event.triggerKey.in.includes('crm_sla_breach'));
    assert.ok(!query.where.event.triggerKey.in.includes('stock_low'));
  });

  it('stock-low scan skips all inventory reads for STARTER and reads them after purchase', async () => {
    const store = notificationStore(TIER_FEATURE_PRESETS.STARTER_249);
    let productReads = 0;
    store.prisma.client.product = { findMany: async () => { productReads++; return []; } };
    store.prisma.client.stockMovement = { groupBy: async () => [] };
    const scan = new StockLowScanUseCase(store.prisma, store.create,
      { findByTriggerKey: async () => ({ status: 'enabled' }) } as any);
    assert.deepEqual(await scan.execute(COMPANY), { scanned: 0, triggered: 0 });
    assert.equal(productReads, 0);
    store.setRows([{ featureKey: 'inventory', enabled: true }]);
    await scan.execute(COMPANY);
    assert.equal(productReads, 1);
  });
});


async function deliverOwnedNotice(triggerKey: string, channel: string, featureKeys: readonly string[], egressFeatureKeys = featureKeys, requireFence = false) {
  const store = notificationStore(featureKeys);
  let pushes = 0;
  const originalFetch = globalThis.fetch;
  const updates: any[] = [];
  let fenced = false;
  const row: any = { id: 'd1', companyId: COMPANY, channel, status: 'QUEUED', attemptCount: 0,
    recipient: { userId: 'u1', event: { triggerKey,
      sourceModule: triggerKey.startsWith('crm_') ? 'crm_inbox' : 'inventory', sourceType: 'crm_conversation', sourceId: 'conv-1',
      severity: 'ACTION', status: 'OPEN', title: 'รายการรอตรวจ', body: '' } } };
  const update = async ({ data }: any) => { updates.push(data); return data; };
  const updateMany = async ({ data }: any) => { updates.push(data); return { count: 1 }; };
  store.prisma.client.notificationDelivery = { findFirst: async () => row, updateMany };
  store.prisma.client.notificationPreference = { findUnique: async () => null };
  store.prisma.client.externalIdentity = { findFirst: async () => ({ providerUserId: 'line-1' }) };
  store.prisma.client.$transaction = async (run: any) => run({ ...store.prisma.client,
    $queryRaw: async () => [{ id: 'm1' }],
    $executeRaw: async (sql: any) => { assert.deepEqual(sql.values, [`entitlement:${COMPANY}`]); fenced = true; return 0; },
    companyFeatureEntitlement: { findMany: async () => {
      if (requireFence) assert.equal(fenced, true, 'entitlement read must hold the company lock through egress');
      return egressFeatureKeys.map(featureKey => ({ featureKey, enabled: true }));
    } },
    notificationDelivery: { findFirst: async () => row, updateMany, update },
    crmConversation: { findFirst: async () => ({ customerId: 'customer-1' }) },
    crmCustomer: { findFirst: async () => ({ id: 'customer-1' }) },
  });
  const config = { lineMessagingChannelAccessToken: 'token', lineMessagingChannelId: 'channel' } as any;
  const process = new ProcessQueuedDeliveryUseCase(lineMessagingCredentialsFixture(config), store.prisma,
    { update: async (_co: string, _id: string, data: any) => update({ data }) } as any,
    { log: async () => undefined } as any, config);
  try {
    globalThis.fetch = (async () => { pushes++; return new Response('{}', { status: 200 }); }) as any;
    await process.execute(COMPANY, 'd1');
    return { pushes, last: updates.at(-1) };
  } finally { globalThis.fetch = originalFetch; }
}

it('registers the five disbursement notices for expenses and LINE, with pending approval and payer approval tasks', () => {
  for (const suffix of ['pending_approval', 'approved', 'returned', 'paid', 'cancelled']) {
    const key = `expense.disbursement_${suffix}`;
    assert.ok(IMPLEMENTED_TRIGGER_KEYS.includes(key));
    assert.ok(ALWAYS_DELIVERED_TRIGGER_KEYS.includes(key));
    assert.deepEqual(notificationModel.NOTIFICATION_TRIGGER_FEATURE_KEYS[key], ['expenses']);
    assert.equal(Boolean(DOCUMENT_NOTIFICATION_STATES[key]), suffix === 'pending_approval' || suffix === 'approved' || suffix === 'returned');
  }
});

it('creates separate pending task events for a resubmit and each reminder round (voucher spec §8.6)', async () => {
  const h = notificationStore(['expenses']);
  const input = { ...h.input('expense.disbursement_pending_approval'), sourceModule: 'expenses', sourceType: 'disbursement_voucher', sourceId: 'dv',
    deepLinkHref: `/companies/${COMPANY}/expenses/disbursement-vouchers/dv` };
  for (const periodKey of ['1', '2', '2:1', '2:2']) await h.create.execute({ ...input, periodKey });
  assert.equal(h.events.length, 4); assert.equal(new Set(h.events.map(e => e.dedupKey)).size, 4);
  assert.equal(h.recipients.length, 4); assert.equal(h.deliveries.length, 8);
  assert.equal(h.recipients.filter(row => !row.supersededAt).length, 1, 'one unread web row while LINE delivery history stays intact');
  assert.ok(h.events.every(e => e.severity === 'ACTION' && e.deepLinkHref === input.deepLinkHref));
});

it('keeps the disbursement task open only for its pending revision, closing after approve, return, withdraw or cancel', async () => {
  let status = 'PENDING_APPROVAL', revision = 1, submittedAt = new Date('2026-10-11T01:00:00Z');
  const db: any = {
    notificationEvent: { findMany: async () => [{ id: 'pending', triggerKey: 'expense.disbursement_pending_approval', sourceType: 'disbursement_voucher', sourceId: 'dv', sourceRefsJson: { refs: [{ revision: 1 }] }, createdAt: new Date('2026-10-11T00:59:59Z') }] },
    disbursementVoucher: { findMany: async (q: any) => { assert.equal(q.where.companyId, 'co'); return [{ id: 'dv', status, revision, submittedAt }]; } },
  };
  assert.deepEqual(await completedDocumentNotificationIds(db, 'co', 'u'), []);
  for (const next of ['APPROVED', 'DRAFT', 'DRAFT', 'CANCELLED']) {
    status = next; assert.deepEqual(await completedDocumentNotificationIds(db, 'co', 'u'), ['pending']);
  }
  status = 'PENDING_APPROVAL'; revision = 2; submittedAt = new Date('2026-10-11T02:00:00Z');
  assert.deepEqual(await completedDocumentNotificationIds(db, 'co', 'u'), ['pending']);
});


it('actionable approval notices for payers and eligible preparers close while information notices stay', async () => {
  let status = 'APPROVED';
  const db: any = { notificationEvent: { findMany: async () => [
    { id: 'payer', triggerKey: 'expense.disbursement_approved', severity: 'ACTION', sourceType: 'disbursement_voucher', sourceId: 'dv', sourceRefsJson: { refs: [{ revision: 1 }] } },
    { id: 'preparer-payer', triggerKey: 'expense.disbursement_approved', severity: 'ACTION', sourceType: 'disbursement_voucher', sourceId: 'dv', sourceRefsJson: { refs: [{ revision: 1 }] } },
    { id: 'preparer', triggerKey: 'expense.disbursement_approved', severity: 'INFO', sourceType: 'disbursement_voucher', sourceId: 'dv' },
  ] }, disbursementVoucher: { findMany: async () => [{ id: 'dv', status, revision: 1 }] } };
  assert.deepEqual(await completedDocumentNotificationIds(db, 'co', 'u'), []);
  for (const next of ['PAID', 'DRAFT', 'CANCELLED']) { status = next; assert.deepEqual(await completedDocumentNotificationIds(db, 'co', 'u'), ['payer', 'preparer-payer']); }
});

it('excludes closed disbursement and substitute tasks identically from the bell badge and resolves their list rows', async () => {
  const captured: Record<string, any> = {}, prisma = capturingPrisma(captured);
  const events = [
    { id: 'dv-task', title: 'รออนุมัติ: ใบเตรียมจ่าย', triggerKey: 'expense.disbursement_pending_approval', sourceType: 'disbursement_voucher', sourceId: 'dv', severity: 'ACTION', status: 'OPEN', recipients: [] },
    { id: 'sub-task', title: 'รออนุมัติ: ใบแทนใบเสร็จ', triggerKey: 'expense.substitute_receipt_approval_pending', sourceType: 'substitute_receipt_evidence', sourceId: 'sub', severity: 'ACTION', status: 'OPEN', recipients: [] },
  ];
  prisma.client.notificationEvent.findMany = async (q: any) => q.select ? events : events;
  prisma.client.disbursementVoucher = { findMany: async () => [{ id: 'dv', status: 'APPROVED', revision: 1 }] };
  prisma.client.expenseSubstituteReceiptEvidence = { findMany: async () => [{ id: 'sub', status: 'APPROVED' }] };
  prisma.client.notificationEvent.groupBy = async (q: any) => { captured.countWhere = q.where; return []; };
  const count = await new PrismaNotificationRecipientRepository(prisma).countUnread(COMPANY, 'u1');
  assert.deepEqual(captured.countWhere.id.notIn, ['dv-task', 'sub-task']); assert.equal(count.total, 0);
  assert.ok((await new PrismaNotificationEventRepository(prisma).list(COMPANY, 'u1', {})).items.every(row => row.status === 'resolved'));
});


it('replays an approved preparer payment task in the same revision without new recipients or LINE text', async () => {
  const h = notificationStore(['expenses']);
  h.prisma.client.notificationEvent.update = async ({ data }: any) => Object.assign(h.events[0], data);
  h.prisma.client.notificationRecipient.findUnique = async () => h.recipients[0] ?? null;
  h.prisma.client.notificationDelivery.findFirst = async ({ where }: any) => h.deliveries.find((d: any) => d.recipientId === where.recipientId && d.channel === where.channel) ?? null;
  const input = { ...h.input('expense.disbursement_approved'), sourceModule: 'expenses', sourceType: 'disbursement_voucher', sourceId: 'dv', periodKey: '1', severity: 'action' as const,
    title: 'อนุมัติแล้ว รอจ่าย: ใบเตรียมจ่ายเลขที่ PV-1', body: 'จ่ายเงินให้ ร้าน ก ยอด 10.10 บาท แล้วบันทึกว่าจ่ายแล้วที่ใบนี้' };
  await h.create.execute(input); await h.create.execute(input);
  assert.equal(h.events.length, 1); assert.equal(h.events[0].severity, 'ACTION');
  assert.equal(h.events[0].title, input.title); assert.equal(h.events[0].body, input.body);
  assert.equal(h.recipients.length, 1); assert.equal(h.deliveries.length, 2);
});

it('expense review requests remain actionable only for the current waiting request', async () => {
  const { completedDocumentNotificationIds } = await import('./infrastructure/document-notification-state');
  const sentAt = new Date('2026-10-13T01:00:00Z');
  let status = 'READY_FOR_CONFIRMATION';
  const db: any = { notificationEvent: { findMany: async () => [{ id: 'current', triggerKey: 'expense.review_requested', sourceType: 'expense_record', sourceId: 'expense', sourceRefsJson: { refs: [{ submittedAt: sentAt.toISOString() }] } }] },
    expenseRecord: { findMany: async (query: any) => { assert.equal(query.where.companyId, 'co'); return [{ id: 'expense', status, submittedAt: sentAt }]; } } };
  assert.deepEqual(await completedDocumentNotificationIds(db, 'co', 'checker'), []);
  status = 'CONFIRMED'; assert.deepEqual(await completedDocumentNotificationIds(db, 'co', 'checker'), ['current']);
  status = 'NEEDS_REVIEW'; assert.deepEqual(await completedDocumentNotificationIds(db, 'co', 'checker'), ['current']);
});

it('waiting filter is applied in the query before the page limit and includes already-read work', async () => {
  const captured: any = {}; const prisma = capturingPrisma(captured);
  await new PrismaNotificationEventRepository(prisma).list(COMPANY, 'u1', { waiting: true, pageSize: 2 });
  const waiting = captured.event.where.AND.find((part: any) => part.triggerKey?.in);
  assert.deepEqual(waiting.severity.in, ['ACTION', 'CRITICAL']);
  assert.ok(waiting.triggerKey.in.includes('expense.disbursement_pending_approval'));
  assert.equal(captured.event.where.recipients.some.finishedAt, null);
  assert.equal(captured.event.where.recipients.some.readAt, undefined);
  assert.equal(captured.event.where.recipients.some.supersededAt, null);
  assert.equal(captured.event.take, 3);
});

// Real database proof; opt in only to a disposable local database with this migration applied.
describe('waiting notifications on PostgreSQL', { skip: !process.env.NOTIFICATION_TEST_DATABASE_URL }, () => {
  for (const sourceType of ['disbursement_voucher', 'reimbursement_request'] as const) it(`${sourceType}: replaces concurrent reminders per recipient, preserves read history and finishes at approval before a read`, async () => {
    const { randomUUID } = await import('node:crypto');
    const { PrismaPg } = await import('@prisma/adapter-pg');
    const { PrismaClient } = await import('../../generated/prisma/client');
    const url = new URL(process.env.NOTIFICATION_TEST_DATABASE_URL!);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
    assert.ok(['/watchdog_bms', '/notification_test'].includes(url.pathname));
    const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) });
    const companyId = `notice-${randomUUID()}`, userId = `user-${randomUUID()}`;
    const repo = new PrismaNotificationRecipientRepository({ client: db } as any);
    try {
      await db.company.create({ data: { id: companyId, name: 'Notice test' } });
      await db.user.create({ data: { id: userId, displayName: 'Test' } });
      const branch = await db.branch.create({ data: { companyId, name: 'Test', code: 'HO', type: 'HEAD_OFFICE', createdByUserId: userId } });
      const voucher = sourceType === 'reimbursement_request' ? await db.reimbursementRequest.create({ data: { companyId, branchId: branch.id, requesterUserId: userId, requesterDisplayNameSnapshot: 'Test', reason: 'Test', categoryKey: 'general', amount: 1, incurredDate: new Date(), createdByUserId: userId, status: 'PENDING_APPROVAL' } }) : await db.disbursementVoucher.create({ data: { companyId, branchId: branch.id, origin: 'PREPARED', payeeName: 'Test', payeeBasis: 'SAME_NAME', totalAmount: 1, preparedByUserId: userId, status: 'PENDING_APPROVAL', revision: 1 } as any });
      const send = async (recipientUserId = userId) => {
        const event = await db.notificationEvent.create({ data: { companyId, triggerKey: sourceType === 'disbursement_voucher' ? 'expense.disbursement_pending_approval' : 'workflow.reimbursement_pending_approval', sourceModule: sourceType === 'disbursement_voucher' ? 'expenses' : 'reimbursements', sourceType, sourceId: voucher.id, title: 'รออนุมัติ: ใบเตรียมจ่ายเลขที่ PV-1', body: 'เดิม', severity: 'ACTION', dedupKey: randomUUID() } });
        const recipient = await db.notificationRecipient.create({ data: { companyId, eventId: event.id, userId: recipientUserId, recipientReason: 'role' } });
        await repo.trackWaiting(recipient as any, event as any); return recipient;
      };
      await Promise.all([send(), send(), send()]);
      assert.equal(await db.notificationRecipient.count({ where: { companyId, userId, supersededAt: null } }), 1);
      const current = await db.notificationRecipient.findFirstOrThrow({ where: { companyId, userId, supersededAt: null } });
      await repo.update(companyId, current.id, { readAt: new Date() });
      const reminder = await send(); await send('another-member');
      assert.equal(await db.notificationRecipient.count({ where: { companyId, userId, supersededAt: null } }), 2);
      if (sourceType === 'disbursement_voucher') {
        await db.disbursementVoucher.update({ where: { id: voucher.id }, data: { status: 'APPROVED' } });
        const notifier = new CreateOrUpdateNotificationEventUseCase({} as any, {} as any, {} as any, {} as any, {} as any, { client: db } as any);
        await notifier.finishDocumentWaiting(companyId, sourceType, voucher.id);
      } else {
        await db.reimbursementRequest.update({ where: { id: voucher.id }, data: { status: 'APPROVED' } });
        const { PrismaWorkflowRepository } = await import('../workflow/infrastructure/prisma-workflow.repository');
        await new PrismaWorkflowRepository({ client: db } as any).closeSettledClaimTasks({ companyId, requestId: voucher.id });
      }
      // No list call may be responsible for this write. Other recipients finish too.
      assert.equal(await db.notificationRecipient.count({ where: { companyId, finishedAt: null } }), 0);
      assert.equal((await repo.countUnread(companyId, userId)).total, 0);
      const events = new PrismaNotificationEventRepository({ client: db } as any);
      assert.equal((await events.list(companyId, userId, { waiting: true })).items.length, 0);
      assert.ok((await db.notificationRecipient.findUniqueOrThrow({ where: { id: reminder.id } })).finishedAt);
      assert.equal((await events.list(companyId, userId, {})).items.find(row => row.id === reminder.eventId)?.title, `${sourceType === 'disbursement_voucher' ? 'อนุมัติแล้ว รอจ่าย' : 'อนุมัติแล้ว'}: ใบเตรียมจ่ายเลขที่ PV-1`);
      assert.equal((await db.notificationEvent.findUniqueOrThrow({ where: { id: reminder.eventId } })).title, 'รออนุมัติ: ใบเตรียมจ่ายเลขที่ PV-1');
    } finally { await db.notificationEvent.deleteMany({ where: { companyId } }); await db.disbursementVoucher.deleteMany({ where: { companyId } }); await db.reimbursementRequest.deleteMany({ where: { companyId } }); await db.branch.deleteMany({ where: { companyId } }); await db.company.deleteMany({ where: { id: companyId } }); await db.user.deleteMany({ where: { id: userId } }); await db.$disconnect(); }
  });
});

// Completion is part of the existing post-commit notice path, even with nobody to notify.
describe('waiting notices finish at the source event', () => {
  for (const [action, status] of [['approve', 'APPROVED'], ['pay', 'PAID'], ['return', 'DRAFT'], ['withdraw', 'DRAFT'], ['cancel', 'CANCELLED']] as const) {
    it(`finishes voucher approval on ${action} before any list read or recipient lookup`, async () => {
      const { DisbursementVoucherNoticeService } = await import('../expenses/application/services/disbursement-voucher-notice.service');
      const writes: any[] = [];
      const db: any = {
        notificationEvent: { findMany: async (q: any) => { assert.equal(q.where.companyId, COMPANY); assert.equal(q.where.sourceId, 'dv'); return [{ id: 'old', triggerKey: 'expense.disbursement_pending_approval', sourceType: 'disbursement_voucher', sourceId: 'dv', severity: 'ACTION' }]; } },
        notificationRecipient: { updateMany: async (q: any) => { writes.push(q); return { count: 2 }; } },
        disbursementVoucher: { findMany: async () => [{ id: 'dv', status, revision: 1 }] },
      };
      const notify = new CreateOrUpdateNotificationEventUseCase({} as any, {} as any, {} as any, {} as any, {} as any, { client: db } as any);
      const service = new DisbursementVoucherNoticeService({ memberNames: async () => { assert.equal(writes.length, 1); throw new Error('no recipients'); } } as any, notify);
      await service.send(ctx as any, { id: 'dv', documentNumber: 'PV-1', status, preparedByUserId: ctx.userId } as any, action);
      assert.equal(writes.length, 1);
      assert.equal(writes[0].where.companyId, COMPANY);
      assert.deepEqual(writes[0].where.eventId, { in: ['old'] });
      assert.ok(writes[0].data.finishedAt instanceof Date);
      assert.equal(writes[0].where.userId, undefined, 'every recipient, including one who has never read the list');
    });
  }
  for (const status of ['APPROVED', 'READY_FOR_PAYMENT', 'PAID', 'DRAFT', 'CANCELLED']) {
    it(`finishes claim approval at the existing workflow event step for ${status}, with no workflow task`, async () => {
      const { PrismaWorkflowRepository } = await import('../workflow/infrastructure/prisma-workflow.repository');
      const writes: any[] = [];
      const db: any = {
        workflowTask: { findMany: async () => [] },
        notificationEvent: { findMany: async (q: any) => { assert.equal(q.where.sourceId, 'claim'); return [{ id: 'old', triggerKey: 'workflow.reimbursement_pending_approval', sourceType: 'reimbursement_request', sourceId: 'claim', severity: 'ACTION' }]; } },
        reimbursementRequest: { findMany: async () => [{ id: 'claim', status, sourceExpenses: [] }] },
        notificationRecipient: { updateMany: async (q: any) => { writes.push(q); return { count: 1 }; } },
      };
      await new PrismaWorkflowRepository({ client: db } as any).closeSettledClaimTasks({ companyId: COMPANY, requestId: 'claim' });
      assert.equal(writes.length, 1); assert.equal(writes[0].where.companyId, COMPANY);
      assert.deepEqual(writes[0].where.eventId, { in: ['old'] }); assert.ok(writes[0].data.finishedAt instanceof Date);
    });
  }
});

describe('waiting filter intersections and unread badge', () => {
  for (const read of [undefined, false, true]) it(`keeps waiting constraints with read=${read} and keyset paging`, async () => {
    const captured: any = {}; const prisma = capturingPrisma(captured);
    await new PrismaNotificationEventRepository(prisma).list(COMPANY, 'u1', { waiting: true, read, cursor: 'evt-page', pageSize: 2 });
    const q = captured.event;
    assert.equal(q.where.recipients.some.finishedAt, null);
    assert.equal(q.where.recipients.some.supersededAt, null);
    assert.deepEqual(q.where.recipients.some.readAt, read === false ? null : read === true ? { not: null } : undefined);
    assert.deepEqual(q.cursor, { id: 'evt-page' }); assert.equal(q.take, 3); assert.equal(q.skip, 1);
  });
  for (const severity of ['action', 'critical', 'info']) it(`intersects waiting with severity ${severity} without replacing the actionable constraint`, async () => {
    const captured: any = {};
    await new PrismaNotificationEventRepository(capturingPrisma(captured)).list(COMPANY, 'u1', { waiting: true, severity });
    assert.equal(captured.event.where.severity, severity.toUpperCase());
    assert.ok(captured.event.where.AND.some((part: any) => part.severity?.in?.join(',') === 'ACTION,CRITICAL'));
  });
  for (const triggerKey of ['expense.disbursement_approved', 'daily_owner_summary']) it(`intersects waiting with kind ${triggerKey}`, async () => {
    const captured: any = {};
    await new PrismaNotificationEventRepository(capturingPrisma(captured)).list(COMPANY, 'u1', { waiting: true, triggerKey });
    assert.equal(captured.event.where.triggerKey, triggerKey);
    const allowed = captured.event.where.AND.find((part: any) => part.triggerKey?.in)?.triggerKey.in;
    assert.ok(allowed?.includes('expense.disbursement_approved')); assert.ok(!allowed?.includes('daily_owner_summary'));
  });
  it('counts current unread rows by severity without counting read, replaced or finished work', async () => {
    const captured: any = {}; const prisma = capturingPrisma(captured);
    prisma.client.notificationEvent.groupBy = async (q: any) => { captured.count = q; return [{ severity: 'ACTION', _count: { _all: 2 } }, { severity: 'CRITICAL', _count: { _all: 1 } }]; };
    const result = await new PrismaNotificationRecipientRepository(prisma).countUnread(COMPANY, 'u1');
    assert.deepEqual(captured.count.where.recipients.some, { userId: 'u1', readAt: null, dismissedAt: null, supersededAt: null, finishedAt: null });
    assert.equal(result.total, 3); assert.equal(result.bySeverity.action, 2); assert.equal(result.bySeverity.critical, 1);
  });
  it('an urgent approval reminder shares the approval waiting key', async () => {
    const { waitingNoticeKey } = await import('./infrastructure/waiting-notification');
    assert.equal(waitingNoticeKey({ triggerKey: 'workflow.approval_sla_breach', sourceType: 'reimbursement_request', sourceId: 'claim', severity: 'CRITICAL' }), 'reimbursement_request:claim:approve');
  });
});

it('a finished waiting task stays resolved when its claim later re-enters the same status', async () => {
  const captured: any = {};
  const repo = new PrismaNotificationEventRepository(capturingPrisma(captured));
  await repo.list(COMPANY, 'u1', { status: 'open' });
  assert.equal(captured.event.where.recipients.some.finishedAt, null);
  await repo.list(COMPANY, 'u1', { status: 'resolved' });
  assert.ok(captured.event.where.OR.some((part: any) => part.recipients?.some?.userId === 'u1' && part.recipients.some.finishedAt?.not === null));
});

it('waiting keys join approval reminders by document and action, never by recipient or revision', () => {
  const event = { sourceType: 'disbursement_voucher', sourceId: 'one', triggerKey: 'expense.disbursement_pending_approval', severity: 'ACTION' };
  assert.equal(waitingNoticeKey(event), 'disbursement_voucher:one:approve');
  assert.equal(waitingNoticeKey({ ...event, triggerKey: 'expense.disbursement_approved' }), 'disbursement_voucher:one:pay');
  assert.equal(waitingNoticeKey({ ...event, triggerKey: 'expense.disbursement_approved', severity: 'INFO' }), null);
  assert.equal(waitingNoticeKey({ ...event, sourceType: 'reimbursement_request', triggerKey: 'workflow.approval_sla_breach' }), waitingNoticeKey({ ...event, sourceType: 'reimbursement_request', triggerKey: 'workflow.reimbursement_pending_approval' }));
});
it('finished titles replace waiting words with the document state without changing the remaining sentence', () => {
  assert.equal(finishedNoticeTitle('รออนุมัติ: ใบเตรียมจ่ายเลขที่ PV-1', 'อนุมัติแล้ว'), 'อนุมัติแล้ว: ใบเตรียมจ่ายเลขที่ PV-1');
  assert.equal(finishedNoticeTitle('เตือนอีกครั้ง: ใบเตรียมจ่ายเลขที่ PV-1 รออนุมัติ', 'จ่ายแล้ว'), 'เตือนอีกครั้ง: ใบเตรียมจ่ายเลขที่ PV-1 จ่ายแล้ว');
  assert.equal(finishedNoticeTitle('อนุมัติแล้ว รอจ่าย: ใบเตรียมจ่ายเลขที่ PV-1', 'จ่ายแล้ว'), 'จ่ายแล้ว: ใบเตรียมจ่ายเลขที่ PV-1');
});

it('finished claim bell rows project returned-for-correction wording without changing the stored title', async () => {
  const notice = { sourceType: 'reimbursement_request', sourceId: 'claim', title: 'รออนุมัติ: ใบเบิก RB-1' };
  const db = { reimbursementRequest: { findMany: async () => [{ id: 'claim', status: 'REJECTED' }] } };
  const words = await documentStateWords(db, 'co', [notice]);
  assert.equal(words.get('reimbursement_request:claim'), 'ถูกส่งกลับให้แก้');
  assert.equal(finishedNoticeTitle(notice.title, words.get('reimbursement_request:claim')!), 'ถูกส่งกลับให้แก้: ใบเบิก RB-1');
  assert.equal(notice.title, 'รออนุมัติ: ใบเบิก RB-1');
});

it('claim decision notices read as sent back even when stored before the wording change', () => {
  for (const decision of ['REJECTED', 'ไม่อนุมัติ', 'ส่งกลับให้แก้แล้ว']) {
    assert.equal(localizeReimbursementDecision(`ผลการพิจารณา: ${decision} · ยอด 120.00 บาท`), 'ผลการพิจารณา: ส่งกลับให้แก้แล้ว · ยอด 120.00 บาท');
  }
  assert.equal(localizeReimbursementDecision('เหตุผล: ไม่อนุมัติรายการซ้ำ'), 'เหตุผล: ไม่อนุมัติรายการซ้ำ', 'free-text reasons are not rewritten');
});

it('finishes old and new payment-document return notices without rewriting their stored words', async () => {
  for (const prefix of ['ตีกลับ', 'ส่งกลับให้แก้']) {
    const notice = { id: 'returned', triggerKey: 'expense.disbursement_returned', sourceType: 'disbursement_voucher', sourceId: 'dv',
      severity: 'ACTION', title: `${prefix}: ใบเตรียมจ่ายเลขที่ PV-1`, sourceRefsJson: { refs: [{ revision: 1 }] } };
    const writes: any[] = [];
    const db: any = {
      notificationEvent: { findMany: async () => [notice] },
      disbursementVoucher: { findMany: async () => [{ id: 'dv', status: 'PENDING_APPROVAL', revision: 2 }] },
      notificationRecipient: { updateMany: async (query: any) => { writes.push(query); return { count: 1 }; } },
    };
    await new CreateOrUpdateNotificationEventUseCase({} as any, {} as any, {} as any, {} as any, {} as any, { client: db } as any)
      .finishDocumentWaiting(COMPANY, 'disbursement_voucher', 'dv');
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].where.eventId, { in: ['returned'] });
    assert.equal(writes[0].where.companyId, COMPANY);
    assert.ok(writes[0].data.finishedAt instanceof Date);
    const states = await documentStateWords(db, COMPANY, [notice]);
    assert.equal(finishedNoticeTitle(notice.title, states.get('disbursement_voucher:dv')!), 'รออนุมัติ: ใบเตรียมจ่ายเลขที่ PV-1');
    assert.equal(notice.title, `${prefix}: ใบเตรียมจ่ายเลขที่ PV-1`, 'stored history stays unchanged');
  }
});

it('new payment-document return events render the current contract words directly, without stored templates', async () => {
  const { DisbursementVoucherNoticeService } = await import('../expenses/application/services/disbursement-voucher-notice.service');
  const events: any[] = [];
  const service = new DisbursementVoucherNoticeService({
    memberNames: async () => new Map([['u1', 'สมชาย'], ['preparer', 'สมหญิง']]),
    activeMemberIds: async () => ['preparer'],
  } as any, { finishDocumentWaiting: async () => undefined, execute: async (input: any) => events.push(input) } as any);
  await service.send(ctx, { id: 'dv', documentNumber: 'PV-1', status: 'DRAFT', preparedByUserId: 'preparer',
    payeeName: 'ร้านทดสอบ', totalAmount: '100', revision: 1 } as any, 'return', { reason: 'แก้ยอด' });
  assert.equal(events.length, 1);
  assert.equal(events[0].title, 'ส่งกลับให้แก้: ใบเตรียมจ่ายเลขที่ PV-1');
  assert.equal(events[0].body, 'สมชาย ส่งกลับให้แก้ เหตุผล: แก้ยอด แก้แล้วส่งใหม่ได้ด้วยเลขที่เดิม');
  assert.deepEqual(events[0].recipientUserIds, ['preparer']);
  assert.equal(events[0].severity, 'action');
});

// HOME-1: same disposable-database opt-in as the notification proofs above.
describe('expense months on PostgreSQL', { skip: !process.env.NOTIFICATION_TEST_DATABASE_URL }, () => {
  it('groups confirmed civil dates at Bangkok month boundaries, isolates year and branch, and matches the dashboard total', async () => {
    const { randomUUID } = await import('node:crypto');
    const { PrismaPg } = await import('@prisma/adapter-pg');
    const { PrismaClient } = await import('../../generated/prisma/client');
    const { coerceCivilDate, civilDateToUtcDate } = await import('@watchdog-bms/contracts');
    const url = new URL(process.env.NOTIFICATION_TEST_DATABASE_URL!);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
    assert.ok(['/watchdog_bms', '/notification_test', '/watchdog_pv_land'].includes(url.pathname));
    const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) });
    const companyId = `months-${randomUUID()}`, otherCompanyId = `other-${randomUUID()}`;
    try {
      await db.company.createMany({ data: [{ id: companyId, name: 'Monthly expenses' }, { id: otherCompanyId, name: 'Other shop' }] });
      // Expense dates enter the app as civil days, even when the source supplied a timestamp.
      const date = (value: string) => civilDateToUtcDate(coerceCivilDate(value, 'Asia/Bangkok'));
      await db.expenseRecord.createMany({ data: [
        { companyId, branchId: 'b1', expenseDate: date('2025-12-31T17:00:00Z'), grandTotalAmount: '10.01' }, // 1 Jan in Bangkok
        { companyId, branchId: 'b1', expenseDate: date('2026-01-31T16:59:59Z'), grandTotalAmount: '20.02' }, // last day of Jan
        { companyId, branchId: 'b1', expenseDate: date('2026-01-31T17:00:00Z'), grandTotalAmount: '40.04' }, // 1 Feb
        { companyId, branchId: null, expenseDate: date('2026-01-15'), grandTotalAmount: '30.03' },
        { companyId, branchId: 'b2', expenseDate: date('2026-01-15'), grandTotalAmount: '50.05' },
        { companyId, branchId: 'b1', expenseDate: date('2025-12-31'), grandTotalAmount: '900' },
        { companyId, branchId: 'b1', expenseDate: date('2027-01-01'), grandTotalAmount: '901' },
        { companyId, branchId: 'b2', expenseDate: date('2024-01-01'), grandTotalAmount: '902' },
        { companyId, branchId: 'b1', expenseDate: date('2026-01-10'), grandTotalAmount: '903', status: 'DRAFT' as const },
        { companyId, branchId: 'b1', expenseDate: date('2023-01-10'), grandTotalAmount: '904', status: 'VOIDED' as const },
        { companyId: otherCompanyId, branchId: null, expenseDate: date('2022-01-10'), grandTotalAmount: '905' },
      ].map(row => ({ status: 'CONFIRMED' as const, createdByUserId: 'monthly-test', ...row })) });
      const provider = new ExpenseSummaryProvider({ client: db } as any);
      const now = new Date('2026-10-14T17:00:00Z');
      const all = await provider.collectMonths({ companyId, year: 2026 }, now);
      assert.equal(all.months.length, 12);
      assert.deepEqual(all.months[0], { month: '2026-01', total: '110.11', count: 4 });
      assert.deepEqual(all.months[1], { month: '2026-02', total: '40.04', count: 1 });
      assert.ok(all.months.slice(2).every(row => row.total === '0.00' && row.count === 0));
      assert.deepEqual(all.years, [2024, 2025, 2026, 2027]);
      const scoped = await provider.collectMonths({ companyId, year: 2026, branchIds: ['b1'] }, now);
      assert.deepEqual(scoped.months[0], { month: '2026-01', total: '30.03', count: 2 });
      assert.deepEqual(scoped.years, [2025, 2026, 2027]);
      const empty = await provider.collectMonths({ companyId, year: 2026, branchIds: [] }, now);
      assert.deepEqual(empty.years, [2026]); assert.ok(empty.months.every(row => row.count === 0 && row.total === '0.00'));
      const [widget] = await provider.collectMetrics({ companyId, branchIds: ['b1'], periodStart: new Date('2025-12-31T17:00:00Z'), periodEnd: new Date('2026-01-31T16:59:59.999Z') });
      assert.equal(widget.metrics.find(row => row.key === 'expense_total_in_period')?.value, Number(scoped.months[0]!.total));
    } finally {
      await db.expenseRecord.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
      await db.company.deleteMany({ where: { id: { in: [companyId, otherCompanyId] } } });
      await db.$disconnect();
    }
  });
});
