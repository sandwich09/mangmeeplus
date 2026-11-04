import { asLedgerSource, buildJournalLines } from '../../ledger/application/use-cases/journal.use-case';
import { PrismaLedgerRepository } from '../../ledger/infrastructure/prisma-ledger.repository';
import { CompanyVatRegistrationUseCase } from '../../data-model-core/application/use-cases/company-vat-registration.use-case';
import { lockExpenseCorrection } from './expense-void-blocker';
import { isSerializationFailure } from '../../../common/database/prisma-error';
import { after, before, describe, it } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import Decimal from 'decimal.js';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '../../../generated/prisma/client';
import { pgSpecUnreachableReason } from '../../../common/database/pg-spec-guard';
import { RecordExpensePaymentUseCase, VoidExpenseUseCase, MarkExpenseReadyUseCase } from '../application/use-cases/expense-draft.use-case';
import { AuditService } from '../../audit/application/audit.service';
import { PrismaAuditRepository } from '../../audit/infrastructure/prisma-audit.repository';
import { PrismaExpenseRepository } from './prisma-expense.repository';
import { seedExpenses, seedExpenseRows } from '../../../../prisma/seed-expenses';
import { expenseEvidenceConfirmationError } from '@watchdog-bms/contracts';
import { expenseTaxSourceChecksum } from '../domain/logic/expense-status.logic';
import { SyncTaxEventsUseCase } from '../../tax/application/use-cases/sync-tax-events.use-case';
import { ExpenseSourceAdapter } from '../../tax/infrastructure/adapters/expense-source.adapter';
import { AccountingDocumentSourceAdapter } from '../../tax/infrastructure/adapters/accounting-document-source.adapter';
import { SupplierPaymentSourceAdapter } from '../../tax/infrastructure/adapters/supplier-payment-source.adapter';
import { ListExpensesUseCase } from '../application/use-cases/expense-draft.use-case';
import { DisbursementVoucherUseCase } from '../application/use-cases/disbursement-voucher.use-case';
import { PrismaDisbursementVoucherRepository } from './prisma-disbursement-voucher.repository';
import { DisbursementVoucherFileService } from '../application/services/disbursement-voucher-file.service';
import { IssueWhtCertificateFromHandoffUseCase } from '../../tax/application/use-cases/issue-wht-certificate-from-handoff.use-case';
import { WhtCertificateHandoffUseCase } from '../../tax/application/use-cases/wht-certificate-handoff.use-case';
import { CorrectWhtCertificateUseCase } from '../../tax/application/use-cases/correct-wht-certificate.use-case';
import { PrismaTaxRepository } from '../../tax/infrastructure/repositories/prisma-tax.repository';
import { IssueWhtReplacementCopyUseCase } from '../../tax/application/use-cases/issue-wht-replacement-copy.use-case';
import { PrismaAccountingRepository } from '../../accounting-documents/infrastructure/prisma-accounting.repository';
import { PrismaDocumentSequenceRepository } from '../../data-model-core/infrastructure/repositories/prisma-document-sequence.repository';
import { ReserveDocumentNumberUseCase } from '../../data-model-core/application/use-cases/reserve-document-number.use-case';
import { PrismaAttachmentRepository } from '../../data-model-core/infrastructure/repositories/prisma-attachment.repository';
import { DeleteExpenseUseCase } from '../application/use-cases/delete-expense.use-case';
import type { WhtHandoffStatus } from '@watchdog-bms/contracts';
import { CorrectWhtCertificateDto } from '../../tax/presentation/http/tax.dtos';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../../../common/pipes/validation-pipe.options';
import { TaxArtifactRendererService } from '../../tax/application/services/tax-artifact-renderer.service';

const VERSION = new Date('2026-08-10T01:00:00.000Z');

function expense(overrides: Record<string, unknown> = {}) {
  return {
    id: 'expense-1', companyId: 'company-1', branchId: 'branch-1', status: 'CONFIRMED', sourceReimbursementRequestId: null,
    expenseDate: new Date('2026-08-10T00:00:00Z'), lines: [], vatAmount: '0', whtAmount: '0',
    currency: 'THB', netPayableAmount: '100.0000', paidAmount: '0.0000', outstandingAmount: '100.0000',
    paymentStatus: 'UNPAID', postingStatus: 'posted', paymentMethod: null, paidAt: null, bankAccountRef: null,
    createdByUserId: 'creator-1', updatedByUserId: null, createdAt: VERSION, updatedAt: VERSION,
    ...overrides,
  };
}

function harness(overrides: Record<string, unknown> = {}) {
  const state = { filedSourceIds: ['expense-1'], files: [] as any[], links: [] as any[], vouchers: [] as any[], voucherLines: [] as any[], expense: expense(overrides), payments: [] as any[], journals: [] as any[], handoffs: [] as any[], taxEvents: [] as any[], certificates: [] as any[], taxPeriods: [] as any[], accountingPeriod: null as any, claim: null as any, certificateHistory: [] as any[], audits: [] as any[], events: [] as any[] };
  let forceCasFailure = false;
  let failingWrite: 'audit' | 'outbox' | undefined;
  const client: any = {
    company: { findUnique: async () => ({ status: 'ACTIVE', archivedAt: null, planTerm: null }) },
    expenseRecord: { findFirst: async () => state.expense },
    $transaction: async (work: (tx: any) => Promise<unknown>) => {
      const draft = structuredClone(state);
      const tx = {
        disbursementVoucherLine: {
          findMany: async ({ where }: any) => draft.voucherLines.filter(l => l.companyId === where.companyId && where.coversPaymentId.in.includes(l.coversPaymentId)),
          updateMany: async ({ where, data }: any) => { const rows = draft.voucherLines.filter(l => l.companyId === where.companyId && l.voucherId === where.voucherId); rows.forEach(l => Object.assign(l, data)); return { count: rows.length }; },
        },
        disbursementVoucher: { updateMany: async ({ where, data }: any) => { const rows = draft.vouchers.filter(v => v.id === where.id && v.companyId === where.companyId && v.status === where.status); rows.forEach(v => { const version = v.version; Object.assign(v, data, { version: version + 1 }); }); return { count: rows.length }; } },
        journalEntry: { findMany: async () => draft.journals },
        whtCertificateHandoff: {
          findMany: async ({ where }: any) => draft.handoffs.filter((row) => {
            const direct = (row.sourcePaymentType ?? 'expense.record') === 'expense.record' && (row.sourcePaymentId ?? 'expense-1') === 'expense-1';
            return where.OR ? direct || where.OR.some((filter: any) => filter.taxEventIdsJson?.array_contains?.some((id: string) => row.taxEventIdsJson?.includes(id))) : direct;
          }),
          findFirst: async ({ where }: any) => draft.handoffs.find(row => row.companyId === where.companyId && (!where.creationCommandId || row.creationCommandId === where.creationCommandId) && (!where.sourcePaymentType || row.sourcePaymentType === where.sourcePaymentType) && (!where.sourcePaymentId || row.sourcePaymentId === where.sourcePaymentId) && (typeof where.status === 'string' ? row.status === where.status : where.status.in.includes(row.status))) ?? null,
          update: async ({ where, data }: any) => { const row = draft.handoffs.find(row => row.id === where.id); Object.assign(row, data); return row; },
          create: async () => { throw new Error('re-confirm must revive the existing handoff'); },
          updateMany: async ({ where, data }: any) => {
            const rows = draft.handoffs.filter(row => row.status === where.status && (!where.id || row.id === where.id) && (!where.companyId || (row.companyId ?? 'company-1') === where.companyId) && (!where.certificateId || row.certificateId === where.certificateId));
            rows.forEach(row => { const round = row.certificateRound ?? 0; Object.assign(row, data); if (data.certificateRound?.increment) row.certificateRound = round + data.certificateRound.increment; });
            return { count: rows.length };
          },
        },
        taxEvent: { findMany: async () => draft.taxEvents, updateMany: async ({ where, data }: any) => { const rows = draft.taxEvents.filter(row => row.status === where.status && (!where.eventType || where.eventType.in.includes(row.eventType))); rows.forEach(row => Object.assign(row, data)); return { count: rows.length }; } },
        whtCertificate: {
          findFirst: async ({ where }: any) => draft.certificates.find(row => (!where.status || row.status === where.status) && (!where.id || row.id === where.id) && (!where.OR || where.OR.some((part: any) => part.taxEventIdsJson.array_contains.some((id: string) => row.taxEventIdsJson?.includes(id))))) ?? null,
          updateMany: async ({ where, data }: any) => { const rows = draft.certificates.filter(row => row.id === where.id && row.companyId === where.companyId && row.status === where.status); rows.forEach(row => Object.assign(row, data)); return { count: rows.length }; },
        },
        whtCertificateHistory: { create: async ({ data }: any) => {
          const handoff = draft.handoffs.find(row => row.id === data.handoffId);
          assert.notEqual(handoff.status, 'CANCELLED', 'history precedes clearing handoff pointers');
          draft.certificateHistory.push(data); return data;
        } },
        company: { findUnique: async () => ({ name: 'ร้านทดสอบ', taxId: '1234567890123' }) },
        branch: { findUnique: async () => ({ taxBranchCode: '00000' }), findMany: async () => [] },
        whtPayerModeFact: { findMany: async () => [] },
        whtIncomeCategory: { findUnique: async () => ({ nameTh: 'ค่าบริการ' }) },
        documentNumber: { findFirst: async () => null },
        accountingPeriod: { findUnique: async () => draft.accountingPeriod },
        taxPeriod: { findMany: async ({ where }: any) => draft.taxPeriods.filter(row => {
          const matches = (part: any): boolean => (!part.formType || (typeof part.formType === 'string' ? row.formType === part.formType : part.formType.in.includes(row.formType)))
            && (!part.periodKey || row.periodKey === part.periodKey) && (!part.id || part.id.in.includes(row.id));
          return matches(where) && (!where.whtFilings || draft.filedSourceIds.includes(where.whtFilings.some.lines.some.sourceId)) && (!where.OR || where.OR.some(matches));
        }) },
        reimbursementRequest: { findFirst: async () => draft.claim },
        attachmentObject: { findFirst: async ({ where }: any) => draft.files.find(f => f.id === where.id && f.companyId === where.companyId && f.branchId === where.branchId && f.uploadedByUserId === where.uploadedByUserId && f.status === where.status) ?? null },
        attachmentLink: { findMany: async () => [], findFirst: async () => null, create: async ({ data }: any) => { draft.links.push(data); return data; } },
        expenseSubstituteReceiptEvidence: { findFirst: async () => null },
        reimbursementLine: { findFirst: async () => null },
        $executeRaw: async () => 0,
        expenseRecord: {
          findFirst: async ({ where }: any) => where.companyId === draft.expense.companyId && where.id === draft.expense.id ? { ...draft.expense, payments: draft.payments } : null,
          findFirstOrThrow: async () => draft.expense,
          updateMany: async ({ where, data }: any) => {
            if (forceCasFailure || (where.status && where.status !== draft.expense.status)
              || (where.updatedAt && where.updatedAt.getTime() !== draft.expense.updatedAt.getTime())) return { count: 0 };
            Object.assign(draft.expense, data, { updatedAt: new Date(draft.expense.updatedAt.getTime() + 1) });
            return { count: 1 };
          },
        },
        expensePayment: {
          findMany: async () => draft.payments.filter((row) => row.status === 'RECORDED'),
          updateMany: async ({ where, data }: any) => {
            const row = draft.payments.find((p) => p.id === where.id && p.companyId === where.companyId && p.expenseId === where.expenseId && p.status === where.status);
            if (!row || forceCasFailure) return { count: 0 };
            Object.assign(row, data); return { count: 1 };
          },
          findFirst: async ({ where }: any) => draft.payments.find((row) => row.companyId === where.companyId && (where.id ? row.id === where.id && row.expenseId === where.expenseId : row.idempotencyKey === where.idempotencyKey)) ?? null,
          create: async ({ data }: any) => {
            const row = {
              ...data, id: `payment-${draft.payments.length + 1}`, journalEntryId: null, postingError: null,
              voidedByUserId: null, voidedAt: null, createdAt: VERSION, updatedAt: VERSION,
            };
            draft.payments.push(row);
            return row;
          },
        },
        auditLog: { create: async ({ data }: any) => {
          if (failingWrite === 'audit') throw new Error('audit unavailable');
          draft.audits.push(data);
        } },
        outboxEvent: { create: async ({ data }: any) => {
          if (failingWrite === 'outbox') throw new Error('outbox unavailable');
          draft.events.push(data);
        } },
      };
      const result = await work(tx);
      state.links = draft.links; state.vouchers = draft.vouchers; state.voucherLines = draft.voucherLines;
      state.expense = draft.expense;
      state.payments = draft.payments;
      state.audits = draft.audits;
      state.certificates = draft.certificates; state.certificateHistory = draft.certificateHistory;
      state.events = draft.events; state.handoffs = draft.handoffs; state.taxEvents = draft.taxEvents;
      return result;
    },
  };
  return {
    state,
    repo: new PrismaExpenseRepository({ client } as any),
    failNextCas: () => { forceCasFailure = true; },
    failWrite: (kind: 'audit' | 'outbox') => { failingWrite = kind; },
  };
}

function paymentInput(amount: string, overrides: Record<string, unknown> = {}) {
  return {
    companyId: 'company-1', expenseId: 'expense-1', actorUserId: 'finance-1', amount,
    scopes: {}, idempotencyKey: `client:${randomUUID()}`,
    paymentMethod: 'BANK_TRANSFER', paidAt: '2026-08-10', bankAccountRef: 'BANK-1',
    ...overrides,
  };
}

function pay(repo: PrismaExpenseRepository, amount: string, overrides: Record<string, unknown> = {}) {
  return repo.recordPaymentAtomic(paymentInput(amount, overrides));
}

for (const inputVatClaimStatus of ['NON_CLAIMABLE', 'NEEDS_REVIEW', 'CLAIMABLE']) it(`payment never waits for the input VAT right ${inputVatClaimStatus}`, async () => {
  const h = harness({ inputVatClaimStatus, postingStatus: 'not_required' });
  await pay(h.repo, '100');
  assert.equal(h.state.payments.length, 1);
  assert.equal(h.state.expense.paidAmount, '100.0000');
});

describe('PrismaExpenseRepository partial payment history', () => {
  it('applies branch and Bangkok future-date guards inside the shared payment transaction', async t => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-04T16:30:00Z').getTime() });
    const missing = harness({ branchId: null });
    await assert.rejects(() => pay(missing.repo, '1'), (e: any) => e.getResponse?.().code === 'TRANSACTION_BRANCH_REQUIRED');
    const future = harness();
    await assert.rejects(() => pay(future.repo, '1', { paidAt: '2026-10-05' }), (e: any) => e.getResponse?.().code === 'expense_payment_future_date' && e.getResponse().message === 'วันที่จ่ายเงินจริงต้องไม่เกินวันนี้');
    assert.equal(future.state.payments.length, 0);
    t.mock.timers.setTime(new Date('2026-10-04T17:30:00Z').getTime());
    assert.equal((await pay(future.repo, '1', { paidAt: '2026-10-05' })).payment.amount, '1.0000');
  });

  it('a direct replay after another actor cancels the payment refuses without effects, while an active replay still succeeds (E5)', async () => {
    const { repo, state } = harness();
    const actor: any = { companyId: 'company-1', userId: 'finance-1', requestId: 'req-e5', permissions: ['expense.payment.record'], scopes: {}, authProvider: 'watchdog' };
    const useCase = new RecordExpensePaymentUseCase(repo, { log: async () => undefined } as any);
    const input = { paidAmount: '40', idempotencyKey: randomUUID() };
    await useCase.execute(actor, 'expense-1', input);
    await useCase.execute(actor, 'expense-1', input); assert.equal(state.events.length, 1);
    await repo.cancelPaymentAtomic({ companyId: 'company-1', expenseId: 'expense-1', paymentId: state.payments[0].id, actorUserId: 'another-finance', scopes: {}, reason: 'จ่ายผิด' });
    await assert.rejects(() => useCase.execute(actor, 'expense-1', input), (e: any) => e.getResponse?.().code === 'expense_payment_cancelled_replay');
    assert.equal(state.payments.length, 1); assert.equal(state.events.length, 1); assert.equal(state.expense.paidAmount, '0.0000');
    await useCase.execute(actor, 'expense-1', { ...input, idempotencyKey: randomUUID() });
    assert.equal(state.payments.length, 2); assert.equal(state.events.length, 2); assert.equal(state.expense.paidAmount, '40.0000');
  });
  it('appends each payment, accumulates the header, and preserves accrual posting state', async () => {
    const { repo, state } = harness();
    const first = await pay(repo, '40.00');
    const second = await pay(repo, '60.00');

    assert.equal(first.expense.paidAmount, '40.0000');
    assert.equal(first.expense.paymentStatus, 'PARTIALLY_PAID');
    assert.equal(second.expense.paidAmount, '100.0000');
    assert.equal(second.expense.outstandingAmount, '0.0000');
    assert.equal(second.expense.paymentStatus, 'PAID');
    assert.equal(state.expense.postingStatus, 'posted');
    assert.deepEqual(state.payments.map((payment) => payment.amount), ['40.0000', '60.0000']);
  });

  it('rejects overpayment without appending or changing the cumulative total', async () => {
    const { repo, state } = harness({ paidAmount: '80.0000', outstandingAmount: '20.0000', paymentStatus: 'PARTIALLY_PAID' });
    await assert.rejects(
      () => pay(repo, '20.01'),
      (error: unknown) => error instanceof BadRequestException
        && (error.getResponse() as any).code === 'expense_payment_exceeds_outstanding',
    );
    assert.equal(state.expense.paidAmount, '80.0000');
    assert.equal(state.payments.length, 0);
  });

  it('returns the stable validation error for a malformed amount', async () => {
    const { repo, state } = harness();
    await assert.rejects(
      () => pay(repo, 'not-a-number'),
      (error: unknown) => error instanceof BadRequestException
        && (error.getResponse() as any).code === 'expense_payment_exceeds_outstanding',
    );
    assert.equal(state.payments.length, 0);
  });

  it('rolls the payment row back when the aggregate CAS loses', async () => {
    const { repo, state, failNextCas } = harness();
    failNextCas();
    await assert.rejects(
      () => pay(repo, '40.00'),
      (error: unknown) => error instanceof ConflictException
        && (error.getResponse() as any).code === 'expense_payment_changed',
    );
    assert.equal(state.expense.paidAmount, '0.0000');
    assert.equal(state.payments.length, 0);
  });

  // FIN-01: pre-satang-policy rows carry a 4dp payable. The document, the UI and the payment
  // input all show its 2dp rounding, so paying that figure has to settle the row — otherwise
  // finance sees an outstanding balance of ฿0.00 on a row the system still calls PARTIALLY_PAID,
  // and the overshoot guard leaves no amount that can ever close it.
  it('settles a legacy 4dp payable when the displayed satang amount is paid', async () => {
    const { repo, state } = harness({ netPayableAmount: '580.0042', outstandingAmount: '580.0042' });
    const { expense: paid } = await pay(repo, '580.00');

    assert.equal(paid.outstandingAmount, '0.0000');
    assert.equal(paid.paymentStatus, 'PAID');
    assert.equal(state.expense.paidAmount, '580.0000');
  });

  it('accepts the rounded-up satang amount of a legacy payable that rounds up', async () => {
    const { repo } = harness({ netPayableAmount: '580.0062', outstandingAmount: '580.0062' });
    const { expense: paid } = await pay(repo, '580.01');

    assert.equal(paid.outstandingAmount, '0.0000');
    assert.equal(paid.paymentStatus, 'PAID');
  });

  it('keeps a real one-satang shortfall partially paid', async () => {
    const { repo } = harness({ netPayableAmount: '580.0100', outstandingAmount: '580.0100' });
    const { expense: paid } = await pay(repo, '580.00');

    assert.equal(paid.outstandingAmount, '0.0100');
    assert.equal(paid.paymentStatus, 'PARTIALLY_PAID');
  });

  it('refuses an overpayment a full satang past the payable', async () => {
    const { repo, state } = harness({ netPayableAmount: '580.0062', outstandingAmount: '580.0062' });
    await assert.rejects(
      () => pay(repo, '580.02'),
      (error: unknown) => error instanceof BadRequestException
        && (error.getResponse() as any).code === 'expense_payment_exceeds_outstanding',
    );
    assert.equal(state.expense.paidAmount, '0.0000');
    assert.equal(state.payments.length, 0);
  });

  it('blocks direct settlement of a claim-born expense', async () => {
    const { repo, state } = harness({ sourceReimbursementRequestId: 'reimbursement-1' });
    await assert.rejects(
      () => pay(repo, '40.00'),
      (error: unknown) => error instanceof BadRequestException
        && (error.getResponse() as any).code === 'claim_expense_settles_via_reimbursement',
    );
    assert.equal(state.payments.length, 0);
  });

  it('replays equivalent money/reference without another row, totals increment, or hook', async () => {
    const { repo, state } = harness();
    let hooks = 0;
    const input = paymentInput('40', { bankAccountRef: ' BANK-1 ' });
    const first = await repo.recordPaymentAtomic(input, async () => { hooks += 1; });
    const replay = await repo.recordPaymentAtomic({ ...input, amount: '40.00', bankAccountRef: 'BANK-1' }, async () => { hooks += 1; });
    assert.equal(replay.payment.id, first.payment.id);
    assert.equal(replay.replayed, true);
    assert.equal(replay.expense.paidAmount, '40.0000');
    assert.equal(state.payments.length, 1);
    assert.equal(hooks, 1);
  });

  it('keeps an omitted legacy date stable instead of assigning a new instant on replay', async () => {
    const { repo, state } = harness();
    const input = paymentInput('40', { paidAt: undefined });
    const first = await repo.recordPaymentAtomic(input);
    const replay = await repo.recordPaymentAtomic(input);
    assert.equal(replay.payment.paidAt.getTime(), first.payment.paidAt.getTime());
    assert.equal(state.payments.length, 1);
  });

  it('normalizes legacy optional null/blank fields and preserves an already-posted payment on replay', async () => {
    const { repo, state } = harness();
    const input = paymentInput('40', { paidAt: undefined, paymentMethod: undefined, bankAccountRef: undefined });
    await repo.recordPaymentAtomic(input);
    Object.assign(state.payments[0], { postingStatus: 'posted', journalEntryId: 'original-journal' });
    const replay = await repo.recordPaymentAtomic({ ...input, paidAt: null, paymentMethod: null, bankAccountRef: '  ' } as any);
    assert.equal(replay.replayed, true);
    assert.equal(replay.payment.postingStatus, 'posted');
    assert.equal(replay.payment.journalEntryId, 'original-journal');
    assert.equal(state.payments.length, 1);
  });

  it('returns 409 for each changed canonical field, without rounding a distinct satang into a replay', async () => {
    const { repo, state } = harness();
    const input = paymentInput('40.00');
    await repo.recordPaymentAtomic(input);
    for (const change of [{ amount: '40.01' }, { paidAt: '2026-08-09' }, { paidAt: undefined }, { paymentMethod: 'CASH' }, { bankAccountRef: 'BANK-2' }]) {
      await assert.rejects(() => repo.recordPaymentAtomic({ ...input, ...change }), (error: any) => error.getStatus?.() === 409 && error.getResponse().code === 'expense_payment_idempotency_conflict');
    }
    assert.equal(state.payments.length, 1);
    assert.equal(state.expense.paidAmount, '40.0000');
  });

  it('allows a genuine equal-value second payment with a new key', async () => {
    const { repo, state } = harness();
    await pay(repo, '40');
    await pay(repo, '40');
    assert.equal(state.payments.length, 2);
    assert.equal(state.expense.paidAmount, '80.0000');
  });

  it('rechecks tenant and branch at the final transaction boundary before replay', async () => {
    const { repo, state } = harness({ branchId: 'branch-1' });
    const input = paymentInput('40', { scopes: { branchIds: ['branch-1'] } });
    await repo.recordPaymentAtomic(input);
    await assert.rejects(() => repo.recordPaymentAtomic({ ...input, companyId: 'foreign-company' }), NotFoundException);
    await assert.rejects(() => repo.recordPaymentAtomic({ ...input, scopes: { branchIds: ['branch-2'] } }), ForbiddenException);
    Object.assign(state.expense, { branchId: 'branch-2' });
    await assert.rejects(() => repo.recordPaymentAtomic(input), ForbiddenException);
    assert.equal(state.payments.length, 1);
  });

  it('replays a voided source as its current voided state and never reapplies settlement', async () => {
    const { repo, state } = harness();
    const input = paymentInput('40');
    await repo.recordPaymentAtomic(input);
    Object.assign(state.expense, { status: 'VOIDED', paidAmount: '0.0000', outstandingAmount: '0.0000' });
    state.payments[0].status = 'VOIDED';
    const result = await repo.recordPaymentAtomic(input, async () => { assert.fail('no replay side effects'); });
    assert.equal(result.expense.status, 'VOIDED');
    assert.equal(result.expense.paidAmount, '0.0000');
    assert.equal(result.payment.status, 'VOIDED');
    assert.equal(state.payments.length, 1);
  });

  it('refuses invalid dates and money without writes, while accepting leading zeros', async () => {
    const { repo, state } = harness();
    for (const amount of ['40.0001', '4e1', 'NaN', 'Infinity', '0', '-1']) {
      await assert.rejects(() => pay(repo, amount), BadRequestException);
    }
    for (const paidAt of ['2026-02-30', '2026-08-10T00:00:00Z', '2569-08-10', '']) {
      await assert.rejects(() => pay(repo, '40', { paidAt }), BadRequestException);
    }
    assert.equal(state.payments.length, 0);
    await pay(repo, '01'); assert.equal(Number(state.payments[0].amount), 1);
  });

  for (const failedWrite of ['audit', 'outbox'] as const) {
    it(`rolls payment, totals, and all earlier side effects back when ${failedWrite} fails`, async () => {
      const { repo, state, failWrite } = harness();
      failWrite(failedWrite);
      const audit = { log: async (entry: any, tx: any) => tx.auditLog.create({ data: entry }) } as any;
      const useCase = new RecordExpensePaymentUseCase(repo, audit);
      await assert.rejects(() => useCase.execute({ companyId: 'company-1', userId: 'finance-1', requestId: 'request-1', permissions: ['expense.payment.record'], scopes: {} } as any,
        'expense-1', { paidAmount: '40', idempotencyKey: 'atomic-intent' }), new RegExp(`${failedWrite} unavailable`));
      assert.equal(state.expense.paidAmount, '0.0000');
      assert.equal(state.payments.length, 0);
      assert.equal(state.audits.length, 0);
      assert.equal(state.events.length, 0);
    });
  }
});

