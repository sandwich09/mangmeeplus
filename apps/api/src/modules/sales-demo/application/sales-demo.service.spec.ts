import 'reflect-metadata';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JwtService } from '@nestjs/jwt';
import { GoneException, HttpException } from '@nestjs/common';
import { SalesDemoService, DEMO_LINK_TTL_MS } from './sales-demo.service';
import { hashLineHandoffToken } from '../../auth/domain/logic/line-handoff.logic';
import { IssueTokenUseCase } from '../../auth/application/use-cases/issue-token.use-case';
import { RefreshSessionUseCase } from '../../auth/application/use-cases/refresh-session.use-case';
import { PLATFORM_TENANT_ID } from '../../sales-console/application/sales-context';
import type { RequestContext } from '../../auth/domain/models/request-context.model';

const context: RequestContext = { requestId: 'req', userId: 'sales', authSubject: 'sales',
  companyId: PLATFORM_TENANT_ID, membershipId: 'sales-member', roles: ['MANGMEE_SALES'],
  permissions: ['sales.demo_link.create'], scopes: {}, authProvider: 'watchdog' };

function world() {
  const links: any[] = [], sessions: any[] = [], companies: string[] = [], audit: any[] = [], quotas: any[] = [], commands: any[] = [];
  const config = { authJwtSecret: 'demo-unit-secret', webBaseUrl: 'https://example.test', publicApiBaseUrl: 'https://api.example.test', sessionRefreshReuseGraceSeconds: 30 } as any;
  let deniedScope: string | undefined;
  const rateLimits = { consume: async (scope: string, key: string, max: number, seconds: number) => {
    quotas.push({ scope, key, max, seconds }); return { allowed: scope !== deniedScope, retryAfterSeconds: 3600 };
  } } as any;
  const db: any = {
    $queryRaw: async () => [],
    salesDemoLink: {
      create: async ({ data }: any) => { const link = { id: `link-${links.length}`, companyId: null, revokedAt: null, ...data }; links.push(link); return link; },
      findUnique: async ({ where }: any) => links.find(link => link.tokenHash === where.tokenHash) ?? null,
      updateMany: async ({ where, data }: any) => {
        const link = links.find(link => link.id === where.id && link.companyId === null && link.revokedAt === null && link.expiresAt > where.expiresAt.gt);
        if (!link) return { count: 0 }; Object.assign(link, data); return { count: 1 };
      },
    },
    branch: { findFirstOrThrow: async () => ({ id: 'branch' }) },
    companyMembership: { findFirst: async ({ where }: any) => companies.includes(where.companyId) ? { userId: `owner-${where.companyId}` } : null },
    auditLog: { create: async ({ data }: any) => { audit.push(data); return data; } },
    authSession: {
      create: async ({ data }: any) => { const row = { id: `session-${sessions.length}`, previousTokenId: null, rotatedAt: null, ...data }; sessions.push(row); return row; },
      findFirst: async ({ where }: any) => sessions.find(row => where.OR.some((part: any) => row.tokenId === part.tokenId || row.previousTokenId === part.previousTokenId)) ?? null,
      updateMany: async ({ where, data }: any) => { const row = sessions.find(row => row.id === where.id && row.tokenId === where.tokenId); if (!row) return { count: 0 }; Object.assign(row, data); return { count: 1 }; },
    },
  };
  // This models transaction ordering only. The pg spec proves the real row-lock/CAS fence.
  let previous = Promise.resolve();
  db.$transaction = (action: (tx: any) => Promise<any>) => {
    const next = previous.then(() => action(db)); previous = next.catch(() => undefined); return next;
  };
  const prisma = { client: db } as any;
  const onboard = { execute: async (command: any, tx: any) => {
    assert.equal(tx, db); commands.push(command);
    const companyId = `company-${companies.length}`; companies.push(companyId);
    return { companyId, ownerId: `owner-${companyId}` };
  } } as any;
  const jwt = new JwtService();
  const issue = new IssueTokenUseCase(jwt, prisma, config);
  const refresh = new RefreshSessionUseCase(jwt, prisma, config);
  const demo = new SalesDemoService(prisma, config, rateLimits, onboard, issue);
  return { demo, links, sessions, companies, audit, quotas, commands, jwt, issue, refresh, db, deny: (scope: string) => { deniedScope = scope; } };
}

const expired = (error: unknown) => error instanceof GoneException && error.getStatus() === 410
  && JSON.stringify(error.getResponse()) === JSON.stringify({ code: 'demo_link_expired' });

describe('sales demo links', () => {
  // Mint/open/reuse/concurrency need the real sample-data writer and row locks: sales-demo.pg.spec.ts proves them.
  for (const reason of ['expired', 'revoked', 'unknown'] as const) {
    it(`returns the same 410 for ${reason} links without provisioning`, async () => {
      const w = world(), minted = await w.demo.mint(context);
      if (reason === 'expired') w.links[0].expiresAt = new Date(Date.now() - 1);
      if (reason === 'revoked') w.links[0].revokedAt = new Date();
      await assert.rejects(w.demo.open(reason === 'unknown' ? 'unknown' : minted.url.split('/d/')[1], 'ip'), expired);
      assert.equal(w.companies.length, 0); assert.equal(w.sessions.length, 0);
      assert.equal(w.quotas.some(q => q.scope === 'demo-new-company-global'), false);
    });
  }
  for (const scope of ['demo-link-mint-user', 'demo-open-ip', 'demo-new-company-global']) {
    it(`fails closed when ${scope} exceeds its quota`, async () => {
      const w = world(), minted = await w.demo.mint(context); w.deny(scope);
      await assert.rejects(scope === 'demo-link-mint-user' ? w.demo.mint(context) : w.demo.open(minted.url.split('/d/')[1], 'ip'),
        (error: unknown) => error instanceof HttpException && error.getStatus() === 429);
      assert.equal(w.companies.length, 0); assert.equal(w.sessions.length, 0);
    });
  }
  it('caps tokens issued in the final fraction of a second without crossing the absolute deadline', async () => {
    const w = world(), cap = new Date(Date.now() + 500);
    const tokens = await w.issue.execute('owner', 'demo', { tx: w.db, companyId: 'demo', expiresAt: cap });
    for (const token of [tokens.accessToken, tokens.refreshToken]) {
      assert.ok(w.jwt.decode(token).exp * 1000 <= cap.getTime());
    }
    assert.ok(tokens.expiresIn <= 0.5);
  });
  it('pins session expiry and both JWTs to the link cap, including refreshed access tokens', async () => {
    const w = world(), cap = new Date(Date.now() + 40_000);
    const tokens = await w.issue.execute('owner', 'demo', { tx: w.db, companyId: 'demo', expiresAt: cap });
    assert.equal(w.sessions[0].expiresAt.getTime(), cap.getTime());
    for (const token of [tokens.accessToken, tokens.refreshToken]) {
      const payload = w.jwt.decode(token); assert.ok(payload.exp * 1000 <= cap.getTime());
      assert.equal(payload.provider, 'demo'); assert.equal(payload.demoCompanyId, 'demo');
    }
    const renewed = await w.refresh.execute(tokens.refreshToken);
    assert.ok(renewed.expiresIn <= 40);
    for (const token of [renewed.accessToken, renewed.refreshToken]) {
      const payload = w.jwt.decode(token); assert.ok(payload.exp * 1000 <= cap.getTime()); assert.equal(payload.demoCompanyId, 'demo');
    }
    assert.equal(w.sessions[0].expiresAt.getTime(), cap.getTime());
  });
});
