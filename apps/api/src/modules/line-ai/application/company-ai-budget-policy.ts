/**
 * The ONE resolver for a company's effective AI budget policy (remediation spec §12.1/§12.5,
 * ADR 0013 §2.1). Admission, the admin read and every later readiness projection call this same
 * function, so a `SPLIT` company can never be described one way by the console and another way by
 * the gate.
 *
 * Plain functions in the `company-ai-usage-meter.ts` style — no service, no DI, no cache. The
 * caller supplies the already-read configuration row, the effective total `T` it resolved, and the
 * PINNED Bangkok month; this file only decides.
 */
import { DEFAULT_CHAT_CREDIT_SATANG, type PartnerAiBudgetPolicyDto } from '@watchdog-bms/contracts';
import { bangkokMonthKey } from './company-ai-usage-meter';

export type AiBudgetMode = 'SHARED' | 'SPLIT';

/** Fail-closed reasons. Nothing is ever clamped or re-spread: an invalid policy refuses spend. */
export type AiBudgetPolicyInvalidReason =
  /** SPLIT with a cap that was never set. `null` means "not set", never "unlimited". */
  | 'SPLIT_CAPS_MISSING'
  /** `C + O > T` — the allocation no longer fits the live effective total. */
  | 'SPLIT_EXCEEDS_TOTAL'
  /** A stored value outside the contract: bad mode, non-integer/negative cap, bad pending JSON. */
  | 'POLICY_MALFORMED';

/** The only shape `CompanyAiConfiguration.pendingBudgetPolicy` may hold (spec §12.4). */
export type AiBudgetPendingPolicy = {
  mode: AiBudgetMode;
  chatMonthlyBudgetSatang: number | null;
  ocrMonthlyBudgetSatang: number | null;
  /** 'YYYY-MM', Asia/Bangkok. */
  effectiveMonthKey: string;
};

/**
 * The policy columns of `CompanyAiConfiguration`. All optional on purpose: unit-test fakes that
 * predate the columns omit them entirely, and an absent field must resolve to SHARED exactly like
 * a fresh row does — the same tolerance `resolveEffectiveBudget` already gives a missing delegate.
 */
export type CompanyAiBudgetPolicyRow = {
  /** Explicit legacy/admin total override also defines the SHARED CHAT ceiling. */
  monthlyBudgetSatang?: number | null;
  budgetMode?: string | null;
  chatMonthlyBudgetSatang?: number | null;
  ocrMonthlyBudgetSatang?: number | null;
  /** New sales deals override the platform CHAT default without replacing admin settings. */
  salesDealChatCreditSatang?: number | null;
  salesDealChatCreditEndsAt?: Date | null;
  budgetConfigVersion?: number | null;
  pendingBudgetPolicy?: unknown;
  /** Add-on spec §11: set (and reached) = AI credit lots replace the SHARED calendar CHAT cap. */
  aiCreditCutoverAt?: Date | null;
};

export type ResolvedAiBudgetPolicy = {
  /** The mode in force for the pinned month — an activated pending policy is already the mode. */
  mode: AiBudgetMode;
  totalSatang: number;
  override: boolean;
  /** SHARED enforces the default or deal CHAT cap; OCR remains within the total. */
  chatCapSatang: number | null;
  ocrCapSatang: number | null;
  /** `PENDING_ACTIVATED` = the stored pending policy's month has arrived; the columns lag. */
  source: 'ACTIVE' | 'PENDING_ACTIVATED';
  /** ONLY a pending policy whose month is still in the future. It changes nothing yet. */
  pending: AiBudgetPendingPolicy | null;
  /**
   * CAS fence for the admin writer. It binds the raw row version, the pinned month AND the source,
   * so an admin page left open across a Bangkok month boundary conflicts even though the row's own
   * version never moved (review R-07).
   */
  revision: string;
  /** Set => refuse spend for this company/month. Never accompanied by a usable allocation. */
  invalidReason?: AiBudgetPolicyInvalidReason;
};

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

