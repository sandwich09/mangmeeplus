import { lockExpenseCorrection } from '../../expenses/infrastructure/expense-void-blocker';
import { EXPENSE_CORRECTION_WORDS } from '@watchdog-bms/contracts';
import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import type { Prisma } from '../../../generated/prisma/client';
import { resolveTransactionBranchId } from '../../data-model-core/application/services/transaction-branch';
import type { AccountRecord, PeriodRecord, JournalEntryRecord, JournalLineRecord, CreateJournalEntryInput } from '../domain/models/ledger.model';
import type { LedgerJournalLineInput, UpdateChartOfAccountInput } from '@watchdog-bms/contracts';
import { branchScopeWhere } from '../../data-model-core/domain/logic/branch.logic';
import { selectPostingRuleCandidate } from '../domain/logic/posting-engine.logic.js';

/** The pool, or the transaction a caller is already in. */
type LedgerDb = PrismaService['client'] | Prisma.TransactionClient;

function journalBranchScopeWhere(branchIds?: string[]): Record<string, unknown> {
  if (!branchIds) return {};
  return {
    lines: {
      none: {
        AND: [
          { branchId: { not: null } },
          { branchId: { notIn: branchIds } },
        ],
      },
    },
  };
}

function mapAccount(r: any): AccountRecord {
  return {
    id: r.id, companyId: r.companyId, code: r.code, nameTh: r.nameTh, nameEn: r.nameEn,
    accountClass: r.accountClass, reportGroup: r.reportGroup, normalBalance: r.normalBalance,
    parentAccountId: r.parentAccountId, isPosting: r.isPosting, isSystem: r.isSystem,
    isControlled: r.isControlled, taxCategory: r.taxCategory, cashFlowCategory: r.cashFlowCategory,
    sourceGroup1: r.sourceGroup1, sourceGroup2: r.sourceGroup2,
    status: r.status, createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

function mapLine(r: any): JournalLineRecord {
  const taxSnapshot = r.taxCodeDefinitionId || r.externalTaxCodeSnapshot ? {
    taxCodeDefinitionId: r.taxCodeDefinitionId ?? null, externalTaxCode: r.externalTaxCodeSnapshot ?? null,
    taxProfileKey: r.taxProfileKeySnapshot ?? null, taxProfileVersion: r.taxProfileVersionSnapshot ?? null,
    roundingMode: r.roundingModeSnapshot ?? 'HALF_UP', roundingScale: r.roundingScaleSnapshot ?? 2,
    taxAmountTolerance: r.taxAmountToleranceSnapshot?.toString() ?? '0.01',
    taxRegime: r.taxRegimeSnapshot ?? null, taxDirection: r.taxDirectionSnapshot ?? null,
    taxTreatment: r.taxTreatmentSnapshot ?? null, taxContext: r.taxContextSnapshot ?? null,
    taxRate: r.taxRateSnapshot?.toString() ?? '0',
    sourceCurrency: r.sourceCurrencySnapshot ?? r.currency,
    taxCurrency: r.taxCurrencySnapshot ?? r.currency,
    exchangeRate: r.exchangeRateSnapshot?.toString() ?? (r.sourceCurrencySnapshot === r.taxCurrencySnapshot || !r.sourceCurrencySnapshot ? '1' : '0'),
    exchangeRateSource: r.exchangeRateSourceSnapshot ?? (!r.sourceCurrencySnapshot || r.sourceCurrencySnapshot === r.taxCurrencySnapshot ? 'FUNCTIONAL_CURRENCY' : ''),
    exchangeRateDate: r.exchangeRateDateSnapshot?.toISOString?.().slice(0, 10) ?? '',
    taxBaseAmount: r.taxBaseAmount?.toString() ?? '0',
    taxAmount: r.transactionTaxAmount?.toString() ?? '0', claimability: r.claimabilitySnapshot ?? 'NOT_APPLICABLE',
    evidenceStatus: r.taxEvidenceReviewStatus ?? 'REVIEW_REQUIRED', accountRuleVersion: r.accountRuleVersionSnapshot ?? null,
    reportRuleVersion: r.reportRuleVersionSnapshot ?? null,
  } : undefined;
  return {
    id: r.id, companyId: r.companyId, journalEntryId: r.journalEntryId, accountId: r.accountId,
    branchId: r.branchId, lineNumber: r.lineNumber, description: r.description,
    debitAmount: r.debitAmount.toString(), creditAmount: r.creditAmount.toString(),
    currency: r.currency, sourceType: r.sourceType, sourceId: r.sourceId, taxCode: r.taxCode,
    taxSnapshot, taxComponentKey: r.componentKey ?? undefined,
    reportContributions: Array.isArray(r.reportContributionsJson) ? r.reportContributionsJson : undefined,
    createdAt: r.createdAt,
  };
}

function mapEntry(r: any): JournalEntryRecord {
  return {
    id: r.id, companyId: r.companyId, periodId: r.periodId, entryNumber: r.entryNumber,
    entryType: r.entryType, sourceType: r.sourceType, sourceId: r.sourceId,
    reversalOfJournalEntryId: r.reversalOfJournalEntryId, status: r.status,
    entryDate: r.entryDate, postedAt: r.postedAt, postedByUserId: r.postedByUserId,
    memo: r.memo, createdByUserId: r.createdByUserId, createdAt: r.createdAt, updatedAt: r.updatedAt,
    lines: r.lines ? r.lines.map(mapLine) : undefined,
  };
}

function journalLineData(l: LedgerJournalLineInput, idx: number) {
  return {
    // companyId is inherited from the parent journalEntry compound FK; passing it explicitly is rejected by Prisma 7
    accountId: l.accountId, branchId: l.branchId,
    lineNumber: idx + 1, description: l.description,
    // Decimal(18,4) columns take the string as-is, the way every other money and rate
    // field in this create already does. Going through parseFloat first spent the
    // value's precision on a float64: the DTO accepts up to 14 integer digits and 4
    // decimals (18 significant), float64 holds ~15-16, so `12345678901234.5678` posted
    // as `...4.568`. Amounts that large have not been posted yet, which is the only
    // reason this never showed up as a wrong balance.
    debitAmount: l.debitAmount || '0',
    creditAmount: l.creditAmount || '0',
    currency: l.currency ?? 'THB', sourceType: l.sourceType, sourceId: l.sourceId,
    taxCode: l.taxCode,
    componentKey: l.taxComponentKey as any,
    taxCodeDefinitionId: l.taxSnapshot?.taxCodeDefinitionId,
    externalTaxCodeSnapshot: l.taxSnapshot?.externalTaxCode,
    taxProfileKeySnapshot: l.taxSnapshot?.taxProfileKey,
    taxProfileVersionSnapshot: l.taxSnapshot?.taxProfileVersion,
    roundingModeSnapshot: l.taxSnapshot?.roundingMode,
    roundingScaleSnapshot: l.taxSnapshot?.roundingScale,
    taxAmountToleranceSnapshot: l.taxSnapshot?.taxAmountTolerance,
    taxRegimeSnapshot: l.taxSnapshot?.taxRegime as any,
    taxDirectionSnapshot: l.taxSnapshot?.taxDirection as any,
    taxTreatmentSnapshot: l.taxSnapshot?.taxTreatment as any,
    taxContextSnapshot: l.taxSnapshot?.taxContext as any,
    taxRateSnapshot: l.taxSnapshot?.taxRate,
    sourceCurrencySnapshot: l.taxSnapshot?.sourceCurrency,
    taxCurrencySnapshot: l.taxSnapshot?.taxCurrency,
    exchangeRateSnapshot: l.taxSnapshot?.exchangeRate,
    exchangeRateSourceSnapshot: l.taxSnapshot?.exchangeRateSource,
    exchangeRateDateSnapshot: l.taxSnapshot?.exchangeRateDate ? new Date(l.taxSnapshot.exchangeRateDate) : undefined,
    taxBaseAmount: l.taxSnapshot?.taxBaseAmount,
    transactionTaxAmount: l.taxSnapshot?.taxAmount,
    claimabilitySnapshot: l.taxSnapshot?.claimability as any,
    accountRuleVersionSnapshot: l.taxSnapshot?.accountRuleVersion,
    reportRuleVersionSnapshot: l.taxSnapshot?.reportRuleVersion,
    taxEvidenceReviewStatus: l.taxSnapshot?.evidenceStatus as any,
    reportContributionsJson: (l as LedgerJournalLineInput & { reportContributions?: unknown[] }).reportContributions as any,
  };
}

@Injectable()
export class PrismaLedgerRepository {
  async resolveCreateBranchId(companyId: string, scopes: { branchIds?: string[] }, selectedBranchId?: string | null): Promise<string> {
    return resolveTransactionBranchId(this.prisma.client, companyId, scopes, selectedBranchId);
  }

  constructor(private readonly prisma: PrismaService) {}

  // ─── Chart of Accounts ────────────────────────────────────────────────────

  async listAccounts(companyId: string, filters?: { accountClass?: string; status?: string }): Promise<AccountRecord[]> {
    const rows = await this.prisma.client.chartOfAccount.findMany({
      where: {
        OR: [{ companyId }, { companyId: null, isSystem: true }],
        accountClass: filters?.accountClass ? { equals: filters.accountClass as any } : undefined,
        status: filters?.status ? { equals: filters.status as any } : undefined,
      },
      orderBy: [{ code: 'asc' }],
    });
    return rows.map(mapAccount);
  }

  async findAccountByCode(companyId: string, code: string): Promise<AccountRecord | null> {
    const row = await this.prisma.client.chartOfAccount.findFirst({
      where: { OR: [{ companyId, code }, { companyId: null, code, isSystem: true }] },
    });
    return row ? mapAccount(row) : null;
  }

  async findAccountById(id: string): Promise<AccountRecord | null> {
    const row = await this.prisma.client.chartOfAccount.findUnique({ where: { id } });
    return row ? mapAccount(row) : null;
  }

  async createAccount(data: Omit<AccountRecord, 'id' | 'createdAt' | 'updatedAt'> & { createdByUserId?: string }): Promise<AccountRecord> {
    const row = await this.prisma.client.chartOfAccount.create({
      data: {
        companyId: data.companyId, code: data.code, nameTh: data.nameTh, nameEn: data.nameEn,
        accountClass: data.accountClass as any, reportGroup: data.reportGroup, normalBalance: data.normalBalance as any,
        parentAccountId: data.parentAccountId, isPosting: data.isPosting ?? true, isSystem: data.isSystem ?? false,
        isControlled: data.isControlled ?? false, taxCategory: data.taxCategory, cashFlowCategory: data.cashFlowCategory,
        sourceGroup1: data.sourceGroup1, sourceGroup2: data.sourceGroup2,
        status: data.status as any ?? 'ACTIVE', createdByUserId: data.createdByUserId,
      },
    });
    return mapAccount(row);
  }

  async updateAccount(id: string, data: UpdateChartOfAccountInput & { updatedByUserId?: string }): Promise<AccountRecord> {
    // H-02: explicit allowlist — never spread caller data into Prisma; tenant/system
    // fields (companyId, isSystem, code, accountClass, normalBalance) stay immutable here.
    const row = await this.prisma.client.chartOfAccount.update({
      where: { id },
      data: {
        nameTh: data.nameTh, nameEn: data.nameEn, reportGroup: data.reportGroup,
        taxCategory: data.taxCategory, cashFlowCategory: data.cashFlowCategory,
        status: data.status as any, updatedByUserId: data.updatedByUserId, updatedAt: new Date(),
      },
    });
    return mapAccount(row);
  }

  async accountHasJournalLines(accountId: string): Promise<boolean> {
    const count = await this.prisma.client.journalLine.count({ where: { accountId } });
    return count > 0;
  }

  // ─── Accounting Periods ────────────────────────────────────────────────────

  async listPeriods(companyId: string): Promise<PeriodRecord[]> {
    const rows = await this.prisma.client.accountingPeriod.findMany({ where: { companyId }, orderBy: { periodKey: 'desc' } });
    return rows.map((r) => ({ id: r.id, companyId: r.companyId, periodKey: r.periodKey, startDate: r.startDate, endDate: r.endDate, status: r.status as any, closedAt: r.closedAt, reopenedAt: r.reopenedAt, closeNote: r.closeNote }));
  }

  async findPeriod(companyId: string, periodKey: string): Promise<PeriodRecord | null> {
    const r = await this.prisma.client.accountingPeriod.findUnique({ where: { companyId_periodKey: { companyId, periodKey } } });
    return r ? { id: r.id, companyId: r.companyId, periodKey: r.periodKey, startDate: r.startDate, endDate: r.endDate, status: r.status as any, closedAt: r.closedAt, reopenedAt: r.reopenedAt, closeNote: r.closeNote } : null;
  }

  async findPeriodById(companyId: string, id: string): Promise<PeriodRecord | null> {
    const r = await this.prisma.client.accountingPeriod.findFirst({ where: { id, companyId } });
    return r ? { id: r.id, companyId: r.companyId, periodKey: r.periodKey, startDate: r.startDate, endDate: r.endDate, status: r.status as any, closedAt: r.closedAt, reopenedAt: r.reopenedAt, closeNote: r.closeNote } : null;
  }

  async upsertPeriod(companyId: string, periodKey: string, startDate: Date, endDate: Date): Promise<PeriodRecord> {
    const r = await this.prisma.client.accountingPeriod.upsert({
      where: { companyId_periodKey: { companyId, periodKey } },
      update: {},
      create: { companyId, periodKey, startDate, endDate, status: 'OPEN' },
    });
    return { id: r.id, companyId: r.companyId, periodKey: r.periodKey, startDate: r.startDate, endDate: r.endDate, status: r.status as any, closedAt: r.closedAt, reopenedAt: r.reopenedAt, closeNote: r.closeNote };
  }

  async findBranchById(id: string): Promise<{ id: string; companyId: string; status: string } | null> {
    return this.prisma.client.branch.findUnique({ where: { id }, select: { id: true, companyId: true, status: true } });
  }

  async closePeriod(periodId: string, userId: string, note?: string): Promise<PeriodRecord> {
    const r = await this.prisma.client.accountingPeriod.update({
      where: { id: periodId },
      data: { status: 'CLOSED', closedByUserId: userId, closedAt: new Date(), closeNote: note },
    });
    return { id: r.id, companyId: r.companyId, periodKey: r.periodKey, startDate: r.startDate, endDate: r.endDate, status: r.status as any, closedAt: r.closedAt, reopenedAt: r.reopenedAt, closeNote: r.closeNote };
  }

  async reopenPeriod(periodId: string, userId: string, note: string): Promise<PeriodRecord> {
    const r = await this.prisma.client.accountingPeriod.update({
      where: { id: periodId },
      data: { status: 'REOPENED', reopenedByUserId: userId, reopenedAt: new Date(), closeNote: note },
    });
    return { id: r.id, companyId: r.companyId, periodKey: r.periodKey, startDate: r.startDate, endDate: r.endDate, status: r.status as any, closedAt: r.closedAt, reopenedAt: r.reopenedAt, closeNote: r.closeNote };
  }

  // ─── Journal Entries ───────────────────────────────────────────────────────

  async listJournals(companyId: string, filters?: { periodId?: string; status?: string; sourceType?: string; sourceId?: string; page?: number; pageSize?: number }, branchIds?: string[]): Promise<{ data: JournalEntryRecord[]; total: number }> {
    const where: any = { companyId, ...journalBranchScopeWhere(branchIds) };
    if (filters?.periodId) where.periodId = filters.periodId;
    if (filters?.status) where.status = filters.status;
    if (filters?.sourceType) where.sourceType = filters.sourceType;
    if (filters?.sourceId) where.sourceId = filters.sourceId;
    const page = filters?.page ?? 1;
    const pageSize = Math.min(filters?.pageSize ?? 50, 200);
    const [rows, total] = await this.prisma.client.$transaction([
      this.prisma.client.journalEntry.findMany({ where, orderBy: { entryDate: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.client.journalEntry.count({ where }),
    ]);
    return { data: rows.map(mapEntry), total };
  }

  async findJournalById(companyId: string, id: string, branchIds?: string[]): Promise<JournalEntryRecord | null> {
    const r = await this.prisma.client.journalEntry.findFirst({ where: { id, companyId, ...journalBranchScopeWhere(branchIds) }, include: { lines: { include: { account: true } }, period: true } });
    if (!r) return null;
    return mapEntry(r);
  }

  // `db` lets a caller read and write a journal inside its own transaction (the claim payout
  // settlement is created and posted under a claim on its payment row); it defaults to the pool.
  async findGeneratedJournal(companyId: string, sourceType: string, sourceId: string, db: LedgerDb = this.prisma.client): Promise<JournalEntryRecord | null> {
    const r = await db.journalEntry.findFirst({ where: { companyId, sourceType, sourceId, entryType: 'GENERATED' } });
    return r ? mapEntry(r) : null;
  }

  async createJournalEntry(input: CreateJournalEntryInput & { entryNumber: string; expectedExpenseConfirmedAt?: Date | null; expectedExpenseStatus?: string; expectedInputVatClaimStatus?: string; expectedTaxEvidenceStatus?: string }, db: LedgerDb = this.prisma.client): Promise<JournalEntryRecord> {
    if (input.entryType === 'GENERATED' && ['expense.record', 'expense.payment'].includes(input.sourceType ?? '')) {
      if (db === this.prisma.client) return this.prisma.client.$transaction((tx) => this.createJournalEntry(input, tx), { isolationLevel: 'ReadCommitted' });
      const payment = input.sourceType === 'expense.payment'
        ? await db.expensePayment.findFirst({ where: { companyId: input.companyId, id: input.sourceId } }) : null;
      const expenseId = payment?.expenseId ?? input.sourceId;
      if (!expenseId) throw new ConflictException({ code: 'expense_posting_source_changed', message: EXPENSE_CORRECTION_WORDS.sourceChanged });
      await lockExpenseCorrection(db, input.companyId, expenseId);
      const expense = await db.expenseRecord.findFirst({ where: { companyId: input.companyId, id: expenseId } });
      const currentPayment = payment ? await db.expensePayment.findFirst({ where: { companyId: input.companyId, id: input.sourceId } }) : null;
      if (!expense || !['CONFIRMED', 'VOIDED'].includes(expense.status) || expense.status !== (input.expectedExpenseStatus ?? 'CONFIRMED') || (input.sourceType === 'expense.payment' && currentPayment?.status !== 'RECORDED')
        || (input.expectedInputVatClaimStatus !== undefined && expense.inputVatClaimStatus !== input.expectedInputVatClaimStatus)
        || (input.expectedTaxEvidenceStatus !== undefined && expense.taxEvidenceStatus !== input.expectedTaxEvidenceStatus)
        || (input.expectedExpenseConfirmedAt !== undefined && (expense.confirmedAt?.getTime() ?? null) !== (input.expectedExpenseConfirmedAt?.getTime() ?? null))) {
        throw new ConflictException({ code: 'expense_posting_source_changed', message: EXPENSE_CORRECTION_WORDS.sourceChanged });
      }
    }
    const r = await db.journalEntry.create({
      data: {
        companyId: input.companyId, periodId: input.periodId, entryNumber: input.entryNumber,
        entryType: input.entryType as any, sourceType: input.sourceType, sourceId: input.sourceId,
        reversalOfJournalEntryId: input.reversalOfJournalEntryId,
        entryDate: input.entryDate, memo: input.memo, status: 'DRAFT',
        createdByUserId: input.createdByUserId,
        lines: {
          create: input.lines.map(journalLineData),
        },
      },
      include: { lines: true },
    });
    return mapEntry(r);
  }

  async replaceExpenseDraftJournalLines(companyId: string, id: string, lines: LedgerJournalLineInput[], db: LedgerDb) {
    await db.journalEntry.update({ where: { id, companyId, status: 'DRAFT', entryType: 'GENERATED', sourceType: 'expense.record' },
      data: { lines: { deleteMany: {}, create: lines.map(journalLineData) } } });
  }

  async postJournalEntry(id: string, userId: string, db: LedgerDb = this.prisma.client): Promise<JournalEntryRecord> {
    const source = await db.journalEntry.findUnique({ where: { id } });
    if (source?.sourceType === 'expense.record' && source.entryType === 'GENERATED' && source.sourceId) {
      if (db === this.prisma.client) return this.prisma.client.$transaction(tx => this.postJournalEntry(id, userId, tx));
      await lockExpenseCorrection(db, source.companyId, source.sourceId);
    }
    const r = await db.journalEntry.update({
      where: { id }, data: { status: 'POSTED', postedAt: new Date(), postedByUserId: userId },
    });
    return mapEntry(r);
  }

  // Reversed originals keep status POSTED: report queries count POSTED entries
  // only, so the original nets to zero against its REVERSAL entry instead of
  // double-subtracting. The linked REVERSAL row is the "already reversed" signal.
  async findReversalOfJournal(companyId: string, journalEntryId: string): Promise<JournalEntryRecord | null> {
    const r = await this.prisma.client.journalEntry.findFirst({ where: { companyId, entryType: 'REVERSAL', reversalOfJournalEntryId: journalEntryId } });
    return r ? mapEntry(r) : null;
  }

  async getJournalLines(companyId: string, journalEntryId: string, branchIds?: string[]): Promise<JournalLineRecord[]> {
    const rows = await this.prisma.client.journalLine.findMany({
      where: { companyId, journalEntryId, ...branchScopeWhere({ branchIds }) },
      orderBy: { lineNumber: 'asc' },
    });
    return rows.map(mapLine);
  }

  // ─── Reports ───────────────────────────────────────────────────────────────

  async getAccountBalances(companyId: string, periodIds: string[], branchIds?: string[]): Promise<Array<{ accountId: string; totalDebit: string; totalCredit: string }>> {
    const rows = await this.prisma.client.journalLine.groupBy({
      by: ['accountId'],
      where: { companyId, ...branchScopeWhere({ branchIds }), journalEntry: { periodId: { in: periodIds }, status: 'POSTED' } },
      _sum: { debitAmount: true, creditAmount: true },
    });
    return rows.map((r) => ({
      accountId: r.accountId,
      totalDebit: (r._sum.debitAmount ?? 0).toString(),
      totalCredit: (r._sum.creditAmount ?? 0).toString(),
    }));
  }

  async getGlLines(companyId: string, periodId: string, accountId?: string, branchIds?: string[]): Promise<any[]> {
    return this.prisma.client.journalLine.findMany({
      where: {
        companyId,
        ...branchScopeWhere({ branchIds }),
        journalEntry: { periodId, status: 'POSTED' },
        accountId: accountId ?? undefined,
      },
      include: { journalEntry: { select: { entryNumber: true, entryDate: true, memo: true } } },
      orderBy: [{ journalEntry: { entryDate: 'asc' } }, { lineNumber: 'asc' }],
    });
  }

  async countDraftJournals(companyId: string, periodId: string): Promise<number> {
    return this.prisma.client.journalEntry.count({ where: { companyId, periodId, status: 'DRAFT' } });
  }

  // ─── Posting Rules ─────────────────────────────────────────────────────────

  async findActivePostingRule(
    companyId: string,
    documentType: string,
    ruleKey: string,
    companyOnly = false,
  ): Promise<{ mappingJson: Record<string, unknown> } | null> {
    const now = new Date();
    const candidates = await this.prisma.client.postingRule.findMany({
      where: {
        documentType,
        ruleKey,
        status: 'ACTIVE',
        effectiveFrom: { lte: now },
        AND: [
          { OR: companyOnly ? [{ companyId }] : [{ companyId }, { companyId: null }] },
          { OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] },
        ],
      },
      select: { companyId: true, version: true, mappingJson: true },
    });
    const r = selectPostingRuleCandidate(candidates, companyId, companyOnly);
    if (!r) return null;
    return { mappingJson: r.mappingJson as Record<string, unknown> };
  }

  // ─── Close Runs ────────────────────────────────────────────────────────────

  async createCloseRun(companyId: string, periodId: string, userId: string): Promise<string> {
    const r = await this.prisma.client.periodCloseRun.create({ data: { companyId, periodId, requestedByUserId: userId, status: 'STARTED', checksJson: [] } });
    return r.id;
  }

  async updateCloseRun(id: string, status: string, checksJson: unknown[], completedByUserId?: string): Promise<void> {
    await this.prisma.client.periodCloseRun.update({ where: { id }, data: { status: status as any, checksJson: checksJson as any, completedByUserId, completedAt: new Date() } });
  }

  async listCloseRuns(companyId: string, periodId: string): Promise<Array<{ id: string; status: string; checksJson: unknown[]; createdAt: Date; completedAt: Date | null }>> {
    const rows = await this.prisma.client.periodCloseRun.findMany({ where: { companyId, periodId }, orderBy: { createdAt: 'desc' } });
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      checksJson: Array.isArray(r.checksJson) ? r.checksJson : [],
      createdAt: r.createdAt,
      completedAt: r.completedAt,
    }));
  }
}
