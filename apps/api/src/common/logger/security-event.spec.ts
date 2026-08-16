/**
 * L-14: named security events + proof the production alarm's coverage claim is real.
 *
 * The only production security alarm is created by infra/prod-ecs-express/deploy.sh with the
 * metric filter
 *   { ($.riskLevel = "CRITICAL") || ($.riskLevel = "HIGH")
 *     || ($.msg = "ai.provider.failure") || ($.msg = "ai.tool.invoke.denied") }
 * Before this change the last clause matched nothing: `ai.tool.invoke.denied` existed only as a
 * database audit action (audit/domain/models/audit-action.ts), never as a pino `msg`. The fix is
 * on the emitting side — the deploy script is deliberately not edited (a concurrent lane owns it
 * under M-16), so this test is what keeps the two sides honest.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { emitSecurityEvent, SECURITY_EVENT, type SecurityEventName } from './security-event';

const REPO_ROOT = join(__dirname, '../../../../..');
const DEPLOY_SCRIPT = join(REPO_ROOT, 'infra/prod-ecs-express/deploy.sh');

function collect(name: SecurityEventName, riskLevel: 'HIGH' | 'CRITICAL', fields?: Record<string, unknown>) {
  const lines: Array<Record<string, unknown>> = [];
  emitSecurityEvent({ warn: (obj) => void lines.push(obj) }, name, riskLevel, fields);
  return lines;
}

describe('emitSecurityEvent', () => {
  it('emits one line whose msg is the event name and whose riskLevel is root-level', () => {
    const [line, ...rest] = collect(SECURITY_EVENT.authRateLimitExceeded, 'HIGH', { clientIp: '203.0.113.9' });
    assert.equal(rest.length, 0, 'exactly one line per event');
    assert.equal(line?.['msg'], 'auth.rate_limit.exceeded');
    assert.equal(line?.['riskLevel'], 'HIGH', 'riskLevel must be root-level — the metric filter reads $.riskLevel');
    assert.equal(line?.['clientIp'], '203.0.113.9', 'caller fields ride along');
  });

  it('never lets a caller field overwrite msg or riskLevel', () => {
    const [line] = collect(SECURITY_EVENT.aiToolInvokeDenied, 'CRITICAL', { msg: 'spoofed', riskLevel: 'LOW' });
    assert.equal(line?.['msg'], 'ai.tool.invoke.denied');
    assert.equal(line?.['riskLevel'], 'CRITICAL');
  });

  it('never throws, even when the logger does', () => {
    assert.doesNotThrow(() =>
      emitSecurityEvent(
        {
          warn: () => {
            throw new Error('stream closed');
          },
        },
        SECURITY_EVENT.authLoginDenied,
        'HIGH',
      ),
    );
  });

  it('works with no fields at all', () => {
    const [line] = collect(SECURITY_EVENT.workflowWebhookBlocked, 'HIGH');
    assert.deepEqual(line, { msg: 'workflow.webhook.blocked', riskLevel: 'HIGH' });
  });

  it('every catalogued name is a stable dotted identifier', () => {
    for (const name of Object.values(SECURITY_EVENT)) {
      assert.match(name, /^[a-z0-9]+(\.[a-z0-9_]+)+$/, `${name} must be a dotted lowercase event name`);
    }
  });

  it('stays byte-identical to the AI Gateway copy (single-sided edits must fail here)', () => {
    const read = (path: string) => readFileSync(path, 'utf8');
    assert.equal(
      read(join(__dirname, 'security-event.ts')),
      read(join(__dirname, '../../../../ai-gateway/src/common/logger/security-event.ts')),
      'security-event.ts must be kept identical in apps/api and apps/ai-gateway',
    );
  });
});

// ── Static alarm-coverage guard ───────────────────────────────────────────────

/** Whitespace-tolerant so reformatting deploy.sh cannot break this test. */
function securityAlarmFilterLine(): string {
  const lines = readFileSync(DEPLOY_SCRIPT, 'utf8').split('\n');
  const filterNameIndex = lines.findIndex((line) => line.includes('--filter-name security-high-risk'));
  assert.ok(filterNameIndex >= 0, 'deploy.sh must still create the named security metric filter');
  const filterLine = lines.slice(filterNameIndex, filterNameIndex + 4)
    .find((line) => line.includes('--filter-pattern'));
  assert.ok(filterLine, 'security-high-risk must still declare a metric filter pattern');
  return filterLine;
}

function alarmMsgLiterals(): string[] {
  return [...securityAlarmFilterLine().matchAll(/\$\s*\.\s*msg\s*=\s*"([^"]+)"/g)]
    .map((match) => match[1]!);
}

