import { INPUT_VAT_REVIEWER_CONDITIONS, INPUT_VAT_RIGHT_LABELS, type ExpenseInputVatRightView, type InputVatClaimStatus } from '@watchdog-bms/contracts';

type RightSource = { inputVatClaimStatus: InputVatClaimStatus; inputVatRight?: ExpenseInputVatRightView };
export function inputVatRightLabel(detail: RightSource): string {
  return detail.inputVatRight?.reasonCode === 'RECORDED_BEFORE_INPUT_VAT_DECISION'
    ? 'ไม่ได้ใช้ภาษีซื้อ (บันทึกก่อนมีการตรวจสิทธิ)'
    : INPUT_VAT_RIGHT_LABELS[detail.inputVatRight?.status ?? detail.inputVatClaimStatus];
}
export function showInputVatQuestion(detail: { vatAmount: string; inputVatRight?: ExpenseInputVatRightView }): boolean {
  return Number(detail.vatAmount) > 0 && detail.inputVatRight?.vatStatus !== 'NOT_REGISTERED';
}
export const INPUT_VAT_FIXED_REASONS: Record<string, string> = {
  ABBREVIATED_TAX_INVOICE_NOT_CREDITABLE: 'ใบกำกับภาษีอย่างย่อใช้ภาษีซื้อไม่ได้ ขอใบกำกับภาษีเต็มรูปจากผู้ขายถ้าต้องการใช้',
  DOCUMENT_NOT_INPUT_VAT_CLAIMABLE: 'ไม่ใช่ใบกำกับภาษี จึงใช้ภาษีซื้อไม่ได้ ไม่เกี่ยวกับการเป็นหลักฐานรายจ่าย',
  REPLACEMENT_EVIDENCE_NOT_INPUT_VAT_CLAIMABLE: 'ใช้หลักฐานแทนใบเสร็จ จึงใช้ภาษีซื้อไม่ได้ ไม่เกี่ยวกับการเป็นหลักฐานรายจ่าย',
  COMPANY_NOT_VAT_REGISTERED_ON_DOCUMENT_DATE: 'ร้านไม่ได้จด VAT ณ วันที่ของเอกสาร',
  NO_INPUT_VAT: 'เอกสารนี้ไม่มี VAT',
};
export const INPUT_VAT_POSTED_NOTICE = 'รายจ่ายนี้ลงบัญชีแล้ว จึงเปลี่ยนสิทธิภาษีซื้อไม่ได้ แม้กลับรายการบัญชีแล้ว';
export const INPUT_VAT_LEDGER_BEFORE_CONFIRM = 'ร้านนี้ลงบัญชีเมื่อยืนยันเอกสาร ถ้าต้องการใช้ภาษีซื้อ ให้ตรวจสิทธิภาษีซื้อก่อนยืนยัน';

/** Lists use the server's document-date fact, never today's registration status. */
export function showListedInputVatRight(row: { vatAmount: string; inputVatRightVisible?: boolean }): boolean {
  return Number(row.vatAmount) > 0 && row.inputVatRightVisible === true;
}

/** JSON facts can arrive with different object-key order after storage. */
function factText(fact: unknown): string | undefined {
  return JSON.stringify(fact, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);
}
export function inputVatChangedConditions(right?: ExpenseInputVatRightView): string[] {
  return (right?.conditions ?? []).filter(condition => {
    const saved = right?.latestDecision?.conditions?.find(previous => previous.code === condition.code);
    return saved && factText(saved.fact) !== factText(condition.fact);
  }).map(condition => condition.code);
}
export function savedInputVatAnswers(right?: ExpenseInputVatRightView) {
  const changed = inputVatChangedConditions(right);
  const answers = (right?.latestDecision?.conditions ?? []).filter(condition => condition.answer && !changed.includes(condition.code));
  return { ticks: INPUT_VAT_REVIEWER_CONDITIONS.filter(tick => answers.some(answer => answer.code === tick.code)).map(tick => tick.code as string),
    buyerConfirmed: answers.some(answer => answer.code === 'BUYER_MATCH' && answer.source === 'REVIEWER') };
}
