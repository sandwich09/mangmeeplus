import type { ExpenseAttachmentRef, ReimbursementSourceSnapshot } from '@watchdog-bms/contracts';
import type { ExpenseDb } from './prisma-expense.repository';
import { branchScopeWhere, isBranchInScope } from '../../data-model-core/domain/logic/branch.logic';

type EvidenceRow = {
  id: string;
  branchId: string | null;
  sourceReimbursementRequestId?: string | null;
  sourceReimbursementLineId?: string | null;
};

/** Resolve immutable claim sources without moving their files onto the accounting projection. */
export async function loadExpenseEvidenceSources(
  db: ExpenseDb, companyId: string, rows: readonly EvidenceRow[], scopes: { branchIds?: string[] } = {},
  includeUnavailableAttachments = false,
) {
  const claimRows = rows.filter((row) => row.sourceReimbursementRequestId && row.sourceReimbursementLineId);
  const lines = claimRows.length ? await db.reimbursementLine.findMany({
    where: { companyId, id: { in: claimRows.map((row) => row.sourceReimbursementLineId!) }, request: { companyId, ...branchScopeWhere(scopes) } },
    select: { id: true, reimbursementRequestId: true, sourceExpenseSnapshotJson: true, request: { select: { branchId: true, requesterDisplayNameSnapshot: true } } },
  }) : [];
  const snapshots = new Map<string, ReimbursementSourceSnapshot>();
  const requesterNames = new Map<string, string>();
  const missingSources = new Set<string>();
  for (const row of claimRows) {
    const line = lines.find((item) => item.id === row.sourceReimbursementLineId && item.reimbursementRequestId === row.sourceReimbursementRequestId && item.request.branchId === row.branchId);
    if (!line) { missingSources.add(row.id); continue; }
    requesterNames.set(row.id, line.request.requesterDisplayNameSnapshot);
    const source = line.sourceExpenseSnapshotJson as ReimbursementSourceSnapshot | null;
    if (source?.schemaVersion === 1 && typeof source.expenseId === 'string' && Array.isArray(source.attachments)) snapshots.set(row.id, source);
    else if (source) missingSources.add(row.id);
  }
  const sourceIds = [...new Set([...snapshots.values()].map((source) => source.expenseId))];
  const sources = sourceIds.length ? await db.expenseRecord.findMany({
    where: { companyId, id: { in: sourceIds }, ...branchScopeWhere(scopes) }, select: { id: true, branchId: true },
  }) : [];
  for (const row of rows) {
    const source = snapshots.get(row.id);
    if (source && !sources.some((item) => item.id === source.expenseId && item.branchId === row.branchId)) { snapshots.delete(row.id); missingSources.add(row.id); }
  }
  const evidenceExpenseIds = [...new Set([...rows.map((row) => row.id), ...[...snapshots.values()].map((source) => source.expenseId)])];
  const certificates = evidenceExpenseIds.length ? await db.expenseSubstituteReceiptEvidence.findMany({
    where: { companyId, expenseId: { in: evidenceExpenseIds }, ...branchScopeWhere(scopes) }, orderBy: { version: 'asc' },
    select: { id: true, expenseId: true, version: true, status: true, fundingSource: true, payerName: true, paymentEvidenceAttachmentIds: true, snapshotJson: true,
      snapshotChecksumSha256: true, correctionOfEvidenceId: true, correctionReason: true, artifactAttachmentId: true, wetSignedScanAttachmentId: true },
  }) : [];
  const links = evidenceExpenseIds.length ? await db.attachmentLink.findMany({
    where: { companyId, targetType: 'expense.record', targetId: { in: evidenceExpenseIds }, attachment: { companyId, ...(!includeUnavailableAttachments && { status: 'ACTIVE', ...branchScopeWhere(scopes) }) } },
    include: { attachment: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  }) : [];
  const attachmentIds = [...new Set([
    ...certificates.flatMap((certificate) => [certificate.artifactAttachmentId, certificate.wetSignedScanAttachmentId]),
    ...[...snapshots.values()].flatMap((source) => source.attachments.map((file) => file.id)),
  ].filter((id): id is string => typeof id === 'string' && Boolean(id)))];
  const certificateFiles = attachmentIds.length ? await db.attachmentObject.findMany({
    where: { companyId, id: { in: attachmentIds }, ...(!includeUnavailableAttachments && { status: 'ACTIVE', ...branchScopeWhere(scopes) }) },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  }) : [];
  const forRow = (row: EvidenceRow) => {
    const source = snapshots.get(row.id);
    // Claims retain exactly the selected source revision; unrelated files added later stay out.
    const pinnedFiles = new Map(source?.attachments.map((file) => [file.id, file.checksumSha256]) ?? []);
    const relevantCertificates = certificates.filter((certificate) => certificate.expenseId === row.id
      || (source && certificate.expenseId === source.expenseId && (source.certificate?.id === certificate.id
        || (certificate.artifactAttachmentId && pinnedFiles.has(certificate.artifactAttachmentId))
        || (certificate.wetSignedScanAttachmentId && pinnedFiles.has(certificate.wetSignedScanAttachmentId)))));
    const files = new Map(links.filter((link) => link.targetId === row.id).map((link) => [link.attachmentId, { file: link.attachment, purpose: link.purpose }]));
    for (const file of certificateFiles) {
      const certificateFile = relevantCertificates.some((certificate) => certificate.artifactAttachmentId === file.id || certificate.wetSignedScanAttachmentId === file.id);
      const pinned = pinnedFiles.has(file.id) && (!pinnedFiles.get(file.id) || pinnedFiles.get(file.id) === file.checksumSha256);
      if (certificateFile || pinned) files.set(file.id, { file, purpose: 'expense.review.evidence' });
    }
    const attachments: ExpenseAttachmentRef[] = [...files.values()].filter(({ file }) => includeUnavailableAttachments || isBranchInScope(scopes, file.branchId)).map(({ file, purpose }) => {
      const refs = relevantCertificates.filter((certificate) => certificate.artifactAttachmentId === file.id || certificate.wetSignedScanAttachmentId === file.id);
      const historical = refs.length > 0 && refs.every((certificate) => certificate.status === 'SUPERSEDED');
      return {
        id: file.id, purpose: purpose as ExpenseAttachmentRef['purpose'], originalFileName: file.originalFileName,
        mimeType: file.mimeType, byteSize: Number(file.byteSize), checksumSha256: file.checksumSha256, status: file.status,
        createdAt: file.createdAt.toISOString(),
        ...(source && (pinnedFiles.has(file.id) || refs.some(ref => ref.expenseId === source.expenseId)) && { sourceExpenseId: source.expenseId }),
        ...(refs.length > 0 && { isHistorical: historical, substituteReceiptStatus: historical ? 'SUPERSEDED' : refs.at(-1)!.status }),
      };
    });
    const expectedFiles = [...(source?.attachments.map(file => file.id) ?? []), ...relevantCertificates.flatMap(cert => [cert.artifactAttachmentId, cert.wetSignedScanAttachmentId]).filter(Boolean)];
    const sourceEvidenceUnavailable = missingSources.has(row.id) || expectedFiles.some(id => !attachments.some(file => file.id === id));
    return { sourceEvidenceUnavailable, attachments, certificates: relevantCertificates, sourceSnapshot: source, requesterName: requesterNames.get(row.id) };
  };
  return new Map(rows.map((row) => [row.id, forRow(row)]));
}
