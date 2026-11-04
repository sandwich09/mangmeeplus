import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { DISBURSEMENT_VOUCHER_STATUSES, disbursementVoucherPaymentAmount, disbursementVoucherError, disbursementExpenseReasonMessage,
  DISBURSEMENT_VOUCHER_ATTACHMENT_TARGET_TYPE, DISBURSEMENT_VOUCHER_SLIP_PURPOSE, DISBURSEMENT_VOUCHER_SLIP_UPLOAD_TAG, DISBURSEMENT_VOUCHER_SUPPORTING_UPLOAD_TAG, DISBURSEMENT_VOUCHER_SUPPORTING_PURPOSE, REIMBURSEMENT_PAYMENT_SLIP_MAX_BYTES,
  type RequestContext, type DisbursementVoucherHeader, type DisbursementVoucherDetail, type DisbursementVoucherStatus, type DisbursementVoucherPayeeBasis, type ExpensePaymentMethod,
} from '@watchdog-bms/contracts';
import { PrismaService } from '../../../common/database/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { isBranchInScope, type BranchScopes } from '../../data-model-core/domain/logic/branch.logic';
import { expenseReadScopeWhere } from './prisma-expense.repository';
import { disbursementPayeeIdentity, assertDisbursementVoucherAction, disbursementVoucherActions, disbursementVoucherHeader } from '../domain/logic/disbursement-voucher.logic';
import type { DisbursementVoucherLifecycleAction } from '@watchdog-bms/contracts';
import { PrismaDocumentSequenceRepository } from '../../data-model-core/infrastructure/repositories/prisma-document-sequence.repository';
import { PrismaWorkflowRepository } from '../../workflow/infrastructure/prisma-workflow.repository';
import { PrismaPermissionResolverRepository } from '../../access-control/infrastructure/prisma-permission-resolver.repository';
import { lockFundingEvidence, assertFundingMutation } from './substitute-funding.guard';
import { lockExpenseCorrection } from './expense-void-blocker';
import { findAttachmentLinkConflict } from '../../data-model-core/domain/logic/attachment.logic';
import { REIMBURSEMENT_PAYMENT_SLIP_MIME_TYPES } from '../../reimbursements/domain/reimbursement.constants';

export type DisbursementReadScope = { companyId: string; createdByUserId?: string; scopes: BranchScopes; relatedUserId?: string };
export type DisbursementDraftData = {
  branchId: string; payeeName: string; payeeTaxId: string | null; payeeBranchCode: string | null; payeeBasis: DisbursementVoucherPayeeBasis;
  payeeConfirmedByUserId: string | null; plannedPayDate: Date | null; plannedMethod: ExpensePaymentMethod | null; note: string | null;
  payeeBankName?: string | null; payeeAccountName?: string | null; payeeAccountLast4?: string | null; payeeAccountCiphertext?: string | null;
  totalAmount: string; lines: { expenseId: string; amount: string; position: number }[];
};

/** Every line must be readable; applying an expense filter only to included rows would leak the header. */
export function disbursementVoucherReadWhere(scope: DisbursementReadScope, branchId?: string): Prisma.DisbursementVoucherWhereInput {
  return { companyId: scope.companyId, ...(branchId ? { branchId } : scope.scopes.branchIds ? { branchId: { in: scope.scopes.branchIds } } : {}),
    lines: { every: { expense: { is: expenseReadScopeWhere(scope, scope.scopes, scope.relatedUserId) } } },
  };
}

const detailInclude = { lines: { orderBy: { position: 'asc' as const }, include: { expense: { select: {
  id: true, status: true, currency: true, expenseNumber: true, expenseDate: true, vendorDocumentNumber: true, vendorAddressSnapshot: true, vendorBranchCodeSnapshot: true, vendorNameSnapshot: true, vendorTaxIdSnapshot: true, branchId: true,
  grandTotalAmount: true, whtAmount: true, whtRemittance: true, whtCategoryCode: true, whtRate: true, whtInputJson: true, netPayableAmount: true, outstandingAmount: true,
  lines: { orderBy: { lineNumber: 'asc' as const }, select: { description: true, whtAmount: true, whtRate: true, taxableAmount: true } },
} } } }, revisions: { orderBy: { revision: 'asc' as const } } };
export type DisbursementLifecycleVoucher = Prisma.DisbursementVoucherGetPayload<{ include: typeof detailInclude }>;

@Injectable()
export class PrismaDisbursementVoucherRepository {
  constructor(private readonly prisma: PrismaService, private readonly documentNumbers: PrismaDocumentSequenceRepository = new PrismaDocumentSequenceRepository(prisma)) {}

  companyForPrint(companyId: string) {
    return this.prisma.client.company.findFirst({ where: { id: companyId }, select: { name: true, registeredName: true, taxId: true, addressJson: true, phone: true } });
  }

  async memberNames(companyId: string, ids: (string | null | undefined)[], db: Prisma.TransactionClient = this.prisma.client, includeInactive = false) {
    const users = await db.user.findMany({ where: { id: { in: [...new Set(ids.filter((id): id is string => Boolean(id)))] },
      memberships: { some: { companyId, ...(!includeInactive ? { status: { not: 'DISABLED' as const } } : {}) } } }, select: { id: true, displayName: true } });
    return new Map(users.map(u => [u.id, u.displayName]));
  }

  /** Same permission resolver and candidate query as workflow's membersAbleToAct. */
  async approvers(companyId: string, branchId: string, db: Prisma.TransactionClient = this.prisma.client) {
    return this.membersWithPermission(companyId, branchId, 'expense.disbursement.approve', db);
  }

