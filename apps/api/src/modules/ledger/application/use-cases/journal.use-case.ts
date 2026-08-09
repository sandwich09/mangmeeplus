import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaLedgerRepository } from '../../infrastructure/prisma-ledger.repository';
import { AuditService } from '../../../audit/application/audit.service';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import { ReserveDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/reserve-document-number.use-case';
import { CommitDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/commit-document-number.use-case';
import { PrismaAccountingRepository } from '../../../accounting-documents/infrastructure/prisma-accounting.repository';
import { PrismaExpenseRepository } from '../../../expenses/infrastructure/prisma-expense.repository';
import { PrismaProcurementRepository } from '../../../procurement/infrastructure/prisma-procurement.repository';
import { PrismaReimbursementRepository } from '../../../reimbursements/infrastructure/prisma-reimbursement.repository';
import { validateJournalBalance, buildReversalLines } from '../../domain/logic/journal-balance.logic';
import {
  BOUND_EXPENSE_ACCRUAL_EVENTS,
  buildBoundExpenseAccrualLines,
  buildDefaultPostingLines,
  buildTransactionTaxPostingLines,
  derivePeriodKey,
  requiresReviewedPostingRules,
  type ExpenseAccountBindings,
} from '../../domain/logic/posting-engine.logic';
import { buildAccountingPaymentPostingSource, buildDocumentPostingInput } from '../../../accounting-documents/application/use-cases/posting-source.use-case';
import { buildVendorBillPostingSource, buildVendorBillPp36PostingSource } from '../../../procurement/application/use-cases/vendor-bill.use-case';
import { buildPp36InputClaimPostingSource } from '../../../procurement/application/use-cases/pp36-input-claim.use-case';
import { buildSupplierPaymentPp36PostingSource, buildSupplierPaymentPostingSource } from '../../../procurement/application/use-cases/supplier-payment.use-case';
import { PrismaService } from '../../../../common/database/prisma.service';
import type { RequestContext, JournalEntrySummary, JournalEntryDetail, CreateManualJournalInput, LedgerJournalLineInput, LedgerSourcePostingInput } from '@watchdog-bms/contracts';
import type { JournalEntryRecord } from '../../domain/models/ledger.model';
import { LEDGER_SEQUENCE_KEY } from '@watchdog-bms/contracts';
import { Decimal } from 'decimal.js';
import { isBranchInScope } from '../../../data-model-core/domain/logic/branch.logic';
import { civilDateToUtcDate, civilPeriodKey, todayCivilDate } from '@watchdog-bms/contracts';


function requirePerm(ctx: RequestContext, perm: string) {
  if (!ctx.permissions.includes(perm)) throw new ForbiddenException(`Missing permission: ${perm}`);
}

function n(s: string | undefined | null): number { return parseFloat(s ?? '0') || 0; }

function manualJournalLines(lines: CreateManualJournalInput['lines']): LedgerJournalLineInput[] {
  return lines.map(({ accountId, branchId, description, debitAmount, creditAmount, currency }) => ({
    accountId, branchId, description, debitAmount, creditAmount, currency,
  }));
}

async function assertManualJournalInvariants(
  repo: PrismaLedgerRepository,
  ctx: RequestContext,
  lines: Array<{ accountId: string; branchId?: string | null }>,
): Promise<void> {
  await Promise.all(lines.map(async (line) => {
    const account = await repo.findAccountById(line.accountId);
    if (!account || account.status !== 'ACTIVE' || !account.isPosting
      || (account.companyId !== ctx.companyId && !(account.companyId === null && account.isSystem))) {
      throw new BadRequestException({ code: 'manual_journal_account_not_available', message: 'บัญชีไม่พร้อมใช้งานหรืออยู่นอกบริษัท' });
    }
    if (!line.branchId) return;
    if (!isBranchInScope(ctx.scopes, line.branchId)) throw new ForbiddenException('Branch is outside your assigned branch scope.');
    const branch = await repo.findBranchById(line.branchId);
    if (!branch || branch.companyId !== ctx.companyId || branch.status !== 'ACTIVE') {
      throw new BadRequestException({ code: 'manual_journal_branch_not_available', message: 'สาขาไม่พร้อมใช้งานหรืออยู่นอกบริษัท' });
    }
  }));
}

function hasCallerOwnedManualMetadata(line: {
  sourceType?: string | null; sourceId?: string | null; taxCode?: string | null;
  taxSnapshot?: unknown; taxComponentKey?: unknown; reportContributions?: unknown[];
}): boolean {
  return [line.sourceType, line.sourceId, line.taxCode, line.taxSnapshot, line.taxComponentKey, line.reportContributions]
    .some((value) => value !== null && value !== undefined);
}

/**
 * Reviewed payable accounts for `TH_SME_COA_V1` (owner decision 2026-08-09, audit CR-2). The
 * template has no dedicated เจ้าหนี้พนักงาน, so employee reimbursement accrues to the generic
 * accrued-expense account rather than being merged into trade AP.
 */
const REVIEWED_PAYABLE_CODES = { accountsPayableCode: '2120-01', employeePayableCode: '2131-09' } as const;

/** Human-readable Thai message per stable binding-gap code. */
function postingBindingMessage(code: string): string {
  if (code.startsWith('expense_account_unmapped')) {
    return 'ยังไม่ได้กำหนดบัญชีแยกประเภทให้หมวดค่าใช้จ่ายนี้ กรุณากำหนดบัญชีของหมวดก่อน';
  }
  if (code === 'wht_account_unmapped') {
    return 'ยังไม่รองรับการลงบัญชีเอกสารที่มีภาษีหัก ณ ที่จ่าย เพราะบัญชีภาษีหัก ณ ที่จ่ายแยกตามแบบยื่น (ภ.ง.ด.3/53)';
  }
  if (code === 'expense_allocation_base_zero') return 'ยอดตามรายการเป็นศูนย์ จึงปันส่วนค่าใช้จ่ายเข้าบัญชีไม่ได้';
  return 'บริษัทที่ใช้ผังบัญชีมาตรฐานต้องกำหนดและอนุมัติกฎการลงบัญชีก่อนบันทึกอัตโนมัติ';
}

function normalizeExpenseVatForLedger(source: LedgerSourcePostingInput, evidence: any): LedgerSourcePostingInput {
  const claimable = evidence.inputVatClaimStatus === 'CLAIMABLE' && evidence.taxEvidenceStatus === 'USABLE_FOR_TAX';
  return {
    ...source,
    taxTotal: claimable ? source.taxTotal : '0',
    lines: source.lines.map((line) => ({ ...line, vatAmount: claimable ? line.vatAmount : '0' })),
  };
}

export function asLedgerSource(input: LedgerSourcePostingInput | any): LedgerSourcePostingInput {
  if (input.totalAmount && input.sourceDate && input.periodKey) {
    return input.sourceType === 'expense.record' ? normalizeExpenseVatForLedger(input, input) : input;
  }
  if (input.sourceType === 'accounting_document' || input.documentId) {
    const date = input.documentDate ?? input.sourceDate;
    const documentType = input.documentType as string | undefined;
    const event = input.sourceEventType === 'voided'
      ? 'accounting.document.voided'
      : documentType === 'RECEIPT'
        ? 'accounting.payment.received'
        : documentType === 'CREDIT_NOTE'
          ? 'accounting.credit_note.issued'
          : documentType === 'DEBIT_NOTE'
            ? 'accounting.debit_note.issued'
        : documentType === 'BILLING_NOTE'
          ? 'accounting.billing_note.issued'
          : 'accounting.invoice.issued';
    return ({
      companyId: input.companyId,
      branchId: input.branchId,
      sourceType: 'accounting.document',
      sourceId: input.sourceId ?? input.documentId,
      sourceEventType: event,
      idempotencyKey: input.idempotencyKey,
      documentNumber: input.documentNumber,
      sourceDate: date,
      periodKey: derivePeriodKey(date),
      currency: input.currency,
      counterpartyId: input.counterpartyId,
      totalAmount: input.grandTotalAmount,
      taxTotal: input.vatAmount,
      whtTotal: input.whtAmount,
      paidAmount: input.paidAmount,
      lines: (input.lines ?? []).map((line: any) => ({
        sourceLineId: line.id ?? String(line.lineNumber),
        description: line.description,
        quantity: line.quantity,
        netAmount: line.taxableAmount ?? line.lineSubtotalAmount ?? line.lineTotalAmount,
        vatAmount: line.vatAmount,
        whtAmount: line.whtAmount,
        categoryKey: line.revenueCategory ?? line.taxCategory,
        taxSnapshot: line.taxSnapshot,
        taxComponents: line.taxComponents,
      })),
      legacyOutputTaxCode: input.outputTaxCode,
    } as LedgerSourcePostingInput & { legacyOutputTaxCode?: string });
  }
  if (input.sourceType === 'expense.record' || input.expenseNumber !== undefined) {
    const date = input.expenseDate ?? input.sourceDate;
    return normalizeExpenseVatForLedger({
      companyId: input.companyId,
      branchId: input.branchId ?? undefined,
      sourceType: 'expense.record',
      sourceId: input.sourceId,
      // GAP-02: a confirmed expense materialized from a reimbursement claim posts
      // to the employee payable (2130-01) via the dedicated claim event; voids/
      // payments keep their existing routing.
      sourceEventType: input.sourceEventType === 'voided' ? 'expense.voided'
        : input.sourceEventType === 'paid' ? 'expense.payment'
        : input.sourceReimbursementRequestId ? 'expense.claim.confirmed'
        : 'expense.confirmed',
      idempotencyKey: input.idempotencyKey,
      documentNumber: input.expenseNumber ?? undefined,
      sourceDate: date,
      periodKey: derivePeriodKey(date),
      currency: input.currency,
      counterpartyId: input.vendorCounterpartyId ?? undefined,
      totalAmount: input.grandTotalAmount,
      taxTotal: input.vatAmount,
      whtTotal: input.whtAmount,
      paidAmount: input.paidAmount,
      lines: (input.lines ?? []).map((line: any) => ({
        sourceLineId: line.id ?? String(line.lineNumber),
        description: line.description,
        quantity: line.quantity,
        netAmount: line.taxableAmount ?? line.lineSubtotalAmount ?? line.lineTotalAmount,
        vatAmount: line.vatAmount,
        whtAmount: line.whtAmount,
        categoryKey: line.accountHintKey ?? line.taxCategory,
        // Falls back to the record-level category so a single-category expense whose lines carry no
        // category of their own still resolves a reviewed account instead of reporting no_category.
        expenseCategoryId: line.expenseCategoryId ?? input.expenseCategoryId ?? undefined,
        taxSnapshot: line.taxSnapshot,
        taxComponents: line.taxComponents,
      })),
    }, input);
  }
  return input;
}

function toSummary(r: JournalEntryRecord): JournalEntrySummary {
  const lines = r.lines ?? [];
  const totalDebit  = lines.reduce((a, l) => a + n(l.debitAmount),  0);
  const totalCredit = lines.reduce((a, l) => a + n(l.creditAmount), 0);
  return {
    id: r.id, companyId: r.companyId, periodId: r.periodId, periodKey: null,
    entryNumber: r.entryNumber, entryType: r.entryType, sourceType: r.sourceType,
    sourceId: r.sourceId, reversalOfJournalEntryId: r.reversalOfJournalEntryId,
    status: r.status, entryDate: r.entryDate.toISOString(), postedAt: r.postedAt?.toISOString() ?? null,
    memo: r.memo, totalDebit: totalDebit.toFixed(4), totalCredit: totalCredit.toFixed(4),
    createdAt: r.createdAt.toISOString(),
  };
}

@Injectable()
export class ListJournalsUseCase {
  constructor(private readonly repo: PrismaLedgerRepository) {}

  async execute(ctx: RequestContext, filters?: { periodId?: string; status?: string; sourceType?: string; sourceId?: string; page?: number; pageSize?: number }): Promise<{ data: JournalEntrySummary[]; total: number }> {
    requirePerm(ctx, 'ledger.journal.read');
    const result = await this.repo.listJournals(ctx.companyId, filters, ctx.scopes.branchIds);
    return { data: result.data.map(toSummary), total: result.total };
  }
}

@Injectable()
export class GetJournalUseCase {
  constructor(private readonly repo: PrismaLedgerRepository) {}

  async execute(ctx: RequestContext, journalId: string): Promise<JournalEntryDetail> {
    requirePerm(ctx, 'ledger.journal.read');
    const r = await this.repo.findJournalById(ctx.companyId, journalId, ctx.scopes.branchIds);
    if (!r) throw new NotFoundException('Journal entry not found');
    const s = toSummary(r);
    return {
      ...s,
      lines: (r.lines ?? []).map((l) => ({
        id: l.id, accountId: l.accountId, accountCode: null, accountNameTh: null,
        branchId: l.branchId, lineNumber: l.lineNumber, description: l.description,
        debitAmount: l.debitAmount, creditAmount: l.creditAmount, currency: l.currency,
        taxCode: l.taxCode, sourceType: l.sourceType, sourceId: l.sourceId,
        taxSnapshot: l.taxSnapshot, taxComponentKey: l.taxComponentKey,
      })),
    };
  }
}

@Injectable()
export class CreateManualJournalUseCase {
  constructor(
    private readonly repo: PrismaLedgerRepository,
    private readonly audit: AuditService,
    private readonly reserve: ReserveDocumentNumberUseCase,
    private readonly commit: CommitDocumentNumberUseCase,
  ) {}

  async execute(ctx: RequestContext, input: CreateManualJournalInput): Promise<JournalEntrySummary> {
    requirePerm(ctx, 'journal.entry.create');
    const lines = manualJournalLines(input.lines);
    await assertManualJournalInvariants(this.repo, ctx, lines);
    const bal = validateJournalBalance(lines);
    if (!bal.isBalanced) throw new BadRequestException({ message: 'Journal unbalanced', errors: bal.errors, totalDebit: bal.totalDebit, totalCredit: bal.totalCredit });

    const periodKey = input.entryDate.slice(0, 7); // YYYY-MM
    let period = await this.repo.findPeriod(ctx.companyId, periodKey);
    if (!period) {
      const d = new Date(input.entryDate);
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end   = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      period = await this.repo.upsertPeriod(ctx.companyId, periodKey, start, end);
    }
    if (period.status === 'CLOSED') throw new BadRequestException({ code: 'period_closed', periodKey, message: 'งวดบัญชีถูกปิดแล้ว' });

    const reserved = await this.reserve.execute({ companyId: ctx.companyId, documentType: LEDGER_SEQUENCE_KEY, periodKey, idempotencyKey: `manual:${ctx.userId}:${Date.now()}`, reservedByUserId: ctx.userId });
    const entry = await this.repo.createJournalEntry({ companyId: ctx.companyId, periodId: period.id, entryNumber: reserved.documentNumber, entryType: 'MANUAL', entryDate: new Date(input.entryDate), memo: input.memo, createdByUserId: ctx.userId, lines });
    await this.commit.execute({ id: reserved.id, companyId: ctx.companyId });

    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'ledger.journal.create', targetType: 'journal_entry', targetId: entry.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { entryNumber: entry.entryNumber, totalDebit: bal.totalDebit } });
    return toSummary(entry);
  }
}

