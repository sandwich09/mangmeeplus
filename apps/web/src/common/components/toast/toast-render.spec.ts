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
