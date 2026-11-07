import { accountantWhtRemittance } from '../../domain/logic/expense-export.logic';
import { buildPurchaseJournalRows, buildPurchaseJournalWorkbook } from '../../domain/logic/accounting-software-export.logic';
import type { AccountingSoftwareExportRequest, AccountingSoftwareExportResult } from '@watchdog-bms/contracts';
import { ExpenseSourceAdapter } from '../../../tax/infrastructure/adapters/expense-source.adapter';
import { withholdingFormFor } from '../../../tax/domain/logic/expense-payment-withholding.logic';
import { filedLineCoversPayment } from '../../../tax/application/services/withholding-filing-state';
import { withholdingRowFaults } from '../../../tax/application/services/withholding-filing-validation';
import { formPeriodKey, withholdingIssueDescription, makeReviewIssue } from '../../../tax/domain/logic/tax-period.logic';
import { formatThaiExportDate } from '../../../../common/export/thai-date.logic';
import { civilDayRangeToUtc, civilInstantDayRangeToUtc, expenseDocumentDateStatus, civilDate, utcDateToCivilDate, expenseEvidenceAssessment, expenseEvidenceImageMissing, TAX_EVIDENCE_REASON_LABELS, EXPENSE_STATUS_LABELS } from '@watchdog-bms/contracts';
import { Injectable, ForbiddenException, NotFoundException, UnprocessableEntityException, Logger } from '@nestjs/common';
import { PrismaExpenseRepository } from '../../infrastructure/prisma-expense.repository';
import { CreateDownloadUrlUseCase } from '../../../data-model-core/application/use-cases/create-download-url.use-case';
import { AuditService } from '../../../audit/application/audit.service';
import { noReceiptDocumentLabel, buildAccountantIndexRow, buildAccountantIndexCsv, buildAccountantWorkbook, accountantNotes, shopBranchLabel, type AccountantExportSource, type AccountantWorkbookRow, type AccountantPaymentRow, type AccountantWithholdingRow, type AccountantWorkbookFile, buildManifestEntry, evidenceRef } from '../../domain/logic/expense-export.logic';
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
  kind: BundleKind; expenseIds: string[]; expenseNumber: string; fileName: string; legacyFileName: string; part: number;
  version?: 'current' | 'superseded'; replacedBy?: string; paymentId?: string;
  attachment: { id: string; byteSize: number; status: string; originalFileName: string };
  extension: string | null; load?: () => Promise<Buffer>; number?: string;
};
const bundleName = (value: string) => value.replace(/[^A-Za-z0-9_\u0E00-\u0E7F-]/g, '_');

function accountantRange(request: AccountantPackageRequest) {
  let from = request.fromDate?.slice(0, 10), to = request.toDate?.slice(0, 10);
  if (request.yearMonth) { from = `${request.yearMonth}-01`; const [year, month] = request.yearMonth.split('-').map(Number); to = new Date(Date.UTC(year!, month!, 0)).toISOString().slice(0, 10); }
  const months: string[] = [];
  if (from && to) for (let month = from.slice(0, 7); month <= to.slice(0, 7);) {
    months.push(month); const [year, number] = month.split('-').map(Number); month = new Date(Date.UTC(year!, number!, 1)).toISOString().slice(0, 7);
  }
  return { from, to, months: from && to ? months : undefined };
}
function legacyBundleFileName(folder: string, expenseNumber: string, extension: string | null,
  options: { index?: number; id?: string; number?: string; name?: string; duplicateId?: string } = {}) {
  const stem = options.index !== undefined ? `${folder}/${bundleName(expenseNumber)}-${options.index + 1}${options.duplicateId ? `-${bundleName(options.duplicateId)}` : ''}`
    : options.name ? `${folder}/${bundleName(options.name)}` : options.number !== undefined ? `${folder}/${bundleName(expenseNumber)}-${bundleName(options.number)}-${bundleName(options.id!)}`
      : `${folder}/${bundleName(expenseNumber)}-${bundleName(options.id!)}`;
  return `${stem}.${extension ?? 'bin'}`;
}

