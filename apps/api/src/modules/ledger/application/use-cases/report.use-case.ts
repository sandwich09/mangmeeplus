import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaLedgerRepository } from '../../infrastructure/prisma-ledger.repository';
import { AuditService } from '../../../audit/application/audit.service';
import { deriveBalance } from '../../domain/logic/journal-balance.logic';
import type {
  RequestContext, GlAccountLine, TrialBalanceSummary, TrialBalanceLine,
  PnlReport, PnlSection, BalanceSheetReport, BalanceSheetSection,
} from '@watchdog-bms/contracts';
import type { AccountRecord } from '../../domain/models/ledger.model';

function requirePerm(ctx: RequestContext, perm: string) {
  if (!ctx.permissions.includes(perm)) throw new ForbiddenException(`Missing permission: ${perm}`);
}

function n(s: string | undefined | null): number { return parseFloat(s ?? '0') || 0; }
function d4(v: number): string { return v.toFixed(4); }

@Injectable()
export class GetGeneralLedgerUseCase {
  constructor(private readonly repo: PrismaLedgerRepository) {}

  async execute(ctx: RequestContext, periodKey: string, accountId?: string): Promise<GlAccountLine[]> {
    requirePerm(ctx, 'ledger.report.read');
    const period = await this.repo.findPeriod(ctx.companyId, periodKey);
    if (!period) return [];

    const glLines = await this.repo.getGlLines(ctx.companyId, period.id, accountId, ctx.scopes.branchIds);
    const accounts = await this.repo.listAccounts(ctx.companyId);
    const accMap = new Map<string, AccountRecord>(accounts.map((a) => [a.id, a]));

    const byAccount = new Map<string, { account: AccountRecord; lines: typeof glLines }>();
    for (const l of glLines) {
      if (!byAccount.has(l.accountId)) byAccount.set(l.accountId, { account: accMap.get(l.accountId)!, lines: [] });
      byAccount.get(l.accountId)!.lines.push(l);
    }

    return Array.from(byAccount.values())
      .filter((g) => g.account)
      .map(({ account, lines }) => {
        const totalDebit  = lines.reduce((a, l) => a + n(l.debitAmount.toString()),  0);
        const totalCredit = lines.reduce((a, l) => a + n(l.creditAmount.toString()), 0);
        const balance = deriveBalance(account.normalBalance, totalDebit, totalCredit);
        return {
          accountId: account.id, accountCode: account.code, accountNameTh: account.nameTh,
          openingBalance: '0.0000', totalDebit: d4(totalDebit), totalCredit: d4(totalCredit),
          endingBalance: d4(balance), normalBalance: account.normalBalance,
          lines: lines.map((l) => ({
            journalEntryId: l.journalEntryId,
            entryNumber: (l.journalEntry as any)?.entryNumber ?? '',
            entryDate: (l.journalEntry as any)?.entryDate?.toISOString() ?? '',
            memo: (l.journalEntry as any)?.memo ?? null,
            debitAmount: l.debitAmount.toString(), creditAmount: l.creditAmount.toString(),
            sourceType: l.sourceType, sourceId: l.sourceId,
          })),
        };
      });
  }
}

@Injectable()
export class GetTrialBalanceUseCase {
  constructor(private readonly repo: PrismaLedgerRepository) {}

  async execute(ctx: RequestContext, periodKey: string): Promise<TrialBalanceSummary> {
    requirePerm(ctx, 'ledger.report.read');
    const period = await this.repo.findPeriod(ctx.companyId, periodKey);
    if (!period) return { periodKey, totalDebit: '0', totalCredit: '0', difference: '0', lines: [] };

    const balances = await this.repo.getAccountBalances(ctx.companyId, [period.id], ctx.scopes.branchIds);
    const accounts = await this.repo.listAccounts(ctx.companyId);
    const accMap = new Map<string, AccountRecord>(accounts.map((a) => [a.id, a]));

    let totalDebit = 0;
    let totalCredit = 0;
    const lines: TrialBalanceLine[] = [];

    for (const b of balances) {
      const acc = accMap.get(b.accountId);
      if (!acc) continue;
      const dr = n(b.totalDebit);
      const cr = n(b.totalCredit);
      totalDebit += dr;
      totalCredit += cr;
      const balance = deriveBalance(acc.normalBalance, dr, cr);
      lines.push({ accountId: acc.id, accountCode: acc.code, accountNameTh: acc.nameTh, accountClass: acc.accountClass, reportGroup: acc.reportGroup, normalBalance: acc.normalBalance, totalDebit: d4(dr), totalCredit: d4(cr), balance: d4(balance) });
    }

    lines.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
    return {
      periodKey, totalDebit: d4(totalDebit), totalCredit: d4(totalCredit),
      difference: d4(Math.abs(totalDebit - totalCredit)), lines,
    };
  }
}

@Injectable()
export class GetPnlReportUseCase {
  constructor(private readonly repo: PrismaLedgerRepository) {}

