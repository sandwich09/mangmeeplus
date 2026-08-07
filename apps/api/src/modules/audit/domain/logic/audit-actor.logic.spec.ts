import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAuditActor } from './audit-actor.logic';

describe('normalizeAuditActor', () => {
  it('defaults to USER and keeps actorUserId, dropping actorRefId', () => {
    assert.deepEqual(normalizeAuditActor({ actorUserId: 'user-1' }), {
      actorType: 'USER',
      actorUserId: 'user-1',
      actorRefId: null,
    });
  });

  it('ignores a stray actorRefId on a USER actor', () => {
    assert.deepEqual(normalizeAuditActor({ actorType: 'USER', actorUserId: 'user-1', actorRefId: 'x' }), {
      actorType: 'USER',
      actorUserId: 'user-1',
      actorRefId: null,
    });
  });

  it('nulls the User FK for a SYSTEM actor and keeps actorRefId', () => {
    assert.deepEqual(normalizeAuditActor({ actorType: 'SYSTEM', actorRefId: 'scan-crm-sla' }), {
      actorType: 'SYSTEM',
      actorUserId: null,
      actorRefId: 'scan-crm-sla',
    });
  });

  it('fails closed: a non-USER actor never writes a User id into actorUserId', () => {
    for (const actorType of ['SYSTEM', 'CRM_CUSTOMER', 'SERVICE'] as const) {
      const result = normalizeAuditActor({ actorType, actorUserId: 'user-1', actorRefId: 'ref-1' });
      assert.equal(result.actorUserId, null, `${actorType} must not occupy the User FK`);
      assert.equal(result.actorType, actorType);
      assert.equal(result.actorRefId, 'ref-1');
    }
  });

  it('leaves actorRefId null when a non-USER actor supplies none', () => {
    assert.deepEqual(normalizeAuditActor({ actorType: 'CRM_CUSTOMER' }), {
      actorType: 'CRM_CUSTOMER',
      actorUserId: null,
      actorRefId: null,
    });
  });
});
