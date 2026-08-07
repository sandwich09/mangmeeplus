# LINE OA Message UI Parity — Codex CLI Handoff

Status: Implement-ready 2026-08-05. Plan authority: `docs/plans/line-oa-message-ui-parity-plan.md`.
Spec authority: `docs/specs/line-ai-assistant-ux-spec.md` §2/§5. Task memory: `docs/agent-memory/line-oa-message-ui-parity.md`.
Predecessor: `docs/agent-memory/line-oa-role-menu.md` (the code you are changing shipped 2026-07-15).

Executor: **Codex CLI** — `codex exec -m gpt-5.6-sol -c model_reasoning_effort="xhigh" -s workspace-write`.
Codex writes code + **unit tests** and runs the verify commands. **Claude reviews the diff, runs the real
test gate, and commits. Codex never commits, never `git add`.**

Business goal (one sentence): when a staff member taps the LINE Rich Menu or "ถ่ายใบเสร็จ", the reply
looks like the owner's approved design — a greeting bubble with bold name/role/scope inline, and a
receipt card with a real dashed capture frame — while every number and label shown stays true to that
user's resolved permissions.

**Scope is cosmetic.** If you find yourself changing routing, OCR, persistence, or permissions, stop —
you have left the plan.

---

## Dispute protocol (you are required to exercise judgment)

Before and during each phase, judge whether this plan matches code reality. If you find a conflict, a
safety hole, or a materially simpler correct design:

1. **STOP the affected phase.**
2. Append to `docs/agent-memory/line-oa-message-ui-parity.md` under `## Objections`: (a) the claim,
   (b) evidence as `file:line`, (c) impact on the business goal, (d) the smallest correct alternative.
3. Do NOT silently deviate. An undocumented deviation is a defect; a well-evidenced objection is a
   success outcome and will be adjudicated by Claude.

## Ground-truth baseline — what EXISTS, do NOT rebuild

- `apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.ts` (168 lines) — the ONLY file that
  builds staff menu messages. `buildStaffMainMenu` (`:30`), `buildStaffQueryMenu` (`:103`),
  `buildReceiptCapturePrompt` (`:116`), `buildPendingApprovalCard` (`:134`), `staffMenuCommand` (`:160`),
  `boundedLabel` (`:50`), `messageAction` (`:28`), `QUERY_ACTIONS` (`:17`).
- `apps/api/src/modules/line-ai/infrastructure/line-reply.adapter.ts:8-13` — `LineQuickReplyItem` /
  `LineReplyMessage`. **The flex variant currently has no `quickReply` field.** Delivery is
  `JSON.stringify`-pass-through (`:81`), so no serialization work is needed beyond the type.
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:772-792` — the
  only call site: builds `StaffMenuContext` from `identity.user.displayName`, `resolvedAccess.roles`,
  `resolvedAccess.permissions`, `this.config.webBaseUrl`, `companyId`, `isOwner`; dispatches on
  `staffMenuCommand`; delivers via `deliverRequiredMessages` (`:626`).
- `resolvedAccess` (`:742`) is typed `{ membershipId; roles; permissions; scopes: { branchIds?: string[] } }`
  — **`scopes.branchIds` is the branch-scope source for D6. It is already in hand; do not query for it.**
- `absoluteWebLink` (`:218`) — existing base-URL joiner (trims trailing slash, returns the bare path when
  no base). `buildPendingApprovalCard` (`:134-145`) is the reference pattern for "omit the block when
  `webBaseUrl` is missing".
- `apps/web/public/assets/line/receipt-dropzone.png` — **already committed by Claude** (520×300 RGB).
  Sibling `mangmeeplus-staff-menu-2500x843.png` is verified served at
  `https://mangmeeplus.com/assets/line/…` = 200 `image/png`, so the folder is public HTTPS in production.
- `scripts/line-oa/make-dropzone.py`, `scripts/line-oa/flex-preview.json` — **already placed by Claude.**
  `flex-preview.json` keys: `01_switched_user`, `02_welcome`, `03_receipt_card`, `04_receipt_result`.

## Environment quirks (read before running anything)

- Node is v24.14.0 on PATH — no nvm dance needed. Package manager is `pnpm` via corepack.
- **API tests are a HAND-MAINTAINED explicit list** in `apps/api/package.json` `"test"` — an unregistered
  new `*.spec.ts` silently never runs. **This handoff therefore requires you to extend the three
  ALREADY-REGISTERED spec files below and create no new API spec file.** `AGENTS.md` forbids editing
  `package.json` for anything but dependency changes; there is no dependency change here, so
  `apps/api/package.json` must NOT appear in your diff.
