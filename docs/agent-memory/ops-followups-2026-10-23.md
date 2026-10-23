# Agent Memory: ops-followups-2026-10-23

Status: PLANNED, docs only. Nothing has been executed: no code, infrastructure, git-state or cloud change,
and no AWS call (read or write).
Plan: [`docs/plans/ops-followups-2026-10-23-plan.md`](../plans/ops-followups-2026-10-23-plan.md).

Owner: platform. The owner approves every AWS change and every Production promotion and types each MFA
code. A Claude subagent wrote the plan.

Scope: the six items of section ก in `docs/research/expense-leadership-verified-backlog-2026-10-23-th.md`:
1. the homepage release, UAT → Production;
2. the ALB default "restoration in progress" text;
3. the UAT `ai-origin` source-IP allow-list;
4. the laptop deploy-key rotation around 2026-11-04;
5. the LINE help-pack review before 2026-12-27 00:00 Bangkok;
6. the AI-credit PG spec date question and the date-rot calendar.

## Decisions

- Recommended windows:
  - **A (owner present, about 1.5–2 h):** item 1 UAT → Production, then item 2 on both listeners, then
    item 3 while UAT is still running, then pause UAT.
  - **B (Wednesday 2026-11-04, start of day):** item 4. Delete the old key at least 24 hours later.
  - **C:** item 5. Remind Tuesday 2026-12-01, review the week of 2026-12-07, Production by Friday
    2026-12-18. The deadline is Saturday 2026-12-26 17:00 UTC.
  - **Any time:** item 6, optional local proof only.
- Item 1:
  - It must use the normal path, `deploy-uat --prepare --publish-images`, then `--apply --prepared-build`,
    then `promote-prod --uat-release <run path> --production-browser-acceptance` with `--prepare` and then
    `--apply`. The hotfix path cannot carry `apps/web/public/home/*.m4a` or `home-faq.json`.
  - No W00 refresh is needed: none of the 10 changed files is hashed.
  - Every UAT command (preflight, prepare, apply) needs `--uat-smoke-acceptance` or
    `--uat-browser-acceptance`, the same flag on all three; the owner chooses.
  - The UAT resume baseline is `8d7cdca01` (`power-runtime.json`, latest pause
    `20261022T133726Z-0bf75cba`), not `733f77864`.
  - The diff against Production `8d7cdca01` is web-only, with no migration.
- Item 2:
  - Neither stack (`mangmee-kamal-production`, `mangmee-kamal-uat`) contains the ALB or its listener; the
    rules hard-code the listener ARNs. A stack change set is therefore not possible.
  - Plan: an owner-approved `ModifyListener` on the default action only. Keep 503 and `text/plain`, change
    only the body, and keep before/after evidence in a new private `~/.codex/edge-operations/` folder.
  - Do UAT too: its default says "UAT restoration in progress".
- Item 3:
  - Mirror the 2026-10-21 Production pair with a stage change set that adds `ApiEip` with
    `InstanceId: Ref ApiServer` and output `ApiFixedPublicIp`.
  - The active change set modifies only `AiUatRoute`, adding `source-ip ${ApiEip}/32`.
  - Use a copy of `ai-ingress-cfn-prod.py` with exact change-list assertions.
  - Only the API calls AI (`AI_GATEWAY_INTERNAL_URL` must be `https://uat-ai-origin.mangmeeplus.com/v1`);
    workers have no AI gateway URL.
  - Schedule it with no LINE traffic expected, and read the LINE AI credit holds afterwards: UNRESOLVED
    holds keep counting until evidence or an audited operator decision closes them.
- Item 5:
  - Do not edit the v4 record: its spec asserts 2026-12-27.
  - On the active pack: version 7, a new `owner-review:<date>` reviewer, and new `effectiveTo`/`reviewDueAt`.
  - Re-pin `home-help-v6.json` `sourcePackHash` and four specs:
    - `home-help-v6.spec.ts`;
    - `agent-tools.registry.spec.ts`: version and reviewers, the version increment at `:382`, the review
      sheet at `:434`;
    - `line-ai-turn-v2.integration.spec.ts`;
    - `orchestrator.agent.spec.ts:1905`.
  - After the deadline only the approved card answers stop; registry-backed action instructions keep
    answering.
  - Regenerate the W00 manifest and run whole-chain.
  - Never pin `line-ai-turn-v2.integration.spec.ts`.
