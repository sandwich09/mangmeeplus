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

## Next

- Producing a static snapshot in the new design requires bumping `RELEASE_VERSION` in
  `scripts/render-legal-release-artifact.ts` and cutting a new release directory. That is a
  governance action, not a code change — `docs/security-evidence/legal-release-evidence.json`
  is still `BLOCKED` on operator identity, rights mailbox, DPO assessment, processor
  cross-border register, and Thai counsel approval. Left for the release owner.
- Fonts are referenced as absolute `/fonts/*.woff2`. Correct for same-origin serving
  (including `/legal/releases/…`), but a snapshot opened as a standalone downloaded file
  will fall back to system faces.
