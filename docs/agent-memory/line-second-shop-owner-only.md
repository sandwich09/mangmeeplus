# Agent Memory: เปิดร้านใหม่ is owner-only on the บริษัทของฉัน card

Status: Implemented and pushed on `codex/line-second-shop-owner-only` (cut from `origin/develop` at
`a4ef867b`). No PR opened (Owner instruction). Not deployed.
Owner: MangmeeDev
Scope: One role gate on the `/companies` card, plus the one sentence that replaces the button in the
employee view. Continues `docs/agent-memory/line-second-shop-button-auto-free-uat.md` (the button)
and `docs/agent-memory/line-pending-shop-hint.md` (the 🕒 line), and closes the item that review left
open there: *"`newShopSignupUrl()` is not role-gated on develop either — a STAFF member who types
`/companies` gets the door wherever signup is open. Whether an employee may open a shop of their own
is a product call, unchanged here."*

## Owner decision (2026-09-06, verbatim)

> "ปุ่มเปิดร้านใหม่โผล่ให้ STAFF ผ่าน /companies => staff ไม่ควรเห็น ถ้าเขาจะเปิดร้านเองต้องผ่าน promotion
> หากอยู่ในมุมมองพนักงาน"

## Decisions

- **Gate on the role KEY, scoped to the ONE membership the card is about.** `isCompanyOwner`
  (`process-line-webhook.use-case.ts`, next to `companyRoleLabels`) reads
  `membership.roles[].role.key === 'OWNER'` — the same key `access.roles.includes('OWNER')` and the
  two `roles: { some: { role: { key: 'OWNER' } } }` Prisma filters in this file already use.
  `companyRoleLabels` renders `role.name`, which a company can rename to anything, so the labels the
  card prints could never be the gate. `listLineCompanies` already selects `key`, so the gate costs
  zero extra reads.
  Scoping to that one membership is what makes *"หากอยู่ในมุมมองพนักงาน"* true: someone who owns
  their own shop and works at another sees the door on their own card and the pointer on their
  employer's. Asserted for a multi-role membership too — `ACCOUNTANT` + `OWNER` in the same company
  is still an owner of it.
- **`isOwner?: boolean` on `CompanyContextCard`, absent meaning employee.** One new optional field,
  matching `StaffMenuContext.isOwner` two types up in the same file rather than inventing a new
  shape. It fails closed on purpose: a future caller that forgets the flag withholds the door instead
  of opening it to everyone, which is the defect being fixed. There is exactly one call site.
