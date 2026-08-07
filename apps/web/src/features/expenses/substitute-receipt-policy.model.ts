import type { UpdateSubstituteReceiptPolicyInput } from '@watchdog-bms/contracts';

export function validApproverSelection(approverUserIds: string[], invalidApproverUserIds: string[]): string[] {
  const invalid = new Set(invalidApproverUserIds);
  return approverUserIds.filter((userId) => !invalid.has(userId));
}

export function validateSubstituteReceiptPolicy(input: UpdateSubstituteReceiptPolicyInput): string | null {
  if (input.approvalMode === 'DESIGNATED_APPROVERS' && input.approverUserIds.length === 0) return 'เลือกผู้อนุมัติอย่างน้อย 1 คน';
  if (new Set(input.approverUserIds).size !== input.approverUserIds.length) return 'ผู้อนุมัติต้องไม่ซ้ำกัน';
  if ((input.cashEvidenceInstructions?.trim().length ?? 0) > 500) return 'คำแนะนำหลักฐานเงินสดต้องไม่เกิน 500 ตัวอักษร';
  return null;
}
