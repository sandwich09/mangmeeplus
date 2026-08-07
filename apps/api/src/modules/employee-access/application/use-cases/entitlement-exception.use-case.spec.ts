/**
 * UAT r7 P0-5 — the way OUT of a normalization dependency exception.
 *
 * REAL-DATABASE, because every property that matters here is invisible to a mock: that the resolve
 * actually writes rows and transitions, that the marker RESET puts the company back in the next
 * plan's pending set, that the snapshot CAS refuses a stale decision, and that a resolved company
 * then normalizes to COMPLETED on the ordinary path. It SKIPS (never fails) when no database is
 * reachable, so the suite still exits 0 without one.
 *
 * Safety: every company it writes is tagged `exc-<pid>-*` and hard-deleted afterwards.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../../generated/prisma/client';
import type { PrismaService } from '../../../../common/database/prisma.service';
import {
  ENTITLEMENT_NORMALIZATION_PENDING,
  SetPartnerFeaturesUseCase,
} from '../../../system-partner-management/application/use-cases/set-partner-features.use-case';
import {
  LEGACY_COHORT,
  normalizeAllCompanyEntitlements,
  normalizeCompanyEntitlements,
  verifyCompanyNormalizations,
} from '../normalize-entitlements';
import { EntitlementExceptionUseCase } from './entitlement-exception.use-case';

type Row = { featureKey: string; enabled: boolean };

const TAG = `exc-${process.pid}`;
/** The ruling-4b shape: a procurement child ON while `procurement.vendor_bills` is OFF. */
const EXCEPTION_ROWS: Row[] = [
  { featureKey: 'procurement', enabled: true },
  { featureKey: 'procurement.vendor_bills', enabled: false },
];

/**
 * The ROOT `.env` is the real local database (docker `127.0.0.1:15432/watchdog_bms`).
 * `apps/api/.env` carries a stale `5432/mydb` URL that only the Prisma CLI should ever see.
 */
function rootDatabaseUrl(): string | null {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = readFileSync(join(__dirname, '../'.repeat(7), '.env'), 'utf8');
    return /^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m.exec(env)?.[1] ?? null;
  } catch {
    return null;
  }
}

