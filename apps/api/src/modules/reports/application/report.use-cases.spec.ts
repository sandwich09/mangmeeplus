import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { RequestContext } from '@watchdog-bms/contracts';
import {
  ArchiveReportViewUseCase,
  CreateReportExportUseCase,
  CreateReportViewUseCase,
  DownloadReportExportUseCase,
  GetReportRunUseCase,
  ListReportExportsUseCase,
  ListReportRunsUseCase,
  ReportDrilldownUseCase,
  RunReportQueryUseCase,
  UpdateReportViewUseCase,
  ListReportViewsUseCase,
} from './report.use-cases';
import type { EnqueueObjectVersionCleanupInput } from '../../data-model-core/application/services/object-version-cleanup.service';
import { findReportDefinition } from '../domain/report-catalog';
import { ReportController } from '../presentation/http/report.controller';
import { REQUIRED_ANY_PERMISSIONS_KEY, REQUIRED_PERMISSIONS_KEY } from '../../../common/security/permissions.decorator';
import { sha256 } from '../domain/report-csv.logic';

const now = new Date().toISOString();
const pendingRun = (id: string) => ({
  id, companyId: 'company-1', requestedByUserId: 'user-1', datasetCode: 'ar.aging', datasetVersion: 1,
  status: 'READY', filters: {}, permissionSnapshot: { sourcePermissions: ['accounting.document.read'] },
  sourceScopeSnapshot: {}, rowCount: 1, computedAt: new Date(now), sourceFreshness: {}, sourceRefsPreview: {},
});
const ctx: RequestContext = {
  requestId: 'req-1',
  authSubject: 'user-1',
  userId: 'user-1',
  companyId: 'company-1',
  membershipId: 'membership-1',
  roles: ['FINANCE'],
  permissions: [
    'report.catalog.read',
    'report.dataset.read',
    'report.query.run',
    'report.snapshot.read',
    'report.export',
    'report.export.read_own',
    'accounting.document.read',
  ],
  scopes: {},
  authProvider: 'dev',
};

const entitlement = (enabled: boolean) => ({
  isEnabled: async () => enabled,
  assertEnabled: async () => {
    if (!enabled) throw Object.assign(new Error('feature_not_enabled'), { code: 'feature_not_enabled' });
    return { present: true, epoch: 1, lastSeq: 1 };
  },
  withEnabledFence: async (
    _companyId: string,
    _expected: { present: boolean; epoch: number | null; lastSeq: number | null },
    write: (tx: unknown) => Promise<unknown>,
  ) => {
    if (!enabled) throw Object.assign(new Error('feature_not_enabled'), { code: 'feature_not_enabled' });
    return write({});
  },
});

describe('ReportController permission metadata', () => {
  it('allows retained export reads through own OR manager authority without weakening create', () => {
    const prototype = ReportController.prototype;
    const retained = ['report.export.read_own', 'report.export.manage'];
    assert.deepEqual(Reflect.getMetadata(REQUIRED_ANY_PERMISSIONS_KEY, prototype.exportsHandler), retained);
    assert.deepEqual(Reflect.getMetadata(REQUIRED_ANY_PERMISSIONS_KEY, prototype.downloadHandler), retained);
    assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, prototype.exportHandler), ['report.export']);
  });
});

function mutableEntitlement(state: { enabled: boolean; epoch: number; lastSeq: number }) {
  return {
    isEnabled: async () => state.enabled,
    assertEnabled: async () => {
      if (!state.enabled) throw Object.assign(new Error('feature_not_enabled'), { code: 'feature_not_enabled' });
      return { present: true, epoch: state.epoch, lastSeq: state.lastSeq };
    },
    withEnabledFence: async (
      _companyId: string,
      expected: { present: boolean; epoch: number | null; lastSeq: number | null },
      write: (tx: unknown) => Promise<unknown>,
    ) => {
      if (!state.enabled) throw Object.assign(new Error('feature_not_enabled'), { code: 'feature_not_enabled' });
      if (expected.epoch !== state.epoch || expected.lastSeq !== state.lastSeq) {
        throw Object.assign(new Error('report_entitlement_changed'), { code: 'report_entitlement_changed' });
      }
      return write({});
    },
  };
}

