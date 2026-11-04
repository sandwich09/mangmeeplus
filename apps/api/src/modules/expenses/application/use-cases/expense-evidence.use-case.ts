import { civilDayRangeToUtc, civilInstantDayRangeToUtc, expenseDocumentDateStatus } from '@watchdog-bms/contracts';
import { Injectable, ForbiddenException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaExpenseRepository } from '../../infrastructure/prisma-expense.repository';
import { CreateDownloadUrlUseCase } from '../../../data-model-core/application/use-cases/create-download-url.use-case';
import { AuditService } from '../../../audit/application/audit.service';
import { noReceiptDocumentLabel, buildAccountantIndexRow, buildAccountantIndexCsv, buildAccountantIndexXlsx, buildManifestEntry, evidenceRef } from '../../domain/logic/expense-export.logic';
import { PrismaService } from '../../../../common/database/prisma.service';
import { branchScopeWhere, isBranchInScope } from '../../../data-model-core/domain/logic/branch.logic';
import type {
  RequestContext, SharedEvidenceFilter, SharedEvidenceView, AccountantPackageRequest, AccountantPackageResult,
  ExpenseAttachmentRef, EvidenceManifestEntry, SkippedEvidenceEntry, AccountantEvidenceBundlePlan,
} from '@watchdog-bms/contracts';

import { DisbursementVoucherUseCase } from './disbursement-voucher.use-case';
import { disbursementVoucherReadWhere } from '../../infrastructure/prisma-disbursement-voucher.repository';
import { IssueWhtCertificateFromHandoffUseCase } from '../../../tax/application/use-cases/issue-wht-certificate-from-handoff.use-case';
import { zipStore } from '../../../../common/export/xlsx.logic';
import { assertExpenseFinancialAccess } from '../expense-commercial-access';
import { canonicalAttachmentExtension } from '../../../data-model-core/domain/logic/attachment.logic';

// Bound memory and download size: stored images/PDFs gain nothing from compression.
export const EVIDENCE_BUNDLE_MAX_FILES = 60;
export const EVIDENCE_BUNDLE_MAX_BYTES = 60_000_000; // 60 MB of file bytes; one oversized file travels alone.

function hasPerm(ctx: RequestContext, perm: string): boolean {
  return ctx.permissions.includes(perm);
}

function toIso(value: Date | string | null | undefined): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : value;
}

function toAttachmentRef(a: { id: string; purpose: string; originalFileName: string; mimeType: string; byteSize: number; checksumSha256: string | null; status: string; createdAt: Date | string; sourceExpenseId?: string; isHistorical?: boolean; substituteReceiptStatus?: string }): ExpenseAttachmentRef {
  return {
    ...(a.sourceExpenseId && { sourceExpenseId: a.sourceExpenseId }),
    ...(a.isHistorical !== undefined && { isHistorical: a.isHistorical }),
    ...(a.substituteReceiptStatus && { substituteReceiptStatus: a.substituteReceiptStatus }),
    id: a.id,
    purpose: a.purpose as ExpenseAttachmentRef['purpose'],
    originalFileName: a.originalFileName,
    mimeType: a.mimeType,
    byteSize: a.byteSize,
    checksumSha256: a.checksumSha256,
    status: a.status,
    createdAt: toIso(a.createdAt),
  };
}

type BundleKind = keyof AccountantEvidenceBundlePlan['counts'];
type BundleFile = {
  kind: BundleKind; expenseIds: string[]; expenseNumber: string; fileName: string;
  attachment: { id: string; byteSize: number; status: string; originalFileName: string };
  extension: string | null; load?: () => Promise<Buffer>; number?: string;
};
const bundleName = (value: string) => value.replace(/[^A-Za-z0-9_\u0E00-\u0E7F-]/g, '_');

/**
 * Accountant/auditor shared evidence view: DB-backed virtual year/month
 * folders (uploadedAt or expenseDate) + permission-filtered rows.
 * Attachment previews/downloads still go through normal signed-URL checks.
 */
@Injectable()
export class GetSharedEvidenceViewUseCase {
  constructor(private readonly repo: PrismaExpenseRepository) {}

