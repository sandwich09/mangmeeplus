import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const summaryWith = (currency: unknown) => ({
  status: 'OCR_EXTRACTED_NEEDS_REVIEW',
  recognizedFields: { grandTotalAmount: '200.00', currency },
});

async function render(summary: Record<string, unknown> | null): Promise<string> {
  const { ForeignCurrencyNotice } = await import('./ForeignCurrencyNotice');
  return renderToStaticMarkup(React.createElement(ForeignCurrencyNotice, { summary }));
}

test('a foreign-currency document warns with its own code, and never offers a converted amount', async () => {
  const html = await render(summaryWith('USD'));
  assert.match(html, /เอกสารนี้เป็นสกุลเงิน USD/);
  assert.match(html, /ยอดที่อ่านได้อาจไม่ใช่จำนวนเงินบาท/);
  assert.match(html, /กรุณาตรวจและแก้ยอดเป็นเงินบาทก่อนบันทึก/);
  assert.match(html, /role="alert"/);
  // Warning only: the reviewer edits the amount and proceeds. No FX rate is applied or suggested.
  assert.doesNotMatch(html, /อัตราแลกเปลี่ยน|แปลงค่า|\+/);
  assert.match(await render(summaryWith('eur')), /เอกสารนี้เป็นสกุลเงิน EUR/, 'the code is normalized');
});

test('a baht document and an unread currency render nothing at all', async () => {
  for (const summary of [
    summaryWith('THB'),
    summaryWith('thb'),
    summaryWith(undefined),
    summaryWith(null),
    summaryWith(''),
    summaryWith('UNKNOWN'),
    summaryWith('$'),
    summaryWith(200),
    { status: 'OCR_EXTRACTED_NEEDS_REVIEW' },
    { recognizedFields: ['vendorName'] },
    null,
  ]) {
    assert.equal(await render(summary), '', JSON.stringify(summary));
  }
});

test('the review page renders the notice in the shared notices block, above the fold', () => {
  const page = readFileSync(new URL('./ExpenseReviewPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /<ForeignCurrencyNotice summary=\{aiMap\} \/>/);
  // Warning, not a gate: the import and that one line are the page's ONLY currency touchpoints, so
  // no confirm/blocker path (owned elsewhere) can start refusing on a foreign document.
  assert.deepEqual(new Set(page.match(/\w*[Cc]urrency\w*/g)), new Set(['ForeignCurrencyNotice']));
});
