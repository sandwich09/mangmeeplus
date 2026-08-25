import { createHash } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../src/generated/prisma/client';
import { hashPassword } from '../src/modules/auth/domain/logic/password-credential.logic';

const SYSTEM_COMPANY_ID = 'seed-watchdog-system-company';
const USERNAME_PATTERN = /^[a-z][a-z0-9._-]{2,63}$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9:._/-]{8,200}$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/;

export type SystemAdminCutoverInput = {
  mode: 'ADD' | 'REVOKE';
  environment: 'production';
  username: string;
  displayName: string;
  sourceUsername: string | null;
  password: string | null;
  approvalRef: string;
  requestId: string;
  actorRef: string;
  sourceCommit: string;
  apiBaseUrl: string | null;
};

export type SystemAdminCutoverEvidence = {
  artifact: 'system-admin-cutover';
  schemaVersion: 1;
  environment: 'production';
  operation: 'ADD' | 'REVOKE';
  result: 'CREATED' | 'REPLAY' | 'REVOKED';
  username: string;
  sourceUsername: string | null;
  userId: string;
  role: 'SYSTEM_ADMIN';
  credentialStatus: 'ACTIVE' | 'TEMPORARY' | 'DISABLED';
  mustChangePassword: boolean;
  activeSessionCount: number;
  revokedSessionCount: number;
  requestId: string;
  sourceCommit: string;
  temporaryLoginVerified: boolean | null;
};

function required(env: NodeJS.ProcessEnv, name: string, maxLength: number): string {
  const value = env[name]?.trim() ?? '';
  if (!value || value.length > maxLength || /[\u0000-\u001f]/.test(value)) {
    throw new Error(`${name} must be 1-${maxLength} printable characters`);
  }
  return value;
}

function username(env: NodeJS.ProcessEnv, name: string): string {
  const value = required(env, name, 64);
  if (!USERNAME_PATTERN.test(value)) throw new Error(`${name} has an invalid username shape`);
  return value;
}

export function parseSystemAdminCutoverInput(env: NodeJS.ProcessEnv): SystemAdminCutoverInput {
  if (env['DEPLOY_ENVIRONMENT'] !== 'production') {
    throw new Error('System Admin cutover is locked to Production');
  }
  const mode = env['SYSTEM_ADMIN_CUTOVER_MODE'];
  if (mode !== 'ADD' && mode !== 'REVOKE') {
    throw new Error('SYSTEM_ADMIN_CUTOVER_MODE must be ADD or REVOKE');
  }
  const targetUsername = username(env, 'ADMIN_USERNAME');
  const sourceUsername = mode === 'REVOKE' ? username(env, 'ADMIN_SOURCE_USERNAME') : null;
  if (sourceUsername === targetUsername) throw new Error('source and replacement usernames must differ');
  const password = mode === 'ADD' ? required(env, 'ADMIN_PASSWORD', 512) : null;
  if (password && password.length < 24) throw new Error('ADMIN_PASSWORD must be at least 24 characters');
  if (mode === 'REVOKE' && env['ADMIN_PASSWORD']) throw new Error('REVOKE rejects ADMIN_PASSWORD');
  const requestId = required(env, 'SYSTEM_ADMIN_CUTOVER_REQUEST_ID', 200);
  if (!REQUEST_ID_PATTERN.test(requestId)) throw new Error('SYSTEM_ADMIN_CUTOVER_REQUEST_ID has an invalid shape');
  const sourceCommit = required(env, 'GIT_SHA', 40);
  if (!SHA_PATTERN.test(sourceCommit)) throw new Error('GIT_SHA must be a lowercase full commit SHA');
  const apiBaseUrl = mode === 'ADD' ? required(env, 'SYSTEM_ADMIN_CUTOVER_API_BASE_URL', 256) : null;
  if (apiBaseUrl) {
    const parsed = new URL(apiBaseUrl);
    if (parsed.protocol !== 'https:' || parsed.port || parsed.username || parsed.password
      || parsed.search || parsed.hash || parsed.pathname !== '/v1'
      || !parsed.hostname.endsWith('.ecs.ap-southeast-1.on.aws')) {
      throw new Error('SYSTEM_ADMIN_CUTOVER_API_BASE_URL is not the Production ECS API /v1 origin');
    }
  }
  if (mode === 'REVOKE' && env['SYSTEM_ADMIN_CUTOVER_API_BASE_URL']) {
    throw new Error('REVOKE rejects SYSTEM_ADMIN_CUTOVER_API_BASE_URL');
  }
  return {
    mode,
    environment: 'production',
    username: targetUsername,
    displayName: required(env, 'ADMIN_DISPLAY_NAME', 120),
    sourceUsername,
    password,
    approvalRef: required(env, 'SYSTEM_ADMIN_CUTOVER_APPROVAL_REF', 256),
    requestId,
    actorRef: required(env, 'SYSTEM_ADMIN_CUTOVER_ACTOR_REF', 256),
    sourceCommit,
    apiBaseUrl,
  };
}

