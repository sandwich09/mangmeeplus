# Generic Client Compatibility Notice Spec

Status: IMPLEMENTED - local verification complete; UAT/real-device validation pending
Date: 2026-08-20
Owner: web/platform with LINE integration

## 1. Goal

Prevent users from remaining on an indefinite loading or session-checking screen when Mangmee Plus
cannot run correctly in their current device, browser, WebView, or LINE environment.

The customer experience is deliberately generic. The product does not identify the device model,
name a failed browser rule, distinguish LINE Legacy from another compatibility problem, or expose a
technical reason. Every compatibility/boot failure uses one actionable notice and one journey.

## 2. Source Docs and Evidence

- `docs/specs/user-facing-error-message-safety-spec.md`
- `docs/plans/web-access-error-handling-plan.md`
- `docs/guidelines/web-frontend-code-style.md`
- `docs/runbooks/uat-production-v2-deployment.md`
- `apps/web/package.json` - Next.js `^16.2.11`, with no custom Browserslist
- Repository `playwright.config.ts` - Chromium and Pixel 7 emulation only
- Next.js browser baseline:
  <https://nextjs.org/docs/architecture/supported-browsers>
- Apple iOS/iPadOS 16 device list:
  <https://support.apple.com/en-lamr/103267>
- Google Chrome system requirements:
  <https://support.google.com/chrome/a/answer/7100626?hl=en>
- LINE system requirements:
  <https://help.line.me/line?contentId=10002433>
- LIFF operating environment:
  <https://developers.line.biz/en/docs/liff/overview/>

## 3. Problem

The login route server-renders `กำลังตรวจสอบเซสชัน...` and waits for client JavaScript to restore a
session. If the shipped bundle cannot run, or refresh never settles, the user receives neither a
diagnosis nor a next action.

A React modal or toast alone cannot solve the first failure because it depends on the same bundle
parsing and hydrating. Device-model detection is also not trustworthy: requests expose browser/OS
signals, not a verified hardware model. LINE Messaging API does not provide the recipient's device,
OS, or LINE version before a link is opened.

## 4. Product Outcomes

1. A positively identified unsupported main-web client receives a useful notice in the initial
   server HTML before authentication or React hydration.
2. A session check that does not settle within 10 seconds leaves the spinner and shows the same
   generic notice.
3. A supported or unknown client continues normally and sees no compatibility banner.
4. Main-web links opened from LINE follow the same journey as every other web link.
5. Existing LIFF pages reuse the same generic copy when their environment is below the vendor
   minimum.
6. The notice is Thai-first, includes an English summary, and provides retry, alternate-device, and
   support guidance without exposing a technical reason.

## 5. Non-goals

- Do not show different customer messages for iPhone, iPad, Android, Safari, Chrome, LINE, LIFF,
  Legacy, session timeout, or network failure.
- Do not show the detected OS/browser/LINE version or raw user agent.
- Do not add a Legacy banner, warning modal, or compatibility toast.
- Do not identify an exact phone/tablet model.
- Do not lower the Next.js browser target, add legacy polyfills, or claim support outside the
  internal matrix.
- Do not block unknown, missing, malformed, crawler, or custom user agents.
- Do not compatibility-gate API, webhook, health, callback, storage, or static-asset requests.
- Do not add a dependency, database table, preference, audit event, analytics event, or device
  fingerprint.
- Do not change LINE Login availability, auth, permissions, CSRF, CSP, consent, or linking rules.
- Do not send a proactive device-specific LINE message before the user opens a link.
- Do not deploy as part of the documentation task.

## 6. Internal Compatibility Policy

The matrix below controls tests and the early gate. It is not displayed as a case-specific customer
diagnosis.

### 6.1 Main web minimums

| Environment | Internal minimum |
|---|---|
| iPhone/iPad browser or LINE WebView | iOS/iPadOS 16.4+ |
| Android browser or LINE WebView | Android 10+ with current Chrome/WebView |
| Chrome desktop | 111+ |
| Microsoft Edge | 111+ |
| Firefox | 111+ |
| Safari desktop | 16.4+ |

On iOS/iPadOS, the gate resolves the OS/WebKit version before browser branding. Chrome or Firefox
branding on an old iPhone does not change the underlying WebKit capability.

### 6.2 LIFF minimums

The plain HTML LIFF linking pages use the LINE vendor minimum rather than the higher Next.js main-web
minimum. At the specification date the blocking signals are:

- iOS/iPadOS below 15;
- Android below 8; or
- a positively parsed LINE app version 13.20.0 or earlier.

