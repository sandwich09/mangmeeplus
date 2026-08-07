# Agent Memory: web-dropdown-dismiss-sweep

Status: Done (2026-07-25)

Owner: Owner report — "Dropdown list ทั้งระบบ พอกดเปิดแล้วมันไม่ปิด ต้องไปกดย้ำๆ"

Scope: Every floating dropdown/menu in `apps/web`. Applied to all three working copies — `WatchDog-BMS` (`20260711`), `WatchDog-BMS-fix-bug-20260718`, and this worktree (`20260725`).

Note: the local docker stack is rebuilt from whichever copy the owner is using at the time, not from a fixed branch. This fix first landed here only, and the owner's next rebuild came from `20260711`, so nothing changed for them — hence the sweep across all three. Fingerprint the running bundle before assuming a source.

## What was actually broken

`20260711` had no dismiss handling on any header menu at all. `fix-bug-20260718` / `20260725` carried commit `252e56a`, which added `useCloseOnOutsideClick` but wired it to only three menus. Combined audit:

| Menu | outside click | Escape |
| --- | --- | --- |
| header user menu, branch selector, company switcher | **missing on `20260711`**, ok elsewhere | missing |
| `ThemedSelect`, `ThemedDate`, `AddEmployeePrototypePage` SelectField | ok, but each with its own copy-pasted effect | missing |
| Inbox status + priority (`InboxPage`, `InboxPrototypePage`) | **missing** | missing |
| Role picker + employee menu (`IndividualPermissionsPrototypePage`) | **missing** | missing |

The four inbox menus and two permissions menus stayed open until their own trigger was clicked again — the "ต้องกดย้ำๆ" behaviour, made worse because an open menu overlays the next trigger, so the first click only dismissed the old menu.

## Decisions

- One shared hook, not per-component effects: `useCloseOnOutsideClick` now handles pointerdown-outside **and** Escape, and the three components that had their own inline copy were routed onto it. Same name/signature kept so the three existing call sites only changed behaviour, not shape.
- `pointerdown`, not `click` — the menu is gone before the click lands, so pressing another trigger opens that menu instead of being swallowed. The trigger must sit inside the ref so its own click still toggles shut.
- `ThemedSelect` / `AddEmployeePrototypePage` guard on `details.open` before closing, so a stray Escape elsewhere on the page never yanks focus back to a closed select.
- Left alone (inline disclosure panels, not floating menus): inbox template picker, `InboxAiPanel` trust details, `LineOaSettingsPage` rotate form, `SharedLineSettingsPage` configure form, mobile sidebar (has its own backdrop).

## Verification

Playwright against `next dev` on :3100 talking to the running local API. Each menu tested for four behaviours — opens, re-click closes, outside click closes, Escape closes:

- header branch selector / company switcher / user menu — PASS
- `ThemedSelect` on crm-catalog and reports — PASS
- inbox priority + status menus — PASS
- access-overview employee menu — PASS

Baseline, probed side by side against the running docker build (then a `20260711` build) in the same script: opening the branch selector and clicking the avatar left **both** panels open, a third click added the company switcher on top, and clicking empty page area closed none of them — exactly the owner's screenshot. The fixed tree returned one panel at a time and none after an outside click or Escape.

The same suite was re-run on the `20260711` tree: header menus, inbox priority + status, access-overview employee menu, and `ThemedSelect` on /reports all PASS on all four behaviours.

`pnpm typecheck` (apps/web): clean. `pnpm test` (apps/web): 297 pass / 0 fail.

## Next

Nothing outstanding. Any new floating menu should call `useCloseOnOutsideClick` with a ref on the wrapper that contains both trigger and panel — grep for `className="relative"` + `{xOpen && (` when reviewing.
