# Agent Memory: admin-receipt-web-upload

Status: Implemented and locally verified
Owner: Codex
Scope: Allow the protected `ADMIN` company role to upload receipt/bill evidence through the Expenses web workspace.
Decisions:
- Grant `expense.receipt.upload` to `ADMIN`; keep review, confirm, payment, and void permissions unchanged.
- Treat routine web/LINE receipt intake as an `ADMIN` capability equivalent to `OWNER`, without broadening owner-only or financial final-mutation permissions.
- Reuse the existing protected-role permission sync so existing company ADMIN roles receive the grant on deployment.
Open questions: None.
Artifacts:
- `apps/api/src/modules/auth/permission-registry.ts`
- `apps/api/src/modules/auth/permission-registry.spec.ts`
- `docs/specs/permission-matrix.md`
Verification:
- `corepack pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/auth/permission-registry.spec.ts` — 14/14 passed.
- `git diff --check` — passed.
Next: Deploy normally so permission sync reconciles existing ADMIN roles.

## 2026-08-14 — the client was compressing the tax id off the receipt

Reported: uploading a receipt **from a phone** loses เลขประจำตัวผู้เสียภาษี; asked to check the
rest of the mobile view too.

**The mobile view was not the problem.** Rendered `/expenses/upload` and an expense review page
at 320, 390 and 1440 against the local stack: no document-level horizontal overflow, the tax id
renders in full (`0-1055-56098-76-5`), and a step-by-step text/value diff of the review page
across all three wizard steps at 390 vs 1440 found **every input value identical**. The only
mobile/desktop difference is the document viewer (`hidden … lg:flex` inline pane on desktop vs
the `lg:hidden` attachment list + modal on mobile), which is by design.

**The value never reaches the form.** `apps/web/src/features/expenses/expense-upload.logic.ts`
re-encodes any image over `MAX_IMAGE_BYTES` before upload. That was **2 MB**, while every
server-side limit on the same path is **10 MB** — `UPLOAD_MAX_BYTES` (`packages/config/src/index.ts:168`),
the attachment gate, and `MAX_EXTRACTION_BYTES` (`expense-extraction.use-case.ts:11`) — and the
AI gateway even scopes a **16 MB** JSON body specifically to `/internal/ai/receipt-ocr`
(`apps/ai-gateway/src/main.ts:53`). So 2 MB was a client-only ceiling five times tighter than
anything that required it. A PDF returns early uncompressed, which is exactly why desktop scans
were never affected and phone photos always were: the old ladder capped the long edge at 2560 px
and drove JPEG quality down to **0.5**, then shrank by 20% and repeated. A receipt's tax id is
its smallest print, so it is the first thing that dissolves — and
`line-ai-internal.controller.ts:610-617` then *deletes* a tax id the read text cannot ground
(`collapsedText.includes(digits)`, spec §19j), so the field came back **empty rather than
wrong**. That guard is correct; the input quality was the defect.

Changed, in `expense-upload.logic.ts` only: `MAX_IMAGE_BYTES` 2 MB → **6 MB**, long edge 2560 →
**3200** (`MAX_IMAGE_EDGE_PX`), quality floor 0.5 → **0.72** (`MIN_IMAGE_QUALITY`, step 0.07 →
0.05). 6 MB leaves headroom on every hop: 6 MB → ~8 MB base64 into a 16 MB gateway limit, under
the 10 MB attachment and extraction gates, and far under the 100 MB per-company pending quota.

Also fixed while in the mobile view: `expenses.step_data_helper` told the reader to compare
against "ใบเสร็จทางซ้าย" / "the receipt on the left", but there is no left pane below `lg`. Both
locales now say the *attached* receipt.

Verified live (iPhone 13 viewport, `apps/web` in `next dev` on :3000 against
`compose.local.yml`) by uploading two synthetic phone photos and reading `AttachmentObject`:

| source | stored |
|---|---|
| 4032×3024, 4.26 MB | **4,469,433 bytes — byte-identical, not re-encoded at all** (old code: ≤2 MB at ≤2560 px) |
| 5712×4284, 18.96 MB | 4.08 MB, no error, ~40 s end to end |

`apps/web` `tsc --noEmit` clean; `pnpm test` 898/898.

Left behind in the local seed DB: two DRAFT expenses from these uploads
(`big-photo.jpg`, `huge-photo.jpg`) — test data, safe to delete.

The line **รายละเอียด** control is now a `<textarea rows={2} className="… resize-y">` instead of
an `<input>` (`ExpensesPages.tsx`, the `sm:col-span-2` label in the line grid). As an input it
clipped its own value on a phone — a seeded 33-character description needed 278 px inside a
264 px box at 390 wide and a 194 px box at 320 — so the value being checked against the receipt
could not be read in one look. It wraps at every width rather than only below `sm`: a one-line
box clips the same way in a narrow desktop window, and branching the control on a breakpoint
would mean two DOM fields bound to one value. `inputClass` + `rows={2}` is already the house
pattern for textareas in this file (see the override-reason and substitute-receipt fields).

Verified at 320 / 390 / 1440: the element is a TEXTAREA, its value is fully visible
(`scrollHeight === clientHeight`, no horizontal overflow), and the page-wide scan for clipped
form controls now returns **empty at every width** — it previously returned this one field.
