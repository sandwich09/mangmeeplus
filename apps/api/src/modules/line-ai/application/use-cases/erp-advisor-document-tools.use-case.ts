/** Sold-pack document reads. No preparation, issuance, filing or payment. */
import { BadRequestException, Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { DISBURSEMENT_VOUCHER_STATUS_LABELS, civilPeriodKey, todayCivilDate, type RequestContext, type ToolResult, type WhtCertificateHandoffListRowDto } from '@watchdog-bms/contracts';
import { DisbursementVoucherUseCase } from '../../../expenses/application/use-cases/disbursement-voucher.use-case';
import { calcLineTotals } from '../../../expenses/domain/logic/expense-totals.logic';
import { ListWhtIncomeCategoriesUseCase } from '../../../procurement/application/use-cases/wht-income-category.use-case';
import { WhtCertificateHandoffUseCase } from '../../../tax/application/use-cases/wht-certificate-handoff.use-case';
import { PrismaTaxRepository } from '../../../tax/infrastructure/repositories/prisma-tax.repository';
import { pnd53PaperDueDay } from '../../../tax/domain/logic/tax-period.logic';
import { isBranchInScope } from '../../../data-model-core/domain/logic/branch.logic';
import type { ErpReadToolPort, ErpToolContext } from '../../domain/ports/erp-read-tool.port';

function requestContext(ctx: ErpToolContext): RequestContext {
  return { requestId: ctx.requestId ?? '', authSubject: ctx.userId, userId: ctx.userId,
    companyId: ctx.companyId, membershipId: ctx.membershipId ?? '', roles: ctx.roles ?? [], permissions: ctx.permissions,
    scopes: { branchIds: ctx.branchIds, locationIds: ctx.locationIds }, authProvider: 'watchdog' };
}
function result(ctx: ErpToolContext, toolName: string, data: Record<string, unknown>, path: string, label: string): ToolResult {
  const asOf = new Date().toISOString();
  return { toolName, status: 'ok', asOf, data, sourceRefs: [{ label, module: toolName.startsWith('voucher.') ? 'expenses' : 'tax',
    entityType: 'advisor_document_read', permissionChecked: true, asOf, webPath: `/companies/${ctx.companyId}/${path}` }] };
}
function denied(toolName: string): ToolResult { return { toolName, status: 'forbidden', sourceRefs: [], asOf: new Date().toISOString() }; }
const money = (value: string) => new Decimal(value).toFixed(2);
const sum = (values: string[]) => values.reduce((total, value) => total.plus(value), new Decimal(0)).toFixed(2);

@Injectable()
export class VoucherListRecentTool implements ErpReadToolPort {
  toolName = 'voucher.list_recent';
  constructor(private readonly vouchers: DisbursementVoucherUseCase) {}
  async execute(ctx: ErpToolContext, input: { q?: string; branchId?: string } = {}): Promise<ToolResult> {
    if (!ctx.permissions.includes('expense.disbursement.read')) return denied(this.toolName);
    const page = await this.vouchers.list(requestContext(ctx), { q: input.q, branchId: input.branchId, page: 1, pageSize: 10 });
    const items = page.data.map(({ id, documentNumber, status, payeeName, totalAmount, paidDate, plannedPayDate, lineCount }) =>
      ({ id, documentNumber, status, payeeName, totalAmount, paidDate, plannedPayDate, lineCount }));
    return result(ctx, this.toolName, { total: page.total, items, message: page.total
      ? `พบใบเตรียมจ่าย/ใบสำคัญจ่าย ${page.total} ใบค่ะ\n${items.map((v, i) => `${i + 1}) ${v.documentNumber ?? 'ฉบับร่าง'} · ${v.payeeName} · ${money(v.totalAmount)} บาท · ${DISBURSEMENT_VOUCHER_STATUS_LABELS[v.status] ?? 'รอตรวจสอบ'}`).join('\n')}${page.total > items.length ? '\nแสดง 10 ใบล่าสุดค่ะ' : ''}`
      : 'ยังไม่มีใบเตรียมจ่าย/ใบสำคัญจ่ายที่คุณมีสิทธิ์ดูค่ะ' }, 'expenses/disbursement-vouchers', 'ใบเตรียมจ่าย/ใบสำคัญจ่าย');
  }
}