describe('Expense payment intent integrity (real PostgreSQL)', () => {
  const required = process.env.EXPENSE_PAYMENT_REQUIRE_POSTGRES === 'true';
  const companyId = `expense-intent-pg-${randomUUID()}`;
  const userId = `${companyId}-user`;
  const branchId = `${companyId}-branch`;
  let clients: PrismaClient[] = [];
  let ready = false;
  let fixtureCreated = false;
  let unreachable: string | null = null;

  before(async () => {
    const url = process.env.DATABASE_URL;
    if (!url) {
      assert.equal(required, false, 'Expense payment PostgreSQL is required but DATABASE_URL is unavailable');
      return;
    }
    clients = [0, 1].map(() => new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }));
    // A supplied but unavailable/unmigrated database skips on a developer machine and fails in CI.
    unreachable = await pgSpecUnreachableReason(
      () => clients[0]!.$queryRaw`SELECT "idempotencyKey", "payloadFingerprint" FROM "ExpensePayment" LIMIT 0`,
      'EXPENSE_PAYMENT_REQUIRE_POSTGRES',
    );
    if (unreachable) return;
    await clients[0]!.company.create({ data: { id: companyId, name: 'Synthetic expense intent tests', registeredName: 'บริษัทผู้จ่ายทดสอบ จำกัด' } });
    fixtureCreated = true;
    await clients[0]!.user.create({ data: { id: userId, displayName: 'Synthetic payment tester' } });
    await clients[0]!.branch.create({ data: { id: branchId, companyId, code: 'HO', name: 'Source branch', type: 'HEAD_OFFICE', createdByUserId: userId } });
    ready = true;
  });

  after(async () => {
    const client = clients[0];
    if (!client) return;
    try {
      if (fixtureCreated) {
        await client.auditLog.deleteMany({ where: { companyId } });
        await client.outboxEvent.deleteMany({ where: { companyId } });
        await client.expensePayment.deleteMany({ where: { companyId } });
        await client.expenseRecord.deleteMany({ where: { companyId } });
        await client.company.deleteMany({ where: { id: companyId } });
        await client.user.deleteMany({ where: { id: userId } });
      }
    } finally {
      await Promise.all(clients.map((client) => client.$disconnect()));
    }
  });

  const context = () => ({ companyId, userId, requestId: randomUUID(), permissions: ['expense.payment.record'], scopes: {} } as any);
  const useCase = (client: PrismaClient, audit?: AuditService) => new RecordExpensePaymentUseCase(
    new PrismaExpenseRepository({ client } as any),
    audit ?? new AuditService(new PrismaAuditRepository({ client } as any), { error: () => undefined } as any),
  );

  it('R7 all AI expense projections share one deduplicated snapshot', async (t) => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const client = clients[0]!;
    const co = await client.company.create({ data: { name: 'R7 filtered population' } });
    const other = await client.company.create({ data: { name: 'R7 other tenant' } });
    try {
      const branch = await client.branch.create({ data: { companyId: co.id, code: 'A', name: 'A' } });
      const hidden = await client.branch.create({ data: { companyId: co.id, code: 'B', name: 'B' } });
      const category = await client.expenseCategory.create({ data: { companyId: co.id, name: 'ค่าเดินทาง', accountHintKey: 'travel' } });
      const vendor = await client.accountingCounterparty.create({ data: { companyId: co.id, type: 'VENDOR', displayName: 'ผู้ขาย', createdByUserId: userId } });
      const source = await client.expenseRecord.create({ data: { companyId: co.id, branchId: branch.id, createdByUserId: userId, status: 'NEEDS_REVIEW',
        expenseDate: new Date('2026-10-20T00:00:00Z'), grandTotalAmount: '1000', expenseCategoryId: category.id, vendorCounterpartyId: vendor.id, paymentStatus: 'UNPAID' } });
      await client.expenseRecord.create({ data: { companyId: co.id, branchId: branch.id, createdByUserId: userId, status: 'NEEDS_REVIEW', expenseDate: new Date('2026-10-21T00:00:00Z'), grandTotalAmount: '200', netPayableAmount: '200', paidAmount: '200', paymentStatus: 'PAID' } });
      const request = await client.reimbursementRequest.create({ data: { companyId: co.id, branchId: branch.id, requesterUserId: userId, requesterDisplayNameSnapshot: 'ผู้เบิก', createdByUserId: userId,
        reason: 'R7', categoryKey: 'travel', amount: '1000', incurredDate: source.expenseDate, status: 'APPROVED',
        // The insert trigger writes line 1 from the header (ensure_reimbursement_request_fallback_line).
        linkedExpenseId: source.id }, include: { lines: true } });
      const filter = { companyId: co.id, fromDate: '2026-10-01', toDate: '2026-10-31' };
      const repo = new PrismaExpenseRepository({ client } as any);
      const check = async (expected: string, extra: any = {}, scope: any = { branchIds: [branch.id] }) => {
        const f = { ...filter, ...extra };
        const summary = await repo.readAiExpenseSummary(f, scope, 1);
        const breakdown = await repo.readAiExpenseBreakdown(f, scope);
        for (const groupBy of ['category', 'vendor', 'day'] as const) {
          const groups = await repo.readAiExpenseGroups(f, scope, groupBy, 1, 0);
          assert.equal(new Decimal(groups.byCurrency.find(r => r.currency === 'THB')!.totalAmount).toFixed(2), expected, groupBy);
          assert.deepEqual(groups.byCurrency, breakdown.byCurrency);
        }
        assert.equal(new Decimal(summary.byCurrency.find(r => r.currency === 'THB')!.totalAmount).toFixed(2), expected);
        assert.equal(summary.total, breakdown.byCurrency.reduce((sum, r) => sum + r.count, 0));
        assert.equal(summary.byStatus.reduce((sum, r) => sum + r.count, 0), summary.total);
        return summary;
      };
      await check('1200.00'); // Before projection/approval materialization the source stays.
      const projection = await client.expenseRecord.create({ data: { companyId: co.id, branchId: branch.id, createdByUserId: userId, status: 'CONFIRMED',
        sourceReimbursementRequestId: request.id, sourceReimbursementLineId: request.lines[0]!.id,
        expenseDate: new Date('2026-10-10T00:00:00Z'), grandTotalAmount: '1000', paymentStatus: 'PAID' } });
      const summary = await check('1200.00');
      assert.equal(summary.items[0]!.grandTotalAmount, '200', 'projection outside page still replaces source');
      const next = await repo.readAiExpenseSummary(filter, { branchIds: [branch.id] }, 1, summary.nextCursorSource!);
      assert.equal(next.items[0]!.id, projection.id); assert.equal(next.total, 2);
      for (const extra of [{ status: 'NEEDS_REVIEW' }, { expenseCategoryId: category.id }, { vendorCounterpartyId: vendor.id }, { paymentStatus: 'UNPAID' }, { fromDate: '2026-10-20', toDate: '2026-10-20' }]) {
        await check(extra.status ? '1200.00' : '1000.00', extra);
      }
      for (const change of [{ status: 'VOIDED' }, { branchId: hidden.id }, { createdByUserId: `${userId}-other` }, { expenseDate: new Date('2026-09-30T00:00:00Z') }]) {
        await client.expenseRecord.update({ where: { id: projection.id }, data: change as any });
        await check('1200.00', change.createdByUserId ? { createdByUserId: userId } : {});
        await check('1200.00', {}, { branchIds: [branch.id], relatedUserId: userId });
        await client.expenseRecord.update({ where: { id: projection.id }, data: { status: 'CONFIRMED', branchId: branch.id, createdByUserId: userId, expenseDate: new Date('2026-10-10T00:00:00Z') } });
      }
      await client.expenseRecord.create({ data: { companyId: other.id, createdByUserId: userId, status: 'CONFIRMED', expenseDate: source.expenseDate, grandTotalAmount: '9999' } });
      await client.expenseRecord.create({ data: { companyId: co.id, branchId: branch.id, createdByUserId: userId, status: 'CONFIRMED', expenseDate: source.expenseDate, grandTotalAmount: '50', currency: 'USD' } });
      const currencies = await check('1200.00');
      assert.equal(currencies.byCurrency.find(r => r.currency === 'USD')!.totalAmount, '50');
      // Establish the read snapshot, then commit a projection on another connection before the reads continue.
      await client.expenseRecord.delete({ where: { id: projection.id } });
      let inserted = false;
      const snapshotClient = { $transaction: (fn: any, options: any) => client.$transaction(async tx => fn(new Proxy(tx, { get(target, key) {
        if (key === '$queryRaw') return async (...args: any[]) => {
          const stamp = await (target.$queryRaw as any)(...args);
          if (!inserted) {
            inserted = true;
            await clients[1]!.expenseRecord.create({ data: { companyId: co.id, branchId: branch.id, createdByUserId: userId, status: 'CONFIRMED', expenseDate: projection.expenseDate,
              grandTotalAmount: '1000', sourceReimbursementRequestId: request.id, sourceReimbursementLineId: request.lines[0]!.id } });
          }
          return stamp;
        };
        const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
      } })), options) };
      const beforeInsert = await new PrismaExpenseRepository({ client: snapshotClient } as any).readAiExpenseSummary(filter, {}, 10);
      assert.equal(beforeInsert.total, 3); assert.ok(beforeInsert.items.some(r => r.id === source.id));
      assert.equal((await check('1200.00')).total, 3);
      assert.equal((await client.expenseRecord.findUniqueOrThrow({ where: { id: source.id } })).status, 'NEEDS_REVIEW', 'read does not mutate source status');
    } finally {
      await client.expenseRecord.deleteMany({ where: { companyId: co.id, sourceReimbursementLineId: { not: null } } });
      await client.company.deleteMany({ where: { id: { in: [co.id, other.id] } } });
    }
  });

  async function vatDraftFixture() {
    const client = clients[0]!;
    const co = await client.company.create({ data: { name: 'VAT decision ledger test' } });
    const branch = await client.branch.create({ data: { companyId: co.id, code: 'HO', name: 'สำนักงานใหญ่' } });
    const s = { companyId: co.id, branchId: branch.id, userId };
    const ledger = new PrismaLedgerRepository({ client } as any);
    const expenses = new PrismaExpenseRepository({ client } as any);
    const incurred = new Date('2026-09-15');
    const accountant = () => ({ ...context(), companyId: co.id, permissions: ['expense.review'] });
    await client.chartOfAccount.create({ data: { companyId: co.id, code: '5310-01', nameTh: 'ค่าใช้จ่าย', accountClass: 'EXPENSE', normalBalance: 'DEBIT' } });
    await client.company.update({ where: { id: s.companyId }, data: { taxId: '0100000000002', registeredName: 'ร้านทดสอบ' } });
    await client.companyVatRegistrationFact.create({ data: { companyId: s.companyId, status: 'REGISTERED', effectiveFrom: new Date('2020-01-01'), source: 'USER_ANSWER' } });
    const inputAccount = await client.chartOfAccount.create({ data: { companyId: s.companyId, code: '1280-00', nameTh: 'ภาษีซื้อ', accountClass: 'ASSET', normalBalance: 'DEBIT' } });
    await client.chartOfAccount.create({ data: { companyId: s.companyId, code: '2120-01', nameTh: 'เจ้าหนี้', accountClass: 'LIABILITY', normalBalance: 'CREDIT' } });
    const paper = await client.attachmentObject.create({ data: { companyId: s.companyId, storageProvider: 'local', bucket: 'test', objectKey: randomUUID(), originalFileName: 'receipt.pdf', mimeType: 'application/pdf', byteSize: 1, status: 'ACTIVE', uploadedByUserId: s.userId } });
    const component = { componentKey: 'VAT', snapshot: { externalTaxCode: 'I1', taxRegime: 'VAT', taxDirection: 'INPUT', taxTreatment: 'STANDARD', taxContext: 'DOMESTIC_PURCHASE',
      taxCurrency: 'THB', sourceCurrency: 'THB', exchangeRate: '1', taxAmount: '7', taxBaseAmount: '100', taxRate: '7', claimability: 'CLAIMABLE', evidenceStatus: 'VERIFIED' },
      accountAssignments: [{ accountId: inputAccount.id, accountRole: 'INPUT_VAT_CLAIMABLE', postingSide: 'DEBIT', ruleVersion: 1 }], reportContributions: [] };
    // Confirmation is fixture setup here, as in the existing posting tests above.
    const expense = await client.expenseRecord.create({ data: { companyId: s.companyId, branchId: s.branchId, createdByUserId: s.userId, status: 'CONFIRMED', confirmedAt: new Date(),
      expenseDate: incurred, sourceDocumentType: 'TAX_INVOICE', vatMode: 'VAT_EXCLUDED', vatAmount: '7', grandTotalAmount: '107', netPayableAmount: '107',
      inputVatClaimStatus: 'NEEDS_REVIEW', taxEvidenceStatus: 'USABLE_FOR_TAX', vendorTaxIdSnapshot: '0100000000001', vendorDocumentNumber: 'INV-1', primaryAttachmentId: paper.id,
      buyerAsPrintedJson: { name: 'ร้านทดสอบ', taxId: '0100000000002' }, lines: { create: [{ companyId: s.companyId, lineNumber: 1, description: 'ซื้อของ', quantity: '1', unitPrice: '100', taxableAmount: '100', vatAmount: '7', taxComponentsJson: [component] }] } } });
    const period = await ledger.upsertPeriod(s.companyId, '2026-09', incurred, new Date('2026-09-30'));
    const source = asLedgerSource({ ...(await expenses.findByIdWithRelations(s.companyId, expense.id)), sourceType: 'expense.record', sourceId: expense.id });
    const { resolvedLines } = await buildJournalLines(accountant(), source, await client.company.findUniqueOrThrow({ where: { id: s.companyId } }), ledger, client);
    const draft = await ledger.createJournalEntry({ companyId: s.companyId, periodId: period.id, entryNumber: `JV-${randomUUID()}`, entryType: 'GENERATED',
      sourceType: 'expense.record', sourceId: expense.id, entryDate: incurred, createdByUserId: s.userId, lines: resolvedLines });
    const input = { toStatus: 'CLAIMABLE' as const, reviewerConditions: ['BUSINESS_USE', 'NOT_PROHIBITED', 'ISSUER_ENTITLED'] };
    const ctx = { ...accountant(), permissions: ['expense.review'] };
    const read = () => client.journalEntry.findUniqueOrThrow({ where: { id: draft.id }, include: { lines: true } });
    const check = async (claimable: boolean) => {
      const row = await read();
      assert.equal(row.lines.some(l => l.accountId === inputAccount.id), claimable);
      assert.equal(row.lines.reduce((sum, l) => sum.add(l.debitAmount.toString()).sub(l.creditAmount.toString()), new Decimal(0)).toString(), '0');
    };
    const cleanup = async () => { await client.auditLog.deleteMany({ where: { companyId: co.id } }); await client.company.delete({ where: { id: co.id } }); };
    return { s, expense, draft, input, ctx, read, check, client, ledger, expenses, cleanup };
  }

  it('VAT decisions rebuild a real draft atomically, and a failed transaction restores its right, audit and lines', async (t) => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const h = await vatDraftFixture();
    const { client, expenses, ledger } = h;
    try {
      await h.check(false);
      const failing = new PrismaExpenseRepository({ client: { $transaction: (fn: any) => client.$transaction(async tx => { await fn(tx); throw new Error('rollback decision'); }) } } as any);
      await assert.rejects(() => failing.decideInputVat(h.ctx, h.expense.id, h.input), /rollback decision/);
      await h.check(false);
      assert.equal(await client.expenseInputVatDecision.count({ where: { expenseId: h.expense.id } }), 0);
      assert.equal(await client.auditLog.count({ where: { companyId: h.s.companyId, action: 'expense.input_vat.decide' } }), 0);
      assert.equal((await client.expenseRecord.findUniqueOrThrow({ where: { id: h.expense.id } })).inputVatClaimStatus, 'NEEDS_REVIEW');
      await expenses.decideInputVat(h.ctx, h.expense.id, h.input); await h.check(true);
      await expenses.decideInputVat(h.ctx, h.expense.id, { toStatus: 'NON_CLAIMABLE', reason: 'ใช้ส่วนตัว' }); await h.check(false);
      assert.equal((await h.read()).status, 'DRAFT');
    } finally { await h.cleanup(); }
  });

  it('posting and deciding concurrently leave a posted journal matching the committed VAT right', async (t) => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const h = await vatDraftFixture();
    const { client, expenses, ledger } = h;
    try {
      const [decision, posted] = await Promise.allSettled([expenses.decideInputVat(h.ctx, h.expense.id, h.input), ledger.postJournalEntry(h.draft.id, h.s.userId)]);
      assert.equal(posted.status, 'fulfilled');
      if (decision.status === 'rejected') assert.equal(decision.reason.getResponse().code, 'input_vat_posted_journal_immutable');
      const expense = await client.expenseRecord.findUniqueOrThrow({ where: { id: h.expense.id } });
      await h.check(expense.inputVatClaimStatus === 'CLAIMABLE');
      assert.equal((await h.read()).status, 'POSTED');
    } finally { await h.cleanup(); }
  });


  it('migrates only undecided open VAT invoices and abbreviated evidence, without inventing decisions', async (t) => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const rollback = new Error('rollback migration fixtures');
    await assert.rejects(() => clients[0]!.$transaction(async (tx) => {
      const co = `vat-migration-${randomUUID()}`;
      await tx.company.create({ data: { id: co, name: 'ทดสอบย้ายสิทธิภาษีซื้อ' } });
      await tx.companyVatRegistrationFact.createMany({ data: [
        { companyId: co, status: 'NOT_REGISTERED', effectiveFrom: new Date('2020-01-01'), effectiveTo: new Date('2025-01-01'), source: 'USER_ANSWER' },
        { companyId: co, status: 'REGISTERED', effectiveFrom: new Date('2025-01-01'), source: 'USER_ANSWER' },
      ] });
      const make = (overrides: any = {}) => tx.expenseRecord.create({ data: { companyId: co, createdByUserId: userId, status: 'NEEDS_REVIEW',
        expenseDate: new Date('2026-10-14'), sourceDocumentType: 'TAX_INVOICE', vatMode: 'VAT_EXCLUDED', vatAmount: '7', inputVatClaimStatus: 'NON_CLAIMABLE', ...overrides } });
      const open = await Promise.all(['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'].map(status => make({ status })));
      const unchanged = await Promise.all([
        ...['CONFIRMED', 'VOIDED', 'REJECTED'].map(status => make({ status })),
        make({ vatAmount: '0' }), make({ vatMode: 'NO_VAT' }), make({ expenseDate: new Date('2024-10-01') }),
        make({ buyerAsPrintedJson: { claimStatusBeforeMark: 'NEEDS_REVIEW' } }),
        make({ aiVerificationSummaryJson: { documentEvidenceDraft: { route: 'SUBSTITUTE_RECEIPT' } } }),
      ]);
      const claimed = await make(); unchanged.push(claimed);
      const request = await tx.reimbursementRequest.create({ data: { companyId: co, requesterUserId: userId,
        requesterDisplayNameSnapshot: 'ผู้เบิก', reason: 'ทดสอบ', categoryKey: 'OTHER', amount: '107', incurredDate: new Date('2026-10-14'), createdByUserId: userId } });
      // The table's trigger already wrote the request's fallback line 1: point it at the expense.
      await tx.reimbursementLine.updateMany({ where: { reimbursementRequestId: request.id, lineNo: 1 }, data: { linkedExpenseId: claimed.id } });
      const abbreviated = await make({ sourceDocumentType: 'ABBREVIATED_TAX_INVOICE', taxEvidenceStatus: 'SUPPORTING_ONLY', taxEvidenceReasonCode: 'ABBREVIATED_TAX_INVOICE_NOT_CREDITABLE' });
      const sql = readFileSync('prisma/migrations/20261014120100_migrate_open_input_vat_rights/migration.sql', 'utf8');
      await tx.$executeRawUnsafe(sql);
      for (const row of open) assert.equal((await tx.expenseRecord.findUniqueOrThrow({ where: { id: row.id } })).inputVatClaimStatus, 'NEEDS_REVIEW');
      for (const row of unchanged) assert.equal((await tx.expenseRecord.findUniqueOrThrow({ where: { id: row.id } })).inputVatClaimStatus, 'NON_CLAIMABLE');
      const after = await tx.expenseRecord.findUniqueOrThrow({ where: { id: abbreviated.id } });
      assert.equal(after.taxEvidenceStatus, 'USABLE_FOR_TAX'); assert.equal(after.taxEvidenceReasonCode, 'VALID_RECEIPT_FIELDS');
      assert.equal(await tx.expenseInputVatDecision.count({ where: { companyId: co } }), 0);
      await tx.$executeRawUnsafe(sql); // Idempotent: already moved rows and retained records stay put.
      assert.equal(await tx.expenseRecord.count({ where: { companyId: co, inputVatClaimStatus: 'NEEDS_REVIEW' } }), open.length);
      throw rollback;
    }), (error: unknown) => error === rollback);
  });

  it('stores both additive VAT document enums and recomputes open expenses in the shop-answer transaction', async (t) => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const client = clients[0]!;
    const companyId = `input-vat-${randomUUID()}`;
    await client.company.create({ data: { id: companyId, name: 'Input VAT transaction test' } });
    const branchId = `${companyId}-branch`;
    await client.branch.create({ data: { id: branchId, companyId, code: 'HO', name: 'สำนักงานใหญ่' } });
    const ctx = () => ({ ...context(), companyId });
    const TODAY = '2026-10-14';
    const draft = async () => (await client.expenseRecord.create({ data: { companyId, createdByUserId: userId, status: 'NEEDS_REVIEW', expenseDate: new Date(TODAY) } })).id;
    const audit = () => new AuditService(new PrismaAuditRepository({ client } as any), { error: () => undefined } as any);
    try {
    const ids: string[] = [];
    for (const sourceDocumentType of ['CUSTOMS_VAT_RECEIPT', 'PP36_RECEIPT'] as const) {
      const id = await draft(); ids.push(id);
      await client.expenseRecord.update({ where: { id }, data: { sourceDocumentType, vatMode: 'VAT_INCLUDED', vatAmount: '7' } });
    }
    const confirmed = await draft();
    await client.expenseRecord.update({ where: { id: confirmed }, data: { status: 'CONFIRMED', sourceDocumentType: 'TAX_INVOICE', vatMode: 'VAT_INCLUDED', vatAmount: '7', inputVatClaimStatus: 'CLAIMABLE' } });
    const useCase = new CompanyVatRegistrationUseCase({ client } as any, audit());
    const answer = (status: 'REGISTERED' | 'NOT_REGISTERED', expectedVersion: number) => ({ commandId: randomUUID(), expectedVersion,
      command: { kind: 'UPSERT_FACT' as const, status, effectiveFrom: '2020-01-01' } });
    await useCase.put(ctx(), companyId, answer('REGISTERED', 0));
    for (const id of ids) assert.equal((await client.expenseRecord.findUniqueOrThrow({ where: { id } })).inputVatClaimStatus, 'NEEDS_REVIEW');
    const rollback = new CompanyVatRegistrationUseCase({ client } as any, { log: async () => { throw new Error('audit rollback'); } } as any);
    await assert.rejects(() => rollback.put(ctx(), companyId, answer('NOT_REGISTERED', 1)), /audit rollback/);
    assert.equal((await useCase.get(companyId, TODAY)).status, 'REGISTERED');
    for (const id of ids) assert.equal((await client.expenseRecord.findUniqueOrThrow({ where: { id } })).inputVatClaimStatus, 'NEEDS_REVIEW');
    const [, concurrent] = await Promise.all([
      useCase.put(ctx(), companyId, answer('NOT_REGISTERED', 1)),
      new PrismaExpenseRepository({ client } as any).createExpense({ companyId, branchId, createdByUserId: userId, captureSource: 'WEB_UPLOAD', expenseDate: new Date(TODAY), sourceDocumentType: 'TAX_INVOICE', vatMode: 'VAT_INCLUDED', vatAmount: '7', inputVatClaimStatus: 'NEEDS_REVIEW', subtotalAmount: '100', discountAmount: '0', taxableAmount: '100', whtAmount: '0', grandTotalAmount: '107', netPayableAmount: '107', outstandingAmount: '107' }),
    ]);
    ids.push(concurrent.id);
    for (const id of ids) assert.equal((await client.expenseRecord.findUniqueOrThrow({ where: { id } })).inputVatClaimStatus, 'NON_CLAIMABLE');
    assert.equal((await client.expenseRecord.findUniqueOrThrow({ where: { id: confirmed } })).inputVatClaimStatus, 'CLAIMABLE');
    } finally {
      await client.auditLog.deleteMany({ where: { companyId } });
      await client.company.delete({ where: { id: companyId } });
    }
  });

  it('S1 seed rent is paid, tax-ready, idempotent and can be reopened and confirmed again', async t => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const client = clients[0]!;
    const owner = { companyId, branchId, ownerUserId: userId };
    const categoryId = `${companyId}-seed-rent-category`;
    await client.expenseCategory.create({ data: { id: categoryId, companyId, name: 'ค่าเช่า', accountHintKey: 'expense.rent' } });
    await client.whtIncomeCategory.upsert({ where: { code: 'WHT_RENT_JUR' }, update: {},
      create: { code: 'WHT_RENT_JUR', nameTh: 'ค่าเช่า (นิติบุคคล)', formType: 'PND53', defaultRate: '5', status: 'ACTIVE' } });
    const rent = seedExpenseRows((offset, hour) => new Date(Date.UTC(2026, 9, 13 + offset, hour)))
      .find(row => row.id === 'seed-expense-record-rent')!;
    // Isolated identities; the fixture's money, payee and source-document facts stay unchanged.
    const row = { ...rent, id: `${companyId}-seed-expense-record-rent`, lineId: `${companyId}-seed-rent-line`, categoryId } as any;
    await seedExpenses(client, owner, [row]);
    const snapshot = () => client.expenseRecord.findUniqueOrThrow({ where: { id: row.id }, include: { lines: true, payments: true } });
    const first = await snapshot();
    assert.equal(first.status, 'CONFIRMED');
    assert.equal(first.paymentStatus, 'PAID');
    assert.equal(first.paidAmount.toFixed(2), '28500.00');
    assert.equal(first.outstandingAmount.toFixed(2), '0.00');
    assert.equal(first.payments.length, 1);
    assert.equal(first.payments[0]!.amount.toFixed(2), '28500.00');
    assert.equal(first.lines[0]!.whtRate!.toFixed(4), '0.0500');
    const handoff = await client.whtCertificateHandoff.findFirstOrThrow({ where: { companyId, sourcePaymentId: row.id } });
    assert.equal(handoff.status, 'REQUIRED');
    const prefill = handoff.prefillSnapshotJson as any;
    assert.equal(prefill.formType, 'PND53');
    assert.equal(prefill.incomeCategoryCode, 'WHT_RENT_JUR');
    assert.equal(Number(prefill.whtRate), 5);
    assert.equal(Number(prefill.grossAmount), 30000);
    assert.equal(Number(prefill.withheldAmount), 1500);
    assert.equal(prefill.payeeSnapshot.taxId, rent.vendorTaxIdSnapshot);
    assert.equal(prefill.payeeSnapshot.address, rent.vendorAddressSnapshot);
    const service = { client } as any;
    const repo = new PrismaExpenseRepository(service);
    assert.equal(expenseEvidenceConfirmationError((await repo.findByIdWithRelations(companyId, row.id))!), null);
    const file = await client.attachmentObject.findUniqueOrThrow({ where: { id: first.primaryAttachmentId! } });
    assert.equal(file.status, 'ACTIVE');
    assert.ok(file.objectVersionId);
    assert.match(file.checksumSha256!, /^[0-9a-f]{64}$/);
    assert.ok(file.byteSize > 0);
    const sync = new SyncTaxEventsUseCase(new PrismaTaxRepository(service), new AccountingDocumentSourceAdapter(service),
      new ExpenseSourceAdapter(service), new SupplierPaymentSourceAdapter(service));
    // Slice 5 W4: the seed writer copied the document date, so its payment stays off every paper until a real date is given.
    assert.equal(first.payments[0]!.paidAtConfirmed, false);
    await sync.execute(companyId, undefined, 'WHT');
    assert.equal(await client.taxEvent.count({ where: { companyId, sourceId: row.id, status: 'ACTIVE' } }), 0);
    await repo.confirmPaymentDateAtomic({ companyId, expenseId: row.id, paymentId: first.payments[0]!.id,
      paidAt: rent.date.toISOString().slice(0, 10), actorUserId: userId, scopes: {} }, async () => undefined);
    const dated = await snapshot();
    assert.equal(dated.payments[0]!.paidAtConfirmed, true);
    await sync.execute(companyId, undefined, 'WHT');
    const event = await client.taxEvent.findFirstOrThrow({ where: { companyId, sourceId: row.id, status: 'ACTIVE' } });
    assert.equal(event.eventType, 'WHT_PND53');
    assert.equal(event.sourceLineKey, `payment:${first.payments[0]!.id}`);
    assert.equal(event.taxableBase.toFixed(2), '30000.00');
    assert.equal(event.taxAmount.toFixed(2), '1500.00');
    assert.equal(await client.taxReviewIssue.count({ where: { companyId, sourceId: row.id, status: 'OPEN' } }), 0);

    await seedExpenses(client, owner, [{ ...row, date: new Date('2026-11-01') }]);
    await sync.execute(companyId, undefined, 'WHT');
    assert.deepEqual(await snapshot(), dated);
    assert.equal(await client.whtCertificateHandoff.count({ where: { companyId, sourcePaymentId: row.id } }), 1);
    assert.equal(await client.taxEvent.count({ where: { companyId, sourceId: row.id } }), 1);
    assert.equal(await client.auditLog.count({ where: { companyId, action: 'expense.confirm', targetId: row.id } }), 1);
    assert.equal(await client.auditLog.count({ where: { companyId, action: 'expense.payment.record', targetId: first.payments[0]!.id } }), 1);
    assert.equal(await client.outboxEvent.count({ where: { companyId, aggregateId: { in: [row.id, first.payments[0]!.id] } } }), 2);

    await repo.reopenExpenseAtomic({ companyId, expenseId: row.id, actorUserId: userId, scopes: {}, reason: 'ตรวจเอกสารอีกครั้ง', permissions: ['expense.confirm'] });
    await new MarkExpenseReadyUseCase(repo).execute({ ...context(), permissions: ['expense.review'] }, row.id);
    const source = (await repo.findByIdWithRelations(companyId, row.id))!;
    assert.equal(expenseEvidenceConfirmationError(source), null);
    await repo.finalizeAndConfirmExpenseCas({ companyId, id: row.id, actorUserId: userId,
      expectedUpdatedAt: source.updatedAt, expectedSourceChecksum: expenseTaxSourceChecksum(source),
      postingStatus: 'pending', vendorSnapshotJson: null, confirmationAudit: { requestId: 'seed-reconfirm' },
      outboxEvent: { eventKey: `${row.id}:reconfirm`, payloadJson: {} },
    }, async () => []);
    const reconfirmed = await snapshot();
    assert.equal(reconfirmed.status, 'CONFIRMED');
    assert.equal(reconfirmed.primaryAttachmentId, first.primaryAttachmentId);
    assert.equal(reconfirmed.payments.length, 1);
    assert.equal(await client.whtCertificateHandoff.count({ where: { companyId, sourcePaymentId: row.id, status: 'REQUIRED' } }), 1);
  });

  it('uses the same document month and missing-date upload fallback for list, evidence and folders', async t => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const client = clients[0]!;
    const repo = new PrismaExpenseRepository({ client } as any);
    const cases = [
      { summary: Prisma.DbNull, expected: '2026-09' },
      { summary: { dateStatus: 'verified', missingFields: ['expenseDate'] }, expected: '2026-09' },
      { summary: { dateStatus: 'assumed', missingFields: ['expenseDate'] }, expected: '2026-09' },
      { summary: { dateStatus: 'unverified' }, expected: '2026-10' },
      { summary: { dateStatus: 'implausible', missingFields: ['expenseDate'] }, expected: '2026-09' },
      { summary: { missingFields: ['expenseDate'] }, expected: '2026-10' },
      { summary: { missingFields: [] }, expected: '2026-09' },
      { summary: { dateStatus: 'implausible', missingFields: ['expenseDate'] }, expenseDate: '2024-03-18', expected: '2024-03' },
      { summary: { dateStatus: 'implausible' }, expenseDate: '2028-03-18', expected: '2028-03' },
    ];
    const rows = [];
    for (const item of cases) rows.push(await client.expenseRecord.create({ data: {
      companyId, branchId, createdByUserId: userId, captureSource: 'WEB_UPLOAD', status: 'CONFIRMED',
      expenseDate: new Date(item.expenseDate ?? '2026-09-30'), uploadedAt: new Date('2026-10-01T17:30:00Z'), aiVerificationSummaryJson: item.summary,
    } }));
    const ids = rows.map(row => row.id);
    for (const month of ['2024-03', '2026-09', '2026-10', '2028-03']) {
      const expected = rows.filter((_row, index) => cases[index]!.expected === month).map(row => row.id).sort();
      const evidence = await repo.listSharedEvidence(companyId, { expenseIds: ids, yearMonth: month });
      const list = await repo.listExpenses({ companyId, fromDate: `${month}-01`, toDate: `${month}-${month.endsWith('09') ? '30' : '31'}`, pageSize: 100 }, { branchIds: [branchId] });
      assert.deepEqual(evidence.rows.map(row => row.id).sort(), expected);
      assert.deepEqual(list.data.filter(row => ids.includes(row.id)).map(row => row.id).sort(), expected);
    }
    const folders = await repo.summarizeSharedEvidenceFolders(companyId, { expenseIds: ids });
    assert.deepEqual(folders.map(folder => [folder.yearMonth, folder.expenseCount]), [['2028-03', 1], ['2026-10', 2], ['2026-09', 5], ['2024-03', 1]]);
    for (const day of ['2024-03-17', '2024-03-18', '2024-03-19']) {
      const list = await repo.listExpenses({ companyId, fromDate: day, toDate: day }, { branchIds: [branchId] });
      assert.deepEqual(list.data.filter(row => ids.includes(row.id)).map(row => row.id), day.endsWith('18') ? [rows[7]!.id] : []);
    }
    const uploaded = await repo.listSharedEvidence(companyId, { expenseIds: ids, yearMonth: '2026-10', dateField: 'uploadedAt' });
    assert.equal(uploaded.total, cases.length);
  });

  it('commits one reviewer request and notice when two submissions race, and rolls back a failed notice', async t => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const client = clients[0]!;
    const repo = new PrismaExpenseRepository({ client } as any);
    const row = await client.expenseRecord.create({ data: { companyId, branchId, createdByUserId: userId, captureSource: 'WEB_UPLOAD', status: 'NEEDS_REVIEW', expenseDate: new Date('2026-10-13') } });
    const people: any = { membersWithPermission: async () => [{ userId: 'checker', displayName: 'ผู้ตรวจ' }], memberNames: async () => new Map([[userId, 'ผู้ส่ง']]) };
    let notices = 0;
    const notify: any = { executeInTransaction: async () => { notices++; } };
    const requestReview = new MarkExpenseReadyUseCase(repo, people, notify);
    const results = await Promise.allSettled([requestReview.execute({ ...context(), permissions: ['expense.review'] }, row.id, 'checker'), requestReview.execute({ ...context(), permissions: ['expense.review'] }, row.id, 'checker')]);
    assert.ok(results.some(result => result.status === 'fulfilled'));
    assert.equal(notices, 1);
    const sent = await client.expenseRecord.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(sent.requestedReviewerUserId, 'checker'); assert.equal(sent.submittedByUserId, userId); assert.ok(sent.submittedAt);
    const retryRow = await client.expenseRecord.create({ data: { companyId, branchId, createdByUserId: userId, captureSource: 'WEB_UPLOAD', status: 'NEEDS_REVIEW', expenseDate: new Date('2026-10-13') } });
    const failing = new MarkExpenseReadyUseCase(repo, people, { executeInTransaction: async () => { throw Error('notice failed'); } } as any);
    await assert.rejects(() => failing.execute({ ...context(), permissions: ['expense.review'] }, retryRow.id, 'checker'), /notice failed/);
    const unchanged = await client.expenseRecord.findUniqueOrThrow({ where: { id: retryRow.id } });
    assert.equal(unchanged.status, 'NEEDS_REVIEW'); assert.equal(unchanged.requestedReviewerUserId, null); assert.equal(unchanged.submittedAt, null);
  });

  const createExpense = () => clients[0]!.expenseRecord.create({ data: {
    companyId, branchId, createdByUserId: userId, status: 'CONFIRMED', expenseDate: new Date('2026-07-31T00:00:00Z'),
    netPayableAmount: '100', outstandingAmount: '100', postingStatus: 'posted',
  } });
  it('DELETE-HISTORY a voided payment keeps its zero-paid draft and returns a clean delete refusal', async t => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const client = clients[0]!;
    const expense = await client.expenseRecord.create({ data: { companyId, branchId, createdByUserId: userId,
      status: 'DRAFT', expenseDate: new Date('2026-07-31'), grandTotalAmount: '100', netPayableAmount: '100',
      outstandingAmount: '100', paidAmount: '0', paymentStatus: 'UNPAID', postingStatus: 'not_required' } });
    const payment = await client.expensePayment.create({ data: { companyId, expenseId: expense.id, amount: '100',
      paidAt: new Date('2026-07-31'), createdByUserId: userId, status: 'VOIDED', voidedAt: new Date(),
      voidedByUserId: userId, postingStatus: 'not_required' } });
    const prisma = { client } as any;
    const audit = new AuditService(new PrismaAuditRepository(prisma), { error: () => undefined } as any);
    const remove = new DeleteExpenseUseCase(prisma, new PrismaAttachmentRepository(prisma), audit);
    try {
      await assert.rejects(() => remove.execute({ ...context(), permissions: ['expense.delete'] }, expense.id), (error: any) => {
        assert.equal(error.getStatus(), 409);
        assert.equal(error.getResponse().code, 'EXPENSE_HAS_LINKED_DATA');
        assert.equal(error.getResponse().blocker, 'PAYMENT');
        return true;
      });
      assert.ok(await client.expenseRecord.findUnique({ where: { id: expense.id } }));
      assert.equal((await client.expensePayment.findUniqueOrThrow({ where: { id: payment.id } })).status, 'VOIDED');
      assert.equal((await new PrismaExpenseRepository(prisma).findByIdWithRelations(companyId, expense.id))?.hasDeletionBlockingHistory, true);
    } finally {
      await client.auditLog.deleteMany({ where: { companyId, targetId: expense.id } });
      await client.expensePayment.deleteMany({ where: { id: payment.id } });
      await client.expenseRecord.deleteMany({ where: { id: expense.id } });
    }
  });
  // Slice 5: a 50 ทวิ is issued for a recorded payment with a known date (a Bangkok day stored as its local midnight).
  const recordDatedPayment = (expenseId: string, day = '2026-07-31', company = companyId, amount = '100') => clients[0]!.expensePayment.create({ data: {
    companyId: company, expenseId, amount, paidAt: new Date(`${day}T00:00:00+07:00`), paidAtConfirmed: true, createdByUserId: userId,
  } });

  it('keeps one payment-slip pair under concurrent retries and exposes it in detail and accountant evidence', async t => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const client = clients[0]!;
    const row = await createExpense();
    const file = await client.attachmentObject.create({ data: { companyId, branchId, uploadedByUserId: userId,
      storageProvider: 'local', bucket: 'test', objectKey: randomUUID(), originalFileName: 'slip.png', mimeType: 'image/png', byteSize: 100, status: 'ACTIVE',
      metadataJson: { generatedFor: 'expense.payment.slip', expenseId: row.id } } });
    const input = { paidAmount: '40', idempotencyKey: randomUUID(), slipAttachmentId: file.id };
    await Promise.all(clients.map(db => useCase(db).execute(context(), row.id, input)));
    const payment = await client.expensePayment.findFirstOrThrow({ where: { expenseId: row.id } });
    const links = await client.attachmentLink.findMany({ where: { companyId, attachmentId: file.id } });
    assert.equal(links.length, 2);
    assert.ok(links.some(link => link.targetType === 'expense.payment' && link.targetId === payment.id));
    const repo = new PrismaExpenseRepository({ client } as any);
    const detail = await repo.findByIdWithRelations(companyId, row.id);
    assert.equal(detail!.payments[0]!.slipAttachmentId, file.id);
    assert.ok(detail!.attachments.some(attachment => attachment.id === file.id && attachment.purpose === 'expense.payment.evidence'));
    const evidence = await repo.listSharedEvidence(companyId, { expenseIds: [row.id] });
    assert.ok(evidence.rows[0]!.attachments.some(attachment => attachment.id === file.id));
    const audit = await client.auditLog.findFirstOrThrow({ where: { companyId, action: 'expense.payment.record', targetId: payment.id } });
    assert.equal((audit.metadataJson as any).slipAttachmentId, file.id);
  });

  async function assertPaymentEffects(expenseId: string, count: number, paidAmount: string) {
    const client = clients[0]!;
    const payments = await client.expensePayment.findMany({ where: { companyId, expenseId } });
    assert.equal(payments.length, count);
    assert.equal((await client.expenseRecord.findUniqueOrThrow({ where: { id: expenseId } })).paidAmount.toFixed(4), paidAmount);
    const targetIds = payments.map((payment) => payment.id);
    assert.equal(await client.auditLog.count({ where: { companyId, action: 'expense.payment.record', targetId: { in: targetIds } } }), count);
    assert.equal(await client.outboxEvent.count({ where: { companyId, eventType: 'expense.payment_recorded', aggregateId: { in: targetIds } } }), count);
    assert.equal(new Set(payments.map((payment) => payment.id)).size, count, 'posting source identity is one per durable payment');
  }

  it('translates a raw TaxPeriod row-lock serialization collision into expense_changed_retry without committing the void', { timeout: 20_000 }, async (t) => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const client = clients[0]!;
    const expense = await createExpense();
    await client.expenseRecord.update({ where: { id: expense.id }, data: { postingStatus: 'pending', whtAmount: '3', vendorEntityKindSnapshot: 'JURISTIC' } });
    const period = await client.taxPeriod.upsert({
      where: { companyId_formType_periodKey: { companyId, formType: 'PND53', periodKey: '2026-07' } },
      update: { status: 'OPEN' }, create: { companyId, taxType: 'WHT', formType: 'PND53', periodKey: '2026-07' },
    });
    const handoff = await client.whtCertificateHandoff.create({ data: {
      companyId, status: 'EXTERNAL_LINKED', sourcePaymentType: 'expense.record', sourcePaymentId: expense.id, sourceBranchId: branchId,
      sourceFeatureKey: 'expenses', externalCertificateNumber: 'EXT-LOCK', externalIssuedDate: expense.expenseDate,
      prefillSnapshotJson: {}, prefillSnapshotHash: 'synthetic', availabilityVectorJson: {},
      creationCommandId: `wht-cert:${companyId}:expense.record:${expense.id}`, payloadFingerprint: 'synthetic',
    } });
    let rawError: any;
    let transactions = 0;
    const racingClient = new Proxy(client, { get(target, key) {
      if (key === '$transaction') return (work: any, options: any) => target.$transaction(async (tx) => {
        transactions++;
        return work(new Proxy(tx, { get(transaction, field) {
          if (field === '$executeRaw') return async (...args: any[]) => {
            if (args[0].join('').includes('FROM "TaxPeriod"')) {
              // The void already holds a Serializable snapshot; a second transaction files its period before the raw lock.
              await clients[1]!.taxPeriod.update({ where: { id: period.id }, data: { status: 'FILED' } });
              try { return await Reflect.apply(transaction.$executeRaw, transaction, args); }
              catch (error) { rawError = error; throw error; }
            }
            return Reflect.apply(transaction.$executeRaw, transaction, args);
          };
          return Reflect.get(transaction, field);
        } }));
      }, { ...options, timeout: 15_000 });
      return Reflect.get(target, key);
    } });
    const voidUseCase = new VoidExpenseUseCase(new PrismaExpenseRepository({ client: racingClient } as any),
      { log: async () => undefined } as any, { append: async () => undefined } as any, {} as any, {} as any, {} as any);
    try {
      await assert.rejects(voidUseCase.execute({ ...context(), permissions: ['expense.void', 'wht.external_certificate.link'] }, expense.id, 'รายจ่ายผิด', true),
        (error: any) => error instanceof ConflictException && (error.getResponse() as any).code === 'expense_changed_retry');
      assert.equal(rawError?.code, 'P2010');
      assert.equal(rawError?.meta?.driverAdapterError?.cause?.originalCode, '40001');
      assert.equal(transactions, 1);
      assert.equal((await client.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } })).status, 'CONFIRMED');
      assert.equal((await client.whtCertificateHandoff.findUniqueOrThrow({ where: { id: handoff.id } })).status, 'EXTERNAL_LINKED');
      assert.equal(await client.whtCertificateHistory.count({ where: { companyId, expenseId: expense.id } }), 0);
    } finally {
      await client.taxPeriod.update({ where: { id: period.id }, data: { status: 'OPEN' } });
    }
  });

  it('concurrent same-key calls from separate clients create exactly one payment, audit, event and totals increment', async (t) => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const expense = await createExpense();
    const input = { paidAmount: '40.00', paymentMethod: 'BANK_TRANSFER' as const, paidAt: '2026-07-31', idempotencyKey: randomUUID() };
    const [first, second] = await Promise.all(clients.map((client) => useCase(client).execute(context(), expense.id, input)));
    assert.equal(first.id, second.id);
    assert.equal(new Decimal(first.paidAmount).toFixed(4), '40.0000');
    assert.equal(new Decimal(second.paidAmount).toFixed(4), '40.0000');
    await assertPaymentEffects(expense.id, 1, '40.0000');
    const payment = await clients[0]!.expensePayment.findFirstOrThrow({ where: { companyId, expenseId: expense.id } });
    // Slice 5: the chosen Bangkok civil day is stored as that day's local midnight.
    assert.equal(payment.paidAt.toISOString(), '2026-07-30T17:00:00.000Z');
    await useCase(clients[1]!).execute(context(), expense.id, { ...input, paidAmount: '40' });
    await assertPaymentEffects(expense.id, 1, '40.0000');
    await assert.rejects(() => useCase(clients[1]!).execute(context(), expense.id, { ...input, paidAmount: '40.01' }),
      (error: any) => error.getStatus?.() === 409 && error.getResponse().code === 'expense_payment_idempotency_conflict');
    await useCase(clients[1]!).execute(context(), expense.id, { ...input, idempotencyKey: randomUUID() });
    await assertPaymentEffects(expense.id, 2, '80.0000');
  });

  it('concurrent same-key different-expense calls return one success and a business 409, never a unique-constraint 500', async (t) => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const expenses = await Promise.all([createExpense(), createExpense()]);
    const input = { paidAmount: '40', idempotencyKey: randomUUID() };
    const results = await Promise.allSettled(clients.map((client, index) => useCase(client).execute(context(), expenses[index]!.id, input)));
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const failed = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    assert.equal(failed.reason.getStatus?.(), 409);
    assert.equal(failed.reason.getResponse?.().code, 'expense_payment_idempotency_conflict');
    const payments = await clients[0]!.expensePayment.findMany({ where: { companyId, expenseId: { in: expenses.map((expense) => expense.id) } } });
    assert.equal(payments.length, 1);
    for (const expense of expenses) {
      await assertPaymentEffects(expense.id, expense.id === payments[0]!.expenseId ? 1 : 0, expense.id === payments[0]!.expenseId ? '40.0000' : '0.0000');
    }
  });

  it('concurrent distinct intents retain both genuine payments and legacy unkeyed history', async (t) => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const expense = await createExpense();
    await clients[0]!.expensePayment.createMany({ data: [0, 1].map(() => ({
      companyId, expenseId: expense.id, createdByUserId: userId, amount: '10', paidAt: new Date('2026-07-01T00:00:00Z'),
    })) });
    await clients[0]!.expenseRecord.update({ where: { id: expense.id }, data: { paidAmount: '20', outstandingAmount: '80', paymentStatus: 'PARTIALLY_PAID' } });
    await Promise.all(clients.map((client) => useCase(client).execute(context(), expense.id, { paidAmount: '40', idempotencyKey: randomUUID() })));
    const payments = await clients[0]!.expensePayment.findMany({ where: { companyId, expenseId: expense.id } });
    assert.equal(payments.length, 4);
    assert.equal(payments.filter((payment) => payment.idempotencyKey === null && payment.payloadFingerprint === null).length, 2);
    assert.equal((await clients[0]!.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } })).paidAmount.toFixed(4), '100.0000');
    const newIds = payments.filter((payment) => payment.idempotencyKey !== null).map((payment) => payment.id);
    assert.equal(await clients[0]!.auditLog.count({ where: { companyId, targetId: { in: newIds } } }), 2);
    assert.equal(await clients[0]!.outboxEvent.count({ where: { companyId, aggregateId: { in: newIds } } }), 2);
  });

  for (const failedWrite of ['audit', 'outbox'] as const) {
    it(`a real PostgreSQL ${failedWrite} constraint failure rolls back payment/totals/audit/event, and retry succeeds`, async (t) => {
      if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
      const expense = await createExpense();
      const input = { paidAmount: '40', idempotencyKey: randomUUID() };
      const audit = new AuditService({ log: async (entry: any, tx: any) => {
        if (failedWrite === 'audit') {
          await tx.auditLog.create({ data: { ...entry, actorUserId: 'missing-user-for-intent-test' } });
        } else {
          await new PrismaAuditRepository({ client: clients[0] } as any).log(entry, tx);
          // Poison the exact event key inside the same transaction; the real use-case append
          // must fail and roll back this row, the preceding audit, payment and source totals.
          await tx.outboxEvent.create({ data: { companyId, eventType: 'synthetic-collision', aggregateType: 'expense_payment', aggregateId: entry.targetId,
            eventKey: `expense.payment_recorded:expense_payment:${entry.targetId}`, payloadJson: {} } });
        }
      } } as any, { error: () => undefined } as any);
      const auditBefore = await clients[0]!.auditLog.count({ where: { companyId } });
      const eventBefore = await clients[0]!.outboxEvent.count({ where: { companyId } });
      await assert.rejects(() => useCase(clients[0]!, audit).execute(context(), expense.id, input), (error: any) => ['P2002', 'P2003'].includes(error.code));
      await assertPaymentEffects(expense.id, 0, '0.0000');
      assert.equal(await clients[0]!.auditLog.count({ where: { companyId } }), auditBefore);
      assert.equal(await clients[0]!.outboxEvent.count({ where: { companyId } }), eventBefore);
      await useCase(clients[1]!).execute(context(), expense.id, input);
      await assertPaymentEffects(expense.id, 1, '40.0000');
    });
  }

  it('rechecks current scope on replay and refuses a cancelled payment without restoring it (E5)', async (t) => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const expense = await createExpense();
    const input = { paidAmount: '40', idempotencyKey: randomUUID() };
    await useCase(clients[0]!).execute(context(), expense.id, input);
    await clients[0]!.expenseRecord.update({ where: { id: expense.id }, data: { branchId: 'restricted-test-branch' } });
    await assert.rejects(() => useCase(clients[1]!).execute({ ...context(), scopes: { branchIds: ['other-branch'] } }, expense.id, input), ForbiddenException);
    const foreignId = `foreign-${randomUUID()}`;
    await clients[0]!.company.create({ data: { id: foreignId, name: 'Synthetic foreign tenant', registeredName: 'บริษัทอื่นทดสอบ จำกัด' } });
    try {
      await assert.rejects(() => useCase(clients[1]!).execute({ ...context(), companyId: foreignId }, expense.id, input), NotFoundException);
    } finally {
      await clients[0]!.company.deleteMany({ where: { id: foreignId } });
    }
    await clients[0]!.expenseRecord.update({ where: { id: expense.id }, data: { branchId } });
    await new PrismaExpenseRepository({ client: clients[0] } as any).voidExpenseTrueReversal(companyId, expense.id, userId, 'Synthetic void replay regression');
    await assert.rejects(() => useCase(clients[1]!).execute(context(), expense.id, input), (e: any) => e.getResponse?.().code === 'expense_payment_cancelled_replay');
    await assertPaymentEffects(expense.id, 1, '0.0000');
    assert.equal((await clients[0]!.expensePayment.findFirstOrThrow({ where: { companyId, expenseId: expense.id } })).status, 'VOIDED');
  });
  async function withYearlyWhtFixture(work: (fixture: any) => Promise<void>) {
    const client = clients[0]!;
    const tenant = `a9-wht-${randomUUID()}`;
    await client.company.create({ data: { id: tenant, name: 'Synthetic yearly WHT tests', registeredName: 'บริษัทผู้จ่ายทดสอบ จำกัด' } });
    const branch = await client.branch.create({ data: { companyId: tenant, code: 'HO', name: 'Test branch', type: 'HEAD_OFFICE', createdByUserId: userId } });
    // Issuing and correcting need the source expense to be readable by the actor (scoped certificate reads).
    const actor = { ...context(), companyId: tenant, permissions: ['expense.read', 'wht.certificate.issue', 'wht.certificate.correct'] };
    const taxRepo = new PrismaTaxRepository({ client } as any);
    const audit = { log: async () => undefined } as any;
    const sequences = new PrismaDocumentSequenceRepository({ client } as any);
    const reserve = new ReserveDocumentNumberUseCase(sequences, audit);
    const gate = { assertLaunchRouteOpen: async () => undefined } as any;
    const renderer = new TaxArtifactRendererService();
    const issueCommand = new IssueWhtCertificateFromHandoffUseCase(taxRepo, reserve, sequences, audit, gate, renderer, {} as any, {} as any);
    const correction = new CorrectWhtCertificateUseCase(taxRepo, reserve, sequences, audit, gate, renderer, {} as any, {} as any);
    const issue = async (day: string) => {
      const expense = await client.expenseRecord.create({ data: { companyId: tenant, branchId: branch.id, createdByUserId: userId,
        status: 'CONFIRMED', expenseDate: new Date(day), netPayableAmount: '100', outstandingAmount: '100', postingStatus: 'not_required' } });
      await recordDatedPayment(expense.id, day, tenant);
      const prefill = { payerSnapshot: { companyName: 'บริษัทผู้จ่าย', taxId: '1234567890123', branchCode: '00000', address: 'ที่อยู่กิจการ' },
        payeeSnapshot: { name: 'ผู้รับเงิน', taxId: '1111111111111', branchCode: '00003', address: 'ที่อยู่เดิม' },
        formType: 'PND53', incomeCategoryCode: 'WHT_SERVICE_JUR', incomeCategoryName: 'ค่าบริการ', whtRate: '3', grossAmount: '100', withheldAmount: '3', paymentDate: day };
      const handoff = await client.whtCertificateHandoff.create({ data: { companyId: tenant, status: 'REQUIRED',
        sourcePaymentType: 'expense.record', sourcePaymentId: expense.id, sourceBranchId: branch.id, sourceFeatureKey: 'expenses',
        prefillSnapshotJson: prefill, prefillSnapshotHash: 'synthetic', availabilityVectorJson: {},
        creationCommandId: `wht-cert:${tenant}:expense.record:${expense.id}`, payloadFingerprint: 'synthetic' } });
      return { handoff, certificate: await issueCommand.execute(actor, handoff.id) };
    };
    try { await work({ client, tenant, actor, sequences, issue, correction }); }
    finally {
      await client.expensePayment.deleteMany({ where: { companyId: tenant } });
      await client.expenseRecord.deleteMany({ where: { companyId: tenant } });
      await client.company.delete({ where: { id: tenant } });
    }
  }

  it('A9 issues October then September from one yearly counter and restarts only next year; correction takes the next yearly number', { timeout: 30_000 }, async t => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    await withYearlyWhtFixture(async ({ issue, correction, actor }: any) => {
      const october = await issue('2026-10-15'); const september = await issue('2026-09-15'); const january = await issue('2027-01-15');
      assert.deepEqual([october, september, january].map(row => row.certificate.certificateNumber), ['WHT-2026-00001', 'WHT-2026-00002', 'WHT-2027-00001']);
      const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);
      const dto = await pipe.transform({ reason: 'แก้วันที่', corrected: { paymentDate: '2026-11-15' } }, { type: 'body', metatype: CorrectWhtCertificateDto });
      const corrected = await correction.execute(actor, october.handoff.id, dto.corrected, dto.reason);
      assert.equal(corrected.certificateNumber, 'WHT-2026-00003');
      assert.equal(corrected.periodKey, '2026-11');
    });
  });

  it('A9 runtime allocation folds late monthly counters and never reuses a retained cancelled number', { timeout: 30_000 }, async t => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    await withYearlyWhtFixture(async ({ client, tenant, issue }: any) => {
      const data = { companyId: tenant, branchScopeKey: 'GLOBAL', documentType: 'tax.wht_certificate', prefixTemplate: 'WHT-{YYYY}-{SEQ}', padding: 5, resetPolicy: 'YEARLY' };
      await client.documentSequence.create({ data: { ...data, periodKey: '2026-09', nextNumber: 4 } });
      const monthly = await client.documentSequence.create({ data: { ...data, periodKey: '2026-10', nextNumber: 8 } });
      await client.documentNumber.create({ data: { companyId: tenant, sequenceId: monthly.id, documentType: 'tax.wht_certificate',
        documentNumber: 'WHT-2026-00011', status: 'CANCELLED', idempotencyKey: 'retained-cancelled', reservedByUserId: userId } });
      assert.equal((await issue('2026-09-15')).certificate.certificateNumber, 'WHT-2026-00012');
      assert.equal((await issue('2027-01-15')).certificate.certificateNumber, 'WHT-2027-00001');
    });
  });

  it('A9 migration and allocation retain voided certificate numbers even without a registry or counter', { timeout: 30_000 }, async t => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    await withYearlyWhtFixture(async ({ client, tenant, issue }: any) => {
      const original = await issue('2026-10-15');
      await client.whtCertificate.update({ where: { id: original.certificate.id }, data: { status: 'VOIDED', certificateNumber: 'WHT-2026-00009' } });
      await client.documentNumber.deleteMany({ where: { companyId: tenant } });
      await client.documentSequence.deleteMany({ where: { companyId: tenant } });
      const sql = readFileSync('prisma/migrations/20261012110000_wht_certificate_yearly_sequence/migration.sql', 'utf8');
      await client.$executeRawUnsafe(sql); await client.$executeRawUnsafe(sql);
      assert.equal((await client.documentSequence.findFirstOrThrow({ where: { companyId: tenant, periodKey: '2026' } })).nextNumber, 10);
      assert.equal((await issue('2026-09-15')).certificate.certificateNumber, 'WHT-2026-00010');
    });
  });

  for (const scenario of ['none', 'one month', 'several months', 'two years']) it(`A9 yearly migration is idempotent with ${scenario}`, { timeout: 30_000 }, async t => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    await withYearlyWhtFixture(async ({ client, tenant }: any) => {
      const data = { companyId: tenant, branchScopeKey: 'GLOBAL', documentType: 'tax.wht_certificate', prefixTemplate: 'WHT-{YYYY}-{SEQ}', padding: 5, resetPolicy: 'YEARLY' };
      const months = scenario === 'none' ? [] : scenario === 'one month' ? [['2026-09', 4]] : scenario === 'several months' ? [['2026-09', 4], ['2026-10', 8]] : [['2026-09', 4], ['2027-01', 8]];
      for (const [periodKey, nextNumber] of months) await client.documentSequence.create({ data: { ...data, periodKey, nextNumber } });
      const sql = readFileSync('prisma/migrations/20261012110000_wht_certificate_yearly_sequence/migration.sql', 'utf8');
      await client.$executeRawUnsafe(sql); await client.$executeRawUnsafe(sql);
      const years = await client.documentSequence.findMany({ where: { companyId: tenant, documentType: 'tax.wht_certificate', periodKey: { in: ['2026', '2027'] } }, orderBy: { periodKey: 'asc' } });
      const expected = scenario === 'none' ? [] : scenario === 'one month' ? [['2026', 4]] : scenario === 'several months' ? [['2026', 8]] : [['2026', 4], ['2027', 8]];
      assert.deepEqual(years.map((row: any) => [row.periodKey, row.nextNumber]), expected);
      assert.equal(await client.documentSequence.count({ where: { companyId: tenant, periodKey: { contains: '-' } } }), months.length);
    });
  });

  it('two real partial DTO corrections preserve the original tax id and branch code without skipping a number (A7b)', { timeout: 30_000 }, async (t) => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const client = clients[0]!;
    const expense = await createExpense();
    await recordDatedPayment(expense.id);
    const prefill = {
      payerSnapshot: { companyName: 'บริษัทผู้จ่าย', taxId: '1234567890123', branchCode: '00002', address: 'ที่อยู่ผู้จ่าย' },
      payeeSnapshot: { name: 'ผู้รับเงินเดิม', taxId: '1111111111111', branchCode: '00003', address: 'ที่อยู่เดิม' },
      formType: 'PND53', incomeCategoryCode: 'WHT_SERVICE_JUR', incomeCategoryName: 'ค่าบริการ',
      whtRate: '3', grossAmount: '100', withheldAmount: '3', paymentDate: expense.expenseDate.toISOString(),
    };
    const handoff = await client.whtCertificateHandoff.create({ data: {
      companyId, status: 'REQUIRED', sourcePaymentType: 'expense.record', sourcePaymentId: expense.id,
      sourceBranchId: branchId, sourceFeatureKey: 'expenses', prefillSnapshotJson: prefill,
      prefillSnapshotHash: 'synthetic', availabilityVectorJson: {},
      creationCommandId: `wht-cert:${companyId}:expense.record:${expense.id}`, payloadFingerprint: 'synthetic',
    } });
    const taxRepo = new PrismaTaxRepository({ client } as any);
    const audit = new AuditService(new PrismaAuditRepository({ client } as any), { error: () => undefined } as any);
    const sequences = new PrismaDocumentSequenceRepository({ client } as any);
    const reserve = new ReserveDocumentNumberUseCase(sequences, audit);
    const gate = { assertLaunchRouteOpen: async () => undefined } as any;
    const renderer = new TaxArtifactRendererService();
    // Issuing and correcting need the source expense to be readable by the actor.
    const actor = { ...context(), permissions: ['expense.read', 'wht.certificate.issue', 'wht.certificate.correct'] };
    const original = await new IssueWhtCertificateFromHandoffUseCase(taxRepo, reserve, sequences, audit, gate, renderer, {} as any, {} as any)
      .execute(actor, handoff.id);
    const correct = new CorrectWhtCertificateUseCase(taxRepo, reserve, sequences, audit, gate, renderer, {} as any, {} as any);
    const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);
    const name = await pipe.transform({ corrected: { payeeSnapshot: { name: 'ชื่อที่แก้ไข' } }, reason: 'แก้ชื่อผู้รับเงิน' },
      { type: 'body', metatype: CorrectWhtCertificateDto });
    const second = await correct.execute(actor, handoff.id, name.corrected, name.reason);
    const address = await pipe.transform({ corrected: { payeeSnapshot: { address: 'ที่อยู่ที่แก้ไข' } }, reason: 'แก้ที่อยู่ผู้รับเงิน' },
      { type: 'body', metatype: CorrectWhtCertificateDto });
    const third = await correct.execute(actor, handoff.id, address.corrected, address.reason);
    assert.deepEqual(third.payeeSnapshot, { ...prefill.payeeSnapshot, name: 'ชื่อที่แก้ไข', address: 'ที่อยู่ที่แก้ไข' });
    // The tax id and branch code stay as issued; the name is the shop's registered name (owner 2026-10-14: never a display name).
    assert.deepEqual(third.payerSnapshot, { ...prefill.payerSnapshot, companyName: 'บริษัทผู้จ่ายทดสอบ จำกัด' });
    assert.ok(third.pdfArtifact.byteLength > 0);
    const stored = await client.whtCertificate.findUniqueOrThrow({ where: { id: third.id } });
    assert.deepEqual(stored.payeeSnapshotJson, third.payeeSnapshot);
    assert.equal(stored.status, 'ISSUED');
    assert.equal((await client.whtCertificateHandoff.findUniqueOrThrow({ where: { id: handoff.id } })).certificateId, third.id);
    const numbers = [original, second, third].map(certificate => certificate.certificateNumber);
    const counters = numbers.map(number => Number(number.split('-').at(-1)));
    assert.deepEqual(counters, [counters[0], counters[0]! + 1, counters[0]! + 2]);
    const reservations = await client.documentNumber.findMany({ where: { companyId, documentType: 'tax.wht_certificate', documentNumber: { in: numbers } } });
    assert.equal(reservations.length, 3);
    assert.ok(reservations.every(number => number.status === 'COMMITTED'));
  });

  for (const winner of ['reopen', 'correction'] as const) it(`correct certificate racing reopen (${winner} first) leaves no ISSUED certificate on a reopened expense`, { timeout: 20_000 }, async (t) => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const client = clients[0]!;
    const expense = await createExpense();
    await client.expenseRecord.update({ where: { id: expense.id }, data: { postingStatus: 'pending', whtAmount: '3', vendorEntityKindSnapshot: 'JURISTIC' } });
    const period = await client.taxPeriod.upsert({
      where: { companyId_formType_periodKey: { companyId, formType: 'PND53', periodKey: '2026-07' } },
      update: {}, create: { companyId, taxType: 'WHT', formType: 'PND53', periodKey: '2026-07' },
    });
    const certificate = await client.whtCertificate.create({ data: {
      companyId, certificateNumber: `WT-${randomUUID()}`, status: 'ISSUED', taxPeriodId: period.id, periodKey: period.periodKey,
      payerSnapshotJson: { companyName: 'ร้านทดสอบ', taxId: '1234567890123', branchCode: '00000', address: 'ที่อยู่กิจการ' },
      payeeSnapshotJson: { name: 'ผู้รับเงิน', taxId: '1111111111111', branchCode: null, address: 'ที่อยู่ผู้รับเงิน' },
      incomeCategoryCode: 'SERVICE', incomeCategoryName: 'ค่าบริการ', whtRate: '3', grossAmount: '100', withheldAmount: '3',
      paymentDate: expense.expenseDate, issuedAt: new Date(), issuedByUserId: userId,
    } });
    const handoff = await client.whtCertificateHandoff.create({ data: {
      companyId, status: 'SYSTEM_ISSUED', sourcePaymentType: 'expense.record', sourcePaymentId: expense.id, sourceBranchId: branchId,
      sourceFeatureKey: 'expenses', certificateId: certificate.id, prefillSnapshotJson: {}, prefillSnapshotHash: 'synthetic',
      availabilityVectorJson: {}, creationCommandId: `wht-cert:${companyId}:expense.record:${expense.id}`, payloadFingerprint: 'synthetic',
    } });
    let reached!: () => void;
    let release!: () => void;
    const paused = new Promise<void>(resolve => { reached = resolve; });
    const proceed = new Promise<void>(resolve => { release = resolve; });
    const correctionClient = new Proxy(client, { get(target, key) {
      if (key === '$transaction' && winner === 'correction') return (work: any, options: any) => target.$transaction(async (tx) => {
        const result = await work(tx); reached(); await proceed; return result;
      }, { ...options, timeout: 15_000 });
      return Reflect.get(target, key);
    } });
    const correct = new CorrectWhtCertificateUseCase(
      new PrismaTaxRepository({ client: correctionClient } as any),
      { execute: async () => ({ id: 'synthetic-reservation', documentNumber: `WT-${randomUUID()}` }) } as any,
      { commitNumberInTransaction: async () => undefined } as any,
      new AuditService(new PrismaAuditRepository({ client } as any), { error: () => undefined } as any),
      { assertLaunchRouteOpen: async () => undefined } as any,
      { renderWhtCertificate: async () => {
        if (winner === 'reopen') { reached(); await proceed; }
        return { mimeType: 'application/pdf', fileName: 'synthetic.pdf', contentBase64: '', checksum: 'synthetic', byteLength: 0 };
      } } as any, {} as any, {} as any,
    );
    const actor = { ...context(), permissions: ['expense.read', 'expense.confirm', 'wht.certificate.correct'] };
    const correction = correct.execute(actor, handoff.id, { payeeSnapshot: { address: 'ที่อยู่ใหม่' } }, 'แก้ที่อยู่')
      .then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
    await paused;
    let reopeningBegan!: () => void;
    const reopening = new Promise<void>(resolve => { reopeningBegan = resolve; });
    const reopeningClient = new Proxy(clients[1]!, { get(target, key) {
      if (key === '$transaction') return (work: any, options: any) => target.$transaction(async (tx) => {
        reopeningBegan(); return work(tx);
      }, options);
      return Reflect.get(target, key);
    } });
    const reopen = new PrismaExpenseRepository({ client: reopeningClient } as any).reopenExpenseAtomic({
      companyId, expenseId: expense.id, actorUserId: userId, scopes: {}, permissions: actor.permissions,
      reason: 'ข้อมูลรายจ่ายผิด', taxFilingAttested: true,
    });
    try {
      if (winner === 'reopen') await reopen;
      else await reopening;
    } finally { release(); }
    const [result] = await Promise.all([correction, reopen]);
    assert.equal(result.ok, winner === 'correction');
    if (!result.ok) assert.equal(result.error.getResponse?.().code, 'expense_wht_source_changed');
    assert.equal((await client.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } })).status, 'NEEDS_REVIEW');
    assert.equal(await client.whtCertificate.count({ where: { companyId, status: 'ISSUED', id: { in: [certificate.id, ...(result.ok ? [result.value.id] : [])] } } }), 0);
    const updated = await client.whtCertificateHandoff.findUniqueOrThrow({ where: { id: handoff.id } });
    assert.equal(updated.status, 'CANCELLED'); assert.equal(updated.certificateId, null); assert.equal(updated.certificateRound, 1);
    assert.equal(await client.whtCertificateHistory.count({ where: { companyId, expenseId: expense.id, eventType: 'CANCELLED_SOURCE_REOPENED' } }), 1);
  });

  it('double-clicked reopen from separate transactions cancels its external record once', async (t) => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const expense = await createExpense();
    await clients[0]!.expenseRecord.update({ where: { id: expense.id }, data: { postingStatus: 'pending' } });
    const handoff = await clients[0]!.whtCertificateHandoff.create({ data: {
      companyId, status: 'EXTERNAL_LINKED', sourcePaymentType: 'expense.record', sourcePaymentId: expense.id, sourceBranchId: branchId,
      sourceFeatureKey: 'expenses', externalCertificateNumber: 'EXT-1', externalEvidenceRef: 'synthetic-file', externalIssuedDate: new Date(),
      linkCommandId: `link-${randomUUID()}`, linkPayloadFingerprint: 'synthetic', prefillSnapshotJson: {}, prefillSnapshotHash: 'synthetic',
      availabilityVectorJson: {}, creationCommandId: `wht-cert:${companyId}:expense.record:${expense.id}`, payloadFingerprint: 'synthetic',
    } });
    const outcomes = await Promise.allSettled(clients.map(db => new PrismaExpenseRepository({ client: db } as any).reopenExpenseAtomic({
      companyId, expenseId: expense.id, actorUserId: userId, scopes: {}, permissions: ['expense.confirm', 'wht.external_certificate.link'],
      reason: 'ข้อมูลรายจ่ายผิด', taxFilingAttested: true,
    })));
    assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1);
    assert.equal(await clients[0]!.whtCertificateHistory.count({ where: { companyId, expenseId: expense.id, eventType: 'EXTERNAL_RECORD_REMOVED' } }), 1);
    const updated = await clients[0]!.whtCertificateHandoff.findUniqueOrThrow({ where: { id: handoff.id } });
    assert.equal(updated.certificateRound, 1); assert.equal(updated.externalCertificateNumber, null); assert.equal(updated.linkCommandId, null);
    assert.equal(await clients[0]!.auditLog.count({ where: { companyId, targetId: handoff.id, action: 'tax.wht_certificate.cancel' } }), 1);
  });


  for (const sameCommand of [false, true]) it(`C5 parallel self-issued changes ${sameCommand ? 'retry one command' : 'retain both changes'} without lost history`, { timeout: 30_000 }, async t => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const client = clients[0]!;
    const source = await createExpense();
    const expense = await client.expenseRecord.update({ where: { id: source.id }, data: { postingStatus: 'pending', whtAmount: '3' } });
    await client.taxPeriod.upsert({ where: { companyId_formType_periodKey: { companyId, formType: 'PND53', periodKey: '2026-07' } },
      create: { companyId, taxType: 'WHT', formType: 'PND53', periodKey: '2026-07' }, update: { status: 'OPEN' } });
    const handoff = await client.whtCertificateHandoff.create({ data: {
      companyId, status: 'EXTERNAL_LINKED', sourcePaymentType: 'expense.record', sourcePaymentId: expense.id, sourceBranchId: branchId,
      sourceFeatureKey: 'expenses', externalCertificateNumber: 'EXT-OLD', externalIssuedDate: new Date('2026-07-20'), externalEvidenceRef: 'old-ref', linkNote: 'เดิม',
      prefillSnapshotJson: { formType: 'PND53', paymentDate: expense.expenseDate.toISOString() }, prefillSnapshotHash: 'synthetic',
      availabilityVectorJson: {}, creationCommandId: randomUUID(), payloadFingerprint: 'synthetic',
    } });
    const sharedCommand = randomUUID();
    const bodies = clients.map((_, index) => ({ commandId: sameCommand ? sharedCommand : randomUUID(),
      externalCertificateNumber: `EXT-${sameCommand ? 'SAME' : index}`, issuedDate: '2026-07-21', externalEvidenceRef: `new-ref-${sameCommand ? 0 : index}`, note: `ใหม่-${sameCommand ? 0 : index}` }));
    // Both real readers observe the original row before either begins its transaction.
    let reads = 0, release!: () => void;
    const bothRead = new Promise<void>(resolve => { release = resolve; });
    const actor = { ...context(), permissions: ['expense.read', 'wht.external_certificate.link'] };
    const outcomes = await Promise.allSettled(clients.map((db, index) => {
      const handoffs = new Proxy(db.whtCertificateHandoff, { get(target, key) {
        if (key === 'findUnique') return async (args: any) => {
          const row = await target.findUnique(args);
          if (++reads === 2) release();
          await bothRead; return row;
        };
        return Reflect.get(target, key);
      } });
      const realClient = new Proxy(db, { get(target, key) { return key === 'whtCertificateHandoff' ? handoffs : Reflect.get(target, key); } });
      const prisma = { client: realClient } as any;
      return new WhtCertificateHandoffUseCase(new PrismaTaxRepository(prisma),
        new AuditService(new PrismaAuditRepository(prisma), { error: () => undefined } as any),
        {} as any, new PrismaAccountingRepository(prisma)).changeExternal(actor, handoff.id, bodies[index]!);
    }));
    const successful = outcomes.filter(outcome => outcome.status === 'fulfilled');
    assert.ok(successful.length >= 1);
    for (const outcome of outcomes) if (outcome.status === 'rejected') assert.equal(outcome.reason.getStatus(), 409);
    const events = await client.whtCertificateHistory.findMany({ where: { companyId, handoffId: handoff.id, eventType: 'EXTERNAL_RECORD_CHANGED' } });
    assert.equal(events.length, sameCommand ? 1 : successful.length);
    assert.equal(await client.auditLog.count({ where: { companyId, targetId: handoff.id, action: 'tax.wht_certificate.external_record_changed' } }), events.length);
    const originals = events.filter(event => (event.detailsJson as any).previousRecord.number === 'EXT-OLD');
    assert.equal(originals.length, 1);
    assert.deepEqual((originals[0]!.detailsJson as any).previousRecord,
      { paymentDate: null, number: 'EXT-OLD', issuedDate: '2026-07-20T00:00:00.000Z', externalEvidenceRef: 'old-ref', note: 'เดิม' });
    if (events.length === 2) {
      const second = events.find(event => event.id !== originals[0]!.id)!;
      assert.equal((second.detailsJson as any).previousRecord.number, originals[0]!.certificateNumber);
      assert.equal((second.detailsJson as any).previousRecord.externalEvidenceRef, (originals[0]!.detailsJson as any).externalEvidenceRef);
      assert.equal((second.detailsJson as any).previousRecord.note, (originals[0]!.detailsJson as any).linkNote);
      assert.equal((await client.whtCertificateHandoff.findUniqueOrThrow({ where: { id: handoff.id } })).externalCertificateNumber, second.certificateNumber);
    }
    assert.equal((await client.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } })).status, 'CONFIRMED');
  });

  for (const competing of ['same removal', 'different removal', 'change'] as const) it(`C15 concurrent removal and ${competing} preserve one removal event or refuse stale evidence`, { timeout: 30_000 }, async t => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const client = clients[0]!;
    const source = await createExpense();
    const expense = await client.expenseRecord.update({ where: { id: source.id }, data: { postingStatus: 'pending', whtAmount: '3' } });
    await client.taxPeriod.upsert({ where: { companyId_formType_periodKey: { companyId, formType: 'PND53', periodKey: '2026-07' } },
      create: { companyId, taxType: 'WHT', formType: 'PND53', periodKey: '2026-07' }, update: { status: 'OPEN' } });
    const handoff = await client.whtCertificateHandoff.create({ data: {
      companyId, status: 'EXTERNAL_LINKED', sourcePaymentType: 'expense.record', sourcePaymentId: expense.id, sourceBranchId: branchId,
      sourceFeatureKey: 'expenses', externalCertificateNumber: 'EXT-OLD', externalIssuedDate: new Date('2026-07-20'), externalEvidenceRef: 'old-ref', linkNote: 'เดิม',
      prefillSnapshotJson: { formType: 'PND53', paymentDate: expense.expenseDate.toISOString(), payerSnapshot: { companyName: 'ร้านทดสอบ', taxId: '1234567890123', address: 'ที่อยู่ร้าน' }, payeeSnapshot: { name: 'ผู้รับเงิน', taxId: '1111111111111', address: 'ที่อยู่ผู้รับเงิน' } },
      prefillSnapshotHash: 'synthetic', availabilityVectorJson: {}, creationCommandId: randomUUID(), payloadFingerprint: 'synthetic',
    } });
    const actor = { ...context(), permissions: ['expense.read', 'wht.external_certificate.link'] };
    const values = clients.map(db => {
      const prisma = { client: db } as any;
      return new WhtCertificateHandoffUseCase(new PrismaTaxRepository(prisma), new AuditService(new PrismaAuditRepository(prisma), { error: () => undefined } as any),
        { assertLaunchRouteOpen: async () => undefined } as any, new PrismaAccountingRepository(prisma));
    });
    const body = { commandId: randomUUID(), expectedUpdatedAt: handoff.updatedAt.toISOString(), reason: 'บันทึกผิด ยังไม่ได้ออกให้' };
    const certificatesBefore = await client.whtCertificate.count({ where: { companyId } });
    const outcomes = await Promise.allSettled([
      values[0]!.removeExternal(actor, handoff.id, body),
      competing === 'change' ? values[1]!.changeExternal(actor, handoff.id, { commandId: randomUUID(), externalCertificateNumber: 'EXT-NEW', externalEvidenceRef: 'new-ref', issuedDate: '2026-07-21' })
        : values[1]!.removeExternal(actor, handoff.id, { ...body, commandId: competing === 'same removal' ? body.commandId : randomUUID() }),
    ]);
    assert.ok(outcomes.some(value => value.status === 'fulfilled'));
    for (const value of outcomes) if (value.status === 'rejected') assert.equal(value.reason.getStatus(), 409);
    const events = await client.whtCertificateHistory.findMany({ where: { companyId, handoffId: handoff.id, eventType: 'EXTERNAL_RECORD_REMOVED' } });
    const final = await client.whtCertificateHandoff.findUniqueOrThrow({ where: { id: handoff.id } });
    if (outcomes[0]!.status === 'fulfilled' || competing !== 'change') {
      assert.equal(events.length, 1); assert.equal(final.status, 'REQUIRED'); assert.equal(final.externalCertificateNumber, null);
      assert.equal(events[0]!.certificateNumber, 'EXT-OLD'); assert.equal(events[0]!.reason, body.reason);
      assert.equal((events[0]!.detailsJson as any).removedManually, true);
      assert.equal(await client.auditLog.count({ where: { companyId, targetId: handoff.id, action: 'tax.wht_certificate.external_record_removed' } }), 1);
      if (outcomes[0]!.status === 'fulfilled') assert.equal((await values[0]!.removeExternal(actor, handoff.id, body)).status, 'REQUIRED');
    } else {
      assert.equal(events.length, 0); assert.equal(final.externalCertificateNumber, 'EXT-NEW');
    }
    assert.equal(await client.whtCertificate.count({ where: { companyId } }), certificatesBefore);
  });

  for (const command of ['system issue', 'correction', 'record self-issued', 'change self-issued', 'remove self-issued'] as const) {
    for (const winner of ['certificate', 'void'] as const) it(`${command} racing void: ${winner} wins and no certificate remains on a voided expense (T18/T19)`, async (t) => {
      if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
      const client = clients[0]!;
      const source = await createExpense();
      await recordDatedPayment(source.id);
      const expense = await client.expenseRecord.update({ where: { id: source.id }, data: { postingStatus: 'pending', whtAmount: '3' } });
      const period = await client.taxPeriod.upsert({ where: { companyId_formType_periodKey: { companyId, formType: 'PND53', periodKey: '2026-07' } },
        create: { companyId, taxType: 'WHT', formType: 'PND53', periodKey: '2026-07' }, update: {} });
      const prefill = { payerSnapshot: { companyName: 'ร้านทดสอบ', taxId: '1234567890123', branchCode: '00000', address: 'ที่อยู่กิจการ' },
        payeeSnapshot: { name: 'ผู้รับเงิน', taxId: '1111111111111', branchCode: null, address: 'ที่อยู่ผู้รับเงิน' }, formType: 'PND53',
        incomeCategoryCode: 'SERVICE', incomeCategoryName: 'ค่าบริการ', whtRate: '3', grossAmount: '100', withheldAmount: '3', paymentDate: expense.expenseDate.toISOString() };
      const certificate = command === 'correction' ? await client.whtCertificate.create({ data: {
        companyId, certificateNumber: `WT-${randomUUID()}`, status: 'ISSUED', taxPeriodId: period.id, periodKey: period.periodKey,
        payerSnapshotJson: prefill.payerSnapshot, payeeSnapshotJson: prefill.payeeSnapshot,
        incomeCategoryCode: 'SERVICE', incomeCategoryName: 'ค่าบริการ', whtRate: '3', grossAmount: '100', withheldAmount: '3',
        paymentDate: expense.expenseDate, issuedAt: new Date(), issuedByUserId: userId,
      } }) : null;
      const handoff = await client.whtCertificateHandoff.create({ data: {
        companyId, status: certificate ? 'SYSTEM_ISSUED' : (command === 'change self-issued' || command === 'remove self-issued') ? 'EXTERNAL_LINKED' : 'REQUIRED', certificateId: certificate?.id,
        ...((command === 'change self-issued' || command === 'remove self-issued') ? { externalCertificateNumber: 'EXT-OLD', externalIssuedDate: new Date('2026-07-20'), externalEvidenceRef: 'old-ref', linkNote: 'เดิม' } : {}),
        sourcePaymentType: 'expense.record', sourcePaymentId: expense.id, sourceBranchId: branchId, sourceFeatureKey: 'expenses',
        prefillSnapshotJson: prefill, prefillSnapshotHash: 'synthetic', availabilityVectorJson: {},
        creationCommandId: `wht-cert:${companyId}:expense.record:${expense.id}`, payloadFingerprint: 'synthetic',
      } });
      let reached!: () => void; let release!: () => void; let snapshotTaken!: () => void;
      const paused = new Promise<void>(resolve => { reached = resolve; });
      const proceed = new Promise<void>(resolve => { release = resolve; });
      const snapshot = new Promise<void>(resolve => { snapshotTaken = resolve; });
      const certificateClient = new Proxy(client, { get(target, key) {
        if (key === '$transaction') return async (work: any, options: any) => {
          if (winner === 'void') { reached(); await proceed; }
          return target.$transaction(async (tx) => {
            const result = await work(tx);
            if (winner === 'certificate') { reached(); await proceed; }
            return result;
          }, { ...options, timeout: 15_000 });
        };
        return Reflect.get(target, key);
      } });
      const voidClient = new Proxy(clients[1]!, { get(target, key) {
        if (key === '$transaction') return (work: any, options: any) => target.$transaction(async (tx) => {
          // Fix the Serializable snapshot while the certificate transaction is holding its lifecycle lock.
          await tx.expenseRecord.findFirst({ where: { companyId, id: expense.id } }); snapshotTaken();
          return work(tx);
        }, { ...options, timeout: 15_000 });
        return Reflect.get(target, key);
      } });
      const actor = { ...context(), permissions: ['expense.read', 'expense.void', 'wht.certificate.correct', 'wht.external_certificate.link'] };
      const audit = new AuditService(new PrismaAuditRepository({ client } as any), { error: () => undefined } as any);
      const taxRepo = new PrismaTaxRepository({ client: certificateClient } as any);
      const gate = { assertLaunchRouteOpen: async () => undefined } as any;
      const renderer = { renderWhtCertificate: async () => ({ mimeType: 'application/pdf', fileName: 'synthetic.pdf', contentBase64: '', checksum: 'synthetic', byteLength: 0 }) } as any;
      const reserve = { execute: async () => ({ id: 'synthetic-reservation', documentNumber: `WT-${randomUUID()}` }) } as any;
      const sequences = { commitNumberInTransaction: async () => undefined } as any;
      const operation = command === 'system issue'
        ? new IssueWhtCertificateFromHandoffUseCase(taxRepo, reserve, sequences, audit, gate, renderer, {} as any, {} as any).execute(actor, handoff.id)
        : command === 'correction'
          ? new CorrectWhtCertificateUseCase(taxRepo, reserve, sequences, audit, gate, renderer, {} as any, {} as any).execute(actor, handoff.id, { payeeSnapshot: { address: 'ที่อยู่ใหม่' } }, 'แก้ที่อยู่')
          : command === 'remove self-issued'
            ? new WhtCertificateHandoffUseCase(taxRepo, audit, gate, {} as any).removeExternal(actor, handoff.id,
              { commandId: randomUUID(), expectedUpdatedAt: handoff.updatedAt.toISOString(), reason: 'บันทึกผิด' })
          : command === 'change self-issued'
            ? new WhtCertificateHandoffUseCase(taxRepo, audit, gate, {} as any).changeExternal(actor, handoff.id,
              { commandId: randomUUID(), externalCertificateNumber: 'EXT-NEW', externalEvidenceRef: 'new-ref', issuedDate: '2026-07-31' })
            : new WhtCertificateHandoffUseCase(taxRepo, audit, gate, {} as any).linkExternal(actor, handoff.id,
              { commandId: randomUUID(), externalCertificateNumber: 'EXT-1', externalEvidenceRef: 'synthetic-file', issuedDate: '2026-07-31' });
      const certificateOutcome = operation.then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
      // A command that fails before its transaction must fail this test, not leave the file waiting forever.
      await Promise.race([paused, certificateOutcome.then(outcome => { if (!outcome.ok) throw outcome.error; })]);
      const voidUseCase = new VoidExpenseUseCase(new PrismaExpenseRepository({ client: voidClient } as any), audit,
        { append: async () => undefined } as any, {} as any, {} as any, {} as any);
      const voidOutcome = voidUseCase.execute(actor, expense.id, 'รายจ่ายผิด', true)
        .then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
      if (winner === 'certificate') { await snapshot; release(); }
      else { assert.equal((await voidOutcome).ok, true); release(); }
      const [issued, voided] = await Promise.all([certificateOutcome, voidOutcome]);
      assert.equal(issued.ok, winner === 'certificate'); assert.equal(voided.ok, winner === 'void');
      if (!voided.ok) {
        assert.equal(voided.error.getResponse().code, 'expense_changed_retry');
        assert.equal(voided.error.getResponse().message, 'มีคนทำรายการกับเอกสารนี้พร้อมกัน ระบบยังไม่ได้บันทึกการยกเลิก เปิดหน้านี้ใหม่แล้วลองอีกครั้ง');
        const unchanged = await client.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } });
        assert.equal(unchanged.updatedAt.toISOString(), expense.updatedAt.toISOString(), 'certificate commands preserve the expense revision');
        assert.equal(unchanged.updatedByUserId, expense.updatedByUserId);
        await voidUseCase.execute(actor, expense.id, 'รายจ่ายผิด', true);
      }
      if (!issued.ok) assert.equal(issued.error.getResponse().code, command === 'remove self-issued' ? 'wht_handoff_not_linkable' : 'expense_wht_source_changed');
      assert.equal((await client.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } })).status, 'VOIDED');
      const updated = await client.whtCertificateHandoff.findUniqueOrThrow({ where: { id: handoff.id } });
      assert.equal(updated.status, 'CANCELLED'); assert.equal(updated.certificateId, null); assert.equal(updated.externalCertificateNumber, null);
      const history = await client.whtCertificateHistory.findMany({ where: { companyId, expenseId: expense.id } });
      const ids = [...history.flatMap(row => row.certificateId ? [row.certificateId] : []), ...(certificate ? [certificate.id] : [])];
      assert.equal(await client.whtCertificate.count({ where: { companyId, id: { in: ids }, status: 'ISSUED' } }), 0);
    });
  }


  describe('C1 certificate reads (real PostgreSQL)', () => {
    // Reuse the enclosing PostgreSQL guard/clients, but isolate all reads from its race fixtures.
    const readCompanyId = `wht-read-pg-${randomUUID()}`;
    const actorId = `${readCompanyId}-actor`;
    const otherId = `${readCompanyId}-other`;
    const branchA = `${readCompanyId}-a`;
    const branchB = `${readCompanyId}-b`;
    const statuses: WhtHandoffStatus[] = ['REQUIRED', 'SYSTEM_ISSUED', 'EXTERNAL_LINKED', 'CANCELLED'];
    const date = new Date('2026-07-31T00:00:00Z');
    let created = false;
    let catalog: Awaited<ReturnType<typeof seed>>[] = [];
    const db = () => clients[0]!;
    const actor = () => ({ companyId: readCompanyId, userId: actorId, requestId: randomUUID(), scopes: {},
      permissions: ['expense.read', 'wht.certificate.read', 'wht.certificate.issue', 'wht.certificate.correct', 'wht.external_certificate.link'] } as any);
    const branchActor = () => ({ ...actor(), scopes: { branchIds: [branchA] } });
    const ownActor = () => ({ ...actor(), permissions: [...actor().permissions.filter((key: string) => key !== 'expense.read'), 'expense.read_own'] });
    const prefill = (name: string, taxId: string) => ({
      payerSnapshot: { companyName: 'ร้านทดสอบ', taxId: '1234567890123', branchCode: '00000', address: 'ที่อยู่กิจการ' },
      payeeSnapshot: { name, taxId, branchCode: null, address: 'ที่อยู่ผู้รับเงิน' }, formType: 'PND53' as const,
      incomeCategoryCode: 'SERVICE', incomeCategoryName: 'ค่าบริการ', whtRate: '3', grossAmount: '100', withheldAmount: '3', paymentDate: date.toISOString(),
    });

    async function seed(label: string, options: {
      status?: WhtHandoffStatus; branchId?: string | null; creatorId?: string; voided?: boolean; taxId?: string;
      sourcePaymentType?: string | null; reviewedByUserId?: string;
    } = {}) {
      const status = options.status ?? 'REQUIRED';
      const sourceBranchId = options.branchId === undefined ? branchA : options.branchId;
      const sourcePaymentType = options.sourcePaymentType === undefined ? 'expense.record' : options.sourcePaymentType;
      const creatorId = options.creatorId ?? actorId;
      const facts = prefill(`ผู้รับเงิน ${label}`, options.taxId ?? '1234567890123');
      const source = sourcePaymentType === 'expense.record' ? await db().expenseRecord.create({ data: {
        companyId: readCompanyId, branchId: sourceBranchId, createdByUserId: creatorId, reviewedByUserId: options.reviewedByUserId,
        expenseNumber: `EXP-${label}-${randomUUID()}`, status: options.voided || status === 'CANCELLED' ? 'VOIDED' : 'CONFIRMED',
        expenseDate: date, netPayableAmount: '97', outstandingAmount: '97', whtAmount: '3', postingStatus: 'pending',
      } }) : null;
      const period = status === 'SYSTEM_ISSUED' ? await db().taxPeriod.upsert({
        where: { companyId_formType_periodKey: { companyId: readCompanyId, formType: 'PND53', periodKey: '2026-07' } },
        create: { companyId: readCompanyId, taxType: 'WHT', formType: 'PND53', periodKey: '2026-07' }, update: {},
      }) : null;
      const certificate = period ? await db().whtCertificate.create({ data: {
        companyId: readCompanyId, certificateNumber: `WT-SEEDED-${randomUUID()}`, status: 'ISSUED', taxPeriodId: period.id, periodKey: period.periodKey,
        payerSnapshotJson: facts.payerSnapshot, payeeSnapshotJson: facts.payeeSnapshot, incomeCategoryCode: facts.incomeCategoryCode,
        incomeCategoryName: facts.incomeCategoryName, whtRate: facts.whtRate, grossAmount: facts.grossAmount, withheldAmount: facts.withheldAmount,
        paymentDate: date, issuedAt: date, issuedByUserId: actorId,
      } }) : null;
      const certificateNumber = certificate?.certificateNumber ?? (['EXTERNAL_LINKED', 'CANCELLED'].includes(status) ? `EXT-${label}` : null);
      const handoff = await db().whtCertificateHandoff.create({ data: {
        companyId: readCompanyId, status, sourceBranchId, sourcePaymentType,
        sourcePaymentId: source?.id ?? (sourcePaymentType ? randomUUID() : null), sourceFeatureKey: source ? 'expenses' : 'procurement',
        certificateId: certificate?.id, externalCertificateNumber: status === 'EXTERNAL_LINKED' ? certificateNumber : null,
        externalIssuedDate: status === 'EXTERNAL_LINKED' ? date : null, externalEvidenceRef: status === 'EXTERNAL_LINKED' ? 'synthetic paper' : null,
        prefillSnapshotJson: facts, prefillSnapshotHash: 'synthetic', availabilityVectorJson: {},
        creationCommandId: `c1b:${randomUUID()}`, payloadFingerprint: 'synthetic',
      } });
      if (certificateNumber) await db().whtCertificateHistory.create({ data: {
        companyId: readCompanyId, expenseId: source?.id, handoffId: handoff.id, certificateId: certificate?.id,
        eventType: status === 'CANCELLED' ? 'EXTERNAL_RECORD_REMOVED' : certificate ? 'ISSUED' : 'EXTERNAL_RECORDED',
        certificateNumber, certificateDate: date, isExternal: !certificate, actorUserId: actorId, occurredAt: date,
      } });
      return { label, source, handoff, certificate, certificateNumber, creatorId, facts };
    }

    function useCases() {
      const prisma = { client: db() } as any;
      const tax = new PrismaTaxRepository(prisma);
      const audit = new AuditService(new PrismaAuditRepository(prisma), { error: () => undefined } as any);
      const sequences = new PrismaDocumentSequenceRepository(prisma);
      const reserve = new ReserveDocumentNumberUseCase(sequences, audit);
      const attachments = new PrismaAttachmentRepository(prisma);
      // Only deployment readiness and PDF rendering are fixed seams. Every database query/write,
      // including numbering, counterparties and audits, uses the unmodified real Prisma client.
      const gate = { assertLaunchRouteOpen: async () => undefined } as any;
      const renderer = { renderWhtCertificate: async () => ({ mimeType: 'application/pdf', fileName: 'synthetic.pdf',
        contentBase64: Buffer.from('%PDF synthetic C1b').toString('base64'), checksum: 'synthetic', byteLength: 18 }) } as any;
      const storage = { getObject: async () => { throw new Error('BLANK signature must not read object storage'); } } as any;
      return {
        handoffs: new WhtCertificateHandoffUseCase(tax, audit, gate, new PrismaAccountingRepository(prisma)),
        issue: new IssueWhtCertificateFromHandoffUseCase(tax, reserve, sequences, audit, gate, renderer, attachments, storage),
        correct: new CorrectWhtCertificateUseCase(tax, reserve, sequences, audit, gate, renderer, attachments, storage),
        replacement: new IssueWhtReplacementCopyUseCase(tax, audit, gate, renderer, attachments, storage),
      };
    }

    before(async () => {
      if (!ready) return;
      await db().company.create({ data: { id: readCompanyId, name: 'Synthetic C1 certificate read tests', registeredName: 'บริษัทผู้จ่ายทดสอบ จำกัด' } });
      created = true;
      await db().user.createMany({ data: [{ id: actorId, displayName: 'Synthetic C1 reader' }, { id: otherId, displayName: 'Synthetic other creator' }] });
      await db().branch.createMany({ data: [
        { id: branchA, companyId: readCompanyId, code: 'HO', name: 'C1 branch A', type: 'HEAD_OFFICE', createdByUserId: actorId },
        { id: branchB, companyId: readCompanyId, code: 'B', name: 'C1 branch B', type: 'BRANCH', createdByUserId: actorId },
      ] });
      for (const group of ['A', 'B', 'OTHER'] as const) for (const status of statuses) catalog.push(await seed(`${group}-${status}`, {
        status, branchId: group === 'B' ? branchB : branchA, creatorId: group === 'OTHER' ? otherId : actorId,
        taxId: String(1100000000000 + catalog.length), reviewedByUserId: group === 'OTHER' && status === 'REQUIRED' ? actorId : undefined,
      }));
      catalog.push(await seed('STALE-VOID', { voided: true, taxId: '7777777777777' }));
      catalog.push(await seed('CENTRAL', { branchId: null, sourcePaymentType: null, taxId: '8888888888888' }));
      catalog.push(await seed('AP', { sourcePaymentType: 'procurement.supplier_payment', taxId: '9999999999999' }));
    });

    after(async () => {
      if (!created) return;
      await db().auditLog.deleteMany({ where: { companyId: readCompanyId } });
      await db().whtCertificateHistory.deleteMany({ where: { companyId: readCompanyId } });
      await db().whtCertificateHandoff.deleteMany({ where: { companyId: readCompanyId } });
      await db().whtCertificate.deleteMany({ where: { companyId: readCompanyId } });
      await db().taxPeriod.deleteMany({ where: { companyId: readCompanyId } });
      await db().documentNumber.deleteMany({ where: { companyId: readCompanyId } });
      await db().expensePayment.deleteMany({ where: { companyId: readCompanyId } });
      await db().expenseRecord.deleteMany({ where: { companyId: readCompanyId } });
      await db().company.deleteMany({ where: { id: readCompanyId } });
      await db().user.deleteMany({ where: { id: { in: [actorId, otherId] } } });
    });

    for (const scope of ['unrestricted', 'one branch', 'own expenses'] as const) it(`C1 array and paged reads enforce ${scope} scope across all four tabs on PostgreSQL`, async (t) => {
      if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
      const ctx = scope === 'one branch' ? branchActor() : scope === 'own expenses' ? ownActor() : actor();
      const visible = catalog.filter(row => scope === 'one branch' ? !row.label.startsWith('B-') : scope === 'own expenses' ? !row.label.startsWith('OTHER-') : true);
      const pendingVisible = visible.filter(row => row.label !== 'STALE-VOID');
      const handoffs = useCases().handoffs;
      const array = await handoffs.list(ctx);
      assert.ok(Array.isArray(array));
      assert.deepEqual(new Set(array.map(row => row.id)), new Set(visible.map(row => row.handoff.id)));
      const all = await handoffs.listPaged(ctx, { pageSize: 100 });
      assert.deepEqual(new Set(all.rows.map(row => row.id)), new Set(pendingVisible.map(row => row.handoff.id)));
      assert.equal(all.total, all.rows.length);
      assert.equal(Object.values(all.counts).reduce((sum, count) => sum + count, 0), all.total);
      for (const status of statuses) {
        const expected = pendingVisible.filter(row => row.handoff.status === status);
        const page = await handoffs.listPaged(ctx, { status, pageSize: 100 });
        assert.deepEqual(new Set(page.rows.map(row => row.id)), new Set(expected.map(row => row.handoff.id)));
        assert.equal(page.total, expected.length); assert.equal(page.counts[status], page.rows.length);
        assert.deepEqual(page.counts, all.counts);
        const tabArray = await handoffs.list(ctx, { status });
        assert.deepEqual(new Set(tabArray.map(row => row.id)), new Set(visible.filter(row => row.handoff.status === status).map(row => row.handoff.id)));
      }
      const outside = await handoffs.listPaged(branchActor(), { branchId: branchB });
      assert.equal(outside.total, 0); assert.deepEqual(outside.rows, []);
      assert.deepEqual(outside.counts, { REQUIRED: 0, SYSTEM_ISSUED: 0, EXTERNAL_LINKED: 0, CANCELLED: 0 });
      assert.deepEqual(await handoffs.list(branchActor(), { branchId: branchB }), []);
      const required = catalog.find(row => row.label === 'A-REQUIRED')!;
      assert.deepEqual((await handoffs.list(ctx, { sourcePaymentId: required.source!.id })).map(row => row.id), [required.handoff.id]);
    });

    it('WHT-LIST PostgreSQL sums share tab, month, form, branch and search filters across pages', async (t) => {
      if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
      const handoffs = useCases().handoffs;
      for (const status of statuses) {
        const query = { status, periodKey: '2026-07', formType: 'PND53', search: 'ผู้รับเงิน', pageSize: 1 };
        const first = await handoffs.listPaged(branchActor(), query);
        const second = await handoffs.listPaged(branchActor(), { ...query, page: 2 });
        const expected = catalog.filter(row => !row.label.startsWith('B-') && row.label !== 'STALE-VOID' && row.handoff.status === status);
        assert.deepEqual(first.sums, { withheld: new Decimal(expected.length).mul(3).toFixed(2) });
        assert.deepEqual(second.sums, first.sums);
        assert.equal(first.rows.length, 1);
        assert.notEqual(first.rows[0].id, second.rows[0].id);
      }
      for (const query of [{ periodKey: '2026-08' }, { formType: 'PND3' }, { branchId: branchB }, { search: 'not-present' }]) {
        assert.deepEqual((await handoffs.listPaged(branchActor(), query)).sums, { withheld: '0.00' });
      }
      const system = catalog.find(row => row.label === 'A-SYSTEM_ISSUED')!;
      try {
        await db().whtCertificate.update({ where: { id: system.certificate!.id }, data: { withheldAmount: '7.25' } });
        const result = await handoffs.listPaged(branchActor(), { status: 'SYSTEM_ISSUED', search: system.certificateNumber! });
        assert.deepEqual(result.sums, { withheld: '7.25' });
        assert.equal(result.total, 1);
      } finally {
        await db().whtCertificate.update({ where: { id: system.certificate!.id }, data: { withheldAmount: '3' } });
      }
    });

    it('C1 PostgreSQL search resolves payee JSON, tax digits, system/external/cancelled certificate and expense numbers with matching scoped counts', async (t) => {
      if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
      const handoffs = useCases().handoffs;
      const required = catalog.find(row => row.label === 'A-REQUIRED')!;
      const system = catalog.find(row => row.label === 'A-SYSTEM_ISSUED')!;
      const external = catalog.find(row => row.label === 'A-EXTERNAL_LINKED')!;
      const cancelled = catalog.find(row => row.label === 'A-CANCELLED')!;
      for (const [search, expected] of [
        [required.facts.payeeSnapshot.name, required], [required.facts.payeeSnapshot.taxId, required],
        [system.certificateNumber!, system], [external.certificateNumber!, external], [cancelled.certificateNumber!, cancelled],
        [required.source!.expenseNumber!, required],
      ] as const) {
        const page = await handoffs.listPaged(branchActor(), { search: search.toLowerCase() });
        assert.deepEqual(page.rows.map(row => row.id), [expected.handoff.id]);
        assert.equal(page.total, 1); assert.equal(page.counts[expected.handoff.status], 1);
        assert.equal(Object.values(page.counts).reduce((sum, count) => sum + count, 0), 1);
        assert.equal(page.rows[0].payeeName, expected.facts.payeeSnapshot.name);
        assert.equal(page.rows[0].expenseNumber, expected.source!.expenseNumber);
        assert.equal(page.rows[0].certificateNumber, expected.certificateNumber);
      }
      const outside = catalog.find(row => row.label === 'B-SYSTEM_ISSUED')!;
      assert.equal((await handoffs.listPaged(branchActor(), { search: outside.certificateNumber! })).total, 0);
      const other = catalog.find(row => row.label === 'OTHER-REQUIRED')!;
      assert.equal((await handoffs.listPaged(ownActor(), { search: other.source!.expenseNumber! })).total, 0);
      const stale = catalog.find(row => row.label === 'STALE-VOID')!;
      assert.equal((await handoffs.listPaged(actor(), { status: 'REQUIRED', search: stale.source!.expenseNumber! })).counts.REQUIRED, 0);
    });

    it('C1 related-expense PostgreSQL predicates reuse persisted actor relations without widening own access', async (t) => {
      if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
      const ctx = { ...branchActor(), permissions: ['expense.read_related', 'expense.read_own'] };
      const expected = catalog.filter(row => row.label.startsWith('A-') || ['OTHER-REQUIRED', 'CENTRAL', 'AP'].includes(row.label));
      const handoffs = useCases().handoffs;
      const page = await handoffs.listPaged(ctx, { pageSize: 100 });
      assert.deepEqual(new Set(page.rows.map(row => row.id)), new Set(expected.map(row => row.handoff.id)));
      assert.equal(page.total, expected.length);
      const related = catalog.find(row => row.label === 'OTHER-REQUIRED')!;
      assert.equal((await handoffs.get(ctx, related.handoff.id)).id, related.handoff.id);
      await assert.rejects(handoffs.get(ownActor(), related.handoff.id), NotFoundException);
    });

    const entries = ['get', 'payee address', 'self-issued record', 'system issue', 'download', 'correction', 'replacement copy'] as const;
    for (const entry of entries) it(`C1 ${entry} on PostgreSQL hides branch/expense scope exactly like a missing id and preserves in-scope behavior`, async (t) => {
      if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
      const status = ['download', 'correction', 'replacement copy'].includes(entry) ? 'SYSTEM_ISSUED' : 'REQUIRED';
      const allowed = await seed(`allowed-${entry}`, { status });
      const foreignBranch = await seed(`branch-${entry}`, { status, branchId: branchB });
      const foreignOwner = await seed(`owner-${entry}`, { status, creatorId: otherId });
      const services = useCases();
      const call = (ctx: any, id: string): Promise<any> => {
        if (entry === 'get') return services.handoffs.get(ctx, id);
        if (entry === 'payee address') return services.handoffs.setPayeeAddress(ctx, id, { payeeAddress: '99 ถนนทดสอบ กรุงเทพฯ 10100' });
        if (entry === 'self-issued record') return services.handoffs.linkExternal(ctx, id, {
          commandId: `c1b:${id}`, externalCertificateNumber: 'EXT-C1b-record', externalEvidenceRef: 'synthetic paper', issuedDate: '2026-07-31',
        });
        if (entry === 'system issue') return services.issue.execute(ctx, id);
        if (entry === 'download') return services.issue.download(ctx, id);
        if (entry === 'correction') return services.correct.execute(ctx, id, { payeeSnapshot: { address: '99 ถนนทดสอบ กรุงเทพฯ 10100' } }, 'แก้ที่อยู่');
        return services.replacement.execute(ctx, id);
      };
      const before = { certificates: await db().whtCertificate.count({ where: { companyId: readCompanyId } }),
        numbers: await db().documentNumber.count({ where: { companyId: readCompanyId } }),
        audits: await db().auditLog.count({ where: { companyId: readCompanyId } }),
        history: await db().whtCertificateHistory.count({ where: { companyId: readCompanyId } }) };
      let missing: unknown;
      await assert.rejects(call(actor(), `missing-${readCompanyId}`), (error: any) => { assert.equal(error.getStatus(), 404); missing = error.getResponse(); return true; });
      for (const [ctx, row] of [[branchActor(), foreignBranch], [ownActor(), foreignOwner]] as const) {
        await assert.rejects(call(ctx, row.handoff.id), (error: any) => {
          assert.equal(error.getStatus(), 404); assert.equal(error.message, 'WHT handoff not found.'); assert.deepEqual(error.getResponse(), missing); return true;
        });
        assert.deepEqual(await db().whtCertificateHandoff.findUniqueOrThrow({ where: { id: row.handoff.id } }), row.handoff);
      }
      assert.deepEqual({ certificates: await db().whtCertificate.count({ where: { companyId: readCompanyId } }),
        numbers: await db().documentNumber.count({ where: { companyId: readCompanyId } }),
        audits: await db().auditLog.count({ where: { companyId: readCompanyId } }),
        history: await db().whtCertificateHistory.count({ where: { companyId: readCompanyId } }) }, before);
      if (entry === 'system issue' || entry === 'self-issued record') await recordDatedPayment(allowed.source!.id, '2026-07-31', readCompanyId, '97');
      const result = await call({ ...ownActor(), scopes: { branchIds: [branchA] } }, allowed.handoff.id);
      const saved = await db().whtCertificateHandoff.findUniqueOrThrow({ where: { id: allowed.handoff.id } });
      if (entry === 'get') assert.equal(result.id, allowed.handoff.id);
      if (entry === 'payee address') {
        assert.equal(saved.payeeAddress, '99 ถนนทดสอบ กรุงเทพฯ 10100'); assert.equal(result.counterpartyAutoSave.case, 'SKIPPED');
      }
      if (entry === 'self-issued record') {
        assert.equal(saved.status, 'EXTERNAL_LINKED'); assert.equal(saved.externalCertificateNumber, 'EXT-C1b-record');
        assert.equal(await db().whtCertificateHistory.count({ where: { companyId: readCompanyId, handoffId: saved.id, eventType: 'EXTERNAL_RECORDED' } }), 1);
      }
      if (['system issue', 'correction'].includes(entry)) {
        assert.equal(saved.status, 'SYSTEM_ISSUED'); assert.equal(saved.certificateId, result.id);
        assert.equal(await db().documentNumber.count({ where: { companyId: readCompanyId, ownerId: result.id, status: 'COMMITTED' } }), 1);
        assert.equal(await db().whtCertificateHistory.count({ where: { companyId: readCompanyId, handoffId: saved.id, eventType: 'ISSUED', certificateId: result.id } }), 1);
      }
      if (entry === 'correction') {
        const old = await db().whtCertificate.findUniqueOrThrow({ where: { id: allowed.certificate!.id } });
        assert.equal(old.status, 'VOIDED'); assert.equal(old.supersededByCertificateId, result.id);
        assert.notEqual(result.certificateNumber, old.certificateNumber);
      }
      if (entry === 'download' || entry === 'replacement copy') {
        assert.equal(result.id, allowed.certificate!.id); assert.equal(result.certificateNumber, allowed.certificate!.certificateNumber);
        assert.equal(result.pdfArtifact.mimeType, 'application/pdf');
        const paper = await db().whtCertificate.findUniqueOrThrow({ where: { id: result.id } });
        assert.equal(paper.replacementCopyCount, entry === 'replacement copy' ? 1 : 0);
        assert.equal(await db().documentNumber.count({ where: { companyId: readCompanyId } }), before.numbers);
      }
      assert.equal((await db().expenseRecord.findUniqueOrThrow({ where: { id: allowed.source!.id } })).status, 'CONFIRMED');
    });

    it('C1 expense certificate history on PostgreSQL returns in-scope papers and hides another branch or creator', async (t) => {
      if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
      const handoffs = useCases().handoffs;
      const own = catalog.find(row => row.label === 'A-SYSTEM_ISSUED')!;
      const otherBranch = catalog.find(row => row.label === 'B-SYSTEM_ISSUED')!;
      const otherOwner = catalog.find(row => row.label === 'OTHER-SYSTEM_ISSUED')!;
      const history = await handoffs.getExpenseHistory(branchActor(), own.source!.id);
      assert.equal(history.length, 1); assert.equal(history[0].certificateNumber, own.certificateNumber);
      assert.equal(history[0].actorDisplayName, 'Synthetic C1 reader');
      assert.equal((await handoffs.getExpenseHistory(ownActor(), own.source!.id)).length, 1);
      assert.equal((await handoffs.getExpenseHistory(actor(), otherBranch.source!.id)).length, 1);
      assert.deepEqual(await handoffs.getExpenseHistory(branchActor(), otherBranch.source!.id), []);
      assert.deepEqual(await handoffs.getExpenseHistory(ownActor(), otherOwner.source!.id), []);
      assert.deepEqual(await handoffs.getExpenseHistory(actor(), `missing-${readCompanyId}`), []);
    });

    it('C17 PostgreSQL historical search retains current tabs, counts and scope, with descriptions and address-clear history', async (t) => {
      if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
      const key = `C17-${randomUUID()}`;
      const entries = [];
      for (const [index, status] of statuses.entries()) {
        const item = await seed(`${key}-${index}`, { status }); entries.push(item);
        await db().whtCertificateHistory.create({ data: {
          companyId: readCompanyId, expenseId: item.source!.id, handoffId: item.handoff.id, actorUserId: actorId, isExternal: status === 'EXTERNAL_LINKED',
          eventType: status === 'SYSTEM_ISSUED' ? 'CORRECTED' : status === 'EXTERNAL_LINKED' ? 'EXTERNAL_RECORD_CHANGED' : status === 'REQUIRED' ? 'EXTERNAL_RECORD_REMOVED' : 'CANCELLED_SOURCE_VOIDED',
          certificateNumber: status === 'EXTERNAL_LINKED' ? item.certificateNumber : `OLD-${key}-${index}`,
          relatedCertificateNumber: status === 'SYSTEM_ISSUED' ? item.certificateNumber : null,
          detailsJson: status === 'EXTERNAL_LINKED' ? { previousRecord: { number: `OLD-${key}-${index}` } } : { removedManually: status === 'REQUIRED' },
        } });
      }
      const outside = await seed(`${key}-outside`, { branchId: branchB, creatorId: otherId });
      await db().whtCertificateHistory.create({ data: { companyId: readCompanyId, expenseId: outside.source!.id, handoffId: outside.handoff.id,
        actorUserId: actorId, isExternal: false, eventType: 'CORRECTED', certificateNumber: `OLD-${key}-outside` } });
      const handoffs = useCases().handoffs;
      const ctx = { ...ownActor(), scopes: { branchIds: [branchA] } };
      const result = await handoffs.listPaged(ctx, { search: `OLD-${key}` });
      assert.equal(result.total, 4); assert.deepEqual(result.counts, { REQUIRED: 1, SYSTEM_ISSUED: 1, EXTERNAL_LINKED: 1, CANCELLED: 1 });
      for (const [index, status] of statuses.entries()) {
        const page = await handoffs.listPaged(ctx, { search: `OLD-${key}`, status });
        assert.equal(page.total, 1); assert.equal(page.rows[0].id, entries[index].handoff.id);
        assert.equal(page.rows[0].matchedPreviousNumber, `OLD-${key}-${index}`);
        if (status === 'SYSTEM_ISSUED') assert.equal(page.rows[0].currentCertificate?.number, entries[index].certificateNumber);
      }
      assert.equal((await handoffs.listPaged(actor(), { search: `OLD-${key}` })).total, 5);
      const pending = entries[0];
      await db().expenseLine.createMany({ data: [2, 1].map(lineNumber => ({ companyId: readCompanyId, expenseId: pending.source!.id,
        lineNumber, description: lineNumber === 1 ? 'ค่าเดินทาง' : 'ค่าจอดรถ', quantity: '1', unitPrice: '50', lineSubtotalAmount: '50', lineTotalAmount: '50' })) });
      await db().whtCertificateHistory.create({ data: { companyId: readCompanyId, expenseId: pending.source!.id, handoffId: pending.handoff.id,
        actorUserId: actorId, isExternal: false, eventType: 'PAYEE_ADDRESS_CLEARED', detailsJson: { reason: 'PAYEE_TAX_ID_CHANGED' } } });
      const page = await handoffs.listPaged(ctx, { sourcePaymentId: pending.source!.id });
      assert.equal(page.rows[0].expenseDescription, 'ค่าเดินทาง; ค่าจอดรถ'); assert.equal(page.rows[0].payeeAddressClearedByTaxIdChange, true);
      assert.equal(page.rows[0].previousCertificate, undefined);
      assert.equal((await handoffs.get(ctx, pending.handoff.id)).payeeAddressClearedByTaxIdChange, true);
      const events = await handoffs.getExpenseHistory(ctx, pending.source!.id);
      assert.ok(events.find(event => event.eventType === 'PAYEE_ADDRESS_CLEARED')?.occurredAt);
      await handoffs.setPayeeAddress(ctx, pending.handoff.id, { payeeAddress: '99 ที่อยู่ใหม่' });
      assert.equal((await handoffs.get(ctx, pending.handoff.id)).payeeAddressClearedByTaxIdChange, false);
    });

    it('C1 PostgreSQL pages more than 200 scoped pending handoffs without losing rows or tab counts', async (t) => {
      if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
      const facts = prefill('ผู้รับเงิน C1b bulk', '1010101010101');
      const data = Array.from({ length: 205 }, (_, index) => ({ id: `${readCompanyId}-bulk-${index}`, index }));
      await db().expenseRecord.createMany({ data: data.map(({ id }) => ({ id, companyId: readCompanyId, branchId: branchA,
        createdByUserId: actorId, status: 'CONFIRMED' as const, expenseNumber: `EXP-C1b-${id}`, expenseDate: date, netPayableAmount: '97', outstandingAmount: '97', whtAmount: '3' })) });
      await db().whtCertificateHandoff.createMany({ data: data.map(({ id, index }) => ({
        id: `${id}-handoff`, companyId: readCompanyId, status: 'REQUIRED' as const, sourcePaymentType: 'expense.record', sourcePaymentId: id, sourceBranchId: branchA,
        sourceFeatureKey: 'expenses', prefillSnapshotJson: facts, prefillSnapshotHash: 'synthetic', availabilityVectorJson: {},
        creationCommandId: `bulk:${id}`, payloadFingerprint: 'synthetic', createdAt: new Date(date.getTime() + index * 1000),
      })) });
      const rows: string[] = [];
      const handoffs = useCases().handoffs;
      for (let page = 1; page <= 3; page++) {
        const result = await handoffs.listPaged({ ...ownActor(), scopes: { branchIds: [branchA] } }, { status: 'REQUIRED', search: 'C1b bulk', page, pageSize: 100 });
        assert.equal(result.total, 205); assert.deepEqual(result.counts, { REQUIRED: 205, SYSTEM_ISSUED: 0, EXTERNAL_LINKED: 0, CANCELLED: 0 });
        assert.equal(result.page, page); assert.equal(result.pageSize, 100); assert.equal(result.rows.length, page === 3 ? 5 : 100);
        rows.push(...result.rows.map(row => row.expenseId!));
      }
      assert.equal(new Set(rows).size, 205); assert.equal(rows[0], data[204].id); assert.equal(rows.at(-1), data[0].id);
      assert.equal((await handoffs.list(actor())).length, 200, 'the legacy array caller retains its cap');
    });
  });

});


