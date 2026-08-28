import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('./IndividualPermissionsPrototypePage.tsx', import.meta.url), 'utf8');

test('employee detail empty state distinguishes company-empty from filter-empty', () => {
  assert.match(source, /employees\.length === 0 \? 'ยังไม่มีพนักงานในบริษัทนี้' : 'ไม่พบพนักงานที่ตรงกับตัวกรอง กรุณาปรับตัวกรองหรือคำค้นหา'/);
});
