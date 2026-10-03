import type { PoApprovalRule as PoApprovalPolicyRule } from '@watchdog-bms/contracts';
import type { MangmeeTone } from '@/common/components/mangmee';
import { roleKeyDisplayName } from './role-picker.logic';

export type PoApprovalRule = PoApprovalPolicyRule & {
  step: number;
  conditionLabel: string;
  inputValue?: string;
  badgeLabel: string;
  badgeTone: MangmeeTone;
  approverLabel: string;
  stepTone: MangmeeTone;
};

export type PoApprovalDemo = {
  rule: PoApprovalRule;
  amount: number;
  statusLabel: string;
  steps: string[];
};

const RULE_TONES = ['brand', 'sky', 'amber', 'purple', 'teal'] as const satisfies readonly MangmeeTone[];

export function parseApprovalAmount(value: string): number {
  const numericValue = Number(value.replace(/[^\d.]/g, ''));
  if (!Number.isFinite(numericValue) || numericValue < 0) return 0;
  return numericValue;
}

export function formatBahtAmount(amount: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(amount);
}

export function poApprovalConditionLabel(rule: PoApprovalPolicyRule): string {
  if (rule.minExclusive === undefined) return 'ยอดไม่เกิน';
  if (rule.maxInclusive === undefined) return `มากกว่า ฿${formatBahtAmount(rule.minExclusive)}`;
  return `มากกว่า ฿${formatBahtAmount(rule.minExclusive)} ถึง`;
}

// A tier with no approver role needs no approval: that is all the rule says, so no word claims the system approves it.
const NO_APPROVAL = 'ไม่ต้องอนุมัติ';

/** A tier's approver roles by their names in the one list; any one of them approves, hence "หรือ". */
function approverNames(approverRoleKeys: readonly string[]): string {
  return approverRoleKeys.map((key) => roleKeyDisplayName(key)).join(' หรือ ');
}

export function poApprovalBadgeLabel(approverRoleKeys: readonly string[]): string {
  if (approverRoleKeys.length === 0) return NO_APPROVAL;
  if (approverRoleKeys.length === 1) return roleKeyDisplayName(approverRoleKeys[0]!);
  return `คนใดคนหนึ่งใน ${approverRoleKeys.length} บทบาท`;
}

export function derivePoApprovalRules(rules: readonly PoApprovalPolicyRule[]): PoApprovalRule[] {
  return rules.map((rule, index) => {
    const tone = RULE_TONES[index % RULE_TONES.length]!;
    return {
      ...rule,
      approverRoleKeys: [...rule.approverRoleKeys],
      step: index + 1,
      conditionLabel: poApprovalConditionLabel(rule),
      ...(rule.maxInclusive === undefined ? {} : { inputValue: String(rule.maxInclusive) }),
      badgeLabel: poApprovalBadgeLabel(rule.approverRoleKeys),
      badgeTone: tone,
      approverLabel: rule.approverRoleKeys.length ? approverNames(rule.approverRoleKeys) : `ไม่มี (${NO_APPROVAL})`,
      stepTone: tone,
    };
  });
}

const DEFAULT_POLICY_RULES: PoApprovalPolicyRule[] = [
  { id: 'auto', maxInclusive: 1000, approverRoleKeys: [] },
  { id: 'manager', minExclusive: 1000, maxInclusive: 10000, approverRoleKeys: ['MANAGER'] },
  { id: 'owner-or-manager', minExclusive: 10000, approverRoleKeys: ['MANAGER', 'OWNER'] },
];

export const PO_APPROVAL_RULES: PoApprovalRule[] = derivePoApprovalRules(DEFAULT_POLICY_RULES);

function toPolicyRule(rule: PoApprovalRule): PoApprovalPolicyRule {
  return {
    id: rule.id,
    ...(rule.minExclusive === undefined ? {} : { minExclusive: rule.minExclusive }),
    ...(rule.maxInclusive === undefined ? {} : { maxInclusive: rule.maxInclusive }),
    approverRoleKeys: [...rule.approverRoleKeys],
  };
}

export function splitOpenEndedPoApprovalRule(
  rules: readonly PoApprovalRule[],
  amount: number,
  newRuleId: string,
): PoApprovalRule[] | null {
  const last = rules[rules.length - 1];
  if (
    !last
    || last.maxInclusive !== undefined
    || !Number.isFinite(amount)
    || amount <= (last.minExclusive ?? -1)
    || rules.some((rule) => rule.id === newRuleId)
  ) return null;

  const policyRules = rules.map(toPolicyRule);
  const openEnded = policyRules[policyRules.length - 1]!;
  return derivePoApprovalRules([
    ...policyRules.slice(0, -1),
    { ...openEnded, id: newRuleId, maxInclusive: amount },
    { ...openEnded, minExclusive: amount },
  ]);
}

export function removePoApprovalRule(rules: readonly PoApprovalRule[], ruleId: string): PoApprovalRule[] {
  if (rules.length <= 1) return [...rules];
  const index = rules.findIndex((rule) => rule.id === ruleId);
  if (index < 0) return [...rules];

  const policyRules = rules.map(toPolicyRule);
  const removed = policyRules[index]!;
  if (index === policyRules.length - 1) {
    const { maxInclusive: _maxInclusive, ...previousOpenEnded } = policyRules[index - 1]!;
    policyRules[index - 1] = previousOpenEnded;
  } else {
    const { minExclusive: _minExclusive, ...nextWithoutMin } = policyRules[index + 1]!;
    policyRules[index + 1] = removed.minExclusive === undefined
      ? nextWithoutMin
      : { ...nextWithoutMin, minExclusive: removed.minExclusive };
  }
  policyRules.splice(index, 1);
  return derivePoApprovalRules(policyRules);
}

export function getPoApprovalRuleForAmount(
  amount: number,
  rules: PoApprovalRule[] = PO_APPROVAL_RULES,
): PoApprovalRule {
  return rules.find((rule) => {
    const aboveMin = rule.minExclusive === undefined || amount > rule.minExclusive;
    const belowMax = rule.maxInclusive === undefined || amount <= rule.maxInclusive;
    return aboveMin && belowMax;
  }) ?? rules[rules.length - 1] ?? PO_APPROVAL_RULES[PO_APPROVAL_RULES.length - 1]!;
}

export function getPoApprovalDemo(
  value: string | number,
  rules: PoApprovalRule[] = PO_APPROVAL_RULES,
): PoApprovalDemo {
  const amount = typeof value === 'number' ? value : parseApprovalAmount(value);
  const rule = getPoApprovalRuleForAmount(amount, rules);
  const noApprover = rule.approverRoleKeys.length === 0;

  return {
    rule,
    amount,
    statusLabel: noApprover ? NO_APPROVAL : `รอ${rule.approverLabel}อนุมัติ`,
    steps: [
      `สร้างใบสั่งซื้อ ฿${formatBahtAmount(amount)} — เข้าเงื่อนไขขั้นที่ ${rule.step}`,
      noApprover ? 'ขั้นนี้ไม่ต้องรอใครอนุมัติ' : `ส่งให้${rule.approverLabel}อนุมัติ`,
      'สร้างรายการซื้อ/รายจ่ายของวันนั้นใน “ค่าใช้จ่าย+ใบเสร็จ”',
    ],
  };
}
