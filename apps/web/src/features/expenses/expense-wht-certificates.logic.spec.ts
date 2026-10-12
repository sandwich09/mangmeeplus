import assert from 'node:assert/strict';
import { test } from 'node:test';
import { certificatePrimaryAction, certificateListQuery, certificateListState } from './expense-wht-certificates.logic';
import { WHT_CERTIFICATE_TABS, type WhtCertificateRow } from './expense-wht-certificates.model';
const row = (over: Partial<WhtCertificateRow> = {}) => ({ status: 'REQUIRED', systemIssuanceOpen: true, withheldAmount: '3', missing: [], ...over } as WhtCertificateRow);
test('one primary action follows certificate state, missing facts, route readiness and issue permission', () => {
  assert.equal(certificatePrimaryAction(row(), ['wht.certificate.issue']), 'issue');
  assert.equal(certificatePrimaryAction(row(), []), 'open');
  assert.equal(certificatePrimaryAction(row({ systemIssuanceOpen: false }), ['wht.certificate.issue']), 'open');
  for (const missing of [['FORM_TYPE_UNRESOLVED'], ['INCOME_CATEGORY_OR_RATE_MISSING']] as const)
    assert.equal(certificatePrimaryAction(row({ missing: [...missing] }), ['wht.certificate.issue']), 'edit');
  assert.equal(certificatePrimaryAction(row({ status: 'SYSTEM_ISSUED' }), ['wht.certificate.issue']), 'download');
  for (const status of ['EXTERNAL_LINKED', 'CANCELLED'] as const) assert.equal(certificatePrimaryAction(row({ status }), ['wht.certificate.issue']), 'open');
});
test('four URL tabs map to the four API statuses; malformed and absent URL state uses pending page one', () => {
  assert.deepEqual(WHT_CERTIFICATE_TABS, { pending: 'REQUIRED', system: 'SYSTEM_ISSUED', external: 'EXTERNAL_LINKED', cancelled: 'CANCELLED' });
  for (const tab of Object.keys(WHT_CERTIFICATE_TABS)) assert.equal(certificateListState(new URLSearchParams({ tab })).tab, tab);
  assert.deepEqual(certificateListState(new URLSearchParams()), { tab: 'pending', search: '', page: 1 });
  for (const page of ['-2', '0', '2.5', 'NaN', 'Infinity']) assert.equal(certificateListState(new URLSearchParams({ tab: 'bad', page })).page, 1);
  assert.deepEqual(certificateListState(new URLSearchParams('tab=external&search=ชื่อ&page=3')), { tab: 'external', search: 'ชื่อ', page: 3 });
});
test('URL updates preserve other filters, encode searches and remove cleared search/page', () => {
  const current = new URLSearchParams('branchId=b&search=เก่า&page=4');
  const query = certificateListQuery(current, { tab: 'system', search: ' ชื่อ & เลข ', page: 1 });
  assert.deepEqual(certificateListState(new URLSearchParams(query)), { tab: 'system', search: 'ชื่อ & เลข', page: 1 });
  assert.equal(new URLSearchParams(query).get('branchId'), 'b');
  assert.equal(new URLSearchParams(certificateListQuery(current, { tab: 'pending', search: '', page: 1 })).has('search'), false);
  assert.equal(current.get('page'), '4');
});