it('payment cancellation cancels its paid voucher and clears every cover while preserving durable payment ids and snapshots', async () => {
  const h = harness({ expenseNumber: 'EXP-1', postingStatus: 'pending' });
  const result = await h.repo.recordPaymentAtomic({ companyId: 'company-1', expenseId: 'expense-1', actorUserId: 'actor-1', scopes: {}, idempotencyKey: 'payment-one', amount: '10' });
  h.state.vouchers.push({ id: 'dv-1', companyId: 'company-1', status: 'PAID', version: 2, documentNumber: 'PV-1', paidSnapshotJson: { original: true }, pdfAttachmentId: 'pdf' });
  h.state.voucherLines.push(...[result.payment.id, 'payment-two', 'payment-three'].map(id => ({ companyId: 'company-1', voucherId: 'dv-1', expensePaymentId: id, coversPaymentId: id })));
  await h.repo.cancelPaymentAtomic({ companyId: 'company-1', expenseId: 'expense-1', paymentId: result.payment.id, actorUserId: 'actor-2', scopes: {}, reason: 'ยอดผิด' });
  assert.equal(h.state.vouchers[0].status, 'CANCELLED'); assert.equal(h.state.vouchers[0].cancelledAfterPaid, true);
  assert.equal(h.state.vouchers[0].cancelReason, 'การจ่ายของรายการ EXP-1 ถูกยกเลิก'); assert.equal(h.state.vouchers[0].cancelSourceReason, 'ยอดผิด'); assert.equal(h.state.vouchers[0].cancelledByUserId, 'actor-2');
  assert.equal(h.state.vouchers[0].documentNumber, 'PV-1'); assert.equal(h.state.vouchers[0].pdfAttachmentId, 'pdf'); assert.deepEqual(h.state.vouchers[0].paidSnapshotJson, { original: true });
  assert.ok(h.state.voucherLines.every(l => l.coversPaymentId === null && l.expensePaymentId));
});