/** A cap is money: a non-negative safe integer of satang, or "not set". */
const isCap = (value: unknown): value is number | null =>
  value === null || (Number.isSafeInteger(value) && (value as number) >= 0);

const isMode = (value: unknown): value is AiBudgetMode => value === 'SHARED' || value === 'SPLIT';

/** The Bangkok month AFTER `now` — the only future month the admin writer may schedule into. */
export function nextBangkokMonthKey(now: Date = new Date()): string {
  const [year, month] = bangkokMonthKey(now).split('-').map(Number);
  return month === 12 ? `${year! + 1}-01` : `${year}-${String(month! + 1).padStart(2, '0')}`;
}

/** `true` only for 'YYYY-MM' with a real month number — the wire/DB form of a Bangkok month. */
export function isBangkokMonthKey(value: unknown): value is string {
  return typeof value === 'string' && MONTH_KEY.test(value);
}

/**
 * Parses stored JSON into a pending policy. Returns `undefined` for "absent" and `null` for
 * "present but malformed" — the caller must distinguish them, because malformed fails closed
 * while absent is the normal case.
 */
export function parsePendingBudgetPolicy(value: unknown): AiBudgetPendingPolicy | null | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (!isMode(raw['mode']) || !isBangkokMonthKey(raw['effectiveMonthKey'])) return null;
  if (!isCap(raw['chatMonthlyBudgetSatang']) || !isCap(raw['ocrMonthlyBudgetSatang'])) return null;
  return {
    mode: raw['mode'],
    chatMonthlyBudgetSatang: raw['chatMonthlyBudgetSatang'],
    ocrMonthlyBudgetSatang: raw['ocrMonthlyBudgetSatang'],
    effectiveMonthKey: raw['effectiveMonthKey'],
  };
}

/**
 * The CAS fence alone, without needing an effective total. The admin writer compares the
 * revision an operator's page was rendered from against this, before and after materialising an
 * activated pending policy.
 */
export function aiBudgetPolicyRevision(row: CompanyAiBudgetPolicyRow | null | undefined, monthKey: string): string {
  const parsed = parsePendingBudgetPolicy(row?.pendingBudgetPolicy);
  const version = Number.isSafeInteger(row?.budgetConfigVersion) ? row!.budgetConfigVersion as number : 0;
  return `${version}:${monthKey}:${parsed != null && parsed.effectiveMonthKey <= monthKey ? 'PENDING_ACTIVATED' : 'ACTIVE'}`;
}

/**
 * Decides which policy governs `monthKey`, and whether it is usable at all.
 *
 * A pending policy whose `effectiveMonthKey` has ARRIVED (`<= monthKey`) IS the effective policy —
 * there is no cron and no activation job; the month keys decide. One still in the future is
 * reported in `pending` and changes nothing.
 */