- **Two states needed one bit, not two.** `newShopSignupUrl` keeps its existing meaning ("this
  environment opens a door") and `isOwner` says who may walk through it, so
  `EXTERNAL_SIGNUP_ENABLED=false` still passes `undefined` and still renders today's card.
- **The employee line replaces the button, and only where a button would have been.** `door` is
  computed once (`newShopSignupUrl` set AND no open application) and both branches read it, so the
  card carries the footer button, or the pointer line, or neither — never both:
  - environment with signup closed (production today) → byte-identical card for owner and employee
    alike. There is no door to replace, so there is nothing to point at, and inventing a pointer
    there would advertise a route the LIFF form itself refuses.
  - an open application (`OPEN_LINE_SIGNUP_STATES`) → the 🕒 line only, for owner and employee both.
    The partial unique index can answer a second application only with `line_signup_already_pending`,
    so neither the door nor an invitation to go find one may sit on top of it.
- **Copy:** `💡 อยากเปิดร้านของตัวเอง กดปุ่ม โปรโมชั่น ในเมนูได้เลยค่ะ`. The Owner's wording, with a
  leading emoji because every other body line on this card has one (🏢 👤 💼 🕒), and with
  "โปรโมชั่น" interpolated from `VIEW_PACKAGES_COMMAND` — the constant the tile label and the command
  matcher both read, so the sentence cannot send an employee to words that stopped working. No URL,
  (Review 2026-09-06: that claim was NOT true when it was written. `staffMenuCommand` re-typed
  `'โปรโมชั่น'` as a literal — the only constant-backed command in the file that did — so renaming the
  constant would have changed this sentence while the matcher kept answering the old word only.
  Fixed in the same branch: the matcher now reads `VIEW_PACKAGES_COMMAND`, and the existing
  "matches every command it publishes" case reads it too, so a rename is now caught.)
  no LIFF id, no id of any kind (LINE-ONBOARD-01); no `+` character (spec §3). It is a constant, so
  no scrubbing is required — `scrubRecordText` still guards the one customer-supplied value on this
  card (`pendingSignupName`), unchanged.
- **Not in `altText`.** The 🕒 line goes to altText because the chat list is where "my shop vanished"
  was decided. This one is a pointer the reader sees when they open the card, not news about their
  own request, and putting a promotion nudge in every employee's chat-list preview is noise.
- **`buildPromotionCard` and its URLs untouched** (Owner design 2026-08-27); the stranger door card
  (`line-business-card.logic.ts`) untouched.

## Promotion route for a linked employee — traced, and it does NOT reach a signup form

Reported to the Owner, not fixed here (the brief forbade widening anything, and §3.1.1 pins
`buildPromotionCard` as untouched). Verified on this branch:

- **The promotion card carries no signup link.** `buildPromotionCard`
  (`line-staff-menu.logic.ts:262-290`) has exactly two URIs, both
  `https://official.mangmeeplus.com/` (`:274` hero, `:282` "ทดลองใช้ฟรี"), plus two message actions:
  `ขอเปลี่ยนแพ็กเกจ` and `ติดต่อเรา`. The rich-menu runbook pins the same fact —
  `docs/runbooks/line-rich-menu-v2-console-setup.md:142-143`: the Promotion tile's ทดลองใช้ฟรี
  "opens only `https://official.mangmeeplus.com/`".
- **Its one interactive button refuses an employee outright.** `ขอเปลี่ยนแพ็กเกจ` →
  `process-line-webhook.use-case.ts:2198-2212`: it requires an `OWNER` membership
  (`roles: { some: { role: { key: 'OWNER' } } }`) and otherwise replies
  `PACKAGE_CHANGE_NOT_OWNER_REPLY` (`:237-238`, "การเปลี่ยนแพ็กเกจต้องให้เจ้าของร้านเป็นคนขอนะคะ") with
  `package_change_denied` / `FORBIDDEN`. It changes the *employer's* package anyway — it was never a
  way to open a shop.
- **Only two places in the API emit a `/signup` LIFF URL,** and both are now closed to a linked
  employee: the stranger door card (`line-business-card.logic.ts:373`, delivered only on the
  unlinked branch at `process-line-webhook.use-case.ts:2788`) and `newShopSignupUrl()` (`:1828`),
  whose only consumer is the card this change just gated.

So the sentence this change ships points at a route that stops one hop short. It is still the right
sentence to ship — it takes the employee to a human ("คุยกับทีมงาน" on that same card) instead of a
form the product has not decided they may use — but the Owner should know it is a pointer, not a
door. The runbook already records the one-line way to make it a door if that is what is wanted:
`docs/runbooks/line-rich-menu-v2-console-setup.md:182-185` — "**Re-point the Promotion tile** …
Changing THAT button to the LIFF URL above is a card-copy change in `buildPromotionCard`".

**What the backend would do if an employee did reach the form** (by a saved link, or if the tile were
re-pointed) — nothing stops them, and the result is not what "พนักงาน" suggests:

- `resolveLineIdentity` (`submit-line-signup.use-case.ts:291-314`) reads only
  `ExternalIdentity.status`, `userId` and `user.status`. **No role, no membership.** A linked staff
  account is ACTIVE, so `attachUserId` is set and the submit is treated as an existing owner adding
  a second shop; `create-company-onboarding.use-case.ts` then creates the ACTIVE membership and the
  `OWNER` `MembershipRole` unconditionally. The employee becomes **OWNER of a brand-new company**.
- They are **not** a repeat trial: `hasOwnedCompany` (`:326`) filters on `OWNED_COMPANY_MEMBERSHIP`
  (`external-signup/domain/company-signup.logic.ts:255-258`), which requires an `OWNER` role
  precisely so an employee's membership in their employer's shop does not count (review B1, comment
  at `:247-248`). So under `LINE_SIGNUP_APPROVAL_MODE=AUTO_FREE` — UAT today — the submit
  **auto-approves and provisions inline**, no queue, no admin ever sees it. Under `MANUAL`
  (production today) it queues.
- Two consequences worth an Owner decision, both pre-existing and out of scope here:
  1. `provision-signup.use-case.ts` upserts `LineCompanyContext` to the new company, so the employee's
     LINE conversation — and their next receipt photo — **silently moves off their employer's shop**.
  2. The LIFF "done" copy branches on `existingAccount` (`= attachUserId !== null`,
     `submit-line-signup.use-case.ts:121`, `:132`), not on the returned `state`, so
     `liff-page.security.ts:607-611` tells an auto-approved applicant to wait for approval of a shop
     that is already live.

## Open questions

- **Owner call: is the โปรโมชั่น pointer meant to become a real door?** Today it is not one (above).
  Options are the runbook's: re-point the card's ทดลองใช้ฟรี button at the LIFF URL, or leave
  "คุยกับทีมงาน" as the deliberate human step for an employee who wants their own shop.
- Whether an employee in an environment with signup **closed** should still see the pointer. This
  branch says no (nothing to replace). Reverse it by dropping `door &&` from `promotionLine`.

## Artifacts

- `apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.ts` (+ `.spec.ts`)
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts` (+ `.spec.ts`)
- `docs/specs/mangmee-line-first-signup-spec-th.md` §3.1.1 (new delta, dated 2026-09-06)

## Verification

Red first, on the branch with the specs but before the implementation hunks:

- `line-staff-menu.logic.spec.ts` — 45 tests, 44 pass, **1 fail**
  (`withholds เปิดร้านใหม่ from the employee view and names the โปรโมชั่น route instead`)
- `process-line-webhook.use-case.spec.ts` — 209 tests, 208 pass, **1 fail**
  (`hides เปิดร้านใหม่ from an employee of the current company and points at โปรโมชั่น instead`)

Exactly one case each, which is the point: the OWNER, pending-signup and signup-closed cases were
already green and had to stay green through the change.

Green after:

- `line-staff-menu.logic.spec.ts` — 45/45
- `process-line-webhook.use-case.spec.ts` — 209/209
- `line-first-signup-webhook.spec.ts` — 67/67
- `line-intake-dispatch.use-case.spec.ts` — 183/183
- `spec-suite-coverage.spec.ts` — 3/3
- `node apps/api/scripts/check-di-metadata.mjs` — 795 files, 870 decorated classes, 820 with
  constructor dependencies, all carry `design:paramtypes`
- `pnpm --filter @watchdog-bms/api typecheck` — clean (exit 0)
- `git diff --check` clean; no `package.json` touched

Mutations (each restored):

- Card gate removed (`door && context.isOwner` → `door`) — logic spec 45 tests, 44 pass, **1 fail**,
  the employee case.
- Source gate removed (`isCompanyOwner` → `return true`) — use-case spec 209 tests, 208 pass,
  **1 fail**, the employee case.

## Next

- Owner reviews the copy. It rides the next UAT deploy with no flag and no config of its own; the
  gate is live wherever the button already was, which today is UAT only
  (`EXTERNAL_SIGNUP_ENABLED=true`) — production has no door and is unchanged.
- UAT journey to re-run: `/companies` as an OWNER (button present), then as a STAFF member of the
  same company (no button, the 💡 line), then as an OWNER with an application still open (🕒 only).
