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
