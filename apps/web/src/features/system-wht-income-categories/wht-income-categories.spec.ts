import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

(globalThis as typeof globalThis & { React: typeof React }).React = React;
require.extensions['.svg'] = module => { module.exports = () => null; };
const source = (path: string) => existsSync(join(__dirname, path)) ? readFileSync(join(__dirname, path), 'utf8') : '';
const rows = [
  { code: 'WHT_SERVICE_5', nameTh: 'ค่าบริการ (นิติบุคคล)', formType: 'PND53', defaultRate: '3', status: 'ACTIVE' },
  { code: 'WHT_INTEREST', nameTh: 'ดอกเบี้ย', formType: 'PND3', defaultRate: '1', status: 'DRAFT' },
  { code: 'old-code', nameTh: 'หมวดเดิม', formType: 'PND3', defaultRate: '5', status: 'RETIRED' },
];

test('the rendered catalog lists Thai names, forms, rates, statuses and on/off controls without code tokens', () => {
  const { WhtIncomeCategoryList } = require('./WhtIncomeCategoriesPage');
  const markup = renderToStaticMarkup(React.createElement(WhtIncomeCategoryList, { rows, busyCode: null, onToggle: () => {} }));
  for (const words of ['ค่าบริการ (นิติบุคคล)', 'ดอกเบี้ย', 'ภ.ง.ด.53', 'ภ.ง.ด.3', '3%', '1%', 'เปิดใช้งาน', 'ยังไม่เปิดใช้งาน', 'เลิกใช้งาน', 'ปิดใช้', 'เปิดใช้']) assert.ok(markup.includes(words), words);
  assert.equal((markup.match(/role="switch"/g) ?? []).length, 3);
  assert.match(markup, /aria-checked="true"/);
  assert.match(markup, /aria-checked="false"/);
  assert.doesNotMatch(markup, /WHT_|PND|ACTIVE|DRAFT|RETIRED|<input|<select/);
  // While one kind is being saved nothing else can be switched, but only that kind looks busy.
  const locked = renderToStaticMarkup(React.createElement(WhtIncomeCategoryList, { rows, busyCode: 'WHT_INTEREST', onToggle: () => {} }));
  assert.equal((locked.match(/disabled=""/g) ?? []).length, 3);
  assert.equal((locked.match(/aria-busy="true"/g) ?? []).length, 1);
  assert.match(locked, /aria-busy="true"[^>]*aria-label="เปิดใช้ ดอกเบี้ย"|aria-label="เปิดใช้ ดอกเบี้ย"[^>]*aria-busy="true"/);
});

test('a phone reads and switches every kind without sideways scrolling, and the result is said on the row', () => {
  const { WhtIncomeCategoryList } = require('./WhtIncomeCategoriesPage');
  const markup = renderToStaticMarkup(React.createElement(WhtIncomeCategoryList, { rows, busyCode: null, savedCode: 'WHT_INTEREST', onToggle: () => {} }));
  assert.doesNotMatch(markup, /<table|overflow-x-auto/, 'no wide table to scroll inside');
  assert.equal((markup.match(/role="switch"[^>]*class="[^"]*whitespace-nowrap/g) ?? markup.match(/class="[^"]*whitespace-nowrap[^"]*"[^>]*role="switch"/g) ?? []).length, 3, 'the switch label never breaks mid-word');
  assert.match(markup, /grid-cols-\[minmax\(0,1fr\)_auto\]/, 'name and facts on the left, the switch beside them');
  assert.match(markup, /<span class="sm:hidden">อัตราเริ่มต้น <\/span>/, 'without column headings the rate still says what it is');
  assert.equal((markup.match(/role="status"[^>]*>บันทึกแล้ว</g) ?? []).length, 1);
  assert.match(markup, /ยังไม่เปิดใช้งาน<span role="status"[^>]*>บันทึกแล้ว</, 'on the kind that was just switched');
  const page = source('WhtIncomeCategoriesPage.tsx');
  assert.ok(page.indexOf('await confirm(') < page.indexOf('setBusyCode(row.code)'), 'reading the confirmation makes nothing busy');
  assert.match(page, /setSavedCode\(saved\.code\)/);
});

test('confirmation states the category-specific effect on every later certificate and preserves existing documents', () => {
  const { confirmation, W } = require('./wht-income-categories.words');
  for (const row of rows) {
    const on = confirmation(row, true);
    assert.ok(on.includes(row.nameTh));
    assert.ok(on.includes(`${row.defaultRate}%`));
    assert.match(on, /ทุกใบ.*ประเภทเงินได้นี้.*หลังจากนี้/);
    assert.match(on, /เอกสารที่ออกแล้วไม่เปลี่ยน/);
    assert.doesNotMatch(on, /[A-Za-z]|ทุกใบใช้.*อัตรานี้$/);
    assert.match(confirmation(row, false), /เลือกประเภทเงินได้นี้สำหรับรายการใหม่ไม่ได้/);
  }
  for (const words of Object.values(W).flatMap(value => typeof value === 'object' ? Object.values(value as object) : [value])) {
    assert.doesNotMatch(String(words), /[A-Za-z]/);
  }
});