  async execute(ctx: RequestContext, filter: SharedEvidenceFilter): Promise<SharedEvidenceView> {
    if (!hasPerm(ctx, 'expense.evidence.read') && !hasPerm(ctx, 'expense.export')) {
      throw new ForbiddenException('Missing permission: expense.evidence.read or expense.export');
    }
    if (!isBranchInScope(ctx.scopes ?? {}, filter.branchId)) throw new ForbiddenException('Branch is outside your assigned branch scope.');
    const effectiveFilter = { ...filter, status: filter.status ?? 'CONFIRMED' as const, dateField: filter.dateField ?? 'expenseDate' as const };
    const dateField = filter.dateField === 'uploadedAt' ? 'uploadedAt' : 'expenseDate';
    const [folders, page] = await Promise.all([
      this.repo.summarizeSharedEvidenceFolders(ctx.companyId, effectiveFilter, ctx.scopes),
      this.repo.listSharedEvidence(ctx.companyId, effectiveFilter, ctx.scopes),
    ]);
    return {
      dateField,
      folders,
      rows: page.rows.map((r) => ({
        dateStatus: expenseDocumentDateStatus(r.aiVerificationSummaryJson),
        expenseId: r.id,
        expenseNumber: r.expenseNumber,
        status: r.status,
        sourceReimbursementRequestId: r.sourceReimbursementRequestId ?? null,
        sourceEvidenceUnavailable: r.evidenceSources?.sourceEvidenceUnavailable,
        missingReceiptReason: r.missingReceiptReason ?? null,
        sourceDocumentType: r.sourceDocumentType,
        sourceDocumentTypeLabel: noReceiptDocumentLabel(r),
        taxEvidenceStatus: r.taxEvidenceStatus,
        taxEvidenceReasonCode: (r.taxEvidenceReasonCode ?? null) as SharedEvidenceView['rows'][number]['taxEvidenceReasonCode'],
        vendorNameSnapshot: r.vendorNameSnapshot,
        expenseDate: toIso(r.expenseDate),
        uploadedAt: toIso(r.uploadedAt),
        grandTotalAmount: r.grandTotalAmount,
        paymentStatus: r.paymentStatus,
        postingStatus: r.postingStatus,
        postingError: r.postingError,
        journalEntryId: r.journalEntryId,
        journalEntryNumber: r.journalEntryNumber,
        pendingPostingSourceType: r.pendingPostingSourceType,
        pendingPostingSourceId: r.pendingPostingSourceId,
        expenseCategoryId: r.expenseCategoryId,
        categoryName: r.categoryName,
        createdByUserId: r.createdByUserId,
        attachments: r.attachments.map(toAttachmentRef),
      })),
      total: page.total,
      page: page.page,
      pageSize: page.pageSize,
    };
  }
}

/**
 * Accountant export package: generic Thai accounting-office index CSV (exact
 * spec column order) + evidence_manifest.json with per-file permission-checked
 * signed download links, plus a separate permission-checked archive of the file bytes.
 */
@Injectable()
export class CreateAccountantPackageUseCase {
  private readonly logger = new Logger(CreateAccountantPackageUseCase.name);

  constructor(
    private readonly repo: PrismaExpenseRepository,
    private readonly downloadUrl: CreateDownloadUrlUseCase,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
    private readonly vouchers: DisbursementVoucherUseCase,
    private readonly wht: IssueWhtCertificateFromHandoffUseCase,
  ) {}

  async execute(ctx: RequestContext, request: AccountantPackageRequest): Promise<AccountantPackageResult> {
    return this.createIndex(ctx, request, await this.bundleContents(ctx, request, false));
  }