@Injectable()
export class PostJournalUseCase {
  constructor(
    private readonly repo: PrismaLedgerRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
  ) {}

  async execute(ctx: RequestContext, journalId: string): Promise<JournalEntrySummary> {
    requirePerm(ctx, 'journal.entry.post');
    const entry = await this.repo.findJournalById(ctx.companyId, journalId, ctx.scopes.branchIds);
    if (!entry) throw new NotFoundException('Journal entry not found');
    if (entry.status !== 'DRAFT') throw new BadRequestException('Only DRAFT journals can be posted');

    const period = await this.repo.findPeriodById(ctx.companyId, entry.periodId);
    if (!period) throw new NotFoundException('Accounting period not found');
    if (period.status === 'CLOSED') throw new BadRequestException({ code: 'period_closed', message: 'งวดบัญชีถูกปิดแล้ว' });

    const lines = await this.repo.getJournalLines(ctx.companyId, journalId, ctx.scopes.branchIds);
    if (entry.entryType === 'MANUAL') {
      if (lines.some(hasCallerOwnedManualMetadata)) throw new BadRequestException({ code: 'manual_journal_provenance_forbidden', message: 'Manual journal provenance and tax metadata are server-owned' });
      await assertManualJournalInvariants(this.repo, ctx, lines);
    }
    const bal = validateJournalBalance(lines.map((l) => ({ accountId: l.accountId, debitAmount: l.debitAmount, creditAmount: l.creditAmount })));
    if (!bal.isBalanced) throw new BadRequestException({ message: 'Journal unbalanced', errors: bal.errors });

    const posted = await this.repo.postJournalEntry(journalId, ctx.userId);

    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'ledger.journal.post', targetType: 'journal_entry', targetId: journalId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { entryNumber: entry.entryNumber, totalDebit: bal.totalDebit, totalCredit: bal.totalCredit } });
    void this.outbox.append('journal.posted', 'journal_entry', journalId, { companyId: ctx.companyId, aggregateType: 'journal_entry', aggregateId: journalId, occurredAt: new Date().toISOString(), data: { entryNumber: entry.entryNumber, periodId: entry.periodId, sourceType: entry.sourceType, sourceId: entry.sourceId, totalDebit: bal.totalDebit } });
    return toSummary(posted);
  }
}

