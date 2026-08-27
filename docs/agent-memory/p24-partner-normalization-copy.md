# Agent Memory: P24 Partner normalization-pending copy

Status: MERGED DEVELOP via PR #284 at `78057e3848414190b5803d89658aee83b0b51420`; exact-head CI `33035656163` SUCCESS on `73beae72`. Local browser acceptance passed; no entitlement or deployment change.
Owner: Codex / phase6_launch_review; parent owns the P24 local browser acceptance.
Scope: Platform Admin → Partner detail → package controls only. Capture-first delivery remains the active scope; subscription and reconciliation/P15–20 remain out of scope.

## Product and acceptance (recorded before code changes)

This is a small P24 clarity correction under [Growth/UX spec §2.2–2.3](../specs/mangmee-growth-ux-full-pass-spec-th.md#22-navigation-ตามบทบาท--preference), not a new entitlement feature. [Entitlement spec CC7 / F1.5.1 item 1](../specs/feature-entitlement-decoupling-spec.md#cc7--legacy-normalization-has-its-own-company-state) remains authoritative: until the normalization predicate is current, every entitlement command is refused without writes and the package screen is read-only.

The previously diagnosed legacy snapshot has no entitlement rows or normalization marker, so normalization is pending. The menu display intentionally preserves legacy effective-ON behavior, while all package commands remain locked. Two messages contradicted that state: the missing-readiness fallback suggested reloading would fix it, and a static sentence promised that enabling more features was still available.

Acceptance for this slice:

1. Missing disable-readiness explains that feature-rights information is incomplete and closing is unavailable; it does not prescribe a reload as a normalization remedy. A supplied API readiness reason still wins.
2. Package guidance uses the existing composite `controlsLocked` state. While locked for normalization, contract readiness, company lifecycle state, or saving, it explicitly says neither enable nor disable is available. Editable guidance describes review/save without promising that every feature can change. Existing permission checks remain untouched.
3. The canonical normalization banner remains exactly the existing API/i18n sentence; no new retry, normalization trigger, or automatic-progress promise is introduced.
4. Zero-row effective-ON display, directional disable readiness, dependency cascades, permission guards, normalization predicate, CAS, idempotency and the API are unchanged.
5. Add regression cases to the existing `system-partners.logic.spec.ts` suite and run focused tests plus web typecheck. Browser/device acceptance is separately owned by the parent; unit tests are not real-device evidence.

## Implementation plan

1. Change the shared missing-readiness fallback text once, so cards, submenus, groups and presets keep one reason.
2. Add a small presentation helper for locked/editable guidance and wire it to the existing `controlsLocked` value; do not alter its computation or button guards.
3. Verify the copy with the legacy empty snapshot, explicit server refusal, missing normalization state, and editable state; retain existing access/cascade/idempotency tests.

Decisions:

- Worktree: `/Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus-p24-partner-copy`; branch `codex/p24-partner-normalization-copy`; base `origin/develop` at `d2b40f37948d482c1bdd29c6047551c4258f24a7` (includes capture-first PR #282).
- Follow Ponytail full: reuse the existing readiness/lock/presentation patterns, no dependencies or `package.json` changes. The AGENTS legacy skill path is absent; the repository `.agents/skills/ponytail/SKILL.md` was read and used.
- Do not edit the shared P24 shell spec/implementation or primary dirty worktree. This note is the scoped acceptance/plan supplement.

Open questions: None for this copy-only correction. Normalization execution is a separate audited operation and is not authorized by this slice.

Artifacts:

- `apps/web/src/features/system-partners/PartnerDetailPage.tsx`
- `apps/web/src/features/system-partners/system-partners.logic.ts`
- `apps/web/src/features/system-partners/system-partners.logic.spec.ts`

## Implementation result

- Missing-readiness fallback now reads: “ข้อมูลสิทธิ์ของฟีเจอร์นี้ยังไม่ครบ จึงยังปิดไม่ได้”. Server-supplied readiness reasons retain precedence.
- `featurePackageEditingNotice(controlsLocked)` reads: “ขณะนี้ยังเปิดหรือปิดฟีเจอร์ไม่ได้” while locked, otherwise explains review and successful saving. `PartnerDetailPage` passes the same existing lock value used by its controls; no lock or API computation changed.
- Canonical normalization banner, current entitlement values, feature-key calculation and all mutation paths are unchanged. The two inaccurate original sentences are absent from the system-partners feature.

Verification (2026-08-27, isolated worktree):

- `corepack pnpm install --frozen-lockfile` — PASS; reused the existing lockfile, no dependency or tracked manifest changes.
- `corepack pnpm --filter @watchdog-bms/contracts build` — PASS.
- `corepack pnpm --filter @watchdog-bms/design-tokens build` — PASS; no generated tracked changes.
- `corepack pnpm --filter @watchdog-bms/web exec tsx --test --test-reporter=spec src/features/system-partners/system-partners.logic.spec.ts` — **39/39 PASS, 0 skipped**. Includes empty legacy snapshot, incomplete-readiness copy, pending/missing normalization state, locked/editable guidance, API/i18n banner parity, directional/cascade behavior and ambiguous retry regressions.
- `corepack pnpm --filter @watchdog-bms/web typecheck` — PASS (`next typegen && tsc --noEmit`).
- `git diff --check` — PASS. Reviewed diff contains only the three scoped web files and this memory; no `package.json`, guards, CAS or API changes.
- The regression remains in the existing web `src/**/*.spec.ts` suite. No browser, real-device, DB, cloud or CI-run evidence is claimed by this slice; parent owns browser acceptance and subsequent delivery.

## Parent integration and real Chrome evidence — 2026-08-27

- Reviewed all three production/test diffs against existing lock/readiness behavior; no permission, API, state or save-handler change.
- `pnpm --filter @watchdog-bms/web test` — **1128/1128 PASS, 0 skipped**.
- `pnpm --filter @watchdog-bms/web typecheck` — PASS after running the local dev server.
- Signed in through the real local login form using the repository's SYSTEM_ADMIN seed fixture, navigated through Partners → WatchDog Local Company, and inspected package controls at **1280×900** and **390×844**.
- New locked guidance and canonical normalization notice are visible. The old enable-more promise and reload advice are absent. Existing checked feature switches remain disabled; no switch/save/normalization mutation was performed.
- At both widths, document scroll width equals viewport width. Browser warning/error log is empty. Viewed both saved screenshots; this is Chrome viewport evidence, not physical-device or complete accessibility certification.
- Evidence: [desktop/mobile screenshots and reproduction notes](../evidence/p24-partner-normalization-copy/README.md).

## Delivery provenance — refreshed 2026-08-27

- [PR #284](https://github.com/MangmeeDev/mangmeeplus/pull/284) merged into develop at `78057e3848414190b5803d89658aee83b0b51420` on 2026-08-27T03:33:42Z after [CI 33035656163](https://github.com/MangmeeDev/mangmeeplus/actions/runs/33035656163) SUCCESS on `73beae72de9e16e2c1972d38f8d50dc6b6cf0f65`. This supersedes the earlier pre-PR status, not the scoped test/capture provenance above.
- This is source integration only, not normalization execution, main promotion or cloud deployment.

Next: Do not repeat this merged copy fix or normalize fixture data/relax guards to make the message disappear. The legacy company's pending normalization remains a separate audited operation; full P24/physical-device acceptance remains open.