  async membersWithPermission(companyId: string, branchId: string, key: string, db: Prisma.TransactionClient = this.prisma.client) {
    if (!await db.branch.findFirst({ where: { companyId, id: branchId, status: 'ACTIVE' }, select: { id: true } })) return [];
    const prisma = { client: db } as PrismaService;
    const candidates = await new PrismaWorkflowRepository(prisma).findUserIdsByPermissions(companyId, [key]);
    const resolver = new PrismaPermissionResolverRepository(prisma);
    const eligible = await Promise.all([...new Set(candidates)].map(async userId => {
      try {
        const access = await resolver.resolveForUser({ userId, companyId });
        return access.permissions.includes(key) && isBranchInScope(access.scopes, branchId) ? userId : null;
      } catch (error) { if (error instanceof ForbiddenException) return null; throw error; }
    }));
    const names = await this.memberNames(companyId, eligible, db);
    return eligible.flatMap(userId => userId && names.has(userId) ? [{ userId, displayName: names.get(userId)! }] : []).sort((a, b) => a.displayName.localeCompare(b.displayName, 'th'));
  }

  async activeMemberIds(companyId: string, ids: string[], db: Prisma.TransactionClient = this.prisma.client) {
    const rows = await db.companyMembership.findMany({ where: { companyId, status: 'ACTIVE', userId: { in: [...new Set(ids)] } }, select: { userId: true } });
    return rows.map(row => row.userId);
  }

  async canOwnerRecover(voucher: Pick<DisbursementLifecycleVoucher, 'companyId' | 'preparedByUserId' | 'submittedByUserId'>, isOwner: boolean, db: Prisma.TransactionClient = this.prisma.client) {
    return isOwner && (await this.activeMemberIds(voucher.companyId, [voucher.preparedByUserId, ...(voucher.submittedByUserId ? [voucher.submittedByUserId] : [])], db)).length === 0;
  }

  /** Internal post-commit facts only; never returns the account secret or snapshot. */
  async notificationFacts(companyId: string, id: string) {
    const voucher = await this.prisma.client.disbursementVoucher.findFirst({ where: { companyId, id }, include: detailInclude });
    if (!voucher) return null;
    const paymentIds = voucher.lines.flatMap(line => line.expensePaymentId ? [line.expensePaymentId] : []);
    const payments = paymentIds.length ? await this.prisma.client.expensePayment.findMany({ where: { companyId, id: { in: paymentIds }, status: 'RECORDED' }, select: { id: true } }) : [];
    return { header: disbursementVoucherHeader(voucher), hasRemainingPayments: payments.length > 0,
      hasEarlierPayment: voucher.lines.some(line => new Prisma.Decimal(String(line.expense.netPayableAmount)).greaterThan(String(line.expense.outstandingAmount))) };
  }

  async lastReminder(tx: Prisma.TransactionClient, companyId: string, voucherId: string, userId: string, revision?: number) {
    // The journal survives A → B → A: a single last-recipient pointer cannot enforce a limit per person.
    const prior = await tx.disbursementVoucherCommand.findFirst({ where: { companyId, voucherId,
      resultJson: { path: ['reminder', 'userId'], equals: userId },
      ...(revision === undefined ? {} : { AND: [{ resultJson: { path: ['header', 'revision'], equals: revision } }] }) }, orderBy: { createdAt: 'desc' }, select: { resultJson: true } });
    const reminder = (prior?.resultJson as { reminder?: { at: string } } | undefined)?.reminder;
    return reminder ? new Date(reminder.at) : null;
  }

