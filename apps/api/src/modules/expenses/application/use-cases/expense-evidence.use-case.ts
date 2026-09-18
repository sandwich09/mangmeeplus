import { Injectable, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaExpenseRepository } from '../../infrastructure/prisma-expense.repository';
import { CreateDownloadUrlUseCase } from '../../../data-model-core/application/use-cases/create-download-url.use-case';
import { AuditService } from '../../../audit/application/audit.service';
import { buildAccountantIndexRow, buildAccountantIndexCsv, buildAccountantIndexXlsx, buildManifestEntry, evidenceRef } from '../../domain/logic/expense-export.logic';
import { PrismaService } from '../../../../common/database/prisma.service';
import { isBranchInScope } from '../../../data-model-core/domain/logic/branch.logic';
import type {
  RequestContext, SharedEvidenceFilter, SharedEvidenceView, AccountantPackageRequest, AccountantPackageResult,
  ExpenseAttachmentRef, EvidenceManifestEntry, SkippedEvidenceEntry,
} from '@watchdog-bms/contracts';

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
    const effectiveFilter = { ...filter, status: filter.status ?? 'CONFIRMED' as const };
    const dateField = filter.dateField === 'expenseDate' ? 'expenseDate' : 'uploadedAt';
    const [folders, page] = await Promise.all([
      this.repo.summarizeSharedEvidenceFolders(ctx.companyId, effectiveFilter, ctx.scopes),
      this.repo.listSharedEvidence(ctx.companyId, effectiveFilter, ctx.scopes),
    ]);
    return {
      dateField,
      folders,
      rows: page.rows.map((r) => ({
        expenseId: r.id,
        expenseNumber: r.expenseNumber,
        status: r.status,
        sourceReimbursementRequestId: r.sourceReimbursementRequestId ?? null,
        sourceEvidenceUnavailable: r.evidenceSources?.sourceEvidenceUnavailable,
        missingReceiptReason: r.missingReceiptReason ?? null,
        sourceDocumentType: r.sourceDocumentType,
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
 * signed download links. No bundled archive in first pass.
 */
@Injectable()
export class CreateAccountantPackageUseCase {
  private readonly logger = new Logger(CreateAccountantPackageUseCase.name);

  constructor(
    private readonly repo: PrismaExpenseRepository,
    private readonly downloadUrl: CreateDownloadUrlUseCase,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(ctx: RequestContext, request: AccountantPackageRequest): Promise<AccountantPackageResult> {
    if (!hasPerm(ctx, 'expense.export')) throw new ForbiddenException('Missing permission: expense.export');
    if (!hasPerm(ctx, 'expense.read')) throw new ForbiddenException('Missing permission: expense.read');
    if (!isBranchInScope(ctx.scopes ?? {}, request.branchId)) throw new ForbiddenException('Branch is outside your assigned branch scope.');

    const columnSet = request.columnSet === 'full' ? 'full' : 'summary';
    const pageSize = request.pageSize && request.pageSize > 0 && request.pageSize <= 500 ? request.pageSize : 500;
    const effectiveRequest = { ...request, status: request.status ?? 'CONFIRMED' as const };
    const page = await this.repo.listSharedEvidence(ctx.companyId, { ...effectiveRequest, page: request.page ?? 1, pageSize }, ctx.scopes);

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

    const filterSummary: Record<string, string> = {};
    for (const [key, value] of Object.entries(effectiveRequest)) {
      if (value !== undefined && value !== null && key !== 'format' && key !== 'columnSet') filterSummary[key] = String(value);
    }

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId,
      action: 'expense.accountant_package.create', targetType: 'expense_export', targetId: ctx.requestId,
      requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM',
      metadataJson: { rowCount: indexRows.length, totalMatched: page.total, truncated: indexRows.length < page.total, evidenceCount: evidenceManifest.length, skippedEvidenceCount: skippedEvidence.length, filterSummary },
    });

    return {
      generatedAt: new Date().toISOString(),
      filterSummary,
      rowCount: indexRows.length,
      totalMatched: page.total,
      truncated: indexRows.length < page.total,
      indexRows,
      indexCsv: buildAccountantIndexCsv(indexRows),
      indexXlsxBase64: buildAccountantIndexXlsx(indexRows, columnSet).toString('base64'),
      columnSet,
      evidenceManifest,
      skippedEvidence,
    };
  }
}
