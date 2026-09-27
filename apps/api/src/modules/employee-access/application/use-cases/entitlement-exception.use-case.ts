/**
 * UAT r7 P0-5 — the way OUT of a normalization dependency exception.
 *
 * Ruling 4b leaves a company with an unmet `FEATURE_DEPENDENCIES` edge untouched and NOT COMPLETED,
 * because neither direction is safe to pick automatically: enabling `procurement.vendor_bills`
 * grants access nobody bought, disabling `procurement.supplier_payments` removes access somebody may
 * be using. That was correct — and it was a DEAD END. The FAILED marker freezes every partner
 * entitlement command for that company (set-partner-features.use-case.ts:82), the normalizer refuses
 * to complete it, and nothing else could write the missing row: staff's only remaining tool was
 * direct SQL against a live tenant.
 *
 * This is the audited replacement. Staff sees the company by NAME, the features by their Thai
 * catalog labels, and what each choice does; then picks one:
 *
 *   ENABLE_PREREQUISITE — turn the missing prerequisite ON, preserving what the company uses today.
 *   DISABLE_DEPENDENT   — turn the dependent features OFF per the contract. `evidenceRef` required,
 *                         because this one removes access and the contract is the only authority for it.
 *
 * The customer is never asked and never sees any of it (spec:232 — zero user interaction).
 *
 * Safety is the same protocol the partner command and the normalizer use, not a lighter one: the
 * exclusive per-company entitlement lock (spec:60), a CAS on the exception snapshot the operator
 * actually reviewed, a `CompanyEntitlementSet` version bump, real `EntitlementTransition` rows with
 * continued epoch/seq fences, and an audit row. Any marker is then RESET to STARTED so the next PLAN
 * picks the company up fresh and normalizes it on the ordinary path.
 *
 * UAT r8 A1 — both sides are computed LIVE, never read off a persisted `status:'FAILED'` marker.
 * PLAN is read-only by ruling, so it detects an exception and writes nothing; requiring a marker
 * made the endpoint unreachable on exactly the journey it exists for (PLAN detects → nothing listed
 * → nothing resolvable → APPLY still refuses, because a detected exception is what makes the
 * artifact not approval-ready). The CAS is now the hash of the company's live plan, recomputed under
 * the lock, which is a strictly stronger fence than the marker's stored snapshot: it moves whenever
 * any row of the company moves.
 */
import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { FEATURE_CATALOG } from '@watchdog-bms/contracts';
import { invalidateLineConversationState } from '../../../line-ai/application/line-conversation-context.service';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../../common/database/prisma.service';
import { exclusiveEntitlementLock } from '../../../feature-launch/application/execution-attempt.service';
import { buildRunoffRoots, completeRunoffIfDrained } from '../../../feature-launch/application/runoff-lifecycle';
import { evaluateEntitledFeatureKeys, type StoredEntitlementRow } from '../entitlement.helper';
import {
  SYSTEM_ACTOR,
  dependencyExceptionMessage,
  humanDecidedKeys,
  pendingCompanyWhere,
  planCompanyNormalization,
} from '../normalize-entitlements';

/** Shared, so the per-company fallback in `list()` allocates nothing. */
const EMPTY_KEYS: ReadonlySet<string> = new Set();

export const ENTITLEMENT_EXCEPTION_RESOLUTIONS = ['ENABLE_PREREQUISITE', 'DISABLE_DEPENDENT'] as const;
export type EntitlementExceptionResolution = (typeof ENTITLEMENT_EXCEPTION_RESOLUTIONS)[number];

/** Thai label for any catalog key, top-level or submenu. Falls back to the key itself. */
const FEATURE_LABELS_TH = new Map<string, string>(
  FEATURE_CATALOG.flatMap((feature) => [
    [feature.key, feature.labelTh] as const,
    ...feature.submenus.map((submenu) => [submenu.key, `${feature.labelTh} › ${submenu.labelTh}`] as const),
  ]),
);
const labelOf = (featureKey: string) => FEATURE_LABELS_TH.get(featureKey) ?? featureKey;

export type EntitlementExceptionUnmet = {
  /** The feature the company has ON today — the "chosen" side of chosen-vs-required. */
  chosenFeatureKey: string;
  chosenLabelTh: string;
  /** The prerequisite that is OFF — the "required" side. */
  requiredFeatureKey: string;
  requiredLabelTh: string;
};

