import { currentWhtPayerDetails } from '../services/wht-payer-identity';
import { normalizeTaxId } from '../../../data-model-core/domain/logic/company-legal-identity.logic';
import { whtPayerIdentity, whtPayerIdentityMissingMessage } from '@watchdog-bms/contracts';
import { whtPayeeAddress } from '@watchdog-bms/contracts';
import { loadScopedWhtHandoff } from '../services/wht-handoff-read-scope';
import { throwIfWhtCertificateNumberCollision } from '../services/wht-certificate-number-error';
import Decimal from 'decimal.js';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { PayeeSnapshot, PayerSnapshot, RequestContext, WhtCertificateCorrectionInput, WhtFormType } from '@watchdog-bms/contracts';
import { AuditService } from '../../../audit/application/audit.service';
import { LaunchGateGuardService } from '../../../feature-launch/application/launch-gate.guard';
import { ReserveDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/reserve-document-number.use-case';
import { PrismaDocumentSequenceRepository } from '../../../data-model-core/infrastructure/repositories/prisma-document-sequence.repository';
import { PrismaAttachmentRepository } from '../../../data-model-core/infrastructure/repositories/prisma-attachment.repository';
import { ATTACHMENT_STORAGE, type AttachmentStoragePort } from '../../../data-model-core/domain/ports/attachment-storage.port';
import { formPeriodKey } from '../../domain/logic/tax-period.logic';
import { PrismaTaxRepository } from '../../infrastructure/repositories/prisma-tax.repository';
import { TaxArtifactRendererService } from '../services/tax-artifact-renderer.service';
import type { WhtCertificateSignature } from '../../domain/logic/wht-certificate-pdf.logic';
import { isSystemContentCorrectionOpen } from './wht-certificate-handoff.use-case';
import { appendWhtCertificateHistory } from '../services/wht-certificate-history';
import { lockExpenseCorrection } from '../../../expenses/infrastructure/expense-void-blocker';
import { coerceCivilDate, EXPENSE_CORRECTION_WORDS, WHT_CERTIFICATE_CORRECTION_WORDS } from '@watchdog-bms/contracts';

const FINANCIAL_PERIOD_LOCK_STATUSES = ['FILED', 'PAID', 'CLOSED'];

/**
 * Corrects a SYSTEM-issued 50 ทวิ certificate — the AP/Expenses "แก้ไขหนังสือรับรอง" button
 * (correction & replacement plan §2.2). Mints a NEW-numbered certificate carrying the corrected
 * fields (merged over the current certificate's own values — every input field optional) and marks
 * the old one VOIDED/SUPERSEDED_BY_CORRECTION. Mirrors `IssueWhtCertificateFromHandoffUseCase`'s
 * dependencies and certificate transaction (plan §2.2); each attempt owns its reservation.
 */
@Injectable()
export class CorrectWhtCertificateUseCase {
  constructor(
    private readonly taxRepo: PrismaTaxRepository,
    private readonly reserveNumber: ReserveDocumentNumberUseCase,
    // Same reasoning as the sibling use case: the commit must land in the same transaction as the
    // new certificate row create, the old certificate's conditional void, and the handoff's
    // certificateId update.
    private readonly documentSequences: PrismaDocumentSequenceRepository,
    private readonly audit: AuditService,
    private readonly launchGate: LaunchGateGuardService,
    private readonly renderer: TaxArtifactRendererService,
    private readonly attachments: PrismaAttachmentRepository,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStoragePort,
  ) {}

  private get table() {
    return (this.taxRepo.prisma.client as any).whtCertificateHandoff;
  }

  private async isCorrectionOpen(): Promise<boolean> {
    return isSystemContentCorrectionOpen(this.launchGate);
  }

  /** Identical to `IssueWhtCertificateFromHandoffUseCase.resolveSignature` (plan §2.2 dependencies). */
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

  async execute(ctx: RequestContext, handoffId: string, corrected: WhtCertificateCorrectionInput, reason: string) {
    const row = await loadScopedWhtHandoff(this.taxRepo.prisma.client, ctx, handoffId);
    // v1 scope (spec §3/§4.1): only a certificate the SYSTEM itself issued may be corrected here —
    // EXTERNAL_LINKED documents are untouched.
    if (row.status !== 'SYSTEM_ISSUED' || !row.certificateId) {
      throw new ConflictException({ code: 'wht_certificate_not_correctable', message: 'แก้ไขหนังสือรับรองนี้ไม่ได้ เพราะไม่ใช่เอกสารที่ระบบออกให้', status: row.status });
    }

    const current = await this.taxRepo.prisma.client.whtCertificate.findUnique({ where: { id: row.certificateId } });
    if (!current || current.companyId !== ctx.companyId) throw new NotFoundException('WHT certificate not found.');
    // Defense-in-depth: should not happen while handoff.certificateId is kept current, but a cheap
    // guard against correcting an already-superseded certificate twice.
    if (current.supersededByCertificateId) {
      throw new ConflictException({ code: 'wht_certificate_already_superseded', message: 'หนังสือรับรองนี้ถูกแทนที่ไปแล้ว กรุณาโหลดข้อมูลใหม่' });
    }
    if (!(await this.isCorrectionOpen())) {
      throw new ConflictException({ code: 'wht_system_correction_unavailable', message: 'ระบบยังไม่เปิดการแก้ไขหนังสือรับรองอัตโนมัติ' });
    }

    // The certificate row itself does not store `formType` — only its TaxPeriod does.
    const currentPeriod = await this.taxRepo.findPeriodById(ctx.companyId, current.taxPeriodId);
    const currentFormType: WhtFormType = currentPeriod?.formType === 'PND3' ? 'PND3' : 'PND53';
    const currentPayerSnapshot = current.payerSnapshotJson as PayerSnapshot;
    const currentPayeeSnapshot = current.payeeSnapshotJson as PayeeSnapshot;
    const currentPaymentDateIso = current.paymentDate.toISOString();

    // §2.2 step 5: merge the user's overrides over the certificate's own current values — an
    // omitted field means "keep what is on the certificate today", never a derive-from-source value.
    const merged = {
      formType: corrected.formType ?? currentFormType,
      incomeCategoryCode: corrected.incomeCategoryCode ?? current.incomeCategoryCode,
      incomeCategoryName: corrected.incomeCategoryName ?? current.incomeCategoryName,
      whtRate: corrected.whtRate ?? String(current.whtRate),
      grossAmount: corrected.grossAmount ?? String(current.grossAmount),
      withheldAmount: corrected.withheldAmount ?? String(current.withheldAmount),
      paymentDate: corrected.paymentDate ?? currentPaymentDateIso,
      payerSnapshot: { ...currentPayerSnapshot, ...Object.fromEntries(Object.entries(corrected.payerSnapshot ?? {}).filter(([, value]) => value !== undefined)) } as PayerSnapshot,
      payeeSnapshot: { ...currentPayeeSnapshot, ...Object.fromEntries(Object.entries(corrected.payeeSnapshot ?? {}).filter(([, value]) => value !== undefined)) } as PayeeSnapshot,
    };
    if (merged.formType !== currentFormType || merged.incomeCategoryCode !== current.incomeCategoryCode || merged.incomeCategoryName !== current.incomeCategoryName
      || !new Decimal(merged.whtRate).eq(current.whtRate.toString()) || !new Decimal(merged.grossAmount).eq(current.grossAmount.toString())
      || !new Decimal(merged.withheldAmount).eq(current.withheldAmount.toString())
      || normalizeTaxId(merged.payeeSnapshot.taxId ?? '') !== normalizeTaxId(currentPayeeSnapshot.taxId ?? '')) {
      throw new ConflictException({ code: 'wht_correction_field_locked', message: WHT_CERTIFICATE_CORRECTION_WORDS.fieldLocked });
    }
    // Equivalent strings from older whole-form screens keep the certificate's original facts.
    Object.assign(merged, { formType: currentFormType, incomeCategoryCode: current.incomeCategoryCode, incomeCategoryName: current.incomeCategoryName,
      whtRate: String(current.whtRate), grossAmount: String(current.grossAmount), withheldAmount: String(current.withheldAmount) });
    merged.payeeSnapshot.taxId = currentPayeeSnapshot.taxId;
    if (!merged.payeeSnapshot.name?.trim()) throw new BadRequestException({
      code: 'wht_certificate_payee_name_required', message: WHT_CERTIFICATE_CORRECTION_WORDS.payeeNameRequired,
    });

    const payer = whtPayerIdentity(merged.payerSnapshot, await currentWhtPayerDetails(this.taxRepo.prisma.client, ctx.companyId));
    if (payer.missing.length) throw new ConflictException({ code: 'wht_payer_identity_missing', message: whtPayerIdentityMissingMessage(payer.missing), payerMissing: payer.missing });
    merged.payerSnapshot = payer.payer;

    if (!whtPayeeAddress(undefined, merged.payeeSnapshot.address)) throw new BadRequestException({
      code: 'wht_certificate_payee_address_required', message: WHT_CERTIFICATE_CORRECTION_WORDS.payeeAddressRequired,
    });

    // Payment date keeps its existing period guard; name/address/branch changes remain nonfinancial.
    const isFinancial = coerceCivilDate(merged.paymentDate) !== coerceCivilDate(current.paymentDate);

    if (!isFinancial && merged.incomeCategoryName === current.incomeCategoryName
      && Object.entries(merged.payerSnapshot).every(([key, value]) => value === currentPayerSnapshot[key as keyof PayerSnapshot])
      && Object.entries(merged.payeeSnapshot).every(([key, value]) => value === currentPayeeSnapshot[key as keyof PayeeSnapshot])) {
      throw new ConflictException({ code: 'wht_certificate_correction_no_changes', message: WHT_CERTIFICATE_CORRECTION_WORDS.noChanges });
    }

    // §5.1's kept guard, mirroring `wht_tax_period_locked_requires_amendment` exactly: a financial
    // correction never silently bypasses a filed/paid/closed tax period — it is refused outright and
    // deferred to the existing accounting-amendment flow.
    if (isFinancial && currentPeriod && FINANCIAL_PERIOD_LOCK_STATUSES.includes(currentPeriod.status)) {
      throw new ConflictException({
        code: 'wht_certificate_correction_tax_period_locked',
        message: 'งวดภาษีของหนังสือรับรองนี้ปิดแล้ว ไม่สามารถแก้ไขยอด/อัตรา/หมวดเงิน/วันที่ได้ กรุณาทำรายการแก้ไขทางบัญชีแยกต่างหาก',
      });
    }

    const periodKey = formPeriodKey(merged.formType, new Date(merged.paymentDate));
    const period = await this.taxRepo.upsertPeriod({ companyId: ctx.companyId, taxType: 'WHT', formType: merged.formType, periodKey });

    const signature = await this.resolveSignature(ctx.companyId);
    // Each attempt owns its reservation: cleanup cannot cancel a concurrent attempt's number,
    // and a retry cannot receive the failed attempt's CANCELLED reservation.
    const idempotencyKey = `wht_certificate_correction:${current.id}:${randomUUID()}`;
    let reserved: Awaited<ReturnType<ReserveDocumentNumberUseCase['execute']>>;
    try {
      reserved = await this.reserveNumber.execute({
        companyId: ctx.companyId, documentType: 'tax.wht_certificate', periodKey: period.periodKey,
        idempotencyKey, reservedByUserId: ctx.userId,
      });
    } catch (error) {
      throwIfWhtCertificateNumberCollision(error, ctx.companyId);
      if ((error as { code?: string })?.code !== 'P2002') throw error;
      return this.reloadWinner(handoffId, current.id);
    }

    const issuedAt = new Date();
    const fields = {
      certificateNumber: reserved.documentNumber,
      formType: merged.formType,
      incomeCategoryCode: merged.incomeCategoryCode,
      incomeCategoryName: merged.incomeCategoryName,
      whtRate: merged.whtRate,
      grossAmount: merged.grossAmount,
      withheldAmount: merged.withheldAmount,
      paymentDate: merged.paymentDate,
      issuedAt: issuedAt.toISOString(),
    };
    const client = this.taxRepo.prisma.client as any;
    let pdf: Awaited<ReturnType<TaxArtifactRendererService['renderWhtCertificate']>>;
    let newRow: any;
    try {
      pdf = await this.renderer.renderWhtCertificate(fields, merged.payerSnapshot, merged.payeeSnapshot, signature);
      newRow = await client.$transaction(async (tx: any) => {
        if (row.sourcePaymentType === 'expense.record' && row.sourcePaymentId) {
          await lockExpenseCorrection(tx, ctx.companyId, row.sourcePaymentId);
          const source = await tx.expenseRecord.findFirst({ where: { companyId: ctx.companyId, id: row.sourcePaymentId }, select: { status: true } });
          if (source?.status !== 'CONFIRMED') throw new ConflictException({ code: 'expense_wht_source_changed', message: EXPENSE_CORRECTION_WORDS.certificateSourceChanged });
        }
        const active = await tx.whtCertificate.findUnique({ where: { id: current.id } });
        if (active?.status !== 'ISSUED') throw new ConflictException({ code: 'expense_wht_source_changed', message: EXPENSE_CORRECTION_WORDS.certificateSourceChanged });

        const newRow = await tx.whtCertificate.create({
          data: {
            companyId: ctx.companyId,
            certificateNumber: reserved.documentNumber,
            status: 'ISSUED',
            taxPeriodId: period.id,
            periodKey: period.periodKey,
            payeeSnapshotJson: merged.payeeSnapshot as any,
            payerSnapshotJson: merged.payerSnapshot as any,
            incomeCategoryCode: merged.incomeCategoryCode,
            incomeCategoryName: merged.incomeCategoryName,
            whtRate: merged.whtRate,
            grossAmount: merged.grossAmount,
            withheldAmount: merged.withheldAmount,
            paymentDate: new Date(merged.paymentDate),
            taxEventIdsJson: [],
            issuedAt,
            issuedByUserId: ctx.userId,
            supersedesCertificateId: current.id,
          },
        });
        await this.documentSequences.commitNumberInTransaction(tx, {
          id: reserved.id, companyId: ctx.companyId, ownerType: 'tax.wht_certificate', ownerId: newRow.id,
        });
        // Conditional on `supersededByCertificateId: null` — guards two concurrent corrections racing
        // on the SAME old certificate. The loser's whole transaction rolls back (no orphaned second
        // "corrected" certificate left dangling with a committed number nobody points to).
        const voided = await tx.whtCertificate.updateMany({
          where: { id: current.id, companyId: ctx.companyId, status: 'ISSUED', supersededByCertificateId: null },
          data: {
            status: 'VOIDED', voidedAt: issuedAt, voidedByUserId: ctx.userId,
            voidReason: 'SUPERSEDED_BY_CORRECTION', supersededByCertificateId: newRow.id, correctionReason: reason,
          },
        });
        if (voided.count === 0) {
          throw new ConflictException({ code: 'wht_certificate_already_superseded', message: 'หนังสือรับรองนี้ถูกแทนที่ไปแล้ว กรุณาโหลดข้อมูลใหม่' });
        }
        await appendWhtCertificateHistory(tx, row, {
          eventType: 'CORRECTED', actorUserId: ctx.userId, isExternal: false,
          certificateId: current.id, certificateNumber: current.certificateNumber,
          certificateDate: current.issuedAt, relatedCertificateId: newRow.id,
          relatedCertificateNumber: newRow.certificateNumber, reason,
        });
        await appendWhtCertificateHistory(tx, row, {
          eventType: 'ISSUED', actorUserId: ctx.userId, isExternal: false,
          certificateId: newRow.id, certificateNumber: newRow.certificateNumber,
          certificateDate: newRow.issuedAt, relatedCertificateId: current.id,
          relatedCertificateNumber: current.certificateNumber,
        });
        // Conditional on the OLD certificateId, not on handoff status — status stays SYSTEM_ISSUED.
        const handoffUpdated = await tx.whtCertificateHandoff.updateMany({
          where: { id: row.id, certificateId: current.id },
          data: { certificateId: newRow.id },
        });
        if (handoffUpdated.count !== 1) throw new ConflictException({ code: 'wht_certificate_already_superseded', message: 'หนังสือรับรองนี้ถูกแทนที่ไปแล้ว กรุณาโหลดข้อมูลใหม่' });
        return newRow;
      });
    } catch (error) {
      try {
        await this.documentSequences.cancelReservation({ id: reserved.id, companyId: ctx.companyId });
        await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'document.number.cancel',
          targetType: 'document_number', targetId: reserved.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW' });
      } catch (cleanupError) {
        Logger.warn({ msg: 'wht_certificate.correction.reservation_cleanup_failed', companyId: ctx.companyId,
          reservationId: reserved.id, error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError) }, 'CorrectWhtCertificate');
      }
      throwIfWhtCertificateNumberCollision(error, ctx.companyId);
      throw error;
    }

    await this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'document.number.commit',
      targetType: 'document_number', targetId: reserved.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW',
    });
    await this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      // A distinct action key from `tax.wht_certificate.issue` — a different action worth filtering
      // separately in the audit trail (plan §2.2 step 12).
      action: 'tax.wht_certificate.correct',
      targetType: 'wht_certificate',
      targetId: newRow.id,
      requestId: ctx.requestId,
      result: 'SUCCESS',
      riskLevel: 'HIGH',
      metadataJson: { originalCertificateId: current.id, newCertificateId: newRow.id, reason, financial: isFinancial },
    });

    return { ...this.toDto(newRow), pdfArtifact: pdf };
  }

  /** The loser of the reserve-level P2002 race reloads the winner's result (mirrors the sibling). */
  private async reloadWinner(handoffId: string, previousCertificateId: string) {
    const winner = await this.table.findUnique({ where: { id: handoffId } });
    if (winner?.certificateId && winner.certificateId !== previousCertificateId) {
      const cert = await this.taxRepo.prisma.client.whtCertificate.findUnique({ where: { id: winner.certificateId } });
      if (cert) {
        const formType = await this.inferFormType(cert);
        const pdf = await this.renderer.renderWhtCertificate({
          certificateNumber: cert.certificateNumber,
          formType,
          incomeCategoryCode: cert.incomeCategoryCode,
          incomeCategoryName: cert.incomeCategoryName,
          whtRate: String(cert.whtRate),
          grossAmount: String(cert.grossAmount),
          withheldAmount: String(cert.withheldAmount),
          paymentDate: cert.paymentDate.toISOString(),
          issuedAt: cert.issuedAt?.toISOString() ?? new Date().toISOString(),
        }, cert.payerSnapshotJson as any, cert.payeeSnapshotJson as any, await this.resolveSignature(winner.companyId));
        return { ...this.toDto(cert), pdfArtifact: pdf };
      }
    }
    throw new ConflictException({ code: 'wht_certificate_issue_in_progress', message: 'กำลังแก้ไขหนังสือรับรองนี้อยู่ กรุณาลองใหม่อีกครั้ง' });
  }

  private async inferFormType(cert: { taxPeriodId: string; companyId: string }): Promise<WhtFormType> {
    const period = await this.taxRepo.findPeriodById(cert.companyId, cert.taxPeriodId);
    return period?.formType === 'PND3' ? 'PND3' : 'PND53';
  }

  /** Same shape as `IssueWhtCertificateFromHandoffUseCase.toDto()` (plan §2.2 step 13: reuse whole). */
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
