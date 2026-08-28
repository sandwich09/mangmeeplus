import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { resolveDeploymentIdentity } from '@watchdog-bms/config';
import { PrismaClient } from '../../../generated/prisma/client';
import type { RequestContext, ResolveTransactionTaxPreviewDto } from '@watchdog-bms/contracts';
import { PrismaAccountingRepository } from './prisma-accounting.repository.js';
import { PrismaDocumentSequenceRepository } from '../../data-model-core/infrastructure/repositories/prisma-document-sequence.repository.js';
import { IncomeExpenseLedgerUseCase } from '../application/use-cases/income-expense-ledger.use-case.js';
import { LaunchGateGuardService } from '../../feature-launch/application/launch-gate.guard.js';
import { exclusiveLaunchGateLock } from '../../feature-launch/application/launch-gate-lock.js';
import { assertSalesDocumentSourceMutationInTransaction } from '../application/sales-document-launch-gate.js';
import {
  FEATURE_TEMPORARILY_UNAVAILABLE,
  featureTemporarilyUnavailable,
} from '../../employee-access/application/entitlement.helper.js';

const updatedAt = new Date('2026-07-15T10:00:00.000Z');

const preview: ResolveTransactionTaxPreviewDto = {
  snapshot: {
    taxCodeDefinitionId: 'tax-o1', externalTaxCode: 'O1', taxProfileKey: 'SAP_S4_TH_CURRENT', taxProfileVersion: 1,
    roundingMode: 'HALF_EVEN', roundingScale: 3, taxAmountTolerance: '0.005',
    taxRegime: 'VAT', taxDirection: 'OUTPUT', taxTreatment: 'STANDARD', taxContext: 'DOMESTIC_SALE', taxRate: '7',
    sourceCurrency: 'THB', taxCurrency: 'THB', exchangeRate: '1', exchangeRateSource: 'FUNCTIONAL_CURRENCY',
    exchangeRateDate: '2026-07-15', taxBaseAmount: '100.00', taxAmount: '7.00', claimability: 'NOT_APPLICABLE',
    evidenceStatus: 'VERIFIED', accountRuleVersion: 1, reportRuleVersion: 1,
  },
  components: [{
    componentKey: 'VAT', snapshot: undefined as never, accountRole: 'OUTPUT_VAT_PAYABLE', accountId: 'account-vat',
    accountAssignments: [{ accountRole: 'OUTPUT_VAT_PAYABLE', accountId: 'account-vat', postingSide: 'CREDIT', ruleVersion: 1 }],
    reportContributions: [{ formType: 'PP30', boxKey: 'box_5_output_tax', amount: '7.00', amountSource: 'TAX_AMOUNT' }],
  }],
  accountRole: 'OUTPUT_VAT_PAYABLE', accountId: 'account-vat',
  reportContributions: [{ formType: 'PP30', boxKey: 'box_5_output_tax', amount: '7.00', amountSource: 'TAX_AMOUNT' }],
  warnings: [], errors: [], sourceChecksum: 'source-checksum', configurationChecksum: 'configuration-checksum',
};
preview.components[0]!.snapshot = preview.snapshot;

function documentRow(outputTaxCode: 'O7' | null = null) {
  return {
    id: 'doc-1', companyId: 'company-1', branchId: null, documentType: 'TAX_INVOICE', documentNumber: null,
    status: 'DRAFT', documentDate: new Date('2026-07-15T00:00:00.000Z'), dueDate: null, counterpartyId: null,
    counterpartySnapshotJson: null, sourceDocumentId: null, sourceDocumentType: null, convertedFromDocumentId: null,
    currency: 'THB', vatMode: 'VAT_EXCLUDED', outputTaxCode, subtotalAmount: '100', discountAmount: '0',
    taxableAmount: '100', vatAmount: '7', whtAmount: '0', grandTotalAmount: '107', paidAmount: '0', outstandingAmount: '107',
    unappliedCreditAmount: null, paymentStatus: 'UNPAID', taxStatus: null, taxInvoiceType: null, taxInvoiceId: null,
    postingStatus: 'not_required', journalEntryId: null, postingError: null, note: null, internalMemo: null,
    issuedByUserId: null, issuedAt: null, voidedByUserId: null, voidedAt: null, voidReason: null,
    approvalStatus: null, submittedByUserId: null, submittedAt: null, approvedByUserId: null, approvedAt: null,
    rejectedByUserId: null, rejectedAt: null, approvalNote: null, createdByUserId: 'creator-1', updatedByUserId: null,
    createdAt: new Date('2026-07-15T09:00:00.000Z'), updatedAt,
    lines: [{
      id: 'line-1', companyId: 'company-1', documentId: 'doc-1', lineNumber: 1, productId: null, skuSnapshot: null,
      description: 'Taxable service', unitName: null, quantity: '1', unitPrice: '100', discountAmount: '0',
      vatRate: '7', vatAmount: '7', whtRate: null, whtAmount: '0', lineSubtotalAmount: '100', lineTotalAmount: '107',
      taxCategory: null, revenueCategory: null, taxCodeDefinitionId: 'draft-tax', externalTaxCodeSnapshot: 'O1',
      taxProfileKeySnapshot: 'SAP_S4_TH_CURRENT', taxProfileVersionSnapshot: 1, taxRegimeSnapshot: 'VAT',
      roundingModeSnapshot: null as string | null, roundingScaleSnapshot: null as number | null, taxAmountToleranceSnapshot: null as string | null,
      taxDirectionSnapshot: 'OUTPUT', taxTreatmentSnapshot: 'STANDARD', taxContextSnapshot: 'DOMESTIC_SALE',
      taxRateSnapshot: '7', sourceCurrencySnapshot: 'THB', taxCurrencySnapshot: 'THB', exchangeRateSnapshot: '1',
      exchangeRateSourceSnapshot: 'FUNCTIONAL_CURRENCY', exchangeRateDateSnapshot: new Date('2026-07-15T00:00:00.000Z'),
      taxBaseAmount: '100', transactionTaxAmount: '7', claimabilitySnapshot: 'NOT_APPLICABLE', accountRuleVersionSnapshot: 1,
      reportRuleVersionSnapshot: 1, taxEvidenceReviewStatus: 'REVIEW_REQUIRED', taxComponentsJson: [], accountAssignmentsJson: [],
      createdAt: new Date('2026-07-15T09:00:00.000Z'), updatedAt,
    }],
  };
}

function harness(options: { lockedTax?: boolean; failIssueUpdate?: boolean; outputTaxCode?: 'O7'; source?: ReturnType<typeof documentRow> } = {}) {
  const state = { document: documentRow(options.outputTaxCode ?? null) };
  const client = {
    $transaction: async (work: (tx: any) => Promise<unknown>) => {
      const draft = structuredClone(state);
      const tx = {
        $executeRaw: async () => 0,
        accountingDocument: {
          findFirst: async ({ where }: any) => where.companyId !== draft.document.companyId ? null
            : where.id === draft.document.id ? draft.document : where.id === options.source?.id ? options.source : null,
          findFirstOrThrow: async () => draft.document,
          findMany: async () => [],
          updateMany: async ({ where, data }: any) => {
            if (options.failIssueUpdate || where.status !== draft.document.status || where.updatedAt?.getTime() !== draft.document.updatedAt.getTime()) return { count: 0 };
            Object.assign(draft.document, data, { updatedAt: new Date('2026-07-15T10:01:00.000Z') });
            return { count: 1 };
          },
        },
        accountingDocumentLine: {
          updateMany: async ({ where, data }: any) => {
            const line = draft.document.lines.find((item) => item.id === where.id);
            if (!line || line.updatedAt.getTime() !== where.updatedAt.getTime()) return { count: 0 };
            Object.assign(line, data, { updatedAt: new Date('2026-07-15T10:00:30.000Z') });
            return { count: 1 };
          },
        },
        accountingPeriod: { findUnique: async () => ({ status: 'OPEN' }) },
        taxPeriod: { findFirst: async () => options.lockedTax ? { status: 'FILED' } : null },
      };
      const result = await work(tx);
      state.document = draft.document;
      return result;
    },
  };
  return { state, repo: new PrismaAccountingRepository({ client } as any) };
}

const finalizer = async () => [{ lineId: 'line-1', preview }];

