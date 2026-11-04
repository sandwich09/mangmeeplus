import { buildWorkbook, XLSX_MIME_TYPE } from '../../../../common/export/xlsx.logic';
import { formatThaiExportDate } from '../../../../common/export/thai-date.logic';
import { printablePnd53PayeeAddress } from '../../domain/logic/pnd53-official-form.logic';
import { E_WHT_WORDS, expenseCurrencyLabel, civilDate } from '@watchdog-bms/contracts';
import { cancelledWithholdingRows, cancelledPayeeNames } from '../services/withholding-filing-history';
import { loadWithholdingEstablishments, partitionWithholdingPayments } from '../services/withholding-establishments';
import { isBranchInScope } from '../../../data-model-core/domain/logic/branch.logic';
import { filedLineCoversPayment, openWithholdingSequence, withholdingPaperPayments, currentWithholdingPayments } from '../services/withholding-filing-state';
import { resolveWhtEstablishment, whtPayerModeInForce } from '../../domain/logic/wht-payer-mode.logic';
import { BadRequestException, Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaTaxRepository } from '../../infrastructure/repositories/prisma-tax.repository';
import { groupWhtEvents, computeWhtTotals } from '../../domain/logic/wht-report.logic';
import type { RequestContext, WithholdingMonthDto, WithholdingMonthsDto, WhtFormType, WhtReportDto } from '@watchdog-bms/contracts';

import { Prisma } from '../../../../generated/prisma/client';
import { branchScopeWhere } from '../../../data-model-core/domain/logic/branch.logic';
import { handoffBranchWhere, handoffReadBoundary } from '../services/wht-handoff-read-scope';
import { isWithholdingDownloadCurrent } from '../services/withholding-filing-state';
import { validateWithholdingFiling, withholdingPaperBlockers } from '../services/withholding-filing-validation';
import { isPeriodLocked, evaluateDueDate, monthlyPeriodKey, withholdingIssueDescription } from '../../domain/logic/tax-period.logic';

@Injectable()
export class GenerateWhtReportUseCase {
  constructor(private readonly taxRepo: PrismaTaxRepository) {}

  async listMonths(ctx: RequestContext): Promise<WithholdingMonthsDto> {
    const db = this.taxRepo.prisma.client;
    const [periods, events, expenses, payments] = await Promise.all([
      db.taxPeriod.findMany({ where: { companyId: ctx.companyId, formType: { in: ['PND2', 'PND3', 'PND53'] } }, select: { periodKey: true }, distinct: ['periodKey'] }),
      db.taxEvent.findMany({ where: { companyId: ctx.companyId, status: 'ACTIVE', eventType: { in: ['WHT_PND2', 'WHT_PND3', 'WHT_PND53'] },
        ...branchScopeWhere(ctx.scopes ?? {}) }, select: { periodKey: true }, distinct: ['periodKey'] }),
      db.expenseRecord.findMany({ where: { companyId: ctx.companyId, status: 'CONFIRMED', whtAmount: { gt: 0 }, ...branchScopeWhere(ctx.scopes ?? {}) },
        select: { expenseDate: true, payments: { where: { status: 'RECORDED', paidAtConfirmed: true }, select: { paidAt: true } } } }),
      db.supplierPayment.findMany({ where: { companyId: ctx.companyId, status: 'RECORDED', whtAmount: { gt: 0 }, ...branchScopeWhere(ctx.scopes ?? {}) },
        select: { paymentDate: true }, distinct: ['paymentDate'] }),
    ]);
    const company = await db.company.findUnique({ where: { id: ctx.companyId }, select: { timezone: true } });
    return { months: [...new Set([...periods.map(row => row.periodKey), ...events.map(row => row.periodKey),
      ...expenses.flatMap(row => (row.payments ?? []).length ? row.payments.map(p => civilDate(p.paidAt, company?.timezone ?? 'Asia/Bangkok').slice(0, 7)) : [monthlyPeriodKey(row.expenseDate)]), ...payments.map(row => monthlyPeriodKey(row.paymentDate))])].sort().reverse() };
  }

