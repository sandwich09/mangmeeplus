import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { expenseHistoryActionLabel, expenseHistoryActorLabel, expenseHistoryFieldLabel, expenseHistoryValueLabel } from './expense-history.logic';

describe('expense history display labels', () => {
  it('renders stored fractional rates and nested line enums in human-readable form', () => {
    assert.equal(expenseHistoryValueLabel('lines.1.vatRate', '0.07'), '7%');
    assert.equal(expenseHistoryValueLabel('lines.1.whtRate', '0.03'), '3%');
    assert.equal(expenseHistoryValueLabel('lines.1.vatRate', '0'), '0%');
    assert.equal(expenseHistoryValueLabel('grandTotalAmount', '12345.6'), '12,345.60');
    assert.equal(expenseHistoryValueLabel('lines.1.vatTreatment', 'EXEMPT'), 'ยกเว้น VAT');
    assert.equal(expenseHistoryValueLabel('vendorEntityKindSnapshot', 'JURISTIC'), 'บริษัท / ห้างหุ้นส่วน');
    assert.equal(expenseHistoryValueLabel('expenseDate', '2026-10-30'), '30 ต.ค. 2569');
    assert.equal(expenseHistoryValueLabel('note', null), '—');
  });
  it('labels known actions and keeps unknown actions safe', () => {
    assert.equal(expenseHistoryActionLabel('expense.payment.record'), 'บันทึกการจ่ายเงิน');
    assert.equal(expenseHistoryActionLabel('tax.document_tax.finalize'), 'ยืนยันข้อมูลภาษี');
    assert.equal(expenseHistoryActionLabel('expense.buyer_match.confirm'), 'ยืนยันข้อมูลผู้ซื้อในเอกสาร');
    assert.equal(expenseHistoryActionLabel('expense.substitute_receipt.wet_signed_scan.link'), 'แนบใบรับรองแทนใบเสร็จที่เซ็นแล้ว');
    assert.equal(expenseHistoryActionLabel('internal.payload.secret'), 'กิจกรรมในรายการจ่าย');
  });

  it('labels only supported change fields and safe line fields', () => {
    assert.equal(expenseHistoryFieldLabel('grandTotalAmount'), 'ยอดรวม');
    assert.equal(expenseHistoryFieldLabel('lines.2.quantity'), 'รายการที่ 2 · จำนวน');
    assert.equal(expenseHistoryFieldLabel('vendorEntityKindSnapshot'), 'ประเภทผู้ขาย');
    assert.equal(expenseHistoryFieldLabel('branchName'), 'สาขา');
    assert.equal(expenseHistoryFieldLabel('lines.1.expenseCategoryName'), 'รายการที่ 1 · หมวดหมู่ค่าใช้จ่าย');
    assert.equal(expenseHistoryFieldLabel('metadata.customerEmail'), 'ข้อมูลที่เปลี่ยน');
  });

  it('uses explicit actor labels when display names are missing', () => {
    assert.equal(expenseHistoryActorLabel('SYSTEM', null), 'ระบบ');
    assert.equal(expenseHistoryActorLabel('USER', null), 'ผู้ใช้ที่ไม่ทราบชื่อ');
    assert.equal(expenseHistoryActorLabel('USER', '  Mali  '), 'Mali');
  });
});
