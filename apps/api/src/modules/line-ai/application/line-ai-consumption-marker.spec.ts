import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ConsumptionMarkerUnavailableError,
  clarificationMarkerKey,
  correctionMarkerKey,
  findConsumedClarificationIds,
  markClarificationsConsumed,
  type MarkerTransactionClient,
} from './line-ai-consumption-marker';

function fakeTx(options: { failFindMany?: boolean; existing?: string[] } = {}) {
  const created: Array<Record<string, unknown>> = [];
  const keys = new Set(options.existing ?? []);
  const tx: MarkerTransactionClient = {
    outboxEvent: {
      create: async ({ data }) => { created.push(data); keys.add(String(data['eventKey'])); },
      findMany: async ({ where }) => {
        if (options.failFindMany) throw new Error('db_down');
        return ((where['eventKey'] as { in: string[] }).in).filter((key) => keys.has(key)).map((eventKey) => ({ eventKey }));
      },
    },
  };
  return { tx, created };
}

describe('LINE AI consumption markers', () => {
  it('keys a correction by message, not by target, so a re-targeted redelivery still matches', () => {
    assert.equal(
      correctionMarkerKey('co-1', 'hash-abc'),
      'expense.line_correction.applied:line_message:co-1:hash-abc',
    );
  });

  it('scopes clarification keys by company and stream so equal Redis ids never collide', () => {
    const chatA = clarificationMarkerKey('co-1', 'lineai:ledger:co-1:chatA', '1-0');
    const chatB = clarificationMarkerKey('co-1', 'lineai:ledger:co-1:chatB', '1-0');
    const otherCompany = clarificationMarkerKey('co-2', 'lineai:ledger:co-2:chatA', '1-0');

    assert.notEqual(chatA, chatB);
    assert.notEqual(chatA, otherCompany);
    assert.ok(chatA.startsWith('ai.line.clarification.consumed:line_clarification:co-1:'));
    // The raw chat id must never reach Postgres — only its hash.
    assert.ok(!chatA.includes('chatA'));
  });

  it('writes one marker per consumed entry on the caller transaction client', async () => {
    const { tx, created } = fakeTx();

    await markClarificationsConsumed(tx, {
      companyId: 'co-1', ledgerStreamKey: 'lineai:ledger:co-1:chat1', entryIds: ['1-0', '2-0'], outcome: 'correction_guidance',
    });

    assert.equal(created.length, 2);
    assert.equal(created[0]['companyId'], 'co-1');
    assert.equal(created[0]['aggregateType'], 'line_clarification');
    assert.deepEqual(created[0]['payloadJson'], { entryId: '1-0', outcome: 'correction_guidance' });
  });

  it('reports exactly the entries that already have markers', async () => {
    const streamKey = 'lineai:ledger:co-1:chat1';
    const { tx } = fakeTx({ existing: [clarificationMarkerKey('co-1', streamKey, '2-0')] });

    const consumed = await findConsumedClarificationIds(tx, { companyId: 'co-1', ledgerStreamKey: streamKey, entryIds: ['1-0', '2-0'] });

    assert.deepEqual([...consumed], ['2-0']);
  });

  it('raises a typed unavailable error rather than reporting "nothing consumed" when the lookup fails', async () => {
    const { tx } = fakeTx({ failFindMany: true });

    await assert.rejects(
      () => findConsumedClarificationIds(tx, { companyId: 'co-1', ledgerStreamKey: 'lineai:ledger:co-1:chat1', entryIds: ['1-0'] }),
      (err: unknown) => err instanceof ConsumptionMarkerUnavailableError,
    );
  });

  it('skips the query entirely when there is nothing to check', async () => {
    const { tx } = fakeTx({ failFindMany: true });

    assert.equal((await findConsumedClarificationIds(tx, { companyId: 'co-1', ledgerStreamKey: 'k', entryIds: [] })).size, 0);
  });
});
