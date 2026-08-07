/**
 * F2 / CC7 legacy entitlement normalization.
 *
 * Part 1 is pure: one plan assertion per F0.F cohort recipe
 * (`docs/agent-memory/f0-entitlement-cohorts-baseline.md` §A), because the plan IS the contract —
 * a wrong proposed value silently changes what a live company can do.
 *
 * Part 2 is a REAL-DATABASE spec, because the invariants that matter here are invisible to a mock:
 * an identical row must stay byte-untouched (a fake upsert cannot restamp `updatedAt`), a partner
 * command must actually unfreeze, and two concurrent passes must not both bump `setVersion`.
 * It SKIPS (never fails) when no database is reachable, so the suite still exits 0 without one.
 *
 * Safety: every company it writes is tagged `norm-<pid>-*` and hard-deleted afterwards. It never
 * touches a company it did not create.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { ALL_FEATURE_ENTITLEMENT_KEYS } from '@watchdog-bms/contracts';
import { PrismaClient } from '../../../generated/prisma/client';
import type { PrismaService } from '../../../common/database/prisma.service';
import {
  ENTITLEMENT_NORMALIZATION_PENDING,
  SetPartnerFeaturesUseCase,
} from '../../system-partner-management/application/use-cases/set-partner-features.use-case';
import {
  COHORT_KINDS,
  ENTITLEMENT_DEPENDENCY_EXCEPTION,
  EXPLICIT_COHORT,
  LEGACY_COHORT,
  LEGACY_GRANT_ORIGIN,
  NORMALIZER_VERSION,
  PLAN_FAILED,
  aggregateNormalizationHash,
  humanDecidedKeys,
  isCohortKind,
  normalizeAllCompanyEntitlements,
  normalizeCompanyEntitlements,
  planCompanyNormalization,
  verifyCompanyNormalizations,
} from './normalize-entitlements';

type Row = { featureKey: string; enabled: boolean };

const TAG = `norm-${process.pid}`;
const CANONICAL_COUNT = ALL_FEATURE_ENTITLEMENT_KEYS.length;

// A pure fixture has no transition log at all, so the human-decided set is provably empty.
const planOf = (rows: Row[]) => planCompanyNormalization('c1', rows, LEGACY_COHORT, new Set<string>());
const valueOf = (rows: Row[], key: string) => planOf(rows).proposedRows.find((r) => r.featureKey === key)?.enabled;

describe('F2 normalization plan — F0.F cohort recipes (pure)', () => {
  it('C0 zero-row fail-open: every canonical key materializes ON except expense_auto_post', () => {
    const plan = planOf([]);
    assert.equal(plan.proposedRows.length, CANONICAL_COUNT);
    assert.equal(plan.writes.length, CANONICAL_COUNT, 'a zero-row company writes every canonical row');
    // S-9: auto-post bypasses the evaluator and reads its row directly, so fail-open never posted.
    // Granting it here would start posting journals nobody asked for.
    assert.equal(valueOf([], 'expense_auto_post'), false);
    assert.equal(plan.proposedRows.filter((r) => !r.enabled).length, 1);
    assert.equal(
      plan.writes.find((w) => w.featureKey === 'expense_auto_post')?.reason,
      'AUTO_POST_IMPLICIT_OFF',
    );
    // Fail-open was effectively ON, so materialising it is storage normalization, not a new grant.
    assert.equal(plan.writes.find((w) => w.featureKey === 'crm')?.fromEnabled, true);
  });

  it('C3 inheritance-dependent: an absent target inherits from its enabled source', () => {
    const rows: Row[] = [{ featureKey: 'expenses', enabled: true }, { featureKey: 'crm', enabled: true }];
    assert.equal(valueOf(rows, 'reimbursement'), true, 'reimbursement inherits from expenses');
    assert.equal(valueOf(rows, 'product_catalog'), true, 'product_catalog inherits from crm');
    assert.equal(valueOf(rows, 'line_oa'), true, 'line_oa inherits from crm');
    assert.equal(valueOf(rows, 'inventory'), false, 'a key with no row and no source stays off');
    assert.equal(valueOf(rows, 'expense_auto_post'), false);
  });

  it('C4 parent-rows-only: submenus follow their parent, both ways', () => {
    const rows: Row[] = [{ featureKey: 'crm', enabled: true }, { featureKey: 'inventory', enabled: false }];
    assert.equal(valueOf(rows, 'crm.leads'), true);
    assert.equal(valueOf(rows, 'inventory.locations'), false);
    // DEFAULT_ON parents have no row at all here, and their submenus come on with them.
    assert.equal(valueOf(rows, 'employee_access'), true);
    assert.equal(valueOf(rows, 'employee_access.employees'), true);
  });

  it('C5 explicit-false always-on anomaly heals to true, and un-masks its submenus', () => {
    const rows: Row[] = [{ featureKey: 'company_settings', enabled: false }];
    assert.equal(valueOf(rows, 'company_settings'), true);
    assert.equal(valueOf(rows, 'company_settings.branches'), true);
    const write = planOf(rows).writes.find((w) => w.featureKey === 'company_settings');
    assert.deepEqual(
      { from: write?.fromEnabled, to: write?.toEnabled, reason: write?.reason },
      { from: false, to: true, reason: 'PLATFORM_INVARIANT_HEAL' },
    );
  });

  it('an explicit-true child under an OFF parent materializes FALSE (consumption semantics)', () => {
    const rows: Row[] = [{ featureKey: 'crm', enabled: false }, { featureKey: 'crm.leads', enabled: true }];
    assert.equal(valueOf(rows, 'crm.leads'), false);
    const write = planOf(rows).writes.find((w) => w.featureKey === 'crm.leads');
    // Its permissions were already stripped by the parent mask, so this is not a real ON→OFF.
    assert.deepEqual({ from: write?.fromEnabled, to: write?.toEnabled, reason: write?.reason }, {
      from: false, to: false, reason: 'PARENT_MASK',
    });
  });

  it('an unknown/orphan featureKey is snapshotted for removal and never proposed', () => {
    const plan = planOf([{ featureKey: 'crm', enabled: true }, { featureKey: 'not_a_real_feature', enabled: true }]);
    assert.deepEqual(plan.orphanRows, [{ featureKey: 'not_a_real_feature', enabled: true }]);
    assert.ok(!plan.proposedRows.some((r) => r.featureKey === 'not_a_real_feature'));
  });

  it('binds cohortKind into the plan hash even when the provenance sets are empty', () => {
    const decided = new Set(ALL_FEATURE_ENTITLEMENT_KEYS);
    const legacy = planCompanyNormalization('cohort-hash', [], LEGACY_COHORT, decided);
    const explicit = planCompanyNormalization('cohort-hash', [], EXPLICIT_COHORT, decided);
    const unresolved = planCompanyNormalization('cohort-hash', [], null, decided);
    assert.deepEqual(legacy.provenanceKeys, []);
    assert.deepEqual(explicit.provenanceKeys, []);
    assert.deepEqual(unresolved.provenanceKeys, []);
    assert.equal(legacy.cohortKind, LEGACY_COHORT);
    assert.equal(explicit.cohortKind, EXPLICIT_COHORT);
    assert.equal(unresolved.cohortKind, null);
    assert.notEqual(legacy.hash, explicit.hash);
    assert.notEqual(legacy.hash, unresolved.hash);
    assert.notEqual(explicit.hash, unresolved.hash);
  });

  it('expense_auto_post keeps an explicit true and is never written — while its ledger is on', () => {
    const rows: Row[] = [
      { featureKey: 'expense_auto_post', enabled: true },
      { featureKey: 'double_entry_ledger', enabled: true },
    ];
    assert.equal(valueOf(rows, 'expense_auto_post'), true);
    assert.deepEqual(planOf(rows).dependencyFindings, []);
    assert.ok(!planOf(rows).writes.some((w) => w.featureKey === 'expense_auto_post'));
  });

  it('ruling 4a: auto-post without the ledger is masked OFF, and the ledger is never auto-enabled', () => {
    const rows: Row[] = [{ featureKey: 'expense_auto_post', enabled: true }, { featureKey: 'expenses', enabled: true }];
    const plan = planOf(rows);
    assert.deepEqual(plan.dependencyFindings, [
      { featureKey: 'expense_auto_post', requiresFeatureKey: 'double_entry_ledger', action: 'MASKED_OFF' },
    ]);
    assert.equal(valueOf(rows, 'expense_auto_post'), false);
    // Enabling the ledger instead would leave auto-post's stale `updatedAt` as the drain cutoff and
    // backfill-post every old expense; masking is the only direction that cannot post anything.
    assert.equal(valueOf(rows, 'double_entry_ledger'), false);
    const write = plan.writes.find((w) => w.featureKey === 'expense_auto_post');
    assert.deepEqual({ from: write?.fromEnabled, to: write?.toEnabled, reason: write?.reason }, {
      from: true, to: false, reason: 'DEPENDENCY_MASK',
    });
  });

  it('ruling 4b: a procurement child without vendor_bills is an EXCEPTION, never a silent fix', () => {
    const rows: Row[] = [
      { featureKey: 'procurement', enabled: true },
      { featureKey: 'procurement.vendor_bills', enabled: false },
    ];
    const plan = planOf(rows);
    assert.deepEqual(plan.dependencyFindings, [
      { featureKey: 'procurement.ap_aging', requiresFeatureKey: 'procurement.vendor_bills', action: 'EXCEPTION' },
      { featureKey: 'procurement.supplier_payments', requiresFeatureKey: 'procurement.vendor_bills', action: 'EXCEPTION' },
    ]);
    // The plan still proposes them ON: nothing is masked, because staff owns this decision.
    assert.equal(valueOf(rows, 'procurement.supplier_payments'), true);
  });

  it('the hash is deterministic over row order and sensitive to any change', () => {
    const a: Row[] = [{ featureKey: 'crm', enabled: true }, { featureKey: 'expenses', enabled: false }];
    assert.equal(planOf(a).hash, planOf([...a].reverse()).hash);
    assert.notEqual(planOf(a).hash, planOf([{ featureKey: 'crm', enabled: true }]).hash);
  });

  /**
   * UAT r8 A3 — `cohortKind` is free text in Prisma (migration `20260803160000_cohort_kind_check`
   * adds the CHECK the schema cannot express), and verify used to test only `=== null` and
   * `=== LEGACY`, so ANY other value read as EXPLICIT — the cohort that waives the grandfather
   * provenance check. A stub client is the only way to exercise it now that the database itself
   * refuses to store the value.
   */
  it('UAT r8 A3: a cohortKind outside LEGACY|EXPLICIT is INCOMPLETE and named, never read as EXPLICIT', async () => {
    assert.deepEqual([...COHORT_KINDS], [LEGACY_COHORT, EXPLICIT_COHORT]);
    assert.equal(isCohortKind('legacy'), false, 'the check is exact, not case-insensitive');
    assert.equal(isCohortKind(null), false);

    const log: string[] = [];
    const stub = {
      client: {
        company: {
          findMany: async () => [{
            id: 'c-typo',
            entitlementNormalization: {
              status: 'COMPLETED',
              normalizerVersion: NORMALIZER_VERSION,
              completedAt: new Date(),
              cohortKind: 'legacy',
            },
          }],
        },
      },
    } as unknown as PrismaService;

    const verified = await verifyCompanyNormalizations(stub, { log: (message) => log.push(message) });
    assert.equal(verified.incomplete, 1);
    assert.match(log.join('\n'), /c-typo INCOMPLETE .*cohort=INVALID\(legacy\)/);
  });
});

