# Agent Memory: homepage SEO local preview 2026-10-29

Status: VERIFIED_FOR_DIRECT_INTEGRATION — owner approved direct integration into develop and main without a PR, with review red removed and Halloween included.
Owner: Codex
Scope: Help prospective shop owners connect MangmeePlus to บริษัท มั่งมียั่งยืน จำกัด and understand receipt AI, expense capture, accountant handoff and package-specific tax documents through visible homepage copy and matching metadata.

Decisions:
- Owner requested “ลองทำมาให้ดูหน่อย ใน local” following the SEO proposal. Keep the current homepage layout, H1, pricing, permissions and customer flows. No new landing pages, keyword lists, hidden SEO text, dependency or package.json changes.
- Isolated managed worktree `/Users/thawatchai/.codex/worktrees/homepage-seo-preview/mangmeeplus`, baseline origin/main `9d4ad53e0`. The original checkout predates the public homepage and contains unrelated work.
- Reuse home-content.ts, home-faq.json, native details/summary and the existing Organization → WebSite/SoftwareApplication graph. Keep the existing FAQ JSON-LD in sync with visible answers; no promise of FAQ rich results.
- Shorten the title; put company identity and the actual workflow in the description and visible introduction. Clarify company ownership, AI draft/review, accountant handoff and the existing Enterprise tax boundary. No claims of full accounting, automatic filing or DBD endorsement.
- No registration number or external company profile link until independently checked against authoritative company records. DBD/DataForThai search behavior is outside this local change.
- Read current AGENTS.md, Thai UX standard and bundled Next metadata/JSON-LD docs. The absolute Ponytail path was absent; read the identical-purpose skill at the original repo's `.agents/skills/ponytail/SKILL.md` and apply full mode.
- Historical review: owner requested changed/new copy in red using `?preview=seo`. After approval, removed that temporary prop, query handling, CSS and review-only test. The old URL now shows normal theme colors. No review implementation remains in the final diff.
- Positioning refinement: owner wants the top message to lead with expense workflow, simpler teamwork and safety, with receipt AI as a supporting capability. Kicker becomes “คุมรายจ่ายเป็นระบบ ตั้งแต่เบิกจ่ายถึงส่งบัญชี”; hero supporting copy names shared receipts/claims, submitter/approver permissions, recording actual payment and accountant handoff. Retain the existing pain-point H1. Title and shared visible/metadata description now lead with expense/claim workflows; AI remains secondary. No claim of automatic transfer, fraud prevention, guaranteed savings or universal accounting coverage.
- Both default and Halloween render the same PublicHome content, metadata and FAQ source. No duplicate themed copy or changes to the Halloween game are needed. Existing seasonal parity tests cover forest, pumpkin and plum palettes.
- Direct Git push is authorized. At integration preparation, origin/main and origin/develop both equal baseline `9d4ad53e0e7fbcd214e8a9954f27bd3572d5b198`. Deployment workflows require dispatch; Git push does not deploy. No PR or workflow dispatch requested.

Plan:
1. Make the scoped copy/metadata changes using existing components.
2. Run existing focused homepage/schema/route checks; update only obsolete copy expectations.
3. Open a loopback-only Next preview and inspect the real browser at 390 and 1280, including FAQ, metadata, pricing and links. Save screenshots and results.
4. Remove temporary red review, verify normal/Halloween, then push the same reviewed commit to develop and main without force or a PR.

Open questions:
- None; approved copy and branch targets are explicit.

Artifacts:
- apps/web/src/features/public-home/{PublicHome.tsx,home-content.ts,home-faq.json}
- Existing home-routes.spec.ts: updated title/description expectations. No changes to page.tsx, public-home.css or PublicHome.rendered.spec.ts remain.
- docs/evidence/homepage-seo-local-preview-2026-10-29/: `final-default-{390,1280}.png`, `final-halloween-{390,1280}.png`, `final-browser-results.json` and `homepage-tests.tap` are final evidence. Earlier screenshots/JSON preserve review history, not the final colors/copy.
- Normal: http://127.0.0.1:43841/#top ; Halloween: http://127.0.0.1:43841/?preview=events&event=halloween&palette=plum#top . Local Next terminal session 65554.

Verification:
- Dependencies installed from the existing lockfile offline with lifecycle scripts disabled. Contracts build passed.
- Final command from apps/web: `corepack pnpm exec tsx --test src/features/public-home/PublicHome.rendered.spec.ts src/features/public-home/home-routes.spec.ts src/features/public-home/home-help-v6.spec.ts src/features/public-home/home-events.spec.ts src/features/public-home/home-theme.server.spec.ts` — 27/27 pass after red removal. Covers rendered FAQ/JSON-LD equality, unchanged plan catalog/permissions/protected paths, seasonal content/link parity and theme selection/fallback.
- Real in-app browser at 390×844 and 1280×900: visible intro equals description, company/product publisher relation intact, 21 FAQ entries equal JSON-LD, one H1, correct canonical, no horizontal overflow. Mouse open/close and keyboard Enter toggles work. Screenshots inspected.
- Final default/Halloween browser checks at 390×844 and 1280×900: no review markers, no horizontal overflow; paired hero buttons are 358×52 on mobile and 220×52 on desktop. Kicker/lead use their respective theme colors. Visible description equals metadata and all 21 FAQ answers match JSON-LD in both themes. Halloween FAQ opens by mouse and closes with Enter. Four final screenshots inspected; viewport override reset afterwards.
- One development hydration warning was caused by opening native details before initial React hydration finished. Reloaded, waited for network idle and repeated interaction; the warning did not recur on that fresh document. No business API, login submission, signup or payment tested; local API points to unused loopback ports and default theme uses the existing failure fallback.
- No package.json/lockfile, backend, API contract, permission, schema or business-flow changes. Full production build and authenticated/payment flows were not run for this copy-only change. UAT/READY/Production NOT_DISPATCHED.
- After the expense-workflow positioning refinement: focused suite still 23/23 passes; real browser 390/1280 screenshots inspected, no horizontal overflow, title updated and description still matches the visible introduction. Hero buttons match at 358×52 (mobile) and 220×52 (desktop). Current title: “มั่งมีพลัส (MangmeePlus) | จัดการรายจ่ายและเบิกจ่ายอย่างเป็นระบบ”. No new logic or capability added; reviewed wording against expense/claim/permission/export help contracts.

Next:
- Commit and push the verified scope to both approved branches; record remote verification. Keep the local preview available. No Google indexing/ranking outcome is implied by local checks.

Restart from this worktree root:

```sh
INTERNAL_API_URL=http://127.0.0.1:43842/v1 NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:43842/v1 NEXT_PUBLIC_AI_GATEWAY_BASE_URL=http://127.0.0.1:43843/v1 corepack pnpm --filter @watchdog-bms/web exec next dev --webpack -H 127.0.0.1 -p 43841
```