describe('atomic accounting tax issue', () => {
  it('issues a linked receipt as paid evidence without posting the already-recorded payment twice', async () => {
    const source = documentRow();
    Object.assign(source, { id: 'source-invoice', documentType: 'INVOICE', status: 'ISSUED', paymentStatus: 'PAID', paidAmount: '107', outstandingAmount: '0', lines: [] });
    const { repo, state } = harness({ source });
    Object.assign(state.document, { documentType: 'RECEIPT', sourceDocumentId: source.id, sourceDocumentType: 'INVOICE', lines: [] });
    const result = await repo.issueDocument('company-1', 'doc-1', 'REC-001', 'issuer-1', 'RECEIPT', undefined, 'DRAFT', updatedAt);
    assert.equal(result.document.paymentStatus, 'PAID');
    assert.equal(result.document.paidAmount, '107');
    assert.equal(Number(result.document.outstandingAmount), 0);
    assert.equal(result.document.postingStatus, 'not_required');
    assert.deepEqual(result.taxPreviews, []);
  });

  it('rejects an O7 compatibility header over an authoritative S/4HANA O1 line before finalization', async () => {
    const { repo, state } = harness({ outputTaxCode: 'O7' });
    let finalized = false;
    await assert.rejects(
      () => repo.issueDocument('company-1', 'doc-1', 'TAX-001', 'issuer-1', 'TAX_INVOICE', undefined, 'DRAFT', updatedAt, async () => {
        finalized = true;
        return finalizer();
      }),
      (error: any) => error.getResponse?.().message === 'output_tax_code_line_mismatch',
    );
    assert.equal(finalized, false);
    assert.equal(state.document.status, 'DRAFT');
  });

  it('issues once and rejects a concurrent stale retry', async () => {
    const { repo, state } = harness();
    const first = await repo.issueDocument('company-1', 'doc-1', 'TAX-001', 'issuer-1', 'TAX_INVOICE', undefined, 'DRAFT', updatedAt, finalizer);
    assert.equal(first.document.status, 'ISSUED');
    assert.equal(state.document.lines[0]!.taxEvidenceReviewStatus, 'VERIFIED');
    assert.deepEqual([
      state.document.lines[0]!.roundingModeSnapshot,
      state.document.lines[0]!.roundingScaleSnapshot,
      state.document.lines[0]!.taxAmountToleranceSnapshot,
    ], ['HALF_EVEN', 3, '0.005']);
    assert.deepEqual([
      first.document.lines?.[0]?.taxSnapshot?.roundingMode,
      first.document.lines?.[0]?.taxSnapshot?.roundingScale,
      first.document.lines?.[0]?.taxSnapshot?.taxAmountTolerance,
    ], ['HALF_EVEN', 3, '0.005']);
    await assert.rejects(
      () => repo.issueDocument('company-1', 'doc-1', 'TAX-002', 'issuer-2', 'TAX_INVOICE', undefined, 'DRAFT', updatedAt, finalizer),
      (error: any) => error.getResponse?.().code === 'accounting_document_changed',
    );
  });

  it('keeps resolver rounding policy in draft and inherited snapshot writes', async () => {
    const writes: any[] = [];
    const client = {
      accountingDocumentLine: { updateMany: async (query: any) => { writes.push(query.data); return { count: 1 }; } },
      $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
    };
    const repo = new PrismaAccountingRepository({ client } as any);
    await repo.saveLineTaxSnapshots('company-1', 'doc-1', [{ lineId: 'line-1', preview }]);
    await repo.saveInheritedLineTaxSnapshots('company-1', 'doc-2', [{ lineId: 'line-2', snapshot: preview.snapshot, components: preview.components }]);
    assert.deepEqual(writes.map((data) => [data.roundingModeSnapshot, data.roundingScaleSnapshot, data.taxAmountToleranceSnapshot]), [
      ['HALF_EVEN', 3, '0.005'], ['HALF_EVEN', 3, '0.005'],
    ]);
  });

  it('rolls back line snapshots when the final status CAS fails', async () => {
    const { repo, state } = harness({ failIssueUpdate: true });
    await assert.rejects(() => repo.issueDocument('company-1', 'doc-1', 'TAX-001', 'issuer-1', 'TAX_INVOICE', undefined, 'DRAFT', updatedAt, finalizer));
    assert.equal(state.document.status, 'DRAFT');
    assert.equal(state.document.lines[0]!.taxCodeDefinitionId, 'draft-tax');
    assert.equal(state.document.lines[0]!.taxEvidenceReviewStatus, 'REVIEW_REQUIRED');
  });

  it('rejects a filed tax period before finalizing or mutating snapshots', async () => {
    const { repo, state } = harness({ lockedTax: true });
    let finalized = false;
    await assert.rejects(
      () => repo.issueDocument('company-1', 'doc-1', 'TAX-001', 'issuer-1', 'TAX_INVOICE', undefined, 'DRAFT', updatedAt, async () => {
        finalized = true;
        return finalizer();
      }),
      (error: any) => error.getResponse?.().code === 'tax_period_locked',
    );
    assert.equal(finalized, false);
    assert.equal(state.document.status, 'DRAFT');
    assert.equal(state.document.lines[0]!.taxEvidenceReviewStatus, 'REVIEW_REQUIRED');
  });
});

function rootDatabaseUrl(): string | null {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const candidate of [join(process.cwd(), '.env'), join(process.cwd(), '../.env'), join(process.cwd(), '../../.env')]) {
    try {
      const match = /^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m.exec(readFileSync(candidate, 'utf8'));
      if (match?.[1]) return match[1];
    } catch {
      // Keep walking toward the workspace root.
    }
  }
  return null;
}

const requireP27Postgres = process.env.P27_REQUIRE_POSTGRES === 'true';

