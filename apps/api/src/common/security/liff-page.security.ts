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
  <script src="/v1/auth/line/link-page.js"></script>
</body>
</html>`;
}

export const LIFF_CLIENT_NOTICE_HTML = `<section id="client-notice" data-client-compatibility-notice="generic" hidden role="alert" style="text-align:center">
  <h1>ไม่สามารถเปิด Mangmee Plus ได้</h1>
  <p>กรุณาอัปเดตระบบปฏิบัติการ เบราว์เซอร์ และ LINE เป็นเวอร์ชันล่าสุด แล้วลองอีกครั้ง หากยังใช้งานไม่ได้ กรุณาเปิดผ่านอุปกรณ์อื่นหรือติดต่อเจ้าหน้าที่</p>
  <p><strong>Mangmee Plus could not be opened.</strong> Update your operating system, browser, and LINE, then try again. If the problem continues, use another device or contact support.</p>
  <p><a class="btn" href="">ลองใหม่ / Try again</a> <a class="btn" href="mailto:contact@mangmeeplus.com">ติดต่อเจ้าหน้าที่ / Contact support</a></p>
</section>`;

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
  const statusEl = document.getElementById('status');
  const detailEl = document.getElementById('detail');
  const actionEl = document.getElementById('notice-action');
  /** Inputs that can carry their own error message; the signup form is the only page with any. */
  const FIELD_IDS = ['company-name', 'phone-number'];
  const actionBtn = document.getElementById(mode === 'customer' ? 'register' : 'link');
  const openLineEl = document.getElementById('open-line');
  const noticeEl = document.getElementById('client-notice');
  const contentEl = document.getElementById('liff-content');
  // P10-L §3.2/§3.5. Signup collects before it sends, so its button submits rather than auto-running;
  // signupReady is what tells the one handler which of the two phases it is in.
  let signupReady = false;

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
  /** States in which an application is still travelling — the page shows status, not the form. */
  const OPEN_SIGNUP_STATES = ['RECEIVED', 'VALIDATED', 'PENDING_REVIEW', 'PROVISIONING', 'READY', 'PROVISIONING_FAILED'];
  const START_REASON_TH = {
    suspended: 'ร้านนี้ถูกระงับการใช้งานอยู่ค่ะ ติดต่อทีมงานเพื่อเปิดใช้อีกครั้งได้นะคะ',
    expired: 'ช่วงทดลองใช้ของร้านนี้หมดอายุแล้วค่ะ พิมพ์ ขอเปลี่ยนแพ็กเกจ ในแชทได้เลย ทีมงานจะติดต่อกลับนะคะ',
    no_membership: 'บัญชี LINE นี้ยังไม่ได้อยู่ในร้านไหนค่ะ ให้เจ้าของร้านส่งลิงก์เชิญให้อีกครั้งนะคะ'
  };
  const FAIL_TITLE_TH = {
    customer: 'Registration failed',
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
    invalid_companyName: { tone: 'warning', text: 'ยังไม่ได้ใส่ชื่อร้าน', advice: 'ใส่ชื่อร้านที่ลูกค้าเรียก ยาวไม่เกิน 120 ตัวอักษรนะคะ', field: 'company-name' },
    invalid_referralCode: { tone: 'warning', text: 'โค้ดแนะนำในลิงก์ไม่ถูกต้อง', advice: 'ปิดหน้านี้แล้วเปิดใหม่จากเมนูใน LINE โดยไม่ต้องใช้ลิงก์เดิมนะคะ' },
    // The release moved under a page left open. Only a real reload re-renders the text being agreed to.
    legal_release_changed: { tone: 'warning', text: 'หน้านี้เปิดค้างไว้นาน ข้อกำหนดมีฉบับใหม่แล้ว', advice: 'แตะปุ่มด้านล่างเพื่อโหลดหน้าใหม่ แล้วยอมรับอีกครั้งนะคะ', action: 'reload' },
    line_signup_already_pending: { tone: 'info', text: 'มีคำขอเดิมรออนุมัติอยู่แล้ว', advice: 'ทีมงานกำลังตรวจสอบให้อยู่ค่ะ พร้อมใช้เมื่อไหร่จะแจ้งในแชทนี้นะคะ' },
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
  const NETWORK_GUIDANCE = { tone: 'warning', text: 'เชื่อมต่อไม่สำเร็จ', advice: 'ตรวจสัญญาณอินเทอร์เน็ต แล้วแตะปุ่มเพื่อลองใหม่อีกครั้งนะคะ' };
  const BUSY_LABEL_TH = 'กำลังส่ง…';

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
    setFieldError(entry.field || '', entry.field ? entry.advice : '');
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
    for (let index = 0; index < FIELD_IDS.length; index += 1) {
      const id = FIELD_IDS[index];
      const input = document.getElementById(id);
      const errorEl = document.getElementById(id + '-error');
      const active = id === inputId && !!message;
      setMessage(errorEl, active ? message : '');
      if (!input) continue;
      if (active) {
        input.setAttribute('aria-invalid', 'true');
        if (input.focus) input.focus();
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
    setStatus('Initializing LIFF...', '', 'info');
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
      setStatus('Refreshing LINE session...', '', 'info');
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
    setStatus('Linking...', '', 'info');
    const res = await fetch(apiBase + '/auth/line/employee-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: linkToken, idToken })
    });
    const text = await res.text();
    if (!res.ok) throw new Error(text || ('Link failed: ' + res.status));
    if (oaAddUrl) {
      setStatus('Linked. Opening LINE...', '', 'success');
      openLineEl.href = oaAddUrl;
      openLineEl.hidden = false;
      setTimeout(function () { location.href = oaAddUrl; }, 800);
    } else {
      setStatus('Linked. You can close this page and use LINE AI now.', '', 'success');
    }
  }

  async function registerCustomer() {
    const lineChannelId = validChannelId(query.get('lineChannelId'));
    const consentEl = document.getElementById('consent');
    if (!lineChannelId) throw new Error('Missing or invalid LINE channel.');
    if (!consentEl.checked) throw new Error('Consent is required.');
    if (!await initLiff()) return;
    const idToken = currentIdToken();
    if (!idToken) return;
    setStatus('Registering...', '', 'info');
    const res = await fetch(apiBase + '/auth/line/customer-register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken, lineChannelId, consent: true })
    });
    const text = await res.text();
    if (!res.ok) throw new Error(text || ('Registration failed: ' + res.status));
    setStatus('Registered. You can close this page and continue in LINE.', '', 'success');
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

  function showOnly(viewId) {
    const views = document.querySelectorAll('[data-view]');
    for (let index = 0; index < views.length; index += 1) views[index].hidden = views[index].id !== viewId;
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

  /** P10-L §3.2. One read on open, then the form or the waiting card. */
  async function openSignup() {
    if (!await initLiff()) return;
    const idToken = currentIdToken();
    if (!idToken) return;
    const decoded = liff.getDecodedIDToken();
    const greetingEl = document.getElementById('greeting');
    if (greetingEl && decoded && decoded.name) greetingEl.textContent = 'สวัสดีคุณ ' + decoded.name;
    const status = await readSignupStatus(idToken);
    if (status && OPEN_SIGNUP_STATES.indexOf(status.state) >= 0) {
      showPending(status);
      return;
    }
    setStatus('');
    showOnly('form-view');
    signupReady = true;
    actionBtn.disabled = false;
  }

  function showPending(status) {
    const companyName = status && status.companyName ? status.companyName : '';
    const shop = companyName ? 'ร้าน ' + companyName + ' ' : '';
    // businessHours is the SERVER's answer for the Bangkok clock; a page left open since yesterday
    // must not narrate hours it worked out itself.
    // Same rule as the done card: the heading is "ได้รับแล้ว", so the body never says it again.
    document.getElementById('pending-text').textContent = status && status.businessHours
      ? 'คำขอเปิด' + shop + 'เข้าระบบแล้วค่ะ ทีมงานกำลังตรวจสอบ ปกติดำเนินการให้ภายในวันทำการ ' + BUSINESS_HOURS_TH + ' พร้อมเมื่อไหร่จะแจ้งในแชทนี้นะคะ'
      : 'คำขอเปิด' + shop + 'เข้าระบบแล้วค่ะ ตอนนี้อยู่นอกเวลาทำการ ทีมงานจะดูให้ในวันทำการถัดไป ' + BUSINESS_HOURS_TH + ' นะคะ';
    setStatus('');
    showOnly('pending-view');
  }

  async function submitSignup() {
    setFieldError('', '');
    const companyName = (document.getElementById('company-name').value || '').trim();
    // Nothing has been sent at this point, so the summary must NOT read as a failed submit — it is
    // a form that is not finished yet, which is a warning, not an error (review BLOCKER 1).
    if (!companyName) {
      throw refusal({ tone: 'warning', text: 'กรอกชื่อร้านก่อนนะคะ', advice: 'ใส่ชื่อร้านที่ลูกค้าเรียก ยาวไม่เกิน 120 ตัวอักษรนะคะ', field: 'company-name' });
    }
    const phoneNumber = (document.getElementById('phone-number').value || '').replace(/[^0-9]/g, '');
    if (!/^0[0-9]{9}$/.test(phoneNumber)) {
      throw refusal({ tone: 'warning', text: 'กรอกเบอร์มือถือให้ครบก่อนนะคะ', advice: PHONE_RULE_TH, field: 'phone-number' });
    }
    const referralCode = validReferralCode(query.get('ref'));
    const idToken = currentIdToken();
    if (!idToken) return;
    setStatus('กำลังส่งคำขอ...', '', 'info');
    const res = await fetch(apiBase + '/public/line-signups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        idToken,
        companyName,
        phoneNumber,
        ...(referralCode ? { referralCode } : {}),
        // Echoed exactly as this page rendered them: the server refuses anything that is not the
        // release it is serving right now (LEGAL-LIFF-01).
        legal: {
          documentVersion: root.dataset.legalVersion || '',
          statementSha256: root.dataset.legalStatement || '',
          releaseFingerprintSha256: root.dataset.legalRelease || '',
          displayChallenge: root.dataset.legalChallenge || '',
          locale: root.dataset.legalLocale || 'th'
        }
      })
    });
    const text = await res.text();
    if (res.status === 409 && refusalCode(text) === 'line_signup_already_pending') {
      // A second tab, or a submit that raced the open read. One more read — not a poll — so the
      // waiting card names the shop and the real business-hours answer instead of guessing both.
      showPending(await readSignupStatus(idToken));
      return;
    }
    // Every other refusal becomes what went wrong plus what to do next, in the right tone.
    if (!res.ok) throw refusal(signupGuidance(res.status, text));
    const accepted = JSON.parse(text);
    // The card's own heading already says "ได้รับแล้ว", so the body says what happens next and
    // nothing else — repeating the heading was the first thing the Owner read twice (2026-09-05).
    document.getElementById('done-text').textContent = accepted.existingAccount
      ? 'เพิ่มร้านที่ 2 ให้บัญชีของคุณแล้วค่ะ พร้อมเมื่อไหร่เราจะส่งข้อความในแชทนี้นะคะ'
      : (accepted.businessHours
        ? 'ทีมงานกำลังตรวจสอบ ปกติดำเนินการให้ภายในวันทำการ ' + BUSINESS_HOURS_TH + ' พร้อมใช้เมื่อไหร่เราจะส่งข้อความในแชทนี้นะคะ'
        : 'ตอนนี้อยู่นอกเวลาทำการ ทีมงานจะดูให้ในวันทำการถัดไป ' + BUSINESS_HOURS_TH + ' พร้อมใช้เมื่อไหร่เราจะส่งข้อความในแชทนี้นะคะ');
    setStatus('');
    showOnly('done-view');
  }

  function validReferralCode(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : '';
  }

  /**
   * P10-L §3.5. The cookie the handoff sets has to land in Safari/Chrome, not in the LINE in-app
   * browser (QR fix 2026-09-01) — so the destination is opened EXTERNALLY, and the same URL is left
   * on screen as a tappable fallback for the client that refuses to open a window.
   */
  async function startSession(companyId) {
    if (!await initLiff()) return;
    const idToken = currentIdToken();
    if (!idToken) return;
    setStatus('กำลังเปิดหน้าเว็บ...', '', 'info');
    const res = await fetch(apiBase + '/auth/line/liff/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken, ...(companyId ? { companyId } : {}) })
    });
    const text = await res.text();
    if (res.status === 403 || res.status === 503) throw new Error(UNAVAILABLE_TH);
    if (!res.ok) throw new Error(refusalCode(text) || ('เปิดหน้าเว็บไม่สำเร็จ: ' + res.status));
    const session = JSON.parse(text);
    if (session.needsSignup) {
      setStatus('ยังไม่มีร้านที่ผูกกับ LINE นี้ค่ะ เปิดร้านใหม่ทดลองฟรีได้เลยนะคะ', '', 'info');
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
    const fallbackEl = document.getElementById('open-web');
    if (fallbackEl) {
      fallbackEl.href = handoffUrl;
      fallbackEl.hidden = false;
    }
    setStatus('เปิดหน้าเว็บให้แล้วค่ะ ถ้าไม่เปิดเอง กดปุ่มด้านล่างได้เลยนะคะ', '', 'success');
    liff.openWindow({ url: handoffUrl, external: true });
  }

  function renderCompanyChoices(companies) {
    const listEl = document.getElementById('companies');
    if (!listEl) return;
    listEl.textContent = '';
    for (let index = 0; index < companies.length; index += 1) {
      const company = companies[index];
      const button = document.createElement('button');
      // textContent, never innerHTML: a shop name is customer-typed data on a page with no CSP escape.
      button.textContent = company.name;
      button.addEventListener('click', function () {
        listEl.hidden = true;
        void runWith(function () { return startSession(company.id); });
      });
      listEl.appendChild(button);
    }
    listEl.hidden = false;
    setStatus('เลือกร้านที่จะเปิดค่ะ', '', 'info');
  }

  async function runWith(action) {
    // The label is restored on every failure, so a customer who fixes a typo taps the same button
    // that invited them in the first place — and cannot double-submit while one is in flight.
    const label = actionBtn ? actionBtn.textContent : '';
    if (actionBtn) {
      actionBtn.disabled = true;
      if (mode === 'signup' && signupReady) actionBtn.textContent = BUSY_LABEL_TH;
    }
    try {
      await action();
    } catch (error) {
      // A refusal we understand carries its own guidance; anything else is either the network or a
      // real defect, and only the latter is worth showing raw in the technical box.
      if (error && error.guidance) {
        setGuidance(error.guidance);
      } else if (mode === 'signup' && signupReady) {
        // Not only the network: a 202 whose JSON will not parse, or a status re-read that fails
        // inside the 409 branch, land here too — and those leave nothing but the raw message.
        setGuidance(NETWORK_GUIDANCE, errorDetail(error));
      } else if (mode === 'signup') {
        // signupReady is false until the form is on screen, so this is precisely the init phase.
        setStatus(SIGNUP_INIT_FAIL_TH + '\n' + 'ปิดหน้านี้แล้วแตะเมนูใน LINE อีกครั้งนะคะ', errorDetail(error), 'error');
        showOnly('retry-view');
      } else {
        setStatus(FAIL_TITLE_TH[mode] || 'Link failed', errorDetail(error), 'error');
      }
      if (actionBtn) {
        actionBtn.textContent = label;
        actionBtn.disabled = false;
      }
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
      else throw new Error('Invalid LIFF page mode.');
    });
  }

  if (actionBtn) actionBtn.addEventListener('click', run);
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
