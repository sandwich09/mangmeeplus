import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../../audit/application/audit.service';
import { CommitDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/commit-document-number.use-case';
import { ReserveDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/reserve-document-number.use-case';
import { formatCompanyLegalAddress, type CompanyLegalAddress, type CreateWhtCertificateDto, type RequestContext } from '@watchdog-bms/contracts';
import { LaunchGateGuardService } from '../../../feature-launch/application/launch-gate.guard';
import { validateCertificateTotals } from '../../domain/logic/wht-report.logic';
import { PrismaTaxRepository } from '../../infrastructure/repositories/prisma-tax.repository';
import { TaxArtifactRendererService } from '../services/tax-artifact-renderer.service';
import { isLaunchRouteOpen, WhtCertificateHandoffUseCase } from './wht-certificate-handoff.use-case';

/**
 * The exact FEATURE_LAUNCH_MATRIX route that authorizes a SYSTEM 50 ทวิ
 * (tax-thailand-2026-spec.md:1391, :2167).
 */
export const WHT_SYSTEM_INITIAL_ISSUE_GATE = { gateKey: 'cap.wht50bis', routeKey: 'SYSTEM_INITIAL_ISSUE' } as const;

/**
 * The CLOSED-route answer. Distinct from `feature_temporarily_unavailable`: the caller is not being
 * refused, it is being told which path applies instead — the payment/WHT facts already exist, only
 * the SYSTEM artifact does not, so the operator issues the certificate outside the system and links
 * it back. Mirrors the spec's `EXTERNAL_CERTIFICATE_REQUIRED` handoff
 * (feature-entitlement-decoupling-spec.md:299, tax-thailand-2026-spec.md:1391).
 */
export const WHT_SYSTEM_ISSUANCE_UNAVAILABLE = 'wht_system_issuance_unavailable';
export const WHT_EXTERNAL_FALLBACK = 'EXTERNAL_CERTIFICATE_REQUIRED';
const WHT_EXTERNAL_FALLBACK_MESSAGE_TH =
  'ระบบยังไม่เปิดการออกหนังสือรับรองอัตโนมัติ — บันทึกข้อมูลไว้แล้ว สามารถออกเอกสารภายนอกแล้วแนบกลับได้';

@Injectable()
export class CreateWhtCertificateUseCase {
  constructor(
    private readonly taxRepo: PrismaTaxRepository,
    private readonly reserveNumber: ReserveDocumentNumberUseCase,
    private readonly commitNumber: CommitDocumentNumberUseCase,
    private readonly audit: AuditService,
    private readonly launchGate: LaunchGateGuardService,
    private readonly handoffs: WhtCertificateHandoffUseCase,
    private readonly renderer: TaxArtifactRendererService,
  ) {}

  async execute(ctx: RequestContext, input: CreateWhtCertificateDto) {
    // FIRST decision on purpose: the launch gate — not this use case — decides whether a SYSTEM
    // certificate may exist. A closed route still reserves no number, renders no PDF and writes no
    // certificate row; the only thing it may write is the durable handoff below, and only after the
    // same fact validation the OPEN path performs, so an unqualifying request produces nothing
    // (spec:204). H4 replaced the previous "throw immediately" shape, whose 409 promised the caller
    // "บันทึกข้อมูลไว้แล้ว" while persisting nothing at all.
    const systemIssuanceOpen = await this.isSystemIssuanceOpen();
    const period = await this.taxRepo.findPeriodById(ctx.companyId, input.taxPeriodId);
    if (!period) throw new NotFoundException('Tax period not found.');
    const events = (await this.taxRepo.findEventsByPeriod(ctx.companyId, period.id, 'ACTIVE'))
      .filter((event) => input.taxEventIds.includes(event.id));
    if (events.length !== input.taxEventIds.length) throw new BadRequestException('Some WHT tax events were not found.');
    if (events.some((event) => event.eventType !== 'WHT_PND3' && event.eventType !== 'WHT_PND53')) {
      throw new BadRequestException('50 Tawi certificate can include WHT events only.');
    }
    const eventGross = sum(events.map((event) => event.grossAmount ?? '0'));
    const eventWithheld = sum(events.map((event) => event.withheldAmount ?? event.taxAmount));
    const errors = validateCertificateTotals(input.grossAmount, input.withheldAmount, eventGross, eventWithheld);
    if (errors.length) throw new BadRequestException(errors.join('; '));

    const [company, profile, category] = await Promise.all([
      this.taxRepo.prisma.client.company.findUnique({ where: { id: ctx.companyId } }),
      this.taxRepo.prisma.client.companyTaxProfile.findUnique({ where: { companyId: ctx.companyId } }),
      this.taxRepo.prisma.client.whtIncomeCategory.findUnique({ where: { code: input.incomeCategoryCode } }),
    ]);
    const payerSnapshot = {
      companyName: company?.registeredName ?? company?.name ?? 'Unknown company',
      taxId: profile?.taxId ?? company?.taxId ?? null,
      branchCode: null,
      // BUG-1: this used to be `JSON.stringify(company.addressJson)`, so the payer address on a
      // 50 ทวิ prefill read `{"line1":"…"}`. The formatter prints one line and answers null for a
      // row whose JSON is not the §4.1 shape — an address nobody can print must not block issuing.
      address: formatCompanyLegalAddress(company?.addressJson as CompanyLegalAddress | null),
    };
    if (!systemIssuanceOpen) {
      // The facts are valid and the tax really was withheld — only the SYSTEM artifact is
      // unavailable. Persist what we know so the operator can have the certificate issued
      // externally and link it back (spec:205).
      const handoff = await this.handoffs.createOrReplay({
        companyId: ctx.companyId,
        creationCommandId: `tax.wht_certificate:${period.id}:${[...input.taxEventIds].sort().join(',')}`,
        sourceFeatureKey: 'thai_tax',
        taxPeriodId: period.id,
        taxEventIds: input.taxEventIds,
        branchCode: input.payeeSnapshot.branchCode ?? null,
        availabilityVector: { ...WHT_SYSTEM_INITIAL_ISSUE_GATE, state: 'CLOSED' },
        prefill: {
          payerSnapshot,
          payeeSnapshot: input.payeeSnapshot,
          formType: (period as { formType?: string }).formType === 'PND53' ? 'PND53' : 'PND3',
          incomeCategoryCode: input.incomeCategoryCode,
          incomeCategoryName: category?.nameTh ?? input.incomeCategoryCode,
          whtRate: input.whtRate,
          grossAmount: input.grossAmount,
          withheldAmount: input.withheldAmount,
          paymentDate: input.paymentDate,
        },
      });
      throw new ConflictException({
        code: WHT_SYSTEM_ISSUANCE_UNAVAILABLE,
        fallback: WHT_EXTERNAL_FALLBACK,
        message: WHT_EXTERNAL_FALLBACK_MESSAGE_TH,
        handoffId: handoff.id,
        handoffStatus: handoff.status,
      });
    }

    const reserved = await this.reserveNumber.execute({
      companyId: ctx.companyId,
      documentType: 'tax.wht_certificate',
      periodKey: period.periodKey,
      idempotencyKey: `tax.wht_certificate:${period.id}:${[...input.taxEventIds].sort().join(',')}`,
      reservedByUserId: ctx.userId,
    });
    const pdf = this.renderer.render('PDF', `wht-certificate-${reserved.documentNumber}`, [{
      certificateNumber: reserved.documentNumber,
      payeeName: input.payeeSnapshot.name,
      grossAmount: input.grossAmount,
      withheldAmount: input.withheldAmount,
    }], {
      period,
      rows: events,
      reviewIssues: [],
      certificateNumber: reserved.documentNumber,
      payerSnapshot,
      payeeSnapshot: input.payeeSnapshot,
    });
    const row = await this.taxRepo.prisma.client.whtCertificate.create({
      data: {
        companyId: ctx.companyId,
        certificateNumber: reserved.documentNumber,
        status: 'ISSUED',
        taxPeriodId: period.id,
        periodKey: period.periodKey,
        payeeSnapshotJson: input.payeeSnapshot as any,
        payerSnapshotJson: payerSnapshot as any,
        incomeCategoryCode: input.incomeCategoryCode,
        incomeCategoryName: category?.nameTh ?? input.incomeCategoryCode,
        whtRate: input.whtRate,
        grossAmount: input.grossAmount,
        withheldAmount: input.withheldAmount,
        paymentDate: new Date(input.paymentDate),
        taxEventIdsJson: input.taxEventIds as any,
        issuedAt: new Date(),
        issuedByUserId: ctx.userId,
      },
    });
    await this.commitNumber.execute({ id: reserved.id, companyId: ctx.companyId, ownerType: 'tax.wht_certificate', ownerId: row.id });
    await this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'tax.wht_certificate.issue',
      targetType: 'wht_certificate',
      targetId: row.id,
      requestId: ctx.requestId,
      result: 'SUCCESS',
      riskLevel: 'HIGH',
      metadataJson: { periodKey: period.periodKey, certificateNumber: row.certificateNumber, taxEventCount: input.taxEventIds.length, pdfChecksum: pdf.checksum },
    });
    return { ...this.toDto(row), pdfArtifact: pdf };
  }

  /** One shared translation of the control-plane refusal — see `isLaunchRouteOpen`. */
  private async isSystemIssuanceOpen(): Promise<boolean> {
    return isLaunchRouteOpen(this.launchGate, WHT_SYSTEM_INITIAL_ISSUE_GATE.gateKey, WHT_SYSTEM_INITIAL_ISSUE_GATE.routeKey);
  }

  private toDto(row: any) {
    return {
      id: row.id,
      companyId: row.companyId,
      certificateNumber: row.certificateNumber,
      status: row.status,
      taxPeriodId: row.taxPeriodId,
      periodKey: row.periodKey,
      payeeSnapshot: row.payeeSnapshotJson,
      payerSnapshot: row.payerSnapshotJson,
      incomeCategoryCode: row.incomeCategoryCode,
      incomeCategoryName: row.incomeCategoryName,
      whtRate: String(row.whtRate),
      grossAmount: String(row.grossAmount),
      withheldAmount: String(row.withheldAmount),
      paymentDate: row.paymentDate.toISOString(),
      taxEventIds: row.taxEventIdsJson,
      pdfAttachmentId: row.pdfAttachmentId ?? null,
      issuedAt: row.issuedAt?.toISOString() ?? null,
      voidedAt: row.voidedAt?.toISOString() ?? null,
      voidReason: row.voidReason ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

function sum(values: string[]): string {
  const scale = 10_000n;
  const total = values.reduce((acc, value) => acc + parseDecimal(value, scale), 0n);
  return `${total / scale}.${String(total % scale).padStart(4, '0')}`;
}

function parseDecimal(value: string, scale: bigint): bigint {
  const negative = value.trim().startsWith('-');
  const normalized = negative ? value.trim().slice(1) : value.trim();
  const [whole = '0', fraction = ''] = normalized.split('.');
  const paddedFraction = `${fraction}0000`.slice(0, 4);
  const amount = BigInt(whole || '0') * scale + BigInt(paddedFraction || '0');
  return negative ? -amount : amount;
}