describe('ListReportViewsUseCase retained scope', () => {
  it('hides saved-view filter identifiers outside the current location scope', async () => {
    const useCase = new ListReportViewsUseCase({
      listViews: async () => [
        { id: 'allowed', datasetCode: 'inventory.stock_balance', filters: { locationId: 'location-1' }, sourcePermissionSnapshot: ['inventory.report.read'], sourceScopeSnapshot: { locationIds: ['location-1'] } },
        { id: 'hidden', datasetCode: 'inventory.stock_balance', filters: { locationId: 'location-2' }, sourcePermissionSnapshot: ['inventory.report.read'], sourceScopeSnapshot: { locationIds: ['location-1'] } },
        { id: 'unfiltered', datasetCode: 'inventory.stock_balance', filters: {}, sourcePermissionSnapshot: ['inventory.report.read'], sourceScopeSnapshot: { locationIds: ['location-1'] } },
      ],
    } as any, entitlement(false) as any);
    const scoped = {
      ...ctx,
      permissions: [...ctx.permissions, 'report.view.read', 'inventory.report.read'],
      scopes: { locationIds: ['location-1'] },
    };

    const views = await useCase.execute(scoped, 'company-1');

    assert.deepEqual(views.map((view) => view.id), ['allowed', 'unfiltered']);
  });

  it('maps a saved location filter through the current branch scope before returning it', async () => {
    const repo = {
      listViews: async () => [
        { id: 'allowed', datasetCode: 'inventory.stock_balance', filters: { locationId: 'location-1' }, sourcePermissionSnapshot: ['inventory.report.read'], sourceScopeSnapshot: { branchIds: ['branch-1'] } },
        { id: 'hidden', datasetCode: 'inventory.stock_balance', filters: { locationId: 'location-2' }, sourcePermissionSnapshot: ['inventory.report.read'], sourceScopeSnapshot: { branchIds: ['branch-1'] } },
      ],
      listAuthorizedLocationIds: mock.fn(async () => ['location-1']),
    };
    const useCase = new ListReportViewsUseCase(repo as any, entitlement(false) as any);
    const scoped = {
      ...ctx,
      permissions: [...ctx.permissions, 'report.view.read', 'inventory.report.read'],
      scopes: { branchIds: ['branch-1'] },
    };

    const views = await useCase.execute(scoped, 'company-1');

    assert.deepEqual(views.map((view) => view.id), ['allowed']);
    assert.deepEqual((repo.listAuthorizedLocationIds.mock.calls as any[])[0]!.arguments, [
      'company-1', ['location-1', 'location-2'], ['branch-1'],
    ]);
  });

  it('retains a multi-authority ANY view while OFF when current authority dominates its creation snapshot', async () => {
    const useCase = new ListReportViewsUseCase({
      listViews: async () => [
        { id: 'multi-any', datasetCode: 'expense.summary', filters: {}, sourcePermissionSnapshot: ['expense.read_own'], sourceScopeSnapshot: {} },
        { id: 'single-any', datasetCode: 'ar.aging', filters: {}, sourcePermissionSnapshot: ['accounting.document.read'], sourceScopeSnapshot: {} },
        { id: 'legacy', datasetCode: 'ar.aging', filters: {}, sourceScopeSnapshot: {} },
      ],
    } as any, entitlement(false) as any);
    const scoped = {
      ...ctx,
      permissions: [...ctx.permissions, 'report.view.read', 'expense.read_own'],
    };

    const views = await useCase.execute(scoped, 'company-1');

    assert.deepEqual(views.map((view) => view.id), ['multi-any', 'single-any']);
    assert.ok(views.every((view) => !('sourcePermissionSnapshot' in view) && !('sourceScopeSnapshot' in view)));
  });

  it('keeps a broad-path ANY view after redundant own access is removed but hides a broad-to-own downgrade', async () => {
    const repo = {
      listViews: async () => [{
        id: 'expense-view', datasetCode: 'expense.summary', filters: {},
        sourcePermissionSnapshot: ['expense.read'], sourceScopeSnapshot: {},
      }],
    };
    const useCase = new ListReportViewsUseCase(repo as any, entitlement(false) as any);
    const enabledUseCase = new ListReportViewsUseCase(repo as any, entitlement(true) as any);
    const base = { ...ctx, permissions: [...ctx.permissions, 'report.view.read'] };

    const stillBroad = await useCase.execute({ ...base, permissions: [...base.permissions, 'expense.read'] }, 'company-1');
    const downgradedToOwn = await useCase.execute({ ...base, permissions: [...base.permissions, 'expense.read_own'] }, 'company-1');
    const enabledDowngrade = await enabledUseCase.execute({ ...base, permissions: [...base.permissions, 'expense.read_own'] }, 'company-1');

    assert.deepEqual(stillBroad.map((view) => view.id), ['expense-view']);
    assert.deepEqual(downgradedToOwn, []);
    assert.deepEqual(enabledDowngrade, [], 'source downgrade is fail-closed even while Reports remains ON');
  });
});