export type EntitlementExceptionCompany = {
  companyId: string;
  companyName: string;
  /**
   * The CAS value: the hash of the company's LIVE normalization plan. A resolve must echo it back,
   * and it is recomputed under the lock, so a stale screen cannot decide a company that moved.
   */
  snapshotHash: string;
  /** The pass that parked this company, when one did. `null` for a PLAN-only detection. */
  runId: string | null;
  detectedAt: string | null;
  error: string;
  unmet: EntitlementExceptionUnmet[];
  /** What each choice would actually do, in the operator's language. */
  resolutions: Array<{
    action: EntitlementExceptionResolution;
    featureKeys: string[];
    labelsTh: string[];
    impactTh: string;
    /**
     * False when this choice would be refused today, so the screen can present it as unavailable
     * instead of offering an action that will 422. Both choices are available since the
     * freeze-in-place decision (2026-08-04) removed the disable refusal.
     */
    available: boolean;
    evidenceRequired: boolean;
  }>;
};

export type ResolveEntitlementExceptionCommand = {
  companyId: string;
  action: EntitlementExceptionResolution;
  /** The `snapshotHash` from the listing. Compared under the lock; a mismatch refuses the write. */
  expectedSnapshotHash: string;
  /** The contract/ticket this decision rests on. REQUIRED to remove access. */
  evidenceRef?: string;
  reason?: string;
  requestingAdminUserId: string;
  requestId: string;
};

export type ResolveEntitlementExceptionResult = {
  companyId: string;
  action: EntitlementExceptionResolution;
  setVersion: number;
  changed: Array<{ featureKey: string; fromEnabled: boolean; toEnabled: boolean }>;
  /**
   * `STARTED` when a marker existed and was reset so the NEXT plan includes this company fresh.
   * `NONE` when the exception was found by a read-only PLAN and there was no marker to reset — the
   * company is already in the pending set, so the next plan picks it up either way.
   */
  markerStatus: 'STARTED' | 'NONE';
};

