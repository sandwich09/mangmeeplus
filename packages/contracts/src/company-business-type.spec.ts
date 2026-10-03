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

it('gives every DBD business type one report industry group, and none to OTHER or an unknown code', async () => {
  const { REPORT_INDUSTRY_GROUPS, REPORT_INDUSTRY_GROUP_VERSION, REPORT_INDUSTRY_MAPPED_BUSINESS_TYPE_CODES, isReportClassification,
    isReportIndustryGroup, reportIndustryGroupOf, reportIndustryGroupOfBusinessType } = await import('./report-labels.js');
  assert.equal(REPORT_INDUSTRY_GROUP_VERSION, 1);
  // Version 1 files all 21 sections, each in exactly one group.
  const sections = REPORT_INDUSTRY_GROUPS.flatMap((group) => [...group.sections]);
  assert.equal(sections.length, 21);
  assert.deepEqual([...new Set(sections)].sort(), [...new Set(DBD_TSIC_ACTIVITIES.map((row) => row.section))].sort());
  assert.equal(new Set(REPORT_INDUSTRY_GROUPS.map((group) => group.key)).size, REPORT_INDUSTRY_GROUPS.length);
  assert.equal(REPORT_INDUSTRY_MAPPED_BUSINESS_TYPE_CODES.length, 1098);
  assert.ok(DBD_TSIC_ACTIVITIES.every((row) => isReportIndustryGroup(reportIndustryGroupOfBusinessType(row.code))));
  assert.equal(reportIndustryGroupOfBusinessType('56101'), 'FOOD_ACCOMMODATION');
  assert.equal(reportIndustryGroupOfBusinessType('01111'), 'AGRICULTURE');
  for (const none of [null, undefined, '', 'OTHER', '99999']) assert.equal(reportIndustryGroupOfBusinessType(none), null);
  // The admin's label wins over the shop's own business type; a value that is no group is not a label.
  assert.deepEqual(reportIndustryGroupOf({ reportIndustryGroup: 'FINANCE', businessTypeCode: '56101' }), { group: 'FINANCE', source: 'ADMIN' });
  assert.deepEqual(reportIndustryGroupOf({ reportIndustryGroup: null, businessTypeCode: '56101' }), { group: 'FOOD_ACCOMMODATION', source: 'MAPPING' });
  assert.deepEqual(reportIndustryGroupOf({ reportIndustryGroup: 'NOT_A_GROUP', businessTypeCode: '56101' }), { group: 'FOOD_ACCOMMODATION', source: 'MAPPING' });
  assert.equal(reportIndustryGroupOf({ reportIndustryGroup: null, businessTypeCode: 'OTHER' }), null);
  assert.equal(reportIndustryGroupOf({}), null);
  assert.deepEqual(['CUSTOMER', 'TEST', 'INTERNAL', 'UNCLASSIFIED', null].map(isReportClassification), [true, true, true, false, false]);
});
