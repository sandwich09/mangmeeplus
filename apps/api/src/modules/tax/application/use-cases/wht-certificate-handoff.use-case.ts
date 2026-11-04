import { CreateUploadIntentUseCase, type CreateUploadIntentCommand } from '../../../data-model-core/application/use-cases/create-upload-intent.use-case';
import { CompleteAttachmentUploadUseCase, type CompleteAttachmentUploadCommand } from '../../../data-model-core/application/use-cases/complete-attachment-upload.use-case';
import { externalWhtFiles, retainExternalWhtFile } from '../services/wht-external-file';
import { WHT_EXTERNAL_FILE } from '@watchdog-bms/contracts';
import { ATTACHMENT_STORAGE, type AttachmentStoragePort } from '../../../data-model-core/domain/ports/attachment-storage.port';
import { allocateExpenseWithholding } from '../../domain/logic/expense-payment-withholding.logic';
import { assertPaymentNotCertified, certificatePayment, paymentHandoff } from '../services/wht-certificate-payment';
import { filedWithholdingPaymentPeriods } from '../services/filed-withholding-payment';
import { whtCertificateUnsupportedReason } from '@watchdog-bms/contracts';
import { expenseSourceDescription } from '../../../expenses/domain/logic/expense-source-description';
import { currentWhtPayerDetails } from '../services/wht-payer-identity';
import { whtPayerIdentity } from '@watchdog-bms/contracts';
import { whtPayeeAddress } from '@watchdog-bms/contracts';
import { whtHandoffMissing } from '../../domain/logic/wht-handoff-missing.logic';
import { findReadableHandoffExpense, handoffBranchWhere, handoffReadBoundary, nonExpenseHandoffWhere, loadScopedWhtHandoff } from '../services/wht-handoff-read-scope';
import type { Prisma, WhtCertificate } from '../../../../generated/prisma/client';
import { lockExpenseCorrection, readExpensePeriodLocks } from '../../../expenses/infrastructure/expense-void-blocker';
import { expenseCorrectionBlockerMessage } from '@watchdog-bms/contracts';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type {
  LinkExternalWhtCertificateDto,
  ChangeExternalWhtCertificateDto,
  RemoveExternalWhtCertificateDto,
  PayeeSnapshot,
  RequestContext,
  SetWhtHandoffPayeeAddressDto,
  VendorCounterpartyAutoSaveResult,
  WhtCertificateHandoffDto,
  WhtCertificateHandoffPageDto, WhtCertificateHandoffListQuery,
  WhtHandoffStatus,
  WhtCertificateHistoryDto,
  WhtCertificateHistoryEventType,
  WhtHandoffPrefillDto,
} from '@watchdog-bms/contracts';
import { isExpenseVoidReason, WHT_HANDOFF_PAYEE_ADDRESS_MAX, WHT_EXTERNAL_RECORD_WORDS, todayCivilDate, withholdingPeriodLockedMessage } from '@watchdog-bms/contracts';
import { formPeriodKey } from '../../domain/logic/tax-period.logic';
import { AuditService } from '../../../audit/application/audit.service';
import { LaunchGateGuardService } from '../../../feature-launch/application/launch-gate.guard';
import { FEATURE_TEMPORARILY_UNAVAILABLE } from '../../../employee-access/application/entitlement.helper';
import { PrismaTaxRepository } from '../../infrastructure/repositories/prisma-tax.repository';
import { PrismaAccountingRepository } from '../../../accounting-documents/infrastructure/prisma-accounting.repository';
import {
  buildCounterpartyAddressV2,
  counterpartyAddressText,
  decideVendorAutoSave,
  vendorMatchKey,
} from '../../../accounting-documents/domain/logic/vendor-counterparty-match.logic';
import { normalizeWhtLinkEvidence } from '../../domain/logic/wht-link-evidence.logic';
import type { WhtLinkEvidenceInput } from '../../domain/logic/wht-link-evidence.logic';
import { isBranchInScope } from '../../../data-model-core/domain/logic/branch.logic';
import { appendWhtCertificateHistory } from '../services/wht-certificate-history';

/**
 * Resolves a launch route into a plain boolean. Only the control-plane refusal becomes `false`:
 * any other failure (a database error inside the guard) propagates, because "the route is closed"
 * and "we could not tell" are not the same answer — and neither a handoff nor a certificate may be
 * created on the strength of an error we did not understand.
 */
export async function isLaunchRouteOpen(guard: LaunchGateGuardService, gateKey: string, routeKey: string): Promise<boolean> {
  try {
    await guard.assertLaunchRouteOpen(gateKey, routeKey);
    return true;
  } catch (error) {
    const body = (error as { getResponse?: () => unknown })?.getResponse?.() as { code?: string } | undefined;
    if (body?.code !== FEATURE_TEMPORARILY_UNAVAILABLE) throw error;
    return false;
  }
}

/** Correction & replacement plan §2.4/§8.1 — defensive re-check, same shape as `isSystemIssuanceOpen`. */
export async function isSystemContentCorrectionOpen(guard: LaunchGateGuardService): Promise<boolean> {
  return isLaunchRouteOpen(guard, 'cap.wht50bis', 'SYSTEM_CONTENT_CORRECTION');
}

export async function isSystemReplacementCopyOpen(guard: LaunchGateGuardService): Promise<boolean> {
  return isLaunchRouteOpen(guard, 'cap.wht50bis', 'SYSTEM_REPLACEMENT_COPY');
}

/**
 * The durable EXTERNAL_CERTIFICATE_REQUIRED artifact.
 *
 * While `cap.wht50bis/SYSTEM_INITIAL_ISSUE` is CLOSED the system issues no 50 ทวิ. The payer still
 * withheld the tax and still owes the payee a certificate, so instead of refusing we persist what
 * the system already knows and let the operator have the certificate issued externally and link it
 * back. This never writes certificate state — CC5 owns `WhtCertificate`.
 *
 * Spec: feature-entitlement-decoupling-spec.md:205, tax-thailand-2026-spec.md:1324-1343.
 */
@Injectable()
export class WhtCertificateHandoffUseCase {
  constructor(
    private readonly taxRepo: PrismaTaxRepository,
    private readonly audit: AuditService,
    private readonly launchGate: LaunchGateGuardService,
    // §10's registry write-back. The accounting module imports THIS module, so it cannot be
    // imported back without a Nest cycle; the repository is stateless over the global PrismaService
    // and is listed in this module's own providers, the same way the tax source adapters already
    // read other modules' tables directly.
    private readonly counterparties: PrismaAccountingRepository,
    @Inject(ATTACHMENT_STORAGE) private readonly storage?: AttachmentStoragePort,
    private readonly uploadIntent?: CreateUploadIntentUseCase,
    private readonly completeUpload?: CompleteAttachmentUploadUseCase,
  ) {}

  private get table() {
    return (this.taxRepo.prisma.client as any).whtCertificateHandoff;
  }

  /**
   * Whether the system may issue the initial SYSTEM 50 ทวิ itself. Source features ask this to
   * decide between "the system will issue it" and "hand it off", and must never block settlement
   * on the answer (spec:299).
   */
  async isSystemIssuanceOpen(): Promise<boolean> {
    return isLaunchRouteOpen(this.launchGate, 'cap.wht50bis', 'SYSTEM_INITIAL_ISSUE');
  }

  /** Correction & replacement plan §2.4: computed alongside `isSystemIssuanceOpen` for `list`/`get`. */
  private async isSystemCorrectionOpen(): Promise<boolean> {
    return isSystemContentCorrectionOpen(this.launchGate);
  }

  private async isSystemReplacementOpen(): Promise<boolean> {
    return isSystemReplacementCopyOpen(this.launchGate);
  }

