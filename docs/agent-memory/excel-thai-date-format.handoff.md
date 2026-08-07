# Handoff: excel-thai-date-format (implementation spec)

Read `AGENTS.md` + `.agents/skills/ponytail/SKILL.md` for the working rules.

**Goal:** every human-readable date inside the generated **.xlsx** files renders as
`28 ก.ค. 2569` (day + abbreviated Thai month + Buddhist year).

**Scope: `apps/api` only.** Only these files may change:

- `apps/api/src/common/export/thai-date.logic.ts` (new) + its `.spec.ts`
- `apps/api/src/modules/expenses/domain/logic/expense-export.logic.ts`
- `apps/api/src/modules/tax/domain/logic/tax-export.logic.ts`
- `docs/specs/expense-receipt-upload-spec.md` (one documentation line, see section E)
- `docs/agent-memory/excel-thai-date-format.results.md` (your report)

No web changes, no Prisma, no `packages/contracts`, no new dependency.

## Survey result — only TWO real .xlsx exports exist

| Export | Builder | In scope |
|---|---|---|
| Accountant package (ค่าใช้จ่าย) | `buildAccountantIndexXlsx` → `expense-export.logic.ts:161` | **Yes** |
| Tax review / filing package | `buildMinimalXlsx` → `tax-export.logic.ts:56` | **Yes** |
| BI / Reports dataset export | `reports/application/report.use-cases.ts:239` | **No — XLSX not implemented.** Returns `export_format_unavailable` ("XLSX export is not configured; CSV export is available"). CSV only. |
| Ledger report export | `ledger/application/use-cases/report.use-case.ts:187` | **No — XLSX not implemented.** Returns `export_not_implemented`. |

Do **not** add XLSX support to reports/ledger. That is a separate feature, not a formatting change.

## THE HARD CONSTRAINT — CSV must not change

`docs/specs/expense-receipt-upload-spec.md:180` states the CSV in the API response
"keeps the machine column keys for **system-to-system consumers**", while the XLSX is the
human-facing rendering. Therefore:

- Format dates **only** inside the XLSX builders.
- `buildAccountantIndexCsv` (`expense-export.logic.ts:134`) and `toCsv` (`tax-export.logic.ts:44`)
  must produce **byte-identical output to today**.
- `accounting_period` stays `YYYY-MM` — it is a period key used for grouping and accounting-software
  import, documented at spec line 191. **Never** convert it. *(User decision, 2026-07-28.)*

---

## A. Shared helper (new file)

`apps/api/src/common/export/thai-date.logic.ts`:

```ts
/**
 * Thai-Buddhist rendering for dates inside generated spreadsheets, e.g. 28 ก.ค. 2569.
 *
 * The time zone is pinned to Asia/Bangkok on purpose: the same UTC timestamp otherwise renders
 * as a different calendar day depending on the server's TZ (verified — 2026-07-28T23:59:00Z is
 * "29 ก.ค." in Bangkok but "28 ก.ค." on a UTC host).
 */
const THAI_EXPORT_DATE = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Asia/Bangkok',
});

/** Strict ISO date or date-time. `2026-07` (a period key) deliberately does NOT match. */
const ISO_DATE_LIKE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export function isIsoDateLike(value: unknown): boolean {
  return typeof value === 'string' && ISO_DATE_LIKE.test(value);
}

/**
 * Returns the Thai-formatted date, or the input unchanged when it is not a parseable ISO date —
 * so period keys, ids and free text pass through untouched.
 */
export function formatThaiExportDate(value: unknown): string {
  if (!isIsoDateLike(value)) return value == null ? '' : String(value);
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? String(value) : THAI_EXPORT_DATE.format(date);
}
```

Node 24 ships full ICU, so `th-TH-u-ca-buddhist` is available — already verified in this environment.

## B. Accountant package XLSX

`expense-export.logic.ts` already has the right seam: `xlsxCell()` applies XLSX-only presentation
(numeric cells, Thai enum labels) while the CSV builder uses the raw row. Add dates there.

Next to the existing `NUMERIC_COLUMNS` / `VALUE_LABELS`:

```ts
/** Display dates in the XLSX only — the CSV keeps ISO for system-to-system consumers.
    `accounting_period` is a YYYY-MM key, not a date, and is deliberately excluded. */
const DATE_COLUMNS = new Set<AccountantIndexColumn>(['uploaded_at', 'document_date', 'paid_at']);
```