it('reads all payment coverage once, masks an unreadable document id and applies issuance rights and payment state per row', async () => {
  let calls = 0, hiddenLine = false;
  const db = { disbursementVoucherLine: { findMany: async (query: any) => {
    calls++; assert.deepEqual(query.where.OR[0].coversPaymentId.in, ['p1', 'p2', 'p3']);
    assert.equal(query.select.voucher.select.lines.take, 1);
    return [{ coversPaymentId: 'p1', voucher: { id: 'dv', documentNumber: 'PV-1', branchId: 'branch-1', lines: hiddenLine ? [{ id: 'foreign-line' }] : [] } }];
  } } } as any;
  const repo = new PrismaExpenseRepository({ client: db } as any), source = { ...expense(), payments: [{ id: 'p1', status: 'RECORDED' }, { id: 'p2', status: 'RECORDED' }, { id: 'p3', status: 'VOIDED' }] } as any;
  const scope = { companyId: 'company-1', scopes: {} };
  const eligible = await repo.paymentDisbursements(source, scope, ['expense.disbursement.issue', 'expense.disbursement.read']);
  assert.equal(calls, 1); assert.deepEqual(eligible.get('p1'), { disbursementVoucher: { id: 'dv', documentNumber: 'PV-1' }, cancelledDisbursementVoucher: null, canIssueDisbursementVoucher: false });
  assert.deepEqual(eligible.get('p2'), { disbursementVoucher: null, cancelledDisbursementVoucher: null, canIssueDisbursementVoucher: true }); assert.equal(eligible.get('p3')?.canIssueDisbursementVoucher, false);
  hiddenLine = true; assert.equal((await repo.paymentDisbursements(source, { ...scope, createdByUserId: 'reader' }, ['expense.disbursement.read'])).get('p1')?.disbursementVoucher?.id, null);
  hiddenLine = false; assert.equal((await repo.paymentDisbursements(source, { ...scope, scopes: { branchIds: ['branch-2'] } }, ['expense.disbursement.read'])).get('p1')?.disbursementVoucher?.id, null);
  assert.equal((await repo.paymentDisbursements(source, { ...scope, scopes: { branchIds: ['branch-2'] } }, ['expense.disbursement.issue'])).get('p2')?.canIssueDisbursementVoucher, false);
  assert.equal((await repo.paymentDisbursements(source, { ...scope, createdByUserId: 'another-reader' }, ['expense.disbursement.issue'])).get('p2')?.canIssueDisbursementVoucher, false);
  assert.equal((await repo.paymentDisbursements(source, scope, [] )).get('p1')?.disbursementVoucher?.id, null);
  assert.equal((await repo.paymentDisbursements(source, scope, [] )).get('p2')?.canIssueDisbursementVoucher, false);
  assert.equal((await repo.paymentDisbursements({ ...source, status: 'DRAFT' }, scope, ['expense.disbursement.issue'])).get('p2')?.canIssueDisbursementVoucher, false);
  assert.equal((await repo.paymentDisbursements({ ...source, sourceReimbursementRequestId: 'claim' }, scope, ['expense.disbursement.issue'])).get('p2')?.canIssueDisbursementVoucher, false);
});

