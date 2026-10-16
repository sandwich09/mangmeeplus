import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SetWhtIncomeCategoryStatusUseCase } from './wht-income-category.use-case.js';
import { ForbiddenException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DenyByDefaultGuard } from '../../../../common/security/deny-by-default.guard';
import { REQUIRED_PERMISSIONS_KEY } from '../../../../common/security/permissions.decorator';
import { PLATFORM_TENANT_ID } from '../../../sales-console/application/sales-context';
import { TaxController } from '../../presentation/http/tax.controller';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../../../../common/pipes/validation-pipe.options';

const ctx = (permissions: string[] = ['system.wht_income_category.manage']) =>
  ({ companyId: PLATFORM_TENANT_ID, userId: 'admin-1', roles: ['SYSTEM_ADMIN'], requestId: 'request-1', permissions, scopes: {} }) as any;

function useCase(rows: Record<string, any>, audits: any[] = []) {
  const repo = {
    prisma: {
      client: {
        whtIncomeCategory: {
          findUnique: async ({ where }: any) => rows[where.code] ?? null,
          update: async ({ where, data }: any) => { rows[where.code] = { ...rows[where.code], ...data }; return rows[where.code]; },
        },
      },
    },
  } as any;
  return { subject: new SetWhtIncomeCategoryStatusUseCase(repo, { log: async (entry: any) => { audits.push(entry); } } as any), rows, audits };
}

const draft = () => ({ WHT_SERVICE_5: { code: 'WHT_SERVICE_5', nameTh: 'ค่าบริการ (นิติบุคคล)', formType: 'PND53', defaultRate: '3.0000', status: 'DRAFT' } });

describe('SetWhtIncomeCategoryStatusUseCase', () => {
  it('records the platform administrator activating a category with a HIGH audit', async () => {
    const { subject, rows, audits } = useCase(draft());
    const result = await subject.execute(ctx(), 'WHT_SERVICE_5', 'ACTIVE');
    assert.equal(result.status, 'ACTIVE');
    assert.equal(rows['WHT_SERVICE_5'].status, 'ACTIVE');
    // Activating vouches for a statutory rate every later certificate inherits, so it is audited.
    assert.equal(audits[0].action, 'tax.wht_income_category.set_status');
    assert.equal(audits[0].riskLevel, 'HIGH');
    assert.equal(audits[0].companyId, PLATFORM_TENANT_ID);
    assert.deepEqual({ from: audits[0].metadataJson.from, to: audits[0].metadataJson.to }, { from: 'DRAFT', to: 'ACTIVE' });
  });

  it('can retire a category without touching what was already withheld under it', async () => {
    const rows = draft();
    rows['WHT_SERVICE_5']!.status = 'ACTIVE';
    const { subject } = useCase(rows);
    assert.equal((await subject.execute(ctx(), 'WHT_SERVICE_5', 'DRAFT')).status, 'DRAFT');
  });

  it('refuses without the manage permission, on an unknown code, or on a status it does not own', async () => {
    const { subject } = useCase(draft());
    await assert.rejects(() => subject.execute(ctx(['tax.config.read']), 'WHT_SERVICE_5', 'ACTIVE'), ForbiddenException);
    await assert.rejects(() => subject.execute(ctx(), 'WHT_MADE_UP', 'ACTIVE'), (e: any) => e.getStatus() === 404);
    await assert.rejects(() => subject.execute(ctx(), 'WHT_SERVICE_5', 'ARCHIVED'), (e: any) => e.getStatus() === 400);
  });

  it('refuses shop tax.config.manage through the legacy route before any mutation or audit', async () => {
    const { subject, rows, audits } = useCase(draft());
    const controller = Object.assign(Object.create(TaxController.prototype), { setWhtCategoryStatus: subject }) as TaxController;
    for (const permissions of [['tax.config.manage'], ['tax.config.manage', 'system.wht_income_category.manage']]) {
      await assert.rejects(() => controller.setWhtCategoryStatusRoute({ ...ctx(permissions), companyId: 'shop-1', roles: ['OWNER'] }, 'WHT_SERVICE_5', { status: 'ACTIVE' }), ForbiddenException);
    }
    assert.equal(rows.WHT_SERVICE_5.status, 'DRAFT');
    assert.deepEqual(audits, []);
  });
});

