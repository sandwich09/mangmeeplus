# UX program research: Thai guideline, its sources, and rules we can check

Input: the owner's guideline "Thai Human-Centered UX/UI Guidelines for AI Coding" (received 2026-10-13, read as data) and its 8 cited sources, all fetched 2026-10-13, plus further sources linked inline. Audience: Thai shop owners and one paperwork staff member, phone first (390 px), not accountants. "Guideline" below means the owner's document. Where a line is my judgment and not a source, it says so.

## M. Measurements made for this research (not from a source)

Playwright Chromium 149 and WebKit 26.5 on a blank test page; fonts loaded from `apps/web/public/fonts`. App facts are from the shared working tree, which may be stale.

- **M1 Line breaks.** Thai wraps at dictionary word boundaries with no spaces, even under `lang="en"`; a break can land inside a compound (`ผู้รับ|เงิน`, `ใบสำคัญ|จ่าย`). `PV-2026-001` breaks after every hyphen in both engines. `฿1,200.00` never breaks by itself, but `1,200.00 บาท` and `13 ต.ค. 2569` break at each space. Gluing with NBSP (`เลขที่ PV-…`) moves the break into the label (`เลข|ที่`).
- **M2 Dangerous CSS.** `word-break: keep-all`: Chromium ignores it for Thai, WebKit removes every Thai break and the text overflows. `break-all` cuts syllables (`จ่า|ย`). `overflow-wrap: anywhere` keeps Thai word breaks but splits amounts (`฿1,234|,567.0|0`). `<wbr>` inside `white-space: nowrap` breaks in Chromium, not in WebKit; U+200B works in both. `text-wrap: balance` and `pretty` are supported by both and work on Thai.
- **M3 Height of Thai marks, with the app's real stack (`'Outfit', 'IBM Plex Sans Thai', …`; Outfit sets the line box, Plex draws the Thai).** Ink on everyday words (`ผู้ที่น้ำ`) reaches 1.08 em above the baseline at weight 400 and 1.15 em at 700, and 0.35 em below; Latin capitals reach 0.69. Total 1.43 em (400) and 1.51 em (700), so wrapped lines can touch below line-height 1.5 (regular) and 1.6 (bold). In a one-line box that clips, with no vertical padding, at 16 px: `leading-none` cuts 3.4–4.4 px off the top and 3.5 px off the bottom; `leading-tight` (1.25) cuts 1.5–2.5 px and 1.5 px; 1.375 cuts 0.5–1.6 px; 1.5 cuts nothing at 400 and 0.4 px at 700; 1.625 cuts nothing. Sarabun (also bundled) is taller: ink 1.25–1.32 em above and 0.33–0.56 below, in a font box of only 1.30.
- **M4 Digits.** Outfit (the app's Latin face) has proportional digits: at 100 px `1111` is 139 px wide and `0000` is 262 px. With `tabular-nums` both are 236 px. `฿` comes from the Thai file and is about 10% taller than the Outfit digits.
- **M5 `Intl` (Node 22).** `th-TH` defaults to the Buddhist calendar with Arabic digits: `13 ต.ค. 2569`, `13 ตุลาคม 2569`, `13/10/69`, `฿1,200.00`, `-฿1,200.50`, `7%`. `currencyDisplay: "name"` gives `บาทไทย`, so write `บาท` by hand.
- **M6 Baseline counts in `apps/web` (grep, includes tests, indicative only).** `กรุณา` 1,226; `ดำเนินการ` 291; `หรือไม่` 68; `ท่าน` 70; `ค่ะ` 113, `นะคะ` 34, `ครับ` 6; three draft labels (`บันทึกร่าง` 13, `บันทึกฉบับร่าง` 14, `บันทึกแบบร่าง` 6); `ลองใหม่` 194 vs `ลองอีกครั้ง` 112; `สำเร็จ` 278 vs `เรียบร้อย` 223; `ตกลง` 19. Classes: `text-xs` 1,148; `text-[10px]`/`[11px]` 76; `break-all` 67; `truncate` 118; `leading-none`/`leading-tight` 33; `uppercase` 51; `tracking-*` 43; `tabular-nums` 126.

## A. Rules we can check

Checks assume Playwright at 360, 390, 768 and 1280 px, real Thai data, and a `data-variant` attribute on the shared Button (add it if missing; it is what makes the button checks mechanical).

### Wording
1. **Every button label is a verb (plus object) naming the result; never bare `ตกลง`, `OK`, `Submit`, `ดำเนินการ`, `ใช่`/`ไม่`.** Bare `ยืนยัน` is allowed only where the title of the review screen or dialog names the action.
   - Why: "describing the action it performs" ([GOV.UK Button](https://design-system.service.gov.uk/components/button/)); "name a button to explain what it does" ([NN/g](https://www.nngroup.com/articles/ok-cancel-or-cancel-ok/)); guideline §3.1.
   - Check: accessible names of all `button, [role=button]` per screen; fail on `/^(ตกลง|OK|Submit|ดำเนินการ(ต่อ)?|ใช่|ไม่)$/`, and on `/^ยืนยัน$/` outside a dialog or review route whose heading has verb + object.
   - Fix: labels from one catalogue (section D): `บันทึกใบสำคัญจ่าย`, `ส่งให้อนุมัติ`, `ลบรายการ`.
2. **One concept has one word everywhere; statuses come from one fixed list.**
   - Why: users should not wonder whether different words mean the same thing ([NN/g heuristic 4](https://www.nngroup.com/articles/ten-usability-heuristics/)); the accounting apps this audience knows run on a short fixed status set ([FlowAccount](https://flowaccount.com/help-center/category/sales-function/document-status)).
   - Check: lint the string catalogue against a synonym table (M6 pairs); on pages, the set of badge texts ⊆ glossary.
   - Fix: one `glossary.ts`; status → label + colour in one map; CI grep for the losing synonym.
3. **No officialese, filler, English leftovers or system tokens in visible text.** That means `ดำเนินการ`, `ทำการ`, `กรุณา`/`โปรด` where it adds nothing, `ท่าน`, `ดังกล่าว`, `…หรือไม่`, polite particles in UI chrome, raw ids, enum names, ISO dates.
   - Why: familiar words, no jargon ([NN/g heuristic 2](https://www.nngroup.com/articles/ten-usability-heuristics/)); "please" implies a choice, avoid "valid/invalid" ([GOV.UK Error message](https://design-system.service.gov.uk/components/error-message/)); guideline §3.1.
   - Check: regex over `document.body.innerText` in every state: the banned list; `/[A-Za-z]{4,}/` minus an allowlist (LINE, PDF, QR, VAT, PromptPay, brand); ULID/UUID patterns; `/\d{4}-\d{2}-\d{2}/`; `/[A-Z]+_[A-Z_]+/`.
   - Fix: rewrite per section D; map backend codes to sentences in one module; never render a server `message` raw.
4. **Say it once, in one sentence.** Helper text ≤ 1 line, dialog body ≤ 1 sentence, nothing that repeats the title, the label, or what the screen already shows.
   - Why: every extra unit competes with the relevant ones ([NN/g heuristic 8](https://www.nngroup.com/articles/ten-usability-heuristics/)); hint is "a single short sentence" ([GOV.UK Text input](https://design-system.service.gov.uk/components/text-input/)); guideline §2.
   - Check: per view, the same normalised string twice outside table cells; hint > 60 characters or > 2 rendered lines at 390 px; dialog body > 120 characters; a paragraph whose words are a subset of the heading above it.
   - Fix: delete; put "what happens next" in the success message; rename the thing instead of explaining it.

### Buttons
5. **At most one primary (filled) button per view; a dialog or sheet counts as its own view.**
   - Why: "Avoid using multiple default buttons on a single page" ([GOV.UK](https://design-system.service.gov.uk/components/button/)); Apple allows "one or two per view" ([HIG Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons)); guideline §3.2.
   - Check: count visible `[data-variant=primary]` in `main` (excluding open dialogs) and in each `[role=dialog]`; each ≤ 1. Row actions in lists are never primary.
   - Fix: demote to `secondary`/`ghost`; move rare actions into one `เพิ่มเติม` menu.
6. **Buttons that sit together have the same height, and the same width when they form a pair or a stack.**
   - Why: do not mix sizes in a group; groups stack on mobile ([USWDS Button group](https://designsystem.digital.gov/components/button-group/)); owner rule 2026-10-13 (stricter than guideline §3.2, see B2).
   - Check: for every parent with ≥ 2 visible button children, `new Set(heights).size === 1`; if they share a row of ≤ 3 or are stacked, `new Set(widths).size === 1` (±1 px).
   - Fix: one `ButtonGroup`: `grid grid-cols-1 gap-3 sm:grid-cols-2`, or `flex gap-3 *:flex-1`; never size by label length inside a group.
7. **One Button component with four variants (primary, secondary, ghost, destructive) and all states; no hand-styled buttons.**
   - Why: consistency ([NN/g heuristic 4](https://www.nngroup.com/articles/ten-usability-heuristics/)); guideline §3.2 and §4.
   - Check: grep for `<button className=` outside the component folder; on pages, distinct `(height, border-radius, font-size)` tuples across buttons ≤ the number of declared sizes; every button has a visible `:focus-visible` style.
   - Fix: route everything through the shared Button; sizes as tokens (`min-h-11`, `min-h-12`).
8. **No two controls in one view do the same thing, and no control without a function.**
   - Why: guideline §2, §3.2; minimalist design ([NN/g heuristic 8](https://www.nngroup.com/articles/ten-usability-heuristics/)).
   - Check: duplicate accessible names or duplicate `href` among visible controls in one view (header + footer copies count); icons with `cursor: pointer` and no handler/role. Judging "same function, different label" is by eye.
   - Fix: keep the one in task order; delete the others.
9. **A button label never truncates and never takes more than 2 lines.**
   - Why: guideline §6 ("ไม่มีข้อความไทยล้น ถูกตัด หรือปุ่มถูกบีบ"); a cut label hides the outcome (rule 1).
   - Check: per button `scrollWidth <= clientWidth`, computed `text-overflow !== 'ellipsis'`, `height <= 2 × line-height + padding`, at 360 px.
   - Fix: shorter label; stack the group on phones; `text-balance` for 2-line labels; `min-w-0` on flex children; never `truncate` on a button.

### Layout and order
10. **Each screen has exactly one `h1` that says where the user is, and the DOM order is title → what to do → fields → primary action → result.**
    - Why: guideline §3.3; visibility of status ([NN/g heuristic 1](https://www.nngroup.com/articles/ten-usability-heuristics/)).
    - Check: `document.querySelectorAll('h1').length === 1`; `document.title` differs per route; the primary button follows the last required field (`compareDocumentPosition`).
    - Fix: page shell component owning `h1` + back link; no summary cards above the task.
11. **The primary action is on the page, not in a `⋯` menu, and on phones it is at the end of the form or in a sticky bottom bar that covers nothing.**
    - Why: guideline §3.3 ("อย่าซ่อน Primary Action ไว้ในเมนู"); focus must not be hidden by sticky content ([WCAG 2.4.11](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum)).
    - Check: `[data-variant=primary]` not inside `[role=menu]`; at 390×844 focus each field and assert `document.elementFromPoint(centre)` is that field; last content row is not under the bar.
    - Fix: `sticky bottom-0 pb-[env(safe-area-inset-bottom)]` plus matching `pb-*` on the scroller and `scroll-pb-*`/`scroll-pt-*` on `html`.
12. **Button order is the same on every screen.** Recommended: primary first in the DOM; phones stack with primary on top; from `sm` up, dialogs and action bars put it at the right edge (see B3).
    - Why: "Following platform conventions is more important than optimizing an individual dialog box" ([NN/g](https://www.nngroup.com/articles/ok-cancel-or-cancel-ok/)); default at "the top of a stack", Cancel "at the bottom" ([Apple Alerts](https://developer.apple.com/design/human-interface-guidelines/alerts)).
    - Check: in every group the primary is child 0; at 390 px its `top` is the smallest; at 1280 px in `[role=dialog]` its `right` is the largest.
    - Fix: `flex flex-col gap-3 sm:flex-row-reverse` in the shared `ButtonGroup`/dialog footer only.
13. **No card inside a card, and no section, icon or border that carries no information.**
    - Why: guideline §2, §3.3; [NN/g heuristic 8](https://www.nngroup.com/articles/ten-usability-heuristics/).
    - Check: `[data-card] [data-card]` count is 0 (or heuristic: element with radius + border/shadow nested in another); decoration is by eye.
    - Fix: flatten to headings + spacing (`space-y-6`, `divide-y`).
14. **Rarely used fields sit behind one labelled disclosure, never deeper than two levels.**
    - Why: "Designs that go beyond 2 disclosure levels typically have low usability"; the control must say what is inside ([NN/g](https://www.nngroup.com/articles/progressive-disclosure/)).
    - Check: `details details` and nested accordions = 0; the trigger text is a noun phrase (`ตัวเลือกเพิ่มเติม: ส่วนลด หมายเหตุ`), not `เพิ่มเติม` alone; required fields are never inside. The split itself is by eye and by usage data.
    - Fix: native `<details>`/one Disclosure component; steps (staged disclosure) for linear tasks such as a payment.
15. **An empty list says what belongs here and offers the one action that fills it; it never shows while data is loading.**
    - Why: status, learnability, direct pathway ([NN/g empty states](https://www.nngroup.com/articles/empty-state-interface-design/)).
    - Check: mock zero rows → one sentence + one button; delay the API 3 s → a loading indicator, and the text `ยังไม่มี` absent.
    - Fix: one `EmptyState` (sentence + Button); distinct `loading | empty | error` branches.

### Forms and errors
16. **Every field has a visible label above it; a placeholder is never the label or the only hint.**
    - Why: "All text inputs must have labels" ([GOV.UK](https://design-system.service.gov.uk/components/text-input/)); placeholders "often hurt usability more than help it" ([NN/g](https://www.nngroup.com/articles/form-design-placeholders/)).
    - Check: axe `label`; every `input, select, textarea` has a visible `<label for>`; flag `placeholder` with no visible label; labels end without a colon.
    - Fix: shared `Field` (label, hint, error, `aria-describedby`).
17. **An error sits next to its field, in red plus an icon or word, and says what is wrong and what to do in the words of the label.**
    - Why: "Explain what went wrong and how to fix it", be specific, match the question ([GOV.UK](https://design-system.service.gov.uk/components/error-message/)); adjacent, never colour alone ([NN/g](https://www.nngroup.com/articles/error-message-guidelines/)).
    - Check: submit empty and wrong values → every `[aria-invalid=true]` has `aria-describedby` pointing at a visible node within 16 px below it; fail on `/^(ข้อมูลไม่ถูกต้อง|เกิดข้อผิดพลาด|จำเป็นต้องกรอก|invalid)/i`; no error shown only as a toast.
    - Fix: message templates in D3; `aria-invalid:border-red-600` + text.
18. **Validate when the user presses the button, keep everything typed, move focus to the first error, and keep the submit button enabled.**
    - Why: "Do not validate when the user moves away from a field"; keep answers ([GOV.UK validation](https://design-system.service.gov.uk/patterns/validation/)); never before input is complete ([NN/g](https://www.nngroup.com/articles/errors-forms-design-guidelines/)); avoid disabled buttons ([GOV.UK](https://design-system.service.gov.uk/components/button/)). See B5, B6.
    - Check: type one character and blur → no error elsewhere; after a failed submit all values equal the typed ones, `document.activeElement` is the first invalid field and it is inside the viewport; no `button[disabled]` on first render of a form.
    - Fix: `noValidate` on forms, submit-time schema check, then re-check a field on change once it has shown an error; server check always.
19. **Amount fields accept what people type and show the unit.** `inputmode="decimal"`, not `type="number"`; commas, spaces and `฿` are stripped, not refused; `บาท` sits outside the input; text is ≥ 16 px.
    - Why: ignore unwanted characters; avoid `type=number`; prefix/suffix outside the input ([GOV.UK](https://design-system.service.gov.uk/patterns/validation/), [Text input](https://design-system.service.gov.uk/components/text-input/)); iOS zooms below 16 px ([CSS-Tricks](https://css-tricks.com/16px-or-larger-text-prevents-ios-form-zoom/)).
    - Check: every amount input has `inputmode=decimal`; typing `1,200` then submit gives no error; computed input font-size ≥ 16 px at 390 px.
    - Fix: one `AmountInput` (normalise on blur, `text-right tabular-nums`).
20. **Every refusal offers a way out inside the app.** A blocked state carries a link or button to the fix, not only "contact the team".
    - Why: suggest a solution ([NN/g heuristic 9](https://www.nngroup.com/articles/ten-usability-heuristics/)); eligibility and permission problems get a page that says what to do next ([GOV.UK](https://design-system.service.gov.uk/components/error-message/)); owner rule 2026-10-11.
    - Check: each error or blocked state contains ≥ 1 link/button; flag text matching `/ติดต่อ(เจ้าหน้าที่|ทีมงาน|ผู้ดูแล)/` with no other action. Force each API error code in tests.
    - Fix: error → `{sentence, action}` map; the action deep-links to the screen that fixes it.

### Feedback
21. **A press answers at once and cannot be sent twice.** Pressed state within 0.1 s; past 1 s the same button shows it is working (`กำลังบันทึก…`); past 10 s show progress.
    - Why: 0.1 s / 1 s / 10 s limits ([NN/g](https://www.nngroup.com/articles/response-times-3-important-limits/)); activity indicator inside the button with a changed label ([Apple](https://developer.apple.com/design/human-interface-guidelines/buttons)).
    - Check: delay the request 2 s, click → within 300 ms the button has `aria-busy=true` and a spinner; click twice → one request; layout does not shift (button width unchanged).
    - Fix: `loading` prop on Button (`aria-busy`, fixed width); idempotency key server side.
22. **Success is said in words where the user is looking: what was done and what is next.**
    - Why: keep users informed ([NN/g heuristic 1](https://www.nngroup.com/articles/ten-usability-heuristics/)); status messages must be exposed without focus ([WCAG 4.1.3](https://www.w3.org/WAI/WCAG22/Understanding/status-messages)).
    - Check: after each successful action a `[role=status]` node has text naming the object (`บันทึกใบสำคัญจ่าย PV-2026-001 แล้ว`), visible ≥ 5 s or until dismissed, or the result is a page of its own.
    - Fix: toast with `role="status"`; result pages for money and documents (rule 27).
23. **A system failure is told apart from a user mistake and loading is never a blank.** Failure says the data is kept and offers `ลองอีกครั้ง`; loading shows within 1 s.
    - Why: not the user's fault, preserve input ([NN/g](https://www.nngroup.com/articles/error-message-guidelines/)); service problems are not field errors ([GOV.UK](https://design-system.service.gov.uk/components/error-message/)).
    - Check: mock 500 and offline → `[role=alert]` with a retry button, form values intact, no field marked invalid; delayed route → skeleton or spinner present.
    - Fix: one `ErrorState` and one `LoadingState`; retry re-sends the same payload.

### Dialogs and irreversible steps
24. **A confirmation dialog appears only before something that cannot be undone or costs money; routine saves have none.**
    - Why: "if you cry wolf too many times, people will stop paying attention" ([NN/g](https://www.nngroup.com/articles/confirmation-dialog/)); not for common undoable actions ([Apple](https://developer.apple.com/design/human-interface-guidelines/alerts)).
    - Check: inventory every dialog trigger; each maps to the irreversible list (delete, cancel a document, issue a numbered document, record a payment, send to another person). Judging the list is by eye.
    - Fix: remove the others; prefer undo (`เลิกทำ`) in the toast where the server allows it.
25. **A confirmation names the exact thing and the consequence, and its buttons name the two outcomes.**
    - Why: be specific; label buttons with outcomes, not Yes/No ([NN/g](https://www.nngroup.com/articles/confirmation-dialog/)); avoid OK ([Apple](https://developer.apple.com/design/human-interface-guidelines/alerts)).
    - Check: `[role=dialog]` has `aria-labelledby`; title contains the document number, name or amount; buttons ≤ 2 (3 at most) and none is `ใช่|ไม่|ตกลง|OK`; body ≤ 1 sentence.
    - Fix: `ลบใบสำคัญจ่าย PV-2026-001?` / `ลบแล้วกู้คืนไม่ได้` / [`ลบ`] [`เก็บไว้`].
26. **The safe choice is the default in a destructive confirmation.** The destructive button is red with a verb, is not focused on open, is not what Enter does; Esc, back and backdrop mean "keep".
    - Why: dangerous actions need deliberate selection ([NN/g](https://www.nngroup.com/articles/ok-cancel-or-cancel-ok/)); never give a destructive button the primary role ([Apple](https://developer.apple.com/design/human-interface-guidelines/buttons)); do not rely on red alone ([GOV.UK](https://design-system.service.gov.uk/components/button/)).
    - Check: on open `document.activeElement` is not `[data-variant=destructive]`; press Escape → closed and zero requests; the destructive button has text.
    - Fix: `autoFocus` on the safe button; `variant="destructive"`.
27. **Money and tax documents get a review screen before commit and a result screen after.** Review shows payee, amount, date and document type with `แก้ไข` links.
    - Why: financial submissions must be reversible, checked or confirmed ([WCAG 3.3.4](https://www.w3.org/WAI/WCAG22/Understanding/error-prevention-legal-financial-data)); [GOV.UK Check answers](https://design-system.service.gov.uk/patterns/check-answers/); the bank flow this audience knows is "ตรวจสอบข้อมูลและกด ยืนยัน", then a slip ([SCB](https://www.scb.co.th/th/personal-banking/stories/tips-for-you/money-transfer.html)).
    - Check: the committing request fires only from the review step; values shown equal values typed; `แก้ไข` returns with fields prefilled.
    - Fix: staged flow fill → review → result; the commit button says the action and amount (`ยืนยันจ่าย ฿1,200.00`).
28. **`ยกเลิก` abandons what I was doing, `ปิด` only closes a window, and cancelling a document is called something else.** An `X` never silently discards typed data.
    - Why: X is ambiguous between cancel and close; "when in doubt, save, then out" ([NN/g](https://www.nngroup.com/articles/cancel-vs-close/)).
    - Check: dialogs with no input use `ปิด`; dialogs with input: type, press X → a keep/discard prompt or the data is still there on reopen; no dialog has both `ยกเลิก` (dismiss) and `ยกเลิก…` (void).
    - Fix: label map in D2; dirty-form guard in the shared Modal.
29. **Dialogs and sheets are short, single-step, one at a time, with a title and a visible close button, and they fit the phone.**
    - Why: multi-step tasks belong on a page ([NN/g modals](https://www.nngroup.com/articles/modal-nonmodal-dialog/)); visible Close, no stacking ([NN/g bottom sheets](https://www.nngroup.com/articles/bottom-sheet/)).
    - Check: visible `[role=dialog]` ≤ 1; it has `aria-modal`, a name, a close button; Tab stays inside; focus returns to the trigger; at 390×700 the footer buttons are visible without scrolling the page.
    - Fix: shared Modal: `max-h-dvh flex flex-col`, body `overflow-y-auto`, footer outside the scroller.

### Thai text layout and typography
30. **`<html lang="th">` and the Thai face really loads, with no synthetic bold or italic.**
    - Why: guideline §3.4. Thai wrapping needs a lexical resource ([CSS Text 3](https://www.w3.org/TR/css-text-3/), [W3C](https://www.w3.org/International/articles/css3-text/)); both engines apply it whatever `lang` says (M1), so `lang` matters for font choice, screen-reader voice and locale defaults, not for wrapping.
    - Check: `document.documentElement.lang === 'th'`; `document.fonts.check('16px "IBM Plex Sans Thai"', 'ก')`; no `font-style: italic` and no weight outside the bundled 400–700 on Thai text.
    - Fix: keep the bundled faces; add a named Thai system font to the fallback stack (`Thonburi`, `Leelawadee UI`, `Noto Sans Thai`), which today ends in generic families only.
31. **Thai that wraps has line-height ≥ 1.5 at regular weight and ≥ 1.6 when bold; body text 1.6–1.7.**
    - Why: Thai is a "tall" script that needs "extra line height to accommodate larger glyphs" ([Flutter Material](https://api.flutter.dev/flutter/material/ScriptCategory.html)); marks stack above and below ([r12a](https://r12a.github.io/scripts/thai/th.html)); M3.
    - Check: for every element with Thai text taller than one line, `parseFloat(lineHeight) / parseFloat(fontSize)` ≥ 1.5, or ≥ 1.6 when `fontWeight >= 600`.
    - Fix: Tailwind v4 defaults are too tight for Thai (`text-xs` 1.33, `text-sm` 1.43, `text-xl` 1.4, `text-2xl` 1.33, `text-3xl` 1.2). Override `--text-*--line-height` once in `@theme`; remove `leading-none`, `leading-tight`, `leading-snug` from Thai text.
32. **No box clips the marks above or below Thai letters.** Anything that clips (`truncate`, `line-clamp-*`, fixed height, `overflow-hidden`) has line-height ≥ 1.5 (bold ≥ 1.6), or block padding that makes up the difference.
    - Why: M3: at `leading-tight` a clipped 16 px label loses 1.5–2.5 px of `ที่`/`ผู้` at the top and 1.5 px at the bottom.
    - Check: flag Thai elements with computed `overflow` ≠ visible, `lineHeight/fontSize` < 1.5 (1.6 bold) and `paddingTop + paddingBottom` < 0.3 × font-size. Precise version: compare `ctx.measureText(text).actualBoundingBoxAscent/Descent` (with `ctx.font = getComputedStyle(el).font`) against the room around the baseline. Then eyeball the string `ผู้ที่ปี้กู้น้ำ` in every badge, button, input, tab and table cell.
    - Fix: `truncate leading-normal`, or `py-[0.15em]`; fixed heights become `min-h-*`.
33. **Never `break-all` or `break-keep` on Thai; no letter-spacing, justify, uppercase or italic on Thai.**
    - Why: M2; `keep-all` is defined for CJK ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/word-break)); letter-spacing adds a gap after every letter and justification fails in all three engines ([W3C Thai gap analysis](https://www.w3.org/TR/thai-gap/)). Thai has no capitals and no italic tradition (judgment).
    - Check: for every element with Thai text: computed `word-break === 'normal'`, `letter-spacing` is `normal`/0, `text-align !== 'justify'`.
    - Fix: long Latin strings (URLs, e-mail) get `wrap-anywhere` on their own element; ids get `whitespace-nowrap` + scroll, not `break-all`.
34. **Things read as one unit never split across lines: document numbers, amounts with `฿` or `บาท`, dates, phone and tax numbers, a word and its `ๆ`.**
    - Why: M1; `฿` stays with its number and `ๆ` must not start a line ([r12a](https://r12a.github.io/scripts/thai/th.html)).
    - Check: find tokens by regex in text nodes (`/[A-Z]{2,4}-\d{4}-\d+/`, `/฿[\d,]+(\.\d+)?/`, `/[\d,]+(\.\d+)? บาท/`, `/\d{1,2} [ก-๙.]+ \d{4}/`), build a `Range`, and require one distinct `top` across `getClientRects()`. Run at 360 px.
    - Fix: formatters render `<span class="whitespace-nowrap tabular-nums">`; label and value go on separate lines (`dt`/`dd`) instead of gluing `เลขที่` to the number; `text-balance` on headings, then re-check compounds.
35. **Text people must read is ≥ 16 px; secondary text ≥ 14 px; nothing below 12 px; amounts, statuses, errors and button labels are never below 14 px.**
    - Why: Thai needs more vertical resolution than Latin to stay readable ([r12a](https://r12a.github.io/scripts/thai/th.html)); Material sets tall scripts "one unit larger" ([Flutter Material](https://api.flutter.dev/flutter/material/ScriptCategory.html)). The thresholds are my judgment; no Thai standard was found.
    - Check: computed `font-size` of every Thai text node by role; list all < 14 px.
    - Fix: remap `text-xs` use (1,148 hits) to a caption token used only for non-essential metadata; remove `text-[10px]`/`[11px]`.
36. **Dates, money and numbers come from one formatter each and look the same everywhere; number columns align.**
    - Why: consistency ([NN/g heuristic 4](https://www.nngroup.com/articles/ten-usability-heuristics/)); CLDR Thai patterns (M5); M4.
    - Check: regex for strays: `/\d{4,}\.\d{2}/` (no comma), `/20\d{2}/` beside a Thai month, `/\d{1,2}\/\d{1,2}\/\d{2,4}/`, Thai digits `/[๐-๙]/`; amount cells have `font-variant-numeric: tabular-nums` and `text-align: right`.
    - Fix: `formatMoney`, `formatDate` wrapping `Intl` with `th-TH`; an `Amount` component; formats in D4.

### Accessibility
37. **Anything tappable is at least 44×44 CSS px on phones (48 for the main action), with ≥ 8 px between neighbours.**
    - Why: AA floor is 24 px ([WCAG 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum)); 44 px is AAA ([2.5.5](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced)) and Apple's rule ([HIG](https://developer.apple.com/design/human-interface-guidelines/buttons)); 48 px with 8 px gaps ([web.dev](https://web.dev/articles/accessible-tap-targets)). See B1.
    - Check: `getBoundingClientRect()` of every `a, button, input, select, [role=button], [role=tab], label[for]` at 390 px; fail < 44 in either axis (inline links in sentences exempt); neighbours closer than 8 px.
    - Fix: `min-h-11 min-w-11`; icon buttons `size-11`; row actions get padding, not a bigger icon. Confirm the `2.5rem` (40 px) minimums in `globals.css` never apply on phones.
38. **Text contrast ≥ 4.5:1 (3:1 for ≥ 24 px or bold ≥ 18.66 px, and for control borders and icons); state is never shown by colour alone.**
    - Why: [WCAG 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum), [1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast), [1.4.1](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color).
    - Check: axe `color-contrast`; every status badge, error and required marker has text or an icon with a name. Placeholder and disabled greys are the usual failures.
    - Fix: token pairs checked once; badges always carry the word.
39. **Everything works by keyboard with a visible focus ring, icon-only controls have names, and axe reports no A/AA violations.**
    - Why: [WCAG 2.4.7](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible); automated tests "detect some common accessibility problems" ([Playwright](https://playwright.dev/docs/accessibility-testing)).
    - Check: `new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze()` on every screen and every opened dialog; Tab through the main flow once by hand.
    - Fix: `focus-visible:outline-2 focus-visible:outline-offset-2`; `aria-label` in Thai on icon buttons; `button` for actions, `a` for navigation.

### Responsive
40. **No horizontal page scroll and no lost function at 360, 390, 768 and 1280 px (and a 320 px smoke run); tables become stacked rows on phones; nothing hides behind the keyboard or the home indicator.**
    - Why: guideline §6; reflow at 320 CSS px ([WCAG 1.4.10](https://www.w3.org/WAI/WCAG22/Understanding/reflow)).
    - Check: `document.documentElement.scrollWidth <= innerWidth` per width; list elements whose `right > innerWidth`; wide tables sit in their own `overflow-x-auto` box or switch layout; screenshots of every screen and state at 390 px reviewed by a person.
    - Fix: `min-w-0` on flex children, `grid-cols-1 sm:grid-cols-2`, `min-h-dvh`/`max-h-dvh` (not `vh`), `env(safe-area-inset-bottom)`.

## B. Where sources disagree, or the guideline is looser or stricter than its sources

| # | Topic | Guideline | Sources | Recommendation for this audience |
|---|---|---|---|---|
| 1 | Target size | 44–48 px default; notes AA is 24 | WCAG AA 24 with spacing exception; AAA 44; Apple 44 pt; web.dev 48 + 8 gap | 44 minimum on phones, 48 for the main action; 24 only for links inside sentences |
| 2 | Equal width | "Not necessarily equal; balanced within a group" | USWDS: stack on mobile, never mix sizes; no source demands equal width | Follow the owner's stricter rule: same height always, same width within a group |
| 3 | Primary left or right | Silent (wireframe: primary above `ยกเลิก`) | GOV.UK and [LukeW](https://www.lukew.com/ff/entry.asp?571): left edge, primary first; Apple: trailing in a row, top of a stack; NN/g: either, consistency and platform matter more | Rule 12. Count what the busiest screens do today before flipping anything; consistency outranks the choice. With `flex-row-reverse` the Tab order runs right to left on desktop, so keep it to two-button groups |
| 4 | How many primaries | One per main task in a context | GOV.UK: avoid multiple per page; Material: "a single prominent button"; Apple: one or two | One per view, dialogs counted separately |
| 5 | When to validate | Silent | GOV.UK: on submit, not on blur; NN/g: inline after leaving the field, never while typing | On submit; after a field has shown an error, re-check it on change. Inline only where it saves a round trip (13-digit tax number) |
| 6 | Disabled buttons | Lists a Disabled state "as needed" | GOV.UK: avoid; poor contrast, confusing | Submit stays enabled and explains on press; disable only while busy |
| 7 | Confirmations | Not covered | NN/g: only serious; Apple: not for common undoable; WCAG 3.3.4: reversible, checked or confirmed | Review screen for money and documents; dialog for delete and void; none for save |
| 8 | Bare `ยืนยัน` | Avoid when unclear, but uses `ยืนยันการจอง` | Banks use bare `ยืนยัน` after a review step (SCB) | Bare only under a title that names the action; elsewhere verb + object |
| 9 | Fonts | Noto Sans Thai or Sarabun | Google calls [Noto Sans Thai](https://github.com/google/fonts/blob/main/ofl/notosansthai/DESCRIPTION.en_us.html) (loopless) "mainly suitable for headlines" and the [Looped](https://github.com/google/fonts/blob/main/ofl/notosansthailooped/DESCRIPTION.en_us.html) family "suitable for all texts"; [Typotheque](https://www.typotheque.com/research/effects-of-loops-in-thai) (180 Thai readers): looped reads better in paragraphs and for older readers | Keep IBM Plex Sans Thai (loopless) for short UI text; before changing, test long reading text and users aged 45+ with a looped face (Sarabun is already bundled) |
| 10 | Line-height | "Check marks and vowels" only | [WCAG 1.4.12](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing) requires surviving 1.5; Material: tall scripts need more | Rule 31 numbers, from M3 |
| 11 | Widths | 360, 390, 768, 1280 | WCAG reflow: 320 | Keep the four; add a 320 smoke run on the main flows |
| 12 | `word-break: keep-all` for Thai | Not mentioned | MDN: CJK only; CSS Text keeps dictionary breaks; WebKit does not (M2) | Never use it; use `whitespace-nowrap` on the unit |
| 13 | Material Thai codelab | Cited as wording guidance | The Thai page is machine-translated | Use its principles, not its Thai, as a model |
| 14 | Five users | "About 5, not statistical" | Same, plus: distinct groups need 3–4 each; three rounds of 5 beat one of 15 ([NN/g](https://www.nngroup.com/articles/why-you-only-need-to-test-with-5-users/)) | 3–4 owners + 3–4 paperwork staff per round, fix, repeat |

## C. Review questions for each screen (priority order)

1. Would a shop owner say these words? Is there any accounting, English or system term they would not use at the counter? (H2)
2. In five seconds: where am I, what am I here to do, and which one button do I press? (H1, guideline goal)
3. After I press, do I see at once that it is working, then plainly that it worked or did not, and where the document went? (H1)
4. What is the costliest mistake here (wrong payee, wrong amount, wrong document, deleted)? Is it prevented, reviewed before commit, or undoable? (H5)
5. When it goes wrong, does the message say in their words what happened and what to do, and can they fix it here without calling anyone? (H9)
6. Can I back out at every step without losing what I typed? Do `ยกเลิก`, `ปิด` and `กลับ` each do what the word says? (H3)
7. Same thing, same word, same place, same look as on the other screens, and as in the bank app they use daily? (H4)
8. What could be removed without anyone noticing: a sentence, card, icon, button, field? Does anything appear twice? (H8)
9. Does the screen show what I need to decide (name, amount, date, status), or must I remember it from the previous screen? (H6)
10. Is the daily task quick for the paperwork person on day 30 (defaults, last choice remembered, copy from previous) without making day 1 harder? (H7)
11. If a term needs explaining, is the explanation one line, right there, in plain Thai? Could the term be replaced instead? (H10)
12. On a 390 px phone, one thumb: is everything readable (no clipped marks, no split numbers), reachable (44 px), and clear of the keyboard and bottom bar? (Thai layout, phone first)

## D. Thai wording standard (short)

**D1 Tone.** No citable Thai source on polite particles in UI text was found; this part is judgment, consistent with GOV.UK ("no please") and Material (one voice, tone varies by context).
- UI chrome (buttons, labels, errors, toasts, dialogs): no `ครับ`/`ค่ะ`/`นะคะ`. A particle gives the system a gender and a persona that then has to be kept everywhere, and it lengthens every line.
- One voice: neutral written Thai, short, direct. Address the user as `คุณ` only when needed; never `ท่าน`. The assistant persona may keep its particle inside its own speech bubbles only (owner decision needed: M6 shows 147 `ค่ะ`/`นะคะ` in the web app).
- Serious where money is involved, never playful in errors (Material codelab).

**D2 Verbs.**

| Action | Use | Why |
|---|---|---|
| Save | `บันทึก` (+ object when two things could be saved) | The word every Thai app uses |
| Save draft | `บันทึกร่าง`; status `ร่าง` | Shortest of the three in use; PEAK's status is `ร่าง` |
| Send | `ส่ง` + what or to whom (`ส่งให้อนุมัติ`) | Bare `ส่ง` hides the consequence |
| Confirm | `ยืนยัน` + object (`ยืนยันจ่าย ฿1,200.00`) | See B8 |
| Abandon what I am doing | `ยกเลิก` | Reserved for this meaning only |
| Close a window | `ปิด` | Nothing is lost; do not call it `ยกเลิก` |
| Void a document | `ยกเลิกเอกสาร`; safe button `เก็บไว้` | Avoids a dialog with two `ยกเลิก` |
| Delete | `ลบ` + object; safe button `เก็บไว้` | Outcome labels, not `ใช่`/`ไม่` |
| Edit | `แก้ไข` | — |
| Back | `กลับ` | Guideline wireframe; shorter than `ย้อนกลับ` |
| Next | `ถัดไป` | Guideline; not `ดำเนินการต่อ` |
| Download | `ดาวน์โหลด PDF` | Say the file type |
| Print | `พิมพ์` | — |
| Add / create | `เพิ่ม…` for a line or item, `สร้าง…` for a document | Two meanings, two words |
| Retry | `ลองอีกครั้ง` | One form only (M6 has two) |
| Approve / reject | `อนุมัติ` / `ไม่อนุมัติ` | Matches FlowAccount statuses |
| Done marker | `…แล้ว` (`บันทึกแล้ว`) | Shorter and truer than `ดำเนินการสำเร็จ`/`เรียบร้อย` |
| Press | `กด` | Works on phone and laptop; not `คลิก` |

**D3 Error sentence = what happened + what to do.** Shapes, not final copy; each real sentence must be true in every case it can appear.
- Empty field: an instruction using the label's words: `กรอกชื่อผู้รับเงิน`, `เลือกวันที่จ่าย`.
- Wrong format: the rule, with the number: `เลขประจำตัวผู้เสียภาษีต้องมี 13 หลัก`, `ยอดเงินต้องมากกว่า 0`.
- System failure: `บันทึกไม่สำเร็จ ข้อมูลที่กรอกยังอยู่ ลองอีกครั้ง`.
- Blocked by a rule: what blocks it + the button that fixes it: `ใบนี้จ่ายแล้ว จึงแก้ไขไม่ได้` + [`ยกเลิกเอกสาร`].
- Never: `เกิดข้อผิดพลาด`, `ข้อมูลไม่ถูกต้อง`, `ขออภัย…`, a code, or blame (`คุณกรอกผิด`).

**D4 Words to avoid.**

| Avoid | Use | Why |
|---|---|---|
| `ดำเนินการ`, `ทำการ` + verb | the verb | Officialese; says nothing |
| `กรุณา`, `โปรด` | drop it | Implies a choice (GOV.UK); 1,226 uses |
| `ท่าน`, `ดังกล่าว` | `คุณ` or nothing; `นี้` | Government-letter register |
| `ต้องการ…หรือไม่` | `ลบรายการนี้?` | Translated English |
| `ตกลง`, `OK`, `ใช่`/`ไม่` | the outcome verb, or `ปิด` | NN/g, Apple |
| `ไม่ถูกต้อง`, `ไม่สมบูรณ์` | the rule that was broken | "Invalid" tells nothing |
| `ระบบได้ทำการ…` | `…แล้ว` | The system is not the subject |
| English (`Submit`, `Draft`, `Pending`), ids, codes | Thai word, or hide | Not the user's language |

**D5 Formats.**
- Money: `฿1,200.00` in tables and cards (CLDR `¤#,##0.00`, no space); `1,200.00 บาท` in sentences and on documents. Always commas, always 2 decimals for money, Arabic digits, `tabular-nums`, right-aligned in columns, never split (rule 34).
- Negative or reducing amounts: a word plus the minus sign (`ส่วนลด -฿100.00`); no brackets.
- Dates: `13 ต.ค. 2569` in the UI, `13 ตุลาคม 2569` on documents: Buddhist year, four digits. Not `13/10/69`, not ISO, no bare Gregorian year; write `ค.ศ. 2026` if one is needed. With time: `13 ต.ค. 2569 12:00` (adding `น.` is common practice, uncited; pick one).
- Percent `7%`; phone and 13-digit tax numbers in one nowrap span; document numbers as issued, with the document type before them (`ใบสำคัญจ่าย PV-2026-001`).

## E. What automated checks can and cannot tell us

1. They can measure: sizes, equal heights, overflow, split tokens, DOM and visual order, counts (primaries, `h1`, dialog buttons), computed CSS (line-height, `word-break`, font loaded), string lint (banned words, formats, glossary), and scripted behaviour (busy state, double submit, focus after an error, Escape).
2. They cannot tell whether the words are understood, whether the one primary action is the right one, whether a message is true in every case, whether a confirmation is warranted, or whether an element is decoration.
3. axe finds only part of WCAG: Playwright's own page says many problems "can only be discovered through manual testing"; it does not judge focus order, name quality, or contrast over images.
4. Clipped Thai marks and awkward compound splits are ink, not layout boxes; the canvas check in rule 32 approximates, so a person must look at 360 and 390 px screenshots of every state.
5. Understanding is tested with people: 3–4 owners and 3–4 paperwork staff per round, tasks without hints, fix, repeat; it finds problems, it does not prove their absence.

## Sources not reached, or weaker than they look

- Material pages (`m2.material.io` language support, dialogs, buttons) return only a title to a fetcher. Used instead: Flutter's Material API docs for "tall scripts", a search snippet for "a single prominent button", Apple HIG for dialog buttons.
- K PLUS: the KBank pages returned empty and no official page with the domestic transfer steps was found, so nothing here rests on K PLUS. SCB's official how-to is the bank citation.
- PEAK status article (`intercom.help/peak/.../13967075`) looped on redirects; PEAK status names come from search excerpts of its help centre only.
- W3C Thai Layout Requirements is a draft index with little content; the detail comes from its linked r12a notes and the Thai gap analysis. The cited W3C `css3-text` article names no CSS properties; CSS Text 3 and MDN fill that in.
- No Royal Society page on date writing was found; date and money formats rest on CLDR as shipped in Node 22 (M5).
- `text-wrap: pretty` in Firefox is reported unsupported by secondary sources only; MDN's support table was cut off.
