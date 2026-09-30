import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('./ExpensesWorkspacePanels.tsx', import.meta.url), 'utf8');

test('evidence export and totals use all filtered rows, not just the current page or unfiltered dataset', () => {
  assert.match(source, /expenseIds: visibleRows\.map\(\(row\) => row\.expenseId\)/);
  assert.match(source, /const total = visibleRows\.reduce\(/);
  assert.match(source, /รายการที่ส่งออก: \{visibleRows\.length\}/);
});

test('changing any export filter clears old package results and ignores late export responses', () => {
  assert.match(source, /exportScopeVersion\.current \+= 1/);
  assert.match(source, /scopeVersion !== exportScopeVersion\.current/);
  assert.match(source, /\[branchId, dateField, yearMonth, documentStatus, taxEvidenceStatus, sourceDocumentType, postingStatus, flagFilter\]/);
  assert.match(source, /สร้างเมื่อ \{formatThaiDateTime\(packageResult\.generatedAt\)\}/);
});

test('the expense category table scrolls sideways on a phone instead of squeezing Thai names (Owner, 2026-09-30)', () => {
  // It has no phone card view, so it sits in the shared scroller like the other migrated tables.
  assert.match(source, /<div className="mangmee-table-scroll">\s*<table className="mangmee-table">\s*<thead><tr>\{\['ชื่อหมวดหมู่'/u);
});
