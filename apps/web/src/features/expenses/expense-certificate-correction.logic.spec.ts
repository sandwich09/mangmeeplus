import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WhtCertificateHandoffDto } from '@watchdog-bms/contracts';
import { expenseCertificateCorrectionValues, expenseCertificateCorrectionChanges } from './expense-certificate-correction.logic';

const handoff = {
  prefill: { formType: 'PND53', incomeCategoryCode: '01', incomeCategoryName: 'ค่าบริการ', whtRate: '3', grossAmount: '1402.00', withheldAmount: '42.06', paymentDate: '2026-10-11T08:30:00Z',
    payerSnapshot: { companyName: 'ร้านทดสอบ', taxId: null, address: null, branchCode: null },
    payeeSnapshot: { name: 'ชื่อเดิม', taxId: '1234567890123', address: 'ที่อยู่เดิม', branchCode: '00000' } },
  currentCertificate: { number: 'WHT-2', issuedAt: '2026-10-11T09:00:00Z', formType: 'PND3', incomeCategoryCode: '02', incomeCategoryName: 'ชื่อประเภทที่แก้แล้ว',
    whtRate: '5.00', grossAmount: '1500', withheldAmount: '75.00', paymentDate: '2026-10-10T08:30:00Z',
    payee: { name: 'ชื่อที่แก้แล้ว', taxId: '9999999999999', address: 'ที่อยู่ที่แก้แล้ว', branchCode: '00001' } },
} satisfies Pick<WhtCertificateHandoffDto, 'prefill' | 'currentCertificate'>;

test('current certificate supplies every opened field; null falls back to the existing prefill', () => {
  const current = expenseCertificateCorrectionValues(handoff);
  assert.deepEqual(current, { formType: 'PND3', incomeCategoryCode: '02', incomeCategoryName: 'ชื่อประเภทที่แก้แล้ว', whtRate: '5.00', grossAmount: '1500', withheldAmount: '75.00', paymentDate: '2026-10-10',
    payeeName: 'ชื่อที่แก้แล้ว', payeeTaxId: '9999999999999', payeeAddress: 'ที่อยู่ที่แก้แล้ว', payeeBranchCode: '00001' });
  const fallback = expenseCertificateCorrectionValues({ ...handoff, currentCertificate: null });
  assert.equal(fallback.payeeName, 'ชื่อเดิม'); assert.equal(fallback.formType, 'PND53'); assert.equal(fallback.paymentDate, '2026-10-11');
  assert.equal(fallback.grossAmount, '1402.00');
});

test('only the allowed payee fields and payment date are sent; locked fields are ignored', () => {
  const opened = expenseCertificateCorrectionValues(handoff);
  for (const field of ['formType', 'incomeCategoryCode', 'incomeCategoryName', 'whtRate', 'grossAmount', 'withheldAmount', 'payeeTaxId'] as const) {
    assert.deepEqual(expenseCertificateCorrectionChanges({ ...opened, [field]: 'ใหม่' }, opened), {});
  }
  for (const [field, key] of [['payeeName', 'name'], ['payeeAddress', 'address'], ['payeeBranchCode', 'branchCode']] as const) {
    assert.deepEqual(expenseCertificateCorrectionChanges({ ...opened, [field]: 'ใหม่' }, opened), { payeeSnapshot: { [key]: 'ใหม่' } });
  }
  assert.deepEqual(expenseCertificateCorrectionChanges({ ...opened, paymentDate: '2026-10-12' }, opened), { paymentDate: '2026-10-12T00:00:00.000Z' });
});

test('unchanged values send nothing and explicit clearing is preserved', () => {
  const opened = expenseCertificateCorrectionValues(handoff);
  assert.deepEqual(expenseCertificateCorrectionChanges(opened, opened), {});
  assert.deepEqual(expenseCertificateCorrectionChanges(opened, null), {});
  assert.deepEqual(expenseCertificateCorrectionChanges({ ...opened, payeeAddress: '' }, opened), { payeeSnapshot: { address: '' } });
  assert.deepEqual(expenseCertificateCorrectionChanges({ ...opened, paymentDate: '' }, opened), { paymentDate: '' });
});
