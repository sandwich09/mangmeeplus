import { lineDisplayDate, type LineReplyLanguage } from '../domain/logic/line-language.logic';
import { formatThaiDate } from '../domain/logic/line-draft-update-card.logic';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { WHT_HANDOFF_PAYEE_ADDRESS_MAX, todayCivilDate, scrubRecordText, whtPayeeAddress, type CreateDisbursementVoucherDraftInput, type PayDisbursementVoucherInput, type RequestContext, type ReimbursementRequestDetail } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../common/database/prisma.service';
import { AppConfigService } from '../../../common/config/app-config.service';
import { assertFeatureEnabled, loadEntitledFeatureKeys } from '../../employee-access/application/entitlement.helper';
import { DisbursementVoucherUseCase } from '../../expenses/application/use-cases/disbursement-voucher.use-case';
import { GetExpenseUseCase } from '../../expenses/application/use-cases/expense-draft.use-case';
import { GetCounterpartyUseCase, ListCounterpartiesUseCase } from '../../accounting-documents/application/use-cases/counterparty.use-case';
import { WhtCertificateHandoffUseCase } from '../../tax/application/use-cases/wht-certificate-handoff.use-case';
import { IssueWhtCertificateFromHandoffUseCase } from '../../tax/application/use-cases/issue-wht-certificate-from-handoff.use-case';
import { deliveryHash } from '../domain/logic/line-delivery-plan.logic';

export const VOUCHER_ACTIONS = ['VOUCHER_CREATE', 'VOUCHER_SUBMIT', 'VOUCHER_APPROVE', 'VOUCHER_RETURN', 'VOUCHER_PAY', 'VOUCHER_CANCEL', 'WHT_CERTIFICATE_ISSUE'] as const;
export type VoucherAction = typeof VOUCHER_ACTIONS[number];
export type VoucherActionPayload = { action: VoucherAction; id: string; expenseIds?: string[]; draft?: CreateDisbursementVoucherDraftInput;
  sources?: { id: string; revision: string }[]; version?: number; reason?: string; payment?: PayDisbursementVoucherInput; handoffs?: { id: string; revision: string }[]; payeeAddress?: string };
const PERMISSIONS: Record<VoucherAction, string[]> = {
  VOUCHER_CREATE: ['expense.disbursement.prepare'], VOUCHER_SUBMIT: ['expense.disbursement.prepare'],
  VOUCHER_APPROVE: ['expense.disbursement.approve'], VOUCHER_RETURN: ['expense.disbursement.approve'],
  VOUCHER_PAY: ['expense.disbursement.pay'], VOUCHER_CANCEL: ['expense.disbursement.prepare', 'expense.disbursement.approve'], WHT_CERTIFICATE_ISSUE: ['wht.certificate.issue'],
};
const operation = (action: VoucherAction) => action.slice('VOUCHER_'.length).toLowerCase() as 'create' | 'submit' | 'approve' | 'return' | 'pay' | 'cancel';

