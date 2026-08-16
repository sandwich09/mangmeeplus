import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { ExpensePaymentMethod, LineSubstituteReceiptPrefill, RequestContext, SubstituteReceiptReasonCode } from '@watchdog-bms/contracts';
import { extractValueCandidates, isAmbiguousDateCandidate } from '@watchdog-bms/contracts';
import type { ExpenseRecordWithRelations } from '../../domain/models/expense.model';
import { PrismaExpenseRepository } from '../../infrastructure/prisma-expense.repository';
import { collectSubstituteReceiptEligibilityIssues } from './substitute-receipt.use-case';

const STATE_KEY = 'lineSubstituteReceiptContinuation';
const ACTIVE_STATUSES = new Set(['OPEN', 'PAUSED']);
const MAX_VALUE_LENGTH = 500;

export type LineSubstituteReceiptValues = {
  reasonCode?: SubstituteReceiptReasonCode;
  missingReceiptReason?: string;
  businessPurpose?: string;
  payerUserId?: string;
  payeeName?: string;
  paymentDate?: string;
  paymentMethod?: ExpensePaymentMethod;
  itemDescription?: string;
  amount?: string;
  expenseCategoryId?: string;
};

export type LineSubstituteReceiptContinuation = {
  workflowId: string;
  kind: 'SUBSTITUTE_RECEIPT';
  companyId: string;
  userId: string;
  expenseId: string;
  chatKeyHash: string;
  status: 'OPEN' | 'PAUSED' | 'CANCELLED' | 'CONSUMED';
  acceptedValues: LineSubstituteReceiptValues;
  provenance: Record<string, { source: 'LINE_USER_TEXT'; acceptedAt: string; messageHash: string }>;
  resolvedFields: string[];
  missingFields: string[];
  attachmentRefs: string[];
  pendingQuestion: string | null;
  targetRevision: string;
  lastActivityAt: string;
};

export type LineSubstituteReceiptBlocker = { code: string; message: string; collectableInLine: boolean };

export type LineSubstituteReceiptContinuationResult = {
  handled: true;
  status: 'READY_FOR_WEB' | 'BLOCKED' | 'INELIGIBLE' | 'TARGET_REQUIRED' | 'PAUSED' | 'CANCELLED' | 'STALE';
  replyText: string;
  workflowId?: string;
  expenseId?: string;
  acceptedFields: string[];
  blockers: LineSubstituteReceiptBlocker[];
  pendingQuestion?: string;
  webPath?: string;
  policy?: { configured: boolean; ready: boolean; approvalMode: 'OWNER_SELF' | 'DESIGNATED_APPROVERS' };
};

export function isSubstituteReceiptConversationText(text: string): boolean {
  const normalized = text.normalize('NFKC').toLocaleLowerCase('th-TH');
  return /(ใบรับรองแทนใบเสร็จ(?:รับเงิน)?|ใบทดแทนใบเสร็จ|ใบแทนใบเสร็จ|ทำใบรับรองต่อ)/u.test(normalized);
}

function normalizedText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function bounded(value: string | undefined, max = MAX_VALUE_LENGTH): string | undefined {
  const text = value && normalizedText(value);
  return text && text.length <= max ? text : undefined;
}

function labeled(text: string, labels: string): string | undefined {
  const match = text.match(new RegExp(`(?:^|\\n)\\s*(?:${labels})\\s*(?::|คือ|เป็น)?\\s*([^,;\\n]+)`, 'imu'));
  return bounded(match?.[1]);
}

function paymentMethodOf(text: string): ExpensePaymentMethod | undefined {
  if (/(เงินสด|cash)/iu.test(text)) return 'CASH';
  if (/(โอน|bank\s*transfer|พร้อมเพย์)/iu.test(text)) return 'BANK_TRANSFER';
  if (/(บัตร|card)/iu.test(text)) return 'CARD';
  if (/(เช็ค|เช็ก|cheque|check)/iu.test(text)) return 'CHEQUE';
  return undefined;
}

function nonQuestionLines(text: string): string {
  return text.split(/\n+/u)
    .filter((line) => !/[?？]|ไหม|อย่างไร|ยังไง|ถ้า/u.test(line))
    .join('\n');
}

