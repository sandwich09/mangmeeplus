/**
 * Pure business logic for CRM and Sales (Item 15).
 * No Nest / Prisma / browser imports. Decimal-safe money math.
 */

import { Decimal } from 'decimal.js';
import type {
  CrmPipelineGroup,
  CrmOpportunityStatus,
  CrmFollowUpStatus,
  UpdateCrmPipelineStageInput,
  CrmFollowUpPriority,
} from '@watchdog-bms/contracts';

// ---- Money helpers ----

export function d(v: string | number): Decimal {
  return new Decimal(String(v));
}
export function decStr(v: Decimal): string {
  return v.toFixed(4);
}
export function sumAmounts(amounts: string[]): string {
  return decStr(amounts.reduce((acc, a) => acc.add(d(a)), d(0)));
}

// ---- Normalization (deterministic; stored separately from display fields) ----

export function normalizePhone(phone?: string | null): string | undefined {
  if (!phone) return undefined;
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('0066')) digits = digits.slice(2);
  const thai = digits.match(/^66(?:0)?([1-9]\d{7,8})$/);
  if (thai) return thai[1];
  if (/^0[1-9]\d{7,8}$/.test(digits)) return digits.slice(1);
  if (digits.startsWith('00')) digits = digits.slice(2);
  return digits === '' ? undefined : digits;
}

export function normalizeEmail(email?: string | null): string | undefined {
  if (!email) return undefined;
  const v = email.trim().toLowerCase();
  return v === '' ? undefined : v;
}

export function normalizeTaxId(taxId?: string | null): string | undefined {
  if (!taxId) return undefined;
  const v = taxId.replace(/\D/g, '');
  return v === '' ? undefined : v;
}

