import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { getTaxSignature } from './tax.api';

const page = readFileSync(new URL('./TaxSignatureSettingsPage.tsx', import.meta.url), 'utf8');
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test('signature API reads the stored picture and upload time from the existing settings route', async () => {
  let requested = '';
  const stored = { signatureMode: 'AUTO_STAMP', signatureImageAttachmentId: 'image', signatureImageUrl: '/signed/image', signatureStoredAt: '2026-10-12T04:00:00Z' };
  globalThis.fetch = (async (input: unknown) => { requested = String(input); return Response.json(stored); }) as typeof fetch;
  assert.deepEqual(await getTaxSignature('shop'), stored);
  assert.equal(requested, '/api/v1/companies/shop/tax/profile/signature');
});

test('stored signature sits under the choice with one stored-date line and the empty state beside upload', () => {
  assert.ok(page.indexOf('</fieldset>') < page.indexOf('profile.signatureImageUrl && <figure'));
  assert.match(page, /<img src=\{profile.signatureImageUrl\} alt="รูปลายเซ็นที่บันทึกไว้"/);
  assert.match(page, /เก็บรูปไว้เมื่อ \{formatThaiDateTime\(profile.signatureStoredAt\)\}/);
  assert.match(page, /!profile.signatureImageUrl && !pickedName && <p[^>]*>ยังไม่มีรูปลายเซ็น/);
  assert.doesNotMatch(page, /max-w-|มีรูปลายเซ็นที่บันทึกไว้แล้ว/);
  assert.match(page, /<FormActionBar><ActionGroup><button type="submit"/);
});

test('signature loading stays permission-gated, rejects stale company reads and retries a failed image without losing form choices', () => {
  assert.match(page, /if \(canManage\) void load\(\)/);
  assert.match(page, /request !== loadRequest.current/);
  assert.match(page, /onError=\{\(\) => setImageFailed\(true\)\}/);
  assert.match(page, /เปิดรูปลายเซ็นไม่ได้ ลองอีกครั้ง/);
  assert.match(page, /onRetry=\{\(\) => void load\(false\)\}/);
  assert.match(page, /if \(reset\) \{ setMode/);
});

test('warns before the deliberate signature reset when saving the hand-sign choice', () => {
  assert.match(page, /mode === 'BLANK' && profile.signatureImageAttachmentId/);
  assert.match(page, /บันทึกแล้วรูปลายเซ็นที่เก็บไว้จะถูกลบ/);
});