function reasonCodeOf(text: string): SubstituteReceiptReasonCode | undefined {
  if (/(ผู้ขาย|ผู้รับเงิน|ร้าน).*(ออก|ให้).*(ไม่ได้|ไม่ออก)|ไม่สามารถออก/u.test(text)) return 'PAYEE_CANNOT_ISSUE';
  if (/(ชำรุด|ไม่ครบ|ข้อมูลไม่ครบ|อ่านไม่ออก)/u.test(text)) return 'RECEIPT_MATERIALLY_INCOMPLETE';
  if (/(ไม่มีใบเสร็จ|ใบเสร็จหาย|ไม่ได้รับใบเสร็จ|หาใบเสร็จไม่เจอ)/u.test(text)) return 'RECEIPT_UNAVAILABLE';
  return undefined;
}

function firstPaymentDate(text: string): string | undefined {
  if (!/(วันที่จ่าย|วันที่ชำระ|ชำระเมื่อ|จ่ายเมื่อ)/u.test(text)) return undefined;
  return extractValueCandidates(text).dates.find((candidate) => !isAmbiguousDateCandidate(candidate))?.isoDate;
}

function messageHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function ordinalSelection(text: string, count: number): number | null {
  const match = normalizedText(text).match(/^(?:รายการ|ข้อ|อัน(?:ที่)?)?\s*(\d{1,2})$/u);
  if (!match) return null;
  const index = Number(match[1]) - 1;
  return index >= 0 && index < count ? index : null;
}

function parseState(value: unknown): LineSubstituteReceiptContinuation | null {
  if (!value || typeof value !== 'object') return null;
  const state = value as Partial<LineSubstituteReceiptContinuation>;
  if (state.kind !== 'SUBSTITUTE_RECEIPT' || typeof state.workflowId !== 'string'
    || typeof state.companyId !== 'string' || typeof state.userId !== 'string'
    || typeof state.expenseId !== 'string' || typeof state.chatKeyHash !== 'string'
    || !state.status || !state.acceptedValues || !state.provenance
    || typeof state.targetRevision !== 'string') return null;
  return state as LineSubstituteReceiptContinuation;
}

function stateFromMetadata(metadata: Record<string, unknown> | null): LineSubstituteReceiptContinuation | null {
  return parseState(metadata?.[STATE_KEY]);
}

function extractValues(
  text: string,
  pendingField: string | null,
  currentUserId: string,
  activeCategories: Array<{ id: string; name: string }>,
): LineSubstituteReceiptValues {
  const values: LineSubstituteReceiptValues = {};
  const declarative = nonQuestionLines(text);
  const reasonCode = reasonCodeOf(declarative);
  if (reasonCode) values.reasonCode = reasonCode;
  const missingReceiptReason = labeled(text, 'เหตุผล(?:ที่ไม่มีใบเสร็จ)?|สาเหตุ');
  if (missingReceiptReason) values.missingReceiptReason = missingReceiptReason;
  const businessPurpose = labeled(text, 'วัตถุประสงค์(?:ทางธุรกิจ)?|ใช้เพื่อ');
  if (businessPurpose) values.businessPurpose = businessPurpose;
  const payeeName = labeled(text, 'ผู้รับเงิน|ผู้ขาย|ร้านค้า');
  if (payeeName) values.payeeName = payeeName;
  if (/(ฉัน|ผม|ดิฉัน|หนู).*(เป็น|คือ).*(ผู้จ่าย|คนจ่าย)|ผู้จ่าย(?:เงิน)?\s*(?:คือ|เป็น)?\s*(ฉัน|ผม|ดิฉัน|หนู)/u.test(declarative)) {
    values.payerUserId = currentUserId;
  }
  const labeledPayment = labeled(declarative, 'วิธีชำระ(?:เงิน)?|ชำระด้วย|จ่ายด้วย');
  const plainPayment = pendingField === 'paymentMethod' && normalizedText(declarative).length <= 40
    ? declarative
    : undefined;
  const paymentMethod = paymentMethodOf(labeledPayment ?? plainPayment ?? '');
  if (paymentMethod) values.paymentMethod = paymentMethod;
  const paymentDate = firstPaymentDate(text);
  if (paymentDate) values.paymentDate = paymentDate;
  const itemDescription = labeled(text, 'รายการ|รายละเอียดรายการ');
  if (itemDescription) values.itemDescription = itemDescription;
  const amountLabel = labeled(text, 'ยอด(?:รวม)?|จำนวนเงิน');
  if (amountLabel) {
    const amount = extractValueCandidates(amountLabel).amounts[0]?.value;
    if (amount) values.amount = amount;
  }
  const categoryLabel = labeled(text, 'หมวด(?:ค่าใช้จ่าย)?');
  if (categoryLabel) {
    const wanted = normalizedText(categoryLabel).toLocaleLowerCase('th-TH');
    const category = activeCategories.find((item) => normalizedText(item.name).toLocaleLowerCase('th-TH') === wanted);
    if (category) values.expenseCategoryId = category.id;
  }

  // A short unlabeled answer is accepted only for the exact source-generated pending question.
  const plain = bounded(text, 200);
  if (plain && Object.keys(values).length === 0 && !/[?？]|ไหม|หรือไม่|อย่างไร|ยังไง/u.test(plain)) {
    if (pendingField === 'missingReceiptReason') values.missingReceiptReason = plain;
    if (pendingField === 'businessPurpose') values.businessPurpose = plain;
    if (pendingField === 'payeeName') values.payeeName = plain;
  }
  return values;
}

