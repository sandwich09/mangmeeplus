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
| `template.ts` | Renders `{{placeholder}}` absolute-date markers in a turn's `user` text (month names, Buddhist years) from the same run-time clock — used identically by `run-preflight.ts` and `run-real.ts`. |
| `types.ts` | The corpus JSON format (types) and its structural validator, `validateCorpus`. |
| `seed.ts` | Builds a Starter-realistic (company A) / Pro-realistic (company B) row set — permissions, roles, entitlements, branches, 5 role users with LINE identities, ≥30 expenses/company, ≥6 reimbursements/company — all dated relative to the run clock. Also exports `truncateAllTables` (idempotent re-run support, shared by both runners). |
| `oracle.ts` | Boots the compiled API as a Nest application context (no HTTP, no gateway) and runs a gold tool call through the SAME tool classes `InternalToolsController` dispatches to, with a really-resolved actor context. Also resolves `$period`/`$fromShownItems` markers, extracts the REQUIRED facts for a call's answer shape, and detects an ambiguous/not-found category/vendor/branch outcome. |
| `scorer.ts` | Pure, model-free scoring: tool/input equivalence (period-aware; category/vendor/branch names judged by what the API RESOLVED, not raw text), fact-in-text checks (Thai amount formatting), and the 7 turn tags. Unit-tested with fake evidence. |
| `corpus.sample.json` | 20 turns across 8 conversations covering spec §3 rows 1, 2, 3, 4, 7, 8, 10, 15, 17, 18 (plus 11 and 19 as a bonus), all 5 roles, both companies, and one 4-turn memory chain. |
| `run-preflight.ts` | CLI: create/migrate the eval DB if needed, seed it, run every gold call through the oracle, print a coverage summary. No gateway, no model. |
| `run-real.ts` | CLI (implemented, **not executed** by this delivery): runs the corpus through a real, already-listening gateway via `runLineReliabilityRuntime`, scores with `scorer.ts`, writes JSON evidence + a markdown report (`report.ts`). |
| `gold-oracle-pass.ts` | The oracle pass itself (DB truncate+seed, run every gold call, resolve `$period`/`$fromShownItems`) plus the shared scoring loop (`scoreAllTurns`, `toCapturedEvidence`) — split out of `run-real.ts` so `run-rescore.ts` runs the EXACT same code, never a second copy that could silently drift. |
| `run-rescore.ts` | CLI: re-score a saved `*.evidence.json` against the CURRENT corpus/scorer, with no gateway and no model call — re-runs only `gold-oracle-pass.ts`'s oracle pass (at the ORIGINAL run's clock, from the evidence's own `startedAt`) and writes a new report next to the input file. For confirming a scorer/corpus fix without re-paying for Bedrock calls. |
| `report.ts` | Pure markdown report builder (split out of `run-real.ts` so it is unit-testable without that script's side effects): per failing turn, the transcript so far with each turn's delivered reply (Flex altText/text, truncated to ~600 chars), the tools called with their inputs, and the Gateway's semantic coverage status/reasonCode. Also renders the subset-run and rescore banners. |
| `launch-gateway.mjs` | Spawns the compiled AI Gateway with this harness's own DB/Redis/ports (**not executed** by this delivery). |
| `types.spec.ts`, `scorer.spec.ts`, `template.spec.ts`, `report.spec.ts`, `oracle.spec.ts`, `run-rescore.spec.ts` | `node:test` unit tests for the validator, the scorer, the placeholder renderer, the report builder, `resolveGoldCallInput`/fact-category selection, and the rescorer's pure parts — registered in `scripts/line-ai-whole-chain-acceptance.catalog.mjs`'s `reliability-contracts-evaluation-v2` group. |

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
MANGMEE_EVAL_TURN_PAUSE_MS=1500                      # sleep between turns of one conversation
MANGMEE_EVAL_CONVERSATION_PAUSE_MS=2000              # sleep between conversations
```

### Pacing (throttling)

`run-real.ts` defaults `MANGMEE_EVAL_TURN_PAUSE_MS` to 1500 and
`MANGMEE_EVAL_CONVERSATION_PAUSE_MS` to 2000 (override either to change the pace, or set to `0` to
run flat out) to stay under the Bedrock account's rate limit. `replayReliabilityCorpus` (shared by
every reliability replay, not only this eval) has no hook a caller can pause in between its
turn/fixture loop iterations, so the pause lives one level down, inside
`scripts/line-ai-reliability-runtime.ts`'s own `reset`/`turn` adapter methods — `reset` (once per
conversation, skipped on the very first) sleeps `MANGMEE_EVAL_CONVERSATION_PAUSE_MS`, `turn` (once
per turn after the first in that conversation) sleeps `MANGMEE_EVAL_TURN_PAUSE_MS`. Both env vars
default to `0` (off) inside that shared file, so every other caller of
`runLineReliabilityRuntime` that never sets them is unaffected.

### Re-running a subset

To confirm a fix without paying for (and waiting on) the whole corpus again, `run-real.ts` accepts
`MANGMEE_EVAL_ONLY`, in either of two forms:

```bash
# a comma-separated list of conversation ids
MANGMEE_EVAL_ONLY=A-owner-monthly-flow,B-manager-approvals ... run-real.ts

# every conversation that had a failing turn in a previous run's evidence.json
MANGMEE_EVAL_ONLY=/path/to/previous.evidence.json MANGMEE_EVAL_ONLY_FAILED=1 ... run-real.ts
```

Selection is always by WHOLE conversation (`types.ts` `selectConversations`/
`parseFailedConversationIds`) — a follow-up turn needs its own history, so re-running a single turn
in isolation is never offered. An id that does not exist in the corpus throws immediately, rather
than silently running fewer conversations than asked for. Both the console `real_run_start` line,
the written `evidence.json`, and the `.report.md` (a `> **Subset run — not the full corpus.**`
line right under the header) say when a run is a subset, and of what — never indistinguishable
from a full run.

Writes `<ISO-timestamp>.evidence.json` (full `turnEvidence`, per-turn scores, summary) and
`<ISO-timestamp>.report.md` (summary table, per-category table, a failures section with the
transcript-so-far and gold `expect` for every failed turn) into `MANGMEE_EVAL_OUTPUT_DIR`.

`run-real.ts` seeds the SAME two companies preflight uses, but builds one `RuntimeSourceSnapshot`
per (company, role) actually used by the corpus — `runLineReliabilityRuntime` truncates and
reseeds the whole database between every conversation, and a snapshot's `lineUserId` has to be
that one conversation's own actor.

Before starting that live replay, `run-real.ts` runs its OWN oracle pass over the same corpus
(truncate, seed, run every gold call — same code preflight uses, then fully closed) so the
required facts and the category/vendor/branch resolution it scores against always come from the
GOLD call's real result, never from re-using the model's own (possibly wrong) one. Running it
first, and closing it before the live replay opens its own Nest app / fetch patch, keeps the two
completely non-overlapping.

## Offline rescore (no model calls)

A scorer or corpus fix should be confirmed against a REAL captured run without paying for Bedrock
again — the model's replies do not change, only how correctly they get scored. `run-rescore.ts`
does exactly that:

```bash
MANGMEE_EVAL_EVIDENCE=/path/to/previous.evidence.json \
node_modules/.bin/tsx scripts/line-ai-expense-advisor/run-rescore.ts
```

It re-runs ONLY `gold-oracle-pass.ts`'s oracle pass (DB truncate+seed, the compiled API as an
in-process application context) — no gateway, no LINE webhook, no model — against the CURRENT
`MANGMEE_EVAL_CORPUS`, at the clock the ORIGINAL run used (the saved evidence's own `startedAt`,
never today's real time: a gold fact like "this month's total" is only comparable to what the
model actually saw if the re-seed reproduces the SAME civil date), then re-scores the saved
`turnEvidence` with the CURRENT `scorer.ts` and writes `<original-name>.rescore-<timestamp>.report.md`
next to the input file (never overwriting it).

The saved evidence must come from the SAME corpus conversations, matched by id: every
`turnEvidence[].scenarioId` must still name a conversation, by id, in the current corpus
(`selectConversations`'s own check, reused) — a renamed/removed conversation fails loudly rather
than silently scoring fewer turns than the evidence actually has. The written report says plainly
that it is a rescore, and of which original run (`rescoredFrom` in `report.ts`).

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
  - `categoryName`/`vendorName`/a `branchId` that is actually a name (e.g. `"สาขาสีลม"`) are plain
    strings, but are matched by what the API RESOLVED them to, never by raw text — see "Category/
    vendor/branch name equivalence" below.
  - `answerShape` (one of `single_metric`, `breakdown`, `list`, `detail`, `pending_approvals`) and
    `groupBy` (one of `category` (default), `branch`, `vendor`, only for a `breakdown` call)
    override the per-tool default that decides which facts are REQUIRED — see "Required facts by
    answer shape" below. Most calls never need to set these; `expense.list_recent` is the one tool
    that answers as either `single_metric` (its default) or `list` (row 7, needs `"answerShape":
    "list"` in gold).
  - `alternatives`: an array of other `{tool, input}` shapes that would equally correctly answer
    the same question.
- **`tags`** — `no_tool`, `must_answer`, `must_not_refuse`, `must_ask_choice` (booleans),
  `must_mention_any`, `must_not_claim`, `forbidden_tools` (string arrays, substring/exact-name
  checks against the delivered text or the captured tool-call list). `must_ask_choice` is for a
  gold call whose category/vendor/branch resolves ambiguously or not at all (task item 3): the
  reply must name at least two of the offered choices and ask which one.

A turn may set both (e.g. row 18, out-of-permission: the tool call IS made — the role's own
`expense.read_own` scope is what narrows the answer — while a tag additionally requires the reply
not to overclaim).

## Absolute-date placeholders

A real customer types a month name or a Buddhist-era year ("สิงหาคม 2569"), never a relative
token — but the corpus itself must stay valid on any future run date (spec §7 R-U3). So a `user`
string never bakes in the literal words; it holds `{{placeholder}}` markers, filled in by
`template.ts`'s `renderUserText(text, now)` from the same Bangkok "today" every other part of this
harness uses. `run-preflight.ts` renders every turn's text (there is no model to send it to, but
this still proves every placeholder resolves before a real run pays for it); `run-real.ts` renders
it into the fixture's `turns[].user` before that text ever reaches the gateway, and again when
building a failed turn's transcript for the report — the same function, the same clock, in both.

`validateCorpus` rejects any `{{...}}` key that is not one of these:

| Placeholder | Example (today = 27 Sep 2026) |
|---|---|
| `{{this_month_th}}` | กันยายน |
| `{{last_month_th}}` | สิงหาคม |
| `{{this_month_abbr_th}}` | ก.ย. |
| `{{last_month_abbr_th}}` | ส.ค. |
| `{{this_be_year}}` | 2569 |
| `{{this_be_year_short}}` | 69 |
| `{{this_ce_year}}` | 2026 |
| `{{last_month_be_year}}` | 2569 (subtracts 1 from `this_be_year` only when "this month" is January — see `template.spec.ts`'s January case) |
| `{{today_day}}` | 27 (no zero-padding) |

## Required facts by answer shape

"Everything else about a result is optional and not checked" (task follow-up 2) — `oracle.ts`
extracts ONLY these, per the gold call's `answerShape` (default per tool: `expense.list_recent` →
`single_metric`, `expense.get_breakdown` → `breakdown`, `expense.get_detail`/
`reimbursement.get_detail` → `detail`, `reimbursement.list_pending_approvals` →
`pending_approvals`, `reimbursement.get_summary` → `single_metric`):

| Shape | Required facts | Notes |
|---|---|---|
| `single_metric` | the total, the item count | `reimbursement.get_summary`'s real shape (`GetReimbursementAiSummaryUseCase`, read from source) has no one total/count pair — `totalUnpaidAmount` and `pendingApprovalCount` are the closest real fields. |
| `breakdown` | the overall total, plus the top-3 groups' names and amounts | Top 3 from `byCategory` (default `groupBy`), `byBranch`, or `byVendor` (the new `{vendorId, vendor, currency, count, totalAmount, linked?}` group — read as soon as it is present, absent today without error). |
| `list` | the first 3 items' amounts and vendor names | An item with no vendor snapshot contributes only its amount. |
| `detail` | the amount, the date, the vendor | The date is matched WEAKLY (day-of-month digits only — this harness does not own the reply's Thai date formatting). A reimbursement claim has no vendor; its requester name is the closest identity fact. |
| `pending_approvals` | the count, the total | The tool has no separate aggregate amount (`erp-reimbursement-tools.use-case.ts`, read from source) — "the total" is the sum of the (already-capped-at-10) listed items' own amounts. |

An ambiguous/not-found result (see below) contributes NO facts — `must_ask_choice` covers that
shape instead.

### Narrowing a shape's default facts: `expect.requiredFacts` (task item 2)

The table above is each shape's DEFAULT — right for a turn that asks the shape's usual question,
too strict for a narrower follow-up. "รายการที่ 3 คือร้านอะไร" ("what's item 3?") only needs the
vendor; requiring the amount and date too (`detail`'s default) fails a correct reply that never
restates them. A turn's own `expect.requiredFacts` — an array of
`'amount'|'date'|'vendor'|'count'|'total'|'groups'|'items'|'status'` — REPLACES the shape's default
selection for that turn only:

```json
{ "user": "รายการที่ 3 คือร้านอะไรครับ", "category": "8",
  "expect": { "calls": [{ "tool": "expense.get_detail", "input": { "expenseId": { "$fromShownItems": 2 } } }] },
  "requiredFacts": ["vendor", "date"] }
```

Omit `requiredFacts` and a turn gets exactly the shape's own default, unchanged from before this
field existed. Each category maps onto the SAME facts the table above already describes
(`total`↔the overall/single total, `count`↔the item count, `groups`↔a breakdown's per-group
name+amount, `items`↔a list's per-item amount+vendor, `amount`/`date`/`vendor`↔a detail's three
default facts) plus one new one:

- **`status`** — `detail` only. Payment AND document status, each already mapped to EVERY Thai
  synonym a reply might use for that one value (`ExpenseStatus`/`ExpensePaymentStatus`/
  `ReimbursementRequestStatus`/`ReimbursementPaymentStatus`, `apps/api/prisma/schema.prisma`, read
  from source — e.g. `PAID` → `["จ่ายแล้ว","ชำระแล้ว"]`, never the raw enum; the plain-verb
  ("จ่าย...") and the contracts ("ชำระ...") wordings are both real, so `factInText` accepts either).
  Never part of `detail`'s default (adding it there would change existing behavior); only required
  when a turn's own `requiredFacts` names it, e.g. for "จ่ายหรือยัง": `"requiredFacts": ["status"]`.

### Equivalent tool for a total: `expense.get_breakdown` in place of `expense.list_recent`

`expense.list_recent` in its default (`single_metric`) shape asks "what's the total" —
`expense.get_breakdown` for the SAME resolved period/filters answers a strictly BIGGER question
(the total, broken down by category), so `scorer.ts`'s `scoreToolCalls` accepts it too, but only
when the reply actually states the gold total (`goldTotalAmountFact` + `factInText`) — calling a
different tool that never surfaces the number asked for is still a wrong answer. This is
deliberately NOT reversible: a `breakdown` gold call is never satisfied by a plain `list_recent`
actual call, because a total alone cannot answer "broken down by what".

## Category/vendor/branch name equivalence

The model may send `"น้ำมัน"` where gold says `"ค่าน้ำมัน"` — comparing that text would never
match, so a gold call naming a category, vendor, or branch (`categoryId`/`categoryName`,
`vendorId`/`vendorName`, or a `branchId` that is itself a name — branch names already resolve
today) is judged by what the API actually RESOLVED: `scorer.ts` reads
`queryApplied.filters.categoryId`/`vendorId` (or `queryApplied.branch.branchId`) off BOTH the
gold call's own oracle result and the model's captured result, and requires the same id. When
either side comes back `{categoryAmbiguous|...}` or `{categoryUnresolved|...}` (task item 3 — the
new output `expense.list_recent`/`get_breakdown` can return for the new `categoryName`/
`vendorName` inputs, mirroring the existing `branchAmbiguous`/`branchUnresolved` shape), the
comparison falls back to the OUTCOME KIND (ambiguous vs. unresolved vs. resolved) rather than an
id. `run-real.ts` supplies both sides' results (its own independent oracle pass — see below —
supplies gold's; the live replay's captured `ToolResult` supplies the model's); a bare unit test
with no results falls back to raw-text comparison, which is why `scorer.spec.ts` tests both paths.

`extractOfferedChoices` (`oracle.ts`) reads the offered `availableCategories`/`availableVendors`/
`availableBranches` names for the `must_ask_choice` tag ("the reply lists at least two of the
offered names and asks which one" — checked heuristically against a small set of Thai
disambiguation-question markers, same spirit as the existing refusal-marker heuristic).

Not exercised by the sample corpus: `categoryName`/`vendorName` resolution is Track C's work
(`claude/mangmee-ai-advisor-tools`), not yet merged into this worktree, so a live preflight run
never actually produces an ambiguous/unresolved category or vendor result today (`branchId`-by-
name already works and is exercised via the shared logic in `callMatchesGold`, just not by a
sample turn). `run-preflight.ts` still exercises the code path (`extractOfferedChoices` on every
captured "ok" result, counted as `choiceResultsSeen`) so it is proven not to throw ahead of that
merge, and `scorer.spec.ts` covers the matching/tag logic with fake ambiguous results.

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
  `reimbursement.get_detail` is also wired in (task follow-up 2), for the same reason. Every
  tool's real output shape is now read from source and mapped explicitly in `oracle.ts` (see
  "Required facts by answer shape" above); `scanNumericFacts`' generic scan is kept only as a
  last-resort fallback for a tool added to the roster before its own rule is.
- **Buddhist-year phrasing (spec §7 R-U3) — solved by templating, see below.** A `user` string
  never bakes in a literal month name or year; it uses `{{placeholder}}` markers instead, rendered
  at run time from the real Bangkok clock (see "Absolute-date placeholders"). Three sample turns
  now exercise this (`A-owner-payment-status` turns 1–2, `B-auditor-paraphrases` turn 1).

## Unit tests

```bash
node_modules/.bin/tsx --test scripts/line-ai-expense-advisor/types.spec.ts scripts/line-ai-expense-advisor/scorer.spec.ts scripts/line-ai-expense-advisor/template.spec.ts scripts/line-ai-expense-advisor/report.spec.ts scripts/line-ai-expense-advisor/oracle.spec.ts scripts/line-ai-expense-advisor/run-rescore.spec.ts
```

(`scorer.spec.ts` imports the real `resolveBusinessReadPeriod`, so `packages/contracts` must be
built first — see the preflight command above.)
