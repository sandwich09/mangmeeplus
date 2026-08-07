import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SharedEvidenceRow } from './expenses.model';
import {
  deriveEvidenceRowFlags,
  evidenceRowState,
  filterRowsByFlag,
  summarizeEvidenceFlags,
  summarizeEvidenceRows,
} from './evidence-audit.logic';

const cleanRow: SharedEvidenceRow = {
  expenseId: 'exp-1',
  expenseNumber: 'EXP-001',
  status: 'CONFIRMED',
  sourceDocumentType: 'TAX_INVOICE',
  taxEvidenceStatus: 'USABLE_FOR_TAX',
  taxEvidenceReasonCode: 'VALID_TAX_INVOICE_FIELDS',
  vendorNameSnapshot: 'บริษัท ตัวอย่าง จำกัด',
  expenseDate: '2026-07-01',
  uploadedAt: '2026-07-01T09:00:00.000Z',
  grandTotalAmount: '107.00',
  paymentStatus: 'UNPAID',
  postingStatus: 'posted',
  postingError: null,
  journalEntryId: 'journal-1',
  journalEntryNumber: 'JV-202607-00001',
  pendingPostingSourceType: null,
  expenseCategoryId: 'category-1',
  categoryName: 'สำนักงาน',
  createdByUserId: 'user-1',
  attachments: [{} as SharedEvidenceRow['attachments'][number]],
};

const flagsFor = (overrides: Partial<SharedEvidenceRow>) =>
  deriveEvidenceRowFlags({ ...cleanRow, ...overrides });

describe('deriveEvidenceRowFlags', () => {
  it('returns no flags and ok for a complete row', () => {
    const flags = flagsFor({});
    assert.deepEqual(flags, []);
    assert.equal(evidenceRowState(flags), 'ok');
  });

  it('derives each warning flag only from its condition', () => {
    assert.deepEqual(flagsFor({ attachments: [] }).map((flag) => flag.key), ['NO_FILE']);
    assert.deepEqual(flagsFor({ taxEvidenceStatus: 'NEEDS_REVIEW' }).map((flag) => flag.key), ['TAX_NEEDS_REVIEW']);
    assert.deepEqual(flagsFor({ taxEvidenceStatus: 'NOT_TAX_EVIDENCE' }).map((flag) => flag.key), ['NOT_TAX_EVIDENCE']);
    assert.deepEqual(flagsFor({ vendorNameSnapshot: '  ' }).map((flag) => flag.key), ['NO_VENDOR']);
  });

  it('derives informational flags without making the row attention', () => {
    const flags = flagsFor({ taxEvidenceStatus: 'SUPPORTING_ONLY', categoryName: null, expenseNumber: null });
    assert.deepEqual(flags.map((flag) => flag.key), ['SUPPORTING_ONLY', 'NO_CATEGORY', 'LEGACY_NO_NUMBER']);
    assert.equal(evidenceRowState(flags), 'ok');
  });

  it('reports both warning flags for an unreviewed row with no files', () => {
    const flags = flagsFor({ attachments: [], taxEvidenceStatus: 'NEEDS_REVIEW' });
    assert.deepEqual(flags.map((flag) => flag.key), ['NO_FILE', 'TAX_NEEDS_REVIEW']);
    assert.equal(evidenceRowState(flags), 'attention');
  });
});

describe('summarizeEvidenceRows', () => {
  it('counts attention and ok rows', () => {
    assert.deepEqual(summarizeEvidenceRows([
      cleanRow,
      { ...cleanRow, expenseId: 'exp-2', attachments: [] },
      { ...cleanRow, expenseId: 'exp-3', categoryName: null },
    ]), { attention: 1, ok: 2 });
  });
});

describe('summarizeEvidenceFlags', () => {
  it('counts overlapping worklist flags in display order', () => {
    assert.deepEqual(summarizeEvidenceFlags([
      cleanRow,
      {
        ...cleanRow,
        expenseId: 'exp-2',
        attachments: [],
        taxEvidenceStatus: 'NEEDS_REVIEW',
        vendorNameSnapshot: null,
        categoryName: null,
      },
      { ...cleanRow, expenseId: 'exp-3', attachments: [], categoryName: null },
    ]), [
      { key: 'NO_FILE', label: 'ไม่มีไฟล์', count: 2 },
      { key: 'TAX_NEEDS_REVIEW', label: 'ยังไม่ตรวจภาษี', count: 1 },
      { key: 'NO_VENDOR', label: 'ไม่มีผู้ขาย', count: 1 },
      { key: 'NO_CATEGORY', label: 'ยังไม่จัดหมวด', count: 2 },
    ]);
  });

  it('omits zero-count and dedicated-cell-only flags', () => {
    assert.deepEqual(summarizeEvidenceFlags([
      cleanRow,
      { ...cleanRow, expenseId: 'exp-2', taxEvidenceStatus: 'NOT_TAX_EVIDENCE', expenseNumber: null },
    ]), []);
  });
});

describe('filterRowsByFlag', () => {
  const rows = [
    cleanRow,
    { ...cleanRow, expenseId: 'exp-2', categoryName: null, expenseNumber: null, taxEvidenceStatus: 'SUPPORTING_ONLY' as const },
    { ...cleanRow, expenseId: 'exp-3', attachments: [] },
    { ...cleanRow, expenseId: 'exp-4', taxEvidenceStatus: 'NOT_TAX_EVIDENCE' as const },
  ];

  it('keeps row order for all and exact-flag filters', () => {
    assert.deepEqual(filterRowsByFlag(rows, 'all').map((row) => row.expenseId), ['exp-1', 'exp-2', 'exp-3', 'exp-4']);
    assert.deepEqual(filterRowsByFlag(rows, 'NO_CATEGORY').map((row) => row.expenseId), ['exp-2']);
    assert.deepEqual(filterRowsByFlag(rows, 'TAX_NEEDS_REVIEW'), []);
  });

  it('filters attention by warning severity, not by any flag', () => {
    assert.deepEqual(filterRowsByFlag(rows, 'attention').map((row) => row.expenseId), ['exp-3', 'exp-4']);
  });
});
