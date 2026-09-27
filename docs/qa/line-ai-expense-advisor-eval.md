# LINE AI expense-advisor eval harness

Evaluation harness for น้องมั่งมี's expense/reimbursement advisor behavior against
[mangmee-ai-expense-advisor-spec-th.md](../specs/mangmee-ai-expense-advisor-spec-th.md) §10. Code
lives in `scripts/line-ai-expense-advisor/`. It reuses the existing LINE AI replay machinery
(`scripts/line-ai-reliability-runtime.ts`, `-fixtures.ts`) for real-mode execution, and reuses the
production permission/entitlement registries (`ROLE_GRANTS`, `SYSTEM_ROLES`, `PERMISSIONS`,
`TIER_FEATURE_PRESETS`) for seeding — never a hand-written permission union.

## Files

| File | Purpose |
|---|---|
| `period.ts` | Resolves a relative period token (`today`, `this_month`, `last_month`, `this_month_to_date`) against a run-time clock, using the same civil-date rules the ERP tools use. |
| `types.ts` | The corpus JSON format (types) and its structural validator, `validateCorpus`. |
| `seed.ts` | Builds a Starter-realistic (company A) / Pro-realistic (company B) row set — permissions, roles, entitlements, branches, 5 role users with LINE identities, ≥30 expenses/company, ≥6 reimbursements/company — all dated relative to the run clock. |
| `oracle.ts` | Boots the compiled API as a Nest application context (no HTTP, no gateway) and runs a gold tool call through the SAME tool classes `InternalToolsController` dispatches to, with a really-resolved actor context. Also resolves `$period`/`$fromShownItems` markers and extracts expected facts from a `ToolResult`. |
| `scorer.ts` | Pure, model-free scoring: tool/input equivalence (period-aware), fact-in-text checks (Thai amount formatting), and the 6 turn tags. Unit-tested with fake evidence. |
| `corpus.sample.json` | 20 turns across 8 conversations covering spec §3 rows 1, 2, 3, 4, 7, 8, 10, 15, 17, 18 (plus 11 and 19 as a bonus), all 5 roles, both companies, and one 4-turn memory chain. |
| `run-preflight.ts` | CLI: create/migrate the eval DB if needed, seed it, run every gold call through the oracle, print a coverage summary. No gateway, no model. |
| `run-real.ts` | CLI (implemented, **not executed** by this delivery): runs the corpus through a real, already-listening gateway via `runLineReliabilityRuntime`, scores with `scorer.ts`, writes JSON evidence + a markdown report. |
| `launch-gateway.mjs` | Spawns the compiled AI Gateway with this harness's own DB/Redis/ports (**not executed** by this delivery). |
| `types.spec.ts`, `scorer.spec.ts` | `node:test` unit tests for the validator and the scorer, registered in `scripts/line-ai-whole-chain-acceptance.catalog.mjs`'s `reliability-contracts-evaluation-v2` group. |

## Running preflight (no model, no gateway)

```bash
pnpm --filter @watchdog-bms/contracts build   # first time only; run-preflight.ts also builds the API
node_modules/.bin/tsx scripts/line-ai-expense-advisor/run-preflight.ts
```

Env (all optional, shown with defaults):

```
MANGMEE_EVAL_SECRETS_PATH=/tmp/mangmee-latency-pilot-20260927/runtime-secrets.json
MANGMEE_EVAL_REDIS_URL=redis://127.0.0.1:16389/13
MANGMEE_EVAL_CORPUS=scripts/line-ai-expense-advisor/corpus.sample.json
MANGMEE_EVAL_SKIP_BUILD=false   # set true to skip `pnpm build` when dist is already fresh
```

