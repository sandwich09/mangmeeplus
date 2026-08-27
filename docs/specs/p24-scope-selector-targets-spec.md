# P24-2b — Company/branch selector touch targets

Status: Scoped source and real-Chrome evidence accepted by root, including many-options
scrolling and label-in-name corrections; phase PR/exact-head CI pending.
Original base: develop `d8d9808e41d15360810ed67e9169ade0cd5605ab` (2026-08-27);
post-freeze integration `d8f1a853` preserves all tested frontend bytes.

## Goal and authority

Make the existing company/branch selectors easy to touch and keyboard-focus for owners
and staff aged 40+ using the capture-first workspace. This is a bounded continuation of
[P24 §2.3](mangmee-growth-ux-full-pass-spec-th.md), using the existing
[mobile evidence rules](mobile-first-launch-features-spec.md#12-evidence-protocol-owner-requirement-2026-08-19)
and [shared UI language](mangmee-system-ui-alignment-spec.md).

`WorkspaceLayout` renders `CompanySwitcher` and `BranchSelector` from `WorkspaceScope.tsx`
in the shared header. Baseline inspection found seven interactive button templates: two
triggers, two retries, company options, branch options and the all-branches option.
The old triggers/branch retry shrank to 40px at `sm`; options used 20px line height plus
16px padding; company retry had no minimum target. Local rendered baseline confirmed
40px triggers,36px options and20px company retry; see the memory's red/green evidence.

## Contract and boundaries

- Every visible interactive selector, retry and option has a target at least 44×44 CSS
  pixels at 360×740, 390×844, 768×900 and 1280×900. `[desktop-visible]` exception to old desktop pixel parity
  is limited to these existing controls, as authorized by this P24-2b task.
- Reuse the shell's `focus-visible:outline-hidden` and brand ring/offset convention.
  Forced-colors Chromium emulation must retain a visible outline, not only box shadow.
- Long display labels may wrap in options and truncate in triggers as today, but targets,
  menus and the page must stay in viewport and remain hit-testable. Keep existing popup
  positioning/breakpoints unless a rendered scoped defect requires a minimal CSS fix.
  Long menus must scroll within the available viewport so the final valid option remains
  reachable. The existing branch caller requests100 rows; two companies/four branches
  in the local seed do not prove this boundary.
  After rendered red at both mobile sizes, root approved only the two popup classes:
  `max-h-[calc(100dvh-var(--app-header-h)-1rem)]` and `overflow-y-auto` replacing
  `overflow-hidden`. Header68px plus mobile8px top margin leaves8px below the menu;
  existing position, width, padding and selection behavior stay unchanged.
- Preserve all handlers, company dashboard route, outside-click closing, selected mark,
  branch localStorage key and scope intersections. No new selection or permission policy.
- Company list still comes from cookie-session `GET /auth/me/companies`; branch options
  from `GET /companies/:id/branches?status=ACTIVE&pageSize=100` intersected with
  `GET /auth/me` branch scope. Branch 401/403 remains hidden; other branch errors offer
  retry. Unresolved/single-company and locked-branch labels remain noninteractive.
  Company lookup failure still offers its existing retry. No permission/identity mocking
  may be presented as proof of server authorization.
- Root visual review found simultaneous mobile failures hid the retry action behind an
  ellipsis. Below `sm`, show existing localized `client_notice.retry` (`ลองใหม่` /
  `Try again`) completely, without clipping; from `sm`, keep the full existing failure
  text. Both buttons retain full failure `aria-label` and `title`, plus unchanged reload
  handlers. The full accessible name must contain the visible action in Thai and English;
  `state.error.retry` is not used because its Thai `ลองอีกครั้ง` is absent from the
  existing full failure name. No new dictionary, permission or retry policy.
  This follows [W3C's Label in Name guidance](https://www.w3.org/WAI/WCAG22/Understanding/label-in-name.html):
  visible text is contained in the accessible name; capitalization is immaterial to
  this comparison. This bounded check is not full WCAG certification or voice-device UAT.
- No schema, API, business mutation, feature gate, subscription, package, provider, LINE
  or cloud changes. Shared P24/master/closure documents are owned by the root docs task.

## Acceptance and evidence

1. Existing `responsive.spec.ts` covers real authenticated seeded controls at all four
   widths, proves their presence before measurement, measures all rendered options,
   verifies focus, popup bounds, no page overflow and unchanged branch selection/reload.
2. Display-only long-label response overrides preserve actual company/branch IDs and
   permissions. Failure/403 and locked-state response cases are explicitly mocked UI
   boundary evidence, not entitlement, identity or backend authorization acceptance.
   Separate geometry-only long-list fixtures add clearly synthetic20-company/100-branch
   rows while preserving every original ID; only an original valid last option is clicked.
   At360×740/390×844/1280×900, measure full popup bounds, verify actual internal scrolling
   to its last option, focus/hit-test and select with Enter. Synthetic rows are not
   memberships or authorization evidence.
3. Retry controls meet the same target/focus criteria and rerun their original lookup;
   failed/forbidden lookup must not fabricate an available branch or selection.
   At360/390px, both simultaneous-failure buttons visibly show the entire action text;
   full accessible labels contain that visible action, and successful retries restore
   real options. Both dictionary relationships are unit-tested; actual workspace browser
   evidence is Thai because `WorkspaceLayout` currently fixes locale to `th`.
4. Existing registered web unit/static checks and responsive E2E run without new harness
   or dependency. Record baseline failures, final results, commands and artifacts in memory.
5. Root owns manual Chrome review and PR/exact-head CI. Emulated viewports/forced-colors
   do not close full P24, actual iOS/Android/iPad/Windows testing, or 40+ human usability.
