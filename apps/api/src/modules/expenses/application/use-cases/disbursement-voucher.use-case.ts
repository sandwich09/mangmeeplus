import { expenseWhtHeaderRate } from '../../domain/logic/expense-wht-input.logic';
import { eWhtRateKind, type ExpenseWhtInput } from '@watchdog-bms/contracts';
import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Optional, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { DISBURSEMENT_VOUCHER_STATUSES, DISBURSEMENT_VOUCHER_WORDS, EXPENSE_PAYMENT_METHODS, civilDateToUtcDate, coerceCivilDate, isCivilDate,
  DISBURSEMENT_VOUCHER_SLIP_UPLOAD_TAG, DISBURSEMENT_VOUCHER_SUPPORTING_UPLOAD_TAG, DISBURSEMENT_VOUCHER_SUPPORTING_PURPOSE, DISBURSEMENT_VOUCHER_SLIP_PURPOSE, DISBURSEMENT_VOUCHER_ATTACHMENT_TARGET_TYPE, REIMBURSEMENT_PAYMENT_SLIP_MAX_BYTES,
  disbursementExpenseReasonMessage, disbursementVoucherError,
  type RequestContext, type CreateDisbursementVoucherDraftInput, type UpdateDisbursementVoucherDraftInput, type DisbursementVoucherHeader,
  type DisbursementVoucherListQuery, type DisbursementVoucherListPage, type DisbursementVoucherDetail, type DisbursementVoucherErrorCode, type DisbursementVoucherRevisionDecision,
  type DisbursementVoucherCommandInput, type SubmitDisbursementVoucherInput, type EndDisbursementVoucherInput, type DisbursementVoucherLifecycleAction, type PayDisbursementVoucherInput, type IssueDisbursementVoucherInput, type ReissueDisbursementVoucherInput, type RemindDisbursementVoucherInput,
  civilDate, civilPeriodKey, todayCivilDate,
} from '@watchdog-bms/contracts';
import { PrismaExpenseRepository, assertEWhtPaymentMethod, assertActiveExpenseBranch, assertExpensePaymentSource, type ExpensePaymentResult } from '../../infrastructure/prisma-expense.repository';
import { PrismaDisbursementVoucherRepository, type DisbursementReadScope, type DisbursementDraftData, type DisbursementLifecycleVoucher, disbursementVoucherReadWhere } from '../../infrastructure/prisma-disbursement-voucher.repository';
import { lockExpenseCorrection, disbursementExpenseSelectionReason } from '../../infrastructure/expense-void-blocker';
import { assertDisbursementVoucherAction, disbursementPayeeIdentity, disbursementVoucherActions, disbursementVoucherHeader, disbursementVoucherPrimaryAction, disbursementVoucherSourceHash } from '../../domain/logic/disbursement-voucher.logic';
import { ListExpensesUseCase, recordExpensePaymentEffects } from './expense-draft.use-case';
import { AuditService } from '../../../audit/application/audit.service';
import { canonicalFingerprint } from '../../../../common/security/canonical-fingerprint';
import { normalizeVendorName, toAsciiDigits } from '../../../accounting-documents/domain/logic/vendor-counterparty-match.logic';
import { POSITIVE_ACCOUNTING_MONEY_PATTERN } from '../../../accounting-documents/domain/logic/accounting-money-validation.logic';
import { Prisma } from '../../../../generated/prisma/client';
import { isSerializationFailure } from '../../../../common/database/prisma-error';
import { eWhtPaymentMethodAllowed } from '@watchdog-bms/contracts';
import { isBranchInScope } from '../../../data-model-core/domain/logic/branch.logic';

import { DisbursementVoucherNoticeService } from '../services/disbursement-voucher-notice.service';
import { DisbursementVoucherFileService } from '../services/disbursement-voucher-file.service';
import { renderDisbursementVoucherSvg, type DisbursementVoucherPrintSnapshot, type DisbursementSignatureSnapshot } from '../../domain/logic/disbursement-voucher-pdf.logic';
import { renderSubstituteReceiptPdf } from '../../domain/logic/substitute-receipt-pdf.logic';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { encryptCredential } from '../../../system-partner-management/domain/logic/credential-cipher.logic';
import { openPayoutAccountNumber, payoutFingerprint } from '../../../reimbursements/domain/logic/payout-destination.logic';
import { CreateUploadIntentUseCase } from '../../../data-model-core/application/use-cases/create-upload-intent.use-case';
import { CompleteAttachmentUploadUseCase } from '../../../data-model-core/application/use-cases/complete-attachment-upload.use-case';
import { ATTACHMENT_STORAGE, type AttachmentStoragePort } from '../../../data-model-core/domain/ports/attachment-storage.port';
import { REIMBURSEMENT_PAYMENT_SLIP_MIME_TYPES } from '../../../reimbursements/domain/reimbursement.constants';
import { SIGNATURE_MAX_BYTES } from '../../domain/logic/signature-image.logic';
import { detectAttachmentMimeType } from '../../../data-model-core/domain/logic/attachment.logic';
import { withAttachmentCreate } from '../../../reimbursements/application/use-cases/reimbursement-claim-signature.use-case';

type Source = Awaited<ReturnType<PrismaExpenseRepository['readDisbursementExpenseSources']>>[number];

function invalid() { return new BadRequestException(disbursementVoucherError('disbursement_invalid_input')); }

function validateInput(body: CreateDisbursementVoucherDraftInput, update: boolean): void {
  const allowed = ['commandId', 'lines', 'payeeName', 'payeeBankName', 'payeeAccountName', 'payeeAccountNumber', 'payeeAccountFromVoucherId', 'payeeConfirmed', 'plannedPayDate', 'plannedMethod', 'note', ...(update ? ['expectedVersion'] : [])];
  if (!body || typeof body !== 'object' || Object.keys(body).some(key => !allowed.includes(key))
    || typeof body.commandId !== 'string' || !body.commandId.trim() || body.commandId.length > 128) throw invalid();
  if (!Array.isArray(body.lines)) throw invalid();
  if (!body.lines.length) throw new BadRequestException(disbursementVoucherError('disbursement_lines_required'));
  if (body.lines.length > 20) throw new BadRequestException(disbursementVoucherError('disbursement_too_many_lines'));
  for (const line of body.lines) if (!line || typeof line !== 'object' || typeof line.expenseId !== 'string' || !line.expenseId.trim()
    || Object.keys(line).some(key => !['expenseId', 'amount'].includes(key))) throw invalid();
  if (new Set(body.lines.map(l => l.expenseId)).size !== body.lines.length) throw new BadRequestException(disbursementVoucherError('disbursement_duplicate_expense'));
  for (const field of ['payeeName', 'note', 'payeeBankName', 'payeeAccountName', 'payeeAccountNumber', 'payeeAccountFromVoucherId'] as const) if (body[field] !== undefined && typeof body[field] !== 'string') throw invalid();
  if (body.payeeConfirmed !== undefined && typeof body.payeeConfirmed !== 'boolean'
    || body.plannedPayDate !== undefined && (typeof body.plannedPayDate !== 'string' || !isCivilDate(body.plannedPayDate))
    || body.plannedMethod !== undefined && !EXPENSE_PAYMENT_METHODS.includes(body.plannedMethod)) throw invalid();
  if (update && (!Number.isSafeInteger((body as UpdateDisbursementVoucherDraftInput).expectedVersion) || (body as UpdateDisbursementVoucherDraftInput).expectedVersion < 0)) throw invalid();
}

@Injectable()
export class DisbursementVoucherUseCase {
  constructor(private readonly repo: PrismaDisbursementVoucherRepository, private readonly expenseRepo: PrismaExpenseRepository,
    private readonly expenses: ListExpensesUseCase, private readonly audit: AuditService,
    @Optional() private readonly config?: AppConfigService, @Optional() private readonly files?: DisbursementVoucherFileService,
    @Optional() private readonly createUpload?: CreateUploadIntentUseCase, @Optional() private readonly completeUpload?: CompleteAttachmentUploadUseCase,
    @Optional() @Inject(ATTACHMENT_STORAGE) private readonly storage?: AttachmentStoragePort, @Optional() private readonly notices?: DisbursementVoucherNoticeService) {}

  private authorize(ctx: RequestContext, permissions: ('prepare' | 'approve' | 'read' | 'pay' | 'issue')[], lineConfirmed = false) {
    if (ctx.authProvider === 'line' && !lineConfirmed) throw new ForbiddenException(disbursementVoucherError('disbursement_line_session_denied'));
    if (!permissions.some(p => ctx.permissions.includes(`expense.disbursement.${p}`))) throw new ForbiddenException(disbursementVoucherError('disbursement_permission_denied'));
  }

  private scope(ctx: RequestContext, permission: 'prepare' | 'approve' | 'read' | 'pay' | 'issue' | 'manage', branchId?: string, lineConfirmed = false): DisbursementReadScope {
    this.authorize(ctx, permission === 'manage' ? ['prepare', 'approve'] : [permission], lineConfirmed);
    const read = this.expenses.readScope(ctx, branchId);
    return { companyId: ctx.companyId, ...read.filter, scopes: ctx.scopes, relatedUserId: read.scope.relatedUserId };
  }

  private async prepare(ctx: RequestContext, body: CreateDisbursementVoucherDraftInput, scope: DisbursementReadScope, tx: Prisma.TransactionClient, currentSources?: Source[]): Promise<DisbursementDraftData> {
    validateInput(body, 'expectedVersion' in body);
    const sources = currentSources ?? await this.expenseRepo.readDisbursementExpenseSources({ companyId: scope.companyId, createdByUserId: scope.createdByUserId, expenseIds: body.lines.map(l => l.expenseId) }, scope.scopes, scope.relatedUserId, tx);
    if (sources.length !== body.lines.length) throw new UnprocessableEntityException(disbursementVoucherError('disbursement_expense_unreadable'));
    if (!eWhtPaymentMethodAllowed(body.plannedMethod) && sources.some(source => source.whtRemittance === 'E_WHT')) {
      throw new ConflictException(disbursementVoucherError('disbursement_ewht_planned_method'));
    }
    const byId = new Map(sources.map(e => [e.id, e]));
    const ordered = body.lines.map(l => byId.get(l.expenseId)!);
    let total = new Decimal(0);
    const lines = body.lines.map((line, i) => {
      const expense = ordered[i]!;
      const reason = disbursementExpenseSelectionReason(expense);
      if (reason) throw new UnprocessableEntityException({ code: `disbursement_expense_${reason}` as DisbursementVoucherErrorCode,
        message: `รายการ ${expense.expenseNumber || 'ที่เลือก'}: ${disbursementExpenseReasonMessage(reason, expense.reservation?.documentNumber)}` });
      if (typeof line.amount !== 'string' || !POSITIVE_ACCOUNTING_MONEY_PATTERN.test(line.amount) || new Decimal(line.amount).gt(new Decimal(String(expense.outstandingAmount)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP))) {
        throw new UnprocessableEntityException(disbursementVoucherError('disbursement_amount_invalid', { number: expense.expenseNumber || 'ที่เลือก', outstanding: new Decimal(String(expense.outstandingAmount)).toFixed(4) }));
      }
      total = total.plus(line.amount);
      return { expenseId: line.expenseId, amount: new Decimal(line.amount).toFixed(4), position: i + 1 };
    });
    const first = ordered[0]!;
    if (ordered.some(e => e.branchId !== first.branchId)) throw new UnprocessableEntityException(disbursementVoucherError('disbursement_branch_mismatch'));
    await assertActiveExpenseBranch(tx, ctx.companyId, first.branchId);
    const taxId = toAsciiDigits(first.vendorTaxIdSnapshot);
    const sameTaxId = taxId.length === 13 && ordered.every(e => toAsciiDigits(e.vendorTaxIdSnapshot) === taxId);
    const name = normalizeVendorName(first.vendorNameSnapshot);
    const sameNameWithoutTaxId = Boolean(name) && ordered.every(e => !e.vendorTaxIdSnapshot?.trim() && normalizeVendorName(e.vendorNameSnapshot) === name);
    const payeeBasis = lines.length === 1 ? 'SINGLE' : sameTaxId ? 'TAX_ID' : sameNameWithoutTaxId ? 'SAME_NAME' : 'PREPARER_CONFIRMED';
    if (payeeBasis === 'PREPARER_CONFIRMED' && !body.payeeConfirmed) throw new UnprocessableEntityException(disbursementVoucherError('disbursement_payee_confirmation_required'));
    if (total.gt('99999999999999.9999')) throw new UnprocessableEntityException(disbursementVoucherError('disbursement_total_overflow'));
    return { branchId: first.branchId!, payeeName: body.payeeName?.trim() || first.vendorNameSnapshot?.trim() || DISBURSEMENT_VOUCHER_WORDS.unnamedPayee,
      payeeTaxId: first.vendorTaxIdSnapshot, payeeBranchCode: first.vendorBranchCodeSnapshot, payeeBasis,
      payeeConfirmedByUserId: payeeBasis === 'PREPARER_CONFIRMED' ? ctx.userId : null,
      plannedPayDate: body.plannedPayDate ? civilDateToUtcDate(body.plannedPayDate) : null, plannedMethod: body.plannedMethod ?? null,
      note: body.note ?? null, totalAmount: total.toFixed(4), lines };
  }

