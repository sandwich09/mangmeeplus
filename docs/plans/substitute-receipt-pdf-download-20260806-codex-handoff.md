# Substitute receipt — PDF download — Codex CLI Handoff

Status: Implement-ready 2026-08-06. Phase 4 of [[substitute-receipt-standalone-menu-plan]].
Owner approved on 2026-08-06 ("ทำให้หน่อย"). Task state: [[substitute-receipt-standalone-menu]].
Phases 1–3 are already applied and committed.

Executor: Codex CLI. Never commit, never `git add`/`checkout`/`restore`/`stash`, never start servers, never run
e2e, no `prisma migrate` (this phase adds no schema change).

## Why, and what changed about the approach

The issued certificate is an SVG that can only be viewed in a modal. An accountant cannot be sent one. The
original plan said to add `@resvg/resvg-js` for rasterisation; **do not** — that was superseded by measurement:

- `sharp` is **already a direct dependency of `apps/api`** (`^0.35.3`, used in
  `complete-attachment-upload.use-case.ts`) and the Dockerfile already carries its Linux native binaries past
  the `--no-optional` prod install (see the `@img/sharp-linux-x64` COPY lines in the runner stage). Rasterising
  through sharp therefore adds **no native dependency and no new Docker plumbing**.
- Verified in a real `node:22-bookworm-slim` container: sharp renders the document's Thai text correctly **only
  once a Thai font is installed**. Ink measured on a one-line probe of the document title:

  | image state | dark pixels |
  |---|---|
  | bare `node:22-bookworm-slim` | 444 (text effectively absent) |
  | after `fonts-noto-core` | 14 331 (correct glyphs) |

  Note it did **not throw** without the font — it silently produced a near-blank image. That is the failure mode
  this phase has to make impossible.

So: **sharp for SVG→PNG, `pdf-lib` (pure JS, no native code) for the A4 container, and a Thai font in the
image.** The only new package is `pdf-lib`.

## 1. Rendering

New domain helper next to the existing renderer, e.g.
`apps/api/src/modules/expenses/domain/logic/substitute-receipt-pdf.logic.ts`:

```ts
export async function renderSubstituteReceiptPdf(svg: Buffer): Promise<Buffer>
```

- `sharp(svg, { density: 200 }).png().toBuffer()` — 200 dpi against the renderer's CSS-pixel canvas gives a
  crisp A4 without a huge file. Measure the output; if a page lands over ~2 MB, drop the density rather than
  post-compressing.
- `pdf-lib`: one A4 page (595.28 × 841.89 pt), embed the PNG, scale it to fit **inside a 36 pt margin**
  preserving aspect ratio, centred. Set the document title metadata to the certificate's document number.
- **Guard against the silent-blank failure**: after rasterising, reject an image whose ink is implausibly low
  (e.g. fewer than 0.2 % dark pixels) with a clear `Error('Thai font missing from the runtime image; the
  rendered certificate is blank.')`. A blank legal document reaching an accountant is worse than a 500. Put a
  unit test on this helper that feeds a Thai-text SVG and asserts a non-trivial ink ratio — it doubles as the
  font regression test.

Add `pdf-lib` to `apps/api/package.json` dependencies. That is the **only** permitted `package.json` edit
(AGENTS.md forbids unrelated ones); do not touch scripts or reorder anything.

## 2. Endpoint

In the same controller that owns the per-expense substitute routes:

```
GET /v1/companies/:companyId/expenses/:expenseId/substitute-receipt/:evidenceId/artifact.pdf
```

- Permission: match the existing artifact-read path (`expense.read_own`), and reuse whatever actor check the
  preview/approve routes already apply for branch scope — do not invent a new rule.
- Only serve when the evidence has an `artifactAttachmentId` (i.e. `ISSUED`). Any other status → 409 with a
  message saying the certificate has not been issued yet.
- Load the stored SVG through the existing storage port, render, and stream back with
  `Content-Type: application/pdf` and
  `Content-Disposition: attachment; filename="<documentNumber>.pdf"`.
- **Generate on demand; do not cache as a new attachment.** The SVG stays the single immutable, checksummed
  artifact and the PDF is a derived rendering, exactly like a printout. One A4 page renders fast enough that a
  cache is not worth the extra rows and the "is the PDF also authoritative?" question. Say so in a comment.
- Audit: log a read at the module's normal level for artifact access if the neighbouring routes do; if they do
  not, do not add one.

## 3. Web

