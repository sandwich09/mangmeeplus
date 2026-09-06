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
  `token_not_pending` — the same generic 403 (`line_handoff_unavailable`) a used token gets,
  refused before the claim, before any session, and before any surface side effect. Verified, not
  assumed.
- Audit reuses each path's existing row rather than adding an action: metadata gains
  `handoffTokensRevoked: <n>`.

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
- Docs: `docs/specs/line-web-deeplink-handoff-spec.md` §9 token lifecycle, dated 2026-09-06.

## Verification

- `pnpm --filter @watchdog-bms/api typecheck` — clean. (Needs `pnpm exec prisma generate` first in a
  fresh worktree, or `src/generated/prisma/client` is missing and ~30 unrelated script errors fire.)
- `pnpm exec tsx --test` over the five touched specs + `line-handoff.logic.spec.ts` — all pass.
- `node apps/api/scripts/check-di-metadata.mjs` — pass.
- `spec-suite-coverage.spec.ts` — pass.
- Mutation: helper body replaced with `return 0` → 4 specs red, one per severing path
  (unlink, partner unlink, employee sever, admin re-point); restored → green.
- The unlink spec's `lineWebHandoffToken.updateMany` fake really applies its `WHERE` to an
  in-memory row set, so a wrong filter fails rather than passing on a recorded call. It asserts
  `USED`/`EXPIRED` rows, another user's row on the same `lineUserId`, and the same user's row on a
  different `lineUserId` all stay `PENDING`.

## Residuals (not this change)

- `severOtherLineIdentities` sets `UNLINKED` but does **not** delete `LineCompanyContext` for the
  severed `providerUserId`, unlike the other two unlink paths. Same class of bug as the
  line-support-request-spec-th §2.5 fix, out of scope here.
- No sweep exists to write `EXPIRED`; it is still lazy-at-read-time, as the spec says.

## Next

Owner review, then PR to `develop`. Nothing to un-park; no UAT/prod action.
