# Agent Memory: node-base-digest-bump-2026-09-19

Status: delivered, awaiting controller review — `codex/node-22-23-2-base-digest-20260919` in worktree
`/private/tmp/mangmee-node-digest-20260919`, cut from `origin/develop` 1a476538. Local commit only:
not pushed, no PR, not deployed.
Owner: controller session (Fable 5.1) directs; Opus 5 implements
Scope: the six Dockerfiles (api, ai-gateway, workers, web, web lambda, infra/api-web), the
ECR-scan-gate section of `docs/runbooks/cloud-environment-operations.md`, this file, plus the two
files the pin sync rewrote (`infra/security/validate-production-maintenance-release.sh`,
`.github/workflows/deploy-production.yml`). No `package.json`, lockfile or waiver change.
Decisions:
- `sha256:6c74791e…f6b3` → `sha256:48e4b67d…f0f9` = Node 22.23.1 → 22.23.2 (July 2026 security
  release: 3 HIGH — HTTP/2 `maxSessionMemory`, HTTP/2 re-entrant-send UAF, Permission Model).
- 3 Dockerfiles are exact-hash pinned → pins re-synced with the sync script
  (`node infra/security/sync-production-maintenance-release-pins.mjs`, no hand edits).
- Debian layer unchanged on purpose (bookworm 12.15, 0 upgradable); the five waived Debian CVEs still
  have no bookworm fix (tracker read 2026-09-19) so no waiver row moved. A separate task moves the
  base to `node:22-trixie-slim` (Debian 13) for the four openssl CVEs.
- Owner decision 2026-09-19 (relayed by the controller): the Kamal path keeps no ECR scan gate —
  deploy speed first, manual ECR/Trivy scans instead. `infra/kamal/release.py` never calls
  `verify-ecr-scan.sh`; the gate lives only in `.github/workflows/ci.yml`.
Open questions: none blocking. The Kamal scan-gate gap stays open by the owner decision above.
Artifacts: the six Dockerfiles; the 2026-09-19 paragraph in §`ECR scan gate — CVE ใหม่ใน base image`;
the two re-synced pin files.
Verification:
- `pnpm install --frozen-lockfile --prefer-offline` rc 0. The four prisma specs first fail
  `Cannot find module '../src/generated/prisma/client'`; after `prisma generate` (rc 0) they pass
  26/26 — environmental, not caused by this change.
- `sync-production-maintenance-release-pins.mjs` → `status=updated`, then `--check` →
  `status=current` rc 0. All 48 pins matched on pristine `origin/develop`, so only this change moved
  them; the sync rewrote 3 validator hashes + the workflow validator sha256, nothing by hand.
- `bash infra/security/sync-production-maintenance-release-pins.spec.sh` → `PASS`.
- `bash infra/docker/production-image-security.spec.sh` → rc 0, ends
  `production image security scanner: pass` (its final 4-spec `tsx --test` step: 26/26, 0 fail).
- `docker build --target system -f apps/api/Dockerfile` (linux/amd64) rc 0, so `apt-get upgrade` ran
  on the new digest; `node --version` `v22.23.2`, `/etc/debian_version` `12.15`,
  `apt list --upgradable` empty. `--target runner` rc 0 in ~50 s, in-image `[api-runtime] … PASS`.
- `git diff --check` clean; `git grep -n 6c74791e -- apps infra` no hits.
Next: controller review → CI on the branch → UAT/production promotion is a separate decision.
