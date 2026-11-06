import 'reflect-metadata';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from './auth.guard';
import { WatchdogJwtVerifierAdapter } from '../infrastructure/watchdog-jwt-verifier.adapter';
import { jwtClaimIdentity } from '../domain/logic/jwt-claims.logic';

it('expired demo POST returns 410 only after verified signature, session and owner; expired tokens never authorize', async () => {
  const jwt = new JwtService(), config: any = { authJwtSecret: 'test-secret', isProduction: true };
  const verifier = new WatchdogJwtVerifierAdapter(jwt, config);
  const identity = jwtClaimIdentity(config);
  const token = jwt.sign({ sub: 'owner', sid: 'session', provider: 'demo', demoCompanyId: 'one', exp: Math.floor(Date.now() / 1000) - 60 }, { secret: 'test-secret', algorithm: 'HS256', issuer: identity.issuer, audience: identity.audience });
  await assert.rejects(verifier.verify(token));
  assert.equal((await verifier.verifyDemoExpiry(token)).subject, 'owner');
  let resolved = 0;
  const db: any = { salesDemoLink: { findUnique: async () => ({ expiresAt: new Date(0), company: { reportClassification: 'DEMO' } }) },
    companyMembership: { findFirst: async () => ({ id: 'member' }) }, authSession: { findUnique: async () => ({ userId: 'owner', status: 'ACTIVE' }) } };
  const guard = new AuthGuard({ getAllAndOverride: () => false } as any, verifier, {} as any, { execute: async () => { resolved++; } } as any, config, { client: db } as any, {} as any);
  const req: any = { method: 'POST', path: '/v1/companies/one/demo-chat/messages', headers: { authorization: `Bearer ${token}` }, params: { companyId: 'one' } };
  const context: any = { getHandler: () => ({}), getClass: () => ({}), switchToHttp: () => ({ getRequest: () => req }) };
  await assert.rejects(guard.canActivate(context), (e: any) => e.getStatus() === 410 && e.getResponse().code === 'demo_link_expired');
  db.authSession.findUnique = async () => ({ userId: 'other', status: 'ACTIVE' });
  await assert.rejects(guard.canActivate(context), (e: any) => e.getStatus() === 401);
  req.headers.authorization = `Bearer ${token.slice(0, -5)}badxx`;
  await assert.rejects(guard.canActivate(context), (e: any) => e.getStatus() === 401);
  assert.equal(resolved, 0);
});