describe('ListReportExportsUseCase', () => {
  it('lists only exports whose current source permission remains authorized', async () => {
    const useCase = new ListReportExportsUseCase({
      listExports: async () => [
        { id: 'visible', datasetCode: 'ar.aging', sourcePermissionSnapshot: ['accounting.document.read'] },
        { id: 'hidden', datasetCode: 'inventory.stock_balance', sourcePermissionSnapshot: ['inventory.report.read'] },
      ],
    } as any, entitlement(false) as any);

    const rows = await useCase.execute(ctx, 'company-1');
    assert.deepEqual(rows.map((row) => row.id), ['visible']);
  });

  it('requires the narrow snapshot authority after OFF', async () => {
    const useCase = new ListReportExportsUseCase({ listExports: async () => [] } as any, entitlement(false) as any);
    await assert.rejects(
      () => useCase.execute({ ...ctx, permissions: ctx.permissions.filter((key) => key !== 'report.snapshot.read') }, 'company-1'),
      /report\.snapshot\.read/,
    );
  });

  it('hides exports generated under a broader branch scope after the user is narrowed', async () => {
    const useCase = new ListReportExportsUseCase({
      listExports: async () => [
        { id: 'branch-1', datasetCode: 'ar.aging', sourcePermissionSnapshot: ['accounting.document.read'], sourceScopeSnapshot: { branchIds: ['branch-1'] } },
        { id: 'all-branches', datasetCode: 'ar.aging', sourcePermissionSnapshot: ['accounting.document.read'], sourceScopeSnapshot: {} },
      ],
    } as any, entitlement(false) as any);

    const rows = await useCase.execute({ ...ctx, scopes: { branchIds: ['branch-1'] } }, 'company-1');
    assert.deepEqual(rows.map((row) => row.id), ['branch-1']);
  });

  it('does not offer expired or authority-unknown pre-U3 rows as downloadable READY files', async () => {
    const base = {
      companyId: 'company-1', requestedByUserId: 'user-1', datasetCode: 'ar.aging', datasetVersion: 1,
      format: 'CSV', status: 'READY', rowCount: 1, createdAt: now, updatedAt: now,
    } as const;
    const useCase = new ListReportExportsUseCase({
      listExports: async () => [
        { ...base, id: 'stored', storageKey: 'opaque', sourcePermissionSnapshot: ['accounting.document.read'], expiresAt: new Date(Date.now() + 60_000).toISOString() },
        { ...base, id: 'expired', storageKey: 'opaque', sourcePermissionSnapshot: ['accounting.document.read'], expiresAt: new Date(Date.now() - 60_000).toISOString() },
        { ...base, id: 'legacy' },
      ],
    } as any, entitlement(false) as any);

    const rows = await useCase.execute(ctx, 'company-1');
    assert.deepEqual(rows.map(({ id, status, errorCode }) => ({ id, status, errorCode })), [
      { id: 'stored', status: 'READY', errorCode: undefined },
      { id: 'expired', status: 'EXPIRED', errorCode: 'report_export_expired' },
    ]);
    assert.ok(rows.every((row) => !('storageKey' in row)), 'opaque object locator never crosses the API boundary');
  });

  it('keeps pre-U3 metadata discoverable while ON without treating it as downloadable bytes', async () => {
    const useCase = new ListReportExportsUseCase({
      listExports: async () => [{
        id: 'legacy', datasetCode: 'ar.aging', status: 'READY', rowCount: 12,
        sourceScopeSnapshot: {},
      }],
    } as any, entitlement(true) as any);

    const rows = await useCase.execute({ ...ctx, scopes: { branchIds: ['branch-1'] } }, 'company-1');

    assert.deepEqual(rows.map(({ id, status, errorCode }) => ({ id, status, errorCode })), [{
      id: 'legacy', status: 'FAILED', errorCode: 'legacy_export_not_materialized',
    }]);
    assert.equal(rows[0]?.rowCount, 0, 'unknown pre-U3 company-wide totals are redacted');
    assert.match(rows[0]?.errorMessage ?? '', /กรุณาสร้างไฟล์ CSV ใหม่/, 'ON copy stays actionable: re-export is possible');
  });

  it('never instructs a reports-OFF company to re-export an unmaterialized row', async () => {
    // Reachable OFF shape: the snapshot passes the retained filter, but the row has no bytes.
    const useCase = new ListReportExportsUseCase({
      listExports: async () => [{
        id: 'legacy-snap', datasetCode: 'ar.aging', status: 'READY', rowCount: 12,
        sourcePermissionSnapshot: ['accounting.document.read'],
        sourceScopeSnapshot: {},
      }],
    } as any, entitlement(false) as any);

    const rows = await useCase.execute(ctx, 'company-1');

    assert.equal(rows[0]?.errorCode, 'legacy_export_not_materialized');
    assert.match(rows[0]?.errorMessage ?? '', /ติดต่อผู้ดูแลให้เปิดฟีเจอร์รายงาน/);
  });

  it('hides an ANY-mode export after only part of its original source authority is revoked', async () => {
    const useCase = new ListReportExportsUseCase({
      listExports: async () => [{
        id: 'expense-export',
        datasetCode: 'expense.summary',
        sourcePermissionSnapshot: ['expense.read', 'expense.read_own'],
        sourceScopeSnapshot: {},
      }],
    } as any, entitlement(false) as any);

    const rows = await useCase.execute({
      ...ctx,
      permissions: [...ctx.permissions, 'expense.read_own'],
    }, 'company-1');

    assert.deepEqual(rows, [], 'current ANY access does not dominate the broader authority used at creation');
  });
});

describe('GetReportRunUseCase retained authority', () => {
  it('denies an ANY-mode run when current authority no longer dominates creation authority', async () => {
    const useCase = new GetReportRunUseCase({
      getRun: async () => ({
        id: 'run-1', companyId: 'company-1', requestedByUserId: 'user-1', datasetCode: 'expense.summary',
        permissionSnapshotJson: { permissions: ['expense.read', 'expense.read_own'] },
        sourceScopeSnapshotJson: {},
      }),
    } as any, entitlement(false) as any);

    await assert.rejects(
      () => useCase.execute({ ...ctx, permissions: [...ctx.permissions, 'expense.read_own'] }, 'company-1', 'run-1'),
      (error: any) => error.getStatus() === 403 && error.getResponse().code === 'report_artifact_authority_changed',
    );
  });

  it('never returns internal permission or scope snapshots', async () => {
    const useCase = new GetReportRunUseCase({
      getRun: async () => ({
        id: 'run-1', companyId: 'company-1', requestedByUserId: 'user-1', datasetCode: 'ar.aging',
        permissionSnapshotJson: { permissions: ctx.permissions },
        sourceScopeSnapshotJson: {},
        sourceRefsPreviewJson: { refs: [{ webPath: '/companies/company-1/reports' }] },
      }),
    } as any, entitlement(false) as any);

    const run = await useCase.execute(ctx, 'company-1', 'run-1');

    assert.equal('permissionSnapshotJson' in run, false);
    assert.equal('sourceScopeSnapshotJson' in run, false);
    assert.equal('sourceRefsPreviewJson' in run, false);
  });

  it('preserves accountant/admin retained access through report.audit.read without weakening source checks', async () => {
    const useCase = new GetReportRunUseCase({
      getRun: async () => ({
        id: 'run-1', companyId: 'company-1', requestedByUserId: 'another-user', datasetCode: 'ar.aging',
        permissionSnapshotJson: { permissions: ctx.permissions }, sourceScopeSnapshotJson: {},
      }),
    } as any, entitlement(false) as any);

    const run = await useCase.execute({ ...ctx, permissions: [...ctx.permissions, 'report.audit.read'] }, 'company-1', 'run-1');

    assert.equal(run.id, 'run-1');
  });
});