it('keeps the latest cancelled coverage for cancelled and surviving payments, prefers a new live document, and masks unreadable ids', async () => {
  let calls = 0, replaced = false, hiddenLine = false;
  const ids = ['cancelled-payment', 'surviving-payment'];
  const old = { id: 'old', documentNumber: 'PV-OLD', branchId: 'branch-1', status: 'CANCELLED', lines: [] };
  const latest = { ...old, id: 'latest', documentNumber: 'PV-LATEST' };
  const db = { disbursementVoucherLine: { findMany: async (query: any) => {
    calls++;
    assert.equal(query.where.companyId, 'company-1');
    assert.deepEqual(query.where.OR, [
      { coversPaymentId: { in: ids }, voucher: { is: { status: { not: 'CANCELLED' } } } },
      { expensePaymentId: { in: ids }, voucher: { is: { status: 'CANCELLED' } } },
    ]);
    assert.deepEqual(query.orderBy, [{ voucher: { cancelledAt: 'desc' } }, { voucherId: 'desc' }]);
    assert.equal(query.select.expensePaymentId, true); assert.equal(query.select.voucher.select.status, true);
    assert.equal(query.select.voucher.select.lines.take, 1);
    const rows = ids.flatMap(id => [latest, old].map(voucher => ({ coversPaymentId: null, expensePaymentId: id,
      voucher: { ...voucher, lines: hiddenLine ? [{ id: 'hidden-line' }] : [] } })));
    if (replaced) rows.push({ coversPaymentId: 'surviving-payment', expensePaymentId: 'surviving-payment',
      voucher: { ...latest, id: 'new', documentNumber: 'PV-NEW', status: 'PAID', lines: [] } } as any);
    return rows;
  } } };
  const repo = new PrismaExpenseRepository({ client: db } as any);
  const source = { ...expense(), payments: [{ id: ids[0], status: 'VOIDED' }, { id: ids[1], status: 'RECORDED' }] } as any;
  const scope = { companyId: 'company-1', scopes: {} };
  const read = (permissions = ['expense.disbursement.read', 'expense.disbursement.issue'], currentScope = scope) => repo.paymentDisbursements(source, currentScope, permissions);
  const answer = await read(); assert.equal(calls, 1);
  for (const id of ids) {
    assert.equal(answer.get(id)?.disbursementVoucher, null);
    assert.deepEqual(answer.get(id)?.cancelledDisbursementVoucher, { id: 'latest', documentNumber: 'PV-LATEST' });
  }
  assert.equal(answer.get(ids[0])?.canIssueDisbursementVoucher, false);
  assert.equal(answer.get(ids[1])?.canIssueDisbursementVoucher, true);
  for (const [permissions, currentScope] of [[[], scope], [['expense.disbursement.read'], { ...scope, scopes: { branchIds: ['another-branch'] } }]] as const) {
    const masked = await read([...permissions], currentScope);
    assert.deepEqual(masked.get(ids[0])?.cancelledDisbursementVoucher, { id: null, documentNumber: 'PV-LATEST' });
  }
  hiddenLine = true;
  assert.equal((await read()).get(ids[1])?.cancelledDisbursementVoucher?.id, null);
  hiddenLine = false; replaced = true;
  const issued = await read();
  assert.deepEqual(issued.get(ids[1])?.disbursementVoucher, { id: 'new', documentNumber: 'PV-NEW' });
  assert.equal(issued.get(ids[1])?.cancelledDisbursementVoucher, null);
  assert.equal(issued.get(ids[1])?.canIssueDisbursementVoucher, false);
  assert.deepEqual(issued.get(ids[0])?.cancelledDisbursementVoucher, { id: 'latest', documentNumber: 'PV-LATEST' });
});

it('renders only the exact recorded signature attachment and checksum, never the current personal asset', async () => {
  const bytes = Buffer.from('original signature bytes'), checksumSha256 = createHash('sha256').update(bytes).digest('hex');
  const queries: any[] = [];
  const client: any = { attachmentObject: { findFirst: async (q: any) => { queries.push(q); return { id: q.where.id, bucket: 'private', objectKey: q.where.id, mimeType: 'image/png' }; } } };
  let stored = bytes;
  const files = new DisbursementVoucherFileService({ client } as any, { getObject: async ({ objectKey }: any) => { assert.equal(objectKey, 'old-signature'); return { bytes: stored }; } } as any);
  const snapshot: any = { actors: { preparer: { name: 'สมใจ', signature: { userId: 'actor', attachmentId: 'old-signature', checksumSha256 } }, approver: { name: 'สมชาย' } } };
  const rendered = await files.withSignatures('company', snapshot);
  assert.equal(rendered.actors?.preparer?.signatureDataUrl, `data:image/png;base64,${bytes.toString('base64')}`);
  assert.equal(rendered.actors?.approver?.signatureDataUrl, undefined);
  assert.equal(snapshot.actors.preparer.signatureDataUrl, undefined);
  assert.equal(queries[0].where.companyId, 'company'); assert.equal(queries[0].where.id, 'old-signature');
  stored = Buffer.from('changed bytes');
  await assert.rejects(() => files.withSignatures('company', snapshot), /checksum mismatch/);
  client.attachmentObject.findFirst = async () => null;
  await assert.rejects(() => files.withSignatures('company', snapshot), /unavailable/);
});

it('stores one immutable disbursement PDF after a failed storage attempt and verifies its checksum on later reads', async () => {
  const voucher: any = { id: 'dv-file', companyId: 'co', branchId: 'branch', documentNumber: 'PV-1', status: 'PAID', paidSnapshotJson: { original: true }, paidSnapshotHash: 'hash', pdfAttachmentId: null, paidByUserId: 'payer', templateVersion: 1 };
  const attachments: any[] = [], links: any[] = [];
  let chain = Promise.resolve(), fail = true, puts = 0, renders = 0;
  const bytes = Buffer.from('%PDF original bytes'), objects = new Map<string, Buffer>();
  const client: any = {
    $executeRaw: async () => 1,
    $transaction: (work: any) => { const result = chain.then(() => work(client)); chain = result.catch(() => undefined); return result; },
    disbursementVoucher: { findFirst: async () => voucher, updateMany: async () => { voucher.pdfAttachmentId = 'attachment'; return { count: 1 }; } },
    attachmentObject: { create: async ({ data }: any) => { const row = { ...data, id: 'attachment' }; attachments.push(row); return row; }, findFirstOrThrow: async () => attachments[0] },
    attachmentLink: { create: async ({ data }: any) => { links.push(data); return data; } },
  };
  const storage: any = { putObject: async ({ objectKey, bytes }: any) => { puts++; if (fail) throw new Error('storage failed'); objects.set(objectKey, bytes); return { bucket: 'test', objectKey, objectVersionId: '1', storageProvider: 'test' }; },
    getObject: async ({ objectKey }: any) => ({ bytes: objects.get(objectKey) }), deleteObject: async () => undefined };
  const files = new DisbursementVoucherFileService({ client } as any, storage);
  files.render = async () => { renders++; return bytes; };
  await assert.rejects(() => files.ensure('co', 'dv-file'), /storage failed/);
  assert.equal(voucher.pdfAttachmentId, null); assert.equal(attachments.length, 0);
  fail = false;
  const [first, second] = await Promise.all([files.ensure('co', 'dv-file'), files.ensure('co', 'dv-file')]);
  assert.deepEqual(first.data, bytes); assert.deepEqual(second.data, bytes);
  assert.equal(attachments.length, 1); assert.equal(puts, 2); assert.equal(renders, 2);
  assert.equal(links[0].purpose, 'expense.disbursement_voucher.pdf');
  assert.equal(attachments[0].checksumSha256, createHash('sha256').update(bytes).digest('hex'));
  voucher.paidSnapshotJson = { changed: true }; files.render = async () => { throw new Error('must not render again'); };
  assert.deepEqual((await files.ensure('co', 'dv-file')).data, bytes);
  objects.set(attachments[0].objectKey, Buffer.from('corrupt'));
  await assert.rejects(() => files.ensure('co', 'dv-file'), /checksum mismatch/);
});

it('orders scoped list IDs in SQL before paging and restores SQL order after hydration', async () => {
  const counts = { DRAFT: 3, PENDING_APPROVAL: 1, APPROVED: 1, PAID: 2, CANCELLED: 2 };
  const fixtures = Object.entries(counts).flatMap(([status, count]) => Array.from({ length: count }, (_, i) => ({ id: `${status}-${i}`, status, cancelledAfterPaid: false })));
  const checkScope = (where: any) => {
    assert.equal(where.companyId, 'company');
    assert.deepEqual(where.branchId, { in: ['branch'] });
    assert.match(JSON.stringify(where.lines), /reader/);
  };
  let sqlCalls = 0;
  const tx: any = {
    disbursementVoucher: {
      groupBy: async (query: any) => {
        assert.deepEqual(query._sum, { totalAmount: true }); checkScope(query.where);
        return Object.entries(counts).map(([status, count]) => ({ status, _count: { _all: count }, _sum: { totalAmount: '99999999999999.9950' } }));
      },
      findMany: async (query: any) => {
        checkScope(query.where);
        const rows = fixtures.filter(row => !query.where.status || row.status === query.where.status);
        return query.select ? rows.map(({ id }) => ({ id })) : rows.filter(row => query.where.id.in.includes(row.id)).reverse();
      },
    },
    $queryRaw: async (query: Prisma.Sql) => {
      sqlCalls++;
      const [company, ids, limit, offset] = query.values as [string, string[], number, number];
      assert.equal(company, 'company');
      const direction = query.sql.includes(' ASC') ? 'ASC' : 'DESC';
      assert.ok(query.sql.includes(`ORDER BY COALESCE("paidDate", "plannedPayDate", "createdAt"::date) ${direction}, "createdAt" ${direction}, "id" ${direction}`));
      assert.match(query.sql, /LIMIT \? OFFSET \?/);
      const rows = fixtures.filter(row => ids.includes(row.id));
      return (direction === 'ASC' ? rows.reverse() : rows).slice(offset, offset + limit).map(({ id }) => ({ id }));
    },
  };
  const repo = new PrismaDisbursementVoucherRepository({ client: { $transaction: async (run: any, options: any) => {
    assert.equal(options.isolationLevel, 'RepeatableRead'); return run(tx);
  } } } as any);
  const scope = { companyId: 'company', scopes: { branchIds: ['branch'] }, relatedUserId: 'reader' };
  for (const order of ['newest', 'oldest'] as const) {
    const result = await repo.list(scope, { order, page: 2, pageSize: 4 });
    const expected = order === 'newest' ? fixtures : [...fixtures].reverse();
    assert.deepEqual(result.rows.map(row => row.id), expected.slice(4, 8).map(row => row.id));
    assert.equal(result.sums.APPROVED, '100000000000000.00');
    assert.deepEqual(result.counts, counts); assert.equal(result.total, 9);
  }
  for (const status of Object.keys(counts)) {
    const result = await repo.list(scope, { status: status as any, page: 2, pageSize: 1 });
    assert.deepEqual(result.rows.map(row => row.id), fixtures.filter(row => row.status === status).slice(1, 2).map(row => row.id));
    assert.equal(result.total, counts[status as keyof typeof counts]);
  }
  assert.equal(sqlCalls, 7);
});