Vendor-supported older environments above that floor may continue without a special Legacy banner.
This does not convert them into a real-device-certified environment.

### 6.3 Conservative decision rule

The internal classifier returns only:

- `SUPPORTED`: positively meets the relevant minimum;
- `UNSUPPORTED`: positively falls below the relevant minimum; or
- `UNKNOWN`: absent or ambiguous signal.

`UNKNOWN` always continues. Compatibility classification is presentation/routing only and never an
authentication or authorization decision.

## 7. Single Customer Journey

```text
ผู้ใช้เปิด Mangmee Plus
        |
        v
ระบบตรวจความพร้อมแบบเงียบ
        |
        +-- พร้อมหรือระบุไม่ได้ --> ใช้งาน/ตรวจเซสชันตามปกติ
        |
        +-- เปิดใช้งานไม่ได้ ----> Generic notice เดียว
                                      |
                                      +-- ลองใหม่
                                      +-- ใช้อุปกรณ์อื่น
                                      +-- ติดต่อเจ้าหน้าที่
```

Detailed behavior:

1. A user navigates with `GET` or `HEAD` to an HTML page.
2. The existing web proxy checks only for a positively unsupported environment before the auth
   cookie-presence gate.
3. If unsupported, it redirects to `/unsupported-browser` with a sanitized same-origin return path,
   existing security headers, and `Cache-Control: private, no-store`.
4. The compatibility route renders the full notice in server HTML and does not require client
   JavaScript.
5. If supported or unknown, the normal route/session journey continues with no warning.
6. If login session recovery exceeds 10 seconds or becomes unavailable, the spinner is replaced by
   the same generic notice and retry actions. Cookies are preserved unless the BFF receives a real
   401.
7. Retrying returns to the sanitized same-origin route. If the environment remains unsupported, the
   same notice is shown again.

The following public routes remain readable and are never redirected by the compatibility gate:

- `/privacy`
- `/terms`
- `/data-deletion`
- `/legal/releases/*`
- `/maintenance`
- `/unsupported-browser`

API routes, Next assets, metadata assets, unsafe HTTP methods, and non-HTML requests retain their
current behavior.

## 8. LINE and LIFF Behavior

### Normal Mangmee Plus web link opened from LINE

The request follows the same main-web journey. The notice does not say that LINE, iOS, Android, or a
specific browser caused the failure.

### Account, employee, and customer LIFF pages

Before link/register submission, the existing external same-origin LIFF script checks available
vendor-minimum signals:

- unsupported: disable the action and show the same generic notice;
- supported or unknown: continue the existing LIFF initialization and action without a Legacy
  warning.

The LIFF change must preserve no-inline-script CSP, same-origin API base, ID-token/link-token
validation, consent, rate limiting, escaping, and existing error handling.

LINE chat itself remains outside this gate. The system cannot send a device-specific warning before
the user opens the web or LIFF link because Messaging API does not provide that signal.

## 9. Canonical Customer Copy

All compatibility and bounded-boot fallback surfaces use the same meaning and actions.

Thai title:

```text
ไม่สามารถเปิด Mangmee Plus ได้
```

Thai body:

```text
กรุณาอัปเดตระบบปฏิบัติการ เบราว์เซอร์ และ LINE เป็นเวอร์ชันล่าสุด แล้วลองอีกครั้ง
หากยังใช้งานไม่ได้ กรุณาเปิดผ่านอุปกรณ์อื่นหรือติดต่อเจ้าหน้าที่
```

English summary:

```text
Mangmee Plus could not be opened. Update your operating system, browser, and LINE, then try again.
If the problem continues, use another device or contact support.
```

Actions:

- `ลองใหม่` / `Try again`
- `ติดต่อเจ้าหน้าที่` / `Contact support`

The page may state the support email. It must not show:

- a device/model name;
- a detected version;
- `unsupported`, `Legacy`, parser errors, or raw user-agent text;
- different instructions based on the detected case; or
- a “continue anyway” action.

## 10. UI and Accessibility

- Use one shared generic state component/copy across the server route, login fallback, and LIFF
  notice markup.
- The main-web hard notice is a full-page state, not a modal or toast.
- Initial HTML includes `main`, one `h1`, explanatory text, retry, and contact action.
- The bounded login fallback uses `role="alert"` because it ends an active wait.
- LIFF uses the same visible copy and disables its mutation action only when positively unsupported.
- Thai and English ship together; understanding the next action does not require hydration.
- Content remains usable at 320 CSS-pixel width, 200% zoom, reduced motion, and high contrast.
- No state is communicated by color alone.

## 11. Boundaries and Ownership

