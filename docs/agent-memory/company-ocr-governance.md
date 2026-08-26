# Agent Memory: company-ocr-governance

Status: READY_FOR_PR — one local feature commit plus verified follow-up fixes; no push/PR yet
Owner: Platform / AI / Finance Operations
Scope: per-company OCR on/off, monthly read quota, OCR + receipt upload usage on Platform Admin; no subscription/billing

Decisions:
- Dedicated OCR config is required; `expenses.upload` must continue to allow upload/manual review and does not govern banking OCR.
- One shared monthly quota covers web receipt, LINE receipt and scanned bank statement OCR.
- Count at durable admission immediately before provider; failures after admission count, pre-provider refusals do not.
- A content-bearing LINE media message is admitted before the image intent router and reuses the same admission
  for later receipt extraction, so one document counts once across its provider/model calls.
- Content-bearing means JPEG/PNG only. LINE PDF is metadata-only today and is not counted until a future
  PDF-content extraction seam actually calls a provider.
- Internal credential and local model policy resolve before admission. Typed downstream refusals that prove
  no provider ran atomically release event + aggregate under the same advisory-lock order; uncertain transport
  failures remain counted because provider execution cannot be disproved.
- HTTP 400/401/403/404 release decisions use the locally observed status, never a JSON string that imitates it.
  Router `PROVIDER_DISABLED/CONFIG_MISSING` releases and lets the distinct receipt OCR provider admit next;
  timeout/throttle/parse keeps the admission and blocks the downstream second image call.
- Prisma governance is mandatory Nest DI in all three OCR clients; a missing dependency fails API boot closed.
- `null` monthly limit means unlimited to preserve existing behavior; burst and AI-spend controls remain in force.
- OCR request idempotency is `(companyId, sourceRoute, requestId)`; config mutation and month admission
  share a company PostgreSQL advisory lock, then admission holds a month lock before incrementing.
- Inbound request ids over 256 bytes are deterministically SHA-256 normalized before they reach the request
  context, preserving retry identity without risking an oversized PostgreSQL btree entry.
- “uploaded receipt documents” counts active receipt primary/supporting attachment links only; never all attachments.
- Partner usage aggregate/source/upload reads share one PostgreSQL `RepeatableRead` snapshot.
- OCR config writes use dedicated monotonic `ocrConfigVersion`, not shared `updatedAt`: compare after the
  exact-desired-state no-op check, so a lost-response replay succeeds with stale expectedVersion while a
  stale different change gets 409. Successful change increments once and audits from/to version.
- No OCR backfill: old AI model-call rows and historical audit rows cannot prove one-row-per-read.
- The August 2026 UI discloses the 27 August tracking start; the partial-month note disappears afterward.

Open questions:
- None required for the first implementation. A future commercial/package policy may replace unlimited inheritance, but subscription is explicitly out of scope.

Artifacts:
- `docs/specs/company-ocr-governance-spec-th.md`
- `docs/plans/company-ocr-governance-plan-th.md`
- `docs/evidence/company-ocr-governance/README.md`
- `docs/evidence/company-ocr-governance/platform-admin-ocr-desktop.jpg`
- `docs/evidence/company-ocr-governance/platform-admin-ocr-mobile-disabled.jpg`
- Claude CLI Opus 5 / effort max blocker review: `/Users/thawatchai/.claude/plans/read-only-blocker-review-of-lucky-babbage.md`

Verification:
- Root adversarial follow-up: 300 focused API tests pass; three database cases were then rerun with
  `DATABASE_URL` and passed 76/76 with zero skip. This covers OCR last-slot concurrency, admin CAS,
  consistent usage snapshot, LINE pre-router admission reuse, exact refusal pairing and transient release retry.
- Latest named web OCR/banking/retry set passes 74/74; contracts, API and web typecheck pass after the follow-up fixes.
- CI PostgreSQL lane sets `OCR_REQUIRE_POSTGRES=true` and directly names the admission race, usage snapshot
  and two-admin CAS files; each fails instead of silently skipping if `DATABASE_URL` is absent.
- Release compensation now spans four attempts with 50/250/1,000 ms backoff. Exhaustion is tested fail-closed,
  preserves the conservative event/aggregate and emits a HIGH-risk `OCR_QUOTA_COMPENSATION_REQUIRED` line
  with repair identity for the existing production security alarm.
- Web retry regression proves lost-response mode reuses the original request id while a received provider
  failure uses a fresh id. LINE regressions cover metadata-only PDF, provider-disabled release, uncertain
  router block and forged HTTP error code in a 200 JSON body.
- P2 stale-write focused API specs: 51/51 pass with `DATABASE_URL`, including real PostgreSQL
  two-admin race (one version-0 change wins as version 1, the other gets 409) and winner replay
  with stale expectedVersion (no second increment/audit). The existing real usage snapshot also passed.
