import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SNAPSHOT_GENERATE_PERMISSION, canForceGenerateSnapshot, homeMetrics, homeStartLinks } from './dashboard-home.logic';
import { dashboardMetricValueText } from './dashboard-notifications.logic';

describe('canForceGenerateSnapshot', () => {
  it('is true when the viewer holds the generate permission', () => {
    assert.equal(canForceGenerateSnapshot(['dashboard.read', SNAPSHOT_GENERATE_PERMISSION]), true);
  });

  it('is false for a dashboard.read-only viewer', () => {
    assert.equal(canForceGenerateSnapshot(['dashboard.read']), false);
  });

  it('is false for an empty permission list', () => {
    assert.equal(canForceGenerateSnapshot([]), false);
  });

  it('exposes the exact API permission key', () => {
    assert.equal(SNAPSHOT_GENERATE_PERMISSION, 'dashboard.snapshot.generate');
  });
});

describe('dashboard period labels', () => {
  it('labels the Monday-Sunday snapshot period as this week, not trailing seven days', () => {
    const source = readFileSync(new URL('./DashboardPages.tsx', import.meta.url), 'utf8');
    const tabs = source.slice(source.indexOf('const PERIOD_TABS'), source.indexOf('const PERIOD_LABEL_KEY'));
    assert.match(tabs, /kind: 'week', labelKey: 'dashboard\.period\.week'/);
    assert.doesNotMatch(tabs, /dashboard\.period\.last7/);
  });

  it('clears stale scope data and ignores outdated load and refresh results', () => {
    const source = readFileSync(new URL('./DashboardPages.tsx', import.meta.url), 'utf8');
    const requests = source.slice(source.indexOf('const load ='), source.indexOf('const availableWidgets'));
    // A new shop or branch clears the numbers before its read; a new period of the same scope keeps the card (owner's home, 2026-10-14).
    assert.match(requests, /if \(scopeRef\.current !== scope\) \{ scopeRef\.current = scope; setSnapshot\(null\); \}/);
    assert.match(requests, /catch \(e\) \{\s*if \(requestId !== snapshotRequestRef\.current\) return;\s*setSnapshot\(null\);/);
    assert.equal(requests.match(/const requestId = \+\+snapshotRequestRef\.current/g)?.length, 2);
    assert.equal(requests.match(/if \(requestId !== snapshotRequestRef\.current\) return;\s*setSnapshot\(data\)/g)?.length, 2);
    assert.equal(requests.match(/catch \(e\) \{\s*if \(requestId !== snapshotRequestRef\.current\) return;/g)?.length, 2);
    assert.match(requests, /return \(\) => \{ snapshotRequestRef\.current \+= 1; \}/);
  });
});

// 2026-10-13 (thai-ux-standard §3.1, §3.5): the home page starts with what the person can do, names its numbers shortly,
// and never tells an employee "no data".
describe('home page', () => {
  it('offers only what the person may start, the commonest last (drawn as the main button)', () => {
    assert.deepEqual(homeStartLinks('co', ['reimbursement.create', 'expense.receipt.upload']).map((link) => [link.label, link.href]), [
      ['สร้างใบเบิก', '/companies/co/reimbursements/new'],
      ['อัปโหลดใบเสร็จ', '/companies/co/expenses/upload'],
    ]);
    assert.deepEqual(homeStartLinks('co', ['reimbursement.create']).map((link) => link.key), ['claim']);
    assert.deepEqual(homeStartLinks('co', ['dashboard.read']), []);
  });

  it('puts what waits first, names the three expense numbers itself and marks the one the period changes', () => {
    const metrics = [
      { key: 'expense_total_in_period', label: 'ค่าใช้จ่ายที่ยืนยันแล้ว' },
      { key: 'something_else', label: 'ป้ายจากระบบ' },
      { key: 'expense_pending_review', label: 'ใบเสร็จรอตรวจ (ทุกช่วงเวลา)' },
      { key: 'expense_unpaid_outstanding', label: 'ค้างจ่ายที่ยืนยันแล้ว (ทุกช่วงเวลา)' },
    ];
    assert.deepEqual(homeMetrics(metrics).map((metric) => [metric.homeLabel, metric.periodScoped]), [
      ['รอตรวจ', false], ['ค้างจ่าย', false], ['ยืนยันแล้ว', true], ['ป้ายจากระบบ', false],
    ]);
  });

  it('writes money as ฿ with two decimals and leaves counts alone', () => {
    assert.equal(dashboardMetricValueText({ key: 'expense_total_in_period', label: '', value: 44750.5, unit: 'บาท', freshness: 'fresh' }), '฿44,750.50');
    assert.equal(dashboardMetricValueText({ key: 'expense_unpaid_outstanding', label: '', value: 200808, unit: 'บาท', freshness: 'fresh' }), '฿200,808.00');
    assert.equal(dashboardMetricValueText({ key: 'expense_pending_review', label: '', value: 6, unit: 'รายการ', freshness: 'fresh' }), '6 รายการ');
  });

  it('shows a failed read with its retry and without the empty sentence, and has no crumb or branch label of its own', () => {
    const source = readFileSync(new URL('./DashboardPages.tsx', import.meta.url), 'utf8');
    assert.match(source, /\{error && \(\s*<Notice tone="error" action=\{<button[^>]*onClick=\{\(\) => void load\(periodKind\)\}/);
    assert.doesNotMatch(source, /dashboard\.home\.no_data|dashboard\.home\.business_overview|shell\.workspace|useBranchScopeLabel/);
  });
});
