# Substitute receipt — draw the signature on screen — Codex CLI Handoff

Status: Implement-ready 2026-08-06. Owner approved ("ถ้าทำได้ทำ"). Follows
[[substitute-receipt-standalone-menu-plan]] §3.3 step 4; task state
[[substitute-receipt-standalone-menu]].

Executor: Codex CLI. Never commit, never `git add`/`checkout`/`restore`/`stash`, never start servers, never run
e2e, no `prisma migrate`. **Web only** — no API, contracts, or schema changes. If you believe one is needed,
stop and say so rather than making it.

## Why

Signing today means finding a pen, signing paper, photographing it, and uploading the photo — on a phone, at a
market stall, with a payee waiting. The client already cleans the photo
(`removeLightBackground` + `findOpaqueBounds` in `expenses.model.ts:38-49`); this adds the obvious alternative:
draw the signature with a finger.

Both steps 4 (payer certify) and 5 (approver approve) of `SubstituteReceiptWizardPage` use the same
`SignatureFields` component, so this lands in one place and serves both.

## What to build

A small, self-contained pad component, e.g.
`apps/web/src/features/expenses/SignaturePad.tsx`, offered **alongside** the existing file input — not
replacing it. Present them as two ways to do one thing (a segmented choice: `ลงลายมือชื่อบนหน้าจอ` /
`อัปโหลดภาพลายมือชื่อ`), defaulting to drawing, because that is the one that works with nothing but the phone
in your hand.

Requirements:

- `<canvas>` driven by **pointer events** (`pointerdown` / `pointermove` / `pointerup` / `pointercancel`), not
  mouse or touch events, so one code path covers finger, stylus and mouse. Call `setPointerCapture` so a stroke
  that leaves the canvas still ends cleanly.
- `touch-action: none` on the canvas, or the browser scrolls the page instead of drawing.
- Size the backing store to `clientWidth * devicePixelRatio` and scale the context, or the line is blurry on
  every phone. Re-measure on resize; a redraw that loses an in-progress signature is a bug — keep the strokes
  as points and repaint from them.
- Stroke styling: round `lineCap` and `lineJoin`, width ~2.5 CSS px, near-black (`#111`). Draw on a
  **transparent** canvas — the certificate composites the signature over the document, so a white background
  would paint a box over the page.
- A `ล้างลายมือชื่อ` button, and a visible baseline so people sign on a line rather than in the middle.
- Disable the confirm action while the canvas is empty; an empty signature must never reach the API.

## Handing the drawing to the existing upload path

The wizard already turns a cleaned image into a `File` and uploads it. Produce the same thing so nothing
downstream changes:

1. Crop to the drawn ink using the existing `findOpaqueBounds` — reuse it, do not write a second bounds
   finder — with a small padding so the strokes are not clipped.
2. Export that region with `canvas.toBlob(…, 'image/png')` and wrap it in a
   `new File([blob], 'signature.png', { type: 'image/png' })`.
3. Feed it into the same state the file input sets, so preview, `assertAllowedUploadFile`, the upload intent
   and the complete call are all unchanged.

**Do not** run `removeLightBackground` on a drawn signature — it exists to strip paper from a photo, and the
drawn canvas is already transparent. Running it would be a no-op at best and would eat light strokes at worst.

Put the geometry in pure exported helpers with unit tests (points → cropped bounds, "is the pad empty") in
`apps/web/src/features/expenses/signature-pad.model.ts` + `.spec.ts`; the canvas wiring itself stays in the
component. That is the pattern the rest of this feature follows.

## Copy, icons, dates (unchanged owner directives)

Formal-professional Thai a layperson understands; official vocabulary (**ลงลายมือชื่อ**, not เซ็น); verb-first
buttons; no casual particles or emoji. Eye = view-only, pencil = edit/continue. Dates `5 ส.ค. 2569` via the
shared `formatThaiDate`. Every new string goes through the `t()` dictionary with **both** `th` and `en`
entries.

## Accessibility

The canvas is not keyboard-operable, so the upload alternative is the accessible path and must stay reachable
and clearly labelled — not hidden behind the segmented control in a way that a screen-reader user cannot find.
Give the canvas an `aria-label` and the container a short instruction line.

## Files

```
apps/web/src/features/expenses/SignaturePad.tsx           (new)
apps/web/src/features/expenses/signature-pad.model.ts     (new)
apps/web/src/features/expenses/signature-pad.model.spec.ts (new)
apps/web/src/features/expenses/SubstituteReceiptWizardPage.tsx
apps/web/src/common/i18n/workspace-dictionary.ts
```

## Verify (run exactly these, in order)

```
corepack pnpm --filter @watchdog-bms/web typecheck
cd apps/web && corepack pnpm exec node --import tsx --test src/features/expenses/signature-pad.model.spec.ts
cd apps/web && corepack pnpm exec node --import tsx --test src/common/i18n/workspace-i18n.spec.ts
```

## Report back

1. How the pad hands its output to the existing upload path, and confirmation that `removeLightBackground` is
   not applied to it.
2. How you handled devicePixelRatio and resize without losing an in-progress signature.
3. Which helpers you extracted and what the tests assert.
4. Test output for each verify command.
5. Anything in this handoff that was wrong about the code — say so plainly rather than working around it.
