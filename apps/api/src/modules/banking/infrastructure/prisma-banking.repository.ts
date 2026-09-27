import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import type {
  BankAccountRecord,
  BankLedgerAccountRecord,
  BankStatementImportRecord,
  BankStatementLineRecord,
  BankReconciliationMatchRecord,
  BankAdjustmentRecord,
  BankReconciliationSessionRecord,
  CreateBankAccountInput,
  UpdateBankAccountInput,
  CreateStatementImportInput,
  CreateStatementLineInput,
  CreateMatchInput,
  CreateBankAdjustmentInput,
  CreateReconciliationSessionInput,
} from '../domain/models/banking.model';
import { branchScopeWhere } from '../../data-model-core/domain/logic/branch.logic';
import { exclusiveEndOfDay } from '@watchdog-bms/contracts';
import type { BankCashPositionSummary } from '@watchdog-bms/contracts';

@Injectable()
export class PrismaBankingRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ---- Bank Account ----

  async createBankAccount(input: CreateBankAccountInput): Promise<BankAccountRecord> {
    const row = await this.prisma.client.bankAccount.create({
      data: {
        companyId: input.companyId,
        branchId: input.branchId,
        displayName: input.displayName,
        bankName: input.bankName,
        bankCode: input.bankCode,
        accountType: input.accountType as any,
        accountNumberMasked: input.accountNumberMasked,
        accountNumberLast4: input.accountNumberLast4,
        accountHolderName: input.accountHolderName,
        currency: input.currency ?? 'THB',
        ledgerAccountId: input.ledgerAccountId,
        openingBalanceAmount: input.openingBalanceAmount ?? '0',
        openingBalanceDate: input.openingBalanceDate ? new Date(input.openingBalanceDate) : undefined,
        status: 'ACTIVE' as any,
        notes: input.notes,
        createdByUserId: input.createdByUserId,
      },
    });
    return this.toBankAccountRecord(row);
  }

  async findActiveBranch(companyId: string, id: string): Promise<{ id: string } | null> {
    return this.prisma.client.branch.findFirst({ where: { id, companyId, status: 'ACTIVE' }, select: { id: true } });
  }

  async findBankAccountById(companyId: string, id: string, branchIds?: string[]): Promise<BankAccountRecord | null> {
    const row = await this.prisma.client.bankAccount.findFirst({ where: { id, companyId, ...branchScopeWhere({ branchIds }) } });
    return row ? this.toBankAccountRecord(row) : null;
  }

  async listBankAccounts(companyId: string, branchIds?: string[]): Promise<BankAccountRecord[]> {
    const rows = await this.prisma.client.bankAccount.findMany({ where: { companyId, ...branchScopeWhere({ branchIds }) }, orderBy: { displayName: 'asc' } });
    return rows.map((r) => this.toBankAccountRecord(r));
  }

  /** One repeatable-read snapshot; counts and latest rows never load the full statement history. */
  async readCashPositionSnapshot(companyId: string, branchIds?: string[]): Promise<{ asOf: Date; accounts: BankCashPositionSummary[] }> {
    return this.prisma.client.$transaction(async (tx) => {
      const stamp = await tx.$queryRaw<Array<{ asOf: Date }>>`SELECT transaction_timestamp() AS "asOf"`;
      const accounts = await tx.bankAccount.findMany({
        where: { companyId, ...branchScopeWhere({ branchIds }) },
        orderBy: { displayName: 'asc' },
        select: { id: true, displayName: true, currency: true },
      });
      const accountIds = accounts.map((account) => account.id);
      if (accountIds.length === 0) return { asOf: stamp[0]?.asOf ?? new Date(), accounts: [] };
      const [lineCounts, latestLines, pendingAdjustments, completedSessions] = await Promise.all([
        tx.bankStatementLine.groupBy({
          by: ['bankAccountId', 'status'], where: { companyId, bankAccountId: { in: accountIds } }, _count: true,
        }),
        tx.bankStatementLine.findMany({
          where: { companyId, bankAccountId: { in: accountIds } },
          distinct: ['bankAccountId'], orderBy: [{ bankAccountId: 'asc' }, { postedDate: 'desc' }, { id: 'asc' }],
          select: { bankAccountId: true, postedDate: true },
        }),
        tx.bankAdjustment.groupBy({
          by: ['bankAccountId'], where: { companyId, bankAccountId: { in: accountIds }, status: 'PENDING_APPROVAL' }, _count: true,
        }),
        tx.bankReconciliationSession.findMany({
          where: { companyId, bankAccountId: { in: accountIds }, status: 'COMPLETED' },
          distinct: ['bankAccountId'], orderBy: [{ bankAccountId: 'asc' }, { completedAt: 'desc' }, { id: 'asc' }],
          select: { bankAccountId: true, completedAt: true, closingStatementBalanceAmount: true },
        }),
      ]);
      const counts = new Map<string, Map<string, number>>();
      for (const row of lineCounts) {
        const current = counts.get(row.bankAccountId) ?? new Map<string, number>();
        current.set(row.status, row._count);
        counts.set(row.bankAccountId, current);
      }
      const latestByAccount = new Map(latestLines.map((row) => [row.bankAccountId, row]));
      const adjustmentsByAccount = new Map(pendingAdjustments.map((row) => [row.bankAccountId, row._count]));
      const sessionsByAccount = new Map(completedSessions.map((row) => [row.bankAccountId, row]));
      return {
        asOf: stamp[0]?.asOf ?? new Date(),
        accounts: accounts.map((account) => {
          const statusCounts = counts.get(account.id) ?? new Map<string, number>();
          const unmatchedLineCount = statusCounts.get('UNMATCHED') ?? 0;
          const unreconciledLineCount = unmatchedLineCount
            + (statusCounts.get('SUGGESTED') ?? 0)
            + (statusCounts.get('PARTIALLY_MATCHED') ?? 0);
          const latest = latestByAccount.get(account.id);
          const completed = sessionsByAccount.get(account.id);
          return {
            companyId, bankAccountId: account.id, bankAccountDisplayName: account.displayName, currency: account.currency,
            ...(completed?.completedAt ? { lastReconciledDate: completed.completedAt.toISOString() } : {}),
            ...(completed ? { lastReconciledBalance: String(completed.closingStatementBalanceAmount) } : {}),
            unreconciledLineCount, unmatchedLineCount,
            pendingAdjustmentCount: adjustmentsByAccount.get(account.id) ?? 0,
            ...(latest ? { lastStatementDate: latest.postedDate.toISOString() } : {}),
          };
        }),
      };
    }, { isolationLevel: 'RepeatableRead', maxWait: 1_000, timeout: 5_000 });
  }

  async findLedgerAccountForBank(companyId: string, id: string): Promise<BankLedgerAccountRecord | null> {
    return this.prisma.client.chartOfAccount.findFirst({
      where: { id, companyId },
      select: {
        id: true,
        companyId: true,
        code: true,
        accountClass: true,
        normalBalance: true,
        reportGroup: true,
        cashFlowCategory: true,
        isPosting: true,
        isControlled: true,
        status: true,
      },
    });
  }

  async updateBankAccount(companyId: string, id: string, update: Partial<UpdateBankAccountInput>): Promise<BankAccountRecord> {
    const row = await this.prisma.client.bankAccount.update({
      where: { id },
      data: {
        displayName: update.displayName,
        bankName: update.bankName,
        bankCode: update.bankCode,
        accountNumberMasked: update.accountNumberMasked,
        accountNumberLast4: update.accountNumberLast4,
        accountHolderName: update.accountHolderName,
        ledgerAccountId: update.ledgerAccountId,
        openingBalanceAmount: update.openingBalanceAmount,
        openingBalanceDate: update.openingBalanceDate ? new Date(update.openingBalanceDate) : undefined,
        status: update.status as any,
        notes: update.notes,
        updatedByUserId: update.updatedByUserId,
      },
    });
    return this.toBankAccountRecord(row);
  }

  // ---- Statement Import ----

  async createStatementImport(input: CreateStatementImportInput): Promise<BankStatementImportRecord> {
    const row = await this.prisma.client.bankStatementImport.create({
      data: {
        companyId: input.companyId,
        bankAccountId: input.bankAccountId,
        sourceType: input.sourceType as any,
        originalFileName: input.originalFileName,
        fileHash: input.fileHash,
        parserVersion: input.parserVersion,
        mappingJson: input.mappingJson as any,
        statementStartDate: input.statementStartDate ? new Date(input.statementStartDate) : undefined,
        statementEndDate: input.statementEndDate ? new Date(input.statementEndDate) : undefined,
        status: 'PREVIEW' as any,
        lineCount: 0,
        duplicateLineCount: 0,
        createdByUserId: input.createdByUserId,
      },
    });
    return this.toStatementImportRecord(row);
  }

  async findStatementImportById(companyId: string, id: string, branchIds?: string[]): Promise<BankStatementImportRecord | null> {
    const row = await this.prisma.client.bankStatementImport.findFirst({
      where: { id, companyId, ...(branchIds ? { bankAccount: branchScopeWhere({ branchIds }) } : {}) },
    });
    return row ? this.toStatementImportRecord(row) : null;
  }

  async listStatementImports(companyId: string, bankAccountId: string): Promise<BankStatementImportRecord[]> {
    const rows = await this.prisma.client.bankStatementImport.findMany({
      where: { companyId, bankAccountId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toStatementImportRecord(r));
  }

  async commitStatementImport(
    companyId: string,
    importId: string,
    lines: CreateStatementLineInput[],
    committedByUserId: string,
  ): Promise<{ import: BankStatementImportRecord; lines: BankStatementLineRecord[] }> {
    const duplicateCount = lines.filter((l) => l.duplicateOfLineId).length;
    return await this.prisma.client.$transaction(async (tx) => {
      const createdLines = await Promise.all(
        lines.map((l) =>
          tx.bankStatementLine.create({
            data: {
              companyId: l.companyId,
              bankAccountId: l.bankAccountId,
              importId: l.importId,
              sourceType: l.sourceType as any,
              rowNumber: l.rowNumber,
              lineHash: l.lineHash,
              postedDate: new Date(l.postedDate),
              valueDate: l.valueDate ? new Date(l.valueDate) : undefined,
              description: l.description,
              normalizedDescription: l.normalizedDescription,
              counterpartyName: l.counterpartyName,
              bankReference: l.bankReference,
              chequeNumber: l.chequeNumber,
              direction: l.direction as any,
              signedAmount: l.signedAmount,
              debitAmount: l.debitAmount,
              creditAmount: l.creditAmount,
              runningBalanceAmount: l.runningBalanceAmount,
              currency: l.currency,
              status: l.duplicateOfLineId ? ('VOIDED' as any) : ('UNMATCHED' as any),
              duplicateOfLineId: l.duplicateOfLineId,
              createdByUserId: l.createdByUserId,
            },
          }),
        ),
      );
      const updated = await tx.bankStatementImport.update({
        where: { id: importId },
        data: {
          status: 'COMMITTED' as any,
          lineCount: lines.length,
          duplicateLineCount: duplicateCount,
          committedAt: new Date(),
          committedByUserId,
        },
      });
      return {
        import: this.toStatementImportRecord(updated),
        lines: createdLines.map((r) => this.toStatementLineRecord(r)),
      };
    });
  }

  async voidStatementImport(companyId: string, importId: string, userId: string, reason: string): Promise<BankStatementImportRecord> {
    const row = await this.prisma.client.bankStatementImport.update({
      where: { id: importId },
      data: { status: 'VOIDED' as any, voidedAt: new Date(), voidedByUserId: userId, voidReason: reason },
    });
    return this.toStatementImportRecord(row);
  }

  async listStatementLines(companyId: string, bankAccountId: string, status?: string): Promise<BankStatementLineRecord[]> {
    const rows = await this.prisma.client.bankStatementLine.findMany({
      where: { companyId, bankAccountId, ...(status ? { status: status as any } : {}) },
      orderBy: { postedDate: 'desc' },
    });
    return rows.map((r) => this.toStatementLineRecord(r));
  }

  async listStatementLinesForPeriod(
    companyId: string,
    bankAccountId: string,
    periodStartDate: Date,
    periodEndDate: Date,
  ): Promise<BankStatementLineRecord[]> {
    const rows = await this.prisma.client.bankStatementLine.findMany({
      where: {
        companyId,
        bankAccountId,
        postedDate: { gte: periodStartDate, lt: exclusiveEndOfDay(periodEndDate) },
        status: { not: 'VOIDED' as any },
      },
      orderBy: [{ postedDate: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => this.toStatementLineRecord(r));
  }

  async findStatementLineById(companyId: string, id: string, branchIds?: string[]): Promise<BankStatementLineRecord | null> {
    const row = await this.prisma.client.bankStatementLine.findFirst({
      where: { id, companyId, ...(branchIds ? { bankAccount: branchScopeWhere({ branchIds }) } : {}) },
    });
    return row ? this.toStatementLineRecord(row) : null;
  }

  async createManualStatementLine(
    input: CreateStatementLineInput & { companyId: string; bankAccountId: string; createdByUserId: string },
  ): Promise<BankStatementLineRecord> {
    const row = await this.prisma.client.bankStatementLine.create({
      data: {
        companyId: input.companyId,
        bankAccountId: input.bankAccountId,
        importId: input.importId,
        sourceType: input.sourceType as any,
        rowNumber: input.rowNumber,
        lineHash: input.lineHash,
        postedDate: new Date(input.postedDate),
        valueDate: input.valueDate ? new Date(input.valueDate) : undefined,
        description: input.description,
        normalizedDescription: input.normalizedDescription,
        counterpartyName: input.counterpartyName,
        bankReference: input.bankReference,
        chequeNumber: input.chequeNumber,
        direction: input.direction as any,
        signedAmount: input.signedAmount,
        debitAmount: input.debitAmount,
        creditAmount: input.creditAmount,
        runningBalanceAmount: input.runningBalanceAmount,
        currency: input.currency,
        status: 'UNMATCHED' as any,
        createdByUserId: input.createdByUserId,
      },
    });
    return this.toStatementLineRecord(row);
  }

  async findLineByHash(companyId: string, bankAccountId: string, lineHash: string): Promise<BankStatementLineRecord | null> {
    const row = await this.prisma.client.bankStatementLine.findFirst({ where: { companyId, bankAccountId, lineHash } });
    return row ? this.toStatementLineRecord(row) : null;
  }

  async updateStatementLineStatus(companyId: string, id: string, status: string, ignoredReason?: string): Promise<BankStatementLineRecord> {
    const row = await this.prisma.client.bankStatementLine.update({
      where: { id },
      data: { status: status as any, ignoredReason },
    });
    return this.toStatementLineRecord(row);
  }

  async isStatementLineLockedByCompletedReconciliation(companyId: string, statementLineId: string): Promise<boolean> {
    const count = await this.prisma.client.bankReconciliationSessionLine.count({
      where: {
        companyId,
        statementLineId,
        session: { status: 'COMPLETED' as any },
      },
    });
    return count > 0;
  }

  async hasImportLinesLockedByCompletedReconciliation(companyId: string, importId: string): Promise<boolean> {
    const count = await this.prisma.client.bankReconciliationSessionLine.count({
      where: {
        companyId,
        session: { status: 'COMPLETED' as any },
        statementLine: { importId },
      },
    });
    return count > 0;
  }

  // ---- Reconciliation Match ----

  async createMatch(input: CreateMatchInput): Promise<BankReconciliationMatchRecord> {
    const line = await this.prisma.client.bankStatementLine.findFirst({ where: { id: input.statementLineId } });
    const row = await this.prisma.client.bankReconciliationMatch.create({
      data: {
        companyId: input.companyId,
        bankAccountId: input.bankAccountId,
        statementLineId: input.statementLineId,
        sourceType: input.sourceType as any,
        sourceId: input.sourceId,
        sourceDisplayNumber: input.sourceDisplayNumber,
        allocatedAmount: input.allocatedAmount,
        currency: input.currency,
        confidenceScore: input.confidenceScore,
        status: 'CONFIRMED' as any,
        suggestedBy: input.suggestedBy,
        suggestedReason: input.suggestedReason,
        overrideReason: input.overrideReason,
      },
    });
    return this.toMatchRecord(row);
  }

  async findMatchById(companyId: string, id: string, branchIds?: string[]): Promise<BankReconciliationMatchRecord | null> {
    const row = await this.prisma.client.bankReconciliationMatch.findFirst({
      where: { id, companyId, ...(branchIds ? { bankAccount: branchScopeWhere({ branchIds }) } : {}) },
    });
    return row ? this.toMatchRecord(row) : null;
  }

  async listMatchesByLine(companyId: string, statementLineId: string): Promise<BankReconciliationMatchRecord[]> {
    const rows = await this.prisma.client.bankReconciliationMatch.findMany({
      where: { companyId, statementLineId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toMatchRecord(r));
  }

  async updateMatchStatus(
    companyId: string,
    id: string,
    update: { status: string; confirmedByUserId?: string; rejectedByUserId?: string; rejectionReason?: string; overrideReason?: string },
  ): Promise<BankReconciliationMatchRecord> {
    const data: Record<string, unknown> = { status: update.status as any };
    if (update.confirmedByUserId) { data.confirmedByUserId = update.confirmedByUserId; data.confirmedAt = new Date(); }
    if (update.rejectedByUserId) { data.rejectedByUserId = update.rejectedByUserId; data.rejectedAt = new Date(); data.rejectionReason = update.rejectionReason; }
    if (update.overrideReason) data.overrideReason = update.overrideReason;
    const row = await this.prisma.client.bankReconciliationMatch.update({ where: { id }, data });
    return this.toMatchRecord(row);
  }

  // ---- Bank Adjustment ----

  async createBankAdjustment(input: CreateBankAdjustmentInput): Promise<BankAdjustmentRecord> {
    const row = await this.prisma.client.bankAdjustment.create({
      data: {
        companyId: input.companyId,
        bankAccountId: input.bankAccountId,
        category: input.category as any,
        status: 'DRAFT' as any,
        adjustmentDate: new Date(input.adjustmentDate),
        description: input.description,
        signedAmount: input.signedAmount,
        currency: input.currency ?? 'THB',
        counterpartyName: input.counterpartyName,
        ledgerDebitAccountId: input.ledgerDebitAccountId,
        ledgerCreditAccountId: input.ledgerCreditAccountId,
        sourceStatementLineId: input.sourceStatementLineId,
        postingStatus: 'not_required' as any,
        createdByUserId: input.createdByUserId,
      },
    });
    return this.toAdjustmentRecord(row);
  }

  async findBankAdjustmentById(companyId: string, id: string, branchIds?: string[]): Promise<BankAdjustmentRecord | null> {
    const row = await this.prisma.client.bankAdjustment.findFirst({
      where: { id, companyId, ...(branchIds ? { bankAccount: branchScopeWhere({ branchIds }) } : {}) },
    });
    return row ? this.toAdjustmentRecord(row) : null;
  }

  async listBankAdjustments(companyId: string, bankAccountId?: string, branchIds?: string[]): Promise<BankAdjustmentRecord[]> {
    const rows = await this.prisma.client.bankAdjustment.findMany({
      where: {
        companyId,
        ...(bankAccountId ? { bankAccountId } : {}),
        ...(branchIds ? { bankAccount: branchScopeWhere({ branchIds }) } : {}),
      },
      orderBy: { adjustmentDate: 'desc' },
    });
    return rows.map((r) => this.toAdjustmentRecord(r));
  }

  async updateBankAdjustmentStatus(
    companyId: string,
    id: string,
    update: { status: string; adjustmentNumber?: string; approvedByUserId?: string; voidedByUserId?: string; voidReason?: string; postingStatus?: string },
  ): Promise<BankAdjustmentRecord> {
    const data: Record<string, unknown> = { status: update.status as any };
    if (update.adjustmentNumber) data.adjustmentNumber = update.adjustmentNumber;
    if (update.approvedByUserId) { data.approvedByUserId = update.approvedByUserId; data.approvedAt = new Date(); }
    if (update.voidedByUserId) { data.voidedByUserId = update.voidedByUserId; data.voidedAt = new Date(); data.voidReason = update.voidReason; }
    if (update.postingStatus) data.postingStatus = update.postingStatus as any;
    const row = await this.prisma.client.bankAdjustment.update({ where: { id }, data });
    return this.toAdjustmentRecord(row);
  }

  // ---- Reconciliation Session ----

  async createReconciliationSession(
    input: CreateReconciliationSessionInput & {
      closingStatementBalanceAmount: string;
      calculatedStatementMovementAmount: string;
      calculatedBookMovementAmount: string;
      calculatedBookBalanceAmount: string;
      differenceAmount: string;
    },
  ): Promise<BankReconciliationSessionRecord> {
    const row = await this.prisma.client.bankReconciliationSession.create({
      data: {
        companyId: input.companyId,
        bankAccountId: input.bankAccountId,
        sessionNumber: input.sessionNumber,
        periodStartDate: new Date(input.periodStartDate),
        periodEndDate: new Date(input.periodEndDate),
        openingStatementBalanceAmount: input.openingStatementBalanceAmount,
        closingStatementBalanceAmount: input.closingStatementBalanceAmount,
        calculatedStatementMovementAmount: input.calculatedStatementMovementAmount,
        calculatedBookMovementAmount: input.calculatedBookMovementAmount,
        calculatedBookBalanceAmount: input.calculatedBookBalanceAmount,
        differenceAmount: input.differenceAmount,
        currency: input.currency,
        status: 'DRAFT' as any,
        createdByUserId: input.createdByUserId,
      },
    });
    return this.toSessionRecord(row);
  }

  async findReconciliationSessionById(companyId: string, id: string, branchIds?: string[]): Promise<BankReconciliationSessionRecord | null> {
    const row = await this.prisma.client.bankReconciliationSession.findFirst({
      where: { id, companyId, ...(branchIds ? { bankAccount: branchScopeWhere({ branchIds }) } : {}) },
    });
    return row ? this.toSessionRecord(row) : null;
  }

  async listReconciliationSessions(companyId: string, bankAccountId?: string, branchIds?: string[]): Promise<BankReconciliationSessionRecord[]> {
    const rows = await this.prisma.client.bankReconciliationSession.findMany({
      where: {
        companyId,
        ...(bankAccountId ? { bankAccountId } : {}),
        ...(branchIds ? { bankAccount: branchScopeWhere({ branchIds }) } : {}),
      },
      orderBy: { periodEndDate: 'desc' },
    });
    return rows.map((r) => this.toSessionRecord(r));
  }

  async hasOpenReconciliationSession(companyId: string, bankAccountId: string): Promise<boolean> {
    const count = await this.prisma.client.bankReconciliationSession.count({
      where: {
        companyId,
        bankAccountId,
        status: { in: ['DRAFT', 'IN_REVIEW', 'REOPENED'] as any },
      },
    });
    return count > 0;
  }

  async hasClosedAccountingPeriodInRange(companyId: string, periodStartDate: Date, periodEndDate: Date): Promise<boolean> {
    const count = await this.prisma.client.accountingPeriod.count({
      where: {
        companyId,
        status: 'CLOSED' as any,
        startDate: { lte: periodEndDate },
        endDate: { gte: periodStartDate },
      },
    });
    return count > 0;
  }

  async completeReconciliationSession(
    companyId: string,
    sessionId: string,
    userId: string,
    snapshotLines: Array<{ statementLineId: string; statusAtCompletion: string; matchedAmountAtCompletion: string; ignoredReasonAtCompletion?: string }>,
  ): Promise<BankReconciliationSessionRecord> {
    return await this.prisma.client.$transaction(async (tx) => {
      await tx.bankReconciliationSessionLine.deleteMany({ where: { companyId, sessionId } });
      await Promise.all(
        snapshotLines.map((sl) =>
          tx.bankReconciliationSessionLine.create({
            data: {
              companyId,
              sessionId,
              statementLineId: sl.statementLineId,
              statusAtCompletion: sl.statusAtCompletion as any,
              matchedAmountAtCompletion: sl.matchedAmountAtCompletion,
              ignoredReasonAtCompletion: sl.ignoredReasonAtCompletion,
            },
          }),
        ),
      );
      const updated = await tx.bankReconciliationSession.update({
        where: { id: sessionId },
        data: { status: 'COMPLETED' as any, completedAt: new Date(), completedByUserId: userId },
      });
      return this.toSessionRecord(updated);
    });
  }

  async updateReconciliationSessionStatus(
    companyId: string,
    sessionId: string,
    update: { status: string; reopenedByUserId?: string; reopenReason?: string; voidedByUserId?: string; voidReason?: string },
  ): Promise<BankReconciliationSessionRecord> {
    const data: Record<string, unknown> = { status: update.status as any };
    if (update.reopenedByUserId) { data.reopenedByUserId = update.reopenedByUserId; data.reopenedAt = new Date(); data.reopenReason = update.reopenReason; }
    if (update.voidedByUserId) { data.voidedByUserId = update.voidedByUserId; data.voidedAt = new Date(); data.voidReason = update.voidReason; }
    const row = await this.prisma.client.bankReconciliationSession.update({ where: { id: sessionId }, data });
    return this.toSessionRecord(row);
  }

  // ---- Mappers ----

  private toBankAccountRecord(row: any): BankAccountRecord {
    return {
      id: row.id, companyId: row.companyId, branchId: row.branchId ?? undefined,
      displayName: row.displayName, bankName: row.bankName ?? undefined, bankCode: row.bankCode ?? undefined,
      accountType: row.accountType, accountNumberMasked: row.accountNumberMasked ?? undefined,
      accountNumberLast4: row.accountNumberLast4 ?? undefined, accountHolderName: row.accountHolderName ?? undefined,
      currency: row.currency, ledgerAccountId: row.ledgerAccountId ?? undefined,
      openingBalanceAmount: row.openingBalanceAmount.toString(), openingBalanceDate: row.openingBalanceDate ?? undefined,
      status: row.status, notes: row.notes ?? undefined,
      createdByUserId: row.createdByUserId, updatedByUserId: row.updatedByUserId ?? undefined,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
  }

  private toStatementImportRecord(row: any): BankStatementImportRecord {
    return {
      id: row.id, companyId: row.companyId, bankAccountId: row.bankAccountId,
      sourceType: row.sourceType, originalFileName: row.originalFileName ?? undefined,
      fileHash: row.fileHash ?? undefined, parserVersion: row.parserVersion,
      mappingJson: row.mappingJson ?? undefined, statementStartDate: row.statementStartDate ?? undefined,
      statementEndDate: row.statementEndDate ?? undefined, status: row.status,
      lineCount: row.lineCount, duplicateLineCount: row.duplicateLineCount,
      committedAt: row.committedAt ?? undefined, committedByUserId: row.committedByUserId ?? undefined,
      voidedAt: row.voidedAt ?? undefined, voidedByUserId: row.voidedByUserId ?? undefined,
      voidReason: row.voidReason ?? undefined, createdByUserId: row.createdByUserId,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
  }

  private toStatementLineRecord(row: any): BankStatementLineRecord {
    return {
      id: row.id, companyId: row.companyId, bankAccountId: row.bankAccountId,
      importId: row.importId ?? undefined, sourceType: row.sourceType,
      rowNumber: row.rowNumber ?? undefined, lineHash: row.lineHash,
      postedDate: row.postedDate, valueDate: row.valueDate ?? undefined,
      description: row.description, normalizedDescription: row.normalizedDescription ?? undefined,
      counterpartyName: row.counterpartyName ?? undefined, bankReference: row.bankReference ?? undefined,
      chequeNumber: row.chequeNumber ?? undefined, direction: row.direction,
      signedAmount: row.signedAmount.toString(), debitAmount: row.debitAmount?.toString() ?? undefined,
      creditAmount: row.creditAmount?.toString() ?? undefined,
      runningBalanceAmount: row.runningBalanceAmount?.toString() ?? undefined,
      currency: row.currency, status: row.status,
      duplicateOfLineId: row.duplicateOfLineId ?? undefined, ignoredReason: row.ignoredReason ?? undefined,
      createdByUserId: row.createdByUserId ?? undefined, createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
  }

  private toMatchRecord(row: any): BankReconciliationMatchRecord {
    return {
      id: row.id, companyId: row.companyId, bankAccountId: row.bankAccountId,
      statementLineId: row.statementLineId, sourceType: row.sourceType,
      sourceId: row.sourceId, sourceDisplayNumber: row.sourceDisplayNumber ?? undefined,
      allocatedAmount: row.allocatedAmount.toString(), currency: row.currency,
      confidenceScore: row.confidenceScore ?? undefined, status: row.status,
      suggestedBy: row.suggestedBy ?? undefined, suggestedReason: row.suggestedReason ?? undefined,
      confirmedByUserId: row.confirmedByUserId ?? undefined, confirmedAt: row.confirmedAt ?? undefined,
      rejectedByUserId: row.rejectedByUserId ?? undefined, rejectedAt: row.rejectedAt ?? undefined,
      rejectionReason: row.rejectionReason ?? undefined, overrideReason: row.overrideReason ?? undefined,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
  }

  private toAdjustmentRecord(row: any): BankAdjustmentRecord {
    return {
      id: row.id, companyId: row.companyId, bankAccountId: row.bankAccountId,
      adjustmentNumber: row.adjustmentNumber ?? undefined, category: row.category, status: row.status,
      adjustmentDate: row.adjustmentDate, description: row.description,
      signedAmount: row.signedAmount.toString(), currency: row.currency,
      counterpartyName: row.counterpartyName ?? undefined,
      ledgerDebitAccountId: row.ledgerDebitAccountId ?? undefined,
      ledgerCreditAccountId: row.ledgerCreditAccountId ?? undefined,
      sourceStatementLineId: row.sourceStatementLineId ?? undefined,
      postingStatus: row.postingStatus, postedJournalEntryId: row.postedJournalEntryId ?? undefined,
      createdByUserId: row.createdByUserId,
      approvedByUserId: row.approvedByUserId ?? undefined, approvedAt: row.approvedAt ?? undefined,
      voidedByUserId: row.voidedByUserId ?? undefined, voidedAt: row.voidedAt ?? undefined,
      voidReason: row.voidReason ?? undefined, createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
  }

  private toSessionRecord(row: any): BankReconciliationSessionRecord {
    return {
      id: row.id, companyId: row.companyId, bankAccountId: row.bankAccountId,
      sessionNumber: row.sessionNumber, periodStartDate: row.periodStartDate,
      periodEndDate: row.periodEndDate,
      openingStatementBalanceAmount: row.openingStatementBalanceAmount.toString(),
      closingStatementBalanceAmount: row.closingStatementBalanceAmount.toString(),
      calculatedStatementMovementAmount: row.calculatedStatementMovementAmount.toString(),
      calculatedBookMovementAmount: row.calculatedBookMovementAmount.toString(),
      calculatedBookBalanceAmount: row.calculatedBookBalanceAmount.toString(),
      differenceAmount: row.differenceAmount.toString(),
      currency: row.currency, status: row.status,
      completedAt: row.completedAt ?? undefined, completedByUserId: row.completedByUserId ?? undefined,
      reopenedAt: row.reopenedAt ?? undefined, reopenedByUserId: row.reopenedByUserId ?? undefined,
      reopenReason: row.reopenReason ?? undefined,
      voidedAt: row.voidedAt ?? undefined, voidedByUserId: row.voidedByUserId ?? undefined,
      voidReason: row.voidReason ?? undefined,
      createdByUserId: row.createdByUserId, createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
  }
}
