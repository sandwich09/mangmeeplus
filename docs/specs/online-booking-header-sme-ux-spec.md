# Online Booking Header — SME UX Specification

Status: Implementing 2026-07-19

## Product goal

Let an SME owner or front-desk employee answer three questions immediately: which branch am I scheduling, which week am I viewing, and how many appointments are today. Keep week navigation fast and make the collision-prevention buffer understandable without competing with daily scheduling controls.

## Problems in the current header

- Title/summary and controls form two visually disconnected groups.
- The subtitle mixes instruction, branch, and today count with repeated separators.
- `วันนี้ 0 คิว` appears beside a different selected week, which can be misread as that week's count.
- Buffer configuration has the same visual priority as week navigation despite being changed far less often.
- Four separate bordered shapes create visual noise and uneven alignment.
- On narrower widths, wrapping does not preserve a clear reading or action order.

## Required hierarchy

1. Page identity: `การจองออนไลน์` and a short plain-language purpose.
2. Context: active branch and today's appointment KPI as distinct badges.
3. Primary control: previous week, selected week range/tag, next week, and `กลับมาวันนี้`.
4. Secondary setting: `เวลาพักระหว่างคิว` with helper text explaining that it prevents overlapping appointments.

## Control contract

| Control | Behavior |
|---|---|
| Branch badge | Read-only reflection of current workspace branch scope; branch remains changed from the global header. |
| Today KPI | Shows today's count independently from the selected week. Must be visually labelled `คิววันนี้`. |
| Previous / next week | Move exactly one calendar week and reload the same branch scope. Accessible names remain explicit. |
| Selected week | Non-interactive center display with relative tag and Thai date range. It is the visual anchor of the toolbar. |
| `กลับมาวันนี้` | Reset week offset to the current week. Disabled when already on the current week so state is obvious. |
| Buffer selector | Persist booking-buffer setting through the existing API. Disabled while saving or without update permission. Helper text explains business effect. |

## Visual and responsive rules

- Use one rounded white panel with subtle border/shadow; avoid multiple unrelated cards.
- Use brand color for current context, not for every control.
- Desktop: context on top; week navigation and secondary setting share the lower toolbar.
- Narrow screens: stack title/context, make week navigation full width, then place buffer setting below.
- Maintain 44px-ish touch targets, visible focus behavior, accessible labels, and no horizontal overflow in the header.

## Acceptance criteria

- Branch, selected week, and today's KPI are unambiguous at a glance.
- Only week navigation dominates; buffer setting reads as secondary configuration.
- `กลับมาวันนี้` clearly indicates when it has no effect.
- Existing booking API behavior, permissions, calendar grid, creation, and lifecycle actions are unchanged.
- Docker production build passes and authenticated desktop/narrow browser checks pass.
