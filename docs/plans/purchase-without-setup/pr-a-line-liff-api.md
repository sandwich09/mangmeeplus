# PR A — LINE / LIFF / API: ลิงก์ออกนอกเบราว์เซอร์ LINE, การ์ดล็อก one-tap, สถานะ "ยังไม่มีแพ็กเกจ" บน LIFF, สิทธิ์ `company.plan.manage`

Spec: [../../specs/mangmee-purchase-without-setup-spec-th.md](../../specs/mangmee-purchase-without-setup-spec-th.md) (v0.2; **§18.2 มีผลเหนือ §7**) · Plan: [../mangmee-purchase-without-setup-plan-th.md](../mangmee-purchase-without-setup-plan-th.md) "แก้ไขแผน 2026-09-27" §P0/§P1 · กติการ่วม: [00-readme.md](00-readme.md) · ฐานโค้ด: `origin/develop` ddcdcadf (ทุกเลขบรรทัดในเอกสารนี้อ้างจาก commit นี้)

กติกาที่ใช้เขียน brief นี้: ทุกไฟล์ที่อ้างถูกอ่านจริงที่ ddcdcadf; snippet "ปัจจุบัน" คัดจากโค้ดจริง, snippet "ใหม่" คือสิ่งที่ต้องเขียน; ไม่มี env/flag ใหม่ (D-PF-8); DTO ใหม่ทุกฟิลด์ optional; ห้ามแก้ `package.json`; ไม่แตะ `attemptDelivery` (`process-line-webhook.use-case.ts:3274-3281`) และ `linePushRetryKey`

---

## 1. Scope และ definition of done

### 1.1 สิ่งที่ PR A ทำ (API + LIFF + LINE เท่านั้น; web/console = PR B)

| # | งาน | กติกาใน spec | ไฟล์หลัก |
|---|---|---|---|
| A1 | Outbound transform `openExternalBrowser=1` ที่ "ทางออก" 3 จุด + helper กลางใน contracts + ตัด param ตอน mint + ลบ hardcode 2 จุด | §18.2 R-B1, RV21 | `packages/contracts/src/line-external-browser.ts` (ใหม่), `line-reply.adapter.ts`, `system-line-push.ts`, `notification.use-cases.ts`, `line-handoff-link.service.ts`, `sales-deal.logic.ts`, `line-business-card.logic.ts` |
| A2 | R-B2 ทาง (ข): การ์ดล็อกและตอบ "ขอเปลี่ยนแพ็กเกจ" mint `/l/<token>` ในเลนก่อนบันทึก; ห้าม mint ในกลุ่ม/ห้อง; การ์ดโปรโมชั่นได้ group guard | §18.2 R-B2, RV07, RV08 | `process-line-webhook.use-case.ts`, `line-business-card.logic.ts` |
| A3 | `/l/[token]`: `HEAD` → 204, ส่งต่อ client IP | §18.2 R-B1, RV22 | `apps/web/app/l/[token]/route.ts` |
| A4 | LIFF: DTO `lockReason`/`canManagePlan` (+ `lockedEntryCompanyId`), หน้าผลลัพธ์ "เปิดร้านแล้ว ขั้นต่อไปเลือกแพ็กเกจ" เตรียม handoff ตอน render, label รายการร้าน, แก้ busy-label, `destination()` permission-aware, `needsSelection` แนบ lock info | §18.2 R-C2, R-C3, RV10, RV24 | `external-signup.ts` (contracts), `get-line-signup-status.use-case.ts`, `liff-page.security.ts`, `exchange-liff-session.use-case.ts` |
| A5 | Push หลังสมัคร: คงลิงก์ LIFF; หัวข้อ/ปุ่มใหม่ทั้ง `approved`(=first) และ `attached`; ถอดภาพวิธีใช้ตอน follow | §18.2 R-C4, RV11, RV33 | `line-signup-notify.service.ts`, `process-line-webhook.use-case.ts` |
| A6 | Copy: G19 postback "ให้ทีมงานติดต่อกลับ" (support request ไม่หยุด AI 24 ชม.), G20 ENTERPRISE, G25 FAQ, RV33 LIFF help text, ข้อความตอบ "ขอเปลี่ยนแพ็กเกจ" | §12, §13 G19/G20/G25, RV32, RV33 | `line-staff-menu.logic.ts`, `line-public-policy.logic.ts`, `auth.controller.ts`, `process-line-webhook.use-case.ts` |
| A7 | R-C11: helper `plan-manager.logic.ts` ใน access-control + ใช้ใน `assertOwner` + แทนที่ OWNER-role ทุก call site ที่ spec ระบุ; คง OWNER สำหรับ "เปิดร้านเพิ่ม" | §18.2 R-C11, D-PF-10, G26 | `access-control/domain/logic/plan-manager.logic.ts` (ใหม่), `billing.service.ts`, webhook, `plan-term-sweep.use-case.ts`, `billing-notifications.service.ts`, `sales-deals.service.ts` |
| A8 | R-B4 / R-B5 ฝั่ง API: **ไม่มี** (ยืนยัน §3.22) | §18.2 R-B4/R-B5 | — |
| A9 | Pins sync (P0): develop stale จริง — `auth.guard.ts` sha ปัจจุบัน `5d1dadec…` ≠ pin `9e752308…` (validator :25) เพราะ 48c4ab57 แก้ไฟล์หลัง sync ล่าสุด (b8fe2b28) | plan §P0, RV12 | `infra/security/validate-production-maintenance-release.sh`, `.github/workflows/deploy-production.yml:421` |
| A10 | ลงทะเบียน spec ใหม่ (catalog / ci.yml) + amend docs | plan §P0 "การลงทะเบียนเทสต์", RV13 | `scripts/line-ai-whole-chain-acceptance.catalog.mjs`, `.github/workflows/ci.yml:543` |

นอก scope (PR อื่น): `/auth/me/companies` lockReason, `planTermStateLabel` ใน contracts `plan-term.ts`, picker/switcher/BillingPage labels, partner list/detail, LoginPage (R-B5 ขยาย), `AccountEmailOtpPanel` (R-B4), DQ8 session — ทั้งหมด PR B; R-E5 reference ในคำขอ — PR E

### 1.2 Definition of done

1. ทุกลิงก์ที่ออกจาก LINE ผ่าน 3 ทางออก (`providerMessages`, `pushLineMessages`, `pushLineMessage`) มี `openExternalBrowser=1` ยกเว้น LIFF/`*.line.me`/official/`tel:`/กล้อง; retry key ของ push และ binding hash ของ billing notification **ไม่เปลี่ยน**; ภาพไม่ถูกแตะ; ใส่ซ้ำแล้วได้ bytes เดิม (idempotent)
2. การ์ดล็อกและข้อความตอบ "ขอเปลี่ยนแพ็กเกจ" มีปุ่ม/ลิงก์ `<web>/l/<token>` ทั้งเมื่อ `LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED` เปิดและปิด; payload ที่ `recordTurnOutcome` บันทึก = payload ที่ส่ง (token เดียวกัน; ต่างกันเฉพาะ param ที่ exit เติมแบบ deterministic — ดู §9.1); mint ล้มเหลว → URL ธรรมดา; ในกลุ่ม/ห้อง → URL ธรรมดา
3. `HEAD /l/<token>` ตอบ 204 โดยไม่เรียก API; `GET` ส่ง `x-forwarded-for` ต่อให้ API
4. LIFF signup COMPLETED + ร้านล็อก + ผู้กดมี `company.plan.manage` → หัวข้อ "เปิดร้านแล้ว ขั้นต่อไปเลือกแพ็กเกจ" + ปุ่ม "เลือกแพ็กเกจ" ที่พร้อมกดทันที (handoff เตรียมตอน render, เปิด `external: true`); พนักงาน → ข้อความพนักงาน; `canEnter` เดิมไม่เปลี่ยน; `liff/session` ของร้านล็อกพา plan manager ไป `/companies/:id/billing?channel=line`, คนอื่นไป `/renew`
5. Push หลังสมัครยังเป็นลิงก์ LIFF (`/start`) หัวข้อ "เปิดร้านแล้ว"/"เพิ่มร้านแล้ว" ปุ่ม "เลือกแพ็กเกจ"; follow reply ไม่ส่งภาพวิธีใช้
6. ทุกจุดที่ LINE ตัดสิน "จัดการแพ็กเกจได้" ใช้ predicate เดียวกับ `assertOwner` (สมาชิก ACTIVE + role ACTIVE ที่มี `company.plan.manage`); OWNER ยังผ่าน (OWNER = `COMPANY_PERMISSION_KEYS` ทั้งหมด `permission-registry.ts:519`)
7. `node infra/security/sync-production-maintenance-release-pins.mjs --check` exit 0 ใน PR นี้; `spec-suite-coverage.spec.ts` ผ่าน (ไม่มี spec กำพร้า); typecheck api/web/contracts ผ่าน; `test:boot` ผ่าน; `node scripts/run-line-ai-whole-chain-acceptance.mjs` ผ่าน
8. docs ใน §7 ถูก amend ใน PR เดียวกัน; `docs/agent-memory/purchase-without-setup-2026-09-26.md` อัปเดต Status/Verification/Next

---

## 2. Contracts

### 2.1 `packages/contracts/src/line-external-browser.ts` (ไฟล์ใหม่; export จาก `index.ts` ต่อจากบรรทัด 260 `export * from './plan-term.js';`)

```ts
export const LINE_EXTERNAL_BROWSER_PARAM = 'openExternalBrowser';
export const LINE_TEXT_MESSAGE_MAX_CHARS = 5000;   // LINE text message body limit (line-reply.adapter.ts:52 นับเท่านี้)
export const LINE_URI_ACTION_MAX_CHARS = 1000;     // LINE uri action limit
export function shouldOpenOutsideLine(url: string): boolean;
export function hasLineExternalBrowserParam(url: string): boolean;
export function withLineExternalBrowserParam(url: string): string;
export function stripLineExternalBrowserParam(pathOrUrl: string): string;
export function withLineExternalBrowserLinks<T>(messages: readonly T[]): T[];
```

กติกา:
- `shouldOpenOutsideLine`: parse ด้วย `URL`; `false` เมื่อ parse ไม่ได้, protocol ไม่ใช่ `http:`/`https:` (ครอบ `tel:`, camera/clipboard action ไม่มี uri อยู่แล้ว), host ∈ {`liff.line.me`, `line.me`, `official.mangmeeplus.com`} หรือ host ลงท้าย `.line.me` (ลิงก์ add-friend `https://line.me/R/ti/p/…` ที่ `auth.controller.ts:705` สร้าง ต้องอยู่ใน LINE)
- `withLineExternalBrowserParam`: ถ้าไม่ควรเปิดนอก หรือมี param อยู่แล้ว → คืน string เดิม **byte-identical**; มิฉะนั้นต่อ `?openExternalBrowser=1` หรือ `&openExternalBrowser=1` **ก่อน** `#fragment` โดย string splice (ห้ามใช้ `URL.toString()` เพราะ normalize bytes ที่ builder ส่งมา เช่น เติม `/` ท้าย origin)
- `stripLineExternalBrowserParam`: รับ path (`/companies/...`) หรือ URL เต็ม; ไม่มี param → คืนค่าเดิม; มี → ลบผ่าน `URLSearchParams` แล้วประกอบ `pathname + search + hash` (ใช้ตอน mint เท่านั้น)
- `withLineExternalBrowserLinks`: เดินทุก message — `type:'text'` → แทนทุก URL ที่ตรง `/https?:\/\/[^\s<>"'`)\]}]+/g` (regex เดียวกับ `line-handoff-link.service.ts:17`) และ **ถ้าความยาวหลังแทน > 5000 ให้คืน text เดิม**; `type:'flex'` → deep-walk `contents` แทนทุก `{ type: 'uri', uri }` และ **ถ้า uri ใหม่ยาว > 1000 ให้คง uri เดิม**; `type:'image'`/อื่น → คืน object เดิม; ไม่มีอะไรเปลี่ยน → คืน array เดิม (identity เท่ากัน) เพื่อให้ caller เทียบได้; **ห้าม mutate** input; `quickReply` ไม่ถูกแตะ (item ใน `LineQuickReplyItem` มีแค่ message/camera)

### 2.2 `packages/contracts/src/external-signup.ts`

ปัจจุบัน (:367-374, :400-403):
```ts
export type LineSignupEligibleCompanyDto = {
  companyId: string;
  companyName: string;
  /** EXPIRED is term-disabled and remains visible for the renewal/support path. */
  status: 'ACTIVE' | 'EXPIRED';
  /** Only ACTIVE is a valid RETURN_EXISTING target and direct entry. */
  canEnter: boolean;
};
…
  companyCreated: boolean;
  /** Permission-checked navigation target, whether newly created or an explicitly resolved existing shop. */
  entryCompanyId?: string;
};
```
ใหม่:
```ts
import type { PlanTermLockReason } from './plan-term.js';

export type LineSignupEligibleCompanyDto = {
  companyId: string;
  companyName: string;
  /** EXPIRED is term-disabled and remains visible for the renewal/support path. */
  status: 'ACTIVE' | 'EXPIRED';
  /**
   * Only ACTIVE is a valid RETURN_EXISTING target and direct entry (FIRST_SHOP/RETURN_EXISTING rules in
   * submit-line-signup.use-case.ts read this — never widen it). A locked shop is reachable through
   * `lockReason` + `canManagePlan` below, which are display-only (spec §18.2 R-C2).
   */
  canEnter: boolean;
  /** Present only for a locked shop (status EXPIRED): why it is locked, for the page's wording. */
  lockReason?: PlanTermLockReason;
  /** Present only for a locked shop: the tapping account may buy/renew (`company.plan.manage`). */
  canManagePlan?: boolean;
};
…
  companyCreated: boolean;
  /** Permission-checked navigation target, whether newly created or an explicitly resolved existing shop. */
  entryCompanyId?: string;
  /**
   * The shop this request created/resolved when it exists but is locked (no package yet, or expired).
   * Display-only — the page offers "เลือกแพ็กเกจ" for it; it never grants entry (that stays `entryCompanyId`).
   */
  lockedEntryCompanyId?: string;
};
```

### 2.3 `POST /v1/auth/line/liff/session` (`ExchangeLiffSessionResult`, `exchange-liff-session.use-case.ts:22-27`)

```ts
export type ExchangeLiffSessionResult =
  | { handoffUrl: string }
  | { needsSignup: true }
  | { needsSelection: true; companies: Array<{ id: string; name: string; lockReason?: PlanTermLockReason; canManagePlan?: boolean }> }
  | { reason: LiffSessionBlockedReason };
```
พฤติกรรม: ร้านล็อก (DISABLED+`termDisabledAt` หรือ ACTIVE ที่ `termEndsAt <= now`) → ผู้มี `company.plan.manage` ได้ `targetPath = /companies/:id/billing?channel=line`, คนอื่น `/companies/:id/renew` (ผ่าน `resolveLineHandoffTarget` เดิม); ร้าน ACTIVE ปกติ → `/dashboard` เดิม; `needsSelection` แนบ lock info เฉพาะร้านล็อก

### 2.4 `GET /v1/public/line-signups/me` (`LineSignupStatusDto`)

ร้าน ACTIVE: shape เดิมทุก byte (`{companyId, companyName, status:'ACTIVE', canEnter:true}`); ร้านล็อก: `{…, status:'EXPIRED', canEnter:false, lockReason, canManagePlan}`; `progress.lockedEntryCompanyId` เมื่อร้านที่คำขอนี้สร้าง/ผูกอยู่ในรายการแต่ล็อก

### 2.5 `GET /l/<token>` (web route)

- `HEAD` → `204` ไม่มี body, ไม่เรียก API (token ไม่ถูกเผา; deeplink spec G7)
- `GET` เดิม + header `x-forwarded-for` (จาก `forwardedClientHeaders(request.headers)`) ไปยัง `POST /auth/line/handoff/exchange` เพื่อให้ `assertLineHandoffExchangeAllowed(trustedClientIp(req))` (`auth.controller.ts:468`; limiter 20/60 วิ `packages/config/src/index.ts:443-444`) นับต่อผู้ใช้ ไม่ใช่ต่อ container

### 2.6 LINE postback ใหม่ (G19)

`data = 'action=package-callback'` → `linePostbackCommandText` คืน `PACKAGE_CALLBACK_COMMAND = 'ให้ทีมงานติดต่อกลับ'` → `staffMenuCommand` = `'package_callback'` → สร้าง `LineSupportRequest` (แถวเดิม, ไม่มีคอลัมน์ใหม่) โดย **ไม่** `pauseAssistant`; ไม่มี id/state ใน data (SEC-04)

### 2.7 R-C11 helper (`apps/api/src/modules/access-control/domain/logic/plan-manager.logic.ts`, ไฟล์ใหม่ — ฟังก์ชัน Prisma ธรรมดา ไม่มี Nest provider, ไม่แตะ `auth.module.ts`)

```ts
export const PLAN_MANAGE_PERMISSION_KEY = 'company.plan.manage';
/** Prisma `CompanyMembershipWhereInput` fragment. Same predicate as billing.service.ts assertOwner. */
export function planManagerRoleFilter(): { roles: { some: { role: { status: 'ACTIVE'; permissions: { some: { permission: { key: string } } } } } } };
/** Pure predicate over loaded rows (roles pre-filtered or carrying `status`). */
export function canManagePlan(roles: ReadonlyArray<{ role?: { status?: string | null; permissions?: ReadonlyArray<{ permission: { key: string } }> | null } | null } | null | undefined> | null | undefined): boolean;
/** ACTIVE members (user ACTIVE) whose ACTIVE role grants plan management. Works on prisma.client or a tx. */
export function planManagersOf(db: PlanManagerDb, companyId: string): Promise<Array<{ userId: string }>>;
/** LINE identities of those members on this channel, de-duplicated. Sibling of ownerLineUserIds (which stays for support replies). */
export function planManagerLineUserIds(db: PlanManagerDb, companyId: string, channelId: string): Promise<string[]>;
```
`PlanManagerDb` = `{ companyMembership: { findMany(args: any): Promise<any[]> }; externalIdentity?: { findMany(args: any): Promise<any[]> } }` (structural เพื่อรับ `prisma.client`, `tx` และ fake ใน spec)

---

## 3. Code changes ตามไฟล์ (ทำตามลำดับ)

### 3.1 `packages/contracts/src/line-external-browser.ts` (ใหม่)

```ts
// Spec: docs/specs/mangmee-purchase-without-setup-spec-th.md §7-B R-B1 / §18.2 R-B1 (Owner D-PF-2).
// Applied at the three LINE send boundaries only — never in a message builder — so retry keys
// (line-reply.adapter.ts linePushRetryKey), stored outcomes and notification binding hashes keep
// the plain bytes and this stays a deterministic, idempotent wire-level rewrite.

