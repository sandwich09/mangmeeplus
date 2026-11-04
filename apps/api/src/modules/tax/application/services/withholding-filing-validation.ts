import { orderWithholdingPayments } from './withholding-filing-state';
import { formatCompanyLegalAddress, type CompanyLegalAddress, type WithholdingMonthIssueDto, type WhtFormType, type WhtEstablishment } from '@watchdog-bms/contracts';
import type { Prisma } from '../../../../generated/prisma/client';
import type { TaxEventRecord } from '../../domain/ports/tax-event.repository.port';
import { printablePnd53PayeeAddress, type Pnd53Filing, type Pnd53FilingLine } from '../../domain/logic/pnd53-official-form.logic';
import { PND3_FILING_REVIEW_MESSAGES, withholdingIssueDescription } from '../../domain/logic/tax-period.logic';

type FilingEvent = Pick<TaxEventRecord, 'id' | 'eventType' | 'sourceType' | 'sourceId' | 'branchId' | 'eventDate' | 'currency' | 'payeeSnapshot' | 'incomeCategoryCode' | 'whtRate' | 'grossAmount' | 'withheldAmount' | 'sourceLineKey'>;
type ReviewIssue = Pick<WithholdingMonthIssueDto, 'id' | 'issueCode' | 'description' | 'severity' | 'sourceType' | 'sourceId'>;
export function withholdingRowFaults(event: FilingEvent, ctx: {
  formType: WhtFormType | 'PND2'; categoryByCode: ReadonlyMap<string, { formType?: string | null; nameTh: string }>; sourceKind?: string | null; expenseWithoutCounterparty?: boolean;
}): Array<{ reason: keyof typeof PND3_FILING_REVIEW_MESSAGES; detail: string }> {
  const { formType, categoryByCode } = ctx;
  const individual = formType !== 'PND53';
  const faults: Array<{ reason: keyof typeof PND3_FILING_REVIEW_MESSAGES; detail: string }> = [];
  const fault = (reason: keyof typeof PND3_FILING_REVIEW_MESSAGES, _event?: FilingEvent, detail?: string) => faults.push({ reason,
    detail: detail ?? withholdingIssueDescription(`${formType}_FILING_${reason.toUpperCase()}`, PND3_FILING_REVIEW_MESSAGES[reason], event.payeeSnapshot?.name, ctx.expenseWithoutCounterparty),
  });
  const payee = event.payeeSnapshot;
  const payeeAddress = printablePnd53PayeeAddress(payee?.address);
  const payeeTaxId = String(payee?.taxId ?? '').replace(/\D/g, '');
  const payeeBranch = payee?.branchCode ?? (individual ? '' : '00000');
  const missingPayee: string[] = [], invalidPayee: string[] = [];
  if (!payee?.name?.trim()) missingPayee.push('ชื่อผู้รับเงิน');
  else if (payee.name.length > 80) invalidPayee.push('ชื่อผู้รับเงินยาวเกินช่องของแบบ (80 ตัวอักษร)');
  if (!payeeTaxId) missingPayee.push('เลขผู้เสียภาษี');
  else if (!/^\d{13}$/.test(payeeTaxId)) invalidPayee.push('เลขผู้เสียภาษีต้องมี 13 หลัก');
  if (!(individual && payeeBranch === '') && !/^\d{5}$/.test(payeeBranch)) invalidPayee.push('รหัสสาขาภาษีต้องมี 5 หลัก');
  if (!payeeAddress) missingPayee.push('ที่อยู่');
  else if (payeeAddress.length > 104) invalidPayee.push('ที่อยู่ยาวเกินช่องของแบบ (104 ตัวอักษร)');
  if (missingPayee.length || invalidPayee.length) fault('payee', event,
    `${payee?.name?.trim() || 'ผู้รับเงิน'}: ${[...(missingPayee.length ? [`ข้อมูลผู้รับเงินยังขาด: ${missingPayee.join(' · ')}`] : []), ...invalidPayee, 'เปิดรายจ่ายหรือคู่ค้าแล้วแก้ไข'].join(' · ')}`);
  if (!categoryByCode.has(event.incomeCategoryCode ?? '')) fault('category', event);
  const categoryForm = categoryByCode.get(event.incomeCategoryCode ?? '')?.formType;
  if (categoryForm && categoryForm !== formType) fault('kind', event);
  const rate = Number(event.whtRate), income = Number(event.grossAmount), withheld = Number(event.withheldAmount);
  // This checks tax against rate, not certificate/filing income equality. Keep the two-satang
  // allowance for independent payment-share rounding and saved legacy per-line withholding.
  if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(income) || income <= 0 || !Number.isFinite(withheld) || (withheld < 0 || (withheld === 0 && !event.sourceLineKey?.startsWith('payment:'))) || Math.abs(Math.round(income * rate) / 100 - withheld) > 0.02) fault('amount', event);
  if (event.sourceType === 'expense.record') {
    if (ctx.sourceKind !== (individual ? 'INDIVIDUAL' : 'JURISTIC')) fault('kind', event);
  } else if (event.sourceType === 'procurement.supplier_payment') {
    if (ctx.sourceKind !== (individual ? 'INDIVIDUAL' : 'JURISTIC_PERSON')) fault('kind', event);
  } else fault('source', event);
  return faults;
}

