# Handoff: csp-dev-and-dead-tokens-round8 (implementation spec)

Read `AGENTS.md` + `.agents/skills/ponytail/SKILL.md` for the working rules.

**Scope: `apps/web` only.** Only these files may change:

- `apps/web/src/common/security/security-headers.logic.ts` (+ **new** co-located `security-headers.logic.spec.ts`)
- `apps/web/proxy.ts`
- `apps/web/src/features/expenses/ExpensesPages.tsx`
- `apps/web/src/features/expenses/SubstituteReceiptSettingsPage.tsx`
- `apps/web/src/features/employee-access/IndividualPermissionsPrototypePage.tsx`
- `docs/agent-memory/csp-dev-and-dead-tokens-round8.results.md` (your report)

No API changes, no new dependency.

## Diagnosis (verified in the main thread — do not re-litigate)

Merge commit `23c61c0 fix(security): harden P1 and P2 controls` introduced a strict CSP in
`proxy.ts` + `security-headers.logic.ts`. In **local dev** it breaks two things:

1. **Console error** `eval() is not supported in this environment … React requires eval() in
   development mode` — `script-src 'self' 'nonce-…' 'strict-dynamic'` has no `'unsafe-eval'`,
   which Next.js/React dev tooling needs. Production React never calls eval, so this must be
   relaxed **in development only**.
2. **Receipt images broken / presigned uploads blocked.** Attachment `downloadUrl`s are S3
   presigned URLs against local MinIO at `http://127.0.0.1:19000` (plain HTTP). The CSP both
   (a) sends `upgrade-insecure-requests`, so the browser rewrites the image/PUT request to
   `https://127.0.0.1:19000` where MinIO serves no TLS, and (b) allows only `https:` in
   `img-src` and only the API origins in `connect-src`, so even without the upgrade the http
   origin is disallowed. `uploadReceiptFile` PUTs directly to the presigned URL via `fetch`,
   so `connect-src` matters too.

## THE HARD CONSTRAINT

**The production CSP string must remain byte-identical to today.** Every relaxation is gated on a
dev flag. A test must prove prod output is unchanged (see D).

---

## A. `buildContentSecurityPolicy`: add a dev mode

Extend the pure function with an explicit third parameter (keep it pure — no `process.env` inside,
so it stays unit-testable):

```ts
export function buildContentSecurityPolicy(
  nonce: string,
  connectUrls: Array<string | undefined>,
  dev = false,
): string {
```

Directive changes when `dev === true` (and ONLY then):

1. `script-src` gains `'unsafe-eval'` →
   `` `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'` ``
2. `img-src` gains `http:` → `"img-src 'self' data: blob: https: http:"`
3. `connect-src` gains `http: https:` (presigned storage PUT/GET origins are not statically known
   in dev) → `` `connect-src 'self' http: https: ${connectOrigins.join(' ')}`.trim() ``
4. `upgrade-insecure-requests` is **omitted** (this is the piece that breaks http MinIO even when
   the scheme sources allow it).

Everything else identical in both modes. Keep the existing `connectOrigins` parsing untouched.

Add a short comment on the dev branch explaining the two dev-only realities (React dev eval;
plain-http presigned MinIO URLs) — future readers must understand why prod stays strict.

## B. `proxy.ts`: pass the flag

```ts
const csp = buildContentSecurityPolicy(nonce, [
  process.env.NEXT_PUBLIC_API_BASE_URL,
  process.env.NEXT_PUBLIC_API_URL,
  process.env.NEXT_PUBLIC_AI_GATEWAY_BASE_URL,
], process.env.NODE_ENV !== 'production');
```

Nothing else in `proxy.ts` changes. (`NODE_ENV` is statically replaced by Next in the proxy bundle,
so prod builds hard-code `false`.)

## C. Dead color-token utilities — fix every site

The design-token colour scales define ONLY: `warning-50/100/500/600/700`, `error-50/500/700`
(plus full brand/gray scales). The classes below reference steps that do not exist, so Tailwind 4
generates nothing and they silently fall back (borders → `currentColor`, text → inherited grey).
A repo-wide sweep found exactly these sites — fix all, introduce no new tokens:

