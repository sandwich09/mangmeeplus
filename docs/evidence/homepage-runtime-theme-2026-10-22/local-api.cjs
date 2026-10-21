// Local-only real API/DB harness. Run after migrations + API/contracts/config build.
// Uses a dedicated database; never points at a shared or deployed environment.
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const { writeFileSync, existsSync, readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const root = resolve(__dirname, '../../..');
const req = createRequire(resolve(root, 'apps/api/package.json'));
const load = name => req(resolve(root, 'apps/api/dist/apps/api/src', name));
const statePath = '/tmp/mangmee-home-theme-local-session.json';
const previous = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : null;
const secret = previous?.secret ?? randomUUID();
const password = previous?.password ?? `LocalTheme!${randomUUID()}`;
Object.assign(process.env, { APP_ENV: 'local', DEPLOY_ENVIRONMENT: 'local', NODE_ENV: 'test', SERVICE_NAME: 'home-theme-local',
  DATABASE_URL: 'postgresql://watchdog:homepage_local_only@127.0.0.1:43834/homepage_theme',
  S3_BUCKET: 'synthetic-home-theme', WATCHDOG_JWT_SECRET_ARN: secret, DEV_AUTH_SECRET: secret,
  REDIS_URL: 'redis://127.0.0.1:43835', RATE_LIMIT_ENABLED: 'false', REQUEST_LOG_ENABLED: 'false',
  WEB_BASE_URL: 'http://127.0.0.1:43831', AWS_EC2_METADATA_DISABLED: 'true', LOG_LEVEL: 'error',
});
req('reflect-metadata');
const { NestFactory } = req('@nestjs/core');
const { ValidationPipe } = req('@nestjs/common');
const { JwtService } = req('@nestjs/jwt');
const { DEFAULT_JWT_ISSUER, DEFAULT_JWT_AUDIENCE } = req('@watchdog-bms/config');
const { HOME_THEME_MANAGE_PERMISSION } = req('@watchdog-bms/contracts');
const { PrismaService } = load('common/database/prisma.service.js');
const { AppConfigService } = load('common/config/app-config.service.js');
const { AppModule } = load('app.module.js');
const { HomeThemeService } = load('modules/public-home-theme/home-theme.service.js');
const { LegalAcceptanceService, currentLegalRelease } = load('modules/auth/application/legal-acceptance.service.js');
const { ROLE_GRANTS } = load('modules/auth/permission-registry.js');
const { hashPassword } = load('modules/auth/domain/logic/password-credential.logic.js');
const assert = require('node:assert/strict');

async function main() {
  const app = await NestFactory.create(AppModule, { abortOnError: false, logger: false });
  app.use(req('cookie-parser')());
  app.setGlobalPrefix('v1');
  app.useGlobalPipes(new ValidationPipe(load('common/pipes/validation-pipe.options.js').GLOBAL_VALIDATION_PIPE_OPTIONS));
  await app.listen(43832, '127.0.0.1');
  const db = app.get(PrismaService).client;
  const company = await db.company.upsert({ where: { id: 'home-theme-local' }, update: {}, create: { id: 'home-theme-local', name: 'ทดสอบธีมหน้าแรกในเครื่อง' } });
  const tokens = {};
  for (const [name, roleKey, grants] of [
    ['admin', 'SYSTEM_ADMIN', ['account.session.read', HOME_THEME_MANAGE_PERMISSION]],
    ['restricted', 'SYSTEM_ADMIN', ['account.session.read']],
    ['owner', 'OWNER', ['account.session.read']],
    ['wrong-role', 'OWNER', ['account.session.read', HOME_THEME_MANAGE_PERMISSION]],
  ]) {
    const userId = `home-theme-${name}`;
    const user = await db.user.upsert({ where: { id: userId }, update: {}, create: { id: userId, displayName: `ทดสอบ ${name}`, email: `${name}@home-theme.example.test`, emailVerifiedAt: new Date() } });
    const role = await db.role.upsert({ where: { scopeKey_key: { scopeKey: `home-theme-${name}`, key: roleKey } }, update: {}, create: { scopeKey: `home-theme-${name}`, key: roleKey, name: `Local ${name}`, isSystem: roleKey === 'SYSTEM_ADMIN' } });
    for (const key of grants) {
      const permission = await db.permission.upsert({ where: { key }, update: {}, create: { key, description: key } });
      await db.rolePermission.upsert({ where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } }, update: {}, create: { roleId: role.id, permissionId: permission.id } });
    }
    const membership = await db.companyMembership.upsert({ where: { companyId_userId: { companyId: company.id, userId } }, update: {}, create: { companyId: company.id, userId, roles: { create: { roleId: role.id } } } });
    await db.$transaction(tx => app.get(LegalAcceptanceService).recordFromEvidence(tx, { userId, companyId: company.id, membershipId: membership.id,
      requestId: randomUUID(), evidence: { ...currentLegalRelease('th'), locale: 'th', legalAcceptedAt: new Date() } }));
    if (name === 'admin') await db.userCredential.upsert({ where: { userId }, update: {}, create: { userId, passwordHash: hashPassword(password), mustChangePassword: false } });
    const sid = randomUUID();
    await db.authSession.create({ data: { userId, tokenId: sid, expiresAt: new Date(Date.now() + 86400000) } });
    tokens[name] = new JwtService().sign({ sub: userId, sid }, { secret, algorithm: 'HS256', issuer: DEFAULT_JWT_ISSUER, audience: DEFAULT_JWT_AUDIENCE, expiresIn: 86400 });
  }
  writeFileSync(statePath, JSON.stringify({ secret, password, tokens }), { mode: 0o600 });
  const request = async (path, method = 'GET', body, who = 'admin') => {
    const response = await fetch(`http://127.0.0.1:43832/v1/${path}`, { method,
      headers: { 'content-type': 'application/json', ...(who ? { authorization: `Bearer ${tokens[who]}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json(), cache: response.headers.get('cache-control') };
  };
  if (process.argv.includes('--check')) {
    assert.equal(await db.publicHomeThemeSetting.count(), 0, 'Checks require the fresh dedicated database');
    assert.deepEqual((await request('public/home-theme', 'GET', undefined, null)).data, { event: 'default' });
    assert.deepEqual((await request('system/home-theme')).data, { event: 'default', version: 0, updatedAt: null });
    for (const method of ['GET', 'PUT']) {
      assert.equal((await request('system/home-theme', method, method === 'PUT' ? { event: 'halloween', expectedVersion: 0 } : undefined, null)).status, 401);
      for (const who of ['owner', 'restricted', 'wrong-role']) assert.equal((await request('system/home-theme', method, method === 'PUT' ? { event: 'halloween', expectedVersion: 0 } : undefined, who)).status, 403);
    }
    assert.deepEqual(Object.entries(ROLE_GRANTS).filter(([, keys]) => keys.includes(HOME_THEME_MANAGE_PERMISSION)).map(([role]) => role), ['SYSTEM_ADMIN']);
    for (const bad of [{event:'removed',expectedVersion:0},{event:'__proto__',expectedVersion:0},{event:['halloween'],expectedVersion:0},{event:'halloween',expectedVersion:-1},{event:'halloween',expectedVersion:'0'},{event:'halloween'},{event:'halloween',expectedVersion:0,css:'body {}'}]) {
      assert.equal((await request('system/home-theme','PUT',bad)).status,400,JSON.stringify(bad));
    }
    const save = body => request('system/home-theme', 'PUT', body);
    const race = await Promise.all([save({event:'halloween',expectedVersion:0}), save({event:'halloween',expectedVersion:0})]);
    assert.deepEqual(race.map(r=>r.status).sort(), [200,409]);
    const published = (await request('system/home-theme')).data;
    assert.equal(published.event,'halloween');assert.equal(published.version,1);
    const visible = await request('public/home-theme','GET',undefined,null);
    assert.deepEqual(visible.data,{event:'halloween'});assert.equal(visible.cache,'no-store');
    const separate = new PrismaService(new AppConfigService());
    try { assert.equal((await new HomeThemeService(separate).read()).event,'halloween'); } finally { await separate.onModuleDestroy(); }
    assert.deepEqual((await save({event:'halloween',expectedVersion:1})).data,published);
    assert.equal(await db.auditLog.count({where:{action:'system.home_theme.update'}}),1);
    const audit = await db.auditLog.findFirst({where:{action:'system.home_theme.update'}});
    assert.equal(audit.actorUserId,'home-theme-admin');assert.deepEqual(audit.metadataJson,{fromEvent:'default',toEvent:'halloween',fromVersion:0,toVersion:1});
    await db.$executeRawUnsafe(`CREATE FUNCTION reject_theme_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'system.home_theme.update' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER theme_audit_fault BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION reject_theme_audit()`);
    assert.equal((await save({event:'default',expectedVersion:1})).status,500);
    assert.deepEqual((await request('system/home-theme')).data,published);
    await db.$executeRawUnsafe('DROP TRIGGER theme_audit_fault ON "AuditLog"');
    await db.$executeRawUnsafe('DROP FUNCTION reject_theme_audit()');
    assert.equal((await save({event:'default',expectedVersion:1})).data.version,2);
    await db.publicHomeThemeSetting.update({where:{id:'homepage'},data:{event:'removed-festival'}});
    assert.deepEqual((await request('public/home-theme','GET',undefined,null)).data,{event:'default'});
    assert.equal((await save({event:'default',expectedVersion:2})).data.version,3);
    assert.equal((await request('system/home-theme','DELETE')).status,404);
    writeFileSync(resolve(__dirname,'api-results.json'),JSON.stringify({passed:true,checks:['fresh migration/default','401 unauthenticated','403 tenant/restricted/spoofed-role','installed allowlist/DTO validation','single winner on concurrent first save/409','same-value no-op','uncached public contract','independent connection reads saved state','atomic before-after audit','audit failure rolls setting back','removed event fallback','off restores default','no delete route'], finalSetting:(await request('system/home-theme')).data},null,2));
    console.log('PASS: real PostgreSQL / full Nest HTTP / permissions / conflict / atomic audit checks');
  }
  console.log('Local API ready on http://127.0.0.1:43832; synthetic session stored privately in /tmp.');
  process.on('SIGTERM', async()=>{ await app.close();process.exit(0); });
}
main().catch(error=>{console.error(error);process.exit(1);});
