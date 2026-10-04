/**
 * "แสดงเมนูบันทึกด้วยมือบนเว็บ" against real PostgreSQL (manual-expense-web-entry-flag spec §5, §10,
 * §13, plan P5).
 *
 * The setting is a per-company SCREEN setting: it hides or shows the web entrances to the manual
 * expense page and must change nothing behind them. The unit specs prove the command, the
 * `/auth/me` field and the web predicate against fakes. A fake cannot prove what the setting does
 * NOT do, because a fake only has the tables somebody thought to give it. This spec runs the real
 * code over a real database and compares, before and after the switch:
 *
 * 1. the migrations apply to an empty database, and a company created by the real onboarding has
 *    no row and reads as the one default;
 * 2. the permissions, the entitled feature keys and the LINE delivery fingerprint of every role in
 *    ROLE_GRANTS and every template in ROLE_TEMPLATES;
 * 3. the command itself: no-op, a real change, 409, a locked company, two operators at once;
 * 4. the LINE conversation rows of the company;
 * 5. the entitlement set version and the billing plan hash — and a plan pinned before the switch
 *    still applies after it;
 * 6. what creating, updating, marking ready and deleting an expense answers.
 *
 * It builds its own scratch database from the real migration files on the given server and drops
 * it afterwards: the permission registry is synced into it, which is a fact about the whole
 * database that the shared test database must not inherit from this spec.
 *
 * Run with (any database on a disposable local server; it is only used to create the scratch one):
 *   MANUAL_EXPENSE_WEB_ENTRY_TEST_DATABASE_URL='postgresql://…@127.0.0.1:5432/watchdog_step0_ci' \
 *     npx tsx --test src/modules/system-partner-management/manual-expense-web-entry.pg.spec.ts
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ConflictException, ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client } from 'pg';
import { ALL_FEATURE_ENTITLEMENT_KEYS } from '@watchdog-bms/contracts';
import { syncPermissions } from '../../../prisma/sync-permissions';
import { PrismaClient } from '../../generated/prisma/client';
import { PrismaPermissionResolverRepository } from '../access-control/infrastructure/prisma-permission-resolver.repository';
import { AuditService } from '../audit/application/audit.service';
import { PrismaAuditRepository } from '../audit/infrastructure/prisma-audit.repository';
import type { RequestContext } from '../auth/domain/models/request-context.model';
import { ROLE_GRANTS } from '../auth/permission-registry';
import { AuthController } from '../auth/presentation/auth.controller';
import { applyBillingFeaturePlan, billingFeaturePlan } from '../billing/application/billing-feature-entitlements';
import { PrismaAttachmentRepository } from '../data-model-core/infrastructure/repositories/prisma-attachment.repository';
import { loadEntitledFeatureKeys } from '../employee-access/application/entitlement.helper';
import { compileRole } from '../employee-access/domain/logic/capability.logic';
import { ROLE_TEMPLATES } from '../employee-access/domain/registries/role-template.registry';
import { DeleteExpenseUseCase } from '../expenses/application/use-cases/delete-expense.use-case';
import { CreateExpenseDraftUseCase, MarkExpenseReadyUseCase, UpdateExpenseDraftUseCase } from '../expenses/application/use-cases/expense-draft.use-case';
import { PrismaExpenseRepository } from '../expenses/infrastructure/prisma-expense.repository';
import { resolvedLineDeliveryAccessFingerprint } from '../line-ai/application/line-delivery-access';
import { CreateCompanyOnboardingUseCase } from '../system-onboarding/application/use-cases/create-company-onboarding.use-case';
import { SetPartnerManualExpenseWebEntryUseCase } from './application/use-cases/set-partner-manual-expense-web-entry.use-case';
import { GetPartnerDetailUseCase } from './application/use-cases/get-partner-detail.use-case';
import { MANUAL_EXPENSE_WEB_ENTRY_WITHOUT_ROW } from './domain/logic/manual-expense-web-entry.logic';
import { ListWhtIncomeCategoriesUseCase } from '../procurement/application/use-cases/wht-income-category.use-case';
import { ExpenseController } from '../expenses/presentation/http/expense.controller';

const databaseUrl = process.env.MANUAL_EXPENSE_WEB_ENTRY_TEST_DATABASE_URL;
const API_SRC = join(__dirname, '..', '..');
const MIGRATIONS = join(API_SRC, '..', 'prisma', 'migrations');
const MIGRATION = '20261002230000_company_web_entry_setting';
const PLATFORM = 'platform-company';
const ADMIN = 'admin-a';
const OTHER_ADMIN = 'admin-b';
const AUDIT_ACTION = 'system.partner_manual_expense_web_entry.update';
const WHT_MIGRATION = '20261004120000_open_wht_income_categories';
const WHT_APPROVED = [
  ['WHT_SERVICE_3', '3.0000', 'PND3'], ['WHT_SERVICE_5', '3.0000', 'PND53'],
  ['WHT_PROFESSIONAL_IND', '3.0000', 'PND3'], ['WHT_PROFESSIONAL_JUR', '3.0000', 'PND53'],
  ['WHT_RENT_IND', '5.0000', 'PND3'], ['WHT_RENT_JUR', '5.0000', 'PND53'],
  ['WHT_ADVERTISING_IND', '2.0000', 'PND3'], ['WHT_ADVERTISING_JUR', '2.0000', 'PND53'],
  ['WHT_TRANSPORT_IND', '1.0000', 'PND3'], ['WHT_TRANSPORT_JUR', '1.0000', 'PND53'],
  ['WHT_OTHER_IND', '3.0000', 'PND3'], ['WHT_OTHER_JUR', '3.0000', 'PND53'],
];
const WHT_DRAFT = ['WHT_DIVIDEND', 'WHT_INTEREST', 'WHT_PRIZE'];

/** Non-spec source files under a directory. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'generated' ? [] : sources(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : [];
  });
}

// Needs no database, so it runs wherever this file runs: the structural half of "nothing behind
// the entrances reads the setting". A guard, use case, repository, LINE tool or billing function
// that started to read it would have to name the table, the field or the default.
describe('manual-expense web entry — who reads the setting', () => {
  it('only the admin command, the partner detail and GET /auth/me touch it', () => {
    const touching = sources(API_SRC)
      .filter((path) => /companyWebEntrySetting|manualExpenseWebEntry|MANUAL_EXPENSE_WEB_ENTRY|manualExpenseEntryEnabled/i.test(readFileSync(path, 'utf8')))
      .map((path) => relative(API_SRC, path)).sort();
    assert.deepEqual(touching, [
      'modules/auth/presentation/auth.controller.ts',
      'modules/system-partner-management/application/use-cases/get-partner-detail.use-case.ts',
      'modules/system-partner-management/application/use-cases/set-partner-manual-expense-web-entry.use-case.ts',
      'modules/system-partner-management/domain/logic/manual-expense-web-entry.logic.ts',
      'modules/system-partner-management/presentation/http/partner.controller.ts',
      // Registers the command as a provider; it reads nothing.
      'modules/system-partner-management/system-partner-management.module.ts',
    ]);
  });

  it('the migration only creates its own table: nothing existing is altered and nothing is back-filled', () => {
    const sql = readFileSync(join(MIGRATIONS, MIGRATION, 'migration.sql'), 'utf8')
      .split('\n').filter((line) => !line.startsWith('--')).join('\n');
    const statements = sql.split(';').map((statement) => statement.trim()).filter(Boolean);
    assert.equal(statements.length, 3);
    assert.match(statements[0]!, /^CREATE TABLE "CompanyWebEntrySetting" \(/);
    assert.match(statements[1]!, /^CREATE UNIQUE INDEX "CompanyWebEntrySetting_companyId_key" ON "CompanyWebEntrySetting"\("companyId"\)$/);
    assert.match(statements[2]!, /^ALTER TABLE "CompanyWebEntrySetting" ADD CONSTRAINT "CompanyWebEntrySetting_companyId_fkey" FOREIGN KEY \("companyId"\) REFERENCES "Company"\("id"\) ON DELETE CASCADE ON UPDATE CASCADE$/);
    // Three statements, each about the new table: no existing table is altered, no row is written.
    for (const statement of statements) assert.match(statement, /^(CREATE TABLE|CREATE UNIQUE INDEX "CompanyWebEntrySetting_companyId_key" ON|ALTER TABLE) "CompanyWebEntrySetting"/);
    // A row always states its value: the one default lives in the application, not in the column.
    assert.match(statements[0]!, /"manualExpenseEntryEnabled" BOOLEAN NOT NULL,/);
  });
});

describe('manual-expense web entry on real PostgreSQL', { skip: !databaseUrl }, () => {
  let admin: Client;
  let raw: Client;
  let client: PrismaClient;
  let prisma: { client: PrismaClient };
  let scratch: string;
  let command: SetPartnerManualExpenseWebEntryUseCase;
  let resolver: PrismaPermissionResolverRepository;
  let me: AuthController;
  let companyId: string;
  let ownerId: string;

  it('all migrations on a fresh database expose exactly the 12 approved categories through the expense endpoint', async () => {
    const rows = await client.whtIncomeCategory.findMany({ orderBy: { code: 'asc' } });
    assert.equal(rows.length, 15);
    assert.deepEqual(rows.filter(row => row.status === 'DRAFT').map(row => row.code), [...WHT_DRAFT].sort());
    const controller = Object.assign(Object.create(ExpenseController.prototype), {
      listWhtCategories: new ListWhtIncomeCategoriesUseCase(prisma as never),
    }) as ExpenseController;
    for (const shop of ['shop-a', 'shop-b']) {
      const options = await controller.whtIncomeCategories({ companyId: shop, permissions: ['expense.create'] } as RequestContext);
      assert.deepEqual(options.map(row => [row.code, row.defaultRate, row.formType]), WHT_APPROVED.map(([code, rate, form]) => [code, String(Number(rate)), form]).sort());
    }
  });

  it('the catalog migration inserts missing rows, opens seeded rows, preserves exceptions and repeats without changing rows', async () => {
    const sql = readFileSync(join(MIGRATIONS, WHT_MIGRATION, 'migration.sql'), 'utf8');
    // A temporary copy isolates this data-only migration from the suite's public global catalog.
    await raw.query('BEGIN');
    try {
      await raw.query('CREATE TEMP TABLE "WhtIncomeCategory" (LIKE public."WhtIncomeCategory" INCLUDING ALL) ON COMMIT DROP');
      assert.equal((await raw.query(sql)).rowCount, 15);
      const read = async () => (await raw.query('SELECT * FROM pg_temp."WhtIncomeCategory" ORDER BY "code"')).rows;
      const assertStatuses = (rows: any[]) => {
        assert.equal(rows.length, 15);
        assert.deepEqual(rows.filter(row => row.status === 'ACTIVE').map(row => [row.code, row.defaultRate, row.formType]), [...WHT_APPROVED].sort());
        assert.deepEqual(rows.filter(row => row.status === 'DRAFT').map(row => row.code), [...WHT_DRAFT].sort());
      };
      const fresh = await read();
      assertStatuses(fresh);
      assert.equal((await raw.query(sql)).rowCount, 0);
      assert.deepEqual(await read(), fresh, 'a repeat is a no-op');

      // Same 15-row seed baseline, with existing ids and review notes to preserve.
      await raw.query('UPDATE pg_temp."WhtIncomeCategory" SET "status" = \'DRAFT\', "conditionNote" = \'existing review note\'');
      const seeded = await read();
      assert.equal((await raw.query(sql)).rowCount, 12);
      const opened = await read();
      assertStatuses(opened);
      assert.deepEqual(opened.map(row => row.id), seeded.map(row => row.id));
      assert.deepEqual(opened.filter(row => WHT_DRAFT.includes(row.code)), seeded.filter(row => WHT_DRAFT.includes(row.code)));
      assert.equal((await raw.query(sql)).rowCount, 0);
      assert.deepEqual(await read(), opened);

      await raw.query('UPDATE pg_temp."WhtIncomeCategory" SET "status" = \'RETIRED\' WHERE "code" = ANY($1)', [WHT_DRAFT]);
      const retired = await read();
      assert.equal((await raw.query(sql)).rowCount, 0);
      assert.deepEqual(await read(), retired, 'existing exceptional statuses are left as they are');
    } finally {
      await raw.query('ROLLBACK');
    }
  });
  /** One user per role of ROLE_GRANTS and per template of ROLE_TEMPLATES, all members of the shop. */
  const actors: Array<{ label: string; userId: string }> = [];
  const actor = (label: string) => actors.find((candidate) => candidate.label === label)!.userId;

  /** GET /auth/me as production builds it, with the two collaborators `me()` reads. */
  function authController(): AuthController {
    const source = readFileSync(join(API_SRC, 'modules', 'auth', 'presentation', 'auth.controller.ts'), 'utf8');
    const start = source.indexOf('constructor(', source.indexOf('export class AuthController'));
    const params = [...source.slice(start, source.indexOf(') {}', start)).matchAll(/private readonly (\w+):/g)].map((match) => match[1]!);
    assert.ok(params.includes('prisma') && params.includes('legalAcceptance'), 'AuthController no longer names prisma and legalAcceptance');
    const args = params.map((name) => (name === 'prisma' ? prisma : name === 'legalAcceptance' ? { getStatus: async () => ({ required: false }) } : {}));
    return new (AuthController as unknown as new (...deps: unknown[]) => AuthController)(...args);
  }

  async function contextOf(userId: string): Promise<RequestContext> {
    const access = await resolver.resolveForUser({ userId, companyId });
    return {
      requestId: `req-${randomUUID().slice(0, 8)}`, authSubject: userId, userId, companyId,
      membershipId: access.membershipId, roles: access.roles, permissions: access.permissions,
      scopes: access.scopes, authProvider: 'watchdog',
    };
  }

  /** Everything the resolver answers for one actor, plus what LINE fingerprints its deliveries with. */
  async function accessOf(userId: string) {
    const access = await resolver.resolveForUser({ userId, companyId });
    const entitled = await loadEntitledFeatureKeys(prisma as never, companyId);
    return {
      roles: [...access.roles].sort(),
      permissions: [...access.permissions].sort(),
      denied: access.entitlementDeniedPermissions,
      entitledFeatureKeys: access.entitledFeatureKeys == null ? access.entitledFeatureKeys : [...access.entitledFeatureKeys].sort(),
      scopes: access.scopes,
      lineDeliveryFingerprint: resolvedLineDeliveryAccessFingerprint(userId, companyId, access, entitled),
    };
  }

  const stored = (id = companyId) => client.companyWebEntrySetting.findUnique({ where: { companyId: id } });
  const audits = (id = companyId) => client.auditLog.count({ where: { companyId: id, action: AUDIT_ACTION } });
  const press = (enabled: boolean, expectedVersion: number, by = ADMIN, id = companyId) => command.execute({
    companyId: id, enabled, expectedVersion, requestingAdminUserId: by, requestId: `req-${randomUUID().slice(0, 8)}`,
  });
  /** Put the shop into a state the way an operator would: read the version, then press. */
  async function switchTo(enabled: boolean) {
    return press(enabled, (await stored())?.version ?? 0);
  }

  before(async () => {
    const url = new URL(databaseUrl!);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'only an explicit local test server is allowed');
    // Localhost is not proof of a local server (a production tunnel listens there too), so the
    // database named in the URL has to be a disposable one before anything is created beside it.
    assert.ok(url.pathname === '/watchdog_bms' || url.pathname.endsWith('_ci'),
      `refusing to work next to ${url.pathname}: only a disposable test server is allowed`);
    scratch = `manual_expense_web_entry_${randomUUID().slice(0, 8)}_ci`;
    admin = new Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${scratch}"`);
    url.pathname = `/${scratch}`;

    // The real migrations, every one, in order — the way `prisma migrate deploy` sends them.
    raw = new Client({ connectionString: url.toString() });
    await raw.connect();
    const names = readdirSync(MIGRATIONS, { withFileTypes: true })
      .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    assert.ok(names.includes(MIGRATION));
    for (const name of names) await raw.query(readFileSync(join(MIGRATIONS, name, 'migration.sql'), 'utf8'));

    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) });
    prisma = { client };
    // The same reconciler production boots with: every permission, system role and grant of the code.
    await syncPermissions(client, () => undefined);
    command = new SetPartnerManualExpenseWebEntryUseCase(prisma as never);
    resolver = new PrismaPermissionResolverRepository(prisma as never);
    me = authController();

    await client.company.create({ data: { id: PLATFORM, name: 'Platform' } });
    const systemAdmin = await client.role.findUniqueOrThrow({ where: { scopeKey_key: { scopeKey: 'system', key: 'SYSTEM_ADMIN' } } });
    for (const userId of [ADMIN, OTHER_ADMIN]) {
      await client.user.create({ data: { id: userId, displayName: userId } });
      await client.companyMembership.create({ data: { companyId: PLATFORM, userId, roles: { create: { roleId: systemAdmin.id } } } });
    }

    // The shop: created by the REAL onboarding use case, the way the admin console creates one.
    const onboarding = new CreateCompanyOnboardingUseCase(
      prisma as never,
      { credentialEncryptionKey: Buffer.alloc(32, 7), lineLiffId: undefined } as never,
      { recordFromEvidence: async () => undefined } as never,
    );
    const shop = await onboarding.execute({
      companyName: 'ร้านทดสอบเมนูบันทึกด้วยมือ', ownerDisplayName: 'เจ้าของร้าน', ownerUsername: 'manual-entry-owner',
      requestingAdminUserId: ADMIN, requestId: `onboard-${randomUUID().slice(0, 8)}`,
      webBaseUrl: 'http://127.0.0.1', apiBaseUrl: 'http://127.0.0.1/v1',
    });
    companyId = shop.companyId;
    ownerId = shop.ownerId;

    const permissionIds = new Map((await client.permission.findMany({ select: { id: true, key: true } })).map((row) => [row.key, row.id]));
    const member = async (label: string, roleId: string) => {
      const userId = `user-${actors.length}`;
      await client.user.create({ data: { id: userId, displayName: label } });
      await client.companyMembership.create({ data: { companyId, userId, branchScopeMode: 'ALL_BRANCHES', roles: { create: { roleId } } } });
      actors.push({ label, userId });
    };
    for (const key of Object.keys(ROLE_GRANTS)) {
      const role = await client.role.findUniqueOrThrow({ where: { scopeKey_key: { scopeKey: 'system', key } } });
      await member(key, role.id);
    }
    for (const template of ROLE_TEMPLATES) {
      // What a company role built from the template is granted, before the company's own entitlements.
      const { permissionKeys } = compileRole({ roleTemplateKey: template.key, entitledFeatureKeys: null });
      const role = await client.role.create({ data: {
        companyId, scopeKey: companyId, key: `role-${actors.length}`, name: template.nameTh,
        permissions: { create: permissionKeys.map((key) => ({ permissionId: permissionIds.get(key)! })) },
      } });
      await member(template.key, role.id);
    }
  });

  after(async () => {
    await client?.$disconnect().catch(() => undefined);
    await raw?.end().catch(() => undefined);
    if (admin) {
      try {
        if (scratch) await admin.query(`DROP DATABASE IF EXISTS "${scratch}" WITH (FORCE)`);
      } finally {
        await admin.end();
      }
    }
  });

  it('a company created by the real onboarding has no row, and reads as the one default everywhere', async () => {
    assert.equal(await client.companyWebEntrySetting.count(), 0, 'onboarding and the migrations wrote no row');
    assert.equal(await stored(), null);

    const answer = await me.me({ context: await contextOf(ownerId) } as never);
    assert.equal(answer.manualExpenseWebEntry, MANUAL_EXPENSE_WEB_ENTRY_WITHOUT_ROW);
    assert.equal(answer.companyId, companyId);

    const detail = await new GetPartnerDetailUseCase(prisma as never, { get: async () => ({ status: 'UNKNOWN', version: 0 }) } as never).execute(companyId);
    assert.deepEqual(detail.manualExpenseWebEntry, { enabled: MANUAL_EXPENSE_WEB_ENTRY_WITHOUT_ROW, version: 0 });
    // The shop is a normal new shop: an explicit, complete entitlement set that owns no key for this.
    assert.equal(detail.featureEntitlements.length, ALL_FEATURE_ENTITLEMENT_KEYS.length);
    assert.equal(detail.entitlementNormalizationPending, false);
  });

  it('no role and no template gains or loses anything when the setting is switched', async () => {
    assert.equal(actors.length, Object.keys(ROLE_GRANTS).length + ROLE_TEMPLATES.length);
    const snapshot = async () => Object.fromEntries(await Promise.all(actors.map(async ({ label, userId }) => [label, await accessOf(userId)] as const)));

    const withoutRow = await snapshot();
    await switchTo(!MANUAL_EXPENSE_WEB_ENTRY_WITHOUT_ROW);
    const afterFirstChange = await snapshot();
    await switchTo(MANUAL_EXPENSE_WEB_ENTRY_WITHOUT_ROW);
    const afterSecondChange = await snapshot();
    await switchTo(!MANUAL_EXPENSE_WEB_ENTRY_WITHOUT_ROW);
    const afterThirdChange = await snapshot();

    for (const { label } of actors) {
      assert.deepEqual(afterFirstChange[label], withoutRow[label], label);
      assert.deepEqual(afterSecondChange[label], withoutRow[label], label);
      assert.deepEqual(afterThirdChange[label], withoutRow[label], label);
    }
    // The comparison is about something: the shop's staff do hold the permissions the menu leads to…
    assert.ok(withoutRow['STAFF']!.permissions.includes('expense.create'));
    assert.ok(withoutRow['OWNER']!.permissions.includes('expense.create'));
    assert.ok(withoutRow['OWNER']!.entitledFeatureKeys!.includes('expenses.manual'));
    // …and a finance template still deletes without updating, exactly as before (spec §11).
    assert.ok(withoutRow['tpl.x.finance']!.permissions.includes('expense.delete'));
    assert.ok(!withoutRow['tpl.x.finance']!.permissions.includes('expense.update'));
  });

  it('GET /auth/me follows the stored value and answers the same permissions in every state', async () => {
    const staff = actor('STAFF');
    const answers = [];
    for (const enabled of [true, false, true]) {
      await switchTo(enabled);
      answers.push(await me.me({ context: await contextOf(staff) } as never));
    }
    assert.deepEqual(answers.map((answer) => answer.manualExpenseWebEntry), [true, false, true]);
    assert.deepEqual(answers[1]!.permissions, answers[0]!.permissions);
    assert.deepEqual(answers[2]!.permissions, answers[0]!.permissions);
    assert.ok(answers[1]!.permissions.includes('expense.create'), 'hidden is not a refusal: the permission stays');
  });

  it('the command: the same value writes nothing, a change is one row and one audit row, an old version is 409', async () => {
    await switchTo(true);
    const start = (await stored())!;
    const auditsBefore = await audits();

    // The same value again, also from an old version (a repeated press, a retry after a lost answer).
    assert.deepEqual(await press(true, start.version), { enabled: true, version: start.version });
    assert.deepEqual(await press(true, 0), { enabled: true, version: start.version });
    assert.deepEqual((await stored())!.updatedAt, start.updatedAt);
    assert.equal(await audits(), auditsBefore);

    // A real change.
    assert.deepEqual(await press(false, start.version), { enabled: false, version: start.version + 1 });
    const hidden = (await stored())!;
    assert.deepEqual([hidden.manualExpenseEntryEnabled, hidden.version, hidden.updatedBySystemAdminUserId], [false, start.version + 1, ADMIN]);
    assert.equal(await audits(), auditsBefore + 1);
    const audit = await client.auditLog.findFirstOrThrow({ where: { companyId, action: AUDIT_ACTION }, orderBy: { createdAt: 'desc' } });
    assert.deepEqual([audit.actorUserId, audit.targetType, audit.targetId, audit.result, audit.riskLevel], [ADMIN, 'company', companyId, 'SUCCESS', 'MEDIUM']);
    assert.deepEqual(audit.metadataJson, {
      entryPoint: 'SYSTEM_PARTNER_ADMIN', fromEnabled: true, toEnabled: false, fromVersion: start.version, toVersion: start.version + 1,
    });

    // A second operator whose page still shows the old version wants a different value: refused.
    await assert.rejects(() => press(true, start.version, OTHER_ADMIN), (error: unknown) => {
      assert.ok(error instanceof ConflictException);
      assert.deepEqual(error.getResponse(), {
        code: 'manual_expense_web_entry_version_conflict',
        message: 'The setting changed after it was loaded. Reload before saving again.',
        currentVersion: start.version + 1,
      });
      return true;
    });
    assert.deepEqual((await stored())!.updatedAt, hidden.updatedAt);
    assert.equal(await audits(), auditsBefore + 1);
  });

  it('two operators pressing at once make one change: the company row lock orders them', async () => {
    await switchTo(false);
    const start = (await stored())!;
    const auditsBefore = await audits();

    const results = await Promise.all([press(true, start.version, ADMIN), press(true, start.version, OTHER_ADMIN)]);
    assert.deepEqual(results, [{ enabled: true, version: start.version + 1 }, { enabled: true, version: start.version + 1 }]);
    assert.equal((await stored())!.version, start.version + 1);
    assert.equal(await audits(), auditsBefore + 1, 'the second press found the value already there');
  });

  it('switching leaves every LINE conversation row of the company exactly as it was', async () => {
    await switchTo(true);
    const later = new Date('2035-01-01T00:00:00.000Z');
    const membership = await client.companyMembership.findFirstOrThrow({ where: { companyId, userId: ownerId } });
    const conversation = await client.aiConversation.create({ data: {
      companyId, userId: ownerId, channel: 'line', channelKind: 'USER', messagingChannelId: 'channel-1', chatKeyHash: 'chat-hash-1',
      membershipId: membership.id, stateVersion: 4, lifecycleEpoch: 2, stateExpiresAt: later,
      taskStateJson: { version: 2, tasks: [{ kind: 'expense_draft', question: 'ราคาเท่าไร' }] },
    } });
    // A legacy conversation too: the entitlement command deletes those outright.
    await client.aiConversation.create({ data: { companyId, userId: ownerId, channel: 'line' } });
    await client.aiTurn.create({ data: { conversationId: conversation.id, companyId, userId: ownerId, messagePreviewHash: '0123456789abcdef' } });
    await client.lineIntakePendingMedia.create({ data: {
      companyId, userId: ownerId, lineMessageId: 'line-message-1', attachmentId: 'attachment-1', mimeType: 'image/jpeg',
      status: 'PENDING', expiresAt: later, askedQuestionJson: { question: 'รูปนี้คืออะไร' },
    } });
    // A reply waiting to be sent. The plan table demands an owner row and sha-256 shaped ids.
    const outbox = await client.outboxEvent.create({ data: {
      companyId, eventType: 'line.reply', aggregateType: 'line', aggregateId: conversation.id, eventKey: `line-reply-${randomUUID()}`, payloadJson: {},
    } });
    await client.lineDeliveryPlan.create({ data: {
      id: 'a'.repeat(64), outboxEventId: outbox.id, companyId, userId: ownerId, planJson: { messages: 1 }, planHash: 'b'.repeat(64),
      batchStateJson: {}, status: 'READY', expiresAt: later, purgeAt: later,
    } });
    const rows = async () => ({
      conversations: await client.aiConversation.findMany({ where: { companyId }, orderBy: { id: 'asc' } }),
      turns: await client.aiTurn.findMany({ where: { companyId }, orderBy: { id: 'asc' } }),
      pendingMedia: await client.lineIntakePendingMedia.findMany({ where: { companyId }, orderBy: { id: 'asc' } }),
      deliveryPlans: await client.lineDeliveryPlan.findMany({ where: { companyId }, orderBy: { id: 'asc' } }),
    });

    const before = await rows();
    assert.deepEqual([before.conversations.length, before.turns.length, before.pendingMedia.length, before.deliveryPlans.length], [2, 1, 1, 1]);
    await switchTo(false);
    await switchTo(true);
    await switchTo(false);
    assert.deepEqual(await rows(), before);
  });

  it('switching moves neither the entitlement set nor the billing plan, and a plan pinned before it still applies', async () => {
    await switchTo(true);
    const set = () => client.companyEntitlementSet.findUniqueOrThrow({ where: { companyId } });
    const entitlementWrites = async () => ({
      rows: await client.companyFeatureEntitlement.findMany({ where: { companyId }, orderBy: { featureKey: 'asc' } }),
      transitions: await client.entitlementTransition.count({ where: { companyId } }),
      runoffSnapshots: await client.runoffSnapshot.count({ where: { companyId } }),
      commands: await client.entitlementCommand.count({ where: { companyId } }),
    });

    // What a checkout pins when the customer opens the payment page.
    const pinned = await billingFeaturePlan(client as never, companyId);
    const setBefore = await set();
    const writesBefore = await entitlementWrites();

    await switchTo(false);
    await switchTo(true);
    await switchTo(false);

    const current = await billingFeaturePlan(client as never, companyId);
    assert.equal(current.plan.sourceHash, pinned.plan.sourceHash);
    assert.equal(current.plan.planHash, pinned.plan.planHash);
    assert.deepEqual(current.impact, pinned.impact);
    assert.deepEqual(await set(), setBefore);
    assert.deepEqual(await entitlementWrites(), writesBefore);

    // The customer pays after the operator switched: the pinned plan applies, nothing is held.
    const disabled = await client.$transaction((tx) => applyBillingFeaturePlan(tx, companyId, `invoice-${randomUUID().slice(0, 8)}`, ownerId, pinned.plan));
    assert.ok(Array.isArray(disabled));
    assert.equal((await set()).setVersion, setBefore.setVersion + 1);
    // And the purchase did not touch the setting either (spec §10): it is still what the operator left.
    assert.equal((await stored())!.manualExpenseEntryEnabled, false);
  });

  it('creating, updating, marking ready and deleting an expense answer the same in every state', async () => {
    const repo = new PrismaExpenseRepository(prisma as never);
    const audit = new AuditService(new PrismaAuditRepository(prisma as never), { error: () => undefined } as never);
    // Tax resolution and the platform launch gate are not about this setting; the launch gate is open.
    const tax = { resolveLines: async (_ctx: unknown, _header: unknown, lines: unknown[]) => lines } as never;
    const create = new CreateExpenseDraftUseCase(repo, audit, tax, { assertLaunchRouteOpen: async () => undefined } as never);
    const update = new UpdateExpenseDraftUseCase(repo, audit, tax);
    const markReady = new MarkExpenseReadyUseCase(repo);
    const remove = new DeleteExpenseUseCase(prisma as never, new PrismaAttachmentRepository(prisma as never), audit);
    const draft = (ctx: RequestContext) => create.execute(ctx, {
      idempotencyKey: `manual-${randomUUID()}`, captureSource: 'WEB_MANUAL', expenseDate: '2026-10-02', vatMode: 'NO_VAT',
      inputVatClaimStatus: 'NON_CLAIMABLE',
      lines: [{ lineNumber: 1, description: 'ค่ากาแฟประชุม', quantity: '1', unitPrice: '65', discountAmount: '0' }],
    });
    const answer = async (run: () => Promise<unknown>) => {
      try { await run(); return 'ok'; } catch (error) { return (error as Error).constructor.name; }
    };

    /** One staff member and one read-only auditor, each trying the four writes. */
    async function journey() {
      const staff = await contextOf(actor('STAFF'));
      const auditor = await contextOf(actor('AUDITOR_READONLY'));
      const own = await draft(staff);
      const spare = await draft(staff);
      const others = await draft(staff);
      return {
        staff: {
          create: 'ok',
          update: await answer(() => update.execute(staff, own.id, { expectedUpdatedAt: own.updatedAt.toISOString(), note: 'แก้หมายเหตุ' } as never)),
          markReady: await answer(() => markReady.execute(staff, own.id)),
          delete: await answer(() => remove.execute(staff, spare.id)),
        },
        auditor: {
          create: await answer(() => draft(auditor)),
          update: await answer(() => update.execute(auditor, others.id, { expectedUpdatedAt: others.updatedAt.toISOString(), note: 'x' } as never)),
          markReady: await answer(() => markReady.execute(auditor, others.id)),
          delete: await answer(() => remove.execute(auditor, others.id)),
        },
        // A draft made through the manual page is an ordinary draft in every state.
        captureSource: own.captureSource,
      };
    }

    await switchTo(true);
    const shown = await journey();
    await switchTo(false);
    const hidden = await journey();
    await switchTo(true);
    const shownAgain = await journey();

    assert.deepEqual(hidden, shown);
    assert.deepEqual(shownAgain, shown);
    // The holder's writes go through and the read-only actor is refused — in the hidden state too,
    // because hiding the menu is not a refusal to record by hand.
    assert.deepEqual(hidden.staff, { create: 'ok', update: 'ok', markReady: 'ok', delete: 'ok' });
    assert.deepEqual(hidden.auditor, { create: ForbiddenException.name, update: ForbiddenException.name, markReady: ForbiddenException.name, delete: ForbiddenException.name });
    assert.equal(hidden.captureSource, 'WEB_MANUAL');
  });

  it('a disabled or archived company is refused with the partner metadata lock, and its stored value stays', async () => {
    await switchTo(true);
    const start = (await stored())!;
    const auditsBefore = await audits();
    try {
      for (const status of ['DISABLED', 'ARCHIVED'] as const) {
        await client.company.update({ where: { id: companyId }, data: { status } });
        await assert.rejects(() => press(false, start.version), (error: unknown) => {
          assert.ok(error instanceof UnprocessableEntityException, status);
          assert.match(error.message, new RegExp(`^Company is ${status}:`));
          return true;
        });
      }
    } finally {
      await client.company.update({ where: { id: companyId }, data: { status: 'ACTIVE' } });
    }
    assert.deepEqual(await stored(), start);
    assert.equal(await audits(), auditsBefore);
  });

  it('the setting belongs to its company: another company keeps the default, and deleting a company takes its row', async () => {
    const other = await client.company.create({ data: { id: `other-${randomUUID().slice(0, 8)}`, name: 'ร้านอื่น' } });
    await switchTo(!MANUAL_EXPENSE_WEB_ENTRY_WITHOUT_ROW);
    assert.equal(await stored(other.id), null);
    assert.deepEqual(await press(MANUAL_EXPENSE_WEB_ENTRY_WITHOUT_ROW, 0, ADMIN, other.id), { enabled: MANUAL_EXPENSE_WEB_ENTRY_WITHOUT_ROW, version: 0 });
    assert.equal(await stored(other.id), null, 'asking for the default of a company without a row creates no row');

    assert.deepEqual(await press(!MANUAL_EXPENSE_WEB_ENTRY_WITHOUT_ROW, 0, ADMIN, other.id), { enabled: !MANUAL_EXPENSE_WEB_ENTRY_WITHOUT_ROW, version: 1 });
    assert.equal((await stored())!.manualExpenseEntryEnabled, !MANUAL_EXPENSE_WEB_ENTRY_WITHOUT_ROW, 'the first shop is untouched');
    await client.auditLog.deleteMany({ where: { companyId: other.id } });
    await client.company.delete({ where: { id: other.id } });
    assert.equal(await stored(other.id), null);
  });
});
