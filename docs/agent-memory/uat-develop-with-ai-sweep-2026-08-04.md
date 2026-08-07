# Agent Memory: UAT develop sweep 2026-08-04

Status: Release gate fix verified locally; awaiting branch CI and UAT deploy
Owner: Platform release owner
Scope: Promote the latest committed `develop` application release to all UAT services without including the dirty local working tree.
Decisions:
- Use the exact remote `develop` SHA and the neutral `main` UAT controller.
- Do not bypass the high-severity dependency audit or the exact controller-blob gate.
- Fix only the vulnerable transitive `brace-expansion` version and use a one-shot, exact-base controller sync to `main`.
Open questions: None.
Artifacts:
- `package.json`
- `pnpm-lock.yaml`
- `.github/workflows/ci.yml`
- `.github/workflows/deploy-uat.yml` (neutral-controller sync only)
Verification:
- Initial CI run `30836783039`: typecheck/tests passed; security audit failed on `brace-expansion@5.0.8` (`GHSA-rgw5-rvv9-x895`).
- UAT controller and CI blobs on `main` differed from the candidate, so an all-target dispatch would fail closed before mutation.
- `corepack pnpm audit --audit-level=high`: 0 high/critical (5 moderate remain below the existing gate).
- `bash infra/docker/production-image-security.spec.sh`: pass.
- Ruby YAML parse for CI/UAT workflows and `git diff --check`: pass.
Next:
- Update the lockfile, run the focused audit/checks, merge the release fix, sync the exact controller blobs to `main`, then dispatch and verify UAT/all.
