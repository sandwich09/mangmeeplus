import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { apiConfigSchema } from '@watchdog-bms/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';
import type { PrismaService } from '../../../common/database/prisma.service';
import { ReceiptOcrClient } from '../../expenses/infrastructure/receipt-ocr.client';
import { bangkokMonthKey, __resetCompanyAiBudgetCache } from './company-ai-usage-meter';
import { resolveAiBudgetPolicy } from './company-ai-budget-policy';
import { __resetFxCache } from './ai-fx-rate';
import { admitCompanyOcr, releaseCompanyOcrAdmission, receiptQuotaSnapshot, type CompanyOcrSourceRoute } from './company-ocr-governance';
import { ExpenseCaptureReadRunnerService } from '../../expenses/application/services/expense-capture-read-runner.service';
import { PrismaExpenseCaptureRepository } from '../../expenses/infrastructure/prisma-expense-capture.repository';
import { OutboxAppendService } from '../../data-model-core/application/services/outbox-append.service';
import { PrismaOutboxRepository } from '../../data-model-core/infrastructure/repositories/prisma-outbox.repository';
import { claimFreeExpenseQuotaNotice, completeCompanyOcrAdmission, freeExpenseAllowanceSnapshot, freeExpenseQuotaResetAt } from './free-expense-quota';