  /**
   * Idempotent by `(companyId, creationCommandId)`.
   *
   * Lookup precedes insert so the common replay costs one query and, critically, so no P2002 is
   * ever raised inside a caller's transaction (that aborts it with 25P02). But lookup-then-insert
   * is only SEQUENTIALLY idempotent: two concurrent identical requests both miss the lookup and one
   * loses the unique. Outside a transaction the sanctioned recovery is to catch that and reload the
   * winner, so the loser still gets the typed handoff answer rather than a raw driver error.
   *
   * The recovery is deliberately NOT attempted when running inside a caller's transaction (`tx`):
   * there the constraint violation has already poisoned it and reloading would fail too. The
   * settlement path passes no `tx` for this reason — it uses its own in-transaction helper.
   */
  async createOrReplay(input: {
    companyId: string;
    creationCommandId: string;
    sourceFeatureKey: string;
    prefill: WhtHandoffPrefillDto;
    availabilityVector: Record<string, unknown>;
    sourcePaymentType?: string | null;
    sourcePaymentId?: string | null;
    payeeId?: string | null;
    branchCode?: string | null;
    sourceBranchId?: string | null;
    taxPeriodId?: string | null;
    taxEventIds?: string[];
    tx?: any;
  }): Promise<{ id: string; status: string; replayed: boolean }> {
    const table = input.tx ? input.tx.whtCertificateHandoff : this.table;
    const where = { companyId_creationCommandId: { companyId: input.companyId, creationCommandId: input.creationCommandId } };
    const existing = await table.findUnique({ where });
    if (existing) return { id: existing.id, status: existing.status, replayed: true };

    const payloadFingerprint = fingerprint(input.prefill);
    try {
      const row = await table.create({
        data: {
          // Flat scalar on purpose: routing companyId through a nested relation create is the
          // Prisma-7 compound-FK trap that tsc and mocked tests are both blind to.
          companyId: input.companyId,
          status: 'REQUIRED',
          sourcePaymentType: input.sourcePaymentType ?? null,
          sourcePaymentId: input.sourcePaymentId ?? null,
          payeeId: input.payeeId ?? null,
          branchCode: input.branchCode ?? null,
          sourceBranchId: input.sourceBranchId ?? null,
          sourceFeatureKey: input.sourceFeatureKey,
          taxPeriodId: input.taxPeriodId ?? null,
          taxEventIdsJson: (input.taxEventIds ?? []) as any,
          prefillSnapshotJson: input.prefill as any,
          prefillSnapshotHash: payloadFingerprint,
          availabilityVectorJson: input.availabilityVector as any,
          creationCommandId: input.creationCommandId,
          payloadFingerprint,
        },
      });
      return { id: row.id, status: row.status, replayed: false };
    } catch (error) {
      // Concurrent identical request won the unique. Only safe outside a caller's transaction.
      if (input.tx || (error as { code?: string })?.code !== 'P2002') throw error;
      const winner = await table.findUnique({ where });
      if (!winner) throw error;
      return { id: winner.id, status: winner.status, replayed: true };
    }
  }

  /** Existing expense and AP callers retain their array response and 200-row limit. */
  async list(ctx: RequestContext, filters: { status?: string; branchId?: string; sourcePaymentId?: string; periodKey?: string; formType?: string } = {}): Promise<WhtCertificateHandoffDto[]> {
    const where = this.listWhere(ctx, filters);
    const boundary = await handoffReadBoundary(this.taxRepo.prisma.client, ctx, where);
    const rows = await this.table.findMany({ where: boundary.where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 200 });
    const [systemIssuanceOpen, systemCorrectionOpen, systemReplacementOpen] = await this.routeFlags();
    const certificates = await this.loadCertificates(ctx.companyId, rows);
    const readHistory = await this.loadReadHistory(ctx.companyId, rows);
    const payer = await currentWhtPayerDetails(this.taxRepo.prisma.client, ctx.companyId);
    return rows.map((row: any) => ({ ...toDto(row, systemIssuanceOpen, systemCorrectionOpen, systemReplacementOpen, certificates.get(row.certificateId), ctx, payer),
      externalAttachmentId: row.status === 'EXTERNAL_LINKED' ? readHistory.files.get(row.id) ?? null : null,
      payeeAddressClearedByTaxIdChange: !row.payeeAddress?.trim() && readHistory.cleared.has(row.id),
      ...(readHistory.previous.get(row.sourcePaymentId) && row.status === 'REQUIRED' && !row.certificateId && !row.externalCertificateNumber ? { previousCertificate: readHistory.previous.get(row.sourcePaymentId) } : {}) }));
  }

  private listWhere(ctx: RequestContext, filters: { status?: string; branchId?: string; sourcePaymentId?: string; periodKey?: string; formType?: string }): Prisma.WhtCertificateHandoffWhereInput {
    if (filters.periodKey && !/^\d{4}-(0[1-9]|1[0-2])$/.test(filters.periodKey)) throw new BadRequestException('เดือนภาษีไม่ถูกต้อง เลือกเดือนอีกครั้ง');
    if (filters.formType && !['PND2', 'PND3', 'PND53'].includes(filters.formType)) throw new BadRequestException('ไม่พบแบบภาษีที่เลือก เลือก ภ.ง.ด.2 ภ.ง.ด.3 หรือ ภ.ง.ด.53');
    return {
      AND: [handoffBranchWhere(ctx),
        ...(filters.periodKey ? [{ prefillSnapshotJson: { path: ['paymentDate'], string_starts_with: `${filters.periodKey}-` } }] : []),
        ...(filters.formType ? [{ prefillSnapshotJson: { path: ['formType'], equals: filters.formType } }] : []),
      ],
      ...(filters.status ? { status: filters.status as WhtHandoffStatus } : {}),
      ...(filters.branchId ? { sourceBranchId: filters.branchId } : {}),
      ...(filters.sourcePaymentId ? { sourcePaymentId: filters.sourcePaymentId } : {}),
    };
  }

  private routeFlags() {
    return Promise.all([this.isSystemIssuanceOpen(), this.isSystemCorrectionOpen(), this.isSystemReplacementOpen()]);
  }