- **Never run Prisma migrate/reset/push.** There is no schema change in this task.
- Your sandbox cannot reach the local Postgres. **Do not run E2E** — the owner explicitly scoped this
  change to unit tests. If a `pnpm --filter … test` invocation hits a `tsx` IPC `listen EPERM`, fall back
  to `node --import tsx --test <files>`.
- No dev servers, no `next dev`.

## Hard rules (violating any = wrong implementation)

1. **No commits, no `git add`** (shared worktree).
2. **No new dependency.** `@line/bot-sdk`, `express`, `dotenv` from the prototype are NOT adopted.
3. **No new file** in `apps/api` — every change lands in the three source files and three spec files
   named below. (Docs/task memory updates are expected and welcome.)
4. **No schema change, no migration, no route change, no permission change.**
5. **Honest values only (plan D6).** Never hard-code `ทุกสาขา` or a menu count. The scope label derives
   from `scopes.branchIds`; the menu count is the number of Quick Reply items actually built.
6. **Safety copy survives (plan D7).** The receipt card must still say the capture becomes a pending
   review item and is not auto-approved / auto-paid.
7. **Bound every user-supplied string** you place in a bubble (reuse `boundedLabel`, `:50`) — a display
   name or role label is attacker-influenced text.
8. Ponytail full mode — read `.agents/skills/ponytail/SKILL.md` before code edits: shortest correct diff,
   existing patterns first, no speculative abstraction.

---

# Phases (P1 → P3, sequenced)

## P1 — Let a Flex message carry Quick Reply

Business intent: the receipt card cannot become a card until the type allows the buttons.

- In `line-reply.adapter.ts`, hoist `quickReply?: { items: LineQuickReplyItem[] }` so **both** variants of
  `LineReplyMessage` accept it (LINE accepts `quickReply` on any message type). Keep the union
  discriminated on `type` — existing narrowing at call sites and in specs must keep working.
- Nothing else in the adapter changes.

Verify: `pnpm --filter @watchdog-bms/api lint`.

## P2 — Greeting bubble + receipt card

> **Adjudication 2026-08-05 (Claude, after Codex objection — ACCEPTED).** The objection is right and the
> fault is this plan's: P2 changes `buildReceiptCapturePrompt`'s signature while the only existing caller
> is a spec file P3 owned, so the P2 lint gate was unreachable. Amendment, using the objection's own first
> alternative: **P2 may update the existing zero-argument call at `line-staff-menu.logic.spec.ts:71` as
> compile maintenance only** — pass the shared test context, change no assertion. All new receipt
> assertions still belong to P3. Everything else in P2/P3 is unchanged.
>
> Second amendment (Claude, reviewing the P2 diff): when `branchScopeLabel` is absent, **omit the
> `· ดูข้อมูลได้ …` segment entirely** instead of rendering the placeholder `ไม่ระบุขอบเขต`. Telling a user
> their data scope is "unspecified" is worse than not raising the subject; the line must degrade by
> dropping the clause, in both the bubble and `altText`. Add a P3 assertion for the omitted-clause case.
>
> **Third amendment — OWNER DECISION 2026-08-05, supersedes the second amendment. See P4.**

Business intent: the two screens the owner approved, built from real permission data.

**`StaffMenuContext` (`line-staff-menu.logic.ts:3-10`)** gains one optional field —
`branchScopeLabel?: string`. The call site computes it from `resolvedAccess.scopes.branchIds`:
absent/empty ⇒ `'ทุกสาขา'`, otherwise `'${n} สาขา'`. Do not invent branch names; do not add a query.

**`buildStaffMainMenu`** — keep the Quick Reply construction EXACTLY as is (same filters, same order,
same labels; the owner-only `🏢 บริษัทของฉัน` and the camera action stay). Change only the message body:

- Return `type: 'flex'` with a `kilo` bubble, white body, `paddingAll: '14px'`, `spacing: 'md'`.
- Line 1: `สวัสดีค่ะ ` + **bold** `<displayName>` + ` 👋` — one `text` block with `contents` spans
  (`{ type: 'span', text, weight: 'bold' }`), `wrap: true`.