  async execute(ctx: RequestContext, periodKey: string): Promise<PnlReport> {
    requirePerm(ctx, 'ledger.report.read');
    const period = await this.repo.findPeriod(ctx.companyId, periodKey);
    if (!period) return { periodKey, revenue: '0', totalCost: '0', grossProfit: '0', totalExpense: '0', taxExpense: '0', netProfit: '0', sections: [] };

    const balances = await this.repo.getAccountBalances(ctx.companyId, [period.id], ctx.scopes.branchIds);
    const accounts = await this.repo.listAccounts(ctx.companyId);
    const accMap = new Map<string, AccountRecord>(accounts.map((a) => [a.id, a]));

    const sectionMap = new Map<string, { total: number; lines: PnlSection['lines'] }>();
    for (const cls of ['REVENUE', 'COST', 'EXPENSE', 'TAX_EXPENSE']) sectionMap.set(cls, { total: 0, lines: [] });

    for (const b of balances) {
      const acc = accMap.get(b.accountId);
      if (!acc) continue;
      const cls = acc.accountClass;
      if (!sectionMap.has(cls)) continue;
      const bal = deriveBalance(acc.normalBalance, b.totalDebit, b.totalCredit);
      sectionMap.get(cls)!.total += bal;
      sectionMap.get(cls)!.lines.push({ accountId: acc.id, accountCode: acc.code, accountNameTh: acc.nameTh, balance: d4(bal) });
    }

    const rev  = sectionMap.get('REVENUE')!.total;
    const cost = sectionMap.get('COST')!.total;
    const exp  = sectionMap.get('EXPENSE')!.total;
    const tax  = sectionMap.get('TAX_EXPENSE')!.total;
    const gross = rev - cost;
    const net   = gross - exp - tax;

    const sections: PnlSection[] = [
      { section: 'REVENUE',     total: rev.toFixed(4),  lines: sectionMap.get('REVENUE')!.lines },
      { section: 'COST',        total: cost.toFixed(4), lines: sectionMap.get('COST')!.lines },
      { section: 'EXPENSE',     total: exp.toFixed(4),  lines: sectionMap.get('EXPENSE')!.lines },
      { section: 'TAX_EXPENSE', total: tax.toFixed(4),  lines: sectionMap.get('TAX_EXPENSE')!.lines },
    ];

    return { periodKey, revenue: rev.toFixed(4), totalCost: cost.toFixed(4), grossProfit: gross.toFixed(4), totalExpense: exp.toFixed(4), taxExpense: tax.toFixed(4), netProfit: net.toFixed(4), sections };
  }
}

@Injectable()
export class GetBalanceSheetUseCase {
  constructor(private readonly repo: PrismaLedgerRepository) {}

  async execute(ctx: RequestContext, periodKey: string): Promise<BalanceSheetReport> {
    requirePerm(ctx, 'ledger.report.read');
    const period = await this.repo.findPeriod(ctx.companyId, periodKey);
    if (!period) return { periodKey, totalAssets: '0', totalLiabilities: '0', totalEquity: '0', sections: [] };

    const balances = await this.repo.getAccountBalances(ctx.companyId, [period.id], ctx.scopes.branchIds);
    const accounts = await this.repo.listAccounts(ctx.companyId);
    const accMap = new Map<string, AccountRecord>(accounts.map((a) => [a.id, a]));

    const sectionMap = new Map<string, { total: number; lines: BalanceSheetSection['lines'] }>();
    for (const cls of ['ASSET', 'LIABILITY', 'EQUITY']) sectionMap.set(cls, { total: 0, lines: [] });

    for (const b of balances) {
      const acc = accMap.get(b.accountId);
      if (!acc || !sectionMap.has(acc.accountClass)) continue;
      const bal = deriveBalance(acc.normalBalance, b.totalDebit, b.totalCredit);
      sectionMap.get(acc.accountClass)!.total += bal;
      sectionMap.get(acc.accountClass)!.lines.push({ accountId: acc.id, accountCode: acc.code, accountNameTh: acc.nameTh, balance: bal.toFixed(4) });
    }

    const assets = sectionMap.get('ASSET')!.total;
    const liab   = sectionMap.get('LIABILITY')!.total;
    const equity = sectionMap.get('EQUITY')!.total;

    const sections: BalanceSheetSection[] = [
      { section: 'ASSET',     total: assets.toFixed(4), lines: sectionMap.get('ASSET')!.lines },
      { section: 'LIABILITY', total: liab.toFixed(4),   lines: sectionMap.get('LIABILITY')!.lines },
      { section: 'EQUITY',    total: equity.toFixed(4), lines: sectionMap.get('EQUITY')!.lines },
    ];

    return { periodKey, totalAssets: assets.toFixed(4), totalLiabilities: liab.toFixed(4), totalEquity: equity.toFixed(4), sections };
  }
}

@Injectable()
export class ExportReportUseCase {
  constructor(private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, reportType: string, periodKey: string): Promise<{ status: string; message: string }> {
    requirePerm(ctx, 'ledger.export');
    const validTypes = ['general-ledger', 'trial-balance', 'profit-and-loss', 'balance-sheet'];
    if (!validTypes.includes(reportType)) throw new ForbiddenException(`Invalid report type: ${reportType}`);
    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'ledger.report.export', targetType: 'ledger_report', targetId: reportType, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { reportType, periodKey } });
    return { status: 'export_not_implemented', message: 'การส่งออกไฟล์ XLSX ยังไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแลระบบ' };
  }
}