| File:line | Dead class | Replace with | Why |
|---|---|---|---|
| `ExpensesPages.tsx:558` | `text-error-600` | `text-error-700` | house error text (ErrorBanner, badge-danger) is error-700; today this warning renders **grey**, not red |
| `ExpensesPages.tsx:572` | `text-error-600` | `text-error-700` | same |
| `ExpensesPages.tsx:573` | `text-error-600` | `text-error-700` | same |
| `ExpensesPages.tsx:614` | `text-warning-800` | `text-warning-700` | house amber text is warning-700 |
| `ExpensesPages.tsx:658` | `border-warning-200` | `border-warning-100` | matches the sibling warning container at L614 and `.mangmee-badge-amber`'s border token |
| `IndividualPermissionsPrototypePage.tsx:502` | `text-error-600` | `text-error-700` | delete-employee action currently renders grey |
| `SubstituteReceiptSettingsPage.tsx:171` | whole hand-rolled error div | shared `ErrorBanner` | the div (`rounded-xl border border-error-200 bg-error-50 p-3 text-sm text-error-700`) is a clone of `ErrorBanner` with a dead border; replace `<div …>{error}</div>` with `<ErrorBanner message={error} />` (import from `./ExpensesUi` — check the file's existing imports and extend them) |

Line numbers are current as of this handoff — locate by the quoted class if drifted. Do not change
any text content, condition, or handler at these sites.

## D. Tests (new `security-headers.logic.spec.ts`)

Match the repo's node:test style (`describe`/`it`, `assert/strict`).

1. **Prod unchanged (regression lock):** `buildContentSecurityPolicy('N', ['http://localhost:3001'])`
   (dev omitted) must equal the exact current output string:
   `default-src 'self'; script-src 'self' 'nonce-N' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' http://localhost:3001; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; worker-src 'self' blob:; upgrade-insecure-requests`
   Build this expectation from the real current output (verify before writing it down), not from
   this spec.
2. **Dev deltas:** with `dev = true` — contains `'unsafe-eval'` in script-src; `img-src` contains
   ` http:`; `connect-src` contains ` http:`; does **not** contain `upgrade-insecure-requests`;
   and the nonce is still present.
3. **Dev ≠ prod only in the four documented ways:** diff the directive lists programmatically and
   assert the changed set is exactly `{script-src, img-src, connect-src, upgrade-insecure-requests}`.
4. Existing behaviour: invalid/non-http connect URLs are still dropped (one case).

## Verification (run these; record exact output in the report)

```bash
corepack pnpm --filter @watchdog-bms/web typecheck
corepack pnpm --filter @watchdog-bms/web lint
corepack pnpm --filter @watchdog-bms/web test
```

Also run the dead-token sweep and paste its (empty) output as proof:

```bash
grep -hoE "--color-[a-z]+-[0-9]+" packages/design-tokens/generated/web/theme.css apps/web/app/globals.css | sort -u | sed 's/--color-//' > /tmp/tokens.txt
grep -rhoE "(bg|border|text|ring|divide|outline|decoration|fill|stroke|from|to|via)-(brand|warning|error|success|gray|gold|line)-[0-9]+" apps/web/src apps/web/app --include="*.tsx" --include="*.ts" | sed -E 's/^[a-z]+-//' | sort -u > /tmp/used.txt
comm -13 /tmp/tokens.txt /tmp/used.txt   # must print nothing
```

## Report back

Write `docs/agent-memory/csp-dev-and-dead-tokens-round8.results.md` with:

- Files touched; what changed and why.
- The prod CSP string before and after (must be identical) and how the test locks it.
- Confirmation the dev flag is threaded only through `proxy.ts` and defaults to `false`.
- The dead-token sweep output (empty) and each replacement made.
- Verification commands with real output. Do not claim a check you did not run.
- Anything you could not do, with the reason.
