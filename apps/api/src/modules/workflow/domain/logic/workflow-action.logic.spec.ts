import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateActionDefinitions } from './workflow-action.logic';
import type { WorkflowActionDefinition } from '@watchdog-bms/contracts';

describe('validateActionDefinitions', () => {
  it('accepts a valid safe action list', () => {
    const actions: WorkflowActionDefinition[] = [
      { actionKey: 'notify', actionType: 'SEND_NOTIFICATION', configJson: {} },
      { actionKey: 'task', actionType: 'CREATE_WORKFLOW_TASK', configJson: {} },
    ];
    assert.deepEqual(validateActionDefinitions(actions), []);
  });

  it('rejects an empty action list', () => {
    assert.ok(validateActionDefinitions([]).length > 0);
  });

  it('rejects unsafe/unknown action types (e.g. a smuggled final-mutation action)', () => {
    const actions = [{ actionKey: 'x', actionType: 'ISSUE_INVOICE', configJson: {} }] as unknown as WorkflowActionDefinition[];
    assert.ok(validateActionDefinitions(actions).some((e) => e.includes('not allowed')));
  });

  it('rejects unsafe money/stock/tax/permission action type strings even if well-formed', () => {
    for (const actionType of ['TRANSFER_FUNDS', 'POST_JOURNAL_ENTRY', 'REDUCE_STOCK', 'GRANT_PERMISSION', 'PUBLISH_MARKETING_POST']) {
      const actions = [{ actionKey: 'x', actionType, configJson: {} }] as unknown as WorkflowActionDefinition[];
      assert.ok(validateActionDefinitions(actions).length > 0, `expected ${actionType} to be rejected`);
    }
  });

  it('rejects duplicate actionKey within a rule', () => {
    const actions: WorkflowActionDefinition[] = [
      { actionKey: 'dup', actionType: 'SEND_NOTIFICATION', configJson: {} },
      { actionKey: 'dup', actionType: 'ADD_AUDIT_NOTE', configJson: {} },
    ];
    assert.ok(validateActionDefinitions(actions).some((e) => e.includes('Duplicate actionKey')));
  });

  it('requires CALL_WEBHOOK to reference an allowlisted endpointId', () => {
    const actions: WorkflowActionDefinition[] = [{ actionKey: 'hook', actionType: 'CALL_WEBHOOK', configJson: {} }];
    assert.ok(validateActionDefinitions(actions).some((e) => e.includes('endpointId')));
  });

  it('accepts CALL_WEBHOOK when endpointId is present', () => {
    const actions: WorkflowActionDefinition[] = [{ actionKey: 'hook', actionType: 'CALL_WEBHOOK', configJson: { endpointId: 'wh_1' } }];
    assert.deepEqual(validateActionDefinitions(actions), []);
  });
});
