import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { hashPassword, verifyPassword } from '../src/modules/auth/domain/logic/password-credential.logic';
import {
  executeSystemAdminCutover,
  parseSystemAdminCutoverInput,
  type SystemAdminCutoverInput,
} from './system-admin-cutover';

const databaseUrl = process.env['SYSTEM_ADMIN_CUTOVER_TEST_DATABASE_URL'];
const sourceCommit = 'a'.repeat(40);

function input(overrides: Partial<SystemAdminCutoverInput> = {}): SystemAdminCutoverInput {
  return {
    mode: 'ADD',
    environment: 'production',
    username: `admin-${randomUUID().slice(0, 8)}`,
    displayName: 'Cutover Test Admin',
    sourceUsername: null,
    password: 'temporary-password-1234567890',
    approvalRef: 'owner-approved:test-system-admin-cutover',
    requestId: `system-admin-cutover:${randomUUID()}:ADD`,
    actorRef: 'github:example/repo:1:1:owner',
    sourceCommit,
    apiBaseUrl: 'https://example.ecs.ap-southeast-1.on.aws/v1',
    ...overrides,
  };
}

test('input boundary rejects non-production and weak temporary credentials', () => {
  const base = {
    DEPLOY_ENVIRONMENT: 'production', SYSTEM_ADMIN_CUTOVER_MODE: 'ADD',
    ADMIN_USERNAME: 'prodmangmeeplus', ADMIN_DISPLAY_NAME: 'Production Admin',
    ADMIN_PASSWORD: 'x'.repeat(24), SYSTEM_ADMIN_CUTOVER_APPROVAL_REF: 'owner-approved:cutover',
    SYSTEM_ADMIN_CUTOVER_REQUEST_ID: 'system-admin-cutover:1:1:ADD',
    SYSTEM_ADMIN_CUTOVER_ACTOR_REF: 'github:example/repo:1:1:owner', GIT_SHA: sourceCommit,
    SYSTEM_ADMIN_CUTOVER_API_BASE_URL: 'https://example.ecs.ap-southeast-1.on.aws/v1',
  } as NodeJS.ProcessEnv;
  assert.equal(parseSystemAdminCutoverInput(base).username, 'prodmangmeeplus');
  assert.throws(() => parseSystemAdminCutoverInput({ ...base, DEPLOY_ENVIRONMENT: 'uat' }), /locked to Production/);
  assert.throws(() => parseSystemAdminCutoverInput({ ...base, ADMIN_PASSWORD: 'too-short' }), /at least 24/);
  assert.throws(() => parseSystemAdminCutoverInput({ ...base, ADMIN_USERNAME: 'Bad Name' }), /invalid username/);
});

test('ADD is fresh-only and replay-safe; REVOKE requires a changed replacement password', { skip: !databaseUrl }, async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
  const suffix = randomUUID().slice(0, 8);
  const sourceUsername = `source-${suffix}`;
  const replacementUsername = `replacement-${suffix}`;
  try {
    await prisma.company.upsert({
      where: { id: 'seed-watchdog-system-company' },
      update: { name: 'WatchDog System', status: 'ACTIVE' },
      create: { id: 'seed-watchdog-system-company', name: 'WatchDog System', status: 'ACTIVE' },
    });
    await prisma.role.upsert({
      where: { scopeKey_key: { scopeKey: 'system', key: 'SYSTEM_ADMIN' } },
      update: { status: 'ACTIVE', isSystem: true },
      create: { scopeKey: 'system', key: 'SYSTEM_ADMIN', name: 'System Admin', status: 'ACTIVE', isSystem: true },
    });

    const sourceAdd = input({ username: sourceUsername, requestId: `system-admin-cutover:${suffix}:source:ADD` });
    const replacementAdd = input({ username: replacementUsername, requestId: `system-admin-cutover:${suffix}:replacement:ADD` });
    assert.equal((await executeSystemAdminCutover(prisma, sourceAdd)).result, 'CREATED');
    const created = await executeSystemAdminCutover(prisma, replacementAdd);
    assert.equal(created.result, 'CREATED');
    assert.equal(created.credentialStatus, 'TEMPORARY');
    assert.equal(created.mustChangePassword, true);
    const originalHash = (await prisma.userCredential.findUniqueOrThrow({ where: { userId: created.userId } })).passwordHash;
    assert.equal(verifyPassword(replacementAdd.password!, originalHash), true);
    assert.equal((await executeSystemAdminCutover(prisma, replacementAdd)).result, 'REPLAY');
    assert.equal((await prisma.userCredential.findUniqueOrThrow({ where: { userId: created.userId } })).passwordHash, originalHash);
    await assert.rejects(
      executeSystemAdminCutover(prisma, input({ username: replacementUsername })),
      /refuses to overwrite existing user/,
    );

    const revoke = input({
      mode: 'REVOKE', username: replacementUsername, sourceUsername,
      password: null, apiBaseUrl: null, requestId: `system-admin-cutover:${suffix}:REVOKE`,
    });
    await assert.rejects(executeSystemAdminCutover(prisma, revoke), /replacement System Admin .* is not ready/);
    await prisma.userCredential.update({
      where: { userId: created.userId },
      data: {
        passwordHash: hashPassword('owner-changed-password'),
        status: 'ACTIVE',
        mustChangePassword: false,
        expiresAt: null,
      },
    });
    const source = await prisma.user.findUniqueOrThrow({ where: { username: sourceUsername } });
    await prisma.authSession.create({
      data: { userId: source.id, tokenId: randomUUID(), status: 'ACTIVE', expiresAt: new Date(Date.now() + 60_000) },
    });
    const revoked = await executeSystemAdminCutover(prisma, revoke);
    assert.equal(revoked.result, 'REVOKED');
    assert.equal(revoked.revokedSessionCount, 1);
    assert.equal((await prisma.userCredential.findUniqueOrThrow({ where: { userId: source.id } })).status, 'DISABLED');
    assert.equal(await prisma.authSession.count({ where: { userId: source.id, status: 'ACTIVE' } }), 0);
    assert.equal((await executeSystemAdminCutover(prisma, revoke)).result, 'REPLAY');
  } finally {
    await prisma.$disconnect();
  }
});
