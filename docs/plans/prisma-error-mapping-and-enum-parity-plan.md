# Prisma Error Mapping + Enum Contract Parity — Implementation Plan

Spec: `docs/specs/platform-foundation-local-prod-lean-spec.md` §15 (addendum 2026-07-29).
Memory: `docs/agent-memory/prisma-error-mapping-and-enum-parity.md`.
Origin: UAT incident — `POST /procurement/suppliers` with `supplierType: "COMPANY"` → 500; point fix shipped in `84a76d9f` (supplier use-case enum checks + `as const` contract arrays). This plan delivers the API-wide backstop (change 1) and the drift guard (change 2). Documents-first lane wrote this; a separate coding lane implements. Ponytail full mode applies: shortest correct diff, existing patterns, no new dependencies.

Non-goals for this change: no DTO conversion of `@Body() body: any` endpoints (see Gap Analysis — separate, client-compat-affecting effort), no AI Gateway changes (no Prisma there), no Prisma migration, no deploy coupling.

Shared-worktree rules apply to the coding lane: never `git add -A`; re-read `apps/api/package.json` and `packages/contracts/package.json` immediately before editing (other sessions touch these); stage surgically.

## Phase 1 — Map Prisma errors to 4xx in the global filter

### Files

- Edit: `apps/api/src/common/filters/all-exceptions.filter.ts`
- New: `apps/api/src/common/filters/all-exceptions.filter.spec.ts`
- Edit: `apps/api/package.json` (append the new spec to the hand-maintained `test` file list — an unregistered spec silently never runs)

### Design (per spec §15.2–15.5)

1. Import the generated client namespace: `import { Prisma } from '../../generated/prisma/client';` (precedent for `common/` importing it: `apps/api/src/common/database/prisma.service.ts`). Detection is `instanceof` — never structural `err.code` sniffing in a filter that sees every exception.
2. Add a small pure translate function in the same file (no new files beyond the spec):
   - `exception instanceof Prisma.PrismaClientValidationError` → `new BadRequestException('Request shape or field values are invalid.')`
   - `exception instanceof Prisma.PrismaClientKnownRequestError`:
     - `code === 'P2002'` → `ConflictException` with the fixed duplicate message; when `Array.isArray(meta?.target)` append the column names (nothing else from meta)
     - `code === 'P2025'` → `NotFoundException('Record not found.')`
     - `code === 'P2003'` → `ConflictException('Operation conflicts with related records: a referenced record is missing or this record is still referenced.')`
     - any other code → `null` (falls through to 500)
   - anything else → `null`
3. In `catch()`: translate first. If translated: one `this.logger.warn({ requestId, method, path, prismaCode, target }, 'prisma client error mapped to 4xx')` (prismaCode = `P2xxx` or `'validation'`; target only when a string array), then `super.catch(translatedHttpException, host)` — passing the *translated* exception makes Nest render a normal HttpException response and skips the ExceptionsHandler 500 path. If not translated: existing code path **byte-for-byte** (status computation, enriched 5xx `logger.error`, `super.catch(exception, host)`).
4. Do not echo `exception.message` of `PrismaClientValidationError` anywhere in the response — it contains the query/argument dump (request payload data). Fixed constants only.
5. Update the file-top comment block (it currently documents "4xx stay quiet; only adds 5xx context") to reflect the mapping + single warn line.

### Filter spec (new)

Construct real error instances — the classes are exported by the generated client:

- `new Prisma.PrismaClientKnownRequestError('msg', { code: 'P2002', clientVersion: '7.8.0', meta: { target: ['companyId', 'supplierCode'] } })` (same for P2025, P2003, and an unmapped code, e.g. P2024)
- `new Prisma.PrismaClientValidationError('Invalid value for argument supplierType', { clientVersion: '7.8.0' })`

Stub `ArgumentsHost` (returning a fake `Request` with headers/method/path) and a stub `HttpServer`/httpAdapter whose `reply(response, body, status)` records body+status (BaseExceptionFilter calls the adapter). Stub logger records calls. Assert:

