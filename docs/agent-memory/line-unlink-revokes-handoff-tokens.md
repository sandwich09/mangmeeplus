# Agent Memory: line-unlink-revokes-handoff-tokens

Status: Implemented on `codex/line-unlink-revokes-handoff-tokens`; typecheck + touched specs green;
pushed, no PR opened, not deployed.
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

## Residuals (not this change)

- `severOtherLineIdentities` sets `UNLINKED` but does **not** delete `LineCompanyContext` for the
  severed `providerUserId`, unlike the other two unlink paths. **Classified LOW this pass:**
  `process-line-webhook.use-case.ts` `resolveLineIdentity` (:2666-2679) matches on
  `status: 'ACTIVE'`, so a severed account resolves to no identity and the leftover row is dead
  weight until a relink overwrites it. Tidiness, not a live hole.
- The employee sever revokes **after** `externalIdentity.updateMany`, and the caller swallows
  failures (`.catch(() => undefined)`). If the revoke throws, the self-heal re-scan cannot retry it:
  `others` filters `status: 'ACTIVE'` and the identities are already `UNLINKED`, so it returns 0
  before reaching the loop. Exposure is a DB error in that gap leaving a bearer link alive for the
  rest of its ≤15 min TTL — and the exchange has **no** identity re-check to fall back on (it
  re-resolves user/membership/company only). Still strictly better than before, when 100 % of
  tokens survived. Fixing it means reordering sever-after-revoke, which costs audit honesty on the
  other failure branch; left for the Owner to call.
- No sweep exists to write `EXPIRED`; it is still lazy-at-read-time, as the spec says.

## Next

Owner review, then PR to `develop`. Nothing to un-park; no UAT/prod action.
