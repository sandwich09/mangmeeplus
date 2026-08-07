import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ChartOfAccountSummary, ChartTemplatePreviewResult } from '@watchdog-bms/contracts';
import {
  chartApplyBlocker,
  filterChartAccounts,
  requestIdFromError,
} from './chart-master.logic.js';

function account(index: number): ChartOfAccountSummary {
  return {
    id: `account-${index}`,
    companyId: 'company-1',
    code: `${String(index).padStart(4, '0')}-00`,
    nameTh: `บัญชี ${index}`,
    nameEn: index === 5 ? 'Petty Cash' : null,
    accountClass: index % 2 === 0 ? 'ASSET' : 'EXPENSE',
    reportGroup: index === 7 ? 'Service expenses' : null,
    normalBalance: 'DEBIT',
    parentAccountId: null,
    isPosting: true,
    isSystem: false,
    isControlled: false,
    taxCategory: null,
    cashFlowCategory: null,
    sourceGroup1: null,
    sourceGroup2: null,
    status: index === 9 ? 'INACTIVE' : 'ACTIVE',
  };
}

function preview(overrides: Partial<ChartTemplatePreviewResult> = {}): ChartTemplatePreviewResult {
  return {
    templateKey: 'TH_SME_COA_V1',
    templateVersion: 1,
    templateChecksum: 'a'.repeat(64),
    previewChecksum: 'b'.repeat(64),
    exact: 175,
    missing: 0,
    unusedConflicts: 0,
    inUseConflicts: 0,
    rows: [],
    ...overrides,
  };
}

describe('chart master filtering', () => {
  it('keeps all 175 rows when no filter is set', () => {
    const accounts = Array.from({ length: 175 }, (_, index) => account(index + 1));
    assert.equal(filterChartAccounts(accounts, { search: '', accountClass: '', status: '' }).length, 175);
  });

  it('searches code, Thai/English names, and report groups then combines class/status filters', () => {
    const accounts = Array.from({ length: 12 }, (_, index) => account(index + 1));
    assert.deepEqual(
      filterChartAccounts(accounts, { search: 'petty cash', accountClass: '', status: '' }).map((row) => row.id),
      ['account-5'],
    );
    assert.deepEqual(
      filterChartAccounts(accounts, { search: 'service', accountClass: 'EXPENSE', status: 'ACTIVE' }).map((row) => row.id),
      ['account-7'],
    );
  });
});

describe('chart master apply guard', () => {
  it('requires manage permission, preview, and explicit conflict confirmation', () => {
    assert.match(chartApplyBlocker({ canManage: false, preview: preview(), mode: 'MISSING_ONLY', confirmed: true })!, /ไม่มีสิทธิ์/);
    assert.match(chartApplyBlocker({ canManage: true, preview: null, mode: 'MISSING_ONLY', confirmed: true })!, /ตรวจสอบผลกระทบ/);
    assert.match(chartApplyBlocker({
      canManage: true,
      preview: preview({ unusedConflicts: 1 }),
      mode: 'MISSING_ONLY',
      confirmed: false,
    })!, /เพิ่มเฉพาะบัญชีที่ขาด/);
    assert.equal(chartApplyBlocker({
      canManage: true,
      preview: preview({ unusedConflicts: 1 }),
      mode: 'MISSING_ONLY',
      confirmed: true,
    }), null);
  });

  it('never allows REPLACE_UNUSED while an in-use conflict exists', () => {
    assert.match(chartApplyBlocker({
      canManage: true,
      preview: preview({ inUseConflicts: 1 }),
      mode: 'REPLACE_UNUSED',
      confirmed: true,
    })!, /ถูกใช้งานแล้ว/);
  });

  it('blocks every mode when a global account shadows the template', () => {
    assert.match(chartApplyBlocker({
      canManage: true,
      preview: preview({
        inUseConflicts: 1,
        rows: [{
          code: '1210-00',
          existingAccountId: null,
          classification: 'IN_USE_CONFLICT',
          dependencyCount: 1,
          dependencies: { GLOBAL_ACCOUNT: 1 },
          differingFields: ['globalAccount'],
        }],
      }),
      mode: 'MISSING_ONLY',
      confirmed: true,
    })!, /บัญชีกลาง/);
  });

  it('extracts the request reference from API details', () => {
    assert.equal(requestIdFromError({ details: { requestId: 'req-123' } }), 'req-123');
    assert.equal(requestIdFromError(new Error('failed')), null);
  });
});