1. PrismaClientValidationError → status 400, body `{ statusCode: 400, message: 'Request shape or field values are invalid.', error: 'Bad Request' }`; body does NOT contain the original Prisma message text; exactly one `warn`, zero `error` logs.
2. P2002 → 409, message contains the fixed text and `companyId, supplierCode`; `error: 'Conflict'`.
3. P2025 → 404; P2003 → 409 (fixed messages).
4. P2002 with `meta.target` absent or non-array → 409 with the base message only (no crash).
5. Unmapped known code (P2024) → 500 and the existing enriched `logger.error` fired with `code` in the err object; same for a plain `new Error('boom')`.
6. `HttpException` passthrough: a thrown `BadRequestException` renders unchanged and logs nothing (4xx stay quiet).
7. 5xx log shape unchanged: `requestId/method/path` + err `{name,message,stack,code,meta}` for the 500 cases.

### Acceptance criteria (Phase 1)

- [ ] Exactly the four mappings from spec §15.2; every other exception's status AND log behavior identical to before (P2021/P2022, P1xxx, P2024, P2034, unknown/panic, raw errors all still 500 + enriched 5xx log).
- [ ] No Prisma internals in any 4xx body beyond P2002 `meta.target` column names.
- [ ] Spec file registered in `apps/api/package.json` `test` list; suite passes.
- [ ] Live re-check of the incident class (optional, if a stack is running): `POST /v1/procurement/suppliers` with an unknown `defaultVatMode` on a *non-supplier* procurement route that lacks use-case checks (e.g. vendor-bill create with a bad `vatMode`) now answers 400 generic instead of 500.

### Verification commands (Phase 1)

```bash
pnpm --filter @watchdog-bms/api typecheck
pnpm --filter @watchdog-bms/api test        # includes the newly registered filter spec
```

(Shell trap: default Node is v14 via nvm — prefix PATH with the v22 bin per the repo memory note if commands fail on syntax.)

## Phase 2 — Enum parity guard test (contracts ↔ schema.prisma)

### Files

- New: `packages/contracts/src/prisma-enum-parity.spec.ts`
- Edit: `packages/contracts/package.json` (`test` script is also a hand-maintained file list — append the new spec)

### Why it lives in `packages/contracts`, not `apps/api`

`apps/api` resolves `@watchdog-bms/contracts` to its built `dist/` (package `main`), and `pnpm -r test` does not build first — an apps/api-hosted test would silently assert against stale dist after a contracts source edit (known contracts-dist trap). A contracts-hosted spec imports the *source* modules directly (`./procurement.js`, `./expenses.js`, `./transaction-tax.js`, `./crm-ai.js` — ESM style like `line-ai-value-normalizer.spec.ts`) and reads the schema as a plain file. Reading `apps/api/prisma/schema.prisma` from a contracts test is a monorepo-internal file read in a dev-only spec, not a package dependency; the inverted layering is confined to the test and documented there.

### Design (per spec §15.8)

1. **Schema parser** (in the spec file, ~20 lines): resolve the schema path from the spec file location, not cwd — `path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../apps/api/prisma/schema.prisma')` (`packages/contracts/src` → three hops up = repo root). Read file; strip `//` comments; match `enum (\w+) { ... }` blocks; values = bare identifiers per line (ignore `@map(...)` if it ever appears; none exist today). Build `Map<enumName, string[]>`.
   - **Fail loudly, never skip**: assert the file exists and ≥ 50 enums parsed (schema has ~200 today; threshold guards against a moved file or broken regex reporting a false green).
2. **Registry** — explicit, authoritative, one entry per pair `{ arrayName, array, prismaEnum }`. Day-one entries (all 12 verified set-equal on 2026-07-29):

   | contracts export (source file) | Prisma enum |
   |---|---|
   | `SUPPLIER_STATUSES` (procurement.ts) | `SupplierStatus` |
   | `SUPPLIER_TYPES` (procurement.ts) | `SupplierType` |
   | `PROCUREMENT_VAT_MODES` (procurement.ts) | `AccountingVatMode` (cross-named) |
   | `INPUT_VAT_CLAIM_STATUSES` (expenses.ts) | `InputVatClaimStatus` |
   | `TAX_SOURCE_SYSTEMS` (transaction-tax.ts) | `TaxSourceSystem` |
   | `TRANSACTION_TAX_REGIMES` (transaction-tax.ts) | `TransactionTaxRegime` |
   | `TRANSACTION_TAX_DIRECTIONS` (transaction-tax.ts) | `TransactionTaxDirection` |
   | `TRANSACTION_TAX_TREATMENTS` (transaction-tax.ts) | `TransactionTaxTreatment` |
   | `TRANSACTION_TAX_CONTEXTS` (transaction-tax.ts) | `TransactionTaxContext` |
   | `TAX_ACCOUNT_ROLES` (transaction-tax.ts) | `TaxAccountRole` (order differs in schema — set equality, not order) |
   | `CRM_AI_SENTIMENTS` (crm-ai.ts) | `CrmSentiment` (cross-named) |
   | `CRM_AI_CUSTOMER_RISKS` (crm-ai.ts) | `CrmRiskLevel` (cross-named) |