const url = process.env.FREE_EXPENSE_QUOTA_TEST_DATABASE_URL;
describe('free document allowance on local PostgreSQL', { skip: !url }, () => {
  const companyId = `free-quota-${randomUUID()}`;
  const monthKey = '2026-12';
  let db: PrismaClient;
  let prisma: PrismaService;
  before(async () => {
    assert.ok(['localhost', '127.0.0.1'].includes(new URL(url!).hostname), 'explicit local database required');
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url!, max: 12 }) });
    prisma = { client: db } as unknown as PrismaService;
    await db.company.create({ data: { id: companyId, name: 'Synthetic free company' } });
    await db.companyPlanTerm.create({ data: { companyId, tierKey: 'FREE_TRIAL_15', branchLimit: 1, employeeLimit: 1,
      monthlySlipLimit: 0, termStartAt: new Date(0), termEndsAt: new Date(0) } });
  });
  after(async () => {
    if (!db) return;
    await db.expenseCaptureObservation.deleteMany({ where: { companyId } });
    await db.expenseCaptureReadJob.deleteMany({ where: { companyId } });
    await db.aiUsageEvent.deleteMany({ where: { companyId } });
    await db.companyAiMonthlyBucketUsage.deleteMany({ where: { companyId } });
    await db.companyAiMonthlyUsage.deleteMany({ where: { companyId } });
    await db.outboxEvent.deleteMany({ where: { companyId } });
    await db.companyOcrUsageEvent.deleteMany({ where: { companyId } });
    await db.companyOcrMonthlyUsage.deleteMany({ where: { companyId } });
    await db.auditLog.deleteMany({ where: { companyId } });
    await db.companyPlanTerm.deleteMany({ where: { companyId } });
    await db.company.deleteMany({ where: { id: companyId } });
    await db.$disconnect();
  });
  it('serializes all four receipt routes, distinguishes pending, refunds once, freezes source and notifies once', async () => {
    const routes: CompanyOcrSourceRoute[] = ['receipt-ocr-web', 'receipt-ocr-line', 'receipt-capture-web', 'receipt-capture-line'];
    const inputs = routes.map((sourceRoute, index) => ({ companyId, sourceRoute, requestId: `race-${index}`, monthKey, enforceReceiptQuota: false }));
    const decisions = await Promise.all(inputs.map((input) => admitCompanyOcr(prisma, input)));
    const accepted = decisions.flatMap((decision, index) => decision.allowed ? [{ input: inputs[index]!, admission: decision }] : []);
    assert.equal(accepted.length, 3, 'shadow rollout cannot exceed the free ceiling');
    assert.equal(decisions.filter((d) => !d.allowed && d.reason === 'free_in_flight').length, 1);
    assert.equal((await freeExpenseAllowanceSnapshot(prisma, companyId, monthKey)).usedCount, 0);
    assert.equal(await claimFreeExpenseQuotaNotice(prisma, companyId, monthKey, new Date('2026-12-15')), false);
    const first = accepted[0]!;
    assert.equal(await releaseCompanyOcrAdmission(prisma, { ...first.input, eventId: first.admission.eventId }), true);
    assert.equal(await releaseCompanyOcrAdmission(prisma, { ...first.input, eventId: first.admission.eventId }), true);
    const replacement = await admitCompanyOcr(prisma, first.input);
    assert.ok(replacement.allowed);
    assert.notEqual(replacement.eventId, first.admission.eventId);
    await assert.rejects(completeCompanyOcrAdmission(prisma, { ...first.input, eventId: first.admission.eventId }),
      (error: any) => error.getResponse?.().code === 'OCR_ADMISSION_STALE');
    await releaseCompanyOcrAdmission(prisma, { ...first.input, eventId: first.admission.eventId });
    assert.equal((await freeExpenseAllowanceSnapshot(prisma, companyId, monthKey)).inFlightCount, 3, 'delayed old refund cannot refund new attempt');
    for (const current of [{ input: first.input, admission: replacement }, ...accepted.slice(1)]) {
      const completed = await completeCompanyOcrAdmission(prisma, { ...current.input, eventId: current.admission.eventId });
      assert.equal(completed.completed, true);
    }
    const blocked = await admitCompanyOcr(prisma, { ...inputs[3]!, requestId: 'fourth-after-success' });
    assert.ok(!blocked.allowed && blocked.reason === 'free_exceeded');
    assert.equal(await claimFreeExpenseQuotaNotice(prisma, companyId, monthKey, new Date('2027-01-01T00:00:00Z')), false, 'old-month completion cannot announce a new-month limit');
    assert.equal((await Promise.all([claimFreeExpenseQuotaNotice(prisma, companyId, monthKey, new Date('2026-12-15')), claimFreeExpenseQuotaNotice(prisma, companyId, monthKey, new Date('2026-12-15'))])).filter(Boolean).length, 1);
    // A successful free operation stays charged after upgrade and cannot be refunded by a delivery failure.
    await db.companyPlanTerm.update({ where: { companyId }, data: { tierKey: 'STARTER_249', monthlySlipLimit: 30, termEndsAt: new Date('2099-01-01') } });
    await releaseCompanyOcrAdmission(prisma, { ...first.input, eventId: replacement.eventId });
    const frozen = await db.companyOcrUsageEvent.findUniqueOrThrow({ where: { id: replacement.eventId } });
    assert.equal(frozen.quotaSource, 'FREE_MONTHLY_3');
    assert.ok(frozen.succeededAt);
    assert.equal((await receiptQuotaSnapshot(prisma, companyId, monthKey)).usedCount, 0, 'free reads never consume upgraded monthly base');
    const nextMonth = await freeExpenseAllowanceSnapshot(prisma, companyId, '2027-01');
    assert.equal(nextMonth.usedCount, 0);
    assert.equal(nextMonth.remainingCount, 3);
    assert.equal(freeExpenseQuotaResetAt('2026-12'), '2026-12-31T17:00:00.000Z');
    assert.equal((await db.companyOcrMonthlyUsage.findUniqueOrThrow({ where: { companyId_monthKey: { companyId, monthKey } } })).usedCount, 3);
  });
  it('keeps the admission month and free source when buying while the provider is in flight', async () => {
    await db.companyPlanTerm.update({ where: { companyId }, data: { tierKey: 'FREE_TRIAL_15', monthlySlipLimit: 0, termEndsAt: new Date(0) } });
    const input = { companyId, sourceRoute: 'receipt-ocr-line' as const, requestId: 'upgrade-in-flight', monthKey: '2026-11' };
    const admitted = await admitCompanyOcr(prisma, input);
    assert.ok(admitted.allowed);
    await db.companyPlanTerm.update({ where: { companyId }, data: { tierKey: 'STARTER_249', monthlySlipLimit: 30, termEndsAt: new Date('2099-01-01') } });
    const complete = await completeCompanyOcrAdmission(prisma, { ...input, eventId: admitted.eventId });
    assert.equal(complete.freeAllowance?.monthKey, '2026-11');
    assert.equal(complete.freeAllowance?.usedCount, 1);
    await releaseCompanyOcrAdmission(prisma, { ...input, eventId: admitted.eventId });
    assert.equal((await db.companyOcrUsageEvent.findUniqueOrThrow({ where: { id: admitted.eventId } })).quotaSource, 'FREE_MONTHLY_3');
    assert.equal((await receiptQuotaSnapshot(prisma, companyId, '2026-11')).usedCount, 0);
  });

  it('rolls back a failed terminal write and refund when its outbox fails, then recovers them together', async () => {
    await db.companyPlanTerm.update({ where: { companyId }, data: { tierKey: 'FREE_TRIAL_15', monthlySlipLimit: 0, termEndsAt: new Date(0) } });
    const input = { companyId, sourceRoute: 'receipt-capture-web' as const, requestId: 'terminal-refund', monthKey: '2026-10' };
    const admission = await admitCompanyOcr(prisma, input);
    assert.ok(admission.allowed);
    const job = await db.expenseCaptureReadJob.create({ data: {
      companyId, ownerType: 'EXPENSE', attachmentId: 'synthetic-attachment', attachmentChecksum: 'synthetic-checksum',
      ocrAdmissionRequestId: input.requestId, status: 'READING', leaseOwner: 'runner-1', manifestJson: {},
    } });
    const capture = new PrismaExpenseCaptureRepository(prisma);
    const failedOutbox = new OutboxAppendService({ append: async () => { throw new Error('synthetic-outbox-down'); } } as any, { error: () => undefined } as any);
    const runner = (outbox: OutboxAppendService) => new ExpenseCaptureReadRunnerService(capture, null!, null!, null!, null!, null!, outbox, null!, prisma, null!, null!);
    const checkpoint = { version: 1, pages: {}, windows: {}, chunks: {}, ocrEventId: admission.eventId, ocrQuotaSource: 'FREE_MONTHLY_3' };
    await assert.rejects((runner(failedOutbox) as any).finish(job, 'runner-1', { status: 'FAILED' }, checkpoint), /synthetic-outbox-down/);
    assert.equal((await db.expenseCaptureReadJob.findUniqueOrThrow({ where: { id: job.id } })).status, 'READING');
    assert.ok(await db.companyOcrUsageEvent.findUnique({ where: { id: admission.eventId } }));
    const outbox = new OutboxAppendService(new PrismaOutboxRepository(prisma), { error: () => undefined } as any);
    await (runner(outbox) as any).finish(job, 'runner-1', { status: 'FAILED' }, checkpoint);
    assert.equal((await db.expenseCaptureReadJob.findUniqueOrThrow({ where: { id: job.id } })).status, 'FAILED');
    assert.equal(await db.companyOcrUsageEvent.findUnique({ where: { id: admission.eventId } }), null);
    assert.equal(await db.outboxEvent.count({ where: { companyId, aggregateId: job.id } }), 1);
  });

  it('refuses a first worker admission after suspension instead of falling into the legacy shadow allowance', async () => {
    const beforeHold = await admitCompanyOcr(prisma, { companyId, sourceRoute: 'receipt-capture-web', requestId: 'admitted-before-hold', enforceReceiptQuota: false });
    assert.ok(beforeHold.allowed);
    await db.company.update({ where: { id: companyId }, data: { status: 'SUSPENDED' } });
    const resumed = await admitCompanyOcr(prisma, { companyId, sourceRoute: 'receipt-capture-web', requestId: 'admitted-before-hold', enforceReceiptQuota: false });
    assert.deepEqual(resumed, { allowed: false, reason: 'plan_inactive' });
    const admission = await admitCompanyOcr(prisma, { companyId, sourceRoute: 'receipt-capture-web', requestId: 'suspended-before-first-admission', enforceReceiptQuota: false });
    assert.deepEqual(admission, { allowed: false, reason: 'plan_inactive' });
    await db.company.update({ where: { id: companyId }, data: { status: 'ACTIVE' } });
    await db.companyPlanTerm.update({ where: { companyId }, data: { tierKey: 'STARTER_249', termEndsAt: new Date(0) } });
    const expiredPaid = await admitCompanyOcr(prisma, { companyId, sourceRoute: 'receipt-capture-web', requestId: 'expired-paid-before-admission', enforceReceiptQuota: false });
    assert.deepEqual(expiredPaid, { allowed: false, reason: 'plan_inactive' });
  });

  it('reads three normal mocked receipts inside the unchanged no-package default OCR budget', async (t) => {
    const defaults = apiConfigSchema.pick({ AI_MONTHLY_BUDGET_SATANG: true, AI_MONTHLY_BUDGET_SATANG_CEILING: true,
      AI_THB_PER_USD: true, AI_OCR_MAX_PER_COMPANY: true, AI_RATE_LIMIT_WINDOW_SECONDS: true, APPROVED_AI_MODEL_IDS: true }).parse({});
    const policy = resolveAiBudgetPolicy({ row: null, totalSatang: defaults.AI_MONTHLY_BUDGET_SATANG, override: false, monthKey: bangkokMonthKey() });
    assert.equal(policy.mode, 'SHARED');
    assert.equal(policy.totalSatang, 200_000);
    assert.equal(policy.ocrCapSatang, null);
    assert.equal(await db.companyAiConfiguration.count({ where: { companyId } }), 0, 'signup has no AI budget grant');
    assert.equal(await db.platformAiBudgetConfig.count(), 0, 'isolated fixture inherits schema defaults');
    await db.companyPlanTerm.update({ where: { companyId }, data: { tierKey: 'FREE_TRIAL_15', termEndsAt: new Date(0), monthlySlipLimit: 0 } });
    // Prior scenarios own historical quota evidence; readiness starts with a fresh current-month allowance.
    const currentMonth = bangkokMonthKey();
    await db.companyOcrUsageEvent.deleteMany({ where: { companyId, monthKey: currentMonth } });
    await db.companyOcrMonthlyUsage.deleteMany({ where: { companyId, monthKey: currentMonth } });
    __resetCompanyAiBudgetCache(); __resetFxCache();
    let providerCalls = 0, leases = 0, releases = 0;
    const rateLimits = {
      consume: async (_scope: string, _key: string, limit: number, window: number) => {
        assert.equal(limit, defaults.AI_OCR_MAX_PER_COMPANY); assert.equal(window, defaults.AI_RATE_LIMIT_WINDOW_SECONDS);
        return { allowed: true };
      },
      tryAcquireLease: async () => ({ acquired: true, token: `synthetic-${++leases}` }),
      releaseLease: async () => { releases += 1; },
    } as any;
    const config = { aiGatewayInternalUrl: 'http://synthetic-gateway.invalid', aiGatewayInternalSecret: 'synthetic', isProduction: false,
      approvedAiModelIds: defaults.APPROVED_AI_MODEL_IDS.split(','), aiMonthlyBudgetSatang: defaults.AI_MONTHLY_BUDGET_SATANG,
      aiMonthlyBudgetSatangCeiling: defaults.AI_MONTHLY_BUDGET_SATANG_CEILING, aiThbPerUsd: defaults.AI_THB_PER_USD,
      aiOcrMaxPerCompany: defaults.AI_OCR_MAX_PER_COMPANY, aiRateLimitWindowSeconds: defaults.AI_RATE_LIMIT_WINDOW_SECONDS,
      receiptQuotaEnforced: false } as any;
    const client = new ReceiptOcrClient(config, rateLimits, prisma);
    const originalFetch = globalThis.fetch;
    const usage = [
      { tag: 'receipt-classify', modelId: config.approvedAiModelIds[0], ok: true, inputTokens: 500, outputTokens: 100, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 },
      { tag: 'receipt-ocr', modelId: config.approvedAiModelIds[0], ok: true, inputTokens: 2000, outputTokens: 500, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 },
    ];
    globalThis.fetch = async (input, init) => {
      if (String(input) === 'https://open.er-api.com/v6/latest/USD') return new Response(JSON.stringify({ rates: { THB: defaults.AI_THB_PER_USD } }));
      assert.equal(String(input), 'http://synthetic-gateway.invalid/internal/ai/receipt-ocr');
      const wire = JSON.parse(String(init?.body));
      assert.equal(wire.companyId, companyId);
      assert.equal(wire.budgetEnvelope, undefined, 'existing SHARED policy uses its governed total lease, not a newly provisioned SPLIT grant');
      providerCalls += 1;
      return new Response(JSON.stringify({ status: 'ok', classification: { contentKind: 'DOCUMENT', documentFamily: 'EXPENSE_EVIDENCE', documentKind: 'RECEIPT', businessDirection: 'PURCHASE_EXPENSE', transactionState: 'PAID', confidence: 0.99, evidenceSignals: ['Synthetic shop'], amountSignals: ['100.00'], settlementSignals: ['paid 100.00'], evidenceRoles: ['EXPENSE_SUPPORT'], missingRequiredSignals: [], contradictionSignals: [], requiresClarification: false }, fields: { vendorName: 'Synthetic shop', grandTotalAmount: '100.00', confidence: 0.99, missingFields: [] }, usage }));
    };
    try {
      for (let index = 0; index < 3; index += 1) {
        let eventId: string | undefined;
        const requestId = `default-budget-${index}`;
        const response = await client.extract({ companyId, userId: 'synthetic-user', requestId,
          attachment: { id: `synthetic-${index}`, mimeType: 'image/jpeg', contentBase64: 'synthetic' } } as any,
          { onAdmitted: (identity) => { eventId = identity.eventId; assert.equal(identity.quotaSource, 'FREE_MONTHLY_3'); } });
        assert.equal(response.status, 'ok');
        assert.ok(eventId);
        await completeCompanyOcrAdmission(prisma, { companyId, sourceRoute: 'receipt-ocr-web', requestId, eventId });
      }
    } finally { globalThis.fetch = originalFetch; __resetCompanyAiBudgetCache(); __resetFxCache(); }
    assert.equal(providerCalls, 3); assert.equal(leases, 3); assert.equal(releases, 3);
    assert.equal((await freeExpenseAllowanceSnapshot(prisma, companyId)).usedCount, 3);
    const spend = await db.companyAiMonthlyUsage.findUniqueOrThrow({ where: { companyId_monthKey: { companyId, monthKey: currentMonth } } });
    assert.equal(spend.callCount, 6);
    assert.ok(spend.costSatang > 0 && spend.costSatang < defaults.AI_MONTHLY_BUDGET_SATANG);
    assert.equal(await db.aiUsageEvent.count({ where: { companyId, budgetBucket: 'CHAT' } }), 0);
    assert.equal(await db.companyAiMonthlyBucketUsage.count({ where: { companyId, bucket: 'CHAT' } }), 0);
    assert.equal(await db.aiUsageEvent.count({ where: { companyId, budgetBucket: 'OCR' } }), 6);
    assert.equal(await db.companyAiConfiguration.count({ where: { companyId } }), 0, 'no CHAT grant, total override or preset rewrite');
    t.diagnostic(`Default total ${defaults.AI_MONTHLY_BUDGET_SATANG} satang; three receipts/two mocked calls each spent ${spend.costSatang} satang in OCR only.`);
  });

});