@Injectable()
export class VoucherGetDetailTool implements ErpReadToolPort {
  toolName = 'voucher.get_detail';
  constructor(private readonly vouchers: DisbursementVoucherUseCase) {}
  async execute(ctx: ErpToolContext, input: { voucherId?: string }): Promise<ToolResult> {
    if (!ctx.permissions.includes('expense.disbursement.read')) return denied(this.toolName);
    if (typeof input.voucherId !== 'string' || !input.voucherId.trim() || input.voucherId.length > 128) throw new BadRequestException('กรุณาเลือกใบที่ต้องการดูค่ะ');
    const v = await this.vouchers.get(requestContext(ctx), input.voucherId);
    const { id, documentNumber, status, payeeName, totalAmount, paidDate, plannedPayDate } = v.header;
    return result(ctx, this.toolName, { id, documentNumber, status, payeeName, totalAmount, paidDate, plannedPayDate,
      lines: v.lines.map(({ expenseNumber, amount }) => ({ expenseNumber, amount })),
      message: `${documentNumber ?? 'ฉบับร่าง'} ของ ${payeeName} ยอด ${money(totalAmount)} บาท สถานะ${DISBURSEMENT_VOUCHER_STATUS_LABELS[status]}${paidDate ? ` วันที่จ่าย ${paidDate}` : ''}ค่ะ\n${v.lines.map((line, i) => `${i + 1}) ${line.expenseNumber ?? 'รายจ่าย'} ${money(line.amount)} บาท`).join('\n')}` },
    `expenses/disbursement-vouchers/${id}`, 'รายละเอียดใบเตรียมจ่าย/ใบสำคัญจ่าย');
  }
}

