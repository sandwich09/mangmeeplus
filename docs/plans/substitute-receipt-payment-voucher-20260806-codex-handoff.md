# ใบสำคัญรับเงิน — printable voucher for cash payees — Codex CLI Handoff

Status: Implement-ready 2026-08-06. Owner approved ("ได้"). Follows
[[substitute-receipt-standalone-menu-plan]] §4; task state [[substitute-receipt-standalone-menu]].
Phases 1–5 (approval mode, standalone menu + hub, wizard, PDF download, payee identity) are applied and
committed — build on them.

Executor: Codex CLI. Never commit, never `git add`/`checkout`/`restore`/`stash`, never start servers, never run
e2e, no `prisma migrate` (this phase adds **no** schema change and no new dependency).

## Why

The certificate is the company certifying its own payment. A ใบสำคัญรับเงิน is the other half: the **payee's**
own acknowledgement, signed by them on paper. For a cash payment to a market trader or a day labourer that
signed slip is the strongest evidence available, and the company policy already has a setting demanding
separate payment evidence for cash (`ExpenseCashEvidencePolicy.REQUIRE_SEPARATE_PAYMENT_EVIDENCE`).

Today the owner has to find a blank form somewhere. Give them one, pre-filled with what the system already
knows, so the flow is: print → payee signs → photograph → attach as payment evidence → carry on.

## Ordering: this is issued *before* the certificate exists

The voucher is printed at wizard **step 3 (แนบหลักฐาน)**, while the substitute evidence has not been prepared
yet. So it must key off the **expense**, not the evidence:

```
GET /v1/companies/:companyId/expenses/:expenseId/payment-voucher.pdf
```

Query parameters carry the payee the user has typed into step 2 but not yet saved — the evidence row does not
exist, so the server cannot read them: `?payeeName=&payeeAddress=&payeeTaxId=`. All optional; when absent, fall
back to the expense's `vendorNameSnapshot` and otherwise leave the field as a blank ruled line for handwriting.
Sanitise and length-cap them exactly like the prepare use-case does (reuse those helpers — do not write a
second validator), and normalise the tax ID through the same `normalizeTaxId` path.

Permission: the same read gate as the expense detail (`expense.read_own`), plus the branch scope check the
neighbouring per-expense routes apply.

## Rendering

Reuse the pipeline built for the certificate — do **not** add a dependency:

- New domain renderer `apps/api/src/modules/expenses/domain/logic/payment-voucher.logic.ts` exporting
  `renderPaymentVoucherSvg(input): Buffer`, written in the same style as `renderSubstituteReceiptSvg`
  (same font stack `Noto Sans Thai, Tahoma, sans-serif`, same `Intl.Segmenter` word-wrap helpers, same
  `xml()` escaping). Reuse `thaiBahtText` from `substitute-receipt.logic.ts` for the amount in words — do not
  reimplement it.
- Pass the SVG through the existing `renderSubstituteReceiptPdf(svg, documentNumber?)`. Its ink guard applies
  here too, which is what you want: a blank voucher is as bad as a blank certificate.
- Generated on demand, never stored. This is a blank form, not an artifact — it must not become an attachment
  and must not be checksummed.

### Document content

Title **ใบสำคัญรับเงิน**, then, in Thai official-document register:

```
วันที่ ..........................        (prefilled with the payment date when known, else a ruled blank)

ข้าพเจ้า ..................................................  (payee name, prefilled if known)
ที่อยู่ ......................................................
เลขประจำตัวประชาชน/เลขประจำตัวผู้เสียภาษี ...............

ได้รับเงินจาก <company name> เป็นค่า <expense description>
เป็นจำนวนเงิน <amount> บาท (<amount in Thai words>)
ไว้เป็นการถูกต้องแล้ว

        ลงชื่อ ..................................... ผู้รับเงิน
              (.....................................)

        ลงชื่อ ..................................... ผู้จ่ายเงิน
              (.....................................)
```

Every prefilled value must still sit **on a ruled line** so a wrong one can be struck through and corrected by
hand — this is a paper form, and the payee is the authority on their own name.

The company name comes from the same `getSubstituteCompanyContext` the certificate uses. Dates on the rendered
document use the **full Thai month** (`6 สิงหาคม 2569`), matching the certificate's convention, not the UI's
abbreviated form.

## Web

Wizard step 3 gains a secondary action next to the payment-evidence dropzone:
`พิมพ์แบบฟอร์มใบสำคัญรับเงิน`, with a one-line explanation
`สำหรับกรณีจ่ายเงินสด พิมพ์ให้ผู้รับเงินลงลายมือชื่อ แล้วถ่ายภาพแนบเป็นหลักฐานการจ่ายเงิน`.

Show it **only when the payment method is เงินสด** — for a bank transfer the slip is the evidence and this
form would be noise.

Reuse the binary-download helper the certificate PDF already uses (find it in `expenses.api.ts`; do not add a
second way to download a file). Saved filename: `ใบสำคัญรับเงิน-<expenseNumber or expenseId>.pdf`.

## Copy, icons, dates (unchanged owner directives)

Formal-professional Thai a layperson understands; official vocabulary (ลงลายมือชื่อ, เลขประจำตัวประชาชน);
verb-first buttons; no casual particles or emoji. Eye = view-only, pencil = edit/continue, download arrow =
PDF. UI dates `5 ส.ค. 2569` via the shared `formatThaiDate`; rendered documents use the full month. Every new
string goes through the `t()` dictionary with **both** `th` and `en` entries.

## Files

```
apps/api/src/modules/expenses/domain/logic/payment-voucher.logic.ts        (new)
apps/api/src/modules/expenses/domain/logic/payment-voucher.logic.spec.ts   (new)
apps/api/src/modules/expenses/application/use-cases/substitute-receipt.use-case.ts
apps/api/src/modules/expenses/presentation/http/expense.controller.ts
apps/api/src/modules/expenses/expenses.module.ts                           (if a provider is needed)
apps/web/src/features/expenses/expenses.api.ts
apps/web/src/features/expenses/SubstituteReceiptWizardPage.tsx
apps/web/src/common/i18n/workspace-dictionary.ts
```

No contracts change is expected (the query parameters are primitives); if you find one is unavoidable, say so
in your report rather than making it silently.

## Verify (run exactly these, in order)

```
corepack pnpm --filter @watchdog-bms/api lint
corepack pnpm --filter @watchdog-bms/web typecheck
cd apps/api && corepack pnpm exec node --import tsx --test src/modules/expenses/domain/logic/payment-voucher.logic.spec.ts
cd apps/web && corepack pnpm exec node --import tsx --test src/common/i18n/workspace-i18n.spec.ts
```

The spec must assert the Thai amount-in-words appears, that a missing payee leaves a ruled blank rather than
printing "null"/"undefined", and that the rendered SVG carries enough ink to survive
`renderSubstituteReceiptPdf`'s guard.

## Report back

1. The endpoint path, its permission decorator, and how the unsaved payee values reach it.
2. Which helpers you reused from `substitute-receipt.logic.ts` and which (if any) you had to duplicate, with
   the reason.
3. The rendered voucher's field list, and how a missing prefill is drawn.
4. Test output for each verify command.
5. Anything in this handoff that was wrong about the code — say so plainly rather than working around it.
