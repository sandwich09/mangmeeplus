import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ToastTone } from './toast.model';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test('renders pastel tone classes and the toast accessibility contract', async () => {
  const { Toast } = await import('./Toast');
  const cases: Array<{ tone: ToastTone; background: string; text: string; role: 'status' | 'alert' }> = [
    { tone: 'success', background: 'bg-success-50', text: 'text-success-700', role: 'status' },
    { tone: 'warning', background: 'bg-warning-50', text: 'text-warning-700', role: 'status' },
    { tone: 'error', background: 'bg-error-50', text: 'text-error-700', role: 'alert' },
  ];

  for (const [index, item] of cases.entries()) {
    const html = renderToStaticMarkup(React.createElement(Toast, {
      item: { id: index, tone: item.tone, message: `${item.tone} message` },
      onDismiss: () => undefined,
    }));
    assert.match(html, new RegExp(item.background));
    assert.match(html, new RegExp(item.text));
    assert.match(html, new RegExp(`role="${item.role}"`));
    assert.match(html, /<button[^>]*aria-label="ปิดการแจ้งเตือน"/);
  }
});
