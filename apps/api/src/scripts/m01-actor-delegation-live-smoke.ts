import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import {
  ActorDelegationError,
  ActorDelegationService,
  AI_ACTOR_DELEGATION_TTL_SECONDS,
  AI_ACTOR_DELEGATION_WORKLOAD,
  signActorDelegationClaims,
  verifyActorDelegationToken,
} from '../modules/line-ai/infrastructure/actor-delegation.service';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function opaque(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

async function main(): Promise<void> {
  const databaseUrl = required('DATABASE_URL');
  const redisUrl = required('REDIS_URL');
  const internalSecret = required('AI_GATEWAY_INTERNAL_SECRET');
  const signingKeyHex = required('AI_ACTOR_DELEGATION_SIGNING_KEY');
  const apiBaseUrl = required('M01_API_BASE_URL').replace(/\/$/, '');
  const sourceCommit = required('GIT_SHA');
  const runId = required('M01_RUN_ID');
  assert.match(sourceCommit, /^[0-9a-f]{40}$/);
  assert.match(runId, /^m01-live-[0-9a-f]{12}-[0-9]+$/);
  assert.match(signingKeyHex, /^[0-9a-f]{64}$/);

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const delegation = new ActorDelegationService({
    aiActorDelegationSigningKey: Buffer.from(signingKeyHex, 'hex'),
    redisUrl,
  } as never);

  const membership = await prisma.companyMembership.findFirst({
    where: {
      status: 'ACTIVE',
      user: { status: 'ACTIVE' },
      company: { status: 'ACTIVE' },
      AND: [
        { roles: { some: { role: { permissions: { some: { permission: { key: 'ai.tool.invoke' } } } } } } },
        { roles: { some: { role: { permissions: { some: { permission: { key: 'company.setup.read' } } } } } } },
      ],
    },
    select: { id: true, userId: true, companyId: true },
    orderBy: { createdAt: 'asc' },
  });
  assert.ok(membership, 'UAT needs one active AI-enabled membership');

  const otherCompany = await prisma.company.findFirst({
    where: { status: 'ACTIVE', id: { not: membership.companyId } },
    select: { id: true },
  });
  const toolName = 'company.get_current_context';
  const prefix = runId;

  const invoke = async (
    token: string,
    context: { userId: string; companyId: string; membershipId: string; requestId: string },
  ) => {
    const response = await fetch(`${apiBaseUrl}/internal/ai/tools/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': internalSecret,
        'X-Actor-Delegation': token,
        'X-Request-Id': context.requestId,
      },
      body: JSON.stringify({
        toolName,
        context: { ...context, permissions: [], locale: 'th-TH' },
        input: {},
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    return { status: response.status, body };
  };

  const acceptedRequestId = `${prefix}-accepted`;
  const acceptedExpected = {
    userId: membership.userId,
    companyId: membership.companyId,
    membershipId: membership.id,
    requestId: acceptedRequestId,
    toolName,
  };
  const acceptedToken = delegation.issue(acceptedExpected);
  const acceptedClaims = verifyActorDelegationToken(
    acceptedToken,
    Buffer.from(signingKeyHex, 'hex'),
    acceptedExpected,
  );
  const accepted = await invoke(acceptedToken, acceptedExpected);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body['status'], 'ok');

  const replay = await invoke(acceptedToken, acceptedExpected);
  assert.equal(replay.status, 401);

  const substitutionRequestId = `${prefix}-substitution`;
  const substitutionExpected = { ...acceptedExpected, requestId: substitutionRequestId };
  const substitution = await invoke(delegation.issue(substitutionExpected), {
    ...substitutionExpected,
    userId: `substituted-${randomUUID()}`,
  });
  assert.equal(substitution.status, 401);

  const crossCompanyRequestId = `${prefix}-cross-company`;
  const crossCompanyExpected = { ...acceptedExpected, requestId: crossCompanyRequestId };
  const crossCompany = await invoke(delegation.issue(crossCompanyExpected), {
    ...crossCompanyExpected,
    companyId: otherCompany?.id ?? `other-${randomUUID()}`,
  });
  assert.equal(crossCompany.status, 401);

  const audienceRequestId = `${prefix}-audience`;
  const issuedAt = Math.floor(Date.now() / 1000);
  const wrongAudience = signActorDelegationClaims({
    v: 1,
    iss: 'watchdog-api',
    aud: 'wrong-service',
    workload: AI_ACTOR_DELEGATION_WORKLOAD,
    sub: membership.userId,
    companyId: membership.companyId,
    membershipId: membership.id,
    requestId: audienceRequestId,
    toolName,
    jti: randomUUID(),
    iat: issuedAt,
    exp: issuedAt + AI_ACTOR_DELEGATION_TTL_SECONDS,
  }, Buffer.from(signingKeyHex, 'hex'));
  const audience = await invoke(wrongAudience, { ...acceptedExpected, requestId: audienceRequestId });
  assert.equal(audience.status, 401);

  const unavailable = new ActorDelegationService({
    aiActorDelegationSigningKey: Buffer.from(signingKeyHex, 'hex'),
    redisUrl: 'redis://127.0.0.1:1',
  } as never);
  const unavailableExpected = {
    ...acceptedExpected,
    requestId: `${prefix}-redis-unavailable`,
  };
  await assert.rejects(
    () => unavailable.consume(unavailable.issue(unavailableExpected), unavailableExpected),
    (error: unknown) =>
      error instanceof ActorDelegationError
      && error.code === 'ACTOR_DELEGATION_REPLAY_STORE_UNAVAILABLE',
  );
  await unavailable.onModuleDestroy();

  const audit = await prisma.auditLog.findFirst({
    where: {
      requestId: acceptedRequestId,
      action: 'ai.actor_delegation.consume',
      targetId: acceptedClaims.jti,
    },
    orderBy: { createdAt: 'desc' },
  });
  assert.ok(audit, 'accepted delegation must write durable audit evidence');
  assert.equal(audit.result, 'SUCCESS');
  assert.equal(audit.actorUserId, membership.userId);
  assert.equal(audit.companyId, membership.companyId);
  const metadata = audit.metadataJson as Record<string, unknown>;
  assert.equal(metadata['membershipId'], membership.id);
  assert.equal(metadata['toolName'], toolName);
  assert.equal(metadata['audience'], 'watchdog-erp-core:internal-ai-tools');
  assert.ok(!JSON.stringify(audit).includes(acceptedToken), 'audit must not contain delegation token');

  console.log(JSON.stringify({
    event: 'm01_live_verification_pass',
    sourceCommit,
    scenarios: ['accepted', 'substitution', 'replay', 'cross_company', 'wrong_audience', 'redis_unavailable'],
    deniedHttpRequests: 4,
    requestPrefix: prefix,
    audit: {
      action: audit.action,
      result: audit.result,
      requestId: audit.requestId,
      delegationId: audit.targetId,
      actorHash: opaque(membership.userId),
      companyHash: opaque(membership.companyId),
      membershipHash: opaque(membership.id),
    },
  }));

  await delegation.onModuleDestroy();
  await prisma.$disconnect();
}

void main().catch((error) => {
  console.error(JSON.stringify({
    event: 'm01_live_verification_failed',
    error: error instanceof Error ? error.message : 'unknown',
  }));
  process.exit(1);
});