describe('ListReportRunsUseCase retained history', () => {
  it('returns only current source/scope-authorized run summaries with a stable next cursor', async () => {
    const createdAt = new Date('2026-08-01T00:00:00.000Z');
    const rows = [
      { id: 'run-3', requestedByUserId: 'user-1', datasetCode: 'ar.aging', datasetVersion: 1, status: 'READY', rowCount: 3, computedAt: createdAt, createdAt, errorCode: null, permissionSnapshotJson: { sourcePermissions: ['accounting.document.read'] }, sourceScopeSnapshotJson: {} },
      { id: 'hidden-source', requestedByUserId: 'user-1', datasetCode: 'inventory.stock_balance', datasetVersion: 1, status: 'READY', rowCount: 2, computedAt: createdAt, createdAt, errorCode: null, permissionSnapshotJson: { sourcePermissions: ['inventory.report.read'] }, sourceScopeSnapshotJson: {} },
      { id: 'run-2', requestedByUserId: 'user-1', datasetCode: 'ar.aging', datasetVersion: 1, status: 'PARTIAL', rowCount: 2, computedAt: createdAt, createdAt, errorCode: null, permissionSnapshotJson: { sourcePermissions: ['accounting.document.read'] }, sourceScopeSnapshotJson: {} },
      { id: 'run-1', requestedByUserId: 'user-1', datasetCode: 'ar.aging', datasetVersion: 1, status: 'READY', rowCount: 1, computedAt: createdAt, createdAt, errorCode: null, permissionSnapshotJson: { sourcePermissions: ['accounting.document.read'] }, sourceScopeSnapshotJson: {} },
    ];
    const useCase = new ListReportRunsUseCase({ listRunCandidates: async () => rows } as any, entitlement(false) as any);

    const page = await useCase.execute(ctx, 'company-1', { pageSize: 2 });

    assert.deepEqual(page.items.map((run) => run.id), ['run-3', 'run-2']);
    assert.equal(page.nextCursor, 'run-2');
    assert.ok(page.items.every((run) => !('permissionSnapshotJson' in run) && !('sourceScopeSnapshotJson' in run)));
  });
});

describe('saved-view authority snapshots', () => {
  it('captures effective source permissions and scopes automatically without customer input', async () => {
    let storedInput: any;
    const repo = {
      createView: mock.fn(async (_companyId: string, _userId: string, input: any) => {
        storedInput = input;
        return { id: 'view-1', ...input };
      }),
    };
    const useCase = new CreateReportViewUseCase(
      repo as any,
      { isAvailable: () => true } as any,
      { log: mock.fn() } as any,
      entitlement(true) as any,
    );

    await useCase.execute({
      ...ctx,
      permissions: [...ctx.permissions, 'report.view.create', 'expense.read', 'expense.read_own'],
      scopes: { branchIds: ['branch-1'] },
    }, 'company-1', { datasetCode: 'expense.summary', name: 'ค่าใช้จ่าย' });

    assert.deepEqual(storedInput.sourcePermissionSnapshot, ['expense.read']);
    assert.deepEqual(storedInput.sourceScopeSnapshot, { branchIds: ['branch-1'] });
  });
});