const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function pauseAfterFirstAdvisoryLock(
  client: PrismaClient,
  onLocked: () => void,
  continueAfter: Promise<void>,
  pauseAtLock = 1,
): any {
  return {
    $transaction: (work: (tx: any) => Promise<unknown>, options?: unknown) => (client as any).$transaction(async (tx: any) => {
      let lockCount = 0;
      const wrapped = new Proxy(tx, {
        get(target, property) {
          if (property === '$executeRaw') {
            return async (...args: unknown[]) => {
              const result = await target.$executeRaw(...args);
              lockCount += 1;
              if (lockCount === pauseAtLock) {
                onLocked();
                await continueAfter;
              }
              return result;
            };
          }
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      return work(wrapped);
    }, options),
  };
}

function assertExpectedBusinessRejection(error: any, expectedCode?: string): void {
  assert.notEqual(error?.code, '40P01', 'PostgreSQL deadlock must never decide the lifecycle race');
  assert.notEqual(error?.code, 'P2034', 'Prisma transaction conflict must not leak from the lifecycle race');
  assert.doesNotMatch(String(error?.message ?? error), /deadlock/i);
  if (expectedCode) assert.equal(error?.getResponse?.().code, expectedCode);
  else assert.equal(error?.getStatus?.(), 422);
}

describe('P27 sales-root launch gate race (real database)', () => {
  const tag = `sales-root-race-${process.pid}-${randomUUID()}`;
  const gateKey = `${tag}-gate`;
  const routeKey = 'DEFAULT';
  const deployment = resolveDeploymentIdentity(process.env);
  let raceClients: PrismaClient[] = [];
  let guards: LaunchGateGuardService[] = [];
  let raceCompanyId = '';
  let raceUserId = '';
  const raceBranchId = `${tag}-branch`;
  let reachable = false;

  async function resetOpen(): Promise<void> {
    await raceClients[0]!.accountingCounterparty.deleteMany({ where: { companyId: raceCompanyId } });
    await raceClients[0]!.featureLaunchGateTransition.deleteMany({ where: { gateKey, routeKey } });
    await raceClients[0]!.featureLaunchGate.upsert({
      where: { gateKey_routeKey: { gateKey, routeKey } },
      create: { gateKey, routeKey, state: 'OPEN', generation: 1, lastSeq: 1 },
      update: { state: 'OPEN', generation: 1, lastSeq: 1 },
    });
    await raceClients[0]!.featureLaunchGateTransition.create({
      data: {
        gateKey, routeKey, seq: 1, generation: 1, commandId: `${tag}-open`, action: 'OPEN',
        actorUserId: 'SYSTEM', payloadFingerprint: tag,
        targetEnvironment: deployment.targetEnvironment, buildReleaseId: deployment.buildReleaseId,
        expectedGeneration: 0, routeClass: 'ORDINARY',
      },
    });
  }

  before(async () => {
    const url = rootDatabaseUrl();
    if (!url) {
      if (requireP27Postgres) throw new Error('P27 PostgreSQL is required but DATABASE_URL is unavailable');
      return;
    }
    try {
      raceClients = [
        new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }),
        new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }),
      ];
      await raceClients[0]!.$queryRaw`SELECT 1`;
      reachable = true;
    } catch (error) {
      reachable = false;
      if (requireP27Postgres) throw error;
      return;
    }
    raceCompanyId = (await raceClients[0]!.company.create({ data: { name: tag, status: 'ACTIVE' }, select: { id: true } })).id;
    raceUserId = (await raceClients[0]!.user.create({ data: { displayName: tag }, select: { id: true } })).id;
    await raceClients[0]!.branch.create({ data: { id: raceBranchId, companyId: raceCompanyId, code: 'HO', name: 'Source branch', type: 'HEAD_OFFICE', createdByUserId: raceUserId } });
    guards = raceClients.map((client) => new LaunchGateGuardService({ client } as any));
  });

  after(async () => {
    if (!reachable) return;
    await raceClients[0]!.featureLaunchGateTransition.deleteMany({ where: { gateKey, routeKey } });
    await raceClients[0]!.featureLaunchGate.deleteMany({ where: { gateKey, routeKey } });
    await raceClients[0]!.company.deleteMany({ where: { id: raceCompanyId } });
    await raceClients[0]!.user.deleteMany({ where: { id: raceUserId } });
    await Promise.all(raceClients.map((client) => client.$disconnect()));
  });

  it('ROOT-FIRST — root commits while CLOSE waits, then CLOSE wins the next generation', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    await resetOpen();
    let releaseRoot!: () => void;
    const holdRoot = new Promise<void>((resolve) => { releaseRoot = resolve; });
    let rootGuarded!: () => void;
    const guarded = new Promise<void>((resolve) => { rootGuarded = resolve; });

    const root = raceClients[0]!.$transaction(async (tx) => {
      await guards[0]!.assertLaunchRouteOpenInTransaction(tx, gateKey, routeKey);
      await tx.accountingCounterparty.create({
        data: { companyId: raceCompanyId, type: 'CUSTOMER', displayName: `${tag}-root-first`, createdByUserId: raceUserId },
      });
      rootGuarded();
      await holdRoot;
    });
    await guarded;

    let closeCommitted = false;
    const close = raceClients[1]!.$transaction(async (tx) => {
      await tx.$executeRaw(exclusiveLaunchGateLock(gateKey, routeKey));
      await tx.featureLaunchGate.update({
        where: { gateKey_routeKey: { gateKey, routeKey } },
        data: { state: 'CLOSED', generation: 2, lastSeq: 2 },
      });
    }).then(() => { closeCommitted = true; });
    await pause(75);
    assert.equal(closeCommitted, false, 'exclusive CLOSE must wait behind the root shared lock');
    releaseRoot();
    await Promise.all([root, close]);

    assert.equal(await raceClients[0]!.accountingCounterparty.count({ where: { companyId: raceCompanyId } }), 1);
    assert.equal((await raceClients[0]!.featureLaunchGate.findUniqueOrThrow({
      where: { gateKey_routeKey: { gateKey, routeKey } },
    })).state, 'CLOSED');
  });

  it('CLOSE-FIRST — root waits, observes CLOSED, and commits no mutation', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    await resetOpen();
    let releaseClose!: () => void;
    const holdClose = new Promise<void>((resolve) => { releaseClose = resolve; });
    let closeLocked!: () => void;
    const locked = new Promise<void>((resolve) => { closeLocked = resolve; });

    const close = raceClients[1]!.$transaction(async (tx) => {
      await tx.$executeRaw(exclusiveLaunchGateLock(gateKey, routeKey));
      await tx.featureLaunchGate.update({
        where: { gateKey_routeKey: { gateKey, routeKey } },
        data: { state: 'CLOSED', generation: 2, lastSeq: 2 },
      });
      closeLocked();
      await holdClose;
    });
    await locked;

    let rootSettled = false;
    const root = raceClients[0]!.$transaction(async (tx) => {
      await guards[0]!.assertLaunchRouteOpenInTransaction(tx, gateKey, routeKey);
      await tx.accountingCounterparty.create({
        data: { companyId: raceCompanyId, type: 'CUSTOMER', displayName: `${tag}-close-first`, createdByUserId: raceUserId },
      });
    }).then(
      () => ({ ok: true as const, error: undefined }),
      (error: unknown) => ({ ok: false as const, error }),
    ).finally(() => { rootSettled = true; });
    await pause(75);
    assert.equal(rootSettled, false, 'shared root check must wait behind the exclusive CLOSE lock');
    releaseClose();
    await close;
    const outcome = await root;
    assert.equal(outcome.ok, false);
    assert.equal((outcome.error as any)?.getResponse?.().code, FEATURE_TEMPORARILY_UNAVAILABLE);
    assert.equal(await raceClients[0]!.accountingCounterparty.count({ where: { companyId: raceCompanyId } }), 0);
  });

  it('replays an idempotent invoice create without consulting a later-closed route', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const repo = new PrismaAccountingRepository({ client: raceClients[0]! } as any);
    const input = {
      companyId: raceCompanyId, branchId: raceBranchId,
      documentType: 'INVOICE' as const,
      documentDate: '2026-08-27',
      idempotencyKey: `${tag}-invoice-replay`,
      payloadFingerprint: `${tag}-fingerprint`,
      vatMode: 'NO_VAT' as const,
      createdByUserId: raceUserId,
      lines: [{ lineNumber: 1, description: 'Replay proof', quantity: '1', unitPrice: '100.00' }],
    };
    const first = await repo.createDocument(input, async () => undefined);
    let gateCalls = 0;
    const replay = await repo.createDocument(input, async () => {
      gateCalls += 1;
      throw featureTemporarilyUnavailable('sales_documents');
    });
    assert.equal(replay.id, first.id);
    assert.equal(gateCalls, 0);
  });

  it('blocks simple income when CLOSE commits after the replay read but before the shared gate lock', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    await resetOpen();
    const repo = new PrismaAccountingRepository(
      { client: raceClients[0]! } as any,
      new PrismaDocumentSequenceRepository({ client: raceClients[0]! } as any),
    );
    let releaseGate!: () => void;
    const mayCheckGate = new Promise<void>((resolve) => { releaseGate = resolve; });
    let reachedAfterReplayRead!: () => void;
    const afterReplayRead = new Promise<void>((resolve) => { reachedAfterReplayRead = resolve; });
    const idempotencyKey = `${tag}-simple-close-gap`;
    const mutation = repo.recordSimpleIncomeBundle({
      companyId: raceCompanyId, branchId: raceBranchId,
      idempotencyKey,
      payloadFingerprint: `${tag}-simple-fingerprint`,
      documentDate: '2026-08-27',
      vatMode: 'NO_VAT',
      paymentMethod: 'BANK_TRANSFER',
      note: idempotencyKey,
      lines: [{ lineNumber: 1, description: idempotencyKey, quantity: '1', unitPrice: '100.00' }],
      createdByUserId: raceUserId,
    }, async () => undefined, async (tx) => {
      reachedAfterReplayRead();
      await mayCheckGate;
      await guards[0]!.assertLaunchRouteOpenInTransaction(tx, gateKey, routeKey);
    });
    await afterReplayRead;
    await raceClients[1]!.$transaction(async (tx) => {
      await tx.$executeRaw(exclusiveLaunchGateLock(gateKey, routeKey));
      await tx.featureLaunchGate.update({
        where: { gateKey_routeKey: { gateKey, routeKey } },
        data: { state: 'CLOSED', generation: 2, lastSeq: 2 },
      });
    });
    releaseGate();
    await assert.rejects(
      () => mutation,
      (error: any) => error.getResponse?.().code === FEATURE_TEMPORARILY_UNAVAILABLE,
    );
    assert.equal(await raceClients[0]!.accountingSimpleIncomeCommand.count({ where: { companyId: raceCompanyId, idempotencyKey } }), 0);
    assert.equal(await raceClients[0]!.accountingDocument.count({ where: { companyId: raceCompanyId, note: idempotencyKey } }), 0);
  });

  it('blocks quotation conversion when CLOSE commits after optimistic reads but before the gate lock', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    await resetOpen();
    const repo = new PrismaAccountingRepository({ client: raceClients[0]! } as any);
    const source = await raceClients[0]!.accountingDocument.create({
      data: {
        companyId: raceCompanyId, branchId: raceBranchId, documentType: 'QUOTATION', status: 'ISSUED', documentNumber: `QT-${randomUUID()}`,
        documentDate: new Date('2026-08-27T00:00:00.000Z'), currency: 'THB', vatMode: 'NO_VAT',
        subtotalAmount: '100', taxableAmount: '100', grandTotalAmount: '100', outstandingAmount: '100',
        paymentStatus: 'UNPAID', createdByUserId: raceUserId,
        lines: { create: [{ lineNumber: 1, description: 'Conversion gate race', quantity: '1', unitPrice: '100', lineSubtotalAmount: '100', lineTotalAmount: '100' }] },
      },
    });
    let releaseGate!: () => void;
    const mayCheckGate = new Promise<void>((resolve) => { releaseGate = resolve; });
    let reachedAfterOptimisticRead!: () => void;
    const afterOptimisticRead = new Promise<void>((resolve) => { reachedAfterOptimisticRead = resolve; });
    const mutation = repo.convertQuotation(source.id, source.updatedAt, {
      companyId: raceCompanyId, branchId: raceBranchId,
      documentType: 'INVOICE',
      documentDate: '2026-08-27',
      convertedFromDocumentId: source.id,
      vatMode: 'NO_VAT',
      lines: [{ lineNumber: 1, description: 'Converted invoice', quantity: '1', unitPrice: '100.00' }],
      createdByUserId: raceUserId,
    }, raceUserId, async (tx) => {
      reachedAfterOptimisticRead();
      await mayCheckGate;
      await guards[0]!.assertLaunchRouteOpenInTransaction(tx, gateKey, routeKey);
    });
    await afterOptimisticRead;
    await raceClients[1]!.$transaction(async (tx) => {
      await tx.$executeRaw(exclusiveLaunchGateLock(gateKey, routeKey));
      await tx.featureLaunchGate.update({
        where: { gateKey_routeKey: { gateKey, routeKey } },
        data: { state: 'CLOSED', generation: 2, lastSeq: 2 },
      });
    });
    releaseGate();
    await assert.rejects(
      () => mutation,
      (error: any) => error.getResponse?.().code === FEATURE_TEMPORARILY_UNAVAILABLE,
    );
    assert.equal((await raceClients[0]!.accountingDocument.findUniqueOrThrow({ where: { id: source.id } })).status, 'ISSUED');
    assert.equal(await raceClients[0]!.accountingDocument.count({ where: { companyId: raceCompanyId, convertedFromDocumentId: source.id } }), 0);
  });
});

