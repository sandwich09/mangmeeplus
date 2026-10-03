import { THAI_SYSTEM_ROLE_NAMES } from '@watchdog-bms/contracts';

export type DiscountOverrideRole = 'owner' | 'manager' | 'any';

export type DiscountStepField = 'defaultPct' | 'maxPct' | 'vipPct' | 'regularPct';

export type DiscountPolicyState = {
  allowAuto: boolean;
  defaultPct: number;
  maxPct: number;
  vipPct: number;
  regularPct: number;
  overrideRole: DiscountOverrideRole;
  saved: boolean;
};

export const DISCOUNT_POLICY_DEFAULTS: DiscountPolicyState = {
  allowAuto: true,
  defaultPct: 10,
  maxPct: 20,
  vipPct: 15,
  regularPct: 10,
  overrideRole: 'manager',
  saved: true,
};

export const DISCOUNT_OVERRIDE_OPTIONS: Array<{ id: DiscountOverrideRole; label: string }> = [
  { id: 'owner', label: `${THAI_SYSTEM_ROLE_NAMES.OWNER}เท่านั้น` },
  { id: 'manager', label: `${THAI_SYSTEM_ROLE_NAMES.OWNER}และ${THAI_SYSTEM_ROLE_NAMES.MANAGER}` },
  // 'any' keeps no role out, and no role ranks above another, so this option names every role.
  { id: 'any', label: 'ทุกบทบาท' },
];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Prototype bounds: default 0..max · max default..50 · vip/regular 0..max. */
export function stepDiscountPolicy(
  state: DiscountPolicyState,
  field: DiscountStepField,
  delta: 1 | -1,
): DiscountPolicyState {
  const bounds: Record<DiscountStepField, [number, number]> = {
    defaultPct: [0, state.maxPct],
    maxPct: [state.defaultPct, 50],
    vipPct: [0, state.maxPct],
    regularPct: [0, state.maxPct],
  };
  const [min, max] = bounds[field];
  // ponytail: like the prototype's markDirty, a clamped no-op click still marks dirty
  return { ...state, [field]: clamp(state[field] + delta, min, max), saved: false };
}

export function toggleDiscountAllowAuto(state: DiscountPolicyState): DiscountPolicyState {
  return { ...state, allowAuto: !state.allowAuto, saved: false };
}

export function setDiscountOverrideRole(
  state: DiscountPolicyState,
  overrideRole: DiscountOverrideRole,
): DiscountPolicyState {
  return { ...state, overrideRole, saved: false };
}

export function saveDiscountPolicy(state: DiscountPolicyState): DiscountPolicyState {
  return { ...state, saved: true };
}
