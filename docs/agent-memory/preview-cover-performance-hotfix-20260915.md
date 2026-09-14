# Agent Memory: Preview cover and performance hotfix 2026-09-15

Status: Cover UX and measured dependency hotfix implemented; verifying before PR/CI and UAT.
Owner: MangmeeDev; user requests cover loading, measured optimization and the same admin merge /
UAT deployment workflow. Production is out of scope.
Scope: Substitute document preview UX and the shared PDF-to-preview rendering bottleneck;
preserve document contents, original checksums, tenant/branch permissions and audit boundaries.

Decisions:
- Separate clean branch codex/hotfix-preview-cover-performance-20260915 from main6df364bc.
  Preserve unrelated dirty billing checkout and PR558. Mandatory ponytail full skill read from
  the available repository path; old /Users/spare058 path is absent. Reuse Modal/CoverLoader.
- Open document modal synchronously before the API wait. Center a cover over its document area
  until both response and page images are usable. Preserve dismissal/stale-response guards,
  retry/error visibility and print readiness; no barely visible inline-only spinner.
- Optimize only after isolated synthetic benchmarks in the exact serving API image. Do not
  change live customer data, relax integrity/authorization, lower print quality or add a dependency.
- Acceptance: immediate visible modal/cover, no duplicate requests, safe dismissal/company switch,
  error/retry settles, all pages/printing retained, measurable render improvement without data loss.
- CPU profile identified PDF.js convertRGBToRGBA as the bottleneck (~3845 samples vs~15 decompression).
  Its tail offset omits srcPos and reprocesses previous 16-row image chunks; this is inferred from
  profiling and the installed/upstream [converter source](https://raw.githubusercontent.com/mozilla/pdf.js/master/src/shared/image_utils.js).
  Patch the two endian tails in all six non-minified entry points of existing pdfjs-dist6.2.108.
  No PDF/SVG/JPEG quality, rendering scale, stored source, authorization or cache changes.
- Register the version-pinned dependency patch via pnpm9.15 patch-commit. Root package.json changes
  only patchedDependencies (the dependency-update exception); no scripts/metadata/other manifests.
  Lock patch hash6o6dpvpszt4vymt2xk2n656umq; copy patches before frozen install in all six Dockerfiles.
  Actual production-graph renderer smoke asserts both patched endian tails. Refresh existing exact
  maintenance enforcement hashes mechanically, without changing gate policy.

Open questions: None.
Artifacts: Existing hub action spec and loading plan, scoped preview tests, this memory.
Verification:
- Frozen-lock offline dependency install PASS.
- Serving image synthetic one-page baseline: PDF generation1271–1437ms; preview raster4326–4477ms;
  total5748–5763ms. Substep profile: parsing172ms, page render4239ms, JPEG encoding43ms.
- Re-encoding embedded page as JPEG100/4:4:4 made total6512–6582ms, slower than PNG;
  rejected this candidate, no live application/source mutation.
- Browser first wait hits documented browser selector transport deadline at~3s; later observed
  successful preview is not a precise latency measurement. No claim of73s request duration.
- Paired full pipeline A/B in an isolated process in the serving image (candidate module in memory,
  no serving-file/customer-data mutation): baseline5641/5688/5716ms vs patched1617/1609/1563ms
  (~72% median total reduction). Preview stage4357/4273/4356ms vs375/351/333ms (~92%);
  render4221/4223/4303ms vs296/296/278ms. Same one-page1191x1684, JPEG90, original lossless PDF.
- Dependency regression PASS: installed six entry points, both endian paths, first/late chunks,
  exact RGBA colors, adjacent sentinel preservation and exactly three tail reads independent of offset.
- Focused API renderer / download permission-state-checksum / bank import tests40/40 PASS.
- First full web test found missing retry aria-busy; fixed with existing native busy pattern;
  full rerun1715/1715 PASS. API/web typecheck and production web build PASS.
  Patched frozen-lock offline install and Prisma generation PASS.
  Initial maintenance pin check stale after Dockerfile edit; exact hashes refreshed (45 enforcement
  files retained, validator d84ed5897a14495e3562add4c4a994c1d28e0cf3dcc72e667bd370399dca57ed).
  Local linux/amd64 complete API/web image build and security audit in progress; do not claim PASS yet.
Next: Complete focused tests/typecheck/build/full CI,
admin merge develop/main, reread deployment protocol and dispatch one retained UAT hotfix.

Release ledger:
- Existing serving source f06c9ac8572e5fbbf1ee3bb7b0a7fd8d558a17b9,
  prior accepted operation20260914T182800Z-e3b8bc63. Current task has no deploy yet.
- UAT_RUN_ID / READY_RUN_ID / PROD_RUN_ID NONE; local Kamal operation pending.
- Cloud runbook read completely before isolated synthetic compute/read-only AWS instance inspection.
  UAT API t3.large x86_64 and AI/workers t3.medium x86_64; no architecture emulation mismatch.