and in `xlsxCell`, after the numeric branch and before the label lookup:

```ts
if (DATE_COLUMNS.has(column)) return formatThaiExportDate(value);
```

Those are **exactly** the three date columns in `ACCOUNTANT_INDEX_COLUMNS`
(`packages/contracts/src/expenses.ts:644`). Verify that list yourself and report if you find another.

**Do not touch** `buildAccountantIndexCsv`, `ACCOUNTANT_INDEX_COLUMNS`, the column order, the Thai
header labels, or `accountingPeriod()`.

## C. Tax export XLSX

`tax-export.logic.ts` takes a generic `ExportRow = Record<string, string | number | null | undefined>`,
so there is no fixed column list. Apply the helper **only** in `buildMinimalXlsx`:

```ts
function buildMinimalXlsx(rows: ExportRow[]): Buffer {
  const headers = rows.length ? Object.keys(rows[0]!) : ['message'];
  const data = rows.length ? rows : [{ message: 'No rows' }];
  return buildXlsx(
    [headers, ...data.map((row) => headers.map((header) => {
      const value = row[header] ?? '';
      return isIsoDateLike(value) ? formatThaiExportDate(value) : value;
    }))],
    'Tax Review',
  );
}
```

The strict ISO guard is what makes this safe on an open-ended row shape: numbers stay numbers, ids and
codes pass through, and `YYYY-MM` period keys do not match.

**Do not touch** `toCsv`, `csvCell`, `buildMinimalPdf`, or `buildTaxExportArtifact`'s signature.

> Note for the report: the tax package carries the disclaimer *"Manual filing review package only.
> Confirm with accountant/RD before submission"* (`generate-tax-filing-package.use-case.ts:62`). The
> user was told this artifact is filing-adjacent and chose to include it anyway. Record that here.

## D. Constraints

- Shortest correct diff. No new dependency, no refactor of untouched code.
- CSV output byte-identical; only `.xlsx` cell values change.
- Do not change column order, header labels, numeric-cell handling, or any Thai enum label.
- Do not weaken or delete existing tests.

## E. Documentation

`docs/specs/expense-receipt-upload-spec.md:181` lists the XLSX rendering rules. Append one clause to
that existing sentence stating that date columns (`uploaded_at`, `document_date`, `paid_at`) render as
Thai-Buddhist dates (e.g. `28 ก.ค. 2569`) in the XLSX while the CSV keeps ISO, and that
`accounting_period` stays `YYYY-MM`. Do not restructure the document.

## F. Verification (run these; record exact output in the report)

```bash
corepack pnpm --filter @watchdog-bms/api typecheck
corepack pnpm --filter @watchdog-bms/api test
```

If the full API suite has pre-existing unrelated failures, say so explicitly and prove it (e.g. by
showing the same failures on a stashed tree). Do not present a failing suite as passing.

Add unit tests for the new helper (`thai-date.logic.spec.ts`):

1. `2026-07-28` → `28 ก.ค. 2569`; `2026-01-05` → `5 ม.ค. 2569`; `2026-12-31` → `31 ธ.ค. 2569`.
2. Timestamps use Bangkok time: `2026-07-28T23:59:00Z` → `29 ก.ค. 2569`. This test must pass
   regardless of the host TZ — that is the point of pinning.
3. Non-dates pass through unchanged: `'2026-07'` (period key), `''`, `'RB-202607-00005'`, `null`
   (→ `''`), `'not a date'`.
4. `isIsoDateLike` — true for date and date-time forms; false for `2026-07`, `2026-7-8`, and numbers.

Also add/extend a test proving the accountant **CSV is unchanged** while the **XLSX** shows the Thai
date for the same row, in `expense-export.logic.spec.ts` if it exists.

## G. Report back

Write `docs/agent-memory/excel-thai-date-format.results.md` with:

- Files touched, one line each: what changed and why.
- Confirmation that both CSV builders are untouched and that `accounting_period` still renders `YYYY-MM`.
- The exact list of date columns you converted, and confirmation you checked
  `ACCOUNTANT_INDEX_COLUMNS` for any you might have missed.
- The tax-package note from section C.
- Verification commands with their **real** output. Do not claim a check you did not run.
- Anything you could not do, with the reason.
