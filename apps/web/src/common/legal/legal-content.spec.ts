import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { CURRENT_LEGAL_DOCUMENTS } from '@watchdog-bms/contracts';
import {
  LEGAL_EFFECTIVE_DATE,
  LEGAL_NAV_ITEMS,
  LEGAL_OPERATOR,
  LEGAL_SOURCES,
  REQUIRED_MARKETING_OPT_OUT_KEYWORDS,
} from './legal-content';

test('publishes one consistent MangmeePlus legal identity and all public notices', () => {
  assert.equal(LEGAL_OPERATOR.tradeName, 'MangmeePlus');
  assert.equal(LEGAL_OPERATOR.legalName, 'บริษัท มั่งมียั่งยืน จำกัด');
  assert.match(LEGAL_OPERATOR.registrationNumber, /^\d{13}$/);
  assert.match(LEGAL_OPERATOR.privacyEmail, /@mangmeeplus\.com$/);
  assert.ok(LEGAL_OPERATOR.contactAddress.includes('กรุงเทพมหานคร'));
  assert.equal(LEGAL_OPERATOR.supportEmail, LEGAL_OPERATOR.privacyEmail);
  assert.deepEqual(LEGAL_NAV_ITEMS.map(({ href }) => href), [
    '/privacy',
    '/terms',
    '/data-deletion',
  ]);
});

test('keeps public copy aligned with implemented marketing opt-out keywords', () => {
  assert.deepEqual(REQUIRED_MARKETING_OPT_OUT_KEYWORDS, [
    'ยกเลิกข่าวสาร',
    'หยุดโปร',
    'STOP',
  ]);
});

test('links to official Thai legal materials and carries an explicit effective date', () => {
  assert.equal(LEGAL_EFFECTIVE_DATE, '9 สิงหาคม 2569');
  for (const href of [
    LEGAL_SOURCES.pdpaAct,
    LEGAL_SOURCES.pdpaRules,
    LEGAL_SOURCES.pdpaErasureRule,
    LEGAL_SOURCES.crossBorderSection28,
    LEGAL_SOURCES.crossBorderSection29,
    LEGAL_SOURCES.accountingAct,
    LEGAL_SOURCES.revenueCodeVat,
    LEGAL_SOURCES.electronicTransactions,
    LEGAL_SOURCES.pdpcOffice,
    LEGAL_SOURCES.companyRegistryService,
  ]) {
    assert.match(href, /^https:\/\//);
  }
});

test('immutable release URLs serve the exact bytes recorded in the contract', () => {
  const repositoryRoot = fileURLToPath(new URL('../../../../../', import.meta.url));
  for (const [document, release] of Object.entries(CURRENT_LEGAL_DOCUMENTS)) {
    const artifactBytes = readFileSync(`${repositoryRoot}/apps/web/public${release.href}`);
    const html = artifactBytes.toString('utf8');

    assert.equal(createHash('sha256').update(artifactBytes).digest('hex'), release.artifactSha256);
    assert.equal(release.releaseFingerprintSha256, release.artifactSha256);
    assert.match(html, /^<!doctype html>\n<html lang="th">/);
    assert.ok(html.includes(`<meta name="mangmeeplus-legal-version" content="${release.version}">`));
    assert.ok(html.includes('<meta name="robots" content="noindex,follow">'));
    assert.ok(html.includes(LEGAL_OPERATOR.legalName));
    assert.ok(html.includes(document === 'terms'
      ? '12. กฎหมายที่ใช้ ข้อพิพาท การแก้ไข และการติดต่อ'
      : 'แหล่งกฎหมายทางการที่ใช้อ้างอิง'));
    assert.ok(!html.includes('<script'), 'immutable artifacts must not depend on mutable JavaScript bundles');
  }
});