  private account(body: CreateDisbursementVoucherDraftInput): Pick<DisbursementDraftData, 'payeeBankName' | 'payeeAccountName' | 'payeeAccountLast4' | 'payeeAccountCiphertext'> {
    if (body.payeeAccountNumber === undefined) return {
      ...(body.payeeBankName !== undefined ? { payeeBankName: body.payeeBankName.trim() || null } : {}),
      ...(body.payeeAccountName !== undefined ? { payeeAccountName: body.payeeAccountName.trim() || null } : {}),
    };
    const number = body.payeeAccountNumber.replace(/[\s-]/g, '');
    if (!number) return { payeeBankName: null, payeeAccountName: null, payeeAccountLast4: null, payeeAccountCiphertext: null };
    if (!/^\d{6,20}$/.test(number)) throw new BadRequestException(disbursementVoucherError('disbursement_account_number_invalid'));
    if (!body.payeeBankName?.trim()) throw new BadRequestException(disbursementVoucherError('disbursement_account_bank_required'));
    return { payeeBankName: body.payeeBankName.trim(), payeeAccountName: body.payeeAccountName?.trim() || null,
      payeeAccountLast4: number.slice(-4), payeeAccountCiphertext: encryptCredential(number, this.config!.credentialEncryptionKey) };
  }

  async payeeAccount(ctx: RequestContext, payeeKey: string, branchId?: string) {
    const scope = this.scope(ctx, 'prepare', branchId);
    if (typeof payeeKey !== 'string' || !payeeKey.trim()) throw invalid();
    return this.repo.payeeAccount(scope, payeeKey, branchId);
  }

  /** Internal signed-card lane; HTTP callers retain the default LINE-session denial. */
  async previewLineAction(ctx: RequestContext, action: 'create' | 'submit' | 'approve' | 'return' | 'pay' | 'cancel', input: {
    id?: string; draft?: CreateDisbursementVoucherDraftInput; reason?: string; payment?: PayDisbursementVoucherInput;
  }) {
    const permission = action === 'create' || action === 'submit' ? 'prepare' : action === 'approve' || action === 'return' ? 'approve' : action === 'pay' ? 'pay' : 'manage';
    const scope = this.scope(ctx, permission, undefined, true);
    return this.repo.readTransaction(async tx => {
      if (action === 'create') return this.prepare(ctx, input.draft!, scope, tx);
      const voucher = await this.repo.findVisible(scope, input.id!);
      if (!voucher) throw new NotFoundException(disbursementVoucherError('disbursement_not_found'));
      const preparersInactive = (action === 'return' || action === 'cancel') && await this.repo.canOwnerRecover(voucher, true, tx);
      assertDisbursementVoucherAction(voucher, action, ctx.permissions, ctx.userId, ctx.roles.includes('OWNER') && preparersInactive, preparersInactive);
      if ((action === 'return' || action === 'cancel') && (!input.reason || input.reason.trim().length < 3)) throw new BadRequestException(disbursementVoucherError(action === 'return' ? 'disbursement_return_reason_required' : 'disbursement_cancel_reason_required'));
      if (action === 'submit') await this.prepare(ctx, { commandId: 'line-preview', lines: voucher.lines.map(l => ({ expenseId: l.expenseId, amount: new Decimal(String(l.amount)).toString() })), payeeName: voucher.payeeName, payeeConfirmed: voucher.payeeBasis === 'PREPARER_CONFIRMED', plannedMethod: voucher.plannedMethod ?? undefined }, scope, tx);
      if (action === 'approve' || action === 'pay') await this.verifiedSources(tx, scope, voucher, ctx, action === 'pay');
      if (action === 'pay') {
        const payment = input.payment!;
        if (!payment.paymentMethod && !voucher.plannedMethod) throw new BadRequestException(disbursementVoucherError('disbursement_payment_method_required'));
        if (payment.paymentMethod !== undefined && !EXPENSE_PAYMENT_METHODS.includes(payment.paymentMethod) || payment.paidDate !== undefined && !isCivilDate(payment.paidDate)) throw invalid();
        for (const source of (await this.sources(tx, scope, voucher))) {
          assertExpensePaymentSource(source, payment.paidDate ?? todayCivilDate('Asia/Bangkok'));
          assertEWhtPaymentMethod(source, payment.paymentMethod ?? voucher.plannedMethod);
        }
      }
      return disbursementVoucherHeader(voucher);
    });
  }

  async revealAccount(ctx: RequestContext, id: string, purpose?: 'prefill') {
    this.authorize(ctx, purpose === 'prefill' ? ['prepare'] : ['prepare', 'approve', 'pay']);
    const read = this.expenses.readScope(ctx);
    const voucher = await this.repo.findVisible({ companyId: ctx.companyId, ...read.filter, scopes: ctx.scopes, relatedUserId: read.scope.relatedUserId }, id);
    if (!voucher) throw new NotFoundException(disbursementVoucherError('disbursement_not_found'));
    if (purpose !== 'prefill' && !disbursementVoucherActions(voucher, ctx.permissions, ctx.userId).edit
      && !['expense.disbursement.approve', 'expense.disbursement.pay'].some(p => ctx.permissions.includes(p)))
      throw new ForbiddenException(disbursementVoucherError('disbursement_permission_denied'));
    if (!voucher.payeeAccountCiphertext) throw new BadRequestException(disbursementVoucherError('disbursement_account_missing'));
    await this.retryable(() => this.audit.logOrThrow({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'expense.disbursement.payee_account.reveal',
      targetType: 'disbursement_voucher', targetId: id, requestId: ctx.requestId, riskLevel: 'HIGH', result: 'SUCCESS',
      ...(purpose ? { metadataJson: { purpose } } : {}) }));
    return { accountNumber: openPayoutAccountNumber(voucher.payeeAccountCiphertext, this.config!.credentialEncryptionKey) };
  }

