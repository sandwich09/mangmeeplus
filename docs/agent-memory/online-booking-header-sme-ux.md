# Agent Memory: Online Booking Header SME UX

Status: Completed 2026-07-19
Owner: Product owner / Codex
Scope: Improve only the online-booking page header for clear SME scheduling context, responsive layout, and action hierarchy.
Decisions:
- Use one cohesive header/control panel.
- Keep today's count as a separately labelled KPI so it is not confused with the selected week.
- Make week navigation primary and booking-buffer configuration secondary.
- Preserve branch ownership in the global workspace header and preserve all booking contracts/mutations.
- Follow ponytail full mode: existing components/state only; no new dependency or speculative automation.
Open questions: None for this scoped header redesign.
Artifacts:
- `docs/specs/online-booking-header-sme-ux-spec.md`
- `docs/plans/online-booking-header-sme-ux-plan.md`
- `apps/web/src/features/crm/BookingsPrototypePage.tsx`
Verification:
- `git diff --check` passed.
- Docker production build completed and the web container restarted successfully.
- Desktop visual/DOM check confirmed the page identity, branch context, today's queue count, week navigator, and buffer control.
- Week navigation and return-to-current-week states passed interaction checks.
- Mobile check at 390 × 844 showed no header overflow and retained a clear vertical action hierarchy.
Next: No follow-up is required for this scoped header redesign; keep future booking changes aligned with the UX spec.
