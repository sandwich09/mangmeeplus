import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import {
  OBJECT_VERSION_CLEANUP_ENQUEUE_FAILED_EVENT,
  OBJECT_VERSION_CLEANUP_EVENT_TYPE,
  ObjectVersionCleanupService,
} from './object-version-cleanup.service';

function fixture() {
  const appended: any[] = [];
  const claimed: any[] = [];
  const completed: any[] = [];
  const failed: any[] = [];
  const errors: any[] = [];
  const repo = {
    append: mock.fn(async (input: any) => { appended.push(input); return {}; }),
    reclaimStalledProcessing: mock.fn(async () => ({ reclaimed: 1, dead: 2 })),
    claimBatch: mock.fn(async (input: any) => {
      claimed.push(input);
      return [{ id: 'task-1', claimToken: 'claim-token-1', attempts: 2, payloadJson: { schemaVersion: 1 } }];
    }),
    markPublished: mock.fn(async (input: any) => { completed.push(input); return true; }),
    markFailed: mock.fn(async (input: any) => { failed.push(input); return true; }),
  };
  const logger = { error: (input: any) => errors.push(input) };
  return {
    service: new ObjectVersionCleanupService(repo as any, logger as any),
    repo,
    appended,
    claimed,
    completed,
    failed,
    errors,
  };
}

describe('ObjectVersionCleanupService', () => {
  it('durably appends one idempotent HIGH-priority exact-version task', async () => {
    const { service, appended } = fixture();
    const input = {
      companyId: 'company-1',
      bucket: 'watchdog-bms-prod',
      objectPath: 'report-export/company-1/run-1/file.csv',
      expectedVersion: 'version-1',
      source: 'REPORT_EXPORT' as const,
    };
    assert.equal(await service.enqueue(input), true);
    assert.equal(await service.enqueue(input), true);
    assert.equal(appended.length, 2);
    assert.equal(appended[0].eventType, OBJECT_VERSION_CLEANUP_EVENT_TYPE);
    assert.equal(appended[0].priority, 'HIGH');
    assert.equal(appended[0].eventKey, appended[1].eventKey);
    assert.deepEqual(appended[0].payloadJson, {
      schemaVersion: 1,
      companyId: 'company-1',
      bucket: 'watchdog-bms-prod',
      path: 'report-export/company-1/run-1/file.csv',
      expectedVersion: 'version-1',
      source: 'REPORT_EXPORT',
      requestedAt: appended[0].payloadJson.requestedAt,
    });
  });

  it('refuses a source/prefix mismatch and records a CRITICAL enqueue failure', async () => {
    const { service, appended, errors } = fixture();
    assert.equal(await service.enqueue({
      companyId: 'company-1',
      bucket: 'watchdog-bms-prod',
      objectPath: 'evidence/company-2/hash/file.pdf',
      expectedVersion: 'version-1',
      source: 'ATTACHMENT_FINALIZATION',
    }), false);
    assert.equal(appended.length, 0);
    assert.equal(errors[0].event, OBJECT_VERSION_CLEANUP_ENQUEUE_FAILED_EVENT);
    assert.equal(errors[0].riskLevel, 'CRITICAL');
    assert.equal(JSON.stringify(errors[0]).includes('evidence/company-2'), false);
  });

  it('claims only cleanup events and fences success/failure by event type and token', async () => {
    const { service, claimed, completed, failed } = fixture();
    const result = await service.claim(7);
    assert.deepEqual(claimed, [{
      batchSize: 7,
      claimedBy: 'object-version-cleanup-worker',
      eventTypes: [OBJECT_VERSION_CLEANUP_EVENT_TYPE],
    }]);
    assert.equal(result.tasks[0]?.attempt, 3);
    assert.equal(result.reclaimed, 1);
    assert.equal(result.dead, 2);

    assert.equal(await service.complete('task-1', 'claim-token-1'), true);
    assert.equal(await service.fail('task-1', 'claim-token-1', 's3_delete_failed:accessdenied'), true);
    assert.equal(completed[0].expectedEventType, OBJECT_VERSION_CLEANUP_EVENT_TYPE);
    assert.equal(failed[0].expectedEventType, OBJECT_VERSION_CLEANUP_EVENT_TYPE);
    assert.equal(failed[0].error, 's3_delete_failed:accessdenied');
  });

  it('preserves producer error semantics when durable append itself is unavailable', async () => {
    const { service, repo, errors } = fixture();
    repo.append.mock.mockImplementation(async () => { throw new Error('database unavailable'); });
    assert.equal(await service.enqueue({
      companyId: 'company-1',
      bucket: 'watchdog-bms-prod',
      objectPath: 'company-1/generated/expense-substitute/expense-1/file.svg',
      expectedVersion: 'version-1',
      source: 'SUBSTITUTE_RECEIPT_ISSUED',
    }), false);
    assert.equal(errors[0].riskLevel, 'CRITICAL');
  });
});