  private async save(ctx: RequestContext, body: CreateDisbursementVoucherDraftInput, id?: string, lineConfirmed = false, sourceRevisions?: { id: string; revision: string }[]): Promise<DisbursementVoucherHeader> {
    const scope = this.scope(ctx, 'prepare', undefined, lineConfirmed);
    validateInput(body, Boolean(id));
    const account = this.account(body);
    const accountIntent = body.payeeAccountNumber !== undefined || body.payeeBankName !== undefined || body.payeeAccountName !== undefined || body.payeeAccountFromVoucherId !== undefined;
    const payloadFingerprint = canonicalFingerprint({ version: accountIntent ? 2 : 1, operation: id ? 'update' : 'create', id: id ?? null,
      ...(accountIntent ? { payeeBankName: body.payeeBankName ?? null, payeeAccountName: body.payeeAccountName ?? null,
      accountFingerprint: body.payeeAccountNumber === undefined ? null : body.payeeAccountNumber.replace(/[\s-]/g, '') ? payoutFingerprint({ payoutKind: 'BANK_ACCOUNT', bankName: account.payeeBankName ?? null, accountName: account.payeeAccountName ?? '', accountNumber: body.payeeAccountNumber.replace(/[\s-]/g, '') }, this.config!.credentialEncryptionKey) : 'cleared' } : {}),
      ...(body.payeeAccountFromVoucherId ? { payeeAccountFromVoucherId: body.payeeAccountFromVoucherId } : {}),
      lines: body.lines, payeeName: body.payeeName ?? null, payeeConfirmed: body.payeeConfirmed ?? null,
      plannedPayDate: body.plannedPayDate ?? null, plannedMethod: body.plannedMethod ?? null, note: body.note ?? null,
      expectedVersion: id ? (body as UpdateDisbursementVoucherDraftInput).expectedVersion : null,
    });
    return this.retryable(() => this.repo.saveDraftAtomic({ ...scope, id, expectedVersion: id ? (body as UpdateDisbursementVoucherDraftInput).expectedVersion : undefined,
      actorUserId: ctx.userId, permissions: ctx.permissions, commandId: body.commandId, payloadFingerprint },
      async tx => {
        if (sourceRevisions) {
          // Compare after taking the same source locks as submit/pay, so a card cannot race an expense edit.
          for (const source of [...sourceRevisions].sort((a, b) => a.id.localeCompare(b.id))) await lockExpenseCorrection(tx, ctx.companyId, source.id);
          const current = await tx.expenseRecord.findMany({ where: { companyId: ctx.companyId, id: { in: sourceRevisions.map(row => row.id) } }, select: { id: true, updatedAt: true } });
          if (current.length !== sourceRevisions.length || current.some(row => sourceRevisions.find(source => source.id === row.id)?.revision !== row.updatedAt.toISOString())) throw new ConflictException(disbursementVoucherError('disbursement_source_changed', { number: 'ที่เลือก' }));
        }
        if (id && account.payeeBankName === null && body.payeeAccountNumber === undefined) {
          const current = await tx.disbursementVoucher.findFirst({ where: { companyId: ctx.companyId, id } });
          if (current?.payeeAccountCiphertext) throw new BadRequestException(disbursementVoucherError('disbursement_account_bank_required'));
        }
        const draft = await this.prepare(ctx, body, scope, tx);
        if (body.payeeAccountFromVoucherId && !body.payeeAccountNumber?.trim()) {
          const source = await tx.disbursementVoucher.findFirst({ where: { ...disbursementVoucherReadWhere(scope), id: body.payeeAccountFromVoucherId },
            include: { lines: { orderBy: { position: 'asc' }, take: 1, include: { expense: true } } } });
          if (!source) throw new ForbiddenException(disbursementVoucherError('disbursement_account_source_denied'));
          const expenses = await this.expenseRepo.readDisbursementExpenseSources({ companyId: ctx.companyId, createdByUserId: scope.createdByUserId, expenseIds: body.lines.map(l => l.expenseId) }, scope.scopes, scope.relatedUserId, tx);
          const key = source.lines[0] && disbursementPayeeIdentity(source.lines[0].expense).payeeKey;
          const payee = expenses.find(e => e.id === body.lines[0]!.expenseId);
          if (!key || !payee || disbursementPayeeIdentity(payee).payeeKey !== key || !source.payeeAccountCiphertext || !source.payeeAccountLast4)
            throw new ConflictException(disbursementVoucherError('disbursement_account_source_mismatch'));
          return { ...draft, payeeBankName: source.payeeBankName, payeeAccountName: source.payeeAccountName,
            payeeAccountLast4: source.payeeAccountLast4, payeeAccountCiphertext: source.payeeAccountCiphertext };
        }
        return { ...draft, ...account };
      }, (tx, header) => this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId,
        action: id ? 'expense.disbursement.draft_updated' : 'expense.disbursement.draft_created', targetType: 'disbursement_voucher', targetId: header.id,
        requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW', metadataJson: { commandId: body.commandId, version: header.version, lineCount: body.lines.length, ...(body.payeeAccountFromVoucherId && !body.payeeAccountNumber?.trim() ? { payeeAccountFromVoucherId: body.payeeAccountFromVoucherId } : {}) } }, tx)));
  }

  create(ctx: RequestContext, body: CreateDisbursementVoucherDraftInput, lineConfirmed = false, sourceRevisions?: { id: string; revision: string }[]) { return this.save(ctx, body, undefined, lineConfirmed, sourceRevisions); }
  update(ctx: RequestContext, id: string, body: UpdateDisbursementVoucherDraftInput) { return this.save(ctx, body, id); }

  async delete(ctx: RequestContext, id: string): Promise<void> {
    const scope = this.scope(ctx, 'prepare');
    await this.retryable(() => this.repo.deleteDraftAtomic(scope, id, ctx.permissions, tx => this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId,
      action: 'expense.disbursement.draft_deleted', targetType: 'disbursement_voucher', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW' }, tx)));
  }

  list(ctx: RequestContext, query: DisbursementVoucherListQuery): Promise<DisbursementVoucherListPage> {
    return this.listScoped(ctx, query, false);
  }

  listForLine(ctx: RequestContext, query: DisbursementVoucherListQuery): Promise<DisbursementVoucherListPage> {
    return this.listScoped(ctx, query, true);
  }

  private async listScoped(ctx: RequestContext, query: DisbursementVoucherListQuery, lineRead: boolean): Promise<DisbursementVoucherListPage> {
    const scope = this.scope(ctx, 'read', query.branchId, lineRead);
    if (query.q !== undefined && typeof query.q !== 'string' || query.branchId !== undefined && typeof query.branchId !== 'string' || query.status !== undefined && !DISBURSEMENT_VOUCHER_STATUSES.includes(query.status) || query.order !== undefined && query.order !== 'newest' && query.order !== 'oldest') throw invalid();
    const page = Number.isFinite(query.page) ? Math.max(1, Math.floor(query.page!)) : 1;
    const pageSize = Number.isFinite(query.pageSize) ? Math.min(200, Math.max(1, Math.floor(query.pageSize!))) : 20;
    const result = await this.repo.list(scope, { ...query, order: query.order ?? 'newest', page, pageSize });
    return { counts: result.counts, sums: result.sums, total: result.total, page, pageSize, data: result.rows.map(v => {
      const header = disbursementVoucherHeader(v);
      return { id: v.id, documentNumber: v.documentNumber, status: header.status, origin: header.origin, payeeName: v.payeeName,
        plannedPayDate: header.plannedPayDate, paidDate: header.paidDate, totalAmount: header.totalAmount, amountInEffect: result.amountsInEffect.get(v.id) ?? null,
        createdAt: header.createdAt, canDelete: disbursementVoucherActions(v, ctx.permissions, ctx.userId).delete,
        lineCount: v._count.lines, primaryAction: disbursementVoucherPrimaryAction(header.status, ctx.permissions) };
    }) };
  }

  async get(ctx: RequestContext, id: string, lineConfirmed = false): Promise<DisbursementVoucherDetail> {
    const voucher = await this.repo.findVisible(this.scope(ctx, 'read', undefined, lineConfirmed), id, true);
    if (!voucher) throw new NotFoundException(disbursementVoucherError('disbursement_not_found'));
    const snapshot = voucher.paidSnapshotJson as unknown as { lines?: { expenseId: string; sourceHashAfterPaid?: string; vendorName: string | null; vendorTaxId?: string | null; netPayable: string; outstandingAfter: string }[] } | null;
    const related = (v: typeof voucher.related[number] | undefined) => v?.documentNumber ? { id: voucher.visibleRelated.has(v.id) ? v.id : null, documentNumber: v.documentNumber } : null;
    const replacement = voucher.related.find(v => v.replacesVoucherId === voucher.id);
    const sourceChangedAfterPaid = voucher.status === 'PAID' && voucher.lines.some(line => {
      const frozen = snapshot?.lines?.find(l => l.expenseId === line.expenseId);
      if (!frozen) return false;
      const revision = voucher.revisions.find(r => r.revision === voucher.revision)?.snapshotJson as { lines?: { expenseId: string; vendorTaxId: string | null }[] } | undefined;
      const frozenTaxId = frozen.vendorTaxId !== undefined ? frozen.vendorTaxId : revision?.lines?.find(l => l.expenseId === line.expenseId)?.vendorTaxId;
      const baseline = frozen.sourceHashAfterPaid ?? disbursementVoucherSourceHash({ status: 'CONFIRMED', branchId: voucher.branchId, currency: voucher.currency,
        vendorNameSnapshot: frozen.vendorName, vendorTaxIdSnapshot: frozenTaxId !== undefined ? frozenTaxId : voucher.payeeTaxId,
        netPayableAmount: frozen.netPayable, outstandingAmount: frozen.outstandingAfter });
      return disbursementVoucherSourceHash(line.expense) !== baseline;
    });
    const printSnapshot = (voucher.paidSnapshotJson ?? voucher.revisions.find(r => r.revision === voucher.revision)?.snapshotJson) as unknown as DisbursementVoucherPrintSnapshot | undefined;
    const name = (id: string | null | undefined) => voucher.names.get(id ?? '') ?? null;
    const activeAuthors = await this.repo.activeMemberIds(ctx.companyId, [voucher.preparedByUserId, ...(voucher.submittedByUserId ? [voucher.submittedByUserId] : [])]);
    const preparerActive = activeAuthors.includes(voucher.preparedByUserId), senderActive = Boolean(voucher.submittedByUserId && activeAuthors.includes(voucher.submittedByUserId));
    const preparersInactive = !preparerActive && !senderActive;
    return { hasOwnSignature: Boolean(await this.expenseRepo.findReusableSignatureAsset(ctx.companyId, ctx.userId)), header: { ...disbursementVoucherHeader(voucher), returnedByName: name(voucher.returnedByUserId), cancelledByName: name(voucher.cancelledByUserId) }, sourceChangedAfterPaid,
      canReissue: voucher.status === 'CANCELLED' && voucher.cancelledAfterPaid && ctx.permissions.includes('expense.disbursement.issue') && !replacement && voucher.uncoveredLivePayments.size > 0,
      reissuedVoucher: related(replacement), replacesVoucher: related(voucher.related.find(v => v.id === voucher.replacesVoucherId)), payeeConfirmerName: voucher.payeeConfirmerName,
      lastReminderToName: name(voucher.lastReminderToUserId), nextReminderAt: voucher.lastReminderAt ? new Date(voucher.lastReminderAt.getTime() + 3600000).toISOString() : null,
      returnedByName: name(voucher.returnedByUserId), cancelledByName: name(voucher.cancelledByUserId),
      preparerActive, senderActive,
      preparerName: name(voucher.preparedByUserId), submittedByName: name(voucher.submittedByUserId), requestedApproverName: name(voucher.requestedApproverUserId), approvedByName: name(voucher.approvedByUserId), paidByName: name(voucher.paidByUserId),
      actions: disbursementVoucherActions(voucher, ctx.permissions, ctx.userId, ctx.roles.includes('OWNER') && preparersInactive, preparersInactive),
      slip: voucher.slip ? { attachmentId: voucher.slip.attachmentId, attachedByUserId: voucher.slip.linkedByUserId,
        attachedByName: name(voucher.slip.linkedByUserId), attachedAt: voucher.slip.createdAt.toISOString() } : null,
      supportingFiles: await this.readSupportingFiles(ctx, id),
      canAttachSlip: (voucher.status === 'APPROVED' || voucher.status === 'PAID') && ctx.permissions.includes('expense.disbursement.pay'),
      lines: voucher.lines.map(line => ({ expenseId: line.expenseId, expenseNumber: line.expense.expenseNumber, expenseDate: coerceCivilDate(line.expense.expenseDate),
        vendorInvoiceNumber: line.expense.vendorDocumentNumber ?? null,
        vendorName: line.expense.vendorNameSnapshot, vendorTaxId: line.expense.vendorTaxIdSnapshot, branchId: line.expense.branchId,
        whtRemittance: line.expense.whtRemittance ?? null,
        eWhtReducedRateApplied: line.expense.whtRemittance === 'E_WHT' && eWhtRateKind(line.expense.whtCategoryCode) === 'REDUCED'
          && Number(expenseWhtHeaderRate(line.expense.whtInputJson as ExpenseWhtInput | null, line.expense.lines, line.expense.whtRate)) === 1,
        grandTotalAmount: new Decimal(String(line.expense.grandTotalAmount)).toFixed(4), whtAmount: new Decimal(String(line.expense.whtAmount)).toFixed(4),
        netPayableAmount: new Decimal(String(line.expense.netPayableAmount)).toFixed(4), outstandingAmount: new Decimal(String(line.expense.outstandingAmount)).toFixed(4),
        amount: new Decimal(String(line.amount)).toFixed(4), position: line.position, expensePaymentId: line.expensePaymentId,
        description: voucher.status === 'DRAFT' ? Array.from(line.expense.lines?.[0]?.description?.trim() || '').slice(0, 80).join('') || null
          : printSnapshot?.lines?.find(l => l.expenseId === line.expenseId)?.description ?? null,
        paymentInEffect: Boolean(line.expensePaymentId && voucher.livePayments.has(line.expensePaymentId)),
        withholdingCertificate: voucher.withholdingCertificates.get(line.expenseId) ?? { state: 'NONE', number: null } })),
      revisions: voucher.revisions.map(r => ({ revision: r.revision, snapshotJson: r.snapshotJson, snapshotHash: r.snapshotHash, requestedApproverUserId: r.requestedApproverUserId ?? null, requestedApproverName: name(r.requestedApproverUserId),
        submittedByUserId: r.submittedByUserId, submittedByName: name(r.submittedByUserId), submittedAt: r.submittedAt.toISOString(), decision: r.decision as DisbursementVoucherRevisionDecision | null, decidedByUserId: r.decidedByUserId, decidedByName: name(r.decidedByUserId),
        decidedAt: r.decidedAt?.toISOString() ?? null, decisionReason: r.decisionReason,
        postApprovalAction: r.postApprovalAction as 'WITHDRAWN' | 'CANCELLED' | null, postApprovalByUserId: r.postApprovalByUserId,
        postApprovalByName: name(r.postApprovalByUserId), postApprovalAt: r.postApprovalAt?.toISOString() ?? null, postApprovalReason: r.postApprovalReason })),
    };
  }

  private async visibleFileDocument(ctx: RequestContext, id: string) {
    if (ctx.authProvider === 'line') throw new ForbiddenException(disbursementVoucherError('disbursement_line_session_denied'));
    const missing = () => new NotFoundException(disbursementVoucherError('disbursement_not_found'));
    if (!ctx.permissions.includes('expense.disbursement.read')) throw missing();
    let scope: DisbursementReadScope;
    try { scope = this.scope(ctx, 'read'); } catch (error) { if (error instanceof ForbiddenException) throw missing(); throw error; }
    const voucher = await this.repo.findVisible(scope, id);
    if (!voucher) throw missing();
    return voucher;
  }

  async documentPdf(ctx: RequestContext, id: string): Promise<{ data: Buffer; fileName: string }> {
    const voucher = await this.visibleFileDocument(ctx, id);
    if (voucher.status === 'PAID') {
      try { return await this.files!.ensure(ctx.companyId, id); }
      catch { throw new ServiceUnavailableException(disbursementVoucherError('disbursement_file_unavailable')); }
    }
    const paid = voucher.status === 'CANCELLED' && voucher.cancelledAfterPaid;
    const revision = voucher.revisions.find(r => r.revision === voucher.revision);
    const snapshot = (paid ? voucher.paidSnapshotJson : revision?.snapshotJson) as unknown as DisbursementVoucherPrintSnapshot | undefined;
    if (!snapshot) throw new BadRequestException(disbursementVoucherError('disbursement_print_unsubmitted'));
    const approver = revision?.decision === 'APPROVED' || revision?.postApprovalAction ? {
      name: voucher.names.get(revision.decidedByUserId ?? '') ?? null, at: revision.decidedAt?.toISOString() ?? null,
      selfApproved: revision.decidedByUserId === revision.submittedByUserId,
      signature: voucher.approverSignatureJson as DisbursementSignatureSnapshot | null,
    } : {};
    const cancellation = voucher.status === 'CANCELLED' ? {
      at: voucher.cancelledAt?.toISOString() ?? null, reason: paid ? voucher.cancelSourceReason : voucher.cancelReason,
      expenseNumbers: voucher.lines.filter(l => l.expensePaymentId && !voucher.livePayments.has(l.expensePaymentId))
        .map(l => snapshot.lines.find(frozen => frozen.expenseId === l.expenseId)?.expenseNumber ?? l.expense.expenseNumber ?? '-'),
      expenseIds: voucher.lines.filter(l => l.expensePaymentId && !voucher.livePayments.has(l.expensePaymentId)).map(l => l.expenseId),
      reissuedDocumentNumber: voucher.related.find(v => v.replacesVoucherId === voucher.id)?.documentNumber,
    } : undefined;
    // The stored paid file remains evidence. Only this served copy carries the current cancellation.
    // Older snapshots lack these print-only facts. Read them through the same visible expenses;
    // never rewrite a revision, a paid snapshot or the stored PDF.
    const company = snapshot.company?.phone === undefined ? await this.repo.companyForPrint(ctx.companyId) : null;
    const print: DisbursementVoucherPrintSnapshot = { ...snapshot, documentNumber: voucher.documentNumber, revision: voucher.revision,
      company: { ...company, ...snapshot.company }, documentDate: snapshot.documentDate ?? voucher.createdAt.toISOString(),
      plannedPayDate: snapshot.plannedPayDate === undefined ? (voucher.plannedPayDate ? coerceCivilDate(voucher.plannedPayDate) : null) : snapshot.plannedPayDate,
      lines: snapshot.lines.map(line => {
        const expense = voucher.lines.find(l => l.expenseId === line.expenseId)?.expense;
        return { ...line,
          vendorDocumentNumber: line.vendorDocumentNumber === undefined ? expense?.vendorDocumentNumber ?? null : line.vendorDocumentNumber,
          vendorAddress: line.vendorAddress === undefined ? expense?.vendorAddressSnapshot ?? null : line.vendorAddress,
          vendorBranchCode: line.vendorBranchCode === undefined ? expense?.vendorBranchCodeSnapshot ?? null : line.vendorBranchCode,
          vendorTaxId: line.vendorTaxId === undefined ? expense?.vendorTaxIdSnapshot ?? null : line.vendorTaxId };
      }),
      snapshotHash: (paid ? voucher.paidSnapshotHash : revision?.snapshotHash) ?? undefined,
      actors: paid ? snapshot.actors : { ...snapshot.actors, preparer: { ...snapshot.actors?.preparer, signature: voucher.preparerSignatureJson as DisbursementSignatureSnapshot | null }, approver }, cancellation };
    if (print.payeeAccount && voucher.payeeAccountCiphertext
      && print.payeeAccount.last4 === voucher.payeeAccountLast4
      && print.payeeAccount.bankName === voucher.payeeBankName && print.payeeAccount.accountName === voucher.payeeAccountName
      && ['expense.disbursement.approve', 'expense.disbursement.pay'].some(p => ctx.permissions.includes(p))) {
      print.payeeAccount = { ...print.payeeAccount, ...(await this.revealAccount(ctx, id)) };
    }
    return { data: await renderSubstituteReceiptPdf(renderDisbursementVoucherSvg(this.files ? await this.files.withSignatures(ctx.companyId, print) : print, paid), voucher.documentNumber ?? undefined, { omitPageFooter: true }), fileName: `${voucher.documentNumber}.pdf` };
  }

  private async finishPaid(header: DisbursementVoucherHeader): Promise<DisbursementVoucherHeader> {
    if (!(header.status === 'PAID' || header.cancelledAfterPaid)) return header;
    if (header.documentFileReady) return header;
    try { await this.files!.ensure(header.companyId, header.id); return { ...header, documentFileReady: true }; }
    catch { return { ...header, documentFileReady: false }; }
  }

  private async supportingDraft(ctx: RequestContext, id: string) {
    const scope = this.scope(ctx, 'prepare');
    const voucher = await this.repo.findVisible(scope, id);
    if (!voucher) throw new NotFoundException(disbursementVoucherError('disbursement_not_found'));
    if (voucher.status !== 'DRAFT') throw new ConflictException(disbursementVoucherError('disbursement_supporting_frozen'));
    return { scope, voucher };
  }

  async startSupportingUpload(ctx: RequestContext, id: string, input: { originalFileName: string; mimeType: string; byteSize: number }) {
    const { voucher } = await this.supportingDraft(ctx, id);
    if (!REIMBURSEMENT_PAYMENT_SLIP_MIME_TYPES.includes(input.mimeType) || !Number.isInteger(input.byteSize) || input.byteSize <= 0 || input.byteSize > REIMBURSEMENT_PAYMENT_SLIP_MAX_BYTES)
      throw new BadRequestException(disbursementVoucherError('disbursement_supporting_invalid'));
    return this.retryable(() => this.createUpload!.execute(withAttachmentCreate(ctx), { originalFileName: input.originalFileName, mimeType: input.mimeType, byteSize: input.byteSize, visibility: 'INTERNAL', branchId: voucher.branchId,
      metadataJson: { generatedFor: DISBURSEMENT_VOUCHER_SUPPORTING_UPLOAD_TAG, voucherId: id } }));
  }

  async completeSupportingUpload(ctx: RequestContext, id: string, attachmentId: string, input: { checksumSha256?: string; byteSize?: number }) {
    await this.supportingDraft(ctx, id);
    const file = await this.repo.findSupportingUpload(ctx.companyId, id, attachmentId, ctx.userId);
    if (!file) throw new BadRequestException(disbursementVoucherError('disbursement_supporting_not_owned'));
    if (file.status !== 'ACTIVE') await this.retryable(() => this.completeUpload!.execute(withAttachmentCreate(ctx), { attachmentId, ...input }));
    return { attachmentId };
  }

  async changeSupportingFile(ctx: RequestContext, id: string, attachmentId: string, remove: boolean) {
    const { scope } = await this.supportingDraft(ctx, id);
    await this.retryable(() => this.repo.changeSupportingFileAtomic(scope, id, attachmentId, ctx.userId, remove, tx => this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: `expense.disbursement.supporting.${remove ? 'remove' : 'attach'}`,
      targetType: 'disbursement_voucher', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { attachmentId } }, tx)));
    return this.readSupportingFiles(ctx, id);
  }

  async supportingFiles(ctx: RequestContext, id: string) {
    await this.visibleFileDocument(ctx, id);
    return this.readSupportingFiles(ctx, id);
  }

  private async readSupportingFiles(ctx: RequestContext, id: string) {
    const links = (await this.repo.supportingFiles(ctx.companyId, id)).filter(l => isBranchInScope(ctx.scopes, l.attachment.branchId));
    const names = await this.repo.memberNames(ctx.companyId, links.map(l => l.attachment.uploadedByUserId), undefined, true);
    return links.map(({ attachment: a, createdAt }) => ({ id: a.id, name: a.originalFileName, mimeType: a.mimeType, byteSize: a.byteSize,
      uploadedByUserId: a.uploadedByUserId, uploadedByName: names.get(a.uploadedByUserId) ?? null, uploadedAt: (a.uploadedAt ?? createdAt).toISOString() }));
  }

  private async supportingFile(ctx: RequestContext, id: string, attachmentId: string) {
    await this.visibleFileDocument(ctx, id);
    const file = (await this.repo.supportingFiles(ctx.companyId, id)).find(l => l.attachmentId === attachmentId)?.attachment;
    if (!file || !isBranchInScope(ctx.scopes, file.branchId)) throw new NotFoundException(disbursementVoucherError('disbursement_supporting_missing'));
    return file;
  }

  async openSupportingFile(ctx: RequestContext, id: string, attachmentId: string) {
    const file = await this.supportingFile(ctx, id, attachmentId);
    const signed = await this.storage!.createDownloadUrl({ bucket: file.bucket, objectKey: file.objectKey, objectVersionId: file.objectVersionId ?? undefined, mimeType: file.mimeType, fileName: file.originalFileName });
    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'expense.disbursement.supporting.open', targetType: 'disbursement_voucher', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { attachmentId } });
    return { downloadUrl: signed.url, expiresAt: signed.expiresAt };
  }

