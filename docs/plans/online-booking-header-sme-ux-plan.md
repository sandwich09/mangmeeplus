# Online Booking Header — SME UX Implementation Plan

Status: Completed 2026-07-19

Authority: `docs/specs/online-booking-header-sme-ux-spec.md` and existing booking/calendar contracts.

## Plan

1. Inspect screenshot, live DOM, header code, responsive booking layout, and existing week/buffer logic.
2. Replace only the header markup/styles using existing state, model functions, select component, and Tailwind tokens.
3. Preserve every API call, permission gate, calendar calculation, and booking mutation.
4. Build/restart the Docker web image.
5. Verify desktop structure, previous/next/today state, buffer control, narrow layout, and browser console.
6. Update this plan and task memory with evidence.

## Scope boundaries

- No new API, data model, dependency, icon library, booking calculation, or AI behavior.
- No redesign of the calendar grid or booking dialogs.
- Branch selection remains owned by the workspace header.

## Verification

- `git diff --check` passed.
- Docker web production build passed and the `web` service restarted successfully on port 3100.
- Authenticated desktop DOM/visual verification passed at `/companies/seed-local-company/bookings`.
- Previous-week navigation exposed an enabled `กลับมาวันนี้` action; returning restored the disabled `กำลังดูสัปดาห์นี้` state.
- A 390 × 844 viewport check passed: the header stayed within the viewport (`left 16`, `right 359` of `390`) with no internal horizontal overflow.
- The booking-buffer select remained present and enabled; no booking or configuration data was mutated during verification.