What it does, in order: reads `runtime-secrets.json` for the admin Postgres URL (never printed);
creates `watchdog_ai_reliability_replay_expense_advisor` if missing; runs `prisma migrate deploy`;
builds `@watchdog-bms/api` and its workspace dependencies if the compiled entry is missing;
truncates every table (idempotent re-run); seeds both companies; boots the compiled API as a Nest
application context; for every corpus turn with `expect.calls`, resolves period/shown-item markers
and calls the real tool with the conversation's real actor; prints a JSON coverage summary
(`dataTurns`, `tagOnlyTurns`, `hardErrors`, `factsExtracted`, per-category and per-tool-status
breakdowns, and full error detail for any hard failure). Exits non-zero only on a hard failure
(an unhandled exception from a tool call) — a tool returning `forbidden`/`error` is reported, not
treated as a crash, since some corpus turns (row 18, out-of-permission) expect exactly that.

Last verified run: 16/16 data turns executed with zero hard errors, all 16 tool calls returned
`status: "ok"`, 82 facts extracted, every one of the 10 required spec §3 rows covered — see the
commit this file ships with.

## Running real mode (real model calls — NOT run by this delivery)

```bash
# 1. terminal A — leave running
AWS_PROFILE=<your profile> node scripts/line-ai-expense-advisor/launch-gateway.mjs

# 2. terminal B — once the gateway is listening
MANGMEE_EVAL_OUTPUT_DIR=/path/to/output \
MANGMEE_EVAL_GATEWAY_URL=http://127.0.0.1:19205/v1 \
node_modules/.bin/tsx scripts/line-ai-expense-advisor/run-real.ts
```

Both required env vars are validated with an assertion before anything else runs. Optional env
(shared with preflight where the name matches, plus):

```
MANGMEE_EVAL_API_PORT=19291                          # must match between the two scripts
MANGMEE_EVAL_DETERMINISTIC_RESPONSE_FAMILIES=<spec §5 R-L4 family list>
```

Writes `<ISO-timestamp>.evidence.json` (full `turnEvidence`, per-turn scores, summary) and
`<ISO-timestamp>.report.md` (summary table, per-category table, a failures section with the
transcript-so-far and gold `expect` for every failed turn) into `MANGMEE_EVAL_OUTPUT_DIR`.

`run-real.ts` seeds the SAME two companies preflight uses, but builds one `RuntimeSourceSnapshot`
per (company, role) actually used by the corpus — `runLineReliabilityRuntime` truncates and
reseeds the whole database between every conversation, and a snapshot's `lineUserId` has to be
that one conversation's own actor.

## Corpus format

```jsonc
{
  "version": 1,
  "conversations": [
    {
      "id": "A-owner-monthly-flow",
      "company": "A",        // "A" = STARTER_249, one branch; "B" = PRO_999, two branches
      "role": "OWNER",        // OWNER | MANAGER | STAFF | ACCOUNTANT | AUDITOR_READONLY
      "turns": [
        {
          "user": "เดือนนี้จ่ายไปเท่าไหร่แล้วคะ",
          "category": "1",               // spec §3 row number, or a free tag for a non-row case
          "language": ["th"],             // th | th-misspelled | th-spoken | en-mixed | ...
          "expect": {
            "calls": [
              {
                "tool": "expense.list_recent",
                "input": { "period": { "$period": "this_month_to_date" } }
              }
            ]
            // "tags" may also/instead appear here — see below.
          }
        }
      ]
    }
  ]
}
```

A turn's `expect` needs at least one of:

