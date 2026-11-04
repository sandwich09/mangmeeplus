import { branchScopeWhere, type BranchScopes } from '../../../data-model-core/domain/logic/branch.logic';
import { ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '../../../../generated/prisma/client';
import type { TaxEventRecord } from '../../domain/ports/tax-event.repository.port';

type Payment = Pick<TaxEventRecord, 'sourceType' | 'sourceId' | 'eventDate' | 'grossAmount' | 'withheldAmount' | 'whtRate'> &
  Partial<Pick<TaxEventRecord, 'branchId' | 'currency' | 'incomeCategoryCode' | 'payeeSnapshot' | 'sourceLineKey'>>;

/** Canonical payment facts kept alongside printed line fields, independent of event replacement. */
export function withholdingPaymentFacts(event: Payment) {
  const amount = (value: string | null) => value == null ? null : new Prisma.Decimal(value).toString();
  return [event.sourceType, event.sourceId, event.eventDate.toISOString(), event.branchId ?? null, event.currency ?? null,
    event.incomeCategoryCode ?? null, amount(event.grossAmount), amount(event.withheldAmount), amount(event.whtRate),
    event.payeeSnapshot?.name ?? null, event.payeeSnapshot?.taxId ?? null,
    event.payeeSnapshot?.branchCode ?? null, event.payeeSnapshot?.address ?? null,
    ...(event.sourceLineKey?.startsWith('payment:') ? [event.sourceLineKey] : [])];
}
export function withholdingPaymentChecksum(events: Payment[]): string {
  return createHash('sha256').update(JSON.stringify(events.map(event => JSON.stringify(withholdingPaymentFacts(event))).sort())).digest('hex');
}
export function orderWithholdingPayments<T extends Payment>(events: T[], formType: string): T[] {
  return [...events].sort((a, b) => (a.payeeSnapshot?.taxId ?? '').replace(/\D/g, '').localeCompare((b.payeeSnapshot?.taxId ?? '').replace(/\D/g, ''))
    || (a.payeeSnapshot?.branchCode ?? (formType === 'PND3' ? '' : '00000')).localeCompare(b.payeeSnapshot?.branchCode ?? (formType === 'PND3' ? '' : '00000'))
    || a.eventDate.getTime() - b.eventDate.getTime() || a.sourceType.localeCompare(b.sourceType) || a.sourceId.localeCompare(b.sourceId) || (a.sourceLineKey ?? '').localeCompare(b.sourceLineKey ?? ''));
}

/** A voided source can outlive its active tax event until background sync retires it. */
export async function currentWithholdingPayments<T extends { sourceType: string; sourceId: string; sourceLineKey?: string }>(db: Prisma.TransactionClient, companyId: string, events: T[], scopes?: BranchScopes): Promise<T[]> {
  const ids = (type: string) => events.filter(event => event.sourceType === type).map(event => event.sourceId);
  const expenseIds = ids('expense.record'), supplierIds = ids('procurement.supplier_payment');
  const [expenses, suppliers] = await Promise.all([
    expenseIds.length ? db.expenseRecord.findMany({ where: { companyId, id: { in: expenseIds }, status: 'CONFIRMED', ...(scopes ? branchScopeWhere(scopes) : {}) }, select: { id: true } }) : [],
    supplierIds.length ? db.supplierPayment.findMany({ where: { companyId, id: { in: supplierIds }, status: 'RECORDED', ...(scopes ? branchScopeWhere(scopes) : {}) }, select: { id: true } }) : [],
  ]);
  const paymentIds = events.flatMap(e => e.sourceLineKey?.startsWith('payment:') ? [e.sourceLineKey.slice(8).split(':line:')[0]] : []);
  const paid = paymentIds.length ? await db.expensePayment.findMany({ where: { companyId, id: { in: paymentIds }, status: 'RECORDED', paidAtConfirmed: true }, select: { id: true } }) : [];
  const active = new Set([...expenses.map(row => `expense.record:${row.id}`), ...suppliers.map(row => `procurement.supplier_payment:${row.id}`)]);
  return events.filter(event => (!event.sourceLineKey?.startsWith('payment:') || paid.some(p => p.id === event.sourceLineKey!.slice(8).split(':line:')[0])) && (!['expense.record', 'procurement.supplier_payment'].includes(event.sourceType) || active.has(`${event.sourceType}:${event.sourceId}`)));
}

/** Older packages without an associated payment snapshot require a fresh official download. */
export async function isWithholdingDownloadCurrent(db: Prisma.TransactionClient, companyId: string, periodId: string,
  events: Payment[], pkg?: { id: string } | null, establishmentCode?: string, sequence = 0): Promise<boolean> {
  const latest = pkg === undefined ? await db.taxFilingPackage.findFirst({
    where: { companyId, taxPeriodId: periodId, whtFiling: { sequence, ...(establishmentCode ? { establishmentCode } : {}) }, exportFormat: { in: ['PDF', 'XLSX'] }, status: { in: ['GENERATED', 'DOWNLOADED'] } },
    orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }],
  }) : pkg;
  if (!latest) return false;
  const filing = await db.whtFiling.findFirst({
    where: { companyId, taxPeriodId: periodId, filingPackageId: latest.id, rowsCertain: true },
    include: { lines: { orderBy: { rowNumber: 'asc' } } },
  });
  if (!filing) return false;
  const frozen = filing.lines.map(line => JSON.stringify((line.lineJson as { payment: unknown }).payment)).sort();
  const current = (await currentWithholdingPayments(db, companyId, events)).map(event => JSON.stringify(withholdingPaymentFacts(event))).sort();
  return JSON.stringify(frozen) === JSON.stringify(current);
}

