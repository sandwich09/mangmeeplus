import { it } from 'node:test';
import assert from 'node:assert/strict';
import { loadExpenseEvidenceSources } from './expense-evidence-sources';
import { loadExpenseReimbursementProgress } from './expense-reimbursement-progress';
import { buildManifestEntry } from '../domain/logic/expense-export.logic';

const file = (id: string) => ({ id, branchId: 'b1', status: 'ACTIVE', originalFileName: `${id}.pdf`, mimeType: 'application/pdf', byteSize: 20n, checksumSha256: id, createdAt: new Date() });
function fixture() {
  const source = { schemaVersion: 1, expenseId: 'source', attachments: [{ id: 'receipt', checksumSha256: 'receipt' }], certificate: { id: 'cert' } };
  const queries: any = {};
  const certificate = { id: 'cert', expenseId: 'source', version: 1, status: 'ISSUED', artifactAttachmentId: 'signed', wetSignedScanAttachmentId: null };
  const db: any = {
    reimbursementLine: { findMany: async (q: any) => { queries.line = q; return [{ id: 'line', reimbursementRequestId: 'claim', sourceExpenseSnapshotJson: source, request: { branchId: 'b1', requesterDisplayNameSnapshot: 'Employee' } }]; } },
    expenseRecord: { findMany: async (q: any) => { queries.source = q; return [{ id: 'source', branchId: 'b1' }]; } },
    expenseSubstituteReceiptEvidence: { findMany: async (q: any) => { queries.cert = q; return [certificate]; } },
    attachmentLink: { findMany: async (q: any) => { queries.links = q; return [{ targetId: 'source', attachmentId: 'new-later', purpose: 'expense.receipt.supporting', attachment: file('new-later') }]; } },
    attachmentObject: { findMany: async (q: any) => { queries.files = q; return [file('signed'), file('receipt'), file('new-later')]; } },
  };
  return { db, queries, source, certificate };
}
const projection = { id: 'projection', branchId: 'b1', sourceReimbursementRequestId: 'claim', sourceReimbursementLineId: 'line' };
it('follows exactly the retained claim revision, preserving company and branch boundaries', async () => {
  const { db, queries } = fixture();
  const evidence = (await loadExpenseEvidenceSources(db, 'co1', [projection], { branchIds: ['b1'] })).get('projection')!;
  assert.deepEqual(evidence.attachments.map(file => file.id).sort(), ['receipt', 'signed']);
  assert.equal(evidence.requesterName, 'Employee');
  assert.equal(evidence.sourceSnapshot?.expenseId, 'source');
  assert.ok(evidence.attachments.every(file => file.sourceExpenseId === 'source'));
  for (const key of ['source', 'cert', 'links', 'files']) assert.equal(queries[key].where.companyId, 'co1');
  assert.deepEqual(queries.files.where.OR, [{ branchId: { in: ['b1'] } }, { branchId: null }]);
  assert.equal(queries.line.where.request.companyId, 'co1');
});
it('does not expose a source outside the authorized tenant or source branch', async () => {
  for (const sources of [[], [{ id: 'source', branchId: 'other' }]]) {
    const { db } = fixture();
    db.expenseRecord.findMany = async () => sources;
    const evidence = (await loadExpenseEvidenceSources(db, 'co1', [projection], { branchIds: ['b1'] })).get('projection')!;
    assert.equal(evidence.sourceSnapshot, undefined);
    assert.deepEqual(evidence.attachments, []);
  }
});
it('keeps cancelled pre-issue scans as history and labels their export role', async () => {
  const { db, certificate } = fixture();
  certificate.status = 'SUPERSEDED';
  const evidence = (await loadExpenseEvidenceSources(db, 'co1', [{ id: 'source', branchId: 'b1' }])).get('source')!;
  const signed = evidence.attachments.find(file => file.id === 'signed')!;
  assert.equal(signed.isHistorical, true);
  assert.equal(buildManifestEntry({ expenseId: 'source', expenseNumber: 'EXP1', attachment: signed, sourceDocumentType: 'SUBSTITUTE_RECEIPT', taxEvidenceStatus: 'NON_TAX_EVIDENCE', downloadUrl: '/file', downloadUrlExpiresAt: '', webUrl: '' } as any).evidence_role, 'substitute.history');
});
it('does not substitute changed files for the retained attachment checksum', async () => {
  const { db, source } = fixture();
  source.attachments[0]!.checksumSha256 = 'original';
  const evidence = (await loadExpenseEvidenceSources(db, 'co1', [projection])).get('projection')!;
  assert.deepEqual(evidence.attachments.map(file => file.id), ['signed']);
});
it('projects paid and reopened payment progress without changing the expense accounting state', async () => {
  const { db } = fixture();
  db.expenseSubstituteReceiptEvidence.findMany = async () => [{ expenseId: 'source' }];
  for (const status of ['PAID', 'READY_FOR_PAYMENT']) {
    db.reimbursementLine.findMany = async () => [{ sourceExpenseSnapshotJson: { expenseId: 'source' }, request: { id: 'claim', requestNo: 'RB1', status, branchId: 'b1' } }];
    const progress = await loadExpenseReimbursementProgress(db, 'co1', [{ id: 'source', branchId: 'b1', status: 'READY_FOR_CONFIRMATION' }]);
    assert.equal(progress.get('source')?.status, status);
  }
  db.reimbursementLine.findMany = async () => [];
  assert.deepEqual((await loadExpenseReimbursementProgress(db, 'co1', [{ id: 'source', branchId: 'b1', status: 'READY_FOR_CONFIRMATION' }])).get('source'), { status: 'WAITING_CLAIM' });
});

it('retains cancelled scans pinned by older claims as history even when another certificate was selected', async () => {
  const { db, source, certificate } = fixture();
  source.certificate.id = 'another-cert';
  source.attachments = [{ id: 'signed', checksumSha256: 'signed' }];
  certificate.status = 'SUPERSEDED';
  const evidence = (await loadExpenseEvidenceSources(db, 'co1', [projection])).get('projection')!;
  assert.equal(evidence.attachments.find(file => file.id === 'signed')?.isHistorical, true);
  assert.equal(evidence.attachments.find(file => file.id === 'signed')?.sourceExpenseId, 'source');
});

it('D3: expense progress loads the confirmed own expense fact in the existing claim query', async () => {
  const { db } = fixture(); let query: any;
  db.expenseSubstituteReceiptEvidence.findMany = async () => [{ expenseId: 'source' }];
  db.reimbursementLine.findMany = async (q: any) => { query = q; return [{ sourceExpenseSnapshotJson: { expenseId: 'source' }, request: { id: 'claim', requestNo: 'RB1', status: 'READY_FOR_PAYMENT', branchId: 'b1', sourceExpenses: [{ duplicateStatus: 'CONFIRMED_DUPLICATE' }] } }]; };
  const progress = await loadExpenseReimbursementProgress(db, 'co1', [{ id: 'source', branchId: 'b1', status: 'READY_FOR_CONFIRMATION' }]);
  assert.equal(progress.get('source')?.hasConfirmedDuplicate, true);
  assert.ok(query.select.request.select.sourceExpenses);
});
