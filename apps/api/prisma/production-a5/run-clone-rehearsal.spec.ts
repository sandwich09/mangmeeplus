import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sha256, stableJson } from '../../src/scripts/a5-readonly-evidence.logic';
import {
  PRODUCTION_A5_REIMBURSEMENT_COMMAND,
  chunkCloneResult,
  exactCandidateSet,
  reimbursementCompatibilityFromOutput,
  strictCloneUrlFromPgEnvironment,
} from './run-clone-rehearsal';

describe('production A5 clone rehearsal runner boundary', () => {
  it('derives the reviewed candidate from repository-minus-applied, not ledger position', () => {
    const files = [
      { name: '20260101000000_first', fileSha256: '1'.repeat(64), sqlBytes: 'SELECT 1' },
      { name: '20260102000000_second', fileSha256: '2'.repeat(64), sqlBytes: 'SELECT 2' },
      { name: '20260103000000_third', fileSha256: '3'.repeat(64), sqlBytes: 'SELECT 3' },
    ];
    const source = [{
      name: files[1]!.name, checksum: files[1]!.fileSha256, appliedOrder: 1,
    }];
    assert.doesNotThrow(() => exactCandidateSet(
      source, files, [files[0]!.name, files[2]!.name],
    ));
    assert.throws(() => exactCandidateSet(source, files, [files[2]!.name, files[0]!.name]),
      /pending_set_not_exactly_reviewed/);
    assert.throws(() => exactCandidateSet(
      [{ ...source[0]!, checksum: 'f'.repeat(64) }], files, [files[0]!.name, files[2]!.name],
    ), /source_migration_ledger_mismatch/);
  });

  it('records the exact offline direct-binary reimbursement command', () => {
    assert.equal(
      PRODUCTION_A5_REIMBURSEMENT_COMMAND,
      'cd /app/apps/api && REIMBURSEMENT_PG_GATE_REQUIRED=true '
      + '/app/node_modules/.bin/tsx --test --test-reporter=spec '
      + 'src/scripts/production-a5-reimbursement-compatibility.pg.spec.ts '
      + 'src/modules/reimbursements/infrastructure/'
      + 'prisma-reimbursement.repository.draft-submit-race.spec.ts',
    );
    assert.doesNotMatch(PRODUCTION_A5_REIMBURSEMENT_COMMAND, /\bpnpm\b/);
  });

  it('binds only the exact isolated RDS clone host and forces TLS/timeouts', () => {
    const host = 'watchdog-a5-clone-7001-a1-abcdef12.cpqecgikiwrq.ap-southeast-1.rds.amazonaws.com';
    const result = new URL(strictCloneUrlFromPgEnvironment({
      PGHOST: host, PGPORT: '5432', PGUSER: 'clone_user', PGPASSWORD: 'secret',
      PGDATABASE: 'watchdog',
    }, host));
    assert.equal(result.hostname, host);
    assert.equal(result.searchParams.get('sslmode'), 'verify-full');
    assert.equal(result.searchParams.get('sslrootcert'), '/etc/ssl/certs/aws-rds-global-bundle.pem');
    assert.equal(result.searchParams.get('options'), '-c lock_timeout=2000ms -c statement_timeout=300000ms');
    assert.throws(() => strictCloneUrlFromPgEnvironment({
      PGHOST: 'watchdog-bms-prod-db.cpqecgikiwrq.ap-southeast-1.rds.amazonaws.com',
      PGPORT: '5432', PGUSER: 'prod', PGPASSWORD: 'secret', PGDATABASE: 'watchdog',
    }, 'watchdog-bms-prod-db.cpqecgikiwrq.ap-southeast-1.rds.amazonaws.com'), /database_host_invalid/);
    assert.throws(() => strictCloneUrlFromPgEnvironment({
      PGHOST: host, PGPORT: '5432', PGUSER: 'clone_user', PGPASSWORD: 'secret',
      PGDATABASE: 'watchdog?host=prod',
    }, host), /database_identity_invalid/);
  });

  it('accepts only the exact required thirteen-test/two-suite reimbursement summary', () => {
    const stdout = Buffer.from('ℹ tests 13\nℹ suites 2\nℹ pass 13\nℹ fail 0\nℹ skipped 0\n');
    const stderr = Buffer.from('');
    assert.deepEqual(reimbursementCompatibilityFromOutput(stdout, stderr), {
      command: PRODUCTION_A5_REIMBURSEMENT_COMMAND,
      commandSha256: sha256(PRODUCTION_A5_REIMBURSEMENT_COMMAND),
      combinedOutputSha256: sha256(Buffer.concat([stdout, stderr])),
      databaseUrlBinding: 'DATABASE_URL',
      requiredGate: 'REIMBURSEMENT_PG_GATE_REQUIRED=true',
      suites: 2,
      tests: 13,
      pass: 13,
      skipped: 0,
      status: 'PASSED',
    });
    assert.throws(() => reimbursementCompatibilityFromOutput(
      Buffer.from('ℹ tests 10\nℹ suites 2\nℹ pass 10\nℹ fail 0\nℹ skipped 0\n'),
      Buffer.alloc(0),
    ), /summary_invalid/);
    assert.throws(() => reimbursementCompatibilityFromOutput(
      Buffer.from('ℹ tests 13\nℹ suites 2\nℹ pass 12\nℹ fail 0\nℹ skipped 1\n'),
      Buffer.alloc(0),
    ), /summary_invalid/);
  });

  it('emits reconstructable bounded aggregate-only result chunks bound to one SHA-256', () => {
    const result = { schemaVersion: 1, catalog: 'x'.repeat(80_000) };
    const lines = chunkCloneResult(result);
    assert.ok(lines.length > 1);
    const parsed = lines.map((line) => {
      const match = /^A5_CLONE_RESULT (\d+)\/(\d+) ([0-9a-f]{64}) ([A-Za-z0-9+/=]+)$/.exec(line);
      assert.ok(match);
      return { index: Number(match[1]), total: Number(match[2]), digest: match[3]!, chunk: match[4]! };
    });
    assert.ok(parsed.every((row) => row.total === lines.length && row.digest === parsed[0]!.digest));
    const bytes = Buffer.from(parsed.sort((a, b) => a.index - b.index).map((row) => row.chunk).join(''), 'base64');
    assert.equal(sha256(bytes), parsed[0]!.digest);
    assert.equal(bytes.toString('utf8'), `${stableJson(result)}\n`);
  });
});
