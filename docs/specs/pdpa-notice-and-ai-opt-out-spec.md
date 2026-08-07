# Spec: PDPA privacy notice page + per-employee AI assistant opt-out

Status: Approved for build (closes the two `[GAP]` items in
`docs/security-evidence/p1-ai-processor-lawful-basis-register.md` §6).
Owner: thawatchai (order 2026-07-28: "ปิด 2 gap นั้นให้เลย ทำ spec + plan และค่อย code
review test + integrate ใช้งานจริงได้").

## Why

The M-05 lawful-basis register cites two things that must exist for its §3 notice and
objection routes to be true:

1. A **privacy notice page** — both notice routes point at a page that does not exist.
2. A **per-employee AI opt-out** — P1's objection route currently has no mechanism; the
   register allows either a real opt-out or a documented "use the web instead" stance,
   and the owner chose the real opt-out.

## Product behaviour

### G1 — Public privacy notice page

- Route: `/privacy` in the web app (public, no auth — same class as `/login`,
  `/forgot-password`). Production URL: `https://mangmeeplus.com/privacy`.
- Content (Thai): who processes what, per purpose (P1–P4 of the register §1), the
  processors (AWS Bedrock/Anthropic, Typhoon OCR, LINE), cross-border processing
  statement, retention (90-day AI window + accounting-law exceptions), data-subject
  rights and how to exercise them, marketing opt-out **using the exact keywords the code
  recognises** (`ยกเลิกข่าวสาร`, `หยุดโปร`, `STOP`), and the employee AI opt-out route
  (G2). Content states only facts verified in the register; lawful-basis wording stays
  generic pending the §3 decision and is updatable without redeploy ceremony.
- Login page footer links to `/privacy` so the notice is reachable from the app's
  front door.

### G2 — Per-employee AI assistant opt-out

- **Data:** `User.aiAssistantOptOutAt DateTime?` — null = assistant on (default);
  set = opted out, timestamp records when. User-level, not per-company: the LINE
  assistant resolves the user before the company, and the objection is personal.
- **Enforcement (fail closed, zero extra queries):** in
  `process-line-webhook.use-case.ts`, both entry paths (text `execute`, media
  `executeReceiptUploadInner`) already load `identity.user`; immediately after the
  identity/ACTIVE check, if `aiAssistantOptOutAt` is set: deliver a deterministic Thai
  reply (no model call, no gateway dispatch, no AiTurn), write the event log with
  status `ai_opt_out` (`LINE_AI_ERROR_CODES.FORBIDDEN` — reuse; the status string is
  the discriminator), and stop. Nothing is sent to any AI processor.
  - Scope note: the opt-out silences the **LINE assistant** (P1) including its media
    intake. Receipt OCR via the web upload path (P2, legal-obligation basis) is
    deliberately unaffected — the employee chooses that path explicitly.
- **Self-service API:** follows the `account/email` precedent exactly.
  - `GET /v1/auth/account/security` → response gains `aiAssistantOptOutAt: string|null`.
  - `POST /v1/auth/account/ai-assistant` `{ enabled: boolean }` → sets/clears the
    timestamp on the caller's own row (`req.context.userId` only), 204, audit-logged
    (`account.ai_assistant.updated`, metadata `{ enabled }`). Permission:
    `account.password.change` — the established self-service account-write key
    (`POST account/email` precedent); no new permission, no template sync.
- **UI:** a card on the existing Settings → Security page (`AccountSecurityPage`):
  current status + one toggle button, Thai copy explaining what stops (LINE assistant
  replies for this account) and what does not (web app, web receipt upload).
- **LINE reply copy (deterministic):**
  `🤖 คุณปิดการใช้งานผู้ช่วย AI ไว้ ข้อความนี้จึงไม่ถูกประมวลผลด้วย AI\nเปิดใช้งานอีกครั้งได้ที่ เว็บแอป → ตั้งค่า → ความปลอดภัย`

## Rules / boundaries

- Opt-out must stop processing **before** any provider/tool/gateway involvement.
- The check must cover every employee-assistant entry path in the use-case; both
  current paths share the identity block, and the ledger drain re-enters the same
  use-case, so the gate holds there too.
- No change to CRM customer flows, company entitlement gate, or AI Gateway.
- Nullable column, idempotent migration (`ADD COLUMN IF NOT EXISTS`), no NOT NULL.

## Acceptance

1. `/privacy` renders publicly (no session), Thai content covering the register facts,
   unsubscribe keywords byte-identical to `CONSENT_DEFAULTS.unsubscribeKeywords`.
2. Employee with `aiAssistantOptOutAt` set sends a LINE text → deterministic reply,
   event log `ai_opt_out`, no gateway call. Same for a LINE receipt image.
3. Toggle round-trip: POST `{enabled:false}` sets the timestamp (visible in GET),
   `{enabled:true}` clears it; audit rows written; another user's row untouched.
4. Register §3.1/§6 updated: objection route now "Settings → Security toggle";
   notice-page gap closed with the real URL.
5. Suites and typechecks pass (api, web, contracts untouched or rebuilt as needed).
