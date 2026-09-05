# Agent Memory: line-signup-stale-identity

Status: Implemented on `codex/line-signup-stale-identity`; gates green; no PR opened.
Owner: Owner (product decisions 2026-09-05), delivered by agent session 2026-09-05.
Scope: P10-L LINE-first signup. `apps/api` external-signup + system-onboarding + LIFF page,
`packages/contracts` queue DTO, `apps/web` signup queue chips and error copy.

## The defect

UAT request `cmto4xtrx002r4o5tf7o38dls` (409 twice, PROVISIONING_FAILED, ~40 ms).

`submit-line-signup.use-case.ts` looked the LINE identity up with `status: 'ACTIVE'` and
`user.status ACTIVE`. The unique key `(provider, providerChannelId, providerUserId)` is owned by
the row whatever its status, so an owner who had unlinked was invisible to submit
(`existingAccount: false`) and fatal to provisioning: `create-company-onboarding.use-case.ts` ran
`tx.externalIdentity.create(...)`, Postgres raised P2002, the global filter answered a generic 409
"Duplicate value", and every admin retry repeated it.

## Decisions

- Submit reads the identity slot with NO status filter and decides in this order, failing closed:
  - identity ACTIVE + user ACTIVE → attach (unchanged);
  - identity ACTIVE + user SUSPENDED/DISABLED → 409 `line_signup_account_blocked`, no request row;
  - identity UNLINKED → a NEW account, and provisioning re-points the stale row;
  - identity DISABLED → 409 `line_signup_identity_disabled`, no request row;
  - any other status → `line_signup_account_blocked`.
- NO migration. Nothing is recorded on the request: provisioning looks the stale row up itself
  under the same unique key, which is the only place that can be right at the moment it writes.
- Onboarding re-points an UNLINKED row (`userId`, `status: ACTIVE`, `linkedAt: now` — the model has
  no unlink timestamp to clear) and writes an `auth.identity.repointed` audit row naming
  `previousUserId`. ACTIVE/DISABLED throw named `ConflictException`s
  (`line_identity_already_linked` / `line_identity_disabled`); a P2002 from the concurrent-insert
  race maps to the first of those rather than escaping.
- `failureCodeOf` in `provision-signup.use-case.ts` needed NO change: a `ConflictException('x')`
  carries `x` as its `message`, so the named codes reach `failureCode` verbatim. Proven by test.
- Owner 2026-09-05 (a): re-pointing reactivates NOTHING. The old company keeps its status,
  memberships, plan term; the old user keeps their status. `LineCompanyContext` is overwritten to
  the new company by the trial guards that already run, so the chat resolves to the new shop.
- Owner 2026-09-05 (b): the queue shows a repeat-trial hint —
  `LINE นี้เคยมีร้าน: <ชื่อ> (ปิดอยู่/หมดอายุ/ใช้งานอยู่)`. Additive DTO fields
  `priorCompanyName` / `priorCompanyState`, batched lookup, advisory only.
  EXPIRED vs CLOSED uses the same pair the LINE assistant uses: `company.status !== ACTIVE` plus
  `planTerm.termDisabledAt`.
- Owner 2026-09-05 (c): AUTO_FREE never auto-provisions a repeat trial. It falls back to
  PENDING_REVIEW exactly like the daily cap, with audit `signup.line.auto_approve_repeat_trial`
  and `metadataJson.reason = 'repeat_trial_manual_review'`.

### Review round 2 (2026-09-05)

- B1: "already had a shop" counts **OWNER memberships only**, in both readers. An employee whose
  LINE was linked by the staff QR holds a membership in their EMPLOYER's shop; counting it flagged
  their own first shop as a repeat trial and named a company that was never theirs. Predicate is
  the one already used in `provision-signup.use-case.ts` and `process-line-webhook.use-case.ts`.
- B2 (policy, fail closed): the user-status guard now runs for EVERY identity status and BEFORE
  the UNLINKED branch. Previously a SUSPENDED owner could unlink, re-apply and reach COMPLETED
  with a fresh account — contradicting the playbook. Only an UNLINKED identity whose old user is
  ACTIVE may open a new account.
- B3 (defence in depth): the re-point takes `pg_advisory_xact_lock(hashtextextended(
  'line-identity:<channel>:<providerUserId>', 0))` at the top of the `lineOwner && !attach` block
  and re-reads inside the lock. Not reachable today (the open-application index and the claim lock
  both stand in the way), but the read-then-update was unguarded and the loser's shop would have
  been left standing with no way in.
