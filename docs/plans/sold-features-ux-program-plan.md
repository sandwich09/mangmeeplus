# Plan: Thai UX programme for the sold screens

Date: 2026-10-13 · Owner: thawatchai · Standard: [docs/guidelines/thai-ux-standard.md](../guidelines/thai-ux-standard.md) · State: [docs/agent-memory/sold-features-ux-program.md](../agent-memory/sold-features-ux-program.md)

## Goal

The owner sent a guideline for Thai human-centred UX/UI on 2026-10-13 and asked for it to be researched and applied to every feature, function and screen in the packages that are sold, and to nothing else: priorities, what stays, what goes and what becomes quieter or louder are the team's call. A first-time Thai shop owner should know on every sold screen where they are, what to do, which button to press and what happens next.

## Scope

In: every screen a shop on a sold package can reach (starter preset, `wht_pnd53`, `wht_50bis`, sign-in and sign-up, package purchase and renewal, own profile, notifications, user guide). Out: staff consoles, unsold modules, LINE replies, printed papers, API behaviour, permissions, data rules. A flow change that needs a rule or API change is written up as a proposal and waits for the owner.

## Order of work

| Step | What | Why first |
|---|---|---|
| 0 | Standard (this round's rules and glossary) | every lane judges against one text |
| 1 | Foundation: one button look and height, one dialog-footer rule (equal size, one order, stack when names are long), Thai line-height and weights, no-wrap for numbers and dates, one error-notice look, glossary words in the shared layer | makes consistency mechanical; lanes reuse instead of restyling |
| 2 | Lane L3 recording expenses and lane L4 expense page, withholding, payment documents, counterparties | the daily job; the most presses |
| 2 | Lane L6 reimbursements | used by every employee |
| 3 | Lane L2 shell, home, notifications, settings, profile, guide | seen in every session |
| 3 | Lane L1 sign-in, sign-up, package purchase and renewal | first impression and the path to paying |
| 3 | Lane L5 substitute receipts, employees and roles | less frequent |
| 4 | Controller: whole suites, cross-lane wording, one walk of the main journeys at 390 and 1280, the 113-step list of the payment-document work | nothing is called done from tests alone |

Each lane: walk its screens in a real browser at 390 and 1280 as the people who use them, judge them against the standard, fix what it owns, update the tests that pin markup or wording, look again, and report findings it could not fix (shared files, rule changes).

## Rules of work

- One worktree, disjoint files per lane; shared files (global CSS, shared components, the dictionary, contracts word files, error-text map) have one owner at a time.
- Looks and words only. No change to what is saved, who may do what, or what the API returns.
- Evidence per changed screen: a picture at 390 and 1280 looked at, button groups measured, touched specs green, type check clean.
- Files pinned by a hash (user-guide content, the LINE capability manifest inputs) are reported to the controller, who re-pins.

## Acceptance

Per screen: the reviewer checklist of the standard, section 7. For the programme: whole web suite and loading audit green, type checks clean, hash pins current, the main journeys walked on real screens at both widths, and a short list for the owner of what changed, what was removed or made quieter, and which choices he can overturn.

## Verification commands

Type checks with the native compiler (`packages/typescript-native`), `corepack pnpm --filter @watchdog-bms/web test`, `node scripts/qa/action-loading-coverage.mjs --check`, `node scripts/run-line-ai-whole-chain-acceptance.mjs` when a pinned file moves, contracts and API suites when a contracts word moves.

## Status at the end of the round (2026-10-13)

Done on the local branch `claude/sold-ux-program-20261013` (not pushed; the owner looks first):

- Foundation (four passes): one button look and height, one dialog-footer rule, shared notice, filter tabs, choice rows, pressable steps, Thai line-heights, toast under the top bar.
- Six screen lanes, each with an audit and a build phase; second passes for L3, L4, L5 and L6.
- Words: the shared error-text map (406 sentences), the last old words on the sold web screens (485 sites), and, added to the scope during the round, **the API's own Thai error sentences on the sold screens (173) and the names and descriptions of role abilities (23 packs)**, because a person reads them under the reworded screens. Words only: no code, status or condition changed.
- The three expense-page specs that were protected during the payment-document work were opened by the controller for wording only (Thai literals inside existing assertions; nothing added or removed).
- Guides: reimbursements, substitute receipts, expenses, payment documents, and the sold parts of the tax guide follow the screens; the approved LINE help pack is version 4.
- Kept on purpose: the package-purchase screens (billing work is parked and `main` differs from `develop` in those files), the menu name `แดชบอร์ด`, the prominent 44 px pager (owner 2026-10-05), Thai file-type names (`เจเพ็ก`, `พีเอ็นจี`: the sold-features wording spec forbids the English ones), and every word that LINE messages, printed papers and bell notices share with the web (`คำขอเบิก`, `ลงนาม`, `ฉบับร่าง`, `ชำระ`, `ปฏิเสธ`).

Waiting for the owner: the proposals list (rule, tax, permission and API changes found by the lanes), the cross-channel word sweep, a UX round for the package-purchase screens, and his word before any push.