function groundedSideAnswer(expense: ExpenseRecordWithRelations, text: string): string | undefined {
  if (/(vat|ภาษีมูลค่าเพิ่ม|ภาษีซื้อ|เคลมภาษี|เครดิตภาษี)/iu.test(text)
    && /[?？]|ไหม|ได้หรือไม่|อย่างไร|ยังไง/u.test(text)) {
    return [
      `คำถามแทรก — VAT: รายการปัจจุบันมีสถานะหลักฐานภาษี ${expense.taxEvidenceStatus ?? 'รอตรวจสอบ'}`,
      'ใบรับรองแทนใบเสร็จรับเงินเป็นหลักฐานภายใน ไม่ใช่ใบกำกับภาษีจากผู้ขาย และไม่ทำให้ VAT ซื้อกลายเป็นเครดิตภาษีได้',
      'หากมีใบกำกับภาษีจากผู้ขาย ให้แนบในรายการและให้ผู้มีสิทธิ์ตรวจสอบในเว็บ',
    ].join('\n');
  }
  if (/(ใบนี้|เอกสารนี้).*(คืออะไร|ประเภทอะไร|เป็นอะไร)|ประเภทเอกสาร/u.test(text)
    && /[?？]|อะไร|ไหม/u.test(text)) {
    return `คำถามแทรก — ประเภทเอกสารในระบบตอนนี้: ${expense.sourceDocumentType ?? 'ยังไม่ระบุ'} (ต้องตรวจจากหลักฐานต้นทางในเว็บ)`;
  }
  return undefined;
}

function blocker(code: string, message: string, collectableInLine = false): LineSubstituteReceiptBlocker {
  return { code, message, collectableInLine };
}

function currentValue<T extends keyof LineSubstituteReceiptValues>(
  values: LineSubstituteReceiptValues,
  key: T,
  fallback: LineSubstituteReceiptValues[T],
): LineSubstituteReceiptValues[T] {
  return values[key] ?? fallback;
}

