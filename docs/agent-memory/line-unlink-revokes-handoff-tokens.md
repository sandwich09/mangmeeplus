# Agent Memory: line-unlink-revokes-handoff-tokens

Status: Implemented on `codex/line-unlink-revokes-handoff-tokens` (PR #464); typecheck + touched specs
green; pushed, not deployed. Follow-up `codex/line-handoff-exchange-identity-guard` (Owner "ทำ",
2026-09-06) closes both residuals and adds the exchange-side identity guard — see below.
Owner: Owner (decision 2026-09-06), delivered by agent session 2026-09-06.
Scope: P12-3b LINE → web deep-link handoff. `apps/api` auth + system-partner-management only. No
schema/migration, no `package.json`, no env, no deploy change.

## The defect

Review residual carried from the company-picker work ("unlink does not revoke PENDING handoff
tokens"), raised to a fix by the Owner: **"ยกเลิกผูก LINE ไม่ได้เพิกถอน token handoff ที่ค้าง แก้ได้เลย"**.

Unlinking a LINE identity set `ExternalIdentity.status = UNLINKED` and deleted the
`LineCompanyContext` row, but left every `PENDING` `LineWebHandoffToken` for that identity
exchangeable for the rest of its ≤ 15-minute TTL (`LINE_HANDOFF_TOKEN_TTL_MS`). Consequences:

- A link already sitting in the severed chat still minted a first-party web session for the
  unlinked user — the exchange re-resolves user/membership/company, and none of those change on an
  unlink, so every check passed.
- A picker-surface token re-created `LineCompanyContext` at exchange time, keyed on a `lineUserId`
  that may since have been relinked to a different person.

## Decisions

- One shared helper, `revokePendingLineHandoffTokens` in
  `apps/api/src/modules/auth/domain/logic/line-handoff.logic.ts`, mirroring the narrow-delegate
  shape of `session-revocation.logic.ts` in the same folder (plain function, no DI, no module or
  `check-di-metadata` change; usable with `prisma.client` or a transaction client).
- Real `REVOKED` status — it was **already** a value of `LineWebHandoffTokenStatus`, only never
  written, so **no migration** and no `expiresAt` fudge was needed.
- Matched on `lineUserId` **AND** `userId`, both of which are on the row. Matching one column
  would either resurrect a previous holder's links after a relink or reach into the new holder's.
- No exchange change. Its step-2 `status !== 'PENDING'` check already refuses a `REVOKED` row as
  `token_not_pending` — the same generic 403 (`line_handoff_unavailable`) a used token gets, and it
  refuses **before the claim**, therefore before the session and before the step-4b
  `company_picker_open_web` context switch that PR #460 added. Verified against the merged code,
  not assumed; the spec asserts it with a picker-surface row.
- Audit reuses each path's existing row rather than adding an action: metadata gains
  `handoffLinksRevoked: <n>`.

## Severing paths covered (all four)

| Path | File | What was done |
| --- | --- | --- |
| Self-serve unlink | `auth/application/use-cases/unlink-line-identity.use-case.ts` | Identity update + context delete + revoke wrapped in one interactive `$transaction` (they were bare sequential awaits before); `AUTH_IDENTITY_UNLINK` metadata gains the count. |
| Admin partner unlink | `system-partner-management/application/use-cases/partner-member-line-unlink.use-case.ts` | Array `$transaction([...])` → interactive, because the audit row must report a count the revoke produces; `system.partner_member.line_unlink` metadata gains the count. |
| Employee relink sever | `auth/application/use-cases/complete-employee-line-link.use-case.ts` (`severOtherLineIdentities`) | Revoke per severed identity, awaited so the count is real; the per-identity `AUTH_IDENTITY_UNLINK` metadata gains the count. Stays outside a transaction, as the existing best-effort sever already is. |
| Re-point to another user | `auth/application/use-cases/link-line-identity.use-case.ts` | One call placed **before** the branch, inside the existing advisory-lock transaction, guarded on `existing.userId !== userId`. Covers both re-point branches (ACTIVE + `allowReassign`, and UNLINKED reactivation for a different user); a refusal below it (`line_linked_elsewhere`, disabled) rolls the revoke back with everything else. |

Checked and deliberately **not** changed:

- `system-onboarding/.../create-company-onboarding.use-case.ts` re-points an already-`UNLINKED`
  row, so the previous holder's tokens were revoked by whichever path severed it — the three
  `UNLINKED` writers above are the only ones. Transitively covered.
- `auth/application/use-cases/account-merge.use-case.ts` only **reads** `externalIdentity` (for the
  "signInWith" summary). It severs nothing.

## Open questions

None. No owner input pending.

## Artifacts

- Code: the four use cases above + `line-handoff.logic.ts`.
- Specs (all four already wired into `apps/api` `package.json` `test`, so **no `package.json`
  edit** and `spec-suite-coverage.spec.ts` stays green):
  `auth/line-linking.spec.ts`, `auth/line-handoff.spec.ts`,
  `auth/application/use-cases/complete-employee-line-link.use-case.spec.ts`,
  `system-partner-management/application/use-cases/partner-member-console.use-cases.spec.ts`.
- Docs: `docs/specs/line-web-deeplink-handoff-spec.md` §9 token lifecycle, dated 2026-09-06;
  `docs/agent-memory/line-company-picker-open-web.md` residual struck through and marked CLOSED.
- Branch cut from `origin/develop` at `5dabcf16`, then merged (never rebased) with `origin/develop`
  at `0e205867`, which brought PR #460 in. That merge is what made the picker-surface assertion
  real: `LineCompanyContext` upsert at exchange did not exist at cut time.

## Verification

- `pnpm --filter @watchdog-bms/api typecheck` — clean. (Needs `pnpm exec prisma generate` first in a
  fresh worktree, or `src/generated/prisma/client` is missing and ~30 unrelated script errors fire.)
- `pnpm exec tsx --test` over the five touched specs + `line-handoff.logic.spec.ts` — all pass.
- `node apps/api/scripts/check-di-metadata.mjs` — pass.
- `spec-suite-coverage.spec.ts` — pass.
- Mutation: helper body `return count` → `return 0` reds **3** leaf subtests (employee sever,
  self-serve unlink, partner unlink); restored → green. It cannot red the re-point specs or
  `reports zero revoked`, which assert the `WHERE` or a zero — the count is all it perturbs.
- Mutation: re-point `userId: existing.userId` → `userId` (the new caller) reds 2 subtests. This is
  the one that matters — with the caller's id the revoke matches nothing and the hazard survives.
- The unlink spec's `lineWebHandoffToken.updateMany` fake really applies its `WHERE` to an
  in-memory row set, so a wrong filter fails rather than passing on a recorded call. It asserts
  `USED`/`EXPIRED` rows, another user's row on the same `lineUserId`, and the same user's row on a
  different `lineUserId` all stay `PENDING`.

## Adversarial review 2026-09-06 (second session)

One real defect found and fixed on the branch:

- **The audit key was being redacted.** `audit.service.ts` `SENSITIVE_METADATA_KEY` is a
  **substring** match that includes `token`, so `handoffTokensRevoked` reached every row as
  `"[REDACTED]"` — the count the whole audit claim rests on. It hit the two paths that go through
  `AuditService.log` (self-serve unlink, employee sever) but **not** the partner unlink, which
  writes `tx.auditLog.create` directly: the three paths disagreed with each other in production.
  Every spec asserting the key used a fake audit that captures the entry *before* `prepare()`
  sanitizes, so nothing could catch it. Fixed by renaming the key to `handoffLinksRevoked`
  (9 sites + both docs); the shared regex is deliberately broad and was left alone. Regression
  guard added to `audit/audit.service.spec.ts`, which exercises the real sanitizer — renaming the
  key back to anything containing `token` reds it.

Verified clean, no change needed:

- Re-point uses the **old** owner's `existing.userId` (`link-line-identity.use-case.ts:84-85`),
  inside the pre-existing advisory-lock transaction (`{maxWait: 5_000, timeout: 20_000}`).
- Both `userId` and `lineUserId` are non-nullable on `LineWebHandoffToken`, and the single minter
  (`mint-line-handoff-token.use-case.ts:42-53`) always writes both — no surface escapes the match.
- All three interactive `$transaction` callbacks use `tx` for every write and keep non-DB I/O out;
  the partner path's `auditLog.create` was already inside the array form, so the 5 s default budget
  is unchanged. Employee sever correctly uses `prisma.client` — it has no transaction.
- Exchange refuses `REVOKED` at step 2 (`exchange-line-handoff-token.use-case.ts:65`), before the
  claim (:87), the picker context upsert (:98) and `issueToken` (:106); same generic 403 body as
  expired/used, no oracle. The claim is a conditional `updateMany({status:'PENDING'}) + count===0`
  (:87-91), so the unlink/exchange race is safe either way it lands.
- No pinned file touched: `sync-production-maintenance-release-pins.mjs` → `status=current`, tree
  clean.

## Residuals

- ~~`severOtherLineIdentities` sets `UNLINKED` but does not delete `LineCompanyContext`.~~ **CLOSED
  2026-09-06** (Owner: "ทำ") on `codex/line-handoff-exchange-identity-guard`: the delete now runs
  inside the sever's transaction, the same one-liner the other two paths use, so all three sever
  paths leave identical state.
- ~~The employee sever revokes AFTER `externalIdentity.updateMany` and a failed revoke can never be
  retried (the self-heal re-scan filters `status: ACTIVE`).~~ **CLOSED 2026-09-06** (Owner: "ทำ") on
  the same branch: the `UNLINKED` write, the context delete and the revoke run in ONE interactive
  `$transaction` per severed identity. `severOtherLineIdentities` has **no outer transaction** — it
  is called twice from `execute` on `prisma.client`, never inside one — so it opens its own; Prisma
  cannot nest interactive transactions, so this was checked before writing it. The audit stays
  outside the transaction, exactly as `unlink-line-identity.use-case.ts` does (it goes through
  `AuditService`, not `tx.auditLog.create`). Reordering sever-after-revoke was **not** needed: the
  transaction removes the failure gap without costing audit honesty on either branch.
- No sweep exists to write `EXPIRED`; it is still lazy-at-read-time, as the spec says.

## Follow-up branch: `codex/line-handoff-exchange-identity-guard` (2026-09-06)

Owner decision "ทำ", two items on one branch, cut from `origin/develop` `0e205867` and fast-forward
merged with this branch at `173ffcdc` (plain merge, never rebased).

1. **Exchange identity guard (defence in depth).** The revoke above is the primary control, but it
   is one `UPDATE` that can fail, and it cannot see a re-point. `exchange-line-handoff-token.use-case.ts`
   step 3 now takes a fourth parallel read: `externalIdentity.findFirst({ userId: record.userId,
   provider: 'LINE', providerUserId: record.lineUserId, status: 'ACTIVE' })`, refusing
   `line_identity_severed` when it misses. Folding `userId` into the WHERE answers both conditions
   ("an ACTIVE identity exists" AND "it is still this user's") in one indexed lookup
   (`@@index([userId, provider, status])`) and gives both failure modes one reason. Channel-agnostic:
   the token row has no channel column, so this is `resolveLineIdentity`'s fallback branch. Placed
   in the existing `Promise.all`, so no extra round trip and no state write before the claim —
   before the `USED` flip, before the #460 `LineCompanyContext` upsert, before `issueToken`. Outward
   result is byte-identical to a used token (`line_handoff_unavailable`, same message, same
   `targetPath` echo), so `/l/[token]/route.ts` — which branches on `!apiRes.ok`, never on a reason —
   still lands on `/login?line=handoff-expired&next=<target>`. No controller mapping exists to
   extend; the route needed no change.
2. **Atomic employee sever**, as recorded under Residuals.

### Verification (this branch)

- Red first: 7 leaf subtests (5 in `line-handoff.spec.ts`, 2 in
  `complete-employee-line-link.use-case.spec.ts`); green after: **105/105** across
  `line-handoff.spec.ts`, `complete-employee-line-link.use-case.spec.ts`, `line-linking.spec.ts`,
  `link-line-identity.use-case.spec.ts`, `partner-member-console.use-cases.spec.ts`,
  `spec-suite-coverage.spec.ts`.
- Mutations, all restored: remove the identity guard → **4** exchange subtests red; move the guard
  to after the claim → **1** red (the "writes nothing" test, which is the whole point of the
  placement); drop the `$transaction` around the sever → **4** employee subtests red, including
  "leaves the identity ACTIVE when the handoff revoke fails".
- The exchange fake applies its `WHERE` for real, so dropping `status`, `providerUserId` or `userId`
  from the guard's query fails rather than passing on an unread call. The employee fake's
  `$transaction` restores an identity-row snapshot on throw, which is what makes "severed but not
  revoked" distinguishable from "neither".
- `pnpm --filter @watchdog-bms/api typecheck` clean; `check-di-metadata.mjs` pass (no DI change, so
  `auth.module.ts` — a pinned file — was not touched); `sync-production-maintenance-release-pins.mjs`
  → `status=current`, `git status --porcelain` shows only the four intended files plus these docs.

## Next

Owner review of both branches, then PRs to `develop` (#464 first, the follow-up merges it).
Nothing to un-park; no UAT/prod action.
