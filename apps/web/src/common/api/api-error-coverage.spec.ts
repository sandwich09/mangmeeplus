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
import { apiErrorCode, apiErrorMessage, translateApiError } from './api-error-message';
import { DISBURSEMENT_VOUCHER_ERROR_WORDS } from '@watchdog-bms/contracts';
import { GENERIC_UPLOAD_ERROR_MESSAGE, UPLOAD_RECEIPT_SOURCE_UNSUPPORTED_ERROR_MESSAGE, uploadErrorMessage } from '../files/upload-file.logic';

/** Default-open customer features, plus the billing/renewal boundary. */
const OPEN_MODULES = [
  'expenses', 'reimbursements', 'employee-access', 'auth',
  'data-model-core', 'system-partner-management',
  'crm', 'crm-inbox', 'inventory', 'dashboard-notifications',
  'ai-draft', 'tax', 'ledger', 'workflow', 'line-ai',
  'billing',
];

const API_MODULES = join(__dirname, '../../../../api/src/modules');

/**
 * Modules whose rule functions answer a refusal as `{ error: 'code' }`, which the caller then throws as
 * it came (`throw new ConflictException(plan.error)`, `paymentPayoutRefusal(plan.error)`). The code is
 * no literal at the place it is thrown, so the exception patterns below never see it: the payout
 * planners' `payout_confirmation_required` and `payment_method_mismatch_reason_required` could have
 * lost their Thai text with this spec still passing. Named per module: in other modules the same
 * shape also carries values that never leave the server.
 */
const PLANNER_ERROR_MODULES = ['reimbursements'];

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    // Test fixtures inject database failures; those are not HTTP answers from product code.
    return entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') && !entry.name.endsWith('.fixture.ts') ? [full] : [];
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
        ...(PLANNER_ERROR_MODULES.includes(moduleName) ? source.matchAll(/\berror:\s*'([a-z][a-z0-9_]{3,})'/g) : []),
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
  // Revision fences supplied only by signed LINE actions; their adapter renders the Thai refusal.
  // Public web DTOs never supply these internal revision arguments.
  'expense_source_version_changed', 'reimbursement_source_version_changed',
  'reimbursement_payment_source_changed', 'wht_handoff_changed',
  // What stands in the way of a claim's cancellation (`expense-void-blocker.ts`, `pendingCancellationOf`):
  // the `blocker` of the claim detail, never an HTTP answer by itself. The claim page words it through
  // `cancellationBlockerText`; a cancel refused for the same reason answers `reimbursement_cancellation_<code>`.
  'expense_not_voidable', 'posting_unresolved', 'reason_too_short',
  // Promotion campaign drafts (`billing/domain/billing-promotion.ts`, `parsePromotionDraft`): what is still missing
  // in one field of a saved draft, listed in the Admin draft view (`validationErrors`), never an HTTP answer. The
  // campaign form words each field's finding itself.
  'REQUIRED', 'INVALID', 'END_NOT_AFTER_START',
]);