@Injectable()
export class EntitlementExceptionUseCase {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * UAT r8 A1 — every company that HAS a dependency exception right now, computed live.
   *
   * This used to list persisted `status:'FAILED'` markers, which made the whole endpoint
   * unreachable on the journey it exists for: PLAN is read-only by ruling, so it detects the
   * exception and writes NOTHING, and APPLY refuses to run while the plan is not approval-ready —
   * which a detected exception is exactly what prevents. With no marker there was no company to
   * list, nothing to resolve, and no way to ever produce a clean artifact.
   *
   * The candidate set is the same predicate the runner plans (`pendingCompanyWhere`), which covers
   * both a PLAN-only detection (no marker) and a parked APPLY (FAILED marker) without a union, and
   * cannot drift from what the release task will actually attempt. The findings and the CAS hash are
   * recomputed from the rows stored RIGHT NOW, never parsed out of the marker's error sentence.
   *
   * ponytail: one plan per pending company, from one bulk row read. This is an internal ops screen
   * over tens of companies; page it the way the runner does if the tenant count ever makes it slow.
   */
  async list(): Promise<{ companies: EntitlementExceptionCompany[] }> {
    const candidates = await this.prisma.client.company.findMany({
      where: pendingCompanyWhere(),
      select: {
        id: true,
        name: true,
        entitlementNormalization: { select: { runId: true, updatedAt: true } },
      },
      orderBy: { id: 'asc' },
    });
    const candidateIds = candidates.map((candidate) => candidate.id);
    const rows = await this.prisma.client.companyFeatureEntitlement.findMany({
      where: { companyId: { in: candidateIds } },
      select: { companyId: true, featureKey: true, enabled: true },
      orderBy: [{ companyId: 'asc' }, { featureKey: 'asc' }],
    });
    const rowsByCompany = new Map<string, StoredEntitlementRow[]>();
    for (const row of rows) {
      const bucket = rowsByCompany.get(row.companyId);
      if (bucket) bucket.push(row);
      else rowsByCompany.set(row.companyId, [row]);
    }
    // The planner's `humanDecided` argument, bulk-read the same way the rows are (UAT r8).
    const decided = await this.prisma.client.entitlementTransition.findMany({
      where: { companyId: { in: candidateIds }, actorUserId: { not: SYSTEM_ACTOR } },
      select: { companyId: true, featureKey: true },
      distinct: ['companyId', 'featureKey'],
    });
    const decidedByCompany = new Map<string, Set<string>>();
    for (const transition of decided) {
      const bucket = decidedByCompany.get(transition.companyId);
      if (bucket) bucket.add(transition.featureKey);
      else decidedByCompany.set(transition.companyId, new Set([transition.featureKey]));
    }

    const companies: EntitlementExceptionCompany[] = [];
    for (const candidate of candidates) {
      const { findings: unmet, hash } = exceptionsOf(
        candidate.id,
        rowsByCompany.get(candidate.id) ?? [],
        decidedByCompany.get(candidate.id) ?? EMPTY_KEYS,
      );
      // Nothing unmet today (never had one, or a partner command / an earlier resolve fixed it) —
      // this company is just waiting for the next plan, not a staff action item.
      if (unmet.length === 0) continue;
      const requiredKeys = [...new Set(unmet.map((finding) => finding.requiresFeatureKey))].sort();
      const chosenKeys = [...new Set(unmet.map((finding) => finding.featureKey))].sort();
      companies.push({
        companyId: candidate.id,
        companyName: candidate.name,
        snapshotHash: hash,
        runId: candidate.entitlementNormalization?.runId ?? null,
        detectedAt: candidate.entitlementNormalization?.updatedAt.toISOString() ?? null,
        error: dependencyExceptionMessage(unmet),
        unmet: unmet.map((finding) => ({
          chosenFeatureKey: finding.featureKey,
          chosenLabelTh: labelOf(finding.featureKey),
          requiredFeatureKey: finding.requiresFeatureKey,
          requiredLabelTh: labelOf(finding.requiresFeatureKey),
        })),
        resolutions: [
          {
            action: 'ENABLE_PREREQUISITE',
            featureKeys: requiredKeys,
            labelsTh: requiredKeys.map(labelOf),
            impactTh: `เปิด ${requiredKeys.map(labelOf).join(', ')} เพิ่มให้บริษัท `
              + `เพื่อให้ ${chosenKeys.map(labelOf).join(', ')} ที่ใช้งานอยู่เดิมทำงานต่อได้เหมือนเดิม`,
            // Never gated: enabling a prerequisite only preserves what the company already uses,
            // so it is the always-available way out of a dependency exception.
            available: true,
            evidenceRequired: false,
          },
          {
            action: 'DISABLE_DEPENDENT',
            featureKeys: chosenKeys,
            labelsTh: chosenKeys.map(labelOf),
            impactTh: `ปิด ${chosenKeys.map(labelOf).join(', ')} ตามสัญญา `
              + 'บริษัทจะใช้เมนูนี้ไม่ได้อีก ข้อมูลเดิมยังอยู่ในระบบ ต้องแนบหลักฐานสัญญา',
            // Freeze-in-place (owner decision 2026-08-04): a disable always succeeds, so this choice
            // is never the unavailable one.
            available: true,
            evidenceRequired: true,
          },
        ],
      });
    }
    return { companies };
  }

