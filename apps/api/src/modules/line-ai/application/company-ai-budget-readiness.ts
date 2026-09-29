/**
 * The ONE readiness projection every admin/ops surface reads (remediation spec §11.4, R-10).
 *
 * Three surfaces used to compare TOTAL spend with the TOTAL budget and then say "receipts can be
 * read" while a `SPLIT` company's OCR cap was already exhausted. This answers the same question
 * from the SAME resolver admission uses plus ONE `readAiBudgetMonthSnapshot`, so the console, the
 * support timeline, the billing previews and the gate can never describe a company differently.
 *
 * Own file on purpose: `company-ai-budget-policy.ts` and `company-ai-usage-meter.ts` already import
 * each other, and `company-ai-budget-reservation.ts` imports both. Nothing imports this one back,
 * so the existing cycle is not widened (`test:boot` stays green).
 *
 * `OK` means only "money is left" (spec §11.4). Without a caller-supplied bound it is never a
 * promise that the next picture can start — the step's own bound, the OCR count quota, the plan
 * quota and the entitlement gates all still apply.
 */
import {
  aiCreditCycleAllowance,
  resolveAiBudgetPolicy,
  type AiBudgetMode,
  type AiBudgetPolicyInvalidReason,
  type CompanyAiBudgetPolicyRow,
} from './company-ai-budget-policy';
import { readAiBudgetMonthSnapshot } from './company-ai-budget-reservation';
import { readAiCreditBalance } from './ai-credit-ledger';

export type AiBudgetScopeReadiness =
  /** Money is left in this scope. NOT a guarantee that any particular step can start. */
  | 'OK'
  /** The cap is reached — nothing more runs in this scope until next Bangkok month. */
  | 'EXHAUSTED'
  /** Money is left, but not this caller's known upper bound. Never call this "full" (spec §12.3). */
  | 'INSUFFICIENT_FOR_KNOWN_BOUND'
  /** A cap of 0: this scope is not allowed at all, or the stored policy refuses spend. */
  | 'CLOSED';

export type AiBudgetReadiness = {
  mode: AiBudgetMode;
  total: AiBudgetScopeReadiness;
  /** Under `SHARED`, the CHAT cap is checked alongside TOTAL; it may be exhausted first. */
  chat: AiBudgetScopeReadiness;
  /** Under `SHARED`, OCR stays inside TOTAL; under `SPLIT`, it has its own cap. */
  ocr: AiBudgetScopeReadiness;
  /** Set => admission is refused for this company/month until an operator fixes the policy. */
  policyInvalid?: AiBudgetPolicyInvalidReason;
  /** Holds whose provider outcome is still unknown; they keep counting until evidence closes them. */
  unresolvedHolds: number;
  /**
   * Credit held by live reservations this company-month, per scope, straight from the snapshot this
   * function already reads. `TOTAL` is CHAT + OCR. Reported so a consumer that needs to say "credit
   * is held" (the billing previews, §5.3 of the credit-wording spec) does not read the snapshot a
   * second time and risk describing a different instant than the scope states above.
   */
  reserved: { TOTAL: number; CHAT: number; OCR: number };
  /**
   * An actual settled above its reserved bound somewhere in this company-month. The snapshot counts
   * it company-wide and cannot attribute it to one bucket, so it is reported beside the scopes
   * rather than folded into them — the admin page is where an operator resolves it.
   */
  breach: boolean;
};

