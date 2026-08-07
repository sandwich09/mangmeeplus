import type { AiCandidateActionType } from '@watchdog-bms/contracts';
import { AI_PERMISSION_KEYS } from '@watchdog-bms/contracts';

// Permission policy: AI permission is never sufficient by itself. Creating a source
// draft requires the AI permission AND the source-module draft/create permission.

// The source-module permission(s) a candidate action requires before it can create a draft.
export const CANDIDATE_ACTION_SOURCE_PERMISSIONS: Record<AiCandidateActionType, string[]> = {
  CREATE_CRM_FOLLOW_UP_DRAFT: ['crm.follow_up.create'],
  CREATE_ACCOUNTING_QUOTATION_DRAFT: ['accounting.quotation.create'],
  CREATE_INVENTORY_REORDER_REVIEW: ['inventory.report.read'],
  CREATE_INVENTORY_TRANSFER_OR_COUNT_REQUEST: ['inventory.movement.create'],
  CREATE_TAX_EVIDENCE_CHECKLIST: ['tax.review_issue.read'],
  CREATE_TAX_CERTIFICATE_DRAFT: ['tax.certificate.issue'],
  CREATE_WORKFLOW_TASK: ['workflow.task.read'],
  CREATE_REVIEW_CHECKLIST: [],
  NO_SOURCE_DRAFT_AVAILABLE: [],
};

export function requiredSourcePermissionsForAction(actionType: AiCandidateActionType): string[] {
  return CANDIDATE_ACTION_SOURCE_PERMISSIONS[actionType] ?? [];
}

function has(permissions: string[], key: string): boolean {
  return permissions.includes(key);
}

export function canReadSuggestions(permissions: string[]): boolean {
  return (
    has(permissions, AI_PERMISSION_KEYS.SUGGESTION_READ) ||
    has(permissions, AI_PERMISSION_KEYS.SUGGESTION_READ_OWN)
  );
}

// Broad read = full company scope; own-only read is narrowed to requester/assignee.
export function hasBroadSuggestionRead(permissions: string[]): boolean {
  return has(permissions, AI_PERMISSION_KEYS.SUGGESTION_READ);
}

export function canRequestSuggestions(permissions: string[]): boolean {
  return (
    has(permissions, AI_PERMISSION_KEYS.SUGGESTION_REQUEST) ||
    has(permissions, AI_PERMISSION_KEYS.DRAFT_REQUEST)
  );
}

export function canReviewSuggestions(permissions: string[]): boolean {
  return (
    has(permissions, AI_PERMISSION_KEYS.SUGGESTION_REVIEW) ||
    has(permissions, AI_PERMISSION_KEYS.DRAFT_REVIEW)
  );
}

export function canValidateCandidateAction(permissions: string[], actionType: AiCandidateActionType): boolean {
  if (!has(permissions, AI_PERMISSION_KEYS.DRAFT_REVIEW)) return false;
  return requiredSourcePermissionsForAction(actionType).every((p) => has(permissions, p));
}

// The core guard for source draft creation. Requires BOTH the AI create permission
// AND every source-module permission the action needs.
export function evaluateCanCreateSourceDraft(
  permissions: string[],
  actionType: AiCandidateActionType,
): { allowed: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!has(permissions, AI_PERMISSION_KEYS.DRAFT_CREATE_SOURCE_DRAFT)) {
    missing.push(AI_PERMISSION_KEYS.DRAFT_CREATE_SOURCE_DRAFT);
  }
  for (const p of requiredSourcePermissionsForAction(actionType)) {
    if (!has(permissions, p)) missing.push(p);
  }
  return { allowed: missing.length === 0, missing };
}

export function canManageTemplates(permissions: string[]): boolean {
  return has(permissions, AI_PERMISSION_KEYS.TEMPLATE_MANAGE);
}

export function canReadToolInvocations(permissions: string[]): boolean {
  return has(permissions, AI_PERMISSION_KEYS.TOOL_INVOCATION_READ);
}