export function resolveAiBudgetPolicy(input: {
  row: CompanyAiBudgetPolicyRow | null | undefined;
  totalSatang: number;
  override: boolean;
  monthKey: string;
  at?: Date;
}): ResolvedAiBudgetPolicy {
  const row = input.row ?? {};
  const parsed = parsePendingBudgetPolicy(row.pendingBudgetPolicy);
  const reached = parsed != null && parsed.effectiveMonthKey <= input.monthKey;

  const activeMode = row.budgetMode ?? 'SHARED';
  const effective = reached
    ? { mode: parsed.mode as string, chat: parsed.chatMonthlyBudgetSatang, ocr: parsed.ocrMonthlyBudgetSatang }
    : { mode: activeMode, chat: row.chatMonthlyBudgetSatang ?? null, ocr: row.ocrMonthlyBudgetSatang ?? null };

  // SHARED's old split columns were informational. Enforcing an old 0 here would close a shop.
  // Existing explicit TOTAL overrides were the operator's AI credit before CHAT had its own cap.
  // Preserve that effective special allowance; new deals only replace the platform default.
  const dealCreditLive = !row.salesDealChatCreditEndsAt || row.salesDealChatCreditEndsAt > (input.at ?? new Date());
  const sharedChatCap = input.override ? input.totalSatang
    : dealCreditLive ? row.salesDealChatCreditSatang ?? DEFAULT_CHAT_CREDIT_SATANG : DEFAULT_CHAT_CREDIT_SATANG;

  const base = {
    totalSatang: input.totalSatang,
    override: input.override,
    chatCapSatang: effective.chat,
    ocrCapSatang: effective.ocr,
    source: (reached ? 'PENDING_ACTIVATED' : 'ACTIVE') as 'ACTIVE' | 'PENDING_ACTIVATED',
    pending: reached ? null : parsed ?? null,
    // One expression for the fence, so the writer's CAS and this read can never drift apart.
    revision: aiBudgetPolicyRevision(row, input.monthKey),
  } as const;

  // Malformed stored state refuses before anything else: a row we cannot read is not a SHARED row.
  if (parsed === null || !isMode(effective.mode) || !isCap(effective.chat) || !isCap(effective.ocr)
    || !isCap(row.salesDealChatCreditSatang ?? null)
    || (row.salesDealChatCreditEndsAt != null && (!(row.salesDealChatCreditEndsAt instanceof Date)
      || Number.isNaN(row.salesDealChatCreditEndsAt.getTime())))) {
    return { ...base, mode: 'SHARED', pending: null, invalidReason: 'POLICY_MALFORMED' };
  }
  if (effective.mode === 'SHARED') return { ...base, mode: 'SHARED', chatCapSatang: sharedChatCap };

  if (effective.chat === null || effective.ocr === null) {
    return { ...base, mode: 'SPLIT', invalidReason: 'SPLIT_CAPS_MISSING' };
  }
  if (effective.chat + effective.ocr > input.totalSatang) {
    return { ...base, mode: 'SPLIT', invalidReason: 'SPLIT_EXCEEDS_TOTAL' };
  }
  return { ...base, mode: 'SPLIT', chatCapSatang: effective.chat, ocrCapSatang: effective.ocr };
}

/**
 * The AI credit a cut-over company gets per package cycle (add-on spec §5.1, Q5): what THIS resolver
 * gives it as CHAT credit at the cycle start — the sales deal's credit while it lasts, an explicit
 * TOTAL override, a SPLIT CHAT cap, or the default 80 — with where it came from. A deal that ends
 * mid-cycle keeps the snapshot to the end of that cycle, because the lot is written once.
 */
export function aiCreditCycleAllowance(input: {
  row: CompanyAiBudgetPolicyRow | null | undefined; totalSatang: number; override: boolean; monthKey: string; at: Date;
}): { units: number; source: 'DEFAULT' | 'SALES_DEAL' | 'TOTAL_OVERRIDE' | 'SPLIT_CHAT_CAP' } {
  const policy = resolveAiBudgetPolicy(input);
  const dealLive = input.row?.salesDealChatCreditSatang != null
    && (!input.row.salesDealChatCreditEndsAt || input.row.salesDealChatCreditEndsAt > input.at);
  return { units: policy.chatCapSatang ?? 0,
    source: policy.mode === 'SPLIT' ? 'SPLIT_CHAT_CAP' : input.override ? 'TOTAL_OVERRIDE' : dealLive ? 'SALES_DEAL' : 'DEFAULT' };
}

/** The wire shape of a resolved policy — one place, so the writer and the admin read agree. */
export function toPartnerAiBudgetPolicyDto(
  policy: ResolvedAiBudgetPolicy,
  splitActivationEnabled: boolean,
): PartnerAiBudgetPolicyDto {
  return {
    mode: policy.mode,
    chatCapSatang: policy.chatCapSatang,
    ocrCapSatang: policy.ocrCapSatang,
    source: policy.source,
    revision: policy.revision,
    pending: policy.pending,
    ...(policy.invalidReason ? { invalidReason: policy.invalidReason } : {}),
    splitActivationEnabled,
  };
}