export function normalizeName(name?: string | null): string {
  return (name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// ---- Duplicate scoring ----

export type DuplicateMatchType = 'TAX_ID' | 'EMAIL' | 'PHONE' | 'NAME';
export type DuplicateConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export type CustomerMatchKey = {
  taxIdNormalized?: string;
  primaryEmailNormalized?: string;
  primaryPhoneNormalized?: string;
  nameNormalized?: string;
};

/**
 * Scores a candidate against a new customer. Exact tax id/external id is high
 * confidence; exact phone/email is medium/high; fuzzy normalized name is a
 * warning only. Returns null when nothing matches.
 */
export function scoreCustomerDuplicate(
  input: CustomerMatchKey,
  candidate: CustomerMatchKey,
): { matchType: DuplicateMatchType; confidence: DuplicateConfidence } | null {
  if (input.taxIdNormalized && input.taxIdNormalized === candidate.taxIdNormalized) {
    return { matchType: 'TAX_ID', confidence: 'HIGH' };
  }
  if (input.primaryEmailNormalized && input.primaryEmailNormalized === candidate.primaryEmailNormalized) {
    return { matchType: 'EMAIL', confidence: 'HIGH' };
  }
  if (input.primaryPhoneNormalized && input.primaryPhoneNormalized === candidate.primaryPhoneNormalized) {
    return { matchType: 'PHONE', confidence: 'MEDIUM' };
  }
  if (input.nameNormalized && input.nameNormalized.length >= 3 && input.nameNormalized === candidate.nameNormalized) {
    return { matchType: 'NAME', confidence: 'LOW' };
  }
  return null;
}

// ---- Pipeline stage validation ----

export type PipelineValidationInput = Pick<UpdateCrmPipelineStageInput, 'name' | 'canonicalGroup' | 'sortOrder'>;

/** Stage config must include at least one WON and one LOST terminal group, and unique non-empty names. */
export function validatePipelineStages(stages: PipelineValidationInput[]): string[] {
  const errors: string[] = [];
  if (stages.length === 0) {
    errors.push('stages_required');
    return errors;
  }
  const groups = new Set(stages.map((s) => s.canonicalGroup));
  if (!groups.has('WON')) errors.push('missing_won_group');
  if (!groups.has('LOST')) errors.push('missing_lost_group');

  const names = stages.map((s) => (s.name ?? '').trim().toLowerCase());
  if (names.some((n) => n === '')) errors.push('stage_name_required');
  if (new Set(names).size !== names.length) errors.push('duplicate_stage_name');
  return errors;
}

export function isTerminalGroup(group: CrmPipelineGroup): 'WON' | 'LOST' | null {
  if (group === 'WON') return 'WON';
  if (group === 'LOST') return 'LOST';
  return null;
}

// ---- Opportunity transitions ----

/** Open opportunities can move stage / close; terminal opportunities need reopen. */
export function canMoveStage(status: CrmOpportunityStatus): boolean {
  return status === 'OPEN';
}

export function validateClose(
  result: 'WON' | 'LOST',
  input: { reason?: string; winReason?: string; hasQuotationLink: boolean },
): string | null {
  if (result === 'LOST') {
    if (!input.reason || input.reason.trim() === '') return 'lost_reason_required';
    return null;
  }
  // WON: require a linked quotation OR a manual win reason.
  if (!input.hasQuotationLink && (!input.winReason || input.winReason.trim() === '')) {
    return 'won_requires_quote_or_reason';
  }
  return null;
}

export function canReopen(status: CrmOpportunityStatus): boolean {
  return status === 'WON' || status === 'LOST';
}

// ---- Follow-up transitions ----

const FOLLOW_UP_TRANSITIONS: Record<CrmFollowUpStatus, CrmFollowUpStatus[]> = {
  OPEN: ['DONE', 'SNOOZED', 'CANCELED'],
  OVERDUE: ['DONE', 'SNOOZED', 'CANCELED'],
  SNOOZED: ['OPEN', 'DONE', 'CANCELED'],
  DONE: [],
  CANCELED: [],
};

export function canTransitionFollowUp(from: CrmFollowUpStatus, to: CrmFollowUpStatus): boolean {
  return (FOLLOW_UP_TRANSITIONS[from] ?? []).includes(to);
}

/** OPEN follow-ups whose dueAt is in the past are effectively OVERDUE. */
export function effectiveFollowUpStatus(status: CrmFollowUpStatus, dueAt: Date, now: Date): CrmFollowUpStatus {
  if (status === 'OPEN' && dueAt.getTime() < now.getTime()) return 'OVERDUE';
  return status;
}

// ---- AI follow-up priority scoring ----

const PRIORITY_WEIGHT: Record<CrmFollowUpPriority, number> = { URGENT: 40, HIGH: 30, NORMAL: 15, LOW: 5 };

export type FollowUpScoreInput = {
  priority: CrmFollowUpPriority;
  dueAt: Date;
  now: Date;
  opportunityAmount?: string;
  stale?: boolean;
};

/**
 * Ranks follow-ups deterministically: overdue and high priority first, then
 * high-value opportunities and stale activity. Higher score = act sooner.
 */
export function scoreFollowUpPriority(input: FollowUpScoreInput): number {
  let score = PRIORITY_WEIGHT[input.priority] ?? 0;
  const overdueHrs = Math.floor((input.now.getTime() - input.dueAt.getTime()) / 3_600_000);
  if (overdueHrs > 0) score += Math.min(30, 10 + overdueHrs); // overdue dominates, capped
  else if (overdueHrs > -24) score += 8; // due within a day
  if (input.opportunityAmount && d(input.opportunityAmount).gte(d(10000))) score += 10;
  if (input.stale) score += 8;
  return score;
}

// ---- CSV export sanitization (formula injection protection) ----

/** Prefixes cells that could be interpreted as spreadsheet formulas. */
export function sanitizeCsvCell(value: unknown): string {
  const s = value == null ? '' : String(value);
  const dangerous = /^[=+\-@\t\r]/.test(s);
  const escaped = s.replace(/"/g, '""');
  const guarded = dangerous ? `'${escaped}` : escaped;
  return `"${guarded}"`;
}

export function toCsvRow(cells: unknown[]): string {
  return cells.map(sanitizeCsvCell).join(',');
}

// ---- Scope helpers (ABAC) ----
//
// Team/branch ABAC primitives are not yet available. Read-context roles get
// company-wide read; roles without a global grant are scoped to explicit
// ownership until team/branch predicates are available.

const CRM_READ_ALL_ROLES = ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT', 'AUDITOR_READONLY', 'MARKETING'];
const CRM_MANAGE_ALL_ROLES = ['OWNER', 'ADMIN'];

export function crmCanReadAll(roles: string[]): boolean {
  return roles.some((r) => CRM_READ_ALL_ROLES.includes(r));
}

export function crmCanManageAll(roles: string[]): boolean {
  return roles.some((r) => CRM_MANAGE_ALL_ROLES.includes(r));
}
