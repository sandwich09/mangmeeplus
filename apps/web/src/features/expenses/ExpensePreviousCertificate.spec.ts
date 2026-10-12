import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { formatThaiDate } from '@/common/i18n/thai-date';
import { ExpensePreviousCertificate } from './ExpensePreviousCertificate';
(globalThis as any).React = React;

test('previous certificates use the right kind, Thai cancellation date and whole number; absent numbers are omitted', () => {
  for (const kind of ['SYSTEM', 'EXTERNAL'] as const) for (const number of ['WHT-2026-00001', null]) {
    const previous = { kind, number, cancelledAt: '2026-10-10T03:00:00Z' };
    const html = renderToStaticMarkup(React.createElement(ExpensePreviousCertificate, { previous }));
    const label = kind === 'SYSTEM' ? 'ใบเดิม' : 'การบันทึกเดิม';
    assert.equal(html.replace(/<[^>]*>/g, ''), `${label}${number ? `เลขที่ ${number}` : ''} ถูกยกเลิกเมื่อ ${formatThaiDate(previous.cancelledAt)}`);
    if (number) assert.ok(html.includes(`<span class="whitespace-nowrap">${number}</span>`));
  }
});
