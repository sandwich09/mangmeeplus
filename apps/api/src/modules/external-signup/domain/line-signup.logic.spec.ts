import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  lineExternalSignupId,
  normalizeLineCompanyName,
  normalizeReferralCode,
  normalizeThaiMobile,
} from './line-signup.logic';

describe('normalizeThaiMobile', () => {
  it('accepts 10 digits starting 0, however the owner typed the separators', () => {
    for (const input of ['0812345678', '081-234-5678', '081 234 5678', ' 0812345678 ']) {
      assert.equal(normalizeThaiMobile(input), '0812345678', input);
    }
  });

  it('treats blank as the legitimate answer it is — the field is optional', () => {
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
