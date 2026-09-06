import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { LINE_OPEN_APPLICATION_STATES } from './company-signup.logic';
import {
  lineExternalSignupId,
  normalizeLineCompanyName,
  normalizeReferralCode,
  normalizeThaiMobile,
  requireThaiMobile,
} from './line-signup.logic';

describe('normalizeThaiMobile', () => {
  it('accepts 10 digits starting 0, however the owner typed the separators', () => {
    for (const input of ['0812345678', '081-234-5678', '081 234 5678', ' 0812345678 ']) {
      assert.equal(normalizeThaiMobile(input), '0812345678', input);
    }
  });

  // Still optional-tolerant: `account-profile` uses a blank value to CLEAR a stored number, so this
  // one must keep answering null rather than throwing. The LIFF form goes through requireThaiMobile.
  it('treats blank as the legitimate answer it is for the profile screen', () => {
    for (const input of [undefined, null, '', '   ', '--']) {
      assert.equal(normalizeThaiMobile(input), null, String(input));
    }
  });

  it('refuses anything that is not a Thai mobile', () => {
    for (const input of ['12345', '812345678', '08123456789', '0212345678123']) {
      assert.throws(() => normalizeThaiMobile(input), /invalid_phoneNumber/, input);
    }
    // A landline-shaped number starting 0 with 9 digits is still not 10 digits.
    assert.throws(() => normalizeThaiMobile('021234567'), /invalid_phoneNumber/);
  });
});

// Owner 2026-09-05: the LIFF form's phone field became required, and the page needs to tell the two
// outcomes apart only far enough to print one sentence — so blank and wrong carry separate codes.
describe('requireThaiMobile', () => {
  it('accepts the same numbers, normalised the same way', () => {
    for (const input of ['0812345678', '081-234-5678', '081 234 5678', ' 0812345678 ']) {
      assert.equal(requireThaiMobile(input), '0812345678', input);
    }
  });

  it('refuses blank with line_signup_phone_required', () => {
    for (const input of [undefined, null, '', '   ', '--']) {
      assert.throws(() => requireThaiMobile(input), /^Error: line_signup_phone_required$/, String(input));
    }
  });

  it('refuses a number that is not a Thai mobile with line_signup_phone_invalid', () => {
    for (const input of ['12345', '812345678', '08123456789', '021234567']) {
      assert.throws(() => requireThaiMobile(input), /^Error: line_signup_phone_invalid$/, input);
    }
  });
});

describe('normalizeLineCompanyName and normalizeReferralCode', () => {
  it('trims a shop name and bounds it at 120 characters', () => {
    assert.equal(normalizeLineCompanyName('  ร้านมั่งมี  '), 'ร้านมั่งมี');
    assert.equal(normalizeLineCompanyName('ก'.repeat(120)).length, 120);
    assert.throws(() => normalizeLineCompanyName('ก'.repeat(121)), /invalid_companyName/);
    assert.throws(() => normalizeLineCompanyName('   '), /invalid_companyName/);
  });

  it('keeps a referral code to the shape a QR can carry, and blank means none', () => {
    assert.equal(normalizeReferralCode('INFLU-01'), 'INFLU-01');
    assert.equal(normalizeReferralCode('  '), null);
    assert.equal(normalizeReferralCode(undefined), null);
    assert.throws(() => normalizeReferralCode('drop table;'), /invalid_referralCode/);
  });
});

describe('lineExternalSignupId', () => {
  it('is minted from the verified identity, in the documented order', () => {
    const id = lineExternalSignupId('channel-1', 'Uline-1', '0f9b1d2e-3c4a-4b5c-8d7e-1f2a3b4c5d6e');
    assert.equal(id, 'line:channel-1:Uline-1:0f9b1d2e-3c4a-4b5c-8d7e-1f2a3b4c5d6e');
    // The column is bounded at 128; a real channel id, LINE user id and uuid stay far inside it.
    assert.ok(lineExternalSignupId('1234567890', `U${'a'.repeat(32)}`, 'x'.repeat(36)).length < 128);
  });
});

// Review HIGH-2/B-05. The open-application fence is a partial unique index, which Prisma cannot
// express — so the states it covers live in SQL and are mirrored in TypeScript. A state present in
// one and missing from the other is the whole bug: a re-submit opens a SECOND application, and for
// a half-committed provisioning (the ExternalIdentity already exists) a SECOND company.
describe('the open-application index and LINE_OPEN_APPLICATION_STATES agree', () => {
  const migration = readFileSync(
    join(__dirname, '../../../../prisma/migrations/20260904120000_line_first_signup/migration.sql'),
    'utf8',
  );

  it('lists exactly the same states in the same set', () => {
    const where = /CompanySignupRequest_line_open_key"[\s\S]*?WHERE "state" IN \(([^)]*)\)/.exec(migration);
    assert.ok(where, 'the partial unique index must exist in the migration');
    const inSql = where![1]!.split(',').map((s) => s.trim().replace(/'/g, '')).sort();
    assert.deepEqual(inSql, [...LINE_OPEN_APPLICATION_STATES].sort());
  });

  it('treats a failed provisioning as still open, because it is recoverable', () => {
    assert.ok(LINE_OPEN_APPLICATION_STATES.includes('PROVISIONING_FAILED'));
    // Settled states must NOT fence the account: the customer may open a second shop later.
    for (const settled of ['COMPLETED', 'REJECTED', 'SUSPENDED'] as const) {
      assert.equal(LINE_OPEN_APPLICATION_STATES.includes(settled), false, settled);
    }
  });
});

// DATA-MIN-01 / review SEC-07. The rule is enforced by ABSENCE, and absence is exactly what a
// future edit can quietly undo — so it is checked against the schema and the migrations themselves.
describe('DATA-MIN-01: no LINE profile picture is ever stored', () => {
  const prismaDir = join(__dirname, '../../../../prisma');
  /** Prose about the rule is not a breach of it, so comment lines are dropped before matching. */
  const code = (source: string, commentPrefix: string) => source
    .split('\n')
    .filter((line) => !line.trim().startsWith(commentPrefix) && !line.trim().startsWith('///'))
    .join('\n');

  it('has no picture, avatar or photo column on the signup request', () => {
    const schema = readFileSync(join(prismaDir, 'schema.prisma'), 'utf8');
    const model = schema.slice(schema.indexOf('model CompanySignupRequest'));
    const body = code(model.slice(0, model.indexOf('\n}')), '//');
    assert.doesNotMatch(body, /picture|avatar|photo|imageUrl/i, 'DATA-MIN-01 forbids a picture column');
    // The fields the spec DOES allow are all here, so this is a real check and not a typo passing.
    for (const field of ['lineProviderUserId', 'lineChannelId', 'lineDisplayName']) {
      assert.match(body, new RegExp(field), field);
    }
  });

  it('never introduced one in a migration either', () => {
    for (const dir of readdirSync(join(prismaDir, 'migrations'), { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const sql = code(readFileSync(join(prismaDir, 'migrations', dir.name, 'migration.sql'), 'utf8'), '--');
      for (const statement of sql.split(';')) {
        if (!/CompanySignupRequest/.test(statement)) continue;
        assert.doesNotMatch(statement, /picture|avatar|photo/i, `${dir.name} adds a picture column`);
      }
    }
  });
});
