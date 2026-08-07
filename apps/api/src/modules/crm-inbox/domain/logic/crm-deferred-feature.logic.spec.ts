import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { assertBroadcastEnabled, assertReleaseOneBroadcastPayload, isBroadcastEnabled } from './crm-deferred-feature.logic';

test('broadcast is deny-by-default and only an explicit true enables it', () => {
  assert.equal(isBroadcastEnabled({}), false);
  assert.equal(isBroadcastEnabled({ CRM_BROADCAST_ENABLED: 'false' }), false);
  assert.equal(isBroadcastEnabled({ CRM_BROADCAST_ENABLED: 'TRUE' }), false);
  assert.equal(isBroadcastEnabled({ CRM_BROADCAST_ENABLED: 'true' }), true);
  assert.throws(() => assertBroadcastEnabled({}), ForbiddenException);
});

test('release one rejects poster and scheduling controls while allowing text send-now', () => {
  assert.doesNotThrow(() => assertReleaseOneBroadcastPayload({}));
  assert.throws(() => assertReleaseOneBroadcastPayload({ imageUrl: 'https://cdn.example/poster.png' }), BadRequestException);
  assert.throws(() => assertReleaseOneBroadcastPayload({ scheduledAt: new Date(Date.now() + 60_000).toISOString() }), BadRequestException);
});