describe('reports OFF new-root fence', () => {
  it('returns feature_not_enabled before query/export/view/drilldown persistence', async () => {
    const disabled = entitlement(false) as any;
    const repo = { createRun: mock.fn(), createView: mock.fn(), updateView: mock.fn(), archiveView: mock.fn(), createDrilldownLog: mock.fn() } as any;
    const audit = { log: mock.fn() } as any;
    const adapters = { isAvailable: () => true, execute: mock.fn() } as any;
    const storage = { putObject: mock.fn() } as any;
    const attempts = [
      () => new RunReportQueryUseCase(repo, adapters, audit, disabled).execute(ctx, 'company-1', { datasetCode: 'ar.aging' }),
      () => new CreateReportViewUseCase(repo, adapters, audit, disabled).execute(ctx, 'company-1', { datasetCode: 'ar.aging', name: 'old' }),
      () => new UpdateReportViewUseCase(repo, { isAvailable: () => true } as any, audit, disabled).execute(ctx, 'company-1', 'view-1', { name: 'changed' }),
      () => new ArchiveReportViewUseCase(repo, audit, disabled).execute(ctx, 'company-1', 'view-1'),
      () => new CreateReportExportUseCase(
        repo, {} as any, audit, { execute: mock.fn() } as any, disabled, storage,
        { enqueue: mock.fn(async () => true) } as any,
      )
        .execute(ctx, 'company-1', { datasetCode: 'ar.aging', format: 'CSV' }),
      () => new ReportDrilldownUseCase(repo, disabled).execute(ctx, 'company-1', {
        datasetCode: 'ar.aging',
        sourceRef: { label: 'invoice', module: 'accounting-documents', entityType: 'invoice', permissionChecked: true },
      }),
    ];

    for (const attempt of attempts) await assert.rejects(attempt, (error: any) => error.code === 'feature_not_enabled');
    assert.equal(repo.createRun.mock.callCount(), 0);
    assert.equal(repo.createView.mock.callCount(), 0);
    assert.equal(repo.updateView.mock.callCount(), 0);
    assert.equal(repo.archiveView.mock.callCount(), 0);
    assert.equal(repo.createDrilldownLog.mock.callCount(), 0);
    assert.equal(storage.putObject.mock.callCount(), 0);
  });

  it('rejects a query and a saved view whose final write reaches a newer OFF→ON generation', async () => {
    const queryState = { enabled: true, epoch: 1, lastSeq: 1 };
    const queryRepo = { createRun: mock.fn(async () => ({ id: 'must-not-exist' })) };
    const query = new RunReportQueryUseCase(
      queryRepo as any,
      {
        isAvailable: () => true,
        execute: async () => {
          queryState.epoch = 2;
          queryState.lastSeq = 4;
          return {
            status: 'READY', computedAt: now,
            freshness: { computedAt: now, sourceModules: ['accounting-documents'], freshnessStatus: 'fresh' },
            warnings: [], columns: [], rows: [], sourceRefs: [], filters: {}, page: 1, pageSize: 100, total: 0,
          };
        },
      } as any,
      { log: mock.fn() } as any,
      mutableEntitlement(queryState) as any,
    );

    await assert.rejects(
      () => query.execute(ctx, 'company-1', { datasetCode: 'ar.aging' }),
      (error: any) => error.code === 'report_entitlement_changed',
    );
    assert.equal(queryRepo.createRun.mock.callCount(), 0);

    const viewState = { enabled: true, epoch: 1, lastSeq: 1 };
    const viewRepo = { createView: mock.fn(async () => ({ id: 'must-not-exist' })) };
    const view = new CreateReportViewUseCase(
      viewRepo as any,
      {
        isAvailable: () => {
          viewState.epoch = 2;
          viewState.lastSeq = 4;
          return true;
        },
      } as any,
      { log: mock.fn() } as any,
      mutableEntitlement(viewState) as any,
    );

    await assert.rejects(
      () => view.execute({ ...ctx, permissions: [...ctx.permissions, 'report.view.create'] }, 'company-1', { datasetCode: 'ar.aging', name: 'stale' }),
      (error: any) => error.code === 'report_entitlement_changed',
    );
    assert.equal(viewRepo.createView.mock.callCount(), 0);
  });

  it('durably queues exact-version cleanup when OFF→ON invalidates the export before its final row', async () => {
    const state = { enabled: true, epoch: 1, lastSeq: 1 };
    const repo = {
      createRun: mock.fn(async () => ({ id: 'must-not-exist' })),
      createExport: mock.fn(async () => ({ id: 'must-not-exist' })),
    };
    const storage = {
      putObject: mock.fn(async (input: { bytes: Buffer }) => {
        state.epoch = 2;
        state.lastSeq = 4;
        return {
          bucket: 'reports', objectKey: 'report-export/company-1/run-1/file.csv', objectVersionId: 'v1',
          storageProvider: 'test', byteSize: input.bytes.byteLength, checksumSha256: sha256(input.bytes.toString('utf8')),
        };
      }),
    };
    const cleanup = { enqueue: mock.fn(async (_input: EnqueueObjectVersionCleanupInput) => true) };
    const runQuery = {
      executeForExport: async () => ({
        runId: 'run-1', dataset: findReportDefinition('ar.aging')!, status: 'READY', computedAt: now,
        freshness: { computedAt: now, sourceModules: ['accounting-documents'], freshnessStatus: 'fresh' },
        warnings: [], columns: [{ key: 'row', label: 'Row', type: 'number' }], rows: [{ row: 1 }],
        sourceRefs: [], filters: {}, page: 1, pageSize: 5_000, total: 1,
        sourcePermissionsUsed: ['accounting.document.read'], pendingRun: pendingRun('run-1'),
      }),
    };
    const create = new CreateReportExportUseCase(
      repo as any,
      runQuery as any,
      { log: mock.fn() } as any,
      { execute: mock.fn() } as any,
      mutableEntitlement(state) as any,
      storage as any,
      cleanup as any,
    );

    await assert.rejects(
      () => create.execute(ctx, 'company-1', { datasetCode: 'ar.aging', format: 'CSV' }),
      (error: any) => error.code === 'report_entitlement_changed',
    );
    assert.equal(repo.createExport.mock.callCount(), 0);
    assert.equal(repo.createRun.mock.callCount(), 0);
    assert.equal(cleanup.enqueue.mock.callCount(), 1);
    assert.deepEqual(cleanup.enqueue.mock.calls[0]!.arguments[0], {
      source: 'REPORT_EXPORT',
      companyId: 'company-1',
      bucket: 'reports',
      objectPath: 'report-export/company-1/run-1/file.csv',
      expectedVersion: 'v1',
    });
  });
});

