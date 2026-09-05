# Agent Memory: LINE-first signup Slice L-C (admin, support, ops alerts)

Status: IMPLEMENTED on `codex/line-signup-c-admin` (branched from `codex/line-signup-b-liff` @ 7bb3d7bf).
Owner: Owner (product) / Claude Fable (control) / this slice implemented per the L-C brief.

Scope: spec §8/§9/§15.5/§15.6/§15.7 and review A-01…A-05, SEC-05. Nothing from L-E, L-B or the
receipt quota was touched.

## Decisions

- **Targeted suspend, exactly one case.** `decide(SUSPEND)` still refuses `PROVISIONING`, except an
  abandoned attempt (`isStaleProvisioning`) with `companyId === null`. The stamp happens inside the
  company transaction, so no company id means no company was created and there is nothing to
  strand. This also answers the plan's open question about the `PROVISIONING → SUSPENDED` edge in
  both transition tables: **keep it — it is reachable again through exactly this path.**
- **Package-change APPROVE is not a second tier writer.** It CLAIMS the row (CAS on `OPEN`) and then
  calls `SetCompanyPlanTermUseCase` — the same use-case `PUT /system/partners/:id/plan-term` calls —
  so limits still move in one place (H-01). A failure inside that write returns the row to `OPEN`.
  The controller therefore lives in `system-partner-management`, beside the writer and under the
  permission that already guards it (`system.partner_company.update`); no new module edge, no new
  permission key.
- **Route param is `:partnerCompanyId`, not `:companyId`.** Same URL shape as the spec (`/system/
  partners/<id>/timeline`), but the auth guard treats a param literally named `companyId` as tenant
  scope and would demand membership in the customer company, which system admins never have. This
  is the existing convention on that controller.
- **The timeline's last line is derived, not remembered.** "Why the assistant is refusing" has never
  been written to any table, and it is the question support is actually asked, so it is computed
  from the shop's state now (disabled → expired → unlinked → image quota → AI budget, first match
  wins). Everything above it comes from rows that already exist. No new log table, as §8 requires.
- **§15.6 (d) is a sweep, not a hot-path write.** "Trial shops that exhausted their AI budget today"
  is counted from the meters that already exist, on the 15-minute reminder sweep. Instrumenting
  `assertCompanyAiBudget` would have added a write to every refusal for a daily-granularity signal.
- **Ops alerts reuse L-B's rail.** `SignupAdminNotifyService.activeSystemAdmins()` and
  `pushToLinkedAdmins()` (made public for this) rather than a second fan-out; the Bangkok day is
  both the outbox `eventKey` suffix and the notification `periodKey`.
- **A-04 sends a boolean, not the union.** The console has one of the three owner shapes to offer;
  `ownerAuth` stays the internal contract.

## Note for the plan (Flow B escape hatch — item 6 of the L-C brief)

**Decision: leave the note, build nothing.** A web-form (`official-site`) row stranded in
`PROVISIONING_FAILED` or `READY` has NO admin path today, and "reissue claim link" is not one:

- `LINE_ONLY_QUEUE_STATES` keeps those two states out of the queue for `official-site` (deliberate,
  review MEDIUM-D) — unchanged by L-C.
- `REISSUABLE_STATES` is `EMAIL_PENDING | EMAIL_FAILED | EXPIRED`, so reissue 409s there; and
  `reissue` advances to `EMAIL_PENDING`, which is not a legal edge from `PROVISIONING_FAILED` in the
  official-site table (`PROVISIONING_FAILED: ['PROVISIONING','SUSPENDED']`).
- The applicant cannot self-recover either: `AccountClaimTokenService.consume` stamps `usedAt`, so
  the link that got them there is spent.

Making it work is therefore a real change (a new transition edge or a Flow-B-specific retry action),
not a flag flip — out of scope for L-C by the brief. Until then the manual recovery is: open the row
in the database, confirm which half committed, and finish it by hand. Frequency is expected to be
near zero (Flow B provisioning runs from the claim page, inside one request), and P10-L's own rows
are fully covered by the LINE-only recovery paths.

## Residuals for the Owner to acknowledge (spec §15.5 note)

0. **The link fence's rule is structural, and must stay that way.** A token may never CONTAIN a
   second `https?://`. Two earlier versions tried to enumerate the characters that end a URL — first
   whitespace, then a longer allowlist — and both leaked: a swept probe of 122 glue characters
   leaked 102 against the allowlist version. Anything that adds a character to `TOKEN_END` instead
   of preserving the lookahead is re-opening the same bypass. `TOKEN_END` still earns its place for
   bare-host glue and invisible characters, but it is not what makes the fence sound.
1. **Bare internationalised hosts pass the SEC-05 link fence.** `มังมี.ไทย/pay` written WITHOUT a
   scheme is not matched, because the only rule that would catch it (`\p{L}` labels) also matches
   ordinary Thai prose around a full stop and would refuse honest operator sentences. Written the
   way it would have to be to be tappable — `https://มังมี.ไทย/pay` — it IS refused, by punycode
   hostname. Accepted tradeoff; revisit only if a real message is ever found using the bare form.
2. **`sweepStuckPushes` re-alerts every Bangkok day while any single push row stays stuck.** That is
   intended (the customer genuinely has not been told their shop is open), but it means the alert
   does not clear itself: an operator has to answer the shop from the partner page and have the
   stuck outbox row cleared. Written up in the playbook with the manual step. If it repeats past one
   day the cause is the OA's monthly message quota, which is a plan decision, not a per-shop fix.

## Artifacts

- api: `signup-ops-alert.service.ts`, `package-change-decision.use-case.ts`,
  `get-partner-timeline.use-case.ts`, `send-partner-line-message.use-case.ts`,
  `partner-line-message.logic.ts`, `EndPlanTermWarmupUseCase`, `SystemPackageChangeController`
- web: queue tabs + hints + tap-to-call, partner timeline/message/warm-up sections, LINE badge in
  the user lookup, "ลูกค้าใช้ LINE เท่านั้น" on admin onboarding
- infra: `LINE_SIGNUP_ADMIN_ALERT_BUDGET_EXHAUSTED_PER_DAY` in `apiConfigSchema` + `deploy.sh`
  (both envs, 5) + serving-mode grep contract (9 → 10 vars, 2 new rejection cases) + pins re-synced
- docs: `docs/runbooks/line-first-signup-support-playbook.md`,
  `docs/runbooks/line-rich-menu-v2-console-setup.md` (P10-L section)

## Verification

- `apps/api`: full fixed test list green; new specs 13 (ops alerts) + 12 (package change) + 18
  (partner support tools) + 13 (SEC-05 logic); guards mutation-verified (CAS loser, idempotency,
  Bangkok day key, alert threshold, SEC-05 link fence, refusal ordering).
- `apps/web`: 1407/0; `next build` green; typecheck green across all projects.
- `infra`: `bash -n` on both scripts, `production-serving-mode.spec.sh` PASS, pins re-synced
  (`exactFiles=45`).

## Next

- Rebase onto the latest `origin/codex/line-signup-b-liff` once L-B's review fixes land (expect only
  the `apps/api/package.json` test-list conflict — union, no duplicates).
- Transplant the "Note for the plan" section above into
  `docs/plans/mangmee-line-first-signup-plan-th.md`, which lives on the docs branch.
- Owner decides the rich-menu tile question recorded at the end of the rich-menu runbook.