/** A source keeps its filed identity even when a sync replaces its event or its establishment changes. */
export function filedLineCoversPayment(line: { sourceType: string; sourceId: string; lineJson?: unknown }, event: { sourceType: string; sourceId: string; sourceLineKey?: string; paymentId?: string | null }) {
  const key = (line.lineJson as { payment?: unknown[] } | undefined)?.payment?.[13];
  const eventKey = event.sourceLineKey ?? (event.paymentId ? `payment:${event.paymentId}` : undefined);
  return line.sourceType === event.sourceType && line.sourceId === event.sourceId && (!key || key === eventKey
    || typeof key === 'string' && key.startsWith('payment:') && !key.includes(':line:') && eventKey?.startsWith(`${key}:line:`) === true);
}
type Paper = { status: string; sequence?: number; rowsCertain: boolean; lines?: { sourceType: string; sourceId: string; lineJson?: unknown }[] };
export function openWithholdingSequence(papers: Paper[]): number | null {
  const normal = papers.find(p => (p.sequence ?? 0) === 0 && p.status === 'FILED');
  if (!normal) return 0;
  if (!normal.rowsCertain) return null;
  return papers.filter(p => (p.sequence ?? 0) > 0 && p.status === 'FILED').length + 1;
}
export function withholdingPaperPayments<T extends { sourceType: string; sourceId: string; sourceLineKey?: string }>(events: T[], papers: Paper[]): T[] {
  const filed = papers.filter(p => p.status === 'FILED').flatMap(p => p.lines ?? []);
  return events.filter(e => !filed.some(line => filedLineCoversPayment(line, e)));
}
export function assertOpenWithholdingSequence(papers: Paper[], sequence: number) {
  if (!Number.isInteger(sequence) || sequence < 0 || openWithholdingSequence(papers) !== sequence) {
    throw new ConflictException({ code: 'WHT_FILING_SEQUENCE_INVALID', message: 'แบบที่เลือกเปลี่ยนแล้ว เปิดข้อมูลเดือนนี้ใหม่แล้วเลือกแบบอีกครั้ง' });
  }
}