describe('immutable report export artifact', () => {
  it('stores CSV bytes once and downloads byte-identical content without rerunning a query', async () => {
    const csv = '\uFEFFCustomer,Outstanding\nAcme,100.00';
    const storageObjects = new Map<string, Buffer>();
    const storage = {
      putObject: mock.fn(async (input: { objectKey: string; bytes: Buffer }) => {
        storageObjects.set(input.objectKey, input.bytes);
        return {
          bucket: 'reports',
          objectKey: input.objectKey,
          objectVersionId: 'version-1',
          storageProvider: 'test',
          byteSize: input.bytes.byteLength,
          checksumSha256: sha256(input.bytes.toString('utf8')),
        };
      }),
      getObject: mock.fn(async ({ objectKey }: { objectKey: string }) => ({ bytes: storageObjects.get(objectKey)! })),
      deleteObject: async () => undefined,
    };
    let storedRow: any;
    const repo = {
      createRun: async (data: any) => ({ id: data.id }),
      createExport: async (data: any) => {
        storedRow = {
          id: 'export-1', companyId: data.companyId, requestedByUserId: data.requestedByUserId,
          datasetCode: data.datasetCode, datasetVersion: data.datasetVersion, format: data.input.format,
          status: data.status, rowCount: data.rowCount, fileName: data.fileName,
          fileMimeType: data.fileMimeType, fileSizeBytes: data.fileSizeBytes, storageKey: data.storageKey,
          sourceScopeSnapshot: data.sourceScopeSnapshot,
          sourcePermissionSnapshot: data.sourcePermissionSnapshot,
          warnings: data.coverageWarnings,
          sha256: data.sha256, expiresAt: data.expiresAt.toISOString(), createdAt: now, updatedAt: now,
        };
        return storedRow;
      },
      findExport: async () => ({ ...storedRow, filters: {} }),
    };
    const runQuery = {
      executeForExport: mock.fn(async () => ({
        runId: 'run-1', dataset: findReportDefinition('ar.aging')!,
        status: 'PARTIAL', computedAt: now, freshness: { computedAt: now, sourceModules: ['accounting-documents'], freshnessStatus: 'fresh' },
        warnings: ['accounting_documents_scope_forbidden'], columns: [{ key: 'customer', label: 'Customer', type: 'string' }, { key: 'amount', label: 'Outstanding', type: 'money' }],
        rows: [{ customer: 'Acme', amount: '100.00' }], sourceRefs: [], filters: {}, page: 1, pageSize: 100, total: 1,
        sourcePermissionsUsed: ['accounting.document.read'],
        pendingRun: pendingRun('run-1'),
      })),
    };
    const create = new CreateReportExportUseCase(
      repo as any,
      runQuery as any,
      { log: async () => undefined } as any,
      { execute: async () => undefined } as any,
      entitlement(true) as any,
      storage as any,
      { enqueue: async () => true } as any,
    );

    await create.execute(ctx, 'company-1', { datasetCode: 'ar.aging', format: 'CSV' });
    assert.equal(runQuery.executeForExport.mock.callCount(), 1);
    assert.equal(storage.putObject.mock.callCount(), 1);
    assert.match(storage.putObject.mock.calls[0]!.arguments[0].objectKey, /^report-export\/company-1\//);
    assert.equal(storageObjects.values().next().value?.toString('utf8'), csv);
    assert.match(storedRow.fileName, /ข้อมูลบางส่วน\.csv$/);
    assert.deepEqual(storedRow.warnings, ['accounting_documents_scope_forbidden']);

    const download = new DownloadReportExportUseCase(
      repo as any,
      { log: async () => undefined } as any,
      entitlement(false) as any,
      storage as any,
    );
    const result = await download.execute(ctx, 'company-1', 'export-1');
    assert.equal(result.content, csv);
    assert.equal('storageKey' in result.request, false, 'opaque object locator never crosses the download API boundary');
    assert.equal('sourceScopeSnapshot' in result.request, false, 'internal authorization snapshot never crosses the download API boundary');
    assert.equal('sourcePermissionSnapshot' in result.request, false, 'internal permission snapshot never crosses the download API boundary');
    assert.equal(runQuery.executeForExport.mock.callCount(), 1, 'download never recomputes live report data');
    assert.equal(storage.getObject.mock.callCount(), 1);
  });

  it('denies retained download after source permission, snapshot authority, or ownership is revoked', async () => {
    const request = {
      id: 'export-1', companyId: 'company-1', requestedByUserId: 'user-1', datasetCode: 'ar.aging',
      datasetVersion: 1, format: 'CSV', status: 'READY', rowCount: 1,
      storageKey: JSON.stringify({ bucket: 'reports', objectKey: 'artifact.csv', objectVersionId: 'v1' }),
      sourcePermissionSnapshot: ['accounting.document.read'],
      sha256: 'x', filters: {}, createdAt: now, updatedAt: now,
    };
    const useCase = new DownloadReportExportUseCase(
      { findExport: async () => request } as any,
      { log: async () => undefined } as any,
      entitlement(false) as any,
      { getObject: async () => ({ bytes: Buffer.from('x') }) } as any,
    );

    await assert.rejects(
      () => useCase.execute({ ...ctx, permissions: ctx.permissions.filter((key) => key !== 'accounting.document.read') }, 'company-1', 'export-1'),
      /source permission/,
    );
    await assert.rejects(
      () => useCase.execute({ ...ctx, permissions: ctx.permissions.filter((key) => key !== 'report.snapshot.read') }, 'company-1', 'export-1'),
      /report\.snapshot\.read/,
    );
    await assert.rejects(
      () => useCase.execute({ ...ctx, userId: 'user-2' }, 'company-1', 'export-1'),
      /report\.export\.read_own/,
    );
    await assert.rejects(
      () => useCase.execute({ ...ctx, scopes: { branchIds: ['branch-2'] } }, 'company-1', 'export-1'),
      /current scope/,
    );
  });

  it('denies ANY-mode retained bytes after only part of the original source authority is revoked', async () => {
    const request = {
      id: 'export-1', companyId: 'company-1', requestedByUserId: 'user-1', datasetCode: 'expense.summary',
      datasetVersion: 1, format: 'CSV', status: 'READY', rowCount: 1,
      storageKey: JSON.stringify({ bucket: 'reports', objectKey: 'report-export/company-1/run-1/artifact.csv', objectVersionId: 'v1' }),
      sourcePermissionSnapshot: ['expense.read', 'expense.read_own'],
      sourceScopeSnapshot: {}, sha256: '0'.repeat(64), filters: {}, createdAt: now, updatedAt: now,
    };
    const storage = { getObject: mock.fn(async () => ({ bytes: Buffer.from('secret') })) };
    const useCase = new DownloadReportExportUseCase(
      { findExport: async () => request } as any,
      { log: async () => undefined } as any,
      entitlement(false) as any,
      storage as any,
    );

    await assert.rejects(
      () => useCase.execute({ ...ctx, permissions: [...ctx.permissions, 'expense.read_own'] }, 'company-1', 'export-1'),
      (error: any) => error.getStatus() === 403 && error.getResponse().code === 'report_artifact_authority_changed',
    );
    assert.equal(storage.getObject.mock.callCount(), 0);
  });

  it('preserves authorized accountant/admin download through report.export.manage', async () => {
    const request = {
      id: 'export-1', companyId: 'company-1', requestedByUserId: 'another-user', datasetCode: 'ar.aging',
      datasetVersion: 1, format: 'CSV', status: 'READY', rowCount: 1,
      storageKey: JSON.stringify({ bucket: 'reports', objectKey: 'report-export/company-1/run-1/artifact.csv', objectVersionId: 'v1' }),
      sourcePermissionSnapshot: ['accounting.document.read'], sourceScopeSnapshot: {},
      sha256: '2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881',
      filters: {}, createdAt: now, updatedAt: now,
    };
    const useCase = new DownloadReportExportUseCase(
      { findExport: async () => request } as any,
      { log: async () => undefined } as any,
      entitlement(false) as any,
      { getObject: async () => ({ bytes: Buffer.from('x') }) } as any,
    );

    const result = await useCase.execute({
      ...ctx,
      userId: 'accountant-user',
      permissions: [...ctx.permissions, 'report.export.manage'],
    }, 'company-1', 'export-1');

    assert.equal(result.content, 'x');
  });

  it('fails closed when a READY artifact has no valid persisted SHA-256', async () => {
    const base = {
      id: 'export-1', companyId: 'company-1', requestedByUserId: 'user-1', datasetCode: 'ar.aging',
      datasetVersion: 1, format: 'CSV', status: 'READY', rowCount: 1,
      storageKey: JSON.stringify({ bucket: 'reports', objectKey: 'artifact.csv', objectVersionId: 'v1' }),
      sourcePermissionSnapshot: ['accounting.document.read'],
      filters: {}, createdAt: now, updatedAt: now,
    };
    for (const sha256 of [undefined, 'not-a-sha256']) {
      const useCase = new DownloadReportExportUseCase(
        { findExport: async () => ({ ...base, sha256 }) } as any,
        { log: async () => undefined } as any,
        entitlement(false) as any,
        { getObject: async () => ({ bytes: Buffer.from('stored bytes') }) } as any,
      );

      await assert.rejects(
        () => useCase.execute(ctx, 'company-1', 'export-1'),
        (error: any) => error.getStatus() === 410 && error.getResponse().code === 'report_export_integrity_failed',
      );
    }
  });

  it('never follows a retained storage locator outside the owning company prefix', async () => {
    const storage = { getObject: mock.fn(async () => ({ bytes: Buffer.from('secret') })) };
    const useCase = new DownloadReportExportUseCase(
      { findExport: async () => ({
        id: 'export-1', companyId: 'company-1', requestedByUserId: 'user-1', datasetCode: 'ar.aging',
        datasetVersion: 1, format: 'CSV', status: 'READY', rowCount: 1,
        storageKey: JSON.stringify({ bucket: 'reports', objectKey: 'report-export/company-10/run-1/file.csv', objectVersionId: 'v1' }),
        sourcePermissionSnapshot: ['accounting.document.read'],
        sha256: '0'.repeat(64), filters: {}, createdAt: now, updatedAt: now,
      }) } as any,
      { log: async () => undefined } as any,
      entitlement(false) as any,
      storage as any,
    );

    await assert.rejects(
      () => useCase.execute(ctx, 'company-1', 'export-1'),
      (error: any) => error.getStatus() === 410 && error.getResponse().code === 'report_export_integrity_failed',
    );
    assert.equal(storage.getObject.mock.callCount(), 0);
  });

  it('keeps legacy metadata friendly while ON and fails it closed while OFF', async () => {
    const request = {
      id: 'legacy', companyId: 'company-1', requestedByUserId: 'user-1', datasetCode: 'ar.aging',
      datasetVersion: 1, format: 'CSV', status: 'READY', rowCount: 1, filters: {}, sourceScopeSnapshot: {},
      createdAt: now, updatedAt: now,
    };
    const make = (enabled: boolean) => new DownloadReportExportUseCase(
      { findExport: async () => request } as any,
      { log: async () => undefined } as any,
      entitlement(enabled) as any,
      { getObject: async () => { throw new Error('must not read'); } } as any,
    );

    await assert.rejects(
      () => make(true).execute(ctx, 'company-1', 'legacy'),
      (error: any) => error.getResponse().code === 'legacy_export_not_materialized',
    );
    await assert.rejects(
      () => make(false).execute(ctx, 'company-1', 'legacy'),
      (error: any) => error.getResponse().code === 'report_artifact_authority_changed',
    );
  });
});

describe('bounded complete CSV export', () => {
  it('rejects every non-CSV format before query, storage, or customer-job creation', async () => {
    const repo = { createExport: mock.fn() };
    const runQuery = { executeForExport: mock.fn() };
    const storage = { putObject: mock.fn() };
    const useCase = new CreateReportExportUseCase(
      repo as any,
      runQuery as any,
      { log: async () => undefined } as any,
      { execute: async () => undefined } as any,
      entitlement(true) as any,
      storage as any,
      { enqueue: async () => true } as any,
    );

    for (const format of ['XLSX', 'PDF', undefined, null]) {
      await assert.rejects(
        () => useCase.execute(ctx, 'company-1', { datasetCode: 'ar.aging', format } as any),
        (error: any) => error.getStatus() === 400 && error.getResponse().code === 'export_format_unavailable',
      );
    }
    assert.equal(repo.createExport.mock.callCount(), 0);
    assert.equal(runQuery.executeForExport.mock.callCount(), 0);
    assert.equal(storage.putObject.mock.callCount(), 0);
  });

  it('queues an object version whose stored checksum or size does not match the exact CSV bytes', async () => {
    const repo = { createRun: mock.fn(), createExport: mock.fn() };
    const storage = {
      putObject: mock.fn(async () => ({
        bucket: 'reports', objectKey: 'mismatch.csv', objectVersionId: 'v1', storageProvider: 'test',
        byteSize: 999, checksumSha256: '0'.repeat(64),
      })),
    };
    const cleanup = { enqueue: mock.fn(async (_input: EnqueueObjectVersionCleanupInput) => true) };
    const runQuery = { executeForExport: async () => ({ ...pageResult(1, 1, 1), pendingRun: pendingRun('run-mismatch') }) };
    const useCase = new CreateReportExportUseCase(
      repo as any, runQuery as any, { log: async () => undefined } as any, { execute: async () => undefined } as any,
      entitlement(true) as any, storage as any, cleanup as any,
    );

    await assert.rejects(
      () => useCase.execute(ctx, 'company-1', { datasetCode: 'ar.aging', format: 'CSV' }),
      (error: any) => error.getStatus() === 409 && error.getResponse().code === 'report_export_integrity_failed',
    );
    assert.equal(cleanup.enqueue.mock.callCount(), 1);
    assert.equal(cleanup.enqueue.mock.calls[0]!.arguments[0].expectedVersion, 'v1');
    assert.equal(repo.createRun.mock.callCount(), 0);
    assert.equal(repo.createExport.mock.callCount(), 0);
  });
  const definition = findReportDefinition('ar.aging')!;
  const pageResult = (page: number, total: number, count: number) => ({
    runId: 'run-paged', dataset: definition, status: 'READY', computedAt: now,
    freshness: { computedAt: now, sourceModules: [definition.sourceModule], freshnessStatus: 'fresh' },
    warnings: [], columns: [{ key: 'row', label: 'Row', type: 'number' }],
    rows: Array.from({ length: count }, (_, index) => ({ row: ((page - 1) * 100) + index + 1 })),
    sourceRefs: [], filters: {}, page, pageSize: 100, total,
    sourcePermissionsUsed: ['accounting.document.read'], pendingRun: pendingRun('run-paged'),
  });

  function exportFixture(total: number) {
    let created: any;
    let uploaded: Buffer | undefined;
    const repo = {
      createRun: mock.fn(async (data: any) => ({ id: data.id })),
      createExport: mock.fn(async (data: any) => {
        created = data;
        return {
          id: 'export-paged', companyId: data.companyId, requestedByUserId: data.requestedByUserId,
          datasetCode: data.datasetCode, datasetVersion: data.datasetVersion, format: data.input.format,
          status: data.status, rowCount: data.rowCount, createdAt: now, updatedAt: now,
        };
      }),
    };
    const runQuery = { executeForExport: mock.fn(async () => pageResult(1, total, total)) };
    const storage = {
      putObject: mock.fn(async (input: { bytes: Buffer }) => {
        uploaded = input.bytes;
        return { bucket: 'reports', objectKey: 'paged.csv', objectVersionId: 'v1', storageProvider: 'test', byteSize: input.bytes.byteLength, checksumSha256: sha256(input.bytes.toString('utf8')) };
      }),
      deleteObject: async () => undefined,
    };
    const useCase = new CreateReportExportUseCase(
      repo as any, runQuery as any,
      { log: async () => undefined } as any, { execute: async () => undefined } as any,
      entitlement(true) as any, storage as any, { enqueue: async () => true } as any,
    );
    return { useCase, repo, runQuery, storage, created: () => created, uploaded: () => uploaded };
  }

  it('runs one 5,000-row adapter query and defers its owning ReportRun to the final export transaction', async () => {
    const repo = { createRun: mock.fn(async () => ({ id: 'run-complete' })) };
    const adapters = {
      isAvailable: () => true,
      executeForExport: mock.fn(async () => ({ ...pageResult(1, 250, 250), runId: undefined, dataset: undefined })),
    };
    const run = new RunReportQueryUseCase(
      repo as any, adapters as any, { log: async () => undefined } as any, entitlement(true) as any,
    );

    const result = await run.executeForExport(ctx, 'company-1', { datasetCode: 'ar.aging' });
    assert.equal(result.rows.length, 250);
    assert.equal(repo.createRun.mock.callCount(), 0);
    assert.equal(result.pendingRun.id, result.runId);
    assert.equal((adapters.executeForExport.mock.calls as any[])[0]!.arguments[2].pageSize, 5_000);
  });

  it('refuses a 5,001-row adapter result before persisting an owning ReportRun', async () => {
    const repo = { createRun: mock.fn(async () => ({ id: 'must-not-exist' })) };
    const adapters = {
      isAvailable: () => true,
      executeForExport: async () => ({ ...pageResult(1, 5_001, 5_000), runId: undefined, dataset: undefined }),
    };
    const run = new RunReportQueryUseCase(
      repo as any, adapters as any, { log: async () => undefined } as any, entitlement(true) as any,
    );

    await assert.rejects(
      () => run.executeForExport(ctx, 'company-1', { datasetCode: 'ar.aging' }),
      (error: any) => error.getStatus() === 413 && error.getResponse().code === 'export_too_large',
    );
    assert.equal(repo.createRun.mock.callCount(), 0);
  });

  it('pages past 100 and stores every exported row exactly once', async () => {
    const fixture = exportFixture(250);
    await fixture.useCase.execute(ctx, 'company-1', { datasetCode: 'ar.aging', format: 'CSV' });

    assert.equal(fixture.runQuery.executeForExport.mock.callCount(), 1, 'one durable ReportRun owns the complete export');
    assert.equal(fixture.repo.createRun.mock.callCount(), 1);
    assert.equal(fixture.created().rowCount, 250);
    const lines = fixture.uploaded()!.toString('utf8').trimEnd().split('\n');
    assert.equal(lines.length, 251, 'one header plus all 250 data rows');
    assert.equal(lines[1], '1');
    assert.equal(lines[250], '250');
  });

  it('returns typed 413/export_too_large at 5,001 rows before storing bytes', async () => {
    const fixture = exportFixture(5_001);
    await assert.rejects(
      () => fixture.useCase.execute(ctx, 'company-1', { datasetCode: 'ar.aging', format: 'CSV' }),
      (error: any) => error.getStatus() === 413 && error.getResponse().code === 'export_too_large',
    );
    assert.equal(fixture.storage.putObject.mock.callCount(), 0);
    assert.equal(fixture.repo.createExport.mock.callCount(), 0);
  });
});
