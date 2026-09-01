import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateLineWebQrCredentials,
  hashLineWebQrValue,
  LINE_WEB_QR_TTL_MS,
  lineWebQrImageUrl,
  lineWebQrScanUrl,
} from './line-web-qr.logic';

test('credentials are two independent url-safe 24-byte tokens', () => {
  const { publicCode, desktopSecret } = generateLineWebQrCredentials();
  assert.match(publicCode, /^[A-Za-z0-9_-]{32}$/);
  assert.match(desktopSecret, /^[A-Za-z0-9_-]{32}$/);
  assert.notEqual(publicCode, desktopSecret);
});

test('every transaction mints fresh credentials', () => {
  const codes = new Set<string>();
  const secrets = new Set<string>();
  for (let i = 0; i < 50; i += 1) {
    const { publicCode, desktopSecret } = generateLineWebQrCredentials();
    codes.add(publicCode);
    secrets.add(desktopSecret);
  }
  assert.equal(codes.size, 50);
  assert.equal(secrets.size, 50);
});

test('hashing is stable, non-reversible in shape, and separates distinct values', () => {
  const hash = hashLineWebQrValue('code-a');
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hash, hashLineWebQrValue('code-a'));
  assert.notEqual(hash, hashLineWebQrValue('code-b'));
  assert.ok(!hash.includes('code-a'));
});

test('scan url is the /line-qr page for that code, with a single separator', () => {
  assert.equal(lineWebQrScanUrl('https://app.example.test', 'abc'), 'https://app.example.test/line-qr/abc?openExternalBrowser=1');
  assert.equal(lineWebQrScanUrl('https://app.example.test/', 'abc'), 'https://app.example.test/line-qr/abc?openExternalBrowser=1');
  assert.equal(lineWebQrScanUrl('https://app.example.test///', 'abc'), 'https://app.example.test/line-qr/abc?openExternalBrowser=1');
});

// UAT 2026-09-01: without it, a scan inside LINE opens the approve page in LINE's in-app browser,
// which carries none of Safari's cookies, so the signed-in phone still sees a signed-out page.
test('scan url carries the LINE in-app browser escape', () => {
  assert.ok(lineWebQrScanUrl('https://app.example.test', 'abc').endsWith('?openExternalBrowser=1'));
});

test('scan url escapes the code so it cannot break out of the path segment', () => {
  assert.equal(lineWebQrScanUrl('https://app.example.test', 'a/b?c'), 'https://app.example.test/line-qr/a%2Fb%3Fc?openExternalBrowser=1');
});

test('the QR image is a self-rendered inline data URI, never a third-party image URL (H-09)', () => {
  const image = lineWebQrImageUrl(lineWebQrScanUrl('https://app.example.test', 'abc'));
  assert.match(image, /^data:image\/svg\+xml;base64,/);
  const svg = Buffer.from(image.slice('data:image/svg+xml;base64,'.length), 'base64').toString('utf8');
  assert.match(svg, /^<svg/);
  assert.ok(!/https?:\/\//.test(svg.replace(/xmlns="[^"]*"/g, '')), 'QR SVG must not reference an external host');
});

test('TTL is a short single-transaction window, not a durable code (AUTH-03)', () => {
  assert.equal(LINE_WEB_QR_TTL_MS, 180_000);
  assert.ok(LINE_WEB_QR_TTL_MS <= 5 * 60_000);
});
