import type {
  AiDraftRequestStatus,
  AiSuggestionStatus,
} from '@watchdog-bms/contracts';

// Lifecycle transition rules for draft requests and suggestions.

const REQUEST_TRANSITIONS: Record<AiDraftRequestStatus, AiDraftRequestStatus[]> = {
  QUEUED: ['GENERATING', 'CANCELED', 'EXPIRED'],
  GENERATING: ['READY', 'NEEDS_DATA', 'PROVIDER_UNAVAILABLE', 'FAILED', 'CANCELED'],
  // Provider-unavailable / needs-data can be retried (back to QUEUED) on manual regenerate.
  PROVIDER_UNAVAILABLE: ['QUEUED', 'GENERATING', 'CANCELED', 'EXPIRED'],
  NEEDS_DATA: ['QUEUED', 'GENERATING', 'CANCELED', 'EXPIRED'],
  FAILED: ['QUEUED', 'CANCELED', 'EXPIRED'],
  READY: ['EXPIRED'],
  CANCELED: [],
  EXPIRED: [],
};

export function canTransitionRequest(from: AiDraftRequestStatus, to: AiDraftRequestStatus): boolean {
  if (from === to) return true;
  return REQUEST_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertRequestTransition(from: AiDraftRequestStatus, to: AiDraftRequestStatus): void {
  if (!canTransitionRequest(from, to)) {
    throw new Error(`Invalid draft-request transition ${from} -> ${to}`);
  }
}

const SUGGESTION_TRANSITIONS: Record<AiSuggestionStatus, AiSuggestionStatus[]> = {
  NEW: ['IN_REVIEW', 'ACCEPTED_FOR_SOURCE_DRAFT', 'DISMISSED', 'SUPERSEDED', 'EXPIRED', 'BLOCKED_BY_PERMISSION', 'BLOCKED_BY_SOURCE_STATE'],
  IN_REVIEW: ['ACCEPTED_FOR_SOURCE_DRAFT', 'SOURCE_DRAFT_CREATED', 'DISMISSED', 'SUPERSEDED', 'EXPIRED', 'BLOCKED_BY_SOURCE_STATE', 'NEW'],
  ACCEPTED_FOR_SOURCE_DRAFT: ['SOURCE_DRAFT_CREATED', 'DISMISSED', 'SUPERSEDED', 'EXPIRED', 'BLOCKED_BY_SOURCE_STATE'],
  SOURCE_DRAFT_CREATED: ['SUPERSEDED', 'EXPIRED'],
  DISMISSED: [],
  SUPERSEDED: [],
  EXPIRED: [],
  BLOCKED_BY_PERMISSION: ['IN_REVIEW', 'EXPIRED'],
  BLOCKED_BY_SOURCE_STATE: ['IN_REVIEW', 'SUPERSEDED', 'EXPIRED'],
  FAILED: ['EXPIRED'],
};

export function canTransitionSuggestion(from: AiSuggestionStatus, to: AiSuggestionStatus): boolean {
  if (from === to) return true;
  return SUGGESTION_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertSuggestionTransition(from: AiSuggestionStatus, to: AiSuggestionStatus): void {
  if (!canTransitionSuggestion(from, to)) {
    throw new Error(`Invalid suggestion transition ${from} -> ${to}`);
  }
}

const TERMINAL_SUGGESTION_STATUSES = new Set<AiSuggestionStatus>([
  'DISMISSED',
  'SUPERSEDED',
  'EXPIRED',
  'SOURCE_DRAFT_CREATED',
  'FAILED',
]);

export function isTerminalSuggestionStatus(status: AiSuggestionStatus): boolean {
  return TERMINAL_SUGGESTION_STATUSES.has(status);
}

// Can a source draft still be created from this suggestion?
export function isSuggestionActionable(status: AiSuggestionStatus): boolean {
  return status === 'NEW' || status === 'IN_REVIEW' || status === 'ACCEPTED_FOR_SOURCE_DRAFT';
}

export function isSuggestionExpired(expiresAt: Date | undefined, now: Date): boolean {
  return expiresAt != null && expiresAt.getTime() <= now.getTime();
}
