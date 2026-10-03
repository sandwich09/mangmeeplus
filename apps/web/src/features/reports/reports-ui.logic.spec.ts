import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultReportViewName, isReportsFeatureDisabled, reportChartKindText, reportExportErrorText, reportExportStatusText, reportFilterOptionText, reportFreshnessText, reportRunStatusText, reportValueText, reportViewVisibilityText, reportWarningText } from './reports-ui.logic';
import * as reportsUi from './reports-ui.logic';

const workspaceSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'ReportsWorkspacePage.tsx'), 'utf8');

describe('report export friendly display', () => {
  it('never exposes the legacy technical code to a customer', () => {
    const text = reportExportErrorText({ errorCode: 'legacy_export_not_materialized' });
    assert.equal(text, 'ไฟล์เดิมไม่ได้เก็บเนื้อหาไว้ กรุณาสร้างไฟล์ CSV ใหม่');
    assert.doesNotMatch(text!, /legacy|materialized/i);
  });

  it('never asks a history-only user to create an export while reports are off', () => {
    const text = reportExportErrorText({ errorCode: 'legacy_export_not_materialized' }, true);
    assert.match(text!, /ติดต่อผู้ดูแลให้เปิดฟีเจอร์รายงาน/);
    assert.doesNotMatch(text!, /กรุณาสร้างไฟล์ CSV ใหม่$/);
  });

  it('shows human status labels and a safe fallback for unknown failures', () => {
    assert.equal(reportExportStatusText('READY'), 'พร้อมดาวน์โหลด');
    assert.equal(reportExportStatusText('EXPIRED'), 'หมดอายุแล้ว');
    assert.equal(reportExportErrorText({ errorCode: 'internal_provider_detail' }), 'สร้างไฟล์ไม่สำเร็จ กรุณาลองใหม่');
  });

  it('tells a history-only user to contact an admin instead of offering an impossible retry', () => {
    assert.match(reportExportErrorText({ errorCode: 'report_export_expired' }, true)!, /ติดต่อผู้ดูแล/);
    assert.doesNotMatch(reportExportErrorText({ errorCode: 'report_export_expired' }, true)!, /ลองใหม่/);
  });

  it('shows friendly run history statuses', () => {
    assert.equal(reportRunStatusText('PARTIAL'), 'ข้อมูลบางส่วน');
    assert.equal(reportFreshnessText('fresh'), 'ข้อมูลล่าสุด');
  });
});

describe('reports history-only detection', () => {
  it('enters history-only mode only for the stable entitlement rejection', () => {
    assert.equal(isReportsFeatureDisabled({ code: 'feature_not_enabled', status: 403 }), true);
    assert.equal(isReportsFeatureDisabled({ code: 'company_access_unavailable', status: 403 }), false);
    assert.equal(isReportsFeatureDisabled(Object.assign(new Error('network down'), { status: 500 })), false);
  });
});

describe('saved report view default name', () => {
  it('uses the Thai short date while keeping the report name intact', () => {
    assert.equal(defaultReportViewName('รายงานยอดขาย', new Date('2026-10-01T17:00:00.000Z')), 'รายงานยอดขาย 2 ต.ค. 2569');
  });
});

describe('report page enum labels', () => {
  it('does not show chart, scope, or saved-view visibility keys', () => {
    assert.equal(reportChartKindText('table'), 'ตาราง');
    assert.equal(reportChartKindText('aging_bucket'), 'ช่วงอายุหนี้');
    assert.equal(reportFilterOptionText('own'), 'รายการของฉัน');
    assert.equal(reportFilterOptionText('all'), 'ทุกรายการ');
    assert.equal(reportViewVisibilityText('COMPANY'), 'ทั้งบริษัท');
    assert.equal(reportValueText(1234.5, 'money'), '1,234.50 บาท');
    assert.equal(reportValueText('1234', 'number'), '1,234');
    // Yes/no and every other machine value arrive as words from the API (reports/domain/report-row-text.logic.ts).
    assert.equal(reportValueText('ใช่', 'boolean'), 'ใช่');
    assert.equal(reportValueText('2026-07', 'string', 'periodKey'), 'ก.ค. 2569');
    assert.doesNotMatch(workspaceSource, /\{view\.datasetCode\}|\{result\.runId\}|dataset\.sourceModule/);
    assert.doesNotMatch(workspaceSource, />\{category\}:/);
    assert.match(workspaceSource, /CATEGORY_LABEL\[category\][^\n]+count\.toLocaleString\('th-TH'\)/);
    assert.match(workspaceSource, /enabledDatasets\.length\.toLocaleString\('th-TH'\)/);
    assert.match(workspaceSource, /เกณฑ์ความใหม่ของข้อมูลไม่เกิน/);
  });
});

