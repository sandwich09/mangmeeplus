import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isReportsFeatureDisabled, reportExportErrorText, reportExportStatusText, reportFreshnessText, reportRunStatusText, reportWarningText } from './reports-ui.logic';

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
