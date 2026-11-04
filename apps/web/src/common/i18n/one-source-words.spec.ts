import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as shared from '@watchdog-bms/contracts';
import { t } from './workspace-i18n.logic';
import { aiRiskLabel, aiSuggestionStatusLabel, SUGGESTION_TABS } from '../../features/ai-suggestions/ai-suggestions.logic';
import { severityLabel } from '../../features/dashboard-notifications/dashboard-notifications.logic';
import { reportFreshnessText } from '../../features/reports/reports-ui.logic';
import * as workflowModel from '../../features/workflow/workflow.model';
import { DOCUMENT_STATUS_LABELS, DOCUMENT_TYPE_LABELS, PAYMENT_STATUS_LABELS } from '../../features/accounting-documents/accounting-documents.model';

// Owner 2026-10-02: one source for a word. The report rows (API) and these pages name the same things,
// so both take the words from @watchdog-bms/contracts and neither keeps a copy.
const words = shared as unknown as Record<string, Record<string, string> | string | undefined>;
const list = (name: string) => {
  const value = words[name];
  assert.ok(value && typeof value === 'object', `${name} is exported by contracts`);
  return value as Record<string, string>;
};

describe('page words shared with the report rows come from contracts', () => {
  it('stock movement types', () => {
    for (const [type, word] of Object.entries(list('STOCK_MOVEMENT_TYPE_LABELS'))) {
      assert.equal(t(`inventory.movement.${type}` as Parameters<typeof t>[0], 'th'), word, type);
    }
  });

  it('AI suggestion statuses, risk levels and the needs-data word', () => {
    for (const [status, word] of Object.entries(list('AI_SUGGESTION_STATUS_LABELS'))) assert.equal(aiSuggestionStatusLabel(status), word, status);
    for (const [level, word] of Object.entries(list('AI_RISK_LEVEL_LABELS'))) assert.equal(aiRiskLabel(level), word, level);
    assert.equal(SUGGESTION_TABS.find((tab) => tab.needsData)?.label, words.AI_SUGGESTION_NEEDS_DATA_LABEL);
  });

  it('notification severity and report freshness', () => {
    for (const [severity, word] of Object.entries(list('NOTIFICATION_SEVERITY_LABELS'))) assert.equal(severityLabel(severity as never), word, severity);
    for (const [freshness, word] of Object.entries(list('REPORT_FRESHNESS_LABELS'))) assert.equal(reportFreshnessText(freshness as never), word, freshness);
  });

  it('automation statuses and accounting document words are the shared lists themselves', () => {
    const model = workflowModel as unknown as Record<string, unknown>;
    assert.equal(model.RULE_STATUS_LABELS, list('WORKFLOW_RULE_STATUS_LABELS'));
    assert.equal(model.RUN_STATUS_LABELS, list('WORKFLOW_RUN_STATUS_LABELS'));
    assert.equal(model.TASK_STATUS_LABELS, list('WORKFLOW_TASK_STATUS_LABELS'));
    assert.equal(model.DEAD_LETTER_RESOLUTION_LABELS, list('WORKFLOW_DEAD_LETTER_RESOLUTION_LABELS'));
    assert.equal(model.WORKFLOW_TAB_LABELS, list('WORKFLOW_TAB_LABELS'));
    assert.equal(DOCUMENT_TYPE_LABELS, list('ACCOUNTING_DOCUMENT_TYPE_LABELS'));
    assert.equal(DOCUMENT_STATUS_LABELS, list('ACCOUNTING_DOCUMENT_STATUS_LABELS'));
    assert.equal(PAYMENT_STATUS_LABELS, list('ACCOUNTING_PAYMENT_STATUS_LABELS'));
  });
});

// PWS-WORDS: the screen title changes independently of accountant output labels.
it('PWS-WORDS uses one plain VAT title while retaining status and output words', () => {
  assert.equal(shared.INPUT_VAT_RIGHT_LABEL, 'ใช้ VAT ตอนยื่นภาษี');
  assert.deepEqual(shared.INPUT_VAT_RIGHT_LABELS, { NEEDS_REVIEW: 'รอตรวจสอบ', CLAIMABLE: 'ใช้ได้ตามเงื่อนไข', NON_CLAIMABLE: 'ใช้ไม่ได้' });
  assert.equal(shared.ACCOUNTANT_WORKBOOK_COLUMN_LABELS.input_vat_right, 'สิทธิภาษีซื้อ');
  const buyerWords = {
    'expenses.buyer_match_hint': 'ตรวจกับใบจริงแล้วเลือกวิธีแก้ด้านล่าง',
    'expenses.buyer_match_mark_message': 'หากเลือกผิด ใช้ “ยกเลิกเครื่องหมาย” ได้ขณะที่รายการยังแก้ไขได้',
    'expenses.buyer_match_marked_toast': 'ทำเครื่องหมายแล้ว ไปขั้น “ภาษีและเอกสาร” แล้วกด “ถัดไป”',
    'expenses.buyer_match_mark_locked': 'แก้คำตอบเรื่อง VAT ที่หน้านี้ไม่ได้ ให้ผู้ทำบัญชีตรวจรายการนี้ต่อ',
    'expenses.buyer_match_mark_needs_reviewer': 'ให้ผู้มีสิทธิ์ตรวจรายจ่ายแก้คำตอบเรื่อง VAT ของใบนี้',
    'expenses.buyer_match_already_not_claimed': 'ใบนี้ไม่ได้เลือกใช้ VAT ตอนยื่นภาษีอยู่แล้ว',
  } as const;
  for (const [key, word] of Object.entries(buyerWords)) assert.equal(t(key as Parameters<typeof t>[0], 'th'), word);
});
