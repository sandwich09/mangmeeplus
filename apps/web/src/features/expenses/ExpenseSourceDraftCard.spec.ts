import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ExpenseSourceDraft } from '@watchdog-bms/contracts';
import { ExpenseSourceDraftCard } from './ExpenseSourceDraftCard';

// Match the shared field tests when tsx renders Next's automatic-JSX components in Node.
(globalThis as typeof globalThis & { React: typeof React }).React = React;

function render(canEdit = true, readOnlyMessage?: string): string {
  const sourceDraft: ExpenseSourceDraft = {
    status: 'PAUSED_INTERRUPTED',
    canEdit,
    header: { expenseDate: '2026-09-07', vendorName: 'ร้านคุณยาย', businessPurpose: null },
    items: [
      { itemRef: 'item-1', lineId: 'line-1', description: 'น้ำดื่ม', quantity: '2', unitPrice: '0', totalAmount: '0', expenseCategoryId: null },
      { itemRef: 'item-2', lineId: null, description: 'กระดาษ', quantity: null, unitPrice: null, totalAmount: null, expenseCategoryId: null },
      { itemRef: 'item-3', lineId: null, description: null, quantity: null, unitPrice: '15', totalAmount: null, expenseCategoryId: null },
    ],
    missingFields: [
      { id: 'D-PURPOSE', scope: 'DOCUMENT', field: 'businessPurpose', prompt: 'ใช้ทำอะไร' },
      { id: 'I-item-2-PRICE', scope: 'ITEM', itemRef: 'item-2', field: 'price', prompt: 'item-2 ราคาเท่าไร' },
      { id: 'I-item-3-DESCRIPTION', scope: 'ITEM', itemRef: 'item-3', field: 'description', prompt: 'ซื้ออะไร' },
    ],
  };
  return renderToStaticMarkup(React.createElement(ExpenseSourceDraftCard, {
    companyId: 'company-1', expenseId: 'expense-1', expectedUpdatedAt: '2026-09-07T00:00:00.000Z',
    sourceDraft, locale: 'th', readOnlyMessage, onSaved: () => undefined,
  }));
}

test('renders every staged item, inline missing hints, known zero, and the partial-save action', () => {
  const html = render();
  assert.equal((html.match(/data-source-draft-item="true"/g) ?? []).length, 3);
  assert.match(html, /aria-label="ข้อมูลบิลที่ยังไม่ครบ"/);
  assert.match(html, /aria-label="วันที่เอกสาร"/);
  assert.match(html, /aria-label="ชื่อผู้ขาย"/);
  assert.match(html, /aria-label="ซื้อไปใช้ทำอะไร"/);
  assert.match(html, /ซื้อไปใช้ทำอะไร/);
  assert.doesNotMatch(html, /ข้อมูลที่ยังต้องเติม|รายการที่ 2: ราคาต่อหน่วยหรือยอดรวม/);
  assert.doesNotMatch(html, /D-PURPOSE|I-item-2-PRICE|item-2 ราคาเท่าไร/);
  assert.match(html, /aria-label="รายการที่ 1 ราคาต่อหน่วย"[^>]*value="0"/);
  assert.match(html, />เพิ่มรายการ<\/button>/);
  assert.match(html, />บันทึกร่าง<\/button>/);
  assert.match(html, /ยังไม่ยืนยันรายการ/);
  assert.doesNotMatch(html, /<select/);
  assert.match(html, /role="combobox"[^>]*aria-label="รายการที่ 1 หมวดหมู่ค่าใช้จ่าย"/);
});

test('shows the staged facts without an unavailable save action when the API denies source editing', () => {
  const html = render(false);
  assert.match(html, /ร้านคุณยาย/);
  assert.match(html, /บัญชีนี้ไม่มีสิทธิ์แก้ไขร่างนี้/);
  assert.doesNotMatch(html, />บันทึกร่าง<\/button>/);
});

test('explains the READY review correction instead of claiming the reviewer lacks permission', () => {
  const message = 'ตรวจข้อมูลด้านล่าง แล้วกด “ถัดไป” เพื่อเปิดร่าง';
  const html = render(false, message);
  assert.match(html, new RegExp(message));
  assert.doesNotMatch(html, /บัญชีนี้ไม่มีสิทธิ์แก้ไขร่างนี้/);
});