describe('Thai coverage for default-open feature error codes', () => {
  it('keeps draft deletion refusals actionable and uses the same missing-document message for hidden documents', () => {
    for (const code of ['disbursement_not_draft', 'disbursement_numbered_delete', 'disbursement_permission_denied', 'disbursement_not_found'] as const) {
      assert.equal(apiErrorMessage({ code, status: code === 'disbursement_not_found' ? 404 : 409 }), DISBURSEMENT_VOUCHER_ERROR_WORDS[code]);
    }
  });
  it('uses document-specific retry sentences while expense cancellation keeps its own sentence', () => {
    assert.equal(apiErrorMessage({ code: 'disbursement_changed_retry', status: 409 }), 'มีการทำรายการกับใบนี้หรือรายจ่ายในใบพร้อมกัน ระบบยังไม่ได้บันทึกสิ่งที่คุณเพิ่งทำ เปิดหน้านี้ใหม่แล้วลองอีกครั้ง');
    assert.equal(apiErrorMessage({ code: 'disbursement_payment_retry', status: 409 }), 'บันทึกไม่สำเร็จ ยังไม่มีการบันทึกจ่ายรายการใด ลองอีกครั้ง');
    assert.match(apiErrorMessage({ code: 'expense_changed_retry', status: 409 }), /ยังไม่ได้บันทึกการยกเลิก/);
  });
  it('covers every disbursement refusal and preserves the server facts without exposing templates', () => {
    for (const [code, message] of Object.entries(DISBURSEMENT_VOUCHER_ERROR_WORDS)) {
      const expected = code === 'disbursement_amount_invalid' ? DISBURSEMENT_VOUCHER_ERROR_WORDS.disbursement_invalid_input
        : code === 'disbursement_source_changed' ? 'รายการในใบนี้ถูกเปลี่ยนแปลงหลังส่งอนุมัติ ใบนี้จึงอนุมัติไม่ได้ กด "ส่งกลับให้แก้" พร้อมเหตุผลให้ผู้เตรียมตรวจรายการใหม่' : message;
      assert.equal(apiErrorMessage({ code, status: 422 }), expected);
      assert.doesNotMatch(apiErrorMessage({ code, status: 422 }), /\{\w+\}/);
    }
    const sentence = 'ยอดของรายการ EXP-1 ต้องมากกว่า 0 และไม่เกินยอดค้างจ่าย 104.0000';
    assert.equal(apiErrorMessage({ code: 'disbursement_amount_invalid', details: { message: sentence }, status: 422 }), sentence);
    const changedSource = 'รายการ EXP-1 ถูกเปลี่ยนแปลงหลังส่งอนุมัติ ใบนี้จึงอนุมัติไม่ได้ กด "กลับไปแก้" เพื่อตรวจรายการใหม่ หรือยกเลิกใบนี้';
    assert.equal(apiErrorMessage({ code: 'disbursement_source_changed', details: { message: changedSource }, status: 409 }), changedSource);
    assert.equal(apiErrorMessage({ code: 'disbursement_version_conflict', status: 409 }), 'ใบนี้ถูกแก้ไขจากที่อื่นแล้ว เปิดหน้านี้ใหม่ก่อนบันทึก');
  });
  it('keeps approval-command server sentences intact and exposes no template in a code-only refusal', () => {
    const sentence = 'ใบนี้ถูกแก้ไขจากที่อื่นแล้ว กรุณาเปิดใหม่ก่อนทำต่อ';
    for (const code of ['disbursement_version_conflict', 'disbursement_status_changed', 'disbursement_approver_ineligible']) {
      assert.equal(apiErrorMessage({ code, status: 409, details: { message: sentence } }), sentence);
    }
    assert.doesNotMatch(apiErrorMessage({ code: 'disbursement_payment_source_changed', status: 409 }), /\{number\}/);
  });
  it('asks to reload and retry after a disbursement-voucher web-entry version conflict', () => {
    const code = 'disbursement_voucher_web_entry_version_conflict';
    const message = 'การตั้งค่านี้เปลี่ยนไปแล้ว กรุณาโหลดหน้านี้ใหม่แล้วลองอีกครั้ง';
    assert.equal(openFeatureErrorCodes().get(code), 'system-partner-management');
    assert.equal(translateApiError(code), message);
    assert.equal(apiErrorMessage({ status: 409, code }), message);
  });
  it('finds the API codes at all, so a moved path fails loudly instead of passing empty', () => {
    const codes = openFeatureErrorCodes();
    assert.ok(codes.size > 400, `only ${codes.size} codes found — check API_MODULES resolves to the api package`);
  });

  // A code a planner returns is found only if the planner still spells it this way. If it moves, this
  // fails here instead of the code dropping out of the check below without anybody noticing.
  it('finds the refusals the payout planners return for their caller to throw', () => {
    const codes = openFeatureErrorCodes();
    for (const code of ['payout_confirmation_required', 'payment_method_mismatch_reason_required', 'payout_destination_changed',
      'payout_method_required', 'payout_destination_required', 'note_contains_account_number']) {
      assert.ok(codes.has(code) && sourceFiles(join(API_MODULES, 'reimbursements')).some(file => readFileSync(file, 'utf8').includes(`'${code}'`)), `${code} is no longer found in the reimbursement source`);
      assert.ok(translateApiError(code), `${code} has no Thai text`);
    }
    // Found by the planner shape alone: neither is thrown as a literal anywhere in the API.
    const thrownAsLiteral = (code: string) => sourceFiles(API_MODULES).some((file) => new RegExp(`Exception\\(\\s*'${code}'|code:\\s*'${code}'`).test(readFileSync(file, 'utf8')));
    assert.deepEqual(['payout_confirmation_required', 'payment_method_mismatch_reason_required'].filter(thrownAsLiteral), []);
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
      ['self_approval_denied', /ไม่สามารถอนุมัติใบเบิกของตัวเองได้/],
      ['missing_receipt_reason_required', /เหตุผลที่ไม่มีใบเสร็จ/],
      ['reimbursement_accrual_not_posted', /ก่อน/],
      ['employee_phone_conflict', /เบอร์โทรศัพท์/],
      ['role_name_reserved', /ใช้ชื่ออื่น/],
      ['password_reuse', /รหัสผ่านเดิม/],
    ] as const) {
      const thai = translateApiError(code);
      assert.ok(thai, `${code} has no Thai text`);
      assert.match(thai!, expected, code);
      assert.doesNotMatch(thai!, /[a-z]{3,}_[a-z]{3,}/, `${code} leaks a snake_case identifier into the message`);
    }
  });
});

