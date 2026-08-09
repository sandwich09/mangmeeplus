# Agent Memory: PDPA / legal pages design overhaul

Status: Implemented and verified locally. Not released — see Next.

Owner: Web (apps/web).

Scope: Visual/typographic redesign of the four PDPA-facing screens — `/privacy`, `/terms`,
`/data-deletion`, `/legal-acceptance` — plus the brand type stack they exposed as broken.
No legal copy was rewritten; the only text changes are the three page eyebrows (see Decisions).

## Decisions

- **Root cause of the "TH Sarabun / government form" look was a stranded font stack.**
  `app/globals.css` redefined `--font-family-sans` as `'Noto Sans Thai', Tahoma,
  'Leelawadee UI', Thonburi, …` — none of which the app shipped — so every machine
  substituted whatever Thai face it had (macOS resolves this to Thonburi). Meanwhile
  `packages/design-tokens/tokens.json` had declared the real stack, `'Outfit',
  'IBM Plex Sans Thai'`, which never loaded. Fix: self-host both families under
  `apps/web/public/fonts` (96 KB total, SIL OFL) via `src/common/styles/fonts.css`, and
  delete the local override so the design token wins. Keeps builds offline and
  deterministic — the original reason the override existed — while actually serving the
  brand type. Applied app-wide by the user's decision; `/login` spot-checked for regressions.
- **Documents, not dashboards.** The pages were a stack of nested rounded cards (white
  section card → tinted card grid → tinted callout), which flattened all hierarchy. They
  are now one continuous sheet divided by hairlines, with a title plate set as a colophon
  page, a scroll-spy rail, and 17px/1.9 body type (Thai diacritics lose definition below
  16px). All colour resolves to existing design tokens; no new hues were introduced.
- **Thai is never letter-spaced.** Tracking pulls tone/vowel marks off their base
  consonant. The tracked-uppercase label treatment is confined to `.doc-eyebrow`, which is
  Latin by design — hence the three eyebrows are now Latin classification labels
  ("Privacy notice · PDPA" / "Terms of service" / "Data deletion · PDPA"). This is the only
  copy change in the whole task.
- **Section numbering was deliberately NOT auto-generated.** A CSS counter over the sheet
  would renumber Terms' own legal clause numbers (its first section is an unnumbered
  summary, so every clause would shift by one). The rail numbers position-in-document;
  Terms' headings keep their own clause numbers. Do not "unify" these.
- **Release artifacts are append-only.** `scripts/render-legal-release-artifact.ts` writes
  with `flag: 'wx'`, and the existing `2026-08-09.1` / `.2` files under
  `public/legal/releases/` were left untouched — they are reviewed legal evidence. Only the
  *generator* was updated.
- **The generator no longer restates the design.** It previously hand-approximated Tailwind
  output with attribute selectors (`article [class*="rounded-xl"]`), so the static snapshot
  drifted from the live page — that mismatch is what the original screenshots showed. It now
  inlines the real stylesheets (design tokens + `fonts.css` + `legal.css`) verbatim.

## Artifacts

- New: `src/common/legal/legal.css` (document type system, ~950 lines, all `doc-` prefixed),
  `src/common/legal/LegalDocNav.tsx` (scroll-spy TOC + reading progress),
  `src/common/styles/fonts.css`, `public/fonts/*.woff2` (6 files).
- Rewritten: `src/common/legal/LegalPage.tsx` (same public component API, plus
  `LegalSubheading`, `LegalFootnote`, `LegalTable`), `src/features/auth/LegalAcceptancePage.tsx`
  (markup/classes only — form logic, field names, and aria wiring unchanged).
- Updated: `app/globals.css`, the three page files (utility classes replaced by components),
  `scripts/render-legal-release-artifact.ts`, `src/common/styles/offline-fonts.spec.ts`.

## Verification

- `tsc --noEmit` clean, run inside the Dockerfile `build` stage (`next build` cannot be
  trusted for this — `next.config.mjs` sets `typescript.ignoreBuildErrors: true`).
- `pnpm test` — 854 pass, 0 fail. `offline-fonts.spec.ts` was rewritten: it had pinned the
  exact broken stack, so it now asserts the stronger invariant (no font CDN in any
  stylesheet, every `@font-face` src resolves to a checked-in file under `public/`, and
  `globals.css` does not redefine `--font-family-sans`).