@Injectable()
export class ReverseJournalUseCase {
  constructor(
    private readonly repo: PrismaLedgerRepository,
    private readonly audit: AuditService,
    private readonly reserve: ReserveDocumentNumberUseCase,
    private readonly commit: CommitDocumentNumberUseCase,
    private readonly outbox: OutboxAppendService,
  ) {}

  async execute(ctx: RequestContext, journalId: string, memo?: string): Promise<JournalEntrySummary> {
    requirePerm(ctx, 'journal.entry.reverse');
    const entry = await this.repo.findJournalById(ctx.companyId, journalId, ctx.scopes.branchIds);
    if (!entry) throw new NotFoundException('Journal entry not found');
    if (entry.status !== 'POSTED') throw new BadRequestException('Only POSTED journals can be reversed');
    // The original stays POSTED after reversal (reports count POSTED entries
    // only, so original + reversal net to zero — same convention as the H-04
    // void flow). The linked REVERSAL row is the "already reversed" marker.
    const priorReversal = await this.repo.findReversalOfJournal(ctx.companyId, journalId);
    if (priorReversal) throw new BadRequestException({ code: 'journal_already_reversed', message: 'Journal has already been reversed', reversalEntryId: priorReversal.id });

    const period = await this.repo.findPeriodById(ctx.companyId, entry.periodId);
    if (!period) throw new NotFoundException('Accounting period not found');
    if (period.status === 'CLOSED') throw new BadRequestException({ code: 'period_closed', message: 'งวดบัญชีถูกปิดแล้ว' });

    const lines = await this.repo.getJournalLines(ctx.companyId, journalId, ctx.scopes.branchIds);
    const reversalLines = buildReversalLines(lines.map((l) => ({ accountId: l.accountId, debitAmount: l.debitAmount, creditAmount: l.creditAmount, branchId: l.branchId, description: l.description, currency: l.currency, taxCode: l.taxCode })));

    const revPeriodKey = civilPeriodKey(todayCivilDate());
    const reserved = await this.reserve.execute({ companyId: ctx.companyId, documentType: LEDGER_SEQUENCE_KEY, periodKey: revPeriodKey, idempotencyKey: `reversal:${journalId}:${Date.now()}`, reservedByUserId: ctx.userId });
    const reversal = await this.repo.createJournalEntry({ companyId: ctx.companyId, periodId: entry.periodId, entryNumber: reserved.documentNumber, entryType: 'REVERSAL', sourceType: entry.sourceType ?? undefined, sourceId: entry.sourceId ?? undefined, reversalOfJournalEntryId: journalId, entryDate: civilDateToUtcDate(todayCivilDate()), memo: memo ?? `[กลับรายการ] ${entry.entryNumber}`, createdByUserId: ctx.userId, lines: reversalLines });
    await this.repo.postJournalEntry(reversal.id, ctx.userId);
    await this.commit.execute({ id: reserved.id, companyId: ctx.companyId });

    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'ledger.journal.reverse', targetType: 'journal_entry', targetId: journalId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'CRITICAL', metadataJson: { reversalEntryId: reversal.id, reversalNumber: reversal.entryNumber } });
    void this.outbox.append('journal.reversed', 'journal_entry', reversal.id, { companyId: ctx.companyId, aggregateType: 'journal_entry', aggregateId: reversal.id, occurredAt: new Date().toISOString(), data: { originalEntryId: journalId, reversalEntryId: reversal.id } });
    return toSummary(reversal);
  }
}