describe('entitlement dependency exception resolver (real database)', () => {
  let prisma: PrismaClient;
  let service: PrismaService;
  let resolver: EntitlementExceptionUseCase;
  let reachable = false;
  const created: string[] = [];
  const adminUserId = `${TAG}-admin`;

  const makeException = async (suffix: string, rows: Row[] = EXCEPTION_ROWS): Promise<string> => {
    const id = `${TAG}-${suffix}`;
    await prisma.company.create({ data: { id, name: `บริษัท ${suffix} จำกัด` } });
    created.push(id);
    await prisma.companyFeatureEntitlement.createMany({
      data: rows.map((row) => ({ companyId: id, featureKey: row.featureKey, enabled: row.enabled })),
    });
    // The normalizer is what parks the company: FAILED with the dependency-exception sentence.
    const run = await normalizeCompanyEntitlements(service, id, { runId: `${TAG}-${suffix}-plan` });
    assert.equal(run.status, 'EXCEPTION');
    return id;
  };
  const storedRows = (companyId: string) => prisma.companyFeatureEntitlement.findMany({
    where: { companyId },
    orderBy: { featureKey: 'asc' },
  });
  const listedFor = async (companyId: string) => (await resolver.list()).companies
    .find((company) => company.companyId === companyId);

  before(async () => {
    const url = rootDatabaseUrl();
    if (!url) return;
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    try {
      await prisma.$queryRaw`SELECT 1`;
      reachable = true;
    } catch {
      reachable = false;
    }
    service = { client: prisma } as unknown as PrismaService;
    resolver = new EntitlementExceptionUseCase(service);
    // The audit writes a real `actorUserId` FK, so the staff actor has to exist.
    if (reachable) await prisma.user.create({ data: { id: adminUserId, displayName: `${TAG} admin` } });
  });

  after(async () => {
    if (!prisma) return;
    if (reachable) {
      // AuditLog's company relation is optional (SetNull), so it must go before the cascade.
      await prisma.auditLog.deleteMany({ where: { companyId: { in: created } } });
      await prisma.auditLog.deleteMany({ where: { actorUserId: adminUserId } });
      await prisma.company.deleteMany({ where: { id: { in: created } } });
      await prisma.user.deleteMany({ where: { id: adminUserId } });
    }
    await prisma.$disconnect();
  });

  it('lists the blocked company by NAME, in Thai, with chosen-vs-required and both impacts', async (t) => {
    if (!reachable) return t.skip('no database');
    const companyId = await makeException('list');
    const listed = await listedFor(companyId);
    assert.ok(listed, 'the exception company is on the staff action list');
    assert.equal(listed.companyName, 'บริษัท list จำกัด');
    assert.match(listed.snapshotHash, /^[0-9a-f]{64}$/, 'the CAS fence staff echoes back');

    // Chosen = what the company has ON today; required = the prerequisite that is OFF.
    assert.deepEqual(listed.unmet.map((unmet) => unmet.chosenFeatureKey).sort(), [
      'procurement.ap_aging', 'procurement.supplier_payments',
    ]);
    assert.ok(listed.unmet.every((unmet) => unmet.requiredFeatureKey === 'procurement.vendor_bills'));
    // Human-readable: the Thai catalog label, never a bare key.
    assert.equal(listed.unmet[0]!.requiredLabelTh, 'จัดซื้อ/เจ้าหนี้ › ใบวางบิล');
    assert.ok(listed.unmet.every((unmet) => /[ก-๙]/.test(unmet.chosenLabelTh)), 'chosen labels are Thai too');

    const enable = listed.resolutions.find((option) => option.action === 'ENABLE_PREREQUISITE')!;
    const disable = listed.resolutions.find((option) => option.action === 'DISABLE_DEPENDENT')!;
    assert.deepEqual(enable.featureKeys, ['procurement.vendor_bills']);
    assert.equal(enable.evidenceRequired, false, 'preserving current usage needs no contract');
    assert.deepEqual(disable.featureKeys, ['procurement.ap_aging', 'procurement.supplier_payments']);
    assert.equal(disable.evidenceRequired, true, 'removing access does');
    assert.ok(/[ก-๙]/.test(enable.impactTh) && /[ก-๙]/.test(disable.impactTh));
  });

  it('ENABLE_PREREQUISITE turns the prerequisite on, resets the marker, and the next plan completes', async (t) => {
    if (!reachable) return t.skip('no database');
    const companyId = await makeException('enable');
    const listed = (await listedFor(companyId))!;

    const result = await resolver.resolve({
      companyId,
      action: 'ENABLE_PREREQUISITE',
      expectedSnapshotHash: listed.snapshotHash,
      reason: 'ลูกค้าใช้งานอยู่แล้ว',
      requestingAdminUserId: adminUserId,
      requestId: `${TAG}-enable-req`,
    });
    assert.equal(result.markerStatus, 'STARTED');
    assert.equal(result.setVersion, 1);
    assert.deepEqual(result.changed, [
      { featureKey: 'procurement.vendor_bills', fromEnabled: false, toEnabled: true },
    ]);

    const rows = await storedRows(companyId);
    assert.equal(rows.find((row) => row.featureKey === 'procurement.vendor_bills')?.enabled, true);
    assert.equal(rows.find((row) => row.featureKey === 'procurement.vendor_bills')?.epoch, 1, 'a real OFF→ON');
    assert.equal(
      rows.find((row) => row.featureKey === 'procurement.vendor_bills')?.grantOrigin,
      null,
      'a staff decision is EXPLICIT, never a grandfathered grant',
    );
    const transition = await prisma.entitlementTransition.findFirst({ where: { companyId } });
    assert.equal(transition?.action, 'ENABLE');
    assert.equal(transition?.actorUserId, adminUserId);
    assert.equal(
      (transition?.reasonJson as { dependencyExceptionResolution?: string }).dependencyExceptionResolution,
      'ENABLE_PREREQUISITE',
    );
    const audit = await prisma.auditLog.findFirst({
      where: { companyId, action: 'system.entitlement.dependency_resolve' },
    });
    assert.equal(audit?.riskLevel, 'HIGH');
    assert.equal((audit?.metadataJson as { resolution?: string }).resolution, 'ENABLE_PREREQUISITE');

    // The marker RESET is the point: the company is off the exception list and back in the plan.
    assert.equal(await listedFor(companyId), undefined);
    const marker = await prisma.companyEntitlementNormalization.findUnique({ where: { companyId } });
    assert.equal(marker?.status, 'STARTED');
    assert.equal(marker?.error, null);
    // UAT r8 A2 — the reset preserves the cohort. A resolved EXPLICIT company must not come back as
    // a grandfathered one, and a resolved LEGACY company must not lose the cohort it was parked in.
    assert.equal(marker?.cohortKind, LEGACY_COHORT, 'the cohort survives the round trip');

    const replanned = await normalizeAllCompanyEntitlements(service, {
      runId: `${TAG}-enable-replan`, companyIds: [companyId],
    });
    assert.equal(replanned.total, 1, 'the next PLAN includes the company fresh');
    assert.equal(replanned.completed, 1);
    assert.equal(replanned.dependencyExceptions, 0);
    assert.equal(
      (await prisma.companyEntitlementNormalization.findUnique({ where: { companyId } }))?.cohortKind,
      LEGACY_COHORT,
      'it was never normalized before, so it is still the grandfather cohort',
    );
    assert.deepEqual(await verifyCompanyNormalizations(service, { companyIds: [companyId] }), {
      total: 1, incomplete: 0, drifted: [], provenanceGaps: [],
    });

    // And the partner entitlement command — frozen for the whole life of the exception — works again.
    const command = new SetPartnerFeaturesUseCase(service, {} as never);
    const unfrozen = await command.execute({
      companyId,
      features: [{ featureKey: 'inventory', enabled: true }],
      requestingAdminUserId: adminUserId,
      requestId: `${TAG}-enable-unfrozen`,
      commandId: `${TAG}-enable-unfrozen`,
      expectedSetVersion: 2,
    });
    assert.equal(unfrozen.setVersion, 3, 'resolve took version 1, normalization 2, the command 3');
  });

  it('DISABLE_DEPENDENT needs evidence, then switches the dependent off and freezes it', async (t) => {
    if (!reachable) return t.skip('no database');
    const companyId = await makeException('disable');
    const listed = (await listedFor(companyId))!;
    const payload = {
      companyId,
      action: 'DISABLE_DEPENDENT' as const,
      expectedSnapshotHash: listed.snapshotHash,
      requestingAdminUserId: adminUserId,
      requestId: `${TAG}-disable-req`,
    };

    await assert.rejects(
      resolver.resolve(payload),
      (error: { getResponse(): { code?: string } }) => error.getResponse().code === 'entitlement_exception_evidence_required',
    );
    assert.equal(await prisma.entitlementTransition.count({ where: { companyId } }), 0, 'zero writes');
    assert.equal(
      (await prisma.companyEntitlementNormalization.findUnique({ where: { companyId } }))?.status,
      'FAILED',
      'a refused resolve does not reset the marker',
    );

    // Both choices are offered: freeze-in-place (owner decision 2026-08-04) means a disable always
    // succeeds, so the screen no longer has to steer the operator away from this one.
    const options = listed.resolutions;
    assert.equal(options.find((option) => option.action === 'ENABLE_PREREQUISITE')!.available, true);
    assert.equal(options.find((option) => option.action === 'DISABLE_DEPENDENT')!.available, true);

    // With evidence: the dependent children go off through the real lifecycle. `procurement` carries
    // PRE_CUTOFF_RUNOFF_ONLY rows in the matrix and still needs no builder — nothing runs off, the
    // rows stay stored and dormant, and the drain completes on its first pass.
    const result = await resolver.resolve({ ...payload, evidenceRef: 'CONTRACT-2026-0042' });
    assert.deepEqual(result.changed, [
      { featureKey: 'procurement.ap_aging', fromEnabled: true, toEnabled: false },
      { featureKey: 'procurement.supplier_payments', fromEnabled: true, toEnabled: false },
    ]);
    const disabledRows = await storedRows(companyId);
    assert.equal(disabledRows.find((row) => row.featureKey === 'procurement.supplier_payments')?.enabled, false);
    for (const featureKey of ['procurement.ap_aging', 'procurement.supplier_payments']) {
      const snapshot = await prisma.runoffSnapshot.findFirstOrThrow({ where: { companyId, featureKey } });
      assert.deepEqual((snapshot.rootsJson as { roots: unknown[] }).roots, [], 'an empty, immutable cutoff record');
    }
    const audit = await prisma.auditLog.findFirst({
      where: { companyId, action: 'system.entitlement.dependency_resolve' },
    });
    assert.equal((audit?.metadataJson as { resolution?: string }).resolution, 'DISABLE_DEPENDENT');
    assert.equal((audit?.metadataJson as { evidenceRef?: string }).evidenceRef, 'CONTRACT-2026-0042');

    // And the repair really is a repair: the dependency exception is gone.
    const replanned = await normalizeAllCompanyEntitlements(service, {
      runId: `${TAG}-disable-replan`, companyIds: [companyId],
    });
    assert.equal(replanned.dependencyExceptions, 0);
  });

  it('a stale snapshot cannot decide: the CAS refuses it with zero writes, twice over', async (t) => {
    if (!reachable) return t.skip('no database');
    const companyId = await makeException('cas');
    const listed = (await listedFor(companyId))!;
    const payload = {
      companyId,
      action: 'ENABLE_PREREQUISITE' as const,
      requestingAdminUserId: adminUserId,
      requestId: `${TAG}-cas-req`,
    };

    await assert.rejects(
      resolver.resolve({ ...payload, expectedSnapshotHash: 'f'.repeat(64) }),
      (error: { getResponse(): { code?: string } }) => error.getResponse().code === 'entitlement_exception_snapshot_conflict',
    );
    assert.equal(await prisma.entitlementTransition.count({ where: { companyId } }), 0);

    await resolver.resolve({ ...payload, expectedSnapshotHash: listed.snapshotHash });
    // The same reviewed snapshot, submitted twice: the marker is no longer FAILED, so it no-matches.
    await assert.rejects(
      resolver.resolve({ ...payload, expectedSnapshotHash: listed.snapshotHash, requestId: `${TAG}-cas-replay` }),
      (error: { getResponse(): { code?: string } }) => (
        error.getResponse().code === 'entitlement_exception_not_found'
      ),
    );
    assert.equal(
      await prisma.entitlementTransition.count({ where: { companyId } }),
      1,
      'exactly one transition — the replay wrote nothing',
    );
  });

  /**
   * UAT r8 A1 — THE journey the endpoint exists for, and the one it could not serve. A generic
   * release runs PLAN, which is read-only by ruling: it detects the dependency exception and writes
   * NO marker. Listing persisted `status:'FAILED'` markers therefore showed nothing, resolve
   * answered 404, and APPLY refused to run at all because the artifact was not approval-ready —
   * a closed loop with no way out.
   */
  it('UAT r8 A1: an exception a read-only PLAN found — with no marker at all — is listed and resolvable', async (t) => {
    if (!reachable) return t.skip('no database');
    const companyId = `${TAG}-planonly`;
    await prisma.company.create({ data: { id: companyId, name: 'บริษัท planonly จำกัด' } });
    created.push(companyId);
    await prisma.companyFeatureEntitlement.createMany({
      data: EXCEPTION_ROWS.map((row) => ({ companyId, featureKey: row.featureKey, enabled: row.enabled })),
    });

    const planned = await normalizeAllCompanyEntitlements(service, {
      runId: `${TAG}-planonly-plan`, companyIds: [companyId], dryRun: true,
    });
    assert.equal(planned.dependencyExceptions, 1, 'PLAN sees the exception');
    assert.equal(
      await prisma.companyEntitlementNormalization.count({ where: { companyId } }),
      0,
      'and writes nothing — there is no marker to list',
    );

    const listed = await listedFor(companyId);
    assert.ok(listed, 'the company is on the staff action list anyway, computed live');
    assert.equal(listed.runId, null, 'no pass parked it');
    assert.equal(listed.detectedAt, null);
    assert.match(listed.error, /procurement\.supplier_payments requires procurement\.vendor_bills/);
    assert.match(listed.snapshotHash, /^[0-9a-f]{64}$/);

    const stale = { ...listed, snapshotHash: 'b'.repeat(64) };
    await assert.rejects(
      resolver.resolve({
        companyId,
        action: 'ENABLE_PREREQUISITE',
        expectedSnapshotHash: stale.snapshotHash,
        requestingAdminUserId: adminUserId,
        requestId: `${TAG}-planonly-stale`,
      }),
      (error: { getResponse(): { code?: string } }) => error.getResponse().code === 'entitlement_exception_snapshot_conflict',
    );
    assert.equal(await prisma.entitlementTransition.count({ where: { companyId } }), 0, 'a stale hash writes nothing');
    assert.equal(await prisma.companyEntitlementSet.count({ where: { companyId } }), 0, 'not even a CAS root');

    const result = await resolver.resolve({
      companyId,
      action: 'ENABLE_PREREQUISITE',
      expectedSnapshotHash: listed.snapshotHash,
      requestingAdminUserId: adminUserId,
      requestId: `${TAG}-planonly-req`,
    });
    assert.equal(result.markerStatus, 'NONE', 'nothing to reset — and no marker is invented');
    assert.equal(await prisma.companyEntitlementNormalization.count({ where: { companyId } }), 0);
    assert.deepEqual(result.changed, [
      { featureKey: 'procurement.vendor_bills', fromEnabled: false, toEnabled: true },
    ]);

    // The point of the whole loop: the next PLAN is clean, so an artifact can finally be approved.
    const replanned = await normalizeAllCompanyEntitlements(service, {
      runId: `${TAG}-planonly-replan`, companyIds: [companyId], dryRun: true,
    });
    assert.equal(replanned.dependencyExceptions, 0);
    assert.equal(await listedFor(companyId), undefined, 'and it is off the action list');

    // ...and the APPLY that follows completes it as the grandfather cohort it always was.
    const applied = await normalizeAllCompanyEntitlements(service, {
      runId: `${TAG}-planonly-apply`, companyIds: [companyId],
    });
    assert.equal(applied.completed, 1);
    assert.equal(
      (await prisma.companyEntitlementNormalization.findUnique({ where: { companyId } }))?.cohortKind,
      LEGACY_COHORT,
    );
    assert.deepEqual(await verifyCompanyNormalizations(service, { companyIds: [companyId] }), {
      total: 1, incomplete: 0, drifted: [], provenanceGaps: [],
    });
  });

  it('a company with no open exception is refused, and the freeze it reports is the real one', async (t) => {
    if (!reachable) return t.skip('no database');
    const companyId = `${TAG}-clean`;
    await prisma.company.create({ data: { id: companyId, name: `บริษัท clean จำกัด` } });
    created.push(companyId);

    await assert.rejects(
      resolver.resolve({
        companyId,
        action: 'ENABLE_PREREQUISITE',
        expectedSnapshotHash: '0'.repeat(64),
        requestingAdminUserId: adminUserId,
        requestId: `${TAG}-clean-req`,
      }),
      (error: { getResponse(): { code?: string } }) => error.getResponse().code === 'entitlement_exception_not_found',
    );

    // The state this endpoint exists to escape: the partner command really is closed until then.
    const command = new SetPartnerFeaturesUseCase(service, {} as never);
    await assert.rejects(
      command.execute({
        companyId,
        features: [{ featureKey: 'crm', enabled: true }],
        requestingAdminUserId: adminUserId,
        requestId: `${TAG}-clean-frozen`,
        commandId: `${TAG}-clean-frozen`,
        expectedSetVersion: 0,
      }),
      (error: { getResponse(): { code?: string } }) => error.getResponse().code === ENTITLEMENT_NORMALIZATION_PENDING,
    );
  });
});