- **`calls`** — one or more gold `{tool, input}` pairs. Every one must be matched by some actual
  tool call (R-U4: several questions in one turn need several calls, all present). `input` values
  are plain JSON EXCEPT two markers, both resolved at run time, never baked in as literal dates or
  ids:
  - `{ "$period": "today" | "this_month" | "last_month" | "this_month_to_date" }` on any key —
    resolves to `fromDate`/`toDate` civil dates and is spread into the call (not nested under the
    marker's own key). `this_month_to_date` is the tool's own default (current month up to today);
    plain `this_month` is the full calendar month (mainly useful for a fully-past month).
  - `{ "$fromShownItems": <index> }` — the id of the item at that 0-based index in the immediately
    preceding data turn's shown list (spec §4 R-M1 memory: "รายการแรก" → index 0).
  - `alternatives`: an array of other `{tool, input}` shapes that would equally correctly answer
    the same question.
- **`tags`** — `no_tool`, `must_answer`, `must_not_refuse` (booleans), `must_mention_any`,
  `must_not_claim`, `forbidden_tools` (string arrays, substring/exact-name checks against the
  delivered text or the captured tool-call list).

A turn may set both (e.g. row 18, out-of-permission: the tool call IS made — the role's own
`expense.read_own` scope is what narrows the answer — while a tag additionally requires the reply
not to overclaim).

## Known limitations / what blocked or shaped this build

- **Runtime coupling to a heavier corpus shape.** `runLineReliabilityRuntime` validates its
  `manifest.corpus` as a full v2.4 `ReliabilityFixture[]` (capabilities `C01`-`C18`, financial-fact
  oracles, required/forbidden effects, delivery-batch bookkeeping) — built for a different, paired
  A/B/C acceptance harness. `run-real.ts` maps this corpus's simpler `expect` into that shape with
  permissive placeholders (`capabilities: ['C01']`, empty `requiredFacts`/`requiredEffects`, a wide
  `outcomes` set) and does NOT use that shape's own `scoreReliabilityTrace` — this corpus's
  `scorer.ts` scores the raw `turnEvidence` instead. The `capabilities` placeholder in particular
  is honest filler, not a real taxonomy mapping; spec §3's row numbers and this corpus's
  `category` field are the real classification.
- **Multi-role/multi-company in one run.** Each `RuntimeSourceSnapshot` resets and reseeds the
  whole database (`resetRuntimeFixtureDatabase`), so a single seed cannot literally serve two
  companies or two actors mid-run. Worked around by making the row-set generator
  (`buildCompanySeed`) reusable per company, called once per (company, role) pair needed —
  preflight applies it directly with no reset (one shared DB); real mode builds one snapshot per
  pair, each carrying the full row set.
- **`ALL_BRANCHES` membership scope is unusable in real mode.** The resolver returns `undefined`
  branch ids for it, and `runLineReliabilityRuntime`'s fixture/access equality assertion spreads
  `access.scopes.branchIds` unconditionally — `[...undefined]` throws. Seeding uses
  `SELECTED_BRANCHES` with an explicit scope over every branch instead (functionally identical for
  this seed, since every branch belongs to the company anyway).
- **A `ReimbursementRequest` insert auto-creates its own compatibility line.** Migration
  `20260804150000_reimbursement_line_compatibility` installs an `AFTER INSERT` trigger
  (`ReimbursementRequest_fallback_line`) that inserts one `ReimbursementLine` (`id`
  `rbl_<requestId>`, `lineNo` 1) from the request's own header fields. `seed.ts` does not insert a
  line row itself — an explicit one collides with the trigger's on the same
  `(reimbursementRequestId, lineNo)` unique index.
- **Reimbursement tools in the oracle.** `reimbursement.list_pending_approvals` and
  `reimbursement.get_summary` both take no meaningful input (`execute(ctx)` / `execute(ctx, _)`),
  so their gold `input` is always `{}`; the oracle runs them exactly like the read tools.
  `reimbursement.get_summary`'s exact output shape was not inspected in source, so
  `extractExpectedFacts` falls back to a generic numeric-field scan (any `amount`/`total`/`count`
  -looking key) for it instead of a hand-mapped one.
- **Buddhist-year phrasing (spec §7 R-U3).** The sample corpus does not include an absolute
  Buddhist-year turn (e.g. "สิงหาคม 2569"), because an absolute month baked into a "runs on any
  future date" corpus eventually goes stale. The format has no blocker for it — a turn's `user`
  text is free text — but the 200-turn corpus should either author it close to its run date or the
  format should grow an explicit (non-relative) period marker if it needs to outlive that.

## Unit tests

```bash
node_modules/.bin/tsx --test scripts/line-ai-expense-advisor/types.spec.ts scripts/line-ai-expense-advisor/scorer.spec.ts
```

(`scorer.spec.ts` imports the real `resolveBusinessReadPeriod`, so `packages/contracts` must be
built first — see the preflight command above.)
