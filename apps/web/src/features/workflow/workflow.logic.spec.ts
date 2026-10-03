import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  validateWebhookForm,
  parseAllowedEventTypes,
  parseJsonSafely,
  visibleWorkflowTabs,
  parseWorkflowTab,
} from './workflow.logic';
import { workflowSourceModuleText, workflowStatusText, workflowTriggerText, TRIGGER_TYPE_LABELS, RULE_STATUS_LABELS } from './workflow.model';

const workflowPageSource = readFileSync(new URL('./WorkflowPages.tsx', import.meta.url), 'utf8');

describe('workflow tab access', () => {
  it('shows only the task tab to a task-only session', () => {
    assert.deepEqual(visibleWorkflowTabs(['workflow.task.read']), ['tasks']);
  });

  it('uses list permissions and accepts webhook manage because it guards the list', () => {
    assert.deepEqual(
      visibleWorkflowTabs(['workflow.run.replay', 'workflow.task.work', 'workflow.webhook.manage']),
      ['webhooks'],
    );
  });

  it('falls back hidden and unknown deep links to the first visible tab', () => {
    assert.equal(parseWorkflowTab('templates', ['tasks']), 'tasks');
    assert.equal(parseWorkflowTab('unknown', ['dead-letters', 'webhooks']), 'dead-letters');
    assert.equal(parseWorkflowTab('webhooks', ['dead-letters', 'webhooks']), 'webhooks');
  });

  it('returns no tabs when no list permission exists', () => {
    assert.deepEqual(visibleWorkflowTabs([]), []);
  });
});

describe('validateWebhookForm', () => {
  const ok = { name: 'hook', url: 'https://example.com/hook', secretRef: 'secret', allowedEventTypes: 'a.b' };
  it('accepts a valid form', () => {
    assert.equal(validateWebhookForm(ok), null);
  });
  it('rejects a non-https URL', () => {
    assert.ok(validateWebhookForm({ ...ok, url: 'http://example.com' }));
  });
  it('rejects an empty allowedEventTypes', () => {
    assert.ok(validateWebhookForm({ ...ok, allowedEventTypes: '' }));
  });
});

describe('parseAllowedEventTypes', () => {
  it('splits and trims a comma-separated list', () => {
    assert.deepEqual(parseAllowedEventTypes('a.b, c.d ,, e.f'), ['a.b', 'c.d', 'e.f']);
  });
});

describe('parseJsonSafely', () => {
  it('parses valid JSON', () => {
    assert.deepEqual(parseJsonSafely('{"a":1}'), { value: { a: 1 } });
  });
  it('reports invalid JSON without throwing', () => {
    const result = parseJsonSafely('{not json}');
    assert.ok(result.error);
  });
});

describe('automation page text', () => {
  it('does not print English source headings, source ids, or raw status fallbacks', () => {
    assert.doesNotMatch(workflowPageSource, /Trigger:|Source:|>\s*Trigger\s*</);
    assert.doesNotMatch(workflowPageSource, /sourceId\.slice|labels\[status\]\s*\?\?\s*status/);
    assert.doesNotMatch(workflowPageSource, /Action runs|Condition JSON|Action JSON|(?:['"]|>)Webhook(?:['"<])/);
  });

  // isRuleInCooldown skips the whole run (tasks, notices and every other action) while the rule ran less than N seconds ago.
  it('names the rule cooldown by what it holds back: the rule running again', () => {
    assert.match(workflowPageSource, />เว้นระยะก่อนทำงานซ้ำ \(วินาที\)</);
    assert.doesNotMatch(workflowPageSource, /พักการแจ้งเตือน/);
  });

  // createWebhookEndpoint always stores DISABLED; only the enable action switches a connection on.
  it('says a new connection starts switched off, not that connections are always off', () => {
    assert.match(workflowPageSource, />การเชื่อมต่อระบบภายนอกที่เพิ่มใหม่จะปิดใช้งานไว้ก่อนเสมอ ต้องกดเปิดใช้งานเองหลังตรวจสอบที่อยู่เว็บไซต์และรายการเหตุการณ์ที่อนุญาตแล้ว</);
    assert.doesNotMatch(workflowPageSource, /ปิดไว้เสมอ/);
  });
});

describe('automation labels', () => {
  it('translates trigger and source values and hides unknown enum values', () => {
    assert.equal(workflowTriggerText('SLA_SCAN'), 'ตรวจงานที่เกินกำหนด');
    assert.equal(workflowSourceModuleText('inventory'), 'คลังสินค้า');
    assert.equal(workflowSourceModuleText('future-module'), 'ส่วนงานอื่น');
    assert.equal(workflowStatusText(TRIGGER_TYPE_LABELS, 'future-trigger'), 'สถานะอื่น');
    assert.equal(workflowStatusText(RULE_STATUS_LABELS, 'DRAFT'), 'แบบร่าง');
  });

  it('reports rule test results in Thai without showing raw JSON', () => {
    assert.match(workflowPageSource, /testResult\.conditionResult\.matched \? 'เงื่อนไขตรงตามที่กำหนด' : 'เงื่อนไขไม่ตรงตามที่กำหนด'/);
    assert.match(workflowPageSource, /มีแผนการทำงาน/);
    assert.match(workflowPageSource, /testResult\.actionPlan\.length\.toLocaleString\('th-TH'\)/);
    assert.doesNotMatch(workflowPageSource, /JSON\.stringify\(testResult/);
  });
});
