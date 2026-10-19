import { PrismaAuditRepository } from '../../audit/infrastructure/prisma-audit.repository';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { INPUT_VAT_REVIEWER_CONDITIONS, expenseEvidenceAssessment, civilPeriodKey, coerceCivilDate, utcDateToCivilDate,
  type DecideExpenseInputVatInput, type ExpenseInputVatDecisionView } from '@watchdog-bms/contracts';
import { deriveInputVatPreset } from '../domain/logic/expense-document.logic';
import { buyerPrintedFields, compareBuyerAsPrinted } from '../domain/logic/buyer-as-printed.logic';
import { OPEN_INPUT_VAT_STATUSES, applyExpenseInputVatPreset, registrationOnDocumentDate } from './expense-input-vat';
import { EXPENSE_VOID_CERTIFICATE_WORDS } from '@watchdog-bms/contracts';

export function inputVatRecordedBeforeReview(expense: any, hasDecision: boolean): boolean {
  return !hasDecision && !OPEN_INPUT_VAT_STATUSES.includes(expense.status)
    && expense.inputVatClaimStatus === 'NON_CLAIMABLE' && ['TAX_INVOICE', 'CUSTOMS_VAT_RECEIPT', 'PP36_RECEIPT'].includes(expense.sourceDocumentType);
}

export function inputVatFixedReason(expense: any, vatStatus: string): string | null {
  const preset = deriveInputVatPreset({ ...expense, vatAmount: expense.vatAmount?.toString(), vatStatus: vatStatus as any });
  if (preset.inputVatClaimStatus === 'NON_CLAIMABLE') return preset.reasonCode;
  const route = expenseEvidenceAssessment(expense)?.route;
  return route === 'SUBSTITUTE_RECEIPT' || route === 'ALTERNATIVE_EVIDENCE' ? 'REPLACEMENT_EVIDENCE_NOT_INPUT_VAT_CLAIMABLE' : null;
}
export function inputVatFixedMessage(reason: string): string {
  if (reason === 'COMPANY_NOT_VAT_REGISTERED_ON_DOCUMENT_DATE') return 'ร้านไม่ได้จด VAT ณ วันที่ของเอกสาร บันทึกรายจ่ายได้โดยไม่ใช้สิทธิภาษีซื้อ';
  if (reason === 'NO_INPUT_VAT') return 'เอกสารนี้ไม่มี VAT จึงใช้สิทธิภาษีซื้อไม่ได้ บันทึกรายจ่ายได้ตามเดิม';
  if (reason === 'ABBREVIATED_TAX_INVOICE_NOT_CREDITABLE') return 'ใบกำกับภาษีอย่างย่อใช้ภาษีซื้อไม่ได้ ขอใบกำกับภาษีเต็มรูปจากผู้ขายถ้าต้องการใช้';
  return 'ไม่ใช่ใบกำกับภาษี จึงใช้ภาษีซื้อไม่ได้ ไม่เกี่ยวกับการเป็นหลักฐานรายจ่าย';
}
const fail = (code: string, message: string): never => { throw new BadRequestException({ code, message }); };
const hasBuyerIdentity = (facts: any): boolean => Boolean(facts.registry?.registeredName?.trim() && facts.registry?.taxId?.trim());
export function validateInputVatDecision(expense: any, facts: any, input: DecideExpenseInputVatInput, userId: string): ExpenseInputVatDecisionView['conditions'] {
  const fixedReason = inputVatFixedReason(expense, facts.vatStatus);
  if (fixedReason) throw new BadRequestException({ code: 'input_vat_fixed', reasonCode: fixedReason, message: inputVatFixedMessage(fixedReason) });
  if (!['CLAIMABLE', 'NON_CLAIMABLE'].includes(input.toStatus)) fail('input_vat_conditions_required', 'เลือกสิทธิภาษีซื้อที่ต้องการบันทึก');
  const reason = input.reason?.trim();
  if ((input.toStatus === 'NON_CLAIMABLE' || facts.latestDecision) && !reason || (reason?.length ?? 0) > 500)
    fail('input_vat_reason_required', input.toStatus === 'NON_CLAIMABLE' ? 'บอกเหตุผลที่ใช้ภาษีซื้อไม่ได้' : 'บอกเหตุผลที่เปลี่ยนสิทธิภาษีซื้อ ไม่เกิน 500 ตัวอักษร');
  const conditions = inputVatConditions(expense, facts, input, userId);
  if (input.toStatus === 'NON_CLAIMABLE') return conditions;
  const failures: Record<string, [string, string]> = {
    SHOP_REGISTERED: ['input_vat_company_registration_unanswered', 'ตอบคำถาม “ร้านจดทะเบียน VAT หรือยัง” ที่ตั้งค่าร้าน › ข้อมูลร้าน ก่อนใช้สิทธิภาษีซื้อ'],
    PAPER_ATTACHED: ['input_vat_attachment_required', 'แนบเอกสารก่อนเลือกใช้สิทธิภาษีซื้อ'],
    SELLER_TAX_ID: ['input_vat_seller_tax_id_required', 'กรอกเลขผู้เสียภาษีผู้ขายให้ครบ 13 หลัก'],
    DOCUMENT_NUMBER: ['input_vat_document_number_required', 'กรอกเลขที่เอกสารก่อนเลือกใช้สิทธิภาษีซื้อ'],
    USABLE_EVIDENCE: ['input_vat_usable_evidence_required', 'ตรวจหลักฐานรายจ่ายให้ใช้ได้ก่อนเลือกใช้สิทธิภาษีซื้อ'],
    BUYER_MATCH: !hasBuyerIdentity(facts) ? ['input_vat_company_identity_required', 'กรอกชื่อจดทะเบียนและเลขผู้เสียภาษีของร้านที่ตั้งค่าร้าน › ข้อมูลร้าน ก่อนใช้สิทธิภาษีซื้อ'] : facts.buyer.matchStatus === 'MISMATCH' ? ['input_vat_buyer_mismatch', 'ชื่อหรือเลขผู้เสียภาษีของร้านบนใบไม่ตรง ขอเอกสารที่ถูกต้องจากผู้ขาย'] : ['input_vat_buyer_confirmation_required', 'ตรวจชื่อและเลขผู้เสียภาษีของร้านบนใบ แล้วติ๊กยืนยันว่าตรงกับข้อมูลร้าน'],
  };
  for (const row of conditions) if (!row.answer) { const refusal = failures[row.code] ?? ['input_vat_conditions_required', 'ติ๊กเงื่อนไขให้ครบก่อนเลือก “ใช้ได้ตามเงื่อนไข”']; fail(...refusal as [string, string]); }
  return conditions;
}

