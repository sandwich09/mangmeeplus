import { lineReplyLanguage, lineDisplayDate, lineUiLabel } from '../../domain/logic/line-language.logic';
/** Sold-pack document reads. No preparation, issuance, filing or payment. */
import { BadRequestException, Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { DISBURSEMENT_VOUCHER_STATUS_LABELS, civilPeriodKey, todayCivilDate, resolvePeriodCandidates, PERIOD_ASSUMPTIONS, isAmbiguousPeriodCandidate, type RequestContext, type ToolResult, type WhtCertificateHandoffListRowDto } from '@watchdog-bms/contracts';
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
    const language = lineReplyLanguage(ctx.groundingText ?? '', ctx.locale?.startsWith('en') ? 'en' : 'th');
    const items = page.data.map(({ id, documentNumber, status, payeeName, totalAmount, paidDate, plannedPayDate, lineCount }) =>
      ({ id, documentNumber, status, payeeName, totalAmount, paidDate, plannedPayDate, lineCount }));
    return result(ctx, this.toolName, { total: page.total, items, message: language === 'en' ? (page.total ? `${page.total} payment vouchers.\n${items.map(v => `• ${v.documentNumber ?? 'Draft'} · ${v.payeeName} · ${money(v.totalAmount)} THB · ${lineUiLabel(DISBURSEMENT_VOUCHER_STATUS_LABELS[v.status] ?? 'รอตรวจสอบ', language)}`).join('\n')}` : 'No payment vouchers are available within your access.') : page.total
      ? `พบใบเตรียมจ่าย/ใบสำคัญจ่าย ${page.total} ใบค่ะ\n${items.map((v, i) => `• ${v.documentNumber ?? 'ฉบับร่าง'} · ${v.payeeName} · ${money(v.totalAmount)} บาท · ${DISBURSEMENT_VOUCHER_STATUS_LABELS[v.status] ?? 'รอตรวจสอบ'}`).join('\n')}${page.total > items.length ? '\nแสดง 10 ใบล่าสุดค่ะ' : ''}`
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
    const language = lineReplyLanguage(ctx.groundingText ?? '', ctx.locale?.startsWith('en') ? 'en' : 'th');
    const v = await this.vouchers.get(requestContext(ctx), input.voucherId);
    const { id, documentNumber, status, payeeName, totalAmount, paidDate, plannedPayDate } = v.header;
    return result(ctx, this.toolName, { id, documentNumber, status, payeeName, totalAmount, paidDate, plannedPayDate,
      lines: v.lines.map(({ expenseNumber, amount }) => ({ expenseNumber, amount })),
      message: language === 'en' ? `${documentNumber ?? 'Draft'} · ${payeeName} · ${money(totalAmount)} THB · ${lineUiLabel(DISBURSEMENT_VOUCHER_STATUS_LABELS[status], language)}${paidDate ? ` · paid ${lineDisplayDate(paidDate, language)}` : ''}\n${v.lines.map(line => `• ${line.expenseNumber ?? 'Expense'} ${money(line.amount)} THB`).join('\n')}` : `${documentNumber ?? 'ฉบับร่าง'} ของ ${payeeName} ยอด ${money(totalAmount)} บาท สถานะ${DISBURSEMENT_VOUCHER_STATUS_LABELS[status]}${paidDate ? ` วันที่จ่าย ${lineDisplayDate(paidDate, language)}` : ''}ค่ะ\n${v.lines.map((line, i) => `• ${line.expenseNumber ?? 'รายจ่าย'} ${money(line.amount)} บาท`).join('\n')}` },
    `expenses/disbursement-vouchers/${id}`, 'รายละเอียดใบเตรียมจ่าย/ใบสำคัญจ่าย');
  }
}

@Injectable()
export class WhtGetMonthSummaryTool implements ErpReadToolPort {
  toolName = 'wht.get_month_summary';
  constructor(private readonly handoffs: WhtCertificateHandoffUseCase, private readonly taxRepo: PrismaTaxRepository) {}
  async execute(ctx: ErpToolContext, input: { periodKey?: string; branchId?: string; dueDateOnly?: boolean } = {}): Promise<ToolResult> {
    const certificatesReadable = ctx.permissions.includes('wht.certificate.read');
    const pnd53Readable = ctx.permissions.includes('wht.pnd53.read');
    if ((!certificatesReadable && !pnd53Readable) || (input.dueDateOnly === true && !pnd53Readable)) return denied(this.toolName);
    if (input.branchId !== undefined && (typeof input.branchId !== 'string' || !input.branchId.trim())) throw new BadRequestException('กรุณาเลือกสาขาที่ต้องการค่ะ');
    if (input.branchId && !isBranchInScope(requestContext(ctx).scopes, input.branchId)) return denied(this.toolName);
    const today = todayCivilDate();
    const language = lineReplyLanguage(ctx.groundingText ?? '', ctx.locale?.startsWith('en') ? 'en' : 'th');
    let periodKey = input.periodKey;
    if (input.dueDateOnly === true && periodKey === undefined) {
      const text = ctx.inputEvidence?.parts.map(part => part.rawText).join('\n') ?? ctx.groundingText ?? '';
      // A deadline is a calendar question, so a named future month is meaningful too.
      const periods = resolvePeriodCandidates(text, today, [], undefined, { allowFuture: true }).filter(p => p.monthKey);
      const months = [...new Set(periods.map(p => p.source === 'named_month' && p.assumptions.includes(PERIOD_ASSUMPTIONS.yearAssumedLatest)
        ? `${today.slice(0, 4)}${p.monthKey!.slice(4)}` : p.monthKey!))];
      if (months.length > 1 || periods.some(isAmbiguousPeriodCandidate)) throw new BadRequestException('กรุณาระบุเดือนและปีที่ต้องการค่ะ');
      periodKey = months[0];
    }
    let period;
    if (input.dueDateOnly === true && periodKey === undefined) {
      const previous = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
      period = await this.taxRepo.findPeriod(ctx.companyId, 'PND53', previous);
      if (today <= pnd53PaperDueDay(previous, period?.dueDate)) periodKey = previous;
      else period = undefined;
    }
    periodKey ??= civilPeriodKey(today);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodKey)) throw new BadRequestException('กรุณาระบุเดือนและปีที่ต้องการค่ะ');
    if (period === undefined) period = pnd53Readable ? await this.taxRepo.findPeriod(ctx.companyId, 'PND53', periodKey) : null;
    const dueDate = pnd53Readable ? pnd53PaperDueDay(periodKey, period?.dueDate) : null;
    const monthLabel = new Date(`${periodKey}-01T00:00:00Z`).toLocaleDateString(language === 'en' ? 'en-GB' : 'th-TH', { month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok' });
    if (input.dueDateOnly === true) return result(ctx, this.toolName, { periodKey, dueDate,
      message: language === 'en' ? `PND53 for ${monthLabel} is due by ${lineDisplayDate(dueDate!, language)}.`
        : `ภ.ง.ด.53 ของเดือน${monthLabel} ต้องยื่นภายใน ${lineDisplayDate(dueDate!, language)} ค่ะ` }, 'tax/pnd53', 'วันยื่น ภ.ง.ด.53');
    // Reuse the web's complete permission/source-state/branch boundary, including source expense ABAC.
    const rows: WhtCertificateHandoffListRowDto[] = [];
    if (certificatesReadable) {
      for (let page = 1; ; page++) {
        const batch = await this.handoffs.listPaged(requestContext(ctx), { branchId: input.branchId, page, pageSize: 100 });
        rows.push(...batch.rows);
        if (page * batch.pageSize >= batch.total) break;
      }
    }
    const currentRows = [...new Map(rows.map(row => [row.id, row])).values()].filter(row => row.status !== 'CANCELLED');
    const sourceKey = (row: WhtCertificateHandoffListRowDto) => row.sourcePaymentType && row.sourcePaymentId
      ? JSON.stringify([row.sourcePaymentType, row.sourcePaymentId]) : null;
    const certified = new Map<string, { gross: Decimal; withheld: Decimal }>();
    for (const row of currentRows) {
      if (row.status !== 'SYSTEM_ISSUED' && row.status !== 'EXTERNAL_LINKED') continue;
      const key = sourceKey(row);
      if (!key) continue;
      const amounts = row.currentCertificate ?? row.prefill;
      const previous = certified.get(key) ?? { gross: new Decimal(0), withheld: new Decimal(0) };
      certified.set(key, { gross: previous.gross.plus(amounts.grossAmount), withheld: previous.withheld.plus(amounts.withheldAmount) });
    }
    const projected = currentRows.flatMap(row => {
      const amounts = row.currentCertificate ?? row.prefill;
      let gross = new Decimal(amounts.grossAmount), withheld = new Decimal(amounts.withheldAmount);
      if (row.status === 'REQUIRED' && row.sourcePaymentType === 'expense.record' && !row.prefill.expensePaymentId) {
        const total = row.prefill.expenseTotals ?? row.prefill;
        const issuedAmounts = certified.get(sourceKey(row) ?? '');
        gross = Decimal.max(0, new Decimal(total.grossAmount).minus(issuedAmounts?.gross ?? 0));
        withheld = Decimal.max(0, new Decimal(total.withheldAmount).minus(issuedAmounts?.withheld ?? 0));
        if (gross.isZero() && withheld.isZero()) return [];
      }
      return amounts.paymentDate.slice(0, 7) === periodKey ? [{ row, amounts, gross: gross.toFixed(2), withheld: withheld.toFixed(2) }] : [];
    });
    const issued = projected.map(p => p.row).filter(row => row.status === 'SYSTEM_ISSUED' || row.status === 'EXTERNAL_LINKED');
    const groups = new Map<string, { incomeCategoryName: string; itemCount: number; income: string[]; withheld: string[] }>();
    for (const { amounts, gross, withheld } of projected) {
      const key = amounts.incomeCategoryCode ?? '';
      const group = groups.get(key) ?? { incomeCategoryName: amounts.incomeCategoryName ?? 'ยังไม่ได้เลือกว่าจ่ายค่าอะไร', itemCount: 0, income: [], withheld: [] };
      group.itemCount++; group.income.push(gross); group.withheld.push(withheld); groups.set(key, group);
    }
    const byIncomeType = [...groups.values()].map(g => ({ incomeCategoryName: g.incomeCategoryName, itemCount: g.itemCount, totalIncome: sum(g.income), totalDocumentWithholding: sum(g.withheld) }));
    const events = period ? (await this.taxRepo.findEventsByPeriod(ctx.companyId, period.id, 'ACTIVE')).filter(event => event.eventType === 'WHT_PND53'
      && isBranchInScope(requestContext(ctx).scopes, event.branchId) && (!input.branchId || event.branchId === input.branchId)) : [];
    const remittance = period ? { totalWithheld: sum(events.map(e => e.taxAmount)), eventCount: events.length, status: period.status,
      dueDate: pnd53PaperDueDay(periodKey, period.dueDate), dueDateBasis: period.dueDate ? 'configured_period' : 'paper_filing_rule' } : null;
    const totalIncome = sum(byIncomeType.map(g => g.totalIncome)), totalDocumentWithholding = sum(byIncomeType.map(g => g.totalDocumentWithholding));
    const dueText = dueDate ? language === 'en' ? `, due ${lineDisplayDate(dueDate, language)}` : ` กำหนดยื่น ${lineDisplayDate(dueDate, language)} ` : '';
    const displayMoney = (value: string) => new Decimal(value).toNumber().toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const message = certificatesReadable
      ? language === 'en' ? `${monthLabel}: records within your access total ${displayMoney(totalIncome)} THB, withheld ${displayMoney(totalDocumentWithholding)} THB${dueText}.`
        : `รายการที่คุณดูได้เดือน ${monthLabel} รวม ${displayMoney(totalIncome)} บาท หักไว้ ${displayMoney(totalDocumentWithholding)} บาท${dueText}ค่ะ`
      : remittance ? language === 'en' ? `${monthLabel}: PND53 period total ${displayMoney(remittance.totalWithheld)} THB, due ${lineDisplayDate(remittance.dueDate, language)}.`
        : `ยอดที่รวบรวมไว้เดือน ${monthLabel} หักไว้ ${displayMoney(remittance.totalWithheld)} บาท กำหนดยื่น ${lineDisplayDate(remittance.dueDate, language)} ค่ะ`
        : language === 'en' ? `No collected data is available for this month${dueText}.` : `ยังไม่มีข้อมูลที่รวบรวมไว้สำหรับเดือนนี้${dueText}ค่ะ`;
    return result(ctx, this.toolName, { periodKey, certificateCount: certificatesReadable ? issued.length : null, certificateItemCount: certificatesReadable ? projected.length : null,
      countBasis: 'certificate_worklist_including_unpaid', totalIncome: certificatesReadable ? totalIncome : null,
      totalDocumentWithholding: certificatesReadable ? totalDocumentWithholding : null, byIncomeType,
      issuedCertificates: issued.slice(0, 10).map(r => ({ number: r.currentCertificate?.number ?? r.externalCertificateNumber ?? r.certificateNumber, payeeName: r.currentCertificate?.payee.name ?? r.prefill.payeeSnapshot.name,
        grossAmount: (r.currentCertificate ?? r.prefill).grossAmount, withheldAmount: (r.currentCertificate ?? r.prefill).withheldAmount })),
      remittance, dueDate, message }, pnd53Readable ? 'tax/pnd53' : 'expenses/wht-certificates', 'สรุป 50 ทวิและภาษีหัก ณ ที่จ่ายรายเดือน');
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
        ...(!catalog.length ? { readChoices: [{ label: 'ติดต่อทีมงานมั่งมี', text: 'ติดต่อเจ้าหน้าที่' }] } : {}),
        message: !catalog.length ? 'ยังไม่มีรายการให้เลือก พิมพ์ ‘ติดต่อเจ้าหน้าที่’ ให้ทีมงานช่วยค่ะ' : !category
          ? 'จ่ายค่าอะไรคะ'
          : 'ยอดที่ใช้คิดหัก ณ ที่จ่ายก่อน VAT เท่าไรคะ' }, 'expenses', 'รายการที่จ่ายที่เลือกได้');
    }
    const totals = calcLineTotals({ quantity: '1', unitPrice: baseAmount, vatMode: 'NO_VAT', whtRate: new Decimal(category.defaultRate).div(100).toString() });
    const withheldAmount = money(totals.whtAmount), netBeforeVat = new Decimal(baseAmount).minus(withheldAmount).toFixed(2);
    return result(ctx, this.toolName, { incomeCategoryName: category.nameTh, baseAmount, ratePercent: category.defaultRate, withheldAmount, netBeforeVat,
      message: `ยอดก่อน VAT ${baseAmount} บาท หัก ${new Decimal(category.defaultRate).toString()}% เป็น ${withheldAmount} บาท เหลือ ${netBeforeVat} บาทก่อนบวก VAT ค่ะ` }, 'expenses', 'คำนวณจากรายการที่จ่ายที่เลือกไว้');
  }
}