  async supportingFileBytes(ctx: RequestContext, id: string, attachmentId: string) {
    const file = await this.supportingFile(ctx, id, attachmentId);
    const object = await this.storage!.getObject({ bucket: file.bucket, objectKey: file.objectKey, objectVersionId: file.objectVersionId ?? undefined });
    return { data: object.bytes, mimeType: file.mimeType };
  }

  private async slipForPayer(ctx: RequestContext, id: string, lineConfirmed = false) {
    const scope = this.scope(ctx, 'pay', undefined, lineConfirmed);
    const voucher = await this.repo.findVisible(scope, id);
    if (!voucher) throw new NotFoundException(disbursementVoucherError('disbursement_not_found'));
    if (voucher.status !== 'APPROVED' && voucher.status !== 'PAID') throw new ConflictException(disbursementVoucherError('disbursement_slip_status'));
    return { voucher, scope };
  }

  async startSlipUpload(ctx: RequestContext, id: string, input: { originalFileName: string; mimeType: string; byteSize: number }, lineConfirmed = false) {
    const { voucher } = await this.slipForPayer(ctx, id, lineConfirmed);
    if (!REIMBURSEMENT_PAYMENT_SLIP_MIME_TYPES.includes(input.mimeType) || !Number.isInteger(input.byteSize)
      || input.byteSize <= 0 || input.byteSize > REIMBURSEMENT_PAYMENT_SLIP_MAX_BYTES) throw new BadRequestException(disbursementVoucherError('disbursement_slip_invalid'));
    return this.retryable(() => this.createUpload!.execute(withAttachmentCreate(ctx), { originalFileName: input.originalFileName,
      mimeType: input.mimeType, byteSize: input.byteSize, visibility: 'INTERNAL', branchId: voucher.branchId,
      metadataJson: { generatedFor: DISBURSEMENT_VOUCHER_SLIP_UPLOAD_TAG, voucherId: id } }));
  }

  async completeSlipUpload(ctx: RequestContext, id: string, attachmentId: string, input: { checksumSha256?: string; byteSize?: number }, lineConfirmed = false) {
    await this.slipForPayer(ctx, id, lineConfirmed);
    const upload = await this.repo.findSlipUpload(ctx.companyId, id, attachmentId, ctx.userId);
    if (!upload || upload.status !== 'PENDING_UPLOAD') throw new BadRequestException(disbursementVoucherError('disbursement_slip_not_owned'));
    // The shared completion verifies actual bytes, checksum, type and malware before ACTIVE.
    await this.retryable(() => this.completeUpload!.execute(withAttachmentCreate(ctx), { attachmentId,
      ...(input.checksumSha256 !== undefined ? { checksumSha256: input.checksumSha256 } : {}),
      ...(input.byteSize !== undefined ? { byteSize: input.byteSize } : {}) }));
    return { attachmentId };
  }

