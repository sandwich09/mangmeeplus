# Agent Memory: Preview cover and performance hotfix 2026-09-15

Status: Both full exact-head CIs PASS; admin merged develop/main, preparing one retained UAT hotfix.
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
  Local linux/amd64 complete API/web, AI and workers image builds PASS, including actual production-only
  dependency/Prisma/Thai PDF/1-3-2-page preview/bank PDF/signature smoke. All three final filesystem
  allowlists PASS; complete production-image-security fixtures PASS.
  Security audit PASS at existing high threshold: zero high/critical, existing13 moderate/1 low remain.
  Root patch registration, lock hash and dependency set remain unchanged after frozen install.
Next: One retained UAT hotfix, signed/customer OPEN acceptance and fresh browser cover verification;
then docs-only evidence merges to develop/main. Production remains out of scope.

Release ledger:
- Existing serving source f06c9ac8572e5fbbf1ee3bb7b0a7fd8d558a17b9,
  prior accepted operation20260914T182800Z-e3b8bc63. Current task has no deploy yet.
- UAT_RUN_ID / READY_RUN_ID / PROD_RUN_ID NONE; local Kamal operation pending.
- Reviewed candidate f3f5ff4561e5e2b0875ff97e9ed80db000b0d6db.
  PR569→develop CI34884275830 and PR570→main CI34884441376 (same hotfix head, independent PR refs)
  run full application checks in parallel; neither is merged until both exact-head CIs actually pass.
  Source baseline main/develop trees byte-identical before PR creation; billing PR558 excluded.
- CI34884275830 and34884441376 completed SUCCESS, including actual Typecheck and Test in both.
  Expected PR-only image publication skips are separate from the three successful local image builds.
- Owner-authorized admin merges: PR569→develop14bc3f15091ed53a8a9e65a9ccd7611f5f1a17e8 at19:22:13Z;
  PR570→main5b2fd63bf82a2917bb47dd0c9a75e2d50edf324c at19:22:17Z (2026-09-14 UTC).
  Both branch trees and reviewed candidate tree match exactly; candidate is ancestor of both.
  Only missing main reviewer approval is waived; all actual application/security checks passed.
  Clean docs-only operator checkpoint uses the reviewed unchanged functional Kamal controller;
  build source must pin origin/main5b2fd63bf82a2917bb47dd0c9a75e2d50edf324c, not checkpoint docs.
- Mandatory deployment protocol read completely in this turn (510 lines), retained owner-authorized
  UAT smoke exception only; no Production READY/promotion, gate-policy, Cloudflare or IAM change.
- Fresh non-root preflight: account311414082667, mangmee-kamal-uat-deploy assumed role; both UAT
  hosts running at enrolled13.212.80.73 /13.213.14.149, Dev stopped. Current workstation27.130.60.231
  matches existing permanent TCP22 rules on both UAT groups (old27.130.53.193 preserved).
  Scoped non-root DescribeSecurityGroups readback and strict SSH with preserved host keys PASS.
  Enrolled target file0600; 161 existing worktrees checked, zero active local UAT operations.
  GitHub has only these two current CI runs. Old Aug12 READY ghost31611733340 remains a jobless shell
  (zero jobs), a previously classified control-plane incident, not this standalone Kamal flow;
  do not dispatch duplicate workflows or attempt another cancel500 workaround.
  Functional controller digest remains1d3f408450f03d28c4406125b7ecf183b853d387c5fe867a3f9967090821efb2.
- Cloud runbook read completely before isolated synthetic compute/read-only AWS instance inspection.
  UAT API t3.large x86_64 and AI/workers t3.medium x86_64; no architecture emulation mismatch.
