import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scoreAndFindDuplicates } from './expense-duplicate.logic';

/**
 * The scorer's job is to rank suspicions, not to decide anything: every match becomes a warning a
 * person reads. These cases pin the one thing it must get right — telling a receipt photographed
 * twice apart from the same purchase made twice.
 */
const SHOP = { vendorName: 'ร้านน้ำแข็งเจ๊หมวย', vendorTaxId: '0105556012345' };

describe('scoreAndFindDuplicates: two purchases vs one receipt twice', () => {
  it('does not suspect two receipts from one shop on one day when their printed numbers differ', () => {
    const matches = scoreAndFindDuplicates(
      { ...SHOP, vendorDocumentNumber: 'A-1001', expenseDate: '2026-09-21', grandTotalAmount: '50.00' },
      [{ id: 'e2', ...SHOP, vendorDocumentNumber: 'A-1042', expenseDate: '2026-09-21', grandTotalAmount: '50.00' }],
    );
    assert.deepEqual(matches, []);
  });

  it('still suspects them when neither receipt carries a number (handwritten cash bill)', () => {
    const matches = scoreAndFindDuplicates(
      { ...SHOP, expenseDate: '2026-09-21', grandTotalAmount: '50.00' },
      [{ id: 'e2', ...SHOP, expenseDate: '2026-09-21', grandTotalAmount: '50.00' }],
    );
    assert.equal(matches.length, 1);
    assert.ok(matches[0]!.reasonCodes.includes('same_vendor_date_amount'));
  });

  it('keeps the tax-id rule off too when the numbers prove two purchases', () => {
    const matches = scoreAndFindDuplicates(
      { ...SHOP, vendorDocumentNumber: 'A-1001', expenseDate: '2026-09-21', grandTotalAmount: '50.00' },
      [{ id: 'e2', ...SHOP, vendorDocumentNumber: 'A-1042', expenseDate: '2026-09-19', grandTotalAmount: '50.00' }],
    );
    assert.deepEqual(matches, []);
  });

  it('never lets a differing number hide the same photo uploaded twice', () => {
    // OCR can misread a number; identical bytes cannot be two purchases.
    const matches = scoreAndFindDuplicates(
      { ...SHOP, checksumSha256: 'abc', vendorDocumentNumber: 'A-1001', expenseDate: '2026-09-21', grandTotalAmount: '50.00' },
      [{ id: 'e2', ...SHOP, checksumSha256: 'abc', vendorDocumentNumber: 'A-1OO1', expenseDate: '2026-09-21', grandTotalAmount: '50.00' }],
    );
    assert.equal(matches.length, 1);
    assert.ok(matches[0]!.reasonCodes.includes('same_checksum'));
  });

  it('still catches the same receipt captured twice, by its own number', () => {
    const matches = scoreAndFindDuplicates(
      { ...SHOP, vendorDocumentNumber: 'A-1001', expenseDate: '2026-09-21', grandTotalAmount: '50.00' },
      [{ id: 'e2', ...SHOP, vendorDocumentNumber: 'a 1001', expenseDate: '2026-09-21', grandTotalAmount: '50.00' }],
    );
    assert.equal(matches.length, 1);
    assert.ok(matches[0]!.reasonCodes.includes('same_vendor_document_number'));
    assert.ok(matches[0]!.reasonCodes.includes('same_vendor_date_amount'));
  });
});
