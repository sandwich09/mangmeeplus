import { it } from 'node:test';
import assert from 'node:assert/strict';
import { DBD_TSIC_ACTIVITIES, normalizeCompanyBusinessType, companyBusinessTypeLabel } from './company-business-type.js';

it('contains the full official DBD 5-digit snapshot and validates real codes, OTHER and clearing', () => {
  assert.equal(DBD_TSIC_ACTIVITIES.length, 1098);
  assert.equal(new Set(DBD_TSIC_ACTIVITIES.map((row) => row.code)).size, 1098);
  assert.equal(new Set(DBD_TSIC_ACTIVITIES.map((row) => row.section)).size, 21);
  assert.ok(DBD_TSIC_ACTIVITIES.every((row) => /^\d{5}$/.test(row.code) && row.label.trim()));
  assert.equal(companyBusinessTypeLabel({ code: '56101', other: null }), '56101 — การบริการด้านอาหารในภัตตาคาร/ร้านอาหาร');
  assert.equal(companyBusinessTypeLabel(), 'ยังไม่ระบุ');
  assert.equal(companyBusinessTypeLabel(normalizeCompanyBusinessType('OTHER', ' ธุรกิจทดสอบ ')), 'อื่น ๆ — ธุรกิจทดสอบ');
  assert.deepEqual(normalizeCompanyBusinessType('01111', 'stale'), { code: '01111', other: null });
  assert.deepEqual(normalizeCompanyBusinessType(null, 'stale'), { code: null, other: null });
  assert.equal(normalizeCompanyBusinessType('OTHER', 'ก'.repeat(200)).other?.length, 200);
  assert.throws(() => normalizeCompanyBusinessType('99999', null), /company_business_type_invalid/);
  assert.throws(() => normalizeCompanyBusinessType('OTHER', ' '), /company_business_type_other_required/);
  assert.throws(() => normalizeCompanyBusinessType('OTHER', 'ก'.repeat(201)), /company_business_type_other_invalid/);
});