describe('report coverage warnings', () => {
  it('translates partial source coverage without exposing technical codes', () => {
    const text = reportWarningText('workflow_dead_letter_scope_forbidden');
    assert.match(text, /ไม่รวมรายการ/);
    assert.doesNotMatch(text, /workflow|dead_letter|forbidden/i);
  });

  it('keeps an already-friendly coverage sentence intact', () => {
    assert.equal(reportWarningText('แสดงเฉพาะรายการค่าใช้จ่ายที่คุณสร้าง'), 'แสดงเฉพาะรายการค่าใช้จ่ายที่คุณสร้าง');
  });

  it('never exposes an unknown implementation warning key', () => {
    const text = reportWarningText('future_adapter_internal_code');
    assert.match(text, /ข้อมูลบางส่วน/);
    assert.doesNotMatch(text, /adapter|internal|code/i);
  });
});

describe('report export history reachability', () => {
  it('renders every export returned by the bounded API list with a 44px download target', () => {
    assert.match(workspaceSource, /\{exports\.map\(\(item\) => \(/);
    assert.doesNotMatch(workspaceSource, /exports\.slice\(/);
    assert.match(workspaceSource, /min-h-11[^\n]+downloadExport\(item\)/);
  });
});

// A money cell says บาท only when its row is in baht. The API sends the row's currency as a word (THB as บาท,
// another currency as its code, null when the source does not know it); reports without a currency column are
// in the company's base currency, which is baht.
describe('report money units', () => {
  const unitOf = (reportsUi as unknown as { reportMoneyUnit?: (row?: Record<string, unknown>) => string | null }).reportMoneyUnit;

  it('takes the unit from the row', () => {
    assert.equal(typeof unitOf, 'function', 'reportMoneyUnit');
    const usd = { source: 'ใบแจ้งหนี้ที่ออกแล้ว', currency: 'USD', amount: '12.3400' };
    assert.equal(reportValueText(usd.amount, 'money', 'amount', unitOf!(usd)), '12.34 USD');
    assert.equal(reportValueText('1234.5', 'money', 'amount', unitOf!({ currency: 'บาท' })), '1,234.50 บาท');
    assert.equal(reportValueText('9', 'money', 'amount', unitOf!({ currency: null })), '9.00');
    assert.equal(reportValueText('9', 'money', 'balance', unitOf!({ accountCode: '1100-00' })), '9.00 บาท');
  });

  it('uses the row unit in the table and in the chart', () => {
    assert.match(workspaceSource, /reportValueText\(row\[column\.key\], column\.type, column\.key, reportMoneyUnit\(row\)\)/);
    assert.match(workspaceSource, /reportValueText\(sourceValue, chartValueType, undefined, reportMoneyUnit\(result\.rows\[i\]\)\)/);
  });
});

// Every warning the report API can send has its own words: the generic sentence (scope and permissions) is untrue
// for a currency gap. The codes are read from the API sources, so a new code without words fails here.
describe('report warnings say what happened', () => {
  const api = join(dirname(fileURLToPath(import.meta.url)), '../../../../api/src/modules/reports/application');
  const sources = ['report-source-adapters.ts', 'report.use-cases.ts'].map((file) => readFileSync(join(api, file), 'utf8')).join('\n');
  const codes = [...new Set([...sources.matchAll(/warnings(?:\.push\(|: \[)'([a-z_]+)'|unavailableReason: '([a-z_]+)'|\?\? '([a-z_]+_not_ready)'|\? \['([a-z_]+)'\] : \[\]/g)]
    .map((match) => match[1] ?? match[2] ?? match[3] ?? match[4]!))];
  const generic = reportWarningText('a_code_the_page_does_not_know');

  it('has words of its own for every code, with no English', () => {
    assert.ok(codes.length >= 14, `found ${codes.length} codes`);
    for (const code of codes) {
      const text = reportWarningText(code);
      assert.notEqual(text, generic, code);
      assert.doesNotMatch(text.replace(/\b(?:LINE|QR|AI|PDF|VAT|Excel|CSV)\b/g, ''), /[A-Za-z]/, code);
    }
  });

  it('says what the currency gaps mean', () => {
    assert.match(reportWarningText('crm_pipeline_currency_unavailable'), /ไม่แยกสกุลเงิน/);
    assert.match(reportWarningText('mixed_currency_total_unavailable'), /มากกว่าหนึ่งสกุลเงิน/);
    assert.match(reportWarningText('crm_scope_forbidden'), /โอกาสการขาย/);
  });
});
