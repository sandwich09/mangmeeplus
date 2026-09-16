/**
 * L-09 redaction canary — API side.
 *
 * These assertions run through a REAL pino instance built by the production `createLogger`,
 * not against `redactLogValue` in isolation. pino applies `formatters.log` first, then per-key
 * serializers, then the `redact` stringifiers (pino/lib/tools.js `asJson`), so the only way to
 * know what actually reaches the stream is to capture the stream.
 *
 * The shape under test is the real leak path: `all-exceptions.filter.ts` logs
 * `err: { name, message, stack, code, meta }` on every 5xx, where `meta` is a Prisma payload and
 * `message` from a Prisma init failure embeds the whole DATABASE_URL.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { createLogger } from './logger.service';

function capture(redactionEnabled = true) {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc: BufferEncoding, cb: () => void) {
      lines.push(chunk.toString().trim());
      cb();
    },
  });
  const logger = createLogger({ level: 'trace', redactionEnabled, serviceName: 'api-test' }, stream);
  return { logger, last: () => JSON.parse(lines[lines.length - 1] ?? '{}') as Record<string, unknown> };
}

const DSN = 'postgres://watchdog:S3cr3tP%40ss@db.internal.example:5432/watchdog_bms';

describe('L-09 deep log redaction (real pino instance)', () => {
  it('redacts a secret nested three levels deep — beyond pino redact.paths depth ceiling', () => {
    const { logger, last } = capture();
    logger.info({ msg: 'depth check', payload: { data: { apiKey: 'ak_live_must_not_leak' } } });
    const payload = last()['payload'] as Record<string, unknown>;
    const data = payload['data'] as Record<string, unknown>;
    assert.equal(data['apiKey'], '[REDACTED]', 'payload.data.apiKey is depth 3 — redact.paths cannot reach it');
    assert.ok(!JSON.stringify(last()).includes('ak_live_must_not_leak'));
  });

  it('redacts err.meta.password on the all-exceptions.filter 5xx shape', () => {
    const { logger, last } = capture();
    logger.error(
      {
        requestId: 'req-1',
        method: 'POST',
        path: '/v1/companies/co-1/journals',
        err: {
          name: 'PrismaClientKnownRequestError',
          message: 'Unique constraint failed',
          stack: 'PrismaClientKnownRequestError: Unique constraint failed\n    at handler',
          code: 'P2002',
          meta: { code: '000123', otp: '654321', nonce: 'sensitive-nonce', target: ['email'], password: 'db-password-in-driver-meta', user: { apiKey: 'nested-ak' } },
        },
      },
      'unhandled exception',
    );
    const out = last();
    const err = out['err'] as Record<string, unknown>;
    const meta = err['meta'] as Record<string, unknown>;
    assert.equal(meta['code'], '[REDACTED]');
    assert.equal(meta['otp'], '[REDACTED]');
    assert.equal(meta['nonce'], '[REDACTED]');
    assert.equal(meta['password'], '[REDACTED]', 'err.meta.password must be redacted');
    assert.equal((meta['user'] as Record<string, unknown>)['apiKey'], '[REDACTED]', 'err.meta.user.apiKey is depth 4');
    assert.equal(err['code'], 'P2002', 'non-personal forensic content must survive (spec §4.4)');
    assert.equal(out['requestId'], 'req-1', 'correlation fields must survive');
    assert.equal(out['path'], '/v1/companies/co-1/journals');
    assert.ok(!JSON.stringify(out).includes('db-password-in-driver-meta'));
  });

  it('scrubs a Postgres DSN embedded inside err.message (Prisma init failure)', () => {
    const { logger, last } = capture();
    logger.error(
      {
        requestId: 'req-2',
        err: {
          name: 'PrismaClientInitializationError',
          message: `Can't reach database server at ${DSN}`,
          stack: `PrismaClientInitializationError: Can't reach database server at ${DSN}\n    at connect`,
        },
      },
      'unhandled exception',
    );
    const out = last();
    const err = out['err'] as Record<string, unknown>;
    // The load-bearing assertion: credentials are gone, the diagnostic host/port/db survives.
    assert.equal(
      err['message'],
      "Can't reach database server at postgres://[REDACTED]@db.internal.example:5432/watchdog_bms",
    );
    assert.ok(!JSON.stringify(out).includes('S3cr3tP%40ss'), 'the DSN password must not reach the stream');
    assert.ok(!JSON.stringify(out).includes('watchdog:'), 'the DSN user must not reach the stream');
    assert.ok(String(err['stack']).includes('[REDACTED]@db.internal.example'), 'the stack copy is scrubbed too');
  });

  it('scrubs a DSN passed on the msg channel (2nd logger argument, not formatters.log)', () => {
    const { logger, last } = capture();
    logger.error({ requestId: 'req-3' }, `db connect failed: ${DSN}`);
    assert.equal(last()['msg'], 'db connect failed: postgres://[REDACTED]@db.internal.example:5432/watchdog_bms');
  });

  it('redacts key-pattern secrets that the exact-path list never matched', () => {
    const { logger, last } = capture();
    logger.warn({
      msg: 'boundary',
      apiKey: 'ak-1',
      idToken: 'id-1',
      internalSecret: 'is-1',
      channelSecret: 'cs-1',
      accessToken: 'at-1',
      signingKey: 'sk-1',
    });
    const out = last();
    for (const field of ['apiKey', 'idToken', 'internalSecret', 'channelSecret', 'accessToken', 'signingKey']) {
      assert.equal(out[field], '[REDACTED]', `${field} must be redacted by key pattern`);
    }
  });

  it('redacts personal-data keys in the log pipeline (audit trail is unaffected — L-11)', () => {
    const { logger, last } = capture();
    logger.info({
      msg: 'crm.inbound',
      conversationId: 'conv-1',
      customer: { displayName: 'สมชาย', phone: '0812345678', email: 'a@b.co', lineUserId: 'U123', taxId: '0105' },
    });
    const customer = last()['customer'] as Record<string, unknown>;
    for (const field of ['displayName', 'phone', 'email', 'lineUserId', 'taxId']) {
      assert.equal(customer[field], '[REDACTED]', `personal-data key ${field} must not reach the log pipeline`);
    }
    assert.equal(last()['conversationId'], 'conv-1', 'non-personal correlation must survive');
  });

  it('empirical ordering: formatters.log runs before pino\'s err serializer', () => {
    // pino's default `serializers.err` re-shapes anything error-like into `{type,message,stack,...}`.
    // Seeing BOTH the injected `type` and our redaction on the same object proves formatters.log
    // handed a redacted plain object to the serializer, not the other way round.
    const { logger, last } = capture();
    logger.error({ err: { name: 'E', message: 'x', stack: 's', token: 'leak-me' } });
    const err = last()['err'] as Record<string, unknown>;
    assert.equal(err['token'], '[REDACTED]');
    assert.equal(err['type'], 'Object', 'pino errSerializer ran after formatters.log');
    assert.equal(err['name'], 'E', 'the M-02 bridge contract (err.name) still holds');
  });

  it('a real Error instance keeps name/message/stack through the redactor', () => {
    const { logger, last } = capture();
    const error = Object.assign(new Error(`boom at ${DSN}`), { apiKey: 'ak-on-error' });
    logger.error({ err: error });
    const err = last()['err'] as Record<string, unknown>;
    assert.equal(err['name'], 'Error');
    assert.equal(err['apiKey'], '[REDACTED]', 'enumerable own props of an Error are walked');
    assert.ok(!JSON.stringify(last()).includes('S3cr3tP%40ss'));
  });

  it('redactionEnabled=false leaves the payload untouched (opt-out is honest)', () => {
    const { logger, last } = capture(false);
    logger.info({ msg: 'plain', apiKey: 'visible' });
    assert.equal(last()['apiKey'], 'visible');
  });

  it('is cycle-safe — a self-referencing payload does not throw', () => {
    const { logger, last } = capture();
    const cyclic: Record<string, unknown> = { msg: 'cycle', token: 'x' };
    cyclic['self'] = cyclic;
    assert.doesNotThrow(() => logger.info(cyclic));
    assert.equal(last()['token'], '[REDACTED]');
  });
});
