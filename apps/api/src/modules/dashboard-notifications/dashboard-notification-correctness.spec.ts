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
import { completedDocumentNotificationIds } from './infrastructure/document-notification-state';
import { WORKFLOW_TEMPLATE_CATALOG } from '../workflow/domain/workflow-template-catalog';
import type { RequestContext } from '../auth/domain/models/request-context.model';

const COMPANY = 'co-1';

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
  });
  return {
    client: {
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
    assert.deepEqual(captured['event.groupBy'].where.recipients.some, { userId: 'u1', readAt: null, dismissedAt: null });
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
