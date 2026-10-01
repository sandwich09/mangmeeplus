/**
 * Shadow coverage for the workflow scan sweep (piece 5).
 *
 * The scan is one of the `workflow_automation` async surfaces the F0 inventory records as
 * entitlement-blind. These tests pin the two things that make its evidence trustworthy: every
 * scanned rule is counted (including rules the scan then skips), and a mid-sweep throw still
 * flushes what was already observed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RunWorkflowScanUseCase } from './workflow-scan.use-case';
import { WorkflowScanCandidatesProvider } from './workflow-scan-candidates.use-case';
import { WORKFLOW_TEMPLATE_CATALOG, WORKFLOW_TEMPLATE_DEFAULT_COOLDOWN_SECONDS } from '../../domain/workflow-template-catalog';
import { evaluateCondition } from '../../domain/logic/workflow-condition.logic';

function makeScan(opts: { rules?: any[]; candidatesThrow?: boolean; runnerThrows?: boolean } = {}) {
  const shadowRecords: any[] = [];
  const flushes: string[] = [];
  const runs: any[] = [];

  const repo = { listAllEnabledRulesByTrigger: async () => opts.rules ?? [] } as any;
  const candidates = {
    forTemplate: async () => {
      if (opts.candidatesThrow) throw new Error('source module unavailable');
      return [{ sourceType: 'expense', sourceId: 'x-1', payload: {} }];
    },
  } as any;
  const runner = {
    execute: async (input: any) => {
      runs.push(input);
      if (opts.runnerThrows) throw new Error('runner blew up');
      return { runId: 'r-1', status: 'CREATED' };
    },
  } as any;
  const shadow = {
    startSweep: (surface: string) => ({
      record: async (companyId: string | null, featureKey: string | null) => {
        shadowRecords.push({ surface, companyId, featureKey });
        return { wouldBlock: false, reason: 'available' as const };
      },
      flush: async () => { flushes.push(surface); return {}; },
    }),
  } as any;

  return { useCase: new RunWorkflowScanUseCase(repo, candidates, runner, shadow), shadowRecords, flushes, runs };
}

const rule = (companyId: string, templateKey: string | null = 'low_stock') => ({
  companyId,
  triggerType: 'THRESHOLD_SCAN',
  template: templateKey ? { key: templateKey, sourceModule: 'inventory' } : undefined,
});

describe('RunWorkflowScanUseCase shadow coverage', () => {
  it('records one observation per scanned rule under workflow_automation', async () => {
    const { useCase, shadowRecords, flushes } = makeScan({ rules: [rule('co-1'), rule('co-2')] });
    const result = await useCase.execute('THRESHOLD_SCAN');

    assert.deepEqual(shadowRecords, [
      { surface: 'workflow.scan', companyId: 'co-1', featureKey: 'workflow_automation' },
      { surface: 'workflow.scan', companyId: 'co-2', featureKey: 'workflow_automation' },
    ]);
    assert.deepEqual(flushes, ['workflow.scan']);
    // SHADOW ONLY: the scan proceeds exactly as before.
    assert.equal(result.rulesScanned, 2);
    assert.equal(result.runsCreated, 2);
  });

  it('counts a rule whose template is missing — it is still work this tenant would be asked about', async () => {
    const { useCase, shadowRecords, runs } = makeScan({ rules: [rule('co-1', null)] });
    await useCase.execute('SCHEDULE');
    assert.equal(shadowRecords.length, 1);
    assert.equal(runs.length, 0, 'the rule is still skipped — only the denominator changed');
  });

  it('counts a rule whose source module is unavailable this tick', async () => {
    const { useCase, shadowRecords, runs } = makeScan({ rules: [rule('co-1')], candidatesThrow: true });
    await useCase.execute('SLA_SCAN');
    assert.equal(shadowRecords.length, 1);
    assert.equal(runs.length, 0);
  });

  it('flushes buffered evidence when the runner throws mid-sweep (finally, not a trailing await)', async () => {
    const { useCase, shadowRecords, flushes } = makeScan({ rules: [rule('co-1'), rule('co-2')], runnerThrows: true });
    await assert.rejects(() => useCase.execute('THRESHOLD_SCAN'), /runner blew up/);
    // Mutation guard: move `await sweep.flush()` out of the `finally` and this fails — the first
    // rule's observation would be lost with no bucket row AND no persist_failed warn.
    assert.equal(shadowRecords.length, 1);
    assert.deepEqual(flushes, ['workflow.scan']);
  });

  it('flushes an empty sweep without recording anything', async () => {
    const { useCase, shadowRecords, flushes } = makeScan({ rules: [] });
    await useCase.execute('SCHEDULE');
    assert.deepEqual(shadowRecords, []);
    assert.deepEqual(flushes, ['workflow.scan']);
  });
});

/**
 * Audit B9: the only reminder covered claims waiting for approval, so a claim waiting for payment
 * was never chased. It rides the same SLA scan and the same policy deadline; these tests pin what
 * the scan offers the rule and when the rule's own condition fires.
 */
