import assert from 'node:assert/strict';
import { test } from 'node:test';
import { certificateRowStatus, certificateRowHref, certificateListQuery, certificateListState } from './expense-wht-certificates.logic';
import { WHT_CERTIFICATE_TABS, type WhtCertificateRow } from './expense-wht-certificates.model';
const row = (over: Partial<WhtCertificateRow> = {}) => ({ status: 'REQUIRED', systemIssuanceOpen: true, withheldAmount: '3', missing: [], ...over } as WhtCertificateRow);
test('row destination follows the first missing fact and keeps the shop return filters', () => {
  const destination = (over: Partial<WhtCertificateRow>, permissions: string[] = []) => certificateRowHref('co', row({ expenseId: 'exp', ...over }), permissions, '/companies/co/expenses/wht-certificates?tab=pending&search=test');
  const expense = '/companies/co/expenses/exp?section=';
  for (const payments of [[], [{ paidAtConfirmed: false }], [{}, {}]]) {
    assert.equal(destination({ payments: payments as any, missing: ['FORM_TYPE_UNRESOLVED'], hasPayeeAddress: false, payerMissing: ['ADDRESS'] }), expense + 'payment');
  }
  for (const missing of [['FORM_TYPE_UNRESOLVED'], ['INCOME_CATEGORY_OR_RATE_MISSING']] as const) {
    assert.equal(destination({ missing: [...missing], hasPayeeAddress: false, payerMissing: ['ADDRESS'] }), expense + 'withholding');
  }
  assert.equal(destination({ hasPayeeAddress: false, payerMissing: ['ADDRESS'] }, ['company.legal_identity.manage']), expense + 'certificate');
  assert.equal(destination({ payerMissing: ['ADDRESS'] }), expense + 'certificate');
  const shop = new URL(destination({ payerMissing: ['ADDRESS'] }, ['company.legal_identity.manage']), 'https://local.test');
  assert.equal(shop.pathname, '/companies/co/settings/profile');
  assert.equal(shop.searchParams.get('returnTo'), '/companies/co/expenses/wht-certificates?tab=pending&search=test');
  for (const status of ['REQUIRED', 'SYSTEM_ISSUED', 'EXTERNAL_LINKED', 'CANCELLED'] as const) {
    assert.equal(destination({ status }), expense + 'certificate');
    if (status !== 'REQUIRED') assert.equal(destination({ status, payments: [], missing: ['FORM_TYPE_UNRESOLVED'], payerMissing: ['ADDRESS'] }, ['company.legal_identity.manage']), expense + 'certificate');
  }
  assert.equal(destination({ payments: [{ paidAtConfirmed: true }] as any }), expense + 'certificate');
});
test('four URL tabs map to the four API statuses; malformed and absent URL state uses pending page one', () => {
  assert.deepEqual(WHT_CERTIFICATE_TABS, { pending: 'REQUIRED', system: 'SYSTEM_ISSUED', external: 'EXTERNAL_LINKED', cancelled: 'CANCELLED' });
  for (const tab of Object.keys(WHT_CERTIFICATE_TABS)) assert.equal(certificateListState(new URLSearchParams({ tab })).tab, tab);
  assert.deepEqual(certificateListState(new URLSearchParams()), { tab: 'pending', search: '', page: 1, order: 'newest' });
  for (const page of ['-2', '0', '2.5', 'NaN', 'Infinity']) assert.equal(certificateListState(new URLSearchParams({ tab: 'bad', page })).page, 1);
  assert.deepEqual(certificateListState(new URLSearchParams('tab=external&search=ชื่อ&page=3')), { tab: 'external', search: 'ชื่อ', page: 3, order: 'newest' });
});
test('URL updates preserve other filters, encode searches and remove cleared search/page', () => {
  const current = new URLSearchParams('branchId=b&search=เก่า&page=4');
  const query = certificateListQuery(current, { tab: 'system', search: ' ชื่อ & เลข ', page: 1, order: 'oldest' });
  assert.deepEqual(certificateListState(new URLSearchParams(query)), { tab: 'system', search: 'ชื่อ & เลข', page: 1, order: 'oldest' });
  assert.equal(new URLSearchParams(query).get('branchId'), 'b');
  assert.equal(new URLSearchParams(certificateListQuery(current, { tab: 'pending', search: '', page: 1, order: 'newest' })).has('search'), false);
  assert.equal(current.get('page'), '4');
});


test('one status badge covers every missing reason; a row whose only state is its tab\'s name shows none', () => {
  const reasons = { FORM_TYPE_UNRESOLVED: 'ยังไม่ทราบว่าผู้รับเงินเป็นบุคคลหรือนิติบุคคล', INCOME_CATEGORY_OR_RATE_MISSING: 'ยังไม่มีประเภทเงินได้หรืออัตราภาษี' };
  for (const [status, label] of Object.entries({ REQUIRED: 'ยังไม่ออก', SYSTEM_ISSUED: 'ออกแล้ว', EXTERNAL_LINKED: 'ทำนอกระบบ', CANCELLED: 'ยกเลิกแล้ว' })) {
    for (const [reason, message] of Object.entries(reasons)) assert.equal(certificateRowStatus(row({ status: status as any, missing: [reason as any] })), status === 'REQUIRED' ? message : ''); void label;
  }
  assert.equal(certificateRowStatus(row({ payments: [] })), 'ยังไม่บันทึกจ่าย');
  assert.equal(certificateRowStatus(row({ payments: [{ paidAtConfirmed: false }] as any })), 'ยังไม่ยืนยันวันที่จ่าย');
  assert.equal(certificateRowStatus(row({ payments: [{}, {}] as any })), 'เลือกการจ่ายที่จะออกหนังสือรับรอง');
  assert.equal(certificateRowStatus(row({ hasPayeeAddress: false })), 'ขาดที่อยู่ผู้รับเงิน');
  // Every waiting row says what it lacks, with or without the shop banner; a row lacking nothing is ready.
  assert.equal(certificateRowStatus(row({ payerMissing: ['ADDRESS'] })), 'ขาดข้อมูลร้าน');
  assert.equal(certificateRowStatus(row({ payerMissing: ['ADDRESS'] }), true), 'ขาดข้อมูลร้าน');
  assert.equal(certificateRowStatus(row()), 'พร้อมออก');
});

test('date order defaults to newest, persists oldest and clears newest from the URL', () => {
  for (const value of ['', 'invalid', 'newest']) assert.equal(certificateListState(new URLSearchParams({ order: value })).order, 'newest');
  assert.equal(certificateListState(new URLSearchParams('order=oldest')).order, 'oldest');
  const current = new URLSearchParams('order=oldest&page=3&periodKey=2026-10');
  const next = new URLSearchParams(certificateListQuery(current, { tab: 'pending', search: '', page: 1, order: 'newest' }));
  assert.equal(next.has('order'), false); assert.equal(next.has('page'), false); assert.equal(next.get('periodKey'), '2026-10');
});
