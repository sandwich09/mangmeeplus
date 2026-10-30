import { THAI_SYSTEM_ROLE_NAMES } from '@watchdog-bms/contracts';
import { createHash } from 'node:crypto';
import { PRIVATE_NO_STORE } from '../middleware/api-cache-control.middleware';

export const LINE_ID_TOKEN_MAX_LENGTH = 4096;
export const LINE_ID_TOKEN_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
export const LINE_CHANNEL_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
export const COMPANY_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
export const EMPLOYEE_LINE_LINK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;

export const LIFF_PAGE_CSP = "default-src 'self'; script-src 'self' https://static.line-scdn.net; connect-src 'self' https://api.line.me; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src https://access.line.me https://liff.line.me; object-src 'none'; base-uri 'none'; form-action 'self'";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

export function validLineChannelId(value: string | null): string {
  return value && LINE_CHANNEL_ID_PATTERN.test(value) ? value : '';
}

/**
 * The one look every API-served LIFF page has had since the first one. Extracted so that adding a
 * page is writing a body, not copying a stylesheet — the P10-L pages are the third and fourth.
 *
 * The มั่งมี palette: `--brand` and `--line` are the values the LINE flex cards use
 * (`line-business-card.logic.ts`); `--ink`, `--muted` and `--brand-dark` are the web app's own ink,
 * and `--ground` is chosen here. Restated rather than imported so a security helper does not depend
 * on a feature module. Sized for a phone held in LINE: 16px body, 48px controls (below that iOS
 * zooms the page on focus), and no external font — the system Thai face is already on the device.
 *
 * CONTRAST: white on `--brand` #22C55E is 2.28:1 and fails WCAG AA, so every white-on-green
 * surface — the buttons and the header bar — uses `--brand-dark` #15803D (5.02:1) instead.
 * #22C55E survives only where nothing is written on it, as the success notice's left rule.
 * `liff-page-contrast.spec.ts` computes these ratios, so the pairing cannot regress silently.
 */
const LIFF_PAGE_STYLE = `:root{--brand:#22C55E;--brand-dark:#15803D;--ink:#101828;--muted:#475467;--line:#E3EBE5;--ground:#F5F8F6}
    *{box-sizing:border-box}
    body{font-family:-apple-system,"Noto Sans Thai","Sarabun",sans-serif;margin:0;padding:0 0 32px;line-height:1.6;font-size:16px;color:var(--ink);background:var(--ground)}
    header.brand{display:flex;align-items:center;gap:8px;padding:10px 16px;background:var(--brand-dark);color:#fff;font-size:17px;font-weight:700}
    header.brand svg{width:28px;height:28px;flex:none}
    main{max-width:520px;width:calc(100% - 24px);margin:16px auto;background:#fff;border:1px solid var(--line);border-radius:12px;padding:20px}
    h1{font-size:20px;margin:0 0 8px}
    h2{font-size:18px;margin:0 0 8px}
    a{color:var(--brand-dark)}
    button,a.btn{border:0;border-radius:12px;background:var(--brand-dark);color:#fff;min-height:48px;padding:12px 20px;font:inherit;font-weight:700;width:100%;display:block;text-align:center;text-decoration:none;cursor:pointer}
    a.btn+a.btn{margin-top:8px}
    [hidden]{display:none!important}
    button:disabled{opacity:.5}
    pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--ground);border:1px solid var(--line);border-radius:8px;padding:12px;font-size:13px;color:var(--muted)}
    /* A container with no message must not paint its own box: #detail is the last element on the
       signup page, and empty it rendered as a grey rounded rectangle under the trial line
       (Owner 2026-09-05). This covers the first paint; setStatus() then toggles [hidden]. */
    #status:empty,#detail:empty{display:none}
    /* Message tones (Owner 2026-09-05: "warning สีเหลือง / ส่งไม่สำเร็จสีแดง พร้อมคำแนะนำ").
       One box, tinted ground plus a thick left rule, at reading size in the page's own Thai face —
       never the monospace #detail box, which is for technical text only. The pre-line white-space
       is what lets setStatus() put advice on a second line with no markup. Every text/ground
       pair below is at least 9:1, well past WCAG AA's 4.5:1. The ::before icon means the tone is
       not carried by colour alone, and generated content leaves :empty above still matching. */
    .notice{margin:0 0 12px;padding:12px 14px;border-radius:10px;border-left:4px solid;white-space:pre-line;font-size:16px;line-height:1.55}
    .notice::before{margin-right:6px}
    .notice-info{background:#EFF6FF;border-color:#3B82F6;color:#1E3A8A}
    .notice-info::before{content:"ℹ️"}
    .notice-success{background:#ECFDF5;border-color:#22C55E;color:#14532D}
    .notice-success::before{content:"✅"}
    .notice-warning{background:#FEF9C3;border-color:#F59E0B;color:#713F12}
    .notice-warning::before{content:"⚠️"}
    .notice-error{background:#FEF2F2;border-color:#DC2626;color:#7F1D1D}
    .notice-error::before{content:"❌"}
    /* Field-level: the offending input says so itself, next to the caret the page just moved there. */
    .field-error{margin:6px 0 0;color:#B91C1C;font-size:14px}
    .field-error:empty{display:none}
    input[aria-invalid="true"]{border-color:#DC2626;border-width:2px}`;

/** The coin-with-sprout mark from the มั่งมี Brand Kit — the same paths `MangmeeLogo.tsx` draws. */
const MANGMEE_HEADER_HTML = `<header class="brand"><svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M24 23c0-6 0-9 0-12" stroke="#FCD34D" stroke-width="2.6" stroke-linecap="round" />
      <path d="M24 15c-1.6-3-4.4-4-7.6-3.6 .4 3.4 3.2 4.8 6 4.6" fill="#86EFAC" />
      <path d="M24 13c1.6-2.6 4.2-3.4 7-3 -.3 3-2.8 4.2-5.4 4" fill="#BBF7D0" />
      <circle cx="24" cy="31" r="11" fill="#FCD34D" stroke="#FBBF24" stroke-width="1.5" />
      <path d="M24 26v10M22 28h3.2a2 2 0 0 1 0 4H22m0 0h3.6a2 2 0 0 1 0 4H22" stroke="#B45309" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none" />
    </svg><span>มั่งมีพลัส</span></header>`;

/**
 * Assembles one of these pages. `data` values are escaped here, so no caller can smuggle an extra
 * attribute through a config value; `content` is markup the controller composed and is responsible
 * for having escaped where it embedded anything untrusted.
 *
 * The two `<script>` tags are the whole script budget of a LIFF page: the SDK by origin allowlist
 * and our own same-origin client. Nothing inline, which is what lets `LIFF_PAGE_CSP` keep
 * `script-src` free of `'unsafe-inline'` (H-08).
 */
export function liffPageHtml(input: {
  title: string;
  data: Readonly<Record<string, string>>;
  content: string;
  /** Extra CSS rules for one page, appended to the shared block. */
  style?: string;
  /** Trusted same-origin client choices only; existing pages retain their script and behavior. */
  client?: 'package-advisor';
}): string {
  const attrs = Object.entries(input.data)
    .map(([key, value]) => ` data-${key}="${escapeHtml(value)}"`)
    .join('');
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(input.title)}</title>
  <style>
    ${LIFF_PAGE_STYLE}${input.style ? `\n    ${input.style}` : ''}
  </style>
</head>
<body${attrs}>
  ${MANGMEE_HEADER_HTML}
  <main>
    ${LIFF_CLIENT_NOTICE_HTML}
    <div id="liff-content">
${input.content}
    </div>
  </main>
  <script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
  <script src="${input.client === 'package-advisor' ? '/v1/auth/line/package-advisor.js' : LIFF_PAGE_SCRIPT_URL}"></script>
</body>
</html>`;
}

export const LIFF_CLIENT_NOTICE_HTML = `<section id="client-notice" data-client-compatibility-notice="generic" hidden role="alert" style="text-align:center">
  <h1>ไม่สามารถเปิด Mangmee Plus ได้</h1>
  <p>กรุณาอัปเดตระบบปฏิบัติการ เบราว์เซอร์ และ LINE เป็นเวอร์ชันล่าสุด แล้วลองอีกครั้ง หากยังใช้งานไม่ได้ กรุณาเปิดผ่านอุปกรณ์อื่นหรือติดต่อเจ้าหน้าที่</p>
  <p><strong>Mangmee Plus could not be opened.</strong> Update your operating system, browser, and LINE, then try again. If the problem continues, use another device or contact support.</p>
  <p><a class="btn" href="">ลองใหม่ / Try again</a> <a class="btn" href="mailto:contact@mangmeeplus.com">ติดต่อเจ้าหน้าที่ / Contact support</a></p>