- P2 web logic: 17/17 pass, including 409 detection, one latest-state reload and reviewed Thai copy.
- Additive `20260827150000_company_ocr_config_version_cas` migration applied successfully to the local
  PostgreSQL QA database; Prisma validate/format, contracts build, final API/web typecheck and
  `git diff --check` pass.
- Adversarial focused registered API specs: 105/105 pass, 0 fail/skip, covering all three clients,
  local policy failure, downstream Typhoon/PDF refusal release, mandatory governance behavior and usage snapshot.
- Real PostgreSQL OCR race/release passed: limit 2 + used 1 admits exactly one of two sessions; releasing
  that pre-provider reservation returns event count to 0 and aggregate to 1, and the same request key can retry.
- Real PostgreSQL usage interleaving passed: a second session committed an event+aggregate increment between
  the admin aggregate and source reads; the response stayed internally consistent at the original snapshot
  while the committed database state advanced to 2.
- Nest token regression passed 3/3 and `pnpm --filter @watchdog-bms/api test:boot` resolved every provider.
- Test-discovery regression: OCR admission/config/statement/client coverage lives only in files already
  listed by the repository's explicit full-test command; no standalone unregistered OCR spec remains.
- Real PostgreSQL race passed (not skipped): with limit 2 and used 1, two concurrent sessions admit
  exactly one request; the final event count is 1 and aggregate is 2. The test skips only when
  `DATABASE_URL` is absent and always cascade-cleans its isolated company.
- Full `pnpm --filter @watchdog-bms/api test` was rerun after the adversarial fixes and passed with exit 0
  while `DATABASE_URL` was present.
  The captured invocation proves discovery of `company-ai-usage-meter.spec.ts`,
  `statement-import.use-case.spec.ts`, and `set-partner-ai-model.use-case.spec.ts`; no standalone
  unregistered OCR spec remains.
- Focused web: 35/35 pass for OCR limit and banking error mapping logic.
- `@watchdog-bms/contracts` and `@watchdog-bms/config` build pass.
- API and web typecheck pass after final UI changes.
- Prisma validate and format check pass.
- A disposable PostgreSQL database applied every migration present in this branch at verification time, including
  `20260827120000_company_ocr_governance`; SQL inspection proved defaults, check constraint,
  foreign keys, uniqueness and indexes. The disposable database was dropped afterward.
- The additive OCR migration also applied successfully to the local `watchdog_bms` database used
  for browser QA. No cloud environment was touched.
- Prisma schema diff after all migrations contains only pre-existing unrelated drift
  (`DataRightsCase.updatedAt`, long index-name renames, and RemoteRelease defaults/FK/name); no OCR drift.
- Chrome local QA at 1440x1000 and 390x844 passed: view usage, save limit 250, reload, disable with
  consequence confirmation, re-enable, clear to unlimited, reload persistence. Final company config
  restored to `enabled=true`, `monthlyLimit=null`; Chrome console error/warn list was empty.
- Final post-review statement contract regression passes API 24/24 and web 61/61. It proves Nest emits
  top-level `{ code, message }`, `authedApiFetch` retains the code, the upload sanitizer retains it and
  the statement UI selects the allowlisted disabled/limit/unavailable recovery copy instead of a generic error.
- Final full API test rerun passes with exit 0 and real `DATABASE_URL`; the strict OCR PostgreSQL gate
  separately passes 77/77 with 0 skipped. Final full web suite passes 1,125/1,125 with 0 skipped.
- Final API and web typecheck pass after the statement contract correction. Two independent agent
  re-reviews report no P0/P1/P2 blocker; the agent that found the statement-code gap verified it resolved.
- Final Claude CLI Opus 5 / effort max follow-up review returns `NO BLOCKERS`. Its omitted-file residuals
  were checked against the full tree: expense retry callers compile and send `X-Request-Id`; all three strict
  PostgreSQL specs fail when the required database is missing; LINE `denied` is consumed as a fresh receipt
  admission only when no route OCR error remains; the admin renders a skeleton before usage exists and updates
  saved config immediately after save; PDF attachment bytes are filtered out of the router model `images` input.
- The compensation event has root-level `riskLevel=HIGH`; the existing production CloudWatch metric filter
  alarms on HIGH/CRITICAL log lines. Four failed release attempts intentionally add a bounded 1.3-second
  recovery window before returning fail-closed rather than silently creating unmetered OCR usage.
- `git diff --check` passes and temporary dev-login/CORS changes are absent from the final diff.

Next:
- Root reviews the isolated worktree diff, then owns commit/push/PR/merge sequencing.