function auditId(input: SystemAdminCutoverInput): string {
  const digest = createHash('sha256')
    .update(`${input.environment}:${input.mode}:${input.requestId}`)
    .digest('hex');
  return `system-admin-cutover-${digest}`;
}

async function loadSystemAdmin(tx: Prisma.TransactionClient, targetUsername: string) {
  const user = await tx.user.findUnique({
    where: { username: targetUsername },
    include: {
      credential: true,
      memberships: {
        where: { companyId: SYSTEM_COMPANY_ID },
        include: { roles: { include: { role: true } } },
      },
    },
  });
  const membership = user?.memberships.find((entry) => entry.status === 'ACTIVE');
  const hasRole = membership?.roles.some((entry) =>
    entry.role.scopeKey === 'system' && entry.role.key === 'SYSTEM_ADMIN' && entry.role.status === 'ACTIVE');
  if (!user || user.status !== 'ACTIVE' || !user.credential || !membership || !hasRole) {
    throw new Error(`replacement System Admin ${targetUsername} is not ready`);
  }
  return user;
}

async function assertChangedSystemAdmin(tx: Prisma.TransactionClient, targetUsername: string) {
  const user = await loadSystemAdmin(tx, targetUsername);
  if (user.credential!.status !== 'ACTIVE' || user.credential!.mustChangePassword) {
    throw new Error(`replacement System Admin ${targetUsername} is not ready`);
  }
  return user;
}

