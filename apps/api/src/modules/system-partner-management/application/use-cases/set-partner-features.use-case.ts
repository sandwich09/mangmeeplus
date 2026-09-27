import { createHash } from 'node:crypto';
import { invalidateLineConversationState } from '../../../line-ai/application/line-conversation-context.service';
import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../../common/database/prisma.service';
import { APPROVED_FEATURE_ENTITLEMENT_KEYS } from '../../domain/feature-registry';
import { partnerMetadataLockError } from '../../domain/logic/partner-lock.logic';
import { ChartReadinessService } from '../../../ledger/application/services/chart-readiness.service.js';
import type { ChartOfAccountsReadiness, SetPartnerFeaturesResultDto } from '@watchdog-bms/contracts';
import { PLATFORM_INVARIANT_FEATURE_KEYS, parentFeatureKey, unmetFeatureDependencies } from '@watchdog-bms/contracts';
import { exclusiveEntitlementLock } from '../../../feature-launch/application/execution-attempt.service';
import { assertCallerCommandId, buildRunoffRoots, completeRunoffIfDrained } from '../../../feature-launch/application/runoff-lifecycle';
import { evaluateEntitledFeatureKeys } from '../../../employee-access/application/entitlement.helper';
import {
  LEGACY_COHORT,
  LEGACY_GRANT_ORIGIN,
  humanDecidedKeys,
  isCurrentEntitlementNormalization,
} from '../../../employee-access/application/normalize-entitlements';

/**
 * F1.5.1 item 1 — a company whose entitlement rows have not been normalized yet has no trustworthy
 * before-state: zero or partial rows read as fail-open ON at runtime but as `false` in storage, so
 * a disable would be recorded as a first materialization (`OFF`) instead of the real ON→OFF
 * transition it is, losing the lifecycle and the fence a later re-enable depends on. Every
 * command shape (enable, disable, cascade, preview) is refused until normalization COMPLETES at the
 * CURRENT normalizer version with a recorded cohort — see the gate in `execute` for why the status
 * alone is not enough.
 */
export const ENTITLEMENT_NORMALIZATION_PENDING = 'company_entitlement_normalization_pending';
export const ENTITLEMENT_NORMALIZATION_PENDING_MESSAGE = 'ระบบกำลังเตรียมสิทธิ์ให้ ไม่ต้องดำเนินการ';

export type SetPartnerFeaturesCommand = {
  companyId: string;
  features: Array<{ featureKey: string; enabled: boolean }>;
  requestingAdminUserId: string;
  requestId: string;
  /** CC1 whole-command idempotency key (spec:51), stable across a lost-response retry. */
  commandId: string;
  /** CC1 batch CAS fence (spec:51), read from the partner detail response. */
  expectedSetVersion: number;
  /** Explicit one-click atomic cascade for a parent disable (spec:52). */
  confirmCascade?: boolean;
};

export type SetPartnerFeaturesResult = SetPartnerFeaturesResultDto;

type FeatureInput = { featureKey: string; enabled: boolean };

/**
 * Stable over key order so a client retry that reorders its payload still replays instead of
 * being rejected as key reuse. `confirmCascade` is part of the fingerprint because it changes
 * the resulting set.
 */
function payloadFingerprintOf(features: readonly FeatureInput[], confirmCascade: boolean): string {
  const canonical = [...features]
    .map((feature) => ({ featureKey: feature.featureKey, enabled: feature.enabled }))
    .sort((a, b) => a.featureKey.localeCompare(b.featureKey));
  return createHash('sha256')
    .update(JSON.stringify({ features: canonical, confirmCascade }))
    .digest('hex');
}

