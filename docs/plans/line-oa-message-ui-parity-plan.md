# LINE OA Message UI Parity Plan

Status: Implement-ready 2026-08-05.
Spec authority: `docs/specs/line-ai-assistant-ux-spec.md` (§2 non-goals, §5 business rules).
Predecessor: `docs/agent-memory/line-oa-role-menu.md` (role-aware Quick Reply, production 2026-07-15).
Task memory: `docs/agent-memory/line-oa-message-ui-parity.md`.
Codex handoff: `docs/plans/line-oa-message-ui-codex-handoff.md`.

## 1. Goal

The owner supplied a standalone LINE OA bot prototype (`line-oa-bot/`: `server.js`, `messages.js`,
`make_dropzone.py`, `flex-preview.json`, `receipt-dropzone.png`) that defines the **intended visual
design** of the staff chat: a greeting bubble with mixed bold/regular text on one line, and a
"ถ่ายใบเสร็จ" card with a real dashed capture frame.

Bring that **presentation layer** into WatchDog-BMS. Nothing else from the prototype is adopted.

## 2. What already exists — do not rebuild

The prototype's *behaviour* is a strict subset of what ships today. Ground truth:

| Prototype piece | Repo status |
|---|---|
| Webhook server, signature middleware, `handleEvent`, `normalize()` | `apps/api/src/modules/line-ai/…/process-line-webhook.use-case.ts` (2169 lines: identity, tenant, permissions, buffering, audit, idempotency) |
| `runOcr()` stub | Real OCR + draft pipeline via `ReceiptOcrApplyService` |
| `getUserProfile()` hard-coded role/scope | `permissionResolver.resolveAccess()` |
| `mainMenuQuickReply` (3 fixed buttons) | `buildStaffMainMenu()` — permission-filtered, up to 9 actions |
| `receiptQuickReply` (camera / cameraRoll / back) | `buildReceiptCapturePrompt()` — identical actions |
| Command matching by Thai label | `staffMenuCommand()` |

So the diff is **cosmetic and small**, and it lives almost entirely in one file:
`apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.ts`.

## 3. The real gap

1. **Greeting is a plain `text` message.** The prototype greeting is a Flex bubble whose lines mix
   bold and regular runs (`span` contents) and states role, data scope, and menu count.
2. **Receipt prompt is a plain `text` message.** The prototype shows a card with a dashed drop-zone
   image (Flex cannot draw dashed borders, hence a PNG) plus the camera Quick Reply.
3. **`LineReplyMessage`'s flex variant has no `quickReply` field** (`line-reply.adapter.ts:11-13`),
   but the prototype attaches Quick Reply to Flex messages — which LINE allows on any message type.
   This type gap is why the receipt card cannot become Flex today.
4. **No public dashed-frame asset.** Flex images must be public HTTPS.

## 4. File placement (done — assets are already in the tree)

| Prototype path | Repo path | Why here |
|---|---|---|
| `assets/receipt-dropzone.png` | `apps/web/public/assets/line/receipt-dropzone.png` | Web already publishes this folder over HTTPS; the sibling Rich Menu PNG is verified 200 in production |
| `tools/make_dropzone.py` | `scripts/line-oa/make-dropzone.py` | Regenerator for a committed asset; paths repointed at the repo layout, font requirement documented |
| `tools/flex-preview.json` | `scripts/line-oa/flex-preview.json` | Flex Simulator payloads for design review before code changes |
| `src/messages.js` | *(not copied)* — folded into `line-staff-menu.logic.ts` | Repo already owns message construction, typed and permission-aware |
| `src/server.js`, `package.json`, `.env.example` | *(not copied)* | Superseded; copying them would fork the webhook |
| `README.md` setup steps | *(not copied)* | Already covered by `docs/runbooks/b1-b2-line-external-setup.md` |

## 5. Design decisions

