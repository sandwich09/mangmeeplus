import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaExpenseRepository } from '../../infrastructure/prisma-expense.repository';
import { CreateDownloadUrlUseCase } from '../../../data-model-core/application/use-cases/create-download-url.use-case';
import { AuditService } from '../../../audit/application/audit.service';
import { buildAccountantIndexRow, buildAccountantIndexCsv, buildAccountantIndexXlsx, buildManifestEntry, evidenceRef } from '../../domain/logic/expense-export.logic';
import { PrismaService } from '../../../../common/database/prisma.service';
import type {
  RequestContext, SharedEvidenceFilter, SharedEvidenceView, AccountantPackageRequest, AccountantPackageResult,
  ExpenseAttachmentRef, EvidenceManifestEntry,
} from '@watchdog-bms/contracts';

function hasPerm(ctx: RequestContext, perm: string): boolean {
  return ctx.permissions.includes(perm);
}

function toIso(value: Date | string | null | undefined): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : value;
}

function toAttachmentRef(a: { id: string; purpose: string; originalFileName: string; mimeType: string; byteSize: number; checksumSha256: string | null; status: string; createdAt: Date | string }): ExpenseAttachmentRef {
  return {
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
  constructor(
    private readonly repo: PrismaExpenseRepository,
    private readonly downloadUrl: CreateDownloadUrlUseCase,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(ctx: RequestContext, request: AccountantPackageRequest): Promise<AccountantPackageResult> {
    if (!hasPerm(ctx, 'expense.export')) throw new ForbiddenException('Missing permission: expense.export');
    if (!hasPerm(ctx, 'expense.read')) throw new ForbiddenException('Missing permission: expense.read');

    const columnSet = request.columnSet === 'full' ? 'full' : 'summary';
    const pageSize = request.pageSize && request.pageSize > 0 && request.pageSize <= 500 ? request.pageSize : 500;
    const effectiveRequest = { ...request, status: request.status ?? 'CONFIRMED' as const };
    const page = await this.repo.listSharedEvidence(ctx.companyId, { ...effectiveRequest, page: request.page ?? 1, pageSize }, ctx.scopes);

    const company = await this.prisma.client.company.findUnique({
      where: { id: ctx.companyId },
      select: { name: true, taxId: true },
    });
    const userIds = [...new Set(page.rows.flatMap((r) => [r.createdByUserId, r.reviewedByUserId].filter((v): v is string => !!v)))];
    const users = userIds.length > 0
      ? await this.prisma.client.user.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true, email: true } })
      : [];
    const userName = new Map(users.map((u) => [u.id, u.displayName ?? u.email ?? u.id]));
    const issuedSubstitutes = page.rows.length
      ? await this.prisma.client.expenseSubstituteReceiptEvidence.findMany({
        where: { companyId: ctx.companyId, expenseId: { in: page.rows.map((row) => row.id) }, status: 'ISSUED' },
        select: { expenseId: true, artifactAttachmentId: true },
      })
      : [];
    const substituteArtifactByExpense = new Map(
      issuedSubstitutes.filter((row) => row.artifactAttachmentId).map((row) => [row.expenseId, row.artifactAttachmentId!]),
    );

    const indexRows = page.rows.map((r) => buildAccountantIndexRow({
      companyName: company?.name ?? ctx.companyId,
      companyTaxId: company?.taxId ?? null,
      branchCode: null,
      expenseId: r.id,
      expenseNumber: r.expenseNumber,
      status: r.status,
      captureSource: r.captureSource,
      sourceDocumentType: r.sourceDocumentType,
      taxEvidenceStatus: r.taxEvidenceStatus,
      taxEvidenceReasonCode: r.taxEvidenceReasonCode,
      postingStatus: r.postingStatus,
      postingError: r.postingError,
      journalEntryNumber: r.journalEntryNumber,
      uploadedAt: toIso(r.uploadedAt),
      expenseDate: toIso(r.expenseDate).slice(0, 10),
      requesterName: null,
      uploaderName: userName.get(r.createdByUserId) ?? null,
      reviewerName: r.reviewedByUserId ? userName.get(r.reviewedByUserId) ?? null : null,
      vendorNameSnapshot: r.vendorNameSnapshot,
      vendorTaxIdSnapshot: r.vendorTaxIdSnapshot,
      vendorBranchCodeSnapshot: r.vendorBranchCodeSnapshot,
      vendorDocumentNumber: r.vendorDocumentNumber,
      categoryName: r.categoryName,
      accountHintKey: r.accountHintKey,
      description: r.note,
      quantity: null,
      subtotalAmount: r.subtotalAmount,
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
      primaryAttachmentId: r.primaryAttachmentId,
      attachments: r.attachments.map(toAttachmentRef),
      webUrl: `/companies/${ctx.companyId}/expenses/${r.id}`,
      notes: r.internalMemo,
    }));

    // Per-file signed links re-check the caller's attachment permission and expire.
    const evidenceManifest: EvidenceManifestEntry[] = [];
    for (const r of page.rows) {
      for (const attachment of r.attachments) {
        if (attachment.status !== 'ACTIVE' && attachment.status !== 'active') continue;
        try {
          const signed = await this.downloadUrl.execute(ctx, { attachmentId: attachment.id });
          evidenceManifest.push(buildManifestEntry({
            expenseId: r.id,
            expenseNumber: r.expenseNumber,
            attachment: toAttachmentRef(attachment),
            sourceDocumentType: r.sourceDocumentType,
            taxEvidenceStatus: r.taxEvidenceStatus,
            downloadUrl: signed.downloadUrl,
            downloadUrlExpiresAt: signed.expiresAt.toISOString(),
            webUrl: `/companies/${ctx.companyId}/expenses/${r.id}`,
          }));
        } catch {
          // Attachment the caller cannot read stays out of the manifest; row remains in the index.
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
      metadataJson: { rowCount: indexRows.length, totalMatched: page.total, truncated: indexRows.length < page.total, evidenceCount: evidenceManifest.length, filterSummary },
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
    };
  }
}