`expenses.api.ts` needs a binary fetch — the shared `authedApiFetch` parses JSON, so add a sibling that returns
a `Blob` (or reuse an existing binary helper if the XLSX export already has one — **check
`downloadIndexXlsx` first and copy its pattern**; do not write a second way to download a file).

Wire the download into all three places, using the owner's icon rule (a download arrow, styled as the primary
action; eye stays view-only, pencil stays edit):

1. **Hub table** — on `ISSUED` rows only, next to the existing eye button.
2. **Wizard done step** — a `ดาวน์โหลด PDF` button beside `เปิดดูเอกสาร`.
3. **Expense detail** — on the issued artifact in `DocumentReviewSection`.

Also **remove `hideOpenNewTab: true`** for the *issued* artifact wherever it is passed, so the document can be
opened in its own tab. Keep it for the payer-certified preview.

Filename the browser saves must be the document number, e.g. `SRC-EXP-0142-V1.pdf`.

## 4. Docker

In `infra/api-web/Dockerfile.api-web`, **runner stage** (the one that installs clamav), add the font:

```dockerfile
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends fonts-noto-core fontconfig \
  && find /usr/share/fonts/truetype/noto -type f ! -name 'NotoSansThai*' ! -name 'NotoSans-Regular*' ! -name 'NotoSans-Bold*' -delete \
  && fc-cache -f \
  && rm -rf /var/lib/apt/lists/*
```

`fonts-noto-core` is ~42 MB installed; the `find … -delete` keeps only what the certificate needs. The document
renderer already asks for `font-family="Noto Sans Thai, Tahoma, sans-serif"`
(`substitute-receipt.logic.ts:195`), so this makes the PDF match what the browser shows. Do not change that
font stack.

Then add a **build-time smoke check** in the same stage so a future base-image change cannot silently reintroduce
blank documents:

```dockerfile
RUN node -e "…render a Thai-text SVG through sharp, count dark pixels, process.exit(ink < 1000 ? 1 : 0)…"
```

Place it after the node_modules are in the runner stage so `sharp` resolves. If that ordering is impossible,
say so in your report rather than dropping the check.

## 5. Copy, icons, dates (unchanged owner directives)

Formal-professional Thai, layperson-readable, no casual particles or emoji. Verb-first buttons
(`ดาวน์โหลด PDF`). Eye = view-only, pencil = edit/continue, download arrow = PDF. Dates `5 ส.ค. 2569` in UI via
the shared `formatThaiDate`; the rendered document keeps the full month. Every new string goes through the
`t()` dictionary with **both** `th` and `en` entries.

## Files

```
apps/api/package.json                                              (add pdf-lib ONLY)
apps/api/src/modules/expenses/domain/logic/substitute-receipt-pdf.logic.ts        (new)
apps/api/src/modules/expenses/domain/logic/substitute-receipt-pdf.logic.spec.ts   (new)
apps/api/src/modules/expenses/application/use-cases/substitute-receipt.use-case.ts
apps/api/src/modules/expenses/presentation/http/expense.controller.ts
apps/api/src/modules/expenses/expenses.module.ts                   (if a provider is needed)
apps/web/src/features/expenses/expenses.api.ts
apps/web/src/features/expenses/SubstituteReceiptHubPage.tsx
apps/web/src/features/expenses/SubstituteReceiptWizardPage.tsx
apps/web/src/features/expenses/ExpensesPages.tsx
apps/web/src/common/i18n/workspace-dictionary.ts
infra/api-web/Dockerfile.api-web
```

## Verify (run exactly these, in order)

```
corepack pnpm install
corepack pnpm --filter @watchdog-bms/api lint
corepack pnpm --filter @watchdog-bms/web typecheck
cd apps/api && corepack pnpm exec node --import tsx --test src/modules/expenses/domain/logic/substitute-receipt-pdf.logic.spec.ts
```

Do **not** run `pnpm --filter @watchdog-bms/api test` (its `pretest` needs postgres), no e2e, no servers, no
docker build (it is slow and the host will run it).

## Report back

1. The rendering helper's body, including the ink guard and the density you settled on, plus the byte size of a
   rendered page.
2. The endpoint path, its permission decorator, and the status guard.
3. Which existing binary-download pattern you reused on the web side.
4. The exact Dockerfile lines added, and where the smoke check landed.
5. Test output for each verify command.
6. Anything in this handoff that was wrong about the code — say so plainly rather than working around it.