/**
 * What POST /posting/generate really needs. canonicalSource rebuilds the whole
 * posting input from the database for every recognized sourceType and throws
 * `unsupported_posting_source` for anything else, so nothing beyond these three
 * fields is ever read; the rest stays optional only so in-process callers can keep
 * handing over a complete LedgerSourcePostingInput.
 */
export type PostingSourceRef = Pick<LedgerSourcePostingInput, 'sourceType' | 'sourceId'> & Partial<LedgerSourcePostingInput>;

@Injectable()
export class GenerateJournalFromSourceUseCase {
  constructor(
    private readonly repo: PrismaLedgerRepository,
    private readonly audit: AuditService,
    private readonly reserve: ReserveDocumentNumberUseCase,
    private readonly commit: CommitDocumentNumberUseCase,
    private readonly outbox: OutboxAppendService,
    private readonly accountingRepo: PrismaAccountingRepository,
    private readonly expenseRepo: PrismaExpenseRepository,
    private readonly procurementRepo: PrismaProcurementRepository,
    private readonly reimbursementRepo: PrismaReimbursementRepository,
    private readonly prisma: PrismaService,
  ) {}

  private async markSource(ctx: RequestContext, source: LedgerSourcePostingInput, status: 'pending' | 'posted' | 'posting_error' | 'reversed', entry?: JournalEntryRecord, error?: string): Promise<void> {
    if (source.sourceType === 'accounting.document') {
      await this.accountingRepo.updateDocumentPostingStatus(ctx.companyId, source.sourceId, { postingStatus: status, journalEntryId: entry?.id ?? null, postingError: error ?? null });
    } else if (source.sourceType === 'accounting.payment') {
      await this.accountingRepo.updatePaymentPostingStatus(ctx.companyId, source.sourceId, { postingStatus: status, journalEntryId: entry?.id ?? null });
    } else if (source.sourceType === 'procurement.supplier_payment') {
      await this.procurementRepo.updateSupplierPaymentPostingStatus(ctx.companyId, source.sourceId, { postingStatus: status, journalEntryId: entry?.id ?? null });
    } else if (source.sourceType === 'expense.record' || source.sourceType === 'expense.payment') {
      // GAP-07: the settlement leg flips the same expense posting flag the accrual
      // uses — pending (set by RecordExpensePayment) → posted / posting_error.
      await this.expenseRepo.updatePostingStatus(ctx.companyId, source.sourceId, { postingStatus: status, journalEntryId: entry?.id ?? null, postingError: error ?? null });
    } else if (source.sourceType === 'reimbursement.payment') {
      // GAP-02: settlement payment is a real posting source now — flip it to
      // 'posted' on success like every other generate source. It carries no
      // journalEntryId/postingError columns, so only the status is written.
      await this.reimbursementRepo.updatePaymentPostingStatus(ctx.companyId, source.sourceId, { postingStatus: status });
    } else if (source.sourceType === 'procurement.vendor_bill.commercial'
      || (source.sourceType === 'procurement.vendor_bill' && source.sourceEventType !== 'procurement.vendor_bill.pp36_payment')) {
      await this.procurementRepo.updateVendorBillPostingStatus(ctx.companyId, source.sourceId, { postingStatus: status, journalEntryId: entry?.id ?? null, postingError: error ?? null });
    }
  }