  async listPaged(ctx: RequestContext, filters: WhtCertificateHandoffListQuery = {}): Promise<WhtCertificateHandoffPageDto> {
    const statuses: WhtHandoffStatus[] = ['REQUIRED', 'SYSTEM_ISSUED', 'EXTERNAL_LINKED', 'CANCELLED'];
    if (filters.status && !statuses.includes(filters.status as WhtHandoffStatus)) {
      throw new BadRequestException('ไม่พบสถานะที่เลือก เลือกตัวกรองรายการอีกครั้ง');
    }
    const page = Number.isFinite(filters.page) ? Math.max(1, Math.floor(filters.page!)) : 1;
    const pageSize = Number.isFinite(filters.pageSize) ? Math.min(100, Math.max(1, Math.floor(filters.pageSize!))) : 20;
    const search = filters.search?.trim();
    const [systemIssuanceOpen, systemCorrectionOpen, systemReplacementOpen] = await this.routeFlags();
    // Counts, source states and rows share a snapshot, including while an expense is reopened.
    return this.taxRepo.prisma.client.$transaction(async (db) => {
      const payer = await currentWhtPayerDetails(db, ctx.companyId);
      const boundary = await handoffReadBoundary(db, ctx, this.listWhere(ctx, { ...filters, status: undefined, periodKey: undefined, formType: undefined }));
      // Delivery A clears cancelled pointers; the append-only history retains the paper's identity.
      const scoped = await db.whtCertificateHandoff.findMany({
        where: boundary.where, select: { id: true, status: true, sourcePaymentType: true, sourcePaymentId: true, prefillSnapshotJson: true },
      });
      const expenseIds = [...boundary.expenses.keys()];
      const history = scoped.length || expenseIds.length ? await db.whtCertificateHistory.findMany({
        where: { companyId: ctx.companyId, OR: [{ handoffId: { in: scoped.map(row => row.id) } }, { expenseId: { in: expenseIds } }] },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        select: { handoffId: true, expenseId: true, certificateNumber: true, relatedCertificateNumber: true, certificateDate: true, isExternal: true, occurredAt: true, eventType: true, reason: true, detailsJson: true },
      }) : [];
      const cancellations = new Map<string, (typeof history)[number]>();
      for (const event of history) if (CANCELLATION_EVENTS.includes(event.eventType) && !(event.detailsJson as Record<string, unknown> | null)?.removedManually && !cancellations.has(event.handoffId)) cancellations.set(event.handoffId, event);
      const previous = previousCertificates(history);
      const cleared = clearedAddressHandoffs(history);
      const files = externalWhtFiles(history);
      const historicalMatches = new Map<string, string[]>();
      if (search) for (const event of history) {
        const details = event.detailsJson as { previousRecord?: { number?: string } } | null;
        const numbers = [event.certificateNumber, event.relatedCertificateNumber, details?.previousRecord?.number]
          .filter((number): number is string => typeof number === 'string' && number.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
        if (numbers.length) historicalMatches.set(event.handoffId, [...(historicalMatches.get(event.handoffId) ?? []), ...numbers]);
      }
      const confirmed = [...boundary.expenses.values()].filter(expense => expense.status === 'CONFIRMED').map(expense => expense.id);
      const confirmedIds = new Set(confirmed);
      const months = [...new Set(scoped.flatMap(row => {
        if (row.status === 'REQUIRED' && row.sourcePaymentType === 'expense.record' && !confirmedIds.has(row.sourcePaymentId ?? '')) return [];
        const date = (row.prefillSnapshotJson as { paymentDate?: string } | null)?.paymentDate;
        return typeof date === 'string' && /^\d{4}-(0[1-9]|1[0-2])-/.test(date) ? [date.slice(0, 7)] : [];
      }))].sort().reverse();
      const paymentRows = await db.expensePayment?.findMany({ where: { companyId: ctx.companyId, expenseId: { in: expenseIds }, status: 'RECORDED' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }) ?? [];
      const certifiedPayments = new Set(scoped.filter(r => ['SYSTEM_ISSUED', 'EXTERNAL_LINKED'].includes(r.status)).flatMap(r => { const id = (r.prefillSnapshotJson as { expensePaymentId?: string } | null)?.expensePaymentId; return id ? [id] : []; }));
      const coveredDraftIds = scoped.filter(r => r.status === 'REQUIRED' && r.sourcePaymentType === 'expense.record' && paymentRows.some(p => p.expenseId === r.sourcePaymentId) && paymentRows.filter(p => p.expenseId === r.sourcePaymentId).every(p => certifiedPayments.has(p.id))).map(r => r.id);
      const conditions: Prisma.WhtCertificateHandoffWhereInput[] = [boundary.where, this.listWhere(ctx, { periodKey: filters.periodKey, formType: filters.formType }), {
        OR: [{ status: { not: 'REQUIRED' } }, nonExpenseHandoffWhere, { sourcePaymentId: { in: confirmed } }],
      }];
      if (coveredDraftIds.length) conditions.push({ id: { notIn: coveredDraftIds } });
      if (search) {
        const certificates = await db.whtCertificate.findMany({
          where: { companyId: ctx.companyId, OR: [
            { certificateNumber: { contains: search, mode: 'insensitive' } },
            { payeeSnapshotJson: { path: ['name'], string_contains: search, mode: 'insensitive' } },
            { payeeSnapshotJson: { path: ['taxId'], string_contains: search, mode: 'insensitive' } },
          ] }, select: { id: true },
        });
        conditions.push({ OR: [
          { prefillSnapshotJson: { path: ['payeeSnapshot', 'name'], string_contains: search, mode: 'insensitive' } },
          { prefillSnapshotJson: { path: ['payeeSnapshot', 'taxId'], string_contains: search, mode: 'insensitive' } },
          { externalCertificateNumber: { contains: search, mode: 'insensitive' } },
          { certificateId: { in: certificates.map(certificate => certificate.id) } },
          { id: { in: [...historicalMatches.keys()] } },
          { sourcePaymentType: 'expense.record', sourcePaymentId: { in: [...boundary.expenses.values()]
            .filter(expense => expense.expenseNumber?.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(expense => expense.id) } },
        ] });
      }
      const where: Prisma.WhtCertificateHandoffWhereInput = { AND: conditions };
      const values = await Promise.all(statuses.map(status => db.whtCertificateHandoff.count({ where: { AND: [where, { status }] } })));
      const counts = Object.fromEntries(statuses.map((status, index) => [status, values[index]])) as Record<WhtHandoffStatus, number>;
      const total = filters.status ? counts[filters.status as WhtHandoffStatus] : values.reduce((sum, value) => sum + value, 0);
      const selectedWhere = { AND: [where, ...(filters.status ? [{ status: filters.status as WhtHandoffStatus }] : [])] };
      // Reuse the exact list boundary, including historical-number search; sum in SQL, before paging.
      const selected = await db.whtCertificateHandoff.findMany({ where: selectedWhere, select: { id: true } });
      const [sums] = await db.$queryRaw<{ withheld: string }[]>`
        SELECT ROUND(COALESCE(SUM(COALESCE(c."withheldAmount", (h."prefillSnapshotJson"->>'withheldAmount')::numeric, 0)), 0), 2)::text AS withheld
        FROM "WhtCertificateHandoff" h
        LEFT JOIN "WhtCertificate" c ON c.id = h."certificateId" AND c."companyId" = h."companyId"
        WHERE h."companyId" = ${ctx.companyId} AND h.id = ANY(${selected.map(row => row.id)}::text[])
      `;
      const rows = await db.whtCertificateHandoff.findMany({
        where: selectedWhere,
        orderBy: [{ createdAt: filters.order === 'oldest' ? 'asc' : 'desc' }, { id: filters.order === 'oldest' ? 'asc' : 'desc' }], skip: (page - 1) * pageSize, take: pageSize,
      });
      const certificates = await this.loadCertificates(ctx.companyId, rows, db);


      return { rows: rows.map(row => {
        const dto = toDto(row, systemIssuanceOpen, systemCorrectionOpen, systemReplacementOpen, certificates.get(row.certificateId ?? ''), ctx, payer);
        const expense = row.sourcePaymentType === 'expense.record' ? boundary.expenses.get(row.sourcePaymentId ?? '') : undefined;
        const totals = dto.prefill.expenseTotals ?? dto.prefill;
        const shares = expense?.netPayableAmount ? allocateExpenseWithholding(paymentRows.filter(p => p.expenseId === row.sourcePaymentId), String(expense.netPayableAmount), totals.grossAmount, totals.withheldAmount) : [];
        const payee = dto.currentCertificate?.payee ?? dto.prefill.payeeSnapshot;
        const cancellation = row.status === 'CANCELLED' ? cancellations.get(row.id) : undefined;
        const currentNumber = row.status === 'SYSTEM_ISSUED' ? dto.certificateNumber : row.status === 'EXTERNAL_LINKED' ? dto.externalCertificateNumber : null;
        return {
          ...dto,
          externalAttachmentId: row.status === 'EXTERNAL_LINKED' ? files.get(row.id) ?? null : null,
          ...(row.sourcePaymentType === 'expense.record' ? { payments: paymentRows.filter(p => p.expenseId === row.sourcePaymentId).map(p => ({ id: p.id, paidAt: p.paidAt.toISOString(), paidAtConfirmed: p.paidAtConfirmed, amount: String(p.amount), grossAmount: shares.find(s => s.id === p.id)?.grossAmount, withheldAmount: shares.find(s => s.id === p.id)?.whtAmount })) } : {}),
          formType: dto.prefill.formType,
          matchedPreviousNumber: historicalMatches.get(row.id)?.find(number => number !== currentNumber) ?? null,
          expenseDescription: expense ? expenseSourceDescription(expense.lines ?? []) || null : null,
          payeeAddressClearedByTaxIdChange: !row.payeeAddress?.trim() && cleared.has(row.id),
          payeeName: payee.name, payeeTaxId: payee.taxId,
          expenseId: expense?.id ?? null, expenseNumber: expense?.expenseNumber ?? null,
          documentDate: expense?.expenseDate.toISOString() ?? dto.prefill.paymentDate,
          withheldAmount: dto.currentCertificate?.withheldAmount ?? dto.prefill.withheldAmount,
          certificateNumber: dto.certificateNumber ?? dto.externalCertificateNumber ?? cancellation?.certificateNumber ?? null,
          certificateIssuedAt: dto.certificateIssuedAt ?? dto.externalIssuedDate ?? cancellation?.certificateDate?.toISOString() ?? null,
          ...(cancellation ? { cancellation: { cancelledAt: cancellation.occurredAt.toISOString(), eventType: cancellation.eventType as WhtCertificateHistoryEventType, reason: cancellation.reason ?? null } } : {}),
          missing: whtHandoffMissing(dto.prefill),
          hasPayeeAddress: Boolean(whtPayeeAddress(row.payeeAddress, dto.prefill.payeeSnapshot.address)),
          ...(row.status === 'REQUIRED' && !row.certificateId && !row.externalCertificateNumber && previous.get(row.sourcePaymentId ?? '')
            ? { previousCertificate: previous.get(row.sourcePaymentId ?? '') } : {}),
        };
      }), total, page, pageSize, counts, months, sums: sums! };
    }, { isolationLevel: 'RepeatableRead' });
  }

  private async loadReadHistory(companyId: string, rows: { id: string; status: string; sourcePaymentType?: string | null; sourcePaymentId?: string | null; certificateId?: string | null; externalCertificateNumber?: string | null }[], db: Pick<Prisma.TransactionClient, 'whtCertificateHistory'> = this.taxRepo.prisma.client) {
    const ids = [...new Set(rows.filter(row => row.status === 'REQUIRED' && !row.certificateId && !row.externalCertificateNumber && row.sourcePaymentType === 'expense.record')
      .flatMap(row => row.sourcePaymentId ? [row.sourcePaymentId] : []))];
    const history = rows.length ? await db.whtCertificateHistory.findMany({
      where: { companyId, OR: [{ expenseId: { in: ids }, eventType: { in: CANCELLATION_EVENTS } },
        { handoffId: { in: rows.map(row => row.id) }, eventType: { in: ['PAYEE_ADDRESS_CLEARED', 'EXTERNAL_RECORDED', 'EXTERNAL_RECORD_CHANGED', 'EXTERNAL_RECORD_REMOVED'] } }] },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      select: { expenseId: true, handoffId: true, eventType: true, certificateNumber: true, isExternal: true, occurredAt: true, detailsJson: true },
    }) : [];
    return { previous: previousCertificates(history), cleared: clearedAddressHandoffs(history), files: externalWhtFiles(history) };
  }

  private async loadCertificates(companyId: string, rows: { certificateId?: string | null }[], db: Pick<Prisma.TransactionClient, 'whtCertificate'> = this.taxRepo.prisma.client) {
    const ids = [...new Set(rows.flatMap((row) => row.certificateId ? [row.certificateId] : []))];
    const certificates = ids.length ? await db.whtCertificate.findMany({
      where: { companyId, id: { in: ids } },
      select: { id: true, certificateNumber: true, issuedAt: true, taxPeriod: { select: { formType: true } },
        incomeCategoryCode: true, incomeCategoryName: true, whtRate: true, grossAmount: true, withheldAmount: true,
        paymentDate: true, payeeSnapshotJson: true },
    }) : [];
    return new Map(certificates.map((certificate) => [certificate.id, certificate]));
  }

  async getExpenseHistory(ctx: RequestContext, expenseId: string): Promise<WhtCertificateHistoryDto[]> {
    if (!(await findReadableHandoffExpense(this.taxRepo.prisma.client, ctx, expenseId))) return [];
    const handoffs = await this.table.findMany({
      where: { companyId: ctx.companyId, sourcePaymentType: 'expense.record', sourcePaymentId: expenseId },
      select: { id: true, sourceBranchId: true, status: true, externalCertificateNumber: true, externalEvidenceRef: true, linkNote: true },
    });
    const handoffIds = handoffs.filter((row: any) => isBranchInScope(ctx.scopes ?? {}, row.sourceBranchId)).map((row: any) => row.id);
    if (!handoffIds.length) return [];
    const client = this.taxRepo.prisma.client;
    const rows = await client.whtCertificateHistory.findMany({
      where: { companyId: ctx.companyId, expenseId, handoffId: { in: handoffIds } },
      orderBy: { occurredAt: 'desc' },
    });
    const actors = rows.length ? await client.user.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.actorUserId))] } },
      select: { id: true, displayName: true },
    }) : [];
    const names = new Map(actors.map((actor) => [actor.id, actor.displayName]));
    return rows.map((row) => {
      const removed = row.eventType === 'EXTERNAL_RECORDED' ? rows.filter(event => event.handoffId === row.handoffId && event.occurredAt >= row.occurredAt
        && ((event.eventType === 'EXTERNAL_RECORD_REMOVED' && event.certificateNumber === row.certificateNumber)
          || (event.eventType === 'EXTERNAL_RECORD_CHANGED' && (event.detailsJson as Record<string, any> | null)?.previousRecord?.number === row.certificateNumber)))
        .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())[0] : undefined;
      const standing = row.eventType === 'EXTERNAL_RECORDED' && !removed ? handoffs.find((handoff: any) => handoff.id === row.handoffId
        && handoff.status === 'EXTERNAL_LINKED' && handoff.externalCertificateNumber === row.certificateNumber) : undefined;
      const changedPrevious = removed?.eventType === 'EXTERNAL_RECORD_CHANGED' ? (removed.detailsJson as Record<string, any>)?.previousRecord : null;
      const priorDetails = changedPrevious ? { externalEvidenceRef: changedPrevious.externalEvidenceRef, linkNote: changedPrevious.note } : removed?.detailsJson;
      const details = (row.detailsJson ?? priorDetails ?? standing) as Record<string, unknown> | null;
      return {
        ...(typeof details?.externalAttachmentId === 'string' ? { externalAttachmentId: details.externalAttachmentId, handoffId: row.handoffId } : {}),
        eventType: row.eventType as WhtCertificateHistoryEventType,
        certificateNumber: row.certificateNumber,
        isExternal: row.isExternal,
        certificateDate: row.certificateDate?.toISOString() ?? null,
        reason: row.reason,
        evidenceRef: typeof details?.externalEvidenceRef === 'string' ? details.externalEvidenceRef : null,
        note: typeof details?.linkNote === 'string' ? details.linkNote : null,
        relatedCertificateNumber: row.relatedCertificateNumber,
        actorDisplayName: names.get(row.actorUserId) ?? null,
        occurredAt: row.occurredAt.toISOString(),
        taxFilingAttested: row.taxFilingAttested,
        ...(details?.removedManually === true ? { removedManually: true } : {}),
        ...(row.eventType === 'EXTERNAL_RECORD_CHANGED' && details?.previousRecord ? { previousExternalRecord: details.previousRecord as NonNullable<WhtCertificateHistoryDto['previousExternalRecord']> } : {}),
      };
    });
  }

  private async externalFileWriter(ctx: RequestContext, handoffId: string) {
    if (!ctx.permissions.includes('wht.external_certificate.link')) throw new ForbiddenException();
    return loadScopedWhtHandoff(this.taxRepo.prisma.client, ctx, handoffId);
  }

  async externalFileIntent(ctx: RequestContext, handoffId: string, body: CreateUploadIntentCommand) {
    const handoff = await this.externalFileWriter(ctx, handoffId);
    if (body.byteSize <= 0 || body.byteSize > WHT_EXTERNAL_FILE.maxBytes || !['image/jpeg', 'image/png', 'application/pdf'].includes(body.mimeType)) throw new BadRequestException({ code: 'wht_external_file_invalid', message: WHT_EXTERNAL_FILE.invalid });
    // Delegate upload/scanning only after the handoff's own write permission and scope checks.
    return this.uploadIntent!.execute({ ...ctx, permissions: [...ctx.permissions, 'attachment.create'] }, {
      originalFileName: body.originalFileName, mimeType: body.mimeType, byteSize: body.byteSize,
      branchId: handoff.sourceBranchId ?? undefined, visibility: 'INTERNAL',
      metadataJson: { generatedFor: WHT_EXTERNAL_FILE.target, handoffId },
    });
  }

  async completeExternalFile(ctx: RequestContext, handoffId: string, body: CompleteAttachmentUploadCommand) {
    await this.externalFileWriter(ctx, handoffId);
    const file = await this.taxRepo.prisma.client.attachmentObject.findFirst({ where: { id: body.attachmentId, companyId: ctx.companyId, uploadedByUserId: ctx.userId } });
    const metadata = file?.metadataJson as Record<string, unknown> | null;
    if (metadata?.generatedFor !== WHT_EXTERNAL_FILE.target || metadata?.handoffId !== handoffId) throw new NotFoundException();
    return this.completeUpload!.execute({ ...ctx, permissions: [...ctx.permissions, 'attachment.create'] }, body);
  }

  async externalFile(ctx: RequestContext, handoffId: string, attachmentId: string) {
    if (!ctx.permissions.some(permission => ['wht.certificate.read', 'wht.certificate.issue', 'wht.certificate.correct', 'wht.external_certificate.link'].includes(permission))) throw new ForbiddenException();
    await loadScopedWhtHandoff(this.taxRepo.prisma.client, ctx, handoffId);
    const file = await this.taxRepo.prisma.client.attachmentObject.findFirst({ where: {
      id: attachmentId, companyId: ctx.companyId, status: 'ACTIVE',
      links: { some: { companyId: ctx.companyId, targetType: WHT_EXTERNAL_FILE.target, targetId: handoffId, purpose: WHT_EXTERNAL_FILE.purpose } },
    } });
    if (!file) throw new NotFoundException();
    const signed = await this.storage!.createDownloadUrl({ bucket: file.bucket, objectKey: file.objectKey, objectVersionId: file.objectVersionId ?? undefined, mimeType: file.mimeType, fileName: file.originalFileName, disposition: 'inline' });
    return { downloadUrl: signed.url, expiresAt: signed.expiresAt, name: file.originalFileName, mimeType: file.mimeType };
  }

  /** Company-scoped lookup on the link fence, so a replay never crosses a tenant boundary. */
  private async findByLinkCommand(companyId: string, linkCommandId: string) {
    return this.table.findUnique({ where: { companyId_linkCommandId: { companyId, linkCommandId } } });
  }

  /**
   * The one place that decides "this is the same request again" vs "this command id is being
   * reused". Both the pre-check and the unique-violation recovery route through it so they cannot
   * answer differently.
   *
   * The handoff id is checked FIRST and independently of the fingerprint: the link fence is
   * company-wide, so a command that linked handoff A, resubmitted against handoff B with byte
   * identical evidence, would otherwise return A as a happy "replay" while B silently stayed
   * REQUIRED — the operator sees success and the payee never gets a certificate.
   */
  private async replayOrConflict(found: any, handoffId: string, linkFingerprint: string, ctx: RequestContext): Promise<WhtCertificateHandoffDto> {
    if (found.id !== handoffId) {
      throw new ConflictException({
        code: 'wht_handoff_link_command_reused',
        message: 'การแนบหนังสือรับรองครั้งนี้ถูกใช้กับรายการอื่นแล้ว เปิดหน้านี้ใหม่',
        handoffId: found.id,
      });
    }
    if (found.linkPayloadFingerprint === linkFingerprint) return { ...toDto(found, false, false, false, undefined, ctx, await currentWhtPayerDetails(this.taxRepo.prisma.client, ctx.companyId)), externalAttachmentId: (await this.loadReadHistory(ctx.companyId, [found])).files.get(found.id) ?? null };
    throw new ConflictException({
      code: 'wht_handoff_link_command_reused',
      message: 'การแนบหนังสือรับรองครั้งนี้ถูกใช้กับข้อมูลชุดอื่นแล้ว เปิดหน้านี้ใหม่',
      handoffId: found.id,
    });
  }

  async get(ctx: RequestContext, handoffId: string): Promise<WhtCertificateHandoffDto> {
    const row = await loadScopedWhtHandoff(this.taxRepo.prisma.client, ctx, handoffId);
    const [systemIssuanceOpen, systemCorrectionOpen, systemReplacementOpen] = await this.routeFlags();
    const certificates = await this.loadCertificates(ctx.companyId, [row]);
    const readHistory = await this.loadReadHistory(ctx.companyId, [row]);
    const payer = await currentWhtPayerDetails(this.taxRepo.prisma.client, ctx.companyId);
    const payments = row.sourcePaymentType === 'expense.record' ? await this.taxRepo.prisma.client.expensePayment.findMany({
      where: { companyId: ctx.companyId, expenseId: row.sourcePaymentId!, status: 'RECORDED' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, paidAt: true, paidAtConfirmed: true, amount: true },
    }) : [];
    return { payments: payments.map(p => ({ id: p.id, paidAt: p.paidAt.toISOString(), paidAtConfirmed: p.paidAtConfirmed, amount: String(p.amount) })), ...toDto(row, systemIssuanceOpen, systemCorrectionOpen, systemReplacementOpen, certificates.get(row.certificateId ?? ''), ctx, payer),
      externalAttachmentId: row.status === 'EXTERNAL_LINKED' ? readHistory.files.get(row.id) ?? null : null,
      payeeAddressClearedByTaxIdChange: !row.payeeAddress?.trim() && readHistory.cleared.has(row.id),
      ...(readHistory.previous.get(row.sourcePaymentId ?? '') ? { previousCertificate: readHistory.previous.get(row.sourcePaymentId ?? '') } : {}) };
  }

  /**
   * §10: supplies the payee address the frozen prefill never had.
   *
   * It lands in its own columns BESIDE `prefillSnapshotJson`. Rewriting that snapshot is not an
   * option — `prefillSnapshotHash` is the proof that the statutory facts the operator copied have
   * not drifted, and an edit would either break the hash or force a recompute that throws the
   * proof away.
   *
   * Idempotency is proportionate rather than copied from `linkExternal`. That one needs a
   * caller-stable command id because it is a one-way transition carrying legal evidence, where a
   * genuine second link must be told apart from a retry. This is a last-write-wins scalar on a row
   * that is still waiting: the same text again has nothing left to do, so a retry returns the
   * stored row — no second column write, no second audit entry, no second registry write.
   */
  async setPayeeAddress(ctx: RequestContext, handoffId: string, dto: SetWhtHandoffPayeeAddressDto, expectedUpdatedAt?: string): Promise<WhtCertificateHandoffDto> {
    const payeeAddress = String(dto?.payeeAddress ?? '').trim();
    if (!payeeAddress) {
      throw new BadRequestException({ code: 'wht_handoff_payee_address_required', message: 'ยังไม่มีที่อยู่ผู้รับเงิน พิมพ์ที่อยู่ตามที่จะพิมพ์ลงหนังสือรับรอง 50 ทวิ' });
    }
    if (payeeAddress.length > WHT_HANDOFF_PAYEE_ADDRESS_MAX) {
      throw new BadRequestException({ code: 'counterparty_address_too_long', message: 'ที่อยู่ยาวเกิน 500 ตัวอักษร ตัดให้สั้นลงแล้วบันทึกอีกครั้ง' });
    }

    const row = await loadScopedWhtHandoff(this.taxRepo.prisma.client, ctx, handoffId);
    // The refusal: once the certificate exists, an address typed here reaches no document. Saying
    // so beats accepting the text and letting the operator believe the paper changed.
    if (row.status !== 'REQUIRED') throw payeeAddressNotEditable(row.status);
    if (expectedUpdatedAt && row.updatedAt.toISOString() !== expectedUpdatedAt) throw new ConflictException({ code: 'wht_handoff_changed' });
    if ((row.payeeAddress ?? '') === payeeAddress) return toDto(row, false, false, false, undefined, ctx, await currentWhtPayerDetails(this.taxRepo.prisma.client, ctx.companyId));

    // Same conditional-write shape as the link, for the same reason: a colleague who links between
    // the read above and this write must not end up with an address landing on a finished job.
    const outcome = await this.table.updateMany({
      where: { id: handoffId, companyId: ctx.companyId, status: 'REQUIRED', ...(expectedUpdatedAt ? { updatedAt: new Date(expectedUpdatedAt) } : {}) },
      data: { payeeAddress, payeeAddressByUserId: ctx.userId, payeeAddressAt: new Date() },
    });
    if (outcome.count === 0) {
      const current = await this.table.findUnique({ where: { id: handoffId } });
      throw payeeAddressNotEditable(current?.status ?? null);
    }
    const updated = await this.table.findUnique({ where: { id: handoffId } });
    await this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'tax.wht_certificate.payee_address_set',
      targetType: 'wht_certificate_handoff',
      targetId: handoffId,
      requestId: ctx.requestId,
      result: 'SUCCESS',
      riskLevel: 'MEDIUM',
      // CON-10: a payee address is personal data for an individual and the audit sanitizer's key
      // list does not cover it, so the value never enters metadata — only that it changed.
      metadataJson: { addressChanged: true },
    });
    return { ...toDto(updated, false, false, false, undefined, ctx, await currentWhtPayerDetails(this.taxRepo.prisma.client, ctx.companyId)), counterpartyAutoSave: await this.saveAddressToRegistry(ctx, row, payeeAddress) };
  }

  /**
   * §7 cases b and c, so the next document for this payee prefills itself. §10 narrows this seam to
   * those two: case a (creating a counterparty) stays with the expense path, which has a document
   * and a vendor behind it.
   *
   * Never throws (§8, AC06). The address is already on the handoff row by the time this runs; a
   * registry failure is reported as `FAILED` — exactly what `EnsureVendorCounterpartyFromExpense`
   * returns — so the operator is told where to retry instead of losing what they typed.
   */
  private async saveAddressToRegistry(ctx: RequestContext, row: any, addressText: string): Promise<VendorCounterpartyAutoSaveResult> {
    try {
      const payee = (row.prefillSnapshotJson as WhtHandoffPrefillDto | null)?.payeeSnapshot;
      // The handoff's own `branchCode` column IS the payee's tax branch code; the snapshot copy is
      // the fallback for rows frozen before it was populated.
      const key = vendorMatchKey({ taxId: payee?.taxId, branchCode: row.branchCode ?? payee?.branchCode, name: payee?.name });
      if (!key) return { case: 'SKIPPED' };
      const matched = await this.counterparties.findCounterpartyByVendorKey(ctx.companyId, key);
      if (!matched) return { case: 'SKIPPED' };

      const registryAddress = matched.billingAddressJson;
      const registryAddressText = counterpartyAddressText(registryAddress ?? null);
      const locked = Boolean((registryAddress as { locked?: unknown } | undefined)?.locked);
      const decision = decideVendorAutoSave({ matched: true, registryAddressText, documentAddressText: addressText, locked });
      const result: VendorCounterpartyAutoSaveResult = {
        case: decision.case,
        counterpartyId: matched.id,
        displayName: matched.displayName,
        ...(decision.case === 'HISTORY' && locked ? { locked: true } : {}),
      };
      if (!decision.promoteToPrimary && !decision.appendToHistory) return result;

      const previous = (registryAddress ?? undefined) as
        { postalCode?: string | null; provenance?: { source?: string; expenseId?: string; userId?: string; at?: string } } | undefined;
      // A4: locked keeps the registry's own primary and only remembers what was typed here.
      const keepPrimary = !decision.promoteToPrimary;
      const at = new Date().toISOString();
      await this.counterparties.saveCounterpartyVendorFields({
        companyId: ctx.companyId,
        counterpartyId: matched.id,
        billingAddressJson: buildCounterpartyAddressV2({
          addressText: keepPrimary ? registryAddressText! : addressText,
          postalCode: keepPrimary ? previous?.postalCode ?? null : null,
          // A person typed this one on a screen, so MANUAL — not EXPENSE_AUTO, which would claim a
          // document that does not exist.
          source: keepPrimary ? (previous?.provenance?.source as 'MANUAL') ?? 'MANUAL' : 'MANUAL',
          ...(keepPrimary && previous?.provenance?.expenseId ? { expenseId: previous.provenance.expenseId } : {}),
          userId: keepPrimary ? previous?.provenance?.userId ?? ctx.userId : ctx.userId,
          at: keepPrimary ? previous?.provenance?.at ?? at : at,
          previous: registryAddress,
          // No expense behind a handoff address — the same empty marker `PromoteSeenAddressUseCase`
          // writes for a hand-picked address with no document of its own.
          ...(decision.appendToHistory
            ? { appendToHistory: { addressText: keepPrimary ? addressText : registryAddressText!, expenseId: '', at } }
            : {}),
        }),
        updatedByUserId: ctx.userId,
      });
      void this.audit.log({
        companyId: ctx.companyId,
        actorUserId: ctx.userId,
        action: 'accounting.counterparty.update',
        targetType: 'accounting_counterparty',
        targetId: matched.id,
        requestId: ctx.requestId,
        result: 'SUCCESS',
        riskLevel: 'MEDIUM',
        metadataJson: { source: 'wht_handoff_payee_address', handoffId: row.id, addressChanged: true },
      });
      return result;
    } catch {
      return { case: 'FAILED', failed: true };
    }
  }

  /** Changes the standing self-issued record, never the source expense or a system certificate. */
  async changeExternal(ctx: RequestContext, handoffId: string, dto: ChangeExternalWhtCertificateDto): Promise<WhtCertificateHandoffDto> {
    const allowed = await loadScopedWhtHandoff(this.taxRepo.prisma.client, ctx, handoffId);
    if (!ctx.permissions.includes('wht.external_certificate.link')) throw new ForbiddenException({
      code: 'wht_handoff_external_change_permission_denied', message: WHT_EXTERNAL_RECORD_WORDS.permissionDenied,
    });
    const parsed = normalizeWhtLinkEvidence(dto as WhtLinkEvidenceInput);
    if (!parsed.ok) throw new BadRequestException({ code: 'wht_handoff_external_record_invalid', message: WHT_EXTERNAL_RECORD_WORDS.invalid });
    const { commandId, externalCertificateNumber, externalEvidenceRef, issuedDate, paymentDate, note } = parsed.value;
    if (issuedDate.toISOString().slice(0, 10) > todayCivilDate('Asia/Bangkok')) throw new BadRequestException({
      code: 'wht_handoff_external_issued_date_future', message: WHT_EXTERNAL_RECORD_WORDS.futureDate,
    });
    const payloadFingerprint = fingerprint({ handoffId, ...(dto.externalAttachmentId !== undefined ? { externalAttachmentId: dto.externalAttachmentId } : {}), externalCertificateNumber, externalEvidenceRef, issuedDate: issuedDate.toISOString(), ...(paymentDate ? { paymentDate: paymentDate.toISOString() } : {}), note });
    const updated = await this.taxRepo.prisma.client.$transaction(async tx => {
      // The company-wide command lock makes history a durable retry fence, even after later changes.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${ctx.companyId}:${commandId}:wht-external-record-change`}))`;
      let expense: Awaited<ReturnType<typeof tx.expenseRecord.findFirst>> = null;
      if (allowed.sourcePaymentType === 'expense.record' && allowed.sourcePaymentId) {
        await lockExpenseCorrection(tx, ctx.companyId, allowed.sourcePaymentId);
        expense = await tx.expenseRecord.findFirst({ where: { companyId: ctx.companyId, id: allowed.sourcePaymentId } });
        if (expense?.status !== 'CONFIRMED') throw new ConflictException({ code: 'expense_wht_source_changed', message: expenseCorrectionBlockerMessage('not_confirmed') });
      } else {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${ctx.companyId}:${handoffId}:wht-external-record`}))`;
      }
      // Read again after the lifecycle lock: the old history values must be the last committed record.
      const row = await loadScopedWhtHandoff(tx, ctx, handoffId);
      if (row.status !== 'EXTERNAL_LINKED') throw new ConflictException({ code: 'wht_handoff_not_linkable', message: WHT_EXTERNAL_RECORD_WORDS.notLinkable });
      const [previousCommand] = await tx.whtCertificateHistory.findMany({
        where: { companyId: ctx.companyId, eventType: 'EXTERNAL_RECORD_CHANGED', detailsJson: { path: ['commandId'], equals: commandId } }, take: 1,
      });
      if (previousCommand) {
        const details = previousCommand.detailsJson as Record<string, unknown>;
        if (previousCommand.handoffId !== handoffId || details.payloadFingerprint !== payloadFingerprint) throw new ConflictException({
          code: 'wht_handoff_link_command_reused', message: WHT_EXTERNAL_RECORD_WORDS.commandReused,
        });
        return row;
      }
      const currentFile = (await this.loadReadHistory(ctx.companyId, [row], tx)).files.get(row.id) ?? null;
      const externalAttachmentId = dto.externalAttachmentId === undefined ? currentFile : dto.externalAttachmentId;
      await retainExternalWhtFile(tx, ctx, row.id, externalAttachmentId);
      const formType = (row.prefillSnapshotJson as WhtHandoffPrefillDto).formType;
      if (expense) {
        const locks = await readExpensePeriodLocks(tx, expense, [], true);
        const filed = locks.lockedTaxPeriods.find((period: { formType: string }) => period.formType === 'PND3' || period.formType === 'PND53');
        if (filed) throw new ConflictException({ code: 'tax_period_filed', message: withholdingPeriodLockedMessage(filed.periodKey, 'แก้ไขเอกสารนี้', filed.formType, 'EXTERNAL') });
      } else if (formType) {
        const periodKey = formPeriodKey(formType, new Date((row.prefillSnapshotJson as WhtHandoffPrefillDto).paymentDate));
        await tx.$executeRaw`SELECT id FROM "TaxPeriod" WHERE "companyId" = ${ctx.companyId} AND "formType"::text = ${formType} AND "periodKey" = ${periodKey} ORDER BY id FOR UPDATE`;
        const [filed] = await filedWithholdingPaymentPeriods(tx, ctx.companyId, row.sourcePaymentType ?? '', row.sourcePaymentId ?? '', { formType, periodKey });
        if (filed) throw new ConflictException({ code: 'tax_period_filed', message: withholdingPeriodLockedMessage(filed.periodKey, 'แก้ไขเอกสารนี้', filed.formType, 'EXTERNAL') });
      }
      if (row.externalCertificateNumber === externalCertificateNumber && row.externalIssuedDate?.toISOString() === issuedDate.toISOString()
        && (!paymentDate || (row.prefillSnapshotJson as WhtHandoffPrefillDto)?.externalPaymentDate === paymentDate.toISOString().slice(0, 10))
        && currentFile === externalAttachmentId && (row.externalEvidenceRef ?? '') === externalEvidenceRef && (row.linkNote ?? null) === note) throw new ConflictException({
        code: 'wht_handoff_external_record_no_changes', message: WHT_EXTERNAL_RECORD_WORDS.noChanges,
      });
      const previousRecord = { ...(currentFile ? { externalAttachmentId: currentFile } : {}), paymentDate: (row.prefillSnapshotJson as WhtHandoffPrefillDto)?.externalPaymentDate ?? null, number: row.externalCertificateNumber, issuedDate: row.externalIssuedDate?.toISOString() ?? null, externalEvidenceRef: row.externalEvidenceRef, note: row.linkNote };
      const result = await tx.whtCertificateHandoff.update({ where: { id: handoffId }, data: {
        externalCertificateNumber, externalIssuedDate: issuedDate, externalEvidenceRef, linkNote: note,
        ...(paymentDate ? { prefillSnapshotJson: { ...(row.prefillSnapshotJson as WhtHandoffPrefillDto), externalPaymentDate: paymentDate.toISOString().slice(0, 10) } } : {}),
      } });
      await appendWhtCertificateHistory(tx, row, {
        eventType: 'EXTERNAL_RECORD_CHANGED', actorUserId: ctx.userId, isExternal: true,
        certificateNumber: externalCertificateNumber, certificateDate: issuedDate,
        detailsJson: { commandId, payloadFingerprint, externalAttachmentId, externalEvidenceRef, linkNote: note,
          previousRecord },
      });
      await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'tax.wht_certificate.external_record_changed',
        targetType: 'wht_certificate_handoff', targetId: handoffId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH',
        metadataJson: { commandId, previousNumber: previousRecord.number, externalCertificateNumber },
      }, tx);
      return result;
    }, { isolationLevel: 'ReadCommitted' });
    return { ...toDto(updated, false, false, false, undefined, ctx, await currentWhtPayerDetails(this.taxRepo.prisma.client, ctx.companyId)), externalAttachmentId: (await this.loadReadHistory(ctx.companyId, [updated])).files.get(updated.id) ?? null };
  }

  async removeExternal(ctx: RequestContext, handoffId: string, dto: RemoveExternalWhtCertificateDto): Promise<WhtCertificateHandoffDto> {
    const allowed = await loadScopedWhtHandoff(this.taxRepo.prisma.client, ctx, handoffId);
    if (!ctx.permissions.includes('wht.external_certificate.link')) throw new ForbiddenException({
      code: 'wht_handoff_external_remove_permission_denied', message: WHT_EXTERNAL_RECORD_WORDS.removePermissionDenied,
    });
    if (typeof dto.reason !== 'string' || !isExpenseVoidReason(dto.reason) || dto.reason.trim().length > 500) throw new BadRequestException({
      code: 'wht_handoff_external_remove_reason_invalid', message: WHT_EXTERNAL_RECORD_WORDS.removeInvalid,
    });
    if (typeof dto.commandId !== 'string' || !dto.commandId.trim() || dto.commandId.length > 200
      || typeof dto.expectedUpdatedAt !== 'string' || !Number.isFinite(Date.parse(dto.expectedUpdatedAt))) throw new BadRequestException({
      code: 'wht_handoff_external_remove_request_invalid', message: WHT_EXTERNAL_RECORD_WORDS.removeRequestInvalid,
    });
    const commandId = dto.commandId.trim(), reason = dto.reason.trim();
    const payloadFingerprint = fingerprint({ handoffId, reason, expectedUpdatedAt: dto.expectedUpdatedAt });
    await this.taxRepo.prisma.client.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${ctx.companyId}:${commandId}:wht-external-record-remove`}))`;
      if (allowed.sourcePaymentType === 'expense.record' && allowed.sourcePaymentId) {
        await lockExpenseCorrection(tx, ctx.companyId, allowed.sourcePaymentId);
      } else {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${ctx.companyId}:${handoffId}:wht-external-record`}))`;
      }
      const row = { ...await loadScopedWhtHandoff(tx, ctx, handoffId) };
      const [previousCommand] = await tx.whtCertificateHistory.findMany({
        where: { companyId: ctx.companyId, eventType: 'EXTERNAL_RECORD_REMOVED', detailsJson: { path: ['commandId'], equals: commandId } }, take: 1,
      });
      if (previousCommand) {
        if (previousCommand.handoffId !== handoffId || (previousCommand.detailsJson as Record<string, unknown>).payloadFingerprint !== payloadFingerprint) throw new ConflictException({
          code: 'wht_handoff_link_command_reused', message: WHT_EXTERNAL_RECORD_WORDS.commandReused,
        });
        return;
      }
      if (row.status !== 'EXTERNAL_LINKED' || row.updatedAt.toISOString() !== dto.expectedUpdatedAt) throw new ConflictException({
        code: 'wht_handoff_not_linkable', message: WHT_EXTERNAL_RECORD_WORDS.notLinkable,
      });
      const expense = row.sourcePaymentType === 'expense.record' && row.sourcePaymentId
        ? await tx.expenseRecord.findFirst({ where: { companyId: ctx.companyId, id: row.sourcePaymentId } }) : null;
      if (row.sourcePaymentType === 'expense.record' && expense?.status !== 'CONFIRMED') throw new ConflictException({
        code: 'expense_wht_source_changed', message: expenseCorrectionBlockerMessage('not_confirmed'),
      });
      const formType = (row.prefillSnapshotJson as WhtHandoffPrefillDto).formType;
      if (expense) {
        const locks = await readExpensePeriodLocks(tx, expense, [], true);
        const filed = locks.lockedTaxPeriods.find((period: { formType: string }) => period.formType === 'PND3' || period.formType === 'PND53');
        if (filed) throw new ConflictException({ code: 'tax_period_filed', message: withholdingPeriodLockedMessage(filed.periodKey, 'แก้ไขเอกสารนี้', filed.formType, 'EXTERNAL') });
      } else if (formType) {
        const periodKey = formPeriodKey(formType, new Date((row.prefillSnapshotJson as WhtHandoffPrefillDto).paymentDate));
        await tx.$executeRaw`SELECT id FROM "TaxPeriod" WHERE "companyId" = ${ctx.companyId} AND "formType"::text = ${formType} AND "periodKey" = ${periodKey} ORDER BY id FOR UPDATE`;
        const [filed] = await filedWithholdingPaymentPeriods(tx, ctx.companyId, row.sourcePaymentType ?? '', row.sourcePaymentId ?? '', { formType, periodKey });
        if (filed) throw new ConflictException({ code: 'tax_period_filed', message: withholdingPeriodLockedMessage(filed.periodKey, 'แก้ไขเอกสารนี้', filed.formType, 'EXTERNAL') });
      }
      const changed = await tx.whtCertificateHandoff.updateMany({
        where: { id: handoffId, companyId: ctx.companyId, status: 'EXTERNAL_LINKED', updatedAt: row.updatedAt },
        data: { status: 'REQUIRED', externalCertificateNumber: null, externalEvidenceRef: null, externalIssuedDate: null,
          linkNote: null, linkCommandId: null, linkPayloadFingerprint: null, linkedAt: null, linkedByUserId: null },
      });
      if (changed.count !== 1) throw new ConflictException({ code: 'wht_handoff_not_linkable', message: WHT_EXTERNAL_RECORD_WORDS.notLinkable });
      await appendWhtCertificateHistory(tx, row, {
        eventType: 'EXTERNAL_RECORD_REMOVED', actorUserId: ctx.userId, isExternal: true,
        certificateNumber: row.externalCertificateNumber, certificateDate: row.externalIssuedDate, reason,
        detailsJson: { commandId, payloadFingerprint, removedManually: true, externalEvidenceRef: row.externalEvidenceRef, linkNote: row.linkNote },
      });
      await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'tax.wht_certificate.external_record_removed',
        targetType: 'wht_certificate_handoff', targetId: handoffId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH',
        metadataJson: { commandId, certificateNumber: row.externalCertificateNumber, reason },
      }, tx);
    }, { isolationLevel: 'ReadCommitted' });
    return this.get(ctx, handoffId);
  }

  /**
   * Records the externally issued certificate against the handoff. Writes no `WhtCertificate`:
   * the SYSTEM route is closed, so there is no system number to register and no active-certificate
   * predicate to contend with (coordinator ruling OQ-3; CC5 owns that machinery).
   */
  async linkExternal(ctx: RequestContext, handoffId: string, dto: LinkExternalWhtCertificateDto): Promise<WhtCertificateHandoffDto> {
    // Re-validated at the mutation boundary as well as at the HTTP DTO: this writes the durable
    // record of a legal document, and an internal caller does not pass through the pipe. Both layers
    // run the SAME rules so the boundary cannot be the laxer of the two.
    const parsed = normalizeWhtLinkEvidence(dto as WhtLinkEvidenceInput);
    if (!parsed.ok) throw new BadRequestException({ code: 'wht_handoff_external_record_invalid', message: WHT_EXTERNAL_RECORD_WORDS.invalid });
    const { commandId, externalCertificateNumber, externalEvidenceRef, issuedDate, paymentDate, note } = parsed.value;
    const uploadHandoffId = handoffId;
    let row = await loadScopedWhtHandoff(this.taxRepo.prisma.client, ctx, handoffId);
    row = await paymentHandoff(this.taxRepo.prisma.client, ctx.companyId, row, dto.paymentId);
    handoffId = row.id;
    // The handoff is part of the fingerprint: the same evidence legitimately links to different
    // handoffs, so identity alone must never make one look like a replay of the other.
    const linkFingerprint = fingerprint({ handoffId, ...(dto.externalAttachmentId !== undefined ? { externalAttachmentId: dto.externalAttachmentId } : {}), externalCertificateNumber, externalEvidenceRef, issuedDate: issuedDate.toISOString(), ...(paymentDate ? { paymentDate: paymentDate.toISOString() } : {}), ...(dto.paymentId ? { paymentId: dto.paymentId } : {}), note });


    // Same-LINK-command replay first, before any state check: a retry after a dropped response must
    // return the stored result rather than collide with itself. Keyed on the link command's own
    // identity — the creation command id cannot tell a retry from a different second link.
    const replayed = await this.findByLinkCommand(ctx.companyId, commandId);
    if (replayed) return this.replayOrConflict(replayed, handoffId, linkFingerprint, ctx);
    if (row.status !== 'REQUIRED' && row.status !== 'EXTERNAL_LINKED') {
      throw new ConflictException({ code: 'wht_handoff_not_linkable', message: WHT_EXTERNAL_RECORD_WORDS.notLinkable, status: row.status });
    }

    // The transition itself is a single conditional statement, not read-then-write. Two operators
    // linking at once therefore produce exactly one winner: the loser matches no row and is told
    // what actually happened, instead of silently overwriting the first one's legal evidence.
    let outcome: { count: number };
    try {
      const write = (table: any, paymentPrefill: WhtHandoffPrefillDto) => table.updateMany({
        where: { id: handoffId, companyId: ctx.companyId, status: 'REQUIRED', payloadFingerprint: row.payloadFingerprint },
        data: {
          status: 'EXTERNAL_LINKED',
          prefillSnapshotJson: { ...paymentPrefill, externalPaymentDate: paymentDate?.toISOString().slice(0, 10) ?? paymentPrefill.paymentDate.slice(0, 10) },
          externalCertificateNumber,
          externalEvidenceRef,
          externalIssuedDate: issuedDate,
          linkNote: note,
          linkCommandId: commandId,
          linkPayloadFingerprint: linkFingerprint,
          linkedAt: new Date(),
          linkedByUserId: ctx.userId,
        },
      });
      outcome = await this.taxRepo.prisma.client.$transaction(async (tx: any) => {
        if (row.sourcePaymentType === 'expense.record' && row.sourcePaymentId) {
          await lockExpenseCorrection(tx, ctx.companyId, row.sourcePaymentId);
          const expense = await tx.expenseRecord.findFirst({ where: { companyId: ctx.companyId, id: row.sourcePaymentId }, select: { status: true } });
          if (expense?.status !== 'CONFIRMED') throw new ConflictException({ code: 'expense_wht_source_changed', message: expenseCorrectionBlockerMessage('not_confirmed') });
        }
        const paymentPrefill = await certificatePayment(tx, ctx.companyId, row, dto.paymentId);
        if (paymentDate && paymentDate.toISOString().slice(0, 10) !== paymentPrefill.paymentDate.slice(0, 10)) throw new BadRequestException({ code: 'wht_certificate_payment_date_mismatch', message: 'วันที่จ่ายบนหนังสือรับรองไม่ตรงกับรายการจ่าย ตรวจวันที่ในรายการจ่ายก่อนบันทึก' });
        await assertPaymentNotCertified(tx, ctx.companyId, row, paymentPrefill);
        const result = await write(tx.whtCertificateHandoff, paymentPrefill);
        if (result.count === 1) {
          if (dto.externalAttachmentId != null) await retainExternalWhtFile(tx, ctx, row.id, dto.externalAttachmentId, uploadHandoffId);
          await appendWhtCertificateHistory(tx, row, {
            eventType: 'EXTERNAL_RECORDED', actorUserId: ctx.userId, isExternal: true,
            certificateNumber: externalCertificateNumber, certificateDate: issuedDate,
            detailsJson: { ...(dto.externalAttachmentId !== undefined ? { externalAttachmentId: dto.externalAttachmentId } : {}), externalEvidenceRef, linkNote: note, paymentDate: paymentDate?.toISOString() ?? paymentPrefill.paymentDate },
          });
        }
        return result;
      }, { isolationLevel: 'ReadCommitted' });
    } catch (error) {
      // A concurrent request took this link command id between our lookup and this write. The
      // lookup above cannot close that window, so the unique index does — and the loser gets the
      // same considered answer it would have got a millisecond earlier, not a raw driver error.
      if ((error as { code?: string })?.code !== 'P2002') throw error;
      const winner = await this.findByLinkCommand(ctx.companyId, commandId);
      if (!winner) throw error;
      return this.replayOrConflict(winner, handoffId, linkFingerprint, ctx);
    }
    if (outcome.count === 0) {
      const current = await this.table.findUnique({ where: { id: handoffId } });
      if (current?.linkCommandId === commandId && current?.linkPayloadFingerprint === linkFingerprint) return toDto(current, false, false, false, undefined, ctx, await currentWhtPayerDetails(this.taxRepo.prisma.client, ctx.companyId));
      throw new ConflictException({
        code: 'wht_handoff_already_linked',
        message: WHT_EXTERNAL_RECORD_WORDS.alreadyLinked,
        status: current?.status ?? null,
        externalCertificateNumber: current?.externalCertificateNumber ?? null,
      });
    }
    const updated = await this.table.findUnique({ where: { id: handoffId } });
    await this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'tax.wht_certificate.external_link',
      targetType: 'wht_certificate_handoff',
      targetId: handoffId,
      requestId: ctx.requestId,
      result: 'SUCCESS',
      riskLevel: 'HIGH',
      metadataJson: {
        externalCertificateNumber,
        externalEvidenceRef,
        issuedDate: issuedDate.toISOString(),
        commandId,
        linkPayloadFingerprint: linkFingerprint,
      },
    });
    return { ...toDto(updated, false, false, false, undefined, ctx, await currentWhtPayerDetails(this.taxRepo.prisma.client, ctx.companyId)), externalAttachmentId: (await this.loadReadHistory(ctx.companyId, [updated])).files.get(updated.id) ?? null };
  }
}