  async resolve(cmd: ResolveEntitlementExceptionCommand): Promise<ResolveEntitlementExceptionResult> {
    // Removing access needs an authority outside this screen. Enabling a prerequisite only
    // preserves what the company already uses, so it does not.
    if (cmd.action === 'DISABLE_DEPENDENT' && (cmd.evidenceRef ?? '').trim() === '') {
      throw new UnprocessableEntityException({
        code: 'entitlement_exception_evidence_required',
        message: 'DISABLE_DEPENDENT removes access; it requires the contract evidence reference.',
      });
    }

    /**
     * UAT r8 A1 — the precondition is the LIVE unmet dependency, not a persisted FAILED marker. A
     * PLAN detects an exception and writes nothing (PLAN is read-only by ruling), so requiring a
     * marker made every PLAN-detected company permanently unresolvable. This read is the cheap
     * refusal — a company with nothing unmet costs one query and never materializes a CAS root —
     * and the authoritative recomputation happens again under the lock below.
     */
    const preflight = exceptionsOf(
      cmd.companyId,
      await loadRows(this.prisma.client, cmd.companyId),
      await humanDecidedKeys(this.prisma.client, cmd.companyId),
    );
    this.assertResolvable(cmd, preflight);

    // Lazily materialize the CAS root at version 0 — upsert, never create-then-catch (a P2002
    // inside a transaction poisons it), and outside the transaction so an exception company's
    // first-ever write does not race its own row creation against the CAS below.
    const set = await this.prisma.client.companyEntitlementSet.upsert({
      where: { companyId: cmd.companyId },
      create: { companyId: cmd.companyId },
      update: {},
      select: { setVersion: true },
    });
    const expectedSetVersion = set.setVersion;
    const resultSetVersion = expectedSetVersion + 1;

    const result = await this.prisma.client.$transaction(async (tx) => {
      // The same exclusive key the partner command and the normalizer take (spec:60), so this can
      // never interleave with a normalization pass on the same company.
      await tx.$executeRaw(exclusiveEntitlementLock(cmd.companyId));

      // ONE cutoff for the whole resolution (spec:60), captured inside the transaction so "later
      // work cannot join that snapshot" is a serialization guarantee and not a race.
      const cutoffAt = new Date();
      const runoffSnapshots: Array<{ featureKey: string; disableSeq: number }> = [];

      // THE decision point: the exception the operator reviewed must still be there, and the
      // company must still hash to what the screen showed. A duplicate submit lands here with the
      // dependency already satisfied and is refused with zero writes.
      const rows = await loadRows(tx, cmd.companyId);
      const locked = exceptionsOf(cmd.companyId, rows, await humanDecidedKeys(tx, cmd.companyId));
      this.assertResolvable(cmd, locked);
      const findings = locked.findings;

      /**
       * Ruling 4b's marker RESET: STARTED with no error is exactly the state `pendingCompanyWhere`
       * treats as "plan me", so the next PLAN includes this company fresh and completes it.
       * `cohortKind` is deliberately NOT in the update — the cohort survives the round trip, which
       * is what stops a resolved EXPLICIT company coming back as a grandfathered one.
       * A company whose exception a PLAN found has NO marker, and none is created: it is already in
       * the pending set, and inventing a marker here would only add a row to reset later.
       */
      const reset = await tx.companyEntitlementNormalization.updateMany({
        where: { companyId: cmd.companyId },
        data: { status: 'STARTED', error: null, completedAt: null, runId: cmd.requestId },
      });

      const targets = new Map<string, boolean>(
        cmd.action === 'ENABLE_PREREQUISITE'
          ? findings.map((finding) => [finding.requiresFeatureKey, true])
          : findings.map((finding) => [finding.featureKey, false]),
      );
      const stored = new Map(rows.map((row) => [row.featureKey, row.enabled]));
      // THE before-state is what the company can actually do now, from the one canonical evaluator
      // — the same question the partner command asks, for the same reason: raw stored rows disagree
      // with runtime for exactly the un-normalized companies this endpoint serves.
      const entitled = evaluateEntitledFeatureKeys(rows);
      const wasOn = (featureKey: string) => entitled === null || entitled.has(featureKey);

      const changed = [...targets.entries()]
        .filter(([featureKey, toEnabled]) => stored.get(featureKey) !== toEnabled)
        .map(([featureKey, toEnabled]) => ({ featureKey, fromEnabled: wasOn(featureKey), toEnabled }))
        .sort((a, b) => a.featureKey.localeCompare(b.featureKey));

      const cas = await tx.companyEntitlementSet.updateMany({
        where: { companyId: cmd.companyId, setVersion: expectedSetVersion },
        data: { setVersion: resultSetVersion, lastTransitionAt: new Date() },
      });
      if (cas.count !== 1) {
        throw new ConflictException({
          code: 'entitlement_set_version_conflict',
          message: 'The entitlement set changed while resolving. Retry.',
          expectedSetVersion,
        });
      }

      // `EntitlementTransition` is append-only and outlives a deleted row, so both counters continue
      // from the higher of the row and the history — a key whose row was removed would otherwise
      // restart at seq 0 and collide with its own history on `(companyId, featureKey, seq)`.
      const fences = new Map(rows.map((row) => [row.featureKey, { epoch: row.epoch ?? 0, lastSeq: row.lastSeq ?? 0 }]));
      const history = await tx.entitlementTransition.groupBy({
        by: ['featureKey'],
        where: { companyId: cmd.companyId },
        _max: { seq: true, epoch: true },
      });
      const historyFences = new Map(
        history.map((row) => [row.featureKey, { epoch: row._max.epoch ?? 0, lastSeq: row._max.seq ?? 0 }]),
      );

      for (const change of changed) {
        const fence = fences.get(change.featureKey) ?? { epoch: 0, lastSeq: 0 };
        const prior = historyFences.get(change.featureKey) ?? { epoch: 0, lastSeq: 0 };
        const baseEpoch = Math.max(fence.epoch, prior.epoch);
        // spec:51 — the epoch moves only on a real non-ON→ON grant, so live claims fenced on the
        // old epoch survive a row that merely materializes what was already effectively on.
        const epoch = change.toEnabled && !change.fromEnabled ? baseEpoch + 1 : baseEpoch;
        const seq = Math.max(fence.lastSeq, prior.lastSeq) + 1;
        await tx.companyFeatureEntitlement.upsert({
          where: { companyId_featureKey: { companyId: cmd.companyId, featureKey: change.featureKey } },
          create: {
            companyId: cmd.companyId,
            featureKey: change.featureKey,
            enabled: change.toEnabled,
            epoch,
            lastSeq: seq,
            updatedBySystemAdminUserId: cmd.requestingAdminUserId,
          },
          update: {
            enabled: change.toEnabled,
            epoch,
            lastSeq: seq,
            updatedBySystemAdminUserId: cmd.requestingAdminUserId,
            // CC7 (spec:235) — an operator decision is an EXPLICIT grant, never a grandfathered one,
            // so the LEGACY cohort marker is cleared exactly as the partner command clears it.
            grantOrigin: null,
          },
        });
        // r18 F1 / r19 — a DISABLE_DEPENDENT write is a REAL ON→OFF transition and takes the runoff
        // lifecycle, not a bare OFF.
        //
        // The proposed exemption ("the evaluator already masks a child whose prerequisite is off, so
        // no runoff-eligible work can exist") was TESTED AND IS FALSE: `evaluateEntitledFeatureKeys`
        // applies platform invariants, legacy inheritance and parent→submenu masking, but never
        // `FEATURE_DEPENDENCIES` — a probe with `procurement.vendor_bills=false,
        // procurement.supplier_payments=true` returns the CHILD AS ENTITLED. `DEPENDENCY_MASK` is a
        // normalizer WRITE decision (CC7), not a runtime read mask. This very loop proves it too:
        // `fromEnabled` is read from that evaluator and comes back `true`.
        //
        // Freeze-in-place (owner decision 2026-08-04): the snapshot is the record of the cutoff and
        // is empty for every family, so this write can never be refused or parked.
        const isRealDisable = !change.toEnabled && change.fromEnabled;
        await tx.entitlementTransition.create({
          data: {
            companyId: cmd.companyId,
            featureKey: change.featureKey,
            seq,
            epoch,
            commandId: `entitlement-exception:${cmd.requestId}`,
            action: change.toEnabled ? 'ENABLE' : (isRealDisable ? 'DISABLE_REQUESTED' : 'OFF'),
            actorUserId: cmd.requestingAdminUserId,
            reasonJson: {
              requestId: cmd.requestId,
              fromEnabled: change.fromEnabled,
              dependencyExceptionResolution: cmd.action,
              ...(cmd.evidenceRef ? { evidenceRef: cmd.evidenceRef } : {}),
              ...(cmd.reason ? { reason: cmd.reason } : {}),
            },
          },
        });
        if (isRealDisable) {
          runoffSnapshots.push({ featureKey: change.featureKey, disableSeq: seq });
          await tx.runoffSnapshot.create({
            data: {
              companyId: cmd.companyId,
              featureKey: change.featureKey,
              disableSeq: seq,
              cutoffAt,
              rootsJson: buildRunoffRoots(change.featureKey) as unknown as Prisma.InputJsonValue,
            },
          });
        }
      }

      if (changed.some(change => change.fromEnabled !== change.toEnabled)) {
        await invalidateLineConversationState(tx, { companyId: cmd.companyId }, false);
      }
      await tx.auditLog.create({
        data: {
          companyId: cmd.companyId,
          actorUserId: cmd.requestingAdminUserId,
          action: 'system.entitlement.dependency_resolve',
          targetType: 'company',
          targetId: cmd.companyId,
          requestId: cmd.requestId,
          result: 'SUCCESS',
          riskLevel: 'HIGH',
          metadataJson: {
            resolution: cmd.action,
            expectedSnapshotHash: cmd.expectedSnapshotHash,
            setVersion: resultSetVersion,
            unmet: findings,
            changed,
            // Runbook R5 triage: which keys the resolver put into runoff, and at which seq.
            ...(runoffSnapshots.length > 0
              ? { cutoffAt: cutoffAt.toISOString(), runoffSnapshots }
              : {}),
            ...(cmd.evidenceRef ? { evidenceRef: cmd.evidenceRef } : {}),
            ...(cmd.reason ? { reason: cmd.reason } : {}),
          },
        },
      });

      return {
        runoffSnapshots,
        companyId: cmd.companyId,
        action: cmd.action,
        setVersion: resultSetVersion,
        changed,
        markerStatus: reset.count > 0 ? ('STARTED' as const) : ('NONE' as const),
      };
    }, { timeout: 60_000, maxWait: 20_000 });

    // spec:69 — completion is a separate SYSTEM command, post-commit, and MUST NOT throw: the
    // resolution is already durable and the company's dependency is already repaired.
    //
    // Every snapshot committed above is empty (freeze in place), so the drain completes here on the
    // first pass. A completion that fails is the sweep's to repair (runbook R5), never a reason to
    // report a committed resolution as failed.
    const { runoffSnapshots, ...resolution } = result;
    for (const snapshot of runoffSnapshots) {
      try {
        await completeRunoffIfDrained(this.prisma, cmd.companyId, snapshot.featureKey);
      } catch {
        // Swallowed for the same reason the partner command swallows it: the sweep repairs a
        // missed completion, and reporting failure here would misdescribe a committed resolution.
      }
    }
    return resolution;
  }