- N4: `LineCompanyContext.aiPausedUntil` is cleared in the trial-guard upsert. It is the §8
  "ติดต่อเจ้าหน้าที่" hold on the PREVIOUS owner's conversation, and a re-pointed LINE account
  would otherwise open its new shop with the assistant silently switched off.
  `profileGuardNudgedAt` was checked and is NOT on this model — it lives on
  `CompanySignupRequest`, which is a fresh row per application, so there is nothing to clear.
- Nit: the repeat-trial lookup now runs inside `list()`'s existing `Promise.all`.
- CI: the `typecheck-and-test` job DOES have a Postgres service, but none of the three
  `*_TEST_DATABASE_URL` pg specs ever ran there. They now do, from a `watchdog_bms` database built
  by `prisma migrate deploy` + `prisma/sync-permissions.ts` (a full `seed.ts` is demo data this
  does not need — proved on a clean container). ONE INVOCATION EACH, deliberately: the runner
  interleaves spec files and the account-profile and employee-access specs seed usernames that
  collide under the `lower(username)` unique index — reproduced, then fixed by sequencing.
  `ci.yml` is not in the maintenance pin list (`--check` still reports `status=current`).
- `resolveCompanyForLineUser` in `process-line-webhook.use-case.ts` was exported (one keyword, no
  behaviour change) so the pg spec asserts chat resolution against the real resolver, not a copy.
- The LIFF page is API-served HTML, so the two submit codes are mapped in the page script's own
  copy (support phone 098-256-5628, contact@mangmeeplus.com), NOT in web `CODE_LABELS`. The two
  PROVISIONING codes ARE in `CODE_LABELS`, because the admin toast reads them.

### Review round 3 (2026-09-05) — sweep around the change

- MED-1 (cross-flow race): `link-line-identity.use-case.ts` re-points the SAME UNLINKED row from a
  flow an owner can trigger at will, and did it with an unlocked read-then-update. Its UPDATE
  waited on the row lock and then overwrote a just-committed re-point from onboarding, taking the
  LINE credential off the owner of the shop that had just been built. Both sites now decide inside
  one transaction holding `pg_advisory_xact_lock(hashtextextended(<key>, 0))` and RE-READ inside
  the lock. The key comes from ONE builder, `common/database/line-identity-lock.ts`
  (`lineIdentityLockKey`) — a divergent literal is a lock that locks nothing, and nothing would
  fail until the day it mattered. Keyed on the canonical channel: the only channel either writer
  creates rows on, so the link's legacy-channel fallback cannot collide with provisioning.
- MED-2: the link path clears `LineCompanyContext.aiPausedUntil`. It can move a severed LINE
  account to a DIFFERENT user, so the previous owner's support hold would otherwise silence the
  assistant in somebody else's shop. The third site — the chat's own company switcher at
  `process-line-webhook.use-case.ts` — KEEPS the pause on purpose and now says why in one line:
  the same person switching between their own shops mid-conversation is not asking for the thread
  back.
- LOW-1: reverted the `apps/api/package.json` `scripts.test` addition. `spec-suite-coverage.spec.ts`
  exempts `*.pg.spec.ts` (`NEEDS_DATABASE`), so the wiring meta-test never wanted it, and AGENTS.md
  forbids non-dependency `package.json` edits. `package.json` is now byte-identical to
  origin/develop; the explicit CI step is the spec's only runner, and `pnpm test` no longer names it.
- LOW-4 (repeat-trial intent): both readers now share ONE predicate,
  `OWNED_COMPANY_MEMBERSHIP` in `domain/company-signup.logic.ts` — OWNER role, and NOT DRAFT.
  **Onboarding creates the owner membership `status: 'ACTIVE'` inside the company transaction**, at
  creation and not at completion, so a shop that really opened never sits in DRAFT; DRAFT only ever
  means an employee draft (`create-employee.use-case.ts`) that nobody finished, and those carry
  roles. INVITED/SUSPENDED/DISABLED still count — those shops existed.
- Item 5 (queue vs chat "expired"): the queue now uses the assistant's exact pair — company
  `DISABLED` **and** `planTerm.termDisabledAt` — instead of the stamp alone. A SUSPENDED shop read
  as "หมดอายุ" before, so an operator would offer a renewal for a suspension only an admin can lift.
  The unreachable "unknown identity status" branch stays as the fail-closed default; the comment no
  longer claims it is a case anything can produce.
- `liff-page.security.ts` deliberately untouched in this round — the LIFF UX branch is rewriting it.

## Artifacts

