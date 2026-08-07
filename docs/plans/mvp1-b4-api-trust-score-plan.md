# MVP1 B4-API: Deterministic Trust Score + Hourly Scan — Implementation Plan

Status: Implement-ready 2026-07-09 (Dev B lane). Written for execution by a coding agent (Codex CLI) under harness supervision.
Scope: parallel-plan item **B6** ([[plans/mvp-1-two-dev-parallel-plan]]) = design doc "B4 API" ([[agent-memory/crm-customer-ai-agent-family]] §"Trust-Score Computation (B4) — DETERMINISTIC").
Authority: [[specs/crm-line-oa-customer-os-spec]] **§27** (supersedes §24's LLM-scored trust): score = deterministic API formula; an LLM number never feeds a gate; sole consumer of `>80` is the future 8C booking gate.

## Goal

Every qualifying `CrmCustomer` gets a stored `trustScore` (0..100 int) + factor breakdown JSON + timestamp, computed by a pure deterministic formula from CRM facts, refreshed by an hourly worker scan through a worker-token-protected internal API route. No LLM call anywhere in this slice.

## Hard rules

1. **File ownership**: in `apps/api/src/modules/crm-inbox/` only ADD new `crm-ai-*` files; `crm-inbox.module.ts` is append-only. Existing files (incl. `crm-internal.controller.ts`, `prisma-crm-inbox.repository.ts`) are Dev A's — copy patterns, never edit. `crm-ai-context.repository.ts` and other `crm-ai-*` files are Dev B's — extending them is allowed.
2. **Workers app is cross-lane** (announced in the parallel plan): you may ADD `apps/workers/src/modules/crm-inbox/crm-trust-worker.ts` and APPEND (import + start call + log line) to `apps/workers/src/main.ts`. Nothing else in apps/workers.
3. **Queue isolation (silent-failure trap)**: the existing `crm-sla-worker` owns queue `crm-inbox` and its processor ignores unknown `kind`s — a second worker on that queue would steal each other's jobs silently. Use a NEW BullMQ queue **`crm-trust`** with its own Worker.
4. **Deterministic only**: no gateway/LLM call, no `Math.random`, no keyword lists. `CrmTrustScoreAgent` narrative is explicitly OUT (first cut per §27).
5. **Advisory convention**: nothing may branch on `trustScore` in this slice (the `>80` consumer arrives in 8C). No audit rows — mirrors the `leadScore`/insights advisory-write precedent (decided deviation from the pre-§27 "store + audit" line).
6. Migration additive only, timestamp after `20260709190000_crm_ai_assist_feedback_summary_cache`.
7. Do NOT edit docs/ (harness records evidence). Do NOT git commit or git add.

## Environment quirks

Same as [[plans/mvp1-b5-api-staff-assist-plan]]: Node via `export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"`; prisma CLI needs explicit DATABASE_URL (apps/api/.env is stale — harness runs deploy/generate); `apps/api/package.json` test list is explicit (append new specs; keep `tsx --test` prefix); if tsx IPC fails in sandbox, verify ad-hoc with `node --import tsx --test <files>` but leave package.json alone.

## Work items

### W1 — Migration (additive)

`apps/api/prisma/schema.prisma`, on `CrmCustomer` directly under the existing item-15A advisory block (`leadScore` … `lifetimeValueUpdatedAt`), keeping the same "advisory" spirit but with its own comment:

```prisma
  // MVP1-4 B4 trust score (spec §27): deterministic API formula over stored facts.
  // Advisory here; the ONLY permitted gate consumer is the 8C booking gate (>80).
  trustScore             Int?
  trustScoreFactorsJson  Json?
  trustScoreComputedAt   DateTime?
```

New folder `apps/api/prisma/migrations/20260709230000_crm_customer_trust_score/migration.sql`, house style:

```sql
-- AlterTable
ALTER TABLE "CrmCustomer" ADD COLUMN "trustScore" INTEGER,
ADD COLUMN "trustScoreFactorsJson" JSONB,
ADD COLUMN "trustScoreComputedAt" TIMESTAMP(3);
```

Plus a partial index the scan needs: `CREATE INDEX "CrmCustomer_trustScoreComputedAt_idx" ON "CrmCustomer"("trustScoreComputedAt");` (and mirror `@@index([trustScoreComputedAt])` in the model). Syntax check: `DATABASE_URL='postgresql://x:x@localhost:5432/x' pnpm --filter @watchdog-bms/api exec prisma validate`. Harness applies it.

### W2 — Pure formula logic (new `apps/api/src/modules/crm-inbox/domain/logic/crm-ai-trust.logic.ts`)

Pure module, zero imports beyond types. Exported single source of weights:

```ts
export const TRUST_WEIGHTS = {
  base: 50,
  tenure30d: 5, tenure90d: 10,          // createdAt age; 90d supersedes 30d (not additive)
  lineLinked: 10,                        // CORRECTED 2026-07-09 (xhigh review F1): a DELIBERATE verified link (CrmChannelIdentity.verifiedLinkAt set via LIFF/staff-link) — NOT CrmCustomer.lineUserId, which the webhook auto-sets for every chat customer
  consentGranted: 10,                    // consentStatus === 'GRANTED'
  financialIdentity: 10,                 // accountingCounterpartyId set
  engagementPerMessage: 1, engagementCap: 10, // inbound messages, last 30d
  keptAppointment: 15, keptAppointmentCap: 30, // 0 until A7 exists
  noShow: -20,                           // per no-show in 90d, uncapped
} as const;

export type CrmTrustSignals = {
  tenureDays: number;
  lineLinked: boolean;
  consentGranted: boolean;
  financialIdentity: boolean;
  inboundMessages30d: number;
  keptAppointments: number; // pass 0 until A7
  noShows90d: number;       // pass 0 until A7
};

export type CrmTrustFactor = { key: string; points: number };
export function computeTrustScore(signals: CrmTrustSignals): { score: number; factors: CrmTrustFactor[] };
```

Rules: factors array lists every non-zero contribution (plus `base`); `score` = clamp(round(sum), 0, 100); negative inputs treated as 0 (defensive). **Load-bearing arithmetic property: base(50) + tenure90d(10) + consentGranted(10) + engagementCap(10) = 80 exactly — the chat-only ceiling. Do not "fix" weights to change this.**

### W3 — Logic spec (new `domain/logic/crm-ai-trust.logic.spec.ts`)

Property tests (node:test + assert, house style):
1. **Chat-only ceiling**: maximal chat-only signals (tenureDays 9999, consentGranted, inboundMessages30d 9999, all identity/appointment fields false/0) → score === **80 exactly**.
2. **Exhaustive chat-only sweep**: for every combination of tenureDays ∈ {0,29,30,89,90,9999} × consentGranted ∈ {t,f} × inboundMessages30d ∈ {0..12}, score ≤ 80 — the strict `>80` gate is uncrossable by chat alone.
3. **Identity/real-world unlock** *(CORRECTED 2026-07-09 per xhigh review F1 + spec §27 conjunction — superseded by [[plans/mvp1-b-review-fix-plan]] Stage 2)*: crossing >80 requires verified identity AND ≥1 real-world event. Chat-only max + lineLinked alone → **clamped to 80** (clamp factor present); + financialIdentity or kept appointment → may cross.
4. Tenure tiers not additive (90d gives +10 total, not +15); engagement caps at +10; kept appointments cap at +30.
5. No-shows: chat-max + 4 no-shows → clamped 0 (floor).
6. Factors: sum of `points` === pre-clamp score; every factor key unique; integer score; negative inputs (e.g. inboundMessages30d: -5) treated as 0.

### W4 — Signals + persistence (extend `infrastructure/crm-ai-context.repository.ts`, Dev B file)

- `findTrustScanCandidates(now: Date, limit = 50)`: customers with (`trustScore IS NULL` AND ≥3 INBOUND `CrmMessage` in last 30d via their conversations) OR (`trustScoreComputedAt` < now − 30d), ordered `trustScoreComputedAt ASC NULLS FIRST`, returning `{id, companyId}`.
- `getTrustSignals(companyId, customerId, now)`: from `CrmCustomer` (createdAt → tenureDays, lineUserId, consentStatus, accountingCounterpartyId) + INBOUND message count last 30d (join `CrmConversation` on customerId, `CrmMessage.direction='INBOUND'`, createdAt ≥ now−30d). `keptAppointments`/`noShows90d` hardcoded 0 with a `// until A7` comment.
- `saveTrustScore(companyId, customerId, score, factors, at)`: update guarded by `{ id, companyId }` (tenant scope).

### W5 — Scan use-case (new `application/use-cases/crm-ai-trust.use-case.ts`)

`ScanCrmTrustScoresUseCase.execute(now = new Date())`: candidates (≤50) → per candidate `getTrustSignals` → `computeTrustScore` → `saveTrustScore`; per-candidate try/catch (one bad row must not kill the batch; count errors); returns `{ scanned, updated, failed }`; one JSON log line (mirror SLA scanner's logging style). No permission ctx — worker-token gate lives at the controller (mirror `ScanCrmSlaBreachesUseCase`).

### W6 — Internal route (new `presentation/http/crm-ai-internal.controller.ts`)

Copy `crm-internal.controller.ts` verbatim-pattern: `@Public() @Controller('internal/crm')`, `@Post('trust-score-scan')`, `X-Worker-Token` vs `process.env['WORKER_INTERNAL_TOKEN']`, `UnauthorizedException` on mismatch, delegates to the use-case. Do NOT edit the existing controller.

### W7 — Worker (new `apps/workers/src/modules/crm-inbox/crm-trust-worker.ts` + main.ts append)

Mirror `crm-sla-worker.ts` exactly but: queue **`crm-trust`**, payload kind `trust.scan`, `jobId: 'crm-trust-score-scan'`, `repeat: { every: 3_600_000 }` (hourly), POST `${INTERNAL_API_URL}/internal/crm/trust-score-scan`. Export `startCrmTrustWorker(redisUrl)`. In `main.ts`: append import + `startCrmTrustWorker(config.REDIS_URL);` + `crm_trust_worker_started` log line inside the same `QUEUE_ENABLED` block, after the SLA worker lines. Touch nothing else.

### W8 — Wiring + specs

- `crm-inbox.module.ts` append-only: `CrmAiInternalController` to controllers, `ScanCrmTrustScoresUseCase` to providers (under the existing `// MVP1-4 B5` comment block, extend comment to B4/B5).
- New `application/use-cases/crm-ai-trust.use-case.spec.ts` (mock repository): scan maps candidates→signals→formula→save with correct args; batch respects limit 50; one candidate throwing → others still saved, `failed` counted; empty candidates → `{0,0,0}`; saved factors JSON equals `computeTrustScore` output.
- Append the 2 new spec files to `apps/api/package.json` test list (keep `tsx --test` prefix).

## Verification (Codex runs; harness re-runs + applies migration)

```bash
export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"
DATABASE_URL='postgresql://x:x@localhost:5432/x' pnpm --filter @watchdog-bms/api exec prisma validate
pnpm --filter @watchdog-bms/api typecheck        # after harness runs prisma generate; in-sandbox may defer W4 typecheck to harness if client lacks new fields
node --import tsx --test <the two new spec files>
pnpm --filter @watchdog-bms/workers typecheck
git diff --check
```

## Done criteria

- Chat-only-ceiling property tests green (the §27 hard property is executable, not prose).
- Full api suite green (existing 1173 + new), workers typecheck green, migration applied by harness.
- `crm-trust` queue isolated from `crm-inbox`; internal route worker-token-gated; nothing branches on the stored score.

## Out of scope

Gateway narrative call, recompute-after-booking (8C), appointment signals (A7), web tier labels/UI (H1), auto-reply gate chain (B7 — reads nothing from this slice yet), audit rows, any doc edits.
