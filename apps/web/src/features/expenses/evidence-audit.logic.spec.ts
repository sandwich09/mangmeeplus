import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SharedEvidenceRow } from './expenses.model';
import {
  deriveEvidenceRowFlags, evidenceRowBadge, evidenceRowsInDateOrder, readEvidenceListState,
  evidenceRowState,
  filterRowsByFlag,
  summarizeEvidenceFlags,
  summarizeEvidenceRows,
} from './evidence-audit.logic';

const cleanRow: SharedEvidenceRow = {
  expenseId: 'exp-1',
  expenseNumber: 'EXP-001',
  status: 'CONFIRMED',
  sourceReimbursementRequestId: null,
  missingReceiptReason: null,
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
  pendingPostingSourceId: null,
  expenseCategoryId: 'category-1',
  categoryName: 'สำนักงาน',
  createdByUserId: 'user-1',
  attachments: [{} as SharedEvidenceRow['attachments'][number]],
};

const flagsFor = (overrides: Partial<SharedEvidenceRow>) =>
  deriveEvidenceRowFlags({ ...cleanRow, ...overrides });

describe('deriveEvidenceRowFlags', () => {
  it('treats a receipt-less claim projection as informational, not attention', () => {
    const flags = flagsFor({
      attachments: [],
      sourceReimbursementRequestId: 'rb-1',
      missingReceiptReason: 'ผู้ให้บริการรายย่อยไม่ออกใบเสร็จ',
      taxEvidenceStatus: 'SUPPORTING_ONLY',
    });
    assert.deepEqual(flags.map((flag) => flag.key), ['CLAIM_FORM_EVIDENCE', 'SUPPORTING_ONLY']);
    assert.equal(evidenceRowState(flags), 'ok');
  });

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

  it('counts uncategorised rows as needing correction while retaining informational evidence notes', () => {
    const flags = flagsFor({ taxEvidenceStatus: 'SUPPORTING_ONLY', categoryName: null, expenseNumber: null });
    assert.deepEqual(flags.map((flag) => flag.key), ['SUPPORTING_ONLY', 'NO_CATEGORY', 'LEGACY_NO_NUMBER']);
    assert.equal(evidenceRowState(flags), 'attention');
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
    ]), { attention: 2, ok: 1 });
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
      { key: 'TAX_NEEDS_REVIEW', label: 'หลักฐานรายจ่ายรอตรวจ', count: 1 },
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

  it('filters attention by failing checks, including a missing category', () => {
    assert.deepEqual(filterRowsByFlag(rows, 'attention').map((row) => row.expenseId), ['exp-2', 'exp-3', 'exp-4']);
  });
});


describe('accountant list status and state', () => {
  it('one badge covers every combination of failing checks; informational notes stay complete', () => {
    const conditions: Partial<SharedEvidenceRow>[] = [
      { sourceEvidenceUnavailable: true }, { attachments: [] }, { taxEvidenceStatus: 'NEEDS_REVIEW' },
      { vendorNameSnapshot: null }, { categoryName: null },
    ];
    for (let mask = 0; mask < 32; mask++) {
      const row = { ...cleanRow, ...Object.assign({}, ...conditions.filter((_, i) => mask & (1 << i))) };
      const failures = deriveEvidenceRowFlags(row).filter(flag => flag.severity === 'warn');
      assert.equal(evidenceRowBadge(row), failures.length === 0 ? 'ครบแล้ว' : failures.length === 1 ? failures[0]!.label : `ต้องแก้ ${failures.length} ข้อ`);
    }
    assert.equal(evidenceRowBadge({ ...cleanRow, taxEvidenceStatus: 'NOT_TAX_EVIDENCE' }), 'หลักฐานรายจ่ายใช้ไม่ได้');
    assert.equal(evidenceRowBadge({ ...cleanRow, taxEvidenceStatus: 'SUPPORTING_ONLY', expenseNumber: null }), 'ครบแล้ว');
    assert.deepEqual(filterRowsByFlag([cleanRow, { ...cleanRow, categoryName: null }], 'ok'), [cleanRow]);
  });
  it('defaults to current document month, while all months and every URL filter survive a return', () => {
    assert.equal(readEvidenceListState(new URLSearchParams(), '2026-10').yearMonth, '2026-10');
    assert.equal(readEvidenceListState(new URLSearchParams('yearMonth='), '2026-10').yearMonth, '');
    assert.deepEqual(readEvidenceListState(new URLSearchParams('yearMonth=2026-09&dateField=uploadedAt&documentStatus=VOIDED&sourceDocumentType=RECEIPT&taxEvidenceStatus=NEEDS_REVIEW&flagFilter=attention&order=oldest&page=3'), '2026-10'), {
      yearMonth: '2026-09', dateField: 'uploadedAt', documentStatus: 'VOIDED', sourceDocumentType: 'RECEIPT', taxEvidenceStatus: 'NEEDS_REVIEW', postingStatus: '', flagFilter: 'attention', order: 'oldest', page: 3,
    });
  });
  it('sorts all matching rows before slicing a page, with a stable id tie-break', () => {
    const rows = Array.from({ length: 23 }, (_, i) => ({ ...cleanRow, expenseId: String(i).padStart(2, '0'), expenseDate: i < 12 ? '2026-09-30' : '2026-10-01' }));
    const oldest = evidenceRowsInDateOrder(rows, 'oldest');
    assert.deepEqual(oldest.map(row => row.expenseId), rows.map(row => row.expenseId));
    assert.deepEqual(evidenceRowsInDateOrder(rows, 'newest').map(row => row.expenseId), rows.map(row => row.expenseId).reverse());
    assert.equal(new Set([...oldest.slice(0, 10), ...oldest.slice(10, 20)].map(row => row.expenseId)).size, 20);
  });
});
