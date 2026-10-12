import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ToastTone } from './toast.model';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test('renders pastel tone classes and the toast accessibility contract', async () => {
  const { Toast } = await import('./Toast');
  const cases: Array<{ tone: ToastTone; background: string; chip: string; text: string; role: 'status' | 'alert' }> = [
    { tone: 'success', background: 'bg-success-50', chip: 'bg-success-500/15', text: 'text-success-700', role: 'status' },
    { tone: 'warning', background: 'bg-warning-50', chip: 'bg-warning-500/20', text: 'text-warning-700', role: 'status' },
    { tone: 'error', background: 'bg-error-50', chip: 'bg-error-500/15', text: 'text-error-700', role: 'alert' },
  ];

  for (const [index, item] of cases.entries()) {
    const html = renderToStaticMarkup(React.createElement(Toast, {
      item: { id: index, tone: item.tone, message: `${item.tone} message` },
      onDismiss: () => undefined,
    }));
    assert.match(html, new RegExp(item.background));
    assert.match(html, new RegExp(item.chip));
    assert.match(html, new RegExp(item.text));
    assert.match(html, new RegExp(`role="${item.role}"`));
    assert.match(html, /rounded-2xl/);
    assert.ok(html.includes('max-w-[min(92vw,28rem)]'));
    assert.match(html, /<button[^>]*aria-label="ปิดการแจ้งเตือน"/);
  }
});


test('document number tokens stay whole at render time without changing the toast message', async () => {
  const { Toast } = await import('./Toast');
  const message = 'ออกหนังสือรับรองเลขที่ WHT-2026-00001 แล้ว ใบเดิม EX-123 เลขอ้างอิง 12345678901234567890';
  const item = { id: 1, tone: 'success' as const, message };
  const html = renderToStaticMarkup(React.createElement(Toast, { item, onDismiss() {} }));
  assert.match(html, /<span class="whitespace-nowrap">WHT-2026-00001<\/span>/);
  assert.match(html, /<span class="whitespace-nowrap">EX-123<\/span>/);
  assert.match(html, /<span class="whitespace-nowrap">12345678901234567890<\/span>/);
  assert.ok(html.replace(/<[^>]*>/g, '').includes(message)); assert.equal(item.message, message);
});

test('keeps payment document numbers together inside a wrapped message', async () => {
  const { Toast } = await import('./Toast');
  const html = renderToStaticMarkup(React.createElement(Toast, {
    item: { id: 1, tone: 'success', message: 'ยกเลิกรายการจ่ายแล้ว ใบสำคัญจ่ายเลขที่ PV-202610-00029 ถูกยกเลิกด้วย' },
    onDismiss: () => {},
  }));
  assert.match(html, /class="whitespace-nowrap">PV-202610-00029<\/span>/);
  const other = renderToStaticMarkup(React.createElement(Toast, { item: { id: 2, tone: 'success', message: 'ออกหนังสือรับรองเลขที่ WHT-2026-00043 แล้ว ของรายจ่าย EXP-202610-00064 ยอด 4,850.00' }, onDismiss: () => {} }));
  assert.match(other, /class="whitespace-nowrap">WHT-2026-00043<\/span>/); assert.match(other, /class="whitespace-nowrap">EXP-202610-00064<\/span>/);
  assert.doesNotMatch(other, /whitespace-nowrap">4,850/);
});