describe('payment reminder candidates (audit B9)', () => {
  const NOW = new Date('2026-10-01T12:00:00.000Z');
  const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);
  const claim = (extra: Record<string, unknown>) => ({
    id: 'rb-1', requestNo: 'RB-202610-00001', status: 'READY_FOR_PAYMENT', amount: '250', outstandingAmount: '250',
    currency: 'THB', submittedAt: hoursAgo(200), approvedAt: hoursAgo(100), ...extra,
  });
  const template = () => WORKFLOW_TEMPLATE_CATALOG.find((entry) => entry.key === 'reimbursement_payment_sla_breach')!;

  function provider(rows: any[], policy: Record<string, unknown> | null = { slaHours: 48 }) {
    const queries: any[] = [];
    const reimbursementRepo = {
      findPolicy: async () => policy,
      listRequests: async (where: any) => { queries.push(where); return rows; },
    } as any;
    return {
      candidates: new WorkflowScanCandidatesProvider(reimbursementRepo, {} as any, {} as any, {} as any, {} as any, {} as any),
      queries,
    };
  }
  const fires = (payload: Record<string, unknown>) => evaluateCondition(template().defaultConditionJson, payload, NOW).matched;

  it('offers every claim waiting for payment and fires only past the policy deadline', async () => {
    const { candidates, queries } = provider([
      claim({ id: 'rb-late', approvedAt: hoursAgo(49) }),
      claim({ id: 'rb-fresh', approvedAt: hoursAgo(47) }),
    ]);

    const items = await candidates.forTemplate('reimbursement_payment_sla_breach', 'co-1', NOW);

    assert.deepEqual(queries, [{ companyId: 'co-1', statuses: ['READY_FOR_PAYMENT', 'PARTIALLY_PAID'] }]);
    assert.deepEqual(items.map((item) => [item.sourceType, item.sourceId, fires(item.payload)]), [
      ['reimbursement_request', 'rb-late', true],
      ['reimbursement_request', 'rb-fresh', false],
    ]);
    assert.deepEqual(items[0]!.payload, {
      requestId: 'rb-late', requestNo: 'RB-202610-00001', ageHours: 49, slaRisk: true, amount: '250', currency: 'THB',
    });
  });

  it('starts the clock at the finance decision when there was one, not at the approval before it', async () => {
    const { candidates } = provider([claim({ approvedAt: hoursAgo(100), financeReviewedAt: hoursAgo(10) })]);

    const [item] = await candidates.forTemplate('reimbursement_payment_sla_breach', 'co-1', NOW);

    assert.equal(item!.payload['ageHours'], 10);
    assert.equal(fires(item!.payload), false);
  });

  it('reminds for what is left to pay on a legacy part-paid claim', async () => {
    const { candidates } = provider([claim({ status: 'PARTIALLY_PAID', amount: '250', outstandingAmount: '100' })]);

    const [item] = await candidates.forTemplate('reimbursement_payment_sla_breach', 'co-1', NOW);

    assert.equal(item!.payload['amount'], '100');
    assert.equal(fires(item!.payload), true);
  });

  // Same rule as approvals: the deadline is the company's own, and a company that set none is not chased.
  it('never fires for a company that has not set a deadline in its claim policy', async () => {
    const { candidates } = provider([claim({ approvedAt: hoursAgo(5000) })], null);

    const [item] = await candidates.forTemplate('reimbursement_payment_sla_breach', 'co-1', NOW);

    assert.equal(item!.payload['slaRisk'], false);
    assert.equal(fires(item!.payload), false);
  });

  it('is an auto-enabled SLA_SCAN rule on the default scan cadence, and only a notice', () => {
    assert.equal(template().triggerType, 'SLA_SCAN');
    assert.equal(template().autoEnable, true);
    assert.equal(template().status, 'AVAILABLE');
    // The scan templates keep the default rule cooldown; that is the cadence approvals use too.
    assert.equal(WORKFLOW_TEMPLATE_DEFAULT_COOLDOWN_SECONDS['reimbursement_payment_sla_breach'], undefined);
    assert.equal(WORKFLOW_TEMPLATE_DEFAULT_COOLDOWN_SECONDS['approval_sla_breach'], undefined);
    // No task action: a task per scan window is how stale tasks pile up (audit B8).
    assert.deepEqual(template().defaultActionJson.map((action) => action.actionType), ['SEND_NOTIFICATION']);
  });
});
