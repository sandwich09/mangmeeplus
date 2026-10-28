import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CoreOutboxPayload } from '@watchdog-bms/contracts';
import { SENSITIVE_LOG_KEY_PATTERN } from '@watchdog-bms/config';
import type { AppLogger } from '../../../../common/logger/logger.service';
import type { PrismaOutboxRepository } from '../../infrastructure/repositories/prisma-outbox.repository';
import { OUTBOX_APPEND_FAILED_EVENT, OutboxAppendService, outboxEventFingerprint } from './outbox-append.service';

type Appended = { eventKey: string };

function makeService(append: (input: Appended) => Promise<unknown>) {
  const errors: Record<string, unknown>[] = [];
  const logger = { error: (payload: Record<string, unknown>) => { errors.push(payload); } } as unknown as AppLogger;
  const repo = { append } as unknown as PrismaOutboxRepository;
  return { service: new OutboxAppendService(repo, logger), errors };
}

const payload = (overrides: Partial<CoreOutboxPayload> = {}): CoreOutboxPayload => ({
  companyId: 'company-1',
  actorUserId: 'user-1',
  aggregateType: 'accounting_payment',
  aggregateId: 'payment-1',
  occurredAt: '2026-07-28T03:00:00.000Z',
  data: { amount: '100.00', method: 'BANK_TRANSFER' },
  ...overrides,
});

describe('OutboxAppendService (L-10)', () => {
  it('emits outbox.append.failed instead of swallowing the error', async () => {
    const { service, errors } = makeService(async () => { throw new Error('Outbox payload exceeds 64 KB limit.'); });

    await service.append('accounting.payment.recorded', 'accounting_payment', 'payment-1', payload({ requestId: 'req-1' }));

    assert.equal(errors.length, 1);
    assert.equal(errors[0]?.['event'], OUTBOX_APPEND_FAILED_EVENT);
    // L-14: root-level riskLevel, or the production metric filter (which keys on $.riskLevel)
    // never sees a lost event.
    assert.equal(errors[0]?.['riskLevel'], 'HIGH');
    assert.equal(errors[0]?.['eventType'], 'accounting.payment.recorded');
    assert.equal(errors[0]?.['aggregateId'], 'payment-1');
    assert.equal(errors[0]?.['requestId'], 'req-1');
    assert.match(String((errors[0]?.['err'] as { message?: string })?.message), /64 KB/);
  });

  it('names the dedupe identity so L-09 key-pattern redaction cannot eat it', () => {
    // `eventKey` matches SENSITIVE_LOG_KEY_PATTERN (`key`), so the one investigable field in
    // the failure log used to ship as [REDACTED].
    for (const field of ['event', 'riskLevel', 'eventType', 'aggregateType', 'aggregateId', 'eventDedupeId', 'requestId', 'err']) {
      assert.ok(!SENSITIVE_LOG_KEY_PATTERN.test(field), `${field} would be redacted out of the failure log`);
    }
  });

  it('carries the eventKey value under the surviving field name', async () => {
    const { service, errors } = makeService(async () => { throw new Error('boom'); });

    await service.append('expense.voided', 'expense_record', 'expense-1', payload({ requestId: 'req-2' }));

    assert.equal(errors[0]?.['eventDedupeId'], 'expense.voided:expense_record:expense-1:req-2');
  });

  it('stays silent on a successful append', async () => {
    const keys: string[] = [];
    const { service, errors } = makeService(async (input) => { keys.push(input.eventKey); return {}; });

    await service.append('accounting.payment.recorded', 'accounting_payment', 'payment-1', payload({ requestId: 'req-1' }));

    assert.deepEqual(keys, ['accounting.payment.recorded:accounting_payment:payment-1:req-1']);
    assert.equal(errors.length, 0);
  });

  it('derives the same eventKey when the same occurrence is appended twice, so @unique de-duplicates', async () => {
    const keys: string[] = [];
    const { service } = makeService(async (input) => { keys.push(input.eventKey); return {}; });

    // One occurrence, appended twice: the use case computes `occurredAt` once and carries it.
    const occurrence = payload();
    await service.append('expense.voided', 'expense_record', 'expense-1', occurrence);
    await service.append('expense.voided', 'expense_record', 'expense-1', { ...occurrence });

    assert.equal(keys.length, 2);
    assert.equal(keys[0], keys[1]);
    assert.doesNotMatch(keys[0]!, /17[0-9]{11}/); // no epoch-millis fallback
  });

  it('keeps a legitimately recurring identical event instead of dropping it forever', async () => {
    const keys: string[] = [];
    const { service } = makeService(async (input) => { keys.push(input.eventKey); return {}; });

    // assign → unassign → assign again: same aggregate, same type, byte-identical data. Scoping
    // the key to all time silently discarded the third one.
    await service.append('crm.conversation.assigned', 'crm_conversation', 'conv-1', payload({ occurredAt: '2026-07-28T03:00:00.000Z', data: { assigneeUserId: 'u-1' } }));
    await service.append('crm.conversation.assigned', 'crm_conversation', 'conv-1', payload({ occurredAt: '2026-07-28T05:30:00.000Z', data: { assigneeUserId: 'u-1' } }));

    assert.notEqual(keys[0], keys[1]);
  });

  it('separates two different logical events without requestId', async () => {
    const keys: string[] = [];
    const { service } = makeService(async (input) => { keys.push(input.eventKey); return {}; });

    await service.append('expense.voided', 'expense_record', 'expense-1', payload({ data: { reason: 'duplicate' } }));
    await service.append('expense.voided', 'expense_record', 'expense-1', payload({ data: { reason: 'wrong supplier' } }));

    assert.notEqual(keys[0], keys[1]);
  });

  it('fingerprints independently of key insertion order', () => {
    const a = outboxEventFingerprint('e', 'agg', 'id-1', payload({ data: { amount: '1.00', method: 'CASH' } }));
    const b = outboxEventFingerprint('e', 'agg', 'id-1', payload({ data: { method: 'CASH', amount: '1.00' } }));
    assert.equal(a, b);
  });

  it('honours toJSON, so two events differing only in a Date field do not collide', () => {
    const a = outboxEventFingerprint('e', 'agg', 'id-1', payload({ data: { dueAt: new Date('2026-07-28T00:00:00.000Z') } }));
    const b = outboxEventFingerprint('e', 'agg', 'id-1', payload({ data: { dueAt: new Date('2026-08-31T00:00:00.000Z') } }));
    assert.notEqual(a, b, 'a Date used to canonicalize to {} — every date-valued field collided');
  });

  it('is a pure function of its arguments: no clock read, no randomness in the key', () => {
    const input = payload();
    assert.equal(
      outboxEventFingerprint('e', 'agg', 'id-1', input),
      outboxEventFingerprint('e', 'agg', 'id-1', { ...input, data: { ...input.data } }),
    );
  });
});

it('passes the owning transaction through and propagates failure so its state change rolls back', async () => {
  const tx = { transactionMarker: true } as any;
  const service = new OutboxAppendService({ append: async (_input: unknown, passedTx: unknown) => {
    assert.equal(passedTx, tx);
    throw new Error('transactional outbox unavailable');
  } } as any, { error: () => undefined } as any);
  await assert.rejects(service.append('expense.capture_read.finished', 'expense_capture_read_job', 'job-1', payload(), 'HIGH', tx), /transactional outbox unavailable/);
});