  private async canonicalSource(ctx: RequestContext, raw: PostingSourceRef): Promise<LedgerSourcePostingInput> {
    if (raw.sourceType === 'accounting.document' || raw.sourceType === 'accounting_document') {
      const document = await this.accountingRepo.findDocumentById(ctx.companyId, raw.sourceId);
      if (!document) throw new NotFoundException('Accounting source document not found');
      return asLedgerSource(buildDocumentPostingInput(document));
    }
    if (raw.sourceType === 'accounting.payment') {
      const payment = await this.accountingRepo.findPaymentById(ctx.companyId, raw.sourceId);
      if (!payment) throw new NotFoundException('Accounting payment source not found');
      return buildAccountingPaymentPostingSource(payment);
    }
    if (raw.sourceType === 'expense.record') {
      const expense = await this.expenseRepo.findByIdWithRelations(ctx.companyId, raw.sourceId);
      if (!expense) throw new NotFoundException('Expense source not found');
      if (expense.status !== 'CONFIRMED' && expense.status !== 'VOIDED') {
        throw new BadRequestException({ code: 'expense_not_confirmed', message: 'Only a confirmed expense can generate a journal' });
      }
      return asLedgerSource({ ...expense, sourceType: 'expense.record', sourceId: expense.id,
        sourceEventType: expense.status === 'VOIDED' ? 'voided' : 'confirmed',
        idempotencyKey: `expense:${expense.status}:${expense.id}` } as any);
    }
    if (raw.sourceType === 'expense.payment') {
      // GAP-07: settlement of a plain (non-claim) expense — Dr 2120-01 trade AP /
      // Cr 1110-01 cash. Expenses carry no payment rows, so paidAmount on the
      // record is the single full settlement: one journal per expense id.
      const expense = await this.expenseRepo.findByIdWithRelations(ctx.companyId, raw.sourceId);
      if (!expense) throw new NotFoundException('Expense source not found');
      if (expense.status !== 'CONFIRMED') throw new BadRequestException({ code: 'expense_not_confirmed', message: 'Only a confirmed expense can post its settlement' });
      // Claim-born expenses settle through reimbursement.payment (Dr 2130-01), not here.
      if ((expense as any).sourceReimbursementRequestId != null) throw new BadRequestException({ code: 'claim_expense_settles_via_reimbursement', message: 'A claim-born expense settles through reimbursement.payment, not expense.payment' });
      // Full settlement only — partial-payment posting is a documented limitation.
      if (expense.paymentStatus !== 'PAID') throw new BadRequestException({ code: 'expense_payment_not_settled', message: 'Only a fully paid expense can post its settlement; partial payments are not yet supported' });
      const paidAt = (expense as any).paidAt as Date | null;
      const sourceDate = (paidAt ?? expense.expenseDate).toISOString();
      return {
        companyId: expense.companyId,
        branchId: expense.branchId ?? undefined,
        sourceType: 'expense.payment',
        sourceId: expense.id,
        sourceEventType: 'expense.payment',
        idempotencyKey: `expense.payment:${expense.status}:${expense.id}`,
        documentNumber: expense.expenseNumber ?? undefined,
        sourceDate,
        periodKey: derivePeriodKey(sourceDate),
        currency: expense.currency,
        counterpartyId: expense.vendorCounterpartyId ?? undefined,
        totalAmount: expense.paidAmount,
        lines: [],
      } as LedgerSourcePostingInput;
    }
    if (raw.sourceType === 'reimbursement.payment') {
      // GAP-02: settlement of a reimbursement claim — Dr employee payable / Cr cash.
      const payment = await this.reimbursementRepo.findPaymentById(ctx.companyId, raw.sourceId);
      if (!payment) throw new NotFoundException('Reimbursement payment source not found');
      if (payment.status !== 'RECORDED') throw new BadRequestException({ code: 'reimbursement_payment_not_recorded', message: 'Only a recorded reimbursement payment can be posted' });
      const settlement = await this.reimbursementRepo.assertSettlementPostingReady(ctx.companyId, payment.id);
      const sourceDate = payment.paidAt.toISOString();
      return {
        companyId: payment.companyId,
        branchId: settlement.branchId,
        sourceType: 'reimbursement.payment',
        sourceId: payment.id,
        sourceEventType: 'reimbursement.payment',
        idempotencyKey: `reimbursement.payment:${payment.status}:${payment.id}`,
        documentNumber: payment.paymentNo ?? undefined,
        sourceDate,
        periodKey: derivePeriodKey(sourceDate),
        currency: payment.currency,
        totalAmount: payment.paidAmount,
        lines: [],
      } as LedgerSourcePostingInput;
    }
    if (raw.sourceType === 'procurement.vendor_bill.commercial') {
      const bill = await this.procurementRepo.findVendorBillById(ctx.companyId, raw.sourceId);
      if (!bill) throw new NotFoundException('Vendor bill source not found');
      const source = buildVendorBillPostingSource(bill);
      if (source.sourceType !== 'procurement.vendor_bill.commercial') throw new BadRequestException('Commercial posting identity is reserved for PP36 vendor bills');
      return source;
    }
    if (raw.sourceType === 'procurement.vendor_bill') {
      const bill = await this.procurementRepo.findVendorBillById(ctx.companyId, raw.sourceId);
      if (!bill) throw new NotFoundException('Vendor bill source not found');
      return raw.sourceEventType === 'procurement.vendor_bill.pp36_payment'
        ? buildVendorBillPp36PostingSource(bill)
        : buildVendorBillPostingSource(bill);
    }
    if (raw.sourceType === 'tax.pp36_input_claim') {
      const adjustment = await (this.prisma.client as any).taxAdjustment.findFirst({ where: { id: raw.sourceId, companyId: ctx.companyId } });
      if (!adjustment) throw new NotFoundException('PP36 input claim release not found');
      return buildPp36InputClaimPostingSource(adjustment);
    }
    if (raw.sourceType === 'procurement.supplier_payment') {
      const payment = await this.procurementRepo.findSupplierPaymentById(ctx.companyId, raw.sourceId);
      if (!payment) throw new NotFoundException('Supplier payment source not found');
      return buildSupplierPaymentPostingSource(payment);
    }
    if (raw.sourceType === 'procurement.supplier_payment.pp36') {
      const payment = await this.procurementRepo.findSupplierPaymentById(ctx.companyId, raw.sourceId);
      if (!payment) throw new NotFoundException('Supplier payment PP36 source not found');
      return buildSupplierPaymentPp36PostingSource(payment);
    }
    throw new BadRequestException({ code: 'unsupported_posting_source', message: 'Journal generation accepts only a recognized server-owned source. Use the manual-journal flow for manual entries.' });
  }

