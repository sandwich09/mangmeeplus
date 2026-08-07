/**
 * L-09 redaction canary — AI Gateway side.
 *
 * The gateway runs the same shared `redactLogValue` from `@watchdog-bms/config`, but through its
 * own `createLogger`. This spec proves the gateway's pino instance actually installs it: the API
 * canary cannot vouch for a second process's configuration.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { createLogger } from './logger.service';

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc: BufferEncoding, cb: () => void) {
      lines.push(chunk.toString().trim());
      cb();
    },
  });
  const logger = createLogger({ level: 'trace', redactionEnabled: true, serviceName: 'gateway-test' }, stream);
  return { logger, last: () => JSON.parse(lines[lines.length - 1] ?? '{}') as Record<string, unknown> };
}

const DSN = 'postgres://watchdog:S3cr3tP%40ss@db.internal.example:5432/watchdog_bms';

describe('L-09 deep log redaction (AI Gateway createLogger)', () => {
  it('redacts a depth-3 nested secret', () => {
    const { logger, last } = capture();
    logger.info({ msg: 'ai.turn.complete', payload: { data: { apiKey: 'ak_live_must_not_leak' } } });
    const data = (last()['payload'] as Record<string, unknown>)['data'] as Record<string, unknown>;
    assert.equal(data['apiKey'], '[REDACTED]');
  });

  it('redacts err.meta on the all-exceptions.filter 5xx shape and scrubs a DSN in err.message', () => {
    const { logger, last } = capture();
    logger.error(
      {
        requestId: 'req-1',
        method: 'POST',
        path: '/internal/ai/turn',
        err: {
          name: 'PrismaClientInitializationError',
          message: `Can't reach database server at ${DSN}`,
          stack: 'at connect',
          code: 'P1001',
          meta: { password: 'driver-meta-password' },
        },
      },
      'unhandled exception',
    );
    const out = last();
    const err = out['err'] as Record<string, unknown>;
    assert.equal(
      err['message'],
      "Can't reach database server at postgres://[REDACTED]@db.internal.example:5432/watchdog_bms",
    );
    assert.equal((err['meta'] as Record<string, unknown>)['password'], '[REDACTED]');
    assert.equal(err['code'], 'P1001', 'forensic content survives');
    assert.equal(out['requestId'], 'req-1');
  });

  it('redacts key-pattern secrets the exact-path list never matched', () => {
    const { logger, last } = capture();
    logger.warn({ msg: 'ai.tool.policy.deny', internalSecret: 'is-1', idToken: 'id-1', channelSecret: 'cs-1' });
    const out = last();
    for (const field of ['internalSecret', 'idToken', 'channelSecret']) {
      assert.equal(out[field], '[REDACTED]', `${field} must be redacted by key pattern`);
    }
    assert.equal(out['msg'], 'ai.tool.policy.deny', 'the event name must survive redaction');
  });

  it('redacts personal-data keys and the raw user prompt', () => {
    const { logger, last } = capture();
    logger.info({ msg: 'ai.turn.start', requestId: 'r-1', prompt: 'raw user text', user: { lineUserId: 'U1', phone: '081' } });
    const out = last();
    assert.equal(out['prompt'], '[REDACTED]');
    const user = out['user'] as Record<string, unknown>;
    assert.equal(user['lineUserId'], '[REDACTED]');
    assert.equal(user['phone'], '[REDACTED]');
    assert.equal(out['requestId'], 'r-1');
  });

  it('scrubs a DSN passed on the msg channel', () => {
    const { logger, last } = capture();
    logger.error({ requestId: 'r-2' }, `connect failed: ${DSN}`);
    assert.equal(last()['msg'], 'connect failed: postgres://[REDACTED]@db.internal.example:5432/watchdog_bms');
  });
});