function preflight(
  ctx: RequestContext,
  expense: ExpenseRecordWithRelations,
  values: LineSubstituteReceiptValues,
  policy: { configured: boolean; approvalMode: 'OWNER_SELF' | 'DESIGNATED_APPROVERS'; approverUserIds: string[]; cashEvidencePolicy: string },
  eligibleApproverIds: Set<string>,
  payerActive: boolean,
): LineSubstituteReceiptBlocker[] {
  const result: LineSubstituteReceiptBlocker[] = [];
  if (!ctx.permissions.includes('expense.review')) result.push(blocker('expense_review_forbidden', 'ไม่มีสิทธิ์ตรวจทานเพื่อจัดทำใบรับรองแทนใบเสร็จรับเงิน'));
  result.push(...collectSubstituteReceiptEligibilityIssues(expense, values.reasonCode)
    .map((issue) => blocker(issue.code, issue.message)));
  if (expense.substituteReceiptEvidence && expense.substituteReceiptEvidence.status !== 'SUPERSEDED') {
    result.push(blocker('active_substitute_evidence_exists', 'รายการนี้มีใบรับรองแทนใบเสร็จที่ยังใช้งานอยู่แล้ว'));
  }
  if (!values.reasonCode) result.push(blocker('reason_code_required', 'ระบุกรณีที่ไม่มี/ใช้ใบเสร็จเดิมไม่ได้', true));
  if (!currentValue(values, 'missingReceiptReason', expense.missingReceiptReason ?? undefined)) {
    result.push(blocker('missing_receipt_reason_required', 'ระบุเหตุผลที่ไม่มีใบเสร็จ', true));
  }
  if (!values.businessPurpose) result.push(blocker('business_purpose_required', 'ระบุวัตถุประสงค์ทางธุรกิจ', true));
  if (!values.payerUserId) result.push(blocker('payer_required', 'ยืนยันผู้จ่ายเงินจริง (เช่น “ฉันเป็นผู้จ่าย”)', true));
  else if (!payerActive) result.push(blocker('payer_not_active_in_branch', 'ผู้จ่ายต้องเป็นสมาชิกที่ยังใช้งานและอยู่ในขอบเขตสาขานี้'));
  if (!currentValue(values, 'payeeName', expense.vendorNameSnapshot ?? undefined)) {
    result.push(blocker('payee_required', 'ระบุชื่อผู้รับเงิน/ผู้ขาย', true));
  }
  const paymentMethod = currentValue(values, 'paymentMethod', expense.paymentMethod ?? undefined);
  if (!paymentMethod) result.push(blocker('payment_method_required', 'ระบุวิธีชำระเงิน', true));
  if (!currentValue(values, 'paymentDate', expense.paidAt?.toISOString().slice(0, 10))) {
    result.push(blocker('payment_date_required', 'ระบุวันที่ชำระเงินจริง', true));
  }
  if (policy.approvalMode === 'DESIGNATED_APPROVERS') {
    const ready = policy.approverUserIds.some((id) => eligibleApproverIds.has(id) && id !== values.payerUserId);
    if (!ready) result.push(blocker('designated_approver_not_ready', 'ยังไม่มีผู้อนุมัติที่ตั้งค่าไว้และมีสิทธิ์ในสาขานี้'));
  } else if (eligibleApproverIds.size === 0) {
    result.push(blocker('owner_self_approver_not_ready', 'ยังไม่มีสมาชิกที่มีสิทธิ์อนุมัติค่าใช้จ่ายในสาขานี้'));
  }
  const activeAttachments = expense.attachments.filter((item) => item.status === 'ACTIVE');
  const supporting = activeAttachments.filter((item) => item.purpose !== 'expense.payment.evidence');
  const payments = activeAttachments.filter((item) => item.purpose === 'expense.payment.evidence');
  if (supporting.length === 0) result.push(blocker('supporting_evidence_required', 'แนบหลักฐานต้นทางหรือหลักฐานประกอบในเว็บ (ข้อความใช้แทนไฟล์ไม่ได้)'));
  if (((paymentMethod && paymentMethod !== 'CASH') || policy.cashEvidencePolicy === 'REQUIRE_SEPARATE_PAYMENT_EVIDENCE')
    && payments.length === 0) {
    result.push(blocker('payment_evidence_required', 'แนบหลักฐานการชำระเงินในเว็บ (ข้อความใช้แทนไฟล์ไม่ได้)'));
  }
  return result;
}

const QUESTIONS: Record<string, string> = {
  reason_code_required: 'ใบเสร็จไม่มี/หาย ผู้ขายออกให้ไม่ได้ หรือเอกสารเดิมไม่ครบคะ?',
  missing_receipt_reason_required: 'เหตุผลที่ไม่มีใบเสร็จคืออะไรคะ?',
  business_purpose_required: 'ค่าใช้จ่ายนี้ใช้เพื่อธุรกิจเรื่องอะไรคะ?',
  payer_required: 'ใครเป็นผู้จ่ายเงินจริงคะ? ถ้าเป็นคุณ ตอบ “ฉันเป็นผู้จ่าย” ได้เลย',
  payee_required: 'ผู้รับเงินหรือผู้ขายชื่ออะไรคะ?',
  payment_method_required: 'ชำระด้วยเงินสด โอน บัตร หรือเช็คคะ?',
  payment_date_required: 'ชำระเงินจริงวันที่เท่าไรคะ?',
};