- Rendered and screenshotted `/privacy`, `/terms`, `/data-deletion` against the local docker
  stack at 1440 and 900 wide; `/login` checked for font-change regressions.
  `/legal-acceptance` could not be screenshotted directly (it 307s without a session and the
  gate needs specific DB state) — verified instead by class-resolution cross-check against
  `legal.css` plus a same-origin static preview of its markup.
- Release generator re-run in the builder image: exits 0, emits 120 KB with the real
  stylesheet inlined and zero `[class*=]` selectors.
- **2026-08-10 mobile follow-up:** rendered `/privacy` and `/data-deletion` at 320 px
  and 390 px.
  The three legal-document tabs now remain fully readable, and the long contents list
  becomes one compact horizontal anchor rail instead of delaying the first clause by
  several screens. The page has no document-level horizontal overflow; IBM Plex Sans
  Thai and Outfit both report loaded. Rechecked the deletion wording against the
  official MDES PDPA legislation index, the PDPA Act, the 2024 erasure rule, Accounting
  Act section 14, and Revenue Code section 87/3; no substantive copy changed, so the
  immutable 2026-08-09.2 legal release remains untouched. Web typecheck, the four
  focused legal-content tests, and `git diff --check` pass.
- **2026-08-10 legal/UX scope follow-up:** owner limited the first release to enabled launch
  feature families and set clickwrap to once per user per exact legal release. Public copy now
  removes deferred sales-document claims, customer auto-replies, CRM scoring/profiling, booking
  automation, and direct bank/payment connections; it distinguishes pseudonymisation from
  anonymisation and expressly requires deletion/destruction (not anonymisation) for unlawfully
  collected data. The current acceptance scope is user + immutable Terms/Privacy release, while
  company, membership, role and capacity remain initial evidence snapshots only. This substantive
  pre-launch change is consolidated into `/legal/releases/v1/`; after v1 is launched, later
  legal-content changes must create v2 and trigger a new acknowledgment.
- **2026-08-10 owner scope clarification:** even the earlier enabled-family list was broader than
  the intended public v1. Privacy, Terms, and Data Deletion now use a neutral boundary—only
  functions visibly enabled for the user's account—and no longer name CRM, LINE, OTP, AI/OCR,
  accounting/tax, filing, reports, or channel-specific opt-out behavior. The legal source module
  also no longer imports feature-specific marketing or retention constants. Because the product
  is still pre-launch, the existing v1 artifacts are rebuilt in place and will receive new hashes.
- **Verification for pre-launch v1:** contracts build, API/Web typecheck, `git diff --check`, and
  23 focused contract/API/Web legal-acceptance tests pass. Browser checks at 320 px and 1280 px
  confirm no document-level horizontal overflow; the mobile legal tabs and horizontal contents
  rail remain readable. Login exposes `/privacy`, `/terms`, and `/data-deletion`; Acceptance opens
  the exact `/legal/releases/v1/terms-th.html` and `privacy-th.html` artifacts and explains the
  once-per-user/across-companies rule. All three public pages and both artifacts contain none of
  the deferred-claim terms in the owner-approved scan. Both immutable responses report `v1`, have
  no script dependency, and their exact served-byte hashes are covered by the legal-content test:
  Terms `d1de74bdef45404d1c8b0e2f8d3d93c31ffd612ccea4d9ee90dcc1b4c35184c7`, Privacy
  `7b274807143af68ee51fa7bc3ec71174206a810eb9ff0de209ee81c10cb874a4`.

## Next

- Because this remains pre-launch, the narrowed copy is consolidated into v1. Once v1 has been
  accepted in production, any content change requires bumping `RELEASE_VERSION`, cutting a new
  release directory, updating hashes, and prompting again. `docs/security-evidence/legal-release-evidence.json`
  remains `BLOCKED` on operator identity, rights mailbox, DPO assessment, processor cross-border
  register, and Thai counsel approval.
- Fonts are referenced as absolute `/fonts/*.woff2`. Correct for same-origin serving
  (including `/legal/releases/…`), but a snapshot opened as a standalone downloaded file
  will fall back to system faces.