@Injectable()
export class WhtGetMonthSummaryTool implements ErpReadToolPort {
  toolName = 'wht.get_month_summary';
  constructor(private readonly handoffs: WhtCertificateHandoffUseCase, private readonly taxRepo: PrismaTaxRepository) {}
  async execute(ctx: ErpToolContext, input: { periodKey?: string; branchId?: string } = {}): Promise<ToolResult> {
    const certificatesReadable = ctx.permissions.includes('wht.certificate.read');
    const pnd53Readable = ctx.permissions.includes('wht.pnd53.read');
    if (!certificatesReadable && !pnd53Readable) return denied(this.toolName);
    if (input.branchId !== undefined && (typeof input.branchId !== 'string' || !input.branchId.trim())) throw new BadRequestException('กรุณาเลือกสาขาที่ต้องการค่ะ');
    if (input.branchId && !isBranchInScope(requestContext(ctx).scopes, input.branchId)) return denied(this.toolName);
    const periodKey = input.periodKey ?? civilPeriodKey(todayCivilDate());
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodKey)) throw new BadRequestException('กรุณาระบุเดือนและปีที่ต้องการค่ะ');
    // Reuse the web's complete permission/source-state/branch boundary, including source expense ABAC.
    const rows: WhtCertificateHandoffListRowDto[] = [];
    if (certificatesReadable) {
      for (let page = 1; ; page++) {
        const batch = await this.handoffs.listPaged(requestContext(ctx), { branchId: input.branchId, page, pageSize: 100 });
        rows.push(...batch.rows.filter(row => row.status !== 'CANCELLED' && (row.currentCertificate ?? row.prefill).paymentDate.slice(0, 7) === periodKey));
        if (page * batch.pageSize >= batch.total) break;
      }
    }
    const issued = rows.filter(row => row.status === 'SYSTEM_ISSUED' || row.status === 'EXTERNAL_LINKED');
    const groups = new Map<string, { incomeCategoryName: string; paymentCount: number; paid: string[]; withheld: string[] }>();
    for (const row of rows) {
      const p = row.currentCertificate ?? row.prefill;
      const key = p.incomeCategoryCode ?? '';
      const group = groups.get(key) ?? { incomeCategoryName: p.incomeCategoryName ?? 'ยังไม่ระบุประเภทเงินได้', paymentCount: 0, paid: [], withheld: [] };
      group.paymentCount++; group.paid.push(p.grossAmount); group.withheld.push(p.withheldAmount); groups.set(key, group);
    }
    const byIncomeType = [...groups.values()].map(g => ({ incomeCategoryName: g.incomeCategoryName, paymentCount: g.paymentCount, totalPaid: sum(g.paid), totalWithheld: sum(g.withheld) }));
    const period = pnd53Readable ? await this.taxRepo.findPeriod(ctx.companyId, 'PND53', periodKey) : null;
    const events = period ? (await this.taxRepo.findEventsByPeriod(ctx.companyId, period.id, 'ACTIVE')).filter(event => event.eventType === 'WHT_PND53'
      && isBranchInScope(requestContext(ctx).scopes, event.branchId) && (!input.branchId || event.branchId === input.branchId)) : [];
    const remittance = period ? { totalWithheld: sum(events.map(e => e.taxAmount)), eventCount: events.length, status: period.status,
      dueDate: pnd53PaperDueDay(periodKey, period.dueDate), dueDateBasis: period.dueDate ? 'configured_period' : 'paper_filing_rule' } : null;
    const totalPaid = sum(byIncomeType.map(g => g.totalPaid)), totalWithheld = sum(byIncomeType.map(g => g.totalWithheld));
    const monthLabel = new Date(`${periodKey}-01T00:00:00.000Z`).toLocaleDateString('th-TH', { month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok' });
    const dueDateLabel = remittance && new Date(`${remittance.dueDate}T00:00:00.000Z`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' });
    const message = [`งวด ${monthLabel} เฉพาะข้อมูลที่คุณมีสิทธิ์ดูค่ะ`,
      ...(certificatesReadable ? [`ออกหรือบันทึก 50 ทวิแล้ว ${issued.length} ใบ จากการจ่าย ${rows.length} รายการ ฐานเงินได้ ${totalPaid} บาท หักไว้ ${totalWithheld} บาทค่ะ`,
        ...byIncomeType.map(g => `${g.incomeCategoryName}: ฐาน ${g.totalPaid} บาท หัก ${g.totalWithheld} บาท`),
        ...issued.slice(0, 10).map(row => `${row.currentCertificate?.number ?? row.externalCertificateNumber ?? row.certificateNumber ?? 'ยังไม่มีเลขเอกสาร'} · ${(row.currentCertificate?.payee ?? row.prefill.payeeSnapshot).name} · หัก ${money((row.currentCertificate ?? row.prefill).withheldAmount)} บาท`),
        ...(issued.length > 10 ? ['แสดงหนังสือรับรอง 10 ใบล่าสุดค่ะ'] : [])] : []),
      pnd53Readable ? remittance ? `ยอดภาษี ภงด.53 ของงวด ${remittance.totalWithheld} บาท กำหนด${remittance.dueDateBasis === 'paper_filing_rule' ? 'ยื่นกระดาษตามกติกาในระบบ' : 'ตามงวดในระบบ'} ${dueDateLabel} ค่ะ`
        : 'ยังไม่มีงวด ภงด.53 จึงยังยืนยันยอดนำส่งและวันครบกำหนดจากงวดไม่ได้ค่ะ' : 'คุณยังไม่มีสิทธิ์ดูยอดนำส่ง ภงด.53 ค่ะ',
      'ยอดหักของการจ่ายกับยอดในงวดอาจต่างกันหากยังไม่ได้ซิงค์ข้อมูล และยอดของงวดยังไม่ใช่ยอดค้างชำระค่ะ'].join('\n');
    return result(ctx, this.toolName, { periodKey, certificateCount: certificatesReadable ? issued.length : null, paymentCount: certificatesReadable ? rows.length : null,
      totalPaid: certificatesReadable ? totalPaid : null, totalWithheld: certificatesReadable ? totalWithheld : null, byIncomeType,
      issuedCertificates: issued.slice(0, 10).map(r => ({ number: r.currentCertificate?.number ?? r.externalCertificateNumber ?? r.certificateNumber, payeeName: r.currentCertificate?.payee.name ?? r.prefill.payeeSnapshot.name,
        grossAmount: (r.currentCertificate ?? r.prefill).grossAmount, withheldAmount: (r.currentCertificate ?? r.prefill).withheldAmount })),
      remittance, message }, pnd53Readable ? 'tax/pnd53' : 'expenses/wht-certificates', 'สรุป 50 ทวิและภาษีหัก ณ ที่จ่ายรายเดือน');
  }
}

@Injectable()
export class WhtCalculateWithholdingTool implements ErpReadToolPort {
  toolName = 'wht.calculate_withholding';
  constructor(private readonly categories: ListWhtIncomeCategoriesUseCase) {}
  async execute(ctx: ErpToolContext, input: { incomeCategoryCode?: string; baseAmount?: string } = {}): Promise<ToolResult> {
    if (!ctx.permissions.includes('expense.create') && !ctx.permissions.includes('procurement.supplier_payment.read')) return denied(this.toolName);
    const catalog = await this.categories.execute(requestContext(ctx));
    const text = (ctx.inputEvidence?.parts.map(part => part.rawText).join('\n') ?? ctx.groundingText ?? '').normalize('NFC');
    const matches = catalog.filter(c => text.includes(c.nameTh.normalize('NFC')));
    const category = matches.length === 1 && (!input.incomeCategoryCode || input.incomeCategoryCode === matches[0]!.code) ? matches[0] : undefined;
    const rawAmount = typeof input.baseAmount === 'string' && /^\d{1,14}(\.\d{1,2})?$/.test(input.baseAmount) ? input.baseAmount : undefined;
    const baseAmount = rawAmount && new Decimal(rawAmount).gt(0) && (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).some(token => {
      try { return new Decimal(token.replace(/,/g, '')).eq(rawAmount); } catch { return false; }
    }) ? money(rawAmount) : undefined;
    if (!category || !baseAmount) {
      return result(ctx, this.toolName, { needsIncomeType: !category, needsAmount: !baseAmount, ...(baseAmount ? { baseAmount } : {}),
        catalog, readChoices: !category ? catalog.map(c => ({ label: Array.from(c.nameTh).slice(0, 20).join(''),
          text: `${c.nameTh}${baseAmount ? ` ฐานก่อนภาษี ${baseAmount} บาท` : ''} ต้องหักเท่าไหร่` })) : [],
        ...(!catalog.length ? { readChoices: [{ label: 'ตั้งค่าประเภทเงินได้', text: 'ตั้งค่าประเภทเงินได้', webPath: '/system/wht-income-categories' }] } : {}),
        message: !catalog.length ? 'ยังไม่มีประเภทเงินได้ที่เปิดใช้ค่ะ ให้ผู้ดูแลระบบเปิดประเภทเงินได้มาตรฐานในหน้าตั้งค่าหัก ณ ที่จ่ายก่อนนะคะ' : !category
          ? 'เป็นเงินได้ประเภทใดคะ เลือกจากปุ่มประเภทเงินได้ได้เลยค่ะ'
          : 'ยอดที่ต้องการใช้เป็นฐานก่อนภาษีมูลค่าเพิ่มเท่าไหร่คะ กรุณาระบุพร้อมประเภทเงินได้ค่ะ' }, 'expenses', 'ประเภทเงินได้หัก ณ ที่จ่ายที่เปิดใช้');
    }
    const totals = calcLineTotals({ quantity: '1', unitPrice: baseAmount, vatMode: 'NO_VAT', whtRate: new Decimal(category.defaultRate).div(100).toString() });
    const withheldAmount = money(totals.whtAmount), netBeforeVat = new Decimal(baseAmount).minus(withheldAmount).toFixed(2);
    return result(ctx, this.toolName, { incomeCategoryName: category.nameTh, baseAmount, ratePercent: category.defaultRate, withheldAmount, netBeforeVat,
      message: `ถ้าใช้ฐานก่อนภาษีมูลค่าเพิ่ม ${baseAmount} บาท สำหรับ${category.nameTh} อัตราที่ระบบเปิดใช้ ${new Decimal(category.defaultRate).toString()}% จะหัก ${withheldAmount} บาท เหลือ ${netBeforeVat} บาทก่อนรวมภาษีมูลค่าเพิ่มค่ะ` }, 'expenses', 'คำนวณจากประเภทเงินได้ที่เปิดใช้');
  }
}
