import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// Every page AND the module that writes their copy — the price used to live in a constant the page
// only referenced by name, so scanning the markup alone would have said the offer was gone.
const dir = fileURLToPath(new URL('.', import.meta.url));

/** Comments explain why copy changed and are not rendered; only what ships is scanned. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const pages = readdirSync(dir)
  .filter((name) => (name.endsWith('.tsx') || name.endsWith('.ts')) && !name.includes('.spec.'))
  .map((name) => ({
    name,
    source: withoutComments(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')),
  }));

test('the public signup journey has pages to check', () => {
  // Guards the two scans below: a glob that matches nothing passes every assertion in it.
  assert.ok(pages.length >= 4, `only found ${pages.map((p) => p.name).join(', ')}`);
});

// Owner 2026-09-05: self-signup no longer sells a tier, and since 2026-09-20 it sells no trial
// either — the pages name the starter price and nothing else. A PRO tier name or its ฿999 on any
// of these pages is an offer the product stopped making.
test('no signup page names the retired PRO offer', () => {
  for (const { name, source } of pages) {
    assert.doesNotMatch(source, /999/, `${name} still quotes a price`);
    assert.doesNotMatch(source, /\bPRO\b/, `${name} still names the PRO tier`);
  }
});

// A "+" reads as part of a phone number or as broken markup on a Thai screen; Owner rule for every
// customer-facing string in this journey.
test('no signup page renders a "+" in customer copy', () => {
  for (const { name, source } of pages) {
    for (const [, thai] of source.matchAll(/>([^<>{}]*[฀-๿][^<>{}]*)</g)) {
      assert.doesNotMatch(thai, /\+/, `${name}: ${thai.trim()}`);
    }
  }
});


test('PWS-WELCOME-D welcome describes expense records without automatic accounting', () => {
  const welcome = pages.find(page => page.name === 'SignupWelcomePage.tsx')!.source;
  assert.match(welcome, /ใช้มั่งมีพลัสบันทึกรายจ่ายและเก็บใบเสร็จให้ค้นหาได้ง่าย/);
  assert.doesNotMatch(welcome, /ระบบลงบัญชีให้/);
});
