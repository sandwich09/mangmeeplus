import { loadScopedWhtHandoff } from '../services/wht-handoff-read-scope';
import { EXPENSE_CORRECTION_WORDS } from '@watchdog-bms/contracts';
import { lockExpenseCorrection } from '../../../expenses/infrastructure/expense-void-blocker';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PayeeSnapshot, PayerSnapshot, RequestContext, WhtFormType } from '@watchdog-bms/contracts';
import { AuditService } from '../../../audit/application/audit.service';
import { LaunchGateGuardService } from '../../../feature-launch/application/launch-gate.guard';
import { PrismaAttachmentRepository } from '../../../data-model-core/infrastructure/repositories/prisma-attachment.repository';
import { ATTACHMENT_STORAGE, type AttachmentStoragePort } from '../../../data-model-core/domain/ports/attachment-storage.port';
import { PrismaTaxRepository } from '../../infrastructure/repositories/prisma-tax.repository';
import { TaxArtifactRendererService } from '../services/tax-artifact-renderer.service';
import type { WhtCertificateSignature } from '../../domain/logic/wht-certificate-pdf.logic';
import { isSystemReplacementCopyOpen } from './wht-certificate-handoff.use-case';

/**
 * Issues an identical, same-numbered "ใบแทน" (replacement copy) of a SYSTEM-issued 50 ทวิ — the
 * AP/Expenses "ออกใบแทน" button (correction & replacement plan §3.1). Unlike correction, nothing
 * about the certificate's content or number changes. Its transaction checks the source before recording the copy.
 */
@Injectable()
export class IssueWhtReplacementCopyUseCase {
  constructor(
    private readonly taxRepo: PrismaTaxRepository,
    private readonly audit: AuditService,
    private readonly launchGate: LaunchGateGuardService,
    private readonly renderer: TaxArtifactRendererService,
    private readonly attachments: PrismaAttachmentRepository,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStoragePort,
  ) {}

  private async isReplacementOpen(): Promise<boolean> {
    return isSystemReplacementCopyOpen(this.launchGate);
  }

  /** Identical to `IssueWhtCertificateFromHandoffUseCase.resolveSignature`. */
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

  /**
   * §3.1 step 2: normally `handoff.certificateId` already points at the active certificate (a
   * correction keeps it current via its own conditional `updateMany`) — this walk is defense-in-depth
   * for a stale pointer, not the primary path.
   */
  private async resolveActiveCertificate(certificateId: string): Promise<any | null> {
    let cert = await this.taxRepo.prisma.client.whtCertificate.findUnique({ where: { id: certificateId } });
    const seen = new Set<string>();
    while (cert?.status === 'VOIDED' && cert.supersededByCertificateId && !seen.has(cert.id)) {
      seen.add(cert.id);
      cert = await this.taxRepo.prisma.client.whtCertificate.findUnique({ where: { id: cert.supersededByCertificateId } });
    }
    return cert ?? null;
  }

  async execute(ctx: RequestContext, handoffId: string) {
    const row = await loadScopedWhtHandoff(this.taxRepo.prisma.client, ctx, handoffId);
    // Same rejection reason/code as correction (plan §3.1 step 1): v1 only touches SYSTEM-issued
    // certificates, never EXTERNAL_LINKED.
    if (row.status !== 'SYSTEM_ISSUED' || !row.certificateId) {
      throw new ConflictException({ code: 'wht_certificate_not_correctable', message: 'ออกใบแทนไม่ได้ เพราะรายการนี้ไม่มีหนังสือรับรอง 50 ทวิที่ระบบออกให้และยังใช้งานอยู่ เปิดหน้านี้ใหม่เพื่อตรวจสถานะ', status: row.status });
    }

    const current = await this.resolveActiveCertificate(row.certificateId);
    if (!current || current.companyId !== ctx.companyId) throw new NotFoundException('WHT certificate not found.');
    if (!(await this.isReplacementOpen())) {
      throw new ConflictException({ code: 'wht_system_replacement_unavailable', message: 'ระบบยังไม่เปิดการออกใบแทนอัตโนมัติ' });
    }

    const formType = await this.inferFormType(current);
    const nowIso = new Date().toISOString();
    const fields = {
      certificateNumber: current.certificateNumber,
      formType,
      incomeCategoryCode: current.incomeCategoryCode,
      incomeCategoryName: current.incomeCategoryName,
      whtRate: String(current.whtRate),
      grossAmount: String(current.grossAmount),
      withheldAmount: String(current.withheldAmount),
      paymentDate: current.paymentDate.toISOString(),
      // The document's own printed issue date stays the ORIGINAL mint date — a replacement copy
      // changes no statutory content, only adds the "ใบแทน" label (plan §6.1/§9).
      issuedAt: current.issuedAt?.toISOString() ?? nowIso,
    };
    const signature = await this.resolveSignature(ctx.companyId);
    const pdf = await this.renderer.renderWhtCertificate(
      fields,
      current.payerSnapshotJson as PayerSnapshot,
      current.payeeSnapshotJson as PayeeSnapshot,
      signature,
      { issuedAt: nowIso },
    );

    const updated = await (this.taxRepo.prisma.client as any).$transaction(async (tx: any) => {
      if (row.sourcePaymentType === 'expense.record' && row.sourcePaymentId) {
        await lockExpenseCorrection(tx, ctx.companyId, row.sourcePaymentId);
        const source = await tx.expenseRecord.findFirst({ where: { companyId: ctx.companyId, id: row.sourcePaymentId }, select: { status: true } });
        if (source?.status !== 'CONFIRMED') throw new ConflictException({ code: 'expense_wht_source_changed', message: EXPENSE_CORRECTION_WORDS.certificateSourceChanged });
      }
      const active = await tx.whtCertificate.findUnique({ where: { id: current.id } });
      if (active?.status !== 'ISSUED') throw new ConflictException({ code: 'expense_wht_source_changed', message: EXPENSE_CORRECTION_WORDS.certificateSourceChanged });
      const changed = await tx.whtCertificate.updateMany({
        where: { companyId: ctx.companyId, id: current.id, status: 'ISSUED' },
        data: { replacementCopyCount: { increment: 1 }, lastReplacementCopyAt: new Date(), lastReplacementCopyByUserId: ctx.userId },
      });
      if (changed.count !== 1) throw new ConflictException({ code: 'expense_wht_source_changed', message: EXPENSE_CORRECTION_WORDS.certificateSourceChanged });
      return tx.whtCertificate.findUnique({ where: { id: current.id } });
    });

    await this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'tax.wht_certificate.replacement_copy',
      targetType: 'wht_certificate',
      targetId: current.id,
      requestId: ctx.requestId,
      result: 'SUCCESS',
      riskLevel: 'HIGH',
      metadataJson: { certificateId: current.id, copySeq: updated.replacementCopyCount },
    });

    return { ...this.toDto(updated), pdfArtifact: pdf };
  }

  private async inferFormType(cert: { taxPeriodId: string; companyId: string }): Promise<WhtFormType> {
    const period = await this.taxRepo.findPeriodById(cert.companyId, cert.taxPeriodId);
    return period?.formType === 'PND3' ? 'PND3' : 'PND53';
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
