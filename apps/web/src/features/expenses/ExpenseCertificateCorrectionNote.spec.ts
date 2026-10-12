import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExpenseCertificateCorrectionNote } from './ExpenseCertificateCorrectionNote';
import { certificateHarness, h } from './expense-certificate-test-harness';
(globalThis as any).React = React;

test('certificate correction note explains exactly which data changes and points back to the expense edit', () => {
  assert.equal(renderToStaticMarkup(React.createElement(ExpenseCertificateCorrectionNote, { onReopen() {} })).replace(/<[^>]*>/g, '').replace(/&quot;/g, '"'),
    'ถ้าส่วนนี้ผิด แก้ไขเอกสาร');
});

test('the edit action is present only for a caller who may reopen and delegates to that same action', () => {
  let opened = 0;
  const view = certificateHarness(() => h(ExpenseCertificateCorrectionNote, { onReopen: () => { opened++; }, busy: false }));
  assert.match(view.render(), />แก้ไขเอกสาร<\/button>/);
  view.find('button').onClick(); assert.equal(opened, 1);
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(ExpenseCertificateCorrectionNote)), /<button/);
});