@Injectable()
export class SetPartnerFeaturesUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chartReadiness: ChartReadinessService,
  ) {}

  async execute(cmd: SetPartnerFeaturesCommand): Promise<SetPartnerFeaturesResult> {
    // The use case is also called outside HTTP. Canonicalize once here so validation,
    // fingerprinting, dependency checks and writes can never observe different duplicate values.
    const received = cmd.features as unknown;
    const approvedSet = new Set<string>(APPROVED_FEATURE_ENTITLEMENT_KEYS);
    if (!Array.isArray(received) || received.length === 0) {
      throw new UnprocessableEntityException({
        code: 'entitlement_features_required',
        message: 'เลือกอย่างน้อยหนึ่งฟีเจอร์ก่อนบันทึก',
      });
    }
    if (received.length > approvedSet.size) {
      throw new UnprocessableEntityException({
        code: 'entitlement_feature_batch_too_large',
        message: 'จำนวนฟีเจอร์เกินรายการที่ระบบรองรับ กรุณาโหลดหน้าใหม่',
      });
    }
    const malformed = received.some((item) => (
      item === null
      || typeof item !== 'object'
      || typeof (item as { featureKey?: unknown }).featureKey !== 'string'
      || !(item as { featureKey: string }).featureKey.trim()
      || typeof (item as { enabled?: unknown }).enabled !== 'boolean'
    ));
    if (malformed) {
      throw new UnprocessableEntityException({
        code: 'entitlement_feature_invalid',
        message: 'ข้อมูลฟีเจอร์ไม่ถูกต้อง กรุณาโหลดหน้าใหม่',
      });
    }
    const inputFeatures = received as FeatureInput[];
    const duplicateKeys = [...new Set(inputFeatures
      .map((feature) => feature.featureKey)
      .filter((key, index, keys) => keys.indexOf(key) !== index))].sort();
    if (duplicateKeys.length > 0) {
      throw new UnprocessableEntityException({
        code: 'entitlement_feature_duplicate',
        message: 'พบฟีเจอร์ซ้ำในคำขอ กรุณาโหลดหน้าใหม่',
        featureKeys: duplicateKeys,
      });
    }
    const features = [...inputFeatures].sort((a, b) => a.featureKey.localeCompare(b.featureKey));
    const unknownKeys = features.map((feature) => feature.featureKey).filter((key) => !approvedSet.has(key));
    if (unknownKeys.length > 0) {
      throw new UnprocessableEntityException({
        code: 'entitlement_feature_unknown',
        message: 'พบฟีเจอร์ที่ระบบไม่รู้จัก กรุณาโหลดหน้าใหม่',
        featureKeys: unknownKeys,
      });
    }

    if (typeof cmd.commandId !== 'string' || !cmd.commandId || cmd.commandId.length > 200) {
      throw new UnprocessableEntityException({
        code: 'entitlement_command_id_required',
        message: 'คำขอบันทึกไม่สมบูรณ์ กรุณาโหลดหน้าใหม่',
      });
    }
    if (!Number.isInteger(cmd.expectedSetVersion) || cmd.expectedSetVersion < 0) {
      throw new UnprocessableEntityException({
        code: 'entitlement_set_version_required',
        message: 'ข้อมูลแพ็กเกจเปลี่ยนไปแล้ว กรุณาโหลดหน้าใหม่',
      });
    }

    // Platform baseline keys are not commercial toggles (spec:262). An explicit `false` row used
    // to silently disable them in the evaluator; the command now refuses to write one.
    //
    // A SUBMENU of a platform family is equally not a commercial toggle: `company_settings.security`
    // carries the password/identity grants and `employee_access.employees` the employee-management
    // ones. The deleted runoff preflight covered them by inheriting the parent's verdict; this is the
    // only refusal left, so it resolves the parent itself.
    const platformOff = features
      .filter((feature) => !feature.enabled
        && PLATFORM_INVARIANT_FEATURE_KEYS.includes(parentFeatureKey(feature.featureKey)))
      .map((feature) => feature.featureKey);
    if (platformOff.length > 0) {
      throw new UnprocessableEntityException({
        code: 'platform_feature_not_disableable',
        message: `Platform baseline features cannot be disabled: ${platformOff.join(', ')}`,
        featureKeys: platformOff,
      });
    }

    const commandId = cmd.commandId;
    assertCallerCommandId(commandId);
    const confirmCascade = cmd.confirmCascade === true;
    const payloadFingerprint = payloadFingerprintOf(features, confirmCascade);

    // Lost-response replay precedes mutable company/normalization/CAS checks. A command that
    // committed must remain replayable after a role, lifecycle or normalizer-version change.
    const replay = await this.prisma.client.entitlementCommand.findUnique({
      where: { companyId_commandId: { companyId: cmd.companyId, commandId } },
      select: { payloadFingerprint: true, resultJson: true },
    });
    if (replay) {
      if (replay.payloadFingerprint !== payloadFingerprint) {
        throw new ConflictException({
          code: 'entitlement_command_conflict',
          message: `commandId "${commandId}" was already used with a different payload.`,
          commandId,
        });
      }
      return replay.resultJson as unknown as SetPartnerFeaturesResult;
    }

    const company = await this.prisma.client.company.findUnique({
      where: { id: cmd.companyId },
      select: { id: true, status: true },
    });
    if (!company) throw new NotFoundException(`Partner company "${cmd.companyId}" not found.`);

    const lockError = partnerMetadataLockError(company.status);
    if (lockError) throw new UnprocessableEntityException(lockError);

    // The normalization gate runs BEFORE anything that could write — including the lazy
    // `CompanyEntitlementSet` materialization and the idempotency replay — so a pending company
    // ends the request with zero rows written and `setVersion` untouched.
    //
    // COMPLETED alone is not the gate (UAT r8). The normalizer treats a COMPLETED marker as current
    // only at `normalizerVersion >= NORMALIZER_VERSION` — an older one is re-opened for repair — and
    // `verifyCompanyNormalizations` reports a null `cohortKind` as INCOMPLETE, because a marker that
    // predates the column never had its grandfather claim verified. Accepting either shape would let
    // partner commands decide entitlements on a company whose repair pass has not run, compounding
    // the cohort misclassification the repair exists to fix.
    const normalization = await this.prisma.client.companyEntitlementNormalization.findUnique({
      where: { companyId: cmd.companyId },
      select: { status: true, normalizerVersion: true, cohortKind: true },
    });
    if (!isCurrentEntitlementNormalization(normalization)) {
      throw new ConflictException({
        code: ENTITLEMENT_NORMALIZATION_PENDING,
        message: ENTITLEMENT_NORMALIZATION_PENDING_MESSAGE,
        companyId: cmd.companyId,
        normalizationStatus: normalization?.status ?? null,
        // Which of the three conditions failed — a COMPLETED-but-stale company is otherwise
        // indistinguishable from one that never started, and the operator answer differs.
        normalizerVersion: normalization?.normalizerVersion ?? null,
        cohortKind: normalization?.cohortKind ?? null,
      });
    }

    // The cohort the gate just verified. It decides what a confirm that moves no value must RECORD
    // (r9 finding 2), so it is carried into the transaction below.
    const legacyCohort = normalization?.cohortKind === LEGACY_COHORT;

    // Lazily materialize the canonical CAS root at version 0. Upsert (never create-then-catch,
    // which poisons the surrounding transaction) and outside the transaction, so a first-ever
    // command does not race its own row creation against the CAS below.
    const set = await this.prisma.client.companyEntitlementSet.upsert({
      where: { companyId: cmd.companyId },
      create: { companyId: cmd.companyId },
      update: {},
      select: { setVersion: true },
    });
    const expectedSetVersion = cmd.expectedSetVersion;
    if (expectedSetVersion !== set.setVersion) {
      throw new ConflictException({
        code: 'entitlement_set_version_conflict',
        message: 'The entitlement set changed since it was read. Reload and retry.',
        expectedSetVersion,
        currentSetVersion: set.setVersion,
      });
    }

    // Cross-module read, hoisted out of the transaction so the entitlement transaction never
    // issues a nested query on a second pooled connection while holding the advisory lock. The
    // refusal below still fires only on a real Auto-post enable.
    const expenseAutoPostReadiness: ChartOfAccountsReadiness | null =
      features.some((feature) => feature.featureKey === 'expense_auto_post' && feature.enabled)
        ? await this.chartReadiness.load(cmd.companyId)
        : null;

    const submittedKeys = new Set(features.map((feature) => feature.featureKey));
    const resultSetVersion = set.setVersion + 1;

    // Set bump + every entitlement row + every child transition + every runoff snapshot + the
    // command result commit together, or not at all (spec:52, spec:59).
    const result = await this.prisma.client.$transaction(async (tx) => {
      // The exclusive half of the CC1 claim protocol (spec:60): an `ExecutionAttempt` claim takes
      // the SHARED side of this same company key, so a concurrent disable either commits first and
      // prevents the claim, or observes the already-claimed attempt. Sharded per company (F0.E §7.2
      // item 4), so tenants never serialize on one another.
      await tx.$executeRaw(exclusiveEntitlementLock(cmd.companyId));

      // A duplicate delivery can arrive while the first request is still committing. Both callers
      // miss the fast replay above, then serialize on this lock. Re-read here so the waiter returns
      // the durable result instead of failing the now-stale set-version CAS.
      const committedReplay = await tx.entitlementCommand.findUnique({
        where: { companyId_commandId: { companyId: cmd.companyId, commandId } },
        select: { payloadFingerprint: true, resultJson: true },
      });
      if (committedReplay) {
        if (committedReplay.payloadFingerprint !== payloadFingerprint) {
          throw new ConflictException({
            code: 'entitlement_command_conflict',
            message: `commandId "${commandId}" was already used with a different payload.`,
            commandId,
          });
        }
        return {
          commandResult: committedReplay.resultJson as unknown as SetPartnerFeaturesResult,
          runoffSnapshots: [],
        };
      }

      // ONE cutoff for the whole command, captured inside the transaction (spec:60). A cascade is
      // one atomic decision, so a parent and every child it drags off share the same instant —
      // two cutoffs would let a root be "pre-cutoff" for the parent and "later work" for the child.
      const cutoffAt = new Date();
      const runoffSnapshots: Array<{ featureKey: string; disableSeq: number; openCount: number }> = [];

      const existing = await tx.companyFeatureEntitlement.findMany({
        where: { companyId: cmd.companyId },
        select: { featureKey: true, enabled: true, epoch: true, lastSeq: true, grantOrigin: true },
      });
      const storedMap = new Map(existing.map((e) => [e.featureKey, e.enabled]));
      const grantOriginMap = new Map(existing.map((e) => [e.featureKey, e.grantOrigin]));
      const fenceMap = new Map(existing.map((e) => [e.featureKey, { epoch: e.epoch ?? 0, lastSeq: e.lastSeq ?? 0 }]));

      // THE before-state is what the company can actually do right now, read under the lock from
      // the one canonical evaluator the permission resolver uses (fail-open / DEFAULT_ON /
      // legacy inheritance / submenu masking). Raw stored rows disagree with it for exactly the
      // cases this command must refuse, which is how a disable used to slip past the runoff rule.
      const entitled = evaluateEntitledFeatureKeys(existing);
      const wasOn = (key: string) => entitled === null || entitled.has(key);

      // The proposed FINAL set: the effective before-state overlaid with the submitted deltas.
      const proposed = new Map<string, boolean>(features.map((feature) => [feature.featureKey, feature.enabled]));
      const isOn = (key: string) => proposed.get(key) ?? wasOn(key);

      // One contracts-owned matrix, validated in both directions (spec:264).
      const violations = unmetFeatureDependencies(isOn);
      // Direction A — the payload switches a child on (or leaves it on) while its prerequisite is
      // being switched off in the same request: a straight reject, never a silent cascade.
      const enablingViolations = violations.filter((v) => submittedKeys.has(v.featureKey) && isOn(v.featureKey));
      if (enablingViolations.length > 0) {
        const first = enablingViolations[0]!;
        throw new UnprocessableEntityException(
          `${first.featureKey} requires ${first.requiresFeatureKey} to remain enabled in the same configuration.`,
        );
      }
      // Direction B — a parent is being disabled under children that stay on. Answer with one
      // truthful impact preview; only an explicit confirm may switch the children off atomically.
      const cascadeOffKeys = violations.map((v) => v.featureKey).sort();
      const strandedBy = new Map(violations.map((v) => [v.featureKey, v.requiresFeatureKey]));
      if (cascadeOffKeys.length > 0 && !confirmCascade) {
        throw new UnprocessableEntityException({
          code: 'feature_cascade_confirmation_required',
          message: 'Disabling this feature also disables the features that depend on it. Confirm to continue.',
          setVersion: set.setVersion,
          impact: violations,
        });
      }

      const requested: FeatureInput[] = [
        ...features,
        ...cascadeOffKeys.map((featureKey) => ({ featureKey, enabled: false })),
      ];
      for (const featureKey of cascadeOffKeys) proposed.set(featureKey, false);
      // The matrix is one level deep today, so a single cascade pass always settles it. This guard
      // makes a future nested dependency fail loudly instead of stranding a second-order child.
      const residual = unmetFeatureDependencies(isOn);
      if (residual.length > 0) {
        throw new UnprocessableEntityException({
          code: 'feature_cascade_incomplete',
          message: 'The confirmed cascade would still leave a dependent feature stranded.',
          impact: residual,
        });
      }

      // Canonical feature-key order for every per-key write (spec:52). A row is WRITTEN when the
      // stored value differs, so a materialization still lands; whether it is a TRANSITION is the
      // effective before-state's call.
      const changedFeatures = requested
        .filter((feature) => storedMap.get(feature.featureKey) !== feature.enabled)
        .sort((a, b) => a.featureKey.localeCompare(b.featureKey));
      const changedKeys = changedFeatures
        .map((f) => ({ featureKey: f.featureKey, fromEnabled: wasOn(f.featureKey), toEnabled: f.enabled }));
      // CC7 ruling 5 — the moment an operator DECIDES a row it is an EXPLICIT grant, and "decided"
      // includes re-submitting a legacy row at the value it already has. `changedFeatures` cannot
      // carry those (nothing changed), so a grandfathered feature re-confirmed by a partner command
      // used to keep `grantOrigin=LEGACY` forever. Disjoint from `changedFeatures` by construction —
      // one is stored !== requested, the other stored === requested — which is what keeps the
      // `@@unique([companyId, featureKey, commandId])` on the transition below satisfiable.
      //
      // ON on both sides: the marker records ACCESS, so the normalizer only ever stamps an enabled
      // row and clears it on an OFF write — which is also what makes `action: 'ENABLE'` below the
      // truthful description of the decision ("this stays ON, explicitly").
      const confirmedKeys = [...proposed.keys()]
        .filter((featureKey) => proposed.get(featureKey) === true && storedMap.get(featureKey) === true)
        .sort((a, b) => a.localeCompare(b));
      // r9 finding 2 — a null `grantOrigin` is NOT proof the key was already decided. On a LEGACY
      // company an ON row whose provenance stamp never landed is exactly the gap the repair pass
      // hunts, so a confirm that records nothing lets a later pass stamp `grantOrigin=LEGACY` onto a
      // row a human just decided — manufactured grandfather evidence — and leaves the decision out of
      // the PLAN/APPLY hash. Recording the transition is what makes the decision permanent.
      //
      // `humanDecidedKeys` is the SAME reader the normalizer exempts on, so this is the exact test
      // for "already permanent": a key decided by an earlier command writes nothing a second time.
      // An EXPLICIT company has no stamping risk at all — a true no-op, zero writes.
      const humanDecided = legacyCohort && confirmedKeys.some((featureKey) => grantOriginMap.get(featureKey) == null)
        ? await humanDecidedKeys(tx, cmd.companyId)
        : new Set<string>();
      const confirmedLegacyKeys = confirmedKeys.filter((featureKey) => grantOriginMap.get(featureKey) != null
        || (legacyCohort && !humanDecided.has(featureKey)));

      // OWNER DECISION 2026-08-04 — FREEZE IN PLACE. The RUNOFF_MATRIX disable preflight that used
      // to refuse every family except `reports` (422 `feature_disable_pending_runoff`) is DELETED:
      // "ควรปิดได้และหยุดทำงาน แต่ถ้ามีข้อมูลเดิมค้างก็แค่ปิดไว้ไม่บล็อค". `enabled=false` stops the family at
      // every chokepoint that already exists, existing rows stay stored and dormant, and a re-enable
      // resumes where it froze — so residual work is never a reason to refuse. The two refusals that
      // remain are above: the platform invariants, and the dependency cascade (a dependent child may
      // not be left stranded when its prerequisite goes off).

      if (
        expenseAutoPostReadiness
        && !expenseAutoPostReadiness.readyForAutomaticPosting
        && changedFeatures.some((feature) => feature.featureKey === 'expense_auto_post' && feature.enabled)
      ) {
        throw new UnprocessableEntityException({
          code: 'coa_posting_readiness_incomplete',
          message: 'Chart, posting, tax, and bank readiness must pass before expense Auto-post can be enabled.',
          missingRoleKeys: [
            ...expenseAutoPostReadiness.requiredPostingRolesMissing,
            ...expenseAutoPostReadiness.requiredTaxAccountRolesMissing,
          ],
          readiness: expenseAutoPostReadiness,
        });
      }

      const cascadedOffKeys = cascadeOffKeys.filter((key) => !submittedKeys.has(key));
      const cas = await tx.companyEntitlementSet.updateMany({
        where: { companyId: cmd.companyId, setVersion: expectedSetVersion },
        data: { setVersion: resultSetVersion, lastTransitionAt: new Date() },
      });
      if (cas.count !== 1) {
        throw new ConflictException({
          code: 'entitlement_set_version_conflict',
          message: 'The entitlement set changed while saving. Reload and retry.',
          expectedSetVersion,
        });
      }

      for (const feature of changedFeatures) {
        const fence = fenceMap.get(feature.featureKey) ?? { epoch: 0, lastSeq: 0 };
        // Is this write a REAL ON→OFF transition, or merely the first materialization of a row for
        // a feature that was already effectively off? Only the former enters the runoff lifecycle.
        // Mirrors the epoch rule below: epoch moves on `enabled && !wasOn`, the lifecycle starts on
        // `!enabled && wasOn`.
        const isRealDisable = !feature.enabled && wasOn(feature.featureKey);
        // spec:51 — epoch increments exactly once on a real non-ON→ON transition, and never on a
        // disable or an idempotent retry. `lastSeq` advances on every real transition. "Was it
        // already ON" is the effective question, so materializing a row for a feature that was
        // already ON at runtime does not invalidate live claims.
        const epoch = feature.enabled && !wasOn(feature.featureKey) ? fence.epoch + 1 : fence.epoch;
        const seq = fence.lastSeq + 1;
        // Preserve each entitlement's updatedAt activation boundary by writing only features
        // whose effective value actually changed.
        await tx.companyFeatureEntitlement.upsert({
          where: { companyId_featureKey: { companyId: cmd.companyId, featureKey: feature.featureKey } },
          create: {
            companyId: cmd.companyId,
            featureKey: feature.featureKey,
            enabled: feature.enabled,
            epoch,
            lastSeq: seq,
            updatedBySystemAdminUserId: cmd.requestingAdminUserId,
          },
          update: {
            enabled: feature.enabled,
            epoch,
            lastSeq: seq,
            updatedBySystemAdminUserId: cmd.requestingAdminUserId,
            // CC7 (spec:235) — `grantOrigin=LEGACY` means "this access predates explicit
            // entitlements". The moment an operator decides this row, it is an EXPLICIT grant and
            // the grandfather marker is no longer true of it. The `create` branch needs no
            // counterpart: a new row is null by schema default.
            grantOrigin: null,
          },
        });
        await tx.entitlementTransition.create({
          data: {
            companyId: cmd.companyId,
            featureKey: feature.featureKey,
            seq,
            epoch,
            commandId,
            // spec:59 — a real disable REQUESTS the drain; it never writes OFF. Completion is a
            // separate SYSTEM command (`completeRunoffIfDrained`), which the transition's
            // `@@unique([companyId, featureKey, commandId])` also makes mandatory: two transitions
            // for one feature cannot share this command's id.
            //
            // A materialization writes plain OFF: the feature was already off, so there is nothing
            // to drain and putting it into DRAINING would invent a lifecycle it never had.
            action: feature.enabled ? 'ENABLE' : (isRealDisable ? 'DISABLE_REQUESTED' : 'OFF'),
            actorUserId: cmd.requestingAdminUserId,
            reasonJson: {
              requestId: cmd.requestId,
              fromEnabled: wasOn(feature.featureKey),
              ...(cascadedOffKeys.includes(feature.featureKey)
                ? { cascadedFrom: strandedBy.get(feature.featureKey) }
                : {}),
            },
          },
        });

        // spec:60 — "In that transaction it records a cutoff and a `RunoffSnapshot` of only the
        // pre-cutoff roots allowed by the approved matrix; later work cannot join that snapshot."
        // Written under the exclusive entitlement lock, so "later work cannot join" is a
        // serialization guarantee and not a race. Keyed by THIS transition's seq, so a later
        // disable cycle gets its own immutable snapshot and a re-enable never revives this one.
        if (isRealDisable) {
          runoffSnapshots.push({
            featureKey: feature.featureKey,
            disableSeq: seq,
            openCount: 0,
          });
          await tx.runoffSnapshot.create({
            data: {
              companyId: cmd.companyId,
              featureKey: feature.featureKey,
              disableSeq: seq,
              cutoffAt,
              rootsJson: buildRunoffRoots(feature.featureKey) as unknown as Prisma.InputJsonValue,
            },
          });
        }
      }

      // CC7 ruling 5, second half — the keys this command decided WITHOUT moving their value. The
      // grandfather marker is cleared and the decision is recorded durably, but nothing else moves:
      // no value, no epoch, and above all no `updatedAt`.
      //
      // RAW SQL on purpose. Prisma stamps `@updatedAt` on every client-side update, and
      // `expense_auto_post.updatedAt` is the expense auto-post worker's activation cutoff
      // (ledger/application/use-cases/expense-auto-post.use-case.ts:113) — restamping it here would
      // silently re-scope which expenses that worker posts, on a command that changed no value at
      // all. The normalizer stamps provenance the same way, for the same reason.
      for (const featureKey of confirmedLegacyKeys) {
        // Nothing to clear on an unstamped LEGACY row; the fence still advances, so the row and its
        // transition stay consistent whichever branch wrote it.
        const cleared = grantOriginMap.get(featureKey) != null;
        const fence = fenceMap.get(featureKey) ?? { epoch: 0, lastSeq: 0 };
        const seq = fence.lastSeq + 1;
        await tx.$executeRaw(Prisma.sql`
          UPDATE "CompanyFeatureEntitlement"
             SET ${cleared ? Prisma.sql`"grantOrigin" = NULL, ` : Prisma.empty}"lastSeq" = ${seq}
           WHERE "companyId" = ${cmd.companyId}
             AND "featureKey" = ${featureKey}`);
        await tx.entitlementTransition.create({
          data: {
            companyId: cmd.companyId,
            featureKey,
            seq,
            // No value moved, so this is not an OFF→ON transition: the epoch is carried, and every
            // live claim fenced on it stays valid (spec:51).
            epoch: fence.epoch,
            commandId,
            action: 'ENABLE',
            actorUserId: cmd.requestingAdminUserId,
            // This row IS the durable evidence that an operator decided the key: the raw UPDATE
            // above leaves no timestamp behind, so nothing else distinguishes a cleared row from a
            // legacy row whose provenance stamp never landed.
            reasonJson: { noopConfirm: true, ...(cleared ? { clearedGrantOrigin: LEGACY_GRANT_ORIGIN } : {}) },
          },
        });
      }

      const saved = await tx.companyFeatureEntitlement.findMany({
        where: { companyId: cmd.companyId },
        select: { featureKey: true, enabled: true, updatedAt: true },
        orderBy: { featureKey: 'asc' },
      });
      const commandResult: SetPartnerFeaturesResult = {
        companyId: cmd.companyId,
        setVersion: resultSetVersion,
        features: saved.map((f) => ({
          featureKey: f.featureKey,
          enabled: f.enabled,
          updatedAt: f.updatedAt.toISOString(),
        })),
        cascadedOffKeys,
      };

      await tx.entitlementCommand.create({
        data: {
          companyId: cmd.companyId,
          commandId,
          payloadFingerprint,
          expectedSetVersion,
          resultSetVersion,
          resultJson: commandResult as unknown as object,
        },
      });

      if (changedFeatures.some(feature => feature.enabled !== wasOn(feature.featureKey))) {
        await invalidateLineConversationState(tx, { companyId: cmd.companyId }, false);
      }
      await tx.auditLog.create({
        data: {
          actorUserId: cmd.requestingAdminUserId,
          action: 'system.partner_feature.update',
          targetType: 'company',
          targetId: cmd.companyId,
          requestId: cmd.requestId,
          result: 'SUCCESS',
          riskLevel: 'HIGH',
          metadataJson: {
            changedKeys,
            commandId,
            setVersion: resultSetVersion,
            ...(cascadedOffKeys.length > 0 ? { cascadedOffKeys } : {}),
            // Without this a confirm-only command audits as `changedKeys: []` — an authority change
            // (the grandfather marker is gone, or may never be stamped again) that reads as
            // "nothing happened".
            ...(confirmedLegacyKeys.length > 0 ? { confirmedLegacyKeys } : {}),
            // Runbook R5 triages a stuck DRAINING from here: which keys entered runoff, at which
            // transition seq, and how much work the snapshot froze.
            ...(runoffSnapshots.length > 0 ? { cutoffAt: cutoffAt.toISOString(), runoffSnapshots } : {}),
            ...(expenseAutoPostReadiness
              ? { expenseAutoPostReadiness: {
                chartTemplateApplied: expenseAutoPostReadiness.chartTemplateApplied,
                chartAccountCount: expenseAutoPostReadiness.chartAccountCount,
                readyForAutomaticPosting: expenseAutoPostReadiness.readyForAutomaticPosting,
              } }
              : {}),
          },
        },
      });

      return { commandResult, runoffSnapshots };
    });

    // spec:69 — "Completion appends OFF." A SEPARATE command, and necessarily so: the transition's
    // `@@unique([companyId, featureKey, commandId])` forbids two transitions for one feature under
    // this command's id. Running it here (post-commit, same request) is what makes an empty drain
    // finish immediately for the operator instead of waiting for a sweep.
    //
    // IT MUST NEVER THROW INTO THE COMMAND RESULT. The disable is already COMMITTED and durable;
    // reporting failure now would tell the operator nothing happened while the feature is really
    // off, and the web would snap its toggles back to a state the server no longer holds
    // (PartnerDetailPage.tsx:501-508 treats any rejection as "nothing was written"). A failure here
    // is precisely the "missed completion event" the reconciler exists to repair (runbook R5).
    for (const snapshot of result.runoffSnapshots) {
      try {
        await completeRunoffIfDrained(this.prisma, cmd.companyId, snapshot.featureKey);
      } catch {
        // Swallowed on purpose. The lifecycle stays DRAINING, the health view shows it with a
        // rising age, and `sweepDrainingLifecycles` completes it on the next pass.
      }
    }

    return result.commandResult;
  }
}