describe('Disbursement voucher draft command integrity (real PostgreSQL)', () => {
  const required = process.env.EXPENSE_PAYMENT_REQUIRE_POSTGRES === 'true';
  const companyId = `disbursement-draft-pg-${randomUUID()}`;
  const userId = `${companyId}-user`, secondUserId = `${companyId}-issuer`, branchId = `${companyId}-branch`;
  let clients: PrismaClient[] = [];
  let ready = false, fixtureCreated = false;
  let unreachable: string | null = null;
  before(async () => {
    const url = process.env.DATABASE_URL;
    if (!url) { assert.equal(required, false, 'Draft PostgreSQL is required but DATABASE_URL is unavailable'); return; }
    clients = [0, 1].map(() => new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }));
    unreachable = await pgSpecUnreachableReason(async () => {
      await clients[0]!.$queryRaw`SELECT "commandId", "resultJson" FROM "DisbursementVoucherCommand" LIMIT 0`;
      return clients[0]!.$queryRaw`SELECT "postApprovalAction" FROM "DisbursementVoucherRevision" LIMIT 0`;
    }, 'EXPENSE_PAYMENT_REQUIRE_POSTGRES');
    if (unreachable) return;
    await clients[0]!.company.create({ data: { id: companyId, name: 'Synthetic disbursement drafts' } });
    fixtureCreated = true;
    await clients[0]!.user.create({ data: { id: userId, displayName: 'Synthetic draft preparer' } });
    await clients[0]!.user.create({ data: { id: secondUserId, displayName: 'Synthetic second issuer' } });
    // The preparer is a member of the shop, as a real preparer is: an approver may not send a document back to people who are no longer members.
    await clients[0]!.companyMembership.create({ data: { companyId, userId } });
    await clients[0]!.branch.create({ data: { id: branchId, companyId, code: 'HO', name: 'Source branch', type: 'HEAD_OFFICE', createdByUserId: userId } });
    ready = true;
  });
  after(async () => {
    const client = clients[0]; if (!client) return;
    try {
      if (fixtureCreated) {
        await client.auditLog.deleteMany({ where: { companyId } });
        await client.outboxEvent.deleteMany({ where: { companyId } });
        await client.disbursementVoucherCommand.deleteMany({ where: { companyId } });
        await client.disbursementVoucher.deleteMany({ where: { companyId } });
        await client.expensePayment.deleteMany({ where: { companyId } });
        await client.expenseRecord.deleteMany({ where: { companyId } });
        await client.company.deleteMany({ where: { id: companyId } });
        await client.user.deleteMany({ where: { id: { in: [userId, secondUserId] } } });
      }
    } finally { await Promise.all(clients.map(c => c.$disconnect())); }
  });
  const context = () => ({ companyId, userId, requestId: randomUUID(), roles: [], permissions: ['expense.disbursement.prepare', 'expense.read'], scopes: {} } as any);
  const useCase = (client: PrismaClient, audit?: AuditService, files?: DisbursementVoucherFileService) => {
    const prisma = { client } as any, expenses = new PrismaExpenseRepository(prisma);
    return new DisbursementVoucherUseCase(new PrismaDisbursementVoucherRepository(prisma), expenses, new ListExpensesUseCase(expenses),
      audit ?? new AuditService(new PrismaAuditRepository(prisma), { error: () => undefined } as any), undefined, files);
  };
  const createExpense = () => clients[0]!.expenseRecord.create({ data: { companyId, branchId, createdByUserId: userId,
    expenseNumber: `EXP-${randomUUID()}`,
    status: 'CONFIRMED', expenseDate: new Date('2026-10-01'), vendorNameSnapshot: 'ร้านทดสอบ',
    grandTotalAmount: '107', whtAmount: '3', netPayableAmount: '104', outstandingAmount: '104' } });

  it('supporting-file links are idempotent, roll back with audit failure and serialize against submission', async t => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const expense = await createExpense();
    const draft = await useCase(clients[0]!).create(context(), { commandId: randomUUID(), lines: [{ expenseId: expense.id, amount: '104' }] });
    const file = await clients[0]!.attachmentObject.create({ data: { companyId, branchId, storageProvider: 'db', bucket: 'db', objectKey: randomUUID(), originalFileName: 'bank.png', mimeType: 'image/png', byteSize: 10, status: 'ACTIVE', uploadedByUserId: userId,
      metadataJson: { generatedFor: 'disbursement_voucher_supporting', voucherId: draft.id } } });
    const scope = { companyId, scopes: {} };
    const repo = (i: number) => new PrismaDisbursementVoucherRepository({ client: clients[i] } as any);
    await assert.rejects(() => repo(0).changeSupportingFileAtomic(scope, draft.id, file.id, userId, false, async () => { throw new Error('audit failed'); }), /audit failed/);
    assert.equal(await clients[0]!.attachmentLink.count({ where: { attachmentId: file.id } }), 0);
    await Promise.all([0, 1].map(i => repo(i).changeSupportingFileAtomic(scope, draft.id, file.id, userId, false, async () => {})));
    assert.equal(await clients[0]!.attachmentLink.count({ where: { attachmentId: file.id } }), 1);
    let locked!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { locked = resolve; });
    const continueSubmission = new Promise<void>(resolve => { release = resolve; });
    const submit = clients[0]!.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${companyId}:${draft.id}:disbursement-voucher-lifecycle`}))`;
      locked(); await continueSubmission;
      await tx.disbursementVoucher.update({ where: { id: draft.id }, data: { status: 'PENDING_APPROVAL' } });
    });
    await entered;
    const removal = assert.rejects(() => repo(1).changeSupportingFileAtomic(scope, draft.id, file.id, userId, true, async () => {}), (error: any) => error.getResponse().code === 'disbursement_supporting_frozen');
    release(); await Promise.all([submit, removal]);
    assert.equal(await clients[0]!.attachmentLink.count({ where: { attachmentId: file.id } }), 1);
  });

  it('orders paid, planned and created dates with stable ties and paging in both directions in PostgreSQL', async t => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const q = `order-${randomUUID()}`;
    const fixtures = [
      ['cancelled', 'CANCELLED', 9, null, null], ['paid-old', 'PAID', 8, 1, 10], ['approved', 'APPROVED', 7, null, 11],
      ['pending', 'PENDING_APPROVAL', 6, null, 11], ['draft', 'DRAFT', 4, null, null], ['sent-back', 'DRAFT', 5, null, null], ['paid-new', 'PAID', 2, 3, null],
      ['tie-a', 'DRAFT', 5, null, 11], ['tie-b', 'DRAFT', 5, null, 11],
    ] as const;
    for (const [name, status, created, paid, planned] of fixtures) await clients[0]!.disbursementVoucher.create({ data: {
      id: `${q}-${name}`, companyId, branchId, preparedByUserId: userId, origin: 'PREPARED', payeeName: q,
      payeeBasis: 'SINGLE', totalAmount: '10', status, createdAt: new Date(`2026-10-${String(created).padStart(2, '0')}T00:00:00Z`),
      ...(name === 'sent-back' ? { returnedAt: new Date('2026-10-05'), returnReason: 'ตรวจใหม่' } : {}),
      ...(paid ? { paidDate: new Date(`2026-10-${String(paid).padStart(2, '0')}`) } : {}),
      ...(planned ? { plannedPayDate: new Date(`2026-10-${String(planned).padStart(2, '0')}`) } : {}),
    } });
    const repo = new PrismaDisbursementVoucherRepository({ client: clients[0]! } as any), scope = { companyId, scopes: {} };
    const expected = ['approved', 'pending', 'tie-b', 'tie-a', 'cancelled', 'sent-back', 'draft', 'paid-new', 'paid-old'].map(name => `${q}-${name}`);
    for (const order of ['newest', 'oldest'] as const) {
      const pages = await Promise.all([1, 2, 3].map(page => repo.list(scope, { q, order, page, pageSize: 3 })));
      assert.deepEqual(pages.flatMap(page => page.rows.map(row => row.id)), order === 'newest' ? expected : [...expected].reverse());
      assert.ok(pages.every(page => page.total === 9));
      assert.ok(pages.every(page => page.counts.DRAFT === 4 && page.sums.DRAFT === '40.00' && page.sums.PAID === '20.00'));
    }
    const paid = await repo.list(scope, { q, status: 'PAID', page: 1, pageSize: 3 });
    assert.deepEqual(paid.rows.map(row => row.id), ['paid-new', 'paid-old'].map(name => `${q}-${name}`));
  });

  it('concurrent same-command creates yield one draft, line, journal and audit with no reservation or number', async t => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const expense = await createExpense(), commandId = randomUUID();
    const body = { commandId, lines: [{ expenseId: expense.id, amount: '10.10' }] };
    const results = await Promise.all(clients.map(c => useCase(c).create(context(), body)));
    assert.deepEqual(results[0], results[1]);
    const id = results[0]!.id;
    assert.equal(results[0]!.documentNumber, null);
    assert.equal(await clients[0]!.disbursementVoucher.count({ where: { companyId, id } }), 1);
    assert.equal(await clients[0]!.disbursementVoucherLine.count({ where: { companyId, voucherId: id } }), 1);
    assert.equal(await clients[0]!.disbursementVoucherCommand.count({ where: { companyId, commandId } }), 1);
    assert.equal(await clients[0]!.auditLog.count({ where: { companyId, targetId: id, action: 'expense.disbursement.draft_created' } }), 1);
    assert.equal((await clients[0]!.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } })).reservedByDisbursementVoucherId, null);
    await assert.rejects(() => useCase(clients[1]!).create(context(), { ...body, note: 'เปลี่ยน' }), (e: any) => e.getResponse?.().code === 'disbursement_command_conflict');
    await useCase(clients[0]!).delete(context(), id);
    assert.deepEqual(await useCase(clients[1]!).create(context(), body), results[0]);
    assert.equal(await clients[0]!.disbursementVoucher.count({ where: { companyId, id } }), 0);
  });

  it('concurrent edits with one expected version produce one success and one stale-version refusal', async t => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const expense = await createExpense();
    const draft = await useCase(clients[0]!).create(context(), { commandId: randomUUID(), lines: [{ expenseId: expense.id, amount: '10' }] });
    const results = await Promise.allSettled(clients.map((c, i) => useCase(c).update(context(), draft.id,
      { commandId: randomUUID(), expectedVersion: 0, lines: [{ expenseId: expense.id, amount: String(20 + i) }] })));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const failure = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
    assert.equal(failure.reason.getResponse?.().code, 'disbursement_version_conflict');
    assert.equal((await clients[0]!.disbursementVoucher.findUniqueOrThrow({ where: { id: draft.id } })).version, 1);
    assert.equal(await clients[0]!.disbursementVoucherCommand.count({ where: { companyId, voucherId: draft.id } }), 2);
    assert.equal(await clients[0]!.auditLog.count({ where: { companyId, targetId: draft.id, action: 'expense.disbursement.draft_updated' } }), 1);
  });

  it('list/counts and detail apply every-line visibility in PostgreSQL and hide foreign companies and branches', async t => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const first = await createExpense(), foreign = await createExpense();
    await clients[0]!.expenseRecord.update({ where: { id: foreign.id }, data: { createdByUserId: 'another-reader' } });
    const own = await useCase(clients[0]!).create(context(), { commandId: randomUUID(), lines: [{ expenseId: first.id, amount: '1' }] });
    const mixed = await useCase(clients[0]!).create(context(), { commandId: randomUUID(), lines: [{ expenseId: first.id, amount: '1' }, { expenseId: foreign.id, amount: '1' }] });
    assert.equal(mixed.payeeBasis, 'SAME_NAME'); assert.equal(mixed.payeeConfirmedByUserId, null);
    const full = { ...context(), permissions: ['expense.disbursement.read', 'expense.read'] };
    const onlyOwn = { ...context(), permissions: ['expense.disbursement.read', 'expense.read_own'] };
    const reader = useCase(clients[0]!);
    const fullList = await reader.list(full, {}), ownList = await reader.list(onlyOwn, {});
    assert.ok(fullList.data.some(v => v.id === own.id) && fullList.data.some(v => v.id === mixed.id));
    assert.ok(ownList.data.some(v => v.id === own.id)); assert.ok(!ownList.data.some(v => v.id === mixed.id));
    assert.equal(fullList.total, Object.values(fullList.counts).reduce((n, count) => n + count, 0));
    assert.equal(ownList.total, ownList.data.length);
    const hidden = await reader.get(onlyOwn, mixed.id).catch(e => e.getResponse());
    assert.deepEqual(hidden, await reader.get(onlyOwn, randomUUID()).catch(e => e.getResponse()));
    for (const denied of [{ ...full, companyId: `${companyId}-other` }, { ...full, scopes: { branchIds: ['other-branch'] } }]) {
      assert.equal((await reader.list(denied, {})).total, 0);
      assert.deepEqual(await reader.get(denied, own.id).catch(e => e.getResponse()), hidden);
    }
  });

  it('searches payee and number in PostgreSQL before paging and shares q counts across status and visibility', async t => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const first = await createExpense(), foreign = await createExpense();
    await clients[0]!.expenseRecord.update({ where: { id: foreign.id }, data: { createdByUserId: secondUserId } });
    const key = randomUUID(), payeeName = `ร้านค้นหา ${key}`, reader = useCase(clients[0]!);
    const own = await reader.create(context(), { commandId: randomUUID(), payeeName, lines: [{ expenseId: first.id, amount: '1' }] });
    const mixed = await reader.create(context(), { commandId: randomUUID(), payeeName, lines: [{ expenseId: first.id, amount: '1' }, { expenseId: foreign.id, amount: '1' }] });
    await reader.create(context(), { commandId: randomUUID(), payeeName: `ร้านอื่น ${key}`, lines: [{ expenseId: first.id, amount: '1' }] });
    const documentNumber = `PV-SEARCH-${key.toUpperCase()}`;
    await clients[0]!.disbursementVoucher.update({ where: { id: mixed.id }, data: { status: 'APPROVED', documentNumber } });
    const full = { ...context(), permissions: ['expense.disbursement.read', 'expense.read'] };
    const ownReader = { ...full, permissions: ['expense.disbursement.read', 'expense.read_own'] };
    const second = await reader.list(full, { q: `  ${payeeName}  `, page: 2, pageSize: 1 });
    assert.equal(second.total, 2); assert.equal(second.data.length, 1);
    assert.equal(second.counts.DRAFT, 1); assert.equal(second.counts.APPROVED, 1);
    const tab = await reader.list(full, { q: payeeName, status: 'DRAFT' });
    assert.equal(tab.total, 1); assert.equal(tab.data[0]!.id, own.id); assert.deepEqual(tab.counts, second.counts);
    assert.equal((await reader.list(full, { q: documentNumber.toLowerCase() })).data[0]!.id, mixed.id);
    assert.equal((await reader.list(ownReader, { q: payeeName })).total, 1);
    for (const denied of [{ ...full, companyId: `${companyId}-other` }, { ...full, scopes: { branchIds: ['other-branch'] } }]) assert.equal((await reader.list(denied, { q: payeeName })).total, 0);
    assert.equal((await reader.list(full, { q: '   ' })).total, (await reader.list(full, {})).total);
  });

  const lifecycleContext = () => ({ ...context(), permissions: ['expense.disbursement.prepare', 'expense.disbursement.approve', 'expense.disbursement.read', 'expense.read'] });
  const lifecycleCommand = (expectedVersion: number) => ({ commandId: randomUUID(), expectedVersion });
  const paymentContext = () => ({ ...context(), permissions: ['expense.disbursement.pay', 'expense.read'] });
  const approvedForPayment = async (amounts: string[]) => {
    const expenses = await Promise.all(amounts.map(() => createExpense()));
    const draft = await useCase(clients[0]!).create(context(), { commandId: randomUUID(), lines: expenses.map((e, i) => ({ expenseId: e.id, amount: amounts[i]! })), plannedMethod: 'BANK_TRANSFER' });
    const voucher = await useCase(clients[0]!).submit(lifecycleContext(), draft.id, { ...lifecycleCommand(0), approveNow: true });
    return { expenses, voucher };
  };

  it('refuses payment without a planned or supplied method without recording any line', async t => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const expense = await createExpense();
    const draft = await useCase(clients[0]!).create(context(), { commandId: randomUUID(), lines: [{ expenseId: expense.id, amount: '10' }] });
    const voucher = await useCase(clients[0]!).submit(lifecycleContext(), draft.id, { ...lifecycleCommand(0), approveNow: true });
    await assert.rejects(() => useCase(clients[0]!).pay(paymentContext(), voucher.id, lifecycleCommand(1)), (e: any) => e.getResponse().code === 'disbursement_payment_method_required' && e.getResponse().message === 'เลือกวิธีจ่ายก่อนบันทึก');
    assert.equal(await clients[0]!.expensePayment.count({ where: { companyId, expenseId: { in: (await clients[0]!.disbursementVoucherLine.findMany({ where: { voucherId: voucher.id } })).map(l => l.expenseId) } } }), 0);
    assert.equal((await clients[0]!.disbursementVoucher.findUniqueOrThrow({ where: { id: voucher.id } })).status, 'APPROVED');
  });

  const issueContext = () => ({ ...context(), permissions: ['expense.disbursement.issue', 'expense.disbursement.read', 'expense.read'] });
  it('parallel direct issuance by two callers creates one paid document and one number for a payment', async t => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const expense = await createExpense(), repository = new PrismaExpenseRepository({ client: clients[0]! } as any);
    const paid = await repository.recordPaymentAtomic({ companyId, expenseId: expense.id, actorUserId: userId, scopes: {}, idempotencyKey: randomUUID(), amount: '20', paidAt: '2026-10-01', paymentMethod: 'CASH' });
    const before = await clients[0]!.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } });
    const results = await Promise.all(clients.map((c, i) => useCase(c).fromPayment({ ...issueContext(), userId: i ? secondUserId : userId }, { commandId: randomUUID(), expenseId: expense.id, paymentId: paid.payment.id })));
    assert.equal((await clients[0]!.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } })).updatedAt.toISOString(), before.updatedAt.toISOString());
    assert.equal(results[0]!.id, results[1]!.id); assert.equal(results[0]!.origin, 'DIRECT_PAYMENT'); assert.equal(results[0]!.approvedByUserId, null);
    assert.equal(await clients[0]!.disbursementVoucherLine.count({ where: { companyId, coversPaymentId: paid.payment.id } }), 1);
    assert.equal(await clients[0]!.documentNumber.count({ where: { companyId, ownerId: results[0]!.id, ownerType: 'disbursement_voucher' } }), 1);
  });

  it('issuing while a Serializable expense void waits cannot leave a paid document for a voided expense', { timeout: 30000 }, async t => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const expense = await createExpense(), repository = new PrismaExpenseRepository({ client: clients[0]! } as any);
    const paid = await repository.recordPaymentAtomic({ companyId, expenseId: expense.id, actorUserId: userId, scopes: {}, idempotencyKey: randomUUID(), amount: '20' });
    let unblock!: () => void, started!: () => void;
    const gate = new Promise<void>(resolve => { unblock = resolve; }), entered = new Promise<void>(resolve => { started = resolve; });
    const issuing = clients[0]!.$transaction(async tx => {
      await lockExpenseCorrection(tx, companyId, expense.id);
      started(); await gate;
      // Same source-row fence used by issuance: no screen version or financial facts change.
      await tx.$executeRaw`UPDATE "ExpenseRecord" SET "reservedByDisbursementVoucherId" = "reservedByDisbursementVoucherId" WHERE "companyId" = ${companyId} AND "id" = ${expense.id}`;
    }, { timeout: 20000 });
    await entered;
    let voidStarted!: () => void;
    const voidEntered = new Promise<void>(resolve => { voidStarted = resolve; });
    const voiding = new PrismaExpenseRepository({ client: clients[1]! } as any).voidExpenseTrueReversal(companyId, expense.id, userId, 'ยกเลิกรายการ', undefined, [], async tx => {
      await tx.expenseRecord.findFirst({ where: { companyId, id: expense.id } }); voidStarted();
    });
    void voiding.catch(() => undefined);
    await voidEntered; unblock(); await issuing;
    await assert.rejects(() => voiding, (e: any) => isSerializationFailure(e));
    const issued = await useCase(clients[0]!).fromPayment(issueContext(), { commandId: randomUUID(), expenseId: expense.id, paymentId: paid.payment.id });
    await new PrismaExpenseRepository({ client: clients[1]! } as any).voidExpenseTrueReversal(companyId, expense.id, userId, 'ยกเลิกรายการ');
    assert.equal((await clients[0]!.disbursementVoucher.findUniqueOrThrow({ where: { id: issued.id } })).status, 'CANCELLED');
  });

  it('cancelling one of three paid lines cancels the header, frees every cover and reissues exactly the two remaining payments once', async t => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const { expenses, voucher } = await approvedForPayment(['104', '104', '104']);
    await useCase(clients[0]!).pay(paymentContext(), voucher.id, lifecycleCommand(1));
    const before = await clients[0]!.disbursementVoucher.findUniqueOrThrow({ where: { id: voucher.id }, include: { lines: { orderBy: { position: 'asc' } } } });
    await new PrismaExpenseRepository({ client: clients[1]! } as any).cancelPaymentAtomic({ companyId, expenseId: expenses[0]!.id, paymentId: before.lines[0]!.expensePaymentId!, actorUserId: userId, scopes: {}, reason: 'ยอดผิด' });
    const after = await clients[0]!.disbursementVoucher.findUniqueOrThrow({ where: { id: voucher.id }, include: { lines: { orderBy: { position: 'asc' } } } });
    assert.equal(after.status, 'CANCELLED'); assert.equal(after.cancelledAfterPaid, true); assert.equal(after.cancelReason, `การจ่ายของรายการ ${expenses[0]!.expenseNumber} ถูกยกเลิก`); assert.equal(after.cancelSourceReason, 'ยอดผิด');
    assert.equal(after.documentNumber, before.documentNumber); assert.deepEqual(after.paidSnapshotJson, before.paidSnapshotJson); assert.equal(after.paidSnapshotHash, before.paidSnapshotHash);
    assert.ok(after.lines.every(l => l.coversPaymentId === null)); assert.deepEqual(after.lines.map(l => l.expensePaymentId), before.lines.map(l => l.expensePaymentId));
    const reissued = await Promise.all(clients.map(c => useCase(c).reissue(issueContext(), voucher.id, { commandId: randomUUID() })));
    assert.equal(reissued[0]!.id, reissued[1]!.id); assert.equal(reissued[0]!.totalAmount, '208.0000'); assert.equal(reissued[0]!.replacesVoucherId, voucher.id);
    assert.equal(await clients[0]!.disbursementVoucherLine.count({ where: { companyId, voucherId: reissued[0]!.id } }), 2);
    assert.notEqual(reissued[0]!.documentNumber, before.documentNumber);
  });

  it('lists only live payment amounts after partial and complete cancellation without changing the frozen total', async t => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const { expenses, voucher } = await approvedForPayment(['104', '52']);
    const reader = useCase(clients[0]!);
    await reader.pay(paymentContext(), voucher.id, lifecycleCommand(1));
    const frozen = await clients[0]!.disbursementVoucher.findUniqueOrThrow({ where: { id: voucher.id }, include: { lines: { orderBy: { position: 'asc' } } } });
    const query = { q: frozen.documentNumber! };
    assert.equal((await reader.list(lifecycleContext(), query)).data[0]!.amountInEffect, null);
    const repository = new PrismaExpenseRepository({ client: clients[1]! } as any);
    await repository.cancelPaymentAtomic({ companyId, expenseId: expenses[0]!.id, paymentId: frozen.lines[0]!.expensePaymentId!, actorUserId: userId, scopes: {}, reason: 'ยอดผิด' });
    const partial = (await reader.list(lifecycleContext(), query)).data[0]!;
    assert.equal(partial.totalAmount, '156.0000'); assert.equal(partial.amountInEffect, '52.0000');
    await repository.cancelPaymentAtomic({ companyId, expenseId: expenses[1]!.id, paymentId: frozen.lines[1]!.expensePaymentId!, actorUserId: userId, scopes: {}, reason: 'ยอดผิด' });
    assert.equal((await reader.list(lifecycleContext(), query)).data[0]!.amountInEffect, '0.0000');
    const after = await clients[0]!.disbursementVoucher.findUniqueOrThrow({ where: { id: voucher.id } });
    assert.deepEqual(after.paidSnapshotJson, frozen.paidSnapshotJson); assert.equal(after.totalAmount.toFixed(4), '156.0000');
    assert.equal((await reader.list({ ...lifecycleContext(), companyId: `${companyId}-other` }, query)).total, 0);
  });

  it('voiding a paid expense cancels its one-line document in the same transaction', async t => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const { expenses, voucher } = await approvedForPayment(['104']);
    await useCase(clients[0]!).pay(paymentContext(), voucher.id, lifecycleCommand(1));
    const repository = new PrismaExpenseRepository({ client: clients[1]! } as any);
    await repository.voidExpenseTrueReversal(companyId, expenses[0]!.id, userId, 'ยกเลิกเอกสารผิด');
    const v = await clients[0]!.disbursementVoucher.findUniqueOrThrow({ where: { id: voucher.id }, include: { lines: true } });
    assert.equal(v.status, 'CANCELLED'); assert.equal(v.cancelledAfterPaid, true); assert.equal(v.cancelReason, `เอกสาร ${expenses[0]!.expenseNumber} ถูกยกเลิก`); assert.equal(v.cancelSourceReason, 'ยกเลิกเอกสารผิด');
    assert.equal(v.lines[0]!.coversPaymentId, null); assert.ok(v.lines[0]!.expensePaymentId);
    assert.equal((await clients[0]!.expensePayment.findUniqueOrThrow({ where: { id: v.lines[0]!.expensePaymentId! } })).status, 'VOIDED');
  });

  it('a pay transaction and cancellation waiting on its expense finish without a document-lock deadlock', { timeout: 30000 }, async t => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const { expenses, voucher } = await approvedForPayment(['104']);
    let cancel: Promise<unknown> | undefined;
    const audit = new AuditService(new PrismaAuditRepository({ client: clients[0]! } as any), { error: () => undefined } as any);
    const intercepted = { log: async (entry: any, tx: any) => {
      await audit.log(entry, tx);
      if (entry.action === 'expense.disbursement.pay') {
        const line = await tx.disbursementVoucherLine.findFirstOrThrow({ where: { companyId, voucherId: voucher.id } });
        cancel = new PrismaExpenseRepository({ client: clients[1]! } as any).cancelPaymentAtomic({ companyId, expenseId: expenses[0]!.id, paymentId: line.expensePaymentId!, actorUserId: userId, scopes: {}, reason: 'ยอดผิด' });
        // Observe rejection immediately while cancellation waits for the pay transaction's expense lock.
        void cancel.catch(() => undefined);
      }
    } } as any;
    await useCase(clients[0]!, intercepted).pay(paymentContext(), voucher.id, lifecycleCommand(1));
    assert.ok(cancel); await cancel;
    const v = await clients[0]!.disbursementVoucher.findUniqueOrThrow({ where: { id: voucher.id }, include: { lines: true } });
    assert.equal(v.status, 'CANCELLED'); assert.ok(v.lines.every(l => l.coversPaymentId === null && l.expensePaymentId));
    assert.equal((await clients[0]!.expenseRecord.findUniqueOrThrow({ where: { id: expenses[0]!.id } })).paidAmount.toFixed(4), '0.0000');
  });

  it('a three-line approved voucher pays exact amounts, clears reservations and emits one event and audit per payment', async t => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const { expenses, voucher } = await approvedForPayment(['104', '40', '0.01']);
    const paid = await useCase(clients[0]!).pay(paymentContext(), voucher.id, { ...lifecycleCommand(1), paidDate: '2026-10-01', paidFromRef: 'เงินสดหน้าร้าน' });
    assert.equal(paid.status, 'PAID'); assert.equal(paid.totalAmount, '144.0100'); assert.equal(paid.documentNumber, voucher.documentNumber);
    const lines = await clients[0]!.disbursementVoucherLine.findMany({ where: { voucherId: voucher.id }, orderBy: { position: 'asc' } });
    const amounts = ['104.0000', '40.0000', '0.0100'], outstanding = ['0.0000', '64.0000', '103.9900'];
    for (const [i, e] of expenses.entries()) {
      const row = await clients[0]!.expenseRecord.findUniqueOrThrow({ where: { id: e.id } });
      assert.equal(row.paidAmount.toFixed(4), amounts[i]); assert.equal(row.outstandingAmount.toFixed(4), outstanding[i]); assert.equal(row.reservedByDisbursementVoucherId, null);
      const payment = await clients[0]!.expensePayment.findUniqueOrThrow({ where: { id: lines[i]!.expensePaymentId! } });
      assert.equal(payment.amount.toFixed(4), amounts[i]); assert.equal(payment.bankAccountRef, 'เงินสดหน้าร้าน'); assert.equal(payment.paidAt.toISOString(), '2026-09-30T17:00:00.000Z');
      assert.equal(lines[i]!.coversPaymentId, payment.id);
      assert.equal(await clients[0]!.outboxEvent.count({ where: { companyId, aggregateId: payment.id, eventType: 'expense.payment_recorded' } }), 1);
      assert.equal(await clients[0]!.auditLog.count({ where: { companyId, targetId: payment.id, action: 'expense.payment.record' } }), 1);
    }
    const document = await clients[0]!.disbursementVoucher.findUniqueOrThrow({ where: { id: voucher.id } });
    const snapshot = document.paidSnapshotJson as any;
    assert.equal(snapshot.totals.paidThisTime, '144.0100'); assert.equal(snapshot.totals.outstandingAfter, '167.9900'); assert.equal(snapshot.totals.wht, '9.0000'); assert.ok(document.paidSnapshotHash);
  });

  it('one lowered outstanding source leaves all document payments, effects and line links unwritten', async t => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const { expenses, voucher } = await approvedForPayment(['40', '40', '40']);
    await clients[0]!.expenseRecord.update({ where: { id: expenses[1]!.id }, data: { outstandingAmount: '39' } });
    const command = lifecycleCommand(1);
    await assert.rejects(() => useCase(clients[1]!).pay(paymentContext(), voucher.id, command), (e: any) => e.getResponse?.().code === 'disbursement_payment_source_changed' && e.getResponse().message.includes(expenses[1]!.expenseNumber));
    assert.equal(await clients[0]!.expensePayment.count({ where: { companyId, expenseId: { in: expenses.map(e => e.id) } } }), 0);
    assert.equal(await clients[0]!.disbursementVoucherCommand.count({ where: { companyId, commandId: command.commandId } }), 0);
    assert.equal(await clients[0]!.expenseRecord.count({ where: { companyId, id: { in: expenses.map(e => e.id) }, paidAmount: 0, reservedByDisbursementVoucherId: voucher.id } }), 3);
    assert.equal(await clients[0]!.disbursementVoucherLine.count({ where: { voucherId: voucher.id, expensePaymentId: null, coversPaymentId: null } }), 3);
    assert.equal((await clients[0]!.disbursementVoucher.findUniqueOrThrow({ where: { id: voucher.id } })).status, 'APPROVED');
  });

  it('parallel same or distinct pay commands create exactly one set of document payments', async t => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    for (const same of [true, false]) {
      const { expenses, voucher } = await approvedForPayment(['104', '104', '104']), command = lifecycleCommand(1);
      const results = await Promise.allSettled(clients.map((c, i) => useCase(c).pay(paymentContext(), voucher.id, same || i === 0 ? command : lifecycleCommand(1))));
      assert.equal(results.filter(r => r.status === 'fulfilled').length, same ? 2 : 1);
      if (!same) assert.equal((results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason.getResponse().code, 'disbursement_status_changed');
      const payments = await clients[0]!.expensePayment.findMany({ where: { companyId, expenseId: { in: expenses.map(e => e.id) } } });
      assert.equal(payments.length, 3); assert.equal(new Set(payments.map(p => p.idempotencyKey)).size, 3);
      assert.equal(await clients[0]!.outboxEvent.count({ where: { companyId, aggregateId: { in: payments.map(p => p.id) }, eventType: 'expense.payment_recorded' } }), 3);
      assert.equal(await clients[0]!.expenseRecord.count({ where: { id: { in: expenses.map(e => e.id) }, paidAmount: 104, outstandingAmount: 0, reservedByDisbursementVoucherId: null } }), 3);
    }
  });

  it('a direct payment racing a reserved document payment cannot pay the same expense twice', async t => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const { expenses, voucher } = await approvedForPayment(['104']);
    const direct = new RecordExpensePaymentUseCase(new PrismaExpenseRepository({ client: clients[1] } as any), new AuditService(new PrismaAuditRepository({ client: clients[1] } as any), { error: () => undefined } as any));
    const [documentResult, directResult] = await Promise.allSettled([
      useCase(clients[0]!).pay(paymentContext(), voucher.id, lifecycleCommand(1)),
      direct.execute({ ...context(), permissions: ['expense.payment.record'] }, expenses[0]!.id, { paidAmount: '104', idempotencyKey: randomUUID() }),
    ]);
    assert.equal(documentResult.status, 'fulfilled'); assert.equal(directResult.status, 'rejected');
    assert.ok(['expense_disbursement_reserved', 'expense_payment_exceeds_outstanding'].includes((directResult as PromiseRejectedResult).reason.getResponse().code));
    assert.equal(await clients[0]!.expensePayment.count({ where: { companyId, expenseId: expenses[0]!.id } }), 1);
    assert.equal((await clients[0]!.expenseRecord.findUniqueOrThrow({ where: { id: expenses[0]!.id } })).paidAmount.toFixed(4), '104.0000');
  });

  it('a twenty-line document pays inside the twenty-second transaction timeout and reports elapsed milliseconds', async t => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const { expenses, voucher } = await approvedForPayment(Array(20).fill('104'));
    const started = Date.now();
    const paid = await useCase(clients[0]!).pay(paymentContext(), voucher.id, lifecycleCommand(1));
    const elapsedMs = Date.now() - started;
    console.log(`Disbursement voucher 20-line pay elapsed milliseconds: ${elapsedMs} (transaction timeout 20000)`);
    assert.equal(paid.status, 'PAID'); assert.equal(paid.totalAmount, '2080.0000'); assert.ok(elapsedMs < 20000);
    assert.equal(await clients[0]!.expensePayment.count({ where: { companyId, expenseId: { in: expenses.map(e => e.id) } } }), 20);
  });

  const createDocumentSlip = (voucherId: string) => clients[0]!.attachmentObject.create({ data: {
    companyId, branchId, storageProvider: 'test', bucket: 'test', objectKey: `slip-${randomUUID()}`, originalFileName: 'slip.png', mimeType: 'image/png', byteSize: 100,
    status: 'ACTIVE', visibility: 'INTERNAL', uploadedByUserId: userId, uploadedAt: new Date(), checksumSha256: 'a'.repeat(64),
    metadataJson: { generatedFor: 'disbursement_voucher_slip', voucherId },
  } });

  it('parallel slip replacements leave one pointer and link, retain old bytes, and payment accepts only the current slip', async t => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const { voucher } = await approvedForPayment(['10']);
    const slips = await Promise.all([createDocumentSlip(voucher.id), createDocumentSlip(voucher.id)]);
    await Promise.all(clients.map((client, i) => useCase(client).attachSlip(paymentContext(), voucher.id, slips[i]!.id)));
    const current = await clients[0]!.disbursementVoucher.findUniqueOrThrow({ where: { id: voucher.id } });
    assert.equal(current.version, 3);
    const links = await clients[0]!.attachmentLink.findMany({ where: { companyId, targetType: 'disbursement_voucher', targetId: voucher.id, purpose: 'expense.disbursement_voucher.slip' } });
    assert.equal(links.length, 1); assert.equal(links[0]!.attachmentId, current.slipAttachmentId);
    assert.equal(await clients[0]!.attachmentObject.count({ where: { id: { in: slips.map(s => s.id) }, status: 'ACTIVE' } }), 2);
    const replaced = slips.find(s => s.id !== current.slipAttachmentId)!;
    await assert.rejects(() => useCase(clients[0]!).pay(paymentContext(), voucher.id, { ...lifecycleCommand(3), slipAttachmentId: replaced.id }), (e: any) => e.getResponse().code === 'disbursement_slip_not_owned');
    const paid = await useCase(clients[0]!).pay(paymentContext(), voucher.id, { ...lifecycleCommand(3), slipAttachmentId: current.slipAttachmentId! });
    assert.equal(paid.status, 'PAID');
    const detail = await useCase(clients[0]!).get({ ...paymentContext(), permissions: ['expense.disbursement.read', 'expense.read'] }, voucher.id);
    assert.equal(detail.slip?.attachmentId, current.slipAttachmentId); assert.equal(detail.slip?.attachedByUserId, userId); assert.ok(detail.slip?.attachedAt);
  });

  it('a generic delete racing slip attachment cannot remove the document file', async t => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const { voucher } = await approvedForPayment(['10']), file = await createDocumentSlip(voucher.id);
    const results = await Promise.allSettled([
      useCase(clients[0]!).attachSlip(paymentContext(), voucher.id, file.id),
      new PrismaAttachmentRepository({ client: clients[1]! } as any).markDeleted({ companyId, id: file.id }),
    ]);
    assert.equal(results[0]!.status, 'fulfilled'); assert.equal(results[1]!.status, 'rejected');
    assert.equal((results[1] as PromiseRejectedResult).reason.getResponse().code, 'disbursement_file_retained');
    assert.equal((await clients[0]!.attachmentObject.findUniqueOrThrow({ where: { id: file.id } })).status, 'ACTIVE');
    assert.equal((await clients[0]!.disbursementVoucher.findUniqueOrThrow({ where: { id: voucher.id } })).slipAttachmentId, file.id);
  });

  it('a failed post-commit PDF store preserves PAID and the number, then two downloads store exactly one attachment', async t => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const { voucher } = await approvedForPayment(['104']);
    let fail = true, puts = 0;
    const objects = new Map<string, Buffer>();
    const storage: any = { putObject: async ({ objectKey, bytes }: any) => {
      puts++; if (fail) throw new Error('synthetic storage failure');
      objects.set(objectKey, bytes); return { bucket: 'test', objectKey, objectVersionId: 'v1', storageProvider: 'test' };
    }, getObject: async ({ objectKey }: any) => ({ bytes: objects.get(objectKey) }), deleteObject: async () => undefined };
    const files = clients.map(client => new DisbursementVoucherFileService({ client } as any, storage));
    files.forEach(file => { file.render = async () => Buffer.from('%PDF frozen paid snapshot'); });
    const paid = await useCase(clients[0]!, undefined, files[0]).pay(paymentContext(), voucher.id, lifecycleCommand(1));
    assert.equal(paid.status, 'PAID'); assert.equal(paid.documentFileReady, false);
    const before = await clients[0]!.disbursementVoucher.findUniqueOrThrow({ where: { id: voucher.id } });
    assert.equal(before.pdfAttachmentId, null); assert.equal(before.documentNumber, voucher.documentNumber);
    fail = false;
    const reader = { ...paymentContext(), permissions: ['expense.disbursement.read', 'expense.read'] };
    const downloads = await Promise.all(clients.map((client, i) => useCase(client, undefined, files[i]).documentPdf(reader, voucher.id)));
    assert.deepEqual(downloads[0]!.data, downloads[1]!.data); assert.equal(puts, 2);
    const after = await clients[0]!.disbursementVoucher.findUniqueOrThrow({ where: { id: voucher.id } });
    assert.equal(after.status, 'PAID'); assert.deepEqual(after.paidSnapshotJson, before.paidSnapshotJson); assert.equal(after.documentNumber, before.documentNumber);
    const links = await clients[0]!.attachmentLink.findMany({ where: { companyId, targetId: voucher.id, purpose: 'expense.disbursement_voucher.pdf' }, include: { attachment: true } });
    assert.equal(links.length, 1); assert.equal(after.pdfAttachmentId, links[0]!.attachmentId);
    assert.equal(links[0]!.attachment.checksumSha256, createHash('sha256').update(downloads[0]!.data).digest('hex'));
    const payer = await clients[0]!.expensePayment.count({ where: { companyId, id: { in: (await clients[0]!.disbursementVoucherLine.findMany({ where: { voucherId: voucher.id } })).map(l => l.expensePaymentId!) } } });
    assert.equal(payer, 1);
  });

  it('commits the payer signature with payment and rolls its snapshot back when the audit fails', async t => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const { voucher } = await approvedForPayment(['104']);
    const signature = { attachmentId: 'personal-signature-fixture', userId, checksumSha256: 'a'.repeat(64) };
    const failing = useCase(clients[0]!, { log: async () => { throw new Error('signature audit failure'); } } as any);
    (failing as any).ownSignature = async () => signature;
    await assert.rejects(() => failing.pay(paymentContext(), voucher.id, lifecycleCommand(1)), /signature audit failure/);
    const unchanged = await clients[0]!.disbursementVoucher.findUniqueOrThrow({ where: { id: voucher.id } });
    assert.equal(unchanged.status, 'APPROVED'); assert.equal(unchanged.payerSignatureJson, null); assert.equal(unchanged.paidSnapshotJson, null);
    const signing = useCase(clients[0]!); (signing as any).ownSignature = async () => signature;
    await signing.pay(paymentContext(), voucher.id, lifecycleCommand(1));
    const paid = await clients[0]!.disbursementVoucher.findUniqueOrThrow({ where: { id: voucher.id } });
    assert.deepEqual(paid.payerSignatureJson, signature);
    assert.deepEqual((paid.paidSnapshotJson as any).actors.payer.signature, signature);
    assert.equal(paid.status, 'PAID');
  });

  it('a document payment audit failure rolls back payments, line coverage, reservations and command completion', async t => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const { expenses, voucher } = await approvedForPayment(['104', '104']); const command = lifecycleCommand(1);
    await assert.rejects(() => useCase(clients[0]!, { log: async () => { throw new Error('synthetic pay audit failure'); } } as any).pay(paymentContext(), voucher.id, command), /synthetic pay audit failure/);
    assert.equal(await clients[0]!.expensePayment.count({ where: { companyId, expenseId: { in: expenses.map(e => e.id) } } }), 0);
    assert.equal(await clients[0]!.expenseRecord.count({ where: { id: { in: expenses.map(e => e.id) }, paidAmount: 0, reservedByDisbursementVoucherId: voucher.id } }), 2);
    assert.equal(await clients[0]!.disbursementVoucherLine.count({ where: { voucherId: voucher.id, expensePaymentId: null, coversPaymentId: null } }), 2);
    assert.equal(await clients[0]!.disbursementVoucherCommand.count({ where: { companyId, commandId: command.commandId } }), 0);
  });

  it('submission reservation is all-or-nothing when another voucher owns one of its expenses', async t => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const [a, b] = await Promise.all([createExpense(), createExpense()]);
    const service = useCase(clients[0]!);
    const first = await service.create(context(), { commandId: randomUUID(), lines: [{ expenseId: a.id, amount: '1' }] });
    const second = await service.create(context(), { commandId: randomUUID(), lines: [{ expenseId: a.id, amount: '1' }, { expenseId: b.id, amount: '1' }] });
    const pending = await service.submit(lifecycleContext(), first.id, lifecycleCommand(0));
    const attempt = lifecycleCommand(0);
    await assert.rejects(() => service.submit(lifecycleContext(), second.id, attempt), (e: any) => e.getResponse?.().code === 'disbursement_expense_reserved' && e.getResponse().message.includes(pending.documentNumber));
    assert.equal((await clients[0]!.expenseRecord.findUniqueOrThrow({ where: { id: a.id } })).reservedByDisbursementVoucherId, first.id);
    assert.equal((await clients[0]!.expenseRecord.findUniqueOrThrow({ where: { id: b.id } })).reservedByDisbursementVoucherId, null);
    const untouched = await clients[0]!.disbursementVoucher.findUniqueOrThrow({ where: { id: second.id } });
    assert.equal(untouched.status, 'DRAFT'); assert.equal(untouched.documentNumber, null); assert.equal(untouched.version, 0);
    assert.equal(await clients[0]!.disbursementVoucherRevision.count({ where: { voucherId: second.id } }), 0);
    assert.equal(await clients[0]!.disbursementVoucherCommand.count({ where: { companyId, commandId: attempt.commandId } }), 0);
  });

  it('reserve and return/withdraw/cancel preserve expense updatedAt and leave no reservation after release', async t => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    for (const [action, approved] of [['return', false], ['withdraw', false], ['withdraw', true], ['cancel', false], ['cancel', true]] as const) {
      const expense = await createExpense(), service = useCase(clients[0]!);
      const draft = await service.create(context(), { commandId: randomUUID(), lines: [{ expenseId: expense.id, amount: '10' }] });
      const pending = await service.submit(lifecycleContext(), draft.id, lifecycleCommand(0));
      assert.deepEqual((await clients[0]!.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } })).updatedAt, expense.updatedAt);
      if (approved) await service.approve(lifecycleContext(), draft.id, lifecycleCommand(1));
      const before = await clients[0]!.disbursementVoucherRevision.findFirstOrThrow({ where: { voucherId: draft.id, revision: 1 } });
      const ended = await service[action](action === 'return' ? { ...lifecycleContext(), userId: secondUserId } : lifecycleContext(), draft.id, { ...lifecycleCommand(approved ? 2 : 1), reason: 'ตรวจรายการใหม่' });
      assert.equal(ended.documentNumber, pending.documentNumber);
      const source = await clients[0]!.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } });
      assert.equal(source.reservedByDisbursementVoucherId, null); assert.deepEqual(source.updatedAt, expense.updatedAt);
      assert.equal(await clients[0]!.expenseRecord.count({ where: { companyId, reservedByDisbursementVoucherId: draft.id } }), 0);
      const revision = await clients[0]!.disbursementVoucherRevision.findFirstOrThrow({ where: { voucherId: draft.id, revision: 1 } });
      if (approved) {
        assert.equal(revision.decision, 'APPROVED'); assert.equal(revision.decidedByUserId, before.decidedByUserId); assert.deepEqual(revision.decidedAt, before.decidedAt);
        assert.equal(revision.postApprovalAction, action === 'cancel' ? 'CANCELLED' : 'WITHDRAWN'); assert.equal(revision.postApprovalReason, 'ตรวจรายการใหม่');
      } else assert.equal(revision.decision, action === 'return' ? 'RETURNED' : action === 'withdraw' ? 'WITHDRAWN' : 'CANCELLED');
    }
  });

  it('parallel submissions sharing an expense produce exactly one pending voucher and one reserved source', async t => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const expense = await createExpense();
    const drafts = await Promise.all(clients.map(c => useCase(c).create(context(), { commandId: randomUUID(), lines: [{ expenseId: expense.id, amount: '10' }] })));
    const results = await Promise.allSettled(clients.map((c, i) => useCase(c).submit(lifecycleContext(), drafts[i]!.id, lifecycleCommand(0))));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
    assert.equal(rejected.reason.getResponse?.().code, 'disbursement_expense_reserved');
    const rows = await clients[0]!.disbursementVoucher.findMany({ where: { companyId, id: { in: drafts.map(d => d.id) } } });
    assert.equal(rows.filter(r => r.status === 'PENDING_APPROVAL').length, 1); assert.equal(rows.filter(r => r.status === 'DRAFT').length, 1);
    const winner = rows.find(r => r.status === 'PENDING_APPROVAL')!;
    assert.equal((await clients[0]!.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } })).reservedByDisbursementVoucherId, winner.id);
    assert.equal(await clients[0]!.documentNumber.count({ where: { companyId, ownerType: 'disbursement_voucher', ownerId: { in: drafts.map(d => d.id) } } }), 1);
  });

  it('approval refuses a direct outstanding or vendor name change and retains the pending reservation', async t => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    for (const data of [{ outstandingAmount: '9.99' }, { vendorNameSnapshot: 'ร้านใหม่' }]) {
      const expense = await createExpense(), service = useCase(clients[0]!);
      const draft = await service.create(context(), { commandId: randomUUID(), lines: [{ expenseId: expense.id, amount: '10' }] });
      await service.submit(lifecycleContext(), draft.id, lifecycleCommand(0));
      await clients[0]!.expenseRecord.update({ where: { id: expense.id }, data });
      await assert.rejects(() => service.approve(lifecycleContext(), draft.id, lifecycleCommand(1)),
        (e: any) => e.getResponse?.().code === 'disbursement_source_changed' && e.getResponse().message.includes(expense.expenseNumber));
      assert.equal((await clients[0]!.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } })).reservedByDisbursementVoucherId, draft.id);
      assert.equal((await clients[0]!.disbursementVoucher.findUniqueOrThrow({ where: { id: draft.id } })).status, 'PENDING_APPROVAL');
    }
  });

  it('same submit command from two clients creates one revision/number and replays the current approved header', async t => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const expense = await createExpense(), draft = await useCase(clients[0]!).create(context(), { commandId: randomUUID(), lines: [{ expenseId: expense.id, amount: '10' }] });
    const submit = lifecycleCommand(0);
    const [a, b] = await Promise.all(clients.map(c => useCase(c).submit(lifecycleContext(), draft.id, submit)));
    assert.deepEqual(a, b); assert.equal(a.revision, 1);
    assert.equal(await clients[0]!.disbursementVoucherRevision.count({ where: { voucherId: draft.id } }), 1);
    await useCase(clients[0]!).approve(lifecycleContext(), draft.id, lifecycleCommand(1));
    assert.equal((await useCase(clients[1]!).submit(lifecycleContext(), draft.id, submit)).status, 'APPROVED');
  });

  it('submission audit failure rolls back its reservation, revision, number and command row', async t => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const expense = await createExpense(), draft = await useCase(clients[0]!).create(context(), { commandId: randomUUID(), lines: [{ expenseId: expense.id, amount: '10' }] });
    const submit = lifecycleCommand(0);
    await assert.rejects(() => useCase(clients[0]!, { log: async () => { throw new Error('synthetic submit audit failure'); } } as any).submit(lifecycleContext(), draft.id, submit), /synthetic submit audit failure/);
    assert.equal((await clients[0]!.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } })).reservedByDisbursementVoucherId, null);
    assert.equal(await clients[0]!.disbursementVoucherRevision.count({ where: { voucherId: draft.id } }), 0);
    assert.equal(await clients[0]!.documentNumber.count({ where: { companyId, ownerId: draft.id } }), 0);
    assert.equal(await clients[0]!.disbursementVoucherCommand.count({ where: { companyId, commandId: submit.commandId } }), 0);
  });

  it('an audit failure rolls back the draft, lines and command journal in the database', async t => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const expense = await createExpense(), commandId = randomUUID();
    const before = await clients[0]!.disbursementVoucher.count({ where: { companyId } });
    await assert.rejects(() => useCase(clients[0]!, { log: async () => { throw new Error('synthetic audit failure'); } } as any)
      .create(context(), { commandId, lines: [{ expenseId: expense.id, amount: '10' }] }), /synthetic audit failure/);
    assert.equal(await clients[0]!.disbursementVoucher.count({ where: { companyId } }), before);
    assert.equal(await clients[0]!.disbursementVoucherCommand.count({ where: { companyId, commandId } }), 0);
    assert.equal(await clients[0]!.disbursementVoucherLine.count({ where: { companyId, expenseId: expense.id } }), 0);
  });
});