export async function executeSystemAdminCutover(
  prisma: PrismaClient,
  input: SystemAdminCutoverInput,
  now = new Date(),
): Promise<SystemAdminCutoverEvidence> {
  const id = auditId(input);
  const passwordHash = input.password ? hashPassword(input.password) : null;
  return prisma.$transaction(async (tx) => {
    const replay = await tx.auditLog.findUnique({ where: { id } });
    if (input.mode === 'ADD') {
      if (replay) {
        const user = await loadSystemAdmin(tx, input.username);
        if (replay.action !== 'system.admin.cutover.add' || replay.targetId !== user.id) {
          throw new Error('ADD replay audit does not match the requested account');
        }
        const activeSessionCount = await tx.authSession.count({ where: { userId: user.id, status: 'ACTIVE' } });
        return {
          artifact: 'system-admin-cutover', schemaVersion: 1, environment: input.environment,
          operation: input.mode, result: 'REPLAY', username: input.username, sourceUsername: null,
          userId: user.id, role: 'SYSTEM_ADMIN', credentialStatus: user.credential!.status,
          mustChangePassword: user.credential!.mustChangePassword,
          activeSessionCount, revokedSessionCount: 0, requestId: input.requestId,
          sourceCommit: input.sourceCommit,
          temporaryLoginVerified: null,
        };
      }
      if (await tx.user.findUnique({ where: { username: input.username }, select: { id: true } })) {
        throw new Error(`ADD refuses to overwrite existing user ${input.username}`);
      }
      const company = await tx.company.findUnique({ where: { id: SYSTEM_COMPANY_ID }, select: { status: true } });
      if (company?.status !== 'ACTIVE') throw new Error('WatchDog System company is not active');
      const role = await tx.role.findUnique({
        where: { scopeKey_key: { scopeKey: 'system', key: 'SYSTEM_ADMIN' } },
      });
      if (!role || role.status !== 'ACTIVE') throw new Error('SYSTEM_ADMIN role is not active');
      const user = await tx.user.create({
        data: { username: input.username, displayName: input.displayName, status: 'ACTIVE', isSystemProtected: true },
      });
      await tx.userCredential.create({
        data: {
          userId: user.id,
          passwordHash: passwordHash!,
          status: 'TEMPORARY',
          mustChangePassword: true,
          expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        },
      });
      const membership = await tx.companyMembership.create({
        data: { companyId: SYSTEM_COMPANY_ID, userId: user.id, status: 'ACTIVE' },
      });
      await tx.membershipRole.create({ data: { membershipId: membership.id, roleId: role.id } });
      await tx.auditLog.create({
        data: {
          id,
          companyId: SYSTEM_COMPANY_ID,
          actorType: 'SERVICE',
          actorRefId: input.actorRef,
          action: 'system.admin.cutover.add',
          targetType: 'user',
          targetId: user.id,
          requestId: input.requestId,
          result: 'SUCCESS',
          riskLevel: 'HIGH',
          metadataJson: {
            username: input.username,
            approvalRef: input.approvalRef,
            sourceCommit: input.sourceCommit,
            mustChangePassword: true,
            passwordExpiresInHours: 24,
          },
        },
      });
      return {
        artifact: 'system-admin-cutover', schemaVersion: 1, environment: input.environment,
        operation: input.mode, result: 'CREATED', username: input.username, sourceUsername: null,
        userId: user.id, role: 'SYSTEM_ADMIN', credentialStatus: 'TEMPORARY',
        mustChangePassword: true, activeSessionCount: 0, revokedSessionCount: 0,
        requestId: input.requestId, sourceCommit: input.sourceCommit,
        temporaryLoginVerified: null,
      };
    }

    // Lock both credentials before the readiness check. Password login/change use the same row
    // lock, so an old-account login cannot slip a new ACTIVE session past the revoke sweep and the
    // replacement cannot be reset to a temporary credential between this check and commit.
    await tx.$queryRaw(Prisma.sql`
      SELECT credential."id"
      FROM "UserCredential" credential
      JOIN "User" user_account ON user_account."id" = credential."userId"
      WHERE user_account."username" IN (${input.username}, ${input.sourceUsername!})
      FOR UPDATE OF credential
    `);
    const replacement = await assertChangedSystemAdmin(tx, input.username);
    const source = await tx.user.findUnique({
      where: { username: input.sourceUsername! },
      include: {
        credential: true,
        memberships: {
          where: { companyId: SYSTEM_COMPANY_ID },
          include: { roles: { include: { role: true } } },
        },
      },
    });
    const sourceHasRole = source?.memberships.some((membership) =>
      membership.status === 'ACTIVE' && membership.roles.some((entry) =>
        entry.role.scopeKey === 'system' && entry.role.key === 'SYSTEM_ADMIN' && entry.role.status === 'ACTIVE'));
    if (!source || !source.isSystemProtected || !source.credential || !sourceHasRole) {
      throw new Error(`protected source System Admin ${input.sourceUsername} was not found`);
    }
    if (replay) {
      if (replay.action !== 'system.admin.cutover.revoke' || replay.targetId !== source.id
        || source.credential.status !== 'DISABLED') {
        throw new Error('REVOKE replay audit does not match a disabled source account');
      }
      const activeSessionCount = await tx.authSession.count({ where: { userId: source.id, status: 'ACTIVE' } });
      if (activeSessionCount !== 0) throw new Error('REVOKE replay found active source sessions');
      return {
        artifact: 'system-admin-cutover', schemaVersion: 1, environment: input.environment,
        operation: input.mode, result: 'REPLAY', username: replacement.username!,
        sourceUsername: input.sourceUsername, userId: source.id, role: 'SYSTEM_ADMIN',
        credentialStatus: 'DISABLED', mustChangePassword: false, activeSessionCount: 0,
        revokedSessionCount: 0, requestId: input.requestId, sourceCommit: input.sourceCommit,
        temporaryLoginVerified: null,
      };
    }
    if (source.credential.status === 'DISABLED') {
      throw new Error('REVOKE refuses an already-disabled source account without matching audit evidence');
    }
    await tx.userCredential.update({
      where: { userId: source.id },
      data: { status: 'DISABLED', expiresAt: now },
    });
    const revoked = await tx.authSession.updateMany({
      where: { userId: source.id, status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedAt: now },
    });
    await tx.auditLog.create({
      data: {
        id,
        companyId: SYSTEM_COMPANY_ID,
        actorType: 'SERVICE',
        actorRefId: input.actorRef,
        action: 'system.admin.cutover.revoke',
        targetType: 'user',
        targetId: source.id,
        requestId: input.requestId,
        result: 'SUCCESS',
        riskLevel: 'HIGH',
        metadataJson: {
          sourceUsername: input.sourceUsername,
          replacementUsername: input.username,
          replacementUserId: replacement.id,
          approvalRef: input.approvalRef,
          sourceCommit: input.sourceCommit,
          credentialDisabled: true,
          revokedSessionCount: revoked.count,
          protectedRoleRetained: true,
        },
      },
    });
    return {
      artifact: 'system-admin-cutover', schemaVersion: 1, environment: input.environment,
      operation: input.mode, result: 'REVOKED', username: replacement.username!,
      sourceUsername: input.sourceUsername, userId: source.id, role: 'SYSTEM_ADMIN',
      credentialStatus: 'DISABLED', mustChangePassword: false, activeSessionCount: 0,
      revokedSessionCount: revoked.count, requestId: input.requestId, sourceCommit: input.sourceCommit,
      temporaryLoginVerified: null,
    };
  });
}

