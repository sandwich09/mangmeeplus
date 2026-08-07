import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateWebhookForm,
  parseAllowedEventTypes,
  parseJsonSafely,
  visibleWorkflowTabs,
  parseWorkflowTab,
} from './workflow.logic';

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