3. **Parity assertions per entry**: Prisma enum exists in the parsed map; contracts array is non-empty and duplicate-free; set difference in both directions is empty — failure message must print `missingInContracts` / `extraInContracts` lists and both names.
4. **Discovery sweep** (same spec file, second describe block): scan `packages/contracts/src/*.ts` sources (skip `*.spec.ts`) with a regex for `export const NAME = [ ...string literals... ] as const` (string arrays only). Derive a candidate Prisma name from `NAME` via a small suffix map (`_STATUSES→Status`, `_TYPES→Type`, `_MODES→Mode`, `_ROLES→Role`, `IES→y`, then generic trailing-`S` drop) + PascalCase. If the derived name is a parsed Prisma enum and `NAME` is neither registered nor in a (initially empty) `DISCOVERY_IGNORE` list → fail with "register this pair or add to DISCOVERY_IGNORE with a reason". Documented limitation stated in the file: cross-named pairs are NOT discoverable — the registry is the authority; discovery only catches same-named additions (the common case, and the exact mechanism by which the staged DTO conversion will add arrays).
5. If any registry pair is red at implementation time: **stop and report** — that is live drift (the bug class this test exists for), not something to allowlist. All 12 were value-verified during planning; a red pair means the tree moved.

### Acceptance criteria (Phase 2)

- [ ] All 12 pairs asserted set-equal; failure output names both sides and prints the exact missing/extra values.
- [ ] Parser fails the suite (not skips) when the schema path breaks or fewer than 50 enums parse.
- [ ] Discovery flags an unregistered same-named `as const` string array (verify by temporarily adding one locally — do not commit the probe).
- [ ] Spec registered in `packages/contracts/package.json` `test` script; `pnpm --filter @watchdog-bms/contracts test` green.
- [ ] Contracts-only arrays (`TAX_ROUNDING_MODES`, `ACCOUNTANT_INDEX_COLUMNS`, `CRM_BOOKING_BUFFER_MINUTE_OPTIONS`, Thai-month lists, line-ai lists) produce no findings (no same-named Prisma enum → ignored by discovery).

### Verification commands (Phase 2)

```bash
pnpm --filter @watchdog-bms/contracts typecheck
pnpm --filter @watchdog-bms/contracts test
```

## Phase 3 — Whole-tree verification + docs

1. Root: `pnpm typecheck` then `pnpm test` (sequential — do not run typecheck concurrently with tests; known rig trap). Both must be clean; apps/api count grows by the filter spec cases, contracts by the parity cases.
2. Update `docs/agent-memory/prisma-error-mapping-and-enum-parity.md`: Status → implemented, record test counts and any deviations from this plan.
3. No migration, no template sync, no deploy step in this change. If the owner later deploys it: normal canary rules (never probe the endpoint during bake; verify with one request after stable).

## Gap Analysis — what these two changes still leave open

### G1. 52 remaining `@Body() body: any` endpoints (staged DTO conversion — the real fix)

> **DONE 2026-07-29.** All 51 handlers converted across six commits, one per module
> batch, in the order proposed below. Memory: `docs/agent-memory/dto-boundary-conversion-g1.md`.
> The recipe held with one correction: step 1 should read *"source the DTO from the
> use-case `execute` input type"*, not from the contracts type — the contracts
> `Create*Dto` types are narrower than what the use cases accept in several places
> (vendor-bill lines, PO/PR header totals), and building from them would have
> stripped fields the use cases read. Steps 2–5 were followed as written; step 3
> (diff against the live caller) is what caught `transactionContext`, the explicit
> nulls, and the body-borne `movementType`.

