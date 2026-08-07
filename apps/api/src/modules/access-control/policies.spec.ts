import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OwnRecordPolicy } from './infrastructure/policies/own-record.policy';
import { TenantBoundaryPolicy } from './infrastructure/policies/tenant-boundary.policy';
import { CompositePolicyEvaluator } from './infrastructure/policies/composite-policy-evaluator';
import type { PolicyContext } from './domain/models/policy-decision.model';

const baseContext: PolicyContext = {
  userId: 'u1',
  companyId: 'c1',
  membershipId: 'm1',
  roles: [],
  permissions: [],
};

describe('OwnRecordPolicy', () => {
  const policy = new OwnRecordPolicy();

  it('not_applicable when no resourceOwnerId', async () => {
    const result = await policy.evaluate(baseContext);
    assert.equal(result.decision, 'not_applicable');
  });

  it('allow when resourceOwnerId matches userId', async () => {
    const result = await policy.evaluate({ ...baseContext, resourceOwnerId: 'u1' });
    assert.equal(result.decision, 'allow');
    assert.equal(result.reason, 'own record');
  });

  it('deny when resourceOwnerId does not match', async () => {
    const result = await policy.evaluate({ ...baseContext, resourceOwnerId: 'u2' });
    assert.equal(result.decision, 'deny');
    assert.equal(result.reason, 'not own record');
  });

  it('allow with ADMIN role on mismatch', async () => {
    const result = await policy.evaluate({ ...baseContext, roles: ['ADMIN'], resourceOwnerId: 'u2' });
    assert.equal(result.decision, 'allow');
    assert.equal(result.reason, 'admin override');
  });

  it('allow with OWNER role on mismatch', async () => {
    const result = await policy.evaluate({ ...baseContext, roles: ['OWNER'], resourceOwnerId: 'u2' });
    assert.equal(result.decision, 'allow');
    assert.equal(result.reason, 'admin override');
  });
});

describe('TenantBoundaryPolicy', () => {
  const policy = new TenantBoundaryPolicy();

  it('not_applicable when no resourceCompanyId', async () => {
    const result = await policy.evaluate(baseContext);
    assert.equal(result.decision, 'not_applicable');
  });

  it('allow when resourceCompanyId matches companyId', async () => {
    const result = await policy.evaluate({ ...baseContext, resourceCompanyId: 'c1' });
    assert.equal(result.decision, 'allow');
    assert.equal(result.reason, 'same tenant');
  });

  it('deny on cross-tenant', async () => {
    const result = await policy.evaluate({ ...baseContext, resourceCompanyId: 'c2' });
    assert.equal(result.decision, 'deny');
    assert.equal(result.reason, 'cross-tenant access denied');
  });
});

describe('CompositePolicyEvaluator', () => {
  it('deny wins over allow', async () => {
    const allow = { evaluate: async () => ({ decision: 'allow' as const, reason: 'ok' }) };
    const deny = { evaluate: async () => ({ decision: 'deny' as const, reason: 'no' }) };
    const evaluator = new CompositePolicyEvaluator([allow, deny]);
    const result = await evaluator.evaluate(baseContext);
    assert.equal(result.decision, 'deny');
  });

  it('allow returned when no deny', async () => {
    const na = { evaluate: async () => ({ decision: 'not_applicable' as const }) };
    const allow = { evaluate: async () => ({ decision: 'allow' as const, reason: 'ok' }) };
    const evaluator = new CompositePolicyEvaluator([na, allow]);
    const result = await evaluator.evaluate(baseContext);
    assert.equal(result.decision, 'allow');
  });

  it('not_applicable when nothing matches', async () => {
    const na = { evaluate: async () => ({ decision: 'not_applicable' as const }) };
    const evaluator = new CompositePolicyEvaluator([na, na]);
    const result = await evaluator.evaluate(baseContext);
    assert.equal(result.decision, 'not_applicable');
  });
});
