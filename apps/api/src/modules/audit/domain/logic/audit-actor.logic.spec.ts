import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { systemWorkerContext } from '../../../auth/domain/logic/system-worker-context';
import { auditActorOf, normalizeAuditActor } from './audit-actor.logic';

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

/**
 * `AuditLog.actorUserId` is a real FK to User. A worker context carries `userId: 'system'`, which
 * is no User row: written as a USER actor the insert is rejected, and `AuditService.log` then
 * drops the row without throwing (the journals the auto-post worker generates, the vendors a
 * capture read saves, a customer's consent withdrawal over LINE).
 */
describe('the system context id is never a USER actor', () => {
  const worker = systemWorkerContext({
    requestId: 'req-1', companyId: 'co-1', permissions: [], authSubject: 'expense-auto-post-worker',
  });

  it('names a worker by its subsystem and leaves a person as the USER actor', () => {
    assert.deepEqual(auditActorOf(worker.userId, worker.authSubject), {
      actorType: 'SYSTEM',
      actorRefId: 'expense-auto-post-worker',
    });
    assert.deepEqual(auditActorOf('user-1', 'user-1'), { actorUserId: 'user-1' });
    assert.deepEqual(normalizeAuditActor(auditActorOf(worker.userId, worker.authSubject)), {
      actorType: 'SYSTEM',
      actorUserId: null,
      actorRefId: 'expense-auto-post-worker',
    });
  });

  it('keeps the id out of the User FK even when a caller still writes it as a USER actor', () => {
    assert.deepEqual(normalizeAuditActor({ actorUserId: worker.userId }), {
      actorType: 'SYSTEM',
      actorUserId: null,
      actorRefId: 'system',
    });
  });
});
