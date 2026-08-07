import { createHash } from 'node:crypto';
import type { AiCandidateActionType, AiDraftRequestOrigin } from '@watchdog-bms/contracts';

// Deterministic idempotency + retention helpers. No I/O, no randomness except the
// explicit MANUAL/WEB fallback which is unique per call (manual requests are not deduped).

export function hashText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// Bounded preview for prompt/user/model/tool text. Default retention is preview + hash.
export function previewText(text: string | undefined, max = 280): string | undefined {
  if (text == null) return undefined;
  const trimmed = text.trim();
  if (trimmed.length <= max) return redactSensitive(trimmed);
  return `${redactSensitive(trimmed.slice(0, max))}…`;
}

// Redact obvious secrets/PII before persistence: long digit runs (bank/card),
// bearer/secret tokens, and key=value secret pairs.
export function redactSensitive(text: string): string {
  return text
    .replace(/\b\d{9,}\b/g, (m) => `${'*'.repeat(Math.max(0, m.length - 4))}${m.slice(-4)}`)
    .replace(/\b(bearer|token|secret|password|apikey|api_key)\b[\s:=]+\S+/gi, '$1 [REDACTED]');
}

// Source-state hash: a stable fingerprint of the evidence a suggestion was built from.
// If the source changes materially, this hash changes and source-draft creation is blocked
// until the reviewer acknowledges or regenerates.
export function buildSourceStateHash(parts: Array<string | number | null | undefined>): string {
  const normalized = parts.map((p) => (p == null ? '' : String(p))).join('|');
  return hashText(normalized);
}

// A request idempotency key. WORKFLOW/SCHEDULE origins MUST be deduped by their
// caller-supplied key; WEB/LINE/SYSTEM manual requests get a unique key per call.
export function buildRequestIdempotencyKey(input: {
  companyId: string;
  origin: AiDraftRequestOrigin;
  templateKey: string;
  sourceRecordId?: string;
  workflowRunId?: string;
  suppliedKey?: string;
  uniqueSuffix?: string;
}): string {
  if (input.suppliedKey) return input.suppliedKey;
  if (input.origin === 'WORKFLOW' || input.origin === 'SCHEDULE') {
    const anchor = input.workflowRunId ?? input.sourceRecordId ?? '';
    if (!anchor) {
      throw new Error('WORKFLOW/SCHEDULE draft requests require an idempotencyKey, workflowRunId, or sourceRecordId');
    }
    return `ai-req:${input.origin}:${input.companyId}:${input.templateKey}:${anchor}`;
  }
  // Manual (WEB/LINE/SYSTEM): unique per call so a user can re-ask.
  const suffix = input.uniqueSuffix ?? `${Date.now()}`;
  return `ai-req:${input.origin}:${input.companyId}:${input.templateKey}:${input.sourceRecordId ?? 'none'}:${suffix}`;
}

// One source draft per candidate action idempotency key.
export function buildCandidateActionIdempotencyKey(
  suggestionId: string,
  actionType: AiCandidateActionType,
  targetRecordId?: string,
): string {
  return `ai-act:${suggestionId}:${actionType}:${targetRecordId ?? 'new'}`;
}
