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
    // v3 is the released edition and its bytes are frozen from here: nothing may move them
    // again, because this hash is what the append-only acceptance evidence records and what
    // the gate shows the signer. The pin below duplicates CURRENT_LEGAL_DOCUMENTS on purpose —
    // that constant is *expected* to move when a new version is cut, this one is not, so a
    // re-cut of v3 fails here even if the contract was updated to match it.
    'v3/terms-th.html': '4d21b7b5c98171d0ae7ca34ccf93c215304822bd512af11c63993a8f13fbe8ed',
    'v3/privacy-th.html': 'cd86af5ede65d5bcdd9be9910da5382b8ad2a07bb8e2eb29b148062150709fc7',
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
  assert.doesNotMatch(acceptancePage, /Business &amp; Accounting Assistant/);
});
