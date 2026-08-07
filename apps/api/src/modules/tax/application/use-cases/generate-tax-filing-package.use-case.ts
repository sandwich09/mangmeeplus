import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../../audit/application/audit.service';
import { CommitDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/commit-document-number.use-case';
import { ReserveDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/reserve-document-number.use-case';
import type { RequestContext, TaxExportFormat } from '@watchdog-bms/contracts';
import { buildTaxExportArtifact } from '../../domain/logic/tax-export.logic';
import { PrismaTaxRepository } from '../../infrastructure/repositories/prisma-tax.repository';

const EXPORT_FORMATS = new Set(['REVIEW_JSON', 'CSV', 'XLSX', 'PDF']);

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
    const artifact = buildTaxExportArtifact(exportFormat, `tax-${period.formType}-${period.periodKey}`, rows, payload);
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