async function readPackageRows(repo: PrismaExpenseRepository, prisma: PrismaService, ctx: RequestContext, request: AccountantPackageRequest, bundle = false) {
    if (!hasPerm(ctx, 'expense.export')) throw new ForbiddenException('Missing permission: expense.export');
    if (!hasPerm(ctx, 'expense.read')) throw new ForbiddenException('Missing permission: expense.read');
    if (!isBranchInScope(ctx.scopes ?? {}, request.branchId)) throw new ForbiddenException('Branch is outside your assigned branch scope.');
    if (!ctx.roles.includes('SYSTEM_ADMIN')) await assertExpenseFinancialAccess(ctx, prisma.client);
    const filter = { ...request, status: request.status ?? 'CONFIRMED' as const, dateField: request.dateField ?? 'expenseDate' as const };
    const pageSize = !bundle && request.pageSize && request.pageSize > 0 && request.pageSize <= 500 ? request.pageSize : 500;
    // Keep unavailable metadata in both exports so an omitted file cannot renumber the ZIP links.
    const page = await repo.listSharedEvidence(ctx.companyId, { ...filter, page: bundle ? 1 : request.page ?? 1, pageSize }, ctx.scopes, true);
    // Explicit pagination remains available to existing consumers. The page exports the whole selection.
    if (bundle || (request.page === undefined && request.pageSize === undefined)) {
      let count = page.rows.length;
      for (let next = 2; count === pageSize && page.rows.length < page.total; next += 1) {
        const more = await repo.listSharedEvidence(ctx.companyId, { ...filter, page: next, pageSize }, ctx.scopes, true);
        count = more.rows.length;
        page.rows.push(...more.rows);
      }
    }
    return page;
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
    private readonly expenseSource: ExpenseSourceAdapter = new ExpenseSourceAdapter(prisma),
  ) {}

  async execute(ctx: RequestContext, request: AccountantPackageRequest): Promise<AccountantPackageResult> {
    return this.createIndex(ctx, request, await this.bundleContents(ctx, request, false));
  }

  private async createIndex(ctx: RequestContext, request: AccountantPackageRequest, contents: Awaited<ReturnType<CreateAccountantPackageUseCase['bundleContents']>>, download?: { part: number; included: Set<string>; skipped: Map<string, string> }): Promise<AccountantPackageResult> {
    const { page, files, expenseIds } = contents;
    const columnSet = 'full' as const;

    const company = await this.prisma.client.company.findUnique({
      where: { id: ctx.companyId },
      select: { name: true, registeredName: true, taxId: true, timezone: true, baseCurrency: true },
    });
    const userIds = [...new Set(page.rows.flatMap((r) => [r.createdByUserId, r.reviewedByUserId].filter((v): v is string => !!v)))];
    const users = userIds.length > 0
      ? await this.prisma.client.user.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true, email: true } })
      : [];
    const userName = new Map(users.map((u) => [u.id, u.displayName ?? u.email ?? u.id]));
    const branchIds = [...new Set(page.rows.map((row) => row.branchId).filter((id): id is string => !!id))];
    const branches = branchIds.length ? await this.prisma.client.branch.findMany({
      where: { companyId: ctx.companyId, id: { in: branchIds } }, select: { id: true, code: true, name: true, taxBranchCode: true, isVatEstablishment: true },
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
      whtRemittance: r.whtRemittance,
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
      indexRows[i]!.bundle_file_names = linked.map(file => file.legacyFileName).join('\n');
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
    const workbook = await this.workbookProjection(ctx, request, contents, company, branches, download);
    const filterSummary: Record<string, string> = {};
    for (const [key, value] of Object.entries({ ...request, status: request.status ?? 'CONFIRMED', dateField: request.dateField ?? 'expenseDate' })) {
      if (value !== undefined && value !== null && key !== 'format' && key !== 'columnSet') filterSummary[key] = String(value);
    }

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId,
      action: 'expense.accountant_package.create', targetType: 'expense_export', targetId: ctx.requestId,
      requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM',
      metadataJson: { workbook: 'accountant-v2', rowCount: expenseIndexRows.length, totalMatched: page.total, truncated: expenseIndexRows.length < page.total, evidenceCount: evidenceManifest.length, skippedEvidenceCount: skippedEvidence.length, filterSummary },
    });

    return {
      generatedAt: new Date().toISOString(),
      filterSummary,
      rowCount: expenseIndexRows.length,
      totalMatched: page.total,
      truncated: expenseIndexRows.length < page.total,
      indexRows: expenseIndexRows,
      indexCsv: buildAccountantIndexCsv(expenseIndexRows),
      indexXlsxBase64: workbook.data.toString('base64'),
      indexFileName: workbook.indexFileName, paymentRowCount: workbook.paymentRowCount, withholdingRowCount: workbook.withholdingRowCount,
      columnSet,
      evidenceManifest,
      skippedEvidence,
    };
  }

  private async workbookProjection(ctx: RequestContext, request: AccountantPackageRequest,
    { page, files, expenseIds }: Awaited<ReturnType<CreateAccountantPackageUseCase['bundleContents']>>,
    company: { name: string; registeredName?: string | null; taxId?: string | null; timezone?: string; baseCurrency?: string } | null,
    branches: { id: string; name: string; taxBranchCode: string | null; isVatEstablishment: boolean }[],
    download?: { part: number; included: Set<string>; skipped: Map<string, string> }) {
    const db = this.prisma.client, loadedRowIds = page.rows.map(row => row.id);
    const visible = { vouchers: ctx.authProvider !== 'line' && hasPerm(ctx, 'expense.disbursement.read'),
      certificates: ['wht.certificate.read', 'wht.certificate.issue', 'wht.certificate.correct', 'wht.external_certificate.link'].some(permission => hasPerm(ctx, permission)),
      shopBranch: await db.branch.count({ where: { companyId: ctx.companyId } }) > 1 };
    const [payments, live, filed] = loadedRowIds.length ? await Promise.all([
      db.expensePayment.findMany({ where: { companyId: ctx.companyId, status: 'RECORDED', expenseId: { in: loadedRowIds } },
        select: { id: true, expenseId: true, amount: true, paidAt: true, paidAtConfirmed: true, paymentMethod: true, bankAccountRef: true } }),
      this.expenseSource.findConfirmedWithWhtByCompany(ctx.companyId, undefined, { expenseIds: loadedRowIds }),
      db.whtFilingLine.findMany({ where: { sourceType: 'expense.record', sourceId: { in: loadedRowIds }, filing: { companyId: ctx.companyId, status: 'FILED' } },
        select: { id: true, sourceType: true, sourceId: true, lineJson: true, filing: { select: { formType: true, periodKey: true } } } }),
    ]) : [[], [], []] as [never[], never[], never[]];
    const selectedIds = page.rows.filter(row => expenseIds.has(row.id)).map(row => row.id);
    const [expenseLines, registration] = selectedIds.length ? await Promise.all([
      db.expenseLine.findMany({ where: { companyId: ctx.companyId, expenseId: { in: selectedIds } }, orderBy: { lineNumber: 'asc' },
        select: { expenseId: true, lineNumber: true, description: true, expenseCategoryId: true, taxableAmount: true, vatAmount: true, vatRate: true,
          vatTreatment: true, whtAmount: true, whtRate: true, whtCategoryCode: true, chargeKind: true, claimabilitySnapshot: true,
          taxEvidenceReviewStatus: true, externalTaxCodeSnapshot: true, taxTreatmentSnapshot: true, taxComponentsJson: true } }),
      db.companyVatRegistrationFact.findMany({ where: { companyId: ctx.companyId }, orderBy: [{ effectiveFrom: 'asc' }, { answeredAt: 'asc' }] }),
    ]) : [[], []];
    const categoryIds = [...new Set([...page.rows.flatMap(row => row.expenseCategoryId ? [row.expenseCategoryId] : []),
      ...expenseLines.flatMap(line => line.expenseCategoryId ? [line.expenseCategoryId] : [])])];
    const categoryNames = new Map((categoryIds.length ? await this.repo.listCategoryNames(ctx.companyId, categoryIds) : []).map(row => [row.id, row.name]));
    const categoryCodes = [...new Set([...live.flatMap(row => row.incomeCategoryCode ? [row.incomeCategoryCode] : []),
      ...filed.flatMap(line => { const code = (line.lineJson as { payment?: (string | null)[] }).payment?.[5]; return code ? [code] : []; })])];
    const [categories, periods, voucherLines, handoffs] = await Promise.all([
      categoryCodes.length ? db.whtIncomeCategory.findMany({ where: { code: { in: categoryCodes } } }) : [],
      live.length ? db.taxPeriod.findMany({ where: { companyId: ctx.companyId, taxType: 'WHT', status: { in: ['FILED', 'PAID', 'CLOSED'] } }, select: { formType: true, periodKey: true, status: true } }) : [],
      visible.vouchers && payments.length ? db.disbursementVoucherLine.findMany({ where: { companyId: ctx.companyId, expensePaymentId: { in: payments.map(payment => payment.id) }, voucher: { status: 'PAID' } },
        select: { expensePaymentId: true, voucher: { select: { documentNumber: true, status: true } } } }) : [],
      visible.certificates && loadedRowIds.length ? db.whtCertificateHandoff.findMany({ where: { companyId: ctx.companyId, sourcePaymentType: 'expense.record', sourcePaymentId: { in: loadedRowIds },
        status: { in: ['SYSTEM_ISSUED', 'EXTERNAL_LINKED'] }, ...(request.branchId ? { sourceBranchId: request.branchId } : ctx.scopes?.branchIds ? { sourceBranchId: { in: ctx.scopes.branchIds } } : {}) },
        select: { sourcePaymentId: true, status: true, certificateId: true, externalCertificateNumber: true } }) : [],
    ]);
    const certificateIds = handoffs.flatMap(handoff => handoff.certificateId ? [handoff.certificateId] : []);
    const certificates = certificateIds.length ? await db.whtCertificate.findMany({ where: { companyId: ctx.companyId, id: { in: certificateIds } }, select: { id: true, certificateNumber: true } }) : [];
    const certificateNumbers = (expenseId: string) => [...new Set(handoffs.filter(handoff => handoff.sourcePaymentId === expenseId).flatMap(handoff => {
      const number = handoff.status === 'EXTERNAL_LINKED' ? handoff.externalCertificateNumber : certificates.find(certificate => certificate.id === handoff.certificateId)?.certificateNumber;
      return number ? [number] : [];
    }))].join(', ');
    const range = accountantRange(request), timezone = company?.timezone ?? 'Asia/Bangkok';
    const inRange = (date: Date | string) => { const day = civilDate(date instanceof Date ? date : new Date(date), timezone); return (!range.from || day >= range.from) && (!range.to || day <= range.to); };
    const fileRows: AccountantWorkbookFile[] = files.map(file => ({ attachmentId: file.attachment.id, expenseIds: file.expenseIds, expenseNumber: file.expenseNumber, kind: file.kind, path: file.fileName, part: file.part,
      version: file.version, replacedBy: file.replacedBy,
      ...(download?.skipped.has(file.fileName) ? { skippedReason: download.skipped.get(file.fileName) } : download && file.part === download.part && !download.included.has(file.fileName) ? { skippedReason: 'ไม่พบไฟล์' } : {}) }));
    const workbookRows: AccountantWorkbookRow[] = page.rows.filter(row => expenseIds.has(row.id)).map(row => {
      const latest = payments.filter(payment => payment.expenseId === row.id).sort((a, b) => b.paidAt.getTime() - a.paidAt.getTime() || b.id.localeCompare(a.id))[0];
      const cert = row.evidenceSources?.certificates.slice().reverse().find(certificate => certificate.status === 'ISSUED');
      const evidenceSource = { aiVerificationSummaryJson: row.aiVerificationSummaryJson as Record<string, unknown> | null, attachments: row.attachments };
      const evidence = expenseEvidenceAssessment(evidenceSource);
      const primary = files.find(file => file.expenseIds.includes(row.id) && file.version !== 'superseded'
        && (file.kind === 'substituteReceipts' || file.attachment.id === row.primaryAttachmentId || row.attachments.some(attachment => attachment.id === file.attachment.id && attachment.purpose === 'expense.receipt.primary')));
      return { sourceExpenseId: row.id, document_date: toIso(row.expenseDate).slice(0, 10), uploaded_at: toIso(row.uploadedAt), dateStatus: expenseDocumentDateStatus(row.aiVerificationSummaryJson),
        expense_number: row.expenseNumber, vendor_document_number: row.vendorDocumentNumber ?? (cert?.snapshotJson as { documentNumber?: string } | null)?.documentNumber, source_document_type: row.sourceDocumentType,
        sourceDocumentTypeLabel: noReceiptDocumentLabel({ sourceDocumentType: row.sourceDocumentType, taxEvidenceStatus: row.taxEvidenceStatus, aiVerificationSummaryJson: row.aiVerificationSummaryJson as Record<string, unknown> | null }) ?? undefined,
        shop_branch: row.branchId && branches.find(branch => branch.id === row.branchId) ? shopBranchLabel(branches.find(branch => branch.id === row.branchId)!) : '',
        vendor_name: row.vendorNameSnapshot, vendor_tax_id: row.vendorTaxIdSnapshot, vendor_branch: row.vendorBranchCodeSnapshot, vendor_address: row.vendorAddressSnapshot,
        category_name: row.categoryName, description: row.note, currency: row.currency,
        taxable_amount: String(row.taxableAmount), vat_amount: String(row.vatAmount), grand_total_amount: String(row.grandTotalAmount),
        input_vat_right: row.inputVatClaimStatus, inputVatRightLabel: row.inputVatRecordedBeforeReview ? 'ไม่ได้ใช้ภาษีซื้อ (บันทึกก่อนมีการตรวจสิทธิ)' : undefined,
        wht_remittance: accountantWhtRemittance(row.whtAmount, row.whtRemittance),
        tax_evidence_status: row.taxEvidenceStatus, wht_amount: String(row.whtAmount), net_payable_amount: String(row.netPayableAmount), paid_amount: String(row.paidAmount), outstanding_amount: String(row.outstandingAmount),
        last_paid_at: latest ? toIso(latest.paidAt) : '', lastPaidAtConfirmed: latest?.paidAtConfirmed,
        advanced_by: row.evidenceSources?.requesterName ?? (cert?.fundingSource === 'PERSONAL_ADVANCE' ? cert.payerName : ''), expense_status: row.status,
        notes: accountantNotes({ hasImage: !expenseEvidenceImageMissing(evidenceSource), evidenceNote: evidence?.note,
          taxEvidenceStatus: row.taxEvidenceStatus, taxEvidenceReason: row.taxEvidenceReasonCode ? (TAX_EVIDENCE_REASON_LABELS as Record<string, string>)[row.taxEvidenceReasonCode] : '',
          inputVatClaimStatus: row.inputVatClaimStatus, inputVatReason: row.latestInputVatDecision?.reason }),
        primaryFile: primary ? fileRows[files.indexOf(primary)] : undefined };
    });
    const paymentRows: AccountantPaymentRow[] = payments.filter(payment => inRange(payment.paidAt)).map(payment => {
      const row = page.rows.find(expense => expense.id === payment.expenseId)!;
      const proof = files.find(file => file.kind === 'paymentSlips' && (file.paymentId === payment.id || file.expenseIds.includes(row.id) && !file.paymentId));
      return { sourceExpenseId: row.id, paid_at: toIso(payment.paidAt), paidAtConfirmed: payment.paidAtConfirmed, expense_number: row.expenseNumber ?? 'ยังไม่มีเลขที่', payee_name: row.vendorNameSnapshot,
        amount: String(payment.amount), currency: row.currency, payment_method: payment.paymentMethod, paid_from: payment.bankAccountRef,
        voucher_numbers: voucherLines.filter(line => line.expensePaymentId === payment.id && line.voucher.status === 'PAID').map(line => line.voucher.documentNumber).filter(Boolean).join(', '),
        paymentFile: proof ? fileRows[files.indexOf(proof)] : undefined };
    });
    const categoryByCode = new Map(categories.map(category => [category.code, category]));
    const withholding: AccountantWithholdingRow[] = [];
    const bankRemitted: AccountantWithholdingRow[] = [];
    let coveredOutsideRangeCount = 0;
    for (const line of [...new Map(filed.map(line => [line.id, line])).values()]) {
      const payment = (line.lineJson as { payment?: (string | null)[] }).payment;
      if (!payment?.[2] || !inRange(payment[2])) continue;
      withholding.push({ sourceExpenseId: line.sourceId, paid_at: payment[2], expense_number: page.rows.find(row => row.id === line.sourceId)?.expenseNumber ?? 'ยังไม่มีเลขที่',
        payee_name: payment[9], payee_tax_id: payment[10], payee_branch: payment[11], payee_address: payment[12], form_type: line.filing.formType,
        income_type: payment[5] ? categoryByCode.get(payment[5])?.nameTh : '', rate: payment[8], gross_amount: payment[6], withheld_amount: payment[7], currency: payment[4],
        certificate_numbers: certificateNumbers(line.sourceId), status: 'FILED', notes: [categoryByCode.get(payment[5] ?? '')?.filingRoute === 'ACCOUNTANT_PREPARES' ? 'ผู้ทำบัญชีจัดทำแบบนี้เอง' : '',
          page.rows.find(source => source.id === line.sourceId)?.whtRemittance === 'E_WHT' ? 'วิธีนำส่งปัจจุบันเป็น e-WHT ให้ตรวจกับแบบที่ยื่น' : ''].filter(Boolean).join(' · ') });
    }
    for (const row of live) {
      const covered = filed.filter(line => filedLineCoversPayment(line, { sourceType: 'expense.record', sourceId: row.id, sourceLineKey: row.sourceLineKey, paymentId: row.paymentId }));
      if (covered.length) {
        if (inRange(row.expenseDate) && !covered.some(line => { const date = (line.lineJson as { payment?: (string | null)[] }).payment?.[2]; return date && inRange(date); })) coveredOutsideRangeCount++;
        continue;
      }
      if (!inRange(row.expenseDate)) continue;
      if (row.whtRemittance === 'E_WHT') {
        bankRemitted.push({ sourceExpenseId: row.id, expense_number: page.rows.find(source => source.id === row.id)?.expenseNumber,
          currency: row.currency, gross_amount: row.grossAmount, withheld_amount: row.whtAmount, rate: row.whtRate });
        continue;
      }
      const category = categoryByCode.get(row.incomeCategoryCode ?? ''), form = withholdingFormFor(row.payeeEntityKind, category?.filingRoute);
      const faults: string[] = [];
      if (!form) faults.push(makeReviewIssue('WHT_PAYEE_KIND_UNKNOWN', { context: row.vendorName ?? undefined }).description);
      if ((category?.filingRoute ?? 'SYSTEM_FILLS') === 'SYSTEM_FILLS' && row.currency.toUpperCase() !== (company?.baseCurrency ?? 'THB').toUpperCase()) faults.push(withholdingIssueDescription('FUNCTIONAL_CURRENCY_FX_MISSING', '', row.vendorName));
      if ((category?.filingRoute ?? 'SYSTEM_FILLS') === 'SYSTEM_FILLS' && !row.vendorTaxId) faults.push(makeReviewIssue('MISSING_TAX_ID', { context: row.vendorName ?? 'ผู้รับเงิน' }).description);
      faults.push(...withholdingRowFaults({ id: row.sourceLineKey ?? row.id, eventType: `WHT_${form ?? 'PND53'}`, sourceType: 'expense.record', sourceId: row.id, branchId: row.branchId,
        eventDate: row.expenseDate, currency: row.currency, payeeSnapshot: { name: row.vendorName ?? '', taxId: row.vendorTaxId, branchCode: row.vendorBranchCode, address: row.vendorAddress },
        incomeCategoryCode: row.incomeCategoryCode, whtRate: row.whtRate, grossAmount: row.grossAmount, withheldAmount: row.whtAmount, sourceLineKey: row.sourceLineKey },
        { formType: form ?? 'PND53', categoryByCode, sourceKind: row.payeeEntityKind, expenseWithoutCounterparty: !page.rows.find(expense => expense.id === row.id)?.vendorCounterpartyId }).map(fault => fault.detail));
      const locked = form && periods.some(period => period.formType === form && period.periodKey === formPeriodKey(form, row.expenseDate));
      withholding.push({ sourceExpenseId: row.id, paid_at: toIso(row.expenseDate), expense_number: page.rows.find(expense => expense.id === row.id)?.expenseNumber ?? 'ยังไม่มีเลขที่',
        payee_name: row.vendorName, payee_tax_id: row.vendorTaxId, payee_branch: row.vendorBranchCode, payee_address: row.vendorAddress, form_type: form,
        income_type: category?.nameTh, rate: row.whtRate, gross_amount: row.grossAmount, withheld_amount: row.whtAmount, currency: row.currency,
        certificate_numbers: certificateNumbers(row.id), status: locked ? 'LOCKED' : faults.length ? 'NEEDS_REVIEW' : 'READY', faults: faults.slice(0, 1), notes: category?.filingRoute === 'ACCOUNTANT_PREPARES' ? 'ผู้ทำบัญชีจัดทำแบบนี้เอง' : '' });
    }
    const about: Record<string, string | number> = { 'ร้าน': company?.registeredName?.trim() || company?.name || '', 'เลขประจำตัวผู้เสียภาษีของร้าน': company?.taxId ?? '',
      'ช่วงวันที่': [range.from, range.to].filter(Boolean).map(formatThaiExportDate).join(' – ') || 'ทุกเดือน', 'นับตาม': request.dateField === 'uploadedAt' ? 'วันที่ส่งเข้า' : 'วันที่เอกสาร',
      'สถานะเอกสาร': EXPENSE_STATUS_LABELS[request.status ?? 'CONFIRMED'], 'สาขา': request.branchId ? branches.find(branch => branch.id === request.branchId)?.name ?? '' : 'ทุกสาขา', 'สร้างเมื่อ': formatThaiExportDate(new Date().toISOString()) };
    if (request.page !== undefined || request.pageSize !== undefined) about['หน้า'] = `หน้าที่ ${request.page ?? 1} — การจ่ายและหัก ณ ที่จ่ายมีเฉพาะรายการในหน้านี้`;
    if (coveredOutsideRangeCount) about['รวมในแบบที่ยื่นแล้ว'] = `การจ่ายหัก ณ ที่จ่าย ${coveredOutsideRangeCount} รายการในช่วงนี้ ระบบถือว่ารวมอยู่ในแบบที่ยื่นแล้วซึ่งลงวันที่จ่ายนอกช่วงนี้ จึงไม่แสดงในแผ่นนี้`;
    const shop = bundleName(company?.registeredName?.trim() || company?.name || 'ร้าน').slice(0, 40), period = request.yearMonth ?? (range.from || range.to ? `${range.from ?? ''}_${range.to ?? ''}` : 'ทุกเดือน');
    const sources: AccountantExportSource[] = page.rows.map(row => ({
      ...row, expenseDate: toIso(row.expenseDate).slice(0, 10), currency: row.currency ?? '', selected: expenseIds.has(row.id), dateStatus: expenseDocumentDateStatus(row.aiVerificationSummaryJson),
      lines: expenseLines.filter(line => line.expenseId === row.id).map(line => ({ ...line, categoryName: categoryNames.get(line.expenseCategoryId ?? '') })),
      payments: payments.filter(payment => payment.expenseId === row.id).map(payment => ({ ...payment, status: 'RECORDED' })),
      categoryName: categoryNames.get(row.expenseCategoryId ?? '') ?? row.categoryName,
      certificateNumber: certificateNumbers(row.id), substituteStatuses: row.evidenceSources?.certificates.filter(certificate => certificate.status !== 'SUPERSEDED').slice(-1).map(certificate => certificate.status),
      sourceEvidenceUnavailable: row.evidenceSources?.sourceEvidenceUnavailable,
      substituteAttachmentIds: row.evidenceSources?.certificates.flatMap(certificate => [certificate.artifactAttachmentId, certificate.wetSignedScanAttachmentId].filter((id): id is string => !!id)),
      // Retained v1 claim snapshots carry file IDs/checksums, but no original receipt role.
      receiptCheckUnavailable: !!row.evidenceSources?.sourceSnapshot && row.attachments.some(file => ['ACTIVE', 'active'].includes(file.status))
        && !row.attachments.some(file => file.id === row.primaryAttachmentId || file.purpose === 'expense.receipt.primary'),
    }));
    const registrationFacts = registration.map(fact => ({ ...fact, effectiveFrom: utcDateToCivilDate(fact.effectiveFrom),
      effectiveTo: fact.effectiveTo ? utcDateToCivilDate(fact.effectiveTo) : null }));
    return { data: buildAccountantWorkbook({ rows: workbookRows, payments: paymentRows, withholding, bankRemitted, sources, company, branches, registrationFacts, files: fileRows, part: download?.part, visible, about }),
      indexFileName: `รายจ่าย-${shop}-${period}.xlsx`, paymentRowCount: paymentRows.length, withholdingRowCount: withholding.length };
  }


  private async bundleContents(ctx: RequestContext, request: AccountantPackageRequest, bundle = true) {
    const page = await readPackageRows(this.repo, this.prisma, ctx, request, bundle);
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
    const range = accountantRange(request);
    const filedCandidates = request.expenseIds?.length === 0 ? [] : await db.whtFilingLine.findMany({ where: { sourceType: 'expense.record',
      ...(request.expenseIds !== undefined ? { sourceId: { in: request.expenseIds } } : {}),
      filing: { companyId: ctx.companyId, status: 'FILED', ...(range.months ? { periodKey: { in: range.months } } : range.from || range.to ? { periodKey: { ...(range.from ? { gte: range.from.slice(0, 7) } : {}), ...(range.to ? { lte: range.to.slice(0, 7) } : {}) } } : {}) } }, select: { sourceId: true } });
    const selection = request.expenseIds !== undefined ? new Set(request.expenseIds) : undefined;
    const extraIds = [...new Set([...payments.map(p => p.expenseId), ...paidVouchers.flatMap(v => v.lines.map(l => l.expenseId)),
      ...handoffs.flatMap(h => h.sourcePaymentId ? [h.sourcePaymentId] : []), ...filedCandidates.map(line => line.sourceId)])].filter(id => (!selection || selection.has(id)) && !page.rows.some(row => row.id === id));
    if (!bundle && (request.page !== undefined || request.pageSize !== undefined)) extraIds.length = 0;
    for (let offset = 0; offset < extraIds.length; offset += 500) {
      const extra = await this.repo.listSharedEvidence(ctx.companyId, { ...request, yearMonth: undefined, fromDate: undefined, toDate: undefined,
        status: request.status ?? 'CONFIRMED', expenseIds: extraIds.slice(offset, offset + 500), page: 1, pageSize: 500 }, ctx.scopes, true);
      page.rows.push(...extra.rows);
    }
    page.rows.sort((a, b) => (a.expenseNumber ?? a.id).localeCompare(b.expenseNumber ?? b.id) || a.id.localeCompare(b.id));
    const names = new Map(page.rows.map(row => [row.id, row.expenseNumber ?? row.id]));
    const files: BundleFile[] = [];
    const usedNames = new Set<string>(), publicNames = new Set<string>();
    const displayNames = new Map(page.rows.map(row => [row.id, row.expenseNumber ?? 'ยังไม่มีเลขที่']));
    const paymentSequence = new Map<string, number>();
    const publicFileName = (stem: string, extension: string | null) => {
      let name = `${stem}.${extension ?? 'bin'}`, suffix = 2;
      while (publicNames.has(name)) name = `${stem}-${suffix++}.${extension ?? 'bin'}`;
      publicNames.add(name); return name;
    };
    const paymentStem = (id: string) => { const next = (paymentSequence.get(id) ?? 0) + 1; paymentSequence.set(id, next); return `หลักฐานการจ่าย/${bundleName(displayNames.get(id)!)}-จ่าย-${next}`; };
    for (const row of page.rows) {
      row.attachments.forEach((attachment, index) => {
        const substitute = row.evidenceSources?.certificates.some(c => c.artifactAttachmentId === attachment.id || c.wetSignedScanAttachmentId === attachment.id);
        const folder = substitute ? 'ใบรับรองแทนใบเสร็จ' : 'ใบเสร็จ';
        const extension = canonicalAttachmentExtension(attachment.mimeType) ?? null;
        let legacyFileName = legacyBundleFileName(folder, names.get(row.id)!, extension, { index });
        if (usedNames.has(legacyFileName)) legacyFileName = legacyBundleFileName(folder, names.get(row.id)!, extension, { index, duplicateId: row.id });
        usedNames.add(legacyFileName);
        const fileName = publicFileName(`${substitute ? 'ใบรับรองแทนใบเสร็จ' : 'เอกสารค่าใช้จ่าย'}/${bundleName(displayNames.get(row.id)!)}-${index + 1}${attachment.isHistorical ? '-ฉบับเดิม' : ''}`, extension);
        files.push({ attachment, expenseIds: [row.id], expenseNumber: displayNames.get(row.id)!, fileName, legacyFileName, part: 0, extension,
          kind: substitute ? 'substituteReceipts' : 'receipts' });
      });
    }
    for (const slip of slips) {
      const expenseId = payments.find(payment => payment.id === slip.targetId)!.expenseId;
      if (!names.has(expenseId)) continue;
      const extension = canonicalAttachmentExtension(slip.attachment.mimeType) ?? null;
      files.push({ kind: 'paymentSlips', expenseIds: [expenseId], expenseNumber: displayNames.get(expenseId)!, paymentId: slip.targetId, part: 0, attachment: { ...slip.attachment, byteSize: Number(slip.attachment.byteSize) }, extension,
        legacyFileName: legacyBundleFileName('สลิปการจ่าย', names.get(expenseId)!, extension, { id: slip.targetId }),
        fileName: publicFileName(paymentStem(expenseId), extension) });
    }
    const addDocument = async (kind: BundleKind, ids: string[], id: string, number: string, folder: string,
      load: () => Promise<{ data: Buffer; mimeType?: string }>, name?: string, displayNumber = number) => {
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
      const legacyFileName = legacyBundleFileName(folder, expenseNumber, extension, { id, number, name });
      const publicFolder = kind === 'whtCertificates' ? 'หนังสือรับรอง 50 ทวิ' : folder;
      const stem = kind === 'paymentSlips' ? paymentStem(ids[0]!) : `${publicFolder}/${bundleName(displayNumber)}${name ? name.match(/-\d+$/)?.[0] ?? '' : ''}`;
      const fileName = publicFileName(stem, extension);
      files.push({ kind, expenseIds: ids, expenseNumber: ids.map(expenseId => displayNames.get(expenseId)!).sort()[0]!, fileName, legacyFileName, part: 0, number, extension,
        attachment: { id, byteSize: document.data.length, status: 'ACTIVE', originalFileName: fileName }, load: async () => (await load()).data });
    };
    for (const voucher of paidVouchers) {
      const ids = voucher.lines.map(line => line.expenseId);
      await addDocument('vouchers', ids, voucher.id, voucher.documentNumber ?? voucher.id, 'ใบสำคัญจ่าย', () => this.vouchers.documentPdf(ctx, voucher.id), undefined, voucher.documentNumber ?? 'ยังไม่มีเลขที่');
      if (ids.length && ids.every(id => names.has(id))) {
        let supporting: Awaited<ReturnType<DisbursementVoucherUseCase['supportingFiles']>> = [];
        try { supporting = await this.vouchers.supportingFiles(ctx, voucher.id); } catch (error) {
          if (!(error instanceof ForbiddenException || error instanceof NotFoundException)) throw error;
        }
        for (const [index, file] of supporting.entries()) await addDocument('supportingFiles', ids, file.id, voucher.documentNumber ?? voucher.id, 'เอกสารประกอบการจ่าย',
          () => this.vouchers.supportingFileBytes(ctx, voucher.id, file.id), `${voucher.documentNumber ?? voucher.id}-${index + 1}`, voucher.documentNumber ?? 'ยังไม่มีเลขที่');
      }
      if (voucher.slipAttachmentId) await addDocument('paymentSlips', ids, voucher.slipAttachmentId, voucher.documentNumber ?? voucher.id, 'สลิปการจ่าย', () => this.vouchers.slipBytes(ctx, voucher.id), undefined, voucher.documentNumber ?? 'ยังไม่มีเลขที่');
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
      file.part = parts.length; parts.at(-1)!.push(file); bytes += file.attachment.byteSize;
    }
    if (!parts.length && page.rows.length) parts.push([]); // An index also explains a month with missing papers.
    for (const row of page.rows) for (const file of files.filter(file => file.kind === 'substituteReceipts' && file.expenseIds.includes(row.id))) {
      const certificates = row.evidenceSources?.certificates ?? [];
      const original = certificates.find(cert => cert.artifactAttachmentId === file.attachment.id || cert.wetSignedScanAttachmentId === file.attachment.id);
      file.version = original?.status === 'SUPERSEDED' || row.attachments.find(attachment => attachment.id === file.attachment.id)?.isHistorical ? 'superseded' : 'current';
      if (file.version !== 'superseded' || !original) continue;
      let terminal = original;
      const seen = new Set<string>();
      while (!seen.has(terminal.id)) { seen.add(terminal.id); const next = certificates.find(cert => cert.correctionOfEvidenceId === terminal.id); if (!next) break; terminal = next; }
      if (terminal.status === 'ISSUED') file.replacedBy = files.find(candidate => candidate.attachment.id === terminal.artifactAttachmentId || candidate.attachment.id === terminal.wetSignedScanAttachmentId)?.fileName;
    }
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
    const skipped: string[] = [], skippedFiles = new Map<string, string>();
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
      if (reason) { skippedFiles.set(file.fileName, reason); skipped.push(`${file.expenseNumber.replace(/[\r\n\t]/g, ' ')} · ${file.attachment.originalFileName.replace(/[\r\n\t]/g, ' ')} · ${reason}`); }
    }
    const fileCount = Object.keys(entries).length;
    if (skipped.length) entries['ไฟล์ที่ไม่ได้รวม.txt'] = Buffer.from(skipped.join('\n'), 'utf8');
    const index = await this.createIndex(ctx, { ...request, columnSet: 'full' }, contents, { part, included: new Set(Object.keys(entries)), skipped: skippedFiles });
    entries['สารบัญ.xlsx'] = Buffer.from(index.indexXlsxBase64, 'base64');
    const bytes = zipStore(entries);
    await this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId,
      action: 'expense.accountant_bundle.download', targetType: 'expense_export', targetId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'MEDIUM',
      metadataJson: { workbook: 'accountant-v2', yearMonth: request.yearMonth ?? 'all', dateField: request.dateField ?? 'expenseDate', branchId: request.branchId ?? null, part, fileCount, skippedCount: skipped.length },
    });
    return { bytes, fileName: index.indexFileName!.replace(/^รายจ่าย-/, 'หลักฐาน-').replace(/\.xlsx$/, `${parts.length > 1 ? `-ชุดที่-${part}` : ''}.zip`) };
  }
}