export function isVoucherPayeeName(value: string): boolean {
  const name = value.trim();
  // ponytail: conservative name shape; uncertain sentences go through the normal admitted intake.
  return name.length >= 2 && name.length <= 200 && /^[\p{L}\p{M}\p{N} .,&'’()\-]+$/u.test(name) && /\p{L}/u.test(name)
    && !/^(?:ขอ|ช่วย|ทำ|สร้าง|ส่ง|จ่าย|โอน|ยืนยัน|บันทึก|อนุมัติ|เปลี่ยน|แก้|ออก|ตรวจ|ดู|ให้|เอา|ซื้อ|ลบ|ยกเลิก|ต้องการ|(?:pay|send|show|change|update|delete|issue|confirm|do)\b)/iu.test(name)
    && !/(?:อนุมัติ|บันทึก|ใบสำคัญ|ใบเตรียม|จ่ายแล้ว|วันนี้|เมื่อวาน|โอนเงิน|ทำให้|ขอดู|ยกเลิก|พิมพ์ชื่อเอง|(?:ช่วย|สร้าง)(?:ใบ|รายการ|ให้|ทำ)|\b(?:approve|record|please|create|cancel|paid|transfer)\b)/iu.test(name);
}

/** Business adapter only: signatures, ownership, grounding, locking and replay live in the shared action lane. */
@Injectable()
export class LineVoucherActionService {
  @Inject(GetCounterpartyUseCase) private readonly counterparties!: GetCounterpartyUseCase;
  @Inject(ListCounterpartiesUseCase) private readonly listCounterparties!: ListCounterpartiesUseCase;
  constructor(private readonly prisma: PrismaService, private readonly vouchers: DisbursementVoucherUseCase,
    private readonly expenses: GetExpenseUseCase, private readonly handoffs: WhtCertificateHandoffUseCase,
    private readonly issue: IssueWhtCertificateFromHandoffUseCase, private readonly config: AppConfigService) {}

  private async sourcePayee(ctx: RequestContext, source: { vendorNameSnapshot: string | null; vendorCounterpartyId: string | null }) {
    if (source.vendorNameSnapshot?.trim() && isVoucherPayeeName(source.vendorNameSnapshot) && !/^ไม่ระบุ(?:ชื่อ)?ผู้ขาย$/u.test(source.vendorNameSnapshot.trim())) return source.vendorNameSnapshot.trim();
    if (source.vendorCounterpartyId && this.counterparties) {
      try { const name = (await this.counterparties.execute(ctx, source.vendorCounterpartyId)).displayName.trim(); return isVoucherPayeeName(name) ? name : ''; }
      catch (error) { if (!(error instanceof ForbiddenException || error instanceof NotFoundException)) throw error; }
    }
    return '';
  }

  async payeeChoices(ctx: RequestContext, language: LineReplyLanguage = 'th') {
    await this.authorize(ctx, 'VOUCHER_CREATE');
    const rows = ctx.permissions.includes('accounting.counterparty.read') && this.listCounterparties
      ? (await this.listCounterparties.execute(ctx, 1, 4)).data : [];
    return rows.filter(row => isVoucherPayeeName(row.displayName)).slice(0, 4)
      .map(row => ({ label: scrubRecordText(row.displayName, 20), text: row.displayName }))
      .concat([{ label: language === 'en' ? 'Type payee name' : 'พิมพ์ชื่อเอง', text: language === 'en' ? 'Type payee name' : 'พิมพ์ชื่อเอง' }]);
  }

  async authorize(ctx: RequestContext, action: VoucherAction) {
    const entitled = await loadEntitledFeatureKeys(this.prisma, ctx.companyId);
    assertFeatureEnabled(entitled, 'expenses');
    if (action === 'WHT_CERTIFICATE_ISSUE') assertFeatureEnabled(entitled, 'wht_50bis');
    if (!PERMISSIONS[action].some(permission => ctx.permissions.includes(permission))) throw new ForbiddenException();
  }
  async nextAction(ctx: RequestContext, id: string): Promise<VoucherAction | undefined> {
    const voucher = await this.vouchers.get(ctx, id, true);
    const action = voucher.header.status === 'DRAFT' ? 'VOUCHER_SUBMIT'
      : voucher.header.status === 'PENDING_APPROVAL' ? 'VOUCHER_APPROVE' : voucher.header.status === 'APPROVED' ? 'VOUCHER_PAY' : undefined;
    if (action) { try { await this.authorize(ctx, action); return action; } catch (error) { if (!(error instanceof ForbiddenException)) throw error; } }
    return undefined;
  }
  async canOfferCertificate(ctx: RequestContext, id: string): Promise<boolean> {
    try {
      await this.authorize(ctx, 'WHT_CERTIFICATE_ISSUE');
      const voucher = await this.vouchers.get(ctx, id, true);
      if (voucher.header.status !== 'PAID') return false;
      const sourceIds = voucher.lines.filter(line => new Decimal(line.whtAmount).gt(0)).map(line => line.expenseId);
      return sourceIds.length > 0 && Boolean(await this.prisma.client.whtCertificateHandoff.findFirst({ where: { companyId: ctx.companyId, sourcePaymentType: 'expense.record', sourcePaymentId: { in: sourceIds }, status: 'REQUIRED' } }));
    } catch { return false; }
  }
  async read(ctx: RequestContext, payload: VoucherActionPayload) {
    await this.authorize(ctx, payload.action);
    if (payload.action === 'VOUCHER_CREATE') {
      const sources = await Promise.all(payload.expenseIds!.map(id => this.expenses.execute(ctx, id)));
      const names = await Promise.all(sources.map(source => this.sourcePayee(ctx, source)));
      const first = sources[0]!;
      return { id: first.id, branchId: first.branchId, createdByUserId: first.createdByUserId, updatedAt: first.updatedAt,
        expenseDate: first.expenseDate, vendorNameSnapshot: payload.draft?.payeeName || names[0],
        grandTotalAmount: payload.draft!.lines.reduce((sum, line) => sum.plus(line.amount), new Decimal(0)).toFixed(2), currency: first.currency,
        status: first.status, claim: undefined as ReimbursementRequestDetail | undefined,
        digest: deliveryHash(sources.map((row, index) => ({ id: row.id, revision: row.updatedAt.toISOString(), status: row.status, branch: row.branchId, outstanding: row.outstandingAmount, wht: row.whtAmount, vendor: names[index], taxId: row.vendorTaxIdSnapshot }))) };
    }
    const voucher = await this.vouchers.get(ctx, payload.id, true);
    const handoffs = payload.action === 'WHT_CERTIFICATE_ISSUE' ? await Promise.all(payload.handoffs!.map(row => this.handoffs.get(ctx, row.id))) : undefined;
    return { id: voucher.header.id, branchId: voucher.header.branchId, createdByUserId: voucher.header.preparedByUserId, updatedAt: new Date(voucher.header.updatedAt),
      expenseDate: new Date(`${voucher.header.paidDate ?? voucher.header.plannedPayDate ?? voucher.header.createdAt.slice(0, 10)}T00:00:00Z`),
      vendorNameSnapshot: handoffs?.[0]?.prefill.payeeSnapshot.name ?? voucher.header.payeeName, grandTotalAmount: handoffs?.[0]?.prefill.grossAmount ?? voucher.header.totalAmount, currency: voucher.header.currency, status: voucher.header.status,
      claim: undefined as ReimbursementRequestDetail | undefined, digest: deliveryHash({ voucher, handoffs }) };
  }
  async prepare(ctx: RequestContext, action: VoucherAction, id: string, input: Record<string, unknown>, language: LineReplyLanguage = 'th'): Promise<{ payload: VoucherActionPayload; details: string[]; awaitingField?: 'reason' | 'payeeName' | 'payeeAddress' | 'paymentMethod'; record: Awaited<ReturnType<LineVoucherActionService['read']>>; nextStatus: string }> {
    const en = language === 'en';
    await this.authorize(ctx, action);
    const payload: VoucherActionPayload = { action, id, ...(typeof input.reason === 'string' ? { reason: input.reason.trim() } : {}) };
    const details: string[] = [];
    let awaitingField: 'reason' | 'payeeName' | 'payeeAddress' | 'paymentMethod' | undefined;
    if (action === 'VOUCHER_CREATE') {
      payload.expenseIds = typeof input.expenseIds === 'string' ? input.expenseIds.split(',').map(id => id.trim()) : [id];
      if (!payload.expenseIds.length || payload.expenseIds.length > 20 || new Set(payload.expenseIds).size !== payload.expenseIds.length) throw new BadRequestException();
      const sources = await Promise.all(payload.expenseIds.map(id => this.expenses.execute(ctx, id)));
      const names = await Promise.all(sources.map(source => this.sourcePayee(ctx, source)));
      const payeeName = names[0] || (typeof input.payeeName === 'string' && isVoucherPayeeName(input.payeeName) ? input.payeeName.trim() : '');
      if (!payeeName) awaitingField = 'payeeName';
      payload.sources = sources.map(row => ({ id: row.id, revision: row.updatedAt.toISOString() }));
      payload.draft = { commandId: 'line-preview', ...(payeeName ? { payeeName } : {}), lines: sources.map(row => ({ expenseId: row.id,
        // Web initialAmount truncates to satang, including four-decimal source amounts.
        amount: new Decimal(row.outstandingAmount).toDecimalPlaces(2, Decimal.ROUND_DOWN).toFixed(2) })) };
      try { await this.vouchers.previewLineAction(ctx, 'create', { draft: payload.draft }); } catch (error) {
        if ((error as { getResponse?: () => { code?: string } }).getResponse?.().code === 'disbursement_payee_confirmation_required') {
          payload.draft.payeeConfirmed = true;
          details.push(en ? `Confirm that all selected expenses are payable to ${scrubRecordText(sources[0]!.vendorNameSnapshot, 80)}.` : `กดสร้างเพื่อยืนยันว่ารายจ่ายทั้งหมดจ่ายให้ ${scrubRecordText(sources[0]!.vendorNameSnapshot, 80)} ค่ะ`);
          await this.vouchers.previewLineAction(ctx, 'create', { draft: payload.draft });
        } else throw error;
      }
      details.push(...sources.map(row => `${scrubRecordText(row.vendorNameSnapshot, 60)} · ${en ? 'Payment' : 'จ่าย'} ${payload.draft!.lines.find(line => line.expenseId === row.id)!.amount} ${en ? 'THB · Withholding' : 'บาท · หักภาษี'} ${new Decimal(row.whtAmount).toFixed(2)} ${en ? 'THB' : 'บาท'}`));
    } else {
      const voucher = await this.vouchers.get(ctx, id, true);
      if ((action === 'VOUCHER_APPROVE' || action === 'VOUCHER_PAY') && ['DRAFT', 'PENDING_APPROVAL'].includes(voucher.header.status)) {
        const next = await this.nextAction(ctx, id);
        if (next && next !== action) return this.prepare(ctx, next, id, input);
      }
      payload.expenseIds = voucher.lines.map(line => line.expenseId);
      payload.version = voucher.header.version;
      if (action === 'WHT_CERTIFICATE_ISSUE') {
        if (voucher.header.status !== 'PAID') throw new ConflictException({ code: 'disbursement_status_changed' });
        const sourceIds = voucher.lines.filter(line => new Decimal(line.whtAmount).gt(0)).map(line => line.expenseId);
        const rows = sourceIds.length ? await this.prisma.client.whtCertificateHandoff.findMany({ where: { companyId: ctx.companyId,
          sourcePaymentType: 'expense.record', sourcePaymentId: { in: sourceIds }, status: 'REQUIRED', ...(typeof input.handoffId === 'string' ? { id: input.handoffId } : {}) }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 1 }) : [];
        if (!this.config.webBaseUrl) throw new BadRequestException();
        if (!rows.length) throw new ConflictException({ code: 'wht_handoff_not_issuable' });
        const handoffs = await Promise.all(rows.map(row => this.handoffs.get(ctx, row.id)));
        payload.handoffs = handoffs.map(row => ({ id: row.id, revision: row.updatedAt }));
        const missing = handoffs.filter(row => !whtPayeeAddress(row.payeeAddress, row.prefill.payeeSnapshot.address));
        if (missing.length) {
          if (typeof input.payeeAddress === 'string' && input.payeeAddress.trim()) {
            if (input.payeeAddress.trim().length > WHT_HANDOFF_PAYEE_ADDRESS_MAX) throw new BadRequestException({ code: 'counterparty_address_too_long', message: 'ขอที่อยู่ผู้รับเงินไม่เกิน 500 ตัวอักษร' });
            payload.payeeAddress = input.payeeAddress.trim();
          }
          else awaitingField = 'payeeAddress';
        }
        // The web issuer owns every precondition. A placeholder lets us check the remaining fields while asking for the missing address.
        const previews = await Promise.all(handoffs.map(row => this.issue.previewLineAction(ctx, row.id, payload.payeeAddress ?? (awaitingField ? (en ? 'Payee address required' : 'รอที่อยู่ผู้รับเงิน') : undefined))));
        details.push(...previews.map(row => `${en ? 'Payee' : 'ผู้รับเงิน'}: ${scrubRecordText(row.prefill.payeeSnapshot.name, 80)} · ${en ? 'What was paid for' : 'จ่ายค่าอะไร'}: ${scrubRecordText(row.prefill.incomeCategoryName, 80)}`));
        details.push(...previews.map(row => `${en ? 'Amount before withholding' : 'ยอดที่จ่าย'} ${row.prefill.grossAmount} ${en ? 'THB · Withholding' : 'บาท · หักภาษี'} ${row.prefill.withheldAmount} ${en ? 'THB' : 'บาท'}`));
        const address = payload.payeeAddress ?? whtPayeeAddress(handoffs[0]!.payeeAddress, handoffs[0]!.prefill.payeeSnapshot.address);
        if (address) details.push(`${en ? 'Payee address' : 'ที่อยู่ผู้รับเงิน'}: ${address.replace(/[\u0000-\u001f\u007f]/gu, ' ').slice(0, 500)}`);
      } else {
        if ((action === 'VOUCHER_RETURN' || action === 'VOUCHER_CANCEL') && !payload.reason) awaitingField = 'reason';
        if (action === 'VOUCHER_PAY') payload.payment = { commandId: 'line-preview', expectedVersion: voucher.header.version,
          paidDate: typeof input.paidAt === 'string' ? input.paidAt : todayCivilDate('Asia/Bangkok'),
          ...(typeof input.paymentMethod === 'string' ? { paymentMethod: input.paymentMethod as PayDisbursementVoucherInput['paymentMethod'] } : {}) };
        if (payload.payment && !payload.payment.paymentMethod && !voucher.header.plannedMethod) awaitingField = 'paymentMethod';
        await this.vouchers.previewLineAction(ctx, operation(action), { id, reason: awaitingField === 'reason' ? 'รอเหตุผลจากผู้ใช้' : payload.reason, payment: awaitingField === 'paymentMethod' ? { ...payload.payment!, paymentMethod: 'CASH' } : payload.payment });
        details.push(...voucher.lines.map(line => `${scrubRecordText(line.vendorName, 60)} · ${en ? 'Payment' : 'จ่าย'} ${line.amount} ${en ? 'THB · Withholding' : 'บาท · หักภาษี'} ${line.whtAmount} ${en ? 'THB' : 'บาท'}`));
        if (payload.payment) details.push(`${en ? 'Payment date' : 'วันที่จ่าย'} ${lineDisplayDate(payload.payment.paidDate!, language)} · ${((payload.payment.paymentMethod ?? voucher.header.plannedMethod) === 'CASH' ? (en ? 'Cash' : (en ? 'Cash' : 'เงินสด')) : (payload.payment.paymentMethod ?? voucher.header.plannedMethod) === 'BANK_TRANSFER' ? (en ? 'Bank transfer' : (en ? 'Bank transfer' : 'โอนเงิน')) : (payload.payment.paymentMethod ?? voucher.header.plannedMethod) === 'CARD' ? (en ? 'Card' : (en ? 'Card' : 'บัตร')) : (payload.payment.paymentMethod ?? voucher.header.plannedMethod) === 'CHEQUE' ? (en ? 'Cheque' : (en ? 'Cheque' : 'เช็ค')) : (en ? 'Other' : 'วิธีอื่น'))}`);
      }
    }
    return { payload, details, awaitingField, record: await this.read(ctx, payload), nextStatus: action === 'VOUCHER_CREATE' || action === 'VOUCHER_RETURN' ? 'DRAFT' : action === 'VOUCHER_SUBMIT' ? 'PENDING_APPROVAL' : action === 'VOUCHER_APPROVE' ? 'APPROVED' : action === 'VOUCHER_PAY' ? 'PAID' : action === 'VOUCHER_CANCEL' ? 'CANCELLED' : 'PAID' };
  }
  async apply(ctx: RequestContext, payload: VoucherActionPayload, commandId: string, evidence?: { id: string; revision: string; attachmentId: string; chat: string }) {
    await this.authorize(ctx, payload.action);
    if (payload.action === 'VOUCHER_CREATE' && !isVoucherPayeeName(payload.draft?.payeeName ?? ''))
      throw new ConflictException({ code: 'disbursement_payee_changed' });
    if (payload.action === 'WHT_CERTIFICATE_ISSUE') {
      const certificates: { number: string; uri: string }[] = [];
      for (const row of payload.handoffs!) {
        let revision = row.revision;
        if (payload.payeeAddress) revision = (await this.handoffs.setPayeeAddress(ctx, row.id, { payeeAddress: payload.payeeAddress }, revision)).updatedAt;
        const issued = await this.issue.execute(ctx, row.id, undefined, revision);
        certificates.push({ number: issued.certificateNumber, uri: `${this.config.webBaseUrl!.replace(/\/+$/, '')}/companies/${encodeURIComponent(ctx.companyId)}/expenses/wht-certificates?tab=system&search=${encodeURIComponent(issued.certificateNumber)}` });
      }
      const current = await this.read(ctx, payload);
      return { ...current, certificates };
    }
    let result;
    const command = { commandId, expectedVersion: payload.version! };
    switch (payload.action) {
      case 'VOUCHER_CREATE': result = await this.vouchers.create(ctx, { ...payload.draft!, commandId }, true, payload.sources); break;
      case 'VOUCHER_SUBMIT': result = await this.vouchers.submit(ctx, payload.id, command, true); break;
      case 'VOUCHER_APPROVE': result = await this.vouchers.approve(ctx, payload.id, command, true); break;
      case 'VOUCHER_RETURN': result = await this.vouchers.return(ctx, payload.id, { ...command, reason: payload.reason! }, true); break;
      case 'VOUCHER_CANCEL': result = await this.vouchers.cancel(ctx, payload.id, { ...command, reason: payload.reason! }, true); break;
      case 'VOUCHER_PAY': {
        const attached = evidence ? await this.vouchers.attachLineSlip(ctx, payload.id, evidence, payload.version!) : undefined;
        result = await this.vouchers.pay(ctx, payload.id, { ...payload.payment!, commandId, expectedVersion: attached?.header.version ?? payload.version!, ...(attached?.slip ? { slipAttachmentId: attached.slip.attachmentId } : {}) }, true); break;
      }
    }
    return { ...result, updatedAt: new Date(result.updatedAt), certificates: undefined };
  }
}
