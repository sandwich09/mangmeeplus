import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaLedgerRepository } from '../../infrastructure/prisma-ledger.repository';
import { AuditService } from '../../../audit/application/audit.service';
import type { RequestContext, CreateChartOfAccountInput, UpdateChartOfAccountInput, ChartOfAccountSummary, LedgerAccountClass, LedgerNormalBalance } from '@watchdog-bms/contracts';
import type { AccountRecord } from '../../domain/models/ledger.model';

function requirePerm(ctx: RequestContext, perm: string) {
  if (!ctx.permissions.includes(perm)) throw new ForbiddenException(`Missing permission: ${perm}`);
}

function toSummary(r: AccountRecord): ChartOfAccountSummary {
  return {
    id: r.id, companyId: r.companyId, code: r.code, nameTh: r.nameTh, nameEn: r.nameEn,
    accountClass: r.accountClass, reportGroup: r.reportGroup, normalBalance: r.normalBalance,
    parentAccountId: r.parentAccountId, isPosting: r.isPosting, isSystem: r.isSystem,
    isControlled: r.isControlled, taxCategory: r.taxCategory, cashFlowCategory: r.cashFlowCategory,
    sourceGroup1: r.sourceGroup1, sourceGroup2: r.sourceGroup2, status: r.status,
  };
}

@Injectable()
export class ListAccountsUseCase {
  constructor(private readonly repo: PrismaLedgerRepository) {}

  async execute(ctx: RequestContext, filters?: { accountClass?: string; status?: string }): Promise<ChartOfAccountSummary[]> {
    requirePerm(ctx, 'ledger.account.read');
    const rows = await this.repo.listAccounts(ctx.companyId, filters);
    return rows.map(toSummary);
  }
}

@Injectable()
export class GetAccountUseCase {
  constructor(private readonly repo: PrismaLedgerRepository) {}

  async execute(ctx: RequestContext, accountId: string): Promise<ChartOfAccountSummary> {
    requirePerm(ctx, 'ledger.account.read');
    const row = await this.repo.findAccountById(accountId);
    if (!row || (row.companyId !== null && row.companyId !== ctx.companyId)) throw new NotFoundException('Account not found');
    return toSummary(row);
  }
}

@Injectable()
export class CreateAccountUseCase {
  constructor(private readonly repo: PrismaLedgerRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, input: CreateChartOfAccountInput): Promise<ChartOfAccountSummary> {
    requirePerm(ctx, 'ledger.account.manage');
    if (!input.code || !input.nameTh) throw new BadRequestException('รหัสบัญชีและชื่อบัญชีภาษาไทยจำเป็น');

    const existing = await this.repo.findAccountByCode(ctx.companyId, input.code);
    if (existing) throw new BadRequestException(`รหัสบัญชี ${input.code} มีอยู่แล้ว`);

    // H-02: parent must be resolvable within this tenant (or an approved system
    // account) — a raw FK id would otherwise create a cross-tenant hierarchy edge.
    if (input.parentAccountId) {
      const parent = await this.repo.findAccountById(input.parentAccountId);
      if (!parent || (parent.companyId !== null && parent.companyId !== ctx.companyId)) {
        throw new BadRequestException('ไม่พบบัญชีแม่ในบริษัทนี้');
      }
    }

    const row = await this.repo.createAccount({
      companyId: ctx.companyId, code: input.code, nameTh: input.nameTh, nameEn: input.nameEn ?? null,
      accountClass: input.accountClass, reportGroup: input.reportGroup ?? null,
      normalBalance: input.normalBalance, parentAccountId: input.parentAccountId ?? null,
      isPosting: input.isPosting ?? true, isSystem: false, isControlled: false,
      taxCategory: input.taxCategory ?? null, cashFlowCategory: input.cashFlowCategory ?? null,
      sourceGroup1: null, sourceGroup2: null,
      status: 'ACTIVE', createdByUserId: ctx.userId,
    });

    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'ledger.account.create', targetType: 'chart_of_account', targetId: row.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { code: row.code } });
    return toSummary(row);
  }
}

@Injectable()
export class UpdateAccountUseCase {
  constructor(private readonly repo: PrismaLedgerRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, accountId: string, input: UpdateChartOfAccountInput): Promise<ChartOfAccountSummary> {
    requirePerm(ctx, 'ledger.account.manage');
    const existing = await this.repo.findAccountById(accountId);
    if (!existing || (existing.companyId !== null && existing.companyId !== ctx.companyId)) throw new NotFoundException('Account not found');
    if (existing.isSystem) throw new ForbiddenException('บัญชีระบบไม่สามารถแก้ไขได้');

    // H-02: input is DTO-whitelisted at the edge; the repository enforces the
    // terminal field allowlist, so no third copy of the field list here.
    const updated = await this.repo.updateAccount(accountId, { ...input, updatedByUserId: ctx.userId });

    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'ledger.account.update', targetType: 'chart_of_account', targetId: accountId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { status: input.status } });
    return toSummary(updated);
  }
}
