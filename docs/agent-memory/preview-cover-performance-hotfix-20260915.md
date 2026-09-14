# Agent Memory: Preview cover and performance hotfix 2026-09-15

Status: Hotfix admin merged and UAT accepted, signed and OPEN; browser acceptance PASS. Evidence docs merges pending.
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
Next: Docs-only evidence merges to develop/main; no second deploy for non-runtime docs. Production unchanged.

Release ledger:
- Existing serving source f06c9ac8572e5fbbf1ee3bb7b0a7fd8d558a17b9,
  prior accepted operation20260914T182800Z-e3b8bc63 is now historical.
- UAT_RUN_ID / READY_RUN_ID / PROD_RUN_ID NONE; standalone Kamal operation20260914T192255Z-e036fe7a.
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

## Accepted UAT release

- Exactly one dispatch, no error/retry: operation20260914T192255Z-e036fe7a, started19:22:55.709062Z,
  finished19:30:05.252048Z (2026-09-14 UTC),429.541s; all11 phases PASSED,
  terminal ACCEPTED_LINE_DEFERRED, productionMutated=false.
- Serving source5b2fd63bf82a2917bb47dd0c9a75e2d50edf324c; reviewed candidatef3f5ff45 is an ancestor
  of develop/main and its tree equals serving main. Operator checkpointcb9940913190b302a93ae7b26c777d034d5b825e
  changes memory only; functional controller SHA1d3f408450f03d28c4406125b7ecf183b853d387c5fe867a3f9967090821efb2
  equals reviewed main. Config contract5b1853730bb96bc33b4ee962add22d01b47a181dd3a7b233b7c2096966553d1b.
- Release ID95f62d5a95821f8a7b9028b97550c4ff2bb4946ade1b7e9ab4776c8f128db7da.
  accepted.json SHA256ad5eea6de787e199e2de888f9c299dbd6ca2aa0e2e0c0bd479c0d9c4c5cca687;
  ECDSA_SHA_256 KMS keycb315bdc-b5ab-42fb-be32-fe9cee2a2d44, signature verified=true.
- Exact immutable image digests:
  - api-web sha256:81ce5169575737a55b9231c96bbd26ff72c65250266710eccf801173b7966269
  - ai-gateway sha256:d38d57d6fb36fef7bfe16743c34df98cbf9951c81c9d127ab1ad1612a316ff6d
  - workers sha256:7aab89fba00779164f0108fdd142bd2db6543289b03c92547b661f4ac4547049
  - tools sha256:3dcf7fce8762fc796b20a83b1e07411b80af013a201d6dbe81e5f48b77a8307c
- Exact source/config/runtime checks PASS for all3 services. API/DB, AI, workers/Redis/internal API
  readiness passed. AgentCore now kamal_uat_a version7 (previousB6), UPDATED_PINNED.
- customerAcceptance.passed=true, allServiceConfigAndReadinessPassed=true; public platform-access
  GET200 stateOPEN and login GET200 data-platform-access="open" separately rechecked.
  Login/logout NOT_REQUIRED_BY_OWNER, live LINE DEFERRED_BY_OWNER under retained UAT smoke exception;
  actual CI LINE fixtures are not live LINE acceptance or Production readiness.
- Fresh Chrome Drtb reload and existing SRC-202609-00002 read-only View: modal/large centered cover
  already observed~281ms after click; screenshot shows clearly visible cover, readable label,
  close available and print disabled. Complete page and enabled print observed3156ms after click
  (browser observation including transport/screenshot, not precise HTTP duration).
  Early-close during loading PASS; old response did not reopen modal; both hub row states retained.
  No sign/approve/upload/cancel/payment mutation was performed. The Sun coffee inaccessible original
  record was not re-tested through another tenant or permission bypass.
- New-container bounded logs for API, AI and workers: zero missing-renderer/DOMMatrix, explicit HTTP5xx,
  or timed-out patterns. Fresh EC2 verifies both UAT hosts keep enrolled public/private addresses,
  Dev stopped; permanent SSH rules preserved. Production, Cloudflare and IAM untouched.
- Broad receipt scan found two copies of old zero-phase RUNNING shell20260911T164143Z-49739d4d,
  unchanged since Sep11, productionMutated=false, no active lock/source/mutation phases. Targeted process
  check found only the current release controller, no old operation reference. Retain these historical
  artifacts; their stale label is not an active deploy. No recovery or duplicate dispatch was needed.
- Private artifacts remain in .env.kamal/uat/runs/20260914T192255Z-e036fe7a; no secrets committed.