  private async createIndex(ctx: RequestContext, request: AccountantPackageRequest, { page, files, expenseIds }: Awaited<ReturnType<CreateAccountantPackageUseCase['bundleContents']>>): Promise<AccountantPackageResult> {
    const columnSet = request.columnSet === 'full' ? 'full' : 'summary';

    const company = await this.prisma.client.company.findUnique({
      where: { id: ctx.companyId },
      select: { name: true, registeredName: true, taxId: true },
    });
    const userIds = [...new Set(page.rows.flatMap((r) => [r.createdByUserId, r.reviewedByUserId].filter((v): v is string => !!v)))];
    const users = userIds.length > 0
      ? await this.prisma.client.user.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true, email: true } })
      : [];
    const userName = new Map(users.map((u) => [u.id, u.displayName ?? u.email ?? u.id]));
    const branchIds = [...new Set(page.rows.map((row) => row.branchId).filter((id): id is string => !!id))];
    const branches = branchIds.length ? await this.prisma.client.branch.findMany({
      where: { companyId: ctx.companyId, id: { in: branchIds } }, select: { id: true, code: true },
    }) : [];
    const branchCodes = new Map(branches.map((branch) => [branch.id, branch.code]));
    const certificatesFor = (id: string) => page.rows.find(row => row.id === id)?.evidenceSources?.certificates ?? [];
    const currentCertificate = (id: string) => certificatesFor(id).slice().reverse().find(row => row.status === 'ISSUED');
    const substituteArtifactByExpense = new Map(page.rows.flatMap(row => {
      const cert = currentCertificate(row.id);
      return cert?.artifactAttachmentId ? [[row.id, cert.artifactAttachmentId] as const] : [];
    }));
    const attachmentsFor = (row: typeof page.rows[number]) => row.attachments;
    const wetSignedScansByExpense = new Map(page.rows.map(row => [row.id, certificatesFor(row.id)
      .filter(cert => cert.status !== 'SUPERSEDED' && cert.wetSignedScanAttachmentId)
      .map(cert => cert.wetSignedScanAttachmentId!)]));

    const indexRows = page.rows.map((r) => buildAccountantIndexRow({
      aiVerificationSummaryJson: r.aiVerificationSummaryJson as Record<string, unknown> | null,
      companyName: (currentCertificate(r.id)?.snapshotJson as any)?.company?.name ?? (company?.registeredName?.trim() || company?.name || ctx.companyId),
      companyTaxId: company?.taxId ?? null,
      branchCode: r.branchId ? branchCodes.get(r.branchId) ?? null : null,
      expenseId: r.id,
      expenseNumber: r.expenseNumber,
      status: r.status,
      captureSource: r.captureSource,
      // Appendix §5: a derived source's evidence ref names its capture group, so two receipts
      // split out of one payment can be recognised as one job in the folder.
      captureGroupId: r.captureGroupId ?? null,
      sourceDocumentType: r.sourceDocumentType,
      taxEvidenceStatus: r.taxEvidenceStatus,
      taxEvidenceReasonCode: r.taxEvidenceReasonCode,
      inputVatClaimStatus: r.inputVatClaimStatus,
      latestInputVatDecision: r.latestInputVatDecision,
      inputVatRecordedBeforeReview: r.inputVatRecordedBeforeReview,
      postingStatus: r.postingStatus,
      postingError: r.postingError,
      journalEntryNumber: r.journalEntryNumber,
      uploadedAt: toIso(r.uploadedAt),
      expenseDate: toIso(r.expenseDate).slice(0, 10),
      requesterName: r.evidenceSources?.requesterName ?? null,
      uploaderName: userName.get(r.createdByUserId) ?? null,
      reviewerName: r.reviewedByUserId ? userName.get(r.reviewedByUserId) ?? null : null,
      vendorNameSnapshot: r.evidenceSources?.sourceSnapshot?.seller?.name ?? (currentCertificate(r.id)?.snapshotJson as any)?.payee?.name ?? r.vendorNameSnapshot,
      vendorTaxIdSnapshot: r.evidenceSources?.sourceSnapshot ? r.evidenceSources.sourceSnapshot.seller?.taxId ?? null : r.vendorTaxIdSnapshot,
      vendorBranchCodeSnapshot: r.evidenceSources?.sourceSnapshot ? r.evidenceSources.sourceSnapshot.seller?.branchCode ?? null : r.vendorBranchCodeSnapshot,
      // GAP-7. The substitute source snapshot has no address field, so the expense's own printed
      // address is the only source — and it is what the accountant is reconciling against anyway.
      vendorAddressSnapshot: r.vendorAddressSnapshot,
      vendorDocumentNumber: r.evidenceSources?.sourceSnapshot ? r.evidenceSources.sourceSnapshot.seller?.documentNumber ?? null : r.vendorDocumentNumber,
      categoryName: r.categoryName,
      accountHintKey: r.accountHintKey,
      description: r.note,
      quantity: null,
      subtotalAmount: r.subtotalAmount,
      additionalChargesAmount: r.additionalChargesAmount,
      discountAmount: r.discountAmount,
      taxableAmount: r.taxableAmount,
      vatAmount: r.vatAmount,
      whtAmount: r.whtAmount,
      grandTotalAmount: r.grandTotalAmount,
      netPayableAmount: r.netPayableAmount,
      paidAmount: r.paidAmount,
      outstandingAmount: r.outstandingAmount,
      paymentMethod: r.paymentMethod,
      paidAt: toIso(r.paidAt),
      paymentReference: r.bankAccountRef,
      substituteReceiptRef: substituteArtifactByExpense.has(r.id)
        ? evidenceRef(r.expenseNumber, r.id, substituteArtifactByExpense.get(r.id)!)
        : null,
      fundingSource: currentCertificate(r.id)?.fundingSource ?? (certificatesFor(r.id).length ? 'LEGACY_UNSPECIFIED' : null),
      certifyingPayerName: currentCertificate(r.id)?.payerName,
      substituteEvidenceProvenance: certificatesFor(r.id).length ? JSON.stringify(certificatesFor(r.id).map(cert => ({
        expenseId: cert.expenseId, evidenceId: cert.id, version: cert.version, status: cert.status,
        snapshotChecksumSha256: cert.snapshotChecksumSha256, correctionOfEvidenceId: cert.correctionOfEvidenceId,
        correctionReason: cert.correctionReason, artifactAttachmentId: cert.artifactAttachmentId,
        webUrl: `/companies/${ctx.companyId}/expenses/${cert.expenseId}`,
      }))) : null,
      primaryAttachmentId: r.primaryAttachmentId,
      attachments: attachmentsFor(r).filter(file => !file.isHistorical).map(toAttachmentRef),
      wetSignedScanAttachmentIds: wetSignedScansByExpense.get(r.id) ?? [],
      webUrl: `/companies/${ctx.companyId}/expenses/${r.id}`,
      notes: r.internalMemo,
    }));

    for (const [i, row] of page.rows.entries()) {
      const linked = files.filter(file => file.expenseIds.includes(row.id));
      indexRows[i]!.voucher_numbers = [...new Set(linked.filter(file => file.kind === 'vouchers').map(file => file.number!))].join(', ');
      indexRows[i]!.wht_certificate_numbers = [...new Set(linked.filter(file => file.kind === 'whtCertificates').map(file => file.number!))].join(', ');
      indexRows[i]!.bundle_file_names = linked.map(file => file.fileName).join('\n');
    }

    // Per-file signed links re-check the caller's attachment permission and expire.
    const evidenceManifest: EvidenceManifestEntry[] = [];
    const skippedEvidence: SkippedEvidenceEntry[] = page.rows.filter(row => row.evidenceSources?.sourceEvidenceUnavailable).map(row => ({
      expense_id: row.id, expense_number: row.expenseNumber ?? '', attachment_id: '', file_name: '',
      reason: 'หลักฐานต้นทางบางส่วนไม่พร้อมใช้งาน หรือไม่ผ่านการตรวจสอบสิทธิ์และฉบับที่บันทึกไว้',
    }));
    for (const r of page.rows) {
      for (const attachment of attachmentsFor(r)) {
        if (attachment.status !== 'ACTIVE' && attachment.status !== 'active') continue;
        try {
          const signed = await this.downloadUrl.execute(ctx, { attachmentId: attachment.id });
          evidenceManifest.push(buildManifestEntry({
            expenseId: r.id,
            expenseNumber: r.expenseNumber,
            captureGroupId: r.captureGroupId ?? null,
            attachment: toAttachmentRef(attachment),
            isWetSignedScan: (wetSignedScansByExpense.get(r.id) ?? []).includes(attachment.id),
            sourceDocumentType: r.sourceDocumentType,
            taxEvidenceStatus: r.taxEvidenceStatus,
            downloadUrl: signed.downloadUrl,
            downloadUrlExpiresAt: signed.expiresAt.toISOString(),
            webUrl: `/companies/${ctx.companyId}/expenses/${r.id}`,
          }));
        } catch (error) {
          // Attachment the caller cannot read stays out of the manifest; row remains in the index —
          // but never silently. Swallowing this handed accountants a package that was short a file
          // with nothing anywhere saying so, which is worse than a package that says what is missing.
          const reason = error instanceof Error ? error.message : 'Download link could not be issued.';
          skippedEvidence.push({
            expense_id: r.id,
            expense_number: r.expenseNumber ?? '',
            attachment_id: attachment.id,
            file_name: attachment.originalFileName,
            reason,
          });
          this.logger.warn(`accountant package skipped attachment ${attachment.id} on expense ${r.expenseNumber}: ${reason}`);
        }
      }
    }
    const exportedAttachmentIds = new Set(evidenceManifest.map((entry) => entry.attachment_id));
    for (let index = 0; index < page.rows.length; index += 1) {
      const artifactId = substituteArtifactByExpense.get(page.rows[index]!.id);
      if (artifactId && !exportedAttachmentIds.has(artifactId)) {
        indexRows[index] = { ...indexRows[index]!, substitute_receipt_ref: '' };
      }
    }

    // Payment-month papers remain available, but cannot become another month's expense rows.
    const expenseIndexRows = indexRows.filter((_, i) => expenseIds.has(page.rows[i]!.id));
    const paymentEvidenceRows = indexRows.filter((_, i) => !expenseIds.has(page.rows[i]!.id));
    const filterSummary: Record<string, string> = {};
    for (const [key, value] of Object.entries({ ...request, status: request.status ?? 'CONFIRMED', dateField: request.dateField ?? 'expenseDate' })) {
      if (value !== undefined && value !== null && key !== 'format' && key !== 'columnSet') filterSummary[key] = String(value);
    }

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId,
      action: 'expense.accountant_package.create', targetType: 'expense_export', targetId: ctx.requestId,
      requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM',
      metadataJson: { rowCount: expenseIndexRows.length, totalMatched: page.total, truncated: expenseIndexRows.length < page.total, evidenceCount: evidenceManifest.length, skippedEvidenceCount: skippedEvidence.length, filterSummary },
    });

    return {
      generatedAt: new Date().toISOString(),
      filterSummary,
      rowCount: expenseIndexRows.length,
      totalMatched: page.total,
      truncated: expenseIndexRows.length < page.total,
      indexRows: expenseIndexRows,
      indexCsv: buildAccountantIndexCsv(expenseIndexRows),
      indexXlsxBase64: buildAccountantIndexXlsx(expenseIndexRows, columnSet, paymentEvidenceRows).toString('base64'),
      columnSet,
      evidenceManifest,
      skippedEvidence,
    };
  }

  private async readPackageRows(ctx: RequestContext, request: AccountantPackageRequest, bundle = false) {
    if (!hasPerm(ctx, 'expense.export')) throw new ForbiddenException('Missing permission: expense.export');
    if (!hasPerm(ctx, 'expense.read')) throw new ForbiddenException('Missing permission: expense.read');
    if (!isBranchInScope(ctx.scopes ?? {}, request.branchId)) throw new ForbiddenException('Branch is outside your assigned branch scope.');
    if (!ctx.roles.includes('SYSTEM_ADMIN')) await assertExpenseFinancialAccess(ctx, this.prisma.client);
    const filter = { ...request, status: request.status ?? 'CONFIRMED' as const, dateField: request.dateField ?? 'expenseDate' as const };
    const pageSize = !bundle && request.pageSize && request.pageSize > 0 && request.pageSize <= 500 ? request.pageSize : 500;
    // Keep unavailable metadata in both exports so an omitted file cannot renumber the ZIP links.
    const page = await this.repo.listSharedEvidence(ctx.companyId, { ...filter, page: bundle ? 1 : request.page ?? 1, pageSize }, ctx.scopes, true);
    // Explicit pagination remains available to existing consumers. The page exports the whole selection.
    if (bundle || (request.page === undefined && request.pageSize === undefined)) {
      let count = page.rows.length;
      for (let next = 2; count === pageSize && page.rows.length < page.total; next += 1) {
        const more = await this.repo.listSharedEvidence(ctx.companyId, { ...filter, page: next, pageSize }, ctx.scopes, true);
        count = more.rows.length;
        page.rows.push(...more.rows);
      }
    }
    return page;
  }

  private async bundleContents(ctx: RequestContext, request: AccountantPackageRequest, bundle = true) {
    const page = await this.readPackageRows(ctx, request, bundle);
    const expenseIds = new Set(page.rows.map(row => row.id));
    const db = this.prisma.client;
    let from = request.fromDate, to = request.toDate;
    if (request.yearMonth && /^\d{4}-\d{2}$/.test(request.yearMonth)) {
      const [year, month] = request.yearMonth.split('-').map(Number);
      from = `${request.yearMonth}-01`;
      to = new Date(Date.UTC(year!, month!, 0)).toISOString().slice(0, 10);
    }
    const dated = civilDayRangeToUtc(from, to);
    const expenseWhere = { companyId: ctx.companyId, ...branchScopeWhere(ctx.scopes ?? {}),
      ...(request.branchId ? { branchId: request.branchId } : {}),
      ...(request.expenseIds ? { id: { in: request.expenseIds } } : {}) };
    const payments = await db.expensePayment.findMany({ where: { companyId: ctx.companyId, status: 'RECORDED',
      paidAt: civilInstantDayRangeToUtc(from, to), expense: expenseWhere }, select: { id: true, expenseId: true } });
    const slips = payments.length ? await db.attachmentLink.findMany({ where: { companyId: ctx.companyId,
      targetType: 'expense.payment', purpose: 'expense.payment.evidence', targetId: { in: payments.map(payment => payment.id) },
      attachment: { companyId: ctx.companyId, ...branchScopeWhere(ctx.scopes ?? {}) } }, include: { attachment: true }, orderBy: { id: 'asc' } }) : [];
    const paidVouchers = ctx.authProvider !== 'line' && hasPerm(ctx, 'expense.disbursement.read')
      ? await db.disbursementVoucher.findMany({ where: { ...disbursementVoucherReadWhere({ companyId: ctx.companyId, scopes: ctx.scopes ?? {} }, request.branchId),
        status: 'PAID', paidDate: dated,
        ...(request.expenseIds ? { AND: [{ lines: { some: { expenseId: { in: request.expenseIds } } } }] } : {}) },
        select: { id: true, documentNumber: true, slipAttachmentId: true, lines: { select: { expenseId: true } } }, orderBy: { id: 'asc' } }) : [];
    // Same any-permission gate as GET .../system-certificate, then the download rechecks source scope.
    const certificates = ['wht.certificate.read', 'wht.certificate.issue', 'wht.certificate.correct', 'wht.external_certificate.link'].some(permission => hasPerm(ctx, permission))
      ? await db.whtCertificate.findMany({ where: { companyId: ctx.companyId, status: 'ISSUED', paymentDate: dated },
        select: { id: true, certificateNumber: true }, orderBy: { id: 'asc' } }) : [];
    const handoffs = certificates.length ? await db.whtCertificateHandoff.findMany({ where: { companyId: ctx.companyId,
      status: 'SYSTEM_ISSUED', certificateId: { in: certificates.map(c => c.id) }, sourcePaymentType: 'expense.record',
      ...(request.expenseIds ? { sourcePaymentId: { in: request.expenseIds } } : {}),
      ...(request.branchId ? { sourceBranchId: request.branchId } : ctx.scopes?.branchIds ? { sourceBranchId: { in: ctx.scopes.branchIds } } : {}) },
      select: { id: true, certificateId: true, sourcePaymentId: true } }) : [];
    const selection = request.expenseIds !== undefined ? new Set(request.expenseIds) : undefined;
    const extraIds = [...new Set([...payments.map(p => p.expenseId), ...paidVouchers.flatMap(v => v.lines.map(l => l.expenseId)),
      ...handoffs.flatMap(h => h.sourcePaymentId ? [h.sourcePaymentId] : [])])].filter(id => (!selection || selection.has(id)) && !page.rows.some(row => row.id === id));
    if (!bundle && (request.page !== undefined || request.pageSize !== undefined)) extraIds.length = 0;
    for (let offset = 0; offset < extraIds.length; offset += 500) {
      const extra = await this.repo.listSharedEvidence(ctx.companyId, { ...request, yearMonth: undefined, fromDate: undefined, toDate: undefined,
        status: request.status ?? 'CONFIRMED', expenseIds: extraIds.slice(offset, offset + 500), page: 1, pageSize: 500 }, ctx.scopes, true);
      page.rows.push(...extra.rows);
    }
    page.rows.sort((a, b) => (a.expenseNumber ?? a.id).localeCompare(b.expenseNumber ?? b.id) || a.id.localeCompare(b.id));
    const names = new Map(page.rows.map(row => [row.id, row.expenseNumber ?? row.id]));
    const files: BundleFile[] = [];
    const usedNames = new Set<string>();
    for (const row of page.rows) {
      row.attachments.forEach((attachment, index) => {
        const substitute = row.evidenceSources?.certificates.some(c => c.artifactAttachmentId === attachment.id || c.wetSignedScanAttachmentId === attachment.id);
        const folder = substitute ? 'ใบรับรองแทนใบเสร็จ' : 'ใบเสร็จ';
        const extension = canonicalAttachmentExtension(attachment.mimeType) ?? null;
        const stem = `${folder}/${bundleName(names.get(row.id)!)}-${index + 1}`;
        let fileName = `${stem}.${extension ?? 'bin'}`;
        if (usedNames.has(fileName)) fileName = `${stem}-${bundleName(row.id)}.${extension ?? 'bin'}`;
        usedNames.add(fileName);
        files.push({ attachment, expenseIds: [row.id], expenseNumber: names.get(row.id)!, fileName, extension,
          kind: substitute ? 'substituteReceipts' : 'receipts' });
      });
    }
    for (const slip of slips) {
      const expenseId = payments.find(payment => payment.id === slip.targetId)!.expenseId;
      if (!names.has(expenseId)) continue;
      const extension = canonicalAttachmentExtension(slip.attachment.mimeType) ?? null;
      files.push({ kind: 'paymentSlips', expenseIds: [expenseId], expenseNumber: names.get(expenseId)!, attachment: { ...slip.attachment, byteSize: Number(slip.attachment.byteSize) }, extension,
        fileName: `สลิปการจ่าย/${bundleName(names.get(expenseId)!)}-${bundleName(slip.targetId)}.${extension ?? 'bin'}` });
    }
    const addDocument = async (kind: BundleKind, ids: string[], id: string, number: string, folder: string,
      load: () => Promise<{ data: Buffer; mimeType?: string }>, name?: string) => {
      if (!ids.length || ids.some(expenseId => !names.has(expenseId))) return;
      // Measure generated documents with the real downloader, one at a time. Do not retain a
      // month's PDF buffers in memory; parts still obey the existing byte and file limits.
      let document: { data: Buffer; mimeType?: string };
      try { document = await load(); } catch (error) {
        if (error instanceof ForbiddenException || error instanceof NotFoundException) return;
        throw error;
      }
      const extension = canonicalAttachmentExtension(document.mimeType ?? 'application/pdf') ?? null;
      const expenseNumber = ids.map(expenseId => names.get(expenseId)!).sort()[0]!;
      const fileName = name ? `${folder}/${bundleName(name)}.${extension ?? 'bin'}` : `${folder}/${bundleName(expenseNumber)}-${bundleName(number)}-${bundleName(id)}.${extension ?? 'bin'}`;
      files.push({ kind, expenseIds: ids, expenseNumber, fileName, number, extension,
        attachment: { id, byteSize: document.data.length, status: 'ACTIVE', originalFileName: fileName }, load: async () => (await load()).data });
    };
    for (const voucher of paidVouchers) {
      const ids = voucher.lines.map(line => line.expenseId);
      await addDocument('vouchers', ids, voucher.id, voucher.documentNumber ?? voucher.id, 'ใบสำคัญจ่าย', () => this.vouchers.documentPdf(ctx, voucher.id));
      if (ids.length && ids.every(id => names.has(id))) {
        let supporting: Awaited<ReturnType<DisbursementVoucherUseCase['supportingFiles']>> = [];
        try { supporting = await this.vouchers.supportingFiles(ctx, voucher.id); } catch (error) {
          if (!(error instanceof ForbiddenException || error instanceof NotFoundException)) throw error;
        }
        for (const [index, file] of supporting.entries()) await addDocument('supportingFiles', ids, file.id, voucher.documentNumber ?? voucher.id, 'เอกสารประกอบการจ่าย',
          () => this.vouchers.supportingFileBytes(ctx, voucher.id, file.id), `${voucher.documentNumber ?? voucher.id}-${index + 1}`);
      }
      if (voucher.slipAttachmentId) await addDocument('paymentSlips', ids, voucher.slipAttachmentId, voucher.documentNumber ?? voucher.id, 'สลิปการจ่าย', () => this.vouchers.slipBytes(ctx, voucher.id));
    }
    for (const handoff of handoffs) {
      const certificate = certificates.find(c => c.id === handoff.certificateId)!;
      await addDocument('whtCertificates', [handoff.sourcePaymentId!], certificate.id, certificate.certificateNumber, '50ทวิ', async () => {
        const result = await this.wht.download(ctx, handoff.id);
        return { data: Buffer.from(result.pdfArtifact.contentBase64, 'base64') };
      });
    }
    const parts: BundleFile[][] = [];
    let bytes = 0;
    for (const file of files) {
      const current = parts.at(-1);
      if (!current || current.length >= EVIDENCE_BUNDLE_MAX_FILES || bytes + file.attachment.byteSize > EVIDENCE_BUNDLE_MAX_BYTES) { parts.push([]); bytes = 0; }
      parts.at(-1)!.push(file); bytes += file.attachment.byteSize;
    }
    if (!parts.length && page.rows.length) parts.push([]); // An index also explains a month with missing papers.
    const counts = { receipts: 0, substituteReceipts: 0, paymentSlips: 0, vouchers: 0, supportingFiles: 0, whtCertificates: 0 };
    for (const file of files) counts[file.kind]++;
    const missingReceiptCount = page.rows.filter(row => !files.some(file => file.expenseIds.includes(row.id)
      && (file.kind === 'substituteReceipts' || row.attachments.some(attachment => attachment.id === file.attachment.id
        && !attachment.isHistorical && (attachment.id === row.primaryAttachmentId || attachment.purpose === 'expense.receipt.primary'))) && file.attachment.status === 'ACTIVE')).length;
    return { page, expenseIds, files, parts, counts, missingReceiptCount };
  }

  async planBundle(ctx: RequestContext, request: AccountantPackageRequest): Promise<AccountantEvidenceBundlePlan> {
    const { files, parts, counts, missingReceiptCount } = await this.bundleContents(ctx, request);
    return { fileCount: files.length, partCount: parts.length, counts, missingReceiptCount };
  }

  async downloadBundle(ctx: RequestContext, request: AccountantPackageRequest, part: number) {
    const contents = await this.bundleContents(ctx, request);
    const { parts } = contents;
    if (!Number.isInteger(part) || part < 1 || part > parts.length) throw new NotFoundException();
    const entries: Record<string, Buffer> = Object.create(null);
    const skipped: string[] = [];
    for (const file of parts[part - 1]!) {
      let reason: string | undefined;
      if (file.attachment.status !== 'ACTIVE') reason = file.attachment.status === 'PENDING_UPLOAD' ? 'ไฟล์ยังตรวจสอบไม่เสร็จ' : 'ไฟล์นี้เปิดไม่ได้';
      else if (!file.extension) reason = 'ไม่รองรับชนิดไฟล์นี้';
      else {
        try {
          entries[file.fileName] = file.load ? await file.load() : await this.downloadUrl.readBytes(ctx, { attachmentId: file.attachment.id });
        } catch (error) {
          const failure = (error ?? {}) as { status?: number; code?: string; getStatus?: () => number; $metadata?: { httpStatusCode?: number } };
          const status = failure.getStatus?.() ?? failure.status ?? failure.$metadata?.httpStatusCode;
          reason = status === 404 || ['ENOENT', 'NoSuchKey', 'NoSuchVersion'].includes(failure.code ?? '') ? 'ไม่พบไฟล์'
            : status === 403 ? 'ไม่มีสิทธิ์เปิดไฟล์' : 'อ่านไฟล์ไม่ได้ ลองดาวน์โหลดอีกครั้ง';
        }
      }
      if (reason) skipped.push(`${file.expenseNumber.replace(/[\r\n\t]/g, ' ')} · ${file.attachment.originalFileName.replace(/[\r\n\t]/g, ' ')} · ${reason}`);
    }
    const fileCount = Object.keys(entries).length;
    if (skipped.length) entries['ไฟล์ที่ไม่ได้รวม.txt'] = Buffer.from(skipped.join('\n'), 'utf8');
    const index = await this.createIndex(ctx, { ...request, columnSet: 'full' }, contents);
    entries['สารบัญ.xlsx'] = Buffer.from(index.indexXlsxBase64, 'base64');
    const bytes = zipStore(entries);
    await this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId,
      action: 'expense.accountant_bundle.download', targetType: 'expense_export', targetId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'MEDIUM',
      metadataJson: { yearMonth: request.yearMonth ?? 'all', dateField: request.dateField ?? 'expenseDate', branchId: request.branchId ?? null, part, fileCount, skippedCount: skipped.length },
    });
    return { bytes, fileName: `หลักฐาน-${request.yearMonth ?? 'ทุกเดือน'}${parts.length > 1 ? `-ชุดที่-${part}` : ''}.zip` };
  }
}
