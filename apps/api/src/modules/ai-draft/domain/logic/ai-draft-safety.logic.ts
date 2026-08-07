import type {
  AiCandidateActionType,
  AiToolCategory,
  AiRiskLevel,
} from '@watchdog-bms/contracts';

// Safety policy: the boundary that keeps AI advisory. Final money/stock/tax/accounting/
// approval/export/permission/publishing mutations can never be expressed as a candidate
// action, and `final_mutation` tools are always blocked.

// Closed allowlist. Anything not in this set is an unsafe/unsupported action.
export const ALLOWED_CANDIDATE_ACTION_TYPES: readonly AiCandidateActionType[] = [
  'CREATE_CRM_FOLLOW_UP_DRAFT',
  'CREATE_ACCOUNTING_QUOTATION_DRAFT',
  'CREATE_INVENTORY_REORDER_REVIEW',
  'CREATE_INVENTORY_TRANSFER_OR_COUNT_REQUEST',
  'CREATE_TAX_EVIDENCE_CHECKLIST',
  'CREATE_TAX_CERTIFICATE_DRAFT',
  'CREATE_WORKFLOW_TASK',
  'CREATE_REVIEW_CHECKLIST',
  'NO_SOURCE_DRAFT_AVAILABLE',
];

const ALLOWED_ACTION_SET = new Set<string>(ALLOWED_CANDIDATE_ACTION_TYPES);

export function isAllowedCandidateActionType(actionType: string): actionType is AiCandidateActionType {
  return ALLOWED_ACTION_SET.has(actionType);
}

// Actions that do not create a source-module record; used for the workflow-review fallback.
const SELF_OWNED_ACTIONS = new Set<AiCandidateActionType>([
  'CREATE_REVIEW_CHECKLIST',
  'CREATE_WORKFLOW_TASK',
]);

export function isSelfOwnedAction(actionType: AiCandidateActionType): boolean {
  return SELF_OWNED_ACTIONS.has(actionType);
}

export const AI_SUGGESTION_NEEDS_DATA_ERROR = {
  code: 'ai_suggestion_needs_data',
  message: 'Suggestion needs source data; only regeneration or dismissal is allowed.',
} as const;

export const AI_SOURCE_DRAFT_UNAVAILABLE_ERROR = {
  code: 'ai_source_draft_unavailable',
  message: 'No source draft is available for this suggestion.',
} as const;

export type CandidateActionShapeErrors = string[];

export function validateCandidateActionShape(action: {
  actionType: string;
  targetModule?: string;
  draftPayloadJson?: unknown;
}): CandidateActionShapeErrors {
  const errors: CandidateActionShapeErrors = [];
  if (!isAllowedCandidateActionType(action.actionType)) {
    errors.push(`Unsafe or unsupported action type: ${action.actionType}`);
    return errors; // no point validating further
  }
  if (action.actionType === 'NO_SOURCE_DRAFT_AVAILABLE') return errors;
  if (!action.targetModule) errors.push('targetModule is required');
  if (action.draftPayloadJson == null || typeof action.draftPayloadJson !== 'object') {
    errors.push('draftPayloadJson must be an object');
  }
  return errors;
}

// Throw for anything that is not an allowlisted, well-formed candidate action.
export function assertSafeCandidateAction(action: {
  actionType: string;
  targetModule?: string;
  draftPayloadJson?: unknown;
}): void {
  const errors = validateCandidateActionShape(action);
  if (errors.length > 0) {
    throw new Error(`Rejected unsafe candidate action: ${errors.join('; ')}`);
  }
}

// ---- Citation requirement ----

// A suggestion that makes a recommendation must be backed by at least one citation.
// Otherwise it must be downgraded to needs-data (or blocked). Checklists/needs-data
// suggestions may legitimately have no recommendation.
export function evaluateCitationRequirement(input: {
  hasRecommendation: boolean;
  citationCount: number;
}): { ok: boolean; reason?: string } {
  if (!input.hasRecommendation) return { ok: true };
  if (input.citationCount > 0) return { ok: true };
  return { ok: false, reason: 'Recommendation has no source citations; downgraded to needs-data' };
}

// ---- Tool policy ----

const ALWAYS_BLOCKED_CATEGORIES = new Set<AiToolCategory>(['final_mutation']);
const WEB_ONLY_CATEGORIES = new Set<AiToolCategory>(['source_draft_create', 'review_decision']);

export type ToolSurface = 'web' | 'line' | 'workflow' | 'worker' | 'system';

export function isToolCategoryAllowed(category: AiToolCategory, surface: ToolSurface): {
  allowed: boolean;
  reason?: string;
} {
  if (ALWAYS_BLOCKED_CATEGORIES.has(category)) {
    return { allowed: false, reason: `Tool category ${category} is blocked for AI` };
  }
  if (WEB_ONLY_CATEGORIES.has(category) && surface !== 'web') {
    return { allowed: false, reason: `Tool category ${category} is web-only (surface: ${surface})` };
  }
  return { allowed: true };
}

export function assertToolCategoryAllowed(category: AiToolCategory, surface: ToolSurface): void {
  const decision = isToolCategoryAllowed(category, surface);
  if (!decision.allowed) throw new Error(decision.reason);
}

// Default risk classification if a template/action does not override it.
export function defaultRiskForAction(actionType: AiCandidateActionType): AiRiskLevel {
  switch (actionType) {
    case 'CREATE_TAX_CERTIFICATE_DRAFT':
    case 'CREATE_ACCOUNTING_QUOTATION_DRAFT':
      return 'HIGH';
    case 'CREATE_REVIEW_CHECKLIST':
    case 'NO_SOURCE_DRAFT_AVAILABLE':
      return 'LOW';
    default:
      return 'MEDIUM';
  }
}