  async getMonth(ctx: RequestContext, periodKey: string): Promise<WithholdingMonthDto> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodKey)) throw new BadRequestException('เดือนภาษีไม่ถูกต้อง เลือกเดือนอีกครั้ง');
    return this.taxRepo.prisma.client.$transaction(async db => {
      const [periods, events, categories, branches, payerFacts, excluded] = await Promise.all([
        db.taxPeriod.findMany({ where: { companyId: ctx.companyId, periodKey, formType: { in: ['PND2', 'PND3', 'PND53'] } } }),
        db.taxEvent.findMany({ where: { companyId: ctx.companyId, periodKey, status: 'ACTIVE', eventType: { in: ['WHT_PND2', 'WHT_PND3', 'WHT_PND53'] },
          ...branchScopeWhere(ctx.scopes ?? {}) }, orderBy: [{ eventDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }] }),
        db.whtIncomeCategory.findMany({ where: { formType: { in: ['PND2', 'PND3', 'PND53'] } }, select: { code: true, nameTh: true } }),
        // Include inactive branches: an old payment still belongs to its branch.
        db.branch.findMany({ where: { companyId: ctx.companyId }, select: { id: true, name: true, type: true, status: true, taxBranchCode: true } }),
        db.whtPayerModeFact.findMany({ where: { companyId: ctx.companyId, supersededAt: null, effectiveFromPeriodKey: { lte: periodKey } } }),
        db.taxEvent.findMany({ where: { companyId: ctx.companyId, periodKey, status: 'EXCLUDED', eventType: { in: ['WHT_PND2', 'WHT_PND3', 'WHT_PND53'] }, ...branchScopeWhere(ctx.scopes ?? {}) }, orderBy: [{ eventDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }] }),
      ]);
      const bankPayments = await currentWithholdingPayments(db, ctx.companyId, excluded.filter(e => e.status === 'EXCLUDED'), ctx.scopes ?? {});
      const undatedSources = await db.expenseRecord.findMany({ where: { companyId: ctx.companyId, status: 'CONFIRMED', whtAmount: { gt: 0 }, ...branchScopeWhere(ctx.scopes ?? {}) },
        select: { id: true, expenseDate: true, netPayableAmount: true, whtAmount: true, vendorNameSnapshot: true, payments: { where: { status: 'RECORDED' }, select: { id: true, amount: true, paidAtConfirmed: true, createdAt: true, createdByUserId: true } } } });
      const undatedPayments = undatedSources.flatMap(e => (e.payments ?? []).filter(p => p.paidAtConfirmed === false).map(p => ({ paymentId: p.id, expenseId: e.id, payeeName: e.vendorNameSnapshot ?? '', amount: p.amount.toString(), recordedAt: p.createdAt.toISOString(), recordedByUserId: p.createdByUserId })));
      const unpaidExpenses = undatedSources.filter(e => !(e.payments ?? []).length && e.expenseDate?.toISOString().slice(0, 7) === periodKey).map(e => ({ expenseId: e.id, payeeName: e.vendorNameSnapshot ?? '' }));
      const paidWithoutWithholding = undatedSources.filter(e => new Prisma.Decimal(String(e.whtAmount ?? 0)).gt(0) && (e.payments ?? []).reduce((sum, p) => sum.add(String(p.amount)), new Prisma.Decimal(0)).gte(new Prisma.Decimal(String(e.netPayableAmount ?? 0)).add(String(e.whtAmount ?? 0)))).map(e => ({ expenseId: e.id, payeeName: e.vendorNameSnapshot ?? '' }));
      const issues = periods.length ? await db.taxReviewIssue.findMany({ where: {
        companyId: ctx.companyId, taxPeriodId: { in: periods.map(period => period.id) }, status: 'OPEN',
      }, orderBy: { createdAt: 'asc' } }) : [];
      // Old expense events have no branch attribution. Read the source branch too, including
      // unknown-kind issues which deliberately have no tax event yet.
      const refs = [...events, ...bankPayments, ...issues];
      const ids = (type: string) => [...new Set(refs.filter(row => row.sourceType === type).flatMap(row => row.sourceId ? [row.sourceId] : []))];
      const expenseIds = ids('expense.record'), paymentIds = ids('procurement.supplier_payment');
      const [expenses, supplierPayments] = await Promise.all([
        expenseIds.length ? db.expenseRecord.findMany({ where: { companyId: ctx.companyId, id: { in: expenseIds }, ...branchScopeWhere(ctx.scopes ?? {}) },
          select: { id: true, branchId: true, company: { select: { timezone: true } }, netPayableAmount: true, status: true, confirmedAt: true, createdAt: true, payments: { where: { status: 'RECORDED' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true, createdAt: true, paidAt: true, paidAtConfirmed: true, amount: true } }, vendorCounterpartyId: true, whtCategoryCode: true, vendorNameSnapshot: true } }) : [],
        paymentIds.length ? db.supplierPayment.findMany({ where: { companyId: ctx.companyId, id: { in: paymentIds }, ...branchScopeWhere(ctx.scopes ?? {}) },
          select: { id: true, branchId: true, status: true, recordedAt: true, createdAt: true, supplier: { select: { counterpartyId: true } } } }) : [],
      ]);
      const sources = new Map<string, string | null>([
        ...expenses.map(row => [`expense.record:${row.id}`, row.vendorCounterpartyId] as const),
        ...supplierPayments.map(row => [`procurement.supplier_payment:${row.id}`, row.supplier.counterpartyId] as const),
      ]);
      const visible = (row: { sourceType: string | null; sourceId: string | null }) => !row.sourceId || sources.has(`${row.sourceType}:${row.sourceId}`);
      const recordingTimes = new Map<string, number>([
        ...expenses.map(row => [`expense.record:${row.id}`, (row.payments?.[0]?.createdAt ?? row.confirmedAt ?? row.createdAt)?.getTime() ?? 0] as const),
        ...supplierPayments.map(row => [`procurement.supplier_payment:${row.id}`, (row.recordedAt ?? row.createdAt)?.getTime() ?? 0] as const),
      ]);
      for (const expense of expenses) for (const payment of expense.payments ?? []) recordingTimes.set(`expense.record:${expense.id}:payment:${payment.id}`, payment.createdAt.getTime());
      const recordedAt = (e: { sourceType: string; sourceId: string; sourceLineKey?: string }) => recordingTimes.get(`${e.sourceType}:${e.sourceId}:${e.sourceLineKey?.split(':line:')[0]}`) ?? recordingTimes.get(`${e.sourceType}:${e.sourceId}`) ?? 0;
      const inactive = new Set([
        ...expenses.filter(row => row.status && row.status !== 'CONFIRMED').map(row => `expense.record:${row.id}`),
        ...supplierPayments.filter(row => row.status && row.status !== 'RECORDED').map(row => `procurement.supplier_payment:${row.id}`),
      ]);
      const sourceKey = (row: { sourceType: string; sourceId: string }) => `${row.sourceType}:${row.sourceId}`;
      const payments = events.filter(row => visible(row) && !inactive.has(sourceKey(row)) && (!row.sourceLineKey?.startsWith('payment:') || expenses.find(e => e.id === row.sourceId)?.payments.some(p => p.id === row.sourceLineKey.slice(8).split(':line:')[0] && p.paidAtConfirmed))).map(row => ({ ...row, branchId: row.branchId ?? (row.sourceType === 'expense.record' ? expenses.find(e => e.id === row.sourceId)?.branchId : supplierPayments.find(p => p.id === row.sourceId)?.branchId) ?? null })).sort((a, b) =>
        b.eventDate.getTime() - a.eventDate.getTime() || recordedAt(b) - recordedAt(a)
        || sourceKey(b).localeCompare(sourceKey(a)) || b.id.localeCompare(a.id));
      const handoffs = payments.length ? await db.whtCertificateHandoff.findMany({ where: { AND: [handoffBranchWhere(ctx), { OR: [
        { sourcePaymentType: 'expense.record', sourcePaymentId: { in: expenses.map(row => row.id) } },
        { sourcePaymentType: 'procurement.supplier_payment', sourcePaymentId: { in: supplierPayments.map(row => row.id) } },
        ...payments.map(row => ({ taxEventIdsJson: { array_contains: [row.id] } })),
      ] }] }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }) : [];
      const certificates = handoffs.length ? await db.whtCertificate.findMany({ where: { companyId: ctx.companyId,
        id: { in: handoffs.flatMap(row => row.certificateId ? [row.certificateId] : []) }, status: 'ISSUED' }, select: { id: true, certificateNumber: true } }) : [];
      const certificateNumbers = new Map(certificates.map(row => [row.id, row.certificateNumber]));
      const canReadCertificate = ['wht.certificate.read', 'wht.certificate.issue', 'wht.certificate.correct', 'wht.external_certificate.link'].some(p => ctx.permissions.includes(p));
      const readable = canReadCertificate && handoffs.length ? await handoffReadBoundary(db, ctx, { AND: [handoffBranchWhere(ctx), { id: { in: handoffs.map(row => row.id) } }] }) : null;
      const readableHandoffs = readable ? await db.whtCertificateHandoff.findMany({ where: readable.where, select: { id: true } }) : [];
      const readableIds = new Set(readableHandoffs.map(row => row.id));
      const categoryNames = new Map(categories.map(row => [row.code, row.nameTh]));
      const handoffBySource = new Map<string, (typeof handoffs)[number]>();
      const handoffByEvent = new Map<string, (typeof handoffs)[number]>();
      for (const row of handoffs) {
        const paymentId = (row.prefillSnapshotJson as { expensePaymentId?: string } | null)?.expensePaymentId;
        const sourceKey = `${row.sourcePaymentType}:${row.sourcePaymentId}${paymentId ? `:payment:${paymentId}` : ''}`;
        if (!handoffBySource.has(sourceKey)) handoffBySource.set(sourceKey, row);
        for (const id of Array.isArray(row.taxEventIdsJson) ? row.taxEventIdsJson : []) {
          if (typeof id === 'string' && !handoffByEvent.has(id)) handoffByEvent.set(id, row);
        }
      }
      const payerMode = whtPayerModeInForce(payerFacts, periodKey);
      const mapPayment = (event: (typeof events)[number]): WithholdingMonthDto['payments'][number] & { sourceLineKey: string } => {
        const paymentKey = event.sourceLineKey?.match(/^payment:[^:]+/)?.[0];
        const handoff = (paymentKey ? handoffBySource.get(`${event.sourceType}:${event.sourceId}:${paymentKey}`) : undefined)
          ?? handoffBySource.get(`${event.sourceType}:${event.sourceId}`) ?? handoffByEvent.get(event.id);
        const source = expenses.find(row => event.sourceType === 'expense.record' && row.id === event.sourceId);
        const categoryCode = categoryNames.has(event.incomeCategoryCode ?? '') ? event.incomeCategoryCode : source?.whtCategoryCode ?? event.incomeCategoryCode;
        const number = handoff?.status === 'SYSTEM_ISSUED' ? certificateNumbers.get(handoff.certificateId ?? '') ?? null
          : handoff?.status === 'EXTERNAL_LINKED' ? handoff.externalCertificateNumber : null;
        return { establishment: resolveWhtEstablishment(payerMode, branches, event.branchId ?? source?.branchId
          ?? supplierPayments.find(row => event.sourceType === 'procurement.supplier_payment' && row.id === event.sourceId)?.branchId ?? null),
          sourceLineKey: event.sourceLineKey, paymentId: event.sourceLineKey?.startsWith('payment:') ? event.sourceLineKey.slice(8).split(':line:')[0] : null, id: event.id, paymentDate: event.eventDate.toISOString().slice(0, 10), payeeName: (event.payeeSnapshotJson as { name?: string } | null)?.name ?? '',
          formType: event.eventType === 'WHT_PND2' ? 'PND2' : event.eventType === 'WHT_PND3' ? 'PND3' : 'PND53', incomeCategoryCode: categoryCode,
          incomeCategoryLabel: categoryNames.get(categoryCode ?? '') ?? null, rate: event.whtRate?.toString() ?? null,
          paid: String(event.grossAmount ?? event.taxableBase), withheld: String(event.withheldAmount ?? event.taxAmount), currency: event.currency,
          sourceType: event.sourceType, sourceId: event.sourceId, expenseId: event.sourceType === 'expense.record' ? event.sourceId : null,
          certificate: handoff ? { handoffId: handoff.id, state: handoff.status, number,
            canDownload: handoff.status === 'SYSTEM_ISSUED' && number !== null && readableIds.has(handoff.id) } : null };
      };
      const rows = payments.map(mapPayment);
      const bankRemitted = bankPayments.map(event => ({ ...mapPayment(event), certificate: null }));
      const completePayments = await currentWithholdingPayments(db, ctx.companyId, ctx.scopes?.branchIds
        ? await db.taxEvent.findMany({ where: { companyId: ctx.companyId, periodKey, status: 'ACTIVE', eventType: { in: ['WHT_PND3', 'WHT_PND53'] } } })
        : payments.filter(event => event.eventType !== 'WHT_PND2'));
      const projections = await Promise.all((['PND3', 'PND53'] as const).map(formType => withholdingPaperBlockers(db, ctx, { periodKey, formType }, undefined, completePayments.filter(e => e.eventType === `WHT_${formType}`))));
      const partition = partitionWithholdingPayments(completePayments, branches, payerFacts, periodKey);
      for (const projection of projections) {
        for (const paper of projection.partition.papers) if (!partition.papers.some(p => p.establishment.code === paper.establishment.code)) partition.papers.push({ ...paper, events: [] });
        partition.unanswered ||= projection.partition.unanswered;
      }
      const frozenPapers = await db.whtFiling.findMany({ where: { companyId: ctx.companyId, periodKey }, include: { lines: true } });
      const confirmationIds = [...new Set(frozenPapers.flatMap(paper => {
        const confirmation = (paper.payerSnapshotJson as { rowsConfirmation?: { userId: string } } | null)?.rowsConfirmation;
        return confirmation ? [confirmation.userId] : [];
      }))];
      const confirmationNames = new Map((confirmationIds.length ? await db.user.findMany({ where: { id: { in: confirmationIds } }, select: { id: true, displayName: true } }) : []).map(user => [user.id, user.displayName]));
      const cancellations = await cancelledWithholdingRows(db, ctx.companyId, frozenPapers);
      const bankPartition = partitionWithholdingPayments(bankPayments, branches, payerFacts, periodKey);
      const establishments = [...new Map([...partition.papers, ...bankPartition.papers].map(p => [p.establishment.code, p.establishment])).values()];
      for (const paper of frozenPapers) if (!establishments.some(e => e.code === paper.establishmentCode)) {
        const branch = branches.find(b => b.id === paper.establishmentBranchId);
        establishments.push({ kind: 'ESTABLISHMENT', code: paper.establishmentCode, branchId: paper.establishmentBranchId,
          name: branch?.type === 'HEAD_OFFICE' || !branch ? 'สำนักงานใหญ่' : branch.name });
      }
      const visibleEstablishments = establishments.filter(e => isBranchInScope(ctx.scopes ?? {}, e.branchId));
      const projectionModeBlockers = (formType: string) => projections[formType === 'PND3' ? 0 : 1].unassignedBlockers.some(e => e.eventType === `WHT_${formType}`);
      const buildForm = async (formType: WhtFormType, establishment?: import('@watchdog-bms/contracts').WhtEstablishment, sequence = 0) => {
        const period = periods.find(row => row.formType === formType);
        const payerModeRequired = partition.unanswered && (partition.unassigned.some(e => e.eventType === `WHT_${formType}`) || projectionModeBlockers(formType));
        // An unanswered form has no payer yet; show its visible rows once, even after an earlier download.
        const showUnassigned = payerModeRequired && (!establishment || establishment.code === visibleEstablishments[0]?.code);
        const establishmentPayments = showUnassigned ? payments.filter(e => e.eventType === `WHT_${formType}`) : establishment ? (partition.papers.find(p => p.establishment.code === establishment.code)?.events ?? []).filter(e => e.eventType === `WHT_${formType}`) : partition.unanswered ? payments.filter(e => e.eventType === `WHT_${formType}`) : [];
        const sameForm = frozenPapers.filter(p => p.taxPeriodId === period?.id);
        const paperPayments = withholdingPaperPayments(establishmentPayments, sameForm);
        let formPayments = paperPayments.map(e => ({ paid: String(e.grossAmount ?? e.taxableBase), withheld: String(e.withheldAmount ?? e.taxAmount) }));
        const projection = await withholdingPaperBlockers(db, ctx, { periodKey, formType }, establishment, completePayments.filter(e => e.eventType === `WHT_${formType}`));
        const periodIssues = projection.issues;
        const frozen = frozenPapers.find(p => p.taxPeriodId === period?.id && (!establishment || p.establishmentCode === establishment.code) && (p.sequence ?? 0) === sequence) ?? null;
        const preserved = frozen?.status === 'FILED';
        const uncertain = frozen?.rowsCertain === false;
        if (preserved) formPayments = frozen.lines.map(line => { const payment = (line.lineJson as { payment: (string | null)[] }).payment; return { paid: payment[6] ?? '0', withheld: payment[7] ?? '0' }; });
        const validation = preserved ? { issues: [] as import('@watchdog-bms/contracts').WithholdingMonthIssueDto[], accountantPrepared: frozen.preparedBy === 'ACCOUNTANT', accountantTypes: [] } : period ? await validateWithholdingFiling(db, ctx.companyId, formType, period,
          paperPayments.map(event => ({ ...event,
            payeeSnapshot: event.payeeSnapshotJson as import('@watchdog-bms/contracts').PayeeSnapshot | null,
            whtRate: event.whtRate?.toString() ?? null, grossAmount: event.grossAmount?.toString() ?? null, withheldAmount: event.withheldAmount?.toString() ?? null,
          })), periodIssues, establishment, sequence, false, ctx) : { issues: periodIssues, accountantPrepared: false, accountantTypes: [] };

        if (preserved && frozen.rowsCertain) {
          const omittedIssueIds = new Set(projection.sourcePayments.filter(payment => !frozen.lines.some(line => filedLineCoversPayment(line, payment))).map(payment => payment.issueId));
          const omittedIssues = periodIssues.filter(issue => omittedIssueIds.has(issue.id));
          validation.issues = omittedIssues.map(issue => ({ ...issue, severity: 'WARNING' as const }));
          const omittedPayees = omittedIssues.map(issue => issue.sourceId
            ? projection.sourcePayments.find(payment => payment.issueId === issue.id)?.payeeSnapshot.name || 'ผู้รับเงิน'
            : 'รายการของสาขาที่คุณไม่ได้ดูแล');
          if (omittedIssueIds.size) validation.issues.push({ id: `omitted:${frozen.id}`, issueCode: 'WHT_FILED_PAYMENT_OMITTED', severity: 'WARNING',
            description: E_WHT_WORDS['W-T6']([...new Set(omittedPayees)].join(', ')), sourceType: null, sourceId: null, expenseId: null, counterpartyId: null });
        }

        // Empty establishment forms have no paper to validate; retain source review issues.
        if (!paperPayments.length && !preserved) validation.issues = validation.issues.filter(i => !/^PND(?:3|53)_FILING_/.test(i.issueCode) || i.issueCode.endsWith('_FILING_BANK_REMITTED_ONLY') || periodIssues.some(p => p.id === i.id));
        const status = frozen?.status ?? (sequence > 0 ? 'OPEN' : frozenPapers.length ? (paperPayments.length ? 'OPEN' : null) : period?.status ?? null);
        const stale = status === 'EXPORTED' && !await isWithholdingDownloadCurrent(db, ctx.companyId, period!.id,
          paperPayments.map(event => ({ ...event, payeeSnapshot: event.payeeSnapshotJson as import('@watchdog-bms/contracts').PayeeSnapshot | null,
            grossAmount: event.grossAmount?.toString() ?? null, withheldAmount: event.withheldAmount?.toString() ?? null, whtRate: event.whtRate?.toString() ?? null })), undefined, establishment?.code, sequence);
        if (payerModeRequired) validation.issues = validation.issues.filter(i => !i.issueCode.endsWith('_FILING_BRANCHES'));
        if (payerModeRequired && !preserved) validation.issues.push({ id: 'payer-mode', issueCode: 'WHT_PAYER_MODE_REQUIRED', description: 'มีรายการจ่ายจากหลายสาขา บอกก่อนว่าใครจ่ายเงินและหักภาษี', severity: 'BLOCKING', sourceType: null, sourceId: null, expenseId: null, counterpartyId: null });
        if (stale && period) validation.issues.push({ id: `changed:${period.id}`, issueCode: 'WHT_FILING_CHANGED_AFTER_DOWNLOAD',
          description: 'ดาวน์โหลดแบบใหม่ก่อนยื่น', severity: 'WARNING', sourceType: null, sourceId: null, expenseId: null, counterpartyId: null });
        const rowsConfirmation = (frozen?.payerSnapshotJson as { rowsConfirmation?: { userId: string; at: string } } | null)?.rowsConfirmation;
        const sum = (key: 'paid' | 'withheld') => formPayments.reduce((total, row) => total.plus(row[key]), new Prisma.Decimal(0)).toFixed(4);
        const paymentBasisChanged = !!preserved && frozen.lines.some(line => {
          if (line.sourceType !== 'expense.record') return false;
          const facts = (line.lineJson as { payment?: (string | null)[] }).payment;
          if (facts?.[13]) return false;
          const source = expenses.find(e => e.id === line.sourceId);
          const paid = source?.payments ?? [];
          return paid.length !== 1 || !paid[0].paidAtConfirmed || !new Prisma.Decimal(String(paid[0].amount ?? 0)).eq(String(source?.netPayableAmount ?? 0)) || civilDate(paid[0].paidAt, source?.company?.timezone ?? 'Asia/Bangkok') !== facts?.[2]?.slice(0, 10);
        });
        return { paymentBasisChanged, cancellations: cancellations.filter(c => c.filingId === frozen?.id),
          cancelledPayeeNames: sequence > 0 ? cancelledPayeeNames(cancellations, preserved ? frozen.lines.map(l => {
            const payment = (l.lineJson as { payment: (string | null)[] }).payment;
            return { payeeSnapshot: { name: payment[9], taxId: payment[10] } };
          }) : paperPayments.map(e => ({ payeeSnapshot: e.payeeSnapshotJson as { name?: string; taxId?: string } }))) : [],
          canConfirmRows: uncertain && (ctx.permissions ?? []).includes('wht.pnd53.prepare'),
          rowsConfirmation: rowsConfirmation ? { ...rowsConfirmation, displayName: confirmationNames.get(rowsConfirmation.userId) ?? null } : null,
          rowsUncertainNotice: uncertain ? 'รายการของแบบที่ยื่นไว้ตรวจได้ไม่ครบ ให้ผู้ทำบัญชีเทียบกับแบบที่ยื่นจริง' : null,
          id: frozen?.id ?? null, kind: sequence === 0 ? 'NORMAL' as const : 'ADDITIONAL' as const, sequence, downloadedAt: frozen?.downloadedAt?.toISOString() ?? null, filedAt: frozen?.filedAt?.toISOString() ?? null, noticeCode: sequence > 0 ? 'WHT_ADDITIONAL_SURCHARGE_MANUAL' as const : null, unfiledPaymentCount: preserved ? paperPayments.filter(event => !frozen.lines.some(line => filedLineCoversPayment(line, event))).length : 0, establishmentCode: establishment?.code, canDownload: !uncertain && (preserved || (paperPayments.length > 0 && !validation.issues.some(i => i.severity === 'BLOCKING'))), canMarkFiled: !uncertain && status === 'EXPORTED' && !stale && !validation.issues.some(i => i.severity === 'BLOCKING'), rowsCertain: frozen?.rowsCertain ?? (sequence > 0 || sameForm.some(p => p.rowsCertain) || !(period && (period.status === 'EXPORTED' || isPeriodLocked(period.status)))), accountantPrepared: validation.accountantPrepared, accountantTypes: validation.accountantTypes, formType, periodId: period?.id ?? null, status, paymentCount: formPayments.length,
          totalPaid: sum('paid'), totalWithheld: sum('withheld'),
          dueDate: (period?.dueDate ?? evaluateDueDate(periodKey, { type: 'day_of_next_month', day: 7 }))!.toISOString().slice(0, 10),
          issues: validation.issues,

        };
      };
      const buildForms = async (establishment?: import('@watchdog-bms/contracts').WhtEstablishment) => Promise.all((['PND3', 'PND53'] as const).map(async formType => {
        const period = periods.find(p => p.formType === formType);
        const existing = frozenPapers.filter(p => p.taxPeriodId === period?.id && (!establishment || p.establishmentCode === establishment.code));
        const normal = await buildForm(formType, establishment);
        const remaining = withholdingPaperPayments((partition.papers.find(p => p.establishment.code === establishment?.code)?.events ?? []).filter(e => e.eventType === `WHT_${formType}`), frozenPapers.filter(p => p.taxPeriodId === period?.id));
        const next = openWithholdingSequence(existing);
        const sequences = [...new Set([...(existing.length || remaining.length || normal.paymentCount || normal.issues.length || (!establishment && period) ? [0] : []), ...existing.map(p => p.sequence ?? 0), ...(next && remaining.length ? [next] : [])])].sort((a, b) => a - b);
        const papers = await Promise.all(sequences.map(async sequence => ({ ...(sequence === 0 ? normal : await buildForm(formType, establishment, sequence)), establishmentCode: establishment?.code ?? '00000' })));
        const sum = (key: 'totalPaid' | 'totalWithheld') => papers.reduce((n, p) => n.plus(p[key]), new Prisma.Decimal(0)).toFixed(4);
        return { ...normal, papers, monthTotals: { paymentCount: papers.reduce((n, p) => n + p.paymentCount, 0), totalPaid: sum('totalPaid'), totalWithheld: sum('totalWithheld') } };
      }));
      const establishmentCards = await Promise.all(visibleEstablishments.map(async e => ({ ...e, forms: await buildForms(e) })));
      for (const row of rows) {
        const period = periods.find(p => p.formType === row.formType);
        const frozen = frozenPapers.find(p => p.taxPeriodId === period?.id && p.status === 'FILED' && p.lines.some(l => filedLineCoversPayment(l, row)));
        const currentEstablishment = partition.papers.find(p => p.events.some(e => e.sourceType === row.sourceType && e.sourceId === row.sourceId))?.establishment;
        const form = establishmentCards.find(e => e.code === currentEstablishment?.code)?.forms.find(f => f.formType === row.formType);
        const open = form?.papers.find(p => p.status !== 'FILED');
        row.paper = frozen ? { id: frozen.id, kind: frozen.sequence ? 'ADDITIONAL' : 'NORMAL', sequence: frozen.sequence ?? 0, establishmentCode: frozen.establishmentCode }
          : open && open.rowsCertain !== false ? { id: open.id, kind: open.kind, sequence: open.sequence, establishmentCode: open.establishmentCode } : null;
      }
      const unassigned = partition.unassigned.filter(e => payments.some(p => p.id === e.id));
      const sourceBranches = projections.flatMap(projection => projection.unassignedBlockers).filter(source => isBranchInScope(ctx.scopes ?? {}, source.branchId));
      const issueGroups = [...new Set([...unassigned, ...sourceBranches].map(source => partition.unanswered ? null : source.branchId ?? null))];
      const establishmentIssues = issueGroups.map(branchId => {
        const group = unassigned.filter(e => partition.unanswered || (e.branchId ?? null) === branchId);
        const branchName = branches.find(b => b.id === branchId)?.name ?? 'สำนักงานใหญ่';
        return { issueCode: partition.unanswered ? 'WHT_PAYER_MODE_REQUIRED' as const : 'WHT_BRANCH_HAS_NO_CODE' as const, branchId, branchName,
          description: partition.unanswered ? 'มีรายการจ่ายจากหลายสาขา บอกก่อนว่าใครจ่ายเงินและหักภาษี' : `${branchName} ยังไม่มีรหัสสาขาภาษี เปิดตั้งค่าสาขาแล้วกรอกรหัส`,
          paymentCount: group.length, totalPaid: group.reduce((n, e) => n.plus(String(e.grossAmount ?? e.taxableBase)), new Prisma.Decimal(0)).toFixed(4),
          totalWithheld: group.reduce((n, e) => n.plus(String(e.withheldAmount ?? e.taxAmount)), new Prisma.Decimal(0)).toFixed(4) };
      });
      return { bankRemitted, unpaidExpenses, paidWithoutWithholding: paidWithoutWithholding.filter(e => rows.some(row => row.expenseId === e.expenseId)), undatedPayments, periodKey, establishments: establishmentCards, establishmentIssues,
        payments: rows.filter(row => row.formType !== 'PND2'), separatePnd2: rows.filter(row => row.formType === 'PND2'),
        forms: establishmentCards[0]?.forms ?? (establishments.length ? [] : await buildForms()) };

    }, { isolationLevel: 'RepeatableRead' });
  }

  async eWhtExport(ctx: RequestContext, periodKey: string, establishmentCode?: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodKey)) throw new BadRequestException('เดือนภาษีไม่ถูกต้อง เลือกเดือนอีกครั้ง');
    if (establishmentCode !== undefined && !/^\d{5}$/.test(establishmentCode)) throw new BadRequestException({ code: 'WHT_ESTABLISHMENT_INVALID', message: 'รหัสสาขาภาษีไม่ถูกต้อง เลือกสาขาอีกครั้ง' });
    return this.taxRepo.prisma.client.$transaction(async db => {
      const events = await db.taxEvent.findMany({ where: { companyId: ctx.companyId, periodKey, status: 'EXCLUDED',
        eventType: { in: ['WHT_PND2', 'WHT_PND3', 'WHT_PND53'] }, ...branchScopeWhere(ctx.scopes ?? {}) }, orderBy: [{ eventDate: 'asc' }, { id: 'asc' }] });
      let payments = await currentWithholdingPayments(db, ctx.companyId, events, ctx.scopes ?? {});
      if (establishmentCode) {
        const context = await loadWithholdingEstablishments(db, ctx.companyId, periodKey);
        payments = partitionWithholdingPayments(payments, context.branches, context.facts, periodKey).papers.find(paper => paper.establishment.code === establishmentCode)?.events ?? [];
      }
      const categories = await db.whtIncomeCategory.findMany({ where: { code: { in: [...new Set(payments.flatMap(row => row.incomeCategoryCode ? [row.incomeCategoryCode] : []))] } } });
      const names = new Map(categories.map(row => [row.code, row.nameTh]));
      const buffer = buildWorkbook([{ name: E_WHT_WORDS['W-X3'], freezeRows: 1, rows: [
        ['วันที่จ่าย', 'ผู้รับเงิน', 'เลขผู้เสียภาษี', 'สาขา', 'ที่อยู่', 'ประเภทเงินได้', 'อัตรา (%)', 'สกุลเงิน', 'ยอดจ่าย', 'ภาษีที่หักไว้'],
        ...payments.map(row => {
          const payee = row.payeeSnapshotJson as import('@watchdog-bms/contracts').PayeeSnapshot | null;
          return [formatThaiExportDate(row.eventDate.toISOString()), payee?.name ?? '', payee?.taxId ?? '', payee?.branchCode ?? '', printablePnd53PayeeAddress(payee?.address) ?? '',
            names.get(row.incomeCategoryCode ?? '') ?? '', row.whtRate == null ? '' : Number(row.whtRate), expenseCurrencyLabel(row.currency), Number(row.grossAmount ?? row.taxableBase), Number(row.withheldAmount ?? row.taxAmount)];
        }),
        ...[...new Set(payments.map(row => row.currency))].map(currency => {
          const same = payments.filter(row => row.currency === currency);
          return ['รวม', '', '', '', '', '', '', expenseCurrencyLabel(currency),
            Number(same.reduce((sum, row) => sum.add(String(row.grossAmount ?? row.taxableBase)), new Prisma.Decimal(0)).toFixed(2)),
            Number(same.reduce((sum, row) => sum.add(String(row.withheldAmount ?? row.taxAmount)), new Prisma.Decimal(0)).toFixed(2))];
        }),
      ] }]);
      return { fileName: `${E_WHT_WORDS['W-X3']}-${periodKey}.xlsx`, mimeType: XLSX_MIME_TYPE, contentBase64: buffer.toString('base64'),
        checksum: crypto.createHash('sha256').update(buffer).digest('hex'), byteLength: buffer.length };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async execute(companyId: string, formType: WhtFormType, periodKey: string): Promise<WhtReportDto> {
    const period = await this.taxRepo.findPeriod(companyId, formType, periodKey);
    if (!period) throw new Error(`Tax period ${formType}/${periodKey} not found`);

    const events = await this.taxRepo.findEventsByPeriod(companyId, period.id, 'ACTIVE');
    const issues = await this.taxRepo.findIssuesByPeriod(companyId, period.id, { status: 'OPEN' });

    const whtEvents = events.filter(e => e.eventType === 'WHT_PND3' || e.eventType === 'WHT_PND53');
    const groups = groupWhtEvents(whtEvents.map(e => ({
      id: e.id,
      whtFormType: (e.whtFormType as WhtFormType | null) ?? formType,
      payeeSnapshot: e.payeeSnapshot,
      incomeCategoryCode: e.incomeCategoryCode,
      whtRate: e.whtRate,
      grossAmount: e.grossAmount,
      withheldAmount: e.withheldAmount,
      netPaidAmount: e.netPaidAmount,
      certificateNumber: null,
      sourceType: e.sourceType,
      sourceId: e.sourceId,
      sourceEventType: e.sourceEventType,
    })));
    const totals = computeWhtTotals(groups, issues.length);

    const reportData = { periodKey, formType, totals, groups };
    const checksum = crypto.createHash('sha256').update(JSON.stringify(reportData)).digest('hex').slice(0, 16);

    await this.taxRepo.prisma.client.taxReportSnapshot.create({
      data: { companyId, taxPeriodId: period.id, formType: formType as any, periodKey, reportJson: reportData as any, checksum },
    });

    return {
      id: period.id, companyId, periodId: period.id, formType, periodKey,
      totalGross: totals.totalGross, totalWithheld: totals.totalWithheld,
      payeeGroupCount: totals.payeeGroupCount, reviewIssueCount: totals.reviewIssueCount,
      checksum, snapshotAt: new Date().toISOString(),
      sourceRefs: whtEvents.map(e => ({ sourceType: e.sourceType, sourceId: e.sourceId, permissionChecked: true as const })),
    };
  }
}