The filter makes malformed input answer 400/409/404 generically; it does not give field-level errors, and use-case checks exist only where hand-written (supplier, product, money-validation, ledger/reimbursement DTO'd routes). The endgame is typed DTOs everywhere. This is a **client-compatibility change**: under `whitelist: true, forbidNonWhitelisted: true`, any extra field a caller sends becomes a 400 that today is silently accepted. Therefore: separate effort, per-module batches, each batch diffed against real `apps/web` payloads before merge. Owner go/no-go per batch.

Per-file counts (formatting-exact grep, 2026-07-29 — grep broadly when implementing; owner's broader count is 53/21):

| Module batch | Files (count) | Risk / notes | Suggested order |
|---|---|---|---|
| Procurement | vendor-bill (8), purchase-order (5), purchase-request (4), supplier (3), supplier-payment (2), goods-receipt (2) | Highest enum density (status/vatMode/matching enums), the incident module, active UAT usage; supplier already has use-case checks to converge with | 1 |
| Inventory | inventory-movement (5), inventory-product (4), inventory-location (3), inventory-qr (1) | Movement enums (`StockMovementType/Direction`), quantity shapes | 2 |
| Data-model-core | attachment (3), branch (2), document-sequence (1) | Attachment flows feed uploads from web + LINE; branch/document-sequence have DTO-less writes with existing use-case validation | 3 |
| Dashboard-notifications | notification (2), internal (2), dashboard (1) | `internal.controller` is worker-token surface — internal callers, coordinate with H-14 worker paths, not web | 4 |
| Banking | statement (1), reconciliation (1) | Import payloads are large JSON shapes; DTO must match importer exactly | 5 |
| Ledger | ledger (1) | Most ledger routes already use `ledger.dtos.ts` — close the stragglers | 6 |

Conversion recipe per endpoint (repeat mechanically):

1. Source the DTO from the existing contracts type (`CreateSupplierDto` etc.) — a class-validator DTO class in the module's `presentation/http/*.dtos.ts`, following the existing precedents `ledger.dtos.ts`, `accounting-money.dtos.ts`, `reimbursement.dtos.ts`.
2. Enum fields validate with `@IsIn([...ARRAY])` using the contracts `as const` array — never a literal list (this is what feeds the parity registry; add the array + registry entry if the enum has none yet).
3. **Diff against the live caller before merging**: grep the `apps/web/src/features/**/*.api.ts` call site(s) for the route and enumerate every field web actually sends; every sent field must exist on the DTO (else `forbidNonWhitelisted` breaks the page). Also check LINE/AI/internal callers (`internal-tools`, workers) for non-web consumers of the same route.
4. Boundary spec per dtos file using `new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS)` — exact production gate, precedent `ledger.dtos.spec.ts` — covering: valid payload passes, unknown field 400s, bad enum 400s with the field named.
5. Register every new spec in the `apps/api/package.json` `test` list. Run the module's e2e/browser path when one exists (see `docs/agent-memory/e2e-catalog.md`).

### G2. Holes that remain even after G1

- **~80 `as any` casts at the procurement Prisma boundary.** DTOs stop bad values at the edge, but the casts still disable compile-time checking inside repositories; a code-authored (not client-authored) invalid value still only fails at runtime — now as a 500, correctly. Shrinking the casts is a separate typing effort; do not conflate with DTO conversion.
- **Type-only contract unions** (the majority of contracts enums) have no runtime artifact; parity for them is unenforceable until/unless converted to `as const` arrays. Accepted residual: their drift surfaces as type errors or stale UI labels, not wrong HTTP statuses. Convert opportunistically when a boundary needs runtime validation (G1 step 2), never in bulk.
- **Cross-named pairs are not discoverable** by the parity sweep — registry discipline is the only guard for a future `SOME_MODES ↔ DifferentlyNamedEnum` addition. Mitigation: G1 step 2 requires the registry entry in the same PR as the array.
- **use-case-level P2025/P2002 handling is inconsistent** across modules (some check existence first, some rely on Prisma). The filter backstop makes the client-visible result correct (404/409), so no sweep is planned; improve messages opportunistically when touching a module.
- **apps/web has no `conflict` ApiError kind** — 409 renders through the `unknown` branch (message text still shown). Candidate one-line web improvement when a feature next handles duplicates explicitly.
- **`GET` query params remain unvalidated** on `any`-style handlers (bad enum in a list filter → PrismaClientValidationError → now 400 generic instead of 500). Correct status, generic message; DTO conversion for query DTOs is a lower-priority tail of G1.
- **AI Gateway error contract** is out of scope (no Prisma). Its filter remains log-only per M-02; nothing to change until it grows response-shaping needs.

## Rollback

Filter change is additive and stateless: reverting the commit restores 500-for-everything behavior with zero data impact. The parity spec is dev-only; reverting removes the guard, nothing else.