@Injectable()
export class CreateAccountingSoftwareExportUseCase {
  constructor(private readonly repo: PrismaExpenseRepository, private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, request: AccountingSoftwareExportRequest): Promise<AccountingSoftwareExportResult> {
    const status = request.status || 'CONFIRMED';
    if (status !== 'CONFIRMED') throw new UnprocessableEntityException({ code: 'accounting_export_confirmed_only' });
    const page = await readPackageRows(this.repo, this.prisma, ctx, { ...request, status });
    const db = this.prisma.client, ids = page.rows.map(row => row.id);
    const [lines, payments] = ids.length ? await Promise.all([
      db.expenseLine.findMany({ where: { companyId: ctx.companyId, expenseId: { in: ids } }, orderBy: { lineNumber: 'asc' },
        select: { expenseId: true, lineNumber: true, description: true, expenseCategoryId: true, taxableAmount: true, vatAmount: true, vatRate: true,
          vatTreatment: true, whtAmount: true, whtRate: true, whtCategoryCode: true, chargeKind: true, claimabilitySnapshot: true,
          taxEvidenceReviewStatus: true, externalTaxCodeSnapshot: true, taxTreatmentSnapshot: true, taxComponentsJson: true } }),
      db.expensePayment.findMany({ where: { companyId: ctx.companyId, expenseId: { in: ids }, status: 'RECORDED' }, select: { expenseId: true, paidAt: true, paidAtConfirmed: true, status: true } }),
    ]) : [[], []];
    const categoryIds = [...new Set([...page.rows.flatMap(row => row.expenseCategoryId ? [row.expenseCategoryId] : []), ...lines.flatMap(line => line.expenseCategoryId ? [line.expenseCategoryId] : [])])];
    const incomeCodes = [...new Set([...page.rows.flatMap(row => row.whtCategoryCode ? [row.whtCategoryCode] : []), ...lines.flatMap(line => line.whtCategoryCode ? [line.whtCategoryCode] : [])])];
    const vendorIds = [...new Set(page.rows.flatMap(row => !row.vendorEntityKindSnapshot && row.vendorCounterpartyId ? [row.vendorCounterpartyId] : []))];
    const [mappings, names, incomeCategories, vendors, company] = await Promise.all([
      categoryIds.length ? this.repo.findCategoryAccountantAccounts(ctx.companyId, categoryIds) : [],
      categoryIds.length ? this.repo.listCategoryNames(ctx.companyId, categoryIds) : [],
      incomeCodes.length ? db.whtIncomeCategory.findMany({ where: { code: { in: incomeCodes } }, select: { code: true, nameTh: true, filingRoute: true } }) : [],
      vendorIds.length ? db.accountingCounterparty.findMany({ where: { companyId: ctx.companyId, id: { in: vendorIds } }, select: { id: true, entityKind: true } }) : [],
      db.company.findUnique({ where: { id: ctx.companyId }, select: { name: true, registeredName: true } }),
    ]);
    const categoryNames = new Map(names.map(category => [category.id, category.name]));
    const built = buildPurchaseJournalRows(page.rows.map(row => {
      const cert = row.evidenceSources?.certificates.slice().reverse().find(certificate => certificate.status === 'ISSUED');
      return { ...row, vendorEntityKindSnapshot: row.vendorEntityKindSnapshot ?? vendors.find(vendor => vendor.id === row.vendorCounterpartyId)?.entityKind,
        categoryName: categoryNames.get(row.expenseCategoryId ?? '') ?? row.categoryName,
        lines: lines.filter(line => line.expenseId === row.id).map(line => ({ ...line, categoryName: categoryNames.get(line.expenseCategoryId ?? '') })),
        payments: payments.filter(payment => payment.expenseId === row.id),
        advancedBy: row.evidenceSources?.requesterName ?? (cert?.fundingSource === 'PERSONAL_ADVANCE' ? cert.payerName : '') };
    }), new Map(mappings.map(mapping => [mapping.expenseCategoryId, mapping])), new Map(incomeCategories.map(category => [category.code, category])));
    const range = accountantRange(request), period = request.yearMonth ?? (range.from || range.to ? `${range.from ?? ''}_${range.to ?? ''}` : 'ทุกเดือน');
    const shop = company?.registeredName?.trim() || company?.name || 'ร้าน';
    const files = built.rows.length ? [{ fileName: `สมุดรายวันซื้อ-${bundleName(shop).slice(0, 40)}-${period}.xlsx`,
      xlsxBase64: buildPurchaseJournalWorkbook(built.rows, built.excluded, { ร้าน: shop, ช่วงวันที่: period }).toString('base64'), rowCount: built.rows.length }] : [];
    const excludedByReason: Record<string, number> = {};
    for (const entry of built.excluded) excludedByReason[entry.reason] = (excludedByReason[entry.reason] ?? 0) + 1;
    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'expense.accounting_software_export.create',
      targetType: 'expense_export', targetId: ctx.requestId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM',
      metadataJson: { preset: request.preset, documentCount: page.rows.length, rowCount: built.rows.length, excludedCount: built.excluded.length, excludedByReason } });
    return { preset: request.preset, files, documentCount: page.rows.length, rowCount: built.rows.length, excluded: built.excluded,
      paymentNotExported: [], unmappedCategories: built.unmappedCategories };
  }
}