export function inputVatConditions(expense: any, facts: any, input: DecideExpenseInputVatInput, userId: string): ExpenseInputVatDecisionView['conditions'] {
  const conditions: ExpenseInputVatDecisionView['conditions'] = [];
  const condition = (code: string, answer: boolean, fact: unknown, source: 'SYSTEM' | 'REVIEWER' = 'SYSTEM') => conditions.push({ code, answer, fact, source, ...(source === 'REVIEWER' && userId ? { answeredByUserId: userId } : {}) });
  condition('SHOP_REGISTERED', facts.vatStatus === 'REGISTERED', { companyId: expense.companyId, status: facts.vatStatus, expenseDate: expense.expenseDate, registrationFacts: facts.registrationFacts });
  condition('CLAIMABLE_TYPE', !inputVatFixedReason(expense, facts.vatStatus), { sourceDocumentType: expense.sourceDocumentType });
  const originalDocumentAvailable = expenseEvidenceAssessment(expense)?.originalDocumentAvailable === true;
  condition('PAPER_ATTACHED', facts.attachmentIds.length > 0 || originalDocumentAvailable, { attachmentIds: facts.attachmentIds,
    ...(originalDocumentAvailable ? { originalDocumentAvailable: true } : {}) }, !facts.attachmentIds.length && originalDocumentAvailable ? 'REVIEWER' : 'SYSTEM');
  condition('SELLER_TAX_ID', /^\d{13}$/.test(expense.vendorTaxIdSnapshot ?? ''), { vendorTaxIdSnapshot: expense.vendorTaxIdSnapshot });
  condition('DOCUMENT_NUMBER', Boolean(expense.vendorDocumentNumber?.trim()), { vendorDocumentNumber: expense.vendorDocumentNumber });
  condition('USABLE_EVIDENCE', expense.taxEvidenceStatus === 'USABLE_FOR_TAX', { taxEvidenceStatus: expense.taxEvidenceStatus });
  condition('BUYER_MATCH', hasBuyerIdentity(facts) && (facts.buyer.matchStatus === 'MATCH' || facts.buyer.matchStatus !== 'MISMATCH' && input.buyerConfirmed === true),
    { ...facts.buyer, printed: facts.printedBuyer, registry: facts.registry }, facts.buyer.matchStatus === 'MATCH' ? 'SYSTEM' : 'REVIEWER');
  for (const tick of INPUT_VAT_REVIEWER_CONDITIONS) condition(tick.code, input.reviewerConditions?.includes(tick.code) === true, { label: tick.label }, 'REVIEWER');
  return conditions;
}

