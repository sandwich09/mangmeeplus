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

## Artifacts

- `apps/api/src/modules/external-signup/application/submit-line-signup.use-case.ts`
- `apps/api/src/modules/system-onboarding/application/use-cases/create-company-onboarding.use-case.ts`
- `apps/api/src/modules/external-signup/application/signup-admin-queue.use-case.ts`
- `apps/api/src/common/security/liff-page.security.ts`
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts` (export only)
- `packages/contracts/src/external-signup.ts`
- `apps/web/src/features/system-signup-requests/signup-queue.logic.ts`, `SignupQueuePage.tsx`
- `apps/web/src/common/api/api-error-message.ts`
- `apps/api/src/modules/external-signup/line-signup-stale-identity.pg.spec.ts` (new; added to the
  fixed api test list in `apps/api/package.json`)
- `docs/runbooks/line-first-signup-support-playbook.md` (support entry)
- `.github/workflows/ci.yml` (the three pg specs now run in `typecheck-and-test`)

## Verification

- api fixed list, with `LINE_SIGNUP_TEST_DATABASE_URL` set: pretest 30 tests / 16 pass / 0 fail /
  14 skipped; test 6461 tests / 6362 pass / 0 fail / 99 skipped (stable across two runs; the
  6475 figure recorded on 2026-09-03 came from date-sensitive specs, not from a lost file — the
  "every spec file is wired into a package.json script" meta-test passes and `git diff` shows a
  net +6 `it(` blocks). Without the variable the pg spec reports 0 tests / 0 fail: it skips.
- pg spec against local docker (`postgresql://…@127.0.0.1:15432/watchdog_bms`): 5/5 pass; the
  database row counts are identical before and after, so cleanup is complete.
- pg spec on a CLEAN container (`migrate deploy` + `sync-permissions`, nothing else): 5/5, and the
  other two `*_TEST_DATABASE_URL` specs pass beside it when each is its own invocation. Run
  together they fail on `lower(username)` — which is why the CI step sequences them.
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
