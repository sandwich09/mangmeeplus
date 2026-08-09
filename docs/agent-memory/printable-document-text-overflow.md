# Agent Memory: printable-document text overflow (all three SVG renderers)

Status: DONE (2026-08-09) — printed Thai text ran past its column rule / off the sheet in all
three server-rendered documents. Root causes fixed, adjacent gaps swept, verified against real
browser text metrics. Not committed.
Owner: Claude
Scope:
- `apps/api/src/modules/reimbursements/domain/logic/claim-form.logic.{ts,spec.ts}`
- `apps/api/src/modules/expenses/domain/logic/substitute-receipt.logic.{ts,spec.ts}`
- `apps/api/src/modules/expenses/domain/logic/payment-voucher.logic.{ts,spec.ts}`
- `apps/api/src/modules/expenses/domain/logic/substitute-receipt-pdf.logic.{ts,spec.ts}`

## Root causes

Found while writing the การเบิกจ่ายและอนุมัติ manual: on RB-202608-00005 the line
`ล้างและเติมน้ำยาแอร์ 2 เครื่อง + เปลี่ยนคาปาซิเตอร์` printed across the x=480 rule and over the
next column. Three independent defects, the first two duplicated in every renderer because
`wrapText`/`estimatedWidth` are deliberately copied between modules (see their header comments).

1. **`estimatedWidth` under-measured Thai by 5–18%.** It charged a flat 8px per grapheme cluster
   and 7.5px per ASCII character. Measured in the print font stack at font-size 15, Thai base
   consonants run 8.3–13.1px and capitals/digits 8.2–13.5px, so a line that "fit" the budget by
   the estimate really rendered wider than its column. Replaced with `graphemeWidth()`: buckets
   keyed on the cluster's base glyph (stacked vowel/tone marks carry no advance), tuned so the
   estimate lands at 1.00–1.08× real over a 26-string Thai/ASCII corpus and never under.
2. **`wrapText` never split an over-wide single word.** The guard read
   `if (!line || estimatedWidth(candidate) <= maxWidth)`, so with an empty line ANY word was
   accepted verbatim and the grapheme-splitting branch below was unreachable. A 42-character
   unbroken token rendered 319px wide inside a 272px column.
3. **ใบสำคัญรับเงิน measured at the wrong font-size.** It prints at 18px but imports the substitute
   receipt's helpers, which are calibrated at 15px — an extra 20% under-measure on top of (1).
   A realistic payee address ran **118px past its ruled line and off the sheet**.
   `estimatedWidth`/`wrapText`/`fitToWidth` now take an optional `fontSize` and the voucher passes 18.

Belt and braces: `multilineText` takes the column budget and stamps `textLength`/`lengthAdjust`
on any line the estimate still puts over it (generalised from the `fitToBlock` that already
existed for signature names), so a font wider than the calibration target cannot spill either.

## Adjacent gaps found by sweeping, and fixed

A whole-sheet audit (every field at its maximum renderable length, every text measured against
the 45..805 margins) found six more unwrapped fields that ran off the page — none of them
reachable through the column-level bug, all of them plain single-line `<text>` with unbounded
user data. All now condense to their slot via `fitToWidth`:

| document | field |
| --- | --- |
| ใบรับรองแทนใบเสร็จรับเงิน | `บริษัท:`, `สาขา:`, payer name·position, approver name·position, `รวมเป็นตัวอักษร:` |
| ใบเบิกค่าใช้จ่าย | company name, branch·tax-id line, `ผู้ขอเบิก:`, `จำนวนเงินรวม (ตัวอักษร):` |

**PDF capacity interaction.** Correct wrapping makes the worst renderable substitute receipt 23%
taller (4832 → 5928px), which broke two safety gates that had been calibrated against the buggy
(short) layout:
- The decoded raster was already at **99% of `maxRasterPixels`** before this change — one extra
  line of text away from failing. `renderSubstituteReceiptPdf` now probes the vector's intrinsic
  size and fits the raster density to the pixel budget (200 DPI normally, never below 150), so a
  long certificate is rasterized slightly coarser instead of refused. Below 150 DPI it still trips
  the existing raster guard, so the "reject an oversized vector" path is unchanged.
- `maxPages` was exactly the worst case (4). The worst case now needs 5, so the ceiling is 6 —
  a page of slack, because pinning it to the worst case means any layout change breaks the promise
  that anything inside `SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS` renders at all.

**Checked and clean** — no other instance of this class:
- `line-message-buffer.logic.ts` also has a `textLength`, but it is a LINE character-count budget,
  not glyph geometry.
- The web has no document renderer of its own; `planDocumentRaster` already fits its canvas to a
  pixel budget the same way the server now does.
- No stored artifact is invalidated. Substitute-receipt evidence re-verifies
  `canonicalSnapshotHash` (the DATA), not the rendered bytes; issued SVGs keep the bytes stored at
  issue time; the claim-form preview checksum is returned inline and never compared to a stored
  value. No spec pins a rendered-bytes hash.
- Ordinary-length documents are unaffected: sheet height, tspan count and clamp count are
  identical before and after for a typical receipt, voucher and claim form.

## Verification

- `apps/api tsc --noEmit` ✓
- `src/modules/expenses/**` + `src/modules/reimbursements/**`: 605 tests, 598 pass, 0 fail, 7 DB-skipped ✓
- Full `apps/api pnpm test` fails only in `feature-launch/execution-attempt.service.race.spec.ts`
  (FK violation on a DB-backed race spec). Confirmed pre-existing: it fails the same way with
  these changes stashed.
- New regression specs: an over-wide single word must split with no character dropped (claim form
  and substitute receipt), and the voucher must wrap a long payee address onto its ruled lines.
  Two existing wrap assertions now strip tags before matching, because wrapping legitimately
  breaks `END-OF-LINE` / `END-OF-CERTIFICATION` across two tspans at a hyphen.
- Browser geometry audits (throwaway scripts): column-level and whole-sheet, over the reported
  case, all seeded claims, maximum-length fields, unbreakable ASCII/Thai tokens, and runs of the
  widest glyphs (ฒ ษ % W). Everything stays inside its rule and inside the sheet margins.
  Column utilisation on real text is 74–98%, so the new estimate is not over-conservative.
- Visually confirmed end-to-end in the running docker stack (claim-form preview + downloaded PDF).

## Next

- [ ] Commit (the working tree also carries an unrelated in-flight privacy/terms change from
      another session — commit only the eight files listed under Scope, plus this note).
- [ ] The local docker api container has the fixed claim-form file hot-copied into `dist/`;
      a normal rebuild picks up the source change and makes that irrelevant.
- [ ] Optional: `wrapText`/`estimatedWidth`/`fitToWidth` are now identical in two modules. The
      duplication is deliberate (module isolation), but if a third document ever needs them,
      promote them to a shared print-geometry module rather than copying a third time.
