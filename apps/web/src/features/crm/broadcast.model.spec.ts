import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { broadcastBlockReason } from './broadcast.model';

const ready = { message: 'โปรวันนี้', recipientCount: 12, channelConnected: true, canSend: true, quotaRemaining: 20, busy: false };

describe('broadcastBlockReason', () => {
  it('allows a valid send', () => assert.equal(broadcastBlockReason(ready), null));
  it('blocks permission, disconnected OA, empty audience and insufficient quota', () => {
    assert.match(broadcastBlockReason({ ...ready, canSend: false })!, /ไม่มีสิทธิ์/);
    assert.match(broadcastBlockReason({ ...ready, channelConnected: false })!, /LINE OA/);
    assert.match(broadcastBlockReason({ ...ready, recipientCount: 0 })!, /ไม่มีผู้รับ/);
    assert.match(broadcastBlockReason({ ...ready, quotaRemaining: 11 })!, /โควตา/);
  });
  it('trims message before validation', () => assert.match(broadcastBlockReason({ ...ready, message: ' ' })!, /ข้อความ/));
});