  /**
   * Reviewed account bindings for this company's expense categories. Only the categories the source
   * actually references are loaded, so an unrelated unmapped category never blocks a posting.
   */
  private async loadExpenseAccountBindings(
    companyId: string,
    source: LedgerSourcePostingInput,
  ): Promise<ExpenseAccountBindings> {
    const categoryIds = [...new Set(source.lines.map((line) => line.expenseCategoryId).filter(Boolean))] as string[];
    const rows = categoryIds.length
      ? await this.prisma.client.expenseCategory.findMany({
        where: { id: { in: categoryIds }, companyId, ledgerAccountCode: { not: null } },
        select: { id: true, ledgerAccountCode: true },
      })
      : [];
    return {
      ...REVIEWED_PAYABLE_CODES,
      expenseByCategoryId: new Map(rows.map((row) => [row.id, row.ledgerAccountCode!])),
    };
  }

  async execute(ctx: RequestContext, rawSource: PostingSourceRef): Promise<JournalEntrySummary> {
    requirePerm(ctx, 'journal.entry.post');
    const source = await this.canonicalSource(ctx, rawSource);
    if (source.companyId !== ctx.companyId) throw new BadRequestException({ code: 'company_mismatch', message: 'Posting source company does not match request company' });
    if (source.branchId && ctx.scopes?.branchIds && !ctx.scopes.branchIds.includes(source.branchId)) throw new ForbiddenException('Branch is outside your assigned branch scope.');
    const company = await this.prisma.client.company.findUnique({
      where: { id: ctx.companyId },
      select: {
        baseCurrency: true,
        chartOfAccountsTemplateKey: true,
        chartOfAccountsTemplateVersion: true,
        chartOfAccountsTemplateChecksum: true,
        chartOfAccountsTemplateAppliedAt: true,
      },
    });
    if (!company) throw new NotFoundException('Company not found');
    const baseCurrency = company.baseCurrency.toUpperCase();
    const taxSnapshots = source.lines.flatMap((line) => line.taxComponents?.map((component) => component.snapshot) ?? (line.taxSnapshot ? [line.taxSnapshot] : []));
    if (taxSnapshots.some((snapshot) => snapshot.taxCurrency.toUpperCase() !== baseCurrency)) {
      throw new BadRequestException({ code: 'tax_functional_currency_mismatch', message: 'Tax snapshot currency must match the company functional currency' });
    }
    const commercialSource = ['accounting.document', 'expense.record', 'procurement.vendor_bill', 'procurement.vendor_bill.commercial'].includes(source.sourceType)
      && source.sourceEventType !== 'procurement.vendor_bill.pp36_payment';
    if (commercialSource && source.currency.toUpperCase() !== baseCurrency && taxSnapshots.length === 0) {
      throw new BadRequestException({ code: 'functional_currency_fx_required', message: 'Foreign-currency commercial posting requires a verified immutable FX snapshot' });
    }

    // Idempotency: return existing generated journal
    const existing = await this.repo.findGeneratedJournal(ctx.companyId, source.sourceType, source.sourceId);
    if (existing) {
      await this.markSource(ctx, source, 'posted', existing);
      return toSummary(existing);
    }

    const periodKey = source.periodKey;
    let period = await this.repo.findPeriod(ctx.companyId, periodKey);
    if (!period) {
      const [y, m] = periodKey.split('-').map(Number) as [number, number];
      const start = new Date(Date.UTC(y, m - 1, 1));
      const end   = new Date(Date.UTC(y, m, 0));
      period = await this.repo.upsertPeriod(ctx.companyId, periodKey, start, end);
    }
    if (period.status === 'CLOSED') throw new BadRequestException({ code: 'period_closed', periodKey, message: 'งวดบัญชีถูกปิดแล้ว ไม่สามารถบันทึกรายการได้' });
    await this.markSource(ctx, source, 'pending');

    // Try rule then default
    const reviewedRulesRequired = requiresReviewedPostingRules(company);
    const rule = await this.repo.findActivePostingRule(
      ctx.companyId,
      source.sourceType,
      source.sourceEventType,
      reviewedRulesRequired,
    );
    // Audit CR-2: a governed company has no PostingRule and must not fall back to
    // DEFAULT_ACCOUNT_CODES — those predate TH_SME_COA_V1 and would book every expense to เงินเดือน.
    // Expense accrual instead resolves the reviewed per-category bindings; every other event type
    // still has no reviewed mapping and keeps failing closed with the actionable code.
    let boundLines: LedgerJournalLineInput[] | null = null;
    if (!rule && reviewedRulesRequired) {
      const bindable = (BOUND_EXPENSE_ACCRUAL_EVENTS as readonly string[]).includes(source.sourceEventType);
      const bound = bindable
        ? buildBoundExpenseAccrualLines(source, await this.loadExpenseAccountBindings(ctx.companyId, source))
        : { error: 'posting_rule_missing' as const };
      if ('error' in bound) {
        await this.markSource(ctx, source, 'posting_error', undefined, bound.error);
        await this.audit.log({
          companyId: ctx.companyId,
          actorUserId: ctx.userId,
          action: 'ledger.journal.generate',
          targetType: 'journal_entry',
          targetId: source.sourceId,
          requestId: ctx.requestId,
          result: 'FAILED',
          riskLevel: 'HIGH',
          metadataJson: {
            sourceType: source.sourceType,
            sourceId: source.sourceId,
            error: bound.error,
            chartTemplateKey: company.chartOfAccountsTemplateKey,
          },
        });
        throw new BadRequestException({
          code: bound.error,
          sourceType: source.sourceType,
          eventType: source.sourceEventType,
          message: postingBindingMessage(bound.error),
        });
      }
      boundLines = bound.lines;
    }
    let baseLines = boundLines ?? (rule ? null : buildDefaultPostingLines({ ...source, taxTotal: '0' }));
    if (rule) {
      const { resolvePostingLinesFromRule } = await import('../../domain/logic/posting-engine.logic.js');
      baseLines = resolvePostingLinesFromRule(source, rule.mappingJson);
    }
    const transactionTax = buildTransactionTaxPostingLines(source, baseLines);
    if (transactionTax.error) {
      await this.markSource(ctx, source, 'posting_error', undefined, transactionTax.error);
      throw new BadRequestException({ code: transactionTax.error, message: 'Transaction-tax snapshot or account determination is incomplete' });
    }
    const legacyCode = (source as LedgerSourcePostingInput & { legacyOutputTaxCode?: string }).legacyOutputTaxCode;
    const legacySnapshots = source.lines.map((line) => line.taxSnapshot).filter(Boolean);
    const reviewedLegacyOutput = source.sourceType === 'accounting.document' && legacySnapshots.length > 0
      && legacySnapshots.every((snapshot) => ['O7', 'OX'].includes(snapshot!.externalTaxCode ?? '')
        && snapshot!.taxDirection === 'OUTPUT' && snapshot!.evidenceStatus === 'VERIFIED');
    if (!transactionTax.handled && (legacyCode === 'O0' || legacySnapshots.some((snapshot) => snapshot?.externalTaxCode === 'O0'))) {
      await this.markSource(ctx, source, 'posting_error', undefined, 'legacy_o0_tax_review_required');
      throw new BadRequestException({ code: 'legacy_o0_tax_review_required', message: 'O0 requires an explicit zero-rated context and reviewed Tax Code definition' });
    }
    if (!transactionTax.handled && new Decimal(source.taxTotal ?? 0).abs().gt('0.0001') && !reviewedLegacyOutput) {
      await this.markSource(ctx, source, 'posting_error', undefined, 'legacy_tax_snapshot_review_required');
      throw new BadRequestException({ code: 'legacy_tax_snapshot_review_required', message: 'Legacy VAT requires reviewed Item 11B Tax Code snapshots before posting' });
    }
    let lines = transactionTax.handled ? transactionTax.lines ?? null
      : reviewedLegacyOutput ? buildDefaultPostingLines(source)
        : baseLines;
    if (!lines) {
      await this.markSource(ctx, source, 'posting_error', undefined, 'posting_rule_missing');
      await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'ledger.journal.generate', targetType: 'journal_entry', targetId: source.sourceId, requestId: ctx.requestId, result: 'FAILED', riskLevel: 'HIGH', metadataJson: { sourceType: source.sourceType, sourceId: source.sourceId, error: 'posting_rule_missing' } });
      throw new BadRequestException({ code: 'posting_rule_missing', sourceType: source.sourceType, eventType: source.sourceEventType, message: 'ไม่พบกฎการลงบัญชีสำหรับเอกสารนี้ กรุณาติดต่อผู้ดูแลระบบเพื่อกำหนดกฎการลงบัญชี' });
    }

    // Resolve account ids from codes
    const resolvedLines = await Promise.all(
      lines.map(async (l) => {
        if (l.accountId?.includes('-')) {
          const acc = await this.repo.findAccountByCode(ctx.companyId, l.accountId);
          if (!acc) {
            await this.markSource(ctx, source, 'posting_error', undefined, `account_not_found:${l.accountId}`);
            throw new BadRequestException({ code: 'posting_rule_missing', message: `ไม่พบรหัสบัญชี ${l.accountId} - กรุณาตั้งค่าผังบัญชี` });
          }
          return { ...l, accountId: acc.id };
        }
        const account = await this.repo.findAccountById(l.accountId);
        if (!account || account.status !== 'ACTIVE' || !account.isPosting
          || (account.companyId !== ctx.companyId && !(account.companyId === null && account.isSystem))) {
          await this.markSource(ctx, source, 'posting_error', undefined, `account_not_available:${l.accountId}`);
          throw new BadRequestException({ code: 'posting_rule_missing', message: `บัญชี ${l.accountId} ไม่พร้อมใช้งานหรืออยู่นอกบริษัท` });
        }
        return l;
      })
    );

    const bal = validateJournalBalance(resolvedLines);
    if (!bal.isBalanced) {
      await this.markSource(ctx, source, 'posting_error', undefined, 'posting_unbalanced');
      throw new BadRequestException({ code: 'posting_unbalanced', errors: bal.errors });
    }

    const reserved = await this.reserve.execute({ companyId: ctx.companyId, documentType: LEDGER_SEQUENCE_KEY, periodKey, idempotencyKey: `gen:${source.sourceType}:${source.sourceId}`, reservedByUserId: ctx.userId });
    const entry = await this.repo.createJournalEntry({ companyId: ctx.companyId, periodId: period.id, entryNumber: reserved.documentNumber, entryType: 'GENERATED', sourceType: source.sourceType, sourceId: source.sourceId, entryDate: new Date(source.sourceDate), memo: source.documentNumber ?? source.sourceId, createdByUserId: ctx.userId, lines: resolvedLines });
    await this.repo.postJournalEntry(entry.id, ctx.userId);
    await this.commit.execute({ id: reserved.id, companyId: ctx.companyId });
    await this.markSource(ctx, source, 'posted', entry);

    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'ledger.journal.generate', targetType: 'journal_entry', targetId: entry.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { sourceType: source.sourceType, sourceId: source.sourceId, entryNumber: entry.entryNumber, totalDebit: bal.totalDebit } });
    void this.outbox.append('journal.generated', 'journal_entry', entry.id, { companyId: ctx.companyId, aggregateType: 'journal_entry', aggregateId: entry.id, occurredAt: new Date().toISOString(), data: { sourceType: source.sourceType, sourceId: source.sourceId, entryNumber: entry.entryNumber, periodKey } });
    return toSummary(entry);
  }
}
