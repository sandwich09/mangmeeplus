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
- **2026-08-10 CI gate follow-up:** the readiness fixture, evidence-manifest release target and
  controller-owned contract/validator pins now follow `v1`; the validator accepts the v1 contact
  context without claiming a verified registered office. Both legal evidence specs,
  `production-image-security.spec.sh`, shell syntax checks and `git diff --check` pass.

## 2026-08-12 — `/legal-acceptance` set as a record, not a card

Requested treatment: make the acceptance gate read as an official document. Visual only —
no form logic, field names, aria wiring or legal statement text changed, and no new colour
or typeface was introduced (every value still resolves to an existing token).

- **Geometry.** Sheet radius 20px → 4px, lifted shadow → one hairline, sheet border firmed
  to `gray-300`. The rounded-card-with-drop-shadow was most of why a signature page read as
  SaaS onboarding.
- **Rules run the full width of the sheet.** `--doc-accept-pad` holds the sheet's inner
  margin; clause rows and the execution block cancel it with a negative inline margin and
  restore it as padding, so the hairlines reach the edge the way a ruled form's do.
- **Register in the header band.** The single "company" line became a three-item `<dl>`:
  company in scope, signing capacity, and the date the current document pair took effect
  (Buddhist era, formatted from `effectiveDate`; the later of the two dates, since the pair
  can be released separately). Uses `grid-template-rows: subgrid` at ≥40rem so a wrapped
  label cannot drop its value below the others' baseline.
- **Each document clause carries its artifact SHA-256** (head+tail, full value on `title`).
  It is the same checksum written to the evidence row, so the reader can tell which exact
  file their acceptance binds to — this is what makes the screen a record rather than a form.
- **Checkbox is hand-drawn** (`appearance: none`, 18px, 1.5px rule, square tick) instead of
  the platform control, and the execute button is solid `brand-900` with a 4px radius: the
  product's green gradient was reading as a sign-up CTA on a legal instrument.
- **Attestation line above the button** names exactly what the append-only evidence row
  stores. Keep that sentence and `legal-acceptance.service.ts`'s `common` record in step.
- **Print rules extended to the acceptance sheet** — people file these.

Verification: `apps/web` `tsc --noEmit` reports no errors in the touched files (the 4 that
remain are pre-existing, in `src/features/expenses/evidence-audit.logic.ts`). Rendered at
1440 and 390 through a same-origin static preview of the markup against the real
`theme.css`/`fonts.css`/`legal.css` — no horizontal overflow at either width.

**The live route can be reached after all**, which is worth recording since the earlier pass
concluded it could not: bring up `infra/docker/compose.local.yml` (postgres, redis, minio,
api, ai-gateway) and run `apps/web` in `next dev`, then create a disposable member exactly
as `e2e/legal-acceptance.spec.ts` LEGAL-01 does (POST `settings/employees` → `/complete` →
sign in with the DOB temporary password → change password → the gate). Do **not** try to
clear an existing user's acceptance instead: `LegalDocumentActionRecord` has a trigger that
rejects UPDATE/DELETE/TRUNCATE. Driven end to end at 1440: empty submit shows the required
error and focuses `termsAccepted`, all three boxes then submit and land on the dashboard.

That run also caught a layout bug the static preview could not: the local API image is an
older release whose document titles are longer, which wraps `เปิดอ่านเอกสารฉบับเต็ม` onto its
own line — and the checksum line, being a sibling of `.doc-accept-head`, then sat *below* the
wrapped link. The checksum now renders inside the head's title block, so a document's
identity stays in one piece at any title length. Older API releases do send `artifactSha256`,
so the checksum line does not need the deprecated `releaseFingerprintSha256` fallback.

Known unrelated staleness found while reading the suite: `e2e/legal-acceptance.spec.ts:140`
asserts `span.text-red-600` inside each checkbox label, but the required mark has carried
`doc-accept-required` since the original overhaul. Not touched here.

## 2026-08-12 — one family for every PDPA surface, and a larger signing sheet

Follow-up on the same request: bigger, more formal, **no copy changes**, and all PDPA
surfaces on one font.

- **One typeface across `/privacy`, `/terms`, `/data-deletion`, `/legal-acceptance`.** The
  brand stack puts Outfit ahead of IBM Plex Sans Thai, so every "MangmeePlus", version
  number and SHA-256 was set in a different face from the Thai sentence carrying it. The
  shipped Plex subset was Thai-only, so `fonts.css` now also serves the family's Latin
  companion (`plex-thai-latin-{400,500,600,700}.woff2`, ~53 KB, same SIL OFL family and the
  same Google Fonts CSS API source as the Thai subsets), and `.doc` names
  `'IBM Plex Sans Thai'` first. Outfit stays in the stack as the fallback for codepoints
  outside the subset, and the rest of the app is untouched — the switch is scoped to `.doc`.
  The three `font-family: 'Outfit'` overrides inside legal.css are gone; `.doc-display` now
  only carries tabular figures.
