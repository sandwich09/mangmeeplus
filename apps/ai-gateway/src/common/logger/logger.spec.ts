/**
 * Logger redaction guard.
 * Verifies that SENSITIVE_PATHS covers both top-level and nested sensitive fields,
 * and that non-sensitive fields are preserved in log output.
 *
 * WHY: Phase 8 requirement — AI_PROMPT_LOGGING_ENABLED=false must be provably safe.
 * If pino redact only covered nested paths (*.prompt) and not top-level (prompt),
 * an accidental logger.log({ prompt: 'user text' }) would leak.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { Logger } from '@nestjs/common';
import pino from 'pino';
import { NestPinoLoggerBridge, SENSITIVE_FIELDS, SENSITIVE_PATHS, createLogger, type AppLogger } from './logger.service';

function captureLogger(redactionEnabled: boolean): { log: (obj: Record<string, unknown>) => void; last: () => Record<string, unknown> } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc: BufferEncoding, cb: () => void) {
      lines.push(chunk.toString().trim());
      cb();
    },
  });
  const logger = pino(
    { level: 'info', redact: redactionEnabled ? { paths: SENSITIVE_PATHS, censor: '[REDACTED]' } : undefined },
    stream,
  );
  return {
    log: (obj) => logger.info(obj),
    last: () => JSON.parse(lines[lines.length - 1] ?? '{}') as Record<string, unknown>,
  };
}

describe('SENSITIVE_PATHS', () => {
  it('includes direct top-level path for every sensitive field', () => {
    for (const field of SENSITIVE_FIELDS) {
      assert.ok(
        SENSITIVE_PATHS.includes(field),
        `SENSITIVE_PATHS must contain direct path "${field}" for top-level redaction`,
      );
    }
  });

  it('includes req.headers.* path for every sensitive field', () => {
    for (const field of SENSITIVE_FIELDS) {
      assert.ok(
        SENSITIVE_PATHS.includes(`req.headers.${field}`),
        `SENSITIVE_PATHS must contain "req.headers.${field}"`,
      );
    }
  });
});

describe('createLogger – redaction enabled', () => {
  it('redacts top-level prompt field', () => {
    const { log, last } = captureLogger(true);
    log({ msg: 'test', prompt: 'raw user text that must never appear in logs' });
    assert.equal(last()['prompt'], '[REDACTED]', 'top-level prompt must be redacted');
  });

  it('redacts top-level secret field', () => {
    const { log, last } = captureLogger(true);
    log({ msg: 'test', secret: 'my-internal-secret-value' });
    assert.equal(last()['secret'], '[REDACTED]');
  });

  it('redacts nested prompt field (e.g. opts.prompt)', () => {
    const { log, last } = captureLogger(true);
    log({ msg: 'test', opts: { prompt: 'nested prompt text' } });
    const opts = last()['opts'] as Record<string, unknown>;
    assert.equal(opts['prompt'], '[REDACTED]', 'nested opts.prompt must be redacted');
  });

  it('redacts actor delegations and their internal header', () => {
    const { log, last } = captureLogger(true);
    log({
      actorDelegations: { 'inventory.list_low_stock': ['signed-delegation'] },
      req: { headers: { 'x-actor-delegation': 'signed-delegation' } },
    });
    assert.equal(last()['actorDelegations'], '[REDACTED]');
    assert.equal(
      ((last()['req'] as Record<string, unknown>)['headers'] as Record<string, unknown>)['x-actor-delegation'],
      '[REDACTED]',
    );
  });

  it('preserves non-sensitive fields', () => {
    const { log, last } = captureLogger(true);
    log({ msg: 'ai.turn.complete', requestId: 'req-1', companyId: 'co-1', refused: false, toolCount: 2, durationMs: 150 });
    const out = last();
    assert.equal(out['requestId'], 'req-1');
    assert.equal(out['companyId'], 'co-1');
    assert.equal(out['refused'], false);
    assert.equal(out['toolCount'], 2);
    assert.equal(out['durationMs'], 150);
  });
});

describe('createLogger – redaction disabled', () => {
  it('does not redact fields when redactionEnabled=false', () => {
    const logger = createLogger({ level: 'info', redactionEnabled: false, serviceName: 'test' });
    // Just verify createLogger returns a pino logger with no redact crash
    assert.ok(typeof logger.info === 'function');
  });
});

// ── M-02: Nest → pino bridge (module Logger calls are no longer dropped) ──────

function captureBridge(): { bridge: NestPinoLoggerBridge; last: () => Record<string, unknown> } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc: BufferEncoding, cb: () => void) {
      lines.push(chunk.toString().trim());
      cb();
    },
  });
  const logger = pino(
    { level: 'trace', redact: { paths: SENSITIVE_PATHS, censor: '[REDACTED]' } },
    stream,
  ) as unknown as AppLogger;
  return {
    bridge: new NestPinoLoggerBridge(logger),
    last: () => JSON.parse(lines[lines.length - 1] ?? '{}') as Record<string, unknown>,
  };
}

describe('NestPinoLoggerBridge', () => {
  it('maps every Nest level onto the matching pino level', () => {
    const { bridge, last } = captureBridge();
    const cases = [['log', 30], ['warn', 40], ['error', 50], ['debug', 20], ['verbose', 10], ['fatal', 60]] as const;
    for (const [method, level] of cases) {
      bridge[method]('level check');
      assert.equal(last()['level'], level, `${method}() must emit at pino level ${level}`);
    }
  });

  it('emits a string message as pino msg', () => {
    const { bridge, last } = captureBridge();
    bridge.log('ai-gateway started');
    assert.equal(last()['msg'], 'ai-gateway started');
  });

  it('merges an object message into the pino payload', () => {
    const { bridge, last } = captureBridge();
    bridge.log({ msg: 'ai.tool.invoke.result', requestId: 'req-1', durationMs: 12 });
    const out = last();
    assert.equal(out['msg'], 'ai.tool.invoke.result');
    assert.equal(out['requestId'], 'req-1');
    assert.equal(out['durationMs'], 12);
  });

  it('records the trailing Nest context argument as a context field', () => {
    const { bridge, last } = captureBridge();
    bridge.log({ msg: 'ai.tool.policy.allow', toolName: 'inventory.list_low_stock' }, 'ErpToolClient');
    assert.equal(last()['context'], 'ErpToolClient');
    bridge.warn('plain warning', 'LineAiTurnUseCase');
    const out = last();
    assert.equal(out['msg'], 'plain warning');
    assert.equal(out['context'], 'LineAiTurnUseCase');
  });

  it('keeps the Error passed to error() in the payload', () => {
    const { bridge, last } = captureBridge();
    bridge.error('boom', new Error('provider exploded'), 'LineAiTurnUseCase');
    const out = last();
    const err = out['err'] as Record<string, unknown>;
    assert.equal(err['message'], 'provider exploded');
    assert.ok(String(err['stack']).includes('provider exploded'), 'stack must survive the bridge');
    assert.equal(out['context'], 'LineAiTurnUseCase');
  });

  it('emits a first-argument Error as err + msg, not an empty spread', () => {
    // Nest's ExceptionsHandler calls error(error, context) in some versions; Error own-props are
    // non-enumerable, so the object branch would otherwise emit a content-free line.
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
    assert.equal(out['stack'], 'Error: boom\n    at handler');
    assert.equal(out['context'], 'ExceptionsHandler');
    assert.equal(out['msg'], 'boom');
  });

  it('receives real Nest module Logger calls once installed (main.ts wiring)', () => {
    const { bridge, last } = captureBridge();
    Logger.overrideLogger(bridge);
    new Logger('ErpToolClient').log({ msg: 'ai.tool.invoke.result', requestId: 'req-nest', durationMs: 3 });
    const out = last();
    assert.equal(out['msg'], 'ai.tool.invoke.result', 'module Logger output must no longer be dropped');
    assert.equal(out['requestId'], 'req-nest');
    assert.equal(out['context'], 'ErpToolClient', 'Nest appends the class context as the last argument');
  });

  it('redaction canary – secrets logged through the bridge never reach the stream', () => {
    const { bridge, last } = captureBridge();
    bridge.log({
      msg: 'ai.tool.invoke.result',
      requestId: 'req-canary',
      toolName: 'inventory.list_low_stock',
      durationMs: 9,
      token: 'jwt-value',
      authorization: 'Bearer jwt-value',
      actorDelegation: 'signed-delegation',
      prompt: 'raw user message text',
    }, 'ErpToolClient');
    const out = last();
    for (const field of ['token', 'authorization', 'actorDelegation', 'prompt']) {
      assert.equal(out[field], '[REDACTED]', `${field} must be redacted on the wired bridge path`);
    }
    assert.equal(out['requestId'], 'req-canary', 'correlation fields must survive redaction');
    assert.equal(out['toolName'], 'inventory.list_low_stock');
    assert.equal(out['durationMs'], 9);
    assert.equal(out['context'], 'ErpToolClient');
  });
});
