import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type {
  LinkExternalWhtCertificateDto,
  RequestContext,
  WhtCertificateHandoffDto,
  WhtHandoffPrefillDto,
} from '@watchdog-bms/contracts';
import { AuditService } from '../../../audit/application/audit.service';
import { LaunchGateGuardService } from '../../../feature-launch/application/launch-gate.guard';
import { FEATURE_TEMPORARILY_UNAVAILABLE } from '../../../employee-access/application/entitlement.helper';
import { PrismaTaxRepository } from '../../infrastructure/repositories/prisma-tax.repository';
import { normalizeWhtLinkEvidence } from '../../domain/logic/wht-link-evidence.logic';
import type { WhtLinkEvidenceInput } from '../../domain/logic/wht-link-evidence.logic';

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

  /**
   * `branchId` is a FILTER, not an authorization boundary — the same shape the other procurement
   * list endpoints use. No AP surface enforces a branch boundary today, and H4 does not invent one.
   */
  async list(ctx: RequestContext, filters: { status?: string; branchId?: string } = {}): Promise<WhtCertificateHandoffDto[]> {
    const rows = await this.table.findMany({
      where: {
        companyId: ctx.companyId,
        ...(filters.status ? { status: filters.status as any } : {}),
        ...(filters.branchId ? { sourceBranchId: filters.branchId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map(toDto);
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
  private replayOrConflict(found: any, handoffId: string, linkFingerprint: string): WhtCertificateHandoffDto {
    if (found.id !== handoffId) {
      throw new ConflictException({
        code: 'wht_handoff_link_command_reused',
        message: 'รหัสคำสั่งนี้ถูกใช้กับรายการอื่นแล้ว',
        handoffId: found.id,
      });
    }
    if (found.linkPayloadFingerprint === linkFingerprint) return toDto(found);
    throw new ConflictException({
      code: 'wht_handoff_link_command_reused',
      message: 'รหัสคำสั่งนี้ถูกใช้กับข้อมูลชุดอื่นแล้ว',
      handoffId: found.id,
    });
  }

  async get(ctx: RequestContext, handoffId: string): Promise<WhtCertificateHandoffDto> {
    const row = await this.table.findUnique({ where: { id: handoffId } });
    // Tenant check is explicit rather than part of the lookup so a cross-company id is
    // indistinguishable from a missing one.
    if (!row || row.companyId !== ctx.companyId) throw new NotFoundException('WHT handoff not found.');
    return toDto(row);
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
    if (!parsed.ok) throw new BadRequestException(parsed.error);
    const { commandId, externalCertificateNumber, externalEvidenceRef, issuedDate, note } = parsed.value;
    // The handoff is part of the fingerprint: the same evidence legitimately links to different
    // handoffs, so identity alone must never make one look like a replay of the other.
    const linkFingerprint = fingerprint({ handoffId, externalCertificateNumber, externalEvidenceRef, issuedDate: issuedDate.toISOString(), note });

    const row = await this.table.findUnique({ where: { id: handoffId } });
    if (!row || row.companyId !== ctx.companyId) throw new NotFoundException('WHT handoff not found.');

    // Same-LINK-command replay first, before any state check: a retry after a dropped response must
    // return the stored result rather than collide with itself. Keyed on the link command's own
    // identity — the creation command id cannot tell a retry from a different second link.
    const replayed = await this.findByLinkCommand(ctx.companyId, commandId);
    if (replayed) return this.replayOrConflict(replayed, handoffId, linkFingerprint);
    if (row.status !== 'REQUIRED' && row.status !== 'EXTERNAL_LINKED') {
      throw new ConflictException({ code: 'wht_handoff_not_linkable', message: 'สถานะของงานนี้ไม่รองรับการแนบเอกสาร', status: row.status });
    }

    // The transition itself is a single conditional statement, not read-then-write. Two operators
    // linking at once therefore produce exactly one winner: the loser matches no row and is told
    // what actually happened, instead of silently overwriting the first one's legal evidence.
    let outcome: { count: number };
    try {
      outcome = await this.table.updateMany({
        where: { id: handoffId, companyId: ctx.companyId, status: 'REQUIRED' },
        data: {
          status: 'EXTERNAL_LINKED',
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
    } catch (error) {
      // A concurrent request took this link command id between our lookup and this write. The
      // lookup above cannot close that window, so the unique index does — and the loser gets the
      // same considered answer it would have got a millisecond earlier, not a raw driver error.
      if ((error as { code?: string })?.code !== 'P2002') throw error;
      const winner = await this.findByLinkCommand(ctx.companyId, commandId);
      if (!winner) throw error;
      return this.replayOrConflict(winner, handoffId, linkFingerprint);
    }
    if (outcome.count === 0) {
      const current = await this.table.findUnique({ where: { id: handoffId } });
      if (current?.linkCommandId === commandId && current?.linkPayloadFingerprint === linkFingerprint) return toDto(current);
      throw new ConflictException({
        code: 'wht_handoff_already_linked',
        message: 'หนังสือรับรองนี้ถูกแนบไว้แล้ว',
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
    return toDto(updated);
  }
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

function toDto(row: any): WhtCertificateHandoffDto {
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
    externalCertificateNumber: row.externalCertificateNumber ?? null,
    externalEvidenceRef: row.externalEvidenceRef ?? null,
    externalIssuedDate: row.externalIssuedDate?.toISOString() ?? null,
    linkNote: row.linkNote ?? null,
    sourceBranchId: row.sourceBranchId ?? null,
    linkedAt: row.linkedAt?.toISOString() ?? null,
    linkedByUserId: row.linkedByUserId ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