describe('System WHT catalog routes', () => {
  it('registers platform list and status routes and guards both with the dedicated permission', async () => {
    const { SystemWhtIncomeCategoryController } = await import('../../presentation/http/system-wht-income-category.controller');
    const { TaxModule } = await import('../../tax.module');
    assert.ok(Reflect.getMetadata('controllers', TaxModule).includes(SystemWhtIncomeCategoryController));
    assert.equal(Reflect.getMetadata('path', SystemWhtIncomeCategoryController), 'system/wht-income-categories');
    const { subject, rows, audits } = useCase(draft());
    const repo = { prisma: { client: { whtIncomeCategory: { findMany: async () => Object.values(rows) } } } } as any;
    const controller = new SystemWhtIncomeCategoryController(repo, subject);
    for (const method of ['list', 'setStatus'] as const) {
      const handler = SystemWhtIncomeCategoryController.prototype[method];
      assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler), ['system.wht_income_category.manage']);
      const request = { context: ctx() };
      const http = { getHandler: () => handler, getClass: () => SystemWhtIncomeCategoryController, switchToHttp: () => ({ getRequest: () => request }) } as any;
      const guard = new DenyByDefaultGuard(new Reflector());
      assert.equal(guard.canActivate(http), true);
      request.context = { ...ctx(['tax.config.manage']), companyId: 'shop-1', roles: ['OWNER'] };
      assert.throws(() => guard.canActivate(http), ForbiddenException);
      request.context = ctx([]);
      assert.throws(() => guard.canActivate(http), ForbiddenException, 'a role name does not bypass the permission');
    }
    assert.deepEqual(await controller.list(ctx()), Object.values(rows));
    assert.equal((await controller.setStatus(ctx(), 'WHT_SERVICE_5', { status: 'ACTIVE' })).status, 'ACTIVE');
    assert.equal(audits.length, 1);
  });

  it('refuses a shop tenant even with the platform permission, on reads and writes', async () => {
    const { SystemWhtIncomeCategoryController } = await import('../../presentation/http/system-wht-income-category.controller');
    const repo = { prisma: { client: { whtIncomeCategory: { findMany: async () => assert.fail('must not read catalog') } } } } as any;
    const { subject, rows, audits } = useCase(draft());
    const controller = new SystemWhtIncomeCategoryController(repo, subject);
    const shop = { ...ctx(), companyId: 'shop-1' };
    await assert.rejects(async () => controller.list(shop), ForbiddenException);
    await assert.rejects(async () => controller.setStatus(shop, 'WHT_SERVICE_5', { status: 'ACTIVE' }), ForbiddenException);
    assert.equal(rows.WHT_SERVICE_5.status, 'DRAFT');
    assert.equal(audits.length, 0);
  });

  it('validates status-only bodies and rejects editing names or rates', async () => {
    const { SetSystemWhtIncomeCategoryStatusDto } = await import('../../presentation/http/system-wht-income-category.controller');
    const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);
    const transform = (value: unknown) => pipe.transform(value, { type: 'body', metatype: SetSystemWhtIncomeCategoryStatusDto });
    for (const status of ['ACTIVE', 'DRAFT']) assert.equal((await transform({ status })).status, status);
    for (const body of [{}, { status: 'RETIRED' }, { status: 'ACTIVE', defaultRate: '15' }, { status: 'ACTIVE', nameTh: 'แก้ชื่อ' }]) {
      await assert.rejects(() => transform(body), (e: any) => e.getStatus() === 400);
    }
  });
});

it('the catalog migration only writes its global table and seed opens only accountant-approved rates', () => {
  const prisma = join(__dirname, '../../../../../prisma');
  const sql = readFileSync(join(prisma, 'migrations/20261004120000_open_wht_income_categories/migration.sql'), 'utf8').replace(/--[^\n]*/g, '').trim();
  assert.match(sql, /^INSERT INTO "WhtIncomeCategory"/);
  assert.equal(sql.split(';').filter(s => s.trim()).length, 1);
  assert.doesNotMatch(sql, /\b(?:CREATE|ALTER|DROP|DELETE|TRUNCATE)\b/);
  assert.match(sql, /ON CONFLICT \("code"\) DO UPDATE/);
  const seed = readFileSync(join(prisma, 'seed.ts'), 'utf8');
  const section = seed.slice(seed.indexOf('const WHT_CATEGORIES ='), seed.indexOf('// ── Item 11: Company tax profile'));
  assert.equal((section.match(/status: 'ACTIVE'/g) ?? []).length, 13);
  assert.equal((section.match(/status: 'DRAFT'/g) ?? []).length, 5);
  assert.match(section, /status: cat.status/);
  assert.match(section, /'filingRoute' in cat/);
  assert.match(section, /cat.code === 'WHT_PRIZE' \? \{ defaultRate: cat.defaultRate \}/);
  const routes = readFileSync(join(prisma, 'migrations/20261013120100_wht_income_routes_catalog/migration.sql'), 'utf8');
  assert.match(routes, /ON CONFLICT \("code"\) DO UPDATE/);
  assert.match(routes, /WHT_PRIZE.*PND3.*SYSTEM_FILLS.*5.0000.*ACTIVE/);
  assert.equal((routes.match(/'DRAFT'/g) ?? []).length, 5);
});

it('the expense catalogue exposes filing routes without changing its existing permission or active selection', async () => {
  const { ExpenseController } = await import('../../../expenses/presentation/http/expense.controller');
  const active = [{ code: 'WHT_PRIZE', nameTh: 'รางวัล', formType: 'PND3', defaultRate: '5' }, { code: 'WHT_OTHER_JUR', nameTh: 'อื่นๆ', formType: 'PND53', defaultRate: '3' }];
  let query: any;
  const controller = Object.assign(Object.create(ExpenseController.prototype), {
    listWhtCategories: { execute: async () => active },
    prisma: { client: { whtIncomeCategory: { findMany: async (input: any) => { query = input; return active.map(row => ({ code: row.code, filingRoute: row.code === 'WHT_PRIZE' ? 'SYSTEM_FILLS' : 'ACCOUNTANT_PREPARES' })); } } } },
  });
  const rows = await controller.whtIncomeCategories({ companyId: 'shop', permissions: ['expense.create'] });
  assert.deepEqual(rows.map((row: any) => row.filingRoute), ['SYSTEM_FILLS', 'ACCOUNTANT_PREPARES']);
  assert.deepEqual(query.where.code.in, active.map(row => row.code));
  assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, ExpenseController.prototype.whtIncomeCategories), ['expense.create']);
});