  /** Copy the chat's validated bytes through the existing exclusive upload/complete/attach path. */
  async attachLineSlip(ctx: RequestContext, id: string, evidence: { id: string; revision: string; attachmentId: string; chat: string }, expectedVersion: number) {
    const { voucher } = await this.slipForPayer(ctx, id, true);
    if (voucher.version !== expectedVersion) throw new ConflictException(disbursementVoucherError('disbursement_version_conflict'));
    const source = await this.repo.lineSlipSource(ctx, evidence, voucher.branchId);
    const object = await this.storage!.getObject({ bucket: source.bucket, objectKey: source.objectKey, objectVersionId: source.objectVersionId ?? undefined });
    const upload = await this.startSlipUpload(ctx, id, { originalFileName: source.originalFileName, mimeType: source.mimeType, byteSize: object.bytes.length }, true);
    const target = await this.repo.findSlipUpload(ctx.companyId, id, upload.attachmentId, ctx.userId);
    if (!target) throw new BadRequestException(disbursementVoucherError('disbursement_slip_not_owned'));
    const stored = await this.storage!.putObject({ objectKey: target.objectKey, mimeType: source.mimeType, bytes: object.bytes });
    await this.completeSlipUpload(ctx, id, upload.attachmentId, { byteSize: stored.byteSize, checksumSha256: stored.checksumSha256 }, true);
    // Recheck source and voucher after I/O; a changed card never attaches or pays a different revision.
    await this.repo.lineSlipSource(ctx, evidence, voucher.branchId);
    const current = await this.slipForPayer(ctx, id, true);
    if (current.voucher.version !== expectedVersion) throw new ConflictException(disbursementVoucherError('disbursement_version_conflict'));
    return this.attachSlip(ctx, id, upload.attachmentId, true, expectedVersion);
  }