async function verifyTemporaryLogin(input: SystemAdminCutoverInput): Promise<void> {
  const login = await fetch(`${input.apiBaseUrl}/auth/password/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: input.username, password: input.password }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!login.ok) throw new Error(`temporary System Admin login failed with HTTP ${login.status}`);
  const loginBody = await login.json() as Record<string, unknown>;
  const accessToken = typeof loginBody['accessToken'] === 'string' ? loginBody['accessToken'] : '';
  if (!accessToken || loginBody['passwordChangeRequired'] !== true
    || loginBody['redirectPath'] !== '/system/platform-access') {
    throw new Error('temporary System Admin login returned an invalid access boundary');
  }

  let failure: Error | null = null;
  try {
    const me = await fetch(`${input.apiBaseUrl}/auth/me`, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!me.ok) throw new Error(`temporary System Admin /auth/me failed with HTTP ${me.status}`);
    const meBody = await me.json() as Record<string, unknown>;
    if (!Array.isArray(meBody['roles']) || !meBody['roles'].includes('SYSTEM_ADMIN')
      || meBody['mustChangePassword'] !== true) {
      throw new Error('temporary System Admin /auth/me returned an invalid role boundary');
    }
  } catch (error) {
    failure = error instanceof Error ? error : new Error('temporary System Admin verification failed');
  }
  const logout = await fetch(`${input.apiBaseUrl}/auth/logout`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!logout.ok && !failure) failure = new Error(`temporary System Admin logout failed with HTTP ${logout.status}`);
  if (failure) throw failure;
}

async function main(): Promise<void> {
  const input = parseSystemAdminCutoverInput(process.env);
  const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL'] ?? '' });
  const prisma = new PrismaClient({ adapter });
  try {
    const evidence = await executeSystemAdminCutover(prisma, input);
    if (input.mode === 'ADD' && evidence.mustChangePassword) {
      await verifyTemporaryLogin(input);
      evidence.temporaryLoginVerified = true;
    }
    console.log(JSON.stringify(evidence));
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'System Admin cutover failed');
    process.exit(1);
  });
}
