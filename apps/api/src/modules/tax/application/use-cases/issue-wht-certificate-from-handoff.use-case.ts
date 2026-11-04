import { createHash } from 'node:crypto';
import { assertPaymentNotCertified, certificatePayment, paymentHandoff } from '../services/wht-certificate-payment';
import { whtCertificateUnsupportedReason } from '@watchdog-bms/contracts';
import { currentWhtPayerDetails } from '../services/wht-payer-identity';
import { whtPayerIdentity, whtPayerIdentityMissingMessage } from '@watchdog-bms/contracts';
import { whtHandoffMissing } from '../../domain/logic/wht-handoff-missing.logic';
import { loadScopedWhtHandoff } from '../services/wht-handoff-read-scope';
import { throwIfWhtCertificateNumberCollision } from '../services/wht-certificate-number-error';
import { lockExpenseCorrection } from '../../../expenses/infrastructure/expense-void-blocker';
import { whtPayeeAddress, WHT_HANDOFF_PAYEE_ADDRESS_MISSING_MESSAGE, EXPENSE_CORRECTION_WORDS, expenseCorrectionBlockerMessage } from '@watchdog-bms/contracts';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { RequestContext, WhtHandoffPrefillDto } from '@watchdog-bms/contracts';
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
import { isLaunchRouteOpen } from './wht-certificate-handoff.use-case';
import { appendWhtCertificateHistory } from '../services/wht-certificate-history';

const HANDOFF_CHANGED_MESSAGE = 'สถานะของงานนี้เปลี่ยนไปแล้วระหว่างออกเอกสาร เปิดหน้านี้ใหม่เพื่อตรวจสถานะ';

/**
 * Mints a 50 ทวิ directly from an existing `WhtCertificateHandoff` — the AP/Expenses "ออกเอกสารใน
 * ระบบ" button (plan §2.2). Unlike `CreateWhtCertificateUseCase`, this never needs a pre-existing
 * `TaxPeriod`/`TaxEventIds` from a separate `POST tax/sync`: both AP and Expenses already recorded
 * every fact the certificate needs on the handoff at settlement/confirm time (Phase 1), so this
 * mints straight off that row (finding 8a).
 */
