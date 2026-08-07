/**
 * REAL-DATABASE proof for Reports U3 final-write fencing.
 *
 * The partner command intentionally still refuses commercial Reports OFF until this workstream is
 * released. These tests therefore exercise the same exclusive entitlement lock directly, against
 * the real query/view/export use cases and two PostgreSQL sessions. All writes belong to one
 * throwaway company and are cascade-deleted afterwards. The suite skips when no database is
 * reachable.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import type { RequestContext } from '@watchdog-bms/contracts';
import { PrismaClient } from '../../../generated/prisma/client';
import { exclusiveEntitlementLock } from '../../feature-launch/application/execution-attempt.service';
import { findReportDefinition } from '../domain/report-catalog';
import { sha256 } from '../domain/report-csv.logic';
import { PrismaReportRepository } from '../infrastructure/prisma-report.repository';
import { ReportEntitlementService, type ReportEntitlementStamp } from './report-entitlement.service';
import { CreateReportExportUseCase, CreateReportViewUseCase, RunReportQueryUseCase } from './report.use-cases';

const TAG = `report-fence-${process.pid}`;

function rootDatabaseUrl(): string | null {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = readFileSync(join(__dirname, '../'.repeat(6), '.env'), 'utf8');
    return /^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m.exec(env)?.[1] ?? null;
  } catch {
    return null;
  }
}

function errorCode(error: unknown): string | undefined {
  const response = (error as { getResponse?: () => unknown }).getResponse?.();
  return response && typeof response === 'object' ? (response as { code?: string }).code : undefined;
}

describe('Reports final writes vs entitlement generation (real database)', () => {
  let clients: PrismaClient[] = [];
  let reachable = false;
  let companyId = '';
  let userId = '';
  let repository: PrismaReportRepository;
  let entitlement: ReportEntitlementService;

  const adapterResult = {
    status: 'READY' as const,
    computedAt: '2026-08-01T00:00:00.000Z',
    freshness: { computedAt: '2026-08-01T00:00:00.000Z', sourceModules: ['accounting-documents'], freshnessStatus: 'fresh' as const },
    warnings: [],
    columns: [{ key: 'documentNumber', label: 'Document', type: 'string' as const }],
    rows: [{ documentNumber: 'INV-001' }],
    sourceRefs: [],
    filters: {},
    page: 1,
    pageSize: 5_000,
    total: 1,
    sourcePermissionsUsed: ['accounting.document.read'],
  };
  const adapters = {
    isAvailable: () => true,
    execute: async () => ({ ...adapterResult, pageSize: 100 }),
    executeForExport: async () => adapterResult,
  };
  const audit = { log: async () => undefined };
  const notify = { execute: async () => undefined };
  const ctx = (): RequestContext => ({
    requestId: randomUUID(),
    authSubject: userId,
    userId,
    companyId,
    membershipId: `${TAG}-membership`,
    roles: ['OWNER'],
    permissions: [
      'report.catalog.read', 'report.dataset.read', 'report.query.run', 'report.view.create',
      'report.export', 'report.export.read_own', 'accounting.document.read',
    ],
    scopes: {},
    authProvider: 'dev',
  });

  async function resetOn(): Promise<void> {
    await clients[0]!.reportExportRequest.deleteMany({ where: { companyId } });
    await clients[0]!.reportRun.deleteMany({ where: { companyId } });
    await clients[0]!.reportView.deleteMany({ where: { companyId } });
    await clients[0]!.companyFeatureEntitlement.deleteMany({ where: { companyId } });
    await clients[0]!.companyFeatureEntitlement.createMany({
      data: [
        { companyId, featureKey: 'reports', enabled: true, epoch: 10, lastSeq: 10 },
        { companyId, featureKey: 'inventory', enabled: true, epoch: 1, lastSeq: 1 },
      ],
    });
  }

  async function setReportsEnabled(enabled: boolean, started?: () => void): Promise<void> {
    await clients[1]!.$transaction(async (tx) => {
      started?.();
      await tx.$executeRaw(exclusiveEntitlementLock(companyId));
      await tx.companyFeatureEntitlement.update({
        where: { companyId_featureKey: { companyId, featureKey: 'reports' } },
        data: {
          enabled,
          ...(enabled ? { epoch: { increment: 1 } } : {}),
          lastSeq: { increment: 1 },
        },
      });
    });
  }

  function transitionAfterStart(mode: 'OFF' | 'ABA') {
    return {
      isEnabled: entitlement.isEnabled.bind(entitlement),
      assertEnabled: async (targetCompanyId: string): Promise<ReportEntitlementStamp> => {
        const stamp = await entitlement.assertEnabled(targetCompanyId);
        await setReportsEnabled(false);
        if (mode === 'ABA') await setReportsEnabled(true);
        return stamp;
      },
      withEnabledFence: entitlement.withEnabledFence.bind(entitlement),
    };
  }

  before(async () => {
    const url = rootDatabaseUrl();
    if (!url) return;
    try {
      clients = [
        new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }),
        new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }),
      ];
      await clients[0]!.$queryRaw`SELECT 1`;
    } catch {
      reachable = false;
      return;
    }
    reachable = true;
    // Once PostgreSQL answered SELECT 1, missing migrations/fixtures are test failures, not skips.
    userId = (await clients[0]!.user.findFirstOrThrow({ select: { id: true }, orderBy: { id: 'asc' } })).id;
    companyId = (await clients[0]!.company.create({
      data: { name: `${TAG}-co`, status: 'ACTIVE' },
      select: { id: true },
    })).id;
    repository = new PrismaReportRepository({ client: clients[0]! } as any);
    entitlement = new ReportEntitlementService({ client: clients[0]! } as any);
  });

  after(async () => {
    if (reachable) await clients[0]!.company.deleteMany({ where: { id: companyId } });
    await Promise.all(clients.map((client) => client.$disconnect().catch(() => undefined)));
  });

  it('a committed shared-fenced ReportRun finishes before a concurrent exclusive OFF', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    await resetOn();

    let enteredWrite!: () => void;
    const entered = new Promise<void>((resolve) => { enteredWrite = resolve; });
    let releaseWrite!: () => void;
    const release = new Promise<void>((resolve) => { releaseWrite = resolve; });
    const blockingRepository = {
      createRun: async (data: any, tx: any) => {
        enteredWrite();
        await release;
        return repository.createRun(data, tx);
      },
    };
    const query = new RunReportQueryUseCase(blockingRepository as any, adapters as any, audit as any, entitlement);
    const runningQuery = query.execute(ctx(), companyId, { datasetCode: 'ar.aging', page: 1, pageSize: 100 });
    await entered;

    let exclusiveStarted!: () => void;
    const started = new Promise<void>((resolve) => { exclusiveStarted = resolve; });
    let offCommitted = false;
    const turningOff = setReportsEnabled(false, exclusiveStarted).then(() => { offCommitted = true; });
    await started;
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(offCommitted, false, 'exclusive OFF waits for the shared-fenced final write');

    releaseWrite();
    await runningQuery;
    await turningOff;
    assert.equal(await clients[0]!.reportRun.count({ where: { companyId } }), 1);
    assert.equal((await clients[0]!.companyFeatureEntitlement.findUniqueOrThrow({
      where: { companyId_featureKey: { companyId, featureKey: 'reports' } },
    })).enabled, false);
  });

  for (const mode of ['OFF', 'ABA'] as const) {
    it(`${mode} after request start leaves zero query/view/export roots`, async (t) => {
      if (!reachable) return t.skip('no database reachable');

      for (const surface of ['query', 'view', 'export'] as const) {
        await resetOn();
        const staleEntitlement = transitionAfterStart(mode);
        const query = new RunReportQueryUseCase(repository, adapters as any, audit as any, staleEntitlement as any);
        let uploaded = 0;
        const storage = {
          putObject: async () => {
            uploaded += 1;
            return { bucket: 'test', objectKey: `report-export/${companyId}/test.csv`, objectVersionId: 'v1', storageProvider: 'test', byteSize: 1, checksumSha256: '0'.repeat(64) };
          },
          getObject: async () => ({ bytes: Buffer.alloc(0) }),
          deleteObject: async () => undefined,
        };

        const operation = surface === 'query'
          ? () => query.execute(ctx(), companyId, { datasetCode: 'ar.aging', page: 1, pageSize: 100 })
          : surface === 'view'
            ? () => new CreateReportViewUseCase(repository, adapters as any, audit as any, staleEntitlement as any)
              .execute(ctx(), companyId, { datasetCode: 'ar.aging', name: `${mode}-${surface}` })
            : () => new CreateReportExportUseCase(repository, query, audit as any, notify as any, staleEntitlement as any, storage as any)
              .execute(ctx(), companyId, { datasetCode: 'ar.aging', format: 'CSV' });

        await assert.rejects(operation, (error: unknown) => {
          assert.equal(errorCode(error), mode === 'OFF' ? 'feature_not_enabled' : 'report_entitlement_changed');
          return true;
        });
        assert.equal(await clients[0]!.reportRun.count({ where: { companyId } }), 0, `${surface}: no ReportRun`);
        assert.equal(await clients[0]!.reportView.count({ where: { companyId } }), 0, `${surface}: no ReportView`);
        assert.equal(await clients[0]!.reportExportRequest.count({ where: { companyId } }), 0, `${surface}: no ReportExportRequest`);
        assert.equal(uploaded, 0, `${surface}: no object bytes before the inner/final fence`);
      }
    });
  }

  for (const mode of ['OFF', 'ABA'] as const) {
    it(`${mode} after object upload deletes bytes and leaves no export or deferred run`, async (t) => {
      if (!reachable) return t.skip('no database reachable');
      await resetOn();
      let deleted = 0;
      const storage = {
        putObject: async (input: { bytes: Buffer }) => {
          await setReportsEnabled(false);
          if (mode === 'ABA') await setReportsEnabled(true);
          return {
            bucket: 'test', objectKey: `report-export/${companyId}/test.csv`, objectVersionId: 'v1',
            storageProvider: 'test', byteSize: input.bytes.byteLength, checksumSha256: sha256(input.bytes.toString('utf8')),
          };
        },
        deleteObject: async () => { deleted += 1; },
      };
      const query = new RunReportQueryUseCase(repository, adapters as any, audit as any, entitlement);
      const create = new CreateReportExportUseCase(repository, query, audit as any, notify as any, entitlement, storage as any);

      await assert.rejects(
        () => create.execute(ctx(), companyId, { datasetCode: 'ar.aging', format: 'CSV' }),
        (error: unknown) => {
          assert.equal(errorCode(error), mode === 'OFF' ? 'feature_not_enabled' : 'report_entitlement_changed');
          return true;
        },
      );
      assert.equal(deleted, 1, 'uploaded object is compensated exactly once');
      assert.equal(await clients[0]!.reportRun.count({ where: { companyId } }), 0);
      assert.equal(await clients[0]!.reportExportRequest.count({ where: { companyId } }), 0);
    });
  }

  it('fixture still targets the live catalog definition', () => {
    assert.ok(findReportDefinition('ar.aging'));
  });
});
