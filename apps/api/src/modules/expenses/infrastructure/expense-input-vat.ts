import { BadRequestException } from '@nestjs/common';
import { expenseEvidenceAssessment, utcDateToCivilDate } from '@watchdog-bms/contracts';
import { effectiveVatStatus, type VatFactRow } from '../../data-model-core/domain/logic/company-vat-registration.logic';
import { deriveInputVatPreset } from '../domain/logic/expense-document.logic';
import { validateDomesticInputVatEvidence } from '../domain/logic/expense-status.logic';

export const INPUT_VAT_NOT_REGISTERED_REASON = 'ร้านไม่ได้จด VAT ณ วันที่ของเอกสาร';
export const OPEN_INPUT_VAT_STATUSES = ['DRAFT', 'EXTRACTING', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'];

export async function registrationOnDocumentDate(tx: any, expense: any, facts?: VatFactRow[]) {
  const rows = facts ?? (await tx.companyVatRegistrationFact.findMany({
    where: { companyId: expense.companyId }, orderBy: [{ effectiveFrom: 'asc' }, { answeredAt: 'asc' }],
  })).map((row: any) => ({ ...row, effectiveFrom: utcDateToCivilDate(row.effectiveFrom), effectiveTo: row.effectiveTo ? utcDateToCivilDate(row.effectiveTo) : null }));
  return expense.expenseDate ? effectiveVatStatus(rows, utcDateToCivilDate(new Date(expense.expenseDate))) : 'UNKNOWN';
}

/** All capture paths meet here. The metadata pointer marks an active human judgement;
 * type resets and undo-to-waiting clear it while retaining their rows in the decision history. */
export async function applyExpenseInputVatPreset(tx: any, expense: any, facts?: VatFactRow[]): Promise<Record<string, any>> {
  if (expense.status && !OPEN_INPUT_VAT_STATUSES.includes(expense.status)) return {};
  const vatStatus = await registrationOnDocumentDate(tx, expense, facts);
  const preset = deriveInputVatPreset({ ...expense, vatAmount: expense.vatAmount?.toString(), vatStatus });
  const route = expenseEvidenceAssessment(expense)?.route;
  if (vatStatus !== 'NOT_REGISTERED' && (route === 'SUBSTITUTE_RECEIPT' || route === 'ALTERNATIVE_EVIDENCE')) {
    preset.inputVatClaimStatus = 'NON_CLAIMABLE';
    preset.reasonCode = 'REPLACEMENT_EVIDENCE_NOT_INPUT_VAT_CLAIMABLE';
  }
  if ((expense.buyerAsPrintedJson?.claimStatusBeforeMark || expense.sourceChannelMetadataJson?.inputVatDecisionId) && preset.inputVatClaimStatus === 'NEEDS_REVIEW') return {};
  return { inputVatClaimStatus: preset.inputVatClaimStatus,
    sourceChannelMetadataJson: { ...expense.sourceChannelMetadataJson, inputVatPresetReasonCode: preset.reasonCode } };
}

/** The legacy buyer-mark undo still meets the document integrity rules before restoration. */
export async function assertInputVatRestoreAllowed(tx: any, expense: any): Promise<void> {
  if (expense.vatMode === 'NO_VAT' || Number(expense.vatAmount ?? 0) === 0) throw new BadRequestException({
    code: 'input_vat_no_vat_to_claim', message: 'เอกสารนี้ไม่มี VAT จึงใช้สิทธิภาษีซื้อไม่ได้ บันทึกรายจ่ายได้ตามเดิม',
  });
  const code = validateDomesticInputVatEvidence({ ...expense, lines: [], vatStatus: await registrationOnDocumentDate(tx, expense) });
  if (code === 'input_vat_company_registration_unanswered') throw new BadRequestException({ code,
    message: 'ตอบคำถาม “ร้านจดทะเบียน VAT หรือยัง” ที่ตั้งค่าร้าน › ข้อมูลร้าน ก่อนใช้สิทธิภาษีซื้อ' });
  if (code === 'input_vat_not_available_company_not_vat_registered') throw new BadRequestException({ code,
    message: `${INPUT_VAT_NOT_REGISTERED_REASON} บันทึกรายจ่ายได้โดยไม่ใช้สิทธิภาษีซื้อ` });
  if (code) throw new BadRequestException(code);
}

export async function recomputeCompanyExpenseInputVat(tx: any, companyId: string, facts: VatFactRow[]): Promise<void> {
  const expenses = await tx.expenseRecord.findMany({ where: { companyId, status: { in: OPEN_INPUT_VAT_STATUSES } } });
  for (const expense of expenses) {
    if (expense.buyerAsPrintedJson?.claimStatusBeforeMark || expense.sourceChannelMetadataJson?.inputVatDecisionId) continue;
    const data = await applyExpenseInputVatPreset(tx, expense, facts);
    if (data.inputVatClaimStatus === expense.inputVatClaimStatus
      && data.sourceChannelMetadataJson?.inputVatPresetReasonCode === expense.sourceChannelMetadataJson?.inputVatPresetReasonCode) continue;
    if (Object.keys(data).length) await tx.expenseRecord.updateMany({ where: { id: expense.id, companyId, status: { in: OPEN_INPUT_VAT_STATUSES }, updatedAt: expense.updatedAt }, data });
  }
}
