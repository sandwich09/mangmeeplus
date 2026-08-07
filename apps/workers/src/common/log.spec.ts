/**
 * L-09: workers stopped writing unredacted `console.*` job payloads.
 * Proves the local helper redacts deeply (same shared redactor as the API/AI Gateway) and
 * honours LOG_LEVEL, which the workers config parsed but never read.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { FATAL_DETAIL_LIMIT, fatalDetail, workerLog } from './log.js';

const originalEnv = { ...process.env };
let written: Array<{ channel: 'log' | 'warn' | 'error'; line: string }> = [];
const realConsole = { log: console.log, warn: console.warn, error: console.error };

beforeEach(() => {
  written = [];
  console.log = (line: string) => void written.push({ channel: 'log', line });
  console.warn = (line: string) => void written.push({ channel: 'warn', line });
  console.error = (line: string) => void written.push({ channel: 'error', line });
});

afterEach(() => {
  Object.assign(console, realConsole);
  process.env = { ...originalEnv };
});

const last = () => JSON.parse(written[written.length - 1]?.line ?? '{}') as Record<string, unknown>;

describe('workerLog', () => {
  it('redacts a whole job payload, including nested credentials', () => {
    // The real leak: `unknown_job_kind` / `unknown_workflow_job_kind` dumped `payload` verbatim.
    workerLog('warn', {
      event: 'unknown_job_kind',
      payload: { kind: 'x', context: { accessToken: 'at-1', customer: { phone: '0812345678' } } },
    });
    const payload = last()['payload'] as Record<string, unknown>;
    const context = payload['context'] as Record<string, unknown>;
    assert.equal(context['accessToken'], '[REDACTED]');
    assert.equal((context['customer'] as Record<string, unknown>)['phone'], '[REDACTED]');
    assert.equal(last()['event'], 'unknown_job_kind', 'the event name must survive redaction');
  });

  it('scrubs credentials embedded in an error string', () => {
    workerLog('error', { event: 'workflow_job_failed', error: "connect ECONNREFUSED redis://user:pw@cache:6379" });
    assert.equal(last()['error'], 'connect ECONNREFUSED redis://[REDACTED]@cache:6379');
  });

  it('honours LOG_LEVEL', () => {
    process.env['LOG_LEVEL'] = 'error';
    workerLog('info', { event: 'workers_heartbeat' });
    workerLog('warn', { event: 'unknown_job_kind' });
    assert.equal(written.length, 0, 'below-threshold lines must not be emitted');
    workerLog('error', { event: 'workflow_job_failed' });
    assert.equal(written.length, 1);
  });

  it('defaults to info when LOG_LEVEL is unset or invalid', () => {
    delete process.env['LOG_LEVEL'];
    workerLog('debug', { event: 'noise' });
    assert.equal(written.length, 0);
    process.env['LOG_LEVEL'] = 'nonsense';
    workerLog('info', { event: 'workers_heartbeat' });
    assert.equal(written.length, 1);
  });

  it('routes level to the matching console channel and stamps level/service/time', () => {
    process.env['SERVICE_NAME'] = 'watchdog-workers-test';
    workerLog('error', { event: 'boom' });
    assert.equal(written[written.length - 1]?.channel, 'error');
    workerLog('warn', { event: 'meh' });
    assert.equal(written[written.length - 1]?.channel, 'warn');
    workerLog('info', { event: 'fine' });
    assert.equal(written[written.length - 1]?.channel, 'log');
    const out = last();
    assert.equal(out['level'], 'info');
    assert.equal(out['service'], 'watchdog-workers-test');
    assert.ok(typeof out['time'] === 'string' && !Number.isNaN(Date.parse(out['time'] as string)));
  });

  it('LOG_REDACTION_ENABLED=false is an honest opt-out', () => {
    process.env['LOG_REDACTION_ENABLED'] = 'false';
    workerLog('info', { event: 'raw', accessToken: 'visible' });
    assert.equal(last()['accessToken'], 'visible');
  });
});

describe('fatalDetail', () => {
  it('drops the Lua script BullMQ hangs off a Redis OOM error', () => {
    // Shape of the real crash: a short message with the whole stalled-jobs script attached.
    const err = Object.assign(new Error("OOM command not allowed when used memory > 'maxmemory'"), {
      command: { name: 'eval', args: ['-- Move stalled jobs to wait.\nlocal rcall = redis.call\n'.repeat(20_000)] },
    });
    const detail = fatalDetail(err);
    assert.ok(detail.includes('OOM command not allowed'), 'the reason must survive');
    assert.ok(!detail.includes('Move stalled jobs'), 'the attached script must never reach the log');
  });

  it('bounds an oversized detail instead of streaming it to CloudWatch', () => {
    const detail = fatalDetail(new Error('x'.repeat(50_000)));
    assert.ok(detail.length <= FATAL_DETAIL_LIMIT + 20, `unbounded fatal detail: ${detail.length} chars`);
    assert.ok(detail.endsWith('[truncated]'));
  });

  it('survives a rejection that is not an Error', () => {
    assert.equal(fatalDetail('redis gone'), 'redis gone');
  });
});