- Line 2: `ตำแหน่ง ` + **bold** role + ` · ดูข้อมูลได้ ` + **bold** scope label + ` · เข้าถึง ` +
  **bold** `<n> เมนู`, where `n` is the number of Quick Reply items built above.
- Line 3: muted hint (`size: 'xs'`, `#667085`) telling the user the menu below shows only what their
  role can access — this replaces the sentence the old text message carried, so no information is lost.
- `altText`: the plain-text equivalent (roughly today's two lines), because notifications and desktop
  clients render altText only.
- `quickReply`: unchanged items.
- Apply `boundedLabel` to display name and role label.

**`buildReceiptCapturePrompt`** — now takes `context: StaffMenuContext` (update the call site at
`process-line-webhook.use-case.ts:788` to pass `menuContext`). Returns `type: 'flex'`, `kilo` bubble:

- Title `ถ่ายใบเสร็จเข้าระบบ`, bold, `md`.
- Body copy: what the old text said, kept — frame the whole receipt, the system reads it and saves a
  **pending-review** item, nothing is approved or paid automatically (hard rule 6).
- Image block `{ type: 'image', url, size: 'full', aspectRatio: '260:150', aspectMode: 'fit', margin: 'md' }`
  where `url = absoluteWebLink`-style join of `context.webBaseUrl` + `/assets/line/receipt-dropzone.png`.
  **If `webBaseUrl` is falsy, omit the image block entirely** (mirror `buildPendingApprovalCard`'s footer
  rule at `:138-145`). Do not import `absoluteWebLink` across the layer boundary — this is domain logic;
  a local trailing-slash trim is the smaller diff.
- `altText: 'ถ่ายใบเสร็จเข้าระบบ'`.
- `quickReply`: unchanged — `camera`, `cameraRoll`, `« เมนูหลัก`.

**Do not touch** `buildStaffQueryMenu`, `buildPendingApprovalCard`, `buildCompanyPickerMessage`,
`staffMenuCommand`, or anything outside `:772-792` in the webhook use-case.

Verify: `pnpm --filter @watchdog-bms/api lint`.

## P3 — Unit tests + preview parity

Extend these three **already-registered** spec files (no new spec file, see Environment quirks):

**`apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.spec.ts`**
- Greeting: `type === 'flex'`; `altText` contains the display name; the bold spans carry name, role
  label, scope label, and menu count; the count equals `quickReply.items.length`.
- Greeting scope label: `branchScopeLabel: 'ทุกสาขา'` vs `'2 สาขา'` renders what was passed — and the
  permission-filtered item list is byte-identical to today's expectations (**update the existing
  `type === 'text'` assertions at `:10`, `:13`, `:25`, `:31` to the flex shape; the label arrays at
  `:11`/`:14` must not change** — that is the regression guard proving the cosmetic change kept the
  permission filter intact).
- Greeting bounds a 200-char display name (no unbounded string reaches the bubble).
- Receipt card: `type === 'flex'`; contains the safety wording; image url is
  `https://app.example.com/assets/line/receipt-dropzone.png` for `webBaseUrl: 'https://app.example.com/'`
  (trailing slash trimmed, exactly one `/`); **no image block at all when `webBaseUrl` is undefined**;
  quick reply action types still `['camera', 'cameraRoll']` first (keep the existing assertion at `:70-74`).

**`apps/api/src/modules/line-ai/infrastructure/line-reply.adapter.spec.ts`**
- A flex message carrying `quickReply` serializes it at the message top level in the POST body
  (mirror the existing body-shape assertion at `:15-16`).

**`apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts`**
- `เมนูหลัก` delivers a `flex` message whose `altText` names the user (the harness already falls back to
  `altText` at `:169`/`:174`).
- `ถ่ายใบเสร็จ` delivers a `flex` message, not text.
- A member whose `resolveAccess` returns `scopes.branchIds` of length 2 sees `2 สาขา` in the greeting;
  a member with no branch restriction sees `ทุกสาขา`. (This is the test that proves D6 — the count comes
  from resolved access, not a constant.)
- Fix any existing assertion this change breaks; if an existing expectation contradicts the plan, that is
  an objection, not a silent edit.

**`scripts/line-oa/flex-preview.json`** — update `02_welcome` and `03_receipt_card` so the Flex Simulator
payloads match what the builders now emit (same spans, same image url shape with a placeholder host).
Leave `01_switched_user` and `04_receipt_result` untouched — `04` is the deferred follow-up
(plan §6) and stays as design reference.