- `apps/api/src/modules/external-signup/application/submit-line-signup.use-case.ts`
- `apps/api/src/modules/system-onboarding/application/use-cases/create-company-onboarding.use-case.ts`
- `apps/api/src/modules/external-signup/application/signup-admin-queue.use-case.ts`
- `apps/api/src/common/security/liff-page.security.ts`
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts` (export only)
- `packages/contracts/src/external-signup.ts`
- `apps/web/src/features/system-signup-requests/signup-queue.logic.ts`, `SignupQueuePage.tsx`
- `apps/web/src/common/api/api-error-message.ts`
- `apps/api/src/common/database/line-identity-lock.ts` (new; the one lock-key builder)
- `apps/api/src/modules/auth/application/use-cases/link-line-identity.use-case.ts`
- `apps/api/src/modules/external-signup/line-signup-stale-identity.pg.spec.ts` (new; run ONLY by the
  explicit CI step — `package.json` is untouched)
- `docs/runbooks/line-first-signup-support-playbook.md` (support entry)
- `.github/workflows/ci.yml` (the three pg specs now run in `typecheck-and-test`)

## Verification

- api fixed list: pretest 30 tests / 16 pass / 0 fail / 14 skipped; test 6477 tests / 6378 pass /
  0 fail / 99 skipped. The new pg spec is NOT in that list any more (LOW-1) — it runs from the CI
  step, and `pnpm test` no longer names it.
- pg spec against local docker (`postgresql://…@127.0.0.1:15432/watchdog_bms`): 7/7 pass; the
  database row counts are identical before and after, so cleanup is complete.
- pg spec on a CLEAN container (`migrate deploy` + `sync-permissions`, nothing else) passed at the
  round-2 head, and the other two `*_TEST_DATABASE_URL` specs pass beside it when each is its own
  invocation. Run together they fail on `lower(username)` — which is why the CI step sequences them.
- `pnpm --filter @watchdog-bms/web test` — 1478 tests, 1478 pass, 0 fail, 0 skipped.
- `pnpm --filter @watchdog-bms/web build` — exit 0.
- `pnpm -r typecheck` green (api `tsc --noEmit` needs `NODE_OPTIONS=--max-old-space-size=8192`
  locally; it OOMs at the 4 GB default on this machine).
- `prisma validate` green. `sync-production-maintenance-release-pins.mjs --check` current.
- Mutation table (each mutation applied alone, then reverted):

  | Mutation | Result |
  | --- | --- |
  | Restore `status: 'ACTIVE', user: { status: 'ACTIVE' }` in the submit lookup | 6 failures: pg spec 3/3, `submit-line-signup.use-case.spec.ts` "reads the identity slot without a status filter", integration spec's two submit refusals |
  | Restore the bare `tx.externalIdentity.create(...)` in onboarding | 8 failures: pg spec 3/5, onboarding spec's three identity tests, integration spec's two re-point tests |
  | B1 — count ANY membership again in both readers | 3 failures: submit unit employee case, queue unit employer-shop case, pg employee case |
  | B2 — move the user-status guard back after the UNLINKED return | 2 failures: submit unit "refuses a suspended account that unlinked first", pg blocked-refusals case |
  | B3 — drop `pg_advisory_xact_lock` from the re-point | 2 failures: pg concurrency case (both runs claimed the row), onboarding unit lock assertion |
  | N4 — inherit `aiPausedUntil` again | 2 failures: provision unit trial-guards case, pg end-to-end case |
  | MED-1 — drop the lock from the link use-case | 2 failures: link unit "decides the identity slot under the shared advisory key", pg "link and approve contend for one stale slot" |
  | MED-2 — inherit `aiPausedUntil` on the link path | 1 failure: link unit "clears the support pause when the context moves" |
  | LOW-4 — count DRAFT again (one shared predicate, so both readers at once) | 3 failures: submit unit, queue unit, pg DRAFT case |
  | Item 5 — read the term stamp alone again | 1 failure: queue unit "calls a shop expired on exactly the pair the LINE assistant uses" |

  Note on the MED-1 mutation: an UNTIMED race passed with no lock at all, because the link's short
  transaction always commits before provisioning reaches the identity block. The pg test now starts
  the link at the one window that matters — provisioning's identity row written, transaction still
  open — via a gate on `recordFromEvidence`, the statement immediately after the identity block.

## Open questions

- None blocking. The repeat-trial hint reads the OLDEST OWNER membership of the applicant; a person
  with several old shops sees only that one named. Widen only if support asks.

## Next

- Push is done; no PR was opened, per the brief. A reviewer should confirm the Owner is happy that
  an ACTIVE second-shop attach also counts as a repeat trial under AUTO_FREE (it does today — that
  account already owns a company).
- The CI step creates `watchdog_bms` on the shared `recovery-postgres` service. If a future spec
  wants an isolated database it must still be NAMED `watchdog_bms`, because all three guards check
  the pathname — either share this one or change the guards together.
