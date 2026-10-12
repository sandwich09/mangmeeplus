import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
(globalThis as any).React = React;
const { WhtPayerIdentityNotice } = require('./WhtPayerIdentityNotice');

test('payer warning names exactly the missing fields and offers the profile only to an identity manager', () => {
  for (const missing of [['TAX_ID'], ['ADDRESS'], ['TAX_ID', 'ADDRESS']] as const) for (const allowed of [false, true]) {
    const html = renderToStaticMarkup(React.createElement(WhtPayerIdentityNotice, { companyId: 'co', missing, permissions: allowed ? ['company.legal_identity.manage'] : [], primary: true }));
    assert.ok(html.includes('ข้อมูลร้านยังขาด:'));
    assert.equal(html.includes('เลขผู้เสียภาษี'), missing.includes('TAX_ID' as never));
    assert.equal(html.includes('ที่อยู่'), missing.includes('ADDRESS' as never));
    assert.equal(html.includes('href="/companies/co/settings/profile"'), allowed);
    assert.equal(html.includes('ไปกรอกข้อมูลร้าน'), allowed); assert.equal(html.includes('เจ้าของกิจการ'), !allowed);
  }
});

test('the profile link carries the expense and card anchor without losing the shop words', () => {
  const returnTo = '/companies/co/expenses/expense-1#wht-certificate';
  const html = renderToStaticMarkup(React.createElement(WhtPayerIdentityNotice, { companyId: 'co', missing: ['TAX_ID', 'ADDRESS'], permissions: ['company.legal_identity.manage'], primary: true, returnTo }));
  assert.ok(html.includes(`href="/companies/co/settings/profile?${new URLSearchParams({ returnTo })}"`));
  assert.ok(html.includes('ข้อมูลร้านยังขาด: เลขผู้เสียภาษีและที่อยู่ของร้าน'));
  assert.ok(html.includes('ไปกรอกข้อมูลร้าน'));
});