Verify (all must pass, paste real output into task memory):
```
pnpm --filter @watchdog-bms/api lint
pnpm --filter @watchdog-bms/api test
```
If the full list is too slow to iterate on, use the targeted run first — but the full list is the gate:
```
node --import tsx --test \
  apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.spec.ts \
  apps/api/src/modules/line-ai/infrastructure/line-reply.adapter.spec.ts \
  apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts
```

## P4 — Owner decision 2026-08-05: the data scope must be REAL and ALWAYS STATED

The owner reviewed the shipped greeting and ruled on the scope clause. Both rulings override earlier
amendments; P1–P3 otherwise stand as merged.

1. **Real values, not a count.** `${n} สาขา` is a derived number, not the thing the user asked for. The
   greeting must name the actual branches the member can see, read from the database.
2. **Always stated.** The second amendment's "omit the clause when unknown" is withdrawn. The line always
   carries `· ดูข้อมูลได้ …`. There is no silent case.

These two are compatible only if every path produces an honest label — so the fallback ladder below is
part of the ruling, not an optimisation.

### Required change

**`StaffMenuContext.branchScopeLabel` becomes REQUIRED** (`branchScopeLabel: string`, drop the `?`). That
is what makes "always stated" a type error rather than a review catch. Delete the optional-branch code
paths in `buildStaffMainMenu` (the `scopeLabel ? […] : []` spread and the `altText` ternary) — the clause
is now unconditional. Delete the P3 test `omits the data-scope clause when no branch scope label is
available`; it asserts behaviour the owner has withdrawn.

**Resolve real branch names in `process-line-webhook.use-case.ts`** (replace the inline count expression
at `:777`). Add a small private helper on the use-case:

- `resolvedAccess.scopes.branchIds` empty/absent ⇒ `'ทุกสาขา'` (unrestricted is itself a real answer).
- Otherwise query **tenant-scoped**, mirroring `erp-dashboard-tools.use-case.ts:63-68`:
  `this.prisma.client.branch.findMany({ where: { companyId, id: { in: branchIds } }, select: { name: true }, orderBy: { createdAt: 'asc' }, take: 50 })`.
  The `companyId` predicate is mandatory — never trust the id list alone to keep the query in-tenant.
- Join up to **2** names with `' · '`; if more remain, append `` ` และอีก ${rest} สาขา` ``. Bound each name
  with the existing `boundedLabel` idiom so one long branch name cannot blow up the bubble.
- **Degradation ladder (never blank, never a lie):** names unavailable — zero rows returned, or the query
  throws — fall back to `${branchIds.length} สาขา`, which is still a true statement from resolved access.
  Log the failure at `warn` and do not let it break the menu reply; a greeting must not 500 because a
  branch lookup hiccuped.
- **Query only when needed:** compute the label only for `menuCommand === 'main'` (the only builder that
  renders it). Do not add a database round-trip to the query/approval/receipt menu paths. Pass
  `'ทุกสาขา'` for those paths, or restructure so the label is resolved inside the `main` branch — your
  choice, smallest diff wins.

### Tests (extend the same registered spec files — still no new spec file)

- `line-staff-menu.logic.spec.ts`: the clause is always present, including for a context whose label is
  the fallback count; the bold spans still read `[name, role, scope, count]`.
- `process-line-webhook.use-case.spec.ts`: a member scoped to 2 branches sees **both branch names** in the
  greeting `altText` (mock `branch.findMany`); a member scoped to 5 sees the first two plus
  `และอีก 3 สาขา`; an unrestricted member sees `ทุกสาขา`; a member whose branch lookup returns `[]` or
  rejects still gets a delivered greeting carrying `2 สาขา` (proves the ladder, proves no crash); and the
  non-`main` menu commands trigger **no** `branch.findMany` call.

Gates unchanged: `corepack pnpm --filter @watchdog-bms/api lint` and `corepack pnpm --filter @watchdog-bms/api test`.

### Not a change

The drop-zone PNG already lives in the Next.js app's public folder
(`apps/web/public/assets/line/receipt-dropzone.png`, served at `${webBaseUrl}/assets/line/…`), which is
what the owner asked for. Leave it exactly where it is.

## P5 — Owner decision 2026-08-05 (second): "แนบรูปใบเสร็จ", and the caption leaves the PNG