function appSourceText(): string {
  const chunks: string[] = [];
  for (const app of readdirSync(join(REPO_ROOT, 'apps'), { withFileTypes: true })) {
    if (!app.isDirectory()) continue;
    const src = join(REPO_ROOT, 'apps', app.name, 'src');
    let entries: string[];
    try {
      entries = readdirSync(src, { recursive: true, encoding: 'utf8' });
    } catch {
      continue; // app has no src/
    }
    for (const entry of entries) {
      if (!/\.tsx?$/.test(entry) || entry.endsWith('.spec.ts') || entry.endsWith('.spec.tsx')) continue;
      chunks.push(readFileSync(join(src, entry), 'utf8'));
    }
  }
  return chunks.join('\n');
}

/** Argument text of every `emitSecurityEvent(...)` call, paren-balanced so a nested call cannot leak. */
function emitSecurityEventCallArgs(source: string): string[] {
  const calls: string[] = [];
  const opener = /emitSecurityEvent\s*\(/g;
  for (let match = opener.exec(source); match; match = opener.exec(source)) {
    let depth = 1;
    let i = match.index + match[0].length;
    for (; i < source.length && depth > 0; i++) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')') depth--;
    }
    calls.push(source.slice(match.index + match[0].length, i - 1));
  }
  return calls;
}

/**
 * Event names an alarm can actually observe in `$.msg`: a literal `msg:` at a call site, or a
 * `SECURITY_EVENT.<key>` genuinely *passed to* `emitSecurityEvent` (which sets `msg` to the
 * name — proven by the first suite in this file). Membership in the catalogue is deliberately
 * NOT enough: a declared-but-never-emitted name is exactly the regression this guard exists for.
 */
function emittedEventNames(source: string): Set<string> {
  const emitted = new Set<string>();
  for (const [, quote, literal] of source.matchAll(/\bmsg\s*:\s*(['"`])([\w.]+)\1/g)) {
    void quote;
    emitted.add(literal!);
  }
  for (const args of emitSecurityEventCallArgs(source)) {
    for (const [, key] of args.matchAll(/SECURITY_EVENT\s*\.\s*(\w+)/g)) {
      const name = (SECURITY_EVENT as Record<string, string>)[key!];
      if (name) emitted.add(name);
    }
  }
  return emitted;
}

describe('production security alarm coverage (infra/prod-ecs-express/deploy.sh)', () => {
  const literals = alarmMsgLiterals();
  const source = appSourceText();
  const emitted = emittedEventNames(source);

  it('still keys on riskLevel, so every emitSecurityEvent line is alarmed with no infra change', () => {
    const filterLine = securityAlarmFilterLine();
    for (const risk of ['CRITICAL', 'HIGH']) {
      assert.match(
        filterLine,
        new RegExp(`\\$\\s*\\.\\s*riskLevel\\s*=\\s*"${risk}"`),
        `the alarm must keep its $.riskLevel = "${risk}" clause`,
      );
    }
  });

  it('extracts the msg literals the alarm claims to watch', () => {
    assert.ok(literals.length >= 2, `expected msg clauses in the metric filter, got ${JSON.stringify(literals)}`);
    assert.ok(literals.includes('ai.tool.invoke.denied'), 'the regression this test exists for');
  });

  for (const literal of literals) {
    it(`"${literal}" is actually emitted by application code`, () => {
      assert.ok(
        emitted.has(literal),
        `deploy.sh alarms on $.msg = "${literal}" but nothing under apps/*/src emits it. ` +
          'Add the emit, or the alarm clause is decoration.',
      );
    });
  }

  it('the emitter is wired to real call sites, not just declared', () => {
    assert.ok(emitSecurityEventCallArgs(source).length > 0, 'emitSecurityEvent must be called from production code');
  });

  it('stays one-directional: a catalogued event may be log-only and absent from the filter', () => {
    // Every `$.msg` literal in the filter must have an emit — not the converse. Some events are
    // deliberately log-only (e.g. `api.rate_limit.store_degraded`, alarmed via `$.riskLevel`),
    // and requiring them in the filter would fail this suite for no security reason.
    const notInFilter = Object.values(SECURITY_EVENT).filter((name) => !literals.includes(name));
    assert.ok(notInFilter.length > 0, 'baseline: the catalogue is broader than the msg clauses');
    for (const name of notInFilter) assert.ok(!literals.includes(name));
  });

  it('goes red when the emit is deleted — a catalogue entry alone is not coverage', () => {
    // Exactly the regression this guard exists for: `ai.tool.invoke.denied` stays in
    // SECURITY_EVENT and in AuditAction, but nothing writes it to the log stream any more.
    const withoutEmit = source.replace(/emitSecurityEvent\s*\(/g, 'noAlarmHere(');
    assert.ok(emitted.has('ai.tool.invoke.denied'), 'baseline: the emit exists today');
    assert.ok(
      !emittedEventNames(withoutEmit).has('ai.tool.invoke.denied'),
      'removing every emitSecurityEvent call must make this guard fail, not pass on the catalogue',
    );
  });
});
