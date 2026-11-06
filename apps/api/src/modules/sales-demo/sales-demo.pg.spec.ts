import 'reflect-metadata';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { JwtService } from '@nestjs/jwt';
import { TIER_FEATURE_PRESETS } from '@watchdog-bms/contracts';
import { PrismaClient } from '../../generated/prisma/client';
import { SalesDemoService } from './application/sales-demo.service';
import { IssueTokenUseCase } from '../auth/application/use-cases/issue-token.use-case';
import { CreateCompanyOnboardingUseCase } from '../system-onboarding/application/use-cases/create-company-onboarding.use-case';
import { hashLineHandoffToken } from '../auth/domain/logic/line-handoff.logic';
import { PLATFORM_TENANT_ID } from '../sales-console/application/sales-context';
import type { RequestContext } from '../auth/domain/models/request-context.model';

// Controller runs this explicitly against a disposable PostgreSQL server. No provider calls.
const databaseUrl = process.env.SALES_DEMO_TEST_DATABASE_URL;
describe('sales demo links on real PostgreSQL', { skip: !databaseUrl }, () => {
  let admin: Client, raw: Client, client: PrismaClient, scratch: string;
  let demo: SalesDemoService, failingDemo: SalesDemoService;
  const actor = 'demo-sales-agent';
  const context: RequestContext = { requestId: 'demo-mint', userId: actor, authSubject: actor,
    companyId: PLATFORM_TENANT_ID, membershipId: 'sales-member', roles: ['MANGMEE_SALES'],
    permissions: ['sales.demo_link.create'], scopes: {}, authProvider: 'watchdog' };
  const tokenOf = (link: { url: string }) => link.url.split('/d/')[1];

  before(async () => {
    const url = new URL(databaseUrl!);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
    assert.ok(url.pathname === '/watchdog_bms' || url.pathname.endsWith('_ci'), 'disposable local database required');
    assert.equal([...url.searchParams.keys()].some(key => ['host', 'hostaddr', 'port', 'service', 'servicefile', 'dbname', 'options'].includes(key.toLowerCase())), false);
    scratch = `sales_demo_${randomUUID().slice(0, 8)}_ci`;
    admin = new Client({ connectionString: databaseUrl }); await admin.connect();
    await admin.query(`CREATE DATABASE "${scratch}"`);
    url.pathname = `/${scratch}`;
    raw = new Client({ connectionString: url.toString() }); await raw.connect();
    const migrations = join(__dirname, '..', '..', '..', 'prisma', 'migrations');
    const folders = readdirSync(migrations, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    for (const name of folders) await raw.query(readFileSync(join(migrations, name, 'migration.sql'), 'utf8'));
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) });
    await client.company.create({ data: { id: PLATFORM_TENANT_ID, name: 'ระบบมั่งมี' } });
    await client.user.create({ data: { id: actor, displayName: 'ทีมขาย' } });
    for (const key of ['OWNER', 'MANAGER', 'FINANCE', 'STAFF']) {
      await client.role.create({ data: { scopeKey: 'system', key, name: key, isSystem: true } });
    }
    const prisma = { client } as any;
    const config = { authJwtSecret: 'demo-pg-secret', credentialEncryptionKey: Buffer.alloc(32, 7),
      webBaseUrl: 'https://example.test', publicApiBaseUrl: 'https://api.example.test' } as any;
    const limits = { consume: async () => ({ allowed: true, retryAfterSeconds: 0 }) } as any;
    const onboarding = new CreateCompanyOnboardingUseCase(prisma, config, {} as any);
    const issuer = new IssueTokenUseCase(new JwtService(), prisma, config);
    demo = new SalesDemoService(prisma, config, limits, onboarding, issuer);
    failingDemo = new SalesDemoService(prisma, config, limits, onboarding, { execute: async () => { throw new Error('session_write_failed'); } } as any);
  });
  after(async () => {
    await client?.$disconnect(); await raw?.end();
    if (admin) {
      try { if (scratch) await admin.query(`DROP DATABASE IF EXISTS "${scratch}" WITH (FORCE)`); }
      finally { await admin.end(); }
    }
  });

  it('mints a hash-only token with an atomic actor/link/expiry audit', async () => {
    const minted = await demo.mint(context);
    const row = await client.salesDemoLink.findUniqueOrThrow({ where: { tokenHash: hashLineHandoffToken(tokenOf(minted)) } });
    assert.equal(Buffer.from(tokenOf(minted), 'base64url').length, 24);
    assert.equal(row.expiresAt.toISOString(), minted.expiresAt); assert.equal(row.companyId, null);
    const audit = await client.auditLog.findFirstOrThrow({ where: { action: 'sales.demo_link.create', targetId: row.id } });
    assert.equal(audit.actorUserId, actor);
    assert.deepEqual(audit.metadataJson, { expiresAt: minted.expiresAt, aiCredit: 80 });
    assert.equal(row.aiCreditUnits, 80);
  });
  it('opens once, reopens the same company and caps every owner session at link expiry', async () => {
    const link = await demo.mint(context), first = await demo.open(tokenOf(link), 'first'), second = await demo.open(tokenOf(link), 'second');
    assert.equal(first.companyId, second.companyId); assert.notEqual(first.accessToken, second.accessToken);
    const company = await client.company.findUniqueOrThrow({ where: { id: first.companyId }, include: { planTerm: true, memberships: { include: { user: { include: { credential: true, sessions: true } } } } } });
    assert.equal(company.reportClassification, 'DEMO'); assert.equal(company.planTerm!.tierKey, 'ENTERPRISE_1999');
    assert.equal(company.planTerm!.termEndsAt.toISOString(), link.expiresAt);
    const owner = company.memberships[0].user;
    assert.equal(owner.displayName, 'คุณมั่งมี (ตัวอย่าง)');
    assert.equal(owner.email, null); assert.equal(owner.phoneNumber, null); assert.equal(owner.username, null); assert.equal(owner.credential, null);
    assert.equal(owner.sessions.length, 2); assert.ok(owner.sessions.every(session => session.expiresAt.toISOString() === link.expiresAt));
    assert.equal(await client.employeeLineLinkToken.count({ where: { companyId: company.id } }), 0);
    assert.equal(await client.externalIdentity.count({ where: { userId: owner.id, provider: 'LINE', providerChannelId: 'demo-web', providerUserId: `Vdemo${company.id}`, status: 'ACTIVE' } }), 1);
    assert.equal(await client.lineChannelBinding.count({ where: { companyId: company.id, messagingChannelId: 'demo-web', status: 'ACTIVE' } }), 1);
    const ai = await client.companyAiConfiguration.findUniqueOrThrow({ where: { companyId: company.id } });
    assert.equal(ai.ocrMonthlyLimit, 3); assert.ok(ai.aiCreditCutoverAt);
    const grants = await client.aiCreditGrant.findMany({ where: { companyId: company.id } });
    assert.equal(grants.length, 1); assert.equal(grants[0].sourceKind, 'SALES_EVENT');
    assert.equal(grants[0].billingAccountId, null); assert.equal(grants[0].units, link.aiCredit * 100);
    const features = await client.companyFeatureEntitlement.findMany({ where: { companyId: company.id, enabled: true } });
    assert.deepEqual(features.map(row => row.featureKey).sort(), [...TIER_FEATURE_PRESETS.ENTERPRISE_1999].sort());
  });
  it('two genuinely concurrent transactions create exactly one company for a link', async () => {
    const link = await demo.mint(context), before = await client.company.count();
    const results = await Promise.all([demo.open(tokenOf(link), 'race-a'), demo.open(tokenOf(link), 'race-b')]);
    assert.equal(results[0].companyId, results[1].companyId);
    assert.equal(await client.company.count(), before + 1);
    assert.equal(await client.salesDemoLink.count({ where: { companyId: results[0].companyId } }), 1);
  });
  for (const reason of ['expired', 'revoked', 'unknown'] as const) {
    it(`returns identical 410 for ${reason} without creating a company or session`, async () => {
      const link = await demo.mint(context), tokenHash = hashLineHandoffToken(tokenOf(link));
      if (reason === 'expired') await client.salesDemoLink.update({ where: { tokenHash }, data: { expiresAt: new Date(Date.now() - 1) } });
      if (reason === 'revoked') await client.salesDemoLink.update({ where: { tokenHash }, data: { revokedAt: new Date() } });
      const before = [await client.company.count(), await client.authSession.count()];
      await assert.rejects(demo.open(reason === 'unknown' ? 'unknown' : tokenOf(link), 'bad'), (error: any) => error.getStatus() === 410 && JSON.stringify(error.getResponse()) === '{"code":"demo_link_expired"}');
      assert.deepEqual([await client.company.count(), await client.authSession.count()], before);
    });
  }
  it('rolls back company creation when issuance fails and allows a clean retry', async () => {
    const link = await demo.mint(context), before = await client.company.count();
    await assert.rejects(failingDemo.open(tokenOf(link), 'failed'), /session_write_failed/);
    assert.equal(await client.company.count(), before);
    const row = await client.salesDemoLink.findUniqueOrThrow({ where: { tokenHash: hashLineHandoffToken(tokenOf(link)) } });
    assert.equal(row.companyId, null); assert.equal(row.openedAt, null);
    await demo.open(tokenOf(link), 'retry'); assert.equal(await client.company.count(), before + 1);
  });
});