- **The signing sheet is set one step up the scale** (`--doc-text-*` redefined on
  `.doc-accept-main`, which must also restate `font-size` since rem is root-relative) and
  widened to 52rem. The long notices keep their proven measure — a short instrument read
  once carefully earns a larger setting than the documents it points at.
- **More document, less card:** clause numerals now sit in their own ruled gutter, the
  opening and closing rules are 2px against the 1px between clauses (the hierarchy a ruled
  form uses), the checkbox is 21px, and the execute control is 56px tall.

Verification: rendered live against the local stack — the acceptance gate at 1440 and 390
(no horizontal overflow at either) and all three notices at 1440. `document.fonts` reports
both the Thai and Latin Plex faces loaded, and `.doc` computes to
`"IBM Plex Sans Thai", Outfit, …` on `/privacy`. `offline-fonts.spec.ts` passes (it asserts
no font CDN and that every `@font-face src` resolves to a checked-in file). `apps/web`
`pnpm test`: 896 pass, 2 fail — both pre-existing and unrelated (release URL/bytes fixture
expecting `/legal/releases/v2/…` where the contract serves `2026-08-09.2`), confirmed by
re-running the suite with this work stashed.

## 2026-08-14 — Sarabun, and `/legal-acceptance` rebuilt as a full-viewport screen

Owner request: redesign the PDPA screens plain but modern ("สมกับเป็นบริษัทที่ develop ด้วย AI"),
full-bleed on the web and still well-proportioned on a phone, set in TH Sarabun, easy to read
and easy to press Accept. No copy was changed and no form logic, field name or aria wiring was
touched.

- **Sarabun replaces IBM Plex Sans Thai on `.doc`, i.e. all four PDPA surfaces.** This
  reverses the original overhaul's premise on purpose: that pass read the loopless
  "government form" look as the bug, but the bug was actually the *unshipped* stack
  falling back to Thonburi. Sarabun (Cadson Demak, SIL OFL, the web-built redraw of
  TH Sarabun New) is the face Thai readers associate with an official document, and it is
  what the owner asked for. Self-hosted like the others — `sarabun-{thai,latin}-{400..700}.woff2`,
  86 KB, from the same Google Fonts CSS API source, so `offline-fonts.spec.ts` still holds.
  Scoped to the `.doc` block; the rest of the app keeps the Outfit/Plex brand stack.
  The four `plex-thai-latin-*.woff2` files added on 2026-08-12 were deleted — they existed
  only to give `.doc` one family for both scripts, which Sarabun now does. Plex's *Thai*
  faces stay: tokens.json names the family app-wide and the spec asserts it is served.
  Sarabun runs optically small, so the whole `.doc` scale moved up one step (body 17px → 18px).
- **The acceptance gate is now `doc-gate-*`, not `doc-accept-*`** — the file has no
  `doc-accept` selectors left. Full-viewport CSS grid: a fixed brand column (identity,
  eyebrow/title/intro, register) and a work column that scrolls *inside itself* at ≥64rem,
  where `.doc-gate` is `height: 100dvh; overflow: hidden`. The page itself does not scroll
  on a wide screen; at 1920×1080 the entire instrument fits with nothing cut off.
- **Accept is a sticky bar, and that is the constraint the layout is built around.**
  `.doc-gate-execute` is the last child of the form with `position: sticky; bottom: 0` and
  `margin-top: auto` — the auto margin matters: without it, a short form leaves the bar
  floating mid-page, because sticky only pulls an element *up*. It carries a progress line
  ("ยืนยันแล้ว N จาก 3 รายการ" plus three marks) so the reader can see why they are not
  through yet. The submit button is still never disabled — an empty submit has to name the
  missing item and focus it.
- **The three ticks are cards with a full-width hit area.** Each `.doc-gate-check` is a
  bordered 3.5rem-min block, and `:has(input:checked)` tints the whole card and fills its
  numeral, so progress is legible from a glance down the column. Deliberately **no**
  "accept all" master control: each statement is separately affirmed and separately written
  to the evidence row, and one toggle that ticks three legal statements is not that record.
- **`doc-gate-foot` (document links + sign out) is its own grid child, not the tail of the
  aside.** On a phone those ~280px of secondary material sat above the task and pushed the
  first confirmation off the opening viewport entirely; as a third grid row it lands under
  the work column on mobile and continues the brand column at ≥64rem.
- Two Thai typesetting fixes: the title dropped `text-wrap: balance` and its `18ch` measure
  (both broke the line inside "ใช้งาน" — Thai has no inter-word spaces, so any width target
  is met at a syllable boundary), and `.doc-gate-hash` lost its `letter-spacing`, which was
  tracking the Thai "ค่าตรวจสอบไฟล์" label.