test('navigation and direct visits require the dedicated platform permission', () => {
  assert.match(source('../../../app/system/wht-income-categories/page.tsx'), /permissions.includes\('system.wht_income_category.manage'\)/);
  assert.match(source('../../../app/system/wht-income-categories/page.tsx'), /ForbiddenState/);
  assert.match(source('../../../app/system/wht-income-categories/page.tsx'), /helpText=\{W.accessHelp\}/);
  assert.match(source('WhtIncomeCategoriesPage.tsx'), /<ForbiddenState helpText=\{W.accessHelp\}/);
  assert.match(source('../../../app/system/layout.tsx'), /whtCategoriesAllowed=\{result.session.permissions.includes\('system.wht_income_category.manage'\)\}/);
  assert.match(source('../../common/components/app-shell/SystemHeader.tsx'), /section.href !== '\/system\/wht-income-categories' \|\| whtCategoriesAllowed/);
  assert.match(source('../../common/components/app-shell/SystemHeader.tsx'), /href: '\/system\/wht-income-categories', label: WHT_CATALOG_WORDS.title, group: 'ตั้งค่าระบบ'/);
});

test('the page confirms before saving and handles loading, empty, denied and error states with retry', () => {
  const page = source('WhtIncomeCategoriesPage.tsx');
  for (const token of ['LoadingState', 'ForbiddenState', 'ErrorState', 'AbortController', 'signal.aborted', 'rows.length === 0', 'onRetry', 'confirmDialog']) assert.ok(page.includes(token), token);
  assert.ok(page.indexOf('await confirm(') < page.indexOf('await setWhtIncomeCategoryStatus('));
  assert.match(page, /confirmation\(row, enable\)/);
  assert.match(page, /setRows\(current => current\?\.map/);
  assert.match(page, /setError\(W.saveFailed\)/);
  assert.match(page, /status === 403/);
});

test('the browser API uses platform routes, an encoded code, a status-only patch, no shop header and no caching', async () => {
  const api = require('./wht-income-categories.api');
  const original = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ data: init?.method === 'PATCH' ? rows[0] : rows }), { status: 200 });
  };
  try {
    await api.listWhtIncomeCategories();
    await api.setWhtIncomeCategoryStatus('a/b', 'ACTIVE');
    assert.deepEqual(calls.map(call => call.url), ['/api/v1/system/wht-income-categories', '/api/v1/system/wht-income-categories/a%2Fb']);
    assert.equal(calls[1].init?.method, 'PATCH');
    assert.deepEqual(JSON.parse(String(calls[1].init?.body)), { status: 'ACTIVE' });
    for (const call of calls) { assert.equal(call.init?.cache, 'no-store'); assert.ok(!JSON.stringify(call.init?.headers).includes('X-Company-Id')); }
  } finally { globalThis.fetch = original; }
});

test('the shop tax catalog remains readable and offers no global status mutation or raw codes', () => {
  const page = source('../tax/TaxWorkspacePage.tsx');
  const panel = page.slice(page.indexOf('function WhtIncomeCategoryPanel'));
  assert.match(panel, /listWhtCategories\(companyId\)/);
  assert.doesNotMatch(page, /setWhtCategoryStatus|canManage=\{can\('tax.config.manage'\)\}/);
  assert.doesNotMatch(panel, /function toggle|row.code\}<\/small>|<button/);
  for (const token of ['WHT_CATALOG_WORDS.noActive', 'formLabel(row.formType)', 'statusLabel(row.status)']) assert.ok(panel.includes(token), token);
  assert.doesNotMatch(source('../tax/tax.api.ts'), /export function setWhtCategoryStatus/);
});

test('AP and the read-only shop catalog share the same truthful empty-category guidance', () => {
  assert.match(source('../accounts-payable/AccountsPayablePages.tsx'), /\{WHT_CATALOG_WORDS.noActive\}/);
  const { W } = require('./wht-income-categories.words');
  assert.match(W.noActive, /ติดต่อทีมมั่งมี/);
  assert.doesNotMatch(W.noActive, /ผู้ทำบัญชี|นักบัญชี.*เปิด/);
});

test('existing withholding browser setup reads the opened baseline and never flips the global catalog as a shop', () => {
  for (const file of ['wht-settlement.spec.ts', 'feature-entitlement-accessibility.spec.ts']) {
    const code = source(`../../../../../e2e/${file}`);
    assert.ok(code.length > 0);
    assert.doesNotMatch(code, /api.patch\(`companies\/\$\{companyId\}\/tax\/wht-categories/);
    assert.match(code, /status\)\.toBe\('ACTIVE'\)/);
  }
});

test('shop catalog loading and failed reads never claim that the catalog is empty', () => {
  const ap = source('../accounts-payable/AccountsPayablePages.tsx');
  assert.ok(ap.includes("useState<'loading' | 'loaded' | 'failed'>('loading')"));
  assert.match(ap, /setWhtCatalogState\('loaded'\)/);
  assert.match(ap, /setWhtCatalogState\('failed'\)/);
  assert.match(ap, /whtCatalogState === 'loading'[\s\S]{0,150}WHT_CATALOG_WORDS.loading/);
  assert.match(ap, /whtCatalogState === 'failed'[\s\S]{0,150}WHT_CATALOG_WORDS.loadFailed/);
  const tax = source('../tax/TaxWorkspacePage.tsx').slice(source('../tax/TaxWorkspacePage.tsx').indexOf('function WhtIncomeCategoryPanel'));
  assert.match(tax, /if \(rows === null\) return <LoadingState label=\{WHT_CATALOG_WORDS.loading\}/);
  assert.match(tax, /if \(error\) return <ErrorState description=\{error\} onRetry=\{load\}/);
});