describe('expense correction before posting (owner 2026-10-04)', () => {
  const command = { companyId: 'company-1', expenseId: 'expense-1', actorUserId: 'finance-1', scopes: {}, reason: 'กรอกยอดผิด' };
  const audit = (tx: any) => tx.auditLog.create({ data: { actorUserId: command.actorUserId, metadataJson: { reason: command.reason } } });

  it('cancels only the chosen unposted payment, retains history and allows recording its replacement', async () => {
    const h = harness({ postingStatus: 'pending' });
    await pay(h.repo, '40'); await pay(h.repo, '60');
    const result = await (h.repo as any).cancelPaymentAtomic({ ...command, paymentId: 'payment-1' }, audit);
    assert.equal(result.paidAmount, '60.0000'); assert.equal(result.outstandingAmount, '40.0000');
    assert.equal(result.paymentStatus, 'PARTIALLY_PAID');
    assert.equal(h.state.payments[0].status, 'VOIDED');
    assert.equal(h.state.payments[0].voidedByUserId, 'finance-1');
    assert.ok(h.state.payments[0].voidedAt); assert.equal(h.state.audits.length, 1);
    await pay(h.repo, '40'); assert.equal(h.state.expense.paymentStatus, 'PAID');
  });

  it('reports an already cancelled payment without accepting a second reason or changing its balance', async () => {
    const h = harness({ postingStatus: 'pending' });
    await pay(h.repo, '40');
    await h.repo.cancelPaymentAtomic({ ...command, paymentId: 'payment-1' }, audit);
    const before = JSON.stringify(h.state);
    await assert.rejects(h.repo.cancelPaymentAtomic({ ...command, paymentId: 'payment-1', reason: 'เหตุผลอีกคน' }, audit),
      (e: any) => e.getResponse?.().code === 'expense_payment_already_cancelled');
    assert.equal(JSON.stringify(h.state), before);
    assert.equal(h.state.audits.length, 1);
  });

  for (const mode of ['posted flag', 'posted journal', 'draft journal']) it(`refuses cancellation with ${mode}, even with stale payment pointers`, async () => {
    const h = harness({ postingStatus: 'pending' }); await pay(h.repo, '40');
    if (mode === 'posted flag') h.state.payments[0].postingStatus = 'posted';
    else h.state.journals.push({ sourceType: 'expense.payment', sourceId: 'payment-1', status: mode === 'posted journal' ? 'POSTED' : 'DRAFT' });
    await assert.rejects(() => (h.repo as any).cancelPaymentAtomic({ ...command, paymentId: 'payment-1' }, audit), (e: any) => e.getResponse?.().code === 'expense_payment_correction_blocked');
    assert.equal(h.state.payments[0].status, 'RECORDED'); assert.equal(h.state.expense.paidAmount, '40.0000');
  });

  it('reopens a paid confirmed expense, keeps its number/payments and retires only unissued WHT', async () => {
    const h = harness({ postingStatus: 'pending', expenseNumber: 'EXP-1', confirmedAt: VERSION, confirmedByUserId: 'confirmer', reviewedAt: VERSION });
    await pay(h.repo, '40'); h.state.handoffs.push({ status: 'REQUIRED' }); h.state.taxEvents.push({ id: 'event-1', taxPeriodId: 'p1', eventType: 'WHT_PND53', status: 'ACTIVE' });
    const { expense: result } = await (h.repo as any).reopenExpenseAtomic(command, audit);
    assert.equal(result.status, 'NEEDS_REVIEW'); assert.equal(result.expenseNumber, 'EXP-1');
    assert.equal(result.paidAmount, '40.0000'); assert.equal(h.state.payments[0].status, 'RECORDED');
    assert.equal(result.postingStatus, 'not_required'); assert.equal(result.confirmedAt, null); assert.equal(result.reviewedAt, null);
    assert.equal(h.state.handoffs[0].status, 'CANCELLED'); assert.equal(h.state.taxEvents[0].status, 'SUPERSEDED'); assert.equal(h.state.audits.length, 1);
  });

  const refusals = [
    ['ledger_posted', (h: any) => h.state.journals.push({ sourceType: 'expense.record', sourceId: 'expense-1', status: 'POSTED' })],
    ['ledger_posted', (h: any) => { h.state.payments.push({ id: 'payment-1', status: 'RECORDED', postingStatus: 'pending' }); h.state.journals.push({ sourceType: 'expense.payment', sourceId: 'payment-1', status: 'POSTED' }); }],
    ['journal_pending', (h: any) => h.state.journals.push({ sourceType: 'expense.record', sourceId: 'expense-1', status: 'DRAFT' })],
    ['certificate_issued', (h: any) => h.state.handoffs.push({ status: 'SYSTEM_ISSUED' })],
    ['certificate_issued', (h: any) => h.state.handoffs.push({ status: 'EXTERNAL_LINKED' })],
    ['certificate_issued', (h: any) => { h.state.taxEvents.push({ id: 'event-1', taxPeriodId: 'period-1' }); h.state.certificates.push({ id: 'cert-1', status: 'ISSUED', taxEventIdsJson: ['event-1'] }); }],
    ['tax_period_filed', (h: any) => { h.state.taxEvents.push({ id: 'event-1', taxPeriodId: 'period-1', status: 'ACTIVE' }); h.state.taxPeriods.push({ id: 'period-1', formType: 'PND53', periodKey: '2026-08', status: 'FILED' }); }],
    ['live_claim', (h: any) => { h.state.expense.sourceReimbursementRequestId = 'claim-1'; h.state.claim = { id: 'claim-1' }; }],
    ['not_confirmed', (h: any) => { h.state.expense.status = 'VOIDED'; }],
  ] as const;
  for (const [index, [code, arrange]] of refusals.entries()) it(`refuses reopen: ${code} (${index}) and reports the same server capability`, async () => {
    const h = harness({ postingStatus: 'pending' }); arrange(h);
    await assert.rejects(() => (h.repo as any).reopenExpenseAtomic(command, audit), (e: any) => e.getResponse?.().blockers?.includes(code));
    const caps = await (h.repo as any).expenseCorrectionCapabilities(command.companyId, command.expenseId, ['expense.confirm', 'expense.payment.record']);
    assert.equal(caps.canReopen, false); assert.ok(caps.reopenBlockers.includes(code));
    assert.equal(h.state.audits.length, 0);
  });

  it('refuses an external certificate linked through tax events rather than a payment source', async () => {
    const h = harness({ postingStatus: 'pending' });
    h.state.taxEvents.push({ id: 'event-1', taxPeriodId: 'period-1' });
    h.state.handoffs.push({ status: 'EXTERNAL_LINKED', sourcePaymentType: 'tax.workspace', taxEventIdsJson: ['event-1'] });
    await assert.rejects(() => h.repo.reopenExpenseAtomic(command), (error: any) => error.getResponse?.().blockers?.includes('certificate_issued'));
    assert.equal(h.state.expense.status, 'CONFIRMED');
  });

  it('capabilities allow only permitted correction and payment recording; posted payment stays blocked', async () => {
    const h = harness({ postingStatus: 'pending' }); await pay(h.repo, '40');
    let caps = await (h.repo as any).expenseCorrectionCapabilities('company-1', 'expense-1', ['expense.confirm', 'expense.payment.record']);
    assert.equal(caps.canReopen, true); assert.equal(caps.canRecordPayment, true); assert.equal(caps.payments[0].canCancel, true);
    caps = await (h.repo as any).expenseCorrectionCapabilities('company-1', 'expense-1', []);
    assert.equal(caps.canReopen, false); assert.equal(caps.canRecordPayment, false); assert.equal(caps.payments[0].canCancel, false);
    h.state.payments[0].postingStatus = 'posted';
    caps = await (h.repo as any).expenseCorrectionCapabilities('company-1', 'expense-1', ['expense.confirm', 'expense.payment.record']);
    assert.equal(caps.payments[0].canCancel, false); assert.equal(caps.payments[0].cancelBlocker, 'posting_unresolved');
  });

  it('rolls correction back on audit failure and refuses cross-tenant, cross-expense, branch and CAS changes', async () => {
    const h = harness({ postingStatus: 'pending' }); await pay(h.repo, '40'); h.failWrite('audit');
    await assert.rejects(() => (h.repo as any).cancelPaymentAtomic({ ...command, paymentId: 'payment-1' }, audit), /audit unavailable/);
    assert.equal(h.state.payments[0].status, 'RECORDED'); assert.equal(h.state.expense.paidAmount, '40.0000');
    await assert.rejects(() => (h.repo as any).cancelPaymentAtomic({ ...command, expenseId: 'other', paymentId: 'payment-1' }), NotFoundException);
    await assert.rejects(() => (h.repo as any).reopenExpenseAtomic({ ...command, companyId: 'other' }), NotFoundException);
    await assert.rejects(() => (h.repo as any).reopenExpenseAtomic({ ...command, scopes: { branchIds: ['other'] } }), ForbiddenException);
    h.failNextCas(); await assert.rejects(() => (h.repo as any).reopenExpenseAtomic(command), ConflictException);
    assert.equal(h.state.expense.status, 'CONFIRMED');
  });
});


describe('controller correction boundaries 2026-10-04', () => {
  const command = { companyId: 'company-1', expenseId: 'expense-1', actorUserId: 'finance-1', scopes: {}, reason: 'แก้ข้อมูลเอกสาร' };
  it('legacy filed withholding forms keep expense capabilities and reopening locked', async () => {
    for (const formType of ['PND3', 'PND53']) {
      const h = harness({ whtAmount: '30', vendorEntityKindSnapshot: formType === 'PND3' ? 'INDIVIDUAL' : 'JURISTIC' });
      h.state.filedSourceIds = [];
      h.state.taxPeriods = [{ id: 'old', formType, periodKey: '2026-08', status: 'FILED', whtFilings: [] }];
      assert.equal((await h.repo.expenseCorrectionCapabilities(command.companyId, command.expenseId, ['expense.confirm'])).canReopen, false);
      await assert.rejects(h.repo.reopenExpenseAtomic(command), (e: any) => e.getResponse?.().blockers?.includes('tax_period_filed'));
      assert.equal(h.state.expense.status, 'CONFIRMED');
    }
  });
  it('another establishment filing never locks reopening this expense', async () => {
    const h = harness({ postingStatus: 'pending', whtAmount: '3', vendorEntityKindSnapshot: 'INDIVIDUAL' });
    h.state.filedSourceIds = ['another-expense'];
    h.state.taxPeriods.push({ id: 'p', formType: 'PND3', periodKey: '2026-08', status: 'FILED' });
    assert.equal((await h.repo.expenseCorrectionCapabilities(command.companyId, command.expenseId, ['expense.confirm'])).canReopen, true);
    await h.repo.reopenExpenseAtomic(command);
    assert.equal(h.state.expense.status, 'NEEDS_REVIEW');
  });
  for (const status of ['CLOSED', 'LOCKED']) it(`reports and refuses accounting month ${status}`, async () => {
    const h = harness({ postingStatus: 'pending' });
    h.state.accountingPeriod = { status };
    const cap = await h.repo.expenseCorrectionCapabilities(command.companyId, command.expenseId, ['expense.confirm']);
    assert.equal(cap.canReopen, false);
    assert.equal(cap.lockedAccountingPeriodKey, '2026-08');
    await assert.rejects(h.repo.reopenExpenseAtomic(command), (e: any) => e.getResponse?.().blockers?.includes('accounting_period_locked'));
    assert.equal(h.state.expense.status, 'CONFIRMED');
  });
  for (const formType of ['PP30', 'PP36', 'CUSTOMS_SUPPORT', 'PND3', 'PND53']) {
    for (const status of ['FILED', 'PAID', 'CLOSED']) it(`reports and refuses ${formType}/${status}, without naming unrelated forms`, async () => {
      const h = harness({ postingStatus: 'pending', ...(formType.startsWith('PND')
        ? { whtAmount: '3', vendorEntityKindSnapshot: formType === 'PND3' ? 'INDIVIDUAL' : 'JURISTIC' }
        : { lines: [{ taxComponentsJson: [{ reportContributions: [{ formType }] }] }] }) });
      h.state.taxPeriods.push({ id: 'locked', formType, periodKey: '2026-08', status }, { id: 'unrelated', formType: 'PND50', periodKey: '2026', status: 'CLOSED' });
      const cap = await h.repo.expenseCorrectionCapabilities(command.companyId, command.expenseId, ['expense.confirm']);
      assert.equal(cap.canReopen, false);
      assert.deepEqual(cap.lockedTaxPeriods, [{ formType, periodKey: '2026-08' }]);
      await assert.rejects(h.repo.reopenExpenseAtomic(command), (e: any) => e.getResponse?.().blockers?.includes('tax_period_filed') && e.getResponse?.().lockedTaxPeriods?.[0]?.formType === formType);
      assert.equal(h.state.expense.status, 'CONFIRMED');
    });
  }
  it('retires legacy VAT, finalized line events and withholding atomically; excluded events stay excluded', async () => {
    const h = harness({ postingStatus: 'pending' });
    h.state.taxEvents.push(...['VAT_INPUT', 'VAT_INPUT', 'WHT_PND3'].map((eventType, i) => ({ id: `e${i}`, eventType, status: 'ACTIVE', sourceLineKey: i === 1 ? 'old-line' : '__HEADER__', sourceHash: 'old' })), { id: 'excluded', status: 'EXCLUDED', eventType: 'VAT_INPUT' });
    h.state.handoffs.push({ status: 'REQUIRED' });
    await h.repo.reopenExpenseAtomic(command);
    assert.deepEqual(h.state.taxEvents.map(e => e.status), ['SUPERSEDED', 'SUPERSEDED', 'SUPERSEDED', 'EXCLUDED']);
    assert.equal(h.state.handoffs[0].status, 'CANCELLED');
  });
  it('blocks rejection of retained payments atomically and reports a cancellation remedy, then permits rejection', async () => {
    const h = harness({ postingStatus: 'pending' }); await pay(h.repo, '40');
    await h.repo.reopenExpenseAtomic(command);
    const cap = await h.repo.expenseCorrectionCapabilities(command.companyId, command.expenseId, ['expense.reject', 'expense.payment.record']);
    assert.equal(cap.canReject, false); assert.equal(cap.rejectBlocker, 'recorded_payments');
    await assert.rejects(h.repo.updateExpense({ companyId: command.companyId, id: command.expenseId, status: 'REJECTED', updatedByUserId: 'finance-1' }), (e: any) => e.getResponse?.().code === 'expense_rejection_payments_recorded');
    assert.equal(h.state.expense.status, 'NEEDS_REVIEW');
    await h.repo.cancelPaymentAtomic({ ...command, paymentId: 'payment-1' });
    const after = await h.repo.expenseCorrectionCapabilities(command.companyId, command.expenseId, ['expense.reject']);
    assert.equal(after.canReject, true);
    await h.repo.updateExpense({ companyId: command.companyId, id: command.expenseId, status: 'REJECTED', updatedByUserId: 'finance-1' });
    assert.equal(h.state.expense.status, 'REJECTED');
    assert.equal(h.state.payments.filter(p => p.status === 'RECORDED').length, 0);
  });
});


describe('correction accounting/report lifecycle', () => {
  const command = { companyId: 'company-1', expenseId: 'expense-1', actorUserId: 'finance-1', scopes: {}, reason: 'แก้ข้อมูล' };
  it('locks an active component recognition period even when it differs from the document month', async () => {
    const h = harness({ postingStatus: 'pending' });
    h.state.taxEvents.push({ id: 'e1', taxPeriodId: 'p1', status: 'ACTIVE' });
    h.state.taxPeriods.push({ id: 'p1', formType: 'PP36', periodKey: '2026-09', status: 'PAID' });
    const cap = await h.repo.expenseCorrectionCapabilities(command.companyId, command.expenseId, ['expense.confirm']);
    assert.deepEqual(cap.lockedTaxPeriods, [{ formType: 'PP36', periodKey: '2026-09' }]);
    await assert.rejects(h.repo.reopenExpenseAtomic(command), (e: any) => e.getResponse?.().blockers?.includes('tax_period_filed'));
  });
  it('rolls VAT retirement and required handoff cancellation back if the reopen audit fails', async () => {
    const h = harness({ postingStatus: 'pending' });
    h.state.taxEvents.push({ id: 'e1', eventType: 'VAT_INPUT', status: 'ACTIVE' }); h.state.handoffs.push({ status: 'REQUIRED' });
    h.failWrite('audit');
    await assert.rejects(h.repo.reopenExpenseAtomic(command, tx => tx.auditLog.create({ data: {} })), /audit unavailable/);
    assert.equal(h.state.expense.status, 'CONFIRMED'); assert.equal(h.state.taxEvents[0].status, 'ACTIVE'); assert.equal(h.state.handoffs[0].status, 'REQUIRED');
  });
  it('retained payments forbid rejection even when the header paid summary is stale', async () => {
    const h = harness({ status: 'NEEDS_REVIEW', postingStatus: 'not_required', paidAmount: '0' });
    h.state.payments.push({ id: 'p1', status: 'RECORDED', companyId: 'company-1', expenseId: 'expense-1' });
    await assert.rejects(h.repo.updateExpense({ companyId: 'company-1', id: 'expense-1', status: 'REJECTED', updatedByUserId: 'finance-1' }), (e: any) => e.getResponse?.().code === 'expense_rejection_payments_recorded');
    assert.equal(h.state.expense.status, 'NEEDS_REVIEW');
  });
  it('rejecting an unpaid correction retires legacy active VAT and required handoffs', async () => {
    const h = harness({ status: 'NEEDS_REVIEW', postingStatus: 'not_required' });
    h.state.taxEvents.push({ id: 'e1', eventType: 'VAT_INPUT', status: 'ACTIVE' }); h.state.handoffs.push({ status: 'REQUIRED' });
    await h.repo.updateExpense({ companyId: 'company-1', id: 'expense-1', status: 'REJECTED', updatedByUserId: 'finance-1' });
    assert.equal(h.state.taxEvents[0].status, 'SUPERSEDED'); assert.equal(h.state.handoffs[0].status, 'CANCELLED');
  });
});


it('a legacy paid balance without a cancellable row explains the existing financial-void remedy', async () => {
  const h = harness({ status: 'NEEDS_REVIEW', paidAmount: '40', postingStatus: 'not_required' });
  const cap = await h.repo.expenseCorrectionCapabilities('company-1', 'expense-1', ['expense.reject']);
  assert.equal(cap.rejectBlocker, 'legacy_paid_balance');
  await assert.rejects(h.repo.updateExpense({ companyId: 'company-1', id: 'expense-1', status: 'REJECTED', updatedByUserId: 'finance-1' }), (e: any) => e.getResponse?.().code === 'expense_rejection_paid_balance');
});

// Browser follow-up regressions stay in this registered API file.
describe('expense correction detail facts and payment input', () => {
  it('accepts leading-zero amounts and still refuses zero/too much precision', async () => {
    const { repo, state } = harness();
    await pay(repo, '0040.00');
    assert.equal(Number(state.payments[0].amount), 40);
    for (const amount of ['000', '0040.001']) await assert.rejects(() => pay(repo, amount), BadRequestException);
  });
  it('names an expense opened elsewhere instead of returning an uncoded status refusal', async () => {
    const { repo } = harness({ status: 'NEEDS_REVIEW' });
    await assert.rejects(() => pay(repo, '1'), (e: any) => e.getResponse?.().code === 'expense_payment_not_confirmed');
  });
  it('reads reopen and cancellation audit facts scoped to the authorized expense and payment IDs', async () => {
    let query: any;
    const repo = new PrismaExpenseRepository({ client: { auditLog: { findMany: async (input: any) => {
      query = input; return [
        { action: 'expense.payment.cancel', targetId: 'p1', metadataJson: { reason: 'ยอดผิด' }, createdAt: VERSION },
        { action: 'expense.reopen', targetId: 'expense-1', createdAt: VERSION },
      ];
    } } } } as any);
    const read = (repo as any).findCorrectionHistory; assert.equal(typeof read, 'function');
    const result = await read.call(repo, 'company-1', 'expense-1', ['p1']);
    assert.equal(query.where.companyId, 'company-1'); assert.equal(query.where.result, 'SUCCESS');
    assert.deepEqual(query.where.OR, [
      { action: 'expense.reopen', targetType: 'expense_record', targetId: 'expense-1' },
      { action: 'expense.payment.cancel', targetType: 'expense_payment', targetId: { in: ['p1'] } },
    ]);
    assert.equal(result.reopenedAt.toISOString(), VERSION.toISOString());
    assert.equal(result.cancellationReasons.get('p1'), 'ยอดผิด');
  });
});


describe('A2 reopen cancels the expense certificate', () => {
  it('keeps the pinned capability text but asks to reopen the page on the stale-status mutation', async () => {
    const h = harness({ status: 'NEEDS_REVIEW', postingStatus: 'pending' });
    const caps = await h.repo.expenseCorrectionCapabilities('company-1', 'expense-1', ['expense.confirm']);
    const { expenseReopenBlockerMessages } = await import('@watchdog-bms/contracts');
    assert.ok(expenseReopenBlockerMessages(caps).some(message => message.includes('กลับไปหน้ารายจ่าย')));
    await assert.rejects(h.repo.reopenExpenseAtomic({ companyId: 'company-1', expenseId: 'expense-1', actorUserId: 'u1', scopes: {}, permissions: ['expense.confirm'], reason: 'ข้อมูลผิด' }), (error: any) => {
      assert.equal(error.getResponse().code, 'expense_correction_blocked');
      assert.equal(error.getResponse().message, 'สถานะเอกสารนี้ยังแก้ไขไม่ได้ เปิดหน้านี้ใหม่เพื่อตรวจสถานะ'); return true;
    });
  });
  const command = { companyId: 'company-1', expenseId: 'expense-1', actorUserId: 'finance-1', scopes: {},
    permissions: ['expense.confirm', 'wht.certificate.correct', 'wht.external_certificate.link'], reason: 'ข้อมูลผู้รับเงินผิด', taxFilingAttested: true };
  function issued(kind: 'SYSTEM' | 'EXTERNAL') {
    const h = harness({ postingStatus: 'pending', expenseNumber: 'EXP-1', whtAmount: '3', whtRate: '3', whtCategoryCode: 'SERVICE', vendorEntityKindSnapshot: 'JURISTIC' });
    h.state.handoffs.push({ id: 'handoff-1', companyId: command.companyId, sourcePaymentType: 'expense.record', sourcePaymentId: command.expenseId,
      status: kind === 'SYSTEM' ? 'SYSTEM_ISSUED' : 'EXTERNAL_LINKED', certificateRound: 0,
      creationCommandId: 'wht-cert:company-1:expense.record:expense-1',
      certificateId: kind === 'SYSTEM' ? 'cert-1' : null,
      externalCertificateNumber: kind === 'EXTERNAL' ? 'EXT-1' : null, externalEvidenceRef: kind === 'EXTERNAL' ? 'file-1' : null,
      externalIssuedDate: kind === 'EXTERNAL' ? VERSION : null, linkNote: 'บันทึกเอง', linkCommandId: 'link-1', linkPayloadFingerprint: 'hash-1', linkedAt: VERSION, linkedByUserId: 'user-1' });
    if (kind === 'SYSTEM') h.state.certificates.push({ id: 'cert-1', companyId: command.companyId, status: 'ISSUED', certificateNumber: 'WT-1', issuedAt: VERSION, issuedByUserId: 'issuer-1', taxEventIdsJson: [] });
    return h;
  }
  for (const kind of ['SYSTEM', 'EXTERNAL'] as const) {
    it(`allows ${kind} with its certificate permission and blocks without it`, async () => {
      const h = issued(kind);
      const allowed = await h.repo.expenseCorrectionCapabilities(command.companyId, command.expenseId, ['expense.confirm', kind === 'SYSTEM' ? 'wht.certificate.correct' : 'wht.external_certificate.link']);
      assert.equal(allowed.canReopen, true);
      assert.deepEqual(allowed.certificateOnExpense, { kind, number: kind === 'SYSTEM' ? 'WT-1' : 'EXT-1', date: VERSION.toISOString(), canCancel: true });
      const blocked = await h.repo.expenseCorrectionCapabilities(command.companyId, command.expenseId, ['expense.confirm', kind === 'SYSTEM' ? 'wht.external_certificate.link' : 'wht.certificate.correct']);
      assert.deepEqual(blocked.reopenBlockers, ['certificate_permission_missing']);
      assert.equal(blocked.certificateOnExpense?.canCancel, false);
      const cancelOnly = await h.repo.expenseCorrectionCapabilities(command.companyId, command.expenseId,
        ['expense.void', kind === 'SYSTEM' ? 'wht.certificate.correct' : 'wht.external_certificate.link']);
      assert.equal(cancelOnly.certificateOnExpense?.canCancel, true);
      assert.equal(cancelOnly.canReopen, false, 'certificate cancellation is independent of expense edit permission');
      await assert.rejects(h.repo.reopenExpenseAtomic({ ...command, permissions: ['expense.confirm'] }), (error: any) => error.getResponse?.().blockers?.includes('certificate_permission_missing'));
    });
    it(`requires explicit attestation before reopening ${kind}`, async () => {
      for (const taxFilingAttested of [undefined, false]) {
        const h = issued(kind);
        await assert.rejects(h.repo.reopenExpenseAtomic({ ...command, taxFilingAttested }), (error: any) => error.getResponse?.().code === 'expense_certificate_attestation_required');
        assert.equal(h.state.expense.status, 'CONFIRMED'); assert.equal(h.state.certificateHistory.length, 0);
      }
    });
    it(`cancels ${kind} once with history before pointer clearing and preserves the round on re-confirm`, async () => {
      const h = issued(kind);
      const result = await h.repo.reopenExpenseAtomic(command);
      assert.deepEqual((result as any).cancelledCertificate, { issuerUserId: kind === 'SYSTEM' ? 'issuer-1' : 'user-1', certificateNumber: kind === 'SYSTEM' ? 'WT-1' : 'EXT-1', isExternal: kind === 'EXTERNAL', certificateRound: 1 });
      const handoff = h.state.handoffs[0];
      assert.equal(handoff.status, 'CANCELLED'); assert.equal(handoff.certificateId, null); assert.equal(handoff.certificateRound, 1);
      for (const key of ['externalCertificateNumber', 'externalEvidenceRef', 'externalIssuedDate', 'linkNote', 'linkCommandId', 'linkPayloadFingerprint', 'linkedAt', 'linkedByUserId']) assert.equal(handoff[key], null, key);
      assert.equal(h.state.certificateHistory.length, 1);
      assert.deepEqual(h.state.certificateHistory[0], {
        companyId: command.companyId, expenseId: command.expenseId, handoffId: 'handoff-1',
        eventType: kind === 'SYSTEM' ? 'CANCELLED_SOURCE_REOPENED' : 'EXTERNAL_RECORD_REMOVED',
        actorUserId: command.actorUserId, isExternal: kind === 'EXTERNAL',
        certificateId: kind === 'SYSTEM' ? 'cert-1' : null,
        certificateNumber: kind === 'SYSTEM' ? 'WT-1' : 'EXT-1', certificateDate: VERSION,
        reason: command.reason, taxFilingAttested: true,
        ...(kind === 'EXTERNAL' ? { detailsJson: { externalEvidenceRef: 'file-1', linkNote: 'บันทึกเอง', linkedAt: VERSION.toISOString(), linkedByUserId: 'user-1' } } : {}),
      });
      if (kind === 'SYSTEM') {
        assert.equal(h.state.certificates[0].status, 'VOIDED'); assert.equal(h.state.certificates[0].voidReason, 'SOURCE_REOPENED');
        assert.equal(h.state.certificates[0].voidedByUserId, command.actorUserId); assert.ok(h.state.certificates[0].voidedAt);
      }
      assert.equal(h.state.audits.length, 1); assert.equal(h.state.audits[0].metadataJson.source, 'expense_reopen');
      await assert.rejects(h.repo.reopenExpenseAtomic(command));
      assert.equal(h.state.certificateHistory.length, 1); assert.equal(h.state.audits.length, 1);
      Object.assign(h.state.expense, { status: 'READY_FOR_CONFIRMATION', vendorNameSnapshot: 'ชื่อใหม่', whtAmount: '6' });
      await h.repo.confirmExpenseCas({ companyId: command.companyId, id: command.expenseId, actorUserId: command.actorUserId,
        expectedUpdatedAt: h.state.expense.updatedAt, expenseNumber: 'EXP-1', postingStatus: 'pending', vendorSnapshotJson: null,
        outboxEvent: { eventKey: 'confirm-again', payloadJson: {} } });
      assert.equal(h.state.handoffs.length, 1); assert.equal(h.state.handoffs[0].id, 'handoff-1');
      assert.equal(h.state.handoffs[0].status, 'REQUIRED'); assert.equal(h.state.handoffs[0].certificateRound, 1);
      assert.equal(h.state.handoffs[0].prefillSnapshotJson.payeeSnapshot.name, 'ชื่อใหม่');
      assert.equal(h.state.handoffs[0].prefillSnapshotJson.withheldAmount, '6');
      assert.equal(h.state.handoffs[0].certificateId, null); assert.equal(h.state.handoffs[0].linkCommandId, null);
    });
  }
  it('ignores attestation without a certificate and excludes VOIDED legacy certificates', async () => {
    const h = harness({ postingStatus: 'pending' });
    h.state.taxEvents.push({ id: 'event-1', status: 'ACTIVE', taxPeriodId: 'period-1' });
    h.state.certificates.push({ id: 'old', status: 'VOIDED', taxEventIdsJson: ['event-1'] });
    assert.equal((await h.repo.expenseCorrectionCapabilities(command.companyId, command.expenseId, command.permissions)).canReopen, true);
    await h.repo.reopenExpenseAtomic({ ...command, taxFilingAttested: false });
    assert.equal(h.state.certificateHistory.length, 0);
  });
  it('retains legacy event certificate blockers with unchanged Thai wording', async () => {
    const { expenseCorrectionBlockerMessage } = await import('@watchdog-bms/contracts');
    assert.equal(expenseCorrectionBlockerMessage('certificate_issued'), 'ออกเอกสาร 50 ทวิแล้ว จึงเปิดแก้ไขเอกสารไม่ได้ ติดต่อผู้ทำบัญชี');
    const h = harness({ postingStatus: 'pending' });
    h.state.taxEvents.push({ id: 'event-1', status: 'ACTIVE', taxPeriodId: 'period-1' });
    h.state.certificates.push({ id: 'legacy', status: 'ISSUED', taxEventIdsJson: ['event-1'] });
    assert.ok((await h.repo.expenseCorrectionCapabilities(command.companyId, command.expenseId, command.permissions)).reopenBlockers.includes('certificate_issued'));
  });
  it('names each PND3 and PND53 blocker by its actual form for edit, void and claim cancellation', async () => {
    const { expenseReopenBlockerMessages, expenseCorrectionBlockerMessage, EXPENSE_VOID_CERTIFICATE_WORDS, REIMBURSEMENT_CERTIFICATE_CANCELLATION_WORDS } = await import('@watchdog-bms/contracts');
    const h = issued('SYSTEM');
    h.state.taxEvents.push({ id: 'pnd3-event', taxPeriodId: 'pnd3-period', status: 'ACTIVE' });
    h.state.taxPeriods.push(
      { id: 'pnd3-period', formType: 'PND3', periodKey: '2026-08', status: 'FILED' },
      { formType: 'PND53', periodKey: '2026-08', status: 'FILED' },
    );
    const caps = await h.repo.expenseCorrectionCapabilities(command.companyId, command.expenseId, command.permissions);
    for (const kind of ['SYSTEM', 'EXTERNAL'] as const) {
      const facts = { ...caps, certificateOnExpense: { ...caps.certificateOnExpense!, kind } };
      const messages = expenseReopenBlockerMessages(facts);
      assert.equal(messages.length, 2);
      for (const [index, formType] of (['PND3', 'PND53'] as const).entries()) {
        const formName = formType === 'PND3' ? 'ภ.ง.ด.3' : 'ภ.ง.ด.53';
        assert.ok(messages[index].startsWith(`ภาษีหัก ณ ที่จ่าย (${formName}) ของเดือน ส.ค. 2569 ยื่นไปแล้ว จึงแก้ไขเอกสารนี้ไม่ได้ `));
        assert.equal(expenseCorrectionBlockerMessage('tax_period_filed', 'reopen', { ...facts, lockedTaxPeriods: [{ formType, periodKey: '2026-08' }] }), messages[index]);
        assert.ok(EXPENSE_VOID_CERTIFICATE_WORDS.periodLocked(kind, '2026-08', formType).startsWith(`ภาษีหัก ณ ที่จ่าย (${formName}) ของเดือน ส.ค. 2569 ยื่นไปแล้ว จึงยกเลิกเอกสารนี้ไม่ได้ `));
        assert.ok(REIMBURSEMENT_CERTIFICATE_CANCELLATION_WORDS.periodLocked(kind, '2026-08', formType).startsWith(`ภาษีหัก ณ ที่จ่าย (${formName}) ของเดือน ส.ค. 2569 ยื่นไปแล้ว จึงยกเลิกใบเบิกไม่ได้ `));
      }
    }
  });
  it('appends certificate-only correction guidance to each locked-tax message for SYSTEM only', async () => {
    const { expenseReopenBlockerMessages, expenseCorrectionBlockerMessage } = await import('@watchdog-bms/contracts');
    const guidance = 'ถ้าผิดเฉพาะตัวสะกดชื่อหรือที่อยู่บนหนังสือรับรอง ใช้ปุ่ม "แก้ไขหนังสือรับรอง" ได้';
    const h = issued('SYSTEM'); h.state.taxPeriods.push({ formType: 'PND53', periodKey: '2026-08', status: 'FILED' });
    const caps = await h.repo.expenseCorrectionCapabilities(command.companyId, command.expenseId, command.permissions);
    assert.ok(caps.reopenBlockers.includes('tax_period_filed'));
    await assert.rejects(h.repo.reopenExpenseAtomic(command), (error: any) => {
      assert.deepEqual(error.getResponse().certificateOnExpense, caps.certificateOnExpense);
      assert.ok(error.getResponse().message.includes(guidance)); return true;
    });
    assert.equal(expenseReopenBlockerMessages(caps)[0], `ภาษีหัก ณ ที่จ่าย (ภ.ง.ด.53) ของเดือน ส.ค. 2569 ยื่นไปแล้ว จึงแก้ไขเอกสารนี้ไม่ได้ ${guidance} ถ้าข้อเท็จจริงผิด ให้ยกเลิกเอกสารแล้วบันทึกใหม่ ให้ผู้ทำบัญชีแจ้งกรมสรรพากรเรื่องแบบเดิม`);
    assert.equal(expenseCorrectionBlockerMessage('tax_period_filed', 'reopen', caps), `ภาษีหัก ณ ที่จ่าย (ภ.ง.ด.53) ของเดือน ส.ค. 2569 ยื่นไปแล้ว จึงแก้ไขเอกสารนี้ไม่ได้ ${guidance} ถ้าข้อเท็จจริงผิด ให้ยกเลิกเอกสารแล้วบันทึกใหม่ ให้ผู้ทำบัญชีแจ้งกรมสรรพากรเรื่องแบบเดิม`);
    const external = { ...caps, certificateOnExpense: { kind: 'EXTERNAL' as const, number: null, date: null, canCancel: false } };
    assert.deepEqual(expenseReopenBlockerMessages(external), ['ภาษีหัก ณ ที่จ่าย (ภ.ง.ด.53) ของเดือน ส.ค. 2569 ยื่นไปแล้ว จึงแก้ไขเอกสารนี้ไม่ได้ ให้ยกเลิกเอกสารแล้วบันทึกใหม่ ให้ผู้ทำบัญชีแจ้งกรมสรรพากรเรื่องแบบเดิม']);
    assert.equal(expenseCorrectionBlockerMessage('certificate_permission_missing', 'reopen', caps), 'เอกสารนี้ออกหนังสือรับรองหัก ณ ที่จ่ายแล้ว (เลขที่ WT-1) การแก้ไขจะยกเลิกหนังสือรับรองใบเดิมด้วย ซึ่งต้องใช้สิทธิ์จัดการหนังสือรับรองหัก ณ ที่จ่าย ให้เจ้าของกิจการหรือผู้ที่มีสิทธิ์นั้นเป็นผู้แก้ไข');
    assert.equal(expenseCorrectionBlockerMessage('certificate_permission_missing'), 'เอกสารนี้ออกหนังสือรับรองหัก ณ ที่จ่ายแล้ว การแก้ไขจะยกเลิกหนังสือรับรองใบเดิมด้วย ซึ่งต้องใช้สิทธิ์จัดการหนังสือรับรองหัก ณ ที่จ่าย ให้เจ้าของกิจการหรือผู้ที่มีสิทธิ์นั้นเป็นผู้แก้ไข');
    assert.equal(expenseCorrectionBlockerMessage('certificate_permission_missing', 'reopen', external), 'เอกสารนี้บันทึกไว้ว่าออกหนังสือรับรองหัก ณ ที่จ่ายนอกระบบแล้ว การแก้ไขจะยกเลิกการบันทึกนั้นด้วย ซึ่งต้องใช้สิทธิ์บันทึกหนังสือรับรองที่ทำนอกระบบ ให้ผู้ที่มีสิทธิ์นั้นเป็นผู้แก้ไข');
    assert.equal(expenseCorrectionBlockerMessage('certificate_permission_missing', 'reopen', { ...external, certificateOnExpense: { ...external.certificateOnExpense, number: 'EXT-1' } }), 'เอกสารนี้บันทึกไว้ว่าออกหนังสือรับรองหัก ณ ที่จ่ายนอกระบบแล้ว (เลขที่ EXT-1) การแก้ไขจะยกเลิกการบันทึกนั้นด้วย ซึ่งต้องใช้สิทธิ์บันทึกหนังสือรับรองที่ทำนอกระบบ ให้ผู้ที่มีสิทธิ์นั้นเป็นผู้แก้ไข');
  });
  it('rolls certificate, handoff, history and expense back together when cancellation audit fails', async () => {
    const h = issued('SYSTEM'); h.failWrite('audit');
    await assert.rejects(h.repo.reopenExpenseAtomic(command), /audit unavailable/);
    assert.equal(h.state.expense.status, 'CONFIRMED'); assert.equal(h.state.certificates[0].status, 'ISSUED');
    assert.equal(h.state.handoffs[0].certificateId, 'cert-1'); assert.equal(h.state.certificateHistory.length, 0);
  });
  it('refuses a changed system certificate without committing the reopen', async () => {
    const h = issued('SYSTEM'); h.state.certificates[0].status = 'VOIDED';
    await assert.rejects(h.repo.reopenExpenseAtomic(command), (error: any) => error.getResponse?.().code === 'expense_correction_source_changed' && error.getResponse().message === 'ข้อมูลเอกสารเปลี่ยนแล้ว เปิดหน้านี้ใหม่และตรวจข้อมูลก่อนทำรายการ');
    assert.equal(h.state.expense.status, 'CONFIRMED'); assert.equal(h.state.certificateHistory.length, 0);
  });
});

