import { it } from 'node:test';
import assert from 'node:assert/strict';
import {
  configureLineSignedInOpen,
  stripLineExternalBrowserParam,
  withLineExternalBrowserLinks,
  withLineExternalBrowserParam,
  withLineExternalBrowserText,
} from './line-external-browser.js';

it('adds the escape once, before the fragment, and leaves LINE-internal and non-web links alone', () => {
  assert.equal(withLineExternalBrowserParam('https://app/companies/c/billing'), 'https://app/companies/c/billing?openExternalBrowser=1');
  assert.equal(withLineExternalBrowserParam('https://app/companies/c/billing?channel=line'), 'https://app/companies/c/billing?channel=line&openExternalBrowser=1');
  assert.equal(withLineExternalBrowserParam('https://app/settings/profile#account'), 'https://app/settings/profile?openExternalBrowser=1#account');
  const once = withLineExternalBrowserParam('https://app/companies/c/billing');
  assert.equal(withLineExternalBrowserParam(once), once);
  assert.equal(withLineExternalBrowserParam('http://localhost:3000/companies/c'), 'http://localhost:3000/companies/c?openExternalBrowser=1');
  for (const kept of ['https://liff.line.me/123-abc/signup', 'https://line.me/R/ti/p/@x', 'https://lin.ee/UU9pbOI', 'https://official.mangmeeplus.com/', 'tel:0982565628', 'not a url']) {
    assert.equal(withLineExternalBrowserParam(kept), kept);
  }
});

it('strips the escape from a mint target and returns anything else untouched', () => {
  assert.equal(stripLineExternalBrowserParam('/companies/c/billing?openExternalBrowser=1'), '/companies/c/billing');
  assert.equal(stripLineExternalBrowserParam('/companies/c/billing?channel=line&openExternalBrowser=1#x'), '/companies/c/billing?channel=line#x');
  assert.equal(stripLineExternalBrowserParam('https://app.example.test/l/t?openExternalBrowser=1'), 'https://app.example.test/l/t');
  const plain = '/companies/c/billing?channel=line';
  assert.equal(stripLineExternalBrowserParam(plain), plain);
});

it('rewrites text and nested Flex uri actions without mutating input, and keeps identity when nothing changes', () => {
  const input = [
    { type: 'text', text: 'ดู https://app/companies/c/a และ https://app/companies/c/b', quickReply: { items: [{ type: 'action', action: { type: 'camera', label: 'ถ่ายรูป' } }] } },
    { type: 'flex', altText: 'x', contents: { type: 'carousel', contents: [{ type: 'bubble', footer: { type: 'box', contents: [
      { type: 'button', action: { type: 'uri', label: 'เปิด', uri: 'https://app/companies/c/billing' } },
      { type: 'button', action: { type: 'uri', label: 'LIFF', uri: 'https://liff.line.me/1-a/start' } },
    ] } }] } },
    { type: 'image', originalContentUrl: 'https://app/a.png', previewImageUrl: 'https://app/a.png' },
  ];
  const snapshot = structuredClone(input);
  const out = withLineExternalBrowserLinks(input);
  assert.deepEqual(input, snapshot);
  assert.equal((out[0] as { text: string }).text, 'ดู https://app/companies/c/a?openExternalBrowser=1 และ https://app/companies/c/b?openExternalBrowser=1');
  assert.equal((out[0] as { quickReply: unknown }).quickReply, input[0]!.quickReply);
  const buttons = JSON.stringify(out[1]);
  assert.match(buttons, /"uri":"https:\/\/app\/companies\/c\/billing\?openExternalBrowser=1"/);
  assert.match(buttons, /"uri":"https:\/\/liff\.line\.me\/1-a\/start"/);
  assert.equal(out[2], input[2]);
  assert.deepEqual(withLineExternalBrowserLinks(out), out);
  const unchanged = [{ type: 'text', text: 'ไม่มีลิงก์' }, input[2]];
  assert.equal(withLineExternalBrowserLinks(unchanged), unchanged);
});