const FIELD_BY_BLOCKER: Record<string, keyof LineSubstituteReceiptValues> = {
  reason_code_required: 'reasonCode',
  missing_receipt_reason_required: 'missingReceiptReason',
  business_purpose_required: 'businessPurpose',
  payer_required: 'payerUserId',
  payee_required: 'payeeName',
  payment_method_required: 'paymentMethod',
  payment_date_required: 'paymentDate',
};

const VALUE_LABELS: Record<string, string> = {
  reasonCode: 'กรณีที่ใช้ใบเสร็จเดิมไม่ได้',
  missingReceiptReason: 'เหตุผลที่ไม่มีใบเสร็จ',
  businessPurpose: 'วัตถุประสงค์ทางธุรกิจ',
  payerUserId: 'ผู้จ่ายเงินจริง',
  payeeName: 'ผู้รับเงิน/ผู้ขาย',
  paymentMethod: 'วิธีชำระเงิน',
  paymentDate: 'วันที่ชำระเงินจริง',
  itemDescription: 'รายการ',
  amount: 'ยอดเงิน',
  expenseCategoryId: 'หมวดค่าใช้จ่าย',
};

function workflowLink(companyId: string, expenseId: string, workflowId: string): string {
  return `/companies/${companyId}/expenses/substitute-receipts/new?expenseId=${encodeURIComponent(expenseId)}&workflow=${encodeURIComponent(workflowId)}`;
}

function formatResult(input: {
  status: LineSubstituteReceiptContinuationResult['status'];
  expense: ExpenseRecordWithRelations;
  state: LineSubstituteReceiptContinuation;
  acceptedFields: string[];
  blockers: LineSubstituteReceiptBlocker[];
  webPath?: string;
  policy?: { configured: boolean; ready: boolean; approvalMode: 'OWNER_SELF' | 'DESIGNATED_APPROVERS' };
  sideAnswer?: string;
}): string {
  const lines = [
    '📄 ใบรับรองแทนใบเสร็จรับเงิน',
    `รายการ: ${input.expense.expenseNumber ?? input.expense.id}`,
    `ยอดปัจจุบัน: ${input.expense.grandTotalAmount} ${input.expense.currency}`,
  ];
  if (input.acceptedFields.length) lines.push(`✅ รับข้อมูลแล้ว: ${input.acceptedFields.map((field) => VALUE_LABELS[field] ?? field).join(', ')}`);
  if (input.sideAnswer) lines.push('', input.sideAnswer);
  if (input.status === 'PAUSED') return [...lines, '⏸️ พักงานนี้ไว้แล้ว ข้อมูลที่รับไว้ยังอยู่', 'พิมพ์ “ทำใบรับรองต่อ” เพื่อกลับมาทำต่อ'].join('\n');
  if (input.status === 'CANCELLED') return [...lines, '🛑 ยกเลิกเฉพาะขั้นตอนสนทนานี้แล้ว รายการค่าใช้จ่ายและไฟล์หลักฐานไม่ได้ถูกลบ'].join('\n');
  if (input.status === 'STALE') return [...lines, '⚠️ รายการถูกแก้ไขจากเว็บหรือผู้ใช้อื่น จึงไม่ได้นำข้อความล่าสุดไปทับข้อมูล', `ตรวจสอบสถานะปัจจุบันในเว็บ: ${input.webPath}`].join('\n');
  if (input.blockers.length) {
    lines.push('', 'สิ่งที่ยังต้องทำทั้งหมด:');
    input.blockers.forEach((item) => lines.push(`• ${item.message}`));
  } else {
    lines.push('', '✅ ข้อมูลร่างพร้อมดำเนินการต่อในเว็บ');
  }
  if (input.policy) {
    const source = input.policy.configured ? 'ตั้งค่าเฉพาะบริษัทแล้ว' : 'ใช้ค่าเริ่มต้นของระบบ';
    lines.push(`นโยบายอนุมัติ: ${input.policy.approvalMode} · ${source} · ${input.policy.ready ? 'พร้อม' : 'ยังไม่พร้อม'}`);
  }
  lines.push('', 'LINE ยังไม่ได้เตรียม ลงนาม อนุมัติ หรือออกเอกสาร');
  lines.push('เอกสารภายในนี้ไม่ใช่ใบกำกับภาษีและไม่ทำให้ VAT ซื้อเครดิตได้');
  if (input.webPath) lines.push(`เปิดตรวจสอบในเว็บ: ${input.webPath}`);
  const next = input.blockers.find((item) => item.collectableInLine && QUESTIONS[item.code]);
  if (next) lines.push('', `ทำต่อ: ${QUESTIONS[next.code]}`);
  if (input.sideAnswer && input.state.status === 'OPEN') {
    lines.push(`กลับมาทำรายการ ${input.expense.expenseNumber ?? input.expense.id} ต่อได้เลย งานเดิมยังอยู่และยังขาด ${input.state.missingFields.length} ช่องที่ตอบผ่าน LINE ได้`);
  }
  return lines.join('\n');
}