export const LINE_EXTERNAL_BROWSER_PARAM = 'openExternalBrowser';
export const LINE_TEXT_MESSAGE_MAX_CHARS = 5000;
export const LINE_URI_ACTION_MAX_CHARS = 1000;
/** Stays inside LINE: LIFF pages, LINE deep links (add-friend), and the official site is not the app. */
const SKIP_HOSTS: ReadonlySet<string> = new Set(['liff.line.me', 'line.me', 'official.mangmeeplus.com']);
/** Absolute http(s) URLs in free text, stopped where LINE's linkifier stops (line-handoff-link.service.ts:17). */
const URL_PATTERN = /https?:\/\/[^\s<>"'`)\]}]+/g;

function parse(url: string): URL | null { try { return new URL(url); } catch { return null; } }

export function shouldOpenOutsideLine(url: string): boolean {
  const parsed = parse(url);
  if (!parsed || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) return false;
  const host = parsed.hostname.toLowerCase();
  return !SKIP_HOSTS.has(host) && !host.endsWith('.line.me');
}

export function hasLineExternalBrowserParam(url: string): boolean {
  return parse(url)?.searchParams.get(LINE_EXTERNAL_BROWSER_PARAM) === '1';
}

export function withLineExternalBrowserParam(url: string): string {
  if (!shouldOpenOutsideLine(url) || hasLineExternalBrowserParam(url)) return url;
  const hashAt = url.indexOf('#');
  const head = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const fragment = hashAt >= 0 ? url.slice(hashAt) : '';
  return `${head}${head.includes('?') ? '&' : '?'}${LINE_EXTERNAL_BROWSER_PARAM}=1${fragment}`;
}

export function stripLineExternalBrowserParam(pathOrUrl: string): string {
  const relative = pathOrUrl.startsWith('/');
  const parsed = parse(relative ? `https://relative.invalid${pathOrUrl}` : pathOrUrl);
  if (!parsed || !parsed.searchParams.has(LINE_EXTERNAL_BROWSER_PARAM)) return pathOrUrl;
  parsed.searchParams.delete(LINE_EXTERNAL_BROWSER_PARAM);
  const rest = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  return relative ? rest : `${parsed.origin}${rest}`;
}

function rewriteText(text: string): string {
  const out = text.replace(URL_PATTERN, (url) => withLineExternalBrowserParam(url));
  return out.length <= LINE_TEXT_MESSAGE_MAX_CHARS ? out : text;
}

function rewriteNode(node: unknown): unknown {
  if (Array.isArray(node)) {
    const items = node.map(rewriteNode);
    return items.some((item, index) => item !== node[index]) ? items : node;
  }
  if (!node || typeof node !== 'object') return node;
  const source = node as Record<string, unknown>;
  let next: Record<string, unknown> | null = null;
  if (source['type'] === 'uri' && typeof source['uri'] === 'string') {
    const uri = withLineExternalBrowserParam(source['uri']);
    if (uri !== source['uri'] && uri.length <= LINE_URI_ACTION_MAX_CHARS) next = { ...source, uri };
  }
  for (const [key, value] of Object.entries(source)) {
    if (!value || typeof value !== 'object') continue;
    const rewritten = rewriteNode(value);
    if (rewritten !== value) { next ??= { ...source }; next[key] = rewritten; }
  }
  return next ?? node;
}

type LineWireMessage = { type?: unknown; text?: unknown; contents?: unknown };

export function withLineExternalBrowserLinks<T>(messages: readonly T[]): T[] {
  const out = messages.map((message) => {
    const wire = message as LineWireMessage | null;
    if (!wire || typeof wire !== 'object') return message;
    if (wire.type === 'text' && typeof wire.text === 'string') {
      const text = rewriteText(wire.text);
      return text === wire.text ? message : ({ ...(wire as object), text } as T);
    }
    if (wire.type === 'flex' && wire.contents && typeof wire.contents === 'object') {
      const contents = rewriteNode(wire.contents);
      return contents === wire.contents ? message : ({ ...(wire as object), contents } as T);
    }
    return message;
  });
  return out.some((item, index) => item !== messages[index]) ? out : (messages as T[]);
}
```
`packages/contracts/src/index.ts`: เพิ่ม `export * from './line-external-browser.js';` หลังบรรทัด 260

### 3.2 `apps/api/src/modules/line-ai/infrastructure/line-reply.adapter.ts` (ทางออก 1: reply + push + replay)

ปัจจุบัน (:22-29):
```ts
/** Internal recovery text stays in the durable outcome, never in the LINE wire schema. */
function providerMessages(messages: LineReplyMessage[]): LineReplyMessage[] {
  return messages.map((message) => {
    if (message.type !== 'flex') return message;
    const { canonicalText: _canonicalText, ...providerMessage } = message;
    return providerMessage;
  });
}
```
ใหม่:
```ts
import { withLineExternalBrowserLinks } from '@watchdog-bms/contracts';
/** Internal recovery text stays in the durable outcome, never in the LINE wire schema — and every
 *  web link leaves LINE's in-app browser (spec R-B1, Owner D-PF-2). Applied HERE, after
 *  `linePushRetryKey` was computed from the caller's payload and after `recordTurnOutcome` stored
 *  it, so the retry identity, the stored outcome and an orphan replay all keep the plain bytes;
 *  the rewrite is deterministic and idempotent, so first send and replay put identical bytes on the wire. */
function providerMessages(messages: LineReplyMessage[]): LineReplyMessage[] {
  return withLineExternalBrowserLinks(messages.map((message) => {
    if (message.type !== 'flex') return message;
    const { canonicalText: _canonicalText, ...providerMessage } = message;
    return providerMessage;
  }));
}
```
ไม่แตะ `sendReply`/`sendPush` (:127-135): `linePushRetryKey(operationId, to, messages)` ยังคำนวณจาก `messages` ต้นฉบับ (helper ไม่ mutate); `postMessage(..., messages, retryKey)` ยังได้ `messages` เดิมสำหรับ `failed_flex` (:206-207). เส้นทาง replay (`recover-orphan-line-events.use-case.ts:301` `sendPush(envelope.chatId, messages, row.webhookEventId)`) และ push fallback (webhook :3294) ผ่านจุดนี้เหมือนกัน

### 3.3 `apps/api/src/modules/auth/infrastructure/system-line-push.ts` (ทางออก 2: signup push, sales offer, partner message, package-change decision)

ปัจจุบัน (:50): `body: JSON.stringify({ to: input.lineUserId, messages: input.messages }),`
ใหม่:
```ts
import { withLineExternalBrowserLinks } from '@watchdog-bms/contracts';
…
      // R-B1: exit-side rewrite; `input.retryKey` was computed by the caller from its own payload.
      body: JSON.stringify({ to: input.lineUserId, messages: withLineExternalBrowserLinks(input.messages) }),
```
`pushSystemLineMessages`/`pushSystemLineMessage`/`buildTemporaryPasswordFlexMessage` ไม่แตะ (clipboard action ไม่มี uri)

### 3.4 `apps/api/src/modules/dashboard-notifications/application/use-cases/notification.use-cases.ts` (ทางออก 3: notification rail + billing "อัปเดตแพ็กเกจ")

ปัจจุบัน (:795): `body: JSON.stringify({ to: lineUserId, messages: [message] }),`
ใหม่:
```ts
import { withLineExternalBrowserLinks } from '@watchdog-bms/contracts';
…
      // R-B1: exit-side only. `buildLineMessage` output is what billing-notifications.service.ts hashes
      // into its binding (:85, :368) and what `notificationLineRetryKey` never sees — both stay stable.
      body: JSON.stringify({ to: lineUserId, messages: withLineExternalBrowserLinks([message]) }),
```
ห้ามใส่ใน `buildLineMessage` (:717-771): จะเปลี่ยน binding → `LINE_BINDING_CHANGED` (`billing-notifications.service.ts:88, :370-372`) และ label check `:735-736` เทียบ `href.endsWith('/billing')` จะพัง

### 3.5 `apps/api/src/modules/line-ai/application/line-handoff-link.service.ts` (ตัด param ตอน mint)

ปัจจุบัน (:116-124):
```ts
  private async handoffFor(url: string, ctx: LineHandoffContext): Promise<string | null> {
    try {
      const parsed = new URL(url);
      // The destination is the path the message already decided to send, never the whole URL.
      return await this.linkFor(ctx, `${parsed.pathname}${parsed.search}`);
```
ใหม่:
```ts
import { stripLineExternalBrowserParam } from '@watchdog-bms/contracts';
…
      // The destination is the path the message already decided to send, never the whole URL — and
      // never the in-app-browser escape: the exit adds it to `/l/<token>` itself (R-B1), so a stored
      // target must not carry it into the post-exchange redirect.
      return await this.linkFor(ctx, stripLineExternalBrowserParam(`${parsed.pathname}${parsed.search}`));
```
และใน `linkFor` (:136-146) เปลี่ยน `targetPath,` ใน `mint.execute({...})` เป็น `targetPath: stripLineExternalBrowserParam(targetPath),` (caller ส่ง path ธรรมดาอยู่แล้ว — defensive)

### 3.6 `apps/api/src/modules/sales-console/domain/sales-deal.logic.ts` (ลบ hardcode)

ปัจจุบัน (:218-221):
```ts
    const link = new URL(`/companies/${encodeURIComponent(companyId)}/billing`, `${base.origin}/`);
    // LINE's browser and the system browser have separate cookies; start the billing login in one browser.
    link.searchParams.set('openExternalBrowser', '1');
    return link.origin === base.origin ? link.toString() : undefined;
```
ใหม่ (ลบ 2 บรรทัดกลาง):
```ts
    const link = new URL(`/companies/${encodeURIComponent(companyId)}/billing`, `${base.origin}/`);
    // The in-app-browser escape is added by the push exit (system-line-push.ts, R-B1), not here.
    return link.origin === base.origin ? link.toString() : undefined;
```

### 3.7 `apps/api/src/modules/line-ai/domain/logic/line-business-card.logic.ts`

(ก) door card — ปัจจุบัน (:413-415 comment, :422):
```ts
    return `${base.origin}/login?line=link-required&next=%2F&openExternalBrowser=1`;
```
ใหม่:
```ts
    return `${base.origin}/login?line=link-required&next=%2F`;
```
และแก้ comment :413-415 เป็น "`openExternalBrowser=1` is added by the reply exit (`line-reply.adapter.ts`, R-B1), never here."

(ข) `buildPackageRequiredMessage` — ปัจจุบัน (:516-545):
```ts
export function buildPackageRequiredMessage(input: {
  lockReason: PlanTermLockReason;
  companyId: string;
  /** Absent when billing is closed or no web base is configured — … */
  webBaseUrl?: string;
}): LineReplyMessage {
  const text = 'น้องมั่งมียังตอบไม่ได้จนกว่าจะเลือกแพ็กเกจค่ะ ข้อมูลทั้งหมดยังอยู่ครบ';
  const link = safeTenantLink(input.webBaseUrl, input.companyId,
    `/companies/${encodeURIComponent(input.companyId)}/billing?channel=line`);
```
ใหม่:
```ts
import { HANDOFF_PATH_PREFIX } from '../../../auth/domain/logic/line-handoff.logic';
…
/** Accepts only a handoff URL on our own web origin (`<web>/l/<token>`); anything else keeps the plain link. */
function oneTapPackageLink(webBaseUrl: string | undefined, candidate: string | undefined): string | undefined {
  if (!webBaseUrl || !candidate) return undefined;
  try {
    const base = new URL(webBaseUrl);
    const url = new URL(candidate);
    if (base.protocol !== 'https:' && base.protocol !== 'http:') return undefined;
    return url.origin === base.origin && url.pathname.startsWith(HANDOFF_PATH_PREFIX)
      && url.pathname.length > HANDOFF_PATH_PREFIX.length ? candidate : undefined;
  } catch {
    return undefined;
  }
}

export function buildPackageRequiredMessage(input: {
  lockReason: PlanTermLockReason;
  companyId: string;
  /** Absent when billing is closed or no web base is configured — the card then keeps only the
   *  staff door, which is still better than a link that goes nowhere. */
  webBaseUrl?: string;
  /** R-B2 (b): the `<web>/l/<token>` the lane minted before recording; must be on the web origin
   *  under `/l/`, otherwise the plain tenant link is used. */
  packageUrl?: string;
}): LineReplyMessage {
  const text = 'น้องมั่งมียังตอบไม่ได้จนกว่าจะเลือกแพ็กเกจค่ะ ข้อมูลทั้งหมดยังอยู่ครบ';
  const link = oneTapPackageLink(input.webBaseUrl, input.packageUrl) ?? safeTenantLink(input.webBaseUrl, input.companyId,
    `/companies/${encodeURIComponent(input.companyId)}/billing?channel=line`);
```
ส่วนที่เหลือของฟังก์ชัน (title/badge/buttons :526-544) คงเดิม

### 3.8 `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts` — R-B2 (ข) + group guard

(ก) import — เพิ่มที่ :159:
```ts
import { isLineGroupChatKey, LINE_HANDOFF_SURFACE_COMPANY_PICKER_OPEN } from '../../../auth/domain/logic/line-handoff.logic';
```

(ข) helper ใหม่ (วางถัดจาก `promotionCard` :2316):
```ts
  /**
   * R-B2 (b): mint the one-tap package link IN the lane, before `recordTurnOutcome` stores the
   * payload, so the stored bytes and the sent bytes carry the same token and LINE's retry key stays
   * one identity (RV07). Never in a group/room: anyone there could exchange it into the owner's
   * session (RV08) — a plain tenant URL (external-browser param added at the exit) is the answer.
   * Absent seam or a refused mint → `undefined`, and the caller renders the plain link it always sent.
   */
  private async oneTapPackageUrl(
    event: { lineUserId: string; pushTargetId?: string },
    userId: string,
    companyId: string,
    surface: 'locked_card_packages' | 'package_change_reply' | 'promotion_card_packages',
  ): Promise<string | undefined> {
    const chatKey = event.pushTargetId ?? event.lineUserId;
    if (!this.handoffLinks || isLineGroupChatKey(chatKey)) return undefined;
    return await this.handoffLinks.linkFor(
      { userId, companyId, lineUserId: chatKey, surface },
      `/companies/${encodeURIComponent(companyId)}/billing?channel=line`,
    ) ?? undefined;
  }
```

(ค) `replyIfCompanyLocked` — ปัจจุบัน (:2184-2192):
```ts
    const owner = await lockedCompanyFor(this.prisma, userId, true);
    if (owner) {
      if (['test', 'live'].includes(this.config.billingMode) && this.config.webBaseUrl) {
        // The same seam `handlePackageChangeRequest` uses: the handoff binds this link to this
        // owner, so the card is one tap into their own package page rather than a login wall.
        event.handoff = { userId, companyId: owner.companyId };
        await this.deliverRequiredMessages(event, [buildPackageRequiredMessage({
          lockReason: owner.lockReason, companyId: owner.companyId, webBaseUrl: this.config.webBaseUrl,
        })]);
```
ใหม่:
```ts
    const manager = await lockedCompanyFor(this.prisma, userId, true);
    if (manager) {
      if (['test', 'live'].includes(this.config.billingMode) && this.config.webBaseUrl) {
        // R-B2 (b): the link is minted here, before the outcome is recorded, so the card is one tap
        // into the package page whether or not the delivery seam wraps (it does not with the replay
        // flag on — production). `event.handoff` still binds the turn's tenant for bookkeeping.
        event.handoff = { userId, companyId: manager.companyId };
        const packageUrl = await this.oneTapPackageUrl(event, userId, manager.companyId, 'locked_card_packages');
        await this.deliverRequiredMessages(event, [buildPackageRequiredMessage({
          lockReason: manager.lockReason, companyId: manager.companyId, webBaseUrl: this.config.webBaseUrl,
          ...(packageUrl ? { packageUrl } : {}),
        })]);
```
บรรทัด :2193-2208 (billing ปิด → `expiredLineOwnerMessageTh()`; member reply; event log `package_required`) คงเดิม (แทน `owner.companyId` ด้วย `manager.companyId` ที่ :2201). แก้ doc comment :2176 "The OWNER is the only person who can act" → "Members whose role grants `company.plan.manage` (R-C11) are the only ones who can act"

(ง) `handlePackageChangeRequest` — ปัจจุบัน (:2841-2848):
```ts
    if (['test', 'live'].includes(this.config.billingMode) && this.config.webBaseUrl) {
      // Old rich-menu/message commands converge here too. The card offers a review page, never
      // claims payment or changes rights; the existing delivery seam binds its handoff to this owner.
      event.handoff = { userId, companyId: owned.companyId };
      const url = new URL(`/companies/${encodeURIComponent(owned.companyId)}/billing?channel=line`, this.config.webBaseUrl).toString();
      await this.deliverReply(event, `📦 ${owned.company.name}\nดูแพ็กเกจ ตรวจสอบการชำระเงิน และเปิดใบเสร็จได้ที่\n${url}\nกรุณาตรวจสอบราคาและยืนยันบนเว็บก่อนชำระเงินค่ะ`);
      await this.updateEventLog(event.webhookEventId, 'billing_review_link', undefined, owned.companyId);
      return;
    }
```
ใหม่:
```ts
    if (['test', 'live'].includes(this.config.billingMode) && this.config.webBaseUrl) {
      // Old rich-menu/message commands converge here too. The reply offers a review page, never
      // claims payment or changes rights. R-B2 (b): the one-tap link is minted here, before the
      // outcome is recorded; a refused mint or a group chat keeps the plain tenant URL.
      event.handoff = { userId, companyId: owned.companyId };
      const plainUrl = new URL(`/companies/${encodeURIComponent(owned.companyId)}/billing?channel=line`, this.config.webBaseUrl).toString();
      const url = await this.oneTapPackageUrl(event, userId, owned.companyId, 'package_change_reply') ?? plainUrl;
      await this.deliverReply(event, `📦 ${owned.company.name}\nเลือกแพ็กเกจ ตรวจสอบการชำระเงิน และเปิดใบเสร็จได้ที่ลิงก์นี้ (เปิดในเบราว์เซอร์ให้อัตโนมัติ)\n${url}\nตรวจสอบราคาและยืนยันบนเว็บก่อนชำระเงินนะคะ`);
      await this.updateEventLog(event.webhookEventId, 'billing_review_link', undefined, owned.companyId);
      return;
    }
```

(จ) `promotionCard` group guard — ปัจจุบัน (:2310-2315):
```ts
    if (!this.config.webBaseUrl) return buildPromotionCard('owner');
    const targetPath = `/companies/${encodeURIComponent(companyId)}/billing?channel=line`;
    return buildPromotionCard('owner', await this.handoffLinks?.linkFor(
      { userId: identity.userId, companyId, lineUserId: event.lineUserId, surface: 'promotion_card_packages' },
      targetPath,
    ) ?? new URL(targetPath, this.config.webBaseUrl).toString());
```
ใหม่:
```ts
    if (!this.config.webBaseUrl) return buildPromotionCard('owner');
    const targetPath = `/companies/${encodeURIComponent(companyId)}/billing?channel=line`;
    // Same mint as the lock card; in a group/room the button stays the plain package page (RV08).
    return buildPromotionCard('owner', await this.oneTapPackageUrl(event, identity.userId, companyId, 'promotion_card_packages')
      ?? new URL(targetPath, this.config.webBaseUrl).toString());
```
หมายเหตุ: เดิม mint ด้วย `lineUserId: event.lineUserId` (คนกด) แม้อยู่ในกลุ่ม; ใหม่ใช้ `pushTargetId ?? lineUserId` ตามที่ `attemptDelivery` (:3278) ใช้ — ในแชต 1:1 สองค่านี้เท่ากัน (`line-webhook.controller.ts:78`)

(ฉ) ห้ามแตะ `attemptDelivery` (:3261-3301) และ `sendMessages` (:3155-3253): เงื่อนไข `!this.config.lineAiTerminalOutcomeReplayEnabled` (:3274) มีไว้เพื่อให้ payload ที่บันทึกไม่มี token อายุ 15 นาที (comment :3271-3273) — เลนสามเลนนี้ตัดสินใจถือ token ในรายการที่บันทึกเอง (แบบเดียวกับ promotion card และ บริษัทของฉัน :5800/:5850 ที่ทำอยู่แล้ว)

### 3.9 `apps/web/app/l/[token]/route.ts` — HEAD + client IP

ปัจจุบัน (:1-5, :48-55):
```ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { internalApiV1Base } from '@/common/api/internal-api-base';
import { generateCsrfToken, setAuthCookies } from '@/common/auth/auth-cookies.server';
import { publicOriginFromHeaders, sanitizeReturnTo } from '@/features/auth/line-login-bff.logic';
…
    apiRes = await fetch(`${internalApiV1Base()}/auth/line/handoff/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      cache: 'no-store',
    });
```
ใหม่:
```ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { forwardedClientHeaders } from '@/common/api/forwarded-client-headers';
import { internalApiV1Base } from '@/common/api/internal-api-base';
import { generateCsrfToken, setAuthCookies } from '@/common/auth/auth-cookies.server';
import { publicOriginFromHeaders, sanitizeReturnTo } from '@/features/auth/line-login-bff.logic';

/**
 * Link previews and reachability probes send HEAD. Next.js would otherwise derive HEAD from GET and
 * RUN it — spending the single-use token before the person taps (deeplink spec §G7, RV22). 204 and
 * nothing else: the token never reaches the API on a HEAD.
 */
export function HEAD() {
  return new Response(null, { status: 204 });
}
…
    apiRes = await fetch(`${internalApiV1Base()}/auth/line/handoff/exchange`, {
      method: 'POST',
      // RV22: the API keys its exchange limiter (20/60 s) on `trustedClientIp`; without the visitor's
      // chain every tap in the country shares the web container's one bucket and overflows to /login.
      headers: { 'Content-Type': 'application/json', ...forwardedClientHeaders(request.headers) },
      body: JSON.stringify({ token }),
      cache: 'no-store',
    });
```
พฤติกรรมอื่นคงเดิม (token จาก path เท่านั้น :45-46 — query `openExternalBrowser=1` ที่ exit เติมมาไม่ถูกอ่าน)

### 3.10 `apps/api/src/modules/external-signup/application/get-line-signup-status.use-case.ts` — DTO ร้านล็อก

ปัจจุบัน (:53-67, :73-78, :85-102):
```ts
    identity
      ? prisma.client.companyMembership.findMany({
          where: {
            userId: identity.userId,
            status: 'ACTIVE',
            roles: { some: { role: { status: 'ACTIVE' } } },
            OR: [
              { company: { status: 'ACTIVE' } },
              { company: { status: 'DISABLED', planTerm: { termDisabledAt: { not: null } } } },
            ],
          },
          orderBy: { createdAt: 'asc' },
          select: { companyId: true, company: { select: { name: true, status: true } } },
        })
      : Promise.resolve([]),
…
  const eligibleCompanies = memberships.map((membership) => ({
    companyId: membership.companyId,
    companyName: membership.company.name,
    status: membership.company.status === 'ACTIVE' ? 'ACTIVE' as const : 'EXPIRED' as const,
    canEnter: membership.company.status === 'ACTIVE',
  }));
…
function toProgress(
  request: CompanySignupRequest,
  existingAccount: boolean,
  businessHours: boolean,
  verified: VerifiedLineSignupIdentity,
  eligibleCompanies: Array<{ companyId: string; canEnter: boolean }>,
) {
  …
  const entryCompanyId = storedEntryCompanyId
    && eligibleCompanies.some((company) => company.companyId === storedEntryCompanyId && company.canEnter)
    ? storedEntryCompanyId
    : undefined;
```
ใหม่:
```ts
import { canManagePlan } from '../../access-control/domain/logic/plan-manager.logic';
import { planTermLockReason } from '../../system-partner-management/domain/logic/plan-term.logic';
import type { LineSignupEligibleCompanyDto, … } from '@watchdog-bms/contracts';
…
          select: {
            companyId: true,
            company: { select: { name: true, status: true, planTerm: { select: { termStartAt: true, termEndsAt: true, renewCount: true } } } },
            // Only what `canManagePlan` reads; the `some` filter above already keeps ACTIVE roles.
            roles: { where: { role: { status: 'ACTIVE' } }, select: { role: { select: { permissions: { select: { permission: { select: { key: true } } } } } } } },
          },
…
  const eligibleCompanies: LineSignupEligibleCompanyDto[] = memberships.map((membership) => {
    const locked = membership.company.status !== 'ACTIVE';
    return {
      companyId: membership.companyId,
      companyName: membership.company.name,
      status: locked ? 'EXPIRED' as const : 'ACTIVE' as const,
      canEnter: !locked,
      // R-C2 (§18.2): display fields for a locked shop only, so an ACTIVE row keeps its exact shape.
      ...(locked ? {
        lockReason: membership.company.planTerm ? planTermLockReason(membership.company.planTerm) : 'trial_ended' as const,
        canManagePlan: canManagePlan(membership.roles),
      } : {}),
    };
  });
…
function toProgress(
  request: CompanySignupRequest,
  existingAccount: boolean,
  businessHours: boolean,
  verified: VerifiedLineSignupIdentity,
  eligibleCompanies: Array<{ companyId: string; canEnter: boolean; lockReason?: PlanTermLockReason }>,
) {
  …
  const entryCompanyId = storedEntryCompanyId
    && eligibleCompanies.some((company) => company.companyId === storedEntryCompanyId && company.canEnter)
    ? storedEntryCompanyId
    : undefined;
  // The same stored shop when it exists but is locked: the page names the next step (choose a
  // package) instead of "cannot enter". Display only — `entryCompanyId` above stays the grant.
  const lockedEntryCompanyId = !entryCompanyId && storedEntryCompanyId
    && eligibleCompanies.some((company) => company.companyId === storedEntryCompanyId && !company.canEnter && company.lockReason)
    ? storedEntryCompanyId
    : undefined;
  …
    ...(entryCompanyId ? { entryCompanyId } : {}),
    ...(lockedEntryCompanyId ? { lockedEntryCompanyId } : {}),
```
`import type { PlanTermLockReason } from '@watchdog-bms/contracts'` เพิ่มใน import list :3-8. `planTermLockReason` (spm `plan-term.logic.ts:74-80`) รับ `{termStartAt, termEndsAt, renewCount}` — fallback `'trial_ended'` ตามที่ webhook `lockedCompanyFor` (:1716) ใช้

### 3.11 `apps/api/src/modules/auth/application/use-cases/exchange-liff-session.use-case.ts` — `destination()` permission-aware (R-C3)

ปัจจุบัน (:26, :113-125, :141-144):
```ts
  | { needsSelection: true; companies: Array<{ id: string; name: string }> }
…
    const memberships = await this.prisma.client.companyMembership.findMany({
      where: { userId, status: 'ACTIVE', OR: [
        { company: { status: 'ACTIVE' } },
        { company: { status: 'DISABLED', planTerm: { termDisabledAt: { not: null } } } },
      ] },
      orderBy: { createdAt: 'asc' },
      select: { companyId: true, company: { select: { name: true, status: true, planTerm: { select: { termEndsAt: true, termDisabledAt: true } } } } },
    });

    const destination = (membership: typeof memberships[number]) => {
      const targetPath = resolveLineHandoffTarget(membership.companyId, `/companies/${membership.companyId}/${LIFF_START_TARGET_PATH}`, membership.company);
      return targetPath ? { companyId: membership.companyId, targetPath } : { reason: 'suspended' as const };
    };
…
    return {
      needsSelection: true,
      companies: memberships.map((membership) => ({ id: membership.companyId, name: membership.company.name })),
    };
```
ใหม่:
```ts
import type { PlanTermLockReason } from '@watchdog-bms/contracts';
import { canManagePlan } from '../../../access-control/domain/logic/plan-manager.logic';
import { planTermLockReason } from '../../../system-partner-management/domain/logic/plan-term.logic';
…
  | { needsSelection: true; companies: Array<{ id: string; name: string; lockReason?: PlanTermLockReason; canManagePlan?: boolean }> }
…
      select: {
        companyId: true,
        company: { select: { name: true, status: true, planTerm: { select: { termStartAt: true, termEndsAt: true, renewCount: true, termDisabledAt: true } } } },
        roles: { where: { role: { status: 'ACTIVE' } }, select: { role: { select: { permissions: { select: { permission: { select: { key: true } } } } } } } },
      },
    });

    // Same "locked" boundary `resolveLineHandoffTarget` applies: an ended term or the sweep's lock.
    const now = new Date();
    const isLocked = (membership: typeof memberships[number]) =>
      (membership.company.status === 'DISABLED' && !!membership.company.planTerm?.termDisabledAt)
      || (membership.company.status === 'ACTIVE' && !!membership.company.planTerm?.termEndsAt && membership.company.planTerm.termEndsAt <= now);
    const lockInfo = (membership: typeof memberships[number]) => isLocked(membership) ? {
      lockReason: membership.company.planTerm ? planTermLockReason(membership.company.planTerm) : 'trial_ended' as const,
      canManagePlan: canManagePlan(membership.roles),
    } : {};

    const destination = (membership: typeof memberships[number]) => {
      // R-C3: a locked shop lands its plan manager on the package page directly (Q5); everyone else
      // keeps the locked shell's /renew, which `resolveLineHandoffTarget` still enforces below.
      const wanted = isLocked(membership) && canManagePlan(membership.roles)
        ? `/companies/${membership.companyId}/billing?channel=line`
        : `/companies/${membership.companyId}/${LIFF_START_TARGET_PATH}`;
      const targetPath = resolveLineHandoffTarget(membership.companyId, wanted, membership.company, now);
      return targetPath ? { companyId: membership.companyId, targetPath } : { reason: 'suspended' as const };
    };
…
    return {
      needsSelection: true,
      companies: memberships.map((membership) => ({ id: membership.companyId, name: membership.company.name, ...lockInfo(membership) })),
    };
```
ไม่แตะ `line-handoff.logic.ts:140-156` (`resolveLineHandoffTarget`): `/billing?channel=line` ผ่าน `isBillingCustomerRecoveryPath` (`contracts/billing.ts:215-219` ตัด query ก่อนเทียบ) → คืน `targetPath` เดิมสำหรับร้านล็อก; `/dashboard` ของร้านล็อก → `/renew` เหมือนเดิม

### 3.12 `apps/api/src/common/security/liff-page.security.ts` (template string — แก้ใน `LIFF_PAGE_SCRIPT`)

(ก) ค่าคงที่ — เพิ่มหลัง :176 (`START_REASON_TH`):
```js
  /** R-C2: the two lock states a shop can be in, and the button that fixes each (short: LINE-length buttons). */
  const LOCK_LABEL_TH = { no_package: 'ยังไม่มีแพ็กเกจ', trial_ended: 'หมดอายุ' };
  const LOCK_ACTION_TH = { no_package: 'เลือกแพ็กเกจ', trial_ended: 'ต่ออายุ' };
  /** startSession() options for a locked shop: the same handoff, labelled for the package page it opens. */
  const PACKAGE_START = { buttonLabel: 'เลือกแพ็กเกจ', readyText: 'พร้อมแล้วค่ะ กดเลือกแพ็กเกจเพื่อเปิดหน้าแพ็กเกจในเบราว์เซอร์' };
  const lockLabel = function (company) { return LOCK_LABEL_TH[company.lockReason] || LOCK_LABEL_TH.trial_ended; };
  const lockAction = function (company) { return LOCK_ACTION_TH[company.lockReason] || LOCK_ACTION_TH.trial_ended; };
```

(ข) `renderEligibleCompanies` — ปัจจุบัน (:658-662):
```js
      } else {
        const note = document.createElement('p');
        note.textContent = company.companyName + ' หมดอายุแล้ว ติดต่อทีมงานเพื่อเลือกแพ็กเกจก่อนเข้าใช้งานค่ะ';
        listEl.appendChild(note);
      }
```
ใหม่:
```js
      } else {
        // R-C2: the state in the body text (buttons are length-limited), the fix as a short button
        // for whoever may buy; staff see the state and the support door the caller already shows.
        const note = document.createElement('p');
        note.textContent = company.companyName + ' · ' + lockLabel(company);
        listEl.appendChild(note);
        if (company.canManagePlan === true) {
          const choose = document.createElement('button');
          choose.type = 'button';
          choose.textContent = lockAction(company);
          choose.addEventListener('click', function () {
            void runWith(function () { return startSession(company.companyId, PACKAGE_START); }, choose, 'กำลังเตรียมลิงก์…');
          });
          listEl.appendChild(choose);
        }
      }
```

(ค) COMPLETED branch — ปัจจุบัน (:700-713):
```js
    if (progress.state === 'COMPLETED') {
      const returned = progress.resolution === 'RETURN_EXISTING';
      setProgress('พร้อมเริ่มใช้งาน', returned
        ? shop + ' ใช้ต่อได้เลยค่ะ ไม่มีการเปิดร้านใหม่'
        : shop + ' เปิดสำเร็จแล้วค่ะ', progress);
      const entered = renderEligibleCompanies(companies, progress.entryCompanyId || '', true);
      if (!entered) {
        document.getElementById('progress-title').textContent = 'ร้านนี้ยังเข้าใช้ไม่ได้';
        document.getElementById('progress-text').textContent = 'สิทธิ์หรือแพ็กเกจปัจจุบันยังไม่พร้อมให้เข้าใช้ กรุณาติดต่อทีมงานเพื่อตรวจสอบค่ะ';
        showSupport();
      }
      document.getElementById('add-shop').hidden = false;
      return;
    }
```
ใหม่:
```js
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
        if (locked && locked.canManagePlan === true) {
          // R-C2: the shop exists and is waiting for its package. Prepare the handoff NOW so the
          // primary button is one tap (GW02 only forbids opening it without a gesture).
          document.getElementById('progress-title').textContent = 'เปิดร้านแล้ว ขั้นต่อไปเลือกแพ็กเกจ';
          document.getElementById('progress-text').textContent = shop + ' เปิดให้แล้วค่ะ เลือกแพ็กเกจเพื่อเริ่มใช้งาน ระบบจะพาไปหน้าแพ็กเกจในเบราว์เซอร์ให้ค่ะ';
          const retry = document.getElementById('retry-status');
          retry.hidden = false;
          void runWith(function () { return startSession(locked.companyId, PACKAGE_START); }, retry, 'กำลังเตรียมลิงก์…');
          showSupport();
        } else if (locked) {
          document.getElementById('progress-title').textContent = 'เปิดร้านแล้ว รอเลือกแพ็กเกจ';
          document.getElementById('progress-text').textContent = shop + ' ' + lockLabel(locked) + ' ให้เจ้าของร้านหรือผู้ดูแลแพ็กเกจเลือกแพ็กเกจก่อน แล้วเข้าใช้งานได้เลยค่ะ';
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
```
เหตุที่ใช้ `#retry-status` เป็นปุ่ม activity: `runWith` ที่ไม่ส่ง `activeButton` จะไป disable `#link` (ปุ่มฟอร์ม) และไม่ปลดใน signup mode; `#retry-status` ("ตรวจสอบสถานะอีกครั้ง") เป็นทาง retry ที่ถูกต้องอยู่แล้ว (re-render → เตรียมลิงก์ใหม่) และหลังแก้ (ฉ) label จะคืนเมื่อสำเร็จ

(ง) `startSession(companyId)` → `startSession(companyId, opts)` — ปัจจุบัน (:990, :1026-1029):
```js
  async function startSession(companyId) {
…
    if (!openWebBtn) throw new Error(UNAVAILABLE_TH);
    preparedHandoffUrl = handoffUrl;
    openWebBtn.hidden = false;
    setStatus('พร้อมแล้วค่ะ กดเปิดหน้าเว็บเพื่อเข้าร้าน', '', 'info');
  }
```
ใหม่:
```js
  async function startSession(companyId, opts) {
…
    if (!openWebBtn) throw new Error(UNAVAILABLE_TH);
    preparedHandoffUrl = handoffUrl;
    openWebBtn.textContent = (opts && opts.buttonLabel) || 'เปิดหน้าเว็บ';
    openWebBtn.hidden = false;
    setStatus((opts && opts.readyText) || 'พร้อมแล้วค่ะ กดเปิดหน้าเว็บเพื่อเข้าร้าน', '', 'info');
  }
```
`#open-web` มีอยู่ทั้งหน้า signup (`auth.controller.ts:564`) และ start (`:663`); handler คลิก (:1032-1045) ใช้ `liff.openWindow({ url, external: true })` อยู่แล้ว — ไม่แก้

(จ) `renderCompanyChoices` (needsSelection ของหน้า start) — ปัจจุบัน (:1055): `button.textContent = company.name;`
ใหม่:
```js
      // R-C2/R-C3: a locked shop says so in the button; the server decides its landing (billing or renew).
      button.textContent = company.name + (company.lockReason ? ' · ' + LOCK_LABEL_TH[company.lockReason] : '');
```

(ฉ) busy-label leftover — ปัจจุบัน (:1066-1101) หลัง `await action()` สำเร็จ ปุ่มรองที่ถูกส่งเป็น `activeButton` ยังค้าง label busy (เช่น `retry-status` = "กำลังตรวจสอบ…" หรือรายการร้าน = "กำลังเปิดร้าน…") และ `disabled=true` เพราะ `finally` ปลดเฉพาะ `mode === 'start'` หรือ `start-existing`. แก้: เพิ่มหลัง `await action();` (:1076):
```js
      await action();
      // A secondary button that showed a busy label gets its words and its tap back on success; the
      // form's own button keeps the existing rule (the view moves on and re-enables it itself).
      if (button && busyLabel) { button.textContent = label; button.disabled = false; }
```

(ช) ไม่แก้ `START_REASON_TH.expired` (:174) — เข้าถึงได้ยาก (`blockedReason` คืน `'expired'` เฉพาะ DISABLED+termDisabledAt ซึ่ง `resolveCompany` รวมไว้ในรายการอยู่แล้ว) — ดู §10

### 3.13 `apps/api/src/modules/external-signup/application/line-signup-notify.service.ts` — push หลังสมัคร (R-C4)

ปัจจุบัน (:51-58, :356-374):
```ts
export function approvedMessageTh(companyName: string): string {
  return `🎉 เปิดร้าน ${companyName} ให้แล้วค่ะ ขั้นต่อไปคือเลือกแพ็กเกจเพื่อเริ่มใช้งาน `
    + 'กดเปิดหน้าเว็บเพื่อดูแพ็กเกจและชำระเงินได้เลยนะคะ';
}

export function attachedMessageTh(companyName: string): string {
  return `🎉 เพิ่มร้าน ${companyName} ให้บัญชีของคุณแล้วค่ะ สลับร้านได้ในเมนู หรือกดเปิดหน้าเว็บนะคะ`;
}
…
  private readyMessage(kind: LineSignupPushKind, companyName: string): unknown {
    const text = kind === 'attached' ? attachedMessageTh(companyName) : approvedMessageTh(companyName);
    const liffId = this.config.lineLiffId;
    if (!liffId) return { type: 'text', text };
    return {
      type: 'flex',
      altText: text.slice(0, 400),
      contents: {
        type: 'bubble', size: 'kilo',
        body: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px', contents: [
          { type: 'text', text: 'พร้อมใช้งานแล้ว', weight: 'bold', size: 'md', color: '#101828', wrap: true },
          { type: 'text', text, size: 'sm', color: '#475467', wrap: true },
        ] },
        footer: { type: 'box', layout: 'vertical', contents: [
          { type: 'button', style: 'primary', color: '#22C55E', action: { type: 'uri', label: 'เริ่มใช้งาน', uri: `https://liff.line.me/${liffId}/start` } },
        ] },
      },
    };
  }
```
ใหม่:
```ts
export function approvedMessageTh(companyName: string): string {
  return `🎉 เปิดร้าน ${companyName} ให้แล้วค่ะ ขั้นต่อไปเลือกแพ็กเกจเพื่อเริ่มใช้งาน `
    + 'กดปุ่มด้านล่าง แล้วกดเปิดหน้าเว็บเพื่อดูแพ็กเกจและชำระเงินได้เลยนะคะ';
}

export function attachedMessageTh(companyName: string): string {
  return `🎉 เพิ่มร้าน ${companyName} ให้บัญชีของคุณแล้วค่ะ ขั้นต่อไปเลือกแพ็กเกจให้ร้านนี้ `
    + 'กดปุ่มด้านล่างได้เลยนะคะ สลับร้านได้ในเมนู บริษัทของฉัน';
}
…
  /**
   * §3.4/§7, R-C4 (§18.2): the button opens the CENTRAL LIFF start URL. No token travels in the
   * message (LINE-ONBOARD-01; a 15-minute token would be dead before a push retried for hours) —
   * the handoff is minted when the button is tapped, and the start page lands a plan manager on the
   * package page (R-C3). Two taps from the push, by design (DQ3).
   */
  private readyMessage(kind: LineSignupPushKind, companyName: string): unknown {
    const text = kind === 'attached' ? attachedMessageTh(companyName) : approvedMessageTh(companyName);
    const liffId = this.config.lineLiffId;
    if (!liffId) return { type: 'text', text };
    return {
      type: 'flex',
      altText: text.slice(0, 400),
      contents: {
        type: 'bubble', size: 'kilo',
        body: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px', contents: [
          { type: 'text', text: kind === 'attached' ? 'เพิ่มร้านแล้ว' : 'เปิดร้านแล้ว', weight: 'bold', size: 'md', color: '#101828', wrap: true },
          { type: 'text', text, size: 'sm', color: '#475467', wrap: true },
        ] },
        footer: { type: 'box', layout: 'vertical', contents: [
          { type: 'button', style: 'primary', color: '#22C55E', action: { type: 'uri', label: 'เลือกแพ็กเกจ', uri: `https://liff.line.me/${liffId}/start` } },
        ] },
      },
    };
  }
```
(`liff.line.me` อยู่ใน skip list ของ exit — ไม่ได้ param; retry key `lineSignupPushRetryKey` ไม่ขึ้นกับ payload)

### 3.14 webhook — ถอดภาพวิธีใช้ตอน follow (R-C4/RV33)

ปัจจุบัน (:252, :2226-2230):
```ts
const FOLLOW_WELCOME_IMAGE_PATH = '/assets/line/mangmeeplus-welcome-how-to-start-1080x1350.png';
…
      if (!welcome) return [this.doorCard()];
      const imageUrl = absoluteWebLink(this.config.webBaseUrl, FOLLOW_WELCOME_IMAGE_PATH);
      const image: LineReplyMessage | null = URL.canParse(imageUrl) && new URL(imageUrl).protocol === 'https:'
        ? { type: 'image', originalContentUrl: imageUrl, previewImageUrl: imageUrl }
        : null;
      return [{ type: 'text', text: FOLLOW_WELCOME_REPLY }, ...(image ? [image] : []), this.doorCard()];
```
ใหม่ (ลบค่าคงที่ :252 และ image):
```ts
      if (!welcome) return [this.doorCard()];
      // R-C4 (§18.2): the how-to picture showed no "choose a package" step, and a locked shop cannot
      // take the steps it did show. Withdrawn until a new asset under a NEW file name exists (LINE
      // caches by URL; apps/web/public is a Release Contracts trigger — the old PNG stays untouched).
      return [{ type: 'text', text: FOLLOW_WELCOME_REPLY }, this.doorCard()];
```
ถ้า `absoluteWebLink` ไม่ถูกใช้ที่อื่นในไฟล์หลังลบ ให้ลบ import (:122) — **ต้องตรวจ** (`grep -n absoluteWebLink` ในไฟล์: ยังใช้ที่ :965 `putLineMediaUpload` → คง import)

### 3.15 G19 — postback "ให้ทีมงานติดต่อกลับ"

(ก) `line-staff-menu.logic.ts` — เพิ่มค่าคงที่ (หลัง :13 `STAFF_CONTACT_COMMAND`):
```ts
/**
 * G19 (purchase-without-setup spec §12/RV32): the promotion card's "ask the team" is a CALLBACK request,
 * not a package-change request and not "ติดต่อเจ้าหน้าที่" — it must not silence the assistant for 24 h.
 * Travels as a postback so the words never enter the chat as something the customer typed.
 */
export const PACKAGE_CALLBACK_COMMAND = 'ให้ทีมงานติดต่อกลับ';
export const PACKAGE_CALLBACK_POSTBACK = 'action=package-callback';
```
`StaffMenuCommand` union (:609-613): เพิ่ม `| 'package_callback'` ต่อจาก `'staff_contact'`
`staffMenuCommand` (:651): เพิ่มบรรทัด `if (normalized === PACKAGE_CALLBACK_COMMAND) return 'package_callback';`
`POSTBACK_ACTIONS` (:671-676): เพิ่ม `'package-callback': PACKAGE_CALLBACK_COMMAND,`
`buildPromotionCard` (:321) — ปัจจุบัน:
```ts
        ...(stranger ? [] : [{ type: 'button', style: 'secondary', action: { type: 'message', label: 'ให้ทีมงานช่วยเลือก', text: PACKAGE_CHANGE_COMMAND } }]),
```
ใหม่:
```ts
        // G19: a callback request that files a support row without pausing the assistant (RV32).
        ...(stranger ? [] : [{ type: 'button', style: 'secondary', action: { type: 'postback', label: PACKAGE_CALLBACK_COMMAND, data: PACKAGE_CALLBACK_POSTBACK, displayText: PACKAGE_CALLBACK_COMMAND } }]),
```
แก้ comment :318-320 ให้ตรง ("the request lands in the support inbox as a callback")

(ข) `line-webhook.controller.ts:87` `linePostbackCommandText(event.postback?.data, …)` — ไม่ต้องแก้ (mapping มาจากตาราง)

(ค) webhook — ค่าคงที่ใหม่ (วางหลัง :269 `SUPPORT_DAILY_LIMIT_REPLY`):
```ts
/** G19: what the inbox shows for a callback request (requestText/lastMessageText + thread line). */
const PACKAGE_CALLBACK_NOTE = 'ขอให้ทีมงานติดต่อกลับเรื่องแพ็กเกจ';
/** G19: no pause — the assistant keeps answering while the team calls back (RV32). */
const PACKAGE_CALLBACK_REPLY = '📮 รับเรื่องแล้วค่ะ ทีมงานจะติดต่อกลับเรื่องแพ็กเกจในเวลาทำการ (จันทร์–เสาร์ 9:00–18:00) '
  + 'ระหว่างนี้ถามน้องมั่งมีต่อได้เลยนะคะ';
const PACKAGE_CALLBACK_ALREADY_OPEN_REPLY = '📮 คำขอของคุณยังอยู่ในคิวค่ะ ทีมงานจะติดต่อกลับในเวลาทำการ (จันทร์–เสาร์ 9:00–18:00) นะคะ';
```
(ง) แยก transaction สร้างแถวออกจาก `handleStaffContact` (:2385-2422) เป็น method ใหม่ แล้วให้ `handleStaffContact` เรียก:
```ts
  /**
   * The ONE creator of a `LineSupportRequest` row (§2.1). Returns the live row when one raced ahead,
   * `null` when the daily amplification floor refused, else the created id. `text` is what the
   * operator reads first (requestText/lastMessageText and the opening thread line).
   */
  private async openSupportRequest(
    lineUserId: string,
    asker: { companyId: string | null; signupRequestId?: string } | null,
    text: string | undefined,
  ): Promise<{ id: string; status?: string } | null> {
    return this.prisma.client.$transaction(async (tx) => {
      const lockKey = `line-support:${hashMessagePreview(lineUserId)}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
      const raced = await tx.lineSupportRequest.findFirst({
        where: { lineUserId, status: { in: ['OPEN', 'ANSWERED'] } },
        orderBy: { requestedAt: 'desc' }, select: { id: true, status: true },
      });
      if (raced) {
        const touched = await tx.lineSupportRequest.updateMany({
          where: { id: raced.id, status: raced.status },
          data: { lastMessageAt: new Date(), ...(raced.status === 'ANSWERED'
            ? { status: 'OPEN', reopenedCount: { increment: 1 } } : {}) },
        });
        if (touched.count === 0) throw new ConflictException('line_support_state_changed');
        return raced;
      }
      if (this.rateLimit && !await this.rateLimit.consumeLineSupportRequestSlot(lineUserId)) return null;
      return tx.lineSupportRequest.create({
        data: {
          lineUserId,
          lineUserIdHash: hashMessagePreview(lineUserId),
          ...(asker?.companyId ? { companyId: asker.companyId } : {}),
          ...(asker?.signupRequestId ? { signupRequestId: asker.signupRequestId } : {}),
          ...(text ? { requestText: text, lastMessageText: text } : {}),
          ...(text ? { messages: { create: { direction: 'CUSTOMER', kind: 'TEXT', text } } } : {}),
        },
        select: { id: true },
      });
    });
  }
```
ใน `handleStaffContact` แทน block :2385-2422 ด้วย `const created = await this.openSupportRequest(event.lineUserId, asker, asker?.lastMessageText);` (พฤติกรรมเดิมทุกอย่าง — bytes ของ `data` เท่าเดิม)

(จ) handler ใหม่ (วางถัดจาก `handleStaffContact`):
```ts
  /**
   * G19 / RV32. "ให้ทีมงานติดต่อกลับ" on the promotion card files a callback request in the same inbox
   * as ติดต่อเจ้าหน้าที่ — same dedupe, same daily floor, same operator notice — but it NEVER pauses
   * the assistant: the customer asked for a call, not for the bot to go quiet. Public like its twin.
   */
  private async handlePackageCallback(event: LineTextEvent, requestId: string): Promise<void> {
    const asker = await this.resolveSupportAsker(event);
    const live = await this.findLiveSupportRequest(event.lineUserId);
    if (live) {
      await this.recordSupportFollowUp(event.lineUserId, requestId, { text: PACKAGE_CALLBACK_NOTE }, { extendPause: false });
      await this.deliverReply(event, PACKAGE_CALLBACK_ALREADY_OPEN_REPLY);
      await this.audit.log({
        action: 'signup.line.support_requested',
        ...(asker?.companyId ? { companyId: asker.companyId } : {}),
        targetType: 'line_support_request', targetId: live.id, requestId, result: 'SUCCESS', riskLevel: 'LOW',
        metadataJson: { kind: 'package_callback', alreadyOpen: true, reopened: live.status === 'ANSWERED', paused: false },
      });
      await this.updateEventLog(event.webhookEventId, 'support_already_open');
      return;
    }
    const created = await this.openSupportRequest(event.lineUserId, asker, PACKAGE_CALLBACK_NOTE);
    if (!created) {
      await this.deliverReply(event, SUPPORT_DAILY_LIMIT_REPLY);
      await this.audit.log({
        action: 'signup.line.support_requested',
        ...(asker?.companyId ? { companyId: asker.companyId } : {}),
        targetType: 'line_user', requestId, result: 'DENIED', riskLevel: 'LOW',
        metadataJson: { kind: 'package_callback', reason: 'daily_limit', linked: Boolean(asker) },
      });
      await this.updateEventLog(event.webhookEventId, 'support_rate_limited');
      return;
    }
    // Deliberately NO pauseAssistant here (the one difference from handleStaffContact).
    await this.deliverReply(event, PACKAGE_CALLBACK_REPLY);
    await this.signupNotify?.enqueueSupportRequest(created.id);
    await this.audit.log({
      action: 'signup.line.support_requested',
      ...(asker?.companyId ? { companyId: asker.companyId } : {}),
      targetType: 'line_support_request', targetId: created.id, requestId, result: 'SUCCESS', riskLevel: 'LOW',
      metadataJson: { kind: 'package_callback', paused: false, linked: Boolean(asker), hasPendingSignup: Boolean(asker?.signupRequestId) },
    });
    await this.updateEventLog(event.webhookEventId, 'package_callback_requested');
  }
```
(ฉ) `recordSupportFollowUp` (:2585-2648): เพิ่ม param ที่ 4 `options: { extendPause?: boolean } = {}` และครอบ block :2625-2628 ด้วย `if (options.extendPause !== false) { … }` (default เดิม = ต่อ pause)
(ช) dispatch — เพิ่มหลัง :3752-3755 (`staff_contact`) ก่อน `resume_ai`:
```ts
    if (publicCommand === 'package_callback') {
      await this.handlePackageCallback(event, requestId);
      return;
    }
```
(อยู่เหนือ pause gate :3898-3911 และไม่ต้องมี identity เหมือน `staff_contact`)

(ซ) ต่อยอดโดย PR E (pr-e §4.1, ตัดสิน 2026-09-27): `openSupportRequest`/`recordSupportFollowUp` รับ `reference?: { kind: 'attempt' | 'invoice'; id: string }` ท้ายสุด และ `handlePackageCallback` derive reference จากบริษัทฝั่ง server (attempt ค้างล่าสุด → invoice ล่าสุด) — postback ยังไม่มี id (SEC-04) และ `handleStaffContact` ไม่ถูกแตะ; PR A ไม่ต้องเตรียมอะไรเพิ่ม

### 3.16 G20 / G25 / RV33 copy (ดูตาราง §5)

- `line-staff-menu.logic.ts:310` แก้ข้อความตามตาราง
- `line-public-policy.logic.ts` :6-34 แก้ `trial`, `trial_limits`(บรรทัด 16), `data`, `paid_renewal`, `buy_early` — คง key ทุกตัว, คง regex ของคำถาม (:86-103), คง `answer()`/`PUBLIC_PACKAGE_URL`
- webhook `FOLLOW_WELCOME_REPLY` :244 — **Owner-verbatim** (comment :236-238) → เสนอข้อความในตาราง แต่ห้าม merge จนกว่า Owner sign-off; ถ้ายังไม่ได้ ให้คง :244 ไว้และบันทึกใน memory
- `auth.controller.ts:580` แก้ตามตาราง

### 3.17 R-C11 helper — `apps/api/src/modules/access-control/domain/logic/plan-manager.logic.ts` (ใหม่)

```ts
// Spec: docs/specs/mangmee-purchase-without-setup-spec-th.md §18.2 R-C11 (Owner D-PF-10): LINE and the
// web answer "who may manage this shop's package" with ONE predicate — an ACTIVE member whose ACTIVE
// role grants `company.plan.manage` — the same rule billing.service.ts assertOwner enforces for
// purchases. OWNER holds every company permission (permission-registry.ts ROLE_GRANTS), so owners
// keep passing; a custom role with the permission now passes too. Plain functions, no Nest wiring.

export const PLAN_MANAGE_PERMISSION_KEY = 'company.plan.manage';

type RoleWithPermissions = {
  status?: string | null;
  permissions?: ReadonlyArray<{ permission: { key: string } }> | null;
};
type MembershipRoleRow = { role?: RoleWithPermissions | null } | null | undefined;

export type PlanManagerDb = {
  companyMembership: { findMany(args: any): Promise<any[]> };
  externalIdentity?: { findMany(args: any): Promise<any[]> };
};

/** Prisma `CompanyMembershipWhereInput` fragment; spread it beside `companyId`/`status`. */
export function planManagerRoleFilter() {
  return {
    roles: { some: { role: { status: 'ACTIVE' as const, permissions: { some: { permission: { key: PLAN_MANAGE_PERMISSION_KEY } } } } } },
  };
}

/** Over loaded rows. A role without `status` is one the caller already filtered to ACTIVE. */
export function canManagePlan(roles: ReadonlyArray<MembershipRoleRow> | null | undefined): boolean {
  return (roles ?? []).some((entry) => !!entry?.role
    && (entry.role.status ?? 'ACTIVE') === 'ACTIVE'
    && (entry.role.permissions ?? []).some((rp) => rp.permission.key === PLAN_MANAGE_PERMISSION_KEY));
}

export async function planManagersOf(db: PlanManagerDb, companyId: string): Promise<Array<{ userId: string }>> {
  return db.companyMembership.findMany({
    where: { companyId, status: 'ACTIVE', user: { status: 'ACTIVE' }, ...planManagerRoleFilter() },
    select: { userId: true },
  });
}

/** Sibling of ownerLineUserIds (package-change-decision.use-case.ts), which stays OWNER-based for support replies. */
export async function planManagerLineUserIds(db: PlanManagerDb, companyId: string, channelId: string): Promise<string[]> {
  const managers = await planManagersOf(db, companyId);
  if (managers.length === 0 || !db.externalIdentity) return [];
  const identities = await db.externalIdentity.findMany({
    where: { userId: { in: managers.map((m) => m.userId) }, provider: 'LINE', providerChannelId: channelId, status: 'ACTIVE' },
    select: { providerUserId: true },
  });
  return [...new Set(identities.map((identity: { providerUserId: string }) => identity.providerUserId))];
}
```

### 3.18 R-C11 call sites

(ก) `billing.service.ts` `assertOwner` — ปัจจุบัน (:117-120):
```ts
    if (!member || member.status !== 'ACTIVE' || member.user.status !== 'ACTIVE' ||
        !member.roles.some((r) => r.role.permissions.some((rp) => rp.permission.key === 'company.plan.manage'))) {
      throw new ForbiddenException('ต้องได้รับสิทธิ์จัดการแพ็กเกจบริษัท');
    }
```
ใหม่ (คง `FOR SHARE` :103-106 และ include :109-115):
```ts
import { canManagePlan } from '../../access-control/domain/logic/plan-manager.logic';
…
    if (!member || member.status !== 'ACTIVE' || member.user.status !== 'ACTIVE' || !canManagePlan(member.roles)) {
      throw new ForbiddenException('ต้องได้รับสิทธิ์จัดการแพ็กเกจบริษัท');
    }
```

(ข) webhook `lockedCompanyFor` — ปัจจุบัน (:1690-1695, :1707):
```ts
async function lockedCompanyFor(
  prisma: PrismaService,
  userId: string,
  /** OWNER-only for the renewal card; any active member for the neutral staff reply (C3). */
  ownerOnly: boolean,
): Promise<{ companyId: string; lockReason: PlanTermLockReason } | null> {
…
      ...(ownerOnly ? { roles: { some: { role: { key: 'OWNER' } } } } : {}),
```
ใหม่:
```ts
import { canManagePlan, planManagerRoleFilter } from '../../../access-control/domain/logic/plan-manager.logic';
…
async function lockedCompanyFor(
  prisma: PrismaService,
  userId: string,
  /** Plan managers only (`company.plan.manage`, R-C11) for the package card; any active member for the neutral staff reply (C3). */
  planManagersOnly: boolean,
): Promise<{ companyId: string; lockReason: PlanTermLockReason } | null> {
…
      ...(planManagersOnly ? planManagerRoleFilter() : {}),
```

(ค) webhook `listLineCompanies` (:5741-5753) — select เพิ่ม `status` + `permissions`:
```ts
        roles: { select: { role: { select: { key: true, name: true, status: true, permissions: { select: { permission: { select: { key: true } } } } } } } },
```
และ `LineCompanyMembership` (:952-956):
```ts
type LineCompanyMembership = {
  companyId: string;
  company?: { name: string; brandName?: string | null } | null;
  roles?: Array<{ role?: { key: string; name?: string; status?: string; permissions?: Array<{ permission: { key: string } }> } | null }>;
};
```
`companyRoleLabels` (:1150-1156) ยังแสดงทุก role เหมือนเดิม (ไม่กรอง status ที่ query)

(ง) webhook promotion card :2301 — ปัจจุบัน `const owners = (await this.listLineCompanies(identity.userId)).filter(isCompanyOwner);` → ใหม่:
```ts
    // R-C11: whoever may buy for the shop gets the button, owner or custom role alike.
    const owners = (await this.listLineCompanies(identity.userId)).filter((membership) => canManagePlan(membership.roles));
```
(ตัวแปรชื่อ `owners` เปลี่ยนเป็น `managers` ได้ตามสะดวก — :2302/:2309 ใช้ต่อ)

(จ) webhook `handlePackageChangeRequest` :2817 — ปัจจุบัน `roles: { some: { role: { key: 'OWNER', status: 'ACTIVE' } } },` → ใหม่ `...planManagerRoleFilter(),` (comment :2800-2802 "owned shop" ยังจริง; `PACKAGE_CHANGE_NOT_OWNER_REPLY` คงข้อความ — ผู้ไม่มีสิทธิ์ยังได้ข้อความพนักงานเดิมตาม spec)

(ฉ) webhook :5842 `isOwner: isCompanyOwner(currentMembership)` — **คง OWNER** (ปุ่ม "เปิดร้านเพิ่ม" เป็นสิทธิ์เจ้าของ ไม่ใช่ plan manager); :3057/:4016/:4104 `isOwner: access.roles.includes('OWNER')` (quick reply "บริษัทของฉัน") คงเดิม

(ช) `plan-term-sweep.use-case.ts` — ปัจจุบัน (:177-180):
```ts
    const owners = await tx.companyMembership.findMany({
      where: { companyId, status: 'ACTIVE', roles: { some: { role: { key: 'OWNER' } } } },
      select: { userId: true },
    });
```
ใหม่:
```ts
import { planManagersOf } from '../../../access-control/domain/logic/plan-manager.logic';
…
    // R-C11: the same people the web lets buy get the warning/expiry notice, inside this transaction.
    const owners = await planManagersOf(tx, companyId);
```
(ชื่อตัวแปร `owners` ใช้ต่อที่ :181-194; comment :159-164 แก้ "OWNERs" → "plan managers"; ส่วน SYSTEM_ADMIN :197-200 ไม่แตะ)

(ซ) `billing-notifications.service.ts` — แยกผู้รับ LINE/เว็บ (plan managers) กับอีเมล (OWNER คงเดิมจน PR C ทำ R-A7):
- เพิ่ม method ถัดจาก `owners()` (:225-228):
```ts
  /** R-C11: LINE/web recipients are whoever may manage the package; email keeps `owners()` until R-A7 moves it to the document recipient (PR C). */
  private async planManagers(companyId: string, tx: Prisma.TransactionClient = this.prisma.client) {
    return tx.companyMembership.findMany({ where: { companyId, status: 'ACTIVE', user: { status: 'ACTIVE' }, ...planManagerRoleFilter() }, include: { user: true } });
  }
```
- :69 (`reviewDelivery` LINE lane): `const owner=(await this.owners(companyId,tx)).find(…)` → `const owner=(await this.planManagers(companyId,tx)).find(m=>m.userId===row.recipient.userId);`
- :233-234: `const { invoice, company } = await this.source(row, tx), owners = await this.owners(company.id, tx); if (!owners.length) throw defer('recipient_pending');` → 
```ts
      const { invoice, company } = await this.source(row, tx);
      const managers = await this.planManagers(company.id, tx), owners = await this.owners(company.id, tx);
      if (!managers.length) throw defer('recipient_pending');
```
- :247 `recipientUserIds: owners.map(m => m.userId)` → `recipientUserIds: managers.map(m => m.userId)`; loop อีเมล :248 คง `owners`
- :347 และ :394 (LINE lanes) `this.owners(` → `this.planManagers(`
- :103, :260, :280 (email lanes) คง `this.owners(`
- import `planManagerRoleFilter` จาก `'../../access-control/domain/logic/plan-manager.logic'`

(ฌ) `sales-deals.service.ts` — ปัจจุบัน (:37, :519-529):
```ts
import { ownerLineUserIds } from '../../system-partner-management/application/use-cases/package-change-decision.use-case';
…
  private async notifyOwners(companyId: string): Promise<void> {
    …
    for (const providerUserId of await ownerLineUserIds(this.prisma, companyId, credentials.channelId)) {
```
ใหม่:
```ts
import { planManagerLineUserIds } from '../../access-control/domain/logic/plan-manager.logic';
…
  /** S19 + R-C11: the shop's plan managers learn an offer exists — and nothing more (no price, tier or months). */
  private async notifyOwners(companyId: string): Promise<void> {
    …
    for (const providerUserId of await planManagerLineUserIds(this.prisma.client, companyId, credentials.channelId)) {
```
ลบ import :37 ถ้าไม่มีที่ใช้อื่นในไฟล์. **ห้ามแตะ** `ownerLineUserIds` (`package-change-decision.use-case.ts:194-206`) และผู้ใช้ของมัน (:179, `send-partner-line-message.use-case.ts:88`)

### 3.19 R-C8 (label ใน บริษัทของฉัน — เล็ก, อยู่ใน scope line-ai ตาม spec §8)

- `listLineCompanies` select `company` เพิ่ม `status: true, planTerm: { select: { termStartAt: true, termEndsAt: true, renewCount: true, termDisabledAt: true } }`; `LineCompanyMembership.company` เพิ่ม `status?: string; planTerm?: { termStartAt: Date; termEndsAt: Date; renewCount: number; termDisabledAt?: Date | null } | null`
- helper ใน webhook (ข้าง `companyLabel` :1146):
```ts
/** R-C8: the same wording as LIFF (R-C2) for a locked shop in the picker and the context card. */
function companyStateLabel(membership: LineCompanyMembership, now = new Date()): string | undefined {
  const term = membership.company?.planTerm;
  const locked = (membership.company?.status === 'DISABLED' && !!term?.termDisabledAt)
    || (membership.company?.status === 'ACTIVE' && !!term && term.termEndsAt <= now);
  if (!locked) return undefined;
  return term && planTermLockReason(term) === 'no_package' ? 'ยังไม่มีแพ็กเกจ' : 'หมดอายุ';
}
```
- `CompanyPickerItem` (:55-65) และ `CompanyContextCard` (:78-118) เพิ่ม `stateLabel?: string`; `companyBubble` (:414-424) เพิ่ม `...(company.stateLabel ? [{ type: 'text', text: '🔒 ' + company.stateLabel, size: 'sm', color: '#B42318' }] : [])` หลังบรรทัดชื่อ; `buildCompanyContextMessage` (:240-247) เพิ่มบรรทัดเดียวกันหลัง `🏢 ${companyName}`; caller (:3939, :5791-5794, :5838-5844) ส่ง `stateLabel: companyStateLabel(membership)`
- optional เมื่อไม่มีค่า → bytes ของร้าน ACTIVE เท่าเดิม (spec เดิมของ picker ไม่แดง)

### 3.20 Catalog / CI registration

- `scripts/line-ai-whole-chain-acceptance.catalog.mjs` ใน `api-behavior.args` (หลัง :371 `'src/modules/billing/line-billing-entry.spec.ts',`) เพิ่ม:
```js
      // Purchase-without-setup PR A: the one plan-manager predicate LINE and the web share (R-C11).
      'src/modules/access-control/domain/logic/plan-manager.logic.spec.ts',
```
- `.github/workflows/ci.yml:543` เพิ่ม `packages/contracts/src/line-external-browser.spec.ts` ต่อท้ายคำสั่ง `pnpm exec tsx --test packages/contracts/src/company-business-type.spec.ts packages/contracts/src/billing-company-profile.spec.ts` (ci.yml ต้องเหมือน main byte-per-byte ก่อน UAT all — P0)
- web spec ใหม่อยู่ใต้ `apps/web/src/**` → glob `apps/web/package.json:10` เก็บเอง

### 3.21 Pins (P0)

รัน `node infra/security/sync-production-maintenance-release-pins.mjs` (rewrite `expected_*` ใน validator + `EXPECTED_MAINTENANCE_RELEASE_VALIDATOR_SHA256` ที่ `deploy-production.yml:421`) → `--check` → `bash infra/security/sync-production-maintenance-release-pins.spec.sh` → `bash infra/security/validate-production-maintenance-release.spec.sh` → commit ใน PR A (+ twin main). PR A เองไม่แตะไฟล์ pinned (รายการ validator :97-154: ไม่มี `auth.controller.ts`, `liff-page.security.ts`, `line-*`, `billing-*`, `route.ts` ของ `/l/`)

### 3.22 R-B4 / R-B5 ฝั่ง API — ยืนยันไม่มี

- R-B4 (§18.2): ปุ่ม "เปิดหน้านี้ใน Safari/Chrome" + `line-login/start` redirect `/login?next=` = web (`AccountEmailOtpPanel.tsx`, `apps/web/app/api/auth/line-login/start/route.ts`) → PR B
- R-B5 (§18.2): ส่วนแรกมีแล้ว (`app/login/page.tsx:37-46`, `session-gate.logic.ts:97-124` pinned); ส่วนขยาย = `LoginPage.tsx` + `issue-token.use-case.ts` (DQ8) → PR B; API ไม่มี endpoint ใหม่

---

## 4. Sequences

### 4.1 การ์ดล็อก (ข้อความจากร้าน `no_package`; flag replay เปิด = production)

1. `execute()` → `resolveCompanyForLineUser` คืน `null` (ร้าน DISABLED) → `replyIfCompanyLocked` (:3931)
2. `lockedCompanyFor(prisma, userId, true)` ด้วย `planManagerRoleFilter()` → `{companyId, lockReason:'no_package'}`
3. `billingMode ∈ {test,live}` + `webBaseUrl` → `event.handoff = {userId, companyId}`; `oneTapPackageUrl(event, …, 'locked_card_packages')`: chatKey = `pushTargetId ?? lineUserId`; ไม่ใช่กลุ่ม → `handoffLinks.linkFor()` → `mint.execute({targetPath:'/companies/<id>/billing?channel=line', surface:'locked_card_packages'})` → `https://<web>/l/<token>` (mint ล้มเหลว/flag `LINE_WEB_HANDOFF_ENABLED` ปิด → `null` → ไม่ส่ง `packageUrl`)
4. `buildPackageRequiredMessage({..., packageUrl})` → `oneTapPackageLink` รับเฉพาะ `<web origin>/l/…` → ปุ่ม "เลือกแพ็กเกจ" = `/l/<token>`; ปุ่ม "ติดต่อเจ้าหน้าที่" คงเดิม
5. `deliverRequiredMessages` → `sendMessages`: `recordTurnOutcome` บันทึก payload (มี `/l/<token>`) → `attemptDelivery`: flag เปิด → ไม่ wrap (:3274) → `lineReply.sendReply(replyToken, outgoing)` → `providerMessages` ตัด `canonicalText` + เติม `?openExternalBrowser=1` ให้ `/l/<token>` (ไม่เปลี่ยน stored bytes) → LINE
6. ผู้ใช้แตะ → Safari/Chrome เปิด `GET /l/<token>?openExternalBrowser=1` → route อ่าน token จาก path → `POST /auth/line/handoff/exchange` พร้อม `x-forwarded-for` → cookie → redirect `/companies/<id>/billing?channel=line` (locked shell อนุญาต billing) → หน้าแพ็กเกจ (1 แตะ; AC10 ก)
7. กลุ่ม/ห้อง: ข้อ 3 คืน `undefined` → ปุ่ม = `https://<web>/companies/<id>/billing?channel=line&openExternalBrowser=1` (param จาก exit) → ผู้แตะใช้ session ของเครื่องตัวเอง (AC10 ง)

### 4.2 LIFF หน้าผลลัพธ์หลังสมัคร (COMPLETED, ร้านล็อก, ผู้กด = OWNER)

1. หน้า signup อ่าน `GET /public/line-signups/me` → `eligibleCompanies=[{…, status:'EXPIRED', canEnter:false, lockReason:'no_package', canManagePlan:true}]`, `progress.entryCompanyId` ไม่มี, `progress.lockedEntryCompanyId='co-1'`
2. `renderSignupStatus` → COMPLETED → `renderEligibleCompanies(companies,'',true)` = `false` → branch `locked && canManagePlan` → หัวข้อ "เปิดร้านแล้ว ขั้นต่อไปเลือกแพ็กเกจ"; `runWith(startSession('co-1', PACKAGE_START), retry-status, 'กำลังเตรียมลิงก์…')`
3. `startSession` → `POST /auth/line/liff/session {idToken, companyId:'co-1'}` → `resolveCompany` → `destination()`: ล็อก + `canManagePlan` → `wanted='/companies/co-1/billing?channel=line'` → `resolveLineHandoffTarget` (billing เป็น recovery path) → mint `surface:'liff_start'` → `{handoffUrl:'https://<web>/l/<token>'}`
4. หน้าแสดง `#open-web` label "เลือกแพ็กเกจ" + status "พร้อมแล้วค่ะ กดเลือกแพ็กเกจ…" (ปุ่ม retry-status คืน label "ตรวจสอบสถานะอีกครั้ง")
5. แตะ → `liff.openWindow({url, external:true})` → Safari/Chrome `/l/<token>` → หน้าแพ็กเกจ (1 แตะจากหน้าผลลัพธ์)
6. พนักงาน (`canManagePlan:false`): หัวข้อ "เปิดร้านแล้ว รอเลือกแพ็กเกจ" + ปุ่ม "ติดต่อเจ้าหน้าที่"; billing ปิด/`new_sales` ปิด: ข้อ 3 ยังคืน handoff (การซื้อจะถูก gate บนเว็บ) — copy "ติดต่อทีมงาน" เดิมของ P29 §3 อยู่ที่หน้าเว็บ/locked shell ไม่ใช่ LIFF; `liff/session` 403 (`line_web_handoff_disabled`) → `UNAVAILABLE_TH` เดิม

### 4.3 Push หลังสมัคร → LIFF start → เว็บ (2 แตะ, DQ3)

1. provisioning เสร็จ → `enqueue(requestId,'approved')` → `deliver()` → `readyMessage('approved', name)` → flex หัวข้อ "เปิดร้านแล้ว" ปุ่ม "เลือกแพ็กเกจ" `https://liff.line.me/<id>/start` → `pushLineMessages` (exit 2: `liff.line.me` ข้าม) → LINE (retry key `lineSignupPushRetryKey`)
2. แตะปุ่ม (แตะที่ 1) → LIFF start page → `run()` → `startSession('')` → `liff/session` → ร้านเดียวและล็อก → `destination()` → billing (manager) / renew (อื่น) → `#open-web` "เปิดหน้าเว็บ"
3. แตะ "เปิดหน้าเว็บ" (แตะที่ 2) → external browser `/l/<token>` → หน้าแพ็กเกจ

---

## 5. ตาราง copy (เก่า → ใหม่; ทุกข้อความไม่มีเครื่องหมายบวก, ไม่มีรหัส/คำเทคนิค)

| ที่ | เก่า | ใหม่ | หมายเหตุ |
|---|---|---|---|
| `line-signup-notify.service.ts:366` หัวข้อ push | `พร้อมใช้งานแล้ว` | `เปิดร้านแล้ว` (approved) / `เพิ่มร้านแล้ว` (attached) | R-C4 |
| `:370` ปุ่ม push | `เริ่มใช้งาน` | `เลือกแพ็กเกจ` | ทั้งสอง kind |
| `:52-53` approvedMessageTh | `🎉 เปิดร้าน {ร้าน} ให้แล้วค่ะ ขั้นต่อไปคือเลือกแพ็กเกจเพื่อเริ่มใช้งาน กดเปิดหน้าเว็บเพื่อดูแพ็กเกจและชำระเงินได้เลยนะคะ` | `🎉 เปิดร้าน {ร้าน} ให้แล้วค่ะ ขั้นต่อไปเลือกแพ็กเกจเพื่อเริ่มใช้งาน กดปุ่มด้านล่าง แล้วกดเปิดหน้าเว็บเพื่อดูแพ็กเกจและชำระเงินได้เลยนะคะ` | คง regex ใน spec :172-173 |
| `:57` attachedMessageTh | `🎉 เพิ่มร้าน {ร้าน} ให้บัญชีของคุณแล้วค่ะ สลับร้านได้ในเมนู หรือกดเปิดหน้าเว็บนะคะ` | `🎉 เพิ่มร้าน {ร้าน} ให้บัญชีของคุณแล้วค่ะ ขั้นต่อไปเลือกแพ็กเกจให้ร้านนี้ กดปุ่มด้านล่างได้เลยนะคะ สลับร้านได้ในเมนู บริษัทของฉัน` | |
| `liff-page.security.ts:660` รายการร้านล็อก | `{ร้าน} หมดอายุแล้ว ติดต่อทีมงานเพื่อเลือกแพ็กเกจก่อนเข้าใช้งานค่ะ` | `{ร้าน} · ยังไม่มีแพ็กเกจ` (no_package) / `{ร้าน} · หมดอายุ` (อื่น) + ปุ่ม `เลือกแพ็กเกจ` / `ต่ออายุ` เฉพาะ `canManagePlan` | R-C2/R-C7 |
| `:707-708` COMPLETED ไม่เข้าได้ | `ร้านนี้ยังเข้าใช้ไม่ได้` / `สิทธิ์หรือแพ็กเกจปัจจุบันยังไม่พร้อมให้เข้าใช้ กรุณาติดต่อทีมงานเพื่อตรวจสอบค่ะ` | manager: `เปิดร้านแล้ว ขั้นต่อไปเลือกแพ็กเกจ` / `{ร้าน} เปิดให้แล้วค่ะ เลือกแพ็กเกจเพื่อเริ่มใช้งาน ระบบจะพาไปหน้าแพ็กเกจในเบราว์เซอร์ให้ค่ะ`; staff: `เปิดร้านแล้ว รอเลือกแพ็กเกจ` / `{ร้าน} ยังไม่มีแพ็กเกจ ให้เจ้าของร้านหรือผู้ดูแลแพ็กเกจเลือกแพ็กเกจก่อน แล้วเข้าใช้งานได้เลยค่ะ`; ไม่มีร้าน: ข้อความเดิม | |
| LIFF ปุ่ม `#open-web` เมื่อเป็นร้านล็อก | `เปิดหน้าเว็บ` / `พร้อมแล้วค่ะ กดเปิดหน้าเว็บเพื่อเข้าร้าน` | `เลือกแพ็กเกจ` / `พร้อมแล้วค่ะ กดเลือกแพ็กเกจเพื่อเปิดหน้าแพ็กเกจในเบราว์เซอร์` | `PACKAGE_START` |
| LIFF start needsSelection ปุ่มร้าน | `{ร้าน}` | `{ร้าน} · ยังไม่มีแพ็กเกจ` / `{ร้าน} · หมดอายุ` เมื่อล็อก | |
| `auth.controller.ts:580` (RV33) | `เพิ่มภายหลังได้ ก่อนชำระแพ็กเกจจะให้ยืนยันอีเมลสำหรับรับเอกสาร ใช้งานผ่าน LINE ได้ทันที` | `เพิ่มภายหลังได้ อีเมลรับเอกสารกรอกได้ที่หน้าชำระเงิน ใช้งานผ่าน LINE ได้ทันที` | D-PF-1 |
| webhook `:2846` ตอบ "ขอเปลี่ยนแพ็กเกจ" | `📦 {ร้าน}\nดูแพ็กเกจ ตรวจสอบการชำระเงิน และเปิดใบเสร็จได้ที่\n{url}\nกรุณาตรวจสอบราคาและยืนยันบนเว็บก่อนชำระเงินค่ะ` | `📦 {ร้าน}\nเลือกแพ็กเกจ ตรวจสอบการชำระเงิน และเปิดใบเสร็จได้ที่ลิงก์นี้ (เปิดในเบราว์เซอร์ให้อัตโนมัติ)\n{url}\nตรวจสอบราคาและยืนยันบนเว็บก่อนชำระเงินนะคะ` | url = `/l/<token>` หรือ URL ธรรมดา |
| `line-staff-menu.logic.ts:321` ปุ่มโปรโมชั่น (G19) | `ให้ทีมงานช่วยเลือก` (message = ขอเปลี่ยนแพ็กเกจ) | `ให้ทีมงานติดต่อกลับ` (postback `action=package-callback`) | |
| webhook ใหม่ `PACKAGE_CALLBACK_REPLY` | — | `📮 รับเรื่องแล้วค่ะ ทีมงานจะติดต่อกลับเรื่องแพ็กเกจในเวลาทำการ (จันทร์–เสาร์ 9:00–18:00) ระหว่างนี้ถามน้องมั่งมีต่อได้เลยนะคะ` | ไม่หยุด AI |
| webhook ใหม่ `PACKAGE_CALLBACK_ALREADY_OPEN_REPLY` | — | `📮 คำขอของคุณยังอยู่ในคิวค่ะ ทีมงานจะติดต่อกลับในเวลาทำการ (จันทร์–เสาร์ 9:00–18:00) นะคะ` | |
| webhook ใหม่ `PACKAGE_CALLBACK_NOTE` (inbox) | — | `ขอให้ทีมงานติดต่อกลับเรื่องแพ็กเกจ` | requestText/thread |
| `line-staff-menu.logic.ts:310` (G20) | `รายเดือน 249 / 499 / 999 บาท และแพ็กเกจธุรกิจ 1,999 บาท ครบทุกเมนูรวมภาษี เลือกและชำระในแอปได้เองค่ะ` | `รายเดือน 249 / 499 / 999 บาท และแพ็กเกจธุรกิจ 1,999 บาท ที่เพิ่มเอกสารภาษี ภ.ง.ด.53 และ 50 ทวิ เลือกและชำระในแอปได้เองค่ะ` | ตาม `menu-entitlements.ts:491-500` (ENTERPRISE = starter + `wht_pnd53` + `wht_50bis`) |
| `line-public-policy.logic.ts:16` (G20) | `แพ็กเกจธุรกิจ 1,999 เปิดครบทุกเมนู รวมภาษี ภ.ง.ด.53 และ 50 ทวิ จัดซื้อ คลังสินค้า CRM บัญชีธนาคาร และรายงานการเงินค่ะ` | `แพ็กเกจธุรกิจ 1,999 ได้เมนูเดียวกัน และเพิ่มเอกสารภาษี ภ.ง.ด.53 และ 50 ทวิ ที่ออกจากระบบค่ะ` | |
| webhook `:244` (G20, **Owner-verbatim — ต้อง sign-off**) | `🧾 แพ็กเกจธุรกิจออกเอกสารและภาษีได้ครบ รวม ภ.ง.ด.53 และ 50 ทวิ` | เสนอ: `🧾 แพ็กเกจธุรกิจเพิ่มเอกสารภาษี ภ.ง.ด.53 และ 50 ทวิ` | ถ้ายังไม่ได้รับ ให้คงเดิม |
| `line-public-policy.logic.ts:8-10` `trial` (G25) | `สมัครแล้วร้านเปิดไว้ก่อน ไม่บังคับซื้อทันที ใช้งานได้เมื่อเลือกและชำระแพ็กเกจแล้ว เริ่มที่ STARTER 249 บาทต่อเดือนเป็นต้นไป ผ่านบัตรออนไลน์\nไม่เรียกเก็บเงินอัตโนมัติจนกว่าจะเลือกเอง ยังไม่ชำระข้อมูลยังอยู่ค่ะ\nร้านที่มีสิทธิ์ทดลองฟรีอยู่ก่อนใช้ต่อได้จนกว่าจะหมดช่วง ต่ออายุตามเงื่อนไขแพ็กเกจค่ะ` | `สมัครแล้วร้านเปิดไว้ก่อนแบบยังไม่มีแพ็กเกจ ไม่บังคับซื้อทันที ใช้งานได้เมื่อเลือกและชำระแพ็กเกจแล้ว เริ่มที่ STARTER 249 บาทต่อเดือน ผ่านบัตรออนไลน์หรือพร้อมเพย์\nไม่เรียกเก็บเงินอัตโนมัติจนกว่าจะเลือกเอง ยังไม่ชำระข้อมูลยังอยู่ค่ะ\nร้านที่มีสิทธิ์ทดลองฟรีอยู่ก่อนใช้ต่อได้จนกว่าจะหมดช่วง แล้วเลือกแพ็กเกจต่อได้เองในแอปค่ะ` | คง regex spec :724-727, :757 |
| `:13-14` `trial_limits` | title `เปิดร้านแล้วใช้อะไรได้บ้าง`; `ก่อนชำระ ใช้ได้แค่ตั้งค่าข้อมูลร้านและบัญชี กับหน้าแพ็กเกจค่ะ` | คง title; `ก่อนชำระ ใช้ได้แค่ตั้งค่าข้อมูลร้านและบัญชี กับหน้าแพ็กเกจค่ะ` (คง) + บรรทัด 15 คง + บรรทัด 16 ตาม G20 ข้างบน | spec :776,:778-780 ต้องแก้ |
| `:24-25` `data` | title `ข้อมูลหลังหมดช่วงทดลอง`; `หมดช่วงทดลองใช้ฟรีแล้ว การใช้งานส่วนธุรกิจจะหยุดไว้ แต่ข้อมูลไม่ได้ถูกลบทันทีเพราะหมดช่วงทดลองค่ะ\n…` | title `ข้อมูลเมื่อยังไม่มีแพ็กเกจหรือหมดอายุ`; `เมื่อยังไม่มีแพ็กเกจหรือแพ็กเกจหมดอายุ การใช้งานส่วนธุรกิจจะหยุดไว้ แต่ข้อมูลไม่ได้ถูกลบทันทีค่ะ\n` + ประโยคลบข้อมูลเดิมทั้งหมด | คง regex :782-783 |
| `:29` `paid_renewal` ประโยคที่ 2 | `ส่วนผู้ที่ยังใช้สิทธิ์ทดลองใช้ฟรีและยังไม่ได้ซื้อ จะไม่ถูกเรียกเก็บเงินอัตโนมัติเมื่อหมดช่วงทดลอง …` | `ส่วนร้านที่ยังไม่ได้ซื้อแพ็กเกจ จะไม่ถูกเรียกเก็บเงินอัตโนมัติ …` (ท้ายประโยคคงเดิม) | คง regex :784 |
| `:32-33` `buy_early` | title `ซื้อแพ็กเกจระหว่างทดลองใช้ฟรี`; `หากซื้อแพ็กเกจระหว่างที่ยังมีสิทธิ์ทดลองใช้ฟรีอยู่ แพ็กเกจที่ซื้อจะเริ่มทำงานและตัดรอบชำระทันทีค่ะ …` | title `ซื้อแพ็กเกจก่อนช่วงเดิมหมด`; `หากซื้อแพ็กเกจก่อนที่ช่วงใช้งานเดิมจะหมด แพ็กเกจที่ซื้อจะเริ่มทำงานและตัดรอบชำระทันทีค่ะ ควรตรวจเงื่อนไขแพ็กเกจก่อนยืนยันซื้อค่ะ` | คง regex :785 |
| `:49` `payment_failure` | `ช่วงนี้ไม่ใช่วันทดลองใช้ฟรีเพิ่ม …` | คงเดิม (ประโยคยังจริง; spec :790 ตรึงไว้) | ไม่แก้ |
| `line-business-card.logic.ts` การ์ดล็อก | title `ยังไม่ได้สมัครแพ็กเกจ`/`แพ็กเกจหมดอายุแล้ว`, badge `🔒 รอเลือกแพ็กเกจ`, ปุ่ม `เลือกแพ็กเกจ` | คงเดิม (R-C8) | |
| webhook `PACKAGE_REQUIRED_MEMBER_REPLY` :410, `PACKAGE_CHANGE_NOT_OWNER_REPLY` :311 | เดิม | คงเดิม (พนักงานได้ข้อความเดิมตาม R-C11) | |

---

## 6. Tests

### 6.1 Spec ที่จะแดงและการแก้ (ตามลำดับไฟล์)

| Spec (ลงทะเบียนที่) | บรรทัด | แก้เป็น |
|---|---|---|
| `apps/api/src/modules/sales-console/domain/sales-deal.logic.spec.ts` (catalog :355) | :180, :184, :202 | ตัด `?openExternalBrowser=1` ออกจาก URL ที่คาด (`…/companies/co-1/billing`, `…/companies/..%2F..%2Fevil/billing`) |
| `apps/api/src/modules/line-ai/line-first-signup-webhook.spec.ts` (package.json `test`) | :111, :124 | `${WEB_BASE}/login?line=link-required&next=%2F` (harness จับที่ `sendReply` fake :349 = ก่อน exit) |
| เดียวกัน | :400-405 | `['text', 'flex']` และลบ `deepEqual` ของ image |
| เดียวกัน | :1297 | คง (harness ไม่มี `handoffLinks` → URL ธรรมดา); เพิ่ม `assert.match(rendered(h), /เปิดในเบราว์เซอร์ให้อัตโนมัติ/)` |
| เดียวกัน | :1317 | `assert.deepEqual(where.roles, { some: { role: { status: 'ACTIVE', permissions: { some: { permission: { key: 'company.plan.manage' } } } } } })` |
| เดียวกัน | :1428 `shop()` | `roles: [{ role: { key, status: 'ACTIVE', permissions: key === 'OWNER' ? [{ permission: { key: 'company.plan.manage' } }] : [] } }]`; เพิ่มเคส `shop('PLAN_MANAGER')` ที่มี permission แต่ key ไม่ใช่ OWNER → ได้ปุ่ม `เลือกแพ็กเกจ` |
| เดียวกัน | :1440 | `lineUserId` ใน ctx ยัง `'Uline-1'` (1:1) — คง; เพิ่มเคส `event(...)` ที่มี `pushTargetId: 'C' + '0'.repeat(32)` → ไม่ mint (`minted.length === 0`) และปุ่มเป็น URL ธรรมดา |
| เดียวกัน | :1460 | `['ดูรายละเอียดบนเว็บ', 'ให้ทีมงานติดต่อกลับ', 'คุยกับทีมงาน']` + `assert.equal(actions(h)[1].type, 'postback')` |
| `apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.spec.ts` (package.json `test`) | :695-700 | labels → `'ให้ทีมงานติดต่อกลับ'`; :697 → `assert.deepEqual(employee[1], { type: 'postback', label: PACKAGE_CALLBACK_COMMAND, data: 'action=package-callback', displayText: PACKAGE_CALLBACK_COMMAND })`; owner list :700 เช่นกัน |
| เดียวกัน | :776 regex trial_limits (`ตั้งค่าข้อมูลร้านและบัญชี[\s\S]*249 \/ 499 \/ 999[\s\S]*แพ็กเกจธุรกิจ`) | คงได้ (ยังมี "แพ็กเกจธุรกิจ"); :779 → `/ภ\.ง\.ด\.53 และ 50 ทวิ/`; :780 `/เปิดครบทุกเมนู/` → `/เพิ่มเอกสารภาษี/` |
| เดียวกัน | :728 `doesNotMatch(/PRO|ฟรีตลอด|…/)` | คง; เพิ่ม `assert.doesNotMatch(JSON.stringify(buildPromotionCard('owner','https://x/l/t')), /ครบทุกเมนู/)` |
| `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` (package.json `test` + catalog :387) | :388, :404 default roles | `[{ role: { key: 'OWNER', status: 'ACTIVE', permissions: [{ permission: { key: 'company.plan.manage' } }] } }]` |
| เดียวกัน | :487-489 fake | `const wantsManager = Boolean(where.roles?.some?.role?.permissions); const row = termExpiredRows.find((candidate) => !wantsManager || candidate.roles.some((assigned: any) => (assigned.role.permissions ?? []).some((rp: any) => rp.permission.key === 'company.plan.manage')));` |
| เดียวกัน | :2318-2343 | คง URL ธรรมดาที่ :2335 เมื่อ `makeUseCase(prisma, {config:{billingMode:'test'}})` ไม่มี `handoffLinks`; เพิ่มเคสใหม่ (§6.2 ข) |
| เดียวกัน | :2399-2413 (`roles: [{ role: { key: 'SALES' } }]`) | คง — ไม่มี permission → member reply (ยืนยัน R-C11 ทางลบ); เพิ่มเคส custom role ที่มี permission → ได้การ์ด |
| `apps/api/src/modules/billing/line-billing-entry.spec.ts` (catalog :371) | :26 | `assert.deepEqual(h.query().where.roles, { some: { role: { status: 'ACTIVE', permissions: { some: { permission: { key: 'company.plan.manage' } } } } } })`; :24 คง (context ไม่มี `handoffLinks`); เพิ่มเคส context มี `handoffLinks.linkFor` → reply มี `/l/tok` และเคส `event.pushTargetId` เป็นกลุ่ม → ไม่มี `/l/` |
| `apps/api/src/modules/system-partner-management/application/use-cases/plan-term-sweep.use-case.spec.ts` (package.json `test`) | :76 | `const wantsOwner = JSON.stringify(where.roles ?? {}).includes('company.plan.manage');` (ชื่อตัวแปรเปลี่ยนได้); :194 ชื่อเทสต์ "notifies the plan managers …" |
| `apps/api/src/modules/system-partner-management/application/use-cases/package-change-decision.use-case.spec.ts` | :45-76 | **ไม่แก้** — `ownerLineUserIds` ไม่ถูกแตะ (spec §18.2 R-C11) |
| `apps/api/src/modules/external-signup/application/line-signup-notify.service.spec.ts` (package.json `test`) | :165-179 | เพิ่ม `assert.match(sent, /เปิดร้านแล้ว/); assert.match(sent, /"label":"เลือกแพ็กเกจ"/); assert.equal(sent.includes('พร้อมใช้งานแล้ว'), false); assert.equal(sent.includes('เริ่มใช้งาน"'), false)`; เพิ่มเคส `deliver('r1','attached')` → `/เพิ่มร้านแล้ว/` + ปุ่มเดียวกัน + LIFF URL |
| `apps/api/src/modules/external-signup/application/line-signup-status-and-package-change.spec.ts` (package.json `test`) | :90-92 | คง (ร้าน ACTIVE shape เดิม); harness :16/:37-39 รับ `roles`/`planTerm` optional; เพิ่มเคส (§6.2 จ) |
| `apps/api/src/modules/auth/line-liff-signup.spec.ts` (package.json `test`) | :73 | `assert.ok(html.includes('อีเมลรับเอกสารกรอกได้ที่หน้าชำระเงิน'))` และ `assert.equal(html.includes('ก่อนชำระแพ็กเกจจะให้ยืนยันอีเมล'), false)` |
| เดียวกัน | :392 type ของ `eligibleCompanies` | เพิ่ม `lockReason?: 'no_package' \| 'trial_ended'; canManagePlan?: boolean` |
| เดียวกัน | :517-525 | คง (ไม่มี `lockedEntryCompanyId` → ข้อความเดิม) |
| `apps/api/src/modules/line-ai/domain/logic/line-business-card.logic.spec.ts` (package.json `test`, `test:line-ai-business-coverage`) | — | ไม่มี assertion การ์ดล็อก/door param → เพิ่มเคสใหม่ (§6.2 ค) |
| `apps/api/src/modules/line-ai/infrastructure/line-reply.adapter.spec.ts` (package.json `test`) | :51-68, :133-154 | คง; เพิ่มเคส (§6.2 ก) |
| `apps/api/src/modules/line-ai/application/line-handoff-link.service.spec.ts` (package.json `test`) | :88 "carries the query string" | ยืนยันยังผ่าน (query อื่นคง); เพิ่มเคส strip |
| `apps/web/src/features/external-signup/*`/e2e `line-signup-contact-email.spec.ts:66,191` (F13) | e2e (Extended Tests) | แก้ข้อความช่วยเหลือเป็นค่าใหม่ — **ต้องตรวจ** บรรทัดจริง (§10) |

### 6.2 Spec ใหม่ / เคสใหม่

(ก) `packages/contracts/src/line-external-browser.spec.ts` (ใหม่; ลงทะเบียน ci.yml:543)
- `withLineExternalBrowserParam`: `https://app/companies/c/billing` → `…?openExternalBrowser=1`; `…/billing?channel=line` → `…&openExternalBrowser=1`; `…/settings/profile#account` → `…/settings/profile?openExternalBrowser=1#account`; idempotent (เรียกซ้ำเท่าเดิม; มี param อยู่แล้วเท่าเดิม); ข้าม `https://liff.line.me/123-abc/signup`, `https://line.me/R/ti/p/@x`, `https://official.mangmeeplus.com/`, `tel:0982565628`, `not a url`; `http://localhost:3000/…` ได้ param
- `stripLineExternalBrowserParam`: `/companies/c/billing?openExternalBrowser=1` → `/companies/c/billing`; `/companies/c/billing?channel=line&openExternalBrowser=1#x` → `/companies/c/billing?channel=line#x`; ไม่มี param → string เดิม (identity)
- `withLineExternalBrowserLinks`: text 2 URL; flex carousel nested uri; image untouched; `quickReply` untouched; ไม่มีการเปลี่ยน → คืน array/object เดิม (`assert.equal(out, input)`); text ยาว 4990 ตัว + URL → คงเดิมเมื่อเกิน 5000; uri ยาว 990 → คงเดิมเมื่อเกิน 1000; input ไม่ถูก mutate (`deepEqual(input, snapshot)`)

(ข) `line-reply.adapter.spec.ts` เพิ่มใน describe `LINE push delivery retry identity`:
- push message text มี `https://app.example.test/companies/c/billing` → body บน wire มี `?openExternalBrowser=1`; `X-Line-Retry-Key` เท่ากับ `linePushRetryKey(op, to, messages)` ของ payload ต้นฉบับ; ส่ง 2 ครั้ง bytes เท่ากัน; `messages` ต้นฉบับไม่เปลี่ยน; flex ที่มี `canonicalText` → wire ไม่มี `canonicalText` และ uri มี param; image ไม่แตะ

(ค) `line-business-card.logic.spec.ts`:
- `buildPackageRequiredMessage({lockReason:'no_package', companyId:'co-1', webBaseUrl:'https://app.example.test', packageUrl:'https://app.example.test/l/tok'})` → ปุ่มแรก `uri === 'https://app.example.test/l/tok'`
- `packageUrl` บน origin อื่น / path ไม่ใช่ `/l/` / `'https://app.example.test/l/'` → fallback `https://app.example.test/companies/co-1/billing?channel=line`
- door card `existingAccountLinkUrl` ไม่มี `openExternalBrowser` และ `stripLineExternalBrowserParam` ของมันเท่าเดิม

(ง) `process-line-webhook.use-case.spec.ts` ใน `describe('locked company')`: `makeUseCase(prisma, { config: { billingMode: 'test', lineAiTerminalOutcomeReplayEnabled: flag }, handoffLinks: { linkFor: async (ctx, path) => { calls.push({ctx, path}); return 'https://app.example.com/l/tok-1'; }, wrapOutgoingLineContent: async (_c, m) => m } })` สำหรับ `flag ∈ {true,false}`:
- ปุ่มแรก `uri === 'https://app.example.com/l/tok-1'`; `calls[0].ctx.surface === 'locked_card_packages'`, `calls[0].path === '/companies/company-1/billing?channel=line'`, `calls[0].ctx.lineUserId === BASE_EVENT.lineUserId`
- flag true: payload ที่ `recordTurnOutcome` บันทึก (`turnOutcomeWrites`/`outcomeStore` ในharness) มี `/l/tok-1` ตัวเดียวกับที่ส่ง (recorded == sent)
- `linkFor` คืน `null` → URL ธรรมดา; `linkFor` throw → URL ธรรมดา (seam จริงจับ error เอง — ในเทสต์ให้คืน null)
- `{ ...BASE_EVENT, pushTargetId: 'C' + 'a'.repeat(32) }` → `calls.length === 0` และปุ่ม = URL ธรรมดา
- เคส R-C11: `termExpiredMemberships: [{ companyId:'company-1', roles:[{ role:{ key:'ACCOUNTANT', status:'ACTIVE', permissions:[{ permission:{ key:'company.plan.manage' } }] } }], term: NO_PACKAGE }]` → ได้การ์ด (ไม่ใช่ member reply)
- G19: `useCase.execute({ ...BASE_EVENT, messageText: 'ให้ทีมงานติดต่อกลับ' })` (fake `lineSupportRequest.create/findFirst`, `lineCompanyContext.upsert` บันทึกการเรียก) → สร้างแถว `requestText === 'ขอให้ทีมงานติดต่อกลับเรื่องแพ็กเกจ'`, ตอบ `/ติดต่อกลับเรื่องแพ็กเกจ/`, **ไม่มี** `lineCompanyContext.upsert` (ไม่ pause), event log `package_callback_requested`; เคส live request → `support_already_open` และ `lineCompanyContext.updateMany` ไม่ถูกเรียก (`extendPause:false`); เคส `handleStaffContact` เดิม (`ติดต่อเจ้าหน้าที่`) ยัง pause (regression)

(จ) `line-signup-status-and-package-change.spec.ts`: `statusHarness({ id:'signup-1', state:'COMPLETED', companyName:'ร้านมั่งมี', companyId:'co-1' }, undefined, false, true, [{ companyId:'co-1', company:{ name:'ร้านมั่งมี', status:'DISABLED', planTerm:{ termStartAt: NOW, termEndsAt: NOW, renewCount: 0 } }, roles:[{ role:{ permissions:[{ permission:{ key:'company.plan.manage' } }] } }] }])` → `eligibleCompanies` deepEqual `[{ companyId:'co-1', companyName:'ร้านมั่งมี', status:'EXPIRED', canEnter:false, lockReason:'no_package', canManagePlan:true }]`, `progress.entryCompanyId === undefined`, `progress.lockedEntryCompanyId === 'co-1'`; เคส roles ไม่มี permission → `canManagePlan:false`; เคส `renewCount:1` → `lockReason:'trial_ended'`; เคส FIRST_SHOP ใน `submit-line-signup` ยังอ่าน `canEnter` (ไม่แตะ)

(ฉ) `line-liff-signup.spec.ts` ใน describe `one truthful renderer…`: `runSignupScript(signupStatus({ state:'COMPLETED', companyCreated:true, resolution:'NEW_SHOP', lockedEntryCompanyId:'co-1' }, [{ companyId:'co-1', companyName:'ร้านนิด', status:'EXPIRED', canEnter:false, lockReason:'no_package', canManagePlan:true }]), [ …status GET…, { status: 200, body: JSON.stringify({ handoffUrl: 'https://app.example.test/l/RAW' }) } ])` → หลัง `settle()` ×3: `progress-title === 'เปิดร้านแล้ว ขั้นต่อไปเลือกแพ็กเกจ'`, มี fetch ไป `/auth/line/liff/session` body `{ idToken, companyId:'co-1' }`, `elements['open-web'].hidden === false && textContent === 'เลือกแพ็กเกจ'`, `retry-status` label กลับเป็น `'ตรวจสอบสถานะอีกครั้ง'` และ `disabled === false`; คลิก `open-web` → liff mock `openWindow` ได้ `{ url:'https://app.example.test/l/RAW', external:true }` (mock :348 ต้องบันทึก args); เคส `canManagePlan:false` → title `/รอเลือกแพ็กเกจ/`, ไม่มี fetch session, `support` แสดง; เคสไม่มี progress + บริษัทล็อก → มี note `ร้านนิด · ยังไม่มีแพ็กเกจ` + ปุ่ม `เลือกแพ็กเกจ`
- busy-label: เคส `retry-status` เดิม (`h.click('retry-status')` สำเร็จ) → label คืนและ `disabled===false`

(ช) `liff-start-handoff.spec.ts` (catalog :348): เพิ่มเคส `needsSelection` ที่ `companies:[{id:'co-1',name:'ร้านหนึ่ง',lockReason:'no_package',canManagePlan:true},{id:'co-2',name:'ร้านสอง'}]` → ปุ่ม `'ร้านหนึ่ง · ยังไม่มีแพ็กเกจ'`, `'ร้านสอง'`

(ซ) `exchange-liff-session` — ไม่มี unit spec แยกในทรี (พฤติกรรมถูกทดสอบผ่าน `line-liff-signup.spec.ts:203-230` ด้วย fake `execute`) → เพิ่มไฟล์ใหม่ `apps/api/src/modules/auth/application/use-cases/exchange-liff-session.use-case.spec.ts` (fake `prisma.client.{externalIdentity,companyMembership,lineCompanyContext}`, `lineIdToken.verify`, `rateLimit`, `mint.execute` บันทึก `targetPath`, `audit.log`, `config:{lineWebHandoffEnabled:true, sesWebBaseUrl:'https://app.example.test'}`): ร้านล็อก+manager → `targetPath === '/companies/co-1/billing?channel=line'`; ร้านล็อก+ไม่ใช่ manager → `/companies/co-1/renew`; ร้าน ACTIVE → `/companies/co-1/dashboard`; ACTIVE แต่ `termEndsAt` อดีต + manager → billing; needsSelection แนบ `lockReason`/`canManagePlan` เฉพาะร้านล็อก — **ลงทะเบียน** ใน catalog api-behavior args ถัดจากบรรทัดของ `plan-manager.logic.spec.ts`

(ฌ) `apps/api/src/modules/access-control/domain/logic/plan-manager.logic.spec.ts` (ใหม่; catalog): `planManagerRoleFilter()` deepEqual shape; `canManagePlan` — ไม่มี roles → false, role status INACTIVE → false, status undefined + permission → true, permission อื่น → false; `planManagersOf(fakeDb,'co')` ส่ง `where` ที่มี `companyId`, `status:'ACTIVE'`, `user:{status:'ACTIVE'}`, filter; `planManagerLineUserIds` dedupe และ `[]` เมื่อไม่มี manager (ไม่เรียก `externalIdentity`)

(ญ) `plan-term-sweep.use-case.spec.ts`: เพิ่มเคส custom-role manager ได้แจ้งเตือน (fake คืน `owners` เมื่อ `where.roles` มี `company.plan.manage`)

(ฎ) `billing-notifications.service.ts` ไม่มี unit spec ในทรี; ครอบด้วย typecheck + `billing-notification-smoke.ts` (Extended Tests) — เพิ่มเคสใน smoke ถ้ามี fixture custom role (**ต้องตรวจ** §10)

(ฏ) `line-signup-notify.service.spec.ts` เพิ่ม: ข้อความ push ถูกส่งผ่าน `pushLineMessages` → body บน wire ยังมี `https://liff.line.me/…/start` โดย **ไม่มี** `openExternalBrowser` (skip host)

(ฐ) web `apps/web/src/features/auth/line-handoff-route.spec.ts` (ใหม่; glob): `HEAD()` → 204, ไม่มี body, `globalThis.fetch` ไม่ถูกเรียก; `GET(new NextRequest('http://localhost:3000/l/' + 'a'.repeat(40), { headers: { 'x-forwarded-for': '203.0.113.55, 172.71.14.9' } }), { params: Promise.resolve({ token }) })` → outgoing headers `x-forwarded-for === '203.0.113.55, 172.71.14.9'`; ไม่มี header เมื่อ request ไม่มี (แบบ `signup-claim-bff.forwarded-ip.spec.ts`)

(ฑ) `line-webhook.controller.spec.ts:92-105` เพิ่ม `postback.data:'action=package-callback'` → enqueue text `'ให้ทีมงานติดต่อกลับ'`

(ฒ) `line-handoff-link.service.spec.ts`: text `https://app/companies/co-1/billing?openExternalBrowser=1` → `calls[0].targetPath === '/companies/co-1/billing'`; `linkFor(ctx,'/companies/co-2/dashboard?openExternalBrowser=1')` → mint ด้วย `/companies/co-2/dashboard`

(ณ) `system-line-push.spec.ts` (package.json `test` + extended :318): เพิ่ม `pushLineMessages({..., messages:[{type:'flex',…uri:'https://app/companies/c/billing'}]})` → body มี param; `liff.line.me` ไม่มี

(ด) `process-due-deliveries.use-case.spec.ts:185-221` (มี fetch fake อยู่แล้ว): เพิ่ม assertion body ของ push มี `openExternalBrowser=1` ใน uri เมื่อ deep link เป็น web URL; retry key regex เดิมยังผ่าน

### 6.3 Coverage guard
`pnpm --filter @watchdog-bms/api exec tsx --test src/spec-suite-coverage.spec.ts` ต้องผ่านหลังเพิ่มไฟล์ใหม่ทั้ง 2 ไฟล์ใน api (catalog) — ถ้าลืม จะแดงพร้อมชื่อไฟล์

---

## 7. Docs ที่ต้อง amend ใน PR นี้ (บรรทัดจาก ddcdcadf)

| ไฟล์:บรรทัด | ปัจจุบัน (ย่อ) | แก้เป็น |
|---|---|---|
| `docs/specs/mangmee-line-first-signup-spec-th.md:5` | follow reply = ข้อความ → รูป `mangmeeplus-welcome-how-to-start-1080x1350.png` → การ์ด | "ข้อความต้อนรับ → การ์ดเปิดร้าน (รูปวิธีใช้ถอดออก 2026-09-27 จนกว่าจะมีไฟล์ใหม่ที่มีขั้นเลือกแพ็กเกจ — purchase-without-setup R-C4)" |
| `:100` | `"เปิดร้านใหม่ ทดลองฟรี"` → LIFF signup | `"เปิดร้านใหม่"` → LIFF signup (ไม่มีทดลองฟรี; R1/R-C7) |
| `:159` | push "ร้าน <ชื่อร้าน> พร้อมใช้แล้ว" + ปุ่ม "เริ่มใช้งาน" + บรรทัด "ลองเลย: ส่งรูปใบเสร็จ…" | push หัวข้อ "เปิดร้านแล้ว" ข้อความ "🎉 เปิดร้าน <ชื่อร้าน> ให้แล้วค่ะ ขั้นต่อไปเลือกแพ็กเกจเพื่อเริ่มใช้งาน …" + ปุ่ม **"เลือกแพ็กเกจ"** → LIFF start (URL กลาง ไม่มี token; 2 แตะ — DQ3); ไม่มีประโยคชวนส่งใบเสร็จเพราะร้านล็อกจนกว่าจะเลือกแพ็กเกจ |
| `:165` | target ครั้งแรก = แดชบอร์ด | "target ครั้งแรก = แดชบอร์ดสำหรับร้าน ACTIVE; ร้านล็อก (ยังไม่มีแพ็กเกจ/หมดอายุ): ผู้มี `company.plan.manage` → `/companies/<id>/billing?channel=line`, คนอื่น → `/companies/<id>/renew` (R-C3, `exchange-liff-session.use-case.ts destination()`)" |
| `:184` | หมดอายุ → LINE ตอบ `expiredLineOwnerMessageTh` + ปุ่ม "ขอเปลี่ยนแพ็กเกจ" | เพิ่ม: "เมื่อ billing เปิด LINE ส่งการ์ดล็อกที่ปุ่ม 'เลือกแพ็กเกจ' เป็น `/l/<token>` mint ในเลนก่อนบันทึก (R-B2 ทาง ข; ห้ามในกลุ่ม/ห้อง) ให้ผู้มี `company.plan.manage` ทุกคน (R-C11) — ข้อความ `expiredLineOwnerMessageTh` ใช้เฉพาะเมื่อ billing ปิด" |
| `:185` | การชำระเงินช่วงแรกทำมือ | "ลูกค้าซื้อเองผ่านหน้าแพ็กเกจ (Stripe) ตั้งแต่ 2026-09-23; แอดมินยังปรับจากหน้า partner ได้ (คำเตือน R-C6 ใน PR B)" |
| `:263` ตาราง push | "ร้าน <ชื่อร้าน> พร้อมใช้แล้วค่ะ 🎉 ทดลองฟรี 30 วัน …" / เริ่มใช้งาน | "🎉 เปิดร้าน <ชื่อร้าน> ให้แล้วค่ะ ขั้นต่อไปเลือกแพ็กเกจเพื่อเริ่มใช้งาน กดปุ่มด้านล่าง แล้วกดเปิดหน้าเว็บเพื่อดูแพ็กเกจและชำระเงินได้เลยนะคะ" / เลือกแพ็กเกจ (LIFF start) / push 1 ครั้ง; เพิ่มแถว `attached`: "🎉 เพิ่มร้าน <ชื่อร้าน> ให้บัญชีของคุณแล้วค่ะ ขั้นต่อไปเลือกแพ็กเกจให้ร้านนี้ …" |
| `docs/specs/mangmee-line-web-billing-ui-spec-th.md:71` | "ใน group/room ให้เพียงทางเข้าไปยืนยันตัวตนส่วนบุคคล" + generic LIFF URL `/billing` | เพิ่มท้าย: "แก้ 2026-09-27 (purchase-without-setup R-B2): การ์ดล็อก/ตอบขอเปลี่ยนแพ็กเกจ/การ์ดโปรโมชั่นถือ `/l/<token>` ที่ mint ในเลนก่อนบันทึก (payload ที่บันทึก = ที่ส่ง); ในกลุ่ม/ห้องเป็น URL ธรรมดา + `openExternalBrowser=1`; ลิงก์ทุกลิงก์ที่ออกจาก LINE ได้ param นี้ที่ทางออก (R-B1)" |
| `:73` | `purpose=start\|billing` + "ตรวจ current OWNER + company.setup.manage" | "ไม่มี `purpose` — `liff/session` เดิมตัดสินปลายทางจากสถานะร้านและสิทธิ์ `company.plan.manage` (R-C3): ร้านล็อก+manager → billing, อื่น → renew; ไม่ใช่ OWNER/`company.setup.manage`" |
| `:75` | surface=liff_billing; ปุ่ม "เปิดหน้าชำระเงินในเบราว์เซอร์" | "surface คง `liff_start`; ปุ่มบนหน้าผลลัพธ์ signup = 'เลือกแพ็กเกจ' (handoff เตรียมตอน render, เปิด `external:true`), หน้า start = 'เปิดหน้าเว็บ'" |
| `docs/specs/line-web-deeplink-handoff-spec.md:5` | "ปัจจุบัน exchange ยังปฏิเสธ non-ACTIVE ทั้งหมด: งานถัดไปเพิ่ม term-expiry recovery สำหรับ current OWNER" | "2026-09-27: exchange รับร้าน DISABLED+termDisabledAt แล้ว (`resolveLineHandoffTarget`); target billing สำหรับผู้มี `company.plan.manage` (ไม่ใช่ OWNER เท่านั้น); `/l/` ตอบ `HEAD` 204 และส่งต่อ client IP; `/l/<token>` บน LINE มี `?openExternalBrowser=1` เสมอ (route อ่าน token จาก path เท่านั้น)" |
| `docs/research/line-stripe-browser-payment-reference-th.md:15` | "ใช้ external browser เป็นทางหลักจาก LIFF …" | เพิ่ม: "และจากทุกข้อความ LINE: ทางออก 3 จุด (`line-reply.adapter.ts`, `system-line-push.ts`, `notification.use-cases.ts`) เติม `openExternalBrowser=1` ให้ทุกลิงก์เว็บ ยกเว้น LIFF/`*.line.me`/official (implemented 2026-09-27)" |
| `docs/specs/mangmee-company-plan-term-spec-th.md:70` | แจ้ง **OWNER เท่านั้น** บันได 7/3/1 | "แจ้ง **ผู้มี `company.plan.manage`** (OWNER และ custom role; Owner D-PF-10 2026-09-26) …" |
| `:93` | แบนเนอร์/หน้าแดงเฉพาะ OWNER; พนักงาน = ข้อความกลาง | "เฉพาะผู้มี `company.plan.manage` (เว็บอ่านจาก `canManagePlan`; LINE ใช้ predicate เดียวกัน) — พนักงานที่ไม่มีสิทธิ์ยังได้ข้อความกลาง" |
| `:113` | "LINE ตอนหมดอายุ → ตอบสุภาพ+ชวนติดต่อ (แจ้งเฉพาะ OWNER เหมือนเดิม)" | "LINE ตอนหมดอายุ → การ์ดล็อกพร้อมปุ่ม 'เลือกแพ็กเกจ' one-tap ให้ผู้มี `company.plan.manage`; พนักงานได้ประโยคกลาง (purchase-without-setup R-B2/R-C11)" |
| `packages/contracts/src/external-signup.ts:372` | `/** Only ACTIVE is a valid RETURN_EXISTING target and direct entry. */` | ตาม §2.2 (comment ใหม่ + ฟิลด์ใหม่) |
| `docs/agent-memory/purchase-without-setup-2026-09-26.md` | Status/Verification/Next | อัปเดตเมื่อ PR A เปิด/merge (run ids, สิ่งที่ Owner ต้อง sign-off: :244) |

---

## 8. Verification (ตามคำสั่ง Owner 2026-09-21: typecheck + boot + spec ที่แตะ; ไม่รอ CI ระหว่างเฟส)

```bash
# 0) pins (P0) — ต้องทำเป็น commit แรกของ PR
node infra/security/sync-production-maintenance-release-pins.mjs
node infra/security/sync-production-maintenance-release-pins.mjs --check
bash infra/security/sync-production-maintenance-release-pins.spec.sh
bash infra/security/validate-production-maintenance-release.spec.sh

# 1) contracts ก่อน (api อ่าน src, web อ่าน dist)
pnpm --filter @watchdog-bms/contracts build && pnpm --filter @watchdog-bms/contracts typecheck
pnpm exec tsx --test packages/contracts/src/line-external-browser.spec.ts

# 2) api
pnpm --filter @watchdog-bms/api exec prisma generate --schema prisma/schema.prisma   # ถ้า client เก่า (worktree ใหม่)
pnpm --filter @watchdog-bms/api typecheck                                             # script มี heap flag แล้ว; อ่าน exit code จริง
pnpm --filter @watchdog-bms/api exec tsx --test \
  src/modules/access-control/domain/logic/plan-manager.logic.spec.ts \
  src/modules/auth/application/use-cases/exchange-liff-session.use-case.spec.ts \
  src/modules/line-ai/infrastructure/line-reply.adapter.spec.ts \
  src/modules/auth/infrastructure/system-line-push.spec.ts \
  src/modules/dashboard-notifications/application/use-cases/process-due-deliveries.use-case.spec.ts \
  src/modules/line-ai/application/line-handoff-link.service.spec.ts \
  src/modules/sales-console/domain/sales-deal.logic.spec.ts \
  src/modules/line-ai/domain/logic/line-business-card.logic.spec.ts \
  src/modules/line-ai/domain/logic/line-staff-menu.logic.spec.ts \
  src/modules/line-ai/line-first-signup-webhook.spec.ts \
  src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts \
  src/modules/billing/line-billing-entry.spec.ts \
  src/modules/auth/line-webhook.controller.spec.ts \
  src/modules/auth/line-liff-signup.spec.ts \
  src/common/security/liff-start-handoff.spec.ts \
  src/modules/external-signup/application/line-signup-status-and-package-change.spec.ts \
  src/modules/external-signup/application/line-signup-notify.service.spec.ts \
  src/modules/system-partner-management/application/use-cases/plan-term-sweep.use-case.spec.ts \
  src/modules/system-partner-management/application/use-cases/package-change-decision.use-case.spec.ts \
  src/spec-suite-coverage.spec.ts
node scripts/run-line-ai-whole-chain-acceptance.mjs      # แตะ LINE-AI → บังคับ (ครอบ catalog + harness)
pnpm --filter @watchdog-bms/api test:boot                # DI: ไม่มี provider ใหม่ แต่ import ข้าม module เพิ่ม

# 3) web
pnpm --filter @watchdog-bms/web exec tsx --test src/features/auth/line-handoff-route.spec.ts src/common/api/forwarded-client-headers.spec.ts
pnpm --filter @watchdog-bms/web typecheck                 # ต้องตรวจชื่อ script (§10)

# 4) PG/smoke/e2e = Extended Tests (manual) — บันทึก run id ใน memory; ไม่ใช่ gate ของ PR นี้
```
Local เครื่องจริง (ก่อน UAT, AC10): iPhone + Android — การ์ดล็อกแตะครั้งแรกเปิด Safari/Chrome ที่หน้าแพ็กเกจโดยไม่มีหน้าล็อกอิน; LIFF ผลลัพธ์ 1 แตะ; push 2 แตะ; ลิงก์ในกลุ่มเป็น URL ธรรมดา; link preview ไม่เผา token (HEAD 204)

---

## 9. Risks / guards

1. **AC3 "payload ที่บันทึก = payload ที่ส่ง"** — เป็นจริงระดับ token/ลิงก์ (mint ในเลน); bytes บน wire ต่างจากที่บันทึกเฉพาะ `openExternalBrowser=1` ที่ exit เติมแบบ deterministic+idempotent → replay/push fallback ส่ง bytes เดียวกับครั้งแรก, retry key คำนวณจาก payload ที่บันทึก (ไม่เปลี่ยน). ต้องเขียน AC3 ใน spec ให้ตรง (ดู §10 ข้อ 1)
2. **Token ตายในรายการที่บันทึก**: เลน `package_required`/`billing_review_link` เมื่อ flag replay เปิด จะบันทึก `/l/<token>` (อายุ 15 นาที) → orphan replay อาจส่งลิงก์ตาย — เท่ากับ promotion card/บริษัทของฉัน ที่ทำอยู่แล้ว; ปลายทางลิงก์ตาย = `/login?line=handoff-expired&next=…` ซึ่ง R-B5 (PR B) จะเริ่ม LINE login ให้เอง (AC10 ค). ห้ามแก้ `:3274`
3. **Length**: text 5000 / uri 1000 — helper คืนค่าเดิมเมื่อเกิน (ไม่ตัดกลางลิงก์); `providerMessages` ยังนับ `altText ≤ 400` เดิม
4. **Binding hash ของ billing notification** (`:85`, `:368`) คำนวณจาก `buildLineMessage` ก่อน exit → ไม่เปลี่ยน; ถ้าใครย้าย transform เข้า `buildLineMessage` จะได้ `LINE_BINDING_CHANGED` ทุก retry
5. **กลุ่ม/ห้อง**: guard ที่ `oneTapPackageUrl` ด้วย `isLineGroupChatKey(pushTargetId ?? lineUserId)`; `attemptDelivery` seam เดิม (flag ปิด) ยัง wrap ในกลุ่มได้ — พฤติกรรมเดิม ไม่แตะ (RV08 ยังคงเป็น residual ของ seam เดิมเมื่อ flag ปิด; production flag เปิด)
6. **R-C11 ขยายผู้รับ**: custom role ที่มี `company.plan.manage` ได้การ์ด/แจ้งเตือน/ข้อเสนอพิเศษ (ราคาไม่เดินทางบน LINE อยู่แล้ว — R14); อีเมล billing notice ยัง OWNER จน PR C; `ownerLineUserIds` (ตอบ support/ตัดสินคำขอเปลี่ยนแพ็กเกจ) ไม่แตะ — สอง predicate อยู่คู่กันโดยตั้งใจ
7. **`canEnter` ไม่เปลี่ยน** (RV10) — `submit-line-signup.use-case.ts:145` ยังอ่าน `canEnter`; ฟิลด์ใหม่ทั้งหมด optional และโผล่เฉพาะร้านล็อก → fixture ร้าน ACTIVE ทุกที่คงเดิม
8. **LIFF เตรียม handoff ตอน render** = mint 1 token ต่อการเปิดหน้า (rate limit `assertLineLiffSessionAllowed` ต่อบัญชี) — เท่ากับหน้า start ที่ทำอยู่แล้ว; ไม่เปิดอัตโนมัติ (GW02)
9. **G19 ไม่ pause** แต่ยังใช้ dedupe/daily floor/notice เดิม; `recordSupportFollowUp(..., {extendPause:false})` ต้อง default `true` เพื่อไม่เปลี่ยนพฤติกรรม "ติดต่อเจ้าหน้าที่"
10. **Owner-verbatim** `:244` — ห้ามเปลี่ยนโดยไม่มี sign-off; PR รวมเป็น commit แยกได้เพื่อถอดง่าย
11. **Release Contracts**: PR A ไม่แตะ `apps/web/public`, `.github/` (ยกเว้น ci.yml:543 และ deploy-production.yml:421 จาก pins) → ci.yml เปลี่ยน = ต้องเหมือน main ก่อน UAT all (P0)
12. **DI**: ไม่มี provider ใหม่; import pure function ข้าม module (access-control ← billing/external-signup/spm/sales-console/line-ai/auth) ไม่สร้าง Nest cycle แต่ต้อง `test:boot`

---

## 10. "ต้องตรวจ" (ยืนยันไม่ได้จากการอ่านโค้ด — พร้อมคำสั่ง)

1. ~~AC3 wording~~ ตัดสินแล้ว 2026-09-27: spec §18.5 A10 แก้ AC3 เป็น "payload ที่บันทึก = payload ที่ส่ง ยกเว้น `openExternalBrowser=1` ที่ทางออกเติมแบบ deterministic/idempotent หลังคำนวณ retry key"
2. **`entryKind`** — spec §7 R-C2 พูดถึง `entryKind: 'ACTIVE'|'LOCKED'` แต่ §18.2 (มีผลเหนือ) ระบุ `lockReason` + `canManagePlan`; brief ใช้ §18.2 และเพิ่ม `lockedEntryCompanyId` (จำเป็นเพราะ `entryCompanyId` ถูก gate ด้วย `canEnter` ที่ห้ามขยาย) — ตัดสินแล้ว 2026-09-27: ใช้ `lockReason`/`canManagePlan`/`lockedEntryCompanyId` (spec §18.5 A9)
3. รายชื่อไฟล์ pinned อื่นที่อาจ stale นอกจาก `auth.guard.ts`: `node infra/security/sync-production-maintenance-release-pins.mjs --check` (loop เทียบ sha ใน session นี้รันไม่ผ่านเพราะ sandbox — ตรวจซ้ำก่อน sync)
4. ชื่อ script typecheck ของ web: `grep -n '"typecheck"' apps/web/package.json`
5. `billing-notification-smoke.ts` / fixture custom role: `grep -n "OWNER\|plan.manage" apps/api/src/scripts/billing-notification-smoke.ts` — ถ้า smoke สร้างผู้รับด้วย OWNER เท่านั้น ยังผ่าน (OWNER ⊂ managers)
6. e2e `line-signup-contact-email.spec.ts:66,191` อ้างข้อความ `ก่อนชำระแพ็กเกจ` หรือไม่: `grep -n "ก่อนชำระ\|ยืนยันอีเมล" apps/web/e2e/line-signup-contact-email.spec.ts` (path ต้องตรวจ: `find apps/web -name "line-signup-contact-email.spec.ts"`)
7. `absoluteWebLink` ยังถูกใช้ใน webhook หลังลบภาพ: `grep -n absoluteWebLink apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts` (คาดว่าใช้ที่ `putLineMediaUpload` :965 → คง import)
8. LINE uri action limit 1000 และ postback `displayText` — ยืนยันกับ LINE Messaging API reference ปัจจุบัน (uri action `uri` ≤ 1000 chars; postback `displayText` ≤ 300) ก่อน merge
9. `START_REASON_TH.expired` (:174) เข้าถึงได้หรือไม่ (blockedReason) — ถ้า dead branch ให้บันทึกใน memory ไม่ต้องแก้
10. `line-staff-menu.logic.spec.ts` มีเทสต์ `linePostbackCommandText` หรือไม่ (grep คืนว่าง) — ถ้าไม่มี ให้ใส่เคสใหม่ใน `line-webhook.controller.spec.ts:92-105` (มี pattern)
11. `docs/specs/mangmee-line-first-signup-spec-th.md:5` ผูกกับ evidence/Release Contracts ใด: `grep -rn "welcome-how-to-start" docs/security-evidence infra .github` — ถ้ามี manifest ที่ตรวจ URL รูป ต้องอัปเดตพร้อมกัน
12. Prisma relation ชื่อ `Role.permissions` → `RolePermission.permission` และ `Role.status` (ใช้ใน `planManagerRoleFilter`): ยืนยันจาก `apps/api/prisma/schema.prisma` `model Role` / `model RolePermission` (assertOwner :111-114 ใช้ shape นี้อยู่แล้ว — typecheck จะฟ้องถ้าผิด)
13. Owner sign-off ข้อความ `:244` (G20) และยืนยันว่า ENTERPRISE = starter + ภ.ง.ด.53 + 50 ทวิ ยังเป็นความจริงในแคตตาล็อกที่ขายจริง (`GET /v1/billing/catalog` บน UAT)