describe('frozen withholding papers (real PostgreSQL)', () => {
  const required = process.env.EXPENSE_PAYMENT_REQUIRE_POSTGRES === 'true';
  const companyId = `wht-filing-pg-${randomUUID()}`;
  let client: PrismaClient | undefined;
  let ready = false;
  let period: any;
  before(async () => {
    if (!process.env.DATABASE_URL) { assert.equal(required, false, 'PostgreSQL required'); return; }
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
    const unavailable = await pgSpecUnreachableReason(() => client!.$queryRaw`SELECT "rowsCertain" FROM "WhtFiling" LIMIT 0`, 'EXPENSE_PAYMENT_REQUIRE_POSTGRES');
    if (unavailable) return;
    await client.company.create({ data: { id: companyId, name: 'Synthetic frozen paper' } });
    period = await client.taxPeriod.create({ data: { companyId, taxType: 'WHT', formType: 'PND3', periodKey: '2026-09' } });
    ready = true;
  });
  after(async () => {
    if (!client) return;
    try {
      if (ready) {
        // Fixture cleanup only: break the latest-package cycle before removing this synthetic tenant.
        const filings = await client.whtFiling.findMany({ where: { companyId } });
        await client.whtFiling.updateMany({ where: { companyId }, data: { filingPackageId: null } });
        await client.whtFilingLine.deleteMany({ where: { whtFilingId: { in: filings.map(row => row.id) } } });
        await client.taxFilingPackage.deleteMany({ where: { companyId } });
        await client.whtFiling.deleteMany({ where: { companyId } });
        await client.attachmentLink.deleteMany({ where: { companyId } });
        await client.attachmentObject.deleteMany({ where: { companyId } });
        await client.company.delete({ where: { id: companyId } });
      }
    } finally { await client.$disconnect(); }
  });
  it('MONEY-T1 persisted certificate and filing payments share the withheld-line income and captured rate', async t => {
    if (!ready) { t.skip('Local migrated PostgreSQL unavailable'); return; }
    const { expenseWhtIncomeBase, expenseWhtHeaderRate } = await import('../domain/logic/expense-wht-input.logic');
    const { calcLineTotals } = await import('../domain/logic/expense-totals.logic');
    const { certificatePayment } = await import('../../tax/application/services/wht-certificate-payment');
    const day = new Date('2026-09-18T00:00:00Z');
    const expense = await client!.expenseRecord.create({ data: { companyId, createdByUserId: 'synthetic-actor', status: 'CONFIRMED',
      expenseDate: day, vatMode: 'NO_VAT', taxableAmount: '143744.56', grandTotalAmount: '143744.56', netPayableAmount: '142307.12',
      whtAmount: '1437.44', whtRate: '3', whtInputJson: { inputType: 'RATE', value: '1', origin: 'REVIEWER' },
      vendorEntityKindSnapshot: 'INDIVIDUAL', vendorNameSnapshot: 'ผู้รับเงิน', vendorAddressSnapshot: 'ที่อยู่ผู้รับเงิน',
      lines: { create: Array.from({ length: 5 }, (_, index) => ({ companyId, lineNumber: index + 1, description: 'Synthetic withholding source',
        quantity: '1', unitPrice: index === 4 ? '-0.24' : '35936.20', chargeKind: index === 4 ? 'ROUNDING' : null,
        ...calcLineTotals({ quantity: '1', unitPrice: index === 4 ? '-0.24' : '35936.20', vatMode: 'NO_VAT', whtRate: index === 4 ? '0' : '0.01' }),
        whtRate: index === 4 ? null : '0.01' })) } } });
    try {
      const source = await client!.expenseRecord.findUniqueOrThrow({ where: { id: expense.id }, include: { lines: true } });
      const payment = await client!.expensePayment.create({ data: { companyId, expenseId: expense.id, amount: expense.netPayableAmount,
        paidAt: day, paidAtConfirmed: true, createdByUserId: 'synthetic-actor' } });
      const input = source.whtInputJson as any;
      const prefill = { grossAmount: expenseWhtIncomeBase({ ...source, whtInputJson: input }), withheldAmount: source.whtAmount.toString(),
        whtRate: expenseWhtHeaderRate(input, source.lines, source.whtRate), paymentDate: day.toISOString() };
      const paper = await certificatePayment(client!, companyId, { sourcePaymentType: 'expense.record', sourcePaymentId: expense.id, prefillSnapshotJson: prefill }, payment.id);
      const filing = (await new ExpenseSourceAdapter({ client } as any).findConfirmedWithWhtByCompany(companyId)).find(row => row.paymentId === payment.id)!;
      assert.equal(paper.grossAmount, '143744.8'); assert.equal(paper.whtRate, '1');
      assert.equal(filing.grossAmount, paper.grossAmount); assert.equal(filing.whtAmount, paper.withheldAmount);
      assert.equal(filing.whtRate, '1.0000');
      assert.equal((await client!.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } })).whtRate!.toString(), '3', 'read projection does not rewrite a saved header');
    } finally {
      await client!.expensePayment.deleteMany({ where: { companyId, expenseId: expense.id } });
      await client!.expenseLine.deleteMany({ where: { companyId, expenseId: expense.id } });
      await client!.expenseRecord.delete({ where: { id: expense.id } });
    }
  });
  it('W1 concurrent certificate payment handoffs have one identity and roll back with the transaction', async t => {
    if (!ready) { t.skip('Local migrated PostgreSQL unavailable'); return; }
    const { paymentHandoff } = await import('../../tax/application/services/wht-certificate-payment');
    const expense = await client!.expenseRecord.create({ data: { companyId, createdByUserId: 'synthetic-actor', captureSource: 'WEB_UPLOAD', status: 'CONFIRMED', expenseDate: new Date('2026-10-28'), netPayableAmount: '970', whtAmount: '30' } });
    try {
      const payment = await client!.expensePayment.create({ data: { companyId, expenseId: expense.id, amount: '970', paidAt: new Date('2026-11-05'), paidAtConfirmed: true, createdByUserId: 'synthetic-actor' } });
      const root = { id: 'draft', sourcePaymentType: 'expense.record', sourcePaymentId: expense.id, sourceFeatureKey: 'expenses',
        prefillSnapshotJson: { payerSnapshot: { companyName: 'ร้าน', taxId: '0105569135722', address: 'กรุงเทพมหานคร', branchCode: '00000' }, payeeSnapshot: { name: 'ผู้รับเงิน', taxId: '1234567890123', address: 'กรุงเทพมหานคร' }, grossAmount: '1000', withheldAmount: '30', paymentDate: '2026-10-28' } };
      const results = await Promise.all([paymentHandoff(client, companyId, root, payment.id), paymentHandoff(client, companyId, root, payment.id)]);
      assert.equal(results[0].id, results[1].id);
      assert.equal(await client!.whtCertificateHandoff.count({ where: { companyId, sourcePaymentId: expense.id } }), 1);
      await client!.whtCertificateHandoff.deleteMany({ where: { companyId, sourcePaymentId: expense.id } });
      await assert.rejects(client!.$transaction(async tx => { await paymentHandoff(tx, companyId, root, payment.id); throw new Error('rollback'); }), /rollback/);
      assert.equal(await client!.whtCertificateHandoff.count({ where: { companyId, sourcePaymentId: expense.id } }), 0);
    } finally {
      await client!.whtCertificateHandoff.deleteMany({ where: { companyId, sourcePaymentId: expense.id } });
      await client!.expensePayment.deleteMany({ where: { companyId, expenseId: expense.id } });
      await client!.expenseRecord.delete({ where: { id: expense.id } });
    }
  });
  it('W4 payment date certainty defaults false and duplicate payment rollback leaves no second source', async t => {
    if (!ready) { t.skip('Local migrated PostgreSQL unavailable'); return; }
    const expense = await client!.expenseRecord.create({ data: { companyId, createdByUserId: 'synthetic-actor', captureSource: 'WEB_UPLOAD', status: 'CONFIRMED', expenseDate: new Date('2026-10-28') } });
    try {
      const data = { companyId, expenseId: expense.id, amount: '97', paidAt: new Date('2026-11-04T17:00:00Z'), createdByUserId: 'synthetic-actor', idempotencyKey: 'payment-date-test', payloadFingerprint: 'a'.repeat(64) };
      const unknown = await client!.expensePayment.create({ data });
      assert.equal(unknown.paidAtConfirmed, false);
      await assert.rejects(client!.$transaction(async tx => {
        await tx.expensePayment.update({ where: { id: unknown.id }, data: { paidAtConfirmed: true } });
        await tx.expensePayment.create({ data });
      }), (error: any) => error.code === 'P2002');
      assert.equal((await client!.expensePayment.findUniqueOrThrow({ where: { id: unknown.id } })).paidAtConfirmed, false);
      assert.equal(await client!.expensePayment.count({ where: { companyId, expenseId: expense.id } }), 1);
    } finally {
      await client!.expensePayment.deleteMany({ where: { companyId, expenseId: expense.id } });
      await client!.expenseRecord.delete({ where: { id: expense.id } });
    }
  });
  it('W4 migration preserves entered historical dates and excludes seed dates only', async t => {
    if (!ready) { t.skip('Local migrated PostgreSQL unavailable'); return; }
    const sql = readFileSync('prisma/migrations/20261014140000_preserve_entered_payment_dates/migration.sql', 'utf8');
    await client!.$transaction(async tx => {
      await tx.$executeRawUnsafe('CREATE TEMP TABLE "ExpensePayment" ("idempotencyKey" TEXT, "paidAtConfirmed" BOOLEAN NOT NULL DEFAULT false) ON COMMIT DROP');
      await tx.$executeRawUnsafe(`INSERT INTO "ExpensePayment" ("idempotencyKey") VALUES (NULL), ('client:human'), ('dv:v:l'), ('substitute-receipt:e'), ('client:seed-payment-rent')`);
      await tx.$executeRawUnsafe(sql);
      const rows = await tx.$queryRawUnsafe<Array<{ idempotencyKey: string | null; paidAtConfirmed: boolean }>>('SELECT * FROM "ExpensePayment"');
      assert.equal(rows.length, 5);
      for (const row of rows) assert.equal(row.paidAtConfirmed, row.idempotencyKey !== 'client:seed-payment-rent');
    });
  });
  it('payer mode admits one live answer per shop/month and retains superseded history', async t => {
    if (!ready) { t.skip('Local migrated PostgreSQL unavailable'); return; }
    const data = { companyId, mode: 'HEAD_OFFICE_PAYS_ALL', effectiveFromPeriodKey: '2026-09', answeredByUserId: 'synthetic-actor' };
    const attempts = await Promise.allSettled([client!.whtPayerModeFact.create({ data }), client!.whtPayerModeFact.create({ data })]);
    assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal((attempts.find(result => result.status === 'rejected') as PromiseRejectedResult).reason.code, 'P2002');
    await client!.$transaction(async tx => {
      await tx.whtPayerModeFact.updateMany({ where: { companyId, effectiveFromPeriodKey: data.effectiveFromPeriodKey, supersededAt: null }, data: { supersededAt: new Date() } });
      await tx.whtPayerModeFact.create({ data: { ...data, mode: 'EACH_BRANCH_PAYS' } });
    });
    assert.equal(await client!.whtPayerModeFact.count({ where: { companyId, supersededAt: null } }), 1);
    assert.equal(await client!.whtPayerModeFact.count({ where: { companyId } }), 2);
    await client!.whtPayerModeFact.create({ data: { ...data, effectiveFromPeriodKey: '2026-10' } });
    await assert.rejects(client!.whtPayerModeFact.create({ data: { ...data, mode: 'UNKNOWN', effectiveFromPeriodKey: '2026-11' } }));
    await assert.rejects(client!.whtPayerModeFact.create({ data: { ...data, effectiveFromPeriodKey: '2026-13' } }));
  });
  it('the establishment/form/month/sequence key admits only one concurrent paper', async t => {
    if (!ready) { t.skip('Local migrated PostgreSQL unavailable'); return; }
    const data = { companyId, taxPeriodId: period.id, formType: 'PND3' as const, periodKey: period.periodKey,
      establishmentCode: '00001', sequence: 0, preparedBy: 'SYSTEM', payerSnapshotJson: {}, rowsChecksum: 'test' };
    const results = await Promise.allSettled([client!.whtFiling.create({ data }), client!.whtFiling.create({ data })]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal((results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason.code, 'P2002');
  });
  it('a filed establishment locks only its lines, and the roll-up waits for the other paper', async t => {
    if (!ready) { t.skip('Local migrated PostgreSQL unavailable'); return; }
    const { filedWithholdingPaymentPeriods } = await import('../../tax/application/services/filed-withholding-payment');
    const { rollUpWithholdingPeriod } = await import('../../tax/application/services/withholding-establishments');
    const p = await client!.taxPeriod.create({ data: { companyId, taxType: 'WHT', formType: 'PND53', periodKey: '2026-10' } });
    for (const [code, source, status] of [['00000', 'one', 'FILED'], ['00002', 'two', 'EXPORTED']] as const) {
      await client!.whtFiling.create({ data: { companyId, taxPeriodId: p.id, formType: 'PND53', periodKey: p.periodKey, establishmentCode: code, sequence: 0,
        status, preparedBy: 'SYSTEM', payerSnapshotJson: {}, rowsChecksum: 'test', lines: { create: { taxEventId: `event-${source}`, sourceType: 'expense.record', sourceId: source, rowNumber: 1, lineJson: {} } } } });
    }
    assert.equal((await filedWithholdingPaymentPeriods(client!, companyId, 'expense.record', 'one')).length, 1);
    assert.equal((await filedWithholdingPaymentPeriods(client!, companyId, 'expense.record', 'two')).length, 0);
    assert.equal(await client!.$transaction(tx => rollUpWithholdingPeriod(tx, companyId, p.id)), 'EXPORTED');
    await client!.whtFiling.updateMany({ where: { companyId, taxPeriodId: p.id, establishmentCode: '00002', status: 'EXPORTED' }, data: { status: 'FILED' } });
    assert.equal(await client!.$transaction(tx => rollUpWithholdingPeriod(tx, companyId, p.id)), 'FILED');
  });
  it('package, file reference and frozen lines commit together, roll back together, and refuse replacement after filing', async t => {
    if (!ready) { t.skip('Local migrated PostgreSQL unavailable'); return; }
    const { PrismaTaxRepository } = await import('../../tax/infrastructure/repositories/prisma-tax.repository');
    const repo = new PrismaTaxRepository({ client } as any);
    const input: any = { ctx: { companyId, userId: 'synthetic-actor' }, period, exportFormat: 'PDF', exportNumber: 'TEST-1',
      artifact: { fileName: 'test.pdf', mimeType: 'application/pdf', checksum: 'file', byteLength: 5, contentBase64: 'JVBERi0=' },
      stored: { bucket: 'synthetic', objectKey: `${companyId}/first`, storageProvider: 'local', objectVersionId: 'v1', byteSize: 5, checksumSha256: 'file' },
      establishmentCode: '00000', establishmentBranchId: null, preparedBy: 'SYSTEM', payerSnapshotJson: { payerName: 'ร้านทดสอบ' }, rowsChecksum: 'rows', rowsCertain: true,
      lines: [{ taxEventId: 'synthetic-event', sourceType: 'expense.record', sourceId: 'synthetic-expense', lineJson: { income: 1000, withheld: 30 } }] };
    const pkg = await repo.recordWithholdingDownload(input);
    const filing = await client!.whtFiling.findFirstOrThrow({ where: { companyId, filingPackageId: pkg.id }, include: { lines: true } });
    assert.equal(filing.lines.length, 1);
    assert.ok(await client!.attachmentObject.findUnique({ where: { id: pkg.attachmentId! } }));
    await assert.rejects(repo.recordWithholdingDownload({ ...input, stored: { ...input.stored, objectKey: `${companyId}/rolled-back` }, lines: [{ ...input.lines[0], taxEventId: null }] }));
    assert.equal(await client!.taxFilingPackage.count({ where: { companyId } }), 1);
    assert.equal(await client!.attachmentObject.count({ where: { companyId } }), 1);
    assert.deepEqual((await client!.whtFiling.findUniqueOrThrow({ where: { id: filing.id }, include: { lines: true } })).lines, filing.lines);
    await client!.$transaction(async tx => {
      await repo.markWithholdingFilingFiled(tx, companyId, pkg.id, 'synthetic-actor', new Date(), 'ยื่นแล้ว');
      await tx.taxPeriod.update({ where: { id: period.id }, data: { status: 'FILED' } });
    });
    await assert.rejects(repo.recordWithholdingDownload(input), (error: any) => error.getResponse().code === 'WHT_FILING_ALREADY_FILED');
    assert.equal(await client!.taxFilingPackage.count({ where: { companyId } }), 1);
    assert.equal((await client!.whtFiling.findUniqueOrThrow({ where: { id: filing.id } })).filedByUserId, 'synthetic-actor');
    const kept = await client!.whtFiling.findUniqueOrThrow({ where: { id: filing.id }, include: { lines: true, latestPackage: true } });
    const additional = { ...input, sequence: 1, exportNumber: 'TEST-ADDITIONAL-1', stored: { ...input.stored, objectKey: `${companyId}/additional-1` },
      lines: [{ ...input.lines[0], taxEventId: 'late-event', sourceId: 'late-expense' }] };
    await assert.rejects(repo.recordWithholdingDownload({ ...additional, lines: input.lines }), (e: any) => e.getResponse().code === 'WHT_FILING_CHANGED_AFTER_DOWNLOAD');
    await assert.rejects(repo.recordWithholdingDownload({ ...additional, lines: [{ ...additional.lines[0], taxEventId: null }] }));
    assert.equal(await client!.whtFiling.count({ where: { companyId, establishmentCode: '00000', sequence: 1 } }), 0, 'failed line write rolls back the additional paper and package');
    const extra = await repo.recordWithholdingDownload(additional);
    assert.equal(await client!.whtFiling.count({ where: { companyId, establishmentCode: '00000', sequence: 1 } }), 1);
    await assert.rejects(repo.recordWithholdingDownload({ ...additional, sequence: 2 }), (e: any) => e.getResponse().code === 'WHT_FILING_SEQUENCE_INVALID');
    await client!.$transaction(tx => repo.markWithholdingFilingFiled(tx, companyId, extra.id, 'synthetic-actor', new Date()));
    await assert.rejects(repo.recordWithholdingDownload(additional), (e: any) => e.getResponse().code === 'WHT_FILING_ALREADY_FILED');
    assert.deepEqual(await client!.whtFiling.findUniqueOrThrow({ where: { id: filing.id }, include: { lines: true, latestPackage: true } }), kept);

  });
  it('legacy restoration is idempotent and confirmation commits file, certainty and audit together', async t => {
    if (!ready) { t.skip('Local migrated PostgreSQL unavailable'); return; }
    const { restoreLegacyWithholdingPeriod, confirmWithholdingRows } = await import('../../tax/application/services/legacy-withholding-filing');
    const actorId = `wht-confirm-${randomUUID()}`;
    await client!.user.create({ data: { id: actorId, displayName: 'Synthetic accountant' } });
    const legacy = await client!.taxPeriod.create({ data: { companyId, taxType: 'WHT', formType: 'PND3', periodKey: '2025-01', status: 'FILED', filedAt: new Date('2025-02-01') } });
    const objects = new Map<string, Buffer>();
    const storage: any = { putObject: async ({ objectKey, bytes }: any) => { objects.set(objectKey, bytes); return { objectKey, bucket: 'test', storageProvider: 'local', byteSize: bytes.length, checksumSha256: 'hash' }; },
      deleteObject: async ({ objectKey }: any) => { objects.delete(objectKey); } };
    const render: any = async () => ({ fileName: 'แบบ.pdf', mimeType: 'application/pdf', contentBase64: Buffer.from('restored').toString('base64'), checksum: 'hash', byteLength: 8 });
    try {
      const others = await client!.whtFiling.findMany({ where: { companyId }, include: { lines: true, latestPackage: true } });
      assert.equal(await restoreLegacyWithholdingPeriod(client!, storage, legacy, render), 'uncertain');
      assert.equal(await restoreLegacyWithholdingPeriod(client!, storage, legacy, render), 'skipped');
      const paper = await client!.whtFiling.findFirstOrThrow({ where: { taxPeriodId: legacy.id }, include: { lines: true } });
      const command: any = { companyId, userId: 'missing-user', permissions: ['wht.pnd53.prepare'], scopes: {}, requestId: randomUUID() };
      await assert.rejects(confirmWithholdingRows(client!, storage, command, paper.id, render));
      assert.equal(objects.size, 0, 'failed audit removes only this attempted new object');
      assert.equal((await client!.whtFiling.findUniqueOrThrow({ where: { id: paper.id } })).rowsCertain, false);
      assert.equal(await client!.taxFilingPackage.count({ where: { whtFilingId: paper.id } }), 0);
      command.userId = actorId;
      await confirmWithholdingRows(client!, storage, command, paper.id, render);
      await confirmWithholdingRows(client!, storage, command, paper.id, render);
      const confirmed = await client!.whtFiling.findUniqueOrThrow({ where: { id: paper.id }, include: { lines: true, latestPackage: true } });
      assert.equal(confirmed.rowsCertain, true); assert.deepEqual(confirmed.lines, paper.lines);
      assert.equal(objects.size, 1); assert.ok(confirmed.latestPackage?.attachmentId);
      const { filedWithholdingPaymentPeriods } = await import('../../tax/application/services/filed-withholding-payment');
      assert.deepEqual(await filedWithholdingPaymentPeriods(client!, companyId, 'expense.record', 'late', { formType: 'PND3', periodKey: legacy.periodKey }), [], 'confirmed empty reconstructed month admits late payments');
      assert.equal(await client!.auditLog.count({ where: { targetId: paper.id, action: 'tax.wht_filing.confirm_rows' } }), 1);
      assert.deepEqual(await client!.whtFiling.findMany({ where: { companyId, id: { in: others.map(p => p.id) } }, include: { lines: true, latestPackage: true } }), others);
    } finally {
      await client!.auditLog.deleteMany({ where: { actorUserId: actorId } });
      await client!.user.delete({ where: { id: actorId } });
    }
  });

  it('legacy and frozen forms in the same month retain independent locks', async t => {
    if (!ready) { t.skip('Local migrated PostgreSQL unavailable'); return; }
    const { filedWithholdingPaymentPeriods } = await import('../../tax/application/services/filed-withholding-payment');
    const old = await client!.taxPeriod.create({ data: { companyId, taxType: 'WHT', formType: 'PND3', periodKey: '2026-11', status: 'FILED' } });
    await client!.whtFiling.create({ data: { companyId, taxPeriodId: old.id, formType: 'PND3', periodKey: old.periodKey, establishmentCode: '00000', sequence: 0,
      status: 'EXPORTED', rowsCertain: false, preparedBy: 'SYSTEM', payerSnapshotJson: {}, rowsChecksum: 'uncertain', lines: { create: { taxEventId: 'old-snapshot', sourceType: 'expense.record', sourceId: 'old-snapshot', rowNumber: 1, lineJson: {} } } } });
    const fresh = await client!.taxPeriod.create({ data: { companyId, taxType: 'WHT', formType: 'PND53', periodKey: '2026-11', status: 'FILED' } });
    await client!.whtFiling.create({ data: { companyId, taxPeriodId: fresh.id, formType: 'PND53', periodKey: fresh.periodKey, establishmentCode: '00000', sequence: 0,
      status: 'FILED', preparedBy: 'SYSTEM', payerSnapshotJson: {}, rowsChecksum: 'kept', lines: { create: { taxEventId: 'kept', sourceType: 'expense.record', sourceId: 'kept', rowNumber: 1, lineJson: {} } } } });
    assert.equal((await filedWithholdingPaymentPeriods(client!, companyId, 'expense.record', 'late', { formType: 'PND3', periodKey: '2026-11' })).length, 1);
    assert.equal((await filedWithholdingPaymentPeriods(client!, companyId, 'expense.record', 'late', { formType: 'PND53', periodKey: '2026-11' })).length, 0);
    assert.equal((await filedWithholdingPaymentPeriods(client!, companyId, 'expense.record', 'kept', { formType: 'PND53', periodKey: '2026-11' })).length, 1);
  });

});

describe('expense payment slip', () => {
  const slip = { id: 'slip-1', companyId: 'company-1', branchId: 'branch-1', uploadedByUserId: 'finance-1', status: 'ACTIVE', mimeType: 'image/png', byteSize: 100, metadataJson: { generatedFor: 'expense.payment.slip', expenseId: 'expense-1' } };
  it('links the scoped slip to that payment and expense evidence atomically; retries keep one pair', async () => {
    const h = harness(); h.state.files.push(slip);
    const input = paymentInput('100', { slipAttachmentId: slip.id });
    const result = await h.repo.recordPaymentAtomic(input);
    assert.deepEqual(h.state.links.map(l => [l.targetType, l.targetId, l.purpose]), [
      ['expense.payment', result.payment!.id, 'expense.payment.evidence'], ['expense.record', 'expense-1', 'expense.payment.evidence'],
    ]);
    assert.ok(h.state.links.every(l => l.companyId === 'company-1' && l.attachmentId === slip.id && l.linkedByUserId === 'finance-1'));
    await h.repo.recordPaymentAtomic(input); assert.equal(h.state.links.length, 2);
    await assert.rejects(h.repo.recordPaymentAtomic({ ...input, slipAttachmentId: 'other' }), (e: any) => e.getResponse().code === 'expense_payment_idempotency_conflict');
  });
  for (const patch of [{ mimeType: 'text/plain' }, { byteSize: 10485761 }, { companyId: 'other' }, { branchId: 'other' }, { uploadedByUserId: 'other' }, { status: 'PENDING_UPLOAD' }, { metadataJson: { generatedFor: 'expense.payment.slip', expenseId: 'other' } }]) {
    it(`refuses a slip outside this payment scope: ${JSON.stringify(patch)}`, async () => {
      const h = harness(); h.state.files.push({ ...slip, ...patch });
      await assert.rejects(h.repo.recordPaymentAtomic(paymentInput('100', { slipAttachmentId: slip.id })), (e: any) => e.getResponse().code === 'expense_payment_slip_invalid');
      assert.equal(h.state.payments.length, 0); assert.equal(h.state.links.length, 0);
    });
  }
});

it('W4 distinguishes an explicitly dated payment from an automatic recording timestamp', async () => {
  const dated = harness(); await pay(dated.repo, '40');
  assert.equal(dated.state.payments[0].paidAtConfirmed, true);
  const unknown = harness(); await pay(unknown.repo, '40', { paidAt: undefined });
  assert.equal(unknown.state.payments[0].paidAtConfirmed, false);
  assert.ok(unknown.state.payments[0].paidAt instanceof Date);
  assert.equal(unknown.state.expense.paidAmount, '40.0000');
});
it('W2 persists a selected Bangkok payment day as a local-midnight instant, not the recording time', async () => {
  const h = harness(); await pay(h.repo, '40', { paidAt: '2026-08-10' });
  assert.equal(h.state.payments[0].paidAt.toISOString(), '2026-08-09T17:00:00.000Z');
});
it('W4 seed and default-date voucher writers can supply an operational date without certifying it', async () => {
  const h = harness(); await pay(h.repo, '40', { paidAt: '2026-08-10', paidAtConfirmed: false });
  assert.equal(h.state.payments[0].paidAtConfirmed, false);
});

it('W4 historical dates are trusted except the seed writer that copies the document date', async () => {
  const { historicalExpensePaymentDateConfirmed } = await import('../domain/logic/expense-payment-date.logic');
  for (const key of [null, 'client:human-payment', 'dv:voucher:line', 'substitute-receipt:evidence']) assert.equal(historicalExpensePaymentDateConfirmed(key), true);
  assert.equal(historicalExpensePaymentDateConfirmed('client:seed-payment-expense-rent'), false);
  assert.equal(historicalExpensePaymentDateConfirmed('client:seed-paymentish'), true);
});

it('W4 confirms only an unknown active payment in its tenant and branch, without touching frozen papers or entry history', async () => {
  const original = { id: 'p', companyId: 'co', expenseId: 'e', paidAtConfirmed: false, status: 'RECORDED', paidAt: new Date('2026-10-01'), createdAt: new Date('2026-10-02'), createdByUserId: 'original' };
  const before = { ...original }; let audited = 0;
  const db: any = { attachmentLink: { findMany: async () => [] }, $executeRaw: async () => 1, $queryRaw: async () => [],
    company: { findUnique: async () => ({ timezone: 'Asia/Bangkok' }) },
    expenseRecord: { findFirst: async () => ({ id: 'e', branchId: 'b' }), update: async () => ({}) },
    expensePayment: { updateMany: async ({ where, data }: any) => { assert.equal(where.companyId, 'co'); assert.equal(where.expenseId, 'e'); assert.equal(where.id, 'p'); assert.equal(where.status, 'RECORDED'); assert.equal(where.paidAtConfirmed, false); if (original.paidAtConfirmed) return { count: 0 }; Object.assign(original, data); return { count: 1 }; } },
  };
  db.$transaction = (fn: any) => fn(db);
  const repo = new PrismaExpenseRepository({ client: db } as any);
  const input = { companyId: 'co', expenseId: 'e', paymentId: 'p', paidAt: '2026-09-05', actorUserId: 'actor', scopes: {} };
  await repo.confirmPaymentDateAtomic(input, async () => { audited++; });
  assert.equal(original.paidAt.toISOString(), '2026-09-04T17:00:00.000Z'); assert.equal(original.createdAt, before.createdAt); assert.equal(original.createdByUserId, 'original'); assert.equal(audited, 1);
  await assert.rejects(repo.confirmPaymentDateAtomic(input, async () => {}), (e: any) => e.getResponse().code === 'expense_payment_date_already_confirmed');

});
it('Round 3 payment card revision is rechecked under the existing payment/source locks', async () => {
  const h = harness();
  await assert.rejects(() => h.repo.recordPaymentAtomic(paymentInput('10.00', { expectedUpdatedAt: new Date(0) })), /version_changed/);
  assert.equal(h.state.payments.length, 0);
});