</section>`;

/**
 * Sales-event discounts (spec §3.3, §3.5, §8): the page a booth QR opens. The body is static; the
 * script fills the ticket in with textContent after the claim answers, so nothing about the batch or
 * the person is rendered by the server. The last paragraph is the §3.5 sentence for shop staff.
 */
export const LIFF_EVENT_DISCOUNT_PAGE = {
  title: 'ส่วนลดจากงาน',
  style: '#ticket-rewards{margin:8px 0;padding-left:20px}#ticket-rewards li{margin:4px 0}#ticket-view p.note{color:var(--muted);font-size:14px}#companies button{display:block;width:100%;margin-top:8px}',
  content: `      <h1 id="ticket-title">ส่วนลดจากงาน</h1>
      <p id="status" class="notice notice-info">กำลังรับส่วนลดให้ค่ะ…</p>
      <section id="ticket-view" hidden>
        <p id="ticket-event"></p>
        <ul id="ticket-rewards"></ul>
        <p id="ticket-note" class="note" hidden></p>
        <p id="ticket-expiry"></p>
        <p><button id="open-mangmee" type="button" hidden>เปิดมั่งมี</button></p>
        <div id="companies" hidden></div>
        <p><a id="go-signup" class="btn" href="/v1/auth/line/link-page/signup" hidden>เปิดร้านใหม่</a></p>
        <p id="signup-hint" class="note" hidden>ถ้ามีบัญชีมั่งมีอยู่แล้ว ให้เข้าสู่ระบบด้วย LINE นี้ก่อน</p>
        <p class="note">ส่วนลดนี้เป็นของบัญชี LINE นี้ ใช้ได้เมื่อคุณเป็น${THAI_SYSTEM_ROLE_NAMES.OWNER}หรือผู้มีสิทธิ์จัดการแพ็กเกจของร้าน ถ้าจะใช้กับร้านที่คุณทำงานอยู่ ให้${THAI_SYSTEM_ROLE_NAMES.OWNER}หรือผู้มีสิทธิ์จัดการแพ็กเกจสแกนรับเอง</p>
      </section>
      <p><button id="link" type="button" hidden>ลองอีกครั้ง</button></p>
      <pre id="detail"></pre>`,
} as const;

// Static same-origin code: untrusted query values stay runtime data and never enter an executable HTML parser context.
export const LIFF_PAGE_SCRIPT = String.raw`'use strict';
(function () {
  const root = document.body;
  const mode = root.dataset.liffMode || '';
  const liffId = root.dataset.liffId || '';
  const apiBase = sameOriginApiBase(root.dataset.apiBase || '');
  const devMode = root.dataset.devMode === 'true';
  const oaAddUrl = root.dataset.oaAddUrl || '';
  const query = new URLSearchParams(location.search);
  /** A LINE message's link (Owner 2026-10-06): the start page opens THAT page, signed in, by itself. */
  const openTo = mode === 'start' ? (query.get('to') || '').slice(0, 512) : '';
  const statusEl = document.getElementById('status');
  const detailEl = document.getElementById('detail');
  const actionEl = document.getElementById('notice-action');
  /** Inputs that can carry their own error message; the signup form is the only page with any. */
  const FIELD_IDS = ['company-name', 'phone-number', 'contact-email', 'discovery-source', 'discovery-source-other', 'referral-sales-code'];
  const actionBtn = document.getElementById(mode === 'customer' ? 'register' : 'link');
  const openLineEl = document.getElementById('open-line');
  const noticeEl = document.getElementById('client-notice');
  const contentEl = document.getElementById('liff-content');
  // P10-L §3.2/§3.5. Signup collects before it sends, so its button submits rather than auto-running;
  // signupReady is what tells the one handler which of the two phases it is in.
  let signupReady = false;
  let signupInitialized = false;
  let signupIntent = 'FIRST_SHOP';
  let lineUserId = '';
  let savedSubmission = null;
  let lastSignupStatus = null;
  let preparedHandoffUrl = '';
  const openWebBtn = document.getElementById('open-web');

  // One sentence for every "we cannot do this right now", so a flag that is off and a service that
  // is down read the same to a shop owner — neither is their problem to diagnose.
  const UNAVAILABLE_TH = 'ตอนนี้ระบบยังเปิดให้สมัครทางนี้ไม่ได้ค่ะ ลองใหม่อีกครั้งภายหลัง หรือทักหาทีมงานได้เลยนะคะ';
  /** Spec §7 writes the window exactly this way. One copy, so the page and the LINE cards agree. */
  const BUSINESS_HOURS_TH = '(จันทร์–เสาร์ 9:00–18:00)';
  /**
   * The two refusals a shop owner cannot fix from this page: their account is suspended, or their
   * LINE identity was disabled by an admin. Retrying is not a way out of either, so the copy names
   * the people who can help instead of inviting another tap.
   */
  const SIGNUP_BLOCKED_TH = 'บัญชี LINE นี้เปิดร้านใหม่ไม่ได้ค่ะ กรุณาติดต่อทีมงาน โทร 098-256-5628 หรืออีเมล contact@mangmeeplus.com นะคะ';
  const SIGNUP_STORAGE_KEY = 'mangmee_line_signup_submission_v1';
  const START_REASON_TH = {
    suspended: 'ร้านนี้ถูกระงับการใช้งานอยู่ค่ะ ติดต่อทีมงานเพื่อเปิดใช้อีกครั้งได้นะคะ',
    expired: 'ร้านนี้ยังไม่มีแพ็กเกจที่ใช้งานได้ค่ะ เข้าสู่ระบบบนเว็บแล้วเลือกแพ็กเกจเพื่อเริ่มใช้งานได้เลยนะคะ',
    no_membership: 'บัญชี LINE นี้ยังไม่ได้อยู่ในร้านไหนค่ะ ให้${THAI_SYSTEM_ROLE_NAMES.OWNER}ส่งลิงก์เชิญให้อีกครั้งนะคะ'
  };
  /** R-C2: the two lock states a shop can be in, as the short state chip. A chip never goes inside a
   *  sentence ("ร้าน หมดอายุ"): sentences use LOCK_SENTENCE_TH, and both states are fixed the same way,
   *  by choosing a package — "ต่ออายุ" is never a customer button (glossary 2026-09-29). */
  const LOCK_LABEL_TH = { no_package: 'ยังไม่มีแพ็กเกจ', trial_ended: 'หมดอายุ' };
  const LOCK_SENTENCE_TH = { no_package: 'ยังไม่มีแพ็กเกจ', trial_ended: 'แพ็กเกจหมดอายุแล้ว' };
  const LOCK_HINT_TH = { no_package: 'เลือกแพ็กเกจเพื่อเริ่มใช้งาน', trial_ended: 'เลือกแพ็กเกจเพื่อใช้งานต่อ' };
  /** startSession() options for a locked shop: the same handoff, labelled for the package page it opens. */
  const PACKAGE_START = { buttonLabel: 'เลือกแพ็กเกจ', readyText: 'พร้อมแล้วค่ะ กดเลือกแพ็กเกจเพื่อเปิดหน้าแพ็กเกจในเบราว์เซอร์' };
  /** The row button only PREPARES the link; #open-web ("เลือกแพ็กเกจ") is what opens it. */
  const PREPARE_PACKAGE_LINK_TH = 'เตรียมลิงก์หน้าแพ็กเกจ';
  const lockKey = function (company) { return company.lockReason === 'no_package' ? 'no_package' : 'trial_ended'; };
  const lockLabel = function (company) { return LOCK_LABEL_TH[lockKey(company)]; };
  const FAIL_TITLE_TH = {
    employee: 'เชื่อม LINE ไม่สำเร็จ',
    customer: 'ลงทะเบียนไม่สำเร็จ',
    signup: 'ส่งคำขอไม่สำเร็จ',
    start: 'เปิดหน้าเว็บไม่สำเร็จ'
  };
  /**
   * A signup page that never got past liff.init has no form, so "ส่งคำขอไม่สำเร็จ" describes a
   * submit that never happened and leaves the reader with nothing to do. The commonest cause is the
   * page being opened OUTSIDE the LINE app — which is exactly what a rich-menu link does when it is
   * tapped from a browser — so the hint names that first.
   */
  const SIGNUP_INIT_FAIL_TH = 'เปิดหน้าสมัครไม่สำเร็จ';
  /** The one contact the LINE copy already gives out (line-signup-notify.service.ts). */
  const SUPPORT_TH = 'ติดต่อทีมงาน โทร 098-256-5628 หรืออีเมล contact@mangmeeplus.com (จันทร์–เสาร์ 9:00–18:00)';
  /** Owner 2026-09-05 wording, with the example that makes the rule unambiguous. */
  const PHONE_RULE_TH = 'ใส่เบอร์มือถือ 10 หลัก ขึ้นต้นด้วย 0 เช่น 0812345678';
  const EMAIL_RULE_TH = 'ใส่อีเมล${THAI_SYSTEM_ROLE_NAMES.OWNER}ให้ถูกต้อง เช่น shop@example.com ยาวไม่เกิน 254 ตัวอักษร';

  /**
   * What went wrong, and what to do about it — for every refusal this page can actually receive.
   * Keys are the codes the server really answers with; nothing here is invented, and a code that is
   * not in this table falls to GENERIC_ERROR rather than being shown raw to a shop owner.
   *
   *   field   moves the message next to the input and puts the caret there.
   *   action  offers the one button that fixes it (only a reload is ever the right answer).
   */
  const SIGNUP_GUIDANCE = {
    line_signup_phone_required: { tone: 'warning', text: 'ยังไม่ได้ใส่เบอร์มือถือ', advice: PHONE_RULE_TH, field: 'phone-number' },
    line_signup_phone_invalid: { tone: 'warning', text: 'เบอร์มือถือยังไม่ถูกต้อง', advice: PHONE_RULE_TH, field: 'phone-number' },
    line_signup_legacy_evidence_required: { tone: 'warning', text: 'คำขอเดิมยังมีข้อมูลไม่ครบ', advice: 'กดขอความช่วยเหลือด้านล่างให้เจ้าหน้าที่ตรวจคำขอเดิม หรือโทร 098-256-5628 โดยไม่ต้องสมัครซ้ำ' },
    line_signup_email_required: { tone: 'warning', text: 'ยังไม่ได้ใส่อีเมล${THAI_SYSTEM_ROLE_NAMES.OWNER}', advice: EMAIL_RULE_TH, field: 'contact-email' },
    line_signup_email_invalid: { tone: 'warning', text: 'อีเมล${THAI_SYSTEM_ROLE_NAMES.OWNER}ยังไม่ถูกต้อง', advice: EMAIL_RULE_TH, field: 'contact-email' },
    invalid_companyName: { tone: 'warning', text: 'ยังไม่ได้ใส่ชื่อร้าน', advice: 'ใส่ชื่อร้านที่ลูกค้าเรียก ยาวไม่เกิน 120 ตัวอักษรนะคะ', field: 'company-name' },
    invalid_referralCode: { tone: 'warning', text: 'โค้ดแนะนำในลิงก์ไม่ถูกต้อง', advice: 'ปิดหน้านี้แล้วเปิดใหม่จากเมนูใน LINE โดยไม่ต้องใช้ลิงก์เดิมนะคะ' },
    line_signup_discovery_source_invalid: { tone: 'warning', text: 'ช่องทางที่เลือกยังไม่ถูกต้อง', advice: 'เลือกช่องทางที่รู้จักเราจากตัวเลือกอีกครั้งนะคะ', field: 'discovery-source' },
    line_signup_discovery_other_invalid: { tone: 'warning', text: 'ช่องทางอื่น ๆ ยาวเกินไป', advice: 'ระบุช่องทางไม่เกิน 200 ตัวอักษรนะคะ', field: 'discovery-source-other' },
    // D6: the server refuses a code that belongs to nobody or to a suspended agent. Both answer
    // the same way on purpose — a customer must not be able to probe which codes exist.
    SALES_CODE_UNKNOWN: { tone: 'warning', text: 'ไม่พบรหัสเซลล์นี้', advice: 'ตรวจสอบรหัสกับเซลล์ของคุณอีกครั้งนะคะ', field: 'referral-sales-code' },
    line_signup_discovery_sales_code_invalid: { tone: 'warning', text: 'รหัสเซลล์ไม่ถูกต้อง', advice: 'รหัสเซลล์เป็นตัวอักษรหรือตัวเลข 3–6 ตัวนะคะ', field: 'referral-sales-code' },
    // The release moved under a page left open. Only a real reload re-renders the text being agreed to.
    legal_release_changed: { tone: 'warning', text: 'หน้านี้เปิดค้างไว้นาน ข้อกำหนดมีฉบับใหม่แล้ว', advice: 'แตะปุ่มด้านล่างเพื่อโหลดหน้าใหม่ แล้วยอมรับอีกครั้งนะคะ', action: 'reload' },
    line_signup_already_pending: { tone: 'info', text: 'มีคำขอเดิมรออนุมัติอยู่แล้ว', advice: 'ทีมงานกำลังตรวจสอบให้อยู่ค่ะ พร้อมใช้เมื่อไหร่จะแจ้งในแชทนี้นะคะ' },
    line_signup_submission_conflict: { tone: 'warning', text: 'ข้อมูลที่ส่งไม่ตรงกับคำขอเดิม', advice: 'แตะตรวจสอบสถานะก่อน หากต้องการเปิดร้านเพิ่มให้เลือกปุ่ม เปิดร้านเพิ่ม จากหน้าผลเดิมนะคะ' },
    line_signup_version_conflict: { tone: 'warning', text: 'คำขอนี้มีข้อมูลใหม่กว่าแล้ว', advice: 'แตะตรวจสอบสถานะ แล้วแก้จากข้อมูลล่าสุดนะคะ' },
    line_signup_contact_update_not_allowed: { tone: 'warning', text: 'ตอนนี้แก้อีเมลจากหน้านี้ไม่ได้', advice: 'ตรวจสอบสถานะล่าสุด หรือ' + SUPPORT_TH },
    line_signup_retry_not_available: { tone: 'warning', text: 'ขั้นตอนนี้ทำต่อจากหน้านี้ไม่ได้แล้ว', advice: 'แตะตรวจสอบสถานะเพื่อดูผลล่าสุดนะคะ' },
    company_signup_request_not_found: { tone: 'error', text: 'ไม่พบคำขอที่แก้ไขได้จากบัญชี LINE นี้', advice: SUPPORT_TH },
    line_signup_disabled: { tone: 'error', text: 'ตอนนี้ยังเปิดให้สมัครทางนี้ไม่ได้', advice: 'ลองใหม่อีกครั้งภายหลัง หรือ' + SUPPORT_TH },
    web_base_url_not_configured: { tone: 'error', text: 'ระบบขัดข้อง ส่งคำขอไม่สำเร็จ', advice: 'ลองใหม่อีกครั้ง หากยังไม่ได้ ' + SUPPORT_TH },
    // AUTO_FREE provisions inside the submit, so this 409 from provision-signup reaches this page.
    // The row is corrupt, not incomplete: re-sending cannot fix it, so the advice does not suggest it.
    line_signup_evidence_missing: { tone: 'error', text: 'ระบบเปิดร้านให้ไม่สำเร็จ', advice: 'ไม่ต้องส่งใหม่นะคะ ' + SUPPORT_TH },
    // From codex/line-signup-stale-identity: the account behind this LINE is suspended, or the
    // identity itself was disabled. Nothing on this page can change either, so the one honest
    // answer is who to call. SIGNUP_BLOCKED_TH is already "what went wrong AND who to call" in a
    // single sentence, so it is the whole notice — a separate advice line would only repeat it.
    line_signup_account_blocked: { tone: 'error', text: SIGNUP_BLOCKED_TH },
    line_signup_identity_disabled: { tone: 'error', text: SIGNUP_BLOCKED_TH }
  };
  /** Used only when the body carried no code we know — the status is then all we have to go on. */
  const SIGNUP_STATUS_GUIDANCE = {
    // A 400 with no code we know is the global ValidationPipe, whose message is an ARRAY of English
    // constraint strings. Never readable to a shop owner, and always a page that is out of step
    // with the DTO — so the answer is a reload, not the generic "system fault".
    400: { tone: 'warning', text: 'ข้อมูลในหน้านี้ไม่ครบ', advice: 'แตะปุ่มเพื่อโหลดใหม่ แล้วกรอกอีกครั้งนะคะ', action: 'reload' },
    401: { tone: 'error', text: 'เปิดจาก LINE ไม่สำเร็จ', advice: 'ปิดหน้านี้แล้วแตะเมนูใน LINE อีกครั้งนะคะ' },
    403: { tone: 'error', text: 'ตอนนี้ยังเปิดให้สมัครทางนี้ไม่ได้', advice: 'ลองใหม่อีกครั้งภายหลัง หรือ' + SUPPORT_TH },
    503: { tone: 'error', text: 'ระบบขัดข้องชั่วคราว', advice: 'ลองใหม่อีกครั้ง หากยังไม่ได้ ' + SUPPORT_TH }
  };
  const GENERIC_ERROR = { tone: 'error', text: 'ระบบขัดข้อง ส่งคำขอไม่สำเร็จ', advice: 'ลองใหม่อีกครั้ง หากยังไม่ได้ ' + SUPPORT_TH };
  const NETWORK_GUIDANCE = { tone: 'warning', text: 'ยังยืนยันผลการส่งไม่ได้', advice: 'ข้อมูลเดิมยังอยู่ แตะลองอีกครั้งเพื่อตรวจหรือทำคำขอเดิมต่อได้ค่ะ' };
  /** Preparing the package-page link is not a submit: nothing was sent, so NETWORK_GUIDANCE would lie. */
  const PREPARE_LINK_GUIDANCE = { tone: 'warning', text: 'ยังเตรียมลิงก์หน้าแพ็กเกจไม่สำเร็จ', advice: 'แตะ ตรวจสอบสถานะอีกครั้ง เพื่อลองใหม่ค่ะ' };
  /** The one read on open failed, so nothing is on screen yet: the retry view is the way back. */
  const STATUS_READ_GUIDANCE = { tone: 'warning', text: 'ยังโหลดสถานะคำขอไม่สำเร็จ', advice: 'แตะ ลองอีกครั้ง ด้านล่างเพื่อโหลดใหม่ค่ะ' };
  const BUSY_LABEL_TH = 'กำลังส่ง…';

  /**
   * Sales-event discounts (spec §3.3, §3.5, §7.3). What each refusal of a scan means to the person
   * holding the phone, keyed by the code the claim answers with. Nothing here names a code.
   */
  // Owner 2026-09-29 (SD-O11): a QR has no clock of its own and may be printed, so no copy here says
  // it "expired" or asks for a "new" one — only that this one does not work, and where to get one.
  const ASK_QR_TH = 'ขอ QR ของงานนี้จากทีมขายอีกครั้ง แล้วสแกนใหม่นะคะ';
  const EVENT_DISCOUNT_GUIDANCE = {
    SALES_EVENT_QR_INVALID: { tone: 'warning', text: 'QR นี้ใช้ไม่ได้', advice: ASK_QR_TH },
    SALES_EVENT_AGENT_INACTIVE: { tone: 'warning', text: 'QR นี้ใช้ไม่ได้แล้ว', advice: ASK_QR_TH },
    SALES_EVENT_CLAIM_CLOSED: { tone: 'info', text: 'งานนี้ปิดรับส่วนลดแล้ว' },
    SALES_EVENT_ISSUE_FULL: { tone: 'info', text: 'ส่วนลดของงานนี้ถูกแจกครบแล้ว' },
    SALES_EVENT_SELF_CLAIM: { tone: 'warning', text: 'บัญชีทีมขายรับส่วนลดนี้ไม่ได้' }
  };
  const EVENT_DISCOUNT_BAD_QR = { tone: 'warning', text: 'QR นี้ใช้ไม่ได้', advice: ASK_QR_TH };
  const EVENT_DISCOUNT_LINE_FAILED = { tone: 'error', text: 'เปิดจาก LINE ไม่สำเร็จ', advice: 'ปิดหน้านี้แล้วสแกน QR อีกครั้งด้วยแอป LINE นะคะ' };
  const EVENT_DISCOUNT_FAILED = { tone: 'error', text: 'รับส่วนลดไม่สำเร็จ', advice: 'แตะ ลองอีกครั้ง หากยังไม่ได้ ' + SUPPORT_TH };
  const EVENT_DISCOUNT_OPEN_FAILED = { tone: 'error', text: 'เปิดมั่งมีไม่สำเร็จ', advice: 'แตะ เปิดมั่งมี อีกครั้ง หากยังไม่ได้ ' + SUPPORT_TH };
  /** Owner 2026-09-29: event-neutral words, under the discount line only. */
  const EVENT_DISCOUNT_NOTE_TH = 'เลือกใช้หรือไม่ใช้ได้ตอนจ่าย · งานเดียวกันใช้ได้ร้านละครั้ง';
  /** Shown only when a tap had to prepare the link, because that tap opened nothing. */
  const EVENT_READY_TH = 'พร้อมแล้วค่ะ แตะ เปิดมั่งมี เพื่อเข้าร้าน';
  /** A prepared link older than this is re-prepared, not opened: the server mints it for 15 minutes.
   *  ponytail: a fixed margin; return the token's expiry from the session if it ever must be exact. */
  const EVENT_HANDOFF_FRESH_MS = 10 * 60 * 1000;
  let preparedAt = 0;
  /** One key per page load: a retry of the same scan is the same claim. */
  const eventDiscountRequestKey = mode === 'event-discount' ? newSubmissionId() : '';
  let eventDiscountShown = false;

  function compareVersion(actual, minimum) {
    const length = Math.max(actual.length, minimum.length);
    for (let index = 0; index < length; index += 1) {
      const difference = (actual[index] || 0) - (minimum[index] || 0);
      if (difference !== 0) return difference;
    }
    return 0;
  }

  function clientIsUnsupported(userAgent) {
    if (!userAgent) return false;
    const isIos = /(?:iPhone|iPad|iPod)/i.test(userAgent) || (/Macintosh/i.test(userAgent) && /Mobile\//i.test(userAgent));
    if (isIos) {
      const ios = userAgent.match(/(?:CPU(?: iPhone)? )?OS (\d+)[._](\d+)/i) || userAgent.match(/Version\/(\d+)\.(\d+)/i);
      if (ios && compareVersion([Number(ios[1]), Number(ios[2])], [15, 0]) < 0) return true;
    }
    const android = userAgent.match(/Android\s+(\d+)(?:\.(\d+))?/i);
    if (android && Number(android[1]) < 8) return true;
    const line = userAgent.match(/Line\/(\d+)\.(\d+)(?:\.(\d+))?/i);
    if (line && compareVersion([Number(line[1]), Number(line[2]), Number(line[3] || 0)], [13, 20, 0]) <= 0) return true;
    return false;
  }

  if (clientIsUnsupported(navigator.userAgent || '')) {
    if (actionBtn) actionBtn.disabled = true;
    if (contentEl) contentEl.hidden = true;
    if (noticeEl) noticeEl.hidden = false;
    return;
  }

  if (openLineEl && oaAddUrl) {
    openLineEl.href = oaAddUrl;
    openLineEl.hidden = false;
  }

  function sameOriginApiBase(value) {
    try {
      const url = new URL(value, location.href);
      return url.origin === location.origin ? url.href.replace(/\/$/, '') : '';
    } catch {
      return '';
    }
  }

  function validIdentifier(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : '';
  }

  function validChannelId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(value) ? value : '';
  }

  function validIdToken(value) {
    return typeof value === 'string' && value.length <= 4096 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
  }

  function validWatchDogToken(value) {
    return typeof value === 'string' && value.length <= 32768 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
  }

  /**
   * The only writer of the two message containers, on every page — so hiding them when they carry
   * nothing is one edit here rather than one per caller. The CSS :empty rule covers the first paint,
   * before this script runs; this covers the case :empty cannot see, which is a message that is
   * present but blank (an Error carrying only whitespace still painted an empty box).
   * No backticks in here: this whole script is a template literal.
   *
   * tone is one of info / success / warning / error and picks the notice colour. #detail stays what
   * it always was — a monospace box for TECHNICAL text — so human advice belongs in the notice, on
   * a second line, which is what the pre-line white-space on .notice renders.
   */
  function setStatus(text, detail, tone) {
    setMessage(statusEl, text);
    if (statusEl) statusEl.className = 'notice notice-' + (tone || 'info');
    setMessage(detailEl, detail || '');
  }

  /**
   * The notice plus its advice line, from one guidance entry. detail is for the cases where a
   * technical string is all anyone has to go on — a dropped connection, a body that would not
   * parse — so support still gets it in #detail while the customer reads the sentence above.
   */
  function setGuidance(entry, detail) {
    setStatus(entry.advice ? entry.text + '\n' + entry.advice : entry.text, detail || '', entry.tone);
    setFieldErrors(entry.fields || (entry.field ? { [entry.field]: entry.advice } : {}), entry.field || '');
    if (actionEl) {
      actionEl.hidden = entry.action !== 'reload';
      if (entry.action === 'reload') actionEl.textContent = 'โหลดหน้าใหม่';
    }
  }

  function setMessage(el, text) {
    if (!el) return;
    el.textContent = text;
    el.hidden = !text.trim();
  }

  /**
   * Marks the input the customer has to change, next to the caret — the message used to land in
   * #detail, which on a 390px phone is below the fold in one direction and the summary above it in
   * the other, so neither was on screen at the moment of the tap (review BLOCKER 1).
   */
  function setFieldError(inputId, message) {
    setFieldErrors(inputId && message ? { [inputId]: message } : {}, inputId);
  }

  /** Marks every missing field together; focus still goes only to the first one. */
  function setFieldErrors(messages, focusId) {
    for (let index = 0; index < FIELD_IDS.length; index += 1) {
      const id = FIELD_IDS[index];
      const input = document.getElementById(id);
      const errorEl = document.getElementById(id + '-error');
      const message = messages[id] || '';
      const active = !!message;
      setMessage(errorEl, message);
      if (!input) continue;
      if (active) {
        input.setAttribute('aria-invalid', 'true');
        if (id === focusId && input.focus) input.focus();
      } else if (input.removeAttribute) {
        input.removeAttribute('aria-invalid');
      }
    }
  }

  /** What the server said, mapped onto what the customer should do. Unknown codes stay generic. */
  function signupGuidance(status, text) {
    const body = refusalBody(text);
    const known = SIGNUP_GUIDANCE[typeof body.message === 'string' ? body.message : ''];
    if (known) return known;
    // Newer refusals carry a machine code beside the Thai sentence ({ code, message }), which is
    // the shape billing and the sales console use. Keyed lookups win over the message text.
    const byCode = SIGNUP_GUIDANCE[typeof body.code === 'string' ? body.code : ''];
    if (byCode) return byCode;
    if (status === 400 && Array.isArray(body.message) && body.message.some(function (message) {
      return typeof message === 'string' && message.indexOf('contactEmail ') === 0;
    })) return SIGNUP_GUIDANCE.line_signup_email_invalid;
    if (status === 400 && Array.isArray(body.message)) {
      if (body.message.some(function (message) { return typeof message === 'string' && message.indexOf('discoverySource ') === 0; })) return SIGNUP_GUIDANCE.line_signup_discovery_source_invalid;
      if (body.message.some(function (message) { return typeof message === 'string' && message.indexOf('discoverySourceOther ') === 0; })) return SIGNUP_GUIDANCE.line_signup_discovery_other_invalid;
      if (body.message.some(function (message) { return typeof message === 'string' && message.indexOf('referralSalesCode ') === 0; })) return SIGNUP_GUIDANCE.line_signup_discovery_sales_code_invalid;
    }
    if (status === 429) {
      const seconds = typeof body.retryAfterSeconds === 'number' ? body.retryAfterSeconds : 0;
      return {
        tone: 'warning',
        text: 'ส่งบ่อยเกินไป',
        advice: seconds > 0 ? 'รออีกประมาณ ' + seconds + ' วินาที แล้วลองใหม่อีกครั้งนะคะ' : 'รอสักครู่แล้วลองใหม่อีกครั้งนะคะ'
      };
    }
    return SIGNUP_STATUS_GUIDANCE[status] || GENERIC_ERROR;
  }

  function removeQueryParam(name) {
    const url = new URL(location.href);
    if (!url.searchParams.has(name)) return;
    url.searchParams.delete(name);
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }

  async function getWatchDogToken(watchdogUserId) {
    const stored = localStorage.getItem('watchdog_access_token');
    if (validWatchDogToken(stored)) return stored;
    if (stored) localStorage.removeItem('watchdog_access_token');
    if (!devMode) throw new Error('WatchDog session missing. Login to WatchDog first.');
    const tokenUrl = apiBase + '/auth/dev/token?fresh=' + Date.now();
    const res = await fetch(tokenUrl, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...(watchdogUserId ? { userId: watchdogUserId } : {}) })
    });
    const text = await res.text();
    if (!res.ok) throw new Error('Dev token failed: ' + res.status + '\nURL: ' + tokenUrl + '\nBody: ' + text.slice(0, 500));
    const data = JSON.parse(text);
    if (!validWatchDogToken(data.accessToken)) throw new Error('Dev token response was invalid.');
    localStorage.setItem('watchdog_access_token', data.accessToken);
    return data.accessToken;
  }

  async function initLiff() {
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(liffId)) throw new Error('LINE_LIFF_ID is not configured.');
    if (!apiBase) throw new Error('Invalid API origin.');
    setStatus(mode === 'employee' ? 'กำลังตรวจการเชื่อมต่อ LINE…' : 'กำลังเตรียมหน้าให้ค่ะ…', '', 'info');
    await liff.init({ liffId });
    if (!liff.isLoggedIn()) {
      liff.login({ redirectUri: location.href });
      return false;
    }
    return true;
  }

  function currentIdToken() {
    const decoded = liff.getDecodedIDToken();
    if (!decoded || !decoded.exp || decoded.exp * 1000 < Date.now() + 60000) {
      setStatus('กำลังเชื่อมต่อ LINE ใหม่ค่ะ…', '', 'info');
      liff.logout();
      liff.login({ redirectUri: location.href });
      return '';
    }
    const idToken = liff.getIDToken();
    if (!validIdToken(idToken)) throw new Error('LINE ID token missing or invalid.');
    return idToken;
  }

  async function linkAccount() {
    const companyId = validIdentifier(query.get('companyId'));
    const watchdogUserId = validIdentifier(query.get('watchdogUserId'));
    if (!await initLiff()) return;
    const idToken = currentIdToken();
    if (!idToken) return;
    const accessToken = await getWatchDogToken(watchdogUserId);
    setStatus('Linking...', '', 'info');
    const res = await fetch(apiBase + '/auth/line/link', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + accessToken,
        ...(companyId ? { 'x-company-id': companyId } : {})
      },
      body: JSON.stringify({ idToken, ...(companyId ? { companyId } : {}) })
    });
    const text = await res.text();
    if (!res.ok) throw new Error(text || ('Link failed: ' + res.status));
    if (oaAddUrl) {
      setStatus('Linked. Opening LINE...', '', 'success');
      setTimeout(function () { location.href = oaAddUrl; }, 800);
    } else {
      setStatus('Linked. Send LINE OA a message now.', text, 'success');
    }
  }

  async function linkEmployee() {
    const linkToken = query.get('token') || '';
    if (!/^[A-Za-z0-9_-]{32}$/.test(linkToken)) throw new Error('Missing or invalid link token. Ask your admin for a new QR code.');
    if (!await initLiff()) return;
    removeQueryParam('token');
    const idToken = currentIdToken();
    if (!idToken) return;
    setStatus('กำลังเชื่อม LINE…', '', 'info');
    const res = await fetch(apiBase + '/auth/line/employee-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: linkToken, idToken })
    });
    const text = await res.text();
    if (!res.ok) {
      let code = '';
      try { const body = JSON.parse(text); code = body.code || (body.error && body.error.code) || ''; } catch (_) {}
      if (code === 'line_identity_review_required') throw new Error('การเชื่อมต่อเดิมต้องให้ผู้ดูแลตรวจสอบ กรุณาติดต่อผู้ดูแลพร้อมแจ้งว่าต้องซ่อมการเชื่อมต่อ LINE');
      if (code === 'line_identity_changed' || code === 'line_link_retry' || res.status >= 500) throw new Error('ยังทำรายการไม่สำเร็จ แตะเชื่อม LINE เพื่อลอง QR เดิมอีกครั้ง หากหมดอายุให้ผู้ดูแลออก QR ใหม่');
      throw new Error('QR นี้ใช้กับบัญชี LINE นี้ไม่ได้ หรือหมดอายุแล้ว กรุณาใช้บัญชี LINE ที่สแกนครั้งแรก หรือติดต่อผู้ดูแลเพื่อออก QR ใหม่');
    }
    if (oaAddUrl) {
      setStatus('เชื่อม LINE สำเร็จ กำลังเปิด LINE…', '', 'success');
      openLineEl.href = oaAddUrl;
      openLineEl.hidden = false;
      setTimeout(function () { location.href = oaAddUrl; }, 800);
    } else {
      setStatus('เชื่อม LINE สำเร็จแล้ว ปิดหน้านี้และกลับไปที่ LINE ได้เลย', '', 'success');
    }
  }

  async function registerCustomer() {
    const lineChannelId = validChannelId(query.get('lineChannelId'));
    const consentEl = document.getElementById('consent');
    if (!lineChannelId) throw new Error('Missing or invalid LINE channel.');
    // Thai on purpose: a non-Thai detail is shown as UNAVAILABLE_TH, which would misname this one.
    if (!consentEl.checked) throw new Error('กรุณาติ๊กยินยอมตามประกาศความเป็นส่วนตัวก่อนนะคะ');
    if (!await initLiff()) return;
    const idToken = currentIdToken();
    if (!idToken) return;
    setStatus('กำลังลงทะเบียน…', '', 'info');
    const res = await fetch(apiBase + '/auth/line/customer-register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken, lineChannelId, consent: true })
    });
    const text = await res.text();
    if (!res.ok) throw new Error(text || ('Registration failed: ' + res.status));
    setStatus('ลงทะเบียนแล้วค่ะ ปิดหน้านี้แล้วกลับไปที่ LINE ได้เลย', '', 'success');
  }

  // Nest answers a refusal as {"message":"<code>"}; a 429 also carries retryAfterSeconds.
  function refusalBody(text) {
    try {
      const parsed = JSON.parse(text);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function refusalCode(text) {
    const message = refusalBody(text).message;
    return typeof message === 'string' ? message : '';
  }

  /** Carries a guidance entry out to runWith, which is where the button is put back. */
  function refusal(entry) {
    const error = new Error(entry.text);
    error.guidance = entry;
    return error;
  }

  function newSubmissionId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    return Array.from(bytes, function (byte, index) {
      const hex = byte.toString(16).padStart(2, '0');
      return index === 4 || index === 6 || index === 8 || index === 10 ? '-' + hex : hex;
    }).join('');
  }

  function readSavedSubmission() {
    if (!lineUserId) return null;
    try {
      const parsed = JSON.parse(localStorage.getItem(SIGNUP_STORAGE_KEY) || 'null');
      if (!parsed || parsed.lineUserId !== lineUserId || !parsed.body) return null;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed.body.submissionId || '')) return null;
      if (parsed.body.intent !== 'FIRST_SHOP' && parsed.body.intent !== 'ADD_SHOP') return null;
      return parsed.body;
    } catch {
      return null;
    }
  }

  function saveSubmission(body) {
    savedSubmission = body;
    if (!lineUserId) return;
    localStorage.setItem(SIGNUP_STORAGE_KEY, JSON.stringify({ lineUserId, body }));
  }

  function clearSavedSubmission(submissionId) {
    if (submissionId && savedSubmission && savedSubmission.submissionId !== submissionId) return;
    savedSubmission = null;
    localStorage.removeItem(SIGNUP_STORAGE_KEY);
  }

  function showOnly(viewId) {
    const views = document.querySelectorAll('[data-view]');
    for (let index = 0; index < views.length; index += 1) views[index].hidden = views[index].id !== viewId;
    // A submit button sits near the bottom of the long form. Once that form collapses, Chromium can
    // retain the old scroll offset and leave the customer looking at blank space below the result.
    if (typeof scrollTo === 'function') scrollTo(0, 0);
  }

  /** One read, on demand. Never on a timer: the answer arrives in the chat, not on this page. */
  async function readSignupStatus(idToken) {
    const res = await fetch(apiBase + '/public/line-signups/me', {
      method: 'GET',
      cache: 'no-store',
      headers: { 'x-line-id-token': idToken }
    });
    if (res.status === 403) throw new Error(UNAVAILABLE_TH);
    const text = await res.text();
    if (!res.ok) throw new Error(refusalCode(text) || ('อ่านสถานะไม่สำเร็จ: ' + res.status));
    return text ? JSON.parse(text) : null;
  }

  function resetProgressActions() {
    for (const id of ['retry-intake', 'retry-status', 'edit-email', 'add-shop', 'support', 'email-update']) {
      const el = document.getElementById(id);
      if (el) el.hidden = true;
    }
    const companiesEl = document.getElementById('existing-companies');
    if (companiesEl) companiesEl.textContent = '';
  }

  function setProgress(title, text, progress) {
    signupReady = false;
    document.getElementById('progress-title').textContent = title;
    document.getElementById('progress-text').textContent = text;
    setStatus('');
    resetProgressActions();
    if (progress && progress.canRetryIntake) document.getElementById('retry-intake').hidden = false;
    if (progress && progress.canUpdateContactEmail) document.getElementById('edit-email').hidden = false;
    showOnly('progress-view');
  }

  function showSupport() {
    const el = document.getElementById('support');
    if (el) el.hidden = false;
  }

  function renderEligibleCompanies(companies, entryCompanyId, entryOnly) {
    const listEl = document.getElementById('existing-companies');
    if (!listEl) return false;
    const ordered = (companies || []).slice().sort(function (left, right) {
      return left.companyId === entryCompanyId ? -1 : right.companyId === entryCompanyId ? 1 : 0;
    });
    let canEnter = false;
    for (let index = 0; index < ordered.length; index += 1) {
      const company = ordered[index];
      if (entryOnly && company.companyId !== entryCompanyId) continue;
      if (company.canEnter === true) {
        canEnter = true;
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = entryOnly ? 'เริ่มใช้งาน' : 'เข้าใช้ ' + company.companyName;
        button.addEventListener('click', function () {
          void runWith(function () { return startSession(company.companyId); }, button, 'กำลังเปิดร้าน…');
        });
        listEl.appendChild(button);
      } else {
        // R-C2: the state in the body text (buttons are length-limited), the fix as a short button
        // for whoever may buy; staff see the state and the support door the caller already shows.
        const note = document.createElement('p');
        note.textContent = company.companyName + ' · ' + lockLabel(company);
        listEl.appendChild(note);
        if (company.canManagePlan === true) {
          const choose = document.createElement('button');
          choose.type = 'button';
          choose.textContent = PREPARE_PACKAGE_LINK_TH;
          choose.addEventListener('click', function () {
            void runWith(function () { return preparePackageLink(company.companyId); }, choose, 'กำลังเตรียมลิงก์…');
          });
          listEl.appendChild(choose);
        }
      }
    }
    return canEnter;
  }

  /** The only mapping from a server signup state to what this page shows. */
  function renderSignupStatus(status) {
    const envelope = status && Object.prototype.hasOwnProperty.call(status, 'progress')
      ? status
      : { progress: status || null, eligibleCompanies: [] };
    const progress = envelope.progress;
    const companies = Array.isArray(envelope.eligibleCompanies) ? envelope.eligibleCompanies : [];
    lastSignupStatus = envelope;
    document.getElementById('add-shop').textContent = 'เปิดร้านเพิ่ม';

    if (!progress) {
      if (companies.length > 0) {
        setProgress('ร้านของคุณ', 'เลือกเข้าร้านเดิมได้เลยค่ะ หากต้องการร้านใหม่ ให้เลือก เปิดร้านเพิ่ม แยกต่างหาก', null);
        const entered = renderEligibleCompanies(companies, '');
        document.getElementById('add-shop').hidden = false;
        if (!entered) showSupport();
        return;
      }
      if (savedSubmission) {
        setProgress('ยังยืนยันผลการส่งไม่ได้', 'ข้อมูลที่กรอกยังอยู่ในอุปกรณ์นี้ แตะทำคำขอเดิมต่อ ระบบจะทำรายการเดิมต่อและไม่เปิดคำขอซ้ำค่ะ', null);
        document.getElementById('retry-intake').hidden = false;
        showSupport();
        return;
      }
      showSignupForm('FIRST_SHOP');
      return;
    }

    if (savedSubmission && savedSubmission.submissionId === progress.submissionId && !progress.canRetryIntake) {
      clearSavedSubmission(progress.submissionId);
    }

    const shop = progress.companyName || 'ร้านของคุณ';
    if (progress.state === 'COMPLETED') {
      const returned = progress.resolution === 'RETURN_EXISTING';
      setProgress('พร้อมเริ่มใช้งาน', returned
        ? shop + ' ใช้ต่อได้เลยค่ะ ไม่มีการเปิดร้านใหม่'
        : shop + ' เปิดสำเร็จแล้วค่ะ', progress);
      const entered = renderEligibleCompanies(companies, progress.entryCompanyId || '', true);
      if (!entered) {
        const locked = progress.lockedEntryCompanyId
          ? companies.find(function (company) { return company.companyId === progress.lockedEntryCompanyId; })
          : undefined;
        if (locked) {
          // R-C2: the shop exists and is waiting for its package. Only a shop opened just now is
          // "เปิดร้านแล้ว"; one that came back (RETURN_EXISTING) or whose package ran out says its
          // state, as a sentence — never the chip word inside one (review 2026-09-29).
          const key = lockKey(locked);
          const opened = !returned && key === 'no_package';
          const manager = locked.canManagePlan === true;
          document.getElementById('progress-title').textContent = !opened ? LOCK_SENTENCE_TH[key]
            : manager ? 'เปิดร้านแล้ว ขั้นต่อไปเลือกแพ็กเกจ' : 'เปิดร้านแล้ว รอเลือกแพ็กเกจ';
          document.getElementById('progress-text').textContent = manager
            ? shop + (opened ? ' เปิดให้แล้วค่ะ ' : ' ' + LOCK_SENTENCE_TH[key] + ' ') + LOCK_HINT_TH[key] + ' ระบบจะพาไปหน้าแพ็กเกจในเบราว์เซอร์ให้ค่ะ'
            : shop + ' ' + LOCK_SENTENCE_TH[key] + ' ให้${THAI_SYSTEM_ROLE_NAMES.OWNER}หรือผู้มีสิทธิ์จัดการแพ็กเกจเลือกแพ็กเกจก่อน แล้วเข้าใช้งานได้เลยค่ะ';
          // Prepare the handoff NOW so the primary button is one tap (GW02 only forbids opening it
          // without a gesture) — and not with #retry-status as its busy button: a tap on that very
          // button can be what rendered this, and the two overlapping runs left it "กำลังตรวจสอบ…".
          if (manager) void preparePackageLink(locked.companyId).catch(function () { setGuidance(PREPARE_LINK_GUIDANCE); });
          showSupport();
        } else {
          document.getElementById('progress-title').textContent = 'ร้านนี้ยังเข้าใช้ไม่ได้';
          document.getElementById('progress-text').textContent = 'สิทธิ์หรือแพ็กเกจปัจจุบันยังไม่พร้อมให้เข้าใช้ กรุณาติดต่อทีมงานเพื่อตรวจสอบค่ะ';
          showSupport();
        }
      }
      document.getElementById('add-shop').hidden = false;
      return;
    }

    if (progress.resolution === 'REQUEST_INFO') {
      setProgress('ต้องการข้อมูลเพิ่ม', progress.requestedInformation
        ? 'ทีมงานขอข้อมูลต่อไปนี้ให้ครบในครั้งเดียว:\n' + progress.requestedInformation
        : 'ทีมงานต้องตรวจข้อมูลเพิ่ม กรุณาแตะติดต่อเจ้าหน้าที่ด้านล่างค่ะ', progress);
      document.getElementById('retry-status').hidden = false;
      showSupport();
      return;
    }

    if (progress.resolution === 'PLAN_REVIEW') {
      setProgress('รอจัดแพ็กเกจ', shop + ' ยังไม่ถูกเปิด เพราะคำขอนี้ต้องตรวจแพ็กเกจก่อน ทีมงานจะติดต่อกลับค่ะ', progress);
      showSupport();
      return;
    }

    if (progress.state === 'RECEIVED' || progress.state === 'VALIDATED') {
      setProgress('บันทึกคำขอแล้ว', 'ข้อมูลคำขออยู่ในระบบแล้ว แต่ขั้นตอนตรวจรับยังไม่จบค่ะ', progress);
      if (!progress.canRetryIntake) {
        document.getElementById('retry-status').hidden = false;
      }
      showSupport();
      return;
    }

    if (progress.state === 'PENDING_REVIEW') {
      const timing = progress.businessHours
        ? 'ทีมงานกำลังตรวจสอบ ปกติดำเนินการให้ภายในวันทำการ ' + BUSINESS_HOURS_TH
        : 'ตอนนี้อยู่นอกเวลาทำการ ทีมงานจะดูให้ในวันทำการถัดไป ' + BUSINESS_HOURS_TH;
      setProgress('รับคำขอแล้ว', shop + ' อยู่ระหว่างตรวจสอบค่ะ ' + timing + ' พร้อมเมื่อไหร่จะแจ้งในแชทนี้นะคะ', progress);
      showSupport();
      return;
    }

    if (progress.state === 'PROVISIONING') {
      setProgress('กำลังเปิดร้าน', 'ข้อมูลคำขอบันทึกแล้ว ระบบกำลังเปิดร้านให้คุณอยู่ค่ะ', progress);
      document.getElementById('retry-status').hidden = false;
      return;
    }

    if (progress.state === 'PROVISIONING_FAILED' || progress.state === 'READY') {
      setProgress(progress.state === 'READY' ? 'เปิดร้านแล้ว แต่ยังปิดงานไม่จบ' : 'เปิดร้านยังไม่สำเร็จ',
        'ข้อมูลบันทึกไว้แล้ว ไม่ต้องสมัครใหม่ค่ะ แตะตรวจสอบสถานะอีกครั้ง หรือติดต่อทีมงานให้ทำรายการเดิมต่อ', progress);
      document.getElementById('retry-status').hidden = false;
      showSupport();
      return;
    }

    if (progress.state === 'REJECTED') {
      setProgress('คำขอก่อนหน้ายังไม่ได้รับอนุมัติ',
        'สมัครใหม่ได้ค่ะ ทีมงานจะตรวจสอบคำขอใหม่ก่อนเปิดร้านให้ โดยไม่เปิดร้านอัตโนมัติ', progress);
      renderEligibleCompanies(companies, '');
      const reapply = document.getElementById('add-shop');
      reapply.textContent = 'สมัครใหม่';
      reapply.hidden = false;
      showSupport();
      return;
    }

    if (progress.state === 'SUSPENDED' || progress.state === 'EXPIRED') {
      setProgress(progress.state === 'SUSPENDED' ? 'คำขอถูกระงับ' : 'คำขอนี้หมดอายุแล้ว',
        progress.companyCreated
          ? 'ร้านเคยเปิดสำเร็จแล้ว แต่ตอนนี้ยังเข้าใช้ไม่ได้ กรุณาติดต่อทีมงานเพื่อตรวจสิทธิ์ค่ะ'
          : 'ยังไม่ได้เปิดร้านจากคำขอนี้ กรุณาติดต่อทีมงานเพื่อตรวจสอบค่ะ', progress);
      showSupport();
      return;
    }

    setProgress('กำลังตรวจสอบคำขอ', 'ข้อมูลบันทึกแล้ว กรุณาตรวจสอบสถานะอีกครั้ง หรือติดต่อทีมงานค่ะ', progress);
    document.getElementById('retry-status').hidden = false;
    showSupport();
  }

  function showSignupForm(intent) {
    signupIntent = intent;
    signupReady = true;
    const addShop = intent === 'ADD_SHOP';
    document.getElementById('form-title').textContent = addShop ? 'เปิดร้านเพิ่ม' : 'เปิดร้านใหม่';
    actionBtn.textContent = addShop ? 'ยืนยันเปิดร้านเพิ่ม' : 'ยอมรับและเปิดร้าน';
    if (addShop) {
      clearSavedSubmission();
      document.getElementById('company-name').value = '';
      const progress = lastSignupStatus && lastSignupStatus.progress;
      document.getElementById('phone-number').value = progress && progress.phoneNumber ? progress.phoneNumber : '';
      document.getElementById('contact-email').value = progress && progress.contactEmail ? progress.contactEmail : '';
      const choices = document.querySelectorAll('input[name="discovery-source"]');
      for (let index = 0; index < choices.length; index += 1) choices[index].checked = false;
      document.getElementById('discovery-source-other').value = '';
      document.getElementById('referral-sales-code').value = '';
      toggleDiscoveryOther();
    }
    setFieldError('', '');
    setStatus('');
    showOnly('form-view');
    actionBtn.disabled = false;
  }

  /** P10-L §3.2. One read on open, then the shared status renderer. */
  async function openSignup() {
    if (!await initLiff()) return;
    signupInitialized = true;
    const idToken = currentIdToken();
    if (!idToken) return;
    const decoded = liff.getDecodedIDToken();
    lineUserId = decoded && typeof decoded.sub === 'string' ? decoded.sub : '';
    savedSubmission = readSavedSubmission();
    const greetingEl = document.getElementById('greeting');
    if (greetingEl && decoded && decoded.name) greetingEl.textContent = 'สวัสดีคุณ ' + decoded.name;
    renderSignupStatus(await readSignupStatus(idToken));
  }

  async function submitSignup() {
    setFieldError('', '');
    const companyName = savedSubmission
      ? savedSubmission.companyName
      : (document.getElementById('company-name').value || '').trim();
    const phoneNumber = savedSubmission
      ? savedSubmission.phoneNumber
      : (document.getElementById('phone-number').value || '').replace(/[^0-9]/g, '');
    const contactEmail = savedSubmission
      ? savedSubmission.contactEmail
      : (document.getElementById('contact-email').value || '').trim().toLowerCase();
    const fields = {};
    const selectedDiscovery = document.querySelector('input[name="discovery-source"]:checked');
    const discoverySource = selectedDiscovery ? selectedDiscovery.value : '';
    const discoverySourceOther = discoverySource === 'OTHER'
      ? (document.getElementById('discovery-source-other').value || '').trim() : '';
    if (discoverySourceOther.length > 200) fields['discovery-source-other'] = 'ระบุช่องทางไม่เกิน 200 ตัวอักษรนะคะ';
    // D6: only read when "เซลล์ของมั่งมี" is the answer, so switching away cannot smuggle a code.
    const referralSalesCode = discoverySource === 'SALES'
      ? (document.getElementById('referral-sales-code').value || '').trim().toUpperCase() : '';
    if (discoverySource === 'SALES' && !/^[A-Z0-9]{3,6}$/.test(referralSalesCode)) {
      fields['referral-sales-code'] = 'รหัสเซลล์เป็นตัวอักษรหรือตัวเลข 3–6 ตัวนะคะ';
    }
    if (!companyName) fields['company-name'] = 'ใส่ชื่อร้านที่ลูกค้าเรียก ยาวไม่เกิน 120 ตัวอักษรนะคะ';
    if (!/^0[0-9]{9}$/.test(phoneNumber)) fields['phone-number'] = PHONE_RULE_TH;
    if (contactEmail && ( contactEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail))) {
      fields['contact-email'] = EMAIL_RULE_TH;
    }
    const missing = savedSubmission ? [] : FIELD_IDS.filter(function (id) { return !!fields[id]; });
    if (missing.length > 0) {
      throw refusal({
        tone: 'warning',
        text: 'กรอกข้อมูลให้ครบ ' + missing.length + ' จุด',
        advice: 'แก้ช่องที่มีข้อความสีแดงให้ครบ แล้วส่งอีกครั้งนะคะ',
        fields,
        field: missing[0]
      });
    }
    const referralCode = validReferralCode(query.get('ref'));
    const idToken = currentIdToken();
    if (!idToken) return;
    const body = savedSubmission || {
      submissionId: newSubmissionId(),
      intent: signupIntent,
      companyName,
      phoneNumber,
      contactEmail,
      ...(referralCode ? { referralCode } : {}),
      ...(discoverySource ? { discoverySource, ...(discoverySourceOther ? { discoverySourceOther } : {}) } : {}),
      ...(referralSalesCode ? { referralSalesCode } : {}),
      legal: {
        documentVersion: root.dataset.legalVersion || '',
        statementSha256: root.dataset.legalStatement || '',
        releaseFingerprintSha256: root.dataset.legalRelease || '',
        displayChallenge: root.dataset.legalChallenge || '',
        locale: root.dataset.legalLocale || 'th'
      }
    };
    saveSubmission(body);
    setStatus('กำลังส่งคำขอ...', '', 'info');
    const res = await fetch(apiBase + '/public/line-signups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken, ...body })
    });
    const text = await res.text();
    if (res.status === 409 && refusalCode(text) === 'line_signup_already_pending') {
      renderSignupStatus(await readSignupStatus(idToken));
      return;
    }
    // A definite pre-admission field refusal allows correction. Unknown outcomes retain
    // the exact submission key/body so a retry cannot create a second shop.
    if (!res.ok) {
      const guidance = signupGuidance(res.status, text);
      if (res.status === 400 && FIELD_IDS.indexOf(guidance.field) >= 0) clearSavedSubmission(body.submissionId);
      throw refusal(guidance);
    }
    renderSignupStatus(JSON.parse(text));
  }

  async function refreshSignupStatus() {
    const idToken = currentIdToken();
    if (!idToken) return;
    renderSignupStatus(await readSignupStatus(idToken));
  }

  async function retrySignupIntake() {
    const progress = lastSignupStatus && lastSignupStatus.progress;
    if (!progress || !progress.canRetryIntake) return submitSignup();
    const idToken = currentIdToken();
    if (!idToken) return;
    const res = await fetch(apiBase + '/public/line-signups/' + encodeURIComponent(progress.requestId) + '/retry', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken, version: progress.version })
    });
    const text = await res.text();
    const code = refusalCode(text);
    if (res.status === 409 && (code === 'line_signup_version_conflict' || code === 'line_signup_retry_not_available')) {
      renderSignupStatus(await readSignupStatus(idToken));
      return;
    }
    if (!res.ok) throw refusal(signupGuidance(res.status, text));
    renderSignupStatus(JSON.parse(text));
  }

  function beginEmailUpdate() {
    const progress = lastSignupStatus && lastSignupStatus.progress;
    if (!progress || !progress.canUpdateContactEmail) return;
    const input = document.getElementById('updated-contact-email');
    input.value = progress.contactEmail || '';
    setMessage(document.getElementById('updated-contact-email-error'), '');
    document.getElementById('email-update').hidden = false;
    document.getElementById('edit-email').hidden = true;
    if (input.focus) input.focus();
  }

  async function updateContactEmail() {
    const progress = lastSignupStatus && lastSignupStatus.progress;
    if (!progress || !progress.canUpdateContactEmail) throw refusal(SIGNUP_GUIDANCE.line_signup_contact_update_not_allowed);
    const input = document.getElementById('updated-contact-email');
    const contactEmail = (input.value || '').trim().toLowerCase();
    if (contactEmail && ( contactEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail))) {
      setMessage(document.getElementById('updated-contact-email-error'), EMAIL_RULE_TH);
      input.setAttribute('aria-invalid', 'true');
      if (input.focus) input.focus();
      throw refusal({ tone: 'warning', text: SIGNUP_GUIDANCE.line_signup_email_invalid.text, advice: EMAIL_RULE_TH });
    }
    input.removeAttribute('aria-invalid');
    setMessage(document.getElementById('updated-contact-email-error'), '');
    const idToken = currentIdToken();
    if (!idToken) return;
    const res = await fetch(apiBase + '/public/line-signups/' + encodeURIComponent(progress.requestId) + '/contact-email', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken, version: progress.version, contactEmail })
    });
    const text = await res.text();
    if (!res.ok) throw refusal(signupGuidance(res.status, text));
    renderSignupStatus(JSON.parse(text));
  }

  function eventDiscountGuidance(status, text) {
    const body = refusalBody(text);
    const known = EVENT_DISCOUNT_GUIDANCE[typeof body.code === 'string' ? body.code : ''];
    if (known) return known;
    if (status === 401) return EVENT_DISCOUNT_LINE_FAILED;
    if (status === 429) return { tone: 'warning', text: 'สแกนบ่อยเกินไป', advice: 'รอสักครู่แล้วแตะ ลองอีกครั้ง นะคะ' };
    return EVENT_DISCOUNT_FAILED;
  }

  function thaiNumber(value) {
    return Number(value).toLocaleString('th-TH', { maximumFractionDigits: 2 });
  }

  /**
   * Spec §3.3, Owner 2026-09-29: the discount only, in words that fit any event — credit for shops
   * that already pay is withdrawn for now, so the page promises none, even on a ticket that has some.
   */
  function eventDiscountRewardLines(ticket) {
    return ticket.discountSatang > 0 ? ['ส่วนลด ' + thaiNumber(ticket.discountSatang / 100) + ' บาท ใช้ตอนจ่ายค่าแพ็กเกจ'] : [];
  }

  function renderEventDiscount(result) {
    const ticket = result && result.ticket;
    if (!ticket || typeof ticket.eventName !== 'string') throw refusal(EVENT_DISCOUNT_FAILED);
    setStatus('');
    // textContent only: the event name is typed by the sales team.
    document.getElementById('ticket-title').textContent = 'รับส่วนลดแล้ว';
    document.getElementById('ticket-event').textContent = 'งาน ' + ticket.eventName;
    const rewardsEl = document.getElementById('ticket-rewards');
    rewardsEl.textContent = '';
    const lines = eventDiscountRewardLines(ticket);
    for (let index = 0; index < lines.length; index += 1) {
      const item = document.createElement('li');
      item.textContent = lines[index];
      rewardsEl.appendChild(item);
    }
    setMessage(document.getElementById('ticket-note'), lines.length > 0 ? EVENT_DISCOUNT_NOTE_TH : '');
    const until = new Date(ticket.expiresAt).toLocaleString('th-TH', {
      timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    document.getElementById('ticket-expiry').textContent = 'ใช้ได้ถึง ' + until;
    const hasAccount = result.next === 'OPEN_PACKAGE';
    document.getElementById('open-mangmee').hidden = !hasAccount;
    document.getElementById('go-signup').hidden = hasAccount;
    document.getElementById('signup-hint').hidden = hasAccount;
    document.getElementById('ticket-view').hidden = false;
    eventDiscountShown = true;
    if (actionBtn) actionBtn.hidden = true;
  }

  /** Spec §3.3 steps 2–4. The QR token is read from this page's own query and posted, never logged. */
  async function claimEventDiscount() {
    const qrToken = query.get('t') || '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(qrToken)) throw refusal(EVENT_DISCOUNT_BAD_QR);
    let idToken = '';
    try {
      if (!await initLiff()) return;
      idToken = currentIdToken();
    } catch {
      throw refusal(EVENT_DISCOUNT_LINE_FAILED);
    }
    if (!idToken) return;
    setStatus('กำลังรับส่วนลดให้ค่ะ…', '', 'info');
    let res;
    let text = '';
    try {
      res = await fetch(apiBase + '/public/event-discounts/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idToken, qrToken, requestKey: eventDiscountRequestKey })
      });
      text = await res.text();
    } catch {
      throw refusal(EVENT_DISCOUNT_FAILED);
    }
    if (!res.ok) throw refusal(eventDiscountGuidance(res.status, text));
    let result = null;
    try { result = JSON.parse(text); } catch { throw refusal(EVENT_DISCOUNT_FAILED); }
    renderEventDiscount(result);
    // One tap (Owner 2026-09-29): preparing the handoff needs no gesture — only opening it does.
    if (result.next === 'OPEN_PACKAGE') void prepareMangmee('', true);
  }

  /**
   * "เปิดมั่งมี" is the event page's one button. Right after the claim this prepares the start page's
   * own handoff with no tap, so the button's first tap opens it. When no fresh link is ready — this
   * failed, the link went stale, or a shop was just picked — a tap prepares it here and the next tap
   * opens it, the two-tap path this page always had.
   */
  function prepareMangmee(companyId, auto) {
    const button = document.getElementById('open-mangmee');
    if (!button) return Promise.resolve();
    button.hidden = false;
    return runWith(async function () {
      await startSession(companyId);
      // Several shops and no chat context: the list is the next tap, not this button.
      if (!document.getElementById('companies').hidden) button.hidden = true;
      if (auto && preparedHandoffUrl) setStatus('');
    }, button, 'กำลังเปิด…');
  }

  function validReferralCode(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : '';
  }

  // Prepare on the network, then open synchronously from a user gesture. A normal anchor would
  // consume this single-use credential in LINE's browser, leaving Safari/Chrome signed out.
  async function startSession(companyId, opts) {
    preparedHandoffUrl = '';
    if (openWebBtn) openWebBtn.hidden = true;
    for (const id of ['companies', 'go-signup']) {
      const element = document.getElementById(id);
      if (element) element.hidden = true;
    }
    // The event page gets here only after its claim started LIFF; starting it again, or saying
    // "กำลังเปิดหน้าเว็บ" before any tap, would only push the ticket down under a status box.
    const eventPage = mode === 'event-discount';
    if (!eventPage && !await initLiff()) return;
    const idToken = currentIdToken();
    if (!idToken) return;
    if (!eventPage) setStatus('กำลังเปิดหน้าเว็บ...', '', 'info');
    const res = await fetch(apiBase + '/auth/line/liff/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // The event page is there to use the discount: the server lands a plan manager on the package page.
      body: JSON.stringify({ idToken, ...(companyId ? { companyId } : {}), ...(eventPage ? { landing: 'package' } : {}), ...(openTo ? { to: openTo } : {}) })
    });
    const text = await res.text();
    if (res.status === 403 || res.status === 503) throw new Error(UNAVAILABLE_TH);
    if (!res.ok) throw new Error(refusalCode(text) || ('เปิดหน้าเว็บไม่สำเร็จ: ' + res.status));
    const session = JSON.parse(text);
    // No signed-in way in for this LINE account: the link still opens, through the web's own login.
    if (typeof session.fallbackUrl === 'string' && session.fallbackUrl && openWebBtn) {
      preparedHandoffUrl = session.fallbackUrl;
      openWebBtn.textContent = 'เข้าสู่ระบบบนเว็บ';
      openWebBtn.hidden = false;
    }
    if (session.needsSignup) {
      setStatus('ยังไม่มีร้านที่ผูกกับ LINE นี้ค่ะ เปิดร้านใหม่ได้เลยนะคะ', '', 'info');
      const signupEl = document.getElementById('go-signup');
      if (signupEl) signupEl.hidden = false;
      return;
    }
    if (session.needsSelection) {
      renderCompanyChoices(session.companies || []);
      return;
    }
    if (session.reason) {
      setStatus(START_REASON_TH[session.reason] || UNAVAILABLE_TH, '', 'warning');
      return;
    }
    const handoffUrl = typeof session.handoffUrl === 'string' ? session.handoffUrl : '';
    if (!handoffUrl) throw new Error(UNAVAILABLE_TH);
    if (!eventPage && !openWebBtn) throw new Error(UNAVAILABLE_TH);
    preparedHandoffUrl = handoffUrl;
    preparedAt = Date.now();
    // "เปิดมั่งมี" opens it (prepareMangmee); the event page has no second button.
    if (eventPage) {
      setStatus(EVENT_READY_TH, '', 'info');
      return;
    }
    // R-C3: the server lands a locked shop's plan manager on the package page; the button says so.
    const labels = opts || (session.packagePage === true ? PACKAGE_START : null);
    openWebBtn.textContent = (labels && labels.buttonLabel) || 'เปิดหน้าเว็บ';
    openWebBtn.hidden = false;
    setStatus((labels && labels.readyText) || 'พร้อมแล้วค่ะ กดเปิดหน้าเว็บเพื่อเข้าร้าน', '', 'info');
    if (openTo) autoOpenPrepared();
  }

  /**
   * A link from a LINE message was already tapped once, in the chat: open it without a second tap.
   * ponytail: not proved on a device that LINE opens the outside browser with no tap on this page,
   * so the button above stays on screen with the same unspent link as the second way.
   */
  function autoOpenPrepared() {
    const url = preparedHandoffUrl;
    if (!liff.isInClient()) {
      preparedHandoffUrl = '';
      location.replace(url);
      return;
    }
    // Hidden = the outside browser took over, so the link is spent; back in LINE, this page is done.
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden' && preparedHandoffUrl === url) {
        preparedHandoffUrl = '';
        if (openWebBtn) openWebBtn.hidden = true;
      } else if (document.visibilityState === 'visible' && !preparedHandoffUrl) {
        try { liff.closeWindow(); } catch { /* the page stays; "ลองอีกครั้ง" makes a new link */ }
      }
    });
    try { liff.openWindow({ url, external: true }); } catch { /* the button is still there */ }
  }

  /** Signup mode's one way to a fresh link. Every sentence about a new link names this button, so
   *  it is shown wherever such a sentence can appear. */
  function showStatusRetry() {
    const el = document.getElementById('retry-status');
    if (el) el.hidden = false;
  }

  /** Signup mode: prepare a locked shop's package-page handoff. A failure is a link not prepared yet,
   *  never "ยังยืนยันผลการส่งไม่ได้" — nothing was sent (review 2026-09-29). */
  function preparePackageLink(companyId) {
    showStatusRetry();
    return startSession(companyId, PACKAGE_START).catch(function () { throw refusal(PREPARE_LINK_GUIDANCE); });
  }

  /** Where a customer gets a new link: signup mode has no "ลองอีกครั้ง" button on screen. */
  const NEW_LINK_TH = mode === 'signup' ? 'แตะ ตรวจสอบสถานะอีกครั้ง เพื่อรับลิงก์ใหม่ค่ะ'
    : mode === 'event-discount' ? 'แตะ เปิดมั่งมี อีกครั้งเพื่อรับลิงก์ใหม่ค่ะ' : 'ให้กดลองอีกครั้งเพื่อเปิดลิงก์ใหม่ค่ะ';

  if (openWebBtn) openWebBtn.addEventListener('click', function (event) {
    event.preventDefault();
    if (preparedHandoffUrl) openPreparedHandoff();
  });

  /** Opens the prepared single-use link, once, inside the tap that called this (GW02). */
  function openPreparedHandoff() {
    const url = preparedHandoffUrl;
    preparedHandoffUrl = '';
    if (openWebBtn) openWebBtn.hidden = true;
    if (mode === 'signup') showStatusRetry();
    try {
      if (liff.isInClient()) liff.openWindow({ url, external: true });
      else location.assign(url);
      setStatus('หากหน้าเว็บยังไม่เปิด หรือกลับมาใช้ลิงก์เดิม ' + NEW_LINK_TH, '', 'info');
    } catch {
      setStatus('ยังเปิดหน้าเว็บไม่ได้ค่ะ ' + NEW_LINK_TH, '', 'warning');
    }
  }

  function renderCompanyChoices(companies) {
    const listEl = document.getElementById('companies');
    if (!listEl) return;
    listEl.textContent = '';
    for (let index = 0; index < companies.length; index += 1) {
      const company = companies[index];
      const button = document.createElement('button');
      // textContent, never innerHTML: a shop name is customer-typed data on a page with no CSP escape.
      // R-C2/R-C3: a locked shop says so in the button; the server decides its landing (billing or renew).
      button.textContent = company.name + (company.lockReason ? ' · ' + lockLabel(company) : '');
      button.addEventListener('click', function () {
        listEl.hidden = true;
        // Event page: the shop tap prepares on "เปิดมั่งมี", whose next tap opens it.
        if (mode === 'event-discount') void prepareMangmee(company.id, false);
        else void runWith(function () { return startSession(company.id); });
      });
      listEl.appendChild(button);
    }
    listEl.hidden = false;
    setStatus('เลือกร้านที่จะเปิดค่ะ', '', 'info');
  }

  async function runWith(action, activeButton, busyLabel) {
    // The label is restored on every failure, so a customer who fixes a typo taps the same button
    // that invited them in the first place — and cannot double-submit while one is in flight.
    const button = activeButton || actionBtn;
    const label = button ? button.textContent : '';
    if (button) {
      button.disabled = true;
      if (mode === 'signup') button.textContent = busyLabel || (signupReady ? BUSY_LABEL_TH : label);
    }
    try {
      await action();
      // A secondary button that showed a busy label gets its words and its tap back on success; the
      // form's own button keeps the existing rule (the view moves on and re-enables it itself).
      if (button && busyLabel) { button.textContent = label; button.disabled = false; }
    } catch (error) {
      // A refusal we understand carries its own guidance. Signup always keeps implementation
      // details off the customer page and gives one natural next step.
      if (error && error.guidance) {
        setGuidance(error.guidance);
      } else if (mode === 'signup' && signupInitialized && lastSignupStatus === null) {
        // The one read on open failed, so no view is on screen: without the retry view this page
        // had no button at all.
        setGuidance(STATUS_READ_GUIDANCE);
        showOnly('retry-view');
      } else if (mode === 'signup' && signupInitialized) {
        setGuidance(NETWORK_GUIDANCE);
      } else if (mode === 'signup') {
        // signupReady is false until the form is on screen, so this is precisely the init phase.
        setStatus(SIGNUP_INIT_FAIL_TH + '\n' + 'ปิดหน้านี้แล้วแตะเมนูใน LINE อีกครั้งนะคะ', '', 'error');
        showOnly('retry-view');
      } else if (mode === 'employee') {
        const detail = errorDetail(error);
        setStatus(FAIL_TITLE_TH.employee, /^(การเชื่อมต่อเดิม|ยังทำรายการ|QR นี้)/.test(detail) ? detail : 'กรุณาแตะเชื่อม LINE เพื่อลอง QR เดิมอีกครั้ง หากหมดอายุหรือใช้บัญชี LINE ไม่ตรง ให้ผู้ดูแลออก QR ใหม่', 'error');
      } else if (mode === 'event-discount') {
        // Every claim failure arrives as guidance above, so this is the "เปิดมั่งมี" step.
        setGuidance(EVENT_DISCOUNT_OPEN_FAILED);
      } else {
        // A customer reads #detail too: a server string with no Thai in it (a code, an English
        // message) becomes the one plain sentence instead.
        const detail = errorDetail(error);
        setStatus(FAIL_TITLE_TH[mode] || 'ทำรายการไม่สำเร็จ', /[ก-๙]/.test(detail) ? detail : UNAVAILABLE_TH, 'error');
      }
      if (button) {
        button.textContent = label;
        button.disabled = false;
      }
      // The scan page's retry re-runs the claim; it is offered only while no ticket is on screen.
      if (mode === 'event-discount' && actionBtn && !eventDiscountShown) actionBtn.hidden = false;
    } finally {
      if (button && (mode === 'start' || button.id === 'start-existing')) button.disabled = false;
    }
  }

  function errorDetail(error) {
    return error && error.message ? error.message : String(error);
  }

  function run() {
    return runWith(async function () {
      if (mode === 'account') await linkAccount();
      else if (mode === 'employee') await linkEmployee();
      else if (mode === 'customer') await registerCustomer();
      else if (mode === 'start') await startSession('');
      else if (mode === 'signup') await (signupReady ? submitSignup() : openSignup());
      else if (mode === 'event-discount') await claimEventDiscount();
      else throw new Error('Invalid LIFF page mode.');
    });
  }

  if (actionBtn) actionBtn.addEventListener('click', run);
  function toggleDiscoveryOther() {
    const selected = document.querySelector('input[name="discovery-source"]:checked');
    const show = !!selected && selected.value === 'OTHER';
    document.getElementById('discovery-other-fields').hidden = !show;
    document.getElementById('discovery-source-other').disabled = !show;
    // D6: the sales-code field follows the "เซลล์ของมั่งมี" choice the same way.
    const showSales = !!selected && selected.value === 'SALES';
    const salesFields = document.getElementById('discovery-sales-fields');
    if (salesFields) {
      salesFields.hidden = !showSales;
      document.getElementById('referral-sales-code').disabled = !showSales;
    }
  }
  const discoveryGroup = document.getElementById('discovery-source');
  if (discoveryGroup) {
    discoveryGroup.addEventListener('change', toggleDiscoveryOther);
    toggleDiscoveryOther();
  }
  const retryStatusBtn = document.getElementById('retry-status');
  if (retryStatusBtn) retryStatusBtn.addEventListener('click', function () {
    void runWith(refreshSignupStatus, retryStatusBtn, 'กำลังตรวจสอบ…');
  });
  const retryIntakeBtn = document.getElementById('retry-intake');
  if (retryIntakeBtn) retryIntakeBtn.addEventListener('click', function () {
    void runWith(retrySignupIntake, retryIntakeBtn, 'กำลังทำคำขอเดิมต่อ…');
  });
  const addShopBtn = document.getElementById('add-shop');
  if (addShopBtn) addShopBtn.addEventListener('click', function () {
    const reapplying = lastSignupStatus && lastSignupStatus.progress && lastSignupStatus.progress.state === 'REJECTED';
    if (reapplying) clearSavedSubmission();
    const hasCompanies = lastSignupStatus && lastSignupStatus.eligibleCompanies.length > 0;
    showSignupForm(reapplying && !hasCompanies ? 'FIRST_SHOP' : 'ADD_SHOP');
    if (reapplying) {
      document.getElementById('form-title').textContent = 'สมัครเปิดร้านอีกครั้ง';
      actionBtn.textContent = 'ส่งคำขอให้ทีมงานตรวจสอบ';
      setStatus('ทีมงานจะตรวจสอบคำขอใหม่ก่อนเปิดร้านให้ค่ะ', '', 'info');
    }
  });
  const openMangmeeBtn = document.getElementById('open-mangmee');
  if (openMangmeeBtn) openMangmeeBtn.addEventListener('click', function () {
    // A fresh link opens inside this very tap; a stale or missing one is prepared on it instead.
    if (preparedHandoffUrl && Date.now() - preparedAt < EVENT_HANDOFF_FRESH_MS) openPreparedHandoff();
    else void prepareMangmee('', false);
  });
  const startExistingBtn = document.getElementById('start-existing');
  if (startExistingBtn) startExistingBtn.addEventListener('click', function () {
    void runWith(function () { return startSession(''); }, startExistingBtn, 'กำลังค้นหาร้าน…');
  });
  const editEmailBtn = document.getElementById('edit-email');
  if (editEmailBtn) editEmailBtn.addEventListener('click', beginEmailUpdate);
  const saveEmailBtn = document.getElementById('save-email');
  if (saveEmailBtn) saveEmailBtn.addEventListener('click', function () {
    void runWith(updateContactEmail, saveEmailBtn, 'กำลังบันทึก…');
  });
  // The signup page's own button lives inside the form, which an init failure never renders — so
  // the retry that recovers from it needs a control of its own.
  // The only guidance action there is: a release that moved needs the SERVER to re-render the page,
  // so re-running the client would keep posting the stale legal attributes.
  if (actionEl) actionEl.addEventListener('click', function () { location.reload(); });
  const retryBtn = document.getElementById('retry');
  if (retryBtn) {
    retryBtn.addEventListener('click', function () {
      showOnly('');
      void run();
    });
  }
  // The "ปิด" buttons on the done and waiting cards. Without this they were decoration: a LIFF page
  // has no browser chrome to close it with, so the customer was left staring at a finished screen.
  const closeButtons = document.querySelectorAll('[data-close]');
  for (let index = 0; index < closeButtons.length; index += 1) {
    closeButtons[index].addEventListener('click', function () {
      try {
        liff.closeWindow();
      } catch {
        // Opened outside the LINE client (a shared link, a desktop browser): nothing to close.
      }
    });
  }
  if (mode !== 'customer') void run();
})();
`;

/**
 * The script's content version, taken once at load, and the only URL a page names it by: a deploy
 * that changes the script changes the URL, so a phone can never pair a fresh page with an old script.
 * UAT 2026-09-29: the bare URL answered `no-cache`, which Cloudflare rewrites on a `.js` into its own
 * 4-hour browser TTL (`max-age=14400`), so LINE's browser kept the morning's script after a deploy.
 */
export const LIFF_PAGE_SCRIPT_VERSION = createHash('sha256').update(LIFF_PAGE_SCRIPT).digest('hex').slice(0, 12);
export const LIFF_PAGE_SCRIPT_URL = `/v1/auth/line/link-page.js?v=${LIFF_PAGE_SCRIPT_VERSION}`;

/**
 * The versioned URL pins its bytes, so it may be kept for a year — and a max-age above Cloudflare's
 * 4-hour browser TTL is the value Cloudflare passes through unchanged (it replaces anything lower,
 * `no-cache` included). Any other `v` (a page from before a deploy, or none) gets today's bytes
 * uncached, so nothing stale is ever stored under a version it does not match.
 */
export function liffPageScriptCacheControl(version: unknown): string {
  return version === LIFF_PAGE_SCRIPT_VERSION ? 'public, max-age=31536000, immutable' : PRIVATE_NO_STORE;
}
