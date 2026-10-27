# Halloween security remediation plan

Status: COMPLETE_LOCAL — 2026-10-28; no deployment
Source: docs/specs/halloween-security-remediation.md; baseline evidence in docs/evidence/halloween-security-review-2026-10-28/.

- [x] Confirm scope: fix website vulnerabilities, keep client-side entertainment gameplay; no signed-result feature.
- [x] Read repository instructions, Ponytail full and existing security assessment/controls.
- [x] Sol: inspect official advisories/registry and existing overrides; update only necessary dependency manifests and lockfile. Own package.json and pnpm-lock.yaml edits; notify root before install and when ready for tests. No source edits without coordination.
- [x] Root: trace Zod/config/parser/upload callers, handle minimal source compatibility if required, and review final dependency diff/advisory applicability.
- [x] Run audit for full and production graphs; verify resolved patched versions and deterministic install.
- [x] Run focused security/config/parser/upload/game tests, affected typechecks and builds; review real browser390/1280.
- [x] Update evidence/memory/spec/plan with results and local-only handoff. No commit/push/deploy.

Dependency review: final updates are Next16.4.3, Zod4.6.7, body-parser2.4.0, multer2.5.0, SWC CLI0.8.1 and compatible maintained build dependencies. Original attempt at forced file-type21 on old archive consumers failed TAR.GZ handling and was replaced with the official newer SWC dependency chain. No forced archive parser overrides remain. Full/prod audits0; frozen offline install passes. Config tests155, web security/game50, gateway HTTP21 and API upload/security87 pass. Config/API/gateway/workers/web builds and standalone API/web typechecks pass. API initially lacked generated Prisma client; local schema generation resolved this without any DB access or migration. Browser390/1280: draw/reveal/save/copy, direct shared route, theme-off homepage and direct-route gates pass. Final evidence: docs/evidence/halloween-security-remediation-2026-10-28/README.md.
