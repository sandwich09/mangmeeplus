/**
 * Audit "i18n / error UX": most API error codes had no Thai text, so the user saw the raw
 * snake_case identifier the developer typed — `missing_receipt_reason_required` on a screen a shop
 * owner is meant to act on.
 *
 * Translating every code at once is not the safe move: a wrong Thai sentence is worse than a
 * generic one because it sends the user to fix the wrong thing. The specific-copy coverage enforced
 * here stays on the launch surface; every unknown API-shaped error now fails closed to the shared
 * status/kind fallback instead of exposing its raw code.
 *
 * The list is derived from the API source rather than restated, so adding a code to a launch module
 * without Thai text fails here instead of appearing on a customer's screen.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { apiErrorMessage, translateApiError } from './api-error-message';
import { GENERIC_UPLOAD_ERROR_MESSAGE, uploadErrorMessage } from '../files/upload-file.logic';

/** Modules behind the eleven launch features. Outside this set, translation is best-effort. */
const LAUNCH_MODULES = [
  'expenses', 'reimbursements', 'employee-access', 'auth',
  'data-model-core', 'system-partner-management',
];

const API_MODULES = join(__dirname, '../../../../api/src/modules');

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [full] : [];
  });
}

/**
 * Codes the API answers with. Both spellings the codebase uses: the bare-string exception
 * (`throw new ConflictException('stale_claim_snapshot')`) and the object form carrying `code:`.
 */
function launchErrorCodes(): Map<string, string> {
  const codes = new Map<string, string>();
  for (const moduleName of LAUNCH_MODULES) {
    for (const file of sourceFiles(join(API_MODULES, moduleName))) {
      const source = readFileSync(file, 'utf8');
      const found = [
        ...source.matchAll(/(?:BadRequest|UnprocessableEntity|Conflict|Forbidden|Unauthorized|NotFound|Gone|PayloadTooLarge|TooManyRequests|ServiceUnavailable)Exception\(\s*'([A-Za-z][A-Za-z0-9_:-]{3,})'/g),
        ...source.matchAll(/code:\s*'([A-Za-z][A-Za-z0-9_:-]{3,})'/g),
      ];
      for (const match of found) if (!codes.has(match[1]!)) codes.set(match[1]!, moduleName);
    }
  }
  return codes;
}

// `validation` is an internal return-shape discriminator in the legal-identity logic, never an HTTP
// answer. Listed rather than filtered by a pattern, so the exemption stays visible.
const NOT_USER_FACING = new Set(['validation']);

describe('Thai coverage for launch-feature error codes', () => {
  it('finds the API codes at all, so a moved path fails loudly instead of passing empty', () => {
    const codes = launchErrorCodes();
    assert.ok(codes.size > 100, `only ${codes.size} codes found — check API_MODULES resolves to the api package`);
  });

  it('has Thai text for every error code the launch modules answer with', () => {
    const missing = [...launchErrorCodes()]
      .filter(([code]) => !NOT_USER_FACING.has(code))
      .filter(([code]) => !translateApiError(code))
      .map(([code, moduleName]) => `${moduleName}: ${code}`)
      .sort();

    assert.deepEqual(missing, [], `these reach the user as raw snake_case:\n  ${missing.join('\n  ')}`);
  });

  // The message has to be actionable, not merely Thai: several of these are the only thing standing
  // between the user and a dead end, so a bare restatement of the code would pass a "is it Thai"
  // check while helping nobody.
  it('answers with what to do, for the codes that end a journey', () => {
    for (const [code, expected] of [
      ['self_approval_denied', /อนุมัติใบเบิกของตนเองไม่ได้/],
      ['missing_receipt_reason_required', /เหตุผลที่ไม่มีใบเสร็จ/],
      ['reimbursement_accrual_not_posted', /ก่อน/],
      ['employee_phone_conflict', /เบอร์โทรศัพท์/],
      ['password_reuse', /รหัสผ่านเดิม/],
    ] as const) {
      const thai = translateApiError(code);
      assert.ok(thai, `${code} has no Thai text`);
      assert.match(thai!, expected, code);
      assert.doesNotMatch(thai!, /[a-z]{3,}_[a-z]{3,}/, `${code} leaks a snake_case identifier into the message`);
    }
  });
});

describe('status fallbacks', () => {
  // These arrive from a proxy or the rate limiter with no body, so there is no code or message to
  // translate — without a status fallback the user saw the client's own "API error 429".
  it('renders throttling and outage statuses in Thai instead of "API error <n>"', () => {
    for (const [status, expected] of [[429, /ถี่เกินไป/], [503, /หนาแน่น|ปรับปรุง/], [413, /ขนาดใหญ่เกิน/]] as const) {
      const error = Object.assign(new Error(`API error ${status}`), { status });
      const message = apiErrorMessage(error);
      assert.match(message, expected, String(status));
      assert.doesNotMatch(message, /API error/, String(status));
    }
  });

  it('still prefers a real server sentence over the status fallback', () => {
    const error = Object.assign(new Error('Attachment not found.'), { status: 404 });
    assert.equal(apiErrorMessage(error), 'ไม่พบไฟล์แนบ');
  });
});

describe('upload errors reaching the translator', () => {
  // The finding's sharpest case: every server answer collapsed into one generic line before the
  // translator ran, so a permanently-rejected file and a transient blip read identically — and the
  // only action the message suggested was uploading the same bytes again.
  it('names the reason a rejected file will never upload, rather than inviting a retry', () => {
    const message = uploadErrorMessage(new Error('Active PDF content is not allowed.'));
    assert.notEqual(message, GENERIC_UPLOAD_ERROR_MESSAGE);
    assert.match(message, /สแกน|ถ่ายรูป|พิมพ์เป็น PDF/);
  });

  it('translates by code as well, since the upload wrapper rebuilds the error', () => {
    const message = uploadErrorMessage(Object.assign(new Error('whatever'), { code: 'insufficient_permissions' }));
    assert.match(message, /ไม่มีสิทธิ์/);
  });

  it('keeps the client-side validation messages exactly as they are', () => {
    assert.equal(uploadErrorMessage(new Error('รองรับเฉพาะไฟล์ PNG, JPG และ JPEG')), 'รองรับเฉพาะไฟล์ PNG, JPG และ JPEG');
  });

  it('still falls back to the generic line for something genuinely unknown', () => {
    assert.equal(uploadErrorMessage(new Error('ECONNRESET')), GENERIC_UPLOAD_ERROR_MESSAGE);
  });
});
