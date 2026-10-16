import { certificateEventPaymentDate } from '../services/wht-certificate-payment';
import { whtCertificateUnsupportedReason } from '@watchdog-bms/contracts';
import { whtPayerIdentity, whtPayerIdentityMissingMessage } from '@watchdog-bms/contracts';
import { throwIfWhtCertificateNumberCollision } from '../services/wht-certificate-number-error';
import { lockExpenseCorrection } from '../../../expenses/infrastructure/expense-void-blocker';
import { whtPayeeAddress, WHT_HANDOFF_PAYEE_ADDRESS_MISSING_MESSAGE, EXPENSE_CORRECTION_WORDS } from '@watchdog-bms/contracts';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../../audit/application/audit.service';
import { CommitDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/commit-document-number.use-case';
import { ReserveDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/reserve-document-number.use-case';
import { PrismaAttachmentRepository } from '../../../data-model-core/infrastructure/repositories/prisma-attachment.repository';
import { ATTACHMENT_STORAGE, type AttachmentStoragePort } from '../../../data-model-core/domain/ports/attachment-storage.port';
import { formatCompanyLegalAddressForPrint, type CompanyLegalAddress, type CreateWhtCertificateDto, type RequestContext } from '@watchdog-bms/contracts';
import { LaunchGateGuardService } from '../../../feature-launch/application/launch-gate.guard';
import { validateCertificateTotals } from '../../domain/logic/wht-report.logic';
import { PrismaTaxRepository } from '../../infrastructure/repositories/prisma-tax.repository';
import { TaxArtifactRendererService } from '../services/tax-artifact-renderer.service';
import type { WhtCertificateSignature } from '../../domain/logic/wht-certificate-pdf.logic';
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
    // §3.4/§2.5: the same company signature setting the AP/Expenses handoff path reads, so the
    // Tax-workspace SYSTEM-issue path prints the identical signature block.
    private readonly attachments: PrismaAttachmentRepository,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStoragePort,
  ) {}

  private async resolveSignature(companyId: string): Promise<WhtCertificateSignature | undefined> {
    const profile = await this.taxRepo.prisma.client.companyTaxProfile.findUnique({ where: { companyId } });
    if (!profile || profile.signatureMode !== 'AUTO_STAMP' || !profile.signatureImageAttachmentId) return undefined;
    const attachment = await this.attachments.findById({ id: profile.signatureImageAttachmentId, companyId });
    if (!attachment || attachment.status !== 'ACTIVE') return undefined;
    const object = await this.storage.getObject({
      bucket: attachment.bucket, objectKey: attachment.objectKey,
      ...(attachment.objectVersionId ? { objectVersionId: attachment.objectVersionId } : {}),
    });
    return {
      mode: 'AUTO_STAMP',
      signatureImageBase64: object.bytes.toString('base64'),
      signatureImageMimeType: attachment.mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png',
    };
  }

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
    const unsupportedForm = whtCertificateUnsupportedReason(input.incomeCategoryCode, period.formType);
    if (systemIssuanceOpen && unsupportedForm) throw new ConflictException({ code: 'wht_certificate_income_unsupported', message: unsupportedForm });
    const events = (await this.taxRepo.findEventsByPeriod(ctx.companyId, period.id, 'ACTIVE'))
      .filter((event) => input.taxEventIds.includes(event.id));
    const unsupportedPayment = events.map(event => whtCertificateUnsupportedReason(event.incomeCategoryCode, event.whtFormType)).find(Boolean);
    if (systemIssuanceOpen && unsupportedPayment) throw new ConflictException({ code: 'wht_certificate_income_unsupported', message: unsupportedPayment });
    if (events.length !== input.taxEventIds.length) throw new BadRequestException('Some WHT tax events were not found.');
    if (events.some((event) => event.eventType !== 'WHT_PND3' && event.eventType !== 'WHT_PND53')) {
      throw new BadRequestException('50 Tawi certificate can include WHT events only.');
    }
    const eventGross = sum(events.map((event) => event.grossAmount ?? '0'));
    const eventWithheld = sum(events.map((event) => event.withheldAmount ?? event.taxAmount));
    const errors = validateCertificateTotals(input.grossAmount, input.withheldAmount, eventGross, eventWithheld);
    if (errors.length) throw new BadRequestException(errors.join('; '));

    const paymentDate = await certificateEventPaymentDate(this.taxRepo.prisma.client, ctx.companyId, events);
    input = { ...input, paymentDate };
    const [company, profile, category] = await Promise.all([
      this.taxRepo.prisma.client.company.findUnique({ where: { id: ctx.companyId } }),
      this.taxRepo.prisma.client.companyTaxProfile.findUnique({ where: { companyId: ctx.companyId } }),
      this.taxRepo.prisma.client.whtIncomeCategory.findUnique({ where: { code: input.incomeCategoryCode } }),
    ]);
    const unsupported = whtCertificateUnsupportedReason(input.incomeCategoryCode, category?.formType);
    if (systemIssuanceOpen && unsupported) throw new ConflictException({ code: 'wht_certificate_income_unsupported', message: unsupported });
    const payerSnapshot = {
      companyName: company?.registeredName ?? company?.name ?? 'Unknown company',
      taxId: profile?.taxId ?? company?.taxId ?? null,
      branchCode: null,
      // BUG-1: this used to be `JSON.stringify(company.addressJson)`, so the payer address on a
      // 50 ทวิ prefill read `{"line1":"…"}`. The formatter prints one line and answers null for a
      // row whose JSON is not the §4.1 shape — an address nobody can print is refused before a new certificate is issued.
      address: formatCompanyLegalAddressForPrint(company?.addressJson as CompanyLegalAddress | null),
    };
    const expenseIds = [...new Set(events.filter((event) => event.sourceType === 'expense.record').map((event) => event.sourceId))].sort();
    const withCurrentExpenseSources = async (write: (db: any) => Promise<any>) => expenseIds.length ? await this.taxRepo.prisma.client.$transaction(async (tx: any) => {
      for (const expenseId of expenseIds) {
        await lockExpenseCorrection(tx, ctx.companyId, expenseId);
        const expense = await tx.expenseRecord.findFirst({ where: { companyId: ctx.companyId, id: expenseId }, select: { status: true } });
        if (expense?.status !== 'CONFIRMED') throw new ConflictException({ code: 'expense_wht_source_changed', message: EXPENSE_CORRECTION_WORDS.sourceChanged });
      }
      const current = await tx.taxEvent.findMany({ where: { companyId: ctx.companyId, id: { in: input.taxEventIds } } });
      if (current.length !== events.length || current.some((event: any) => event.status !== 'ACTIVE' || event.sourceHash !== events.find((old) => old.id === event.id)?.sourceHash)) {
        throw new ConflictException({ code: 'expense_wht_source_changed', message: EXPENSE_CORRECTION_WORDS.sourceChanged });
      }
      if (await certificateEventPaymentDate(tx, ctx.companyId, current) !== paymentDate) throw new ConflictException({ code: 'expense_wht_source_changed', message: EXPENSE_CORRECTION_WORDS.sourceChanged });
      return write(tx);
    }, { isolationLevel: 'ReadCommitted' }) : await write(this.taxRepo.prisma.client);
    if (!systemIssuanceOpen) {
      // The facts are valid and the tax really was withheld — only the SYSTEM artifact is
      // unavailable. Persist what we know so the operator can have the certificate issued
      // externally and link it back (spec:205).
      const handoff = await withCurrentExpenseSources((db) => this.handoffs.createOrReplay({
        ...(db !== this.taxRepo.prisma.client ? { tx: db } : {}),
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
      }));
      throw new ConflictException({
        code: WHT_SYSTEM_ISSUANCE_UNAVAILABLE,
        fallback: WHT_EXTERNAL_FALLBACK,
        message: WHT_EXTERNAL_FALLBACK_MESSAGE_TH,
        handoffId: handoff.id,
        handoffStatus: handoff.status,
      });
    }

    const payer = whtPayerIdentity(payerSnapshot, { ...payerSnapshot, registeredName: company?.registeredName ?? null });
    if (payer.missing.length) throw new ConflictException({ code: 'wht_payer_identity_missing', message: whtPayerIdentityMissingMessage(payer.missing), payerMissing: payer.missing });

    if (!whtPayeeAddress(undefined, input.payeeSnapshot.address)) throw new ConflictException({
      code: 'wht_handoff_payee_address_missing', message: WHT_HANDOFF_PAYEE_ADDRESS_MISSING_MESSAGE,
    });

    const reserved = await this.reserveNumber.execute({
      companyId: ctx.companyId,
      documentType: 'tax.wht_certificate',
      periodKey: period.periodKey,
      idempotencyKey: `tax.wht_certificate:${period.id}:${[...input.taxEventIds].sort().join(',')}`,
      reservedByUserId: ctx.userId,
    }).catch((error: unknown) => {
      throwIfWhtCertificateNumberCollision(error, ctx.companyId);
      throw error;
    });
    // §2.5/§3.4: the real 50 ทวิ template, not the filing-package `buildMinimalPdf` — the same gate
    // covers this Tax-workspace path and the AP/Expenses handoff path, so both must render the same
    // real PDF, including the same company signature setting.
    const signature = await this.resolveSignature(ctx.companyId);
    const pdf = await this.renderer.renderWhtCertificate({
      certificateNumber: reserved.documentNumber,
      formType: (period as { formType?: string }).formType === 'PND53' ? 'PND53' : 'PND3',
      incomeCategoryCode: input.incomeCategoryCode,
      incomeCategoryName: category?.nameTh ?? input.incomeCategoryCode,
      whtRate: input.whtRate,
      grossAmount: input.grossAmount,
      withheldAmount: input.withheldAmount,
      paymentDate: input.paymentDate,
      issuedAt: new Date().toISOString(),
    }, payer.payer, input.payeeSnapshot, signature);
    const writeCertificate = (db: any) => db.whtCertificate.create({
      data: {
        companyId: ctx.companyId,
        certificateNumber: reserved.documentNumber,
        status: 'ISSUED',
        taxPeriodId: period.id,
        periodKey: period.periodKey,
        payeeSnapshotJson: input.payeeSnapshot as any,
        payerSnapshotJson: payer.payer as any,
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
    const row = await withCurrentExpenseSources(writeCertificate).catch((error: unknown) => {
      throwIfWhtCertificateNumberCollision(error, ctx.companyId);
      throw error;
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
