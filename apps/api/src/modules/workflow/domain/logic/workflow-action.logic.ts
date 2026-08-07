import type { WorkflowActionDefinition } from '@watchdog-bms/contracts';
import { WORKFLOW_ALLOWED_ACTION_TYPES } from '../workflow.constants';

// Rejects anything outside the fixed safe-action allow-list before persistence.
// This is the single choke point that makes unsafe final actions impossible by design.
export function validateActionDefinitions(actions: WorkflowActionDefinition[]): string[] {
  const errors: string[] = [];
  if (!Array.isArray(actions) || actions.length === 0) {
    return ['Rule must define at least one action'];
  }
  const seenKeys = new Set<string>();
  for (const action of actions) {
    if (!action || typeof action !== 'object') {
      errors.push('Action must be an object');
      continue;
    }
    if (!action.actionKey || typeof action.actionKey !== 'string') {
      errors.push('Action must have a non-empty string actionKey');
    } else if (seenKeys.has(action.actionKey)) {
      errors.push(`Duplicate actionKey: ${action.actionKey}`);
    } else {
      seenKeys.add(action.actionKey);
    }
    if (!WORKFLOW_ALLOWED_ACTION_TYPES.includes(action.actionType)) {
      errors.push(`Action type is not allowed: ${String(action.actionType)}`);
    }
    if (action.configJson != null && typeof action.configJson !== 'object') {
      errors.push(`Action ${action.actionKey ?? '?'} configJson must be an object`);
    }
    if (action.actionType === 'CALL_WEBHOOK') {
      const cfg = (action.configJson ?? {}) as Record<string, unknown>;
      if (!cfg['endpointId'] || typeof cfg['endpointId'] !== 'string') {
        errors.push('CALL_WEBHOOK action requires configJson.endpointId referencing an allowlisted WorkflowWebhookEndpoint');
      }
    }
  }
  return errors;
}