- **D1 — Presentation only.** No new module, no new dependency (`@line/bot-sdk` is not adopted), no
  route change, no schema change, no migration. Builders in/out shape stays `LineReplyMessage`.
- **D2 — `quickReply` moves to the shared message level** in `LineReplyMessage` so a Flex message can
  carry it. Adapter serialization is already pass-through JSON.
- **D3 — Greeting becomes a Flex bubble** with `span`-based bold, keeping the exact same
  permission-filtered Quick Reply items. `altText` carries the plain-text greeting so notifications
  and desktop clients stay readable.
- **D4 — Receipt prompt becomes a Flex card** with the drop-zone image and the same camera /
  cameraRoll / back Quick Reply.
- **D5 — Image URL is derived, never hard-coded**: `${webBaseUrl}/assets/line/receipt-dropzone.png`.
  When `webBaseUrl` is absent the image block is **omitted**, not rendered broken — the same
  graceful-degradation rule the approval card already uses for its footer.
- **D6 — Honest values only.** The prototype hard-codes `ทุกสาขา` and `12 เมนู`. In the repo the scope
  label comes from the caller's resolved branch scope and the menu count is the number of Quick Reply
  actions actually granted. A cosmetic change must not assert access the user does not have.
- **D7 — Safety copy is preserved.** The receipt card keeps
  "บันทึกเป็นรายการรอตรวจสอบ ไม่อนุมัติหรือชำระเงินอัตโนมัติ" (UX spec §5: LINE capture is draft-only).
- **D8 — Query menu stays `text`.** The prototype's ถามข้อมูล reply is plain text too; changing it
  would be churn.
- **D9 — Palette follows the repo**, not the prototype: `#101828` heading, `#667085` muted,
  `#12B76A` accent. The prototype's `#169152` survives only inside the PNG.

## 6. Deferred — receipt result card (`04_receipt_result`)

The prototype's "บันทึกใบเสร็จแล้ว" summary card is **not** in this change.

Reason: today that reply is `formatPaypersReply()` — a **string** produced at four call sites
(`process-line-webhook.use-case.ts:895, 1607, 1777, 1876`) and then persisted as `replyText` on the
conversation turn, where it feeds AI context and correction lookups. It also carries far more than the
prototype card (document type, VAT, category, duplicate warning, missing-attachment notice). Turning it
into Flex changes a logging/AI-context contract, not just pixels — that belongs in its own change with
its own spec decision on what the persisted text becomes. Tracked as the follow-up in task memory.

## 7. Verification

Unit tests only (owner scope: no E2E for this change), all added to **already-registered** spec files
so `apps/api/package.json` stays untouched:

- `line-staff-menu.logic.spec.ts` — greeting shape/altText/spans/menu count/scope label/long-name
  bounding; receipt card shape, image URL derivation, image omitted without `webBaseUrl`, safety copy,
  camera actions; existing permission-filter assertions still pass.
- `line-reply.adapter.spec.ts` — a Flex message with `quickReply` serializes it at message top level.
- `process-line-webhook.use-case.spec.ts` — `เมนูหลัก` and `ถ่ายใบเสร็จ` deliver the new Flex messages.

Gates: `pnpm --filter @watchdog-bms/api test` (full registered list) + `pnpm --filter @watchdog-bms/api lint`.

Manual design check (no code): paste `scripts/line-oa/flex-preview.json` `02_welcome` / `03_receipt_card`
into <https://developers.line.biz/flex-simulator/>. The preview file is updated in the same change so it
matches what the builders emit.

## 8. Out of scope

- `follow`-event greeting (the webhook handles message events only today; the Rich Menu launcher sends
  `เมนูหลัก`).
- Rich Menu image or LINE OA Manager configuration — unchanged, see `docs/runbooks/b1-b2-line-external-setup.md`.
- Customer-facing CRM inbox messages (`crm-inbox` module) — staff channel only.
- Receipt result card (§6).
