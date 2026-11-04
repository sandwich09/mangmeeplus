import { withholdingPaperBlockers } from '../../application/services/withholding-filing-validation';
import { currentWithholdingPayments, withholdingPaymentChecksum } from '../../application/services/withholding-filing-state';
import { selectWithholdingPaper } from '../../application/services/withholding-establishments';
import { withholdingFormFor } from '../../domain/logic/expense-payment-withholding.logic';
import type { ExpenseWhtSourceRow } from '../../domain/ports/source-reader.port';
import { assertOpenWithholdingSequence, withholdingPaperPayments } from '../../application/services/withholding-filing-state';
import { filedWithholdingPaymentPeriods } from '../../application/services/filed-withholding-payment';
import { todayCivilDate, type AnswerWhtPayerModeRequest, type WhtPayerModeDto } from '@watchdog-bms/contracts';
import { monthAfter, whtPayerModeInForce } from '../../domain/logic/wht-payer-mode.logic';
import { Prisma } from '../../../../generated/prisma/client';
import type { RequestContext } from '@watchdog-bms/contracts';
import type { TaxExportArtifact } from '../../domain/logic/tax-export.logic';
import type { PutObjectResult } from '../../../data-model-core/domain/ports/attachment-storage.port';
import { EXPENSE_CORRECTION_WORDS } from '@watchdog-bms/contracts';
import { lockExpenseCorrection } from '../../../expenses/infrastructure/expense-void-blocker';
import { ConflictException, BadRequestException, ForbiddenException, NotFoundException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import type { TaxEventRecord, UpsertTaxEventInput } from '../../domain/ports/tax-event.repository.port';
import type { TaxPeriodRecord, CreateTaxPeriodInput } from '../../domain/ports/tax-period.repository.port';
import type { TaxReviewIssueRecord, CreateReviewIssueInput } from '../../domain/ports/tax-review-issue.repository.port';
import type { TaxEventStatus, TaxEventType, TaxFormType, TaxPeriodStatus, TaxType, ReviewIssueSeverity, ReviewIssueStatus } from '@watchdog-bms/contracts';
import { findAttachmentLinkConflict } from '../../../data-model-core/domain/logic/attachment.logic';

function toStr(v: unknown): string { return String(v ?? '0'); }

@Injectable()
export class PrismaTaxRepository {
  constructor(readonly prisma: PrismaService) {}

  async readWhtPayerMode(companyId: string, month?: string, db: Prisma.TransactionClient = this.prisma.client): Promise<WhtPayerModeDto> {
    const company = await db.company.findUnique({ where: { id: companyId }, select: { timezone: true } });
    if (!company) throw new NotFoundException({ code: 'WHT_PAYER_MODE_SHOP_NOT_FOUND', message: 'ไม่พบร้าน เปิดเลือกร้านแล้วลองอีกครั้ง' });
    const periodKey = month ?? todayCivilDate(company.timezone).slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodKey)) throw new BadRequestException({ code: 'WHT_PAYER_MODE_MONTH_INVALID', message: 'เดือนที่เริ่มใช้ไม่ถูกต้อง เลือกเดือนอีกครั้ง' });
    const [branches, facts, filed, legacy] = await Promise.all([
      db.branch.findMany({ where: { companyId, status: 'ACTIVE' }, select: { id: true } }),
      db.whtPayerModeFact.findMany({ where: { companyId, supersededAt: null } }),
      db.whtFiling.findFirst({ where: { companyId, status: 'FILED' }, orderBy: { periodKey: 'desc' }, select: { periodKey: true } }),
      db.taxPeriod.findFirst({ where: { companyId, formType: { in: ['PND3', 'PND53'] }, status: { in: ['FILED', 'PAID', 'CLOSED'] } }, orderBy: { periodKey: 'desc' }, select: { periodKey: true } }),
    ]);
    const lastFiled = [filed?.periodKey, legacy?.periodKey].filter((v): v is string => !!v).sort().at(-1);
    return { periodKey, asked: branches.length > 1, mode: branches.length <= 1 ? 'HEAD_OFFICE_PAYS_ALL' : whtPayerModeInForce(facts, periodKey),
      firstAllowedPeriodKey: lastFiled ? monthAfter(lastFiled) : periodKey };
  }

  async answerWhtPayerMode(ctx: RequestContext, answer: AnswerWhtPayerModeRequest): Promise<WhtPayerModeDto> {
    if (!ctx.permissions.includes('company.legal_identity.manage')) throw new ForbiddenException({ code: 'WHT_PAYER_MODE_FORBIDDEN', message: 'ไม่มีสิทธิ์บันทึกวิธีจ่าย ให้ผู้ที่แก้ไขข้อมูลร้านได้เป็นผู้บันทึก' });
    if (!['HEAD_OFFICE_PAYS_ALL', 'EACH_BRANCH_PAYS'].includes(answer.mode)) throw new BadRequestException({ code: 'WHT_PAYER_MODE_INVALID', message: 'วิธีจ่ายไม่ถูกต้อง เลือกผู้ที่จ่ายเงินและหักภาษีอีกครั้ง' });
    try {
      return await this.prisma.client.$transaction(async tx => {
        // Serialize answers for this shop, including the first answer with no fact row yet.
        await tx.$queryRaw`SELECT id FROM "Company" WHERE id = ${ctx.companyId} FOR UPDATE`;
        const current = await this.readWhtPayerMode(ctx.companyId, answer.effectiveFromPeriodKey, tx);
        if (current.periodKey < current.firstAllowedPeriodKey) throw new ConflictException({ code: 'WHT_PAYER_MODE_FILED',
          message: 'มีแบบที่ยื่นแล้วในช่วงที่เลือก เลือกเริ่มใช้ตั้งแต่เดือนที่ยังไม่ยื่น', firstAllowedPeriodKey: current.firstAllowedPeriodKey });
        const now = new Date();
        await tx.whtPayerModeFact.updateMany({ where: { companyId: ctx.companyId, effectiveFromPeriodKey: current.periodKey, supersededAt: null }, data: { supersededAt: now } });
        await tx.whtPayerModeFact.create({ data: { companyId: ctx.companyId, mode: answer.mode, effectiveFromPeriodKey: current.periodKey, answeredByUserId: ctx.userId, answeredAt: now } });
        return this.readWhtPayerMode(ctx.companyId, current.periodKey, tx);
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (['P2034', 'P2002'].includes((error as { code?: string }).code ?? '')) throw new ConflictException({ code: 'WHT_PAYER_MODE_CHANGED', message: 'วิธีจ่ายเปลี่ยนระหว่างบันทึก เปิดข้อมูลล่าสุดแล้วลองอีกครั้ง' });
      throw error;
    }
  }

  async assertWithholdingFilingMutable(tx: Prisma.TransactionClient, companyId: string, id: string) {
    const filing = await tx.whtFiling.findFirst({ where: { id, companyId } });
    if (!filing || filing.status === 'FILED') throw new ConflictException({ code: 'WHT_FILING_ALREADY_FILED', message: 'แบบนี้ยื่นแล้ว แก้แบบเดิมไม่ได้ ดาวน์โหลดแบบที่ยื่นไว้แทน' });
    return filing;
  }

  async markWithholdingFilingFiled(tx: Prisma.TransactionClient, companyId: string, packageId: string, userId: string, filedAt: Date, note?: string) {
    const filing = await tx.whtFiling.findFirst({ where: { companyId, filingPackageId: packageId } });
    if (!filing || filing.status !== 'EXPORTED' || !filing.rowsCertain) throw new ConflictException({ code: 'WHT_FILING_CHANGED_AFTER_DOWNLOAD', message: 'มีรายการเปลี่ยนหลังดาวน์โหลดแบบ ดาวน์โหลดแบบใหม่ก่อนยื่น' });
    const result = await tx.whtFiling.updateMany({ where: { id: filing.id, companyId, status: 'EXPORTED', filingPackageId: packageId, rowsCertain: true },
      data: { status: 'FILED', filedAt, filedByUserId: userId, filedNote: note } });
    if (result.count !== 1) throw new ConflictException({ code: 'WHT_FILING_ALREADY_FILED', message: 'แบบนี้ยื่นแล้ว แก้แบบเดิมไม่ได้ ดาวน์โหลดแบบที่ยื่นไว้แทน' });
  }

  async recordWithholdingDownload(input: {
    ctx: RequestContext; period: TaxPeriodRecord; sequence?: number; exportFormat: string; exportNumber: string;
    artifact: TaxExportArtifact; stored: PutObjectResult; establishmentCode: string; establishmentBranchId: string | null;
    preparedBy: string; payerSnapshotJson: object; rowsChecksum: string; rowsCertain: boolean;
    lines: { taxEventId: string; sourceType: string; sourceId: string; lineJson: object }[];
  }) {
    const { ctx, period, artifact, stored } = input;
    return this.prisma.client.$transaction(async tx => {
      // Serialize first downloads (no filing row exists yet) and competing replacements.
      await tx.$queryRaw`SELECT id FROM "TaxPeriod" WHERE id = ${period.id} AND "companyId" = ${ctx.companyId} FOR UPDATE`;
      const filed = await tx.whtFiling.findFirst({ where: { companyId: ctx.companyId, taxPeriodId: period.id, establishmentCode: input.establishmentCode, sequence: input.sequence ?? 0, status: 'FILED' } });
      if (filed) await this.assertWithholdingFilingMutable(tx, ctx.companyId, filed.id);
      if ((input.sequence ?? 0) !== 0) {
        const papers = await tx.whtFiling.findMany({ where: { companyId: ctx.companyId, taxPeriodId: period.id }, include: { lines: true } });
        assertOpenWithholdingSequence(papers.filter(p => p.establishmentCode === input.establishmentCode), input.sequence!);
        if (withholdingPaperPayments(input.lines, papers).length !== input.lines.length) throw new ConflictException({ code: 'WHT_FILING_CHANGED_AFTER_DOWNLOAD', message: 'มีรายการเปลี่ยนหลังดาวน์โหลดแบบ ดาวน์โหลดแบบใหม่ก่อนยื่น' });
      }
      const events = await currentWithholdingPayments(tx, ctx.companyId, (await tx.taxEvent.findMany({ where: { companyId: ctx.companyId, taxPeriodId: period.id, status: 'ACTIVE' } })).map(e => ({
        ...e, payeeSnapshot: e.payeeSnapshotJson as import('@watchdog-bms/contracts').PayeeSnapshot | null,
        grossAmount: e.grossAmount?.toString() ?? null, withheldAmount: e.withheldAmount?.toString() ?? null, whtRate: e.whtRate?.toString() ?? null,
      })));
      const projection = await withholdingPaperBlockers(tx, ctx, period, undefined, events);
      const selected = selectWithholdingPaper(ctx, projection.partition, input.establishmentCode);
      const blockers = await withholdingPaperBlockers(tx, ctx, period, selected?.establishment, events);
      const blocking = blockers.issues.find(i => i.severity === 'BLOCKING');
      if (blocking) throw new ConflictException({ code: `${period.formType}_FILING_REVIEW`, message: blocking.description, issues: blockers.issues });
      const papers = await tx.whtFiling.findMany({ where: { companyId: ctx.companyId, taxPeriodId: period.id }, include: { lines: true } });
      if (!selected || withholdingPaymentChecksum(withholdingPaperPayments(selected.events, papers)) !== input.rowsChecksum) {
        throw new ConflictException({ code: 'WHT_FILING_CHANGED_AFTER_DOWNLOAD', message: 'มีรายการเปลี่ยนหลังดาวน์โหลดแบบ ดาวน์โหลดแบบใหม่ก่อนยื่น' });
      }
      const key = { companyId: ctx.companyId, formType: period.formType as 'PND3' | 'PND53', periodKey: period.periodKey, establishmentCode: input.establishmentCode, sequence: input.sequence ?? 0 };
      let filing = await tx.whtFiling.findUnique({ where: { companyId_formType_periodKey_establishmentCode_sequence: key } });
      if (filing) await this.assertWithholdingFilingMutable(tx, ctx.companyId, filing.id);
      const data = { establishmentBranchId: input.establishmentBranchId, status: 'EXPORTED' as const, preparedBy: input.preparedBy,
        payerSnapshotJson: JSON.parse(JSON.stringify(input.payerSnapshotJson)) as Prisma.InputJsonValue,
        rowsChecksum: input.rowsChecksum, rowsCertain: input.rowsCertain, downloadedAt: new Date() };
      if (!filing) filing = await tx.whtFiling.create({ data: { ...key, ...data, taxPeriodId: period.id } });
      const attachment = await tx.attachmentObject.create({ data: {
        companyId: ctx.companyId, branchId: input.establishmentBranchId, storageProvider: stored.storageProvider,
        bucket: stored.bucket, objectKey: stored.objectKey, objectVersionId: stored.objectVersionId,
        originalFileName: artifact.fileName, mimeType: artifact.mimeType, byteSize: stored.byteSize,
        checksumSha256: stored.checksumSha256, status: 'ACTIVE', uploadedByUserId: ctx.userId, uploadedAt: new Date(),
      } });
      const pkg = await tx.taxFilingPackage.create({ data: { companyId: ctx.companyId, taxPeriodId: period.id,
        formType: key.formType, periodKey: period.periodKey, exportNumber: input.exportNumber, exportFormat: input.exportFormat,
        checksum: artifact.checksum, generatedByUserId: ctx.userId, attachmentId: attachment.id, whtFilingId: filing.id } });
      // This conditional write is the guard for every replacement of lines/file pointer too.
      const changed = await tx.whtFiling.updateMany({ where: { id: filing.id, companyId: ctx.companyId, status: { not: 'FILED' } }, data: { ...data, filingPackageId: pkg.id } });
      if (changed.count !== 1) throw new ConflictException({ code: 'WHT_FILING_ALREADY_FILED', message: 'แบบนี้ยื่นแล้ว แก้แบบเดิมไม่ได้ ดาวน์โหลดแบบที่ยื่นไว้แทน' });
      await tx.whtFilingLine.deleteMany({ where: { whtFilingId: filing.id } });
      await tx.whtFilingLine.createMany({ data: input.lines.map((line, index) => ({ ...line, whtFilingId: filing.id, rowNumber: index + 1,
        lineJson: JSON.parse(JSON.stringify(line.lineJson)) as Prisma.InputJsonValue })) });
      await tx.attachmentLink.create({ data: { companyId: ctx.companyId, attachmentId: attachment.id, targetType: 'tax.filing_package', targetId: pkg.id, purpose: 'tax.filing_export', linkedByUserId: ctx.userId } });
      await tx.taxReportSnapshot.create({ data: { companyId: ctx.companyId, taxPeriodId: period.id, formType: key.formType, periodKey: period.periodKey,
        reportJson: { kind: 'WITHHOLDING_DOWNLOAD', filingPackageId: pkg.id }, checksum: input.rowsChecksum, createdByUserId: ctx.userId } });
      await tx.taxPeriod.updateMany({ where: { companyId: ctx.companyId, id: period.id, status: { notIn: ['FILED', 'PAID', 'CLOSED'] } }, data: { status: 'EXPORTED' } });
      return pkg;
    }, { isolationLevel: 'Serializable' });
  }

  // ─── Tax Period ─────────────────────────────────────────────────────────────

  async findPeriod(companyId: string, formType: TaxFormType, periodKey: string): Promise<TaxPeriodRecord | null> {
    const row = await this.prisma.client.taxPeriod.findUnique({
      where: { companyId_formType_periodKey: { companyId, formType, periodKey } },
    });
    return row ? this.toPeriodRecord(row) : null;
  }

  async findPeriodById(companyId: string, id: string): Promise<TaxPeriodRecord | null> {
    const row = await this.prisma.client.taxPeriod.findFirst({ where: { id, companyId } });
    return row ? this.toPeriodRecord(row) : null;
  }

  async findPeriods(companyId: string, filters?: { taxType?: TaxType; formType?: string; status?: TaxPeriodStatus; periodKey?: string; page?: number; pageSize?: number }): Promise<{ items: TaxPeriodRecord[]; total: number }> {
    const page = filters?.page ?? 1;
    const pageSize = filters?.pageSize ?? 20;
    const where: Record<string, unknown> = { companyId };
    if (filters?.taxType) where['taxType'] = filters.taxType;
    if (filters?.formType) where['formType'] = filters.formType;
    if (filters?.status) where['status'] = filters.status;
    if (filters?.periodKey) where['periodKey'] = filters.periodKey;
    const [items, total] = await Promise.all([
      this.prisma.client.taxPeriod.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { periodKey: 'desc' } }),
      this.prisma.client.taxPeriod.count({ where }),
    ]);
    return { items: items.map(r => this.toPeriodRecord(r)), total };
  }

  async upsertPeriod(input: CreateTaxPeriodInput): Promise<TaxPeriodRecord> {
    const row = await this.prisma.client.taxPeriod.upsert({
      where: { companyId_formType_periodKey: { companyId: input.companyId, formType: input.formType, periodKey: input.periodKey } },
      update: { dueDate: input.dueDate ?? undefined },
      create: {
        companyId: input.companyId,
        taxType: input.taxType as any,
        formType: input.formType as any,
        periodKey: input.periodKey,
        status: (input.status ?? 'OPEN') as any,
        dueDate: input.dueDate ?? null,
      },
    });
    return this.toPeriodRecord(row);
  }

  async updatePeriodStatus(companyId: string, id: string, status: TaxPeriodStatus, meta?: { filedAt?: Date; paidAt?: Date; closedAt?: Date; reviewNote?: string }): Promise<TaxPeriodRecord> {
    const current = await this.prisma.client.taxPeriod.findFirst({ where: { id, companyId }, select: { id: true } });
    if (!current) throw new Error('tax_period_not_found');
    if (status === 'EXPORTED') {
      await this.prisma.client.taxPeriod.updateMany({
        where: { id, companyId, status: { notIn: ['FILED', 'PAID', 'CLOSED'] } }, data: { status: 'EXPORTED' },
      });
      return (await this.findPeriodById(companyId, id))!;
    }
    const row = await this.prisma.client.taxPeriod.update({
      where: { id },
      data: { status: status as any, filedAt: meta?.filedAt, paidAt: meta?.paidAt, closedAt: meta?.closedAt, reviewNote: meta?.reviewNote },
    });
    return this.toPeriodRecord(row);
  }

  private toPeriodRecord(row: any): TaxPeriodRecord {
    return {
      id: row.id, companyId: row.companyId, taxType: row.taxType as TaxType, formType: row.formType as TaxFormType,
      periodKey: row.periodKey, status: row.status as TaxPeriodStatus, dueDate: row.dueDate ?? null,
      filedAt: row.filedAt ?? null, paidAt: row.paidAt ?? null, reviewNote: row.reviewNote ?? null,
      closedAt: row.closedAt ?? null, createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
  }

  // ─── Tax Event ──────────────────────────────────────────────────────────────

  async findEventByIdempotencyKey(key: string): Promise<TaxEventRecord | null> {
    const row = await this.prisma.client.taxEvent.findUnique({ where: { idempotencyKey: key } });
    return row ? this.toEventRecord(row) : null;
  }

  async findActiveEventBySourceComponent(companyId: string, sourceType: string, sourceId: string, sourceLineKey: string, componentKey: string | null, eventType: string): Promise<TaxEventRecord | null> {
    const row = await (this.prisma.client as any).taxEvent.findFirst({ where: {
      companyId, sourceType, sourceId, sourceLineKey, componentKey, eventType, status: { in: ['ACTIVE', 'EXCLUDED'] },
    }, orderBy: { createdAt: 'desc' } });
    return row ? this.toEventRecord(row) : null;
  }

  async findEventsByPeriod(companyId: string, taxPeriodId: string, status?: TaxEventStatus): Promise<TaxEventRecord[]> {
    const where: Record<string, unknown> = { companyId, taxPeriodId };
    if (status) where['status'] = status;
    const rows = await this.prisma.client.taxEvent.findMany({ where, orderBy: { eventDate: 'asc' } });
    return rows.map(r => this.toEventRecord(r));
  }

  async upsertEvent(input: UpsertTaxEventInput, db: any = this.prisma.client): Promise<TaxEventRecord> {
    if (input.sourceType === 'expense.record') {
      if (db === this.prisma.client) return this.prisma.client.$transaction(tx => this.upsertEvent(input, tx), { isolationLevel: 'ReadCommitted' });
      await lockExpenseCorrection(db, input.companyId, input.sourceId);
      const current = await db.expenseRecord.findFirst({ where: { companyId: input.companyId, id: input.sourceId } });
      if (!current || current.status !== 'CONFIRMED'
        || (input.expectedInputVatClaimStatus !== undefined && input.expectedInputVatClaimStatus !== current.inputVatClaimStatus)
        || (input.expectedTaxEvidenceStatus !== undefined && input.expectedTaxEvidenceStatus !== current.taxEvidenceStatus)
        || (input.expectedExpenseConfirmedAt !== undefined && (current.confirmedAt?.getTime() ?? null) !== (input.expectedExpenseConfirmedAt?.getTime() ?? null))) {
        throw new ConflictException({ code: 'expense_tax_source_changed', message: EXPENSE_CORRECTION_WORDS.sourceChanged });
      }
    }
    if (input.sourceType === 'expense.record' && input.sourceLineKey?.startsWith('payment:')) {
      await db.$queryRaw`SELECT id FROM "TaxPeriod" WHERE id = ${input.taxPeriodId} FOR UPDATE`;
      const payment = await db.expensePayment.findFirst({ where: { companyId: input.companyId, expenseId: input.sourceId,
        id: input.sourceLineKey.slice(8).split(':line:')[0], status: 'RECORDED', paidAtConfirmed: true } });
      if (!payment || (await filedWithholdingPaymentPeriods(db, input.companyId, input.sourceType, input.sourceId,
        { formType: input.whtFormType ?? '', periodKey: input.periodKey }, input.sourceLineKey, input.status === 'EXCLUDED')).length) {
        throw new ConflictException({ code: 'expense_tax_source_changed', message: EXPENSE_CORRECTION_WORDS.sourceChanged });
      }
    }
    const data = {
      companyId: input.companyId, taxPeriodId: input.taxPeriodId, idempotencyKey: input.idempotencyKey,
      eventType: input.eventType as any, status: (input.status ?? 'ACTIVE') as any,
      sourceType: input.sourceType, sourceId: input.sourceId, branchId: input.branchId ?? null,
      sourceLineId: input.sourceLineId ?? null, sourceLineKey: input.sourceLineKey ?? '__HEADER__', componentKey: input.componentKey as any ?? null,
      sourceEventType: input.sourceEventType ?? null,
      sourceHash: input.sourceHash ?? null, periodKey: input.periodKey, eventDate: input.eventDate,
      taxableBase: input.taxableBase, taxAmount: input.taxAmount, currency: input.currency,
      vatMode: input.vatMode ?? null, outputTaxCode: input.outputTaxCode as any ?? null,
      whtFormType: input.whtFormType as any ?? null,
      payeeSnapshotJson: input.payeeSnapshot as any ?? null, incomeCategoryCode: input.incomeCategoryCode ?? null,
      whtRate: input.whtRate ?? null, grossAmount: input.grossAmount ?? null,
      withheldAmount: input.withheldAmount ?? null, netPaidAmount: input.netPaidAmount ?? null,
      taxInvoiceNumber: input.taxInvoiceNumber ?? null, reviewNote: input.reviewNote ?? null,
      taxCodeDefinitionId: input.taxSnapshot?.taxCodeDefinitionId ?? null,
      externalTaxCodeSnapshot: input.taxSnapshot?.externalTaxCode ?? null,
      taxProfileKeySnapshot: input.taxSnapshot?.taxProfileKey ?? null,
      taxProfileVersionSnapshot: input.taxSnapshot?.taxProfileVersion ?? null,
      roundingModeSnapshot: input.taxSnapshot?.roundingMode ?? null,
      roundingScaleSnapshot: input.taxSnapshot?.roundingScale ?? null,
      taxAmountToleranceSnapshot: input.taxSnapshot?.taxAmountTolerance ?? null,
      taxRegimeSnapshot: input.taxSnapshot?.taxRegime as any ?? null,
      taxDirectionSnapshot: input.taxSnapshot?.taxDirection as any ?? null,
      taxTreatmentSnapshot: input.taxSnapshot?.taxTreatment as any ?? null,
      taxContextSnapshot: input.taxSnapshot?.taxContext as any ?? null,
      taxRateSnapshot: input.taxSnapshot?.taxRate ?? null,
      sourceCurrencySnapshot: input.taxSnapshot?.sourceCurrency ?? null,
      taxCurrencySnapshot: input.taxSnapshot?.taxCurrency ?? null,
      exchangeRateSnapshot: input.taxSnapshot?.exchangeRate ?? null,
      exchangeRateSourceSnapshot: input.taxSnapshot?.exchangeRateSource ?? null,
      exchangeRateDateSnapshot: input.taxSnapshot?.exchangeRateDate ? new Date(input.taxSnapshot.exchangeRateDate) : null,
      claimabilitySnapshot: input.taxSnapshot?.claimability as any ?? null,
      accountRuleVersionSnapshot: input.taxSnapshot?.accountRuleVersion ?? null,
      reportRuleVersionSnapshot: input.taxSnapshot?.reportRuleVersion ?? null,
      taxEvidenceReviewStatus: input.taxSnapshot?.evidenceStatus as any ?? null,
      reportContributionsJson: input.reportContributions as any ?? null,
      accountAssignmentsJson: input.accountAssignments as any ?? null,
    };
    const row = await db.taxEvent.upsert({
      where: { idempotencyKey: input.idempotencyKey },
      update: data,
      create: data,
    });
    if (['WHT_PND3', 'WHT_PND53'].includes(input.eventType) && (input.status ?? 'ACTIVE') === 'ACTIVE') {
      // A new payment is off paper; kept papers and legacy month locks are never changed here.
      await db.taxPeriod.updateMany({ where: { id: input.taxPeriodId, companyId: input.companyId, status: 'FILED',
        whtFilings: { some: { status: 'FILED', lines: { some: {} } }, ...(input.sourceLineKey?.startsWith('payment:') ? {} : { none: { status: 'FILED', lines: { some: { sourceType: input.sourceType, sourceId: input.sourceId } } } }) } },
        data: { status: 'EXPORTED', filedAt: null } });
    }
    return this.toEventRecord(row);
  }

  async supersedeEvent(id: string): Promise<void> {
    await this.prisma.client.taxEvent.update({ where: { id }, data: { status: 'SUPERSEDED' as any } });
  }

  private toEventRecord(row: any): TaxEventRecord {
    return {
      id: row.id, companyId: row.companyId, taxPeriodId: row.taxPeriodId, idempotencyKey: row.idempotencyKey,
      eventType: row.eventType as TaxEventType, status: row.status as TaxEventStatus,
      sourceType: row.sourceType, sourceId: row.sourceId, sourceEventType: row.sourceEventType ?? null,
      branchId: row.branchId ?? null, sourceLineId: row.sourceLineId ?? null, sourceLineKey: row.sourceLineKey ?? '__HEADER__',
      componentKey: row.componentKey ?? null,
      taxSnapshot: row.taxCodeDefinitionId || row.externalTaxCodeSnapshot ? {
        taxCodeDefinitionId: row.taxCodeDefinitionId ?? null, externalTaxCode: row.externalTaxCodeSnapshot ?? null,
        taxProfileKey: row.taxProfileKeySnapshot ?? null, taxProfileVersion: row.taxProfileVersionSnapshot ?? null,
        roundingMode: row.roundingModeSnapshot ?? 'HALF_UP', roundingScale: row.roundingScaleSnapshot ?? 2,
        taxAmountTolerance: toStr(row.taxAmountToleranceSnapshot ?? '0.01'),
        taxRegime: row.taxRegimeSnapshot ?? null, taxDirection: row.taxDirectionSnapshot ?? null,
        taxTreatment: row.taxTreatmentSnapshot ?? null, taxContext: row.taxContextSnapshot ?? null,
        taxRate: toStr(row.taxRateSnapshot), sourceCurrency: row.sourceCurrencySnapshot ?? row.currency,
        taxCurrency: row.taxCurrencySnapshot ?? row.currency,
        exchangeRate: toStr(row.exchangeRateSnapshot ?? (row.sourceCurrencySnapshot === row.taxCurrencySnapshot || !row.sourceCurrencySnapshot ? 1 : 0)),
        exchangeRateSource: row.exchangeRateSourceSnapshot ?? (!row.sourceCurrencySnapshot || row.sourceCurrencySnapshot === row.taxCurrencySnapshot ? 'FUNCTIONAL_CURRENCY' : ''),
        exchangeRateDate: row.exchangeRateDateSnapshot?.toISOString?.().slice(0, 10) ?? '',
        taxBaseAmount: toStr(row.taxableBase), taxAmount: toStr(row.taxAmount),
        claimability: row.claimabilitySnapshot ?? 'NOT_APPLICABLE', evidenceStatus: row.taxEvidenceReviewStatus ?? 'REVIEW_REQUIRED',
        accountRuleVersion: row.accountRuleVersionSnapshot ?? null, reportRuleVersion: row.reportRuleVersionSnapshot ?? null,
        recognitionDate: row.eventDate?.toISOString?.() ?? null, evidenceRefs: [],
      } : null,
      reportContributions: Array.isArray(row.reportContributionsJson) ? row.reportContributionsJson : [],
      accountAssignments: Array.isArray(row.accountAssignmentsJson) ? row.accountAssignmentsJson : [],
      sourceHash: row.sourceHash ?? null, periodKey: row.periodKey, eventDate: row.eventDate,
      taxableBase: toStr(row.taxableBase), taxAmount: toStr(row.taxAmount), currency: row.currency,
      vatMode: row.vatMode ?? null, outputTaxCode: row.outputTaxCode ?? null,
      whtFormType: row.whtFormType as TaxFormType ?? null,
      payeeSnapshot: row.payeeSnapshotJson as any ?? null, incomeCategoryCode: row.incomeCategoryCode ?? null,
      whtRate: row.whtRate ? toStr(row.whtRate) : null, grossAmount: row.grossAmount ? toStr(row.grossAmount) : null,
      withheldAmount: row.withheldAmount ? toStr(row.withheldAmount) : null,
      netPaidAmount: row.netPaidAmount ? toStr(row.netPaidAmount) : null,
      taxInvoiceNumber: row.taxInvoiceNumber ?? null, reviewNote: row.reviewNote ?? null,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
  }

  // ─── Tax Review Issue ────────────────────────────────────────────────────────

  async createIssue(input: CreateReviewIssueInput): Promise<TaxReviewIssueRecord> {
    // Sync passes re-flag the same condition every run; one OPEN issue per
    // (period, code, source) is enough. Resolved/ignored issues may recur.
    // ponytail: check-then-create can race concurrent syncs; add a partial unique index if that ever matters.
    const existing = await this.prisma.client.taxReviewIssue.findFirst({
      where: {
        companyId: input.companyId, taxPeriodId: input.taxPeriodId, issueCode: input.issueCode,
        sourceType: input.sourceType ?? null, sourceId: input.sourceId ?? null, status: 'OPEN' as any,
      },
    });
    if (existing) {
      if (input.issueCode === 'WHT_PAYEE_KIND_UNKNOWN' && existing.description !== input.description) {
        return this.toIssueRecord(await this.prisma.client.taxReviewIssue.update({ where: { id: existing.id }, data: { description: input.description } }));
      }
      return this.toIssueRecord(existing);
    }
    const row = await this.prisma.client.taxReviewIssue.create({
      data: {
        companyId: input.companyId, taxPeriodId: input.taxPeriodId, taxEventId: input.taxEventId ?? null,
        severity: input.severity as any, status: 'OPEN' as any, issueCode: input.issueCode,
        description: input.description, sourceType: input.sourceType ?? null, sourceId: input.sourceId ?? null,
      },
    });
    return this.toIssueRecord(row);
  }

  async findIssuesByPeriod(companyId: string, taxPeriodId: string, filters?: { status?: ReviewIssueStatus; severity?: ReviewIssueSeverity }): Promise<TaxReviewIssueRecord[]> {
    const where: Record<string, unknown> = { companyId, taxPeriodId };
    if (filters?.status) where['status'] = filters.status;
    if (filters?.severity) where['severity'] = filters.severity;
    const rows = await this.prisma.client.taxReviewIssue.findMany({ where, orderBy: { createdAt: 'asc' } });
    return rows.map(r => this.toIssueRecord(r));
  }

  /** W8: remove only obsolete unfiled reporting facts; never mutate a frozen line or file. */
  async retireObsoleteExpenseWithholding(companyId: string, rows: (Pick<ExpenseWhtSourceRow, 'id' | 'expenseDate'> & Partial<ExpenseWhtSourceRow>)[]) {
    const issues = await this.prisma.client.taxReviewIssue.findMany({ where: { companyId, sourceType: 'expense.record', status: 'OPEN',
      issueCode: { in: ['WHT_PAYEE_KIND_UNKNOWN', 'MISSING_TAX_ID', 'FUNCTIONAL_CURRENCY_FX_MISSING', 'WHT_RATE_MISMATCH'] },
      taxPeriod: { formType: { in: ['PND2', 'PND3', 'PND53'] } } }, include: { taxPeriod: { select: { formType: true, periodKey: true } } } });
    const categoryCodes = [...new Set(rows.flatMap(row => row.incomeCategoryCode ? [row.incomeCategoryCode] : []))];
    const categories = issues.length && categoryCodes.length ? await this.prisma.client.whtIncomeCategory.findMany({ where: { code: { in: categoryCodes } } }) : [];
    const routes = new Map(categories.map(category => [category.code, category.filingRoute]));
    for (const issue of issues) {
      if (rows.some(row => row.whtRemittance !== 'E_WHT' && row.id === issue.sourceId && row.expenseDate.toISOString().slice(0, 7) === issue.taxPeriod.periodKey
        && (withholdingFormFor(row.payeeEntityKind ?? null, routes.get(row.incomeCategoryCode ?? '')) ?? 'PND53') === issue.taxPeriod.formType)) continue;
      await this.prisma.client.taxReviewIssue.updateMany({ where: { companyId, sourceType: 'expense.record', sourceId: issue.sourceId,
        taxPeriodId: issue.taxPeriodId, taxPeriod: { formType: issue.taxPeriod.formType, periodKey: issue.taxPeriod.periodKey }, issueCode: issue.issueCode, status: 'OPEN' },
        data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedNote: 'ข้อมูลต้นทางเปลี่ยนแล้ว' } });
    }
    const current = new Set(rows.map(r => `${r.id}:${r.sourceLineKey ?? `payment:${r.paymentId}`}:${r.expenseDate.toISOString()}`));
    const events = await this.prisma.client.taxEvent.findMany({ where: { companyId, sourceType: 'expense.record', eventType: { in: ['WHT_PND2', 'WHT_PND3', 'WHT_PND53'] }, status: { in: ['ACTIVE', 'EXCLUDED'] } } });
    for (const event of events) {
      if (current.has(`${event.sourceId}:${event.sourceLineKey}:${event.eventDate.toISOString()}`)) continue;
      await this.prisma.client.$transaction(async tx => {
        await lockExpenseCorrection(tx, companyId, event.sourceId);
        if (event.status !== 'EXCLUDED') {
          await tx.$queryRaw`SELECT id FROM "TaxPeriod" WHERE id = ${event.taxPeriodId} FOR UPDATE`;
          if ((await filedWithholdingPaymentPeriods(tx, companyId, event.sourceType, event.sourceId,
            { formType: event.whtFormType ?? '', periodKey: event.periodKey }, event.sourceLineKey.startsWith('payment:') ? event.sourceLineKey : undefined)).length) return;
        }
        await tx.taxEvent.updateMany({ where: { id: event.id, companyId, status: { in: ['ACTIVE', 'EXCLUDED'] } }, data: { status: 'SUPERSEDED' } });
        await tx.taxReviewIssue.updateMany({ where: { companyId, sourceType: 'expense.record', sourceId: event.sourceId, taxPeriodId: event.taxPeriodId,
          taxPeriod: { formType: { in: ['PND2', 'PND3', 'PND53'] } }, issueCode: 'WHT_RATE_MISMATCH', status: 'OPEN' },
          data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedNote: 'ข้อมูลต้นทางเปลี่ยนแล้ว' } });
      });
    }
  }

  async resolveStaleExpenseWithholdingIssues(companyId: string, desired: Set<string>) {
    const issues = await this.prisma.client.taxReviewIssue.findMany({ where: { companyId, sourceType: 'expense.record', status: 'OPEN',
      issueCode: { in: ['WHT_PAYEE_KIND_UNKNOWN', 'MISSING_TAX_ID', 'FUNCTIONAL_CURRENCY_FX_MISSING', 'WHT_RATE_MISMATCH'] },
      taxPeriod: { formType: { in: ['PND2', 'PND3', 'PND53'] } } } });
    const ids = issues.filter(issue => !desired.has(JSON.stringify([issue.sourceId, issue.taxPeriodId, issue.issueCode]))).map(issue => issue.id);
    if (ids.length) await this.prisma.client.taxReviewIssue.updateMany({ where: { companyId, id: { in: ids }, status: 'OPEN' },
      data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedNote: 'ข้อมูลต้นทางเปลี่ยนแล้ว' } });
  }

  async isWithholdingPaymentFiled(companyId: string, sourceType: string, sourceId: string, paymentPeriod?: { formType: string; periodKey: string }, sourceLineKey?: string, onlyFiledRows = false): Promise<boolean> {
    return (await filedWithholdingPaymentPeriods(this.prisma.client, companyId, sourceType, sourceId, paymentPeriod, sourceLineKey, onlyFiledRows)).length > 0;
  }

  async supersedeUnclassifiedWithholding(companyId: string, sourceType: string, sourceId: string, keepEventType?: 'WHT_PND2' | 'WHT_PND3' | 'WHT_PND53', sourceLineKey?: string, onlyFiledRows = false) {
    if (await this.isWithholdingPaymentFiled(companyId, sourceType, sourceId, undefined, sourceLineKey, onlyFiledRows)) return;
    await this.prisma.client.taxEvent.updateMany({
      where: { companyId, sourceType, sourceId, eventType: { in: ['WHT_PND2', 'WHT_PND3', 'WHT_PND53'], ...(keepEventType ? { not: keepEventType } : {}) }, ...(sourceLineKey ? { sourceLineKey } : {}), status: { in: ['ACTIVE', 'EXCLUDED'] },
        OR: [{ eventType: { in: ['WHT_PND3', 'WHT_PND53'] } }, { taxPeriod: { status: { notIn: ['FILED', 'PAID', 'CLOSED'] } } }, { status: 'EXCLUDED' }] },
      data: { status: 'SUPERSEDED' },
    });
  }

  async resolveSourceIssues(companyId: string, issueCode: string, sourceType: string, sourceId: string, taxPeriodId?: string, formTypes?: readonly import('@watchdog-bms/contracts').TaxFormType[]) {
    await this.prisma.client.taxReviewIssue.updateMany({
      where: { companyId, issueCode, sourceType, sourceId, status: 'OPEN', ...(taxPeriodId ? { taxPeriodId } : {}), ...(formTypes ? { taxPeriod: { formType: { in: [...formTypes] } } } : !taxPeriodId && sourceType === 'expense.record' ? { taxPeriod: { formType: { in: ['PND2', 'PND3', 'PND53'] } } } : {}) },
      data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedNote: 'ข้อมูลต้นทางครบแล้ว' },
    });
  }

  async resolveIssue(companyId: string, id: string, note: string, resolvedByUserId: string): Promise<TaxReviewIssueRecord> {
    const current = await this.prisma.client.taxReviewIssue.findFirst({ where: { id, companyId }, select: { id: true } });
    if (!current) throw new Error('tax_review_issue_not_found');
    const row = await this.prisma.client.taxReviewIssue.update({
      where: { id },
      data: { status: 'RESOLVED' as any, resolvedNote: note, resolvedByUserId, resolvedAt: new Date() },
    });
    return this.toIssueRecord(row);
  }

  private toIssueRecord(row: any): TaxReviewIssueRecord {
    return {
      id: row.id, companyId: row.companyId, taxPeriodId: row.taxPeriodId, taxEventId: row.taxEventId ?? null,
      severity: row.severity as ReviewIssueSeverity, status: row.status as ReviewIssueStatus,
      issueCode: row.issueCode, description: row.description,
      sourceType: row.sourceType ?? null, sourceId: row.sourceId ?? null,
      resolvedAt: row.resolvedAt ?? null, resolvedNote: row.resolvedNote ?? null,
      resolvedByUserId: row.resolvedByUserId ?? null, createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
  }

  // ─── Company tax signature (WHT certificate system issuance plan §3.2) ──────
  // Fifth copy of the `linkAttachmentToTarget`-shaped method every module that links attachments
  // already carries its own of (expenses/procurement/reimbursements/crm-inbox) — repo convention is
  // a small per-module copy, not a shared cross-module service.
  async linkAttachmentToTarget(attachmentId: string, targetType: string, targetId: string, purpose: string, companyId: string, actorUserId: string): Promise<void> {
    const conflict = await findAttachmentLinkConflict(this.prisma.client, { companyId, attachmentId, targetType });
    if (conflict) throw new BadRequestException(conflict);
    await this.prisma.client.attachmentLink.create({ data: { attachmentId, targetType, targetId, purpose, companyId, linkedByUserId: actorUserId } });
  }
}
