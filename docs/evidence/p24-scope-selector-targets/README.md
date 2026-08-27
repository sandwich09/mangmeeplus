# P24-2b — Company and branch selector evidence

Status: final scoped local browser checks passed; PR/exact-head CI pending. This is local
synthetic-data evidence, not full P24, physical-device or human 40+ acceptance.

## Real Chrome baseline — 2026-08-27

- Frontend source: `d8d9808e41d15360810ed67e9169ade0cd5605ab`, before the selector
  production edit, served from the isolated P24 worktree on `http://127.0.0.1:3004`.
- Existing local API: port3003, expense-capture head
  `179981a45f00a1d0b3a1898dce9f877f2457563e`; no database bootstrap, permission grant,
  identity mock or cloud/provider operation. The existing synthetic Local Owner session
  returned two companies and four active branches for `seed-local-company`.
- Native Chrome viewport: **1126×796 CSS px**. This is not the separate1280px automated
  matrix or an emulated/physical mobile result.
- Opened and closed both menus through their visible buttons. Company and branch were
  not changed during this baseline. DOM inspection was read-only; screenshots are unedited.

| Rendered control | Width | Height |
| --- | ---: | ---: |
| Company trigger | 214.3828125 | 40 |
| Branch trigger | 158.2421875 | 40 |
| Each company option (2) | 278 | 36 |
| All-branches option and each branch (5) | 246 | 36 |
| Notification bell, existing P24-2a control | 44 | 44 |

Both target triggers and every option are below the44px acceptance height. No horizontal
document overflow was present. These actual rendered measurements confirm the source
finding rather than treating a CSS class name as proof.

- [Company menu before](chrome-before-company-desktop.jpg)
- [Branch menu before](chrome-before-branch-desktop.jpg)

## Real Chrome — final selector correction

Source `WorkspaceScope.tsx` SHA256
`9181d1970c85a844a049e9137a9a642302b4389bbb703eece1812af326ce242f`, including the
long-list popup-height correction. Same API, synthetic session and native1126×796
viewport as above. Root repeated the real journey and recaptured the three after-images
on this final source; the earlier intermediate screenshots are not used as final proof.

- Company trigger214.3828125×44, both company options278×44; branch trigger158.2421875×44,
  all five branch options246×44; notification bell44×44. No horizontal page overflow.
- Keyboard Enter opened and closed both menus; visible focus remained. Actual popup
  top63.5px, company bottom161.5px and branch bottom293.5px; computed max-height712px
  and overflow-y:auto. Small real lists remain fully visible without unnecessary scrolling.
- Clicked real branch `Room45 Eyes Lashes · สยาม`: header and dashboard scope changed to
  that branch without navigating away. Clicked `Bloom Beauty Clinic`: route became
  `/companies/seed-local-company-2/dashboard`, header/main scope changed to that company
  and all branches, and no old-company navigation links remained.
- Switched back to `WatchDog Local Company`, then selected `ทุกสาขา (รวม)` to restore
  the original browser state. No financial mutation, data seed, permission change or
  provider call. Browser error-level logs returned an empty list on the real paths.
- Root visually inspected all images below. This proves the rendered UI journey with
  the synthetic API data, not backend tenant-isolation or physical-device acceptance.

[Company menu](chrome-after-company-desktop.jpg) ·
[Branch menu](chrome-after-branch-desktop.jpg) ·
[Switched company](chrome-after-company-switch-desktop.jpg)

## Automated mobile/tablet/desktop evidence

The final registered P24-2a/2b + BSC-03 run started2026-08-27T05:46:45.613Z and finished
in88.055s: **61 expected passes, zero skipped, unexpected or flaky; no report errors**.
Root independently read the final JSON and reran the focused unit checks:89/89 passed,
zero skipped. Commands, full-suite/typecheck results and historical red runs are in
[task memory](../../agent-memory/p24-scope-selector-targets.md).

The reviewer found that44px options exposed a many-options overflow; four rendered red
tests confirmed it before changing the two existing popup CSS classes. With20 companies
or100 branches plus "all", the old fixed popup bottoms were966/4530px. The final bounded
menus end at732px in360×740,836px in390×844 and879.5px in1280×900. Tests verify actual
internal scrolling, visible focus/hit-testing, and Enter selecting the final original
valid option; synthetic IDs are never selected. No new record is seeded.

Selected unedited PNGs copied byte-for-byte from the final mobile-Chromium report:

- [Real branch menu,390×844 CSS px](mobile-real-branch-390.png): actual API rows;
  source attachment `real-branch-390px`, PNG1024×2216 due to emulated device scale.
- [Readable retries,360×740 CSS px](mobile-mock-retries-360.png): **mocked503 UI state**,
  attachment `mock-503-retries-360px`, PNG945×1943. Both "ลองใหม่" labels fit; retry then
  restores real options. Not evidence of a real backend outage.
- [Long menu scrolled to final valid branch,360×740 CSS px](mobile-mock-long-branch-scrolled-360.png):
  **synthetic long-list geometry only**, attachment `mock-long-branch-360px-scrolled`,
  PNG945×1943. Not proof of permission or100 real memberships/branches.

Root visually inspected these images. Thai is the actual workspace locale; unit checks
also verify the existing English retry-label relationship, not English rendered UX.
Local full report: `test-results/p24-scope-long-list-final-report/index.html`; JSON:
`test-results/p24-scope-long-list-final.json`. Reports/traces remain ignored and are not
committed because they may carry session information. Only the eight selected images
and this explanation are delivery artifacts. No physical device or actual40+ user test
is claimed, and this bounded correction does not close the full P24 backlog.