describe('P27 simple-income bundle (real PostgreSQL when available)', () => {
  const companyId = `p27-simple-${process.pid}`;
  const branchId = `${companyId}-branch`;
  let client: PrismaClient | null = null;
  let repo: PrismaAccountingRepository | null = null;
  let reachable = false;

  before(async () => {
    const url = rootDatabaseUrl();
    if (!url) {
      if (requireP27Postgres) throw new Error('P27 PostgreSQL is required but DATABASE_URL is unavailable');
      return;
    }
    try {
      client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
      const [probe] = await client.$queryRaw<Array<{ command_table: string | null; payment_column: boolean }>>`
        SELECT
          to_regclass('"AccountingSimpleIncomeCommand"')::text AS command_table,
          EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'AccountingPayment' AND column_name = 'idempotencyKey'
          ) AS payment_column
      `;
      if (!probe?.command_table || !probe.payment_column) {
        if (requireP27Postgres) throw new Error('P27 PostgreSQL schema is missing required accounting migrations');
        return;
      }
      await client.accountingSimpleIncomeCommand.deleteMany({ where: { companyId } });
      await client.company.deleteMany({ where: { id: companyId } });
      await client.company.create({ data: { id: companyId, name: 'P27 simple-income test' } });
      await client.branch.create({ data: { id: branchId, companyId, code: 'HO', name: 'Source branch', type: 'HEAD_OFFICE', createdByUserId: 'p27-test-user' } });
      repo = new PrismaAccountingRepository(
        { client } as any,
        new PrismaDocumentSequenceRepository({ client } as any),
      );
      reachable = true;
    } catch (error) {
      reachable = false;
      if (requireP27Postgres) throw error;
    }
  });

  after(async () => {
    if (!client) return;
    if (reachable) {
      await client.accountingSimpleIncomeCommand.deleteMany({ where: { companyId } });
      await client.accountingPaymentAllocation.deleteMany({ where: { companyId } });
      await client.accountingPayment.deleteMany({ where: { companyId } });
      await client.accountingDocument.deleteMany({ where: { companyId } });
      await client.documentNumber.deleteMany({ where: { companyId } });
      await client.documentSequence.deleteMany({ where: { companyId } });
      await client.company.deleteMany({ where: { id: companyId } });
    }
    await client.$disconnect();
  });

  const input = (idempotencyKey: string, payloadFingerprint: string, note: string) => ({
    companyId, branchId, idempotencyKey, payloadFingerprint, documentDate: '2026-08-26', vatMode: 'NO_VAT' as const,
    paymentMethod: 'BANK_TRANSFER' as const, note,
    lines: [{ lineNumber: 1, description: note, quantity: '1', unitPrice: '100.00', whtRate: '3' }],
    createdByUserId: 'p27-test-user',
  });

  it('rolls back every row on a late failure, then gives one result to concurrent retries', async (t) => {
    if (!reachable || !client || !repo) return t.skip('local PostgreSQL or the P27 migration is unavailable');

    await assert.rejects(() => repo!.recordSimpleIncomeBundle(
      input('income-fail-0001', 'fingerprint-fail', `${companyId}-fail`),
      async () => { throw new Error('audit unavailable'); },
    ));
    assert.equal(await client.accountingSimpleIncomeCommand.count({ where: { companyId, idempotencyKey: 'income-fail-0001' } }), 0);
    assert.equal(await client.accountingDocument.count({ where: { companyId, note: `${companyId}-fail` } }), 0);
    assert.equal(await client.accountingPayment.count({ where: { companyId, note: `${companyId}-fail` } }), 0);

    const attempts = await Promise.all(Array.from({ length: 6 }, () => repo!.recordSimpleIncomeBundle(
      input('income-race-0001', 'fingerprint-race', `${companyId}-success`),
      async () => undefined,
    )));
    assert.equal(new Set(attempts.map((result) => result.invoice.id)).size, 1);
    assert.equal(attempts.filter((result) => !result.replayed).length, 1);
    const result = attempts[0]!;
    assert.equal(result.invoice.paymentStatus, 'PAID');
    assert.equal(Number(result.invoice.paidAmount), 100);
    assert.equal(Number(result.invoice.outstandingAmount), 0);
    assert.equal(Number(result.payment.amount), 97);
    assert.equal(Number(result.payment.whtAmount), 3);
    assert.equal(result.receipt.sourceDocumentId, result.invoice.id);
    assert.equal(result.receipt.postingStatus, 'not_required', 'auto-receipt must not post settlement twice');
    assert.equal(await client.accountingDocument.count({ where: { companyId } }), 2);
    assert.equal(await client.accountingPayment.count({ where: { companyId } }), 1);
    assert.equal(await client.accountingPaymentAllocation.count({ where: { companyId } }), 1);
    assert.equal(await client.accountingSimpleIncomeCommand.count({ where: { companyId } }), 1);
    assert.equal(await client.documentNumber.count({ where: { companyId, status: 'COMMITTED' } }), 3);

    let replayGateCalls = 0;
    const replay = await repo!.recordSimpleIncomeBundle(
      input('income-race-0001', 'fingerprint-race', `${companyId}-success`),
      async () => undefined,
      async () => {
        replayGateCalls += 1;
        throw new Error('a completed retry must not need the launch gate');
      },
    );
    assert.equal(replay.replayed, true);
    assert.equal(replay.invoice.id, result.invoice.id);
    assert.equal(replayGateCalls, 0);

    await assert.rejects(
      () => repo!.recordSimpleIncomeBundle(
        input('income-race-0001', 'different-fingerprint', `${companyId}-changed`),
        async () => undefined,
      ),
      (error: any) => error.getResponse?.().code === 'simple_income_idempotency_conflict',
    );
  });

  it('makes allocated payment retries at-most-once and prevents concurrent over-allocation', async (t) => {
    if (!reachable || !client || !repo) return t.skip('local PostgreSQL or the payment idempotency migration is unavailable');
    const makeInvoice = (note: string) => client!.accountingDocument.create({ data: {
      companyId, branchId, documentType: 'INVOICE', status: 'ISSUED', documentDate: new Date('2026-08-27T00:00:00.000Z'),
      currency: 'THB', vatMode: 'NO_VAT', subtotalAmount: '100', taxableAmount: '100', grandTotalAmount: '100',
      paidAmount: '0', outstandingAmount: '100', paymentStatus: 'UNPAID', note, createdByUserId: 'p27-test-user',
    } });
    const payment = (documentId: string, idempotencyKey: string, amount: string) => ({
      companyId, branchId, idempotencyKey, payloadFingerprint: `${idempotencyKey}:${amount}`, direction: 'RECEIVED' as const,
      method: 'BANK_TRANSFER' as const, amount, paidAt: '2026-08-27T10:00:00.000Z',
      allocateToDocumentId: documentId, createdByUserId: 'p27-test-user',
    });

    const retryInvoice = await makeInvoice(`${companyId}-payment-retry`);
    const retries = await Promise.all(Array.from({ length: 4 }, () => repo!.createPayment(
      payment(retryInvoice.id, 'payment-retry-0001', '100.00'),
    )));
    assert.equal(new Set(retries.map((result) => result.payment.id)).size, 1);
    assert.equal(retries.filter((result) => !result.replayed).length, 1);
    assert.equal(await client.accountingPaymentAllocation.count({ where: { companyId, documentId: retryInvoice.id } }), 1);

    const raceInvoice = await makeInvoice(`${companyId}-payment-race`);
    const race = await Promise.allSettled([
      repo.createPayment(payment(raceInvoice.id, 'payment-race-0001', '60.00')),
      repo.createPayment(payment(raceInvoice.id, 'payment-race-0002', '60.00')),
    ]);
    assert.equal(race.filter((result) => result.status === 'fulfilled').length, 2);
    const persisted = await client.accountingDocument.findUniqueOrThrow({ where: { id: raceInvoice.id } });
    assert.equal(Number(persisted.paidAmount), 100);
    assert.equal(Number(persisted.outstandingAmount), 0);
    const allocations = await client.accountingPaymentAllocation.findMany({ where: { companyId, documentId: raceInvoice.id } });
    assert.equal(allocations.reduce((total, row) => total + Number(row.amount), 0), 100);
    const racePaymentIds = race.flatMap((result) => result.status === 'fulfilled' ? [result.value.payment.id] : []);
    const payments = await client.accountingPayment.findMany({ where: { id: { in: racePaymentIds } } });
    assert.equal(payments.reduce((total, row) => total + Number(row.unappliedAmount), 0), 20);
  });

  it('keeps balances equal to active allocations when payment create races payment void in both orders', async (t) => {
    if (!reachable || !client || !repo) return t.skip('local PostgreSQL or the payment idempotency migration is unavailable');
    const createFixture = async (suffix: string) => {
      const invoice = await client!.accountingDocument.create({
        data: {
          companyId, branchId, documentType: 'INVOICE', documentNumber: `INV-${randomUUID()}`, status: 'ISSUED',
          documentDate: new Date('2026-08-27T00:00:00.000Z'), currency: 'THB', vatMode: 'NO_VAT',
          subtotalAmount: '100', taxableAmount: '100', grandTotalAmount: '100', paidAmount: '0',
          outstandingAmount: '100', paymentStatus: 'UNPAID', createdByUserId: 'p27-test-user',
        },
      });
      const first = await repo!.createPayment({
        companyId, branchId, idempotencyKey: `payment-void-race-first-${suffix}-${randomUUID()}`,
        payloadFingerprint: `payment-void-race-first-${suffix}`,
        direction: 'RECEIVED', method: 'BANK_TRANSFER', amount: '40.00', paidAt: '2026-08-27T10:00:00.000Z',
        allocateToDocumentId: invoice.id, createdByUserId: 'p27-test-user',
      });
      const secondInput = {
        companyId, branchId, idempotencyKey: `payment-void-race-second-${suffix}-${randomUUID()}`,
        payloadFingerprint: `payment-void-race-second-${suffix}`,
        direction: 'RECEIVED' as const, method: 'BANK_TRANSFER' as const, amount: '30.00', paidAt: '2026-08-27T11:00:00.000Z',
        allocateToDocumentId: invoice.id, createdByUserId: 'p27-test-user',
      };
      return { invoice, firstPaymentId: first.payment.id, secondInput };
    };
    const assertFinalBalance = async (invoiceId: string, firstPaymentId: string, secondPaymentId: string) => {
      const persisted = await client!.accountingDocument.findUniqueOrThrow({ where: { id: invoiceId } });
      assert.equal(Number(persisted.paidAmount), 30);
      assert.equal(Number(persisted.outstandingAmount), 70);
      const allocations = await client!.accountingPaymentAllocation.findMany({ where: { companyId, documentId: invoiceId } });
      assert.deepEqual(allocations.map((row) => row.paymentId), [secondPaymentId]);
      assert.equal(await client!.accountingPayment.findUniqueOrThrow({ where: { id: firstPaymentId } }).then((row) => row.status), 'VOIDED');
    };

    const createFirst = await createFixture('create-first');
    let releaseCreate!: () => void;
    const createMayContinue = new Promise<void>((resolve) => { releaseCreate = resolve; });
    let createLocked!: () => void;
    const createHasLifecycle = new Promise<void>((resolve) => { createLocked = resolve; });
    const pausedCreateClient = pauseAfterFirstAdvisoryLock(client, createLocked, createMayContinue, 2);
    const pausedCreateRepo = new PrismaAccountingRepository(
      { client: pausedCreateClient } as any,
      new PrismaDocumentSequenceRepository({ client: pausedCreateClient } as any),
    );
    const secondPaymentPromise = pausedCreateRepo.createPayment(createFirst.secondInput);
    await createHasLifecycle;
    let losingVoidSettled = false;
    const voidPromise = repo.voidPaymentTrueReversal(
      companyId, createFirst.firstPaymentId, 'p27-test-user', 'race proof',
    ).finally(() => { losingVoidSettled = true; });
    await pause(75);
    assert.equal(losingVoidSettled, false);
    releaseCreate();
    const secondPayment = await secondPaymentPromise;
    await voidPromise;
    await assertFinalBalance(createFirst.invoice.id, createFirst.firstPaymentId, secondPayment.payment.id);

    const voidFirst = await createFixture('void-first');
    let releaseVoid!: () => void;
    const voidMayContinue = new Promise<void>((resolve) => { releaseVoid = resolve; });
    let voidLocked!: () => void;
    const voidHasLifecycle = new Promise<void>((resolve) => { voidLocked = resolve; });
    const pausedVoidRepo = new PrismaAccountingRepository({
      client: pauseAfterFirstAdvisoryLock(client, voidLocked, voidMayContinue),
    } as any);
    const firstVoidPromise = pausedVoidRepo.voidPaymentTrueReversal(
      companyId, voidFirst.firstPaymentId, 'p27-test-user', 'race proof',
    );
    await voidHasLifecycle;
    let losingCreateSettled = false;
    const afterVoidPaymentPromise = repo.createPayment(voidFirst.secondInput)
      .finally(() => { losingCreateSettled = true; });
    await pause(75);
    assert.equal(losingCreateSettled, false);
    releaseVoid();
    await firstVoidPromise;
    const afterVoidPayment = await afterVoidPaymentPromise;
    await assertFinalBalance(voidFirst.invoice.id, voidFirst.firstPaymentId, afterVoidPayment.payment.id);
  });

  it('serializes receipt creation against payment void and keeps the committed receipt/payment state valid', async (t) => {
    if (!reachable || !client || !repo) return t.skip('local PostgreSQL or the payment idempotency migration is unavailable');
    const invoice = await client.accountingDocument.create({
      data: {
        companyId, branchId, documentType: 'INVOICE', documentNumber: `INV-${randomUUID()}`, status: 'ISSUED',
        documentDate: new Date('2026-08-27T00:00:00.000Z'), currency: 'THB', vatMode: 'NO_VAT',
        subtotalAmount: '75', taxableAmount: '75', grandTotalAmount: '75', paidAmount: '0',
        outstandingAmount: '75', paymentStatus: 'UNPAID', createdByUserId: 'p27-test-user',
        lines: { create: [{ lineNumber: 1, description: 'Receipt race', quantity: '1', unitPrice: '75', lineSubtotalAmount: '75', lineTotalAmount: '75' }] },
      },
    });
    const payment = await repo.createPayment({
      companyId, branchId, idempotencyKey: `receipt-race-payment-${randomUUID()}`, payloadFingerprint: `receipt-race-${invoice.id}`,
      direction: 'RECEIVED', method: 'BANK_TRANSFER', amount: '75.00', paidAt: '2026-08-27T10:00:00.000Z',
      allocateToDocumentId: invoice.id, createdByUserId: 'p27-test-user',
    });

    let releaseReceipt!: () => void;
    const receiptMayContinue = new Promise<void>((resolve) => { releaseReceipt = resolve; });
    let receiptLocked!: () => void;
    const receiptHasLock = new Promise<void>((resolve) => { receiptLocked = resolve; });
    const receiptInput = {
      companyId, branchId, documentType: 'RECEIPT' as const, sourceDocumentId: invoice.id, sourceDocumentType: 'INVOICE',
      documentDate: '2026-08-27', vatMode: 'NO_VAT' as const, createdByUserId: 'p27-test-user',
      lines: [{ lineNumber: 1, description: 'Receipt race', quantity: '1', unitPrice: '75.00' }],
    };
    const receiptPromise = repo.createDocument(receiptInput, async (db) => {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${companyId}:${invoice.id}:accounting-document-lifecycle`}))`;
      receiptLocked();
      await receiptMayContinue;
      await assertSalesDocumentSourceMutationInTransaction(db, companyId, receiptInput);
    });
    await receiptHasLock;

    let voidSettled = false;
    const voidPromise = repo.voidPaymentTrueReversal(companyId, payment.payment.id, 'p27-test-user', 'race proof')
      .then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      )
      .finally(() => { voidSettled = true; });
    await pause(75);
    assert.equal(voidSettled, false, 'payment void must wait behind the receipt lifecycle lock');
    releaseReceipt();

    const receipt = await receiptPromise;
    const voidResult = await voidPromise;
    assert.equal(receipt.sourceDocumentId, invoice.id);
    assert.equal(voidResult.ok, false);
    assert.equal((voidResult as any).error?.getResponse?.().code, 'accounting_active_receipt_must_be_voided');
    const [persistedInvoice, persistedPayment] = await Promise.all([
      client.accountingDocument.findUniqueOrThrow({ where: { id: invoice.id } }),
      client.accountingPayment.findUniqueOrThrow({ where: { id: payment.payment.id } }),
    ]);
    assert.equal(persistedInvoice.paymentStatus, 'PAID');
    assert.equal(Number(persistedInvoice.outstandingAmount), 0);
    assert.equal(persistedPayment.status, 'RECORDED');
  });

  it('serializes concurrent tax invoices across an invoice/receipt family and leaves one active child', async (t) => {
    if (!reachable || !client || !repo) return t.skip('local PostgreSQL or the P27 migration is unavailable');
    const invoice = await client.accountingDocument.create({
      data: {
        companyId, branchId, documentType: 'INVOICE', documentNumber: `INV-${randomUUID()}`, status: 'ISSUED',
        documentDate: new Date('2026-08-27T00:00:00.000Z'), currency: 'THB', vatMode: 'NO_VAT',
        subtotalAmount: '100', taxableAmount: '100', grandTotalAmount: '100', paidAmount: '0',
        outstandingAmount: '100', paymentStatus: 'UNPAID', createdByUserId: 'p27-test-user',
        lines: { create: [{ lineNumber: 1, description: 'Tax invoice race', quantity: '1', unitPrice: '100', lineSubtotalAmount: '100', lineTotalAmount: '100' }] },
      },
    });
    const receipt = await client.accountingDocument.create({
      data: {
        companyId, branchId, documentType: 'RECEIPT', documentNumber: `REC-${randomUUID()}`, status: 'ISSUED',
        // Historical rows may omit sourceDocumentType; canonicalization must trust the upstream row.
        sourceDocumentId: invoice.id,
        documentDate: new Date('2026-08-27T00:00:00.000Z'), currency: 'THB', vatMode: 'NO_VAT',
        subtotalAmount: '100', taxableAmount: '100', grandTotalAmount: '100', paidAmount: '100',
        outstandingAmount: '0', paymentStatus: 'PAID', createdByUserId: 'p27-test-user',
        lines: { create: [{ lineNumber: 1, description: 'Tax source receipt', quantity: '1', unitPrice: '100', lineSubtotalAmount: '100', lineTotalAmount: '100' }] },
      },
    });
    const createLinkedTaxInvoice = (sourceDocumentId: string, sourceDocumentType: 'INVOICE' | 'RECEIPT', suffix: string) => {
      const input = {
        companyId, branchId, documentType: 'TAX_INVOICE' as const, sourceDocumentId, sourceDocumentType,
        idempotencyKey: `tax-invoice-race-${suffix}-${randomUUID()}`, payloadFingerprint: `tax-invoice-race-${suffix}`,
        documentDate: '2026-08-27', vatMode: 'NO_VAT' as const, outputTaxCode: 'O0' as const, createdByUserId: 'p27-test-user',
        lines: [{ lineNumber: 1, description: 'Tax invoice race', quantity: '1', unitPrice: '100.00' }],
      };
      return repo!.createDocument(input, (db) => assertSalesDocumentSourceMutationInTransaction(db, companyId, input));
    };

    const results = await Promise.allSettled([
      createLinkedTaxInvoice(invoice.id, 'INVOICE', 'invoice'),
      createLinkedTaxInvoice(receipt.id, 'RECEIPT', 'receipt'),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const rejection = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    assert.equal((rejection?.reason as any)?.getResponse?.().code, 'accounting_tax_invoice_already_exists');
    assert.equal(await client.accountingDocument.count({
      where: { companyId, sourceDocumentId: { in: [invoice.id, receipt.id] }, documentType: 'TAX_INVOICE', status: { not: 'VOIDED' } },
    }), 1);
  });

  it('orders receipt issue and void on root then child locks without deadlock', async (t) => {
    if (!reachable || !client || !repo) return t.skip('local PostgreSQL or the P27 migration is unavailable');
    const createFixture = async (suffix: string) => {
      const invoice = await client!.accountingDocument.create({
        data: {
          companyId, branchId, documentType: 'INVOICE', documentNumber: `INV-${randomUUID()}`, status: 'ISSUED',
          documentDate: new Date('2026-08-27T00:00:00.000Z'), currency: 'THB', vatMode: 'NO_VAT',
          subtotalAmount: '50', taxableAmount: '50', grandTotalAmount: '50', paidAmount: '50',
          outstandingAmount: '0', paymentStatus: 'PAID', createdByUserId: 'p27-test-user',
          lines: { create: [{ lineNumber: 1, description: `Receipt lifecycle ${suffix}`, quantity: '1', unitPrice: '50', lineSubtotalAmount: '50', lineTotalAmount: '50' }] },
        },
      });
      const receipt = await client!.accountingDocument.create({
        data: {
          companyId, branchId, documentType: 'RECEIPT', status: 'DRAFT', sourceDocumentId: invoice.id,
          documentDate: new Date('2026-08-27T00:00:00.000Z'), currency: 'THB', vatMode: 'NO_VAT',
          subtotalAmount: '50', taxableAmount: '50', grandTotalAmount: '50', outstandingAmount: '50',
          paymentStatus: 'UNPAID', createdByUserId: 'p27-test-user',
          lines: { create: [{ lineNumber: 1, description: `Receipt lifecycle ${suffix}`, quantity: '1', unitPrice: '50', lineSubtotalAmount: '50', lineTotalAmount: '50' }] },
        },
      });
      return { invoice, receipt };
    };

    const issueFirst = await createFixture('issue-first');
    let releaseIssue!: () => void;
    const issueMayContinue = new Promise<void>((resolve) => { releaseIssue = resolve; });
    let issueLocked!: () => void;
    const issueHasRoot = new Promise<void>((resolve) => { issueLocked = resolve; });
    const pausedIssueRepo = new PrismaAccountingRepository({
      client: pauseAfterFirstAdvisoryLock(client, issueLocked, issueMayContinue),
    } as any);
    const issuePromise = pausedIssueRepo.issueDocument(
      companyId, issueFirst.receipt.id, `REC-${randomUUID()}`, 'p27-test-user', 'RECEIPT',
      undefined, 'DRAFT', issueFirst.receipt.updatedAt,
    );
    await issueHasRoot;
    let losingVoidSettled = false;
    const losingVoid = repo.voidDocumentTrueReversal(
      companyId, issueFirst.receipt.id, 'p27-test-user', 'race proof', 'DRAFT',
    ).then(
      () => ({ ok: true as const, error: undefined }),
      (error: unknown) => ({ ok: false as const, error }),
    ).finally(() => { losingVoidSettled = true; });
    await pause(75);
    assert.equal(losingVoidSettled, false);
    releaseIssue();
    await issuePromise;
    const issueFirstVoidResult = await losingVoid;
    assert.equal(issueFirstVoidResult.ok, false);
    assertExpectedBusinessRejection(issueFirstVoidResult.error, 'accounting_document_changed');
    assert.equal((await client.accountingDocument.findUniqueOrThrow({ where: { id: issueFirst.receipt.id } })).status, 'ISSUED');

    const voidFirst = await createFixture('void-first');
    let releaseVoid!: () => void;
    const voidMayContinue = new Promise<void>((resolve) => { releaseVoid = resolve; });
    let voidLocked!: () => void;
    const voidHasRoot = new Promise<void>((resolve) => { voidLocked = resolve; });
    const pausedVoidRepo = new PrismaAccountingRepository({
      client: pauseAfterFirstAdvisoryLock(client, voidLocked, voidMayContinue),
    } as any);
    const voidPromise = pausedVoidRepo.voidDocumentTrueReversal(
      companyId, voidFirst.receipt.id, 'p27-test-user', 'race proof', 'DRAFT',
    );
    await voidHasRoot;
    let losingIssueSettled = false;
    const losingIssue = repo.issueDocument(
      companyId, voidFirst.receipt.id, `REC-${randomUUID()}`, 'p27-test-user', 'RECEIPT',
      undefined, 'DRAFT', voidFirst.receipt.updatedAt,
    ).then(
      () => ({ ok: true as const, error: undefined }),
      (error: unknown) => ({ ok: false as const, error }),
    ).finally(() => { losingIssueSettled = true; });
    await pause(75);
    assert.equal(losingIssueSettled, false);
    releaseVoid();
    await voidPromise;
    const voidFirstIssueResult = await losingIssue;
    assert.equal(voidFirstIssueResult.ok, false);
    assertExpectedBusinessRejection(voidFirstIssueResult.error, 'accounting_document_changed');
    assert.equal((await client.accountingDocument.findUniqueOrThrow({ where: { id: voidFirst.receipt.id } })).status, 'VOIDED');
  });

  it('serializes tax creation through a receipt against receipt void in both orders', async (t) => {
    if (!reachable || !client || !repo) return t.skip('local PostgreSQL or the P27 migration is unavailable');
    const createFixture = async (suffix: string) => {
      const invoice = await client!.accountingDocument.create({
        data: {
          companyId, branchId, documentType: 'INVOICE', documentNumber: `INV-${randomUUID()}`, status: 'ISSUED',
          documentDate: new Date('2026-08-27T00:00:00.000Z'), currency: 'THB', vatMode: 'NO_VAT',
          subtotalAmount: '80', taxableAmount: '80', grandTotalAmount: '80', outstandingAmount: '80',
          paymentStatus: 'UNPAID', createdByUserId: 'p27-test-user',
        },
      });
      const receipt = await client!.accountingDocument.create({
        data: {
          companyId, branchId, documentType: 'RECEIPT', documentNumber: `REC-${randomUUID()}`, status: 'ISSUED',
          sourceDocumentId: invoice.id,
          documentDate: new Date('2026-08-27T00:00:00.000Z'), currency: 'THB', vatMode: 'NO_VAT',
          subtotalAmount: '80', taxableAmount: '80', grandTotalAmount: '80', paidAmount: '80',
          outstandingAmount: '0', paymentStatus: 'PAID', createdByUserId: 'p27-test-user',
        },
      });
      const input = {
        companyId, branchId, documentType: 'TAX_INVOICE' as const, sourceDocumentId: receipt.id, sourceDocumentType: 'RECEIPT',
        documentDate: '2026-08-27', vatMode: 'NO_VAT' as const, outputTaxCode: 'O0' as const,
        createdByUserId: 'p27-test-user',
        lines: [{ lineNumber: 1, description: `Tax/void ${suffix}`, quantity: '1', unitPrice: '80.00' }],
      };
      return { receipt, input };
    };

    const taxFirst = await createFixture('tax-first');
    let releaseTax!: () => void;
    const taxMayContinue = new Promise<void>((resolve) => { releaseTax = resolve; });
    let taxLocked!: () => void;
    const taxHasRoot = new Promise<void>((resolve) => { taxLocked = resolve; });
    const pausedTaxRepo = new PrismaAccountingRepository({
      client: pauseAfterFirstAdvisoryLock(client, taxLocked, taxMayContinue),
    } as any);
    const taxPromise = pausedTaxRepo.createDocument(
      taxFirst.input,
      (db) => assertSalesDocumentSourceMutationInTransaction(db, companyId, taxFirst.input),
    );
    await taxHasRoot;
    let losingVoidSettled = false;
    const losingVoid = repo.voidDocumentTrueReversal(
      companyId, taxFirst.receipt.id, 'p27-test-user', 'race proof', 'ISSUED',
    ).then(
      () => ({ ok: true as const, error: undefined }),
      (error: unknown) => ({ ok: false as const, error }),
    ).finally(() => { losingVoidSettled = true; });
    await pause(75);
    assert.equal(losingVoidSettled, false);
    releaseTax();
    const taxDocument = await taxPromise;
    const taxFirstVoidResult = await losingVoid;
    assert.equal(taxFirstVoidResult.ok, false);
    assertExpectedBusinessRejection(taxFirstVoidResult.error, 'accounting_active_child_document_must_be_voided');
    assert.equal(taxDocument.sourceDocumentId, taxFirst.receipt.id);
    assert.equal((await client.accountingDocument.findUniqueOrThrow({ where: { id: taxFirst.receipt.id } })).status, 'ISSUED');

    const voidFirst = await createFixture('void-first');
    let releaseVoid!: () => void;
    const voidMayContinue = new Promise<void>((resolve) => { releaseVoid = resolve; });
    let voidLocked!: () => void;
    const voidHasRoot = new Promise<void>((resolve) => { voidLocked = resolve; });
    const pausedVoidRepo = new PrismaAccountingRepository({
      client: pauseAfterFirstAdvisoryLock(client, voidLocked, voidMayContinue),
    } as any);
    const voidPromise = pausedVoidRepo.voidDocumentTrueReversal(
      companyId, voidFirst.receipt.id, 'p27-test-user', 'race proof', 'ISSUED',
    );
    await voidHasRoot;
    let losingTaxSettled = false;
    const losingTax = repo.createDocument(
      voidFirst.input,
      (db) => assertSalesDocumentSourceMutationInTransaction(db, companyId, voidFirst.input),
    ).then(
      () => ({ ok: true as const, error: undefined }),
      (error: unknown) => ({ ok: false as const, error }),
    ).finally(() => { losingTaxSettled = true; });
    await pause(75);
    assert.equal(losingTaxSettled, false);
    releaseVoid();
    await voidPromise;
    const voidFirstTaxResult = await losingTax;
    assert.equal(voidFirstTaxResult.ok, false);
    assertExpectedBusinessRejection(voidFirstTaxResult.error);
    assert.equal(await client.accountingDocument.count({
      where: { companyId, sourceDocumentId: voidFirst.receipt.id, documentType: 'TAX_INVOICE', status: { not: 'VOIDED' } },
    }), 0);
  });

  it('keeps mixed 7% and zero-rate line arithmetic through invoice, payment, and receipt', async (t) => {
    if (!reachable || !repo) return t.skip('local PostgreSQL or the P27 migration is unavailable');
    const result = await repo.recordSimpleIncomeBundle({
      ...input('income-mixed-0001', 'fingerprint-mixed', `${companyId}-mixed`),
      vatMode: 'VAT_EXCLUDED',
      lines: [
        { lineNumber: 1, description: 'บริการ VAT 7%', quantity: '1', unitPrice: '100.00', vatRate: '7' },
        { lineNumber: 2, description: 'รายการอัตรา 0%', quantity: '1', unitPrice: '100.00', vatRate: '0' },
      ],
    }, async () => undefined);
    assert.equal(Number(result.invoice.taxableAmount), 200);
    assert.equal(Number(result.invoice.vatAmount), 7);
    assert.equal(Number(result.invoice.grandTotalAmount), 207);
    assert.equal(Number(result.payment.amount), 207);
    assert.equal(Number(result.receipt.grandTotalAmount), 207);
    assert.equal(result.invoice.paymentStatus, 'PAID');
  });

  it('keeps the six ledger definitions, permission split, Bangkok payment boundary, and export on one dataset', async (t) => {
    if (!reachable || !client || !repo) return t.skip('local PostgreSQL or the P27 migration is unavailable');
    const ledgerCompanyId = `${companyId}-ledger`;
    const ctx: RequestContext = {
      requestId: 'p27-ledger-request', authSubject: 'p27-ledger-user', userId: 'p27-ledger-user', companyId: ledgerCompanyId,
      membershipId: 'p27-ledger-membership', roles: [], scopes: { branchIds: [] }, authProvider: 'watchdog',
      permissions: ['accounting.document.read', 'accounting.document.export', 'expense.read', 'expense.export'],
    };
    try {
      await client.company.create({ data: { id: ledgerCompanyId, name: 'P27 ledger test' } });
      await client.companyTaxProfile.create({ data: { companyId: ledgerCompanyId, accountingPeriodMonth: 12 } });
      const allowedBranch = await client.branch.create({ data: {
        companyId: ledgerCompanyId, code: 'P27-ALLOWED', name: 'สาขาที่มีสิทธิ์', type: 'BRANCH', createdByUserId: ctx.userId,
      } });
      const forbiddenBranch = await client.branch.create({ data: {
        companyId: ledgerCompanyId, code: 'P27-FORBIDDEN', name: 'สาขาที่ไม่มีสิทธิ์', type: 'BRANCH', createdByUserId: ctx.userId,
      } });
      ctx.scopes = { branchIds: [allowedBranch.id] };
      const counterparty = await client.accountingCounterparty.create({ data: {
        companyId: ledgerCompanyId, type: 'CUSTOMER', displayName: 'ลูกค้าทดสอบ', createdByUserId: ctx.userId,
      } });
      const incomeBundle = await repo.recordSimpleIncomeBundle({
        companyId: ledgerCompanyId, branchId: allowedBranch.id, idempotencyKey: 'ledger-income-0001', payloadFingerprint: 'ledger-fingerprint',
        documentDate: '2026-08-01', counterpartyId: counterparty.id, vatMode: 'NO_VAT', paymentMethod: 'BANK_TRANSFER',
        lines: [{ lineNumber: 1, description: 'รายรับทดสอบ', quantity: '1', unitPrice: '100.00', whtRate: '3' }],
        createdByUserId: ctx.userId,
      }, async () => undefined);
      await client.accountingDocument.update({ where: { id: incomeBundle.invoice.id }, data: { dueDate: new Date('2026-08-15T00:00:00.000Z') } });
      const creditNote = await client.accountingDocument.create({ data: {
        companyId: ledgerCompanyId, documentType: 'CREDIT_NOTE', documentNumber: 'CN-P27-LEDGER-0001',
        status: 'ISSUED', documentDate: new Date('2026-08-02T00:00:00.000Z'), sourceDocumentId: incomeBundle.invoice.id,
        counterpartyId: counterparty.id, counterpartySnapshotJson: { displayName: counterparty.displayName },
        subtotalAmount: '10', taxableAmount: '10', grandTotalAmount: '10', outstandingAmount: '10',
        paymentStatus: 'UNPAID', adjustmentReasonCode: 'PRICE_ADJUSTMENT', createdByUserId: ctx.userId,
      } });
      await client.accountingDocumentLine.create({ data: {
        companyId: ledgerCompanyId, documentId: creditNote.id, lineNumber: 1, description: 'ลดราคาทดสอบ',
        quantity: '1', unitPrice: '10', lineSubtotalAmount: '10', lineTotalAmount: '10',
      } });
      const allowedBranchInvoice = await client.accountingDocument.create({ data: {
        companyId: ledgerCompanyId, branchId: allowedBranch.id, documentType: 'INVOICE',
        documentNumber: 'INV-P27-ALLOWED-0001', status: 'ISSUED', documentDate: new Date('2026-08-03T00:00:00.000Z'),
        dueDate: new Date('2026-08-20T00:00:00.000Z'), subtotalAmount: '20', taxableAmount: '20', grandTotalAmount: '20',
        paidAmount: '0', outstandingAmount: '20', paymentStatus: 'UNPAID', vatMode: 'NO_VAT', createdByUserId: ctx.userId,
      } });
      await client.accountingDocumentLine.create({ data: {
        companyId: ledgerCompanyId, documentId: allowedBranchInvoice.id, lineNumber: 1, description: 'รายรับสาขาที่มีสิทธิ์',
        quantity: '1', unitPrice: '20', lineSubtotalAmount: '20', lineTotalAmount: '20',
      } });
      const forbiddenBranchInvoice = await client.accountingDocument.create({ data: {
        companyId: ledgerCompanyId, branchId: forbiddenBranch.id, documentType: 'INVOICE',
        documentNumber: 'INV-P27-FORBIDDEN-0001', status: 'ISSUED', documentDate: new Date('2026-08-03T00:00:00.000Z'),
        dueDate: new Date('2026-08-20T00:00:00.000Z'), subtotalAmount: '900', taxableAmount: '900', grandTotalAmount: '900',
        paidAmount: '0', outstandingAmount: '900', paymentStatus: 'UNPAID', vatMode: 'NO_VAT', createdByUserId: ctx.userId,
      } });
      await client.accountingDocumentLine.create({ data: {
        companyId: ledgerCompanyId, documentId: forbiddenBranchInvoice.id, lineNumber: 1, description: 'รายรับสาขาที่ไม่มีสิทธิ์',
        quantity: '1', unitPrice: '900', lineSubtotalAmount: '900', lineTotalAmount: '900',
      } });
      const ytdInvoice = await client.accountingDocument.create({ data: {
        companyId: ledgerCompanyId, documentType: 'INVOICE', documentNumber: 'INV-P27-YTD-0001', status: 'ISSUED',
        documentDate: new Date('2026-01-15T00:00:00.000Z'), subtotalAmount: '1500000', taxableAmount: '1500000',
        grandTotalAmount: '1500000', paidAmount: '1500000', outstandingAmount: '0', paymentStatus: 'PAID',
        vatMode: 'NO_VAT', createdByUserId: ctx.userId,
      } });
      const standaloneTaxInvoice = await client.accountingDocument.create({ data: {
        companyId: ledgerCompanyId, documentType: 'TAX_INVOICE', documentNumber: 'TAX-P27-STANDALONE-0001', status: 'ISSUED',
        documentDate: new Date('2026-01-20T00:00:00.000Z'), subtotalAmount: '100000', taxableAmount: '100000',
        grandTotalAmount: '100000', paidAmount: '100000', outstandingAmount: '0', paymentStatus: 'PAID',
        vatMode: 'NO_VAT', outputTaxCode: 'O0', createdByUserId: ctx.userId,
      } });
      await client.accountingDocumentLine.create({ data: {
        companyId: ledgerCompanyId, documentId: standaloneTaxInvoice.id, lineNumber: 1, description: 'ใบกำกับภาษีต้นทาง',
        quantity: '1', unitPrice: '100000', lineSubtotalAmount: '100000', lineTotalAmount: '100000',
      } });
      const standaloneTaxCredit = await client.accountingDocument.create({ data: {
        companyId: ledgerCompanyId, documentType: 'CREDIT_NOTE', documentNumber: 'CN-P27-TAX-0001', status: 'ISSUED',
        documentDate: new Date('2026-01-21T00:00:00.000Z'), sourceDocumentId: standaloneTaxInvoice.id,
        sourceDocumentType: 'TAX_INVOICE', subtotalAmount: '50000', taxableAmount: '50000', grandTotalAmount: '50000',
        paidAmount: '0', outstandingAmount: '0', paymentStatus: 'UNPAID', vatMode: 'NO_VAT', outputTaxCode: 'O0',
        adjustmentReasonCode: 'PRICE_ADJUSTMENT', createdByUserId: ctx.userId,
      } });
      await client.accountingDocumentLine.create({ data: {
        companyId: ledgerCompanyId, documentId: standaloneTaxCredit.id, lineNumber: 1, description: 'ลดใบกำกับภาษีต้นทาง',
        quantity: '1', unitPrice: '50000', lineSubtotalAmount: '50000', lineTotalAmount: '50000',
      } });
      const linkedTaxInvoice = await client.accountingDocument.create({ data: {
        companyId: ledgerCompanyId, documentType: 'TAX_INVOICE', documentNumber: 'TAX-P27-LINKED-0001', status: 'ISSUED',
        documentDate: new Date('2026-01-22T00:00:00.000Z'), sourceDocumentId: ytdInvoice.id, sourceDocumentType: 'INVOICE',
        subtotalAmount: '1500000', taxableAmount: '1500000', grandTotalAmount: '1500000', paidAmount: '1500000',
        outstandingAmount: '0', paymentStatus: 'PAID', vatMode: 'NO_VAT', outputTaxCode: 'O0', createdByUserId: ctx.userId,
      } });
      await client.accountingDocumentLine.create({ data: {
        companyId: ledgerCompanyId, documentId: linkedTaxInvoice.id, lineNumber: 1, description: 'ใบกำกับภาษีที่อ้างใบแจ้งหนี้',
        quantity: '1', unitPrice: '1500000', lineSubtotalAmount: '1500000', lineTotalAmount: '1500000',
      } });
      const linkedTaxCredit = await client.accountingDocument.create({ data: {
        companyId: ledgerCompanyId, documentType: 'CREDIT_NOTE', documentNumber: 'CN-P27-LINKED-TAX-0001', status: 'ISSUED',
        documentDate: new Date('2026-01-23T00:00:00.000Z'), sourceDocumentId: linkedTaxInvoice.id,
        sourceDocumentType: 'TAX_INVOICE', subtotalAmount: '25000', taxableAmount: '25000', grandTotalAmount: '25000',
        paidAmount: '0', outstandingAmount: '0', paymentStatus: 'UNPAID', vatMode: 'NO_VAT', outputTaxCode: 'O0',
        adjustmentReasonCode: 'PRICE_ADJUSTMENT', createdByUserId: ctx.userId,
      } });
      await client.accountingDocumentLine.create({ data: {
        companyId: ledgerCompanyId, documentId: linkedTaxCredit.id, lineNumber: 1, description: 'ลดใบกำกับภาษีที่อ้างใบแจ้งหนี้',
        quantity: '1', unitPrice: '25000', lineSubtotalAmount: '25000', lineTotalAmount: '25000',
      } });
      await client.accountingDocument.create({ data: {
        companyId: ledgerCompanyId, documentType: 'INVOICE', documentNumber: 'INV-P27-VOIDED-0001', status: 'VOIDED',
        documentDate: new Date('2026-02-15T00:00:00.000Z'), subtotalAmount: '1000000', taxableAmount: '1000000',
        grandTotalAmount: '1000000', paidAmount: '0', outstandingAmount: '0', paymentStatus: 'UNPAID',
        vatMode: 'NO_VAT', createdByUserId: ctx.userId,
      } });
      const expense = await client.expenseRecord.create({ data: {
        companyId: ledgerCompanyId, status: 'CONFIRMED', expenseDate: new Date('2026-08-01T00:00:00.000Z'),
        grandTotalAmount: '50', netPayableAmount: '50', paidAmount: '20', outstandingAmount: '30',
        paymentStatus: 'PARTIALLY_PAID', createdByUserId: ctx.userId,
      } });
      await client.expenseLine.create({ data: {
        companyId: ledgerCompanyId, expenseId: expense.id, lineNumber: 1, description: 'รายจ่ายทดสอบ',
        quantity: '1', unitPrice: '50', taxableAmount: '50', lineSubtotalAmount: '50', lineTotalAmount: '50',
      } });
      await client.expensePayment.createMany({ data: [
        { companyId: ledgerCompanyId, expenseId: expense.id, amount: '20', paidAt: new Date('2026-07-31T17:00:00.000Z'), createdByUserId: ctx.userId },
        { companyId: ledgerCompanyId, expenseId: expense.id, amount: '99', paidAt: new Date('2026-07-31T16:59:59.999Z'), createdByUserId: ctx.userId },
      ] });

      const ledger = new IncomeExpenseLedgerUseCase(
        { client } as any,
        { get: async () => { throw new Error('branch-scoped ledger must not load a company-wide VAT total'); } } as any,
      );
      const summary = await ledger.summary(ctx, '2026-08-01', '2026-08-31');
      assert.deepEqual({
        sales: summary.income.salesDocumentTotal, received: summary.income.receivedTotal,
        wht: summary.income.withheldTaxTotal, outstanding: summary.income.receivableOutstanding,
        expense: summary.expense.recordedExpenseTotal, paid: summary.expense.paidExpenseTotal,
        cashDifference: summary.cashDifference, documentDifference: summary.documentDifference,
      }, {
        sales: '110.00', received: '100.00', wht: '3.00', outstanding: '20.00',
        expense: '50.00', paid: '20.00', cashDifference: '80.00', documentDifference: '60.00',
      });
      const incomeOnly = await ledger.summary({ ...ctx, permissions: ['accounting.document.read'] }, '2026-08-01', '2026-08-31');
      assert.equal(incomeOnly.income.available, true);
      assert.equal(incomeOnly.income.vatRegistrationAlert, undefined);
      assert.deepEqual(incomeOnly.expense, { available: false, unavailableReason: 'NO_PERMISSION', byCategory: [] });
      assert.equal(incomeOnly.cashDifference, undefined);

      let vatStatusReads = 0;
      const companyWideLedger = new IncomeExpenseLedgerUseCase(
        { client } as any,
        { get: async () => { vatStatusReads += 1; return { status: 'NOT_REGISTERED' }; } } as any,
      );
      const companyWidePermissions = [
        ...ctx.permissions, 'company.vat_registration.read', 'tax.profile.read',
      ];
      const companyWide = await companyWideLedger.summary(
        { ...ctx, scopes: {}, permissions: companyWidePermissions },
        '2026-08-01', '2026-08-31', '2026-08-27',
      );
      assert.deepEqual(companyWide.income.vatRegistrationAlert, {
        level: 'APPROACHING', periodBasis: 'ACCOUNTING_PERIOD', periodStart: '2026-01-01', periodEnd: '2026-08-27',
        salesDocumentTotal: '1526010.00', thresholdAmount: '1800000.00',
      });
      assert.equal(vatStatusReads, 1);

      const missingVatPermission = await companyWideLedger.summary(
        { ...ctx, scopes: {}, permissions: [...ctx.permissions, 'tax.profile.read'] },
        '2026-08-01', '2026-08-31', '2026-08-27',
      );
      assert.equal(missingVatPermission.income.vatRegistrationAlert, undefined);
      assert.equal(vatStatusReads, 1, 'VAT status is not read without company.vat_registration.read');

      const missingTaxProfilePermission = await companyWideLedger.summary(
        { ...ctx, scopes: {}, permissions: [...ctx.permissions, 'company.vat_registration.read'] },
        '2026-08-01', '2026-08-31', '2026-08-27',
      );
      assert.equal(missingTaxProfilePermission.income.vatRegistrationAlert, undefined);
      assert.equal(vatStatusReads, 1, 'VAT status is not read when the protected accounting period cannot be read');

      const accessorUnavailable = await new IncomeExpenseLedgerUseCase(
        { client } as any,
        { get: async () => { throw new Error('temporary VAT accessor outage'); } } as any,
      ).summary(
        { ...ctx, scopes: {}, permissions: companyWidePermissions },
        '2026-08-01', '2026-08-31', '2026-08-27',
      );
      assert.equal(accessorUnavailable.income.available, true);
      assert.equal(accessorUnavailable.income.vatRegistrationAlert, undefined);

      const januaryIncome = await ledger.entries(ctx, { type: 'INCOME', from: '2026-01-01', to: '2026-01-31' });
      assert.deepEqual(
        new Set(januaryIncome.data.map((row) => row.id)),
        new Set([ytdInvoice.id, standaloneTaxInvoice.id, standaloneTaxCredit.id, linkedTaxCredit.id]),
        'standalone TAX_INVOICE is a revenue root; linked TAX_INVOICE is evidence while its correction still adjusts revenue',
      );

      const entries = await ledger.entries(ctx, { type: 'ALL', from: '2026-08-01', to: '2026-08-31' });
      assert.equal(entries.total, 4, 'evidence-only receipt and the forbidden branch are not income rows');
      assert.deepEqual(new Set(entries.data.map((row) => row.side)), new Set(['INCOME', 'EXPENSE']));
      assert.equal(entries.data.some((row) => row.id === forbiddenBranchInvoice.id), false);
      const incomeEntry = entries.data.find((row) => row.id === incomeBundle.invoice.id)!;
      assert.match(incomeEntry.evidenceHref, /\/sales-documents\?documentId=/);
      assert.equal(incomeEntry.dueDate, '2026-08-15');
      assert.equal(incomeEntry.counterpartyId, counterparty.id);
      assert.equal(incomeEntry.partyName, 'ลูกค้าทดสอบ');
      const creditEntry = entries.data.find((row) => row.id === creditNote.id);
      assert.equal(creditEntry?.amount, '-10.00');
      assert.equal(creditEntry?.outstandingAmount, undefined, 'credit notes reduce income but never display as receivable');
      const receivables = await ledger.entries(ctx, { type: 'RECEIVABLE', from: '2026-08-01', to: '2026-08-31' });
      assert.equal(receivables.total, 1, 'only the allowed-branch invoice is receivable');
      assert.equal(receivables.data[0]?.id, allowedBranchInvoice.id);
      const exported = await ledger.export(ctx, { type: 'ALL', from: '2026-08-01', to: '2026-08-31' });
      assert.equal(exported.rowCount, 4);
      assert.match(exported.csv, /รายรับ/);
      assert.doesNotMatch(exported.csv, /INV-P27-FORBIDDEN-0001/);
      assert.ok(Buffer.from(exported.xlsxBase64, 'base64').subarray(0, 2).equals(Buffer.from('PK')));
    } finally {
      await client.accountingSimpleIncomeCommand.deleteMany({ where: { companyId: ledgerCompanyId } });
      await client.accountingPaymentAllocation.deleteMany({ where: { companyId: ledgerCompanyId } });
      await client.accountingPayment.deleteMany({ where: { companyId: ledgerCompanyId } });
      await client.accountingDocument.deleteMany({ where: { companyId: ledgerCompanyId } });
      await client.accountingCounterparty.deleteMany({ where: { companyId: ledgerCompanyId } });
      await client.documentNumber.deleteMany({ where: { companyId: ledgerCompanyId } });
      await client.documentSequence.deleteMany({ where: { companyId: ledgerCompanyId } });
      await client.expensePayment.deleteMany({ where: { companyId: ledgerCompanyId } });
      await client.expenseLine.deleteMany({ where: { companyId: ledgerCompanyId } });
      await client.expenseRecord.deleteMany({ where: { companyId: ledgerCompanyId } });
      await client.companyTaxProfile.deleteMany({ where: { companyId: ledgerCompanyId } });
      await client.company.deleteMany({ where: { id: ledgerCompanyId } });
    }
  });
});
