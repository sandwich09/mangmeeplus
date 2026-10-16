import type { WhtPayerMode, WhtPaymentEstablishment } from '@watchdog-bms/contracts';

export type WhtPayerModeFact = {
  id: string; mode: string; effectiveFromPeriodKey: string; answeredAt: Date; supersededAt: Date | null;
};
export type WhtPayerBranch = { id: string; name: string; type: string; status: string; taxBranchCode: string | null };

/** Start-month boundaries remain in history; only a corrected same-month answer is superseded. */
export function whtPayerModeInForce(facts: readonly WhtPayerModeFact[], month: string): WhtPayerMode | null {
  const fact = facts.filter(f => !f.supersededAt && f.effectiveFromPeriodKey <= month)
    .sort((a, b) => b.effectiveFromPeriodKey.localeCompare(a.effectiveFromPeriodKey)
      || b.answeredAt.getTime() - a.answeredAt.getTime() || b.id.localeCompare(a.id))[0];
  return fact?.mode === 'HEAD_OFFICE_PAYS_ALL' || fact?.mode === 'EACH_BRANCH_PAYS' ? fact.mode : null;
}

/** Attribution only: never rejects the payment or changes an existing paper. */
export function resolveWhtEstablishment(mode: WhtPayerMode | null, branches: readonly WhtPayerBranch[], paymentBranchId: string | null): WhtPaymentEstablishment {
  const active = branches.filter(b => b.status === 'ACTIVE');
  const head = active.find(b => b.type === 'HEAD_OFFICE') ?? branches.find(b => b.type === 'HEAD_OFFICE');
  if (active.length > 1 && !mode) return { kind: 'SHOP_HAS_NOT_ANSWERED' };
  const useHead = active.length <= 1 || mode === 'HEAD_OFFICE_PAYS_ALL' || !paymentBranchId;
  const branch = useHead ? head : branches.find(b => b.id === paymentBranchId);
  const code = useHead || branch?.type === 'HEAD_OFFICE' ? branch?.taxBranchCode ?? '00000' : branch?.taxBranchCode;
  if (!code || !/^\d{5}$/.test(code)) return { kind: 'BRANCH_HAS_NO_CODE', branchId: branch?.id ?? paymentBranchId };
  return { kind: 'ESTABLISHMENT', code, branchId: branch?.id ?? null, name: branch?.type === 'HEAD_OFFICE' || useHead ? 'สำนักงานใหญ่' : branch!.name };
}

export function monthAfter(month: string): string {
  const [year, value] = month.split('-').map(Number);
  return value === 12 ? `${year + 1}-01` : `${year}-${String(value + 1).padStart(2, '0')}`;
}
