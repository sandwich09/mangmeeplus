# Agent Memory: mangmee-advisor-fixup-13

Status: implementation and sandbox verification complete; uncommitted diff, no release or live acceptance.
Owner: Codex, one lane.
Scope: T1–T4 in docs/specs/mangmee-advisor-fixup-13-spec.md; preserve round-11 J1/J2/J5/J6 behavior.

Decisions:
- T1 root: the recorded 70-row PDF sums to 1,050,447.00. Rounding VAT per row gives 73,531.39, while the printed document calculation gives 73,531.29. The pre-reconciliation row validator rejected the ten-satang difference and folded the complete block to one summary. Shared VAT reconciliation now admits document rounding only when the complete base, single known rate and exact printed gross prove it, using the existing residual allocation/snapshot. Real base, tax or gross mismatches still fail.
- OCR source facts retain the existing capture/web 200-row ceiling and numeric product descriptions. An internal itemSource marker separates them from the unchanged default 40-row typed-text continuation. Initial projection, saved reload, question IDs beyond I99, source edits and confirmation completeness retain every row.
- A thrown confirmation preview logs the error and freezes/delivers the capture result as text with a web link and no mutation controls. Existing access, revision and delivery/outbox guards remain in force.
- T2: extraction passes OCR document classification independently of the saved/reviewer document type. Shared apply suppresses registry lookup/autosave for any TRANSFER_SLIP indication. Split-document apply also passes the actual OCR classification. Explicit counterparty actions and receipt autosave remain separate existing flows.
- T3: the existing eligible slip supplies a readable civil date before payment preview; explicit user date wins, unknown/no slip uses Bangkok today. Existing actor, company, chat, branch, attachment and revision checks still run before payment and at confirmation.
- T4: all signature capture routes share the same helper. A pending workflow resolves through the scoped continuation repository and offers the existing signed prepare action. The reply names the prepare button and web signing; standalone signature capture has no prepare action. Signing, approval and final substitute issuance remain web-only.
- Refreshed the existing W00 artifact through its existing generator: only source hashes and checkout/generation metadata changed; no capability or gate changes.
- No package.json edits, dependencies, new flags/switches, AI budget/final-mutation policy edits, commits, cloud operations or deploys.

Open questions:
- No new code failures. Full suites are not all green: 37 existing API failures and socket/database cancellations reproduce on exact starting commit d19fb56a4b1ced2c8d7ca42aac255844eb9fdd65. All remaining failed/cancelled names, failure types, codes and error messages compare equal after normalizing checkout paths.
- Live provider/LINE and real PostgreSQL acceptance remain unavailable. The existing R10 PDF fixture matches the reported R11 70 rows and total; this is deterministic replay, not recovered raw R11 OCR output or a new live run.

Artifacts:
- New scoped spec above; ten implementation files and six already-registered API spec files (see handoff).
- docs/research/mangmee-ai-capability-manifest-2026-09-27.json: regenerated W00 fingerprint.
- /private/tmp/fixup-13-last-message.md: requested handoff, at most 40 lines.
- /tmp/fx13-api-specs.json: all 516 API pretest/test files; /tmp/fx13-api-importer-specs.json: 223 transitive API importer specs; /tmp/fx13-api-extra-specs.json: 66 additional files. The 582-file union covers every importer plus required DI and table-driven delivery checks.
- /private/tmp/fx13-base-d19fb56a4: exact git archive baseline with identical installed dependencies/generated Prisma; no repository checkout or commit mutation.
- /tmp/fx13-baseline-comparison.json: detailed current/base comparison, zero new failed/cancelled entries. Regenerated W00 resolves one baseline failure.

Behavior evidence:
- receipt-ocr-apply.service.spec.ts: R11 T1 replays all recorded PDF rows with exact VAT/total and proves 70/200 source rows survive projection, reload, source editing and confirmation completeness; typed-text >40 still refuses. R11 T2 checks a saved RECEIPT with OCR TRANSFER_SLIP performs no uploader/registry lookup or autosave.
- expense-totals.logic.spec.ts: R11 T1 proves exact document rounding and refuses incorrect base, gross, tax, missing row and missing base evidence.
- line-capture-result-notifier.use-case.spec.ts: R11 T1 exercises RangeError and generic preview failure through execute/outbox settlement, saved delivery plan and actual push seam; published, zero parked/failed, web link retained, no mutation controls.
- expense-extraction.use-case.spec.ts: R11 T2 passes OCR slip classification on an existing RECEIPT without overwriting reviewer type.
- line-draft-update.security.spec.ts: R11 T3 covers known/edited/unread/absent/already-linked slip dates without payment writes; existing stale/foreign-slip regressions remain passing.
- process-line-webhook.use-case.spec.ts: R11 T4 checks shared saved-signature helper creates the prepare postback with existing token, web-signing wording and standalone isolation; existing caption and numbered signature routes use the new wording. Full package suites retain J1/J2/J5/J6 regression paths.

Verification:
- pnpm --filter @watchdog-bms/contracts build: PASS.
- pnpm --filter @watchdog-bms/api typecheck and pnpm --filter @watchdog-bms/ai-gateway typecheck: PASS (package scripts).
- All tests use pnpm --filter <pkg> exec node --import tsx --test <full declared files>; broad runs use --test-concurrency=4 (no tsx CLI IPC socket).
- Contracts complete test list: 419 pass, 0 fail (/tmp/fx13-contracts-full.log).
- Gateway complete test list: 1,674 pass, 0 fail, 46 socket cancellations; exact base identical (/tmp/fx13-gateway-full.log, /tmp/fx13-base-gateway-full.log).
- API complete pretest + test lists, 516 files: 11,235 pass, 2 fail, 303 skipped. Base 11,228 pass, identical 2 failures and 303 skips (/tmp/fx13-api-full-final.log, /tmp/fx13-base-api-full.log).
- Additional 66 API importer specs: 531 pass, 35 fail, 38 cancelled, 12 skipped. Base 530 pass, 36 fail, identical cancellations/skips; the resolved failure is stale W00 artifact (/tmp/fx13-api-extra-final.log, /tmp/fx13-base-api-extra.log).
- All six changed spec files: 968 pass, 0 fail (/tmp/fx13-focused-final.log).
- Required real-module DI + delivery-plan logic: 32 pass, 0 fail (/tmp/fx13-di-final.log).
- Required DI + logic + table-driven frozen delivery: 46 pass, 27 fail; all 27 failures exactly match base (/tmp/fx13-di-delivery.log, /tmp/fx13-base-di-delivery.log), also included in broad API runs.
- W00 regenerated, then rerun without update mode: 5 pass, 0 fail (/tmp/fx13-manifest-final.log).
- git diff --check: PASS; every changed test file belongs to the existing API package test list; no package.json diff.

Next: review/integrate this uncommitted diff; rerun live LINE/model and PostgreSQL acceptance in an authorized environment supporting network/database sockets. Do not infer deployment acceptance from these sandbox checks.
