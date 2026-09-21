import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { counterpartyFormValues } from './counterparties.logic';
import type { CounterpartyFormIssue, CounterpartyFormValues } from './counterparties.model';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const base = counterpartyFormValues(null);

async function renderIdentity(values: Partial<CounterpartyFormValues>, options: {
  issue?: CounterpartyFormIssue;
  allowUnspecifiedEntityKind?: boolean;
} = {}): Promise<string> {
  const { CounterpartyIdentityFields } = await import('./CounterpartyFields');
  return renderToStaticMarkup(React.createElement(CounterpartyIdentityFields, {
    values: { ...base, ...values },
    onChange: () => undefined,
    disabled: false,
    issue: options.issue ?? null,
    allowUnspecifiedEntityKind: options.allowUnspecifiedEntityKind ?? false,
  }));
}

test('A5: the identity block offers no customer/vendor/both picker at all', async () => {
  const html = await renderIdentity({ displayName: 'ร้านตัวอย่าง' });
  assert.doesNotMatch(html, /ลูกค้า\/คู่ค้า|CUSTOMER|VENDOR|BOTH/);
  // The taxpayer class is a themed combobox, never a native select (theme contract).
  assert.doesNotMatch(html, /<select/);
  assert.match(html, /role="combobox"/);
  assert.match(html, /ภ\.ง\.ด\.53/);
});

test('the taxpayer class stays blank-able only while the registry holds none (CON-7)', async () => {
  assert.match(await renderIdentity({}, { allowUnspecifiedEntityKind: true }), /ยังไม่ระบุ/);
  assert.doesNotMatch(await renderIdentity({ entityKind: 'JURISTIC' }), /ยังไม่ระบุ/);
});

test('A6/CON-8: the branch code box is optional and appears only for สาขา', async () => {
  const headOffice = await renderIdentity({});
  assert.match(headOffice, /aria-pressed="true"[^>]*>สำนักงานใหญ่/);
  assert.doesNotMatch(headOffice, /placeholder="00001"/);
  assert.match(headOffice, /ไม่บังคับ/);

  const branch = await renderIdentity({ isBranch: true, branchCode: '00001' });
  assert.match(branch, /placeholder="00001"/);
});

test('§8: a refused field says what to do, in an alert the reader is pointed at', async () => {
  const html = await renderIdentity(
    { isBranch: true, branchCode: '0001' },
    { issue: { field: 'branchCode', messageKey: 'counterparties.v_branch_code_invalid' } },
  );
  assert.match(html, /role="alert"/);
  assert.match(html, /ตัวเลข 5 หลัก/);
  assert.match(html, /aria-invalid="true"/);
});

test('the address block has no Revenue Department button while the adapter does not exist (§7)', async () => {
  const { CounterpartyAddressFields } = await import('./CounterpartyFields');
  const html = renderToStaticMarkup(React.createElement(CounterpartyAddressFields, {
    values: base,
    onChange: () => undefined,
    disabled: false,
    issue: null,
  }));
  assert.doesNotMatch(html, /กรมสรรพากร/);
  assert.match(html, /ที่อยู่ตามเอกสาร/);
  assert.match(html, /รหัสไปรษณีย์/);
});
