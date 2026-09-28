import React from 'react';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReimbursementDraftActionView } from './ReimbursementDraftActionPage';

const noop = () => {};
const preview = {
  schemaVersion: 1, actionId: 'a1', previewRevision: 2, operation: 'UPDATE', expiresAt: '2999-01-01T00:00:00.000Z', confirmationDigest: 'f'.repeat(64),
  before: { requesterDisplayName: 'พิม', amount: '100.0000', currency: 'THB', reason: 'เดิม', receiptRequirementStatus: 'ATTACHED', lines: [], signatureImpact: 'NONE' },
  after: { requesterDisplayName: 'พิม', amount: '120.0000', currency: 'THB', reason: 'ไปพบลูกค้า', receiptRequirementStatus: 'REQUIRED', lines: [{ lineRef: 'l1', lineNo: 1, description: 'แท็กซี่', categoryKey: 'travel', incurredDate: '2026-09-27', amount: '120.0000' }], signatureImpact: 'INVALIDATED' },
  diff: [{ fieldPath: 'lines' }], warnings: ['missing_receipt', 'signatures_invalidated'],
};

describe('ReimbursementDraftActionView', () => {
  it('renders the complete before/after result, draft-only boundary, warnings and exact revision', () => {
    const html = renderToStaticMarkup(React.createElement(ReimbursementDraftActionView, { companyId: 'company-1', state: { kind: 'ready', result: { status: 'preview', preview } }, onConfirm: noop, onCancel: noop, onRefresh: noop }));
    for (const text of ['รุ่น 2', 'DRAFT', 'ไม่ส่งอนุมัติ', 'ข้อมูลก่อนแก้ไข', 'ข้อมูลหลังแก้ไข', 'แท็กซี่', '120.00 THB', 'ลบลายเซ็นเดิม', 'ยังไม่มีใบเสร็จประกอบรายการ', 'ยืนยันบันทึกเป็นร่าง']) assert.match(html, new RegExp(text));
  });

  it('renders terminal and unknown recovery states without offering a second create', () => {
    const applied = renderToStaticMarkup(React.createElement(ReimbursementDraftActionView, { companyId: 'company-1', state: { kind: 'ready', result: { status: 'applied', receipt: { requestId: 'rb1', amount: '120.0000', currency: 'THB', currentState: 'DRAFT' } } }, onConfirm: noop, onCancel: noop, onRefresh: noop }));
    assert.match(applied, /บันทึกร่างใบเบิกแล้ว/);
    assert.match(applied, /href="\/companies\/company-1\/reimbursements\/rb1"/);
    assert.doesNotMatch(applied, /สร้าง.*ใหม่/);
    const unknown = renderToStaticMarkup(React.createElement(ReimbursementDraftActionView, { companyId: 'company-1', state: { kind: 'unknown', notice: 'result_unconfirmed' }, onConfirm: noop, onCancel: noop, onRefresh: noop }));
    assert.match(unknown, /ตรวจสถานะจากระบบ/);
    assert.match(unknown, /ระบบจะตรวจจากร่างเดิมโดยไม่สร้างใบเบิกซ้ำ/);
    assert.doesNotMatch(unknown, /ยืนยันบันทึกเป็นร่าง/);
  });

  it('preserves large decimal amounts and does not turn an unknown amount into zero', () => {
    const render = (amount: unknown) => renderToStaticMarkup(React.createElement(ReimbursementDraftActionView, {
      companyId: 'company-1', state: { kind: 'ready', result: { status: 'preview', preview: { ...preview,
        after: { ...preview.after, amount } } } }, onConfirm: noop, onCancel: noop, onRefresh: noop }));
    assert.match(render('9007199254740993.01'), /9,007,199,254,740,993\.01 THB/);
    assert.match(render(null), /ยังตรวจสอบจำนวนเงินไม่ได้/);
    assert.doesNotMatch(render('120.00'), /missing_receipt|signatures_invalidated|claimSignatures/);
  });

  it('disables confirmation after the exact preview expires', () => {
    const html = renderToStaticMarkup(React.createElement(ReimbursementDraftActionView, { companyId: 'company-1', state: { kind: 'ready', result: { status: 'preview', preview: { ...preview, expiresAt: '2000-01-01T00:00:00.000Z' } } }, onConfirm: noop, onCancel: noop, onRefresh: noop }));
    assert.match(html, /หมดอายุแล้ว/);
    assert.match(html, /disabled=""[^>]*>ยืนยันบันทึกเป็นร่าง/);
  });
});