export async function readAiBudgetReadiness(
  tx: any,
  input: {
    companyId: string;
    /** PINNED by the caller, Asia/Bangkok 'YYYY-MM'. */
    monthKey: string;
    /** The `CompanyAiConfiguration` row the caller already read; absent/partial resolves to SHARED. */
    row: CompanyAiBudgetPolicyRow | null | undefined;
    /** The effective total the caller resolved (override, else the platform settings row). */
    totalSatang: number;
    /**
     * This caller's known upper bound in satang, when it has one. Only then may a scope answer
     * `INSUFFICIENT_FOR_KNOWN_BOUND`; pricing stays the reservation engine's job, so the bound is
     * passed in rather than re-derived here from a model and an FX rate.
     */
    boundSatang?: number;
    at?: Date;
  },
): Promise<AiBudgetReadiness> {
  const policy = resolveAiBudgetPolicy({
    row: input.row,
    totalSatang: input.totalSatang,
    // An explicit legacy/admin TOTAL override is also the effective SHARED CHAT cap.
    override: input.row?.monthlyBudgetSatang != null,
    monthKey: input.monthKey,
  });
  const snapshot = await readAiBudgetMonthSnapshot(tx, input.companyId, input.monthKey);

  // `CLOSED` before `EXHAUSTED`: a cap of 0 is "this scope is not allowed", not "the money ran
  // out" — the same distinction `decideAiBudgetStep` makes by refusing at spend 0.
  const scope = (cap: number | null, spent: number, reserved: number): AiBudgetScopeReadiness => {
    if (cap === null) return 'OK';
    if (cap === 0) return 'CLOSED';
    if (spent >= cap) return 'EXHAUSTED';
    if (input.boundSatang !== undefined && spent + reserved + input.boundSatang > cap) {
      return 'INSUFFICIENT_FOR_KNOWN_BOUND';
    }
    return 'OK';
  };
  const total = scope(input.totalSatang, snapshot.spent.TOTAL, snapshot.reserved.TOTAL);
  const base = { mode: policy.mode, unresolvedHolds: snapshot.unresolvedHolds, breach: snapshot.breach,
    reserved: snapshot.reserved };

  // Fail closed, exactly like `reserveAiBudgetStep`: a policy we cannot read is not a SHARED policy,
  // and nothing may start in any scope until an operator fixes it.
  if (policy.invalidReason) {
    return { ...base, total: 'CLOSED', chat: 'CLOSED', ocr: 'CLOSED', policyInvalid: policy.invalidReason };
  }
  return policy.mode === 'SPLIT'
    ? {
      ...base,
      total,
      chat: scope(policy.chatCapSatang, snapshot.spent.CHAT, snapshot.reserved.CHAT),
      ocr: scope(policy.ocrCapSatang, snapshot.spent.OCR, snapshot.reserved.OCR),
    }
    : {
      ...base,
      total,
      // Add-on spec §18.3: after cutover the calendar CHAT cap is gone (admission funds from AI
      // credit lots), so CHAT is only as ready as TOTAL — the same rule `reserveAiBudgetStep` uses.
      chat: input.row?.aiCreditCutoverAt && input.row.aiCreditCutoverAt <= (input.at ?? new Date())
        ? total : scope(policy.chatCapSatang, snapshot.spent.CHAT, snapshot.reserved.CHAT),
      ocr: total,
    };
}

export type AiCreditSalesReadiness = {
  ready: boolean;
  /** Why not: legacy shop, no paid cycle now (D3/D2), unreadable policy, or not enough TOTAL room. */
  reason: 'NOT_CUT_OVER' | 'NO_PAID_CYCLE' | 'POLICY_INVALID' | 'TOTAL_HEADROOM' | null;
  /** This Bangkok month's TOTAL minus spend and live holds. */
  headroomSatang: number;
  /** AI credit the company holds now (package + added), in units = satang of CHAT cost. */
  commercialUnits: number;
};

/**
 * Add-on spec §5.3 (F-18) and §8.4: AI credit may be sold only when this month's TOTAL headroom
 * covers what the company already holds plus the pack, so nothing is sold that the safety cap
 * would then refuse. Also what a cap writer checks before lowering a total under held credit (C6).
 * Read-only — the quote and checkout (plan PR E) evaluate it again at their own instant.
 */
export async function readAiCreditSalesReadiness(tx: any, input: {
  companyId: string; monthKey: string; at: Date; row: CompanyAiBudgetPolicyRow | null | undefined; totalSatang: number; packUnits: number;
}): Promise<AiCreditSalesReadiness> {
  const none = { headroomSatang: 0, commercialUnits: 0 };
  if (!input.row?.aiCreditCutoverAt || input.row.aiCreditCutoverAt > input.at) return { ready: false, reason: 'NOT_CUT_OVER', ...none };
  const override = input.row.monthlyBudgetSatang != null;
  if (resolveAiBudgetPolicy({ row: input.row, totalSatang: input.totalSatang, override, monthKey: input.monthKey }).invalidReason) {
    return { ready: false, reason: 'POLICY_INVALID', ...none };
  }
  const balance = await readAiCreditBalance(tx, { companyId: input.companyId, at: input.at,
    allowance: (cycle) => aiCreditCycleAllowance({ row: input.row, totalSatang: input.totalSatang, override, monthKey: input.monthKey, at: cycle.start }) });
  if (!balance.cycle) return { ready: false, reason: 'NO_PAID_CYCLE', ...none };
  const snapshot = await readAiBudgetMonthSnapshot(tx, input.companyId, input.monthKey);
  const headroomSatang = input.totalSatang - snapshot.spent.TOTAL - snapshot.reserved.TOTAL;
  const commercialUnits = balance.totalRemainingUnits;
  const ready = headroomSatang >= commercialUnits + input.packUnits;
  return { ready, reason: ready ? null : 'TOTAL_HEADROOM', headroomSatang, commercialUnits };
}
