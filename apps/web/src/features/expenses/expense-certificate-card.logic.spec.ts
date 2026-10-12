import assert from 'node:assert/strict';
import { test } from 'node:test';
import { certificateCardAction, selfIssuedCertificateBody, certificateMoneyDisplay } from './expense-certificate-card.logic';

test('one primary action respects each status, missing data, permission and system route', () => {
  const row = { status: 'REQUIRED', systemIssuanceOpen: true, missing: [] } as any;
  const issue = ['wht.certificate.issue'], link = ['wht.external_certificate.link'];
  assert.equal(certificateCardAction(row, issue), 'issue');
  assert.equal(certificateCardAction(row, [...issue, ...link]), 'issue');
  assert.equal(certificateCardAction(row, ['wht.certificate.read']), null);
  assert.equal(certificateCardAction({ ...row, missing: ['FORM_TYPE_UNRESOLVED'] }, issue), null);
  assert.equal(certificateCardAction({ ...row, systemIssuanceOpen: false }, [...issue, ...link]), 'record');
  assert.equal(certificateCardAction({ ...row, missing: ['FORM_TYPE_UNRESOLVED'] }, link), 'record');
  assert.equal(certificateCardAction({ ...row, status: 'SYSTEM_ISSUED' }, issue), 'download');
  assert.equal(certificateCardAction({ ...row, status: 'SYSTEM_ISSUED' }, ['wht.certificate.read']), null);
  for (const status of ['EXTERNAL_LINKED', 'CANCELLED']) assert.equal(certificateCardAction({ ...row, status }, [...issue, ...link]), null);
});

test('self-issued validation requires number and a real date no later than today, reference is optional', () => {
  const values = { number: ' EXT-1 ', date: '2026-10-11', reference: ' ', note: ' หมายเหตุ ' };
  assert.deepEqual(selfIssuedCertificateBody(values, 'command', '2026-10-11'), { commandId: 'command', externalCertificateNumber: 'EXT-1', issuedDate: '2026-10-11', externalEvidenceRef: '', note: 'หมายเหตุ' });
  assert.throws(() => selfIssuedCertificateBody({ ...values, number: ' ' }, 'command', '2026-10-11'), /เลขที่หนังสือรับรอง/);
  assert.throws(() => selfIssuedCertificateBody({ ...values, date: '' }, 'command', '2026-10-11'), /วันที่ออก/);
  assert.throws(() => selfIssuedCertificateBody({ ...values, date: '2026-02-31' }, 'command', '2026-10-11'), /วันที่ออก/);
  assert.throws(() => selfIssuedCertificateBody({ ...values, date: '2026-10-12' }, 'command', '2026-10-11'), /วันที่ออกต้องไม่เกินวันนี้/);
});

test('certificate correction money displays two decimals and grouping without floating-point loss', () => {
  assert.equal(certificateMoneyDisplay('10000.0000'), '10,000.00');
  assert.equal(certificateMoneyDisplay('42.0600'), '42.06');
  assert.equal(certificateMoneyDisplay('9999.9950'), '10,000.00');
  assert.equal(certificateMoneyDisplay('9007199254740993.0000'), '9,007,199,254,740,993.00');
});