The owner reviewed the rendered card and changed the affordance: the receipt card is no longer about
*taking* a photo, it is about **attaching** one. Scope of the rewording, per the owner's explicit answer:
**the card and the image only.** Do NOT touch the main menu's `📷 ถ่ายใบเสร็จ` action, and do NOT touch
`staffMenuCommand` — people who type `ถ่ายใบเสร็จ` or tap an older Rich Menu must keep working.

**Already done by Claude, do not redo:** `apps/web/public/assets/line/receipt-dropzone.png` is regenerated
— paperclip icon instead of the camera, and **no baked-in text at all**. Text was removed from the PNG on
purpose: a caption baked into an image goes stale the moment the button label changes (which is exactly
what just happened), and Pillow cannot shape Thai vowels/tone marks without libraqm, which is not
installed here. `scripts/line-oa/make-dropzone.py` is updated to match and carries that rationale.

### Required change in `buildReceiptCapturePrompt`

- Title: `ถ่ายใบเสร็จเข้าระบบ` → **`แนบรูปใบเสร็จเข้าระบบ`**. `altText` follows the title.
- Body copy: reword from taking to attaching, e.g.
  `แนบรูปใบเสร็จให้เห็นข้อมูลครบทั้งใบ ส่งมาในแชทนี้ได้เลยค่ะ 🖼` — and keep the second line
  `ระบบจะบันทึกเป็นรายการรอตรวจสอบ ไม่อนุมัติหรือชำระเงินอัตโนมัติ` **verbatim** (hard rule 6 still binds).
- **New caption line below the image**, because it no longer lives in the PNG:
  `แตะปุ่ม "แนบรูปใบเสร็จ" ด้านล่าง` — `align: 'center'`, `size: 'xs'`, `weight: 'bold'`, color `#12B76A`,
  `margin: 'sm'`. Render it unconditionally; it refers to the Quick Reply button, not to the image, so it
  must still appear when `webBaseUrl` is missing and the image block is dropped.
- Quick Reply order changes so the primary affordance leads:
  1. `{ type: 'cameraRoll', label: '🖼 แนบรูปใบเสร็จ' }` — label must match the caption exactly.
  2. `{ type: 'camera', label: '📷 เปิดกล้อง' }` — kept; someone who still wants to shoot the receipt can.
  3. `« เมนูหลัก` — unchanged.

### Also in P5 — fix a latent falsehood found in Claude's P4 review

At the menu call site, non-`main` commands currently pass the literal `'ทุกสาขา'` into `menuContext`
purely to satisfy the required field. For a branch-restricted member that value is **false**. It is dead
data today (only `buildStaffMainMenu` reads it), which is exactly why it will be wrong silently the day
someone renders scope elsewhere. Replace it with a truthful no-query label: extract the ladder's lower
rung as a small helper — `branchIds?.length ? \`${branchIds.length} สาขา\` : 'ทุกสาขา'` — use it for the
non-`main` paths, and reuse it inside `resolveBranchScopeLabel` as its `fallback`. No new query on those
paths; Codex's existing "non-main commands trigger no `branch.findMany`" test must still pass.

### Tests

- `line-staff-menu.logic.spec.ts`: card title/copy say แนบ, not ถ่าย; the safety sentence is still present
  verbatim; the caption line is present **both** with and without `webBaseUrl`; Quick Reply action types
  are now `['cameraRoll', 'camera']` in that order and the first label matches the caption text.
- `process-line-webhook.use-case.spec.ts`: a branch-restricted member issuing a **non-main** menu command
  performs no `branch.findMany` (keep) — and add that the scope label handed to non-main builders is the
  count form, never `ทุกสาขา`, for a restricted member. Assert it wherever it is observable without
  contorting the test; if it is genuinely unobservable, cover the extracted helper directly instead and
  say so.
- `scripts/line-oa/flex-preview.json`: update `03_receipt_card` to the new title/copy/caption. The image
  block stays.

Gates unchanged. Do not regenerate or move the PNG.

## Definition of done

- [ ] Diff touches only: `line-reply.adapter.ts`, `line-staff-menu.logic.ts`,
      `process-line-webhook.use-case.ts` (call site only), the three spec files,
      `scripts/line-oa/flex-preview.json`, and docs/task memory.
- [ ] `apps/api/package.json` unchanged. No new dependency. No new API spec file.
- [ ] Both gates green, output recorded in `docs/agent-memory/line-oa-message-ui-parity.md`.
- [ ] Task memory updated: Status, Decisions (incl. any objection + outcome), Artifacts, Verification, Next.
- [ ] No commit, no `git add`.