  /**
   * The two refusals, applied identically before the lock and under it: no live exception at all,
   * and an exception whose company no longer hashes to what the operator reviewed.
   */
  private assertResolvable(
    cmd: ResolveEntitlementExceptionCommand,
    live: { hash: string; findings: unknown[] },
  ): void {
    if (live.findings.length === 0) {
      throw new NotFoundException({
        code: 'entitlement_exception_not_found',
        message: `Company "${cmd.companyId}" has no open entitlement dependency exception.`,
      });
    }
    if (live.hash !== cmd.expectedSnapshotHash) {
      throw new ConflictException({
        code: 'entitlement_exception_snapshot_conflict',
        message: 'The exception changed since it was read. Reload the list and decide again.',
        expectedSnapshotHash: cmd.expectedSnapshotHash,
        currentSnapshotHash: live.hash,
      });
    }
  }
}

/** Everything the resolve writes fences from, plus what the planner reads. */
function loadRows(client: Pick<PrismaService['client'], 'companyFeatureEntitlement'>, companyId: string) {
  return client.companyFeatureEntitlement.findMany({
    where: { companyId },
    select: { featureKey: true, enabled: true, epoch: true, lastSeq: true },
    orderBy: { featureKey: 'asc' },
  });
}

/**
 * The live unmet edges and the CAS hash, from THE planner — never a second copy of the dependency
 * rules. Pure, so the listing (one bulk read for the whole pending set) and the resolve (one company
 * under its lock) cannot compute them differently.
 *
 * `humanDecided` is threaded through even though this dependency-only preview has no resolved
 * cohort and therefore no provenance plan. It is passed rather than defaulted so that no planner
 * call site can drift into stamping a human decision by omission.
 */
function exceptionsOf(
  companyId: string,
  rows: readonly StoredEntitlementRow[],
  humanDecided: ReadonlySet<string>,
) {
  const plan = planCompanyNormalization(companyId, rows, null, humanDecided);
  return { hash: plan.hash, findings: plan.dependencyFindings.filter((finding) => finding.action === 'EXCEPTION') };
}