export async function inputVatDecisionFacts(tx: any, expense: any) {
  const company = await tx.company.findFirstOrThrow({ where: { id: expense.companyId }, select: { taxId: true, registeredName: true, name: true, brandName: true, addressJson: true } });
  const branch = expense.branchId ? await tx.branch.findFirst({ where: { companyId: expense.companyId, id: expense.branchId } }) : null;
  const registry = { ...company, displayName: company.name, branchAddressJson: branch?.addressJson, branchTaxCode: branch?.taxBranchCode ?? null };
  const printedBuyer = buyerPrintedFields(expense.buyerAsPrintedJson ?? expense.aiVerifiedFieldsJson?.buyerAsPrinted);
  const buyer = compareBuyerAsPrinted(printedBuyer, registry, branch?.taxBranchCode ?? null);
  if (buyer.matchStatus === 'MATCH' && (!printedBuyer.name || (printedBuyer.taxId?.replace(/[^0-9๐-๙]/g, '').length ?? 0) !== 13)) buyer.matchStatus = 'UNCHECKED';
  const links = await tx.attachmentLink.findMany({ where: { companyId: expense.companyId, targetType: 'expense.record', targetId: expense.id, purpose: { in: ['expense.receipt.primary', 'expense.receipt.supporting'] } }, select: { attachmentId: true } });
  const ids = [...new Set([expense.primaryAttachmentId, ...links.map((row: any) => row.attachmentId)].filter(Boolean))];
  const attachments = ids.length ? await tx.attachmentObject.findMany({ where: { companyId: expense.companyId, id: { in: ids }, status: 'ACTIVE' }, select: { id: true } }) : [];
  const rows = await tx.companyVatRegistrationFact.findMany({ where: { companyId: expense.companyId }, orderBy: [{ effectiveFrom: 'asc' }, { answeredAt: 'asc' }] });
  const registrationFacts = rows.map((row: any) => ({ ...row, effectiveFrom: utcDateToCivilDate(row.effectiveFrom), effectiveTo: row.effectiveTo ? utcDateToCivilDate(row.effectiveTo) : null }));
  return { registrationFacts, vatStatus: await registrationOnDocumentDate(tx, expense, registrationFacts), attachmentIds: attachments.map((row: any) => row.id), registry, printedBuyer,
    buyer,
    latestDecision: await tx.expenseInputVatDecision.findFirst({ where: { companyId: expense.companyId, expenseId: expense.id }, orderBy: [{ decidedAt: 'desc' }, { id: 'desc' }] }) };
}