/** Live facts, shared by the month read and PDF export. Old filing issues are historical, never inputs. */
export async function validateWithholdingFiling(db: Prisma.TransactionClient, companyId: string, formType: WhtFormType,
  period: { periodKey: string; dueDate?: Date | null }, events: FilingEvent[], reviewIssues: ReviewIssue[], establishment?: WhtEstablishment, sequence = 0, historical = false) {
  const individual = formType === 'PND3';
  const reviews = reviewIssues.filter(issue => !/^PND(?:3|53)_FILING_/.test(issue.issueCode) && issue.issueCode !== 'WHT_PAYEE_KIND_UNKNOWN');
  const refs = [...events, ...reviews];
  const ids = (type: string) => [...new Set(refs.filter(row => row.sourceType === type).flatMap(row => row.sourceId ? [row.sourceId] : []))];
  const expenseIds = ids('expense.record'), supplierIds = ids('procurement.supplier_payment');
  const [company, profile, categories, expenses, supplierPayments] = await Promise.all([
    db.company.findUnique({ where: { id: companyId } }), db.companyTaxProfile.findUnique({ where: { companyId } }),
    db.whtIncomeCategory.findMany({ where: { code: { in: events.flatMap(event => event.incomeCategoryCode ? [event.incomeCategoryCode] : []) } } }),
    expenseIds.length ? db.expenseRecord.findMany({ where: { companyId, id: { in: expenseIds } }, select: { id: true, vendorEntityKindSnapshot: true, vendorCounterpartyId: true, vendorNameSnapshot: true } }) : [],
    supplierIds.length ? db.supplierPayment.findMany({ where: { companyId, id: { in: supplierIds } }, select: { id: true, supplier: { select: { supplierType: true, counterpartyId: true } } } }) : [],
  ]);
  const counterpartyIds = [...new Set(expenses.filter(row => row.vendorEntityKindSnapshot == null && row.vendorCounterpartyId).map(row => row.vendorCounterpartyId!))];
  const counterparties = counterpartyIds.length ? await db.accountingCounterparty.findMany({ where: { companyId, id: { in: counterpartyIds } }, select: { id: true, entityKind: true } }) : [];
  const expenseById = new Map(expenses.map(row => [row.id, row]));
  const supplierById = new Map(supplierPayments.map(row => [row.id, row.supplier]));
  const kinds = new Map(counterparties.map(row => [row.id, row.entityKind]));
  const counterpartyId = (sourceType: string | null, sourceId: string | null) => sourceType === 'expense.record'
    ? expenseById.get(sourceId ?? '')?.vendorCounterpartyId ?? null : supplierById.get(sourceId ?? '')?.counterpartyId ?? null;
  const issues: WithholdingMonthIssueDto[] = reviews.map(issue => ({ ...issue,
    description: withholdingIssueDescription(issue.issueCode, issue.description, expenseById.get(issue.sourceId ?? '')?.vendorNameSnapshot),
    expenseId: issue.sourceType === 'expense.record' ? issue.sourceId : null, counterpartyId: counterpartyId(issue.sourceType, issue.sourceId),
  }));
  const fault = (reason: keyof typeof PND3_FILING_REVIEW_MESSAGES, event?: FilingEvent, detail?: string) => {
    const issueCode = `${formType}_FILING_${reason.toUpperCase()}`;
    const sourceType = event?.sourceType ?? null, sourceId = event?.sourceId ?? null;
    const id = `filing:${formType}:${reason}:${sourceType ?? ''}:${sourceId ?? ''}`;
    if (issues.some(issue => issue.id === id)) return;
    issues.push({ id, issueCode, severity: 'BLOCKING', sourceType, sourceId,
      expenseId: sourceType === 'expense.record' ? sourceId : null, counterpartyId: counterpartyId(sourceType, sourceId),
      description: detail ?? withholdingIssueDescription(issueCode, PND3_FILING_REVIEW_MESSAGES[reason], event?.payeeSnapshot?.name, sourceType === 'expense.record' && !counterpartyId(sourceType, sourceId)),
    });
  };
  const categoryByCode = new Map(categories.map(category => [category.code, category]));
  // Restoration must keep rows in their original form even when today's catalogue route differs.
  if (!historical) events = events.filter(event => categoryByCode.get(event.incomeCategoryCode ?? '')?.filingRoute !== 'SEPARATE_PND2');
  const accountantTypes = events.filter(event => categoryByCode.get(event.incomeCategoryCode ?? '')?.filingRoute === 'ACCOUNTANT_PREPARES')
    .map(event => ({ incomeType: categoryByCode.get(event.incomeCategoryCode!)!.nameTh, payeeName: event.payeeSnapshot?.name ?? '' }));

  if (!events.length) fault('empty');
  const [year, month] = period.periodKey.split('-').map(Number);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period.periodKey)) fault('month');
  else {
    const dueDay = period.dueDate?.toISOString().slice(0, 10) ?? new Date(Date.UTC(year, month, 7)).toISOString().slice(0, 10);
    if (sequence === 0 && Date.now() > Date.parse(`${dueDay}T16:59:59.999Z`)) fault('overdue');
  }
  const branchIds = new Set(events.map(event => event.branchId ?? null));
  if (!establishment && branchIds.size > 1) fault('branches');
  const branchId = establishment ? establishment.branchId : branchIds.size === 1 ? [...branchIds][0] : null;
  const branch = branchId ? await db.branch.findFirst({ where: { id: branchId, companyId } }) : null;
  if (branchId && !branch) fault('branch');
  const payerName = company?.registeredName?.trim() ?? '';
  const payerTaxId = String(profile?.taxId ?? company?.taxId ?? '').replace(/\D/g, '');
  const payerBranch = establishment?.code ?? branch?.taxBranchCode ?? '00000';
  const payerAddress = (establishment && (branch?.type === 'HEAD_OFFICE' || !branchId) ? company?.addressJson : branch?.addressJson ?? company?.addressJson) as CompanyLegalAddress | null;
  const payer = { periodKey: period.periodKey, payerName, payerTaxId, payerBranch, payerAddress: payerAddress! };
  if (accountantTypes.length && !/^\d{5}$/.test(payerBranch)) fault('payer', undefined, 'รหัสสาขาภาษีต้องมี 5 หลัก เปิดข้อมูลร้านแล้วแก้ไข');
  if (accountantTypes.length && !historical) return { issues: issues.filter(issue => issue.issueCode.endsWith('_BRANCHES') || issue.issueCode.endsWith('_BRANCH') || issue.issueCode.endsWith('_PAYER')),
    filing: null, candidateFiling: null, eventIds: events.map(event => event.id), payer, establishmentBranchId: branchId, accountantPrepared: true, accountantTypes };
  const missing: string[] = [], invalid: string[] = [];
  if (!payerName) missing.push('ชื่อจดทะเบียน');
  else if (payerName.length > 80) invalid.push('ชื่อจดทะเบียนยาวเกินช่องของแบบ (80 ตัวอักษร)');
  if (!payerTaxId) missing.push('เลขผู้เสียภาษี');
  else if (!/^\d{13}$/.test(payerTaxId)) invalid.push('เลขผู้เสียภาษีต้องมี 13 หลัก');
  if (!/^\d{5}$/.test(payerBranch)) invalid.push('รหัสสาขาภาษีต้องมี 5 หลัก');
  if (!payerAddress || !formatCompanyLegalAddress(payerAddress) || !payerAddress.line1?.trim() || !payerAddress.subdistrict?.trim()
    || !payerAddress.district?.trim() || !payerAddress.province?.trim() || !/^\d{5}$/.test(payerAddress.postalCode ?? '')) missing.push('ที่อยู่');
  const addressLimits = [['line1', 'ที่อยู่ (บ้านเลขที่ ถนน)', 50], ['line2', 'ที่อยู่เพิ่มเติม', 35], ['subdistrict', 'ตำบล / แขวง', 35], ['district', 'อำเภอ / เขต', 35], ['province', 'จังหวัด', 35]] as const;
  for (const [key, label, limit] of addressLimits) if ((payerAddress?.[key]?.length ?? 0) > limit) invalid.push(`${label}ยาวเกินช่องของแบบ (${limit} ตัวอักษร)`);
  if (missing.length || invalid.length) fault('payer', undefined, [...(missing.length ? [`ข้อมูลร้านยังขาด: ${missing.join(' · ')}`] : []), ...invalid, 'เปิดข้อมูลร้านแล้วแก้ไข'].join(' · '));
  const categoryNames = new Map(categories.map(category => [category.code, category.nameTh]));
  const lines: Pnd53FilingLine[] = [];
  for (const event of orderWithholdingPayments(events, formType)) {
    if (event.eventType !== `WHT_${formType}` || event.currency !== 'THB' || event.eventDate.toISOString().slice(0, 7) !== period.periodKey) fault('event', event);
    const payee = event.payeeSnapshot;
    const payeeAddress = printablePnd53PayeeAddress(payee?.address);
    const payeeTaxId = String(payee?.taxId ?? '').replace(/\D/g, '');
    const payeeBranch = payee?.branchCode ?? (individual ? '' : '00000');
    const source = expenseById.get(event.sourceId);
    const sourceKind = event.sourceType === 'expense.record'
      ? source?.vendorEntityKindSnapshot ?? kinds.get(source?.vendorCounterpartyId ?? '')
      : supplierById.get(event.sourceId)?.supplierType;
    for (const item of withholdingRowFaults(event, { formType, categoryByCode, sourceKind, expenseWithoutCounterparty: event.sourceType === 'expense.record' && !counterpartyId(event.sourceType, event.sourceId) })) fault(item.reason, event, item.detail);
    const incomeType = event.incomeCategoryCode ? categoryNames.get(event.incomeCategoryCode) : null;
    const rate = Number(event.whtRate), income = Number(event.grossAmount), withheld = Number(event.withheldAmount);
    lines.push({ payeeName: payee?.name ?? '', payeeTaxId, payeeBranch, payeeAddress: payeeAddress ?? '', paidAt: event.eventDate, incomeType: incomeType ?? '', rate, income, withheld });
  }
  lines.sort((a, b) => a.payeeTaxId.localeCompare(b.payeeTaxId) || a.payeeBranch.localeCompare(b.payeeBranch) || a.paidAt.getTime() - b.paidAt.getTime());
  const unique = issues.filter((issue, index) => issues.findIndex(other => other.issueCode === issue.issueCode && other.sourceType === issue.sourceType && other.sourceId === issue.sourceId) === index);
  const candidateFiling: Pnd53Filing = { sequence, periodKey: period.periodKey, payerName, payerTaxId, payerBranch, payerAddress: payerAddress!, lines };
  const filing = unique.some(issue => issue.severity === 'BLOCKING') ? null : candidateFiling;
  return { issues: unique, filing, candidateFiling, eventIds: events.map(event => event.id), payer, establishmentBranchId: branchId, accountantPrepared: false, accountantTypes };
}
