# Agent Memory: Mangmee advisor fix-up 10

Status: Complete locally (2026-10-16), with exact-base-proven sandbox socket failures; one lane, uncommitted.
Owner: Codex.
Scope: PDF bookkeeping/apply race; deterministic counterparty routing and one-card delivery; substitute reply/action polish; chat-first receipt review.
Decisions:
- Ponytail full; use existing permission, tenant, branch, revision and mutation guards.
- Delivery-only receipt metadata preserves the existing content revision and workflow targets; its scoped CAS still detects concurrent edits. Genuine edits still stale queued reads.
- Explicit counterparty commands route to guarded preview tools before expense capture, independent of history. Pending media, draft collection and unrelated clarification answers cannot consume this command; the original pending work remains stored.
- Preserve J1–J4 and existing final-mutation policy; no package.json, dependency, flag, cloud, commit or live-evidence changes.
- Acceptance: 40/70 PDF rows apply across delivery bookkeeping; intervening edits refuse; vendor command after help reaches counterparty preview; one card; signature ask has no stale controls; Thai dates, one payer action, neutral multipart closer; receipt action starts existing chat confirmation.
- Receipt cards reuse the existing signed CONFIRM preview and show its evidence acknowledgement/details. The notifier persists the matching action proof/control, exact fallback, expiry and fresh-preview verification; the web link is secondary. Ineligible previews retain the guarded chat entry.
- Missing-signature preparation returns only the real ask, discards the obsolete action, and cannot reoffer preparation until the signature exists. Certification reports the committed step; the next preview determines whether this actor may approve.
Open questions: Live J1–J4/device/provider replay is unavailable without network/docker. PDF windows reconstruct the reported 40/70-row cases; they are not raw live provider checkpoint replays.
Artifacts:
- P1: registered expense-capture-read-runner.service.spec.ts uses real delivered-continuation repository and ReceiptOcrApplyService for 40/70 rows, fresh/checkpoint resumes and intervening user edits; repository continuation spec pins unchanged revision and stale workflow targets.
- P2/P3: registered process-line-webhook.use-case.spec.ts sends the exact vendor command after capability help through the real webhook to the counterparty card; line-non-receipt-reply.logic.spec.ts extends the real delivery-plan table with the reported counterparty and signed receipt cases.
- P4: registered webhook spec checks both deduplication paths and neutral multipart closer; substitute-receipt.use-case.spec.ts runs the actual missing-signature continuation/service/postback, approval wording/Thai dates, and single payer action.
- P5: registered notifier spec checks signed primary action, secondary web link, exact fallback and stale-preview denial; line-draft-update.security.spec.ts presses the receipt card through real ready → review → confirm with committed CAS revisions and the existing payment next step.
- /private/tmp/fx10-api-test-files.json lists all 154 registered direct/transitive affected API specs plus the original delivery-plan suite (155 files total).
- /private/tmp/fx10-baseline-comparison.json; /private/tmp/fixup-10-last-message.md.
Verification:
- Contracts build PASS; API and gateway package typecheck scripts PASS (API uses its required memory-configured script).
- Literal full gateway/contracts test scripts attempted on current and exact original HEAD c58178276ff4d470ae0d37f44a3b0ada12a1d3f8: identical tsx IPC listen EPERM. Their complete unchanged script file lists ran with pnpm --filter <pkg> exec node --import tsx --test --test-concurrency=4 <files>.
- Full contracts: 419 pass, 0 fail/cancelled. Full gateway: 1,670 pass, 0 fail, 46 cancelled by blocked local sockets; full exact-base gateway: identical counts and cancelled names/types.
- All 155 affected/required API specs: 5,648 pass, 2 fail, 111 existing skips. Exact same full list on archived original HEAD, using the same installed dependencies/generated Prisma client: 5,644 pass, the identical 2 listen EPERM failures, 111 skips. No new failure; detailed names/types match in comparison JSON.
- Separate real Nest AppModule DI plus both delivery suites: 57 pass, 0 fail/cancelled. Targeted fix-up 10 regressions: 6 pass, 0 fail/cancelled.
- Logs: /private/tmp/fx10-{full-api-final,base-full-api-final,full-gateway-final,base-full-gateway,full-contracts,di-delivery,targeted-final}.log; build/typecheck logs share the fx10 prefix.
- git diff --check PASS. No package.json, dependency, final-mutation gate, feature flag, live-evidence, cloud or commit changes.
Next: Review/integrate the diff; live acceptance and sandbox-blocked socket/DB checks require a capable environment.