/**
 * D5: never a silent no-op. The handoff already has its certificate, so the text would reach no
 * document — the refusal says that and points at the place where the address still matters.
 */
function payeeAddressNotEditable(status: string | null): ConflictException {
  return new ConflictException({
    code: 'wht_handoff_address_not_editable',
    message: 'รายการนี้ออกหนังสือรับรองไปแล้ว ที่อยู่ที่พิมพ์ที่นี่จึงไม่มีผลกับเอกสารที่ออกไป แก้ที่อยู่ผู้รับเงินได้ที่หน้าคู่ค้า',
    status,
  });
}

/** Stable over key order so a replay of the same facts fingerprints identically. */
export function fingerprint(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

function toDto(row: any, systemIssuanceOpen = false, systemCorrectionOpen = false, systemReplacementOpen = false, certificate?: Pick<WhtCertificate, 'certificateNumber' | 'issuedAt' | 'incomeCategoryCode' | 'incomeCategoryName' | 'whtRate' | 'grossAmount' | 'withheldAmount' | 'paymentDate' | 'payeeSnapshotJson'> & { taxPeriod: { formType: string } }, ctx?: RequestContext, payer = { registeredName: null as string | null, taxId: null as string | null, address: null as string | null }): WhtCertificateHandoffDto {
  const payee = certificate?.payeeSnapshotJson as PayeeSnapshot | undefined;
  return {
    id: row.id,
    companyId: row.companyId,
    status: row.status,
    sourcePaymentType: row.sourcePaymentType ?? null,
    sourcePaymentId: row.sourcePaymentId ?? null,
    payeeId: row.payeeId ?? null,
    branchCode: row.branchCode ?? null,
    sourceFeatureKey: row.sourceFeatureKey,
    taxPeriodId: row.taxPeriodId ?? null,
    taxEventIds: (row.taxEventIdsJson ?? []) as string[],
    prefill: row.prefillSnapshotJson as WhtHandoffPrefillDto,
    payeeAddress: row.payeeAddress ?? null,
    payeeAddressClearedByTaxIdChange: false,
    payeeAddressAt: row.payeeAddressAt?.toISOString() ?? null,
    payeeAddressByUserId: row.payeeAddressByUserId ?? null,
    externalCertificateNumber: row.externalCertificateNumber ?? null,
    externalEvidenceRef: row.externalEvidenceRef ?? null,
    externalPaymentDate: (row.prefillSnapshotJson as WhtHandoffPrefillDto)?.externalPaymentDate ?? null,
    externalIssuedDate: row.externalIssuedDate?.toISOString() ?? null,
    linkNote: row.linkNote ?? null,
    sourceBranchId: row.sourceBranchId ?? null,
    linkedAt: row.linkedAt?.toISOString() ?? null,
    linkedByUserId: row.linkedByUserId ?? null,
    certificateId: row.certificateId ?? null,
    certificateNumber: certificate?.certificateNumber ?? null,
    certificateIssuedAt: certificate?.issuedAt?.toISOString() ?? null,
    currentCertificate: certificate ? {
      number: certificate.certificateNumber, issuedAt: certificate.issuedAt?.toISOString() ?? null,
      formType: certificate.taxPeriod.formType === 'PND3' ? 'PND3' : 'PND53',
      incomeCategoryCode: certificate.incomeCategoryCode, incomeCategoryName: certificate.incomeCategoryName,
      whtRate: certificate.whtRate.toString(), grossAmount: certificate.grossAmount.toString(), withheldAmount: certificate.withheldAmount.toString(),
      paymentDate: certificate.paymentDate.toISOString(),
      payee: { name: payee?.name ?? '', taxId: payee?.taxId ?? null, address: payee?.address ?? null, branchCode: payee?.branchCode ?? null },
    } : null,
    payerMissing: whtPayerIdentity((row.prefillSnapshotJson as WhtHandoffPrefillDto).payerSnapshot, payer).missing,
    systemIssuanceOpen: systemIssuanceOpen && !whtCertificateUnsupportedReason(row.prefillSnapshotJson?.incomeCategoryCode, row.prefillSnapshotJson?.formType),
    systemCorrectionOpen,
    systemReplacementOpen,
    canChangeExternalRecord: row.status === 'EXTERNAL_LINKED' && Boolean(ctx?.permissions.includes('wht.external_certificate.link')),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const CANCELLATION_EVENTS = ['CANCELLED_SOURCE_REOPENED', 'CANCELLED_SOURCE_VOIDED', 'EXTERNAL_RECORD_REMOVED'];

function clearedAddressHandoffs(events: { handoffId: string; eventType: string }[]) {
  return new Set(events.filter(event => event.eventType === 'PAYEE_ADDRESS_CLEARED').map(event => event.handoffId));
}

function previousCertificates(events: { eventType: string; expenseId: string | null; certificateNumber: string | null; isExternal: boolean; occurredAt: Date; detailsJson?: unknown }[]) {
  const previous = new Map<string, NonNullable<WhtCertificateHandoffDto['previousCertificate']>>();
  for (const event of events) if (CANCELLATION_EVENTS.includes(event.eventType) && !(event.detailsJson as Record<string, unknown> | null)?.removedManually && event.expenseId && !previous.has(event.expenseId)) previous.set(event.expenseId, {
    number: event.certificateNumber, kind: event.isExternal ? 'EXTERNAL' : 'SYSTEM', cancelledAt: event.occurredAt.toISOString(),
  });
  return previous;
}