// Seen on a local stack on 2026-10-02: a company's sixth role with a Thai name was refused with a bare 409,
// and the role form reads a bare 409 as "ข้อมูลซ้ำกับที่มีอยู่ในระบบ". Nothing was duplicated. Role keys are
// numbered without a cap now, and the one refusal left (several roles saved in one company in the same
// instant, every round lost) carries a code, so the form and the toast say what happened and what to do.
describe('a role that could not be created because other roles were saved at the same moment', () => {
  it('says so and asks to save again, on the role form and in the toast, and never calls it a duplicate', () => {
    const code = 'role_key_allocation_failed';
    assert.equal(openFeatureErrorCodes().get(code), 'employee-access', `${code} is no longer found in the API source`);
    const thai = translateApiError(code)!;
    assert.equal(thai, 'ยังไม่ได้สร้างบทบาทนี้ เพราะมีการบันทึกบทบาทอื่นในเวลาเดียวกัน กดบันทึกอีกครั้ง');
    assert.doesNotMatch(thai, /ซ้ำ|[A-Za-z]/);
    // The API gives the same sentence as its message, so a reader of the message is told the same thing.
    const useCase = readFileSync(join(API_MODULES, 'employee-access/application/use-cases/create-role.use-case.ts'), 'utf8');
    assert.ok(useCase.includes(`message: '${thai}'`), 'the API message and the web text differ');

    // The answer as `authedApiFetch` throws it. The toast words it by its code, whatever the message says.
    const refusal = Object.assign(new Error('Conflict'), { status: 409, code, details: { code } });
    assert.equal(apiErrorMessage(refusal), thai);
    // So does the role form: it reads a refusal by its status only when the refusal has no code.
    const form = readFileSync(join(__dirname, '../../features/employee-access/EmployeeAccessPages.tsx'), 'utf8');
    assert.match(form, /setError\(apiErrorCode\(e2\) \? apiErrorMessage\(e2, locale\) : localizedErrorMessage\(e2, locale, /);
    assert.equal(apiErrorCode(refusal), code);
  });
});

// Review 2026-10-01 (claim hub, bank match and void): each refusal added there is something a shop owner or a
// finance person reads in the middle of a job, so it has to be plain Thai that says what to do next. The two bank
// codes come from the banking module, which the discovery above does not walk, so they are named here.
// `note_contains_account_number` answers for two texts people type on a claim: finance's note (shown on the
// claim and copied into the requester's notice) and the reason a payment was made another way than asked
// (shown on the payment row, and in no notice). One label serves both, so it may say only what is true of both.
describe('the refusal of a text that carries an account number is true wherever the API gives it', () => {
  it('says what to write instead, and nothing about a notice', () => {
    const thai = translateApiError('note_contains_account_number')!;
    assert.equal(thai, 'อย่าพิมพ์เลขบัญชีหรือตัวเลขยาวตั้งแต่ 6 หลัก ถ้าต้องอ้างบัญชี บอกแค่ 4 ตัวท้าย');
    assert.doesNotMatch(thai, /แจ้งเตือน/, 'the payment reason is in no notice');
    assert.match(thai, /4 ตัวท้าย/, 'what to write instead');
    assert.doesNotMatch(thai, /[A-Za-z]/);
    // The places the API answers with it. A third place has to be read against the sentence above before it is listed here.
    const uses = sourceFiles(join(API_MODULES, 'reimbursements'))
      .filter((file) => readFileSync(file, 'utf8').includes("'note_contains_account_number'"))
      .map((file) => file.slice(join(API_MODULES, 'reimbursements').length + 1)).sort();
    assert.deepEqual(uses, [
      // The note that goes with sending a claim back for its payout account: `sendBackForPayoutCorrection`.
      // It is shown on the claim page; the requester's notice carries the reason from the fixed list only.
      'application/use-cases/reimbursement-approval.use-case.ts',
      // Finance's note on a claim: `FinanceReviewReimbursementUseCase`.
      'application/use-cases/reimbursement-finance.use-case.ts',
      // The reason a payment was made by another method than the requester asked for: `planPaymentPayout`, and how it is thrown.
      'domain/logic/payout-destination.logic.ts',
      'infrastructure/reimbursement-payout.ts',
    ]);
  });
});

describe('the refusals added with the claim hub and bank-match fixes are plain Thai that says what to do', () => {
  it('names the next step, with no id, code word, enum word or currency code in the text', () => {
    for (const [code, nextStep] of [
      // Voiding a payment whose bank line is inside a completed reconciliation: reopen that reconciliation first.
      ['reimbursement_payment_bank_reconciled', /กด "เปิดใหม่" ที่รอบกระทบยอดนั้น.*ก่อน.*ยกเลิกการจ่าย/],
      // Matching a bank line to a claim payment voided since the list was read: refresh and pick another.
      ['bank_match_payment_not_recorded', /กดรีเฟรชแล้วเลือกรายการอื่น/],
      ['bank_match_state_changed', /กดรีเฟรชแล้วลองอีกครั้ง/],
      // A hub filter the API does not have (a page left open across an update): reload and pick again.
      ['reimbursement_list_bucket_invalid', /เปิดหน้านี้ใหม่แล้วเลือกตัวกรองอีกครั้ง/],
    ] as const) {
      const thai = translateApiError(code);
      assert.ok(thai, `${code} has no Thai text`);
      assert.match(thai!, nextStep, code);
      assert.match(thai!, /กด|เปิด/, `${code} asks for nothing`);
      // No Latin letter at all: that rules out an id, a status or enum word, a snake_case code and "THB" at once.
      assert.doesNotMatch(thai!, /[A-Za-z]/, `${code}: ${thai}`);
      // And what the person sees for the HTTP answer is that text, not the code or the English message.
      const shown = apiErrorMessage({ status: 409, code, message: 'Refresh the list and pick another payment.', details: { code } });
      assert.equal(shown, thai, code);
    }
    // The message this replaced sent the person to undo a match on a screen that does not list the line.
    assert.equal(translateApiError('reimbursement_payment_bank_matched'), null);
  });
});

// The claim payment check (`validatePaymentRecording`) answers a bare code that its caller throws as it came
// (`throw new UnprocessableEntityException(error)`). No pattern of the discovery above sees a code returned that
// way, and two of them reached the payment form with no Thai text: the payer read the generic fallback.
describe('the refusals of a claim payment over or under its amount say what to enter', () => {
  it('finds both codes where the API returns them, and answers each with the amount to pay', () => {
    const logic = readFileSync(join(API_MODULES, 'reimbursements/domain/logic/reimbursement.logic.ts'), 'utf8');
    const check = logic.slice(logic.indexOf('export function validatePaymentRecording('));
    const returned = [...check.slice(0, check.indexOf('\n}\n')).matchAll(/return '([a-z][a-z0-9_]{3,})'/g)].map((match) => match[1]!);
    for (const [code, nextStep] of [
      ['payment_amount_invalid', /ต้องมากกว่า 0 กรอกยอดคงค้างของใบเบิกแล้วกดบันทึกจ่ายอีกครั้ง/],
      ['payment_over_approved_amount', /เกินยอดคงค้างของใบเบิก แก้เป็นยอดคงค้างแล้วกดบันทึกจ่ายอีกครั้ง/],
    ] as const) {
      assert.ok(returned.includes(code), `${code} is no longer returned by the payment check`);
      const thai = translateApiError(code);
      assert.ok(thai, `${code} has no Thai text`);
      assert.match(thai!, nextStep, code);
      assert.doesNotMatch(thai!, /[A-Za-z]/, `${code}: ${thai}`);
      // What the payment form shows for the HTTP answer is that text: the API sends the code as its message.
      assert.equal(apiErrorMessage(Object.assign(new Error(code), { status: 422 })), thai, code);
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
    assert.equal(uploadErrorMessage(new Error(UPLOAD_RECEIPT_SOURCE_UNSUPPORTED_ERROR_MESSAGE)), UPLOAD_RECEIPT_SOURCE_UNSUPPORTED_ERROR_MESSAGE);
  });

  it('still falls back to the generic line for something genuinely unknown', () => {
    assert.equal(uploadErrorMessage(new Error('ECONNRESET')), GENERIC_UPLOAD_ERROR_MESSAGE);
  });
});


describe('expense certificate void errors (A3)', () => {
  it('shows the retry sentence and preserves operation-specific certificate refusals', () => {
    assert.equal(apiErrorMessage({ code: 'expense_changed_retry' }), 'มีคนทำรายการกับเอกสารนี้พร้อมกัน ระบบยังไม่ได้บันทึกการยกเลิก เปิดหน้านี้ใหม่แล้วลองอีกครั้ง');
    for (const [code, message] of [
      ['expense_certificate_attestation_required', 'ยังไม่ได้ยืนยันเรื่องการยื่นภาษี ติ๊กยืนยันก่อนยกเลิกเอกสาร'],
      ['expense_certificate_attestation_required', 'ยังไม่ได้ยืนยันเรื่องการยื่นภาษี ติ๊กยืนยันก่อนแก้ไขเอกสาร'],
      ['tax_period_locked', 'ภาษีหัก ณ ที่จ่ายของเดือนนี้ยื่นไปแล้ว จึงยกเลิกรายจ่ายที่ออกหนังสือรับรองแล้วไม่ได้ ถ้าต้องแก้เฉพาะตัวสะกดชื่อหรือที่อยู่บนหนังสือรับรอง ใช้ปุ่ม "แก้ไขหนังสือรับรอง" ได้'],
    ]) assert.equal(apiErrorMessage({ details: { code, message } }), message);
  });
  it('includes the claim certificate number and drops brackets when it is absent', () => {
    for (const certificateNumber of ['WHT-1', null]) assert.equal(apiErrorMessage({ details: { code: 'reimbursement_cancellation_wht_certificate_on_expense', certificateNumber } }),
      `รายจ่ายของใบเบิกนี้ออกหนังสือรับรอง 50 ทวิแล้ว${certificateNumber ? ` (เลขที่ ${certificateNumber})` : ''} จึงยกเลิกใบเบิกตอนนี้ไม่ได้ ระบบยังไม่ได้เปลี่ยนแปลงอะไร แจ้งทีมงานมั่งมีเพื่อช่วยยกเลิก`);
  });
});

// AW1: preserve the API's complete sentence at the action that was refused.
describe('expense certificate web refusals (AW1)', () => {
  it('keeps server sentences for reopen blockers and certificate void refusals without adding a remedy', () => {
    for (const code of ['expense_correction_blocked', 'tax_period_filed', 'certificate_permission_missing', 'expense_changed_retry']) {
      const message = 'ทำรายการนี้ไม่ได้ กรุณาเปิดหน้านี้ใหม่แล้วลองอีกครั้ง';
      assert.equal(apiErrorMessage({ details: { code, message, requestId: 'secret-request' } }), message);
    }
    for (const blocker of ['certificate_permission_missing', 'tax_period_filed']) {
      const message = apiErrorMessage({ details: { code: 'expense_correction_blocked', blockers: [blocker], certificateOnExpense: { kind: 'SYSTEM' } } });
      assert.match(message, /[ก-๙]/); assert.doesNotMatch(message, /certificate_permission_missing|tax_period_filed|SYSTEM/);
    }
    for (const code of ['expense_changed_retry', 'certificate_permission_missing', 'expense_certificate_attestation_required', 'tax_period_locked', 'expense_wht_source_changed']) {
      const text = translateApiError(code);
      assert.ok(text, code); assert.match(text, /[ก-๙]/); assert.doesNotMatch(text, /[A-Za-z]/);
    }
  });
});


describe('reserved expense refusal wording (B5b)', () => {
  for (const preparerName of ['สมใจ', null]) it(`keeps all four reservation remedies with ${preparerName ? 'a preparer' : 'no preparer'}`, async () => {
    const { expenseCorrectionBlockerMessage, expenseReopenBlockerMessages, expenseDisbursementReservationMessage } = await import('@watchdog-bms/contracts');
    const reservation = { voucherId: null, documentNumber: 'DV-1', preparerName, viewerMay: 'act' as const, viewerCanPay: true };
    const capabilities = { canReopen: false, reopenBlockers: ['disbursement_reserved'] as const, canRecordPayment: false, recordPaymentBlocker: 'disbursement_reserved' as const, payments: [], disbursementReservation: reservation };
    const prefix = `รายการนี้อยู่ในใบเตรียมจ่ายเลขที่ DV-1${preparerName ? ` จัดทำโดย ${preparerName}` : ''} `;
    const remedies = {
      recordPayment: 'ให้บันทึกจ่ายจากใบนั้น หรือยกเลิกใบนั้นก่อนถ้าจะจ่ายแยก',
      reopen: 'ให้กด "กลับไปแก้" ที่ใบนั้นหรือยกเลิกใบนั้นก่อน แล้วจึงแก้ไขเอกสารนี้ได้',
      void: 'ให้นำรายการนี้ออกจากใบนั้นหรือยกเลิกใบนั้นก่อน แล้วจึงยกเลิกเอกสารนี้ได้',
      approveSubstitute: 'ให้ยกเลิกใบนั้นก่อน แล้วจึงอนุมัติใบรับรองแทนใบเสร็จได้',
    };
    for (const [operation, remedy] of Object.entries(remedies)) {
      const sentence = prefix + remedy;
      assert.equal(expenseDisbursementReservationMessage(operation as keyof typeof remedies, 'DV-1', preparerName), sentence);
      assert.equal(apiErrorMessage({ code: 'expense_disbursement_reserved', details: { message: sentence }, status: 409 }), sentence);
    }
    const facts = { ...capabilities, reopenBlockers: [...capabilities.reopenBlockers] };
    assert.equal(expenseCorrectionBlockerMessage('disbursement_reserved', 'recordPayment', facts), prefix + remedies.recordPayment);
    assert.deepEqual(expenseReopenBlockerMessages(facts), [prefix + remedies.reopen]);
    assert.equal(apiErrorMessage({ code: 'expense_correction_blocked', details: { blockers: ['disbursement_reserved'], disbursementReservation: reservation } }), prefix + remedies.reopen);
    assert.match(apiErrorMessage({ code: 'expense_disbursement_reserved' }), /ใบเตรียมจ่าย.*สอบถามผู้จัดทำ/);
  });
  it('keeps the existing Thai retry sentence for a reservation committed during void', () => {
    assert.equal(apiErrorMessage({ code: 'expense_changed_retry', status: 409 }), 'มีคนทำรายการกับเอกสารนี้พร้อมกัน ระบบยังไม่ได้บันทึกการยกเลิก เปิดหน้านี้ใหม่แล้วลองอีกครั้ง');
  });
  for (const viewerMay of ['open', 'none'] as const) it(`keeps the server reservation next step when the viewer may ${viewerMay}`, async () => {
    const { expenseDisbursementReservationMessage } = await import('@watchdog-bms/contracts');
    const reservation = { voucherId: viewerMay === 'open' ? 'voucher' : null, documentNumber: 'DV-1', preparerName: 'สมใจ', viewerMay, viewerCanPay: false };
    for (const operation of ['recordPayment', 'reopen', 'void'] as const) {
      const sentence = expenseDisbursementReservationMessage(operation, reservation.documentNumber, reservation.preparerName, viewerMay, reservation.viewerCanPay);
      assert.equal(apiErrorMessage({ code: 'expense_disbursement_reserved', message: sentence, status: 409 }), sentence);
      assert.doesNotMatch(sentence, /ให้บันทึกจ่ายจากใบนั้น/);
      if (viewerMay === 'none') assert.doesNotMatch(sentence, /กลับไปแก้/);
    }
  });
});

it('keeps the receipt file refusal specific to payment, posting, review permission and final state', () => {
  for (const message of [
    'รายจ่ายนี้ยืนยันแล้ว กดแก้ไขเอกสารก่อนแนบหลักฐานเพิ่ม',
    'รายจ่ายนี้ปิดแล้ว แนบหลักฐานให้รายจ่ายที่ยังเปิดตรวจอยู่หรือสร้างรายจ่ายใหม่',
    'รายจ่ายนี้ส่งให้ตรวจแล้ว ให้คนที่มีสิทธิ์ตรวจรายจ่ายเปลี่ยนไฟล์ใบเสร็จให้',
    'รายจ่ายนี้บันทึกจ่ายแล้ว เปลี่ยนใบเสร็จหลักไม่ได้ ให้แนบเป็นหลักฐานเพิ่ม',
    'รายจ่ายนี้บันทึกบัญชีแล้ว ให้คนที่ดูแลบัญชีแก้รายการบัญชีก่อนแนบหรือเปลี่ยนไฟล์',
  ]) {
    assert.equal(apiErrorMessage({ code: 'expense_receipt_replace_locked', message }), message);
    assert.equal(apiErrorMessage({ details: { code: 'expense_receipt_replace_locked', message } }), message);
    assert.doesNotMatch(message, /กรุณา|ดำเนินการ/);
  }
});

it('names both review fields and both ways to fix an incompatible withholding income type', () => {
  const text = apiErrorMessage({ code: 'expense_wht_category_payee_mismatch' });
  assert.equal(text, 'เลือก “จ่ายค่าอะไร” ให้ตรงกับผู้รับเงิน หรือแก้ “ผู้รับเงินเป็นใคร”');
});

it('PWS-ERROR code and regex period refusals agree and unknown facts stay unknown', () => {
  const accounting = 'ยกเลิกเอกสารของเดือน 09/2569 ไม่ได้ ให้ผู้ทำบัญชีตรวจรายการนี้ต่อ';
  assert.equal(translateApiError('accounting_period_locked:2026-09'), accounting);
  assert.equal(translateApiError('Accounting period 2026-09 is not open; reopen it before voiding.'), accounting);
  assert.equal(apiErrorMessage({ code: 'accounting_period_locked', details: { periodKey: '2026-09' } }), accounting);
  const tax = 'แก้รายการในรอบภาษี ภ.ง.ด.3 เดือน 09/2569 ไม่ได้ ให้ผู้ทำบัญชีตรวจต่อ';
  assert.equal(translateApiError('tax_period_locked:PND3:2026-09'), tax);
  assert.equal(translateApiError('PND3/2026-09 is locked; use an adjustment or amended filing workflow.'), tax);
  assert.equal(apiErrorMessage({ code: 'tax_period_locked', details: { formType: 'PND3', periodKey: '2026-09' } }), tax);
  for (const raw of ['accounting_period_locked:unknown', 'tax_period_locked:UNKNOWN:unknown', 'tax_period_locked:UNKNOWN:2026-13', 'UNKNOWN/unknown is locked; use an adjustment or amended filing workflow.']) {
    const message = translateApiError(raw)!;
    assert.ok(message); assert.doesNotMatch(message, /UNKNOWN|unknown|ภ.ง.ด.3|ภ.ง.ด.53|2569|2026-13/);
    assert.match(message, /ผู้ทำบัญชีตรวจ/);
  }
});