- Item 6:
  - The spec does not fail on 2026-11-01. Commit 6cd02ffee (2026-10-01 13:13 +0700) fixed the renewal
    fixture to one whole calendar month, and the content is in `main`'s tree.
  - No Date pin. The spec passes `now` to most calls, but `settle()` omits it and settlement uses
    `input.now ?? new Date()`. That remaining real-clock use is not known to fail on any date and is left
    as is. Mocking Date in a real-PG spec would mix in the database's own clock.

## Open questions

- The runbook heading "Current UAT power state — paused 2026-10-22" names baseline `733f77864`, but the
  latest pause saved `8d7cdca01`. Reconcile the heading at the next UAT record.

- Where does `infra/kamal/power-uat` live? It is not in git at `main` 6c54ba208, and neither is the
  README anchor the runbook cites. Should it be landed in git (separate task)?
- Is the laptop profile `thawatchai` a static root access key or a login session? A 2026-09-01 note says
  root access key, "to be deleted". The 2026-10-09 record says the session expired and the owner did an
  AWS login with MFA. If it is a static root key, removing it outranks item 4.
- Item 3 cost: about 3.6 USD/month for the UAT EIP, even while paused. This is the public-rate estimate.
  Owner decides.
- Item 2: the replacement wording (suggested `Service unavailable`, status 503 unchanged). Owner decides.
- Item 4: why 2026-11-04? It fits 90 days from about 2026-08-06, but that is not verified. The owner can
  read the key's creation date in IAM.

## Artifacts

- `docs/plans/ops-followups-2026-10-23-plan.md` (this round's plan, with the owner summary in Thai).
- Read only:
  - `~/.codex/edge-operations/20261021-ai-ingress/`: Production helper, intents, reviewed change lists,
    templates;
  - `~/.codex/edge-operations/20261021-uat-role/`: UAT templates;
  - `~/.codex/edge-operations/20261021-legacy-seo/`: UAT/Production SEO templates.

## Verification

All checks were read-only. These things were done:
- Read the two runbooks, `infra/kamal/README.md`, the security memory and the backlog section ก.
- Read the item-5 sources: `approved-product-help.ts`, `approved-knowledge.ts`, the specs that pin the
  pack, and the W00 manifest.
- Read the item-6 sources: `ai-credit-funding.pg.spec.ts` (16 tests), the billing helpers,
  `git blame`/`git show 6cd02ffee`, and the timer pins in the other date-sensitive specs.
- Anonymous HTTPS probes, 2026-10-23 16:16–16:18Z:

  | Probe | Result |
  |---|---|
  | `ai-origin` | 503 "Production restoration in progress", `awselb/2.0` |
  | `uat-ai-origin` | 504 |
  | Unmatched Host header on the Production ALB | 503 "Production restoration in progress" |
  | Unmatched Host header on the UAT ALB | 503 "UAT restoration in progress" |
  | Homepage audio | 404, not edge-cached |
  | Homepage text | "เทียบทุกแพ็กเกจ" ×2; new FAQ question absent |
  | Port 80 on both AI origins | no answer |

- Two further anonymous GETs went to `uat.mangmeeplus.com` (504) and `uat-origin.mangmeeplus.com` (301).
  Both are our own hosts, but outside the three hosts this task named.

Not done:
- The release pins check `node infra/security/sync-production-maintenance-release-pins.mjs --check`: the
  session's permission policy refused it. Run it before item 1.
- AWS reads.
- The Date-shift proof run, which needs a local PG database.
- Reading `power-uat` and `~/.codex/offline-restores/`.

## Next

- When the owner is available for window A, start item 1 step 1. The plan lists the stop conditions and
  the IDs to record.
- Update the session's date-rot memory note: `ai-credit-funding` is fixed (6cd02ffee),
  `orchestrator-model-loop` and `company-vat-registration` are pinned, and the 2027-01-01 orchestrator
  entry is unverified.
- Set an owner reminder for Tuesday 2026-12-01 (item 5) and for Wednesday 2026-11-04 (item 4).
