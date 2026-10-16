# Agent Memory: LINE substitute receipt Fix-up 11

Status: Complete locally; uncommitted diff, no deployment.
Owner: Owner decision, 2026-10-16; implementation by Codex.
Scope: Restore web-only Preview/Certify/Approve; retain LINE facts/evidence/prepare and send the authenticated signing/approval link.
Decisions:
- Owner verbatim: “ให้การลงนามและอนุมัติใบรับรองแทนใบเสร็จทำบนเว็บเหมือนเดิม น้องเตรียมให้แล้วส่งลิงก์”. Supersedes 7B signing/approval/issuance cards.
- Restore develop's three `assertWeb(ctx)` calls and original boundary comments. Retain harmless audit source metadata; no final-mutation policy, env switches or package.json changes.
- PREPARE keeps its signed private confirmation, real LINE context and existing permission/branch/source/financial guards. Prepared facts use one URI-only card to the existing evidence wizard/hub route, labelled เปิดลงนามในเว็บ or เปิดอนุมัติในเว็บ. The web remains authoritative for signing/approval. Facts remain limited to the payer, reviewers or policy-eligible approvers.
- Old sign/approve postbacks navigate without invoking preview/certify/approve; an unavailable/expired source returns the authenticated hub without document facts. Web-link cards keep existing source/quote proofs but create no delivery-plan mutation control.
- Remove the 7B signature-asset-to-signing-card hook; preserve pre-7B signature assets and paper scan handling. Web notifications and LINE expense confirm/payment actions continue through existing use cases.
Open questions: None about implementation. Live LINE/browser and PostgreSQL verification are unavailable in this sandbox; baseline exceptions are documented below.
Artifacts:
- `docs/specs/line-substitute-receipt-assisted-issuance-spec.md` and corresponding plan record the owner decision.
- Expense use-case and continuation, LINE action service/webhook, and three existing registered regression spec files.
- Handoff: `/private/tmp/fixup-11-last-message.md` (under 40 lines).
Verification:
- `pnpm --filter @watchdog-bms/contracts build`: exit 0 (`/tmp/fx11-contracts-build.log`).
- `pnpm --filter @watchdog-bms/api typecheck` and `pnpm --filter @watchdog-bms/ai-gateway typecheck`: exit 0 (`/tmp/fx11-{api,gateway}-typecheck-final.log`).
- Tests use the required `pnpm --filter <pkg> exec node --import tsx --test --test-concurrency=4 <files>` runner, without the sandbox-incompatible tsx CLI. Exact commands are the first lines of each log; no package scripts were edited.
- ALL registered API roots transitively importing changed sources, plus named delivery-plan and expense-chain checks: 24 roots, 2,109 pass, 0 fail/cancel/skip (`/tmp/fx11-api-registered-final.log`; roots `/tmp/fx11-api-registered-test-roots.txt`). Includes real Nest-module DI, ask-once/no-more-evidence/payer/slip/prepare, channel refusal, exact URI cards on both delivery paths, old postbacks, policy/revocation, card-table and expense confirm → payment checks.
- FULL contracts test-script list: 13 roots, 419 pass, 0 fail/cancel/skip (`/tmp/fx11-contracts-full-final.log`).
- FULL gateway test-script list: 51 roots, 1,670 pass, 0 fail, 46 cancelled, exit 1 (`/tmp/fx11-gateway-full-final.log`). Re-run on an untouched `git archive` of starting commit `c761bd4b5f8669e89234ec469fa7ba107166007d`: exactly 1,670 pass, 0 fail, 46 cancelled (`/tmp/fx11-gateway-base-full.log`). These cancellations are not claimed as passes.
- Broader API run includes ALL direct-import specs, even unregistered/PG ones: 45 roots, 2,444 pass, 35 fail, 31 cancelled, 6 skipped (`/tmp/fx11-api-affected-final.log`). Exact same 45-root command on the untouched starting archive: 2,442 pass, 35 fail, 31 cancelled, 6 skipped (`/tmp/fx11-api-base-affected.log`). All non-passing test names, failure kinds and messages match; no added failures. Generated Prisma output and installed dependencies were shared with the base archive; tracked base sources were not edited.
- Machine comparison of both base runs: `/tmp/fx11-base-comparison.json`; runner `/tmp/fx11-run-tests.py`; base API command `/tmp/fx11-base-api.py`. Base archive `/private/tmp/fx11-original-c761bd4b5`.
- `git diff --check`: passed. No package.json edits, commits, cloud operations, or process termination.
Next: Review/integrate the diff; live LINE and database checks when those environments are available. No further local code changes required.
