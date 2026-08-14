import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { CURRENT_LEGAL_DOCUMENTS } from '@watchdog-bms/contracts';
import {
  LEGAL_EFFECTIVE_DATE,
  LEGAL_LAST_UPDATED,
  LEGAL_NAV_ITEMS,
  LEGAL_OPERATOR,
  LEGAL_SOURCES,
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

test('links to official Thai legal materials and carries an explicit effective date', () => {
  assert.equal(LEGAL_EFFECTIVE_DATE, '14 สิงหาคม 2569');
  assert.equal(LEGAL_LAST_UPDATED, '14 สิงหาคม 2569');
  for (const href of [
    LEGAL_SOURCES.pdpaAct,
    LEGAL_SOURCES.pdpaRules,
    LEGAL_SOURCES.pdpaErasureRule,
    LEGAL_SOURCES.pdpaAccessRule,
    LEGAL_SOURCES.crossBorderSection28,
    LEGAL_SOURCES.crossBorderSection29,
    LEGAL_SOURCES.pdpcOffice,
  ]) {
    assert.match(href, /^https:\/\//);
  }
});

test('preserves the exact historical artifacts after publishing the official first edition', () => {
  const repositoryRoot = fileURLToPath(new URL('../../../../../', import.meta.url));
  const historicalHashes = {
    'v1/terms-th.html': 'd1de74bdef45404d1c8b0e2f8d3d93c31ffd612ccea4d9ee90dcc1b4c35184c7',
    'v1/privacy-th.html': '7b274807143af68ee51fa7bc3ec71174206a810eb9ff0de209ee81c10cb874a4',
    'v2/terms-th.html': '09fe321666d7fd554544a7cf3c9a7e1c192e71a5ff47fb1c98bbc1c165d63281',
    'v2/privacy-th.html': '5edcb642f8e9ca8e736804d0a732979228822f8183fa602afb4de5e372a67efd',
    // v3 is the released edition and its bytes are frozen: these are the values it was first
    // published with, and the owner's instruction is that they never move. A restyle of the
    // legal pages does NOT move them on its own — the artifacts are static checked-in files
    // that no build step regenerates — but re-running the generator over v3 would, and this
    // pin is what stops that landing. It duplicates CURRENT_LEGAL_DOCUMENTS on purpose: that
    // constant is expected to move when a genuinely new version is cut, this one is not, so a
    // re-cut of v3 fails here even if the contract was updated to match the new bytes.
    // A restyled full document therefore has to wait for v4; it cannot be slipped into v3.
    'v3/terms-th.html': '67757a8237de6cd962a7325300d2bbd9a0649f1f273aa1c4972beb1155c1c05a',
    'v3/privacy-th.html': '1e224b9f5f8830a22fe10edb840fd8e01edeaafcd69862a28f1beda59c43b87d',
  } as const;

  for (const [file, expectedHash] of Object.entries(historicalHashes)) {
    const bytes = readFileSync(`${repositoryRoot}/apps/web/public/legal/releases/${file}`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedHash);
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
      ? '9. กฎหมายที่ใช้ การแก้ไข และการติดต่อ'
      : 'แหล่งกฎหมายทางการที่ใช้อ้างอิง'));
    assert.ok(!html.includes('<script'), 'immutable artifacts must not depend on mutable JavaScript bundles');
  }
});

test('publishes the declared official-version-1 scope without deferred or unproven provider claims', () => {
  const repositoryRoot = fileURLToPath(new URL('../../../../../', import.meta.url));
  const privacy = readFileSync(`${repositoryRoot}/apps/web/app/privacy/page.tsx`, 'utf8');
  const terms = readFileSync(`${repositoryRoot}/apps/web/app/terms/page.tsx`, 'utf8');
  const deletion = readFileSync(`${repositoryRoot}/apps/web/app/data-deletion/page.tsx`, 'utf8');
  const publicPages = [privacy, terms, deletion].join('\n');

  for (const launchScope of [/พนักงาน/, /ใบเสร็จ/, /\bLINE\b/, /\bOCR\b/, /\bAI\b/]) {
    assert.match(publicPages, launchScope);
  }
  assert.match(publicPages, /CRM[^\n]+ไม่อยู่ในขอบเขต/);
  assert.match(privacy, /ไม่ใช่การอนุมัติ การบันทึกบัญชี การยื่นภาษี/);
  assert.match(privacy, /เว้นแต่และเท่าที่กฎหมายที่มีผลใช้บังคับอนุญาต/);
  assert.match(deletion, /โดยไม่ชักช้าและไม่เกิน 90 วัน/);
  assert.match(deletion, /โดยไม่ชักช้าและไม่เกิน 30 วัน/);
  assert.match(deletion, /ข้อจำกัดของระบบหรือผู้ให้บริการไม่ทำให้ขยายเวลาโดยอัตโนมัติ/);
  assert.match(deletion, /หนังสือรับรองนิติบุคคลฉบับปัจจุบัน/);
  assert.match(deletion, /การเปลี่ยนสถานะรายการในฐานข้อมูลไม่ใช่หลักฐานว่าลบเสร็จทั้งหมด/);

  for (const unprovenClaim of [
    /\bTyphoon\b/i,
    /\bBedrock\b/i,
    /\bOpenAI\b/i,
    /soft[- ]delete.{0,30}30 วัน/i,
    /ลบถาวรทั้งหมด/,
    /กู้ระบบ.{0,60}สถานะการลบกลับมามีผล/,
  ]) {
    assert.doesNotMatch(publicPages, unprovenClaim);
  }
});

test('keeps login and acceptance links aligned with the current public and immutable documents', () => {
  const repositoryRoot = fileURLToPath(new URL('../../../../../', import.meta.url));
  const loginPage = readFileSync(`${repositoryRoot}/apps/web/src/features/auth/LoginPage.tsx`, 'utf8');
  const acceptancePage = readFileSync(`${repositoryRoot}/apps/web/src/features/auth/LegalAcceptancePage.tsx`, 'utf8');

  for (const href of ['/privacy', '/terms', '/data-deletion']) {
    assert.ok(loginPage.includes(`href="${href}"`));
    assert.ok(acceptancePage.includes(`href="${href}"`));
  }
  assert.match(acceptancePage, /status\.terms\.href/);
  assert.match(acceptancePage, /status\.privacy\.href/);
  assert.match(acceptancePage, /ใช้กับบัญชีของคุณทุกกิจการ/);
  assert.match(acceptancePage, /เฉพาะเมื่อเอกสารออกฉบับใหม่/);
  assert.match(acceptancePage, /await refreshSessionSilently\(\)[\s\S]*window\.location\.assign\(returnTo\)/);
  assert.doesNotMatch(acceptancePage, /void refreshSessionSilently\(\)/);
  assert.doesNotMatch(acceptancePage, /Business &amp; Accounting Assistant/);
});
