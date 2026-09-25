# Agent Memory: LINE AI multi-month expense answer, 2026-09-25

Status: Implemented and locally verified; UAT/Production rollout pending.
Owner: Codex
Scope: Production incident for บริษัท มั่งมียั่งยืน จำกัด; LINE AI expense questions naming July and August; AgentCore transport and nearby period/expense modules.

Decisions:
- Use the existing permission-checked `expense.list_recent` and document-date filter. No data migration or new tool.
- Preserve validated date candidates through the Gateway/AgentCore boundary. Admit the observed `กรกฏาคม` spelling in the shared month parser.
- Admit punctuation-free Thai month abbreviations only after `เดือน` or a clear token boundary; the generic month regex still excludes them to avoid false March matches inside `มีค่าใช้จ่าย`.
- Follow-up: a clear full Thai month name one Unicode character from exactly one calendar month is interpreted with an audit assumption and visible label. An unresolved `เดือน...` or separated full month-like word in a business read asks for the month before any tool call, including the prepared lane; ordinary relative expressions remain unchanged.
- Numeric/English month follow-up: parse numbered calendar months 1–12 (including a one-prefix list) and all twelve English month abbreviations. Preserve up to twelve period candidates so a full-year month list cannot silently lose the final four; the existing tool budget can still leave later months explicitly incomplete. Bare `may` remains ambiguous as an English verb; `เดือน May`, `month May`, or `May 2025` resolves it. Invalid numeric months ask before a business read.
- For one expense intent with multiple resolved months, complete missing monthly reads within the existing tool budget and same resolved branch. Render each month from echoed tool data; show an explicit incomplete state for failed or truncated reads.
- A one-call prepared plan cannot serve a multi-month expense answer and falls back before any prepared tool call.

Impact and module audit:
- API `process-line-webhook` already computes candidates once. Its ledger stores and replays them; the API `expense.list_recent` uses `ListExpensesUseCase` with `fromDate/toDate`, which filters `expenseDate`, not upload/creation time. It excludes REJECTED and VOIDED from money/count and marks page-cap truncation.
- The missing wire field affected all AgentCore date-sensitive reads (sales, expense, accounting, tax, CRM), not only expenses. Preserving it improves their date guards; the deterministic all-month completion is scoped to `expense.list_recent`. Other multi-period business intents still depend on the existing model/coverage critic and need separate product rules before automatic multi-tool completion.
- LINE's generic expense source link opens the list at its current selected month. The multi-month answer labels the action as choosing a month in the web list; no automatic two-month web selection exists.
- This code changes neither stored expense dates nor the recently merged web document-date filter. `main`/`develop` merge does not deploy Production.

Open questions: Historical exact August total at 10:50 cannot be reconstructed from the later live row statuses; UAT should compare the answer to current tool results at test time.

Artifacts: `docs/agent-memory/prod-mangmee-two-month-expense-answer-2026-09-25.md`; `docs/specs/line-ai-period-resolution-spec-th.md`; focused contract, Gateway, AgentCore, and ERP tool tests.

Verification:
- Contract normalizer: 116/116, including the exact two-month Production wording, spelling and bounded punctuation-free abbreviations.
- AI Gateway / AgentCore focused and adjacent suites: 188/188, including one-model-call completion, resolved branch reuse, incomplete August on tool failure or budget exhaustion, unresolved branch, prepared-lane fallback, and wire round-trip.
- ERP expense/business tool suites: 48/48 after generating the local Prisma client; confirmed document-date range, status exclusions, branch resolution, and truncation behavior. The first attempt could not load the absent generated Prisma client; generation resolved that setup issue.
- `pnpm --filter @watchdog-bms/contracts build`, `pnpm --filter @watchdog-bms/ai-gateway typecheck`, and `build:agentcore` passed (the standalone build required building the workspace config package first). `git diff --check` passed.
- Month-typo follow-up: contracts full suite 330/330, AI Gateway full suite 1,267/1,267, contracts build, Gateway typecheck and AgentCore build passed. Tests include unique typo recovery, visible correction, an unclear first or second month with zero ERP calls even when a prepared read is present, shorthand, and relative-month regressions.
- Bare-name follow-up: normalizer 117/117, model-loop 13/13, contracts build, Gateway typecheck and diff check passed; a separated two-edit month typo without `เดือน` asks instead of reading the known month alone.
- Numbered-month follow-up: normalizer table checks all twelve numbered months and Jan–Dec in both explicit-year and latest-past forms, plus multi-month `เดือน 1 2 3`, Thai digits, and invalid 13. Model-loop integration checks three monthly ERP reads, a twelve-month request that explicitly marks months after the eight-call budget incomplete, and zero calls for invalid 13 or an explicit future month; unresolved numeric copy requests the month/year again. Contracts full suite 331/331, Gateway full suite 1,267/1,267, contracts build, Gateway typecheck, AgentCore build, and diff check passed.
- No live LINE canary, Production data mutation, or deployment in this implementation.

Next: Production rollout follows `docs/runbooks/uat-production-v2-deployment.md` separately, with a live LINE canary comparing each month to current tool output.