/**
 * The ROOT `.env` is the real local database (docker `127.0.0.1:15432/watchdog_bms`).
 * `apps/api/.env` carries a stale `5432/mydb` URL that only the Prisma CLI should ever see.
 */
function rootDatabaseUrl(): string | null {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = readFileSync(join(__dirname, '../'.repeat(6), '.env'), 'utf8');
    return /^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m.exec(env)?.[1] ?? null;
  } catch {
    return null;
  }
}

describe('F2 normalization writes (real database)', () => {
  let prisma: PrismaClient;
  let service: PrismaService;
  let reachable = false;
  let databaseUrl = '';
  const created: string[] = [];
  const adminUserIds: string[] = [];

  const makeCompany = async (suffix: string, rows: Row[]): Promise<string> => {
    const id = `${TAG}-${suffix}`;
    await prisma.company.create({ data: { id, name: `${TAG} ${suffix}` } });
    created.push(id);
    if (rows.length > 0) {
      await prisma.companyFeatureEntitlement.createMany({
        data: rows.map((row) => ({ companyId: id, featureKey: row.featureKey, enabled: row.enabled })),
      });
    }
    return id;
  };
  const storedRows = (companyId: string) => prisma.companyFeatureEntitlement.findMany({
    where: { companyId },
    orderBy: { featureKey: 'asc' },
  });

  before(async () => {
    const url = rootDatabaseUrl();
    if (!url) return;
    databaseUrl = url;
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    try {
      await prisma.$queryRaw`SELECT 1`;
      reachable = true;
    } catch {
      reachable = false;
    }
    service = { client: prisma } as unknown as PrismaService;
  });

  after(async () => {
    if (!prisma) return;
    if (reachable && created.length > 0) {
      // AuditLog's company relation is optional (SetNull), so it must go before the cascade.
      await prisma.auditLog.deleteMany({ where: { companyId: { in: created } } });
      await prisma.companyOnboardingRun.deleteMany({ where: { companyId: { in: created } } });
      await prisma.company.deleteMany({ where: { id: { in: created } } });
    }
    if (reachable && adminUserIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { actorUserId: { in: adminUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: adminUserIds } } });
    }
    await prisma.$disconnect();
  });

  it('C0 fail-open company: materializes every row as LEGACY and marks COMPLETED', async (t) => {
    if (!reachable) return t.skip('no database');
    const companyId = await makeCompany('c0', []);

    const dry = await normalizeCompanyEntitlements(service, companyId, { runId: `${TAG}-dry`, dryRun: true });
    assert.equal(dry.status, 'DRY_RUN');
    assert.equal(dry.cohortKind, LEGACY_COHORT);
    assert.equal(dry.cohortEvidence, 'FIRST_NORMALIZATION_RULE');
    assert.equal((await storedRows(companyId)).length, 0, 'a dry run writes nothing');

    const run = await normalizeCompanyEntitlements(service, companyId, { runId: `${TAG}-c0` });
    assert.equal(run.status, 'COMPLETED');
    assert.equal(run.hash, dry.hash, 'the executed hash matches the dry-run hash');
    assert.equal(run.written, CANONICAL_COUNT);
    assert.equal(run.setVersion, 1);

    const rows = await storedRows(companyId);
    assert.equal(rows.length, CANONICAL_COUNT);
    // CC7 ruling 5 — the grandfather marker records ACCESS. Every ON row carries it; the one OFF
    // row (auto-post) does not, because absence is not something to grandfather.
    assert.ok(rows.filter((row) => row.enabled).every((row) => row.grantOrigin === LEGACY_GRANT_ORIGIN));
    assert.equal(rows.find((r) => r.featureKey === 'expense_auto_post')?.grantOrigin, null);
    assert.equal(rows.find((r) => r.featureKey === 'expense_auto_post')?.enabled, false);
    // Already effectively ON: materializing must not invalidate live claims fenced on the epoch.
    assert.ok(rows.every((row) => row.epoch === 0 && row.lastSeq === 1));

    const marker = await prisma.companyEntitlementNormalization.findUnique({ where: { companyId } });
    assert.equal(marker?.status, 'COMPLETED');
    assert.equal(marker?.snapshotHash, run.hash);
    assert.ok(marker?.completedAt);
    assert.equal(await prisma.entitlementTransition.count({ where: { companyId } }), CANONICAL_COUNT);
  });

  it('re-run is an idempotent no-op: zero writes, setVersion frozen', async (t) => {
    if (!reachable) return t.skip('no database');
    const companyId = `${TAG}-c0`;
    const before = await prisma.companyEntitlementSet.findUnique({ where: { companyId } });
    const again = await normalizeCompanyEntitlements(service, companyId, { runId: `${TAG}-c0-again` });
    assert.equal(again.status, 'ALREADY_COMPLETED');
    assert.equal(again.cohortKind, LEGACY_COHORT);
    assert.equal(again.cohortEvidence, 'EXISTING_MARKER');
    assert.equal(again.written, 0);
    assert.equal(
      (await prisma.companyEntitlementSet.findUnique({ where: { companyId } }))?.setVersion,
      before?.setVersion,
    );
    assert.equal(await prisma.entitlementTransition.count({ where: { companyId } }), CANONICAL_COUNT);
  });

  it('identical rows stay byte-untouched but still get LEGACY, and auto-post keeps its cutoff', async (t) => {
    if (!reachable) return t.skip('no database');
    // Explicit auto-post ON is the row whose `updatedAt` the drain worker uses as its cutoff
    // (expense-auto-post.use-case.ts:94). A rewrite would silently re-scope the worker.
    const companyId = await makeCompany('autopost', [
      { featureKey: 'expense_auto_post', enabled: true },
      { featureKey: 'double_entry_ledger', enabled: true },
      { featureKey: 'crm', enabled: false },
    ]);
    const before = new Map((await storedRows(companyId)).map((r) => [r.featureKey, r.updatedAt.getTime()]));
    await new Promise((resolve) => setTimeout(resolve, 15));

    const run = await normalizeCompanyEntitlements(service, companyId, { runId: `${TAG}-autopost` });
    assert.equal(run.status, 'COMPLETED');
    assert.equal(run.unchanged, 3, 'the three pre-existing rows already matched their effective value');

    const after = await storedRows(companyId);
    for (const [featureKey, stamp] of before) {
      const row = after.find((r) => r.featureKey === featureKey)!;
      assert.equal(row.updatedAt.getTime(), stamp, `${featureKey} must not be rewritten`);
      // CC7 ruling 5 — an ON row whose stored value already agreed is just as grandfathered, and is
      // stamped by the raw-SQL provenance pass. That path is the only reason `updatedAt` above can
      // still be byte-identical: any Prisma write here would restamp it.
      assert.equal(
        row.grantOrigin,
        row.enabled ? LEGACY_GRANT_ORIGIN : null,
        `${featureKey}: ON rows carry LEGACY, OFF rows carry nothing`,
      );
    }
    assert.equal(after.find((r) => r.featureKey === 'expense_auto_post')?.enabled, true);
    assert.equal(await prisma.entitlementTransition.count({ where: { companyId } }), run.written);
  });

  it('an always-on explicit false heals ON with a real epoch bump; an orphan key is audited then removed', async (t) => {
    if (!reachable) return t.skip('no database');
    const companyId = await makeCompany('anomaly', [
      { featureKey: 'company_settings', enabled: false },
      { featureKey: 'not_a_real_feature', enabled: true },
    ]);
    const run = await normalizeCompanyEntitlements(service, companyId, { runId: `${TAG}-anomaly` });
    assert.equal(run.removed, 1);
    assert.deepEqual(run.orphanRows, [{ featureKey: 'not_a_real_feature', enabled: true }]);

    const rows = await storedRows(companyId);
    assert.ok(!rows.some((r) => r.featureKey === 'not_a_real_feature'), 'the orphan row is gone');
    const healed = rows.find((r) => r.featureKey === 'company_settings')!;
    assert.equal(healed.enabled, true);
    assert.equal(healed.epoch, 1, 'a real OFF→ON is the one case that bumps the epoch');
    assert.equal(healed.grantOrigin, LEGACY_GRANT_ORIGIN);
    assert.equal(rows.find((r) => r.featureKey === 'company_settings.branches')?.enabled, true);

    const audit = await prisma.auditLog.findFirst({
      where: { companyId, action: 'system.entitlement.normalize' },
    });
    const metadata = audit?.metadataJson as { removedOrphanRows?: unknown[]; snapshotHash?: string };
    assert.deepEqual(metadata.removedOrphanRows, [{ featureKey: 'not_a_real_feature', enabled: true }]);
    assert.equal(metadata.snapshotHash, run.hash);
  });

  it('ruling 4a: auto-post without its ledger is masked OFF with no epoch bump', async (t) => {
    if (!reachable) return t.skip('no database');
    const companyId = await makeCompany('depmask', [
      { featureKey: 'expense_auto_post', enabled: true },
      { featureKey: 'expenses', enabled: true },
    ]);
    const run = await normalizeCompanyEntitlements(service, companyId, { runId: `${TAG}-depmask` });
    assert.equal(run.status, 'COMPLETED');
    assert.deepEqual(run.dependencyFindings, [
      { featureKey: 'expense_auto_post', requiresFeatureKey: 'double_entry_ledger', action: 'MASKED_OFF' },
    ]);

    const rows = await storedRows(companyId);
    const autoPost = rows.find((r) => r.featureKey === 'expense_auto_post')!;
    assert.equal(autoPost.enabled, false);
    assert.equal(autoPost.epoch, 0, 'a mask is a withdrawal, never a grant — the epoch cannot move');
    assert.equal(autoPost.grantOrigin, null, 'OFF is not grandfathered access');
    assert.equal(rows.find((r) => r.featureKey === 'double_entry_ledger')?.enabled, false, 'never auto-enabled');
    const transition = await prisma.entitlementTransition.findFirst({
      where: { companyId, featureKey: 'expense_auto_post' },
    });
    assert.equal(transition?.action, 'OFF');
    assert.equal(transition?.epoch, 0);
    assert.equal((transition?.reasonJson as { reason?: string }).reason, 'DEPENDENCY_MASK');
  });

  it('ruling 4b: a procurement child without vendor_bills blocks COMPLETED and writes nothing', async (t) => {
    if (!reachable) return t.skip('no database');
    const companyId = await makeCompany('procdep', [
      { featureKey: 'procurement', enabled: true },
      { featureKey: 'procurement.vendor_bills', enabled: false },
    ]);
    const run = await normalizeCompanyEntitlements(service, companyId, { runId: `${TAG}-procdep` });
    assert.equal(run.status, 'EXCEPTION');
    assert.equal(run.written, 0);
    assert.equal((await storedRows(companyId)).length, 2, 'the company is left exactly as it was');
    assert.equal(await prisma.companyEntitlementSet.count({ where: { companyId } }), 0, 'no CAS root, no version');
    assert.equal(await prisma.entitlementTransition.count({ where: { companyId } }), 0);

    const marker = await prisma.companyEntitlementNormalization.findUnique({ where: { companyId } });
    assert.equal(marker?.status, 'FAILED');
    assert.ok(marker?.error?.startsWith(ENTITLEMENT_DEPENDENCY_EXCEPTION), marker?.error ?? 'no error recorded');
    assert.ok(marker?.error?.includes('procurement.supplier_payments requires procurement.vendor_bills'));
    // UAT r8 A2 — the parked marker carries the cohort the plan ran under. Without it, being parked
    // is how a legacy company LOSES its cohort: every later pass then sees "seen before, no cohort".
    assert.equal(marker?.cohortKind, LEGACY_COHORT, 'a parked exception keeps its cohort');

    // What the release task reports: still incomplete, and support-visible in the summary.
    const all = await normalizeAllCompanyEntitlements(service, { runId: `${TAG}-procdep-all`, companyIds: [companyId] });
    assert.equal(all.dependencyExceptions, 1);
    assert.equal(all.failed, 1);
    assert.equal(all.normalizationIncomplete, 1, 'the deploy gate reads this number');
    assert.equal((await verifyCompanyNormalizations(service, { companyIds: [companyId] })).incomplete, 1);
  });

  it('ruling 5: a marker below the running normalizer version is re-opened and repaired', async (t) => {
    if (!reachable) return t.skip('no database');
    const companyId = await makeCompany('version', [{ featureKey: 'crm', enabled: true }]);
    await normalizeCompanyEntitlements(service, companyId, { runId: `${TAG}-version-1` });
    assert.equal(
      (await normalizeAllCompanyEntitlements(service, { runId: `${TAG}-version-skip`, companyIds: [companyId] })).total,
      0,
      'a company at the current version is not re-planned',
    );

    // Lowering the stored version is the mirror image of raising NORMALIZER_VERSION, and needs no
    // production seam. Deleting a row is the drift the raised version is supposed to repair.
    await prisma.companyEntitlementNormalization.update({
      where: { companyId },
      data: { normalizerVersion: NORMALIZER_VERSION - 1 },
    });
    await prisma.companyFeatureEntitlement.deleteMany({ where: { companyId, featureKey: 'crm.leads' } });

    const rerun = await normalizeAllCompanyEntitlements(service, { runId: `${TAG}-version-2`, companyIds: [companyId] });
    assert.equal(rerun.total, 1, 'version < current re-opens an already-COMPLETED company');
    assert.equal(rerun.completed, 1);
    const repaired = (await storedRows(companyId)).find((r) => r.featureKey === 'crm.leads');
    assert.equal(repaired?.enabled, true, 'the repair pass restored the row');
    // UAT r8 A2 — the stamp follows the COHORT, not "is this the first pass". This company is in the
    // grandfather cohort, and verify demands the marker on EVERY effective-ON row after each pass;
    // leaving a re-created row unstamped was a provenance gap nothing could ever close, because the
    // repair also moves `completedAt` past the transition that would have exempted it.
    assert.equal(repaired?.grantOrigin, LEGACY_GRANT_ORIGIN);
    assert.equal(
      (await prisma.companyEntitlementNormalization.findUnique({ where: { companyId } }))?.normalizerVersion,
      NORMALIZER_VERSION,
    );
    assert.deepEqual(await verifyCompanyNormalizations(service, { companyIds: [companyId] }), {
      total: 1, incomplete: 0, drifted: [], provenanceGaps: [],
    }, 'a repaired LEGACY company is a clean fixed point, provenance included');
  });

  it('the partner entitlement command is frozen before normalization and unfrozen after', async (t) => {
    if (!reachable) return t.skip('no database');
    const companyId = await makeCompany('partner', [{ featureKey: 'crm', enabled: true }]);
    // The partner command audits with a real `actorUserId` FK, so the actor has to exist.
    const adminUserId = `${TAG}-admin`;
    await prisma.user.create({ data: { id: adminUserId, displayName: `${TAG} admin` } });
    adminUserIds.push(adminUserId);
    const command = new SetPartnerFeaturesUseCase(service, {} as never);
    const payload = { companyId, features: [{ featureKey: 'crm', enabled: true }], requestingAdminUserId: adminUserId };

    await assert.rejects(
      command.execute({
        ...payload,
        requestId: `${TAG}-frozen`,
        commandId: `${TAG}-frozen`,
        expectedSetVersion: 0,
      }),
      (error: { getResponse(): { code?: string } }) => error.getResponse().code === ENTITLEMENT_NORMALIZATION_PENDING,
    );
    assert.equal(await prisma.companyEntitlementSet.count({ where: { companyId } }), 0, 'zero rows written');

    await normalizeCompanyEntitlements(service, companyId, { runId: `${TAG}-partner` });
    const result = await command.execute({
      ...payload,
      requestId: `${TAG}-unfrozen`,
      commandId: `${TAG}-unfrozen`,
      expectedSetVersion: 1,
    });
    assert.equal(result.setVersion, 2, 'normalization took version 1; the partner command takes 2');
  });

  it('ruling 5: the partner command clears grantOrigin on any row it writes', async (t) => {
    if (!reachable) return t.skip('no database');
    const companyId = `${TAG}-partner`;
    const adminUserId = `${TAG}-admin`;
    // After normalization no OFF row carries LEGACY — that IS ruling 5 — so this fixture recreates
    // the one shape the clearing rule exists for: a grandfathered grant that some later lifecycle
    // switched off and an operator now decides explicitly.
    await prisma.$executeRaw`
      UPDATE "CompanyFeatureEntitlement" SET "enabled" = false, "grantOrigin" = 'LEGACY'
       WHERE "companyId" = ${companyId} AND "featureKey" = 'inventory'`;

    const command = new SetPartnerFeaturesUseCase(service, {} as never);
    await command.execute({
      companyId,
      features: [{ featureKey: 'inventory', enabled: true }],
      requestingAdminUserId: adminUserId,
      requestId: `${TAG}-explicit`,
      commandId: `${TAG}-explicit`,
      expectedSetVersion: 2,
    });

    const row = (await storedRows(companyId)).find((r) => r.featureKey === 'inventory')!;
    assert.equal(row.enabled, true);
    assert.equal(row.grantOrigin, null, 'an operator decision is EXPLICIT, never a grandfathered grant');
    // The rows the command did not SUBMIT keep their cohort marker. (`crm` is not one of them: an
    // earlier test in this file re-confirms it through the same command, and re-submitting a legacy
    // row at the value it already has is an explicit decision that clears the marker too.)
    assert.equal((await storedRows(companyId)).find((r) => r.featureKey === 'crm.leads')?.grantOrigin, LEGACY_GRANT_ORIGIN);
  });

  it('two concurrent passes: exactly one writes, the loser observes COMPLETED and skips', async (t) => {
    if (!reachable) return t.skip('no database');
    const companyId = await makeCompany('race', [{ featureKey: 'expenses', enabled: true }]);
    const [a, b] = await Promise.all([
      normalizeCompanyEntitlements(service, companyId, { runId: `${TAG}-race-a` }),
      normalizeCompanyEntitlements(service, companyId, { runId: `${TAG}-race-b` }),
    ]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, ['ALREADY_COMPLETED', 'COMPLETED']);
    assert.equal(a.hash, b.hash, 'both passes computed the same deterministic plan');
    assert.equal(
      (await prisma.companyEntitlementSet.findUnique({ where: { companyId } }))?.setVersion,
      1,
      'setVersion moves exactly once',
    );
    const written = (a.status === 'COMPLETED' ? a : b).written;
    assert.equal(await prisma.entitlementTransition.count({ where: { companyId } }), written);
  });

  it('the all-companies runner reports completed/skipped/failed and drives incomplete to zero', async (t) => {
    if (!reachable) return t.skip('no database');
    // Scoped to this spec's own companies: an unscoped pass would normalize whatever database the
    // suite happens to point at.
    const companyIds = [await makeCompany('runner-1', []), await makeCompany('runner-2', [{ featureKey: 'inventory', enabled: true }])];

    const dry = await normalizeAllCompanyEntitlements(service, { runId: `${TAG}-runner-dry`, companyIds, dryRun: true });
    assert.equal(dry.total, 2);
    assert.equal(dry.failed, 0);
    assert.equal(dry.normalizationIncomplete, 2, 'a dry run leaves every company pending');

    const run = await normalizeAllCompanyEntitlements(service, { runId: `${TAG}-runner`, companyIds, concurrency: 4 });
    assert.equal(run.completed, 2);
    assert.equal(run.failed, 0);
    assert.deepEqual(run.errors, []);
    assert.equal(run.normalizationIncomplete, 0, 'the deploy gate reads this number');
    assert.equal(run.companies.length, 2, 'the artifact gets one entry per company');
    assert.equal(
      (await normalizeAllCompanyEntitlements(service, { runId: `${TAG}-runner-2`, companyIds })).total,
      0,
      'a second pass has nothing left to do',
    );

    // Ruling 3c — the post-apply check: the stored rows must already BE the plan's fixed point.
    assert.deepEqual(await verifyCompanyNormalizations(service, { companyIds }), {
      total: 2,
      incomplete: 0,
      drifted: [],
      provenanceGaps: [],
    });
  });

  /**
   * UAT r6 item 2 — the provenance stamp is a REAL mutation that `writes` never reports, because it
   * is a raw UPDATE of one column on rows whose value is already correct. Before this, the plan hash
   * excluded it: the artifact under-reported what an apply changes, and the verify pass could not
   * tell a fully-stamped company from an unstamped one.
   */
  it('provenance is in the plan hash and the verify pass checks it landed', async (t) => {
    if (!reachable) return t.skip('no database');
    const companyId = await makeCompany('provenance', [
      { featureKey: 'crm', enabled: true },
      { featureKey: 'double_entry_ledger', enabled: true },
      { featureKey: 'expense_auto_post', enabled: true },
    ]);
    const rows = await storedRows(companyId);

    // The hash MOVES purely because the cohort changes — nothing else about the plan differs. The
    // human-decided set is loaded exactly as the runner loads it, so `run.hash === legacy.hash`
    // below is real evidence that PLAN and APPLY agree on the same planner inputs.
    const decided = await humanDecidedKeys(prisma, companyId);
    assert.equal(decided.size, 0, 'nothing human has touched this company yet');
    const legacy = planCompanyNormalization(companyId, rows, LEGACY_COHORT, decided);
    const repair = planCompanyNormalization(companyId, rows, EXPLICIT_COHORT, decided);
    assert.notEqual(legacy.hash, repair.hash, 'the grantOrigin stamp must change the hash');
    assert.deepEqual(repair.provenanceKeys, [], 'a repair pass re-labels nothing');

    // The point of the whole change: rows that get stamped but are NOT written.
    const writtenKeys = new Set(legacy.writes.map((write) => write.featureKey));
    const stampedButUnwritten = legacy.provenanceKeys.filter((key) => !writtenKeys.has(key));
    assert.ok(stampedButUnwritten.length > 0, 'writes alone cannot describe this mutation');

    const dry = await normalizeAllCompanyEntitlements(service, {
      runId: `${TAG}-prov-dry`, companyIds: [companyId], dryRun: true,
    });
    assert.equal(dry.companies[0]?.provenance, legacy.provenanceKeys.length, 'the artifact reports the stamp count');

    const run = await normalizeCompanyEntitlements(service, companyId, { runId: `${TAG}-prov` });
    assert.equal(run.status, 'COMPLETED');
    assert.equal(run.hash, legacy.hash, 'the executed plan is the one whose hash was published');
    assert.equal(run.provenance, legacy.provenanceKeys.length);
    const stamped = await storedRows(companyId);
    assert.ok(
      stamped.filter((row) => row.enabled).every((row) => row.grantOrigin === LEGACY_GRANT_ORIGIN),
      'every effective-ON row carries the cohort marker',
    );
    assert.deepEqual(await verifyCompanyNormalizations(service, { companyIds: [companyId] }), {
      total: 1, incomplete: 0, drifted: [], provenanceGaps: [],
    });

    // Drop the stamp from one ON row WITHOUT touching its value: the fixed-point check still passes
    // (the values are right), so provenance is the only thing that can catch it.
    await prisma.$executeRaw`
      UPDATE "CompanyFeatureEntitlement" SET "grantOrigin" = NULL
       WHERE "companyId" = ${companyId} AND "featureKey" = 'crm'`;
    const gapped = await verifyCompanyNormalizations(service, { companyIds: [companyId] });
    assert.deepEqual(gapped.drifted, [], 'the values are still the plan fixed point');
    assert.deepEqual(gapped.provenanceGaps, [{ companyId, missing: ['crm'] }]);

    /**
     * UAT r8 A4 — the other side of the rule: an OPERATOR decision legitimately clears the marker on
     * a row that stays ON (SetPartnerFeaturesUseCase does exactly this), and without an exemption
     * the deploy gate would fail permanently after any partner entitlement change. The exemption is
     * a durable `EntitlementTransition` AFTER the pass — not a fresh `updatedAt`, which any write at
     * all produces and which would therefore waive the check for something nobody decided.
     */
    await prisma.companyFeatureEntitlement.update({
      where: { companyId_featureKey: { companyId, featureKey: 'crm' } },
      data: { grantOrigin: null },
    });
    assert.deepEqual(
      (await verifyCompanyNormalizations(service, { companyIds: [companyId] })).provenanceGaps,
      [{ companyId, missing: ['crm'] }],
      'a bare row write restamps updatedAt and must NOT exempt anything',
    );

    await prisma.entitlementTransition.create({
      data: {
        companyId,
        featureKey: 'crm',
        seq: 9_001,
        epoch: 0,
        commandId: `${TAG}-prov-operator`,
        action: 'ENABLE',
        actorUserId: `${TAG}-operator`,
        reasonJson: { explicitDecision: true },
      },
    });
    assert.deepEqual(
      (await verifyCompanyNormalizations(service, { companyIds: [companyId] })).provenanceGaps,
      [],
      'a key an operator decided after the pass is EXPLICIT, not a missing stamp',
    );
  });

  it('the aggregate hash is order-independent and moves on membership or content drift', async (t) => {
    if (!reachable) return t.skip('no database');
    const first = await makeCompany('agg-1', [{ featureKey: 'crm', enabled: true }]);
    const second = await makeCompany('agg-2', [{ featureKey: 'inventory', enabled: true }]);
    const planFor = async (companyIds: string[]) => (await normalizeAllCompanyEntitlements(service, {
      runId: `${TAG}-agg`, companyIds, dryRun: true,
    })).aggregateHash;

    const both = await planFor([first, second]);
    assert.equal(await planFor([second, first]), both, 'the concurrent runner returns results in any order');
    assert.notEqual(await planFor([first]), both, 'a company leaving the pending set moves the hash');

    // Content drift: the same two companies, one of them changed.
    await prisma.companyFeatureEntitlement.update({
      where: { companyId_featureKey: { companyId: first, featureKey: 'crm' } },
      data: { enabled: false },
    });
    assert.notEqual(await planFor([first, second]), both, 'changed rows move the hash');
    assert.equal(aggregateNormalizationHash([]), aggregateNormalizationHash([]), 'an empty estate is a stable constant');
  });

  /**
   * UAT r7 P0-4 — the aggregate hash was checked ONCE and then a fresh runner re-planned everything,
   * so a company whose rows moved in between was applied from a plan no human saw (its own retry
   * re-planned it on conflict). Binding each company to its reviewed plan hash is what closes it,
   * and the property that matters is that ONE drifted company is a permanent local failure: no
   * retry, no writes, and every other company still commits.
   */
  it('P0-4: post-review drift fails that company permanently while the others commit', async (t) => {
    if (!reachable) return t.skip('no database');
    const drifted = await makeCompany('bound-drift', [{ featureKey: 'crm', enabled: true }]);
    const clean = await makeCompany('bound-clean', [{ featureKey: 'inventory', enabled: true }]);
    const companyIds = [drifted, clean];

    const reviewed = await normalizeAllCompanyEntitlements(service, {
      runId: `${TAG}-bound-plan`, companyIds, dryRun: true,
    });
    assert.deepEqual(Object.keys(reviewed.planHashes).sort(), [...companyIds].sort());

    // The drift the aggregate preflight cannot see: it happens AFTER the estate was re-checked.
    await prisma.companyFeatureEntitlement.update({
      where: { companyId_featureKey: { companyId: drifted, featureKey: 'crm' } },
      data: { enabled: false },
    });

    const log: string[] = [];
    const applied = await normalizeAllCompanyEntitlements(service, {
      runId: `${TAG}-bound-apply`,
      companyIds,
      approvedPlanHashes: reviewed.planHashes,
      log: (message) => log.push(message),
    });
    assert.equal(applied.failed, 1);
    assert.equal(applied.completed, 1);
    assert.match(applied.errors[0]!.error, /entitlement_normalization_plan_not_approved/);
    assert.equal(applied.errors[0]!.companyId, drifted);
    // No retry-with-a-new-plan: one attempt, then a permanent failure for this run.
    assert.ok(!log.some((line) => line.includes('retrying after')), log.join('\n'));

    // Zero writes for the drifted company — not even the marker that would freeze it further.
    assert.equal((await storedRows(drifted)).length, 1, 'nothing was materialized');
    assert.equal(await prisma.companyEntitlementNormalization.count({ where: { companyId: drifted } }), 0);
    assert.equal(await prisma.entitlementTransition.count({ where: { companyId: drifted } }), 0);
    assert.equal(await prisma.companyEntitlementSet.count({ where: { companyId: drifted } }), 0);

    // (d) per-company commits: the clean company is COMPLETED and durable, not rolled back with it.
    const marker = await prisma.companyEntitlementNormalization.findUnique({ where: { companyId: clean } });
    assert.equal(marker?.status, 'COMPLETED');
    assert.equal(marker?.cohortKind, LEGACY_COHORT);
    assert.equal(marker?.normalizerVersion, NORMALIZER_VERSION);

    // (d) verify still answers after a partial apply — the failure list alone cannot say which
    // companies are actually fine.
    const verified = await verifyCompanyNormalizations(service, { companyIds });
    assert.equal(verified.total, 2);
    assert.equal(verified.incomplete, 1, 'only the drifted company is outstanding');
    assert.deepEqual(verified.drifted, []);
    assert.deepEqual(verified.provenanceGaps, []);
  });

  it('P0-4: a PLAN_FAILED entry is refused by name, even when the company now plans cleanly', async (t) => {
    if (!reachable) return t.skip('no database');
    const companyId = await makeCompany('bound-planfailed', [{ featureKey: 'crm', enabled: true }]);
    const applied = await normalizeAllCompanyEntitlements(service, {
      runId: `${TAG}-planfailed`,
      companyIds: [companyId],
      approvedPlanHashes: { [companyId]: PLAN_FAILED },
    });
    assert.equal(applied.failed, 1);
    assert.equal(applied.completed, 0);
    assert.match(applied.errors[0]!.error, /PLAN_FAILED/);
    assert.equal((await storedRows(companyId)).length, 1);
    assert.equal(await prisma.companyEntitlementNormalization.count({ where: { companyId } }), 0);
  });

  it('P0-4: the membership freeze — a company created after the review never joins the apply', async (t) => {
    if (!reachable) return t.skip('no database');
    const inPlan = await makeCompany('freeze-reviewed', [{ featureKey: 'crm', enabled: true }]);
    const reviewed = await normalizeAllCompanyEntitlements(service, {
      runId: `${TAG}-freeze-plan`, companyIds: [inPlan], dryRun: true,
    });
    const latecomer = await makeCompany('freeze-latecomer', [{ featureKey: 'inventory', enabled: true }]);

    const applied = await normalizeAllCompanyEntitlements(service, {
      runId: `${TAG}-freeze-apply`,
      companyIds: [inPlan, latecomer],
      approvedPlanHashes: reviewed.planHashes,
    });
    assert.equal(applied.total, 1, 'the run considers only the approved ids');
    assert.equal(applied.completed, 1);
    assert.deepEqual(applied.skippedOutsideApprovedPlan, [latecomer], 'skipped AND reported, never silent');
    assert.equal((await storedRows(latecomer)).length, 1, 'the latecomer is untouched');
    assert.equal(await prisma.companyEntitlementNormalization.count({ where: { companyId: latecomer } }), 0);
    assert.equal(applied.normalizationIncomplete, 1, 'the deploy gate still counts it as outstanding');
  });

  /**
   * UAT r7 gap — verify used to infer the cohort from `rows.some(grantOrigin = LEGACY)`, which is
   * self-fulfilling: a legacy company whose provenance UPDATE never ran has zero stamps, reads as
   * "not grandfathered", and passes with its whole cohort marker missing. The cohort is now on the
   * marker, so the same company fails.
   */
  it('UAT r7: an all-unstamped LEGACY company is caught by the recorded cohort', async (t) => {
    if (!reachable) return t.skip('no database');
    const companyId = await makeCompany('cohort', [{ featureKey: 'crm', enabled: true }]);
    await normalizeCompanyEntitlements(service, companyId, { runId: `${TAG}-cohort` });
    assert.equal(
      (await prisma.companyEntitlementNormalization.findUnique({ where: { companyId } }))?.cohortKind,
      LEGACY_COHORT,
    );

    // Strip EVERY stamp without touching a single value: the stored rows are still the plan's fixed
    // point, so the value check passes and only the cohort can catch this.
    await prisma.$executeRaw`
      UPDATE "CompanyFeatureEntitlement" SET "grantOrigin" = NULL WHERE "companyId" = ${companyId}`;
    const verified = await verifyCompanyNormalizations(service, { companyIds: [companyId] });
    assert.deepEqual(verified.drifted, []);
    assert.equal(verified.provenanceGaps.length, 1, 'the old "any LEGACY row" inference passed this');
    assert.ok(verified.provenanceGaps[0]!.missing.length > 1);

    // And a marker with no recorded cohort at all is INCOMPLETE, never assumed EXPLICIT.
    await prisma.companyEntitlementNormalization.update({ where: { companyId }, data: { cohortKind: null } });
    assert.equal((await verifyCompanyNormalizations(service, { companyIds: [companyId] })).incomplete, 1);
  });

  /**
   * UAT r8 A2 — `isLegacyCohort = !alreadyCompleted` read ANY non-COMPLETED marker as a first-ever
   * legacy company. The exception resolver parks a marker at STARTED, so an onboarding-EXPLICIT
   * company that went through it came back stamped `grantOrigin=LEGACY` on every ON row: fabricated
   * grandfather evidence, on the exact rows the day-14 removal of legacy semantics consults.
   */
  it('UAT r8 A2: an EXPLICIT marker reset to STARTED is never re-stamped as the grandfather cohort', async (t) => {
    if (!reachable) return t.skip('no database');
    const companyId = await makeCompany('cohort-reset', [{ featureKey: 'crm', enabled: true }]);
    // Exactly what the exception resolver leaves behind for an onboarding-EXPLICIT company.
    await prisma.companyEntitlementNormalization.create({
      data: {
        companyId,
        status: 'STARTED',
        snapshotHash: 'reset-by-resolver',
        runId: `${TAG}-reset`,
        normalizerVersion: NORMALIZER_VERSION,
        cohortKind: EXPLICIT_COHORT,
      },
    });

    const run = await normalizeCompanyEntitlements(service, companyId, { runId: `${TAG}-cohort-reset` });
    assert.equal(run.status, 'COMPLETED');
    assert.equal(run.cohortKind, EXPLICIT_COHORT);
    assert.equal(run.cohortEvidence, 'EXISTING_MARKER');
    assert.equal(run.provenance, 0, 'an EXPLICIT company has no grandfather cohort to stamp');
    assert.equal(
      (await prisma.companyEntitlementNormalization.findUnique({ where: { companyId } }))?.cohortKind,
      EXPLICIT_COHORT,
    );
    assert.equal(
      (await storedRows(companyId)).some((row) => row.grantOrigin === LEGACY_GRANT_ORIGIN),
      false,
      'not one row carries manufactured grandfather evidence',
    );
    assert.deepEqual(await verifyCompanyNormalizations(service, { companyIds: [companyId] }), {
      total: 1, incomplete: 0, drifted: [], provenanceGaps: [],
    });
  });

  /**
   * UAT r8 A2 — the other direction: a marker with NO recorded cohort used to fall back to
   * "does any row carry grantOrigin=LEGACY", so a legacy company whose provenance UPDATE never ran
   * silently became EXPLICIT — the cohort that waives the provenance check entirely. The cohort now
   * comes from evidence written in the marker's own transaction, or from nothing at all.
   */
  it('UAT r8 A2: a null cohort is derived from durable evidence, never defaulted to EXPLICIT', async (t) => {
    if (!reachable) return t.skip('no database');
    const preCohortMarker = (companyId: string) => ({
      companyId,
      status: 'COMPLETED' as const,
      snapshotHash: 'pre-cohort',
      runId: `${TAG}-pre-cohort`,
      normalizerVersion: NORMALIZER_VERSION - 1,
      completedAt: new Date(),
    });

    // (a) No evidence anywhere: the repair refuses before every write and the deploy gate keeps
    // blocking. Guessing EXPLICIT here is what used to hide a whole missing cohort.
    const unknown = await makeCompany('cohort-null', [{ featureKey: 'crm', enabled: true }]);
    await prisma.companyEntitlementNormalization.create({ data: preCohortMarker(unknown) });
    const unknownRun = await normalizeAllCompanyEntitlements(service, {
      runId: `${TAG}-cohort-null`, companyIds: [unknown],
    });
    assert.equal(unknownRun.completed, 0);
    assert.equal(unknownRun.failed, 1);
    assert.equal(unknownRun.unresolvedCohorts, 1);
    assert.equal(unknownRun.companies[0]?.status, 'UNRESOLVED_COHORT');
    assert.equal(unknownRun.companies[0]?.cohortKind, null);
    assert.equal(unknownRun.companies[0]?.cohortEvidence, 'UNRESOLVED');
    const unresolved = await prisma.companyEntitlementNormalization.findUnique({ where: { companyId: unknown } });
    assert.equal(unresolved?.cohortKind, null, 'no evidence is recorded as no evidence');
    assert.equal(unresolved?.normalizerVersion, NORMALIZER_VERSION - 1, 'the marker is byte-unmodified');
    assert.equal(await prisma.companyEntitlementSet.count({ where: { companyId: unknown } }), 0);
    assert.equal(await prisma.entitlementTransition.count({ where: { companyId: unknown } }), 0);
    assert.equal(
      (await verifyCompanyNormalizations(service, { companyIds: [unknown] })).incomplete,
      1,
      'and it stays INCOMPLETE until a human resolves it',
    );

    // (b) The durable evidence a grandfather pass leaves behind: its audit row, written in the same
    // transaction as the marker, and untouched by anything that rewrites the entitlement rows.
    const legacy = await makeCompany('cohort-null-legacy', [{ featureKey: 'crm', enabled: true }]);
    await prisma.companyEntitlementNormalization.create({ data: preCohortMarker(legacy) });
    await prisma.auditLog.create({
      data: {
        companyId: legacy,
        actorType: 'SYSTEM',
        action: 'system.entitlement.normalize',
        targetType: 'company',
        targetId: legacy,
        requestId: `${TAG}-old-legacy-pass`,
        result: 'SUCCESS',
        riskLevel: 'HIGH',
        metadataJson: { runId: `${TAG}-old-legacy-pass`, grantOrigin: LEGACY_GRANT_ORIGIN, legacyOnKeys: 12 },
      },
    });
    const legacyRun = await normalizeAllCompanyEntitlements(service, {
      runId: `${TAG}-cohort-null-legacy`, companyIds: [legacy],
    });
    assert.equal(legacyRun.completed, 1);
    assert.equal(legacyRun.unresolvedCohorts, 0);
    assert.equal(legacyRun.companies[0]?.cohortKind, LEGACY_COHORT);
    assert.equal(legacyRun.companies[0]?.cohortEvidence, 'LEGACY_NORMALIZATION_AUDIT');
    assert.equal(
      (await prisma.companyEntitlementNormalization.findUnique({ where: { companyId: legacy } }))?.cohortKind,
      LEGACY_COHORT,
    );
    // Derived LEGACY means the provenance stamp is DEMANDED — and this pass applied it.
    assert.deepEqual(await verifyCompanyNormalizations(service, { companyIds: [legacy] }), {
      total: 1, incomplete: 0, drifted: [], provenanceGaps: [],
    });

    // (c) An onboarding run is the durable evidence for an EXPLICIT company whose old marker lacks
    // the cohort column. The same user can own and create this test run; no customer input is needed.
    const explicit = await makeCompany('cohort-null-explicit', [{ featureKey: 'crm', enabled: true }]);
    await prisma.companyEntitlementNormalization.create({ data: preCohortMarker(explicit) });
    const onboardingUserId = `${TAG}-cohort-onboarding-user`;
    await prisma.user.create({ data: { id: onboardingUserId, displayName: `${TAG} cohort onboarding` } });
    adminUserIds.push(onboardingUserId);
    const onboardingRun = await prisma.companyOnboardingRun.create({
      data: {
        companyId: explicit,
        ownerUserId: onboardingUserId,
        createdBySystemAdminUserId: onboardingUserId,
        status: 'DRAFT',
      },
    });
    for (const status of ['DRAFT', 'CANCELLED', 'FAILED'] as const) {
      await prisma.companyOnboardingRun.update({
        where: { id: onboardingRun.id },
        data: { status, completedAt: null },
      });
      const incomplete = await normalizeAllCompanyEntitlements(service, {
        runId: `${TAG}-cohort-null-explicit-${status.toLowerCase()}`,
        companyIds: [explicit],
      });
      assert.equal(incomplete.failed, 1, `${status} onboarding is not completed evidence`);
      assert.equal(incomplete.unresolvedCohorts, 1);
      assert.equal(incomplete.companies[0]?.cohortEvidence, 'UNRESOLVED');
    }
    await prisma.companyOnboardingRun.update({
      where: { id: onboardingRun.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    const explicitRun = await normalizeAllCompanyEntitlements(service, {
      runId: `${TAG}-cohort-null-explicit`, companyIds: [explicit],
    });
    assert.equal(explicitRun.completed, 1);
    assert.equal(explicitRun.companies[0]?.cohortKind, EXPLICIT_COHORT);
    assert.equal(explicitRun.companies[0]?.cohortEvidence, 'COMPANY_ONBOARDING_RUN');
  });

  /**
   * External r9 — the r8 "never guess" outcome used to be a DEAD END.
   *
   * A company with no durable cohort evidence completes at the CURRENT generation with
   * `cohortKind` null. `normalizeCompanyEntitlements` then early-returned ALREADY_COMPLETED on
   * status+version alone and `pendingCompanyWhere` never selected it again — while the partner write
   * gate (`normalizationCurrent`, set-partner-features.use-case.ts) and verify BOTH called it pending. So
   * the documented heal went nowhere: recording the cohort by hand left a company no pass would ever
   * visit, and verify kept demanding the LEGACY provenance stamps that only a pass can apply.
   * "Complete" now means COMPLETED + this generation + a valid cohort, everywhere.
   */
  it('external r9: a COMPLETED marker with no cohort is not complete — it stays pending, and the heal lands', async (t) => {
    if (!reachable) return t.skip('no database');
    const companyId = await makeCompany('r9-no-cohort', [{ featureKey: 'crm', enabled: true }]);
    // The r8 outcome verbatim: COMPLETED at the CURRENT generation, no cohort — and no audit row and
    // no onboarding run exist for this company, so there is nothing for `cohortKindOf` to derive.
    await prisma.companyEntitlementNormalization.create({
      data: {
        companyId,
        status: 'COMPLETED',
        snapshotHash: 'no-evidence',
        runId: `${TAG}-r9-seed`,
        normalizerVersion: NORMALIZER_VERSION,
        completedAt: new Date(),
      },
    });

    // (a) Selected by the runner's own predicate, and re-processed rather than skipped.
    const first = await normalizeAllCompanyEntitlements(service, { runId: `${TAG}-r9-1`, companyIds: [companyId] });
    assert.equal(first.total, 1, 'pendingCompanyWhere selects a COMPLETED marker with no cohort');
    assert.equal(first.failed, 1);
    assert.equal(first.unresolvedCohorts, 1);
    assert.equal(first.companies[0]?.status, 'UNRESOLVED_COHORT', 'the entry check no longer early-returns it');
    assert.equal(
      (await prisma.companyEntitlementNormalization.findUnique({ where: { companyId } }))?.cohortKind,
      null,
      'no evidence appeared, so the pass still records none — honestly, rather than by guess',
    );

    // Deliberate and honest: it refuses with no cohort and stays pending until a human decides.
    // Every pass over it must therefore be a no-op, or the deploy would rewrite live rows forever.
    const untouched = new Map((await storedRows(companyId)).map((row) => [row.featureKey, row.updatedAt.getTime()]));
    const transitions = await prisma.entitlementTransition.count({ where: { companyId } });
    await new Promise((resolve) => setTimeout(resolve, 15));
    const second = await normalizeAllCompanyEntitlements(service, { runId: `${TAG}-r9-2`, companyIds: [companyId] });
    assert.equal(second.total, 1, 'still pending');
    assert.equal(second.companies[0]?.written, 0, 'and re-planning it writes nothing');
    for (const row of await storedRows(companyId)) {
      assert.equal(row.updatedAt.getTime(), untouched.get(row.featureKey), `${row.featureKey} must not be rewritten`);
    }
    assert.equal(await prisma.entitlementTransition.count({ where: { companyId } }), transitions);
    // The plan remains reviewable, but unresolved cohort evidence is an ordinary failure so the
    // existing CLI approvalReady formula stays fail-closed without a second downstream gate.
    const planned = await normalizeAllCompanyEntitlements(service, {
      runId: `${TAG}-r9-plan`, companyIds: [companyId], dryRun: true,
    });
    assert.deepEqual(
      [planned.failed, planned.dependencyExceptions, planned.unresolvedCohorts, planned.errors.length],
      [1, 0, 1, 1],
      'a pending-forever company has a plan/hash but cannot authorize APPLY',
    );
    assert.match(planned.errors[0]?.error ?? '', /entitlement_cohort_unresolved/);

    // (b) THE HEAL, one statement. The reopen is part of it, not an extra step: recording the cohort
    // is exactly what takes the company out of the pending set, and a LEGACY company still needs the
    // pass that stamps grantOrigin on its effective-ON rows.
    await prisma.$executeRaw`
      UPDATE "CompanyEntitlementNormalization"
         SET "cohortKind" = ${LEGACY_COHORT},
             "status" = 'STARTED'::"CompanyEntitlementNormalizationStatus",
             "completedAt" = NULL
       WHERE "companyId" = ${companyId}`;
    const healed = await normalizeAllCompanyEntitlements(service, { runId: `${TAG}-r9-heal`, companyIds: [companyId] });
    assert.equal(healed.completed, 1);
    assert.ok(healed.companies[0]!.provenance > 0, 'the recorded cohort is what makes the pass stamp at all');
    assert.equal(healed.normalizationIncomplete, 0);
    assert.deepEqual(await verifyCompanyNormalizations(service, { companyIds: [companyId] }), {
      total: 1, incomplete: 0, drifted: [], provenanceGaps: [],
    });

    // (c) The control: with a VALID cohort the entry check skips the company exactly as before.
    const done = await normalizeCompanyEntitlements(service, companyId, { runId: `${TAG}-r9-done` });
    assert.equal(done.status, 'ALREADY_COMPLETED');
    assert.equal(done.written, 0);
    assert.equal(
      (await normalizeAllCompanyEntitlements(service, { runId: `${TAG}-r9-none`, companyIds: [companyId] })).total,
      0,
      'and it is out of the pending set',
    );
  });

  /**
   * UAT r8 — a HUMAN decision is permanent, and no later machine pass may revert it.
   *
   * The owner ruling is that the moment an operator decides a row it is an EXPLICIT grant, which is
   * why every partner command clears `grantOrigin` — including a confirm that moves no value. The
   * provenance stamp is applied to the LEGACY cohort's whole effective-ON set, so without an
   * exclusion the next `NORMALIZER_VERSION` bump would quietly write `grantOrigin=LEGACY` back onto
   * that row: manufactured grandfather evidence on the one kind of row that has a human behind it.
   *
   * The exemption cannot be a time window either. `completedAt` is rewritten by every pass, so a
   * window relative to it expires on each repair — the decision would be honoured exactly until the
   * next release, then reverted.
   */
  it('UAT r8: a human-decided key is never re-stamped, and the exclusion is in the PLAN', async (t) => {
    if (!reachable) return t.skip('no database');
    const companyId = await makeCompany('human-decided', [{ featureKey: 'crm', enabled: true }]);
    const operatorId = `${TAG}-operator`;
    await normalizeCompanyEntitlements(service, companyId, { runId: `${TAG}-human-1` });
    assert.equal(
      (await storedRows(companyId)).find((r) => r.featureKey === 'inventory')?.grantOrigin,
      null,
      'inventory is OFF for this company, so it starts unstamped',
    );
    const stampedKey = 'crm.leads';
    assert.equal((await storedRows(companyId)).find((r) => r.featureKey === stampedKey)?.grantOrigin, LEGACY_GRANT_ORIGIN);

    // Exactly the shape SetPartnerFeaturesUseCase leaves behind when an operator re-confirms a
    // grandfathered row: the marker cleared by raw SQL, and one transition naming the human.
    await prisma.$executeRaw`
      UPDATE "CompanyFeatureEntitlement" SET "grantOrigin" = NULL
       WHERE "companyId" = ${companyId} AND "featureKey" = ${stampedKey}`;
    await prisma.entitlementTransition.create({
      data: {
        companyId,
        featureKey: stampedKey,
        seq: 9_100,
        epoch: 0,
        commandId: `${TAG}-human-confirm`,
        action: 'ENABLE',
        actorUserId: operatorId,
        reasonJson: { noopConfirm: true, clearedGrantOrigin: LEGACY_GRANT_ORIGIN },
      },
    });

    // (1) The PLAN tells the truth: the key is out of `provenanceKeys`, so the reviewed artifact
    // describes exactly what an apply would stamp. A write-time filter could not do this.
    const decided = await humanDecidedKeys(prisma, companyId);
    assert.deepEqual([...decided], [stampedKey]);
    const plan = planCompanyNormalization(companyId, await storedRows(companyId), LEGACY_COHORT, decided);
    assert.equal(plan.provenanceKeys.includes(stampedKey), false, 'the plan excludes the human decision');
    assert.ok(plan.provenanceKeys.includes('crm'), 'and still covers every machine-stamped key');

    // (2) A full version-bump repair leaves the decision standing.
    await prisma.companyEntitlementNormalization.update({
      where: { companyId },
      data: { normalizerVersion: NORMALIZER_VERSION - 1 },
    });
    const repaired = await normalizeAllCompanyEntitlements(service, {
      runId: `${TAG}-human-repair`, companyIds: [companyId],
    });
    assert.equal(repaired.completed, 1);
    assert.equal(
      (await storedRows(companyId)).find((r) => r.featureKey === stampedKey)?.grantOrigin,
      null,
      'the repair did NOT revert the human decision to a grandfathered grant',
    );

    // (3) And verify exempts it — with the transition now OLDER than the marker's new completedAt,
    // which is the post-repair reality the deleted window got wrong every time.
    const marker = await prisma.companyEntitlementNormalization.findUnique({ where: { companyId } });
    const transition = await prisma.entitlementTransition.findFirst({
      where: { companyId, featureKey: stampedKey, actorUserId: operatorId },
    });
    assert.ok(
      transition!.createdAt.getTime() < marker!.completedAt!.getTime(),
      'the human decision predates the current completedAt — a window would have expired it',
    );
    assert.deepEqual(await verifyCompanyNormalizations(service, { companyIds: [companyId] }), {
      total: 1, incomplete: 0, drifted: [], provenanceGaps: [],
    });

    // (4) The control: a SYSTEM-only key on the same company, unstamped, is still a gap.
    await prisma.$executeRaw`
      UPDATE "CompanyFeatureEntitlement" SET "grantOrigin" = NULL
       WHERE "companyId" = ${companyId} AND "featureKey" = 'crm'`;
    assert.deepEqual(
      (await verifyCompanyNormalizations(service, { companyIds: [companyId] })).provenanceGaps,
      [{ companyId, missing: ['crm'] }],
      'only a HUMAN decision exempts; a machine-stamped key still has to carry the marker',
    );
  });

  it('UAT r7: a repair pass keeps the cohort it already had', async (t) => {
    if (!reachable) return t.skip('no database');
    const companyId = await makeCompany('cohort-repair', [{ featureKey: 'crm', enabled: true }]);
    // An onboarding-shaped marker: COMPLETED, EXPLICIT, one generation behind.
    await prisma.companyEntitlementNormalization.create({
      data: {
        companyId,
        status: 'COMPLETED',
        snapshotHash: 'seeded',
        runId: `${TAG}-seed`,
        normalizerVersion: NORMALIZER_VERSION - 1,
        cohortKind: EXPLICIT_COHORT,
        completedAt: new Date(),
      },
    });
    const repaired = await normalizeAllCompanyEntitlements(service, {
      runId: `${TAG}-cohort-repair`, companyIds: [companyId],
    });
    assert.equal(repaired.completed, 1, 'a marker below the current generation is re-opened');
    const marker = await prisma.companyEntitlementNormalization.findUnique({ where: { companyId } });
    assert.equal(marker?.cohortKind, EXPLICIT_COHORT, 'a repair never re-labels a company as grandfathered');
    assert.equal(marker?.normalizerVersion, NORMALIZER_VERSION);
    // And with no LEGACY cohort there is no provenance stamp to demand.
    assert.deepEqual(await verifyCompanyNormalizations(service, { companyIds: [companyId] }), {
      total: 1, incomplete: 0, drifted: [], provenanceGaps: [],
    });
  });

  /**
   * UAT r6/r7 — the halt is the whole safety property, so it is exercised through the REAL CLI
   * against the REAL database, not through a stub: `F2_APPLY=true` used to be the only gate, and a
   * plan nobody reviewed would have been written.
   */
  it('the CLI refuses to apply without a reviewed artifact, and halts with zero writes on a mismatch', async (t) => {
    if (!reachable) return t.skip('no database');
    const apiRoot = join(__dirname, '..', '..', '..', '..');
    const tsxBin = join(apiRoot, 'node_modules', '.bin', 'tsx');
    if (!existsSync(tsxBin)) return t.skip('no tsx binary');
    // A company the apply WOULD rewrite if the guard ever stopped holding.
    const canaryId = await makeCompany('halt-canary', [{ featureKey: 'crm', enabled: true }]);
    const before = await storedRows(canaryId);

    const runCli = (env: Record<string, string>, argv: string[] = []) => spawnSync(
      tsxBin,
      ['prisma/normalize-entitlements.ts', ...argv],
      {
        cwd: apiRoot,
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          F2_ARTIFACT_PATH: join(tmpdir(), `${TAG}-halt-artifact.json`),
          ...env,
        },
        encoding: 'utf8',
        timeout: 300_000,
      },
    );
    const artifactFile = (body: Record<string, unknown>) => {
      const path = join(tmpdir(), `${TAG}-approved-${Math.random().toString(36).slice(2)}.json`);
      writeFileSync(path, JSON.stringify({
        artifact: 'f2-entitlement-normalization',
        normalizerVersion: NORMALIZER_VERSION,
        approvalReady: true,
        aggregateHash: '0'.repeat(64),
        planHashes: { [canaryId]: 'a'.repeat(64) },
        ...body,
      }));
      return path;
    };

    // Armed but unauthorized: refused before the database is even opened.
    const unauthorized = runCli({ F2_APPLY: 'true' });
    assert.equal(unauthorized.status, 1, unauthorized.stdout ?? '');
    assert.match(unauthorized.stderr, /APPLY requires the reviewed PLAN artifact/);

    // (c) PLAN is REVIEWABLE but not approval-ready while a dependency-exception company exists
    // (`${TAG}-procdep`, created earlier in this file). It fails by default — and `--allow-exceptions`
    // softens only the EXIT CODE, which is what keeps the boot preflight's "always exits 0" promise.
    const planBlocked = runCli({});
    assert.equal(planBlocked.status, 1, planBlocked.stdout ?? '');
    assert.match(planBlocked.stderr, /PLAN is NOT approval-ready/);
    assert.match(planBlocked.stdout, /"approvalReady": false/);
    const planAllowed = runCli({}, ['--allow-exceptions']);
    assert.equal(planAllowed.status, 0, planAllowed.stderr ?? '');
    assert.match(planAllowed.stdout, /"approvalReady": false/, 'the flag never makes the artifact appliable');

    // (c) an artifact whose PLAN was not clean can be READ but never applied.
    const notReady = runCli(
      { F2_APPLY: 'true' },
      [`--approved-plan=${artifactFile({ approvalReady: false })}`],
    );
    assert.equal(notReady.status, 1, notReady.stdout ?? '');
    assert.match(notReady.stderr, /approvalReady=false/);

    // An artifact from another normalizer generation cannot authorize this build.
    const wrongVersion = runCli(
      { F2_APPLY: 'true' },
      [`--approved-plan=${artifactFile({ normalizerVersion: NORMALIZER_VERSION + 1 })}`],
    );
    assert.equal(wrongVersion.status, 1, wrongVersion.stdout ?? '');
    assert.match(wrongVersion.stderr, /the rules changed/);

    // A hash that cannot describe any estate: plans the frozen membership, then halts.
    const mismatched = runCli({ F2_APPLY: 'true' }, [`--approved-plan=${artifactFile({})}`]);
    assert.equal(mismatched.status, 1, mismatched.stdout ?? '');
    assert.match(mismatched.stderr, /no longer matches the approved artifact/);
    assert.match(mismatched.stdout, /aggregateHash=[0-9a-f]{64}/, 'the recomputed hash is reported');

    // Zero writes, proven on the canary AND on the pass's own bookkeeping.
    const after = await storedRows(canaryId);
    assert.deepEqual(
      after.map((row) => [row.featureKey, row.enabled, row.grantOrigin, row.updatedAt.getTime()]),
      before.map((row) => [row.featureKey, row.enabled, row.grantOrigin, row.updatedAt.getTime()]),
    );
    assert.equal(
      await prisma.companyEntitlementNormalization.count({ where: { companyId: canaryId } }),
      0,
      'a halted apply leaves no marker behind',
    );
    assert.equal(await prisma.entitlementTransition.count({ where: { companyId: canaryId } }), 0);
  });
});
