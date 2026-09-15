import assert from 'node:assert/strict';
import { test } from 'node:test';
import { postmarkConfigurationFacts } from './postmark-configuration';

const expected = { serverId: 123, stream: 'outbound' };
const server = { ID: 123, DeliveryType: 'Sandbox', ApiTokens: ['PRIVATE_TOKEN'], Name: 'PRIVATE_NAME', InboundAddress: 'PRIVATE_ADDRESS' };
const stream = { ID: 'outbound', ServerID: 123, MessageStreamType: 'Transactional', ArchivedAt: null, ExpectedPurgeDate: '2099-01-01T00:00:00Z' };

test('projects only configured native facts without secrets or inferred content retention', () => {
  assert.deepEqual(postmarkConfigurationFacts(expected, server, stream), {
    server: 'MATCHED', stream: 'MATCHED', mode: 'SANDBOX', transactional: true, archived: false,
  });
  assert.equal(postmarkConfigurationFacts(expected, { ...server, DeliveryType: 'Live' }, stream).mode, 'LIVE');
  assert.doesNotMatch(JSON.stringify(postmarkConfigurationFacts(expected, server, stream)), /PRIVATE|2099|retention|quota|ApiTokens/);
});

test('foreign identities never establish configured mode, stream type or archive state', () => {
  assert.deepEqual(postmarkConfigurationFacts(expected, { ...server, ID: 456 }, stream), {
    server: 'MISMATCH', stream: 'UNKNOWN', mode: 'UNKNOWN', transactional: null, archived: null,
  });
  for (const changed of [{ ...stream, ID: 'foreign' }, { ...stream, ServerID: 456 }]) {
    assert.deepEqual(postmarkConfigurationFacts(expected, server, changed), {
      server: 'MATCHED', stream: 'MISMATCH', mode: 'SANDBOX', transactional: null, archived: null,
    });
  }
});

test('absent or malformed native fields remain unknown without truthy coercion', () => {
  for (const malformed of [null, [], { ID: '123' }, { ID: true }, { ID: -1 }]) {
    assert.equal(postmarkConfigurationFacts(expected, malformed, stream).server, 'UNKNOWN');
  }
  assert.equal(postmarkConfigurationFacts(expected, { ID: 123 }, stream).mode, 'UNKNOWN');
  assert.equal(postmarkConfigurationFacts(expected, server, { ...stream, ServerID: '123' }).stream, 'UNKNOWN');
  const partial = postmarkConfigurationFacts(expected, server, { ID: 'outbound', ServerID: 123 });
  assert.equal(partial.transactional, null); assert.equal(partial.archived, null);
  for (const ArchivedAt of ['invalid', '0', '2026-09-15']) assert.equal(postmarkConfigurationFacts(expected, server, { ...stream, ArchivedAt }).archived, null);
});

test('known inactive or non-transactional streams stay distinguishable from unknown', () => {
  assert.equal(postmarkConfigurationFacts(expected, server, { ...stream, ArchivedAt: '2026-09-15T00:00:00Z' }).archived, true);
  for (const MessageStreamType of ['Inbound', 'Broadcasts']) {
    assert.equal(postmarkConfigurationFacts(expected, server, { ...stream, MessageStreamType }).transactional, false);
  }
  assert.equal(postmarkConfigurationFacts(expected, server, { ...stream, MessageStreamType: 'new-type' }).transactional, null);
});
