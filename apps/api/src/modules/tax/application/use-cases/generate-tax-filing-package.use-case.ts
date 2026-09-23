import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../../audit/application/audit.service';
import { CommitDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/commit-document-number.use-case';
import { ReserveDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/reserve-document-number.use-case';
import type { RequestContext, TaxExportFormat } from '@watchdog-bms/contracts';
import { formatCompanyLegalAddress, type CompanyLegalAddress } from '@watchdog-bms/contracts';
import * as crypto from 'node:crypto';
import { buildTaxExportArtifact } from '../../domain/logic/tax-export.logic';
import { printablePnd53PayeeAddress, renderPnd53OfficialForm, type Pnd53Filing, type Pnd53FilingLine } from '../../domain/logic/pnd53-official-form.logic';
import { PrismaTaxRepository } from '../../infrastructure/repositories/prisma-tax.repository';

const EXPORT_FORMATS = new Set(['REVIEW_JSON', 'CSV', 'XLSX', 'PDF']);
// The source model has no legal-section fact. These seeded corporate categories are the supported
// section 3 ter paper journey; ambiguous "other" and dividends need accountant classification.
const PND53_SECTION_3_TER_CATEGORIES = new Set([
  'WHT_SERVICE_5', 'WHT_RENT_JUR', 'WHT_PROFESSIONAL_JUR', 'WHT_ADVERTISING_JUR', 'WHT_TRANSPORT_JUR',
]);

@Injectable()
export class GenerateTaxFilingPackageUseCase {
  constructor(
    private readonly taxRepo: PrismaTaxRepository,
    private readonly reserveNumber: ReserveDocumentNumberUseCase,
    private readonly commitNumber: CommitDocumentNumberUseCase,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, periodId: string, exportFormat: TaxExportFormat) {
    if (!EXPORT_FORMATS.has(exportFormat)) throw new BadRequestException('Unsupported tax export format.');
    const period = await this.taxRepo.findPeriodById(ctx.companyId, periodId);
    if (!period) throw new NotFoundException('Tax period not found.');

    const [events, reviewIssues, latestSnapshot, reconciliation] = await Promise.all([
      this.taxRepo.findEventsByPeriod(ctx.companyId, period.id, 'ACTIVE'),
      this.taxRepo.findIssuesByPeriod(ctx.companyId, period.id, { status: 'OPEN' }),
      this.taxRepo.prisma.client.taxReportSnapshot.findFirst({
        where: { companyId: ctx.companyId, taxPeriodId: period.id },
        orderBy: { snapshotAt: 'desc' },
      }),
      ['PP30', 'PP36'].includes(period.formType) ? (this.taxRepo.prisma.client as any).taxReconciliationRun.findFirst({
        where: { companyId: ctx.companyId, branchId: null, formType: period.formType, periodKey: period.periodKey }, orderBy: { createdAt: 'desc' },
      }) : null,
    ]);
    if (['PP30', 'PP36'].includes(period.formType)) {
      if (!reconciliation) throw new ConflictException('A current tax reconciliation run is required before export');
      if (reconciliation.status !== 'REVIEWED' || reconciliation.blockingIssueCount > 0) throw new ConflictException('Tax reconciliation must be reviewed with no blocking lines before export');
      if (reviewIssues.some((issue) => issue.severity === 'BLOCKING')) throw new ConflictException('Blocking tax review issues must be resolved before export');
      const latestSourceUpdate = events.reduce((latest, event) => Math.max(latest, event.updatedAt.getTime()), 0);
      if (latestSourceUpdate > new Date(reconciliation.reviewedAt ?? reconciliation.updatedAt).getTime()) throw new ConflictException('Tax reconciliation is stale after source changes');
    }
    const rows = events.map((event) => ({
      eventType: event.eventType,
      sourceType: event.sourceType,
      sourceId: event.sourceId,
      eventDate: event.eventDate.toISOString().slice(0, 10),
      outputTaxCode: event.outputTaxCode,
      taxInvoiceNumber: event.taxInvoiceNumber,
      taxableBase: event.taxableBase,
      taxAmount: event.taxAmount,
      grossAmount: event.grossAmount,
      withheldAmount: event.withheldAmount,
      reviewNote: event.reviewNote,
    }));
    const payload = {
      generatedAt: new Date().toISOString(),
      period,
      latestReport: latestSnapshot?.reportJson ?? null,
      rows,
      reviewIssues,
      disclaimer: 'Manual filing review package only. Confirm with accountant/RD before submission.',
    };
    const artifact = period.formType === 'PND53' && exportFormat === 'PDF'
      ? await this.buildPnd53Artifact(ctx.companyId, period, events, reviewIssues)
      : buildTaxExportArtifact(exportFormat, `tax-${period.formType}-${period.periodKey}`, rows, payload);
    const reserved = await this.reserveNumber.execute({
      companyId: ctx.companyId,
      documentType: 'tax.filing_export',
      periodKey: period.periodKey,
      idempotencyKey: `tax.filing_export:${period.id}:${exportFormat}:${artifact.checksum}`,
      reservedByUserId: ctx.userId,
    });
    const pkg = await this.taxRepo.prisma.client.taxFilingPackage.create({
      data: {
        companyId: ctx.companyId,
        taxPeriodId: period.id,
        formType: period.formType as any,
        periodKey: period.periodKey,
        exportNumber: reserved.documentNumber,
        exportFormat,
        checksum: artifact.checksum,
        generatedByUserId: ctx.userId,
      },
    });
    await this.commitNumber.execute({
      id: reserved.id,
      companyId: ctx.companyId,
      ownerType: 'tax.filing_package',
      ownerId: pkg.id,
    });
    await this.taxRepo.updatePeriodStatus(ctx.companyId, period.id, 'EXPORTED');
    await this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'tax.filing_package.generate',
      targetType: 'tax_filing_package',
      targetId: pkg.id,
      requestId: ctx.requestId,
      result: 'SUCCESS',
      riskLevel: 'HIGH',
      metadataJson: { formType: period.formType, periodKey: period.periodKey, exportFormat, checksum: artifact.checksum, byteLength: artifact.byteLength },
    });
    return { ...this.toDto(pkg), artifact };
  }

  private async buildPnd53Artifact(companyId: string, period: { periodKey: string; dueDate?: Date | null }, events: Awaited<ReturnType<PrismaTaxRepository['findEventsByPeriod']>>, issues: Awaited<ReturnType<PrismaTaxRepository['findIssuesByPeriod']>>) {
    if (issues.length) throw new ConflictException('Resolve all open PND53 review issues before producing the filing form.');
    if (!events.length) throw new ConflictException('PND53 filing form requires at least one WHT payment.');
    const [year, month] = period.periodKey.split('-').map(Number);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      throw new ConflictException('PND53 period key is invalid.');
    }
    // A paper filing is ordinarily due on day 7 of the next month. A configured period due date
    // may include an official extension/holiday; without one, use day 7 conservatively rather than
    // silently writing zero surcharge on a late paper form.
    const dueDay = period.dueDate?.toISOString().slice(0, 10)
      ?? new Date(Date.UTC(year, month, 7)).toISOString().slice(0, 10);
    if (Date.now() > Date.parse(`${dueDay}T16:59:59.999Z`)) {
      throw new ConflictException('PND53 filing is overdue; review the surcharge before producing the form.');
    }
    const [company, profile, categories] = await Promise.all([
      this.taxRepo.prisma.client.company.findUnique({ where: { id: companyId } }),
      this.taxRepo.prisma.client.companyTaxProfile.findUnique({ where: { companyId } }),
      this.taxRepo.prisma.client.whtIncomeCategory.findMany({ where: { formType: 'PND53' } }),
    ]);
    const payerTaxId = String(profile?.taxId ?? company?.taxId ?? '').replace(/\D/g, '');
    const payerName = company?.registeredName?.trim();
    const branchIds = new Set(events.map((event) => event.branchId ?? null));
    if (branchIds.size !== 1) throw new ConflictException('PND53 payments from multiple branches require separate branch forms.');
    const branchId = [...branchIds][0];
    const branch = branchId ? await this.taxRepo.prisma.client.branch.findFirst({ where: { id: branchId, companyId } }) : null;
    if (branchId && !branch) throw new ConflictException('PND53 payer branch was not found.');
    const payerBranch = branch?.taxBranchCode ?? '00000';
    const payerAddress = (branch?.addressJson ?? company?.addressJson) as CompanyLegalAddress | null;
    if (!payerName || payerName.length > 80 || !/^\d{13}$/.test(payerTaxId) || !/^\d{5}$/.test(payerBranch) || !payerAddress || !formatCompanyLegalAddress(payerAddress)
      || !payerAddress.line1?.trim() || !payerAddress.subdistrict?.trim() || !payerAddress.district?.trim()
      || !payerAddress.province?.trim() || !/^\d{5}$/.test(payerAddress.postalCode ?? '')
      || payerAddress.line1.length > 50 || (payerAddress.line2?.length ?? 0) > 35
      || payerAddress.subdistrict.length > 35 || payerAddress.district.length > 35 || payerAddress.province.length > 35) {
      throw new ConflictException('Complete the payer legal name, 13-digit tax ID, 5-digit branch and address before producing PND53.');
    }
    const categoryNames = new Map(categories.map((category) => [category.code, category.nameTh]));
    const lines: Pnd53FilingLine[] = [];
    for (const event of events) {
      if (event.eventType !== 'WHT_PND53' || event.currency !== 'THB' || event.eventDate.toISOString().slice(0, 7) !== period.periodKey) {
        throw new ConflictException('PND53 contains an unsupported or out-of-period tax event.');
      }
      const payee = event.payeeSnapshot;
      const payeeAddress = printablePnd53PayeeAddress(payee?.address);
      const payeeTaxId = String(payee?.taxId ?? '').replace(/\D/g, '');
      const payeeBranch = payee?.branchCode ?? '00000';
      const rate = Number(event.whtRate);
      const income = Number(event.grossAmount);
      const withheld = Number(event.withheldAmount);
      const incomeType = event.incomeCategoryCode ? categoryNames.get(event.incomeCategoryCode) : null;
      if (!payee?.name?.trim() || payee.name.length > 80 || !/^\d{13}$/.test(payeeTaxId) || !/^\d{5}$/.test(payeeBranch)
        || !payeeAddress || payeeAddress.length > 104
        || !incomeType || !PND53_SECTION_3_TER_CATEGORIES.has(event.incomeCategoryCode ?? '')
        || !Number.isFinite(rate) || rate <= 0 || !Number.isFinite(income) || income <= 0
        || !Number.isFinite(withheld) || withheld <= 0 || Math.abs(Math.round(income * rate) / 100 - withheld) > 0.02) {
        throw new ConflictException(`PND53 source ${event.sourceId} needs complete payee, income category, rate, amount and address before filing.`);
      }
      if (event.sourceType === 'expense.record') {
        const source = await this.taxRepo.prisma.client.expenseRecord.findFirst({ where: { id: event.sourceId, companyId }, select: { vendorEntityKindSnapshot: true } });
        if (source?.vendorEntityKindSnapshot !== 'JURISTIC') throw new ConflictException(`PND53 source ${event.sourceId} needs a confirmed juristic payee classification.`);
      } else if (event.sourceType === 'procurement.supplier_payment') {
        const source = await this.taxRepo.prisma.client.supplierPayment.findFirst({ where: { id: event.sourceId, companyId }, include: { supplier: { select: { supplierType: true } } } });
        if (source?.supplier?.supplierType !== 'JURISTIC_PERSON') throw new ConflictException(`PND53 source ${event.sourceId} needs a confirmed juristic payee classification.`);
      } else throw new ConflictException(`Unsupported PND53 source type: ${event.sourceType}`);
      lines.push({ payeeName: payee.name, payeeTaxId, payeeBranch, payeeAddress, paidAt: event.eventDate,
        incomeType, rate, income, withheld });
    }
    const filing: Pnd53Filing = { periodKey: period.periodKey, payerName, payerTaxId, payerBranch, payerAddress, lines };
    const buffer = await renderPnd53OfficialForm(filing);
    return { fileName: `PND53-${period.periodKey}.pdf`, mimeType: 'application/pdf', contentBase64: buffer.toString('base64'),
      checksum: crypto.createHash('sha256').update(buffer).digest('hex'), byteLength: buffer.length };
  }

  private toDto(row: any) {
    return {
      id: row.id,
      companyId: row.companyId,
      taxPeriodId: row.taxPeriodId,
      formType: row.formType,
      periodKey: row.periodKey,
      exportNumber: row.exportNumber,
      status: row.status,
      exportFormat: row.exportFormat,
      attachmentId: row.attachmentId ?? null,
      checksum: row.checksum ?? null,
      generatedAt: row.generatedAt.toISOString(),
      downloadedAt: row.downloadedAt?.toISOString() ?? null,
      voidedAt: row.voidedAt?.toISOString() ?? null,
      filedManuallyAt: row.filedManuallyAt?.toISOString() ?? null,
      filedManuallyNote: row.filedManuallyNote ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
