/**
 * Audit "i18n / error UX": most API error codes had no Thai text, so the user saw the raw
 * snake_case identifier the developer typed — `missing_receipt_reason_required` on a screen a shop
 * owner is meant to act on.
 *
 * Translating every code at once is not the safe move: a wrong Thai sentence is worse than a
 * generic one because it sends the user to fix the wrong thing. The specific-copy coverage enforced
 * here stays on the default-open surface; every unknown API-shaped error now fails closed to the
 * shared status/kind fallback instead of exposing its raw code.
 *
 * The list is derived from the API source rather than restated, so adding a code to a default-open
 * module without Thai text fails here instead of appearing on a customer's screen.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { apiErrorMessage, translateApiError } from './api-error-message';
import { GENERIC_UPLOAD_ERROR_MESSAGE, uploadErrorMessage } from '../files/upload-file.logic';

/** Default-open customer features, plus the billing/renewal boundary. */
const OPEN_MODULES = [
  'expenses', 'reimbursements', 'employee-access', 'auth',
  'data-model-core', 'system-partner-management',
  'crm', 'crm-inbox', 'inventory', 'dashboard-notifications',
  'ai-draft', 'tax', 'ledger', 'workflow', 'line-ai',
  'billing',
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
 * Codes the API answers with. Every spelling the codebase uses: the bare-string exception
 * (`throw new ConflictException('stale_claim_snapshot')`), the object form carrying `code:`,
 * billing's `billingError('X', …)` helper, and an `emailError('X', …)` helper of the same shape —
 * not used yet, but recipient-flow codes are added the moment one exists, so this keeps them
 * covered from the start instead of after the fact.
 */
function openFeatureErrorCodes(): Map<string, string> {
  const codes = new Map<string, string>();
  for (const moduleName of OPEN_MODULES) {
    for (const file of sourceFiles(join(API_MODULES, moduleName))) {
      const source = readFileSync(file, 'utf8');
      const found = [
        ...source.matchAll(/(?:BadRequest|UnprocessableEntity|Conflict|Forbidden|Unauthorized|NotFound|Gone|PayloadTooLarge|TooManyRequests|ServiceUnavailable)Exception\(\s*'([A-Za-z][A-Za-z0-9_:-]{3,})'/g),
        ...source.matchAll(/code:\s*'([A-Za-z][A-Za-z0-9_:-]{3,})'/g),
        ...source.matchAll(/billingError\(\s*'([A-Za-z][A-Za-z0-9_:-]{3,})'/g),
        ...source.matchAll(/emailError\(\s*'([A-Za-z][A-Za-z0-9_:-]{3,})'/g),
      ];
      for (const match of found) if (!codes.has(match[1]!)) codes.set(match[1]!, moduleName);
    }
  }
  return codes;
}

// Codes the discovery above finds that never reach the web as an HTTP answer. Listed rather than
// filtered by a pattern, so each exemption stays visible and has its reason next to it.
const NOT_USER_FACING = new Set([
  // An internal return-shape discriminator in the legal-identity logic.
  'validation',
  // LINE send outcomes: what `LineReplyAdapter.sendFrozenV2` returns about one LINE API call to its
  // callers (webhook replay, ledger drain, receipt notifier). `API_ACCEPTED` is the success value.
  'API_ACCEPTED', 'CHANNEL_CHANGED', 'CHANNEL_UNAVAILABLE', 'FLEX_REJECTED', 'INVALID_FROZEN_WIRE',
  'PROVIDER_ACCEPTANCE_UNKNOWN', 'PROVIDER_REJECTED', 'RATE_LIMITED', 'REPLY_TOKEN_REJECTED',
  // Receipt-result notification outcomes (`line-capture-result-notifier.use-case.ts`): the
  // accepted/retryable/permanent verdicts it returns to the notification worker.
  'CAPTURE_ACCESS_OR_SOURCE_CHANGED', 'CAPTURE_CHECKPOINT_LOST', 'CAPTURE_LEASE_CHANGED', 'CAPTURE_MORE_BATCHES',
  'CAPTURE_NOT_DISPATCHABLE', 'CAPTURE_SOURCE_CHANGED', 'CAPTURE_SOURCE_MISSING', 'LINE_DELIVERY_NOT_ACCEPTED',
  'LINE_OUTCOME_RECOVERY_REQUIRED', 'LINE_PROVIDER_REJECTED', 'WAITING_CONTINUATION',
  // The API's own check of its contract with the AI Gateway (`ai-gateway.client.ts`). Only the LINE
  // webhook, the ledger drain and the document-QA worker call it; no web request does.
  'AI_CONTRACT_UNSUPPORTED',
  // LINE reimbursement drafts (`line-reimbursement-draft.use-case.ts`, the draft-action repository):
  // thrown inside the LINE draft flow. The web draft page's endpoints (getForWeb / confirmForWeb /
  // cancelForWeb) catch them and answer with a status the page renders through its own Thai copy.
  'reimbursement_action_changed', 'reimbursement_action_identity_conflict', 'reimbursement_active_action_exists',
  'reimbursement_target_missing', 'state_not_editable',
  // What stands in the way of a claim's cancellation (`expense-void-blocker.ts`, `pendingCancellationOf`):
  // the `blocker` of the claim detail, never an HTTP answer by itself. The claim page words it through
  // `cancellationBlockerText`; a cancel refused for the same reason answers `reimbursement_cancellation_<code>`.
  'expense_not_voidable', 'posting_unresolved', 'reason_too_short',
]);

describe('Thai coverage for default-open feature error codes', () => {
  it('finds the API codes at all, so a moved path fails loudly instead of passing empty', () => {
    const codes = openFeatureErrorCodes();
    assert.ok(codes.size > 400, `only ${codes.size} codes found — check API_MODULES resolves to the api package`);
  });

  it('has Thai text for every error code the default-open modules answer with', () => {
    const missing = [...openFeatureErrorCodes()]
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

/**
 * Credit-wording spec §3 / W-01 (owner decision 2026-09-18): every surface a customer, a shop owner,
 * a support operator or a System Admin reads calls it "เครดิต AI" — never "งบ AI" and never
 * "โควตา AI". Codes, enum members, DTO fields, telemetry keys and test ids keep their names; only
 * human-readable text moved, so this guard looks for the retired PHRASES anywhere in the product
 * source rather than trying to tell a string literal from an identifier.
 *
 * It lives in the web package because this is the spec that already walks sibling packages from
 * here; the phrases themselves are shared by the API, the gateway, the web app, the contracts and the
 * browser smoke scripts, so a single sweep is cheaper than one guard per package.
 *
 * `docs/` is deliberately out of scope: specs, plans and memory quote the old wording as history.
 */
const RETIRED_AI_CREDIT_PHRASES = ['งบ AI', 'โควตา AI'];

/**
 * Paths that may still contain a retired phrase, each with the reason. One entry today — this file,
 * which cannot state what it forbids without writing it down. Everything else in the product source
 * is clean, comments included. A new entry needs a reason a reviewer can check, and a code comment
 * recording history ("used to say …") is one; a string a user reads is never one.
 */
const RETIRED_AI_CREDIT_ALLOWLIST = new Map<string, string>([
  ['apps/web/src/common/api/api-error-coverage.spec.ts', 'this guard has to spell the phrases it forbids'],
]);

const REPO_ROOT = join(__dirname, '../../../../..');

function productSourceFiles(): string[] {
  const roots = [
    join(REPO_ROOT, 'apps/api/src'), join(REPO_ROOT, 'apps/web/src'), join(REPO_ROOT, 'apps/ai-gateway/src'),
    join(REPO_ROOT, 'scripts'), join(REPO_ROOT, 'e2e'),
    ...readdirSync(join(REPO_ROOT, 'packages'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory()).map((entry) => join(REPO_ROOT, 'packages', entry.name, 'src')),
  ];
  const walk = (dir: string): string[] => (existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return ['node_modules', 'dist', '.next', 'generated'].includes(entry.name) ? [] : walk(full);
      return entry.isFile() && /\.(ts|tsx|mjs)$/.test(entry.name) ? [full] : [];
    })
    : []);
  return roots.flatMap(walk);
}

describe('"เครดิต AI" is the only wording for the AI money (spec §3, W-01)', () => {
  it('finds the product source at all, so a moved spec fails loudly instead of passing empty', () => {
    assert.ok(existsSync(join(REPO_ROOT, 'pnpm-workspace.yaml')), `REPO_ROOT does not resolve: ${REPO_ROOT}`);
    assert.ok(productSourceFiles().length > 1000, 'too few source files — check the roots above');
  });

  it('has no "งบ AI" or "โควตา AI" left outside the allowlist', () => {
    const offenders = productSourceFiles().flatMap((file) => {
      const relative = file.slice(REPO_ROOT.length + 1);
      if (RETIRED_AI_CREDIT_ALLOWLIST.has(relative)) return [];
      const lines = readFileSync(file, 'utf8').split('\n');
      return lines.flatMap((line, index) => (RETIRED_AI_CREDIT_PHRASES.some((phrase) => line.includes(phrase))
        ? [`${relative}:${index + 1}: ${line.trim()}`]
        : []));
    });

    assert.deepEqual(offenders, [], `retired AI-money wording (use "เครดิต AI"):\n  ${offenders.join('\n  ')}`);
  });
});

describe('status fallbacks', () => {
  // These arrive from a proxy or the rate limiter with no body, so there is no code or message to
  // translate — without a status fallback the user saw the client's own "API error 429".
  it('renders throttling and outage statuses in Thai instead of "API error <n>"', () => {
    for (const [status, expected] of [[429, /ถี่เกินไป/], [503, /บริการที่จำเป็นยังไม่พร้อม/], [413, /ขนาดใหญ่เกิน/]] as const) {
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
