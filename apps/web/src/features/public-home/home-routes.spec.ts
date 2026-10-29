import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { GET as summary } from '../../../app/llms.txt/route';
import { GET as full } from '../../../app/llms-full.txt/route';
import { robotsFor } from '../../../app/robots';
import sitemap from '../../../app/sitemap';
import { HOME_PLANS, HOME_SOCIAL, HOME_TITLE, HOME_DESCRIPTION } from './home-content';
import { isProtectedPagePath } from '../../common/auth/middleware.logic';

for (const [name, route] of [['llms.txt', summary], ['llms-full.txt', full]] as const) test(`HOME-PAGE ${name} is a public cacheable bilingual plain-text wiki`, async () => {
  const response = route();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.match(response.headers.get('cache-control')!, /public/);
  assert.equal(response.headers.has('set-cookie'), false);
  const body = await response.text();
  assert.match(body, /มั่งมีพลัส/); assert.match(body, /MangmeePlus/);
  for (const alias of ['มั่งมี Plus', 'มั่งมี-Plus', 'mangmee_plus']) assert.ok(body.includes(alias), alias);
  for (const url of HOME_SOCIAL) assert.ok(body.includes(url), url);
  assert.match(body, /https:\/\/mangmeeplus\.com\/privacy/);
  assert.match(body, /https:\/\/mangmeeplus\.com\/terms/);
  assert.doesNotMatch(body, /official\.mangmeeplus\.com/);
  assert.equal(isProtectedPagePath(`/${name}`), false);
  for (const p of HOME_PLANS) {
    assert.ok(body.includes(`${p.monthlyPrice.toLocaleString('en-US')} บาท/เดือน`));
    assert.ok(body.includes(`THB ${p.monthlyPrice.toLocaleString('en-US')}/month`));
    assert.ok(body.includes(`${p.annualPrice.toLocaleString('en-US')} บาท/ปี`));
    if (name === 'llms-full.txt') assert.ok(body.includes(`${p.users} users including the owner; ${p.branches} branches`));
  }
});

test('HOME-PAGE robots explicitly admits search/AI crawlers and keeps private application areas out', () => {
  const config = robotsFor('production'), rules = config.rules as Array<{ userAgent: string[]; allow: string[]; disallow: string[] }>;
  for (const agent of ['*', 'GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended', 'OAI-SearchBot', 'CCBot']) assert.ok(rules[0]!.userAgent.includes(agent));
  for (const path of ['/$', '/privacy', '/terms', '/llms.txt', '/llms-full.txt']) assert.ok(rules[0]!.allow.includes(path));
  for (const path of ['/companies', '/api', '/system', '/sales', '/login', '/billing', '/account']) assert.ok(rules[0]!.disallow.includes(path));
  assert.equal(config.sitemap, 'https://mangmeeplus.com/sitemap.xml');
});

test('HOME-PAGE robots: UAT and local are never indexed', () => {
  for (const environment of ['uat', undefined, 'local']) assert.deepEqual(robotsFor(environment), { rules: [{ userAgent: '*', disallow: '/' }] });
});

test('HOME-PAGE sitemap contains only the public home, legal and AI-readable routes', () => {
  assert.deepEqual(sitemap().map(item => item.url), ['', 'privacy', 'terms', 'llms.txt', 'llms-full.txt'].map(path => `https://mangmeeplus.com/${path}`));
});

test('HOME-PAGE preserves nonce rendering and public access, with brand and company SEO copy scoped to the root', () => {
  assert.equal(isProtectedPagePath('/'), false);
  assert.equal(isProtectedPagePath('/companies/shop/dashboard'), true);
  const page = readFileSync(new URL('../../../app/page.tsx', import.meta.url), 'utf8');
  const layout = readFileSync(new URL('../../../app/layout.tsx', import.meta.url), 'utf8');
  assert.match(page, /\(await headers\(\)\)\.get\('x-nonce'\)/);
  assert.match(page, /HomeStructuredData nonce=\{nonce\}/);
  assert.match(page, /'text\/plain': '\/llms.txt'/);
  assert.match(page, /openGraph:/); assert.match(page, /twitter:/);
  assert.match(layout, /await connection\(\)/); assert.match(layout, /<html lang="th">/);
  assert.equal(HOME_TITLE, 'มั่งมีพลัส (MangmeePlus) | จัดการรายจ่ายและเบิกจ่ายอย่างเป็นระบบ');
  assert.match(HOME_DESCRIPTION, /มั่งมีพลัส โดย บริษัท มั่งมียั่งยืน จำกัด.*ตรวจและอนุมัติตามสิทธิ์.*บันทึกการจ่าย.*สำนักงานบัญชี.*AI/);
  assert.doesNotMatch(page, /redirect\(|cookies\(|fetch\(/);
});