export async function assertInputVatDecisionPeriodOpen(tx: any, expense: any) {
  const periodKey = civilPeriodKey(coerceCivilDate(expense.expenseDate));
  // Upsert before locking also serializes with filing when this month has no row yet.
  await tx.taxPeriod.upsert({ where: { companyId_formType_periodKey: { companyId: expense.companyId, formType: 'PP30', periodKey } },
    create: { companyId: expense.companyId, taxType: 'VAT', formType: 'PP30', periodKey, status: 'OPEN' }, update: {} });
  await tx.$executeRaw`SELECT id FROM "TaxPeriod" WHERE "companyId" = ${expense.companyId} AND "formType" = 'PP30' AND "periodKey" = ${periodKey} FOR UPDATE`;
  if (await tx.taxPeriod.findFirst({ where: { companyId: expense.companyId, formType: 'PP30', periodKey, status: { in: ['FILED', 'PAID', 'CLOSED'] } } }))
    throw new ConflictException({ code: 'tax_period_locked', message: EXPENSE_VOID_CERTIFICATE_WORDS.taxPeriodLocked(periodKey) });
  // A posted journal is the authoritative fact, including a shop that later disabled posting.
  if (await tx.journalEntry.findFirst({ where: { companyId: expense.companyId, sourceType: 'expense.record', sourceId: expense.id, status: 'POSTED' } }))
    throw new ConflictException({ code: 'input_vat_posted_journal_immutable', message: 'รายจ่ายนี้ลงบัญชีแล้ว จึงเปลี่ยนสิทธิภาษีซื้อไม่ได้ แม้กลับรายการบัญชีแล้ว' });
}

export async function appendInputVatDecision(tx: any, expense: any, input: { toStatus: string; reason: string | null; conditions: any[]; attachmentIds: string[]; userId: string; requestId?: string }) {
  const latest = await tx.expenseInputVatDecision.findFirst({ where: { companyId: expense.companyId, expenseId: expense.id }, orderBy: [{ decidedAt: 'desc' }, { id: 'desc' }] });
  const decidedAt = new Date(Math.max(Date.now(), (latest?.decidedAt?.getTime() ?? 0) + 1));
  const decision = await tx.expenseInputVatDecision.create({ data: { companyId: expense.companyId, expenseId: expense.id,
    fromStatus: expense.inputVatClaimStatus, toStatus: input.toStatus, reason: input.reason, conditionsJson: JSON.parse(JSON.stringify(input.conditions)),
    evidenceAttachmentIds: input.attachmentIds, decidedByUserId: input.userId, decidedAt } });
  await new PrismaAuditRepository({ client: tx } as any).log({ companyId: expense.companyId, actorUserId: input.userId, action: 'expense.input_vat.decide',
    targetType: 'expense_record', targetId: expense.id, requestId: input.requestId ?? decision.id, result: 'SUCCESS', riskLevel: 'HIGH',
    metadataJson: { decisionId: decision.id, before: expense.inputVatClaimStatus, after: input.toStatus, reason: input.reason, conditions: input.conditions } }, tx);
  return decision;
}



/** Both the review save and the reader reset a judgement when they change the paper's type. */
export async function resetInputVatDecisionForType(tx: any, before: any, next: any, actor: { userId: string; requestId?: string }) {
  if (!OPEN_INPUT_VAT_STATUSES.includes(before.status) || before.sourceDocumentType === next.sourceDocumentType || !before.sourceChannelMetadataJson?.inputVatDecisionId) return null;
  await assertInputVatDecisionPeriodOpen(tx, before);
  const sourceChannelMetadataJson = { ...next.sourceChannelMetadataJson };
  delete sourceChannelMetadataJson.inputVatDecisionId;
  const buyerAsPrintedJson = { ...next.buyerAsPrintedJson };
  delete buyerAsPrintedJson.claimStatusBeforeMark;
  const preset = await applyExpenseInputVatPreset(tx, { ...next, sourceChannelMetadataJson, buyerAsPrintedJson });
  const facts = await inputVatDecisionFacts(tx, next);
  await appendInputVatDecision(tx, before, { toStatus: preset.inputVatClaimStatus, reason: 'เปลี่ยนประเภทเอกสาร',
    conditions: [{ code: 'DOCUMENT_TYPE_CHANGED', source: 'SYSTEM', answer: true, fact: { from: before.sourceDocumentType, to: next.sourceDocumentType } }],
    attachmentIds: facts.attachmentIds, userId: actor.userId, requestId: actor.requestId });
  return { ...preset, inputVatClaimStatus: preset.inputVatClaimStatus, buyerAsPrintedJson, sourceChannelMetadataJson: preset.sourceChannelMetadataJson };
}