- `e2e/legal-acceptance.spec.ts:139` was fixed while here: it asserted `span.text-red-600`
  inside each checkbox label, which had been dead since the original overhaul (noted as
  known-stale on 2026-08-12). It now asserts `span.doc-gate-required`.

Verification: `apps/web` `tsc --noEmit` reports only the 4 pre-existing
`src/features/expenses/evidence-audit.logic*` errors. `pnpm test` 898 pass / 0 fail — the two
release-href failures recorded on 2026-08-12 were a stale `packages/contracts/dist` (serving
`2026-08-09.2` where the source says `v3`); rebuilding that gitignored dist clears both and
they are unrelated to this work. Rendered through a same-origin static preview against the
real `theme.css`/`fonts.css`/`legal.css` at 1920, 1440, 390 and 320: no document-level
horizontal overflow at any width, six Sarabun faces report loaded, `.doc` computes to
`Sarabun, Outfit, …`, the execute bar pins to the viewport bottom at every scroll position
(at 390 it is on screen at first paint; at 320 the aside is 643px tall so it takes one short
scroll), and on desktop the page is unscrollable while the work column scrolls internally.
`/privacy` was re-rendered through `render-legal-release-artifact.ts` and checked at 1440
and 390.

### v3 re-cut in place, not bumped to v4

The immutable artifacts inline the stylesheets as they stood when the release was cut, so after
the typeface change the full documents opened from the gate would have stayed in Plex while the
four live pages were Sarabun. The owner confirmed nobody had accepted v3, so the two files were
re-cut in place — the same pre-launch treatment v1 got, and the reason to prefer it over cutting
v4 is that a v4 would leave an orphan version and a re-prompt path for a change that alters no
legal text. `flag: 'wx'` means the old files had to be deleted first; that deletion is the
deliberate act, so it is recorded here.

Everything from `<body>` onward is **byte-identical** to the first cut (verified by diffing the
post-`<body>` slice against `git show HEAD:…`); only the inlined `<style>` differs. New hashes:
Terms `4d21b7b5c98171d0ae7ca34ccf93c215304822bd512af11c63993a8f13fbe8ed`, Privacy
`cd86af5ede65d5bcdd9be9910da5382b8ad2a07bb8e2eb29b148062150709fc7`.

Everything that pinned the old bytes was moved in step — there were exactly three places, found
by grepping the hashes repo-wide:

- `packages/contracts/src/legal-acceptance.ts` — `artifactSha256` and the deprecated
  `releaseFingerprintSha256` for both documents.
- `.github/workflows/deploy-production.yml` — `EXPECTED_LEGAL_ACCEPTANCE_CONTRACT_SHA256`, which
  pins the *source hash of that contract file*, so editing the artifact hashes changes it too:
  now `26ee59215e2d8ef5944b60cdcc6e674d22ed3eeacd43c716c2adefc6aa381b60`.
  `infra/docker/production-image-security.spec.sh:289` is what enforces the two staying in step.
- `docs/agent-memory/mangmeeplus-privacy-terms-data-deletion.md` — the recorded verification hashes.

Nothing else needed touching: `validate-legal-release-readiness.sh` *derives* the expected
hashes from the contract source and compares them to the files on disk (lines 112–113, 174–175)
rather than carrying its own copy, and `docs/security-evidence/legal-release-evidence.json`
targets `releaseVersion: "v3"`, which did not move. The manifest stays `BLOCKED`; running the
validator standalone still stops at the missing `LEGAL_RELEASE_EVIDENCE_SHA256`, which is the
documented pre-launch state and not a regression.

Verification after the re-cut: contracts 121/121, `apps/web` 898/898, API
`legal-acceptance.service.spec.ts` 14/14, `validate-legal-release-readiness.spec.sh`,
`provision-legal-release-evidence.spec.sh` and `production-image-security.spec.sh` all pass.
(The last needs `pnpm` on PATH; in a shell without it, it fails at line 2213 for that reason
alone — `corepack pnpm` via a shim is enough.)

## Next

- Because this remains pre-launch, the narrowed copy is consolidated into v1. The legal-release
  evidence manifest now targets `v1` but remains `BLOCKED`; no review evidence was fabricated.
  Once v1 has been accepted in production, any content change requires bumping `RELEASE_VERSION`,
  cutting a new
  release directory, updating hashes, and prompting again. `docs/security-evidence/legal-release-evidence.json`
  remains `BLOCKED` on operator identity, rights mailbox, DPO assessment, processor cross-border
  register, and Thai counsel approval.
- Fonts are referenced as absolute `/fonts/*.woff2`. Correct for same-origin serving
  (including `/legal/releases/…`), but a snapshot opened as a standalone downloaded file
  will fall back to system faces.