@Injectable()
export class IssueWhtCertificateFromHandoffUseCase {
  constructor(
    private readonly taxRepo: PrismaTaxRepository,
    private readonly reserveNumber: ReserveDocumentNumberUseCase,
    // Repository, not `CommitDocumentNumberUseCase`: the commit must land in the SAME transaction
    // as the certificate row create and the handoff status transition (step 8), and the use case's
    // `.execute()` opens its own nested `$transaction`, which would not share this one. Mirrors the
    // existing `expenseNumberInTransaction` pattern (prisma-expense.repository.ts) for the identical
    // reserve-then-atomic-commit problem. `ReserveDocumentNumberUseCase` above still owns the
    // `document.number.reserve` audit entry; the matching `document.number.commit` entry is
    // reproduced by hand below so the audit trail is unchanged either way.
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

  private async isSystemIssuanceOpen(): Promise<boolean> {
    return isLaunchRouteOpen(this.launchGate, 'cap.wht50bis', 'SYSTEM_INITIAL_ISSUE');
  }

  /**
   * §3.4: `CompanyTaxProfile.signatureMode` decides whether the PDF's signature block is stamped.
   * `BLANK`/no profile at all/no attachment/attachment gone inactive all fall through to
   * `undefined` (BLANK) — never a broken placeholder, exactly today's behaviour for a company that
   * never opted in.
   */
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

  async previewLineAction(ctx: RequestContext, handoffId: string, address?: string, paymentId?: string) {
    const row = await loadScopedWhtHandoff(this.taxRepo.prisma.client, ctx, handoffId);
    // Mutually exclusive with `linkExternal` (spec §4.1): the operator picks one path. Checked here
    // for a fast, clear answer; the transaction's own conditional `updateMany` below is the actual
    // race fence against a concurrent `linkExternal` or a second identical mint.
    if (row.status !== 'REQUIRED') {
      throw new ConflictException({ code: 'wht_handoff_not_issuable', message: 'รายการนี้ไม่อยู่ในสถานะที่ออกเอกสารในระบบได้ เปิดหน้านี้ใหม่เพื่อตรวจสถานะ', status: row.status });
    }
    // Defense-in-depth: permission + entitlement already gate the route/UI, but route-readiness is
    // a separate axis (spec §8) and must be re-checked here exactly like `CreateWhtCertificateUseCase`.
    if (!(await this.isSystemIssuanceOpen())) {
      throw new ConflictException({ code: 'wht_system_issuance_unavailable', message: 'ระบบยังไม่เปิดการออกหนังสือรับรองในระบบ' });
    }

    const prefill = await certificatePayment(this.taxRepo.prisma.client, ctx.companyId, row, paymentId);
    const unsupported = whtCertificateUnsupportedReason(prefill.incomeCategoryCode, prefill.formType);
    if (unsupported || prefill.formType === 'PND2') throw new ConflictException({ code: 'wht_certificate_income_unsupported', message: unsupported });
    // AP's `createWhtHandoffForPayment` leaves `formType` null when the payee's taxpayer class maps
    // to neither ภ.ง.ด.3 nor ภ.ง.ด.53 (e.g. FOREIGN) — a real, if rare, state a REQUIRED handoff can
    // be in. `TaxPeriod`/`WhtCertificate` both require a resolved form, so this must refuse cleanly
    // rather than guess or hit the NOT NULL constraint raw.
    const missing = whtHandoffMissing(prefill);
    if (missing.includes('FORM_TYPE_UNRESOLVED') || !prefill.formType) {
      throw new ConflictException({ code: 'wht_handoff_form_type_unresolved', message: 'ระบุแบบ ภ.ง.ด. ไม่ได้ ตรวจประเภทผู้รับเงินก่อนออกหนังสือรับรอง 50 ทวิ' });
    }
    if (missing.includes('INCOME_CATEGORY_OR_RATE_MISSING') || !prefill.incomeCategoryCode || !prefill.incomeCategoryName || !prefill.whtRate) {
      throw new ConflictException({ code: 'wht_handoff_income_category_missing', message: 'รายการนี้ยังไม่มีประเภทเงินได้หรืออัตราหัก ณ ที่จ่าย กรอกให้ครบก่อนออกหนังสือรับรอง 50 ทวิ' });
    }

    const payer = whtPayerIdentity(prefill.payerSnapshot, await currentWhtPayerDetails(this.taxRepo.prisma.client, ctx.companyId));
    if (payer.missing.length) throw new ConflictException({ code: 'wht_payer_identity_missing', message: whtPayerIdentityMissingMessage(payer.missing), payerMissing: payer.missing });

    const payeeAddress = whtPayeeAddress(address ?? row.payeeAddress, prefill.payeeSnapshot.address);
    if (!payeeAddress) throw new ConflictException({
      code: 'wht_handoff_payee_address_missing', message: WHT_HANDOFF_PAYEE_ADDRESS_MISSING_MESSAGE,
    });

    return { row, prefill: { ...prefill, formType: prefill.formType, incomeCategoryCode: prefill.incomeCategoryCode, incomeCategoryName: prefill.incomeCategoryName, whtRate: prefill.whtRate }, payer, payeeAddress };
  }

  async execute(ctx: RequestContext, handoffId: string, paymentId?: string, expectedUpdatedAt?: string) {
    const initial = await loadScopedWhtHandoff(this.taxRepo.prisma.client, ctx, handoffId);
    if (expectedUpdatedAt && initial.updatedAt.toISOString() !== expectedUpdatedAt) throw new ConflictException({ code: 'wht_handoff_changed', message: HANDOFF_CHANGED_MESSAGE });
    const selected = await paymentHandoff(this.taxRepo.prisma.client, ctx.companyId, initial, paymentId);
    handoffId = selected.id;
    const { row, prefill, payer, payeeAddress } = await this.previewLineAction(ctx, handoffId, undefined, paymentId);
    if (expectedUpdatedAt && row.updatedAt.toISOString() !== expectedUpdatedAt) throw new ConflictException({ code: 'wht_handoff_changed', message: HANDOFF_CHANGED_MESSAGE });

    // Finding 8a's concrete answer: find-or-create the period the same way every sync-tax-events
    // loop already does, instead of requiring a prior `POST tax/sync`.
    const periodKey = formPeriodKey(prefill.formType, new Date(prefill.paymentDate));
    const period = await this.taxRepo.upsertPeriod({ companyId: ctx.companyId, taxType: 'WHT', formType: prefill.formType, periodKey });

    const signature = await this.resolveSignature(ctx.companyId);
    const idempotencyKey = `wht_certificate_from_handoff:${row.id}${row.certificateRound > 0 ? `:r${row.certificateRound}` : ''}`;
    let reserved: Awaited<ReturnType<ReserveDocumentNumberUseCase['execute']>>;
    try {
      reserved = await this.reserveNumber.execute({
        companyId: ctx.companyId, documentType: 'tax.wht_certificate', periodKey: period.periodKey,
        idempotencyKey, reservedByUserId: ctx.userId,
      });
    } catch (error) {
      throwIfWhtCertificateNumberCollision(error, ctx.companyId);
      // A concurrent identical request won the reservation race (F5-style recovery — H4's
      // `WhtCertificateHandoffUseCase.createOrReplay`). The winner reserves, mints and updates the
      // handoff as one unit below, so reloading the handoff's `certificateId` returns its result.
      if ((error as { code?: string })?.code !== 'P2002') throw error;
      return this.reloadWinner(handoffId);
    }

    // Contract (`WhtCertificateHandoffDto.payeeAddress`): the operator-typed address wins over the
    // frozen prefill's. Merged into the certificate's own snapshot only — the handoff's
    // `prefillSnapshotJson`/`prefillSnapshotHash` stay untouched.
    const payee = { ...prefill.payeeSnapshot, address: payeeAddress };
    const issuedAt = new Date();
    const fields = {
      certificateNumber: reserved.documentNumber,
      formType: prefill.formType,
      incomeCategoryCode: prefill.incomeCategoryCode,
      incomeCategoryName: prefill.incomeCategoryName,
      whtRate: prefill.whtRate,
      grossAmount: prefill.grossAmount,
      withheldAmount: prefill.withheldAmount,
      paymentDate: prefill.paymentDate,
      issuedAt: issuedAt.toISOString(),
    };
    const pdf = await this.renderer.renderWhtCertificate(fields, payer.payer, payee, signature);

    const client = this.taxRepo.prisma.client as any;
    const { certificateRow } = await client.$transaction(async (tx: any) => {
      if (row.sourcePaymentType === 'expense.record' && row.sourcePaymentId) {
        await lockExpenseCorrection(tx, ctx.companyId, row.sourcePaymentId);
        const expense = await tx.expenseRecord.findFirst({ where: { companyId: ctx.companyId, id: row.sourcePaymentId }, select: { status: true } });
        if (expense?.status !== 'CONFIRMED') throw new ConflictException({ code: 'expense_wht_source_changed', message: expenseCorrectionBlockerMessage('not_confirmed') });
      }
      await assertPaymentNotCertified(tx, ctx.companyId, row, prefill);
      const currentPayment = await certificatePayment(tx, ctx.companyId, row, prefill.expensePaymentId);
      if (JSON.stringify(currentPayment) !== JSON.stringify(prefill)) throw new ConflictException({ code: 'expense_wht_source_changed', message: expenseCorrectionBlockerMessage('not_confirmed') });
      await tx.$executeRaw`SELECT id FROM "WhtCertificateHandoff" WHERE id = ${row.id} AND "companyId" = ${ctx.companyId} FOR UPDATE`;
      const current = await tx.whtCertificateHandoff.findUnique({ where: { id: row.id } });
      if (expectedUpdatedAt && current?.updatedAt.toISOString() !== expectedUpdatedAt || current?.status !== 'REQUIRED' || current.prefillSnapshotHash !== row.prefillSnapshotHash || (current.certificateRound ?? 0) !== (row.certificateRound ?? 0)) {
        throw new ConflictException({ code: 'wht_handoff_not_issuable', message: HANDOFF_CHANGED_MESSAGE });
      }
      const cancellations = await tx.whtCertificateHistory.findMany({
        where: { companyId: ctx.companyId, handoffId: row.id, eventType: 'CANCELLED_SOURCE_REOPENED', certificateId: { not: null } },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], select: { certificateId: true },
      });
      const unreplaced = cancellations.length ? await tx.whtCertificate.findMany({
        where: { companyId: ctx.companyId, id: { in: cancellations.map((event: any) => event.certificateId) },
          status: 'VOIDED', voidReason: 'SOURCE_REOPENED', supersededByCertificateId: null },
        select: { id: true, certificateNumber: true },
      }) : [];
      const predecessor = cancellations.map((event: any) => unreplaced.find((cert: any) => cert.id === event.certificateId)).find(Boolean);
      const certificateRow = await tx.whtCertificate.create({
        data: {
          companyId: ctx.companyId,
          certificateNumber: reserved.documentNumber,
          status: 'ISSUED',
          taxPeriodId: period.id,
          periodKey: period.periodKey,
          payeeSnapshotJson: payee as any,
          payerSnapshotJson: payer.payer as any,
          incomeCategoryCode: prefill.incomeCategoryCode,
          incomeCategoryName: prefill.incomeCategoryName,
          whtRate: prefill.whtRate,
          grossAmount: prefill.grossAmount,
          withheldAmount: prefill.withheldAmount,
          paymentDate: new Date(prefill.paymentDate),
          // No discrete TaxEvent rows back this certificate — it is minted directly from
          // settlement/expense facts, not from synced tax events (spec §5's amended note).
          taxEventIdsJson: [],
          issuedAt,
          issuedByUserId: ctx.userId,
          supersedesCertificateId: predecessor?.id ?? null,
        },
      });
      if (predecessor) {
        const linked = await tx.whtCertificate.updateMany({
          where: { companyId: ctx.companyId, id: predecessor.id, status: 'VOIDED', voidReason: 'SOURCE_REOPENED', supersededByCertificateId: null },
          data: { supersededByCertificateId: certificateRow.id },
        });
        if (linked.count !== 1) throw new ConflictException({ code: 'wht_handoff_not_issuable', message: HANDOFF_CHANGED_MESSAGE });
      }
      await this.documentSequences.commitNumberInTransaction(tx, {
        id: reserved.id, companyId: ctx.companyId, ownerType: 'tax.wht_certificate', ownerId: certificateRow.id,
      });
      // Conditional, not a plain `update` — races with `linkExternal` (same `REQUIRED` guard, same
      // shape) so exactly one of the two ever wins a given handoff.
      const handoffUpdated = await tx.whtCertificateHandoff.updateMany({
        where: { id: row.id, companyId: ctx.companyId, status: 'REQUIRED' },
        data: { status: 'SYSTEM_ISSUED', certificateId: certificateRow.id, ...(prefill.expensePaymentId ? { prefillSnapshotJson: prefill, prefillSnapshotHash: createHash('sha256').update(JSON.stringify(prefill)).digest('hex') } : {}) },
      });
      if (handoffUpdated.count !== 1) throw new ConflictException({ code: 'wht_handoff_not_issuable', message: HANDOFF_CHANGED_MESSAGE });
      await appendWhtCertificateHistory(tx, row, {
        eventType: 'ISSUED', actorUserId: ctx.userId, isExternal: false,
        certificateId: certificateRow.id, certificateNumber: certificateRow.certificateNumber,
        certificateDate: certificateRow.issuedAt,
        ...(predecessor ? { relatedCertificateId: predecessor.id, relatedCertificateNumber: predecessor.certificateNumber } : {}),
      });
      return { certificateRow, handoffUpdated };
    }).catch((error: unknown) => {
      throwIfWhtCertificateNumberCollision(error, ctx.companyId);
      throw error;
    });

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'document.number.commit',
      targetType: 'document_number', targetId: reserved.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW',
    });
    await this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      // Reuses the exact action key `CreateWhtCertificateUseCase` already uses (spec §7) — only
      // `source` in the metadata says which entry point minted it.
      action: 'tax.wht_certificate.issue',
      targetType: 'wht_certificate',
      targetId: certificateRow.id,
      requestId: ctx.requestId,
      result: 'SUCCESS',
      riskLevel: 'HIGH',
      metadataJson: {
        source: 'handoff', handoffId: row.id, periodKey: period.periodKey,
        certificateNumber: certificateRow.certificateNumber, pdfChecksum: pdf.checksum,
      },
    });

    return { ...this.toDto(certificateRow), pdfArtifact: pdf };
  }

  /**
   * The loser of the reserve-level P2002 race gets the SAME response shape as the winner would
   * have (DTO + `pdfArtifact`) — re-rendering costs one extra PDF build on this rare double-click
   * path, but a response without a `pdfArtifact` would leave the loser with no way to download the
   * certificate at all (nothing ever populates `pdfAttachmentId` — see `CreateWhtCertificateUseCase`).
   */
  async download(ctx: RequestContext, handoffId: string) {
    const handoff = await loadScopedWhtHandoff(this.taxRepo.prisma.client, ctx, handoffId);
    if (handoff.status !== 'SYSTEM_ISSUED') throw new ConflictException({ code: 'wht_certificate_download_unavailable', message: EXPENSE_CORRECTION_WORDS.certificateUnavailable });
    return this.reloadWinner(handoffId);
  }

  private async reloadWinner(handoffId: string) {
    const winner = await this.table.findUnique({ where: { id: handoffId } });
    if (winner?.certificateId) {
      const cert = await this.taxRepo.prisma.client.whtCertificate.findUnique({ where: { id: winner.certificateId } });
      if (cert && cert.companyId === winner.companyId) {
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
    throw new ConflictException({ code: 'wht_certificate_issue_in_progress', message: 'กำลังออกเอกสารนี้อยู่ ลองอีกครั้ง' });
  }

  /** The certificate row itself does not store `formType` (only its `TaxPeriod` does) — reload it
   *  rather than guess, so a re-rendered replay PDF checks the same box the original did. */
  private async inferFormType(cert: { taxPeriodId: string; companyId: string }): Promise<'PND3' | 'PND53'> {
    const period = await this.taxRepo.findPeriodById(cert.companyId, cert.taxPeriodId);
    return period?.formType === 'PND3' ? 'PND3' : 'PND53';
  }

  /** Same shape as `CreateWhtCertificateUseCase.toDto()` (spec §7: reuse the audit/DTO shape whole). */
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