it('puts the escape on the link, not on the punctuation or Thai text typed right after it', () => {
  assert.equal(withLineExternalBrowserText('ดูที่ https://app/companies/c/billing.'), 'ดูที่ https://app/companies/c/billing?openExternalBrowser=1.');
  assert.equal(withLineExternalBrowserText('https://app/a, https://app/b”'), 'https://app/a?openExternalBrowser=1, https://app/b?openExternalBrowser=1”');
  assert.equal(withLineExternalBrowserText('(https://app/x)'), '(https://app/x?openExternalBrowser=1)');
  assert.equal(withLineExternalBrowserText('เปิด https://app/companies/c/billingได้เลยค่ะ'), 'เปิด https://app/companies/c/billing?openExternalBrowser=1ได้เลยค่ะ');
  assert.equal(withLineExternalBrowserText('https://app/x?a=1.'), 'https://app/x?a=1&openExternalBrowser=1.');
  // Only a TRAILING run is trimmed; a LIFF link keeps its trailer and gets no escape at all.
  assert.equal(withLineExternalBrowserText('https://liff.line.me/1-a/start.'), 'https://liff.line.me/1-a/start.');
  assert.equal(withLineExternalBrowserText('https://.'), 'https://.');
});

it('never cuts a link: over-length text and uri stay as they were', () => {
  // 4,994 characters fit LINE's 5,000; with the escape they would not.
  const longText = `${'ก'.repeat(4980)} https://app/x`;
  assert.equal(withLineExternalBrowserText(longText), longText);
  assert.equal(withLineExternalBrowserText(longText, Number.POSITIVE_INFINITY), `${longText}?openExternalBrowser=1`);
  const longUri = `https://app/${'a'.repeat(978)}`;
  const flex = [{ type: 'flex', contents: { type: 'bubble', action: { type: 'uri', uri: longUri } } }];
  assert.equal(withLineExternalBrowserLinks(flex), flex);
});

// Owner 2026-10-06: a company page in a LINE message opens signed in, through the LIFF start page.
it('sends a company page through the LIFF start page once configured, and nothing else', () => {
  try {
    configureLineSignedInOpen({ webBaseUrl: 'https://app.example.test/', liffId: '2011037668-AbCd' });
    const open = 'https://liff.line.me/2011037668-AbCd/start?to=%2Fcompanies%2Fc1%2Fexpenses%2Fe1%3FbranchId%3Db1';
    assert.equal(withLineExternalBrowserParam('https://app.example.test/companies/c1/expenses/e1?branchId=b1'), open);
    assert.equal(withLineExternalBrowserParam('https://app.example.test/companies/c1/expenses/e1?branchId=b1&openExternalBrowser=1'), open);
    assert.equal(withLineExternalBrowserParam(open), open, 'idempotent: a replay sends the same bytes');
    assert.equal(withLineExternalBrowserText('ดู https://app.example.test/companies/c1/billing.'), 'ดู https://liff.line.me/2011037668-AbCd/start?to=%2Fcompanies%2Fc1%2Fbilling.');
    const [flex] = withLineExternalBrowserLinks([{ type: 'flex', contents: { action: { type: 'uri', uri: 'https://app.example.test/companies/c1/billing' } } }]);
    assert.match(JSON.stringify(flex), /liff\.line\.me\/2011037668-AbCd\/start\?to=%2Fcompanies%2Fc1%2Fbilling"/);
    // Not a company page, a sign-in token link, another origin: exactly as before.
    for (const url of ['https://app.example.test/l/token', 'https://app.example.test/login', 'https://other.example.test/companies/c1/billing'])
      assert.equal(withLineExternalBrowserParam(url), `${url}?openExternalBrowser=1`);
    configureLineSignedInOpen({ webBaseUrl: 'https://app.example.test', liffId: 'not-a-liff-id' });
    assert.equal(withLineExternalBrowserParam('https://app.example.test/companies/c1/billing'), 'https://app.example.test/companies/c1/billing?openExternalBrowser=1');
  } finally {
    configureLineSignedInOpen(null);
  }
});
