# Homepage package guide

Status: Implemented and authorized for direct main/develop integration; focused homepage tests passed. Actual-browser visual review remains unavailable due to tool URL-policy rejection, 2026-10-24.

## Outcome and journey

Replace the confusing expandable four-question form with an inline conversation led by น้องมั่งมี. Shop owners see `ให้น้องมั่งมีช่วยเลือกแพ็กเกจ` and `น้องจะถาม 4 ข้อ กดคำตอบที่ตรงกับร้านคุณได้เลยค่ะ`.

1. The first question is visible without opening a disclosure. Mascot pops when it enters view.
2. Show one question at a time: people managing receipts/expenses (including the owner), monthly receipt volume, branches, and whether the shop prepares tax documents itself.
3. Tapping an answer records it and advances immediately. Show `ข้อ N จาก 4`, preserve selected answers when going back, and let the owner choose an existing answer again to advance.
4. Alternate the existing reviewing/scanning mascot assets, with a short pop for each new question. Reserve image space, keep controls outside animation, and disable motion under reduced-motion preference.
5. On the fourth answer, use the existing recommendation rule, mark the matching package card and move focus/scroll there as previously requested. Keep a completion summary and `แก้คำตอบ` in the guide; editing restarts at question one with existing choices retained.

## Boundaries and behavior

- Homepage only, shared by default and festival themes. Inline card, no modal or fixed overlay. Keep larger-shop contact guidance separate as established in item 37.
- Reuse existing React state, IntersectionObserver helper, images and CSS; no dependencies, generated artwork, audio, API, database, permission or plan entitlement changes.
- Keep the four answer ranges and `recommendedPlan` rule. Do not present a personalized package recommendation until all four steps are completed. Keep the existing general default card emphasis before completion.
- Native answer buttons work with touch, mouse and keyboard. Move focus to the new question after a response/back action; do not steal focus on first page render. Only completion scrolls to pricing. Changing monthly/annual billing must not reset answers or move focus.
- State is local to the page and resets on refresh. No saving/loading API; no new network error state. Missing IntersectionObserver leaves mascot readable; reduced motion leaves static poses. The existing native pricing links remain available.

## Acceptance

- One question/answer group visible; plain Thai heading and progress label.
- Answers advance in order; back/edit preserve values and cannot auto-finish early.
- Correct recommendation and one automatic jump per completion, including after edits; billing toggle does not trigger another jump.
- Two existing poses alternate and pop on question changes, without moving answer targets; reduced motion is respected.
- Default/festival scope and prior receipt-story controls remain intact. Verify focused interaction/rendered tests and TypeScript; record any actual-browser limitation honestly.