@Injectable()
export class LineSubstituteReceiptContinuationUseCase {
  constructor(private readonly repo: PrismaExpenseRepository) {}

  async loadForWeb(ctx: RequestContext, expenseId: string, workflowId: string): Promise<LineSubstituteReceiptPrefill> {
    if (ctx.authProvider === 'line') throw new ForbiddenException('Open this continuation in the authenticated web app.');
    if (!ctx.permissions.includes('expense.review')) throw new ForbiddenException('Missing permission: expense.review');
    const expense = await this.repo.findByIdWithRelations(ctx.companyId, expenseId, undefined, ctx.scopes ?? {});
    if (!expense) throw new NotFoundException('Substitute-receipt continuation not found.');
    const state = stateFromMetadata(expense.sourceChannelMetadataJson);
    if (!state || state.workflowId !== workflowId || state.expenseId !== expense.id
      || state.companyId !== ctx.companyId || state.userId !== ctx.userId
      || !ACTIVE_STATUSES.has(state.status)) {
      throw new NotFoundException('Substitute-receipt continuation not found.');
    }
    if (state.targetRevision !== expense.updatedAt.toISOString()) {
      throw new ConflictException({ code: 'LINE_SUBSTITUTE_CONTINUATION_STALE', message: 'Expense changed. Reload the current expense before continuing.' });
    }
    return {
      workflowId: state.workflowId,
      expenseId: state.expenseId,
      targetRevision: state.targetRevision,
      status: state.status as 'OPEN' | 'PAUSED',
      acceptedValues: state.acceptedValues,
    };
  }