  async payeeAccount(scope: DisbursementReadScope, payeeKey: string, branchId?: string) {
    // The existing payee key normalizes Thai names in application code; only masked candidates are read.
    const rows = await this.prisma.client.disbursementVoucher.findMany({
      where: { ...disbursementVoucherReadWhere(scope, branchId), payeeAccountLast4: { not: null }, payeeAccountCiphertext: { not: null } },
      select: { id: true, status: true, createdAt: true, payeeBankName: true, payeeAccountName: true, payeeAccountLast4: true,
        lines: { orderBy: { position: 'asc' }, take: 1, select: { expense: { select: { id: true, vendorNameSnapshot: true, vendorTaxIdSnapshot: true } } } } },
    });
    const rank = { PAID: 0, APPROVED: 1, PENDING_APPROVAL: 1, DRAFT: 2, CANCELLED: 3 };
    const found = rows.filter(row => row.lines[0] && disbursementPayeeIdentity(row.lines[0].expense).payeeKey === payeeKey)
      .sort((a, b) => rank[a.status] - rank[b.status] || b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))[0];
    return found ? { bankName: found.payeeBankName, accountName: found.payeeAccountName, last4: found.payeeAccountLast4!, sourceVoucherId: found.id } : null;
  }

  async findVisible(scope: DisbursementReadScope, id: string, includeInactiveNames = false) {
    const voucher = await this.prisma.client.disbursementVoucher.findFirst({ where: { ...disbursementVoucherReadWhere(scope), id }, include: detailInclude });
    if (!voucher) return null;
    const withholdingIds = voucher.lines.filter(l => new Prisma.Decimal(String(l.expense.whtAmount)).greaterThan(0)).map(l => l.expenseId);
    // The certificate pointer is plain, so join once for all readable expenses; exclude cancelled certificates.
    const handoffs = withholdingIds.length ? await this.prisma.client.$queryRaw<{
      sourcePaymentId: string; status: string; certificateNumber: string | null; externalCertificateNumber: string | null;
    }[]>`SELECT DISTINCT ON (h."sourcePaymentId") h."sourcePaymentId", h."status", c."certificateNumber", h."externalCertificateNumber"
      FROM "WhtCertificateHandoff" h LEFT JOIN "WhtCertificate" c
        ON c."id" = h."certificateId" AND c."companyId" = h."companyId" AND c."status" = 'ISSUED'
      WHERE h."companyId" = ${scope.companyId} AND h."sourcePaymentType" = 'expense.record'
        AND h."sourcePaymentId" IN (${Prisma.join(withholdingIds)})
      ORDER BY h."sourcePaymentId", h."updatedAt" DESC, h."id" DESC` : [];
    const withholdingCertificates = new Map<string, DisbursementVoucherDetail['lines'][number]['withholdingCertificate']>(withholdingIds.map(id => [id, { state: voucher.lines.some(line => line.expenseId === id && line.expense.whtRemittance === 'E_WHT') ? 'E_WHT' : 'PENDING', number: null }]));
    for (const h of handoffs) {
      if (withholdingCertificates.get(h.sourcePaymentId)?.state === 'E_WHT') continue;
      if (h.status === 'SYSTEM_ISSUED' && h.certificateNumber) withholdingCertificates.set(h.sourcePaymentId, { state: 'SYSTEM_ISSUED', number: h.certificateNumber });
      else if (h.status === 'EXTERNAL_LINKED') withholdingCertificates.set(h.sourcePaymentId, { state: 'EXTERNAL_LINKED', number: h.externalCertificateNumber });
    }
    const slip = voucher.slipAttachmentId ? await this.prisma.client.attachmentLink.findFirst({ where: { companyId: scope.companyId, attachmentId: voucher.slipAttachmentId,
      targetType: DISBURSEMENT_VOUCHER_ATTACHMENT_TARGET_TYPE, targetId: id, purpose: DISBURSEMENT_VOUCHER_SLIP_PURPOSE, attachment: { status: 'ACTIVE' } },
      select: { attachmentId: true, linkedByUserId: true, createdAt: true } }) : null;
    const names = await this.memberNames(scope.companyId, [voucher.preparedByUserId, voucher.submittedByUserId, voucher.requestedApproverUserId, voucher.approvedByUserId, voucher.paidByUserId, voucher.returnedByUserId, voucher.cancelledByUserId, voucher.lastReminderToUserId,
      voucher.payeeBasis === 'PREPARER_CONFIRMED' ? voucher.payeeConfirmedByUserId : null,
      slip?.linkedByUserId, ...voucher.revisions.flatMap(r => [r.submittedByUserId, r.requestedApproverUserId, r.decidedByUserId, r.postApprovalByUserId])], this.prisma.client, includeInactiveNames);
    // Project legacy pointers from the journal's exact round, even when two actions share a timestamp.
    const lastReminderAt = voucher.lastReminderToUserId ? await this.lastReminder(this.prisma.client, scope.companyId, id, voucher.lastReminderToUserId, voucher.revision) : null;
    const ids = voucher.lines.flatMap(l => l.expensePaymentId ? [l.expensePaymentId] : []);
    const payments = ids.length ? await this.prisma.client.expensePayment.findMany({ where: { companyId: scope.companyId, id: { in: ids } }, select: { id: true, status: true } }) : [];
    const covered = ids.length ? await this.prisma.client.disbursementVoucherLine.findMany({ where: { companyId: scope.companyId, coversPaymentId: { in: ids } }, select: { coversPaymentId: true } }) : [];
    const related = await this.prisma.client.disbursementVoucher.findMany({ where: { companyId: scope.companyId, OR: [{ replacesVoucherId: id }, ...(voucher.replacesVoucherId ? [{ id: voucher.replacesVoucherId }] : [])] }, select: { id: true, documentNumber: true, replacesVoucherId: true } });
    const visibleRelated = related.length ? await this.prisma.client.disbursementVoucher.findMany({ where: { ...disbursementVoucherReadWhere(scope), id: { in: related.map(v => v.id) } }, select: { id: true } }) : [];
    return { ...voucher, withholdingCertificates, lastReminderAt, lastReminderToUserId: lastReminderAt ? voucher.lastReminderToUserId : null, slip, related, visibleRelated: new Set(visibleRelated.map(v => v.id)), uncoveredLivePayments: new Set(payments.filter(p => p.status === 'RECORDED' && !covered.some(l => l.coversPaymentId === p.id)).map(p => p.id)), names, livePayments: new Set(payments.filter(p => p.status === 'RECORDED').map(p => p.id)), payeeConfirmerName: voucher.payeeBasis === 'PREPARER_CONFIRMED' ? names.get(voucher.payeeConfirmedByUserId ?? '') ?? null : null };
  }

  async supportingFiles(companyId: string, id: string) {
    return this.prisma.client.attachmentLink.findMany({ where: { companyId, targetType: DISBURSEMENT_VOUCHER_ATTACHMENT_TARGET_TYPE,
      targetId: id, purpose: DISBURSEMENT_VOUCHER_SUPPORTING_PURPOSE, attachment: { status: 'ACTIVE', companyId } },
      include: { attachment: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  }

  async findSupportingUpload(companyId: string, id: string, attachmentId: string, userId: string) {
    return this.prisma.client.attachmentObject.findFirst({ where: { companyId, id: attachmentId, uploadedByUserId: userId,
      metadataJson: { equals: { generatedFor: DISBURSEMENT_VOUCHER_SUPPORTING_UPLOAD_TAG, voucherId: id } } } });
  }

  async changeSupportingFileAtomic(scope: DisbursementReadScope, id: string, attachmentId: string, userId: string, remove: boolean, audit: (tx: Prisma.TransactionClient) => Promise<void>) {
    return this.prisma.client.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '10s'`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${scope.companyId}:${id}:disbursement-voucher-lifecycle`}))`;
      const voucher = await tx.disbursementVoucher.findFirst({ where: { ...disbursementVoucherReadWhere(scope), id } });
      if (!voucher) throw new NotFoundException(disbursementVoucherError('disbursement_not_found'));
      if (voucher.status !== 'DRAFT') throw new ConflictException(disbursementVoucherError('disbursement_supporting_frozen'));
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${scope.companyId}:${attachmentId}:attachment-retention`}))`;
      const where = { companyId: scope.companyId, attachmentId, targetType: DISBURSEMENT_VOUCHER_ATTACHMENT_TARGET_TYPE, targetId: id, purpose: DISBURSEMENT_VOUCHER_SUPPORTING_PURPOSE };
      const existing = await tx.attachmentLink.findFirst({ where });
      if (remove) { await tx.attachmentLink.deleteMany({ where }); }
      else if (!existing) {
        const file = await tx.attachmentObject.findFirst({ where: { companyId: scope.companyId, id: attachmentId, branchId: voucher.branchId,
          uploadedByUserId: userId, status: 'ACTIVE', mimeType: { in: REIMBURSEMENT_PAYMENT_SLIP_MIME_TYPES }, byteSize: { gt: 0, lte: REIMBURSEMENT_PAYMENT_SLIP_MAX_BYTES },
          metadataJson: { equals: { generatedFor: DISBURSEMENT_VOUCHER_SUPPORTING_UPLOAD_TAG, voucherId: id } } } });
        if (!file || await findAttachmentLinkConflict(tx, where)) throw new UnprocessableEntityException(disbursementVoucherError('disbursement_supporting_not_owned'));
        await tx.attachmentLink.create({ data: { ...where, linkedByUserId: userId } });
      }
      await audit(tx);
    }, { isolationLevel: 'ReadCommitted', timeout: 20000, maxWait: 5000 });
  }

  readTransaction<T>(read: (tx: Prisma.TransactionClient) => Promise<T>) { return this.prisma.client.$transaction(read); }

  async lineSlipSource(ctx: RequestContext, evidence: { id: string; revision: string; attachmentId: string; chat: string }, branchId: string) {
    const source = await this.prisma.client.expenseRecord.findFirst({ where: { companyId: ctx.companyId, id: evidence.id,
      createdByUserId: ctx.userId, captureSource: 'LINE_UPLOAD', sourceDocumentType: 'TRANSFER_SLIP', branchId,
      primaryAttachmentId: evidence.attachmentId, updatedAt: new Date(evidence.revision) } });
    const metadata = source?.sourceChannelMetadataJson as Record<string, any> | null;
    if (!source || !['DRAFT', 'NEEDS_REVIEW'].includes(source.status) || metadata?.chatKeyHash !== evidence.chat
      || metadata?.linePaymentEvidence?.state === 'LINKED' || metadata?.linePaymentEvidenceSeparate) throw new ConflictException(disbursementVoucherError('disbursement_source_changed', { number: 'ที่เลือก' }));
    const file = await this.prisma.client.attachmentObject.findFirst({ where: { id: evidence.attachmentId, companyId: ctx.companyId,
      uploadedByUserId: ctx.userId, status: 'ACTIVE', branchId, mimeType: { in: REIMBURSEMENT_PAYMENT_SLIP_MIME_TYPES }, byteSize: { lte: REIMBURSEMENT_PAYMENT_SLIP_MAX_BYTES } } });
    if (!file) throw new UnprocessableEntityException(disbursementVoucherError('disbursement_slip_not_owned'));
    return file;
  }

  async findSlipUpload(companyId: string, voucherId: string, attachmentId: string, userId: string) {
    return this.prisma.client.attachmentObject.findFirst({ where: { id: attachmentId, companyId, uploadedByUserId: userId,
      metadataJson: { equals: { generatedFor: DISBURSEMENT_VOUCHER_SLIP_UPLOAD_TAG, voucherId } } } });
  }

  async findSlipFile(companyId: string, voucherId: string, attachmentId: string, tx: Prisma.TransactionClient = this.prisma.client) {
    const link = await tx.attachmentLink.findFirst({ where: { companyId, attachmentId, targetType: DISBURSEMENT_VOUCHER_ATTACHMENT_TARGET_TYPE,
      targetId: voucherId, purpose: DISBURSEMENT_VOUCHER_SLIP_PURPOSE, attachment: { status: 'ACTIVE' } }, include: { attachment: true } });
    return link?.attachment ?? null;
  }

  async assertPaymentSlip(tx: Prisma.TransactionClient, voucher: DisbursementLifecycleVoucher, attachmentId: string) {
    const file = voucher.slipAttachmentId === attachmentId ? await this.findSlipFile(voucher.companyId, voucher.id, attachmentId, tx) : null;
    const metadata = file?.metadataJson as Record<string, unknown> | null | undefined;
    if (!file || file.branchId !== voucher.branchId || metadata?.['generatedFor'] !== DISBURSEMENT_VOUCHER_SLIP_UPLOAD_TAG || metadata['voucherId'] !== voucher.id) {
      throw new UnprocessableEntityException(disbursementVoucherError('disbursement_slip_not_owned'));
    }
  }

  async attachSlipAtomic(scope: DisbursementReadScope, id: string, attachmentId: string, userId: string,
    audit: (tx: Prisma.TransactionClient) => Promise<void>, expectedVersion?: number) {
    return this.prisma.client.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '10s'`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${scope.companyId}:${id}:disbursement-voucher-lifecycle`}))`;
      const voucher = await tx.disbursementVoucher.findFirst({ where: { ...disbursementVoucherReadWhere(scope), id } });
      if (!voucher) throw new NotFoundException(disbursementVoucherError('disbursement_not_found'));
      if (voucher.status !== 'APPROVED' && voucher.status !== 'PAID') throw new ConflictException(disbursementVoucherError('disbursement_slip_status'));
      if (expectedVersion !== undefined && voucher.version !== expectedVersion) throw new ConflictException(disbursementVoucherError('disbursement_version_conflict'));
      // The same retention lock as generic deletion: a live pointer can never refer to a deleted file.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${scope.companyId}:${attachmentId}:attachment-retention`}))`;
      await tx.$executeRaw`SELECT 1 FROM "AttachmentObject" WHERE "id" = ${attachmentId} AND "companyId" = ${scope.companyId} FOR UPDATE`;
      const conflict = await findAttachmentLinkConflict(tx, { companyId: scope.companyId, attachmentId,
        targetType: DISBURSEMENT_VOUCHER_ATTACHMENT_TARGET_TYPE, targetId: id, purpose: DISBURSEMENT_VOUCHER_SLIP_PURPOSE });
      if (conflict) throw new UnprocessableEntityException({ code: 'disbursement_slip_link_conflict', message: conflict });
      const file = await tx.attachmentObject.findFirst({ where: { id: attachmentId, companyId: scope.companyId, branchId: voucher.branchId,
        status: 'ACTIVE', mimeType: { in: REIMBURSEMENT_PAYMENT_SLIP_MIME_TYPES }, byteSize: { lte: REIMBURSEMENT_PAYMENT_SLIP_MAX_BYTES },
        metadataJson: { equals: { generatedFor: DISBURSEMENT_VOUCHER_SLIP_UPLOAD_TAG, voucherId: id } } } });
      if (!file || voucher.slipAttachmentId !== attachmentId && file.uploadedByUserId !== userId) throw new UnprocessableEntityException(disbursementVoucherError('disbursement_slip_not_owned'));
      if (voucher.slipAttachmentId === attachmentId) return;
      const changed = await tx.disbursementVoucher.updateMany({ where: { companyId: scope.companyId, id, version: voucher.version, status: voucher.status },
        data: { slipAttachmentId: attachmentId, version: { increment: 1 } } });
      if (changed.count !== 1) throw new ConflictException(disbursementVoucherError('disbursement_status_changed'));
      await tx.attachmentLink.deleteMany({ where: { companyId: scope.companyId, targetType: DISBURSEMENT_VOUCHER_ATTACHMENT_TARGET_TYPE, targetId: id, purpose: DISBURSEMENT_VOUCHER_SLIP_PURPOSE } });
      await tx.attachmentLink.create({ data: { companyId: scope.companyId, attachmentId, targetType: DISBURSEMENT_VOUCHER_ATTACHMENT_TARGET_TYPE, targetId: id,
        purpose: DISBURSEMENT_VOUCHER_SLIP_PURPOSE, linkedByUserId: userId } });
      await audit(tx);
    }, { isolationLevel: 'ReadCommitted', timeout: 20000, maxWait: 5000 });
  }

  async issueAtomic(input: DisbursementReadScope & { id?: string; expenseId?: string; commandId: string; payloadFingerprint: string },
    issue: (tx: Prisma.TransactionClient, old: DisbursementLifecycleVoucher | null) => Promise<DisbursementVoucherHeader>) {
    return this.prisma.client.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '10s'`;
      let old: DisbursementLifecycleVoucher | null = null;
      if (input.id) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.companyId}:${input.id}:disbursement-voucher-lifecycle`}))`;
        old = await tx.disbursementVoucher.findFirst({ where: { ...disbursementVoucherReadWhere(input), id: input.id }, include: detailInclude });
        if (!old) throw new NotFoundException(disbursementVoucherError('disbursement_not_found'));
        for (const expenseId of [...new Set(old.lines.map(l => l.expenseId))].sort()) await lockExpenseCorrection(tx, input.companyId, expenseId);
      } else {
        await lockExpenseCorrection(tx, input.companyId, input.expenseId!);
        if (!await tx.expenseRecord.findFirst({ where: { ...expenseReadScopeWhere(input, input.scopes, input.relatedUserId), id: input.expenseId }, select: { id: true } })) throw new UnprocessableEntityException(disbursementVoucherError('disbursement_expense_unreadable'));
      }
      // Submit/pay take the command lock before expense locks. Never wait in the opposite
      // order here: a busy command retries, while the unique journal still guards its intent.
      const [commandLock] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${`${input.companyId}:${input.commandId}:disbursement-voucher-command`})) AS locked`;
      if (!commandLock?.locked) throw new ConflictException(disbursementVoucherError('disbursement_changed_retry'));
      const prior = await tx.disbursementVoucherCommand.findUnique({ where: { companyId_commandId: { companyId: input.companyId, commandId: input.commandId } } });
      if (prior) {
        if (prior.payloadFingerprint !== input.payloadFingerprint) throw new ConflictException(disbursementVoucherError('disbursement_command_conflict'));
        const current = await tx.disbursementVoucher.findFirst({ where: { ...disbursementVoucherReadWhere(input), id: prior.voucherId } });
        if (!current) throw new NotFoundException(disbursementVoucherError('disbursement_not_found'));
        return disbursementVoucherHeader(current);
      }
      const header = await issue(tx, old);
      const lines = await tx.disbursementVoucherLine.findMany({ where: { companyId: input.companyId, voucherId: header.id }, select: { expenseId: true } });
      await tx.disbursementVoucherCommand.create({ data: { companyId: input.companyId, commandId: input.commandId, voucherId: header.id, payloadFingerprint: input.payloadFingerprint, resultJson: { header, expenseIds: lines.map(l => l.expenseId) } } });
      return header;
    }, { isolationLevel: 'ReadCommitted', timeout: 20000, maxWait: 5000 });
  }

  async lifecycleAtomic(input: DisbursementReadScope & { id: string; actorUserId: string; isOwner?: boolean; action: DisbursementVoucherLifecycleAction; commandId: string; expectedVersion: number; payloadFingerprint: string; permissions: string[]; approveNow?: boolean },
    mutate: (tx: Prisma.TransactionClient, voucher: DisbursementLifecycleVoucher) => Promise<Prisma.DisbursementVoucherUpdateManyMutationInput>,
    audit: (tx: Prisma.TransactionClient, header: DisbursementVoucherHeader) => Promise<void>) {
    return this.prisma.client.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '10s'`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.companyId}:${input.id}:disbursement-voucher-lifecycle`}))`;
      const voucher = await tx.disbursementVoucher.findFirst({ where: { ...disbursementVoucherReadWhere(input), id: input.id }, include: detailInclude });
      if (!voucher) throw new NotFoundException(disbursementVoucherError('disbursement_not_found'));
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.companyId}:${input.commandId}:disbursement-voucher-command`}))`;
      const prior = await tx.disbursementVoucherCommand.findUnique({ where: { companyId_commandId: { companyId: input.companyId, commandId: input.commandId } } });
      if (prior) {
        if (prior.payloadFingerprint !== input.payloadFingerprint) throw new ConflictException(disbursementVoucherError('disbursement_command_conflict'));
        return disbursementVoucherHeader(voucher);
      }
      const preparersInactive = (input.action === 'withdraw' || input.action === 'cancel' || input.action === 'return') && await this.canOwnerRecover(voucher, true, tx);
      const canRecover = input.isOwner === true && preparersInactive;
      assertDisbursementVoucherAction(voucher, input.approveNow ? 'submitAndApprove' : input.action, input.permissions, input.actorUserId, canRecover, preparersInactive);
      if (voucher.version !== input.expectedVersion) throw new ConflictException(disbursementVoucherError('disbursement_version_conflict'));
      const data = await mutate(tx, voucher);
      const changed = await tx.disbursementVoucher.updateMany({ where: { companyId: input.companyId, id: input.id, version: input.expectedVersion, status: voucher.status }, data: { ...data, version: { increment: 1 } } });
      if (changed.count !== 1) throw new ConflictException(disbursementVoucherError('disbursement_version_conflict'));
      const current = await tx.disbursementVoucher.findFirstOrThrow({ where: { companyId: input.companyId, id: input.id } });
      const header = disbursementVoucherHeader(current);
      await audit(tx, header);
      await tx.disbursementVoucherCommand.create({ data: { companyId: input.companyId, commandId: input.commandId, voucherId: input.id,
        payloadFingerprint: input.payloadFingerprint, resultJson: { header, expenseIds: voucher.lines.map(l => l.expenseId),
          ...(input.action === 'remind' ? { reminder: { userId: current.lastReminderToUserId, at: current.lastReminderAt!.toISOString() } } : {}) } } });
      return header;
    }, { isolationLevel: 'ReadCommitted', timeout: input.action === 'pay' ? 20000 : 60000, maxWait: 5000 });
  }

  async lockPaymentKeys(tx: Prisma.TransactionClient, voucher: DisbursementLifecycleVoucher) {
    const keys = voucher.lines.map(l => `dv:${voucher.id}:${l.id}`).sort();
    for (const key of keys) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${voucher.companyId}:${key}:expense-payment-command`}))`;
  }

  async lockSources(tx: Prisma.TransactionClient, voucher: DisbursementLifecycleVoucher, fundingRefusal: (error: unknown, line: DisbursementLifecycleVoucher['lines'][number]) => never, checkFunding = true) {
    const lines = [...voucher.lines].sort((a, b) => a.expenseId < b.expenseId ? -1 : a.expenseId > b.expenseId ? 1 : 0);
    await lockFundingEvidence(tx, voucher.companyId, { expenseIds: lines.map(l => l.expenseId), attachmentIds: [] });
    for (const line of checkFunding ? lines : []) {
      try { await assertFundingMutation(tx, voucher.companyId, line.expenseId, 'payment'); } catch (error) { fundingRefusal(error, line); }
    }
    for (const line of lines) await lockExpenseCorrection(tx, voucher.companyId, line.expenseId);
  }

  async reserveSources(tx: Prisma.TransactionClient, voucher: DisbursementLifecycleVoucher) {
    const ids = voucher.lines.map(l => l.expenseId);
    const count = await tx.$executeRaw`UPDATE "ExpenseRecord" SET "reservedByDisbursementVoucherId" = ${voucher.id} WHERE "companyId" = ${voucher.companyId} AND "id" IN (${Prisma.join(ids)}) AND "reservedByDisbursementVoucherId" IS NULL`;
    if (count !== ids.length) {
      const conflict = await tx.expenseRecord.findFirst({ where: { companyId: voucher.companyId, id: { in: ids }, reservedByDisbursementVoucherId: { not: null }, NOT: { reservedByDisbursementVoucherId: voucher.id } }, select: { expenseNumber: true, reservedByDisbursementVoucherId: true } });
      const owner = conflict?.reservedByDisbursementVoucherId ? await tx.disbursementVoucher.findFirst({ where: { companyId: voucher.companyId, id: conflict.reservedByDisbursementVoucherId }, select: { documentNumber: true } }) : null;
      throw new UnprocessableEntityException({ code: 'disbursement_expense_reserved', message: `รายการ ${conflict?.expenseNumber || 'ที่เลือก'}: ${disbursementExpenseReasonMessage('reserved', owner?.documentNumber)}` });
    }
    return count;
  }

  async clearSources(tx: Prisma.TransactionClient, voucher: Pick<DisbursementLifecycleVoucher, 'companyId' | 'id'>) {
    await tx.$executeRaw`UPDATE "ExpenseRecord" SET "reservedByDisbursementVoucherId" = NULL WHERE "companyId" = ${voucher.companyId} AND "reservedByDisbursementVoucherId" = ${voucher.id}`;
  }

  async numberAtSubmit(tx: Prisma.TransactionClient, voucher: DisbursementLifecycleVoucher, userId: string, periodKey: string) {
    if (voucher.documentNumber) return voucher.documentNumber;
    const number = await this.documentNumbers.reserveNumberInTransaction(tx, { companyId: voucher.companyId, branchId: voucher.branchId,
      documentType: 'expense.disbursement_voucher', periodKey, idempotencyKey: `disbursement:${voucher.id}:number`, reservedByUserId: userId });
    if (number.status === 'COMMITTED' && number.ownerType === 'disbursement_voucher' && number.ownerId === voucher.id) return number.documentNumber;
    if (number.status !== 'RESERVED') throw new ConflictException(disbursementVoucherError('disbursement_number_unavailable'));
    await this.documentNumbers.commitNumberInTransaction(tx, { id: number.id, companyId: voucher.companyId, ownerType: 'disbursement_voucher', ownerId: voucher.id });
    return number.documentNumber;
  }

  async list(scope: DisbursementReadScope, query: { q?: string; branchId?: string; status?: DisbursementVoucherStatus; order?: 'newest' | 'oldest'; page: number; pageSize: number }) {
    // One snapshot for rows and counts, even when another transaction inserts or changes status.
    return this.prisma.client.$transaction(async tx => {
      const q = query.q?.trim();
      const where: Prisma.DisbursementVoucherWhereInput = { ...disbursementVoucherReadWhere(scope, query.branchId),
        ...(q ? { OR: [{ payeeName: { contains: q, mode: 'insensitive' } }, { documentNumber: { contains: q, mode: 'insensitive' } }] } : {}) };
      const groups = await tx.disbursementVoucher.groupBy({ by: ['status'], where, _count: { _all: true }, _sum: { totalAmount: true } });
      const counts = Object.fromEntries(DISBURSEMENT_VOUCHER_STATUSES.map(s => [s, 0])) as Record<DisbursementVoucherStatus, number>;
      const sums = Object.fromEntries(DISBURSEMENT_VOUCHER_STATUSES.map(s => [s, '0.00'])) as Record<DisbursementVoucherStatus, string>;
      for (const group of groups) {
        counts[group.status as DisbursementVoucherStatus] = group._count._all;
        sums[group.status as DisbursementVoucherStatus] = new Prisma.Decimal(group._sum.totalAmount ?? 0).toFixed(2);
      }
      // Keep the shared every-line visibility predicate in Prisma; SQL orders only those IDs.
      const visible = await tx.disbursementVoucher.findMany({ where: { ...where, ...(query.status ? { status: query.status } : {}) }, select: { id: true } });
      const direction = query.order === 'oldest' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
      const ordered = visible.length ? await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT "id" FROM "DisbursementVoucher"
        WHERE "companyId" = ${scope.companyId} AND "id" = ANY(${visible.map(v => v.id)}::text[])
        ORDER BY COALESCE("paidDate", "plannedPayDate", "createdAt"::date) ${direction}, "createdAt" ${direction}, "id" ${direction}
        LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`) : [];
      const pageRows = ordered.length ? await tx.disbursementVoucher.findMany({
        where: { ...where, id: { in: ordered.map(v => v.id) } }, include: { _count: { select: { lines: true } } },
      }) : [];
      const byId = new Map(pageRows.map(v => [v.id, v]));
      const rows = ordered.map(v => byId.get(v.id)!);
      const cancelledIds = rows.filter(v => v.status === 'CANCELLED' && v.cancelledAfterPaid).map(v => v.id);
      const paid = cancelledIds.length ? await tx.$queryRaw<{ voucherId: string; amount: Prisma.Decimal }[]>`
        SELECT l."voucherId", COALESCE(SUM(l."amount") FILTER (WHERE p."status" = 'RECORDED'), 0) AS amount
        FROM "DisbursementVoucherLine" l LEFT JOIN "ExpensePayment" p
          ON p."id" = l."expensePaymentId" AND p."companyId" = l."companyId" AND p."expenseId" = l."expenseId"
        WHERE l."companyId" = ${scope.companyId} AND l."voucherId" IN (${Prisma.join(cancelledIds)})
        GROUP BY l."voucherId"` : [];
      const amountsInEffect = new Map(rows.filter(v => cancelledIds.includes(v.id)).map(v => {
        const display = disbursementVoucherPaymentAmount(String(v.totalAmount), [{ amount: String(paid.find(p => p.voucherId === v.id)?.amount ?? 0), paymentInEffect: true }]);
        return [v.id, display.excludesCancelled ? display.amount : null];
      }));
      return { rows, counts, sums, amountsInEffect, total: query.status ? counts[query.status] : Object.values(counts).reduce((sum, n) => sum + n, 0) };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async saveDraftAtomic(input: DisbursementReadScope & { id?: string; expectedVersion?: number; actorUserId: string; permissions: string[]; commandId: string; payloadFingerprint: string },
    prepare: (tx: Prisma.TransactionClient) => Promise<DisbursementDraftData>, audit: (tx: Prisma.TransactionClient, header: DisbursementVoucherHeader) => Promise<void>) {
    return this.prisma.client.$transaction(async tx => {
      if (input.id) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.companyId}:${input.id}:disbursement-voucher-lifecycle`}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.companyId}:${input.commandId}:disbursement-voucher-command`}))`;
      const prior = await tx.disbursementVoucherCommand.findUnique({ where: { companyId_commandId: { companyId: input.companyId, commandId: input.commandId } } });
      if (prior) {
        const result = prior.resultJson as unknown as { header: DisbursementVoucherHeader; expenseIds: string[] };
        const current = await tx.disbursementVoucher.findFirst({ where: { companyId: input.companyId, id: prior.voucherId }, include: { lines: true } });
        const expenseIds = current ? current.lines.map(l => l.expenseId) : result.expenseIds;
        const count = await tx.expenseRecord.count({ where: { ...expenseReadScopeWhere(input, input.scopes, input.relatedUserId), id: { in: expenseIds } } });
        if (!isBranchInScope(input.scopes, current?.branchId ?? result.header.branchId) || count !== expenseIds.length) throw new NotFoundException(disbursementVoucherError('disbursement_not_found'));
        if (prior.payloadFingerprint !== input.payloadFingerprint) throw new ConflictException(disbursementVoucherError('disbursement_command_conflict'));
        return current ? disbursementVoucherHeader(current) : result.header;
      }
      if (input.id) {
        const current = await tx.disbursementVoucher.findFirst({ where: { ...disbursementVoucherReadWhere(input), id: input.id } });
        if (!current) throw new NotFoundException(disbursementVoucherError('disbursement_not_found'));
        assertDisbursementVoucherAction(current, 'edit', input.permissions);
        if (current.version !== input.expectedVersion) throw new ConflictException(disbursementVoucherError('disbursement_version_conflict'));
      }
      const { lines, ...data } = await prepare(tx);
      let voucher;
      if (input.id) {
        const changed = await tx.disbursementVoucher.updateMany({ where: { id: input.id, companyId: input.companyId, version: input.expectedVersion, status: 'DRAFT' }, data: { ...data, version: { increment: 1 } } });
        if (changed.count !== 1) throw new ConflictException(disbursementVoucherError('disbursement_version_conflict'));
        await tx.disbursementVoucherLine.deleteMany({ where: { companyId: input.companyId, voucherId: input.id } });
        voucher = await tx.disbursementVoucher.findFirst({ where: { id: input.id, companyId: input.companyId } });
      } else {
        voucher = await tx.disbursementVoucher.create({ data: { ...data, companyId: input.companyId, preparedByUserId: input.actorUserId, origin: 'PREPARED' } });
      }
      if (!voucher) throw new NotFoundException(disbursementVoucherError('disbursement_not_found'));
      await tx.disbursementVoucherLine.createMany({ data: lines.map(line => ({ ...line, companyId: input.companyId, voucherId: voucher.id })) });
      const header = disbursementVoucherHeader(voucher);
      await audit(tx, header);
      await tx.disbursementVoucherCommand.create({ data: { companyId: input.companyId, commandId: input.commandId, voucherId: voucher.id, payloadFingerprint: input.payloadFingerprint,
        resultJson: { header, expenseIds: lines.map(l => l.expenseId) },
      } });
      return header;
    }, { isolationLevel: 'ReadCommitted', timeout: 10000 });
  }

  async deleteDraftAtomic(scope: DisbursementReadScope, id: string, permissions: string[], audit: (tx: Prisma.TransactionClient) => Promise<void>) {
    return this.prisma.client.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${scope.companyId}:${id}:disbursement-voucher-lifecycle`}))`;
      const voucher = await tx.disbursementVoucher.findFirst({ where: { ...disbursementVoucherReadWhere(scope), id } });
      if (!voucher) throw new NotFoundException(disbursementVoucherError('disbursement_not_found'));
      if (voucher.documentNumber !== null) throw new ConflictException(disbursementVoucherError('disbursement_numbered_delete'));
      assertDisbursementVoucherAction(voucher, 'delete', permissions);
      await this.clearSources(tx, voucher);
      const result = await tx.disbursementVoucher.deleteMany({ where: { companyId: scope.companyId, id, status: 'DRAFT', documentNumber: null, revision: 0, version: voucher.version } });
      if (result.count !== 1) throw new ConflictException(disbursementVoucherError('disbursement_version_conflict'));
      await audit(tx);
    });
  }
}
