# Agent Memory: Runtime dependency hotfix — 2026-09-14

Status: In progress; isolated hotfix branch created, runtime audit confirms missing canvas affects substitute preview and bank PDF extraction.
Owner: Codex / user
Scope: Audit production runtime dependency packaging across API/Web, standalone API, AI Gateway and Workers; repair confirmed omissions and deploy hotfix to retained Kamal UAT only. Not a claim to exhaustively exercise every business journey. No Production/dev rollout, migrations, gate change or unrelated billing work.
Additional owner scope: Make browser file replacement and all upload entry points consistent with primary receipt uploads, including iOS HEIC/HEIF, GIF and JPEG aliases. Signatures remain image-only; statement text formats remain unchanged. Reuse existing decoding/normalization before upload intent; never convert bytes after obtaining a signed URL. Server byte/MIME validation, permissions, scan and final-mutation rules remain unchanged.
Decisions:
- Use ponytail full; old absolute skill path is absent, so use the repo's existing ponytail skill.
- Branch `codex/hotfix-runtime-preview-20260914`, clean worktree from `origin/main` (`a8836288`), separate from dirty billing checkout.
- Preserve `--no-optional` production graphs and existing image security boundaries; retain only required Linux canvas packages, following sharp's existing packaging pattern. No package/lock changes.
- Add one shared API image smoke that executes actual compiled PDF preview, paper composition, bank extraction and signature normalization. Run it during both API image builds so dev dependencies cannot hide omissions.
- Acceptance: replacement/supporting/payment evidence, reimbursement receipts/signatures/signed copies, substitute paper/signatures, accounting/tax supporting files and statement images share the primary source policy and normalization. Canonical PDF/PNG/JPEG bytes stay unchanged; normalized metadata, PUT bytes, completion size and paper checksum must agree. Unsupported/spoofed source descriptors are refused before intent.
Open questions: None. Owner explicitly approved permanent TCP22 ingress for27.130.60.231/32 on both UAT groups, rather than the proposed temporary rule. Keep the original27.130.53.193/32 rule. Created API rule `sgr-0e4dfb75cc6543bff` on `sg-021fe21a46c0fcb88` and AI rule `sgr-0d133747833e0c6e0` on `sg-089ddbf86bd4251a1`; no other access was changed.
Artifacts:
- Last accepted UAT operation `20260911T201637Z-cb364f03`; API digest `sha256:7767fbe57d8d698b489c374816235219d396766b93b76289fc2bfe8376f368e7`.
- UAT_RUN_ID / READY_RUN_ID / PROD_RUN_ID: none dispatched. No running GH workflows; unrelated historical READY31611733340 remains a queued ghost since2026-08-12, unchanged.
Verification:
- Read cloud operations and mandatory deployment protocol; read Kamal command README and ponytail.
- All runtime production top-level dependencies loaded in retained AI/Workers images. API PDF.js fails with missing DOMMatrix. API custom generated Prisma client loads; default `@prisma/client` entry is intentionally unused because generator outputs `src/generated/prisma`.
- Same valid minimal PDF yields bank extractor `unreadable` in accepted API image; same synthetic Thai SVG builds PDF but preview fails with missing canvas/DOMMatrix.
- Remaining verification, PR/CI and exact release evidence to be recorded here.
- Old exact accepted API image fails the new production-graph smoke with missing DOMMatrix (red). Both rebuilt API images pass Thai PDF generation, digital1/3-page and paper2-page previews, signature normalization; final smoke also verifies bank text-PDF row extraction and image-only no-text handling. Final image build/security checks are in progress after the source-consistency addition.
- `pnpm --filter @watchdog-bms/web test`:1703/1703 PASS; web typecheck PASS. New consistency test exercises6 source variants across9 high-level upload flows (54 intents/PUTs/completions), using stubbed browser pixels; verifies exact normalized bytes/metadata/create-only headers and paper checksum. This is contract evidence, not a real iOS device or real HEIC WASM decoding claim; existing primary decoder is reused unchanged.
- Kamal controller fixture tests23/23 PASS. Read-only target preflight `20260914T161515Z-bc3a836d`: `PREFLIGHT_PASSED_NO_DEPLOYMENT`,9.578s, no apply or remote lock. Permanent SSH /32 exact readback PASS via `DescribeSecurityGroups`; granular `DescribeSecurityGroupRules` was denied, so no permissions were added.
Next: Finish sibling/native/optional audit; prove smoke fails on old image and passes on both rebuilt API images; run Docker/security/controller focused checks, open reviewed hotfix PR, wait exact CI, merge and deploy once only after approved SSH/enrollment and read-only preflight pass. Capture signed result, full config/readiness/OPEN and original feature read acceptance.