  async execute(ctx: RequestContext, input: {
    messageText: string;
    chatKeyHash: string;
    recentCandidates: Array<{ id: string; label: string }>;
  }): Promise<LineSubstituteReceiptContinuationResult> {
    const rows = await this.repo.listLineSubstituteContinuationRows({
      companyId: ctx.companyId, userId: ctx.userId, chatKeyHash: input.chatKeyHash, scopes: ctx.scopes ?? {}, take: 5,
    });
    const states = rows
      .map((row) => ({ row, state: stateFromMetadata(row.sourceChannelMetadataJson) }))
      .filter((item): item is { row: typeof rows[number]; state: LineSubstituteReceiptContinuation } =>
        !!item.state && ACTIVE_STATUSES.has(item.state.status));
    const selection = ordinalSelection(input.messageText, Math.max(states.length, input.recentCandidates.length));
    let selected = states.length === 1 ? states[0] : selection !== null ? states[selection] : undefined;

    if (!selected && states.length > 1) {
      const choices = states.map((item, index) => `${index + 1}) ${item.state.expenseId}`).join('\n');
      return { handled: true, status: 'TARGET_REQUIRED', replyText: `มีงานใบรับรองที่ยังค้างมากกว่า 1 รายการ กรุณาเลือกก่อนค่ะ\n${choices}`, acceptedFields: [], blockers: [] };
    }

    if (!selected) {
      const candidateIndex = selection ?? (input.recentCandidates.length === 1 ? 0 : null);
      if (candidateIndex === null || !input.recentCandidates[candidateIndex]) {
        const choices = input.recentCandidates.map((item, index) => `${index + 1}) ${item.label}`).join('\n');
        return {
          handled: true,
          status: 'TARGET_REQUIRED',
          replyText: choices
            ? `กรุณาเลือกรายการที่จะทำใบรับรองแทนใบเสร็จรับเงินก่อนค่ะ\n${choices}`
            : `ยังระบุรายการค่าใช้จ่ายไม่ได้ค่ะ กรุณาเปิดรายการในเว็บก่อน\n/companies/${ctx.companyId}/expenses/substitute-receipts/new`,
          acceptedFields: [], blockers: [],
        };
      }
      const expenseId = input.recentCandidates[candidateIndex].id;
      const expense = await this.repo.findByIdWithRelations(ctx.companyId, expenseId, undefined, ctx.scopes ?? {});
      if (!expense) return { handled: true, status: 'TARGET_REQUIRED', replyText: 'ไม่พบรายการที่เลือกในสิทธิ์หรือสาขาปัจจุบันค่ะ', acceptedFields: [], blockers: [] };
      const now = new Date().toISOString();
      selected = {
        row: { id: expense.id, updatedAt: expense.updatedAt, sourceChannelMetadataJson: expense.sourceChannelMetadataJson },
        state: {
          workflowId: randomUUID(), kind: 'SUBSTITUTE_RECEIPT', companyId: ctx.companyId, userId: ctx.userId,
          expenseId: expense.id, chatKeyHash: input.chatKeyHash, status: 'OPEN', acceptedValues: {}, provenance: {},
          resolvedFields: [], missingFields: [], attachmentRefs: [], pendingQuestion: null,
          targetRevision: expense.updatedAt.toISOString(), lastActivityAt: now,
        },
      };
    }

    const expense = await this.repo.findByIdWithRelations(ctx.companyId, selected.state.expenseId, undefined, ctx.scopes ?? {});
    if (!expense) return { handled: true, status: 'TARGET_REQUIRED', replyText: 'ไม่พบรายการนี้ในสิทธิ์หรือสาขาปัจจุบันค่ะ', acceptedFields: [], blockers: [] };
    const webPath = workflowLink(ctx.companyId, expense.id, selected.state.workflowId);
    const lowered = normalizedText(input.messageText).toLocaleLowerCase('th-TH');
    const pause = /^(พัก|พักไว้ก่อน|ไว้ทำทีหลัง)$/u.test(lowered);
    const cancel = /^(ยกเลิก|ยกเลิกงานนี้|ไม่ทำแล้ว)$/u.test(lowered);
    if (pause || cancel) {
      const nextState = { ...selected.state, status: pause ? 'PAUSED' as const : 'CANCELLED' as const };
      const saved = await this.repo.saveLineSubstituteContinuation({
        companyId: ctx.companyId, expenseId: expense.id, actorUserId: ctx.userId,
        expectedUpdatedAt: expense.updatedAt, scopes: ctx.scopes ?? {}, continuation: nextState as unknown as Record<string, unknown>,
      });
      const state = saved.continuation as unknown as LineSubstituteReceiptContinuation;
      const status = pause ? 'PAUSED' as const : 'CANCELLED' as const;
      return { handled: true, status, expenseId: expense.id, workflowId: state.workflowId, acceptedFields: [], blockers: [], webPath,
        replyText: formatResult({ status, expense, state, acceptedFields: [], blockers: [], webPath }) };
    }
    if (selected.state.targetRevision !== expense.updatedAt.toISOString()) {
      return {
        handled: true, status: 'STALE', expenseId: expense.id, workflowId: selected.state.workflowId,
        replyText: formatResult({ status: 'STALE', expense, state: selected.state, acceptedFields: [], blockers: [], webPath }),
        acceptedFields: [], blockers: [], webPath,
      };
    }

    const categories = await this.repo.listCategories(ctx.companyId);
    const pendingField = selected.state.missingFields[0] ?? null;
    const acceptedNow = extractValues(input.messageText, pendingField, ctx.userId, categories);
    const sideAnswer = groundedSideAnswer(expense, input.messageText);
    const acceptedValues = { ...selected.state.acceptedValues, ...acceptedNow };
    const acceptedAt = new Date().toISOString();
    const provenance = { ...selected.state.provenance };
    for (const field of Object.keys(acceptedNow)) provenance[field] = { source: 'LINE_USER_TEXT', acceptedAt, messageHash: messageHash(input.messageText) };
    const [policyRow, eligibleApprovers, payer] = await Promise.all([
      this.repo.getSubstituteReceiptPolicy(ctx.companyId),
      this.repo.listEligibleSubstituteReceiptApprovers(ctx.companyId, expense.branchId),
      acceptedValues.payerUserId
        ? this.repo.findActiveMemberIdentity(ctx.companyId, acceptedValues.payerUserId, expense.branchId)
        : Promise.resolve(null),
    ]);
    const policy = {
      configured: Boolean(policyRow),
      approvalMode: policyRow?.approvalMode ?? 'OWNER_SELF' as const,
      approverUserIds: policyRow?.approverUserIds ?? [],
      cashEvidencePolicy: policyRow?.cashEvidencePolicy ?? 'REQUIRE_SEPARATE_PAYMENT_EVIDENCE',
    };
    const policyReady = policy.approvalMode === 'DESIGNATED_APPROVERS'
      ? policy.approverUserIds.some((id) => eligibleApprovers.some((item) => item.userId === id) && id !== acceptedValues.payerUserId)
      : eligibleApprovers.length > 0;
    const policyFacts = { configured: policy.configured, ready: policyReady, approvalMode: policy.approvalMode };
    const blockers = preflight(ctx, expense, acceptedValues, policy, new Set(eligibleApprovers.map((item) => item.userId)), Boolean(payer));
    const missingFields = blockers
      .filter((item) => item.collectableInLine)
      .map((item) => FIELD_BY_BLOCKER[item.code])
      .filter((field): field is keyof LineSubstituteReceiptValues => Boolean(field));
    const pending = blockers.find((item) => item.collectableInLine && QUESTIONS[item.code]);
    const nextState: LineSubstituteReceiptContinuation = {
      ...selected.state,
      status: 'OPEN',
      acceptedValues,
      provenance,
      resolvedFields: Object.keys(acceptedValues).sort(),
      missingFields,
      attachmentRefs: expense.attachments.filter((item) => item.status === 'ACTIVE').map((item) => item.id).slice(0, 20),
      pendingQuestion: pending ? QUESTIONS[pending.code] : null,
      targetRevision: expense.updatedAt.toISOString(),
      lastActivityAt: acceptedAt,
    };
    const saved = await this.repo.saveLineSubstituteContinuation({
      companyId: ctx.companyId, expenseId: expense.id, actorUserId: ctx.userId,
      expectedUpdatedAt: expense.updatedAt, scopes: ctx.scopes ?? {}, continuation: nextState as unknown as Record<string, unknown>,
    });
    const state = saved.continuation as unknown as LineSubstituteReceiptContinuation;
    const ineligible = blockers.some((item) => ['expense_status_ineligible', 'source_type_ineligible', 'valid_receipt_normal_path', 'classification_ineligible', 'document_kind_ineligible', 'currency_not_supported', 'active_substitute_evidence_exists'].includes(item.code));
    const status = ineligible ? 'INELIGIBLE' as const : blockers.length ? 'BLOCKED' as const : 'READY_FOR_WEB' as const;
    const targetPath = ineligible ? `/companies/${ctx.companyId}/expenses/${expense.id}` : workflowLink(ctx.companyId, expense.id, state.workflowId);
    return {
      handled: true, status, workflowId: state.workflowId, expenseId: expense.id,
      acceptedFields: Object.keys(acceptedNow), blockers, webPath: targetPath,
      policy: policyFacts,
      ...(state.pendingQuestion ? { pendingQuestion: state.pendingQuestion } : {}),
      replyText: formatResult({ status, expense, state, acceptedFields: Object.keys(acceptedNow), blockers, webPath: targetPath, policy: policyFacts, sideAnswer }),
    };
  }
}
