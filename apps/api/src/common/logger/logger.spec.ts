/**
 * M-02: API-side Nest→pino bridge canary.
 * The API boots with `logger: new NestPinoLoggerBridge(...)` (main.ts), so every module
 * `new Logger()` call now reaches a real stream. This spec proves the wired path maps levels,
 * respects the configured level, keeps Errors readable, and still redacts secrets — and that the
 * bridge stays byte-identical to the AI Gateway copy so a one-sided edit fails loudly.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import pino from 'pino';
import { NestPinoLoggerBridge, SENSITIVE_PATHS, type AppLogger } from './logger.service';

function captureBridge(level = 'trace'): { bridge: NestPinoLoggerBridge; lines: string[]; last: () => Record<string, unknown> } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc: BufferEncoding, cb: () => void) {
      lines.push(chunk.toString().trim());
      cb();
    },
  });
  // Same redact config createLogger installs, so the canary covers the production path.
  const logger = pino({ level, redact: { paths: SENSITIVE_PATHS, censor: '[REDACTED]' } }, stream) as unknown as AppLogger;
  return {
    bridge: new NestPinoLoggerBridge(logger),
    lines,
    last: () => JSON.parse(lines[lines.length - 1] ?? '{}') as Record<string, unknown>,
  };
}

describe('API NestPinoLoggerBridge', () => {
  it('maps Nest levels onto pino levels', () => {
    const { bridge, last } = captureBridge();
    const cases = [['log', 30], ['warn', 40], ['debug', 20], ['error', 50]] as const;
    for (const [method, level] of cases) {
      bridge[method]('level check');
      assert.equal(last()['level'], level, `${method}() must emit at pino level ${level}`);
    }
  });

  it('respects the configured level end-to-end (config.logLevel)', () => {
    const { bridge, lines } = captureBridge('info');
    bridge.debug({ msg: 'noisy module detail' });
    assert.equal(lines.length, 0, 'a debug module log must not emit when the app level is info');
    bridge.log({ msg: 'ai.turn.complete' });
    assert.equal(lines.length, 1);
  });

  it('emits a first-argument Error as err + msg, not an empty spread', () => {
    const { bridge, last } = captureBridge();
    bridge.error(new Error('unhandled boom'), 'ExceptionsHandler');
    const out = last();
    const err = out['err'] as Record<string, unknown>;
    assert.equal(err['name'], 'Error');
    assert.equal(err['message'], 'unhandled boom');
    assert.ok(String(err['stack']).includes('unhandled boom'), 'stack must survive the bridge');
    assert.equal(out['msg'], 'unhandled boom', 'the emitted line must carry the failure text');
    assert.equal(out['context'], 'ExceptionsHandler');
  });

  it('keeps the Nest (message, stack, context) convention intact', () => {
    const { bridge, last } = captureBridge();
    bridge.error('boom', 'Error: boom\n    at handler', 'ExceptionsHandler');
    const out = last();
    assert.equal(out['msg'], 'boom');
    assert.equal(out['stack'], 'Error: boom\n    at handler');
    assert.equal(out['context'], 'ExceptionsHandler');
  });

  it('redaction canary – secrets never reach the stream, correlation fields survive', () => {
    const { bridge, last } = captureBridge();
    bridge.log({
      msg: 'internal tool boundary',
      requestId: 'req-canary',
      toolName: 'sales.get_sales_summary',
      token: 'jwt-value',
      authorization: 'Bearer jwt-value',
      actorDelegation: 'signed-delegation',
      ctx: { token: 'nested-jwt', authorization: 'Bearer nested', actorDelegation: 'nested-delegation' },
    }, 'InternalToolsController');
    const out = last();
    for (const field of ['token', 'authorization', 'actorDelegation']) {
      assert.equal(out[field], '[REDACTED]', `top-level ${field} must be redacted`);
      assert.equal((out['ctx'] as Record<string, unknown>)[field], '[REDACTED]', `nested ctx.${field} must be redacted`);
    }
    assert.equal(out['requestId'], 'req-canary', 'correlation fields must survive redaction');
    assert.equal(out['toolName'], 'sales.get_sales_summary');
    assert.equal(out['context'], 'InternalToolsController');
  });

  it('stays byte-identical to the AI Gateway bridge (single-sided edits must fail here)', () => {
    const marker = 'export class NestPinoLoggerBridge';
    const classBody = (path: string) => {
      const text = readFileSync(path, 'utf8');
      const start = text.indexOf(marker);
      assert.notEqual(start, -1, `${path} must still declare ${marker}`);
      return text.slice(start).trim();
    };
    assert.equal(
      classBody(join(__dirname, 'logger.service.ts')),
      classBody(join(__dirname, '../../../../ai-gateway/src/common/logger/logger.service.ts')),
      'NestPinoLoggerBridge must be kept identical in apps/api and apps/ai-gateway',
    );
  });
});