  async attachSlip(ctx: RequestContext, id: string, attachmentId: string, lineConfirmed = false, expectedVersion?: number) {
    const { scope } = await this.slipForPayer(ctx, id, lineConfirmed);
    if (typeof attachmentId !== 'string' || !attachmentId.trim()) throw invalid();
    await this.retryable(() => this.repo.attachSlipAtomic(scope, id, attachmentId, ctx.userId, tx => this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'expense.disbursement.slip.attach', targetType: 'disbursement_voucher', targetId: id,
      requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { slipAttachmentId: attachmentId } }, tx), expectedVersion));
    const voucher = await this.repo.findVisible(scope, id);
    if (!voucher) throw new NotFoundException(disbursementVoucherError('disbursement_not_found'));
    return { header: disbursementVoucherHeader(voucher), slip: voucher.slip ? { attachmentId: voucher.slip.attachmentId,
      attachedByUserId: voucher.slip.linkedByUserId, attachedByName: voucher.names.get(voucher.slip.linkedByUserId) ?? null, attachedAt: voucher.slip.createdAt.toISOString() } : null };
  }

  async slip(ctx: RequestContext, id: string) {
    const voucher = await this.visibleFileDocument(ctx, id);
    const file = voucher.slipAttachmentId ? await this.repo.findSlipFile(ctx.companyId, id, voucher.slipAttachmentId) : null;
    if (!file) throw new NotFoundException(disbursementVoucherError('disbursement_slip_missing'));
    const signed = await this.storage!.createDownloadUrl({ bucket: file.bucket, objectKey: file.objectKey, objectVersionId: file.objectVersionId ?? undefined,
      mimeType: file.mimeType, fileName: file.originalFileName });
    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'expense.disbursement.slip.open', targetType: 'disbursement_voucher', targetId: id,
      requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { slipAttachmentId: file.id } });
    return { downloadUrl: signed.url, expiresAt: signed.expiresAt };
  }

  /** Bundle downloads use the same private-file boundary as opening a voucher's slip. */
  async slipBytes(ctx: RequestContext, id: string) {
    const voucher = await this.visibleFileDocument(ctx, id);
    const file = voucher.slipAttachmentId ? await this.repo.findSlipFile(ctx.companyId, id, voucher.slipAttachmentId) : null;
    if (!file) throw new NotFoundException(disbursementVoucherError('disbursement_slip_missing'));
    const object = await this.storage!.getObject({ bucket: file.bucket, objectKey: file.objectKey, objectVersionId: file.objectVersionId ?? undefined });
    return { data: object.bytes, fileName: file.originalFileName, mimeType: file.mimeType };
  }

  async approvers(ctx: RequestContext, branchId: string | undefined) {
    this.authorize(ctx, ['prepare']);
    if (typeof branchId !== 'string' || !branchId.trim()) throw invalid();
    if (!isBranchInScope(ctx.scopes, branchId)) throw new ForbiddenException(disbursementVoucherError('disbursement_permission_denied'));
    return this.repo.approvers(ctx.companyId, branchId);
  }

  private sources(tx: Prisma.TransactionClient, scope: DisbursementReadScope, voucher: DisbursementLifecycleVoucher) {
    return this.expenseRepo.readDisbursementExpenseSources({ companyId: scope.companyId, createdByUserId: scope.createdByUserId, expenseIds: voucher.lines.map(l => l.expenseId) }, scope.scopes, scope.relatedUserId, tx);
  }

  private changed(number: string | null, paying: boolean, voucher: DisbursementLifecycleVoucher, ctx: RequestContext, canOwnerRecover = false) { return new ConflictException(disbursementVoucherError(paying ? 'disbursement_payment_source_changed' : 'disbursement_source_changed', { number: number || 'ที่เลือก', mayWithdraw: String(disbursementVoucherActions(voucher, ctx.permissions, ctx.userId, canOwnerRecover).withdraw) })); }

  private async verifiedSources(tx: Prisma.TransactionClient, scope: DisbursementReadScope, voucher: DisbursementLifecycleVoucher, ctx: RequestContext, paying = false) {
    const sources = new Map((await this.sources(tx, scope, voucher)).map(e => [e.id, e]));
    for (const line of voucher.lines) {
      const source = sources.get(line.expenseId);
      if (!source || source.status !== 'CONFIRMED' || source.reservedByDisbursementVoucherId !== voucher.id
        || new Decimal(String(source.outstandingAmount)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).lt(String(line.amount)) || disbursementVoucherSourceHash(source) !== line.sourceHashAtSubmit
        || disbursementExpenseSelectionReason({ ...source, reservedByDisbursementVoucherId: null })) throw this.changed(source?.expenseNumber ?? line.expense.expenseNumber, paying, voucher, ctx, await this.repo.canOwnerRecover(voucher, ctx.roles.includes('OWNER'), tx));
    }
    return sources;
  }

  private async ownSignature(tx: Prisma.TransactionClient, ctx: RequestContext): Promise<DisbursementSignatureSnapshot | null> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${ctx.companyId}:${ctx.userId}:signature-asset`}))`;
    const attachment = await this.expenseRepo.findReusableSignatureAsset(ctx.companyId, ctx.userId);
    if (!attachment) return null;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${ctx.companyId}:${attachment.id}:attachment-retention`}))`;
    if (!await tx.attachmentObject.findFirst({ where: { companyId: ctx.companyId, id: attachment.id, status: 'ACTIVE' }, select: { id: true } })) throw new ConflictException(disbursementVoucherError('disbursement_signature_unavailable'));
    const object = await this.storage!.getObject({ bucket: attachment.bucket, objectKey: attachment.objectKey, objectVersionId: attachment.objectVersionId })
      .catch(() => { throw new ConflictException(disbursementVoucherError('disbursement_signature_unavailable')); });
    const checksumSha256 = createHash('sha256').update(object.bytes).digest('hex');
    if (attachment.byteSize > SIGNATURE_MAX_BYTES || object.bytes.length > SIGNATURE_MAX_BYTES || detectAttachmentMimeType(object.bytes) !== attachment.mimeType
      || attachment.checksumSha256 && attachment.checksumSha256 !== checksumSha256) throw new ConflictException(disbursementVoucherError('disbursement_signature_unavailable'));
    return { attachmentId: attachment.id, userId: ctx.userId, checksumSha256 };
  }

  private async approveRevision(tx: Prisma.TransactionClient, ctx: RequestContext, scope: DisbursementReadScope, voucher: DisbursementLifecycleVoucher) {
    await this.verifiedSources(tx, scope, voucher, ctx);
    const now = new Date();
    const revision = voucher.revisions.find(r => r.revision === voucher.revision);
    if (!revision || revision.decision !== null) throw new ConflictException(disbursementVoucherError('disbursement_status_changed'));
    await tx.disbursementVoucherRevision.updateMany({ where: { voucherId: voucher.id, revision: voucher.revision, decision: null },
      data: { decision: 'APPROVED', decidedByUserId: ctx.userId, decidedAt: now } });
    return { approverSignatureJson: await this.ownSignature(tx, ctx) ?? Prisma.DbNull, status: 'APPROVED' as const, approvedByUserId: ctx.userId, approvedAt: now, selfApproved: revision.submittedByUserId === ctx.userId };
  }

  private async retryable<T>(work: () => Promise<T>, paying = false): Promise<T> {
    try { return await work(); } catch (error) {
      const e = error as { code?: string; meta?: { code?: string; driverAdapterError?: { cause?: { originalCode?: string } } } };
      if (isSerializationFailure(error) || ['P2028', 'P1008', '55P03', '57014'].includes(e?.code ?? '')
        || ['55P03', '57014'].includes(e?.meta?.driverAdapterError?.cause?.originalCode ?? e?.meta?.code ?? '')) {
        throw new ConflictException(disbursementVoucherError(paying ? 'disbursement_payment_retry' : 'disbursement_changed_retry'));
      }
      throw error;
    }
  }

  private async command(ctx: RequestContext, id: string, action: Exclude<DisbursementVoucherLifecycleAction, 'pay' | 'remind'>, body: SubmitDisbursementVoucherInput | EndDisbursementVoucherInput, lineConfirmed = false) {
    if (action === 'return' && ctx.authProvider !== 'line' && !ctx.permissions.includes('expense.disbursement.approve')) throw new ForbiddenException({ ...disbursementVoucherError('disbursement_permission_denied'), message: DISBURSEMENT_VOUCHER_WORDS.returnPermissionRequired });
    const scope = this.scope(ctx, action === 'submit' ? 'prepare' : action === 'approve' || action === 'return' ? 'approve' : 'manage', undefined, lineConfirmed);
    const allowed = ['commandId', 'expectedVersion', ...(action === 'submit' ? ['requestedApproverUserId', 'approveNow'] : action === 'approve' ? [] : ['reason'])];
    if (!body || typeof body !== 'object' || Object.keys(body).some(k => !allowed.includes(k)) || typeof body.commandId !== 'string' || !body.commandId.trim() || body.commandId.length > 128
      || !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 0) throw invalid();
    const submit = body as SubmitDisbursementVoucherInput, end = body as EndDisbursementVoucherInput;
    if (action === 'submit' && (submit.approveNow !== undefined && typeof submit.approveNow !== 'boolean'
      || submit.requestedApproverUserId !== undefined && (typeof submit.requestedApproverUserId !== 'string' || !submit.requestedApproverUserId.trim()))) throw invalid();
    if (action !== 'submit' && action !== 'approve' && end.reason !== undefined && typeof end.reason !== 'string') throw invalid();
    const reason = end.reason?.trim() || null;
    if ((action === 'return' || action === 'cancel') && (!reason || reason.length < 3)) throw new BadRequestException(disbursementVoucherError(action === 'return' ? 'disbursement_return_reason_required' : 'disbursement_cancel_reason_required'));
    if (submit.approveNow) this.authorize(ctx, ['approve'], lineConfirmed);
    const payloadFingerprint = canonicalFingerprint({ version: 1, operation: action, id, expectedVersion: body.expectedVersion,
      requestedApproverUserId: submit.requestedApproverUserId ?? null, approveNow: submit.approveNow ?? false, reason });
    let changed = false;
    const signatureChecksums: Record<string, string> = {};
    const header = await this.retryable(() => this.repo.lifecycleAtomic({ ...scope, id, action, commandId: body.commandId, expectedVersion: body.expectedVersion, payloadFingerprint,
      permissions: ctx.permissions, actorUserId: ctx.userId, isOwner: ctx.roles.includes('OWNER'), approveNow: submit.approveNow }, async (tx, voucher) => {
      const canRecover = await this.repo.canOwnerRecover(voucher, ctx.roles.includes('OWNER'), tx);
      await this.repo.lockSources(tx, voucher, (error, line) => {
        const code = (error as { getResponse?: () => { code?: string } }).getResponse?.().code;
        if (action === 'approve' && code) throw this.changed(line.expense.expenseNumber, false, voucher, ctx, canRecover);
        const reason = code === 'substitute_source_has_live_claim' ? 'claim' : code === 'substitute_personal_settles_via_reimbursement' ? 'personal_advance' : null;
        if (!reason) throw error;
        throw new UnprocessableEntityException({ code: `disbursement_expense_${reason}`, message: `รายการ ${line.expense.expenseNumber || 'ที่เลือก'}: ${disbursementExpenseReasonMessage(reason)}` });
      }, action === 'submit' || action === 'approve');
      if (action === 'approve') {
        const approval = await this.approveRevision(tx, ctx, scope, voucher);
        if ('checksumSha256' in approval.approverSignatureJson) signatureChecksums.approver = approval.approverSignatureJson.checksumSha256;
        return approval;
      }
      const now = new Date();
      if (action === 'submit') {
        const sources = await this.sources(tx, scope, voucher);
        const data = await this.prepare(ctx, { commandId: body.commandId, lines: voucher.lines.map(l => ({ expenseId: l.expenseId, amount: new Decimal(String(l.amount)).toString() })),
          payeeName: voucher.payeeName, payeeConfirmed: voucher.payeeBasis === 'PREPARER_CONFIRMED',
          plannedPayDate: voucher.plannedPayDate ? coerceCivilDate(voucher.plannedPayDate) : undefined, plannedMethod: voucher.plannedMethod ?? undefined, note: voucher.note ?? undefined }, scope, tx, sources);
        if (data.branchId !== voucher.branchId) throw new UnprocessableEntityException(disbursementVoucherError('disbursement_branch_changed'));
        if (data.payeeBasis !== voucher.payeeBasis) throw new UnprocessableEntityException(disbursementVoucherError('disbursement_payee_changed'));
        if (submit.requestedApproverUserId && !(await this.repo.approvers(ctx.companyId, voucher.branchId, tx)).some(m => m.userId === submit.requestedApproverUserId)) throw new UnprocessableEntityException(disbursementVoucherError('disbursement_approver_ineligible'));
        await this.repo.reserveSources(tx, voucher);
        const names = await this.repo.memberNames(ctx.companyId, [voucher.payeeConfirmedByUserId, voucher.preparedByUserId, ctx.userId], tx);
        const sourceById = new Map(sources.map(s => [s.id, s]));
        const frozenLines = voucher.lines.map(line => {
          const e = sourceById.get(line.expenseId)!;
          return { expenseId: line.expenseId, position: line.position, expenseNumber: e.expenseNumber, expenseDate: coerceCivilDate(e.expenseDate),
            description: Array.from(e.lines?.[0]?.description?.trim() || '').slice(0, 80).join('') || null,
            vendorName: e.vendorNameSnapshot, vendorTaxId: e.vendorTaxIdSnapshot, vendorBranchCode: e.vendorBranchCodeSnapshot ?? null, vendorAddress: e.vendorAddressSnapshot ?? null, vendorDocumentNumber: e.vendorDocumentNumber ?? null, grandTotal: new Decimal(String(e.grandTotalAmount)).toFixed(4), wht: new Decimal(String(e.whtAmount)).toFixed(4),
            netPayable: new Decimal(String(e.netPayableAmount)).toFixed(4), outstanding: new Decimal(String(e.outstandingAmount)).toFixed(4), amount: new Decimal(String(line.amount)).toFixed(4) };
        });
        const [company, branch] = await Promise.all([
          tx.company.findFirst({ where: { id: ctx.companyId }, select: { id: true, name: true, registeredName: true, brandName: true, taxId: true, addressJson: true, phone: true } }),
          tx.branch.findFirst({ where: { companyId: ctx.companyId, id: voucher.branchId }, select: { id: true, name: true, code: true, taxBranchCode: true, addressJson: true } }),
        ]);
        if (!company || !branch) throw new NotFoundException(disbursementVoucherError('disbursement_not_found'));
        const preparerSignature = ctx.userId === voucher.preparedByUserId ? await this.ownSignature(tx, ctx) : null;
        if (preparerSignature) signatureChecksums.preparer = preparerSignature.checksumSha256;
        const snapshot = { company, branch, documentDate: voucher.createdAt.toISOString(),
          payeeAccount: voucher.payeeAccountLast4 ? { bankName: voucher.payeeBankName, accountName: voucher.payeeAccountName, last4: voucher.payeeAccountLast4 } : null,
          actors: { preparer: { name: names.get(voucher.preparedByUserId) ?? null, at: voucher.createdAt.toISOString(), signature: preparerSignature } },
          companyId: voucher.companyId, branchId: voucher.branchId, templateVersion: voucher.templateVersion, currency: voucher.currency,
          payee: { name: voucher.payeeName, taxId: data.payeeTaxId, branchCode: data.payeeBranchCode, basis: data.payeeBasis,
            confirmedByUserId: voucher.payeeConfirmedByUserId, confirmerName: names.get(voucher.payeeConfirmedByUserId ?? '') ?? null },
          preparerName: names.get(voucher.preparedByUserId) ?? null, submittedByName: names.get(ctx.userId) ?? null,
          plannedPayDate: voucher.plannedPayDate ? coerceCivilDate(voucher.plannedPayDate) : null, plannedMethod: voucher.plannedMethod,
          note: voucher.note, total: data.totalAmount, lines: frozenLines };
        const revision = voucher.revision + 1;
        const created = await tx.disbursementVoucherRevision.create({ data: { voucherId: voucher.id, revision, snapshotJson: snapshot,
          snapshotHash: canonicalFingerprint(snapshot), submittedByUserId: ctx.userId, requestedApproverUserId: submit.requestedApproverUserId ?? null, submittedAt: now } });
        const lines = [];
        for (const line of voucher.lines) {
          const sourceHashAtSubmit = disbursementVoucherSourceHash(sourceById.get(line.expenseId)!);
          const changed = await tx.disbursementVoucherLine.updateMany({ where: { companyId: voucher.companyId, id: line.id, voucherId: voucher.id }, data: { sourceHashAtSubmit } });
          if (changed.count !== 1) throw new ConflictException(disbursementVoucherError('disbursement_status_changed'));
          lines.push({ ...line, sourceHashAtSubmit });
        }
        const approval = submit.approveNow ? await this.approveRevision(tx, ctx, scope, { ...voucher, revision, lines, revisions: [...voucher.revisions, created] }) : null;
        if (approval && 'checksumSha256' in approval.approverSignatureJson) signatureChecksums.approver = approval.approverSignatureJson.checksumSha256;
        const documentNumber = await this.repo.numberAtSubmit(tx, voucher, ctx.userId, civilPeriodKey(todayCivilDate()));
        return { preparerSignatureJson: preparerSignature ?? Prisma.DbNull, approverSignatureJson: Prisma.DbNull, payerSignatureJson: Prisma.DbNull, status: 'PENDING_APPROVAL', revision, documentNumber, submittedByUserId: ctx.userId, submittedAt: now, requestedApproverUserId: submit.requestedApproverUserId ?? null,
          payeeTaxId: data.payeeTaxId, payeeBranchCode: data.payeeBranchCode, totalAmount: data.totalAmount,
          lastReminderToUserId: null, lastReminderAt: null, approvedAt: null, approvedByUserId: null, selfApproved: false, returnedAt: null, returnedByUserId: null, returnReason: null, ...approval };
      }
      await this.repo.clearSources(tx, voucher);
      const decision = action === 'return' ? 'RETURNED' : action === 'withdraw' ? 'WITHDRAWN' : 'CANCELLED';
      if (voucher.status === 'PENDING_APPROVAL') {
        await tx.disbursementVoucherRevision.updateMany({ where: { voucherId: voucher.id, revision: voucher.revision, decision: null }, data: { decision, decidedByUserId: ctx.userId, decidedAt: now, decisionReason: reason } });
      } else if (voucher.status === 'APPROVED') {
        await tx.disbursementVoucherRevision.updateMany({ where: { voucherId: voucher.id, revision: voucher.revision, decision: 'APPROVED' },
          data: { postApprovalAction: decision, postApprovalByUserId: ctx.userId, postApprovalAt: now, postApprovalReason: reason } });
      }
      if (action === 'cancel') return { status: 'CANCELLED', cancelledByUserId: ctx.userId, cancelledAt: now, cancelReason: reason, cancelledAfterPaid: false };
      return { preparerSignatureJson: Prisma.DbNull, approverSignatureJson: Prisma.DbNull, payerSignatureJson: Prisma.DbNull, status: 'DRAFT', approvedAt: null, approvedByUserId: null, selfApproved: false,
        ...(action === 'return' ? { returnedByUserId: ctx.userId, returnedAt: now, returnReason: reason } : {}) };
    }, async (tx, header) => {
      changed = true;
      for (const event of submit.approveNow ? ['submit', 'approve'] : [action]) await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId,
        action: `expense.disbursement.${event}`, targetType: 'disbursement_voucher', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW',
        metadataJson: { commandId: body.commandId, revision: header.revision, selfApproved: header.selfApproved, reason, signatureChecksums } }, tx);
    }));
    if (changed) await this.notices?.send(ctx, header, action === 'submit' && header.status === 'APPROVED' ? 'approve' : action, { reason });
    return header;
  }

  async remind(ctx: RequestContext, id: string, body: RemindDisbursementVoucherInput) {
    const scope = this.scope(ctx, 'prepare');
    if (!body || typeof body !== 'object' || Object.keys(body).some(k => !['commandId', 'expectedVersion', 'approverUserId'].includes(k))
      || typeof body.commandId !== 'string' || !body.commandId.trim() || body.commandId.length > 128
      || !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 0
      || typeof body.approverUserId !== 'string' || !body.approverUserId.trim()) throw invalid();
    const payloadFingerprint = canonicalFingerprint({ version: 1, operation: 'remind', id, expectedVersion: body.expectedVersion, approverUserId: body.approverUserId });
    let changed = false;
    const header = await this.retryable(() => this.repo.lifecycleAtomic({ ...scope, id, action: 'remind', ...body, payloadFingerprint, permissions: ctx.permissions, actorUserId: ctx.userId }, async (tx, voucher) => {
      const approver = (await this.repo.approvers(ctx.companyId, voucher.branchId, tx)).find(m => m.userId === body.approverUserId);
      if (!approver) throw new UnprocessableEntityException(disbursementVoucherError('disbursement_approver_ineligible'));
      const now = new Date(), last = await this.repo.lastReminder(tx, ctx.companyId, id, body.approverUserId);
      if (last && now.getTime() < last.getTime() + 3600000) {
        const next = new Date(last.getTime() + 3600000);
        throw new ConflictException(disbursementVoucherError('disbursement_reminder_cooldown', { name: approver.displayName,
          minutes: String(Math.max(0, Math.floor((now.getTime() - last.getTime()) / 60000))),
          time: new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(next) }));
      }
      return { lastReminderToUserId: body.approverUserId, lastReminderAt: now, reminderCount: (voucher.reminderCount ?? 0) + 1 };
    }, async (tx, current) => {
      changed = true;
      await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'expense.disbursement.remind', targetType: 'disbursement_voucher', targetId: id,
        requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW', metadataJson: { commandId: body.commandId, revision: current.revision, approverUserId: body.approverUserId, reminderCount: current.reminderCount } }, tx);
    }));
    if (changed) await this.notices?.send(ctx, header, 'remind', { approverUserId: body.approverUserId });
    return header;
  }

  submit(ctx: RequestContext, id: string, body: SubmitDisbursementVoucherInput, lineConfirmed = false) { return this.command(ctx, id, 'submit', body, lineConfirmed); }
  approve(ctx: RequestContext, id: string, body: DisbursementVoucherCommandInput, lineConfirmed = false) { return this.command(ctx, id, 'approve', body, lineConfirmed); }
  return(ctx: RequestContext, id: string, body: EndDisbursementVoucherInput, lineConfirmed = false) { return this.command(ctx, id, 'return', body, lineConfirmed); }
  withdraw(ctx: RequestContext, id: string, body: EndDisbursementVoucherInput) { return this.command(ctx, id, 'withdraw', body); }
  cancel(ctx: RequestContext, id: string, body: EndDisbursementVoucherInput, lineConfirmed = false) { return this.command(ctx, id, 'cancel', body, lineConfirmed); }

  private async paidSnapshot(tx: Prisma.TransactionClient, ctx: RequestContext, voucher: DisbursementLifecycleVoucher, sources: Map<string, Source>, payments: { payment: { id: string; amount: string }; expense: { outstandingAmount: string } }[], paidDate: string, paidMethod: DisbursementVoucherHeader['paidMethod'], paidFromRef: string | null, paidRecordedAt: Date, paidByUserId: string) {
    const slip = voucher.slipAttachmentId ? await tx.attachmentLink.findFirst({ where: { companyId: ctx.companyId, attachmentId: voucher.slipAttachmentId, targetType: DISBURSEMENT_VOUCHER_ATTACHMENT_TARGET_TYPE, targetId: voucher.id, purpose: DISBURSEMENT_VOUCHER_SLIP_PURPOSE }, select: { linkedByUserId: true, createdAt: true } }) : null;
    const [company, branch, names] = await Promise.all([
      tx.company.findFirst({ where: { id: ctx.companyId }, select: { id: true, name: true, registeredName: true, brandName: true, taxId: true, addressJson: true, phone: true } }),
      tx.branch.findFirst({ where: { companyId: ctx.companyId, id: voucher.branchId }, select: { id: true, name: true, code: true, taxBranchCode: true, addressJson: true } }),
      this.repo.memberNames(ctx.companyId, [voucher.preparedByUserId, voucher.approvedByUserId, paidByUserId, voucher.payeeConfirmedByUserId, slip?.linkedByUserId], tx),
    ]);
    if (!company || !branch) throw new NotFoundException(disbursementVoucherError('disbursement_not_found'));
    const submittedSnapshot = voucher.revisions.find(r => r.revision === voucher.revision)?.snapshotJson as unknown as DisbursementVoucherPrintSnapshot | undefined;
    const lines = voucher.lines.map((line, i) => {
      const created = payments[i]!;
      const e = sources.get(line.expenseId)!;
      return { expenseId: e.id, expenseNumber: e.expenseNumber, expenseDate: coerceCivilDate(e.expenseDate), vendorName: e.vendorNameSnapshot, vendorTaxId: e.vendorTaxIdSnapshot, vendorBranchCode: e.vendorBranchCodeSnapshot ?? null, vendorAddress: e.vendorAddressSnapshot ?? null, vendorDocumentNumber: e.vendorDocumentNumber ?? null, sourceHashAfterPaid: disbursementVoucherSourceHash({ ...e, outstandingAmount: created.expense.outstandingAmount }),
        description: voucher.origin === 'DIRECT_PAYMENT' ? Array.from(e.lines?.[0]?.description?.trim() || '').slice(0, 80).join('') || null
          : submittedSnapshot?.lines?.find(l => l.expenseId === e.id)?.description ?? null,
        grandTotal: new Decimal(String(e.grandTotalAmount)).toFixed(4), wht: new Decimal(String(e.whtAmount)).toFixed(4), netPayable: new Decimal(String(e.netPayableAmount)).toFixed(4),
        paidThisTime: new Decimal(created.payment.amount).toFixed(4), outstandingAfter: new Decimal(created.expense.outstandingAmount).toFixed(4), expensePaymentId: created.payment.id, position: line.position };
    });
    const sum = (field: 'grandTotal' | 'wht' | 'netPayable' | 'paidThisTime' | 'outstandingAfter') => lines.reduce((total, l) => total.plus(l[field]), new Decimal(0)).toFixed(4);
    return { company, branch, documentDate: voucher.createdAt.toISOString(), plannedPayDate: voucher.plannedPayDate ? coerceCivilDate(voucher.plannedPayDate) : null, documentNumber: voucher.documentNumber, revision: voucher.revision, templateVersion: voucher.templateVersion, currency: voucher.currency,
      payee: { name: voucher.payeeName, taxId: voucher.payeeTaxId, branchCode: voucher.payeeBranchCode, basis: voucher.payeeBasis,
        confirmedByUserId: voucher.payeeConfirmedByUserId, confirmerName: names.get(voucher.payeeConfirmedByUserId ?? '') ?? null },
      payeeAccount: voucher.payeeAccountLast4 ? { bankName: voucher.payeeBankName, accountName: voucher.payeeAccountName, last4: voucher.payeeAccountLast4 } : null,
      note: voucher.note, directPayment: !voucher.approvedByUserId, lines, totals: { grandTotal: sum('grandTotal'), wht: sum('wht'), netPayable: sum('netPayable'), paidThisTime: sum('paidThisTime'), outstandingAfter: sum('outstandingAfter') },
      paymentEvidence: slip ? { attachedByName: names.get(slip.linkedByUserId) ?? null, attachedAt: slip.createdAt.toISOString() } : null,
      paidDate, paidRecordedAt: paidRecordedAt.toISOString(), paymentMethod: paidMethod, paidFromRef,
      actors: { preparer: { userId: voucher.preparedByUserId, name: names.get(voucher.preparedByUserId) ?? null, at: voucher.createdAt.toISOString(), signature: voucher.preparerSignatureJson as DisbursementSignatureSnapshot | null },
        approver: { userId: voucher.approvedByUserId ?? null, name: names.get(voucher.approvedByUserId ?? '') ?? null, at: voucher.approvedAt?.toISOString() ?? null, selfApproved: voucher.selfApproved, signature: voucher.approverSignatureJson as DisbursementSignatureSnapshot | null },
        payer: { userId: paidByUserId, name: names.get(paidByUserId) ?? null, at: paidRecordedAt.toISOString(), signature: voucher.payerSignatureJson as DisbursementSignatureSnapshot | null } } };
  }

  async pay(ctx: RequestContext, id: string, body: PayDisbursementVoucherInput, lineConfirmed = false): Promise<DisbursementVoucherHeader> {
    const scope = this.scope(ctx, 'pay', undefined, lineConfirmed);
    if (!body || typeof body !== 'object' || Object.keys(body).some(k => !['commandId', 'expectedVersion', 'paidDate', 'paymentMethod', 'paidFromRef', 'slipAttachmentId'].includes(k))
      || typeof body.commandId !== 'string' || !body.commandId.trim() || body.commandId.length > 128
      || !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 0
      || body.paidDate !== undefined && (typeof body.paidDate !== 'string' || !isCivilDate(body.paidDate))
      || body.paymentMethod !== undefined && !EXPENSE_PAYMENT_METHODS.includes(body.paymentMethod)
      || body.paidFromRef !== undefined && (typeof body.paidFromRef !== 'string' || body.paidFromRef.length > 128)
      || body.slipAttachmentId !== undefined && (typeof body.slipAttachmentId !== 'string' || !body.slipAttachmentId.trim())) throw invalid();
    // Fingerprint the caller's intent, so defaults remain replayable across midnight.
    const payloadFingerprint = canonicalFingerprint({ version: 1, operation: 'pay', id, expectedVersion: body.expectedVersion,
      paidDate: body.paidDate ?? null, paymentMethod: body.paymentMethod ?? null, paidFromRef: body.paidFromRef ?? null,
      ...(body.slipAttachmentId !== undefined ? { slipAttachmentId: body.slipAttachmentId } : {}) });
    const payments: ExpensePaymentResult[] = [];
    let payerSignature: DisbursementSignatureSnapshot | null = null;
    const header = await this.retryable(() => this.repo.lifecycleAtomic({ ...scope, id, action: 'pay', commandId: body.commandId, expectedVersion: body.expectedVersion,
      payloadFingerprint, permissions: ctx.permissions, actorUserId: ctx.userId }, async (tx, voucher) => {
      await this.repo.lockPaymentKeys(tx, voucher);
      const canRecover = await this.repo.canOwnerRecover(voucher, ctx.roles.includes('OWNER'), tx);
      await this.repo.lockSources(tx, voucher, (error, line) => {
        if ((error as { getResponse?: () => { code?: string } }).getResponse?.().code) throw this.changed(line.expense.expenseNumber, true, voucher, ctx, canRecover);
        throw error;
      });
      const sources = await this.verifiedSources(tx, scope, voucher, ctx, true);
      if (body.slipAttachmentId !== undefined) await this.repo.assertPaymentSlip(tx, voucher, body.slipAttachmentId);
      const paidDate = body.paidDate ?? todayCivilDate('Asia/Bangkok'), paidMethod = body.paymentMethod ?? voucher.plannedMethod;
      if (!paidMethod) throw new BadRequestException(disbursementVoucherError('disbursement_payment_method_required'));
      const paidFromRef = body.paidFromRef?.trim() || null, paidRecordedAt = new Date();
      for (const source of sources.values()) assertExpensePaymentSource(source, paidDate);
      if (!new Decimal(String(voucher.totalAmount)).eq(voucher.lines.reduce((total, l) => total.plus(String(l.amount)), new Decimal(0)))) throw new ConflictException(disbursementVoucherError('disbursement_payment_total_changed'));
      const keys = voucher.lines.map(l => `dv:${voucher.id}:${l.id}`);
      if (await tx.expensePayment.findFirst({ where: { companyId: ctx.companyId, idempotencyKey: { in: keys } }, select: { id: true } })) throw new ConflictException(disbursementVoucherError('disbursement_payment_key_conflict'));
      for (const line of voucher.lines) {
        const created = await this.expenseRepo.recordPaymentInTransaction(tx, { companyId: ctx.companyId, expenseId: line.expenseId, actorUserId: ctx.userId,
          scopes: ctx.scopes, idempotencyKey: `dv:${voucher.id}:${line.id}`, amount: new Decimal(String(line.amount)).toString(),
          paidAt: paidDate, paidAtConfirmed: Boolean(body.paidDate), paymentMethod: paidMethod ?? undefined, bankAccountRef: paidFromRef ?? undefined, payingThroughDisbursementVoucherId: voucher.id });
        if (created.replayed) throw new ConflictException(disbursementVoucherError('disbursement_payment_key_conflict'));
        const changed = await tx.disbursementVoucherLine.updateMany({ where: { companyId: ctx.companyId, voucherId: voucher.id, id: line.id, expensePaymentId: null, coversPaymentId: null },
          data: { expensePaymentId: created.payment.id, coversPaymentId: created.payment.id } });
        if (changed.count !== 1) throw new ConflictException(disbursementVoucherError('disbursement_payment_key_conflict'));
        payments.push(created);
      }
      await this.repo.clearSources(tx, voucher);
      payerSignature = await this.ownSignature(tx, ctx);
      const snapshot = await this.paidSnapshot(tx, ctx, { ...voucher, payerSignatureJson: payerSignature }, sources, payments, paidDate, paidMethod, paidFromRef, paidRecordedAt, ctx.userId);
      return { payerSignatureJson: payerSignature ?? Prisma.DbNull, status: 'PAID', paidDate: civilDateToUtcDate(paidDate), paidRecordedAt, paidByUserId: ctx.userId, paidMethod, paidFromRef,
        paidSnapshotJson: snapshot, paidSnapshotHash: canonicalFingerprint(snapshot) };
    }, async (tx, header) => {
      await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'expense.disbursement.pay', targetType: 'disbursement_voucher', targetId: id,
        requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { commandId: body.commandId, revision: header.revision, totalAmount: header.totalAmount, lineCount: payments.length, signatureChecksumSha256: payerSignature?.checksumSha256 ?? null } }, tx);
      for (const created of payments) await recordExpensePaymentEffects(this.audit, ctx, created.expense.id, tx, created);
    }), true);
    if (payments.length) await this.notices?.send(ctx, header, 'pay');
    return this.finishPaid(header);
  }
  private validateIssue(body: ReissueDisbursementVoucherInput, fields: string[]) {
    if (!body || typeof body !== 'object' || Object.keys(body).some(k => !fields.includes(k)) || typeof body.commandId !== 'string' || !body.commandId.trim() || body.commandId.length > 128) throw invalid();
  }

  private async issued(tx: Prisma.TransactionClient, ctx: RequestContext, scope: DisbursementReadScope, data: Prisma.DisbursementVoucherUncheckedCreateInput, lines: { expenseId: string; amount: string; expensePaymentId: string; position: number }[], old?: DisbursementLifecycleVoucher) {
    // A Serializable void can take its snapshot before waiting for the expense lifecycle lock.
    // Fence that stale snapshot with a row write, preserving every value and the screen version token.
    await tx.$executeRaw`UPDATE "ExpenseRecord" SET "reservedByDisbursementVoucherId" = "reservedByDisbursementVoucherId" WHERE "companyId" = ${ctx.companyId} AND "id" IN (${Prisma.join(lines.map(l => l.expenseId))})`;
    const created = await tx.disbursementVoucher.create({ data });
    await tx.disbursementVoucherLine.createMany({ data: lines.map(l => ({ ...l, companyId: ctx.companyId, voucherId: created.id, coversPaymentId: l.expensePaymentId })) });
    const voucher = await tx.disbursementVoucher.findFirstOrThrow({ where: { companyId: ctx.companyId, id: created.id }, include: { lines: { include: { expense: { include: { lines: { orderBy: { lineNumber: 'asc' }, take: 1, select: { description: true } } } } } }, revisions: true } });
    let snapshot;
    if (old) {
      const frozen = old.paidSnapshotJson as Record<string, any>;
      const ids = new Set(lines.map(l => l.expensePaymentId));
      const frozenLines = frozen.lines.filter((l: any) => ids.has(l.expensePaymentId)).map((l: any, i: number) => ({ ...l, position: i + 1 }));
      if (frozenLines.length !== lines.length) throw new ConflictException(disbursementVoucherError('disbursement_status_changed'));
      const names = await this.repo.memberNames(ctx.companyId, [ctx.userId], tx);
      const sum = (field: string) => frozenLines.reduce((t: Decimal, l: any) => t.plus(l[field]), new Decimal(0)).toFixed(4);
      snapshot = { ...frozen, paymentEvidence: null, documentNumber: null, origin: 'REISSUED', replacesVoucherId: old.id, replacesDocumentNumber: old.documentNumber, lines: frozenLines,
        totals: Object.fromEntries(['grandTotal', 'wht', 'netPayable', 'paidThisTime', 'outstandingAfter'].map(f => [f, sum(f)])),
        actors: { ...frozen.actors, preparer: { userId: ctx.userId, name: names.get(ctx.userId) ?? null, at: voucher.createdAt.toISOString() } } };
    } else {
      const sources = new Map((await this.sources(tx, scope, voucher)).map(e => [e.id, e]));
      const payment = await tx.expensePayment.findFirstOrThrow({ where: { companyId: ctx.companyId, id: lines[0]!.expensePaymentId } });
      const source = sources.get(lines[0]!.expenseId)!;
      snapshot = await this.paidSnapshot(tx, ctx, voucher, sources, [{ payment: { id: payment.id, amount: String(payment.amount) }, expense: { outstandingAmount: String(source.outstandingAmount) } }],
        coerceCivilDate(voucher.paidDate!), voucher.paidMethod, voucher.paidFromRef, voucher.paidRecordedAt!, voucher.paidByUserId!);
    }
    // All validation, coverage writes and snapshot reads precede allocating a number.
    const documentNumber = await this.repo.numberAtSubmit(tx, voucher, ctx.userId, civilPeriodKey(todayCivilDate()));
    snapshot = { ...snapshot, documentNumber };
    await tx.disbursementVoucher.updateMany({ where: { companyId: ctx.companyId, id: voucher.id, status: 'PAID' }, data: { documentNumber, paidSnapshotJson: snapshot, paidSnapshotHash: canonicalFingerprint(snapshot) } });
    const header = disbursementVoucherHeader(await tx.disbursementVoucher.findFirstOrThrow({ where: { companyId: ctx.companyId, id: voucher.id } }));
    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: old ? 'expense.disbursement.reissue' : 'expense.disbursement.issue', targetType: 'disbursement_voucher', targetId: header.id,
      requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW', metadataJson: { replacesVoucherId: old?.id ?? null, paymentIds: lines.map(l => l.expensePaymentId) } }, tx);
    return header;
  }

  async fromPayment(ctx: RequestContext, body: IssueDisbursementVoucherInput): Promise<DisbursementVoucherHeader> {
    const scope = this.scope(ctx, 'issue');
    this.validateIssue(body, ['commandId', 'expenseId', 'paymentId']);
    if (typeof body.expenseId !== 'string' || !body.expenseId.trim() || typeof body.paymentId !== 'string' || !body.paymentId.trim()) throw invalid();
    const header = await this.retryable(() => this.repo.issueAtomic({ ...scope, expenseId: body.expenseId, commandId: body.commandId, payloadFingerprint: canonicalFingerprint({ version: 1, operation: 'fromPayment', expenseId: body.expenseId, paymentId: body.paymentId }) }, async tx => {
      const expense = await tx.expenseRecord.findFirstOrThrow({ where: { companyId: ctx.companyId, id: body.expenseId } });
      if (expense.sourceReimbursementRequestId) throw new UnprocessableEntityException(disbursementVoucherError('disbursement_issue_claim'));
      const payment = await tx.expensePayment.findFirst({ where: { companyId: ctx.companyId, expenseId: body.expenseId, id: body.paymentId } });
      if (!payment) throw new NotFoundException(disbursementVoucherError('disbursement_issue_payment_not_found'));
      if (payment.status !== 'RECORDED') throw new ConflictException(disbursementVoucherError('disbursement_issue_payment_cancelled'));
      if (expense.status !== 'CONFIRMED') throw new UnprocessableEntityException(disbursementVoucherError('disbursement_expense_not_confirmed'));
      if (!expense.branchId) throw new UnprocessableEntityException(disbursementVoucherError('disbursement_expense_missing_branch'));
      const covered = await tx.disbursementVoucherLine.findFirst({ where: { companyId: ctx.companyId, coversPaymentId: payment.id }, select: { voucherId: true } });
      if (covered) {
        const existing = await tx.disbursementVoucher.findFirst({ where: { ...disbursementVoucherReadWhere(scope), id: covered.voucherId } });
        if (!existing) throw new NotFoundException(disbursementVoucherError('disbursement_not_found'));
        return disbursementVoucherHeader(existing);
      }
      return this.issued(tx, ctx, scope, { companyId: ctx.companyId, branchId: expense.branchId, status: 'PAID', origin: 'DIRECT_PAYMENT',
        payeeName: expense.vendorNameSnapshot?.trim() || DISBURSEMENT_VOUCHER_WORDS.unnamedPayee, payeeTaxId: expense.vendorTaxIdSnapshot, payeeBranchCode: expense.vendorBranchCodeSnapshot,
        payeeBasis: 'SINGLE', preparedByUserId: ctx.userId, totalAmount: payment.amount, currency: payment.currency,
        paidDate: civilDateToUtcDate(civilDate(payment.paidAt, 'Asia/Bangkok')), paidRecordedAt: payment.createdAt, paidByUserId: payment.createdByUserId, paidMethod: payment.paymentMethod, paidFromRef: payment.bankAccountRef },
        [{ expenseId: expense.id, amount: String(payment.amount), expensePaymentId: payment.id, position: 1 }]);
    }));
    return this.finishPaid(header);
  }

  async reissue(ctx: RequestContext, id: string, body: ReissueDisbursementVoucherInput): Promise<DisbursementVoucherHeader> {
    const scope = this.scope(ctx, 'issue'); this.validateIssue(body, ['commandId']);
    const header = await this.retryable(() => this.repo.issueAtomic({ ...scope, id, commandId: body.commandId, payloadFingerprint: canonicalFingerprint({ version: 1, operation: 'reissue', id }) }, async (tx, old) => {
      if (!old || old.status !== 'CANCELLED' || !old.cancelledAfterPaid) throw new ConflictException(disbursementVoucherError('disbursement_status_changed'));
      const existing = await tx.disbursementVoucher.findFirst({ where: { companyId: ctx.companyId, replacesVoucherId: old.id } });
      if (existing) return disbursementVoucherHeader(existing);
      const ids = old.lines.flatMap(l => l.expensePaymentId ? [l.expensePaymentId] : []);
      const payments = await tx.expensePayment.findMany({ where: { companyId: ctx.companyId, id: { in: ids }, status: 'RECORDED' } });
      const covered = await tx.disbursementVoucherLine.findMany({ where: { companyId: ctx.companyId, coversPaymentId: { in: ids } }, select: { coversPaymentId: true } });
      const live = new Set(payments.filter(p => !covered.some(l => l.coversPaymentId === p.id)).map(p => p.id));
      const lines = old.lines.filter(l => l.expensePaymentId && live.has(l.expensePaymentId)).map((l, i) => ({ expenseId: l.expenseId, amount: String(l.amount), expensePaymentId: l.expensePaymentId!, position: i + 1 }));
      if (!lines.length) throw new ConflictException(disbursementVoucherError('disbursement_reissue_empty'));
      return this.issued(tx, ctx, scope, { companyId: ctx.companyId, branchId: old.branchId, status: 'PAID', origin: 'REISSUED', replacesVoucherId: old.id,
        payeeName: old.payeeName, payeeTaxId: old.payeeTaxId, payeeBranchCode: old.payeeBranchCode, payeeBasis: old.payeeBasis, payeeConfirmedByUserId: old.payeeConfirmedByUserId,
        preparedByUserId: ctx.userId, approvedByUserId: old.approvedByUserId, approvedAt: old.approvedAt, selfApproved: old.selfApproved, note: old.note,
        payeeBankName: old.payeeBankName, payeeAccountName: old.payeeAccountName, payeeAccountLast4: old.payeeAccountLast4, payeeAccountCiphertext: old.payeeAccountCiphertext,
        totalAmount: lines.reduce((sum, l) => sum.plus(l.amount), new Decimal(0)).toFixed(4), currency: old.currency,
        paidDate: old.paidDate, paidRecordedAt: old.paidRecordedAt, paidByUserId: old.paidByUserId, paidMethod: old.paidMethod, paidFromRef: old.paidFromRef }, lines, old);
    }));
    return this.finishPaid(header);
  }

}