- Web proxy owns early HTML-navigation compatibility routing.
- Common web client-support logic owns pure parsing and the three internal states.
- Common generic state owns main-web notice presentation.
- Auth feature owns the bounded session-recovery wait and reuse of the generic state.
- API LIFF security helper owns vendor-minimum gating and reuse of the generic copy in static pages.
- Existing auth, permission, token, CSRF, CSP, maintenance, legal, and tenant boundaries remain
  authoritative.
- AI Gateway, workers, database, audit, permissions, and infrastructure are out of boundary.

## 12. Security and Privacy

- Compatibility never grants access.
- Raw user agent, internal classification reason, tokens, hardware guesses, query values, and parser
  exceptions are not visible or placed in redirect parameters.
- The return path is same-origin and sanitized again before rendering a retry link.
- Unsupported responses are private/no-store and cannot poison a shared cache.
- API routes are not rejected based on user agent.
- Web CSP remains nonce-based. LIFF retains external/same-origin-only script sources and does not add
  `'unsafe-inline'` to `script-src`.
- The feature adds no persistent tracking or fingerprint.

## 13. Acceptance Criteria

- [x] Every customer-facing compatibility/boot failure uses the canonical generic title, body, and
  actions; there is no device-, browser-, LINE-, Legacy-, timeout-, or network-specific variant.
- [x] A positively identified client below the main-web minimum reaches the server-rendered notice
  before `/api/auth/refresh` or protected-session work starts.
- [x] A client at the minimum proceeds normally and sees no warning.
- [x] Unknown, missing, bot, custom, or malformed user agents proceed normally and see no warning.
- [x] The generic page remains complete and actionable in the raw server HTML without JavaScript.
- [x] The compatibility route cannot redirect to itself.
- [x] Legal/privacy/maintenance routes, API, assets, unsafe methods, and non-HTML requests retain
  their current behavior.
- [x] Compatibility redirects preserve CSP/security headers and are private/no-store.
- [x] No Legacy banner, modal, compatibility toast, device name, or detected version is rendered.
- [x] Session recovery exits within 10 seconds from the UI perspective and replaces the spinner with
  the shared generic state.
- [x] Session timeout/unavailability preserves cookies; only a real 401 follows signed-out behavior.
- [x] Normal web links opened from LINE use the same generic journey.
- [x] Account, employee, and customer LIFF pages use the same generic copy only below the vendor
  minimum; supported/unknown LIFF environments continue without a Legacy warning.
- [x] LIFF CSP, escaping, consent, token validation, same-origin checks, and rate limiting remain
  unchanged.
- [x] No dependency, `package.json`, database, permission, API DTO, or deployment change is made.

## 14. Required Tests

### Pure classifier

- iOS/iPadOS immediately below and at 16.4.
- `CriOS`/`FxiOS` on old iOS still resolves by the iOS/WebKit baseline.
- Android immediately below and at 10.
- Chrome/Edge/Firefox immediately below and at 111.
- Safari immediately below and at 16.4.
- LIFF below and at the vendor minimum.
- Missing, malformed, bot, and custom user agents return `UNKNOWN` and continue.

### Web proxy and server page

- Unsupported HTML navigation redirects before auth presence checks.
- Supported/unknown requests preserve current route behavior.
- Compatibility and public-route exemptions cannot loop.
- API/assets/non-HTML/unsafe methods are not gated.
- CSP/security headers and private/no-store remain present.
- Server HTML contains the canonical copy/actions with JavaScript disabled.

### Auth

- Refresh success, 401, 5xx, network rejection, abort, and timer cleanup.
- Every refresh outcome exits the spinner.
- Timeout/unavailable reuse the generic state and preserve cookies.
- Real 401 shows the normal login form rather than the generic state.

### LIFF/API

- All three pages contain the shared notice target and approved external script tags only.
- Below-minimum signals disable the action and show the canonical generic copy.
- Supported/unknown signals continue with no warning.
- Existing XSS, CSP, DTO, token, consent, same-origin, and rate-limit coverage remains green.

### Browser/manual

- Unsupported user agent sees the generic state and makes no refresh request.
- Supported user agent sees the normal login journey and no warning.
- Stalled refresh exits the spinner into the same generic state.
- JavaScript-disabled hard-notice page remains readable.
- Check 320px width and 200% zoom.
- Before Production, smoke one supported and one below-minimum main-web environment plus one LIFF
  environment in UAT. Record unrun real-device checks and do not claim certification without them.

## 15. Open Questions

None blocking. Support thresholds remain internal and versioned, while customer-facing behavior
stays generic unless a future product decision explicitly changes this spec.
