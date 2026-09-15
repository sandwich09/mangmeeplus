#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
# Native COPY paths must follow the lockfile, not independently repeat an old version pin.
python3 - "$repo_root" <<'PY'
import pathlib, re, sys
root = pathlib.Path(sys.argv[1])
lock = (root / 'pnpm-lock.yaml').read_text()
assert 'path: patches/pdfjs-dist@6.2.108.patch' in lock, 'missing exact PDF.js dependency patch'
for path in ['infra/api-web/Dockerfile.api-web', 'apps/api/Dockerfile', 'apps/ai-gateway/Dockerfile',
             'apps/workers/Dockerfile', 'apps/web/Dockerfile', 'apps/web/Dockerfile.lambda']:
    dockerfile = (root / path).read_text()
    assert 0 <= dockerfile.find('COPY patches ./patches') < dockerfile.find('RUN pnpm install'), f'{path}: patch must be copied before frozen installation'
for path in ['apps/api/Dockerfile', 'apps/ai-gateway/Dockerfile', 'infra/api-web/Dockerfile.api-web']:
    dockerfile = (root / path).read_text()
    for name in ['sharp-linux-x64', 'sharp-libvips-linux-x64']:
        match = re.search(rf'^COPY --from=deps /app/node_modules/.pnpm/@img\+{name}@([0-9.]+)/node_modules/@img/{name} ', dockerfile, re.M)
        assert match, f'{path}: missing native {name} COPY'
        assert f"  '@img/{name}@{match[1]}':" in lock, f'{path}: {name}@{match[1]} is absent from pnpm-lock.yaml'
    if path != 'apps/ai-gateway/Dockerfile':
        for name in ['canvas', 'canvas-linux-x64-gnu']:
            match = re.search(rf'^COPY --from=deps /app/node_modules/.pnpm/@napi-rs\+{name}@([0-9.]+)/node_modules/@napi-rs/{name} ', dockerfile, re.M)
            assert match, f'{path}: missing PDF.js native {name} COPY'
            assert f"  '@napi-rs/{name}@{match[1]}':" in lock, f'{path}: {name}@{match[1]} is absent from pnpm-lock.yaml'
        assert 'RUN node /tmp/api-runtime-smoke.cjs ' in dockerfile, f'{path}: missing actual production-graph renderer smoke'
PY
scanner="$repo_root/infra/docker/verify-production-image.sh"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/watchdog-bms-image-spec.XXXXXX")"
trap 'rm -rf "$fixture"' EXIT

mkdir -p "$fixture/app/api/dist" "$fixture/app/api/node_modules/.bin"
mkdir -p "$fixture/var/lib/dpkg"
printf 'Package: libc6\nStatus: install ok installed\n\n' > "$fixture/var/lib/dpkg/status"
printf 'console.log("ok")\n' > "$fixture/app/api/dist/main.js"
"$scanner" --root "$fixture" >/dev/null

# Exercise the exported-image package guard, not only the Dockerfile spelling.
for package in util-linux util-linux-extra bsdutils mount libblkid1 libmount1 libsmartcols1 libuuid1 e2fsprogs; do
  printf 'Package: %s\nStatus: install ok installed\n\n' "$package" > "$fixture/var/lib/dpkg/status"
  if "$scanner" --root "$fixture" >/dev/null 2>&1; then
    echo "ERROR: scanner accepted unused vulnerable OS package: $package" >&2
    exit 1
  fi
done
printf 'Status: hold ok installed\nPackage: libblkid1\n\n' > "$fixture/var/lib/dpkg/status"
if "$scanner" --root "$fixture" >/dev/null 2>&1; then
  echo 'ERROR: scanner accepted a held vulnerable package' >&2
  exit 1
fi
printf 'Package: libblkid1\nStatus: deinstall ok config-files\n\nPackage: libc6\nStatus: install ok installed\n\n' > "$fixture/var/lib/dpkg/status"
"$scanner" --root "$fixture" >/dev/null
rm "$fixture/var/lib/dpkg/status"
if "$scanner" --root "$fixture" >/dev/null 2>&1; then
  echo 'ERROR: scanner accepted an image without package inventory' >&2
  exit 1
fi
printf 'Package: libc6\nStatus: install ok installed\n\n' > "$fixture/var/lib/dpkg/status"

assert_rejected() {
  local path="$1"
  mkdir -p "$(dirname "$fixture/$path")"
  : > "$fixture/$path"
  if "$scanner" --root "$fixture" >/dev/null 2>&1; then
    echo "ERROR: scanner accepted forbidden path: $path" >&2
    exit 1
  fi
  rm -f "$fixture/$path"
}

assert_rejected app/api/.env.production
assert_rejected app/api/src/main.ts
assert_rejected app/api/dist/main.js.map
assert_rejected app/api/dist/provider-smoke.js
assert_rejected app/api/dist/README.md
assert_rejected app/api/node_modules/.bin/prisma
assert_rejected app/api/node_modules/.pnpm/tsx@4.20.0/package.json

for dockerfile in \
  apps/api/Dockerfile \
  apps/ai-gateway/Dockerfile \
  apps/web/Dockerfile \
  apps/web/Dockerfile.lambda \
  apps/workers/Dockerfile \
  infra/api-web/Dockerfile.api-web; do
  if grep -Eq '^COPY[[:space:]]+\.[[:space:]]+\.' "$repo_root/$dockerfile"; then
    echo "ERROR: unrestricted build-context copy in $dockerfile" >&2
    exit 1
  fi
done

for dockerfile in \
  apps/api/Dockerfile \
  apps/ai-gateway/Dockerfile \
  apps/web/Dockerfile \
  apps/web/Dockerfile.lambda \
  apps/workers/Dockerfile \
  infra/api-web/Dockerfile.api-web; do
  while read -r base; do
    if [[ ( "$base" == *:* || "$base" == */* ) && "$base" != *@sha256:* ]]; then
      echo "ERROR: unpinned base image in $dockerfile: $base" >&2
      exit 1
    fi
  done < <(awk 'toupper($1) == "FROM" { print $2 }' "$repo_root/$dockerfile")
done
grep -Fq 'ADD --checksum=sha256:' "$repo_root/apps/api/Dockerfile"
grep -Fq 'ADD --checksum=sha256:' "$repo_root/infra/api-web/Dockerfile.api-web"
grep -Fq 'onlyBuiltDependencies:' "$repo_root/pnpm-workspace.yaml"
if grep -Fq 'allowBuilds:' "$repo_root/pnpm-workspace.yaml"; then
  echo "ERROR: placeholder allowBuilds policy is not effective" >&2
  exit 1
fi

grep -Fxq '**/.env' "$repo_root/.dockerignore"
grep -Fxq '**/.env.*' "$repo_root/.dockerignore"
grep -Fq 'COPY apps/api/prisma.config.ts apps/api/prisma.config.ts' "$repo_root/apps/api/Dockerfile"
grep -Fq 'FROM system AS migration-tool' "$repo_root/apps/api/Dockerfile"
migration_tool_stage="$(sed -n '/ AS migration-tool$/,/^FROM system AS runner$/p' "$repo_root/apps/api/Dockerfile")"
if grep -Fq 'node:22-alpine' <<< "$migration_tool_stage"; then
  echo 'ERROR: migration-tool libc differs from its Debian Prisma schema engine' >&2
  exit 1
fi
grep -Fq 'COPY --from=build --chown=node:node /app /app' <<< "$migration_tool_stage"
grep -Fq 'apt-get purge -y --auto-remove fontconfig fonts-noto-core' <<< "$migration_tool_stage"
grep -Fq 'apt-get purge -y openssl ca-certificates' <<< "$migration_tool_stage"
grep -Fq 'apt-get purge -y --allow-remove-essential perl-base' <<< "$migration_tool_stage"
test "$(grep -n 'apt-get purge -y openssl ca-certificates' <<< "$migration_tool_stage" | cut -d: -f1)" \
  -lt "$(grep -n 'apt-get purge -y --allow-remove-essential perl-base' <<< "$migration_tool_stage" | cut -d: -f1)"
grep -Fq 'install -m 0644 /tmp/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt' <<< "$migration_tool_stage"
grep -Fq '! dpkg-query -W openssl ca-certificates' <<< "$migration_tool_stage"
grep -Fq '&& chmod 1777 /tmp' <<< "$migration_tool_stage"
grep -Fq 'VOLUME ["/tmp"]' <<< "$migration_tool_stage"
grep -Fq 'FROM migration-tool AS release-task' "$repo_root/apps/api/Dockerfile"
grep -Fq 'com.watchdog-bms.image-purpose=production-release-task' "$repo_root/apps/api/Dockerfile"
grep -Fq 'docker run --rm --read-only --network none' \
  "$repo_root/infra/security/verify-production-a5-migration-tool.sh"
grep -Fq 'Config.Volumes | keys) == ["/tmp"]' \
  "$repo_root/infra/security/verify-production-a5-migration-tool.sh"
grep -Fq -- '--from-empty --to-schema prisma/schema.prisma --script' \
  "$repo_root/infra/security/verify-production-a5-migration-tool.sh"
grep -Fq 'if ! [[ "$image" =~' "$repo_root/infra/security/verify-production-a5-migration-tool.sh"
grep -Fq 'test ! -e /sys/class/net/eth0' \
  "$repo_root/infra/security/verify-production-a5-migration-tool.sh"
grep -Fq 'for package in perl-base libexpat1 fontconfig fontconfig-config' \
  "$repo_root/infra/security/verify-production-a5-migration-tool.sh"
a5_migration_sources=(
  "$repo_root/apps/api/prisma/production-a5/run-clone-rehearsal.ts"
  "$repo_root/apps/api/prisma/production-a5/run-release-readiness-clone.ts"
  "$repo_root/apps/api/prisma/production-a5/run-production-apply.ts"
)
if grep -En "runCaptured\('pnpm'" "${a5_migration_sources[@]}"; then
  echo 'ERROR: production A5 runtime still depends on pnpm' >&2
  exit 1
fi
test "$(grep -hF "runCaptured('/app/apps/api/node_modules/.bin/prisma'" \
  "${a5_migration_sources[@]}" | wc -l | tr -d ' ')" -eq 4
test "$(grep -hF "'/app/node_modules/.bin/tsx'" \
  "${a5_migration_sources[@]}" | wc -l | tr -d ' ')" -eq 2
grep -Fq '"purpose":"release-task","repository":"watchdog-bms-api","target":"release-task"' "$repo_root/.github/workflows/ci.yml"
if grep -Fq '"purpose":"release-task","repository":"watchdog-bms-api","target":"local"' "$repo_root/.github/workflows/ci.yml"; then
  echo "ERROR: release-task must not publish the vulnerable development-oriented local target" >&2
  exit 1
fi

# ADR 0005: App Runner is closed to new AWS customers and its deploy scripts were removed
# (2026-07-28) once ECS Express took over every production service. Clean-build, immutable
# digest and release-task assertions now cover only the live deploy path.
grep -Fq 'SOURCE_COMMIT="$COMMIT" bash infra/docker/build-clean-production-image.sh' "$repo_root/infra/prod-ecs-express/deploy.sh"
grep -Fq 'immutable_image_ref' "$repo_root/infra/prod-ecs-express/deploy.sh"
grep -Fq 'RELEASE_TASKS_APPLIED_SHA' "$repo_root/infra/prod-ecs-express/deploy.sh"

ci="$repo_root/.github/workflows/ci.yml"
sbom_generator="$repo_root/infra/docker/generate-image-sbom.sh"
bash -n "$sbom_generator"
bash "$repo_root/infra/docker/generate-image-sbom.spec.sh"
test "$(grep -Fc 'infra/docker/generate-image-sbom.sh' "$ci")" -eq 3
if grep -Fq 'anchore/sbom-action' "$ci"; then
  echo "ERROR: CI SBOM generation still depends on an unbounded action download" >&2
  exit 1
fi
grep -Fq 'syft_version=1.42.3' "$sbom_generator"
grep -Fq 'syft_url=https://github.com/anchore/syft/releases/download/v1.42.3/syft_1.42.3_linux_amd64.tar.gz' "$sbom_generator"
grep -Fq 'syft_sha256=0d6be741479eddd2c8644a288990c04f3df0d609bbc1599a005532a9dff63509' "$sbom_generator"
grep -Fq -- '--retry 4 --retry-all-errors --retry-delay 2' "$sbom_generator"
grep -Fq 'workflow_dispatch:' "$ci"
grep -Fq 'workflow_call:' "$ci"
grep -Fq 'pull_request:' "$ci"
if grep -Eq '^  push:' "$ci"; then
  echo "ERROR: CI must not duplicate full validation on branch pushes" >&2
  exit 1
fi
grep -Fq 'group: ci-${{ github.event_name }}-${{ github.ref }}' "$ci"
grep -Fq "github.event_name == 'pull_request'" "$ci"
grep -Fq 'code_changed: ${{ steps.source.outputs.code_changed }}' "$ci"
grep -Fq "':(exclude)docs/**'" "$ci"
grep -Fq "github.event_name == 'workflow_call'" "$ci"
grep -Fq "github.event_name == 'workflow_dispatch'" "$ci"
grep -Fq "inputs.validated_ci_run_id != ''" "$ci"
test "$(grep -Fc "inputs.validated_ci_run_id == ''" "$ci")" -eq 7
grep -Fq '.head_sha == $sha' "$ci"
grep -Fq '.path == ".github/workflows/ci.yml"' "$ci"
grep -Fq 'validationRunId:$validationRunId' "$ci"
test "$(grep -Fc 'cache-from: type=gha' "$ci")" -ge 2
grep -Fq 'cache-from: type=gha,scope=release-tool-${{ matrix.purpose }}' "$ci"
test "$(grep -Fc 'cache-to: type=gha,mode=max' "$ci")" -ge 2
grep -Fq 'cache-to: type=gha,mode=max,scope=release-tool-${{ matrix.purpose }},ignore-error=true' "$ci"
for repository in watchdog-bms-api watchdog-bms-ai-gateway watchdog-bms-workers; do
  grep -Fq "repository: $repository" "$ci"
done
grep -Fq 'push: true' "$ci"
grep -Fq 'DIGEST: ${{ steps.build.outputs.digest }}' "$ci"
grep -Fq 'bash infra/docker/verify-production-image.sh "$IMAGE_REF"' "$ci"
grep -Fq 'Generate SBOM from pushed digest' "$ci"
grep -Fq 'verify-ecr-scan.sh' "$ci"
grep -Fq 'platforms: linux/amd64' "$ci"
grep -Fq 'provenance: mode=max' "$ci"
grep -Fq 'cosign sign --yes "$IMAGE_REF"' "$ci"
grep -Fq 'cosign verify' "$ci"
grep -Fq 'production-image-manifest.json' "$ci"
grep -Fq 'test -f /app/apps/api/prisma/verify-production-ready-migration.ts' "$ci"
grep -Fq 'test -f /app/apps/api/prisma/verify-applied-migration-catalog.ts' "$ci"
grep -Fq 'test -f /app/apps/api/prisma/run-exclusive-release-operation.ts' "$ci"

ecr_scan="$repo_root/infra/docker/verify-ecr-scan.sh"
grep -Fq 'start-image-scan' "$ecr_scan"
grep -Fq 'ScanNotFoundException' "$ecr_scan"
grep -Fq 'application/vnd.oci.image.index.v1+json' "$ecr_scan"
grep -Fq '.platform.architecture == "amd64"' "$ecr_scan"
grep -Fq 'apt-get purge -y openssl ca-certificates' "$repo_root/infra/api-web/Dockerfile.api-web"
grep -Fq 'apt-get purge -y --allow-remove-essential perl-base' "$repo_root/infra/api-web/Dockerfile.api-web"
test "$(grep -n 'apt-get purge -y openssl ca-certificates' "$repo_root/infra/api-web/Dockerfile.api-web" | cut -d: -f1)" \
  -lt "$(grep -n 'apt-get purge -y --allow-remove-essential perl-base' "$repo_root/infra/api-web/Dockerfile.api-web" | cut -d: -f1)"
grep -Fq 'install -m 0644 /tmp/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt' "$repo_root/infra/api-web/Dockerfile.api-web"
grep -Fq '! dpkg-query -W openssl ca-certificates' "$repo_root/infra/api-web/Dockerfile.api-web"
grep -Fq 'apt-get purge -y --allow-remove-essential perl-base' "$repo_root/apps/ai-gateway/Dockerfile"
grep -Fq 'apt-get purge -y --allow-remove-essential perl-base' "$repo_root/apps/workers/Dockerfile"
for dockerfile in apps/api/Dockerfile apps/ai-gateway/Dockerfile apps/workers/Dockerfile \
  apps/web/Dockerfile apps/web/Dockerfile.lambda infra/api-web/Dockerfile.api-web; do
  grep -Fq 'util-linux util-linux-extra bsdutils mount libblkid1 libmount1 libsmartcols1 libuuid1 e2fsprogs' "$repo_root/$dockerfile"
  # util-linux-extra postrm needs the Perl-based init helpers, even in a container.
  if ! awk '
    /^FROM / { disk_purged = 0 }
    /^[[:space:]]*util-linux util-linux-extra / { disk_purged = 1 }
    /apt-get purge.*perl-base/ { if (!disk_purged) exit 1 }
  ' "$repo_root/$dockerfile"; then
    echo "ERROR: disk tools must be purged before perl-base in $dockerfile" >&2
    exit 1
  fi
done
grep -Fq 'util-linux util-linux-extra bsdutils mount libblkid1 libmount1 libsmartcols1 libuuid1 e2fsprogs' \
  "$repo_root/infra/security/verify-production-a5-migration-tool.sh"
uat_publish_policy="$repo_root/infra/uat/github-publish-role-policy.template.json"
grep -Fq '"ecr:DescribeImageScanFindings"' "$uat_publish_policy"
grep -Fq '"ecr:StartImageScan"' "$uat_publish_policy"
uat_deploy_policy="$repo_root/infra/uat/github-deploy-role-policy.template.json"
grep -Fq '"Sid": "VerifyUatReleaseImageSignatures"' "$uat_deploy_policy"
jq -e '
  .Statement[] | select(.Sid == "CreateOrUpdateOnlyUatExpressServices")
  | (.Action | index("ecs:UpdateService")) != null
' "$uat_deploy_policy" >/dev/null
jq -e '
  .Statement[] | select(.Sid == "UatRolloutRead")
  | (.Action | index("ecs:DescribeServices")) != null
' "$uat_deploy_policy" >/dev/null
jq -e '
  .Statement[] | select(.Sid == "UatReleaseTaskImage")
  | (.Action | index("ecr:DescribeImages")) != null
    and .Resource == "arn:aws:ecr:ap-southeast-1:<ACCOUNT_ID>:repository/watchdog-bms-api"
' "$uat_deploy_policy" >/dev/null
for repository in watchdog-bms-api watchdog-bms-ai-gateway watchdog-bms-workers; do
  grep -Fq "repository/$repository" "$uat_deploy_policy"
done

deploy_workflow="$repo_root/.github/workflows/deploy-production.yml"
uat_workflow="$repo_root/.github/workflows/deploy-uat.yml"
uat_deploy="$repo_root/infra/uat/deploy-with-runtime-mutex.sh"
for caller in "$deploy_workflow" "$uat_workflow"; do
  build_permissions="$(awk '/^  build_and_publish:/{found=1; next} found && /^  [[:alnum:]_-]+:/{exit} found{print}' "$caller")"
  grep -Fq 'id-token: write' <<< "$build_permissions"
done
uat_build_permissions="$(awk '/^  build_and_publish:/{found=1; next} found && /^  [[:alnum:]_-]+:/{exit} found{print}' "$uat_workflow")"
grep -Fq 'actions: read' <<< "$uat_build_permissions"
if grep -Eq 'uses: .+@(main|v[0-9]+)$' "$ci" "$deploy_workflow" "$uat_workflow"; then
  echo "ERROR: production workflow contains a mutable action reference" >&2
  exit 1
fi
grep -Fq 'release_ref:' "$deploy_workflow"
grep -Fq 'target:' "$deploy_workflow"
grep -Fq 'direct_partial_incident:' "$deploy_workflow"
grep -Fq 'test "$GITHUB_REF" = "refs/heads/main"' "$deploy_workflow"
grep -Fq 'git fetch origin main --tags --force' "$deploy_workflow"
grep -Fq 'resolve-production-release-ref.sh "$RELEASE_REF" origin/main' "$deploy_workflow"
grep -Fq "if: needs.resolve-release.outputs.release_mode == 'partial-incident'" "$deploy_workflow"
grep -Fq "needs.resolve-release.outputs.release_mode == 'promotion'" "$deploy_workflow"
grep -Fq 'Validate release intent before build or AWS access' "$deploy_workflow"
grep -Fq 'and .event == "workflow_dispatch"' "$deploy_workflow"
grep -Fq 'and .path == ".github/workflows/deploy-uat.yml"' "$deploy_workflow"
grep -Fq 'and .head_branch == "main"' "$deploy_workflow"
grep -Fq '.referenced_workflows // []' "$deploy_workflow"
grep -Fq 'git merge-base --is-ancestor "$controller_sha" origin/main' "$deploy_workflow"
grep -Fq "git fetch --no-tags origin '+refs/heads/main:refs/heads/main' --force" "$deploy_workflow"
grep -Fq 'name: uat-deployment-acceptance-${{ needs.resolve-release.outputs.source_sha }}-attempt-${{ steps.promoted-run.outputs.run_attempt }}' "$deploy_workflow"
grep -Fq 'name: uat-accepted-release-${{ needs.resolve-release.outputs.source_sha }}-attempt-${{ steps.promoted-run.outputs.run_attempt }}' "$deploy_workflow"
grep -Fq 'cosign verify-blob \' "$deploy_workflow"
grep -Fq 'https://github.com/${GITHUB_REPOSITORY}/.github/workflows/deploy-uat.yml@refs/heads/main' "$deploy_workflow"
grep -Fq -- '--certificate-github-workflow-repository "$GITHUB_REPOSITORY"' "$deploy_workflow"
grep -Fq -- '--certificate-github-workflow-ref "refs/heads/main"' "$deploy_workflow"
grep -Fq -- '--certificate-github-workflow-trigger "workflow_dispatch"' "$deploy_workflow"
grep -Fq 'validate-uat-deployment-acceptance.sh' "$deploy_workflow"
grep -Fq 'name: Wait for and fully verify independent U5 owner authority' "$deploy_workflow"
grep -Fq 'wait-for-production-evidence.sh \' "$deploy_workflow"
grep -Fq '"$SOURCE_SHA"' "$deploy_workflow"
grep -Fq 'expected-source-sha' "$repo_root/infra/security/wait-for-production-evidence.sh"
grep -Fq 'OWNER_U5E_APPROVAL_V1 "$GITHUB_RUN_ID" APPROVAL 1800' "$deploy_workflow"
grep -Fq 'fetch-verified-production-evidence.sh PRODUCTION_A5_EVIDENCE_V1' "$deploy_workflow"
grep -Fq 'fetch-verified-production-evidence.sh PRODUCTION_A5_CLONE_REHEARSAL_V1' "$deploy_workflow"
grep -Fq 'fetch-verified-production-evidence.sh PRODUCTION_SECURITY_PREFLIGHT_V1' "$deploy_workflow"
grep -Fq '"$BRIDGE_RUN" "$GITHUB_RUN_ID" "$root" "$BRIDGE_SOURCE" "$BRIDGE_ATTEMPT"' "$deploy_workflow"
grep -Fq 'attempts/$expected_run_attempt' "$repo_root/infra/security/fetch-verified-uat-release.sh"
grep -Fq 'name: Restore exact UAT-attested bridge image' "$deploy_workflow"
grep -Fq 'role-to-assume: ${{ vars.AWS_ROLE_ARN }}' "$deploy_workflow"
grep -Fq 'expected_digest="${BRIDGE_IMAGE##*@}"' "$deploy_workflow"
grep -Fq 'test "$RESTORED_DIGEST" = "$expected_digest"' "$deploy_workflow"
grep -Fq 'deploy-production.yml@refs/heads/main' "$deploy_workflow"
grep -Fq -- '--certificate-github-workflow-sha "$GITHUB_SHA"' "$deploy_workflow"
grep -Fq 'validate-u5-production-chain.sh validate-pre' "$deploy_workflow"
grep -Fq 'REIMBURSEMENT_BRIDGE=true REIMBURSEMENT_BRIDGE_PROVED_SHA="$BRIDGE_SOURCE"' "$deploy_workflow"
grep -Fq 'REIMBURSEMENT_WRITE_QUIESCE=true DEPLOYMENT_EVIDENCE_DIR="$bridge_evidence"' "$deploy_workflow"
grep -Fq 'build-production-a5-stage-context.sh \' "$deploy_workflow"
grep -Fq '"$output" PRE_MUTATION "$SOURCE_SHA"' "$deploy_workflow"
grep -Fq 'run-production-a5-reviewed-migration.sh' "$deploy_workflow"
grep -Fq '"$output" POST_MIGRATION "$SOURCE_SHA"' "$deploy_workflow"
grep -Fq 'RELEASE_DATABASE_AUTHORITY=U5_REVIEWED_APPLY \' "$deploy_workflow"
grep -Fq 'run-release-task.sh "$release_image" "$SOURCE_SHA" release-prepare' "$deploy_workflow"
grep -Fq 'REIMBURSEMENT_WRITE_QUIESCE=false \' "$deploy_workflow"
grep -Fq 'requiesce_on_error() {' "$deploy_workflow"
grep -Fq 'REIMBURSEMENT_WRITE_QUIESCE=true \' "$deploy_workflow"
grep -Fq 'trap requiesce_on_error ERR' "$deploy_workflow"
grep -Fq 'automatic fail-closed re-quiesce could not be verified' "$deploy_workflow"
grep -Fq '"$output" POST_DEPLOYMENT "$SOURCE_SHA"' "$deploy_workflow"
grep -Fq 'validate-u5-production-chain.sh validate-post' "$deploy_workflow"
test "$(grep -Fc 'validate-u5-production-chain.sh validate-approval-current' "$deploy_workflow")" -ge 4
if grep -Eq 'U5_SHADOW_PROMOTION_APPROVAL|u5-shadow-promotion-approval|inputs\.u5_' "$deploy_workflow"; then
  echo 'ERROR: production controller still accepts or synthesizes legacy U5 authority' >&2
  exit 1
fi
grep -Fq 'AWS_DEPLOY_ROLE_ARN' "$deploy_workflow"
grep -Fq 'LEGAL_RELEASE_EVIDENCE_READER_ROLE_ARN' "$deploy_workflow"
grep -Fq 'LEGAL_RELEASE_EVIDENCE_BUNDLE_S3_URI' "$deploy_workflow"
grep -Fq 'LEGAL_RELEASE_EVIDENCE_BUNDLE_S3_VERSION_ID' "$deploy_workflow"
grep -Fq 'LEGAL_RELEASE_EVIDENCE_BUNDLE_SHA256' "$deploy_workflow"
grep -Fq 'provision-legal-release-evidence.sh preflight "$GITHUB_WORKSPACE"' "$deploy_workflow"
grep -Fq 'provision-legal-release-evidence.sh provision "$GITHUB_WORKSPACE"' "$deploy_workflow"
grep -Fq 'LEGAL_RELEASE_EVIDENCE_DIR: ${{ steps.legal-evidence.outputs.evidence_dir }}' "$deploy_workflow"
grep -Fq 'printf '\''evidence_dir=%s\n'\'' "$evidence_dir" >> "$GITHUB_OUTPUT"' "$deploy_workflow"
test "$(grep -Fc 'unset-current-credentials: true' "$deploy_workflow")" -ge 2
legal_provisioner_hash="$(sha256sum "$repo_root/infra/security/provision-legal-release-evidence.sh" | awk '{print $1}')"
legal_validator_hash="$(sha256sum "$repo_root/infra/security/validate-legal-release-readiness.sh" | awk '{print $1}')"
legal_contract_hash="$(sha256sum "$repo_root/packages/contracts/src/legal-acceptance.ts" | awk '{print $1}')"
grep -Fq "EXPECTED_LEGAL_EVIDENCE_PROVISIONER_SHA256: $legal_provisioner_hash" "$deploy_workflow"
grep -Fq "EXPECTED_LEGAL_RELEASE_VALIDATOR_SHA256: $legal_validator_hash" "$deploy_workflow"
grep -Fq "EXPECTED_LEGAL_ACCEPTANCE_CONTRACT_SHA256: $legal_contract_hash" "$deploy_workflow"
grep -Fq 'run-release-task.sh' "$deploy_workflow"
grep -Fq 'PRODUCTION_IMAGE_MANIFEST' "$deploy_workflow"
grep -Fq 'verify-deployment.sh' "$deploy_workflow"
grep -Fq 'ECS_DEPLOY_MANAGE_IAM: "false"' "$deploy_workflow"
recheck_line="$(grep -n 'name: Recheck release authority immediately before final mutation' "$deploy_workflow" | cut -d: -f1)"
legal_policy_line="$(grep -n 'name: Verify legal evidence gate policy pins' "$deploy_workflow" | cut -d: -f1)"
legal_preflight_line="$(grep -n 'name: Verify legal evidence manifest preflight' "$deploy_workflow" | cut -d: -f1)"
legal_reader_line="$(grep -n 'name: Configure AWS legal evidence reader credentials' "$deploy_workflow" | cut -d: -f1)"
legal_provision_line="$(grep -n 'name: Provision independently reviewed legal release evidence' "$deploy_workflow" | cut -d: -f1)"
legal_validate_line="$(grep -n 'name: Validate legal operator and privacy release evidence' "$deploy_workflow" | cut -d: -f1)"
legal_cleanup_line="$(grep -n 'name: Remove local legal release evidence' "$deploy_workflow" | cut -d: -f1)"
legal_recheck_line="$(grep -n 'name: Recheck release authority after legal evidence verification' "$deploy_workflow" | cut -d: -f1)"
aws_line="$(grep -n 'name: Configure AWS deploy credentials' "$deploy_workflow" | cut -d: -f1)"
clone_wait_line="$(grep -n 'name: Wait for exact clone rehearsal before quiesce' "$deploy_workflow" | cut -d: -f1)"
bridge_publisher_line="$(grep -n 'name: Configure AWS bridge image publisher credentials' "$deploy_workflow" | cut -d: -f1)"
bridge_restore_line="$(grep -n 'name: Restore exact UAT-attested bridge image' "$deploy_workflow" | cut -d: -f1)"
rollout_credentials_line="$(grep -n 'name: Configure AWS rollout credentials' "$deploy_workflow" | cut -d: -f1)"
bridge_line="$(grep -n 'name: Prove the exact UAT-attested bridge is globally closed and build PRE context' "$deploy_workflow" | cut -d: -f1)"
owner_line="$(grep -n 'name: Wait for and fully verify independent U5 owner authority' "$deploy_workflow" | cut -d: -f1)"
apply_line="$(grep -n 'name: Apply the exact reviewed migration while the bridge stays quiesced' "$deploy_workflow" | cut -d: -f1)"
post_migration_line="$(grep -n 'name: Wait for exact signed POST_MIGRATION evidence' "$deploy_workflow" | cut -d: -f1)"
final_deploy_line="$(grep -n 'name: Deploy immutable manifest' "$deploy_workflow" | cut -d: -f1)"
unquiesce_line="$(grep -n 'name: Prove final quiesced revision and unquiesce the same image last' "$deploy_workflow" | cut -d: -f1)"
retire_line="$(grep -n 'name: Retire superseded launch builds' "$deploy_workflow" | cut -d: -f1)"
post_context_line="$(grep -n 'name: Build exact POST_DEPLOYMENT stage context' "$deploy_workflow" | cut -d: -f1)"
post_validate_line="$(grep -n 'name: Wait for and fully verify signed POST deployment chain' "$deploy_workflow" | cut -d: -f1)"
test "$legal_policy_line" -lt "$recheck_line"
test "$legal_policy_line" -lt "$bridge_publisher_line"
test "$legal_policy_line" -lt "$legal_preflight_line"
test "$legal_preflight_line" -lt "$bridge_publisher_line"
test "$bridge_publisher_line" -lt "$bridge_restore_line"
test "$bridge_restore_line" -lt "$rollout_credentials_line"
test "$rollout_credentials_line" -lt "$clone_wait_line"
test "$recheck_line" -lt "$aws_line"
test "$recheck_line" -lt "$legal_reader_line"
test "$legal_reader_line" -lt "$legal_provision_line"
test "$legal_provision_line" -lt "$legal_validate_line"
test "$legal_validate_line" -lt "$legal_cleanup_line"
test "$legal_cleanup_line" -lt "$legal_recheck_line"
test "$legal_recheck_line" -lt "$aws_line"
test "$((aws_line - recheck_line))" -lt 100
test "$clone_wait_line" -lt "$bridge_line"
test "$bridge_line" -lt "$owner_line"
test "$owner_line" -lt "$apply_line"
test "$apply_line" -lt "$post_migration_line"
test "$post_migration_line" -lt "$final_deploy_line"
test "$final_deploy_line" -lt "$unquiesce_line"
test "$unquiesce_line" -lt "$retire_line"
test "$retire_line" -lt "$post_context_line"
test "$post_context_line" -lt "$post_validate_line"
grep -Fq 'bash infra/security/provision-legal-release-evidence.spec.sh' "$ci"
grep -Fq 'bash infra/security/validate-legal-release-readiness.spec.sh' "$ci"
grep -Fq 'bash infra/security/production-a5-current-health.spec.sh' "$ci"
grep -Fq 'publish_environment:' "$ci"
grep -Fq "environment: \${{ inputs.publish_environment || 'production' }}" "$ci"
grep -Fq 'git fetch origin develop --tags --force' "$uat_workflow"
grep -Fq 'resolve-production-release-ref.sh "$RELEASE_REF" origin/develop uat' "$uat_workflow"
grep -Fq 'test "$GITHUB_REF" = "refs/heads/main"' "$uat_workflow"
grep -Fq 'an all-target UAT acceptance must execute the exact CI policy stored in the candidate' "$uat_workflow"
grep -Fq 'an all-target UAT acceptance must use the exact deploy controller stored in the candidate' "$uat_workflow"
test "$(grep -Fc 'git merge-base --is-ancestor "$SOURCE_SHA" origin/develop' "$uat_workflow")" -eq 1
grep -Fq 'git merge-base --is-ancestor "$source_sha" origin/develop' "$uat_workflow"
grep -Fq 'ref: ${{ needs.resolve-release.outputs.source_sha }}' "$uat_workflow"
grep -Fq 'ref: ${{ github.workflow_sha }}' "$uat_workflow"
grep -Fq 'test "$(git rev-parse HEAD)" = "$GITHUB_WORKFLOW_SHA"' "$uat_workflow"
grep -Fq 'test "$(git -C candidate rev-parse HEAD)" = "$SOURCE_SHA"' "$uat_workflow"
grep -Fq 'run_m01_acceptance:' "$uat_workflow"
grep -Fq 'M-01 acceptance requires a resolved all-target release' "$uat_workflow"
grep -Fq "if: success() && inputs.run_m01_acceptance && steps.target.outputs.target == 'all'" "$uat_workflow"
grep -Fq '"$ECR_REGISTRY/watchdog-bms-api@$RELEASE_DIGEST" "$SOURCE_SHA" m01-live' "$uat_workflow"
grep -Fq 'env -u RELEASE_PARENT_OPERATION_ID -u RELEASE_DEPLOYMENT_MANIFEST_JSON \' "$uat_workflow"
m01_step_line="$(grep -n 'name: Run UAT M-01 actor-delegation acceptance' "$uat_workflow" | cut -d: -f1)"
release_finalizer_line="$(grep -n 'name: Retire superseded launch builds' "$uat_workflow" | cut -d: -f1)"
test "$m01_step_line" -gt "$release_finalizer_line"
grep -Fq 'name: Sign exact UAT deployment acceptance' "$uat_workflow"
grep -Fq "if: success() && steps.target.outputs.target == 'all'" "$uat_workflow"
if grep -Fq "if: success() && inputs.target == 'all'" "$uat_workflow"; then
  echo "ERROR: UAT acceptance must follow the resolved deployment target" >&2
  exit 1
fi
grep -Fq 'cosign sign-blob --yes \' "$uat_workflow"
grep -Fq 'acceptanceKind: "UAT_DEPLOYMENT_ACCEPTANCE"' "$uat_workflow"
grep -Fq 'target: "all"' "$uat_workflow"
grep -Fq 'name: uat-accepted-release-${{ needs.resolve-release.outputs.source_sha }}-attempt-${{ github.run_attempt }}' "$uat_workflow"
grep -Fq 'name: uat-deployment-acceptance-${{ needs.resolve-release.outputs.source_sha }}-attempt-${{ github.run_attempt }}' "$uat_workflow"
acceptance_step_line="$(grep -n 'name: Sign exact UAT deployment acceptance' "$uat_workflow" | cut -d: -f1)"
acceptance_upload_line="$(grep -n 'name: uat-deployment-acceptance-${{ needs.resolve-release.outputs.source_sha }}-attempt-${{ github.run_attempt }}' "$uat_workflow" | cut -d: -f1)"
test "$acceptance_step_line" -gt "$m01_step_line"
test "$acceptance_upload_line" -gt "$acceptance_step_line"
grep -Fq 'publish_environment: uat' "$uat_workflow"
grep -Fq 'Refresh AWS UAT credentials for deployment' "$uat_workflow"
acceptance_validator="$repo_root/infra/docker/validate-uat-deployment-acceptance.sh"
intent_validator="$repo_root/infra/docker/validate-production-release-intent.sh"
test -x "$acceptance_validator"
test -x "$intent_validator"
bash -n "$acceptance_validator" "$intent_validator"
acceptance_validator_hash="$(sha256sum "$acceptance_validator" | awk '{print $1}')"
manifest_validator_hash="$(sha256sum "$repo_root/infra/docker/validate-production-manifest.sh" | awk '{print $1}')"
[[ "$acceptance_validator_hash" =~ ^[0-9a-f]{64}$ ]]
[[ "$manifest_validator_hash" =~ ^[0-9a-f]{64}$ ]]
test "$(grep -Fhc "$acceptance_validator_hash" "$deploy_workflow" "$uat_workflow" | awk '{sum += $1} END {print sum}')" -eq 5

bash "$repo_root/infra/docker/uat-deployment-acceptance.spec.sh"
bash "$repo_root/infra/docker/production-release-intent.spec.sh"
bash "$repo_root/infra/docker/production-maintenance-workflow.spec.sh"
bash "$repo_root/infra/security/sync-production-maintenance-release-pins.spec.sh"
grep -Fq 'Verify maintenance policy pins before CI fan-out' "$ci"
grep -Fq 'node infra/security/sync-production-maintenance-release-pins.mjs --check' "$ci"

acceptance_source=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
acceptance_controller=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
acceptance_ci_blob=cccccccccccccccccccccccccccccccccccccccc
acceptance_deploy_blob=dddddddddddddddddddddddddddddddddddddddd
acceptance_run=123456789
acceptance_attempt=2
acceptance_repository=example/watchdog
acceptance_now=2000000000
acceptance_issued=$((acceptance_now - 100))
acceptance_expires=$((acceptance_issued + 86400))
acceptance_manifest="$fixture/uat-release-manifest.json"
acceptance_json="$fixture/uat-production-acceptance.json"
jq -cnS \
  --arg source "$acceptance_source" \
  --arg run "$acceptance_run" '
    {
      schemaVersion: 1,
      sourceCommit: $source,
      workflowRunId: $run,
      validationRunId: "123456788",
      images: [
        {service:"ai-gateway",repository:"watchdog-bms-ai-gateway",image:"registry/watchdog-bms-ai-gateway@sha256:2222222222222222222222222222222222222222222222222222222222222222",digest:"sha256:2222222222222222222222222222222222222222222222222222222222222222",sourceCommit:$source,sbom:"sbom-ai-gateway.spdx.json"},
        {service:"api-web",repository:"watchdog-bms-api",image:"registry/watchdog-bms-api@sha256:1111111111111111111111111111111111111111111111111111111111111111",digest:"sha256:1111111111111111111111111111111111111111111111111111111111111111",sourceCommit:$source,sbom:"sbom-api-web.spdx.json"},
        {service:"workers",repository:"watchdog-bms-workers",image:"registry/watchdog-bms-workers@sha256:3333333333333333333333333333333333333333333333333333333333333333",digest:"sha256:3333333333333333333333333333333333333333333333333333333333333333",sourceCommit:$source,sbom:"sbom-workers.spdx.json"}
      ]
    }
  ' > "$acceptance_manifest"
if command -v sha256sum >/dev/null 2>&1; then
  acceptance_manifest_hash="$(sha256sum "$acceptance_manifest" | awk '{print $1}')"
else
  acceptance_manifest_hash="$(shasum -a 256 "$acceptance_manifest" | awk '{print $1}')"
fi
acceptance_body="$fixture/uat-production-acceptance-body.json"
jq -cnS \
  --arg source "$acceptance_source" \
  --arg controller "$acceptance_controller" \
  --arg run "$acceptance_run" \
  --argjson attempt "$acceptance_attempt" \
  --arg repository "$acceptance_repository" \
  --arg manifestHash "$acceptance_manifest_hash" \
  --arg ciBlob "$acceptance_ci_blob" \
  --arg deployBlob "$acceptance_deploy_blob" \
  --arg validatorHash "$acceptance_validator_hash" \
  --arg manifestValidatorHash "$manifest_validator_hash" \
  --argjson issuedAt "$acceptance_issued" \
  --argjson expiresAt "$acceptance_expires" \
  --slurpfile manifest "$acceptance_manifest" '
    {
      schemaVersion:1,
      acceptanceKind:"UAT_DEPLOYMENT_ACCEPTANCE",
      environment:"uat",
      repository:$repository,
      workflowPath:".github/workflows/deploy-uat.yml",
      workflowRunId:$run,
      workflowRunAttempt:$attempt,
      controllerRef:"refs/heads/main",
      controllerCommit:$controller,
      sourceCommit:$source,
      ciWorkflowBlob:$ciBlob,
      deployWorkflowBlob:$deployBlob,
      validatorSha256:$validatorHash,
      manifestValidatorSha256:$manifestValidatorHash,
      issuedAtEpoch:$issuedAt,
      expiresAtEpoch:$expiresAt,
      target:"all",
      healthVerified:true,
      releaseFinalized:true,
      releaseArtifactName:("uat-accepted-release-" + $source + "-attempt-" + ($attempt | tostring)),
      releaseManifestSha256:$manifestHash,
      images:($manifest[0].images | map({service,image,digest,sourceCommit}) | sort_by(.service))
    }
  ' > "$acceptance_body"
acceptance_content_hash="$(jq -cS . "$acceptance_body" | sha256sum | awk '{print $1}')"
jq -cS --arg content "$acceptance_content_hash" '.contentSha256=$content' \
  "$acceptance_body" > "$acceptance_json"
"$acceptance_validator" "$acceptance_json" "$acceptance_manifest" \
  "$acceptance_source" "$acceptance_run" "$acceptance_attempt" \
  "$acceptance_controller" "$acceptance_repository" "$acceptance_ci_blob" \
  "$acceptance_deploy_blob" "$acceptance_validator_hash" "$acceptance_now"
jq -cS '.forged = true' "$acceptance_json" > "$fixture/uat-production-acceptance-extra-field.json"
if "$acceptance_validator" "$fixture/uat-production-acceptance-extra-field.json" "$acceptance_manifest" \
  "$acceptance_source" "$acceptance_run" "$acceptance_attempt" \
  "$acceptance_controller" "$acceptance_repository" "$acceptance_ci_blob" \
  "$acceptance_deploy_blob" "$acceptance_validator_hash" "$acceptance_now" >/dev/null 2>&1; then
  echo "ERROR: UAT acceptance validator accepted an unknown result field" >&2
  exit 1
fi
if "$acceptance_validator" "$acceptance_json" "$acceptance_manifest" \
  "$acceptance_source" 999 "$acceptance_attempt" \
  "$acceptance_controller" "$acceptance_repository" "$acceptance_ci_blob" \
  "$acceptance_deploy_blob" "$acceptance_validator_hash" "$acceptance_now" >/dev/null 2>&1; then
  echo "ERROR: UAT acceptance validator accepted the wrong workflow run" >&2
  exit 1
fi
jq -cS '.target = "api-web"' "$acceptance_json" > "$fixture/uat-production-acceptance-wrong-target.json"
if "$acceptance_validator" "$fixture/uat-production-acceptance-wrong-target.json" "$acceptance_manifest" \
  "$acceptance_source" "$acceptance_run" "$acceptance_attempt" \
  "$acceptance_controller" "$acceptance_repository" "$acceptance_ci_blob" \
  "$acceptance_deploy_blob" "$acceptance_validator_hash" "$acceptance_now" >/dev/null 2>&1; then
  echo "ERROR: UAT acceptance validator accepted a partial-service run" >&2
  exit 1
fi
jq -cS '.images[0].image += "-tampered"' "$acceptance_manifest" > "$fixture/uat-release-manifest-tampered.json"
if "$acceptance_validator" "$acceptance_json" "$fixture/uat-release-manifest-tampered.json" \
  "$acceptance_source" "$acceptance_run" "$acceptance_attempt" \
  "$acceptance_controller" "$acceptance_repository" "$acceptance_ci_blob" \
  "$acceptance_deploy_blob" "$acceptance_validator_hash" "$acceptance_now" >/dev/null 2>&1; then
  echo "ERROR: UAT acceptance validator accepted a different release manifest" >&2
  exit 1
fi
jq -cS '.expiresAtEpoch = 1999999999' "$acceptance_json" > "$fixture/uat-production-acceptance-expired.json"
if "$acceptance_validator" "$fixture/uat-production-acceptance-expired.json" "$acceptance_manifest" \
  "$acceptance_source" "$acceptance_run" "$acceptance_attempt" \
  "$acceptance_controller" "$acceptance_repository" "$acceptance_ci_blob" \
  "$acceptance_deploy_blob" "$acceptance_validator_hash" "$acceptance_now" >/dev/null 2>&1; then
  echo "ERROR: UAT acceptance validator accepted expired evidence" >&2
  exit 1
fi
if "$acceptance_validator" "$acceptance_json" "$acceptance_manifest" \
  "$acceptance_source" "$acceptance_run" "$acceptance_attempt" \
  "$acceptance_controller" "$acceptance_repository" ffffffffffffffffffffffffffffffffffffffff \
  "$acceptance_deploy_blob" "$acceptance_validator_hash" "$acceptance_now" >/dev/null 2>&1; then
  echo "ERROR: UAT acceptance validator accepted the wrong CI policy blob" >&2
  exit 1
fi

neutral_bootstrap="$repo_root/infra/uat/neutral-main-bootstrap-files.txt"
expected_neutral_bootstrap="$(printf '%s\n' \
  .github/workflows/ci.yml \
  .github/workflows/deploy-uat.yml \
  .github/workflows/f2-normalize-apply.yml \
  .github/workflows/f2-normalize.yml \
  .github/workflows/recover-release-intent.yml)"
test "$(cat "$neutral_bootstrap")" = "$expected_neutral_bootstrap"
if grep -Ev '^\.github/workflows/(ci|deploy-uat|f2-normalize|f2-normalize-apply|recover-release-intent)\.yml$' "$neutral_bootstrap" | grep -q .; then
  echo "ERROR: neutral main bootstrap includes production deployment, app code or runtime scripts" >&2
  exit 1
fi
# The one-shot exception is topology-sensitive, not merely path-name-sensitive. A deletion has the
# same name in `--name-only`, and an added symlink has the same name as a regular workflow. Pin the
# exact M/M/A/A/A status contract plus a 100644-blob check for all five candidate files.
grep -Fq 'git diff --name-status --no-renames "$BASE_SHA" "$sha"' "$ci"
grep -Fq "\$'M\\t.github/workflows/ci.yml'" "$ci"
grep -Fq "\$'M\\t.github/workflows/deploy-uat.yml'" "$ci"
grep -Fq "\$'A\\t.github/workflows/f2-normalize-apply.yml'" "$ci"
grep -Fq "\$'A\\t.github/workflows/f2-normalize.yml'" "$ci"
grep -Fq "\$'A\\t.github/workflows/recover-release-intent.yml'" "$ci"
grep -Fq 'git ls-tree "$sha" -- "$path"' "$ci"
grep -Fq '== "100644 blob"' "$ci"
recovery_workflow="$repo_root/.github/workflows/recover-release-intent.yml"
grep -Fq 'test "$GITHUB_REF" = refs/heads/main' "$recovery_workflow"
grep -Fq 'RECOVERY_FIX_BASELINE_UAT: 668a2d0827921257d6412a5edc0598d5aeb9a0fa' "$recovery_workflow"
grep -Fq 'git merge-base --is-ancestor "$RELEASE_REF" "origin/$branch"' "$recovery_workflow"
grep -Fq 'git merge-base --is-ancestor "$RELEASE_REF" "$RECOVERY_REF"' "$recovery_workflow"
grep -Fq 'git merge-base --is-ancestor "$baseline" "$RECOVERY_REF"' "$recovery_workflow"
grep -Fq 'test "$(git rev-parse HEAD)" = "$RECOVERY_REF"' "$recovery_workflow"
grep -Fq 'head_sha=$RECOVERY_REF' "$recovery_workflow"
grep -Fq '.head_sha == $sha and .head_branch == $branch and .conclusion == "success"' "$recovery_workflow"
grep -Fq 'actions/runs/$run_id/jobs?per_page=100' "$recovery_workflow"
grep -Fq '.total_count == (.jobs | length)' "$recovery_workflow"
grep -Fq 'select(.name == "Typecheck and Test")' "$recovery_workflow"
grep -Fq 'select(.name == "Typecheck and test durable release recovery against PostgreSQL")' "$recovery_workflow"
grep -Fq 'RECOVERY_CI_PROOF_REF_UAT: 33266c1220b3a71cfae86cbd3aeb5b0ad6607118' "$recovery_workflow"
grep -Fq 'RECOVERY_CI_PROOF_RUN_UAT: "32002605508"' "$recovery_workflow"
grep -Fq 'git diff --quiet "$proof_ref" "$RECOVERY_REF" --' "$recovery_workflow"
grep -Fq 'apps/api/prisma' "$recovery_workflow"
grep -Fq 'test "$DEPLOY_ENV" = uat' "$recovery_workflow"
grep -Fq 'release-intent-recover' "$recovery_workflow"
grep -Fq 'release-orphan-intent-recover' "$recovery_workflow"
grep -Fq 'release-pre-intent-recover' "$recovery_workflow"
grep -Fq 'release-bootstrap-closed-recover' "$recovery_workflow"
grep -Fq "inputs.intent_id == 'BOOTSTRAP_CLOSED'" "$recovery_workflow"
grep -Fq 'RELEASE_BOOTSTRAP_CLOSED_RECOVERY_JSON: ${{ steps.bootstrap_closed.outputs.evidence }}' "$recovery_workflow"
grep -Fq 'production-v2-controller-evidence-${RELEASE_REF}-attempt-${attempt}' "$recovery_workflow"
grep -Fq 'boundHistory:$bound' "$recovery_workflow"
grep -Fq 'test "$bound_count" -le 8' "$recovery_workflow"
test "$(grep -Fc 'curl_retry=(--retry 2 --retry-delay 2 --retry-max-time 70 --retry-all-errors)' "$recovery_workflow")" -eq 2
test "$(grep -Fc '"${curl_retry[@]}"' "$recovery_workflow")" -eq 6
grep -Fq -- '--max-filesize 16384 --output "$readiness" --write-out' "$recovery_workflow"
grep -Fq -- '--max-filesize 65536 --dump-header "$headers" --output "$body_file"' "$recovery_workflow"
grep -Fq 'inputs.intent_id }}" = PRE_INTENT' "$recovery_workflow"
grep -Fq 'group: watchdog-bms-${{ inputs.environment }}-deploy' "$recovery_workflow"
grep -Fq 'cancel-in-progress: false' "$recovery_workflow"
grep -Fq 'aws ecs describe-tasks --cluster "$cluster" --tasks "$PARENT_TASK_ARN"' "$recovery_workflow"
grep -Fq 'and .tasks[0].lastStatus == "STOPPED"' "$recovery_workflow"
grep -Fq 'and .tasks[0].desiredStatus == "STOPPED"' "$recovery_workflow"
grep -Fq 'first="$(read_stopped)"' "$recovery_workflow"
grep -Fq 'second="$(read_stopped)"' "$recovery_workflow"
grep -Fq 'test "$first" = "$second"' "$recovery_workflow"
grep -Fq 'RELEASE_RECOVERY_PARENT_TASK_EVIDENCE_JSON: ${{ steps.parent_task.outputs.evidence }}' "$recovery_workflow"
# ORPHAN recovery trusts historical execution evidence, not merely a signed image name. Runtime
# role/env overrides and task-definition mounts could otherwise execute different code or authority
# while preserving every previously-checked identity.
grep -Fq 'and ((.overrides.taskRoleArn // "") == "")' "$recovery_workflow"
grep -Fq 'and ((.overrides.executionRoleArn // "") == "")' "$recovery_workflow"
grep -Fq 'and ((.enableExecuteCommand // false) == false)' "$recovery_workflow"
grep -Fq 'and ((.taskDefinition.containerDefinitions[0].mountPoints // []) | length) == 0' "$recovery_workflow"
grep -Fq 'and ((.taskDefinition.containerDefinitions[0].volumesFrom // []) | length) == 0' "$recovery_workflow"
grep -Fq 'and ((.taskDefinition.containerDefinitions[0].repositoryCredentials // null) == null)' "$recovery_workflow"
grep -Fq 'and ((.taskDefinition.containerDefinitions[0].healthCheck // null) == null)' "$recovery_workflow"
grep -Fq 'and ((.taskDefinition.containerDefinitions[0].linuxParameters // null) == null)' "$recovery_workflow"
grep -Fq 'and .taskDefinition.containerDefinitions[0].logConfiguration.logDriver == "awslogs"' "$recovery_workflow"
grep -Fq 'and ((.taskDefinition.containerDefinitions[0].logConfiguration.secretOptions // []) | length) == 0' "$recovery_workflow"
grep -Fq 'and ((.taskDefinition.volumes // []) | length) == 0' "$recovery_workflow"
grep -Fq 'and ((.taskDefinition.proxyConfiguration // null) == null)' "$recovery_workflow"
grep -Fq 'test "$(jq -c '\''keys | sort'\'' <<< "$parent_env")" = "$parent_keys"' "$recovery_workflow"
grep -Fq 'test "$(jq -c '\''keys | sort'\'' <<< "$intent_env")" = "$intent_keys"' "$recovery_workflow"
grep -Fq 'test "$(jq -c '\''keys | sort'\'' <<< "$binder_env")" = "$binder_keys"' "$recovery_workflow"
expired_evidence="$repo_root/infra/uat/recovery-evidence/bf131086-6055-4143-a77c-579bc7d58b57.json"
expired_evidence_sha256=f152c3da1b7d6cb54d1d51b6714f8028fb2c43f8dd324efbc829142906fc7cfb
test "$(sha256sum "$expired_evidence" | awk '{print $1}')" = "$expired_evidence_sha256"
grep -Fq "reviewed_evidence_sha256=$expired_evidence_sha256" "$recovery_workflow"
grep -Fq 'test "$DEPLOY_ENV" = uat || { echo "ERROR: expired-task evidence is UAT-only"' "$recovery_workflow"
grep -Fq '.tasks == [] and (.failures | length) == 3' "$recovery_workflow"
grep -Fq 'historical tasks must be either all retained or all exact MISSING' "$recovery_workflow"
grep -Fq 'validate_reviewed_registration "$parent_def" parent' "$recovery_workflow"
grep -Fq 'aws logs get-log-events --log-group-name "$log_group" --log-stream-name "$stream"' "$recovery_workflow"
grep -Fq 'reviewedEvidenceManifestSha256:$manifestSha256' "$recovery_workflow"
grep -Fq 'originalController:$originalController,evidenceKind:$evidenceKind' "$recovery_workflow"
grep -Fq 'test "$(date -u -d "$deployment_created" +%s%3N)" = "$(date -u -d "$reviewed_deployment_created" +%s%3N)"' "$recovery_workflow"
release_operation="$repo_root/apps/api/prisma/run-exclusive-release-operation.ts"
grep -Fq "'infra/uat/recovery-evidence/bf131086-6055-4143-a77c-579bc7d58b57.json'" "$release_operation"
grep -Fq "'f152c3da1b7d6cb54d1d51b6714f8028fb2c43f8dd324efbc829142906fc7cfb'" "$release_operation"
grep -Fq "evidenceKind: 'RETAINED_ECS_TASK' | 'REVIEWED_EXPIRED_ECS_TASK'" "$release_operation"
grep -Fq 'retained ECS task evidence cannot carry reviewed-expiry authority' "$release_operation"
grep -Fq 'row.leaseOwner !== row.ecsTaskArn' "$release_operation"
grep -Fq 'system.release_operation.reclaim_stopped_hold' "$release_operation"
grep -Fq 'stopped parent-task evidence is accepted only by exact recovery modes' "$release_operation"
jq -e '
  .schemaVersion == 1 and .evidenceKind == "REVIEWED_EXPIRED_ECS_TASK" and .environment == "uat"
  and .parentOperationId == "bf131086-6055-4143-a77c-579bc7d58b57"
  and .releaseRef == "605a52e29f67d1dea5599387dbd22919799ebfe9"
  and .serviceName == "watchdog-bms-uat-ai-gateway"
  and .ssmParameterName == "/watchdog-bms/uat/ecs-express-ai-gateway-service-arn"
  and .tasks.parent.taskDefinitionArn == "arn:aws:ecs:ap-southeast-1:311414082667:task-definition/watchdog-bms-uat-release-task:28"
  and .tasks.intent.taskDefinitionArn == "arn:aws:ecs:ap-southeast-1:311414082667:task-definition/watchdog-bms-uat-release-task:30"
  and .tasks.binder.taskDefinitionArn == "arn:aws:ecs:ap-southeast-1:311414082667:task-definition/watchdog-bms-uat-release-task:34"
  and .tasks.parent.taskDefinitionRegisteredAt == "2026-08-02T18:28:08.054Z"
  and .tasks.intent.taskDefinitionRegisteredAt == "2026-08-02T18:31:28.654Z"
  and .tasks.binder.taskDefinitionRegisteredAt == "2026-08-02T18:34:10.816Z"
  and .tasks.parent.logStream == "release/release/3b0a64a9d6c1465998c45f4319b05d9b"
  and .tasks.parent.logTimestamp == 1785695387463
  and .tasks.intent.logTimestamp == 1785695602264 and .tasks.binder.logTimestamp == 1785695747810
  and .deploymentCreatedAt == "2026-08-02T18:34:00.973Z"
  and .auditMetadata.cloudTrailRunTaskEvents.parent.eventId == "fb35c60e-8abb-46ab-bba2-73805de726ce"
  and .auditMetadata.cloudTrailRunTaskEvents.intent.eventId == "09c116fd-9fdb-450d-a92f-056ade94ac63"
  and .auditMetadata.cloudTrailRunTaskEvents.binder.eventId == "a8af36f4-f63f-4f37-a8dc-d498d9e6fe3d"
  and all(.auditMetadata.cloudTrailRunTaskEvents[]; .requestOverridesPresent == false)
' "$expired_evidence" >/dev/null
grep -Fq 'sigstore/cosign-installer@6f9f17788090df1f26f669e9d70d6ae9567deba6' "$recovery_workflow"
grep -Fq 'deploy_workflow=deploy-uat.yml' "$recovery_workflow"
grep -Fq 'deploy_workflow=deploy-production.yml' "$recovery_workflow"
grep -Fq 'deploy_workflow=deploy-production-v2.yml' "$recovery_workflow"
grep -Fq 'image_signer_workflow=deploy-uat.yml' "$recovery_workflow"
grep -Fq -- '--certificate-identity "https://github.com/${GITHUB_REPOSITORY}/.github/workflows/${image_signer_workflow}@refs/heads/main"' "$recovery_workflow"
grep -Fq -- '--certificate-identity "https://github.com/${GITHUB_REPOSITORY}/.github/workflows/recover-release-intent.yml@refs/heads/main"' "$recovery_workflow"
grep -Fq 'org.opencontainers.image.revision' "$recovery_workflow"
grep -Fq 'RELEASE_RECOVERY_VALIDATED_CI_RUN_ID' "$recovery_workflow"
grep -Fq 'ci_event=workflow_dispatch' "$recovery_workflow"
grep -Fq '[ "$DEPLOY_ENV" = uat ] && ci_event=pull_request' "$recovery_workflow"
grep -Fq 'event=$ci_event&status=success&head_sha=$RECOVERY_REF' "$recovery_workflow"
grep -Fq 'and .event == $event and .path == ".github/workflows/ci.yml"' "$recovery_workflow"
if grep -Fq -- '--certificate-identity-regexp' "$recovery_workflow"; then
  echo "ERROR: recovery accepts a cross-environment release-image signer" >&2
  exit 1
fi
if grep -Fq 'deploy.sh' "$recovery_workflow"; then
  echo "ERROR: exact recovery controller must not perform an ordinary application deploy" >&2
  exit 1
fi
# The main copy is a controller only. The reusable CI receives the resolved develop SHA,
# checks it out first, derives its output from that checkout, and every executable job checks out
# the same output (or verifies an exact successful pull-request run for that SHA).
grep -Fq 'source_ref: ${{ needs.resolve-release.outputs.source_sha }}' "$uat_workflow"
grep -Fq 'ref: ${{ inputs.source_ref || github.event.pull_request.head.sha || github.sha }}' "$ci"
grep -Fq 'sha="$(git rev-parse HEAD)"' "$ci"
test "$(grep -Fc 'ref: ${{ needs.resolve-source.outputs.source_sha }}' "$ci")" -ge 1
grep -Fq '.head_sha == $sha' "$ci"
test "$(grep -Fc 'bash infra/uat/deploy-with-runtime-mutex.sh "$TARGET"' "$uat_workflow")" -eq 1
if grep -Fq 'bash infra/prod-ecs-express/deploy.sh "$TARGET"' "$uat_workflow"; then
  echo "ERROR: UAT workflow bypasses the reviewed runtime mutex wrapper" >&2
  exit 1
fi
grep -Fq '. infra/uat/lib-runtime-mutex.sh' "$repo_root/infra/prod-ecs-express/deploy.sh"
grep -Fq 'uat_runtime_mutex_acquire "deploy-${TARGET}"' "$repo_root/infra/prod-ecs-express/deploy.sh"
grep -Fq 'exec bash infra/prod-ecs-express/deploy.sh "${1:-all}"' "$uat_deploy"
if grep -Eq 'lib-runtime-mutex|uat_runtime_mutex_acquire' "$uat_deploy"; then
  echo "ERROR: UAT compatibility wrapper attempts to own the mutex a second time" >&2
  exit 1
fi
grep -Fq 'AI Gateway endpoint unchanged; skipping redundant api-web rollout' "$repo_root/infra/prod-ecs-express/deploy.sh"
test "$(grep -Fc 'if [ "$new_url" != "$current_url" ]; then' "$repo_root/infra/prod-ecs-express/deploy.sh")" -eq 2
grep -Fq 'source_ci="$(git rev-parse "$SOURCE_SHA:.github/workflows/ci.yml")"' "$uat_workflow"
grep -Fq 'caller_ci="$(git rev-parse "$GITHUB_SHA:.github/workflows/ci.yml")"' "$uat_workflow"
grep -Fq 'head_sha=$SOURCE_SHA' "$uat_workflow"
grep -Fq 'curl_retry=(--retry 2 --retry-delay 2 --retry-max-time 70 --retry-all-errors)' "$uat_workflow"
grep -Fq 'curl --fail --silent --show-error "${curl_retry[@]}"' "$uat_workflow"
grep -Fq 'event=pull_request&status=success&head_sha=$SOURCE_SHA' "$uat_workflow"
grep -Fq '.event == "pull_request"' "$uat_workflow"
grep -Fq 'validated_ci_run_id: ${{ needs.resolve-release.outputs.validated_ci_run_id }}' "$uat_workflow"
manifest_job="$(awk '/^  publish-production-manifest:/{found=1; next} found && /^  [[:alnum:]_-]+:/{exit} found{print}' "$ci")"
grep -Fq 'always() &&' <<< "$manifest_job"
grep -Fq "needs.resolve-source.result == 'success'" <<< "$manifest_job"
grep -Fq "needs.publish-production-images.result == 'success'" <<< "$manifest_job"
grep -Fq 'cache-from: type=gha,scope=release-tool-${{ matrix.purpose }}' "$ci"
grep -Fq 'cache-to: type=gha,mode=max,scope=release-tool-${{ matrix.purpose }},ignore-error=true' "$ci"
if grep -Fq 'Build and push exact-commit UAT release task' "$uat_workflow"; then
  echo 'ERROR: UAT deploy rebuilt the release task after CI publication' >&2
  exit 1
fi
if grep -Fq 'validated_ci_run_id:' "$deploy_workflow"; then
  echo "ERROR: production deploy must retain the full validation gate" >&2
  exit 1
fi
grep -Fq 'cache-from: type=gha,scope=release-task-api' "$deploy_workflow"
grep -Fq 'cache-to: type=gha,mode=max,scope=release-task-api,ignore-error=true' "$deploy_workflow"
grep -Fq 'environment: uat' "$uat_workflow"
grep -Fq 'DEPLOY_ENV: uat' "$uat_workflow"
grep -Fq 'ECS_CLUSTER_NAME: watchdog-bms-uat' "$uat_workflow"
grep -Fq 'ECS_DEPLOY_MANAGE_IAM: "false"' "$uat_workflow"
grep -Fq "CRM_AI_OUTBOUND_ALLOWED_DOMAINS: \${{ vars.CRM_AI_OUTBOUND_ALLOWED_DOMAINS || 'mangmeeplus.com' }}" "$deploy_workflow"
grep -Fq "CRM_AI_OUTBOUND_ALLOWED_DOMAINS: \${{ vars.CRM_AI_OUTBOUND_ALLOWED_DOMAINS || 'uat.mangmeeplus.com' }}" "$uat_workflow"
grep -Fq '{name:"CRM_AI_OUTBOUND_ALLOWED_DOMAINS", value:$crmAiOutboundAllowedDomains}' "$repo_root/infra/prod-ecs-express/deploy.sh"
grep -Fq 'CRM_AI_OUTBOUND_ALLOWED_DOMAINS_INPUT="${CRM_AI_OUTBOUND_ALLOWED_DOMAINS:-}"' "$repo_root/infra/prod-ecs-express/deploy.sh"
grep -Fq 'CRM_AI_OUTBOUND_ALLOWED_DOMAINS="mangmeeplus.com"' "$repo_root/infra/prod-ecs-express/deploy.sh"
grep -Fq 'CRM_AI_OUTBOUND_ALLOWED_DOMAINS="uat.mangmeeplus.com"' "$repo_root/infra/prod-ecs-express/deploy.sh"
grep -Fq 'PROD_CHAT_MODEL="global.anthropic.claude-sonnet-4-6"' "$repo_root/infra/prod-ecs-express/deploy.sh"
grep -Fq 'AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF is required to deploy production' "$repo_root/infra/prod-ecs-express/deploy.sh"
grep -Fq 'inference-profile/global.anthropic.*' "$repo_root/infra/prod-ecs-express/deploy.sh"
grep -Fq '{name:"AI_GLOBAL_INFERENCE_PROFILE_APPROVED", value:$globalProfileApproved}' "$repo_root/infra/prod-ecs-express/deploy.sh"
grep -Fq '{name:"AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF", value:$globalProfileApprovalRef}' "$repo_root/infra/prod-ecs-express/deploy.sh"
for key in \
  AI_DATA_RETENTION_DAYS AI_LLM_MAX_PER_COMPANY AI_OCR_MAX_PER_COMPANY \
  AI_RATE_LIMIT_WINDOW_SECONDS AI_THB_PER_USD PASSWORD_RESET_RESPONSE_MIN_MS \
  AI_MONTHLY_BUDGET_SATANG AI_MONTHLY_BUDGET_SATANG_CEILING \
  SESSION_REFRESH_MAX_PER_SESSION SESSION_REFRESH_WINDOW_SECONDS \
  SESSION_REFRESH_REUSE_GRACE_SECONDS CLAMAV_PORT CLAMAV_TIMEOUT_MS \
  AGENTCORE_MAX_BODY_BYTES AGENTCORE_MAX_MESSAGE_CHARS \
  AGENTCORE_MAX_ATTACHMENTS AGENTCORE_MAX_CONCURRENT_INVOCATIONS; do
  grep -Fq "$key:" "$deploy_workflow"
  grep -Fq "$key:" "$uat_workflow"
  grep -Fq "name:\"$key\"" "$repo_root/infra/prod-ecs-express/deploy.sh"
done
for key in \
  AGENTCORE_MAX_BODY_BYTES AGENTCORE_MAX_MESSAGE_CHARS \
  AGENTCORE_MAX_ATTACHMENTS AGENTCORE_MAX_CONCURRENT_INVOCATIONS; do
  grep -Fq "\"$key\":" "$repo_root/infra/ai-gateway/agentcore-deploy.sh"
done
grep -Fq 'CRM_AI_OUTBOUND_ALLOWED_DOMAINS: ${CRM_AI_OUTBOUND_ALLOWED_DOMAINS:-localhost,127.0.0.1,mangmeeplus.com,uat.mangmeeplus.com}' "$repo_root/infra/docker/compose.local.yml"
s3_lifecycle="$repo_root/infra/object-storage-lifecycle.json"
jq -e '
  ([.Rules[] | select(
    .ID == "expire-uncompleted-uploads"
    and .Status == "Enabled"
    and .Filter.Prefix == "pending/"
    and .Expiration.Days == 1
    and .NoncurrentVersionExpiration.NoncurrentDays == 1
    and .AbortIncompleteMultipartUpload.DaysAfterInitiation == 1
  )] | length) == 1
  and ([.Rules[] | select(
    .ID == "expire-report-exports"
    and .Status == "Enabled"
    and .Filter.Prefix == "report-export/"
    and .Expiration.Days == 7
    and .NoncurrentVersionExpiration.NoncurrentDays == 1
  )] | length) == 1
' "$s3_lifecycle" >/dev/null
grep -Fq -- '--lifecycle-configuration file://infra/object-storage-lifecycle.json' "$repo_root/infra/prod-ecs-express/deploy.sh"
grep -Fq -- '--lifecycle-configuration file://infra/object-storage-lifecycle.json' "$repo_root/infra/uat/bootstrap-data.sh"
grep -Fq -- '../object-storage-lifecycle.json:/config/object-storage-lifecycle.json:ro' "$repo_root/infra/docker/compose.local.yml"
grep -Fq 'mc ilm rule import "local/$$S3_BUCKET" < /config/object-storage-lifecycle.json' "$repo_root/infra/docker/compose.local.yml"
if grep -Eq 'environment: production|watchdog-bms/production|watchdog-bms-deploy-production' "$uat_workflow"; then
  echo "ERROR: UAT workflow references production authority or runtime state" >&2
  exit 1
fi

# The default branch holds neutral UAT controllers only. Validate their authority here; application
# runtime behavior is validated again from the exact develop release SHA before dispatch.
f2_plan_workflow="$repo_root/.github/workflows/f2-normalize.yml"
f2_apply_workflow="$repo_root/.github/workflows/f2-normalize-apply.yml"
for f2_workflow in "$f2_plan_workflow" "$f2_apply_workflow"; do
  grep -Fq 'group: watchdog-bms-${{ inputs.environment }}-deploy' "$f2_workflow"
  grep -Fq 'cancel-in-progress: false' "$f2_workflow"
  grep -Fq 'test "$GITHUB_REF" = "refs/heads/main"' "$f2_workflow"
  grep -Fq 'A5/F2 is locked to isolated UAT' "$f2_workflow"
  grep -Fq 'branch=develop' "$f2_workflow"
  grep -Fq 'git merge-base --is-ancestor' "$f2_workflow"
  grep -Fq 'sigstore/cosign-installer@6f9f17788090df1f26f669e9d70d6ae9567deba6' "$f2_workflow"
  grep -Fq 'signer_workflow=deploy-production.yml' "$f2_workflow"
  grep -Fq '[ "$DEPLOY_ENV" = uat ] && signer_workflow=deploy-uat.yml' "$f2_workflow"
  grep -Fq -- '--certificate-identity "https://github.com/${GITHUB_REPOSITORY}/.github/workflows/${signer_workflow}@refs/heads/main"' "$f2_workflow"
  grep -Fq 'org.opencontainers.image.revision' "$f2_workflow"
  if grep -Fq -- '--certificate-identity-regexp' "$f2_workflow"; then
    echo "ERROR: F2 accepts a cross-environment release-image signer" >&2
    exit 1
  fi
  if grep -Eq 'uses: .+@(main|v[0-9]+)$' "$f2_workflow"; then
    echo "ERROR: F2 workflow contains a mutable action reference" >&2
    exit 1
  fi
done

grep -Fq 'run-release-task.sh "$RELEASE_IMAGE" "$RELEASE_REF" a5-ro' "$f2_plan_workflow"
grep -Fq 'run-release-task.sh "$RELEASE_IMAGE" "$RELEASE_REF" f2-plan' "$f2_plan_workflow"
grep -Fq 'name: Re-pin PLAN after A5 collection' "$f2_plan_workflow"
grep -Fq 'schemaVersion: 2' "$f2_plan_workflow"
grep -Fq 'a5: $a5Evidence' "$f2_plan_workflow"
grep -Fq '.f2PrecheckReady' "$f2_plan_workflow"
grep -Fq 'approval: {' "$f2_plan_workflow"
grep -Fq 'planHashes: $plan.planHashes' "$f2_plan_workflow"
if grep -Eq 'F2_APPLY|F2_APPROVED_HASH|f2-apply' "$f2_plan_workflow"; then
  echo "ERROR: the read-only F2 PLAN workflow contains writer authority" >&2
  exit 1
fi
if grep -Eq '^  apply:' "$f2_plan_workflow"; then
  echo "ERROR: F2 PLAN and APPLY are not structurally separated" >&2
  exit 1
fi

grep -Fq 'run-release-task.sh "$RELEASE_IMAGE" "$RELEASE_REF" f2-apply' "$f2_apply_workflow"
grep -Fq 'run-release-task.sh "$RELEASE_IMAGE" "$RELEASE_REF" f2-verify' "$f2_apply_workflow"
grep -Fq 'run-release-task.sh "$RELEASE_IMAGE" "$RELEASE_REF" a5-ro' "$f2_apply_workflow"
fresh_a5_line="$(grep -n 'name: Refresh the zero-write A5 precheck before the writer' "$f2_apply_workflow" | cut -d: -f1)"
repin_a5_line="$(grep -n 'name: Re-pin APPLY after the fresh A5 precheck' "$f2_apply_workflow" | cut -d: -f1)"
f2_writer_line="$(grep -n 'name: Apply the reviewed plan' "$f2_apply_workflow" | cut -d: -f1)"
f2_verify_line="$(grep -n 'name: Verify the estate independently' "$f2_apply_workflow" | cut -d: -f1)"
final_a5_line="$(grep -n 'name: Re-check A5 and WHT after the writer' "$f2_apply_workflow" | cut -d: -f1)"
test "$fresh_a5_line" -lt "$repin_a5_line"
test "$repin_a5_line" -lt "$f2_writer_line"
test "$f2_writer_line" -lt "$f2_verify_line"
test "$f2_verify_line" -lt "$final_a5_line"
grep -Fq 'and .launchHealth.wht50Bis.open == 0' "$f2_apply_workflow"
grep -Fq "if: always() && steps.apply.outcome != 'skipped'" "$f2_apply_workflow"
grep -Fq 'run-id: ${{ inputs.plan_run_id }}' "$f2_apply_workflow"
grep -Fq 'the F2 controller changed after PLAN; re-plan before applying' "$f2_apply_workflow"
if sed -n '/^    inputs:/,/^permissions:/p' "$f2_apply_workflow" | grep -Eq 'hash:|release_ref:|release_image:|apply:'; then
  echo "ERROR: F2 APPLY exposes a caller-supplied authority value" >&2
  exit 1
fi

grep -Fq 'AWS_DEPLOY_ROLE_ARN' "$repo_root/infra/prod-ecs-express/README.md"
grep -Fq 'ECS_DEPLOY_MANAGE_IAM' "$repo_root/infra/prod-ecs-express/deploy.sh"
wait_helper="$repo_root/infra/prod-ecs-express/lib-wait-for-service-url.sh"
bash -n "$wait_helper"
grep -Fq '. "$(dirname "$0")/lib-wait-for-service-url.sh"' "$repo_root/infra/prod-ecs-express/deploy.sh"
grep -Fq 'describe-service-deployments' "$wait_helper"
grep -Fq 'deployment_status" = "SUCCESSFUL"' "$wait_helper"
grep -Fq 'list-service-deployments' "$wait_helper"
grep -Fq 'wait_for_service_url "$service_arn" "$access_type" "$expected_deployment"' "$repo_root/infra/prod-ecs-express/deploy.sh"
grep -Fq 'bind-express-deployment.sh' "$repo_root/infra/prod-ecs-express/deploy.sh"
grep -Fq 'verify-express-noop.sh' "$wait_helper"
grep -Fq 'could not be causally bound to exactly one deployment; state is UNKNOWN' "$repo_root/infra/prod-ecs-express/deploy.sh"
if grep -Eq 'expected_deployment=.*(previous|current).*deployment' "$repo_root/infra/prod-ecs-express/deploy.sh"; then
  echo "ERROR: an ambiguous ECS update is still inferred to be a no-op" >&2
  exit 1
fi
grep -Fq 'AWS credentials may have expired' "$wait_helper"
grep -Fq 'if [ "$new_url" != "$current_url" ]; then' "$repo_root/infra/prod-ecs-express/deploy.sh"
grep -Fq "require('./apps/api/node_modules/sharp')" "$repo_root/apps/api/Dockerfile"
grep -Fq "require('./apps/ai-gateway/node_modules/sharp')" "$repo_root/apps/ai-gateway/Dockerfile"
grep -Fq 'Receipt orientation runtime check failed' "$repo_root/apps/ai-gateway/Dockerfile"
grep -Fq "require('./api-runtime/apps/api/node_modules/sharp')" "$repo_root/infra/api-web/Dockerfile.api-web"
grep -Fq 'HOSTNAME=0.0.0.0 PORT="${WEB_PORT:-3002}"' "$repo_root/infra/api-web/start-api-web-runtime.sh"
grep -Fq 'clamav-1.5.3.linux.x86_64.deb' "$repo_root/infra/api-web/Dockerfile.api-web"
grep -Fq 'ADD --checksum=sha256:0c69e033a976855cfecfa1b6c36563822f2cc618f0c7e40ce5bcc2703d0dc436' "$repo_root/infra/api-web/Dockerfile.api-web"
grep -Fq 'TCPAddr 127.0.0.1' "$repo_root/infra/api-web/Dockerfile.api-web"
grep -Fq 'USER node' "$repo_root/infra/api-web/Dockerfile.api-web"
grep -Fq 'env -i PATH="$PATH" clamd --foreground=true --fail-if-cvd-older-than=7' "$repo_root/infra/api-web/start-api-web-runtime.sh"
grep -Fq 'freshclam --daemon --foreground --stdout --user=node' "$repo_root/infra/api-web/start-api-web-runtime.sh"
grep -Fq '/v1/health 2048 6144)' "$repo_root/infra/prod-ecs-express/deploy.sh"
jq -e . "$repo_root/infra/prod-ecs-express/github-deploy-role-trust.template.json" >/dev/null
jq -e . "$repo_root/infra/prod-ecs-express/github-deploy-role-policy.template.json" >/dev/null
# The readback statement covers both the release task role and the workers role, so `.Resource` is a
# list now; keep the check shape-tolerant rather than pinning it back to a single string.
jq -e '.Statement[] | select(.Sid == "VerifyReleaseTaskRolePolicy")
  | ((.Action | if type == "array" then . else [.] end) | index("iam:GetRolePolicy")) != null
    and ((.Resource | if type == "array" then . else [.] end)
      | any(endswith(":role/watchdog-bms-release-task-role")))' \
  "$repo_root/infra/prod-ecs-express/github-deploy-role-policy.template.json" >/dev/null
jq -e '
  .Statement as $statements
  | ($statements[] | select(.Sid=="EcsReleaseAndExpressDeploy").Action) as $ecs
  | ($statements[] | select(.Sid=="PassExistingEcsRoles").Resource) as $pass
  | ($statements[] | select(.Sid=="VerifyAndPullRuntimeImages").Resource) as $images
  | ($statements[] | select(.Sid=="NetworkRead").Action) as $network
  | ($ecs|index("ecs:DeregisterTaskDefinition"))!=null
    and ($ecs|index("ecs:StopTask"))!=null
    and ($pass|index("arn:aws:iam::<ACCOUNT_ID>:role/watchdog-bms-production-a5-apply-execution"))!=null
    and ($images|index("arn:aws:ecr:ap-southeast-1:<ACCOUNT_ID>:repository/watchdog-bms-migration-tool"))!=null
    and ($network|index("ec2:DescribeRouteTables"))!=null
    and ($network|index("ec2:DescribeVpcEndpoints"))!=null
    and any($statements[]; .Sid=="ProductionDatabaseReadback"
      and .Action=="rds:DescribeDBInstances"
      and .Resource=="arn:aws:rds:ap-southeast-1:<ACCOUNT_ID>:db:watchdog-bms-prod-db")
' "$repo_root/infra/prod-ecs-express/github-deploy-role-policy.template.json" >/dev/null
jq -e '
  .Statement[] | select(.Sid == "ReleaseTaskImage")
  | (.Action | index("ecr:DescribeImages")) != null
    and .Resource == "arn:aws:ecr:ap-southeast-1:<ACCOUNT_ID>:repository/watchdog-bms-api"
' "$repo_root/infra/prod-ecs-express/github-deploy-role-policy.template.json" >/dev/null
for policy in "$repo_root"/infra/uat/*.json; do
  jq -e . "$policy" >/dev/null
  if grep -Eq 'watchdog-bms/production|watchdog-bms-prod|environment:production' "$policy"; then
    echo "ERROR: UAT IAM template references production: $policy" >&2
    exit 1
  fi
done
# Exact actions/resources, so the preflight can prove sole inline policies and no attached policy on
# both UAT AI roles without turning the deploy controller into a general IAM reader.
jq -e '.Statement[] | select(.Sid == "VerifyUatReleaseTaskRolePolicy")
  | ((.Action | sort) == ["iam:GetRolePolicy","iam:ListAttachedRolePolicies","iam:ListRolePolicies"])
    and ((.Resource | sort) == [
      "arn:aws:iam::<ACCOUNT_ID>:role/watchdog-bms-deploy-uat",
      "arn:aws:iam::<ACCOUNT_ID>:role/watchdog-bms-uat-agentcore-execution-role",
      "arn:aws:iam::<ACCOUNT_ID>:role/watchdog-bms-uat-ecs-ai-gateway-role",
      "arn:aws:iam::<ACCOUNT_ID>:role/watchdog-bms-uat-ecs-workers-role",
      "arn:aws:iam::<ACCOUNT_ID>:role/watchdog-bms-uat-release-task-role"
    ])' \
  "$repo_root/infra/uat/github-deploy-role-policy.template.json" >/dev/null
jq -e '.Statement[] | select(.Sid == "VerifyUatReleaseImageSignatures")
  | (.Action | index("ecr:BatchGetImage")) != null
    and (.Resource | index("arn:aws:ecr:ap-southeast-1:<ACCOUNT_ID>:repository/watchdog-bms-migration-tool")) != null' \
  "$repo_root/infra/uat/github-deploy-role-policy.template.json" >/dev/null
grep -Fq 'watchdog-bms-uat-release-task-ecs-read' "$repo_root/infra/uat/setup-control-plane.sh"
grep -Fq 'ecs:DescribeExpressGatewayService' "$repo_root/infra/uat/setup-control-plane.sh"
grep -Fq 'ecs:DescribeServiceDeployments' "$repo_root/infra/uat/setup-control-plane.sh"
grep -Fq 'iam get-role-policy --role-name "$deploy_role" --policy-name watchdog-bms-uat-deploy' \
  "$repo_root/infra/uat/setup-control-plane.sh"
grep -Fq 'deploy-policy-actual.json' "$repo_root/infra/uat/setup-control-plane.sh"
grep -Fq 'deploy-policy-expected.json' "$repo_root/infra/uat/setup-control-plane.sh"
grep -Fq 'UAT_IAM_BOOTSTRAP_APPLY_UNVERIFIED' "$repo_root/infra/uat/setup-control-plane.sh"
grep -Fq 'one-shot bootstrap requires the existing ${deploy_role}' "$repo_root/infra/uat/setup-control-plane.sh"
grep -Fq 'iam create-role --role-name "$release_role"' "$repo_root/infra/uat/setup-control-plane.sh"
grep -Fq 'bootstrap-release-trust-actual.json' "$repo_root/infra/uat/setup-control-plane.sh"
grep -Fq 'APPLIED_BUT_UNVERIFIED: role=${release_role}' "$repo_root/infra/uat/setup-control-plane.sh"

# Execute both policy-read entry points under `set -u`. A same-command declaration such as
# `local role="$1" ... actual="${role}..."` expands `role` before Bash assigns it and used to stop
# the first post-assume-role UAT gate with an unbound-variable error. The fake denies the read so
# both scripts must fail closed with their intentional diagnostics before any mutation.
policy_preflight_fake="$fixture/policy-preflight-aws"
cat > "$policy_preflight_fake" <<'FAKE_POLICY_PREFLIGHT_AWS'
#!/usr/bin/env bash
set -euo pipefail
case "$1 $2" in
  'sts get-caller-identity') printf '311414082667\n' ;;
  'bedrock-agentcore-control list-agent-runtimes') printf '{"agentRuntimes":[]}\n' ;;
  'secretsmanager describe-secret')
    name=''
    while [ "$#" -gt 0 ]; do
      if [ "$1" = --secret-id ]; then name="$2"; break; fi
      shift
    done
    printf 'arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:%s-aaaaaa\n' "$name" ;;
  'iam get-role-policy') echo 'AccessDenied: test policy read refusal' >&2; exit 254 ;;
  *) echo "unexpected policy-preflight aws call: $*" >&2; exit 64 ;;
esac
FAKE_POLICY_PREFLIGHT_AWS
chmod +x "$policy_preflight_fake"

verify_policy_output="" verify_policy_code=0
verify_policy_output="$(AWS_BIN="$policy_preflight_fake" \
  bash "$repo_root/infra/uat/verify-control-plane-policies.sh" 2>&1)" || verify_policy_code=$?
if [ "$verify_policy_code" -ne 1 ] \
  || ! grep -Fq 'control-plane preflight cannot read role=watchdog-bms-deploy-uat' <<< "$verify_policy_output" \
  || grep -Fq 'unbound variable' <<< "$verify_policy_output"; then
  echo "ERROR: UAT policy verifier did not fail closed through its named-role diagnostic" >&2
  exit 1
fi

setup_policy_output="" setup_policy_code=0
setup_policy_output="$(AWS_BIN="$policy_preflight_fake" \
  bash "$repo_root/infra/uat/setup-control-plane.sh" 2>&1)" || setup_policy_code=$?
if [ "$setup_policy_code" -ne 1 ] \
  || ! grep -Fq 'cannot preflight iam:GetRolePolicy for watchdog-bms-deploy-uat/watchdog-bms-uat-deploy' <<< "$setup_policy_output" \
  || grep -Fq 'unbound variable' <<< "$setup_policy_output"; then
  echo "ERROR: UAT policy setup preflight did not fail closed through its named-role diagnostic" >&2
  exit 1
fi

resolver="$repo_root/infra/docker/resolve-production-release-ref.sh"
release_repo="$fixture/release-repo"
git init -q "$release_repo"
git -C "$release_repo" config user.name test
git -C "$release_repo" config user.email test@example.invalid
git -C "$release_repo" config commit.gpgSign false
printf 'allowed\n' > "$release_repo/value"
git -C "$release_repo" add value
git -C "$release_repo" commit -qm allowed
allowed_sha="$(git -C "$release_repo" rev-parse HEAD)"
git -C "$release_repo" branch allowed "$allowed_sha"
git -C "$release_repo" tag release-test "$allowed_sha"
git -C "$release_repo" tag uat-test "$allowed_sha"
test "$(cd "$release_repo" && bash "$resolver" "$allowed_sha" refs/heads/allowed)" = "$allowed_sha"
test "$(cd "$release_repo" && bash "$resolver" release-test refs/heads/allowed)" = "$allowed_sha"
test "$(cd "$release_repo" && bash "$resolver" uat-test refs/heads/allowed uat)" = "$allowed_sha"
if (cd "$release_repo" && bash "$resolver" release-test refs/heads/allowed uat) >/dev/null 2>&1; then
  echo "ERROR: UAT resolver accepted a production release tag" >&2
  exit 1
fi
git -C "$release_repo" checkout -q --orphan unrelated
printf 'unrelated\n' > "$release_repo/value"
git -C "$release_repo" add value
git -C "$release_repo" commit -qm unrelated
unrelated_sha="$(git -C "$release_repo" rev-parse HEAD)"
git -C "$release_repo" tag release-unrelated "$unrelated_sha"
if (cd "$release_repo" && bash "$resolver" "$unrelated_sha" refs/heads/allowed) >/dev/null 2>&1; then
  echo "ERROR: release resolver accepted a commit outside the allowed branch" >&2
  exit 1
fi
if (cd "$release_repo" && bash "$resolver" release-unrelated refs/heads/allowed) >/dev/null 2>&1; then
  echo "ERROR: release resolver accepted a tag outside the allowed branch" >&2
  exit 1
fi
if (cd "$release_repo" && bash "$resolver" main) >/dev/null 2>&1; then
  echo "ERROR: release resolver accepted an unapproved ref shape" >&2
  exit 1
fi

# Every ordinary release/F2/retirement task is owned by an exact GitHub workflow. These immutable
# runner fields are inherited by the production render fixtures below; UAT fixtures override only
# the environment-owned workflow path.
export GITHUB_ACTIONS=true
export GITHUB_RUN_ID=12345
export GITHUB_RUN_ATTEMPT=2
export GITHUB_ACTOR=release-operator
export GITHUB_ACTOR_ID=67890
export GITHUB_REPOSITORY=example/watchdog
export GITHUB_WORKFLOW_REF=example/watchdog/.github/workflows/deploy-production.yml@refs/heads/main

release_task="$fixture/release-task.json"
AWS_ACCOUNT_ID=311414082667 \
DATABASE_URL_SECRET_ARN=arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/production/database-url-aaaaaa \
RELEASE_TASK_RENDER_ONLY=true \
bash "$repo_root/infra/prod-ecs-express/run-release-task.sh" \
  "311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@sha256:$(printf 'c%.0s' {1..64})" \
  "$allowed_sha" > "$release_task"
# GIT_SHA is the FULL 40-hex commit, never the 12-char tag prefix: the launch-gate attestation this
# task writes must record exactly the build id the deployed services compare against, and the
# post-deploy retirement matches the platform's active list against it (F1.5.1, UAT r6 item 1).
jq -e --arg sha "$allowed_sha" '
  .family == "watchdog-bms-release-task"
  and .taskRoleArn == "arn:aws:iam::311414082667:role/watchdog-bms-release-task-role"
  and .containerDefinitions[0].user == "node"
  and .containerDefinitions[0].workingDirectory == "/app/apps/api"
  and ([.containerDefinitions[0].environment[] | select(.name == "GIT_SHA") | .value] == [$sha])
  and (.containerDefinitions[0].environment[] | select(.name == "GIT_SHA") | .value | test("^[0-9a-f]{40}$"))
  and ([.containerDefinitions[0].environment[] | select(.name == "RELEASE_SOURCE_BRANCH") | .value] == ["main"])
  and ([.containerDefinitions[0].environment[] | select(.name == "RELEASE_CONTROLLER_KIND") | .value] == ["GITHUB_ACTIONS"])
  and ([.containerDefinitions[0].environment[] | select(.name == "RELEASE_GITHUB_WORKFLOW_REF") | .value]
    == ["example/watchdog/.github/workflows/deploy-production.yml@refs/heads/main"])
  and ([.containerDefinitions[0].environment[] | select(.name == "RELEASE_MANUAL_ACTOR_REF")] == [])
  and ([.containerDefinitions[0].environment[] | select(.name == "RELEASE_OPERATION_MODE") | .value] == ["release"])
  and ([.containerDefinitions[0].environment[] | select(.name == "RELEASE_DEPLOY_TARGET") | .value] == ["all"])
  and ([.containerDefinitions[0].environment[] | select(.name == "RELEASE_OPERATION_ID") | .value][0]
    | test("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"))
  and ([.containerDefinitions[0].environment[] | select(.name == "RELEASE_PARENT_OPERATION_ID")] == [])
' "$release_task" >/dev/null
if env -u GITHUB_ACTIONS \
  AWS_ACCOUNT_ID=311414082667 \
  DATABASE_URL_SECRET_ARN=arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/production/database-url-aaaaaa \
  RELEASE_TASK_RENDER_ONLY=true \
  bash "$repo_root/infra/prod-ecs-express/run-release-task.sh" \
    "311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@sha256:$(printf 'c%.0s' {1..64})" \
    "$allowed_sha" release >/dev/null 2>&1; then
  echo "ERROR: ordinary release accepted a manual controller without branch ancestry evidence" >&2
  exit 1
fi
if GITHUB_WORKFLOW_REF=example/watchdog/.github/workflows/ci.yml@refs/heads/main \
  AWS_ACCOUNT_ID=311414082667 \
  DATABASE_URL_SECRET_ARN=arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/production/database-url-aaaaaa \
  RELEASE_TASK_RENDER_ONLY=true \
  bash "$repo_root/infra/prod-ecs-express/run-release-task.sh" \
    "311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@sha256:$(printf 'c%.0s' {1..64})" \
    "$allowed_sha" release >/dev/null 2>&1; then
  echo "ERROR: release accepted an arbitrary main-branch workflow as its controller" >&2
  exit 1
fi
jq -e '
  (.containerDefinitions[0].secrets | length) == 1
  and .containerDefinitions[0].secrets[0].name == "DATABASE_URL"
  and (.containerDefinitions[0].command | join(" ") | contains("run-exclusive-release-operation.ts"))
  and ([.containerDefinitions[0].environment[] | select(.name == "RELEASE_OPERATION_COMMAND") | .value][0] | contains("prisma migrate deploy"))
  and ([.containerDefinitions[0].environment[] | select(.name == "RELEASE_OPERATION_COMMAND") | .value][0] | contains("sync-permissions.ts"))
  and ([.containerDefinitions[0].environment[] | select(.name == "RELEASE_OPERATION_COMMAND") | .value][0] | contains("sync-thai-address-master.ts"))
' "$release_task" >/dev/null
grep -Fq 'pg_try_advisory_lock' "$repo_root/apps/api/prisma/run-exclusive-release-operation.ts"
grep -Fq -- '--started-by "$started_by"' "$repo_root/infra/prod-ecs-express/run-release-task.sh"
grep -Fq 'reconciling detached task' "$repo_root/infra/prod-ecs-express/run-release-task.sh"
uat_release_task="$fixture/uat-release-task.json"
DEPLOY_ENV=uat \
AWS_ACCOUNT_ID=311414082667 \
DATABASE_URL_SECRET_ARN=arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/uat/database-url-aaaaaa \
RELEASE_TASK_RENDER_ONLY=true \
GITHUB_ACTIONS=true GITHUB_RUN_ID=12345 GITHUB_RUN_ATTEMPT=2 \
GITHUB_ACTOR=uat-operator GITHUB_ACTOR_ID=67890 GITHUB_REPOSITORY=example/watchdog \
GITHUB_WORKFLOW_REF=example/watchdog/.github/workflows/deploy-uat.yml@refs/heads/main \
bash "$repo_root/infra/prod-ecs-express/run-release-task.sh" \
  "311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@sha256:$(printf 'd%.0s' {1..64})" \
  "$allowed_sha" > "$uat_release_task"
jq -e '
  .family == "watchdog-bms-uat-release-task"
  and .executionRoleArn == "arn:aws:iam::311414082667:role/watchdog-bms-uat-ecs-execution-role"
  and .taskRoleArn == "arn:aws:iam::311414082667:role/watchdog-bms-uat-release-task-role"
  and .containerDefinitions[0].logConfiguration.options["awslogs-group"] == "/ecs/watchdog-bms-uat-release-task"
  and ([.containerDefinitions[0].environment[] | select(.name == "RELEASE_SOURCE_BRANCH") | .value] == ["develop"])
  and ([.containerDefinitions[0].environment[] | select(.name == "RELEASE_CONTROLLER_KIND") | .value] == ["GITHUB_ACTIONS"])
  and ([.containerDefinitions[0].environment[] | select(.name == "RELEASE_GITHUB_RUN_ID") | .value] == ["12345"])
  and ([.containerDefinitions[0].environment[] | select(.name == "RELEASE_GITHUB_RUN_ATTEMPT") | .value] == ["2"])
  and ([.containerDefinitions[0].environment[] | select(.name == "RELEASE_GITHUB_ACTOR") | .value] == ["uat-operator"])
  and ([.containerDefinitions[0].environment[] | select(.name == "RELEASE_GITHUB_ACTOR_ID") | .value] == ["67890"])
  and ([.containerDefinitions[0].environment[] | select(.name == "RELEASE_GITHUB_WORKFLOW_REF") | .value]
    == ["example/watchdog/.github/workflows/deploy-uat.yml@refs/heads/main"])
  and (.containerDefinitions[0].secrets[0].valueFrom | contains(":secret:watchdog-bms/uat/database-url-"))
' "$uat_release_task" >/dev/null
m01_live_task="$fixture/m01-live-task.json"
DEPLOY_ENV=uat \
AWS_ACCOUNT_ID=311414082667 \
DATABASE_URL_SECRET_ARN=arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/uat/database-url-aaaaaa \
REDIS_URL_SECRET_ARN=arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/uat/redis-url-aaaaaa \
AI_GATEWAY_INTERNAL_SECRET_ARN=arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/uat/ai-gateway-internal-secret-aaaaaa \
AI_ACTOR_DELEGATION_SIGNING_KEY_ARN=arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/uat/ai-actor-delegation-signing-key-aaaaaa \
M01_API_BASE_URL=https://uat.example.test/v1 \
M01_RUN_ID="m01-live-${allowed_sha:0:12}-1" \
RELEASE_TASK_RENDER_ONLY=true \
GITHUB_WORKFLOW_REF=example/watchdog/.github/workflows/deploy-uat.yml@refs/heads/main \
bash "$repo_root/infra/prod-ecs-express/run-release-task.sh" \
  "311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@sha256:$(printf 'e%.0s' {1..64})" \
  "$allowed_sha" m01-live > "$m01_live_task"
jq -e --arg sha "$allowed_sha" '
  .family == "watchdog-bms-uat-release-task"
  and .containerDefinitions[0].name == "m01"
  and ([.containerDefinitions[0].environment[] | select(.name == "GIT_SHA") | .value] == [$sha])
  and (.containerDefinitions[0].environment[] | select(.name == "GIT_SHA") | .value | test("^[0-9a-f]{40}$"))
  and ([.containerDefinitions[0].secrets[].name] | sort) == [
    "AI_ACTOR_DELEGATION_SIGNING_KEY",
    "AI_GATEWAY_INTERNAL_SECRET",
    "DATABASE_URL",
    "REDIS_URL"
  ]
  and all(.containerDefinitions[0].secrets[]; .valueFrom | contains(":secret:watchdog-bms/uat/"))
  and ([.containerDefinitions[0].environment[] | select(.name == "RELEASE_OPERATION_COMMAND") | .value][0] | contains("m01-actor-delegation-live-smoke.ts"))
  and (([.containerDefinitions[0].environment[] | select(.name == "RELEASE_OPERATION_COMMAND") | .value][0]
    | contains("sync-feature-launch-gates.ts")) | not)
' "$m01_live_task" >/dev/null
if DEPLOY_ENV=uat \
  AWS_ACCOUNT_ID=311414082667 \
  DATABASE_URL_SECRET_ARN=arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/uat/database-url-aaaaaa \
  REDIS_URL_SECRET_ARN=arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/uat/redis-url-aaaaaa \
  AI_GATEWAY_INTERNAL_SECRET_ARN=arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/uat/ai-gateway-internal-secret-aaaaaa \
  AI_ACTOR_DELEGATION_SIGNING_KEY_ARN=arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/uat/ai-actor-delegation-signing-key-aaaaaa \
  M01_API_BASE_URL=https://uat.example.test/v1 \
  M01_RUN_ID="m01-live-${allowed_sha:0:12}-1" \
  RELEASE_PARENT_OPERATION_ID=11111111-2222-3333-4444-555555555555 \
  RELEASE_TASK_RENDER_ONLY=true \
  GITHUB_WORKFLOW_REF=example/watchdog/.github/workflows/deploy-uat.yml@refs/heads/main \
  bash "$repo_root/infra/prod-ecs-express/run-release-task.sh" \
    "311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@sha256:$(printf 'e%.0s' {1..64})" \
    "$allowed_sha" m01-live >/dev/null 2>&1; then
  echo "ERROR: M-01 silently attached to a held release without its exact manifest" >&2
  exit 1
fi
if AWS_ACCOUNT_ID=311414082667 \
  DATABASE_URL_SECRET_ARN=arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/production/database-url-aaaaaa \
  RELEASE_TASK_RENDER_ONLY=true \
  GITHUB_WORKFLOW_REF=example/watchdog/.github/workflows/deploy-uat.yml@refs/heads/main \
  bash "$repo_root/infra/prod-ecs-express/run-release-task.sh" \
    "311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@sha256:$(printf 'e%.0s' {1..64})" \
    "$allowed_sha" m01-live >/dev/null 2>&1; then
  echo "ERROR: M-01 live verification accepted production" >&2
  exit 1
fi
if DEPLOY_ENV=uat \
  AWS_ACCOUNT_ID=311414082667 \
  DATABASE_URL_SECRET_ARN=arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/production/database-url-aaaaaa \
  RELEASE_TASK_RENDER_ONLY=true \
  bash "$repo_root/infra/prod-ecs-express/run-release-task.sh" \
    "311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@sha256:$(printf 'd%.0s' {1..64})" \
    "$allowed_sha" >/dev/null 2>&1; then
  echo "ERROR: UAT release task accepted the production database secret" >&2
  exit 1
fi
if DEPLOY_ENV=uat \
  ECS_CLUSTER_NAME=watchdog-bms-prod \
  AWS_ACCOUNT_ID=311414082667 \
  DATABASE_URL_SECRET_ARN=arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/uat/database-url-aaaaaa \
  RELEASE_TASK_RENDER_ONLY=true \
  GITHUB_WORKFLOW_REF=example/watchdog/.github/workflows/deploy-uat.yml@refs/heads/main \
  bash "$repo_root/infra/prod-ecs-express/run-release-task.sh" \
    "311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@sha256:$(printf 'd%.0s' {1..64})" \
    "$allowed_sha" >/dev/null 2>&1; then
  echo "ERROR: UAT release task accepted the production cluster" >&2
  exit 1
fi

# ── UAT r6 item 4: post-deploy retirement must survive a FAILED rollout ────────────────────────────
# 4a — the active-build extraction is strict or it fails. The workflows used to read the list with
# `flatten | unique | join(",")`, which erased a configuration carrying no GIT_SHA and passed a
# malformed value through; either way a build still serving vanished from the list and was retired.
active_builds="$repo_root/infra/prod-ecs-express/active-launch-builds.sh"
bash -n "$active_builds"
sha_a="$(printf 'a%.0s' {1..40})"
sha_b="$(printf 'b%.0s' {1..40})"
# One ECS Express activeConfiguration per argument, each naming its service revision. The argument is
# that configuration's comma-separated GIT_SHA values; empty means "no GIT_SHA at all".
active_configurations() {
  local json='[]' spec index=0
  for spec in "$@"; do
    index=$((index + 1))
    json="$(jq -c --arg spec "$spec" --arg index "$index" \
      '. + [{
        serviceRevisionArn: ("arn:aws:ecs:ap-southeast-1:311414082667:service-revision/watchdog-bms-prod/api-web/" + $index),
        primaryContainer: {environment: (
          [{name:"NODE_ENV", value:"production"}]
          + (if $spec == "" then [] else ($spec | split(",") | map({name:"GIT_SHA", value:.})) end)
        )}
      }]' <<< "$json")"
  done
  printf '%s' "$json"
}
without_revision() { active_configurations "$@" | jq -c 'map(del(.serviceRevisionArn))'; }
test "$(active_configurations "$sha_a" "$sha_b" | bash "$active_builds")" = "$sha_a,$sha_b"
test "$(active_configurations "$sha_a" "$sha_a" | bash "$active_builds")" = "$sha_a"
assert_active_rejected() {
  local label="$1"
  shift
  if "$@" | bash "$active_builds" >/dev/null 2>&1; then
    echo "ERROR: active-build extraction accepted $label" >&2
    exit 1
  fi
}
assert_active_rejected 'a serving configuration with no GIT_SHA' active_configurations "$sha_a" ''
assert_active_rejected 'a 12-char short sha' active_configurations "${sha_a:0:12}"
assert_active_rejected 'an empty active list' printf '[]'
# UAT r7 item 1 — the counting used to be AGGREGATE (one GIT_SHA per active configuration, totalled),
# so a configuration carrying TWO shas paid for one carrying NONE and the serving build whose
# configuration had no GIT_SHA was silently erased from the list and then retired. Validation is now
# per configuration, so each of these fails on its own.
assert_active_rejected 'two GIT_SHA values in one configuration' active_configurations "$sha_a,$sha_b"
assert_active_rejected 'a two-sha configuration paying for a no-sha configuration' \
  active_configurations "$sha_a,$sha_b" ''
assert_active_rejected 'a configuration that names no service revision' without_revision "$sha_a"
assert_active_rejected 'three active configurations even when all name one SHA' \
  active_configurations "$sha_a" "$sha_a" "$sha_a"
assert_active_rejected 'a mixed valid/short pair inside one configuration' \
  active_configurations "$sha_a,${sha_b:0:12}"

# UAT r7 item 1(a)+(b) — reading the list from the PLATFORM is gated on a terminal deployment status
# and on two agreeing reads. Exit 75 means "not settled": defer, emit nothing, retire nothing.
fake_aws="$fixture/fake-aws"
cat > "$fake_aws" <<'FAKE_AWS'
#!/usr/bin/env bash
set -euo pipefail
query=""
for arg in "$@"; do
  case "$arg" in
    service.currentDeployment|service.activeConfigurations|'serviceDeployments[0].status') query="$arg" ;;
    'serviceDeployments[0].{status:status,serviceArn:serviceArn,targetRevision:targetServiceRevision.arn,createdAt:createdAt}') query=deployment ;;
    'service.{status:status.statusCode,currentDeployment:currentDeployment,activeConfigurations:activeConfigurations}') query=service-state ;;
  esac
done
if [[ "$*" == *"list-service-deployments"* ]]; then query=history; fi
case "$query" in
  service.currentDeployment)
    printf '%s\n' "${FAKE_CURRENT_DEPLOYMENT:-${FAKE_DEPLOYMENT_ARN:-arn:aws:ecs:ap-southeast-1:311414082667:service-deployment/watchdog-bms-prod/api-web/1}}"
    ;;
  deployment)
    jq -n \
      --arg status "${FAKE_DEPLOYMENT_STATUS:-SUCCESSFUL}" \
      --arg serviceArn "$FAKE_SERVICE_ARN" \
      --arg targetRevision "${FAKE_TARGET_REVISION:-arn:aws:ecs:ap-southeast-1:311414082667:service-revision/watchdog-bms-prod/api-web/1}" \
      '{status:$status,serviceArn:$serviceArn,targetRevision:$targetRevision,createdAt:"2026-08-02T01:00:00Z"}'
    ;;
  'serviceDeployments[0].status') printf '%s\n' "${FAKE_DEPLOYMENT_STATUS:-SUCCESSFUL}" ;;
  service.activeConfigurations)
    count="$(cat "$FAKE_READ_COUNT" 2>/dev/null || printf '0')"
    count=$((count + 1))
    printf '%s' "$count" > "$FAKE_READ_COUNT"
    read_file="${FAKE_ACTIVE_PREFIX}-${count}.json"
    [ -f "$read_file" ] || read_file="${FAKE_ACTIVE_PREFIX}-1.json"
    cat "$read_file"
    ;;
  service-state)
    count="$(cat "$FAKE_READ_COUNT" 2>/dev/null || printf '0')"
    count=$((count + 1))
    printf '%s' "$count" > "$FAKE_READ_COUNT"
    read_file="${FAKE_ACTIVE_PREFIX}-${count}.json"
    [ -f "$read_file" ] || read_file="${FAKE_ACTIVE_PREFIX}-1.json"
    current="${FAKE_CURRENT_DEPLOYMENT:-${FAKE_DEPLOYMENT_ARN:-arn:aws:ecs:ap-southeast-1:311414082667:service-deployment/watchdog-bms-prod/api-web/1}}"
    jq -cn --arg current "$current" --argjson active "$(cat "$read_file")" '
      {status:"ACTIVE",currentDeployment:(if $current == "None" then null else $current end),activeConfigurations:$active}
    '
    ;;
  history)
    target="${FAKE_DEPLOYMENT_ARN:-arn:aws:ecs:ap-southeast-1:311414082667:service-deployment/watchdog-bms-prod/api-web/1}"
    if [ "${FAKE_HISTORY_NEWER:-false}" = true ]; then
      jq -cn --arg target "$target" \
        '{nextToken:null,serviceDeployments:[
          {deploymentArn:$target,createdAt:"2026-08-02T01:00:00Z"},
          {deploymentArn:($target+"-new"),createdAt:"2026-08-02T01:01:00Z"}
        ]}'
    else
      jq -cn --arg target "$target" \
        '{nextToken:null,serviceDeployments:[{deploymentArn:$target,createdAt:"2026-08-02T01:00:00Z"}]}'
    fi
    ;;
  *) echo "unexpected fake aws call: $*" >&2; exit 64 ;;
esac
FAKE_AWS
chmod +x "$fake_aws"
export FAKE_READ_COUNT="$fixture/fake-read-count"
export FAKE_ACTIVE_PREFIX="$fixture/fake-active"
service_arn_fixture="arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-prod/api-web"
export FAKE_SERVICE_ARN="$service_arn_fixture"
deployment_arn_fixture="arn:aws:ecs:ap-southeast-1:311414082667:service-deployment/watchdog-bms-prod/api-web/1"
# Reads 1 and 2 are what the two stability reads see, in order.
platform_reads() {
  rm -f "$FAKE_READ_COUNT"
  printf '%s' "$1" > "${FAKE_ACTIVE_PREFIX}-1.json"
  printf '%s' "${2:-$1}" > "${FAKE_ACTIVE_PREFIX}-2.json"
}
platform_active() {
  AWS_BIN="$fake_aws" \
  ACTIVE_BUILDS_POLL_ATTEMPTS=2 ACTIVE_BUILDS_POLL_SECONDS=0 ACTIVE_BUILDS_STABILITY_SECONDS=0 \
  FAKE_DEPLOYMENT_STATUS="${1:-SUCCESSFUL}" \
    bash "$active_builds" --service-arn "$service_arn_fixture" --deployment-arn "$deployment_arn_fixture" \
      --target-revision-arn arn:aws:ecs:ap-southeast-1:311414082667:service-revision/watchdog-bms-prod/api-web/1
}
assert_deferred() {
  local label="$1" status="$2" output="" code=0
  output="$(platform_active "$status" 2>/dev/null)" || code=$?
  if [ "$code" -ne 75 ]; then
    echo "ERROR: platform read did not defer on $label (exit $code)" >&2
    exit 1
  fi
  if [ -n "$output" ]; then
    echo "ERROR: platform read emitted an active list while deferring on $label" >&2
    exit 1
  fi
}
platform_reads "$(active_configurations "$sha_a")"
test "$(platform_active SUCCESSFUL)" = "$sha_a"
platform_reads "$(active_configurations "$sha_a")"
test "$(FAKE_CURRENT_DEPLOYMENT=None platform_active SUCCESSFUL)" = "$sha_a"
platform_reads "$(active_configurations "$sha_a")"
FAKE_HISTORY_NEWER=true assert_deferred 'a newer deployment in bounded history' SUCCESSFUL
platform_reads "$(active_configurations "$sha_a")"
test "$(platform_active ROLLBACK_SUCCESSFUL)" = "$sha_a"
for non_terminal in IN_PROGRESS ROLLBACK_IN_PROGRESS PENDING ROLLBACK_FAILED STOPPED; do
  platform_reads "$(active_configurations "$sha_a")"
  assert_deferred "deployment status $non_terminal" "$non_terminal"
done
# The rollout reports a terminal status, but a draining configuration disappears between the reads.
platform_reads "$(active_configurations "$sha_a" "$sha_b")" "$(active_configurations "$sha_a")"
assert_deferred 'an active list that moved between two reads' SUCCESSFUL
# A malformed manifest is NOT a defer: it is a hard failure, so the caller stops instead of retiring.
platform_reads "$(active_configurations "$sha_a,$sha_b" '')"
malformed_code=0
platform_active SUCCESSFUL >/dev/null 2>&1 || malformed_code=$?
if [ "$malformed_code" -eq 0 ] || [ "$malformed_code" -eq 75 ]; then
  echo "ERROR: a malformed active manifest must fail hard, never pass and never defer (exit $malformed_code)" >&2
  exit 1
fi

# 4b — reconcile mode. After a rollback the deployed commit is exactly the build that is NOT serving,
# so the retire task must accept an active list without it and tell the CLI to reconcile.
reconcile_task="$fixture/reconcile-task.json"
retire_deployment_arn="arn:aws:ecs:ap-southeast-1:311414082667:service-deployment/watchdog-bms-prod/api-web/deployment"
retire_service_arn="arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-prod/api-web"
retire_target_revision_arn="arn:aws:ecs:ap-southeast-1:311414082667:service-revision/watchdog-bms-prod/api-web/revision"
RETIRE_ACTIVE_BUILDS="$sha_a" \
RETIRE_DEPLOYMENT_ARN="$retire_deployment_arn" \
RETIRE_SERVICE_ARN="$retire_service_arn" \
RETIRE_TARGET_REVISION_ARN="$retire_target_revision_arn" \
AWS_ACCOUNT_ID=311414082667 \
DATABASE_URL_SECRET_ARN=arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/production/database-url-aaaaaa \
RELEASE_TASK_RENDER_ONLY=true \
bash "$repo_root/infra/prod-ecs-express/run-release-task.sh" \
  "311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@sha256:$(printf 'c%.0s' {1..64})" \
  "$allowed_sha" reconcile > "$reconcile_task"
jq -e --arg sha "$allowed_sha" --arg active "$sha_a" '
  .containerDefinitions[0].name == "retire"
  and ([.containerDefinitions[0].environment[] | select(.name == "RELEASE_OPERATION_COMMAND") | .value][0]
       | contains("retire-launch-builds.ts --mode=reconcile --active-builds=" + $active))
  and ([.containerDefinitions[0].environment[] | select(.name == "GIT_SHA") | .value] == [$sha])
' "$reconcile_task" >/dev/null
retire_task="$fixture/retire-task.json"
RETIRE_ACTIVE_BUILDS="$allowed_sha" \
RETIRE_DEPLOYMENT_ARN="$retire_deployment_arn" \
RETIRE_SERVICE_ARN="$retire_service_arn" \
RETIRE_TARGET_REVISION_ARN="$retire_target_revision_arn" \
AWS_ACCOUNT_ID=311414082667 \
DATABASE_URL_SECRET_ARN=arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/production/database-url-aaaaaa \
RELEASE_TASK_RENDER_ONLY=true \
bash "$repo_root/infra/prod-ecs-express/run-release-task.sh" \
  "311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@sha256:$(printf 'c%.0s' {1..64})" \
  "$allowed_sha" retire > "$retire_task"
jq -e --arg active "$allowed_sha" '
  [.containerDefinitions[0].environment[] | select(.name == "RELEASE_OPERATION_COMMAND") | .value][0]
  | contains("retire-launch-builds.ts --mode=retire --active-builds=" + $active)
' "$retire_task" >/dev/null
# The shape check on the list itself is NOT relaxed by any of this.
if RETIRE_ACTIVE_BUILDS="${allowed_sha:0:12}" \
  AWS_ACCOUNT_ID=311414082667 \
  DATABASE_URL_SECRET_ARN=arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/production/database-url-aaaaaa \
  RELEASE_TASK_RENDER_ONLY=true \
  bash "$repo_root/infra/prod-ecs-express/run-release-task.sh" \
    "311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@sha256:$(printf 'c%.0s' {1..64})" \
    "$allowed_sha" reconcile >/dev/null 2>&1; then
  echo "ERROR: retirement accepted a short-sha active build list" >&2
  exit 1
fi
# UAT r7 item 1(c) — `retire` claims the incoming build is the one serving, so it must be in the
# list. A two-build window still counts as serving; `reconcile` remains exempt (proved above).
render_release_task() {
  local label="$1" mode="$2"
  shift 2
  local controller_workflow="deploy-production.yml"
  local deploy_env="production"
  local database_secret="arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/production/database-url-aaaaaa"
  local readonly_secret=""
  case "$mode" in
    a5-ro|f2-plan)
      controller_workflow="f2-normalize.yml"
      deploy_env="uat"
      database_secret=""
      readonly_secret="arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/uat/a5-readonly-database-url-aaaaaa"
      ;;
    a5-capacity|a5-capacity-cleanup)
      controller_workflow="a5-capacity-uat.yml"
      deploy_env="uat"
      database_secret="arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/uat/database-url-aaaaaa"
      ;;
    f2-verify)
      controller_workflow="f2-normalize-apply.yml"
      deploy_env="uat"
      database_secret=""
      readonly_secret="arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/uat/a5-readonly-database-url-aaaaaa"
      ;;
    f2-apply)
      controller_workflow="f2-normalize-apply.yml"
      deploy_env="uat"
      database_secret="arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/uat/database-url-aaaaaa"
      ;;
    release-intent-recover|release-orphan-intent-recover|release-pre-intent-recover|release-bootstrap-closed-recover) controller_workflow="recover-release-intent.yml" ;;
  esac
  env GITHUB_WORKFLOW_REF="example/watchdog/.github/workflows/${controller_workflow}@refs/heads/main" \
    AWS_ACCOUNT_ID=311414082667 \
    DEPLOY_ENV="$deploy_env" \
    DATABASE_URL_SECRET_ARN="$database_secret" \
    A5_READONLY_DATABASE_URL_SECRET_ARN="$readonly_secret" \
    RETIRE_DEPLOYMENT_ARN="$retire_deployment_arn" \
    RETIRE_SERVICE_ARN="$retire_service_arn" \
    RETIRE_TARGET_REVISION_ARN="$retire_target_revision_arn" \
    RELEASE_TASK_RENDER_ONLY=true "$@" \
    bash "$repo_root/infra/prod-ecs-express/run-release-task.sh" \
      "311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@sha256:$(printf 'c%.0s' {1..64})" \
      "$allowed_sha" "$mode"
}
assert_release_task_rejected() {
  local label="$1"
  shift
  if render_release_task "$label" "$@" >/dev/null 2>&1; then
    echo "ERROR: release task accepted $label" >&2
    exit 1
  fi
}
render_release_task 'a draining two-build retire window' retire \
  "RETIRE_ACTIVE_BUILDS=${sha_a},${allowed_sha}" >/dev/null
assert_release_task_rejected 'a retire whose deployed commit is not serving' retire \
  "RETIRE_ACTIVE_BUILDS=$sha_a"

# The pre-deploy release stays RUNNING while exact deployments are appended by short binder tasks.
# A finalizer must carry the same parent UUID and the complete bounded history (a service can roll
# twice during bootstrap/config discovery), while a binder carries exactly one record.
parent_operation_id='11111111-2222-3333-4444-555555555555'
mutation_intent_id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
held_record_one="$(jq -cn \
  --arg serviceArn "$retire_service_arn" --arg deploymentArn "$retire_deployment_arn" \
  --arg targetRevisionArn "$retire_target_revision_arn" --arg sourceSha "$allowed_sha" \
  '{service:"api-web",serviceArn:$serviceArn,deploymentArn:$deploymentArn,
    targetRevisionArn:$targetRevisionArn,sourceSha:$sourceSha,noOp:false}')"
held_record_two="$(jq -cn \
  --arg serviceArn "$retire_service_arn" --arg deploymentArn "${retire_deployment_arn}-two" \
  --arg targetRevisionArn "${retire_target_revision_arn}-two" --arg sourceSha "$allowed_sha" \
  '{service:"api-web",serviceArn:$serviceArn,deploymentArn:$deploymentArn,
    targetRevisionArn:$targetRevisionArn,sourceSha:$sourceSha,noOp:false}')"
held_one="$(jq -cn --argjson row "$held_record_one" '[$row]')"
held_full="$(jq -cn --argjson first "$held_record_one" --argjson second "$held_record_two" '[$first,$second]')"
held_task="$fixture/held-task.json"
bootstrap_closed_recovery="$(jq -cn \
  --arg operation "$parent_operation_id" --arg source "$allowed_sha" \
  '{schemaVersion:2,artifactDigest:("sha256:"+("1"*64)),maintenanceProofSha256:("2"*64),
    failedPromotionRunId:"31727367323",failedPromotionRunAttempt:1,controllerCommit:("d"*40),
    sourceCommit:$source,operationId:$operation,
    parentTaskArn:"arn:aws:ecs:ap-southeast-1:311414082667:task/watchdog-bms-prod/parent",
    manifestSha256:("3"*64),services:[{},{},{}],boundHistory:[]}')"
bootstrap_closed_task="$fixture/bootstrap-closed-task.json"
render_release_task 'the exact V2 bootstrap-closed recovery' release-bootstrap-closed-recover \
  "RELEASE_PARENT_OPERATION_ID=$parent_operation_id" \
  "RELEASE_RECOVERY_BUILD_RELEASE_ID=$allowed_sha" \
  RELEASE_RECOVERY_VALIDATED_CI_RUN_ID=31730000001 \
  "RELEASE_BOOTSTRAP_CLOSED_RECOVERY_JSON=$bootstrap_closed_recovery" > "$bootstrap_closed_task"
jq -e --arg parent "$parent_operation_id" --argjson evidence "$bootstrap_closed_recovery" '
  .containerDefinitions[0].name=="release-bootstrap-closed-recover"
  and ([.containerDefinitions[0].environment[]|select(.name=="RELEASE_PARENT_OPERATION_ID")|.value]==[$parent])
  and ([.containerDefinitions[0].environment[]|select(.name=="RELEASE_BOOTSTRAP_CLOSED_RECOVERY_JSON")|.value][0]|fromjson)==$evidence
' "$bootstrap_closed_task" >/dev/null
assert_release_task_rejected 'bootstrap-closed evidence on an ordinary intent' release-intent \
  "RELEASE_PARENT_OPERATION_ID=$parent_operation_id" \
  "RELEASE_MUTATION_INTENT_JSON=$(jq -cn --arg id "$mutation_intent_id" '{id:$id,serviceKey:"api-web",mutationKind:"UPDATE",requestHash:("1"*64),desiredConfigHash:("2"*64),beforeDeploymentArns:[],beforeActiveConfigurations:[]}')" \
  "RELEASE_BOOTSTRAP_CLOSED_RECOVERY_JSON=$bootstrap_closed_recovery"
assert_release_task_rejected 'an inherited deploy target on release-intent' release-intent \
  "RELEASE_PARENT_OPERATION_ID=$parent_operation_id" \
  "RELEASE_MUTATION_INTENT_JSON=$(jq -cn --arg id "$mutation_intent_id" '{id:$id,serviceKey:"api-web",mutationKind:"UPDATE",requestHash:("1"*64),desiredConfigHash:("2"*64),beforeDeploymentArns:[],beforeActiveConfigurations:[]}')" \
  RELEASE_DEPLOY_TARGET=all

# The recovery controller pins the exact environment names emitted by these three historical
# modes. An extra NODE_OPTIONS/BASH_ENV/DATABASE_URL name is executable input, not harmless metadata.
orphan_common_keys='["APP_ENV","AWS_REGION","DEPLOY_ENVIRONMENT","GIT_SHA","NODE_ENV","RELEASE_CONTROLLER_KIND","RELEASE_GITHUB_ACTOR","RELEASE_GITHUB_ACTOR_ID","RELEASE_GITHUB_REPOSITORY","RELEASE_GITHUB_RUN_ATTEMPT","RELEASE_GITHUB_RUN_ID","RELEASE_GITHUB_WORKFLOW_REF","RELEASE_OPERATION_MODE","RELEASE_SOURCE_BRANCH"]'
orphan_parent_keys="$(jq -cn --argjson common "$orphan_common_keys" '$common + ["RELEASE_DEPLOY_TARGET","RELEASE_OPERATION_COMMAND","RELEASE_OPERATION_ID"] | sort')"
orphan_intent_keys="$(jq -cn --argjson common "$orphan_common_keys" '$common + ["RELEASE_MUTATION_INTENT_ID","RELEASE_MUTATION_INTENT_JSON","RELEASE_PARENT_OPERATION_ID"] | sort')"
orphan_binder_keys="$(jq -cn --argjson common "$orphan_common_keys" '$common + ["RELEASE_MUTATION_INTENT_ID","RELEASE_OPERATION_DEPLOYMENT_MANIFEST","RELEASE_PARENT_OPERATION_ID"] | sort')"
grep -Fq "common_keys='$orphan_common_keys'" "$recovery_workflow"
grep -Fq '$common + ["RELEASE_DEPLOY_TARGET","RELEASE_OPERATION_COMMAND","RELEASE_OPERATION_ID"] | sort' "$recovery_workflow"
grep -Fq '$common + ["RELEASE_MUTATION_INTENT_ID","RELEASE_MUTATION_INTENT_JSON","RELEASE_PARENT_OPERATION_ID"] | sort' "$recovery_workflow"
grep -Fq '$common + ["RELEASE_MUTATION_INTENT_ID","RELEASE_OPERATION_DEPLOYMENT_MANIFEST","RELEASE_PARENT_OPERATION_ID"] | sort' "$recovery_workflow"
test "$(jq -c '[.containerDefinitions[0].environment[].name] | sort' "$release_task")" = "$orphan_parent_keys"

orphan_intent_json="$(jq -cn --arg id "$mutation_intent_id" --arg sha "${allowed_sha:0:12}" '
  {id:$id,serviceKey:"ai-gateway",mutationKind:"UPDATE",
    expectedServiceArn:"arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-prod/watchdog-bms-ai-gateway",
    clusterName:"watchdog-bms-prod",serviceName:"watchdog-bms-ai-gateway",
    ssmParameterName:"/watchdog-bms/production/ecs-express-ai-gateway-service-arn",
    requestHash:("a" * 64),desiredConfigHash:("b" * 64),beforeDeploymentArns:[],
    beforeCurrentDeploymentArn:null,beforeActiveConfigurations:[],
    legacyBootstrapDescriptor:{revisionArn:"legacy",sourceSha:$sha}}')"
orphan_intent_task="$fixture/orphan-intent-task.json"
render_release_task 'an orphan historical intent definition' release-intent \
  RETIRE_DEPLOYMENT_ARN= RETIRE_SERVICE_ARN= RETIRE_TARGET_REVISION_ARN= \
  "RELEASE_PARENT_OPERATION_ID=$parent_operation_id" \
  "RELEASE_MUTATION_INTENT_JSON=$orphan_intent_json" > "$orphan_intent_task"
test "$(jq -c '[.containerDefinitions[0].environment[].name] | sort' "$orphan_intent_task")" = "$orphan_intent_keys"

render_release_task 'an exact release binder' release-bind \
  RETIRE_DEPLOYMENT_ARN= RETIRE_SERVICE_ARN= RETIRE_TARGET_REVISION_ARN= \
  "RELEASE_PARENT_OPERATION_ID=$parent_operation_id" \
  "RELEASE_MUTATION_INTENT_ID=$mutation_intent_id" \
  "RELEASE_DEPLOYMENT_MANIFEST_JSON=$held_one" > "$held_task"
test "$(jq -c '[.containerDefinitions[0].environment[].name] | sort' "$held_task")" = "$orphan_binder_keys"
jq -e --arg parent "$parent_operation_id" --argjson manifest "$held_one" '
  .containerDefinitions[0].name == "release-bind"
  and ([.containerDefinitions[0].environment[] | select(.name == "RELEASE_OPERATION_MODE") | .value] == ["release-bind"])
  and ([.containerDefinitions[0].environment[] | select(.name == "RELEASE_PARENT_OPERATION_ID") | .value] == [$parent])
  and ([.containerDefinitions[0].environment[] | select(.name == "RELEASE_OPERATION_DEPLOYMENT_MANIFEST") | .value][0] | fromjson) == $manifest
  and ([.containerDefinitions[0].environment[] | select(.name == "RELEASE_OPERATION_COMMAND")] == [])
' "$held_task" >/dev/null

orphan_release_command='set -eu; ./node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma; ./node_modules/.bin/tsx prisma/sync-permissions.ts; ./node_modules/.bin/tsx prisma/sync-workflow-templates.ts; ./node_modules/.bin/tsx prisma/sync-thai-address-master.ts; ./node_modules/.bin/tsx prisma/normalize-entitlements.ts --dry-run --allow-exceptions; echo release-task-complete sha=$GIT_SHA'
orphan_launch_release_command='set -eu; ./node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma; ./node_modules/.bin/tsx prisma/sync-permissions.ts; ./node_modules/.bin/tsx prisma/sync-feature-launch-gates.ts --verify-specialist-closed; ./node_modules/.bin/tsx prisma/sync-workflow-templates.ts; ./node_modules/.bin/tsx prisma/sync-thai-address-master.ts; ./node_modules/.bin/tsx prisma/normalize-entitlements.ts --dry-run --allow-exceptions; echo release-task-complete sha=$GIT_SHA'
grep -Fq "release_command='$orphan_release_command'" "$recovery_workflow"
grep -Fq "launch_release_command='$orphan_launch_release_command'" "$recovery_workflow"
test "$(jq -r '.containerDefinitions[0].environment[] | select(.name == "RELEASE_OPERATION_COMMAND") | .value' "$release_task")" = "$orphan_launch_release_command"

# Executable negative fixtures for the trust-boundary clauses above. The static assertions tie each
# clause to the workflow; these mutations prove the clauses reject code/authority substitution.
select_orphan_task_evidence() {
  local selector_environment="$1" response="$2" parent="$3" intent="$4" binder="$5"
  if jq -e '(.failures | length) == 0 and (.tasks | length) == 3' <<< "$response" >/dev/null; then
    printf 'RETAINED_ECS_TASK\n'
  elif jq -e --arg parent "$parent" --arg intent "$intent" --arg binder "$binder" '
    .tasks == [] and (.failures | length) == 3
    and ([.failures[] | {taskId:(.arn | split("/")[-1]),reason}] | sort_by(.taskId)) ==
      ([{taskId:$parent,reason:"MISSING"},{taskId:$intent,reason:"MISSING"},{taskId:$binder,reason:"MISSING"}] | sort_by(.taskId))
  ' <<< "$response" >/dev/null; then
    [ "$selector_environment" = uat ] || return 1
    printf 'REVIEWED_EXPIRED_ECS_TASK\n'
  else
    return 1
  fi
}
expired_parent="$(jq -r '.tasks.parent.taskArn' "$expired_evidence")"
expired_intent="$(jq -r '.tasks.intent.taskArn' "$expired_evidence")"
expired_binder="$(jq -r '.tasks.binder.taskArn' "$expired_evidence")"
expired_parent_id="${expired_parent##*/}"
expired_intent_id="${expired_intent##*/}"
expired_binder_id="${expired_binder##*/}"
retained_response='{"failures":[],"tasks":[{"taskArn":"parent"},{"taskArn":"intent"},{"taskArn":"binder"}]}'
expired_response="$(jq -cn --arg parent "$expired_parent_id" --arg intent "$expired_intent_id" --arg binder "$expired_binder_id" '
  {tasks:[],failures:[{arn:("arn:aws:ecs:ap-southeast-1:311414082667:task/"+$parent),reason:"MISSING"},
    {arn:("arn:aws:ecs:ap-southeast-1:311414082667:task/"+$intent),reason:"MISSING"},
    {arn:("arn:aws:ecs:ap-southeast-1:311414082667:task/"+$binder),reason:"MISSING"}]}
')"
mixed_response="$(jq -cn --arg parent "$expired_parent" --arg intent "$expired_intent_id" '
  {tasks:[{taskArn:$parent}],failures:[{arn:("arn:aws:ecs:ap-southeast-1:311414082667:task/"+$intent),reason:"MISSING"}]}
')"
test "$(select_orphan_task_evidence uat "$retained_response" "$expired_parent_id" "$expired_intent_id" "$expired_binder_id")" = RETAINED_ECS_TASK
test "$(select_orphan_task_evidence uat "$expired_response" "$expired_parent_id" "$expired_intent_id" "$expired_binder_id")" = REVIEWED_EXPIRED_ECS_TASK
if select_orphan_task_evidence production "$expired_response" "$expired_parent_id" "$expired_intent_id" "$expired_binder_id" >/dev/null; then
  echo "ERROR: production accepted the UAT-only expired-task fallback" >&2
  exit 1
fi
if select_orphan_task_evidence uat "$mixed_response" "$expired_parent_id" "$expired_intent_id" "$expired_binder_id" >/dev/null; then
  echo "ERROR: mixed retained/MISSING task evidence selected a recovery path" >&2
  exit 1
fi
tampered_evidence="$fixture/tampered-expired-evidence.json"
jq '.githubRunId = "30760853051"' "$expired_evidence" > "$tampered_evidence"
if test "$(sha256sum "$tampered_evidence" | awk '{print $1}')" = "$expired_evidence_sha256"; then
  echo "ERROR: reviewed evidence hash pin accepted a modified manifest" >&2
  exit 1
fi

orphan_task_shape_safe() {
  jq -e --arg name release --arg startedBy watchdog-bms-prod-release --argjson exitCode 0 '
    .lastStatus == "STOPPED" and .startedBy == $startedBy
    and (.containers | length) == 1 and .containers[0].name == $name
    and .containers[0].exitCode == $exitCode
    and ((.enableExecuteCommand // false) == false)
    and ((.overrides.taskRoleArn // "") == "")
    and ((.overrides.executionRoleArn // "") == "")
    and all(.overrides.containerOverrides[]?;
      .name == $name and ((.command // []) | length) == 0
      and ((.environment // []) | length) == 0
      and ((.environmentFiles // []) | length) == 0)
  ' >/dev/null
}
orphan_task_fixture='{"lastStatus":"STOPPED","startedBy":"watchdog-bms-prod-release","containers":[{"name":"release","exitCode":0}],"overrides":{"containerOverrides":[{"name":"release"}]}}'
orphan_task_shape_safe <<< "$orphan_task_fixture"
for mutation in \
  '.enableExecuteCommand=true' \
  '.overrides.taskRoleArn="arn:aws:iam::311414082667:role/untrusted"' \
  '.overrides.executionRoleArn="arn:aws:iam::311414082667:role/untrusted"' \
  '.overrides.containerOverrides[0].environment=[{name:"NODE_OPTIONS",value:"--require /tmp/evil"}]'; do
  if jq -c "$mutation" <<< "$orphan_task_fixture" | orphan_task_shape_safe; then
    echo "ERROR: ORPHAN task evidence accepted runtime substitution: $mutation" >&2
    exit 1
  fi
done

orphan_definition_safe() {
  jq -e --arg name release --arg logGroup /ecs/watchdog-bms-release-task --arg region ap-southeast-1 '
    (.taskDefinition.containerDefinitions | length) == 1
    and ((.taskDefinition.containerDefinitions[0].entryPoint // []) | length) == 0
    and ((.taskDefinition.containerDefinitions[0].environmentFiles // []) | length) == 0
    and ((.taskDefinition.containerDefinitions[0].mountPoints // []) | length) == 0
    and ((.taskDefinition.containerDefinitions[0].volumesFrom // []) | length) == 0
    and ((.taskDefinition.containerDefinitions[0].repositoryCredentials // null) == null)
    and ((.taskDefinition.containerDefinitions[0].healthCheck // null) == null)
    and ((.taskDefinition.containerDefinitions[0].linuxParameters // null) == null)
    and .taskDefinition.containerDefinitions[0].logConfiguration.logDriver == "awslogs"
    and .taskDefinition.containerDefinitions[0].logConfiguration.options == {
      "awslogs-group":$logGroup,"awslogs-region":$region,"awslogs-stream-prefix":$name
    }
    and ((.taskDefinition.containerDefinitions[0].logConfiguration.secretOptions // []) | length) == 0
    and ((.taskDefinition.volumes // []) | length) == 0
    and ((.taskDefinition.proxyConfiguration // null) == null)
  ' >/dev/null
}
orphan_definition_fixture="$(jq -c '{taskDefinition:.}' "$release_task")"
orphan_definition_safe <<< "$orphan_definition_fixture"
for mutation in \
  '.taskDefinition.containerDefinitions[0].entryPoint=["/tmp/evil"]' \
  '.taskDefinition.containerDefinitions[0].environmentFiles=[{type:"s3",value:"arn:evil"}]' \
  '.taskDefinition.containerDefinitions[0].volumesFrom=[{sourceContainer:"evil"}]' \
  '.taskDefinition.containerDefinitions[0].repositoryCredentials={credentialsParameter:"arn:evil"}' \
  '.taskDefinition.containerDefinitions[0].healthCheck={command:["CMD-SHELL","/tmp/evil"]}' \
  '.taskDefinition.containerDefinitions[0].linuxParameters={tmpfs:[{containerPath:"/app",size:64}]}' \
  '.taskDefinition.containerDefinitions[0].logConfiguration.secretOptions=[{name:"awslogs-group",valueFrom:"arn:evil"}]' \
  '.taskDefinition.proxyConfiguration={type:"APPMESH",containerName:"release",properties:[]}' \
  '.taskDefinition.containerDefinitions[0].mountPoints=[{sourceVolume:"evil",containerPath:"/app"}] | .taskDefinition.volumes=[{name:"evil"}]'; do
  if jq -c "$mutation" <<< "$orphan_definition_fixture" | orphan_definition_safe; then
    echo "ERROR: ORPHAN task definition accepted code substitution: $mutation" >&2
    exit 1
  fi
done

parent_env_fixture="$(jq -c '.containerDefinitions[0].environment | map({key:.name,value:.value}) | from_entries' "$release_task")"
if test "$(jq -c '. + {NODE_OPTIONS:"--require /tmp/evil"} | keys | sort' <<< "$parent_env_fixture")" = "$orphan_parent_keys"; then
  echo "ERROR: ORPHAN exact environment schema accepted an executable extra key" >&2
  exit 1
fi
assert_release_task_rejected 'a binder without its parent operation' release-bind \
  "RELEASE_DEPLOYMENT_MANIFEST_JSON=$held_one"
assert_release_task_rejected 'a binder carrying more than one deployment' release-bind \
  "RELEASE_PARENT_OPERATION_ID=$parent_operation_id" \
  "RELEASE_MUTATION_INTENT_ID=$mutation_intent_id" \
  "RELEASE_DEPLOYMENT_MANIFEST_JSON=$held_full"
render_release_task 'a held release finalizer with repeated-service history' release-finalize \
  "RELEASE_PARENT_OPERATION_ID=$parent_operation_id" \
  "RELEASE_DEPLOYMENT_MANIFEST_JSON=$held_full" > "$held_task"
jq -e --arg parent "$parent_operation_id" --argjson manifest "$held_full" '
  .containerDefinitions[0].name == "release-finalize"
  and ([.containerDefinitions[0].environment[] | select(.name == "RELEASE_PARENT_OPERATION_ID") | .value] == [$parent])
  and ([.containerDefinitions[0].environment[] | select(.name == "RELEASE_OPERATION_DEPLOYMENT_MANIFEST") | .value][0] | fromjson) == $manifest
' "$held_task" >/dev/null
render_release_task 'a zero-api-intent recovery task' release-pre-intent-recover \
  "RELEASE_PARENT_OPERATION_ID=$parent_operation_id" \
  "RELEASE_RECOVERY_BUILD_RELEASE_ID=$allowed_sha" \
  "RELEASE_RECOVERY_VALIDATED_CI_RUN_ID=123456" \
  'RELEASE_RECOVERY_PARENT_TASK_EVIDENCE_JSON={"taskArn":"arn:aws:ecs:ap-southeast-1:311414082667:task/watchdog-bms-prod/task-a"}' > "$held_task"
jq -e --arg parent "$parent_operation_id" --arg target "$allowed_sha" '
  .containerDefinitions[0].name == "release-pre-intent-recover"
  and ([.containerDefinitions[0].environment[] | select(.name == "RELEASE_PARENT_OPERATION_ID") | .value] == [$parent])
  and ([.containerDefinitions[0].environment[] | select(.name == "RELEASE_RECOVERY_BUILD_RELEASE_ID") | .value] == [$target])
  and ([.containerDefinitions[0].environment[] | select(.name == "RELEASE_RECOVERY_VALIDATED_CI_RUN_ID") | .value] == ["123456"])
  and ([.containerDefinitions[0].environment[] | select(.name == "RELEASE_RECOVERY_PARENT_TASK_EVIDENCE_JSON") | .value][0] | fromjson | .taskArn) == "arn:aws:ecs:ap-southeast-1:311414082667:task/watchdog-bms-prod/task-a"
  and ([.containerDefinitions[0].environment[] | select(.name == "RELEASE_RECOVERY_EXECUTOR_IMAGE") | .value] | length) == 1
  and ([.containerDefinitions[0].environment[] | select(.name == "RELEASE_MUTATION_INTENT_ID")] == [])
  and ([.containerDefinitions[0].environment[] | select(.name == "RELEASE_OPERATION_COMMAND")] == [])
' "$held_task" >/dev/null
assert_release_task_rejected 'a normal release carrying recovery parent-task evidence' release \
  'RELEASE_RECOVERY_PARENT_TASK_EVIDENCE_JSON={"taskArn":"unexpected"}'
held_nine="$(jq -cn --argjson row "$held_record_one" '[range(0;9) | $row]')"
assert_release_task_rejected 'a finalizer carrying unbounded deployment history' release-finalize \
  "RELEASE_PARENT_OPERATION_ID=$parent_operation_id" \
  "RELEASE_DEPLOYMENT_MANIFEST_JSON=$held_nine"

# Non-api hotfixes still run migrations/admin sync, but must not attest an API build that never
# serves and therefore has no post-deploy launch-build retirement pass.
render_release_task 'an AI-only release' release 'RELEASE_DEPLOY_TARGET=ai-gateway' > "$held_task"
jq -e '
  ([.containerDefinitions[0].environment[] | select(.name == "RELEASE_DEPLOY_TARGET") | .value] == ["ai-gateway"])
  and ([.containerDefinitions[0].environment[] | select(.name == "RELEASE_OPERATION_COMMAND") | .value][0]
    | contains("prisma migrate deploy"))
  and (([.containerDefinitions[0].environment[] | select(.name == "RELEASE_OPERATION_COMMAND") | .value][0]
    | contains("sync-feature-launch-gates.ts")) | not)
' "$held_task" >/dev/null
assert_release_task_rejected 'an unknown deploy target' release 'RELEASE_DEPLOY_TARGET=unknown'

# UAT A5/F2 — PLAN and VERIFY execute directly as the dedicated SELECT-only reader with no task
# role; APPLY alone retains the durable writer wrapper. None can migrate/sync/attest a build.
f2_task="$fixture/f2-task.json"
f2_hash="$(printf 'f%.0s' {1..64})"
assert_f2_read_task_only_normalizer() {
  jq -e '
    .containerDefinitions[0].name == "f2"
    and (.taskRoleArn == null)
    and (.containerDefinitions[0].command[2] | contains("prisma/normalize-entitlements.ts"))
    and (.containerDefinitions[0].command[2] | contains("prisma migrate deploy") | not)
    and (.containerDefinitions[0].command[2] | test("sync-[a-z-]+\\.ts") | not)
    and (.containerDefinitions[0].command[2] | contains("run-exclusive-release-operation.ts") | not)
    and ([.containerDefinitions[0].environment[] | select(.name == "PGOPTIONS") | .value]
      == ["-c default_transaction_read_only=on"])
    and ([.containerDefinitions[0].environment[] | select(.name | startswith("F2_"))] == [])
    and ([.containerDefinitions[0].secrets[] | select(.name == "DATABASE_URL") | .valueFrom] as $secrets
      | ($secrets | length) == 1 and ($secrets[0] | contains("watchdog-bms/uat/a5-readonly-database-url-")))
  ' "$1" > /dev/null
}
render_release_task 'the F2 plan' f2-plan > "$f2_task"
assert_f2_read_task_only_normalizer "$f2_task"
jq -e '
  (.containerDefinitions[0].command[2] | contains("normalize-entitlements.ts --dry-run --allow-exceptions --require-read-only"))
' "$f2_task" > /dev/null
render_release_task 'the F2 verify' f2-verify > "$f2_task"
assert_f2_read_task_only_normalizer "$f2_task"
jq -e '
  (.containerDefinitions[0].command[2] | contains("normalize-entitlements.ts --verify --require-read-only"))
' "$f2_task" > /dev/null
# The write is bound to the reviewed ARTIFACT, not just its hash: the normalizer applies each
# company under the plan hash it was reviewed with (`--approved-plan`), so the approval unit has to
# reach the container. A Fargate task has no stdin, so it travels as an environment variable that the
# task command writes to a file.
f2_plan_json() {
  jq -cn --arg hash "${1:-$f2_hash}" --argjson ready "${2:-true}" \
    '{artifact:"f2-entitlement-normalization", normalizerVersion:1, approvalReady:$ready,
      aggregateHash:$hash, planHashes:{"company-1":"1111", "company-2":"2222"}}'
}
render_release_task 'the F2 apply' f2-apply "F2_APPROVED_HASH=$f2_hash" \
  "F2_APPROVED_PLAN_JSON=$(f2_plan_json)" > "$f2_task"
jq -e '
  .containerDefinitions[0].name == "f2"
  and (.taskRoleArn | type == "string")
  and (.containerDefinitions[0].command[2] | contains("run-exclusive-release-operation.ts"))
  and (([.containerDefinitions[0].environment[] | select(.name == "RELEASE_OPERATION_COMMAND") | .value][0])
    | contains("prisma/normalize-entitlements.ts"))
  and (([.containerDefinitions[0].environment[] | select(.name == "RELEASE_OPERATION_COMMAND") | .value][0])
    | contains("prisma migrate deploy") | not)
  and ([.containerDefinitions[0].secrets[] | select(.name == "DATABASE_URL") | .valueFrom] as $secrets
    | ($secrets | length) == 1 and ($secrets[0] | contains("watchdog-bms/uat/database-url-")))
' "$f2_task" >/dev/null
f2_preamble="printf '%s' \"\$F2_APPROVED_PLAN_JSON\" > /tmp/f2-approved-plan.json;"
jq -e --arg hash "$f2_hash" --arg plan "$(f2_plan_json)" --arg preamble "$f2_preamble" '
  (([.containerDefinitions[0].environment[] | select(.name == "RELEASE_OPERATION_COMMAND") | .value][0]) | contains("--approved-plan=/tmp/f2-approved-plan.json"))
  and (([.containerDefinitions[0].environment[] | select(.name == "RELEASE_OPERATION_COMMAND") | .value][0]) | contains($preamble))
  and ([.containerDefinitions[0].environment[] | select(.name == "F2_APPLY") | .value] == ["true"])
  and ([.containerDefinitions[0].environment[] | select(.name == "F2_APPROVED_HASH") | .value] == [$hash])
  and ([.containerDefinitions[0].environment[] | select(.name == "F2_APPROVED_PLAN_JSON") | .value] == [$plan])
' "$f2_task" > /dev/null
assert_release_task_rejected 'an F2 apply with no approved hash' f2-apply \
  "F2_APPROVED_PLAN_JSON=$(f2_plan_json)"
assert_release_task_rejected 'an F2 apply with a truncated approved hash' f2-apply \
  'F2_APPROVED_HASH=deadbeef' "F2_APPROVED_PLAN_JSON=$(f2_plan_json)"
assert_release_task_rejected 'an F2 apply with no reviewed plan artifact' f2-apply \
  "F2_APPROVED_HASH=$f2_hash"
# A plan whose PLAN had failures or dependency exceptions has no agreed final state to write.
assert_release_task_rejected 'an F2 apply bound to a plan that was never appliable' f2-apply \
  "F2_APPROVED_HASH=$f2_hash" "F2_APPROVED_PLAN_JSON=$(f2_plan_json "$f2_hash" false)"
# Handing the job a real artifact that is not the one the hash names must not write either.
assert_release_task_rejected 'an F2 apply whose plan and hash disagree' f2-apply \
  "F2_APPROVED_HASH=$f2_hash" "F2_APPROVED_PLAN_JSON=$(f2_plan_json "$(printf 'e%.0s' {1..64})")"
assert_release_task_rejected 'an F2 apply carrying something that is not an artifact' f2-apply \
  "F2_APPROVED_HASH=$f2_hash" 'F2_APPROVED_PLAN_JSON={"artifact":"nope"}'
# The MODE arms the writer, never an environment variable that could survive on a task definition.
assert_release_task_rejected 'F2_APPLY as an input' release 'F2_APPLY=true'
assert_release_task_rejected 'F2_VERIFY as an input' release 'F2_VERIFY=true'
assert_release_task_rejected 'an approved hash outside the f2-apply mode' release \
  "F2_APPROVED_HASH=$f2_hash"
assert_release_task_rejected 'an F2 plan carrying the writer secret' f2-plan \
  'DATABASE_URL_SECRET_ARN=arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/uat/database-url-aaaaaa'
assert_release_task_rejected 'an F2 verify carrying the writer secret' f2-verify \
  'DATABASE_URL_SECRET_ARN=arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/uat/database-url-aaaaaa'
assert_release_task_rejected 'an F2 plan targeting production before production A5 review' f2-plan \
  'DEPLOY_ENV=production'

a5_task="$fixture/a5-task.json"
render_release_task 'the A5 read-only precheck' a5-ro > "$a5_task"
jq -e '
  .taskRoleArn == null
  and .containerDefinitions[0].name == "a5-ro"
  and (.containerDefinitions[0].command[2] | contains("prisma/a5-readonly-evidence.ts"))
  and (.containerDefinitions[0].command[2] | contains("run-exclusive-release-operation.ts") | not)
  and ([.containerDefinitions[0].secrets[] | select(.name == "DATABASE_URL") | .valueFrom] as $secrets
    | ($secrets | length) == 1 and ($secrets[0] | contains("watchdog-bms/uat/a5-readonly-database-url-")))
' "$a5_task" >/dev/null
# The same exact read task is allowed from the APPLY controller for the mandatory fresh precheck.
render_release_task 'the fresh A5 apply precheck' a5-ro \
  'GITHUB_WORKFLOW_REF=example/watchdog/.github/workflows/f2-normalize-apply.yml@refs/heads/main' > "$a5_task"
jq -e '.containerDefinitions[0].name == "a5-ro" and .taskRoleArn == null' "$a5_task" >/dev/null

# Capacity is a direct, no-task-role UAT writer with fixed owner approval/marker inputs. It never
# inherits authority from another release mode and cannot target production.
capacity_task="$fixture/a5-capacity-task.json"
capacity_baseline_hash="$(printf 'f%.0s' {1..64})"
render_release_task 'the exact approved U5 capacity workload' a5-capacity \
  'U5_CAPACITY_MARKER=U5C-0123456789AB' \
  'U5_CAPACITY_APPROVAL_REF=owner-approved:2026-08-03:u5-c-v2' \
  "U5_CAPACITY_BASELINE_HASH=$capacity_baseline_hash" > "$capacity_task"
jq -e '
  .taskRoleArn == null
  and .containerDefinitions[0].name == "a5-capacity"
  and (.containerDefinitions[0].command[2] | contains("prisma/a5-capacity-mutating.ts run"))
  and (.containerDefinitions[0].command[2] | contains("run-exclusive-release-operation.ts") | not)
  and ([.containerDefinitions[0].secrets[] | select(.name == "DATABASE_URL") | .valueFrom] as $secrets
    | ($secrets | length) == 1 and ($secrets[0] | contains("watchdog-bms/uat/database-url-")))
  and ([.containerDefinitions[0].environment[] | select(.name == "DEPLOY_ENV") | .value] == ["uat"])
  and ([.containerDefinitions[0].environment[] | select(.name == "U5_CAPACITY_MARKER") | .value] == ["U5C-0123456789AB"])
  and ([.containerDefinitions[0].environment[] | select(.name == "U5_CAPACITY_APPROVAL_REF") | .value] == ["owner-approved:2026-08-03:u5-c-v2"])
  and ([.containerDefinitions[0].environment[] | select(.name == "U5_CAPACITY_BASELINE_HASH") | .value] == [$baseline])
' --arg baseline "$capacity_baseline_hash" "$capacity_task" >/dev/null
render_release_task 'the exact capacity cleanup' a5-capacity-cleanup \
  'U5_CAPACITY_MARKER=U5C-0123456789AB' \
  'U5_CAPACITY_APPROVAL_REF=owner-approved:2026-08-03:u5-c-v2' \
  "U5_CAPACITY_BASELINE_HASH=$capacity_baseline_hash" > "$capacity_task"
jq -e '.containerDefinitions[0].name == "a5-capacity-cleanup"
  and (.containerDefinitions[0].command[2] | contains("prisma/a5-capacity-mutating.ts cleanup"))
  and ([.containerDefinitions[0].environment[] | select(.name == "U5_CAPACITY_BASELINE_HASH") | .value] == [$baseline])' \
  --arg baseline "$capacity_baseline_hash" "$capacity_task" >/dev/null
assert_release_task_rejected 'capacity without an exact marker' a5-capacity \
  'U5_CAPACITY_APPROVAL_REF=owner-approved:2026-08-03:u5-c-v2' \
  "U5_CAPACITY_BASELINE_HASH=$capacity_baseline_hash"
assert_release_task_rejected 'capacity without the approved bounds reference' a5-capacity \
  'U5_CAPACITY_MARKER=U5C-0123456789AB' \
  "U5_CAPACITY_BASELINE_HASH=$capacity_baseline_hash"
assert_release_task_rejected 'capacity without the exact preflight baseline hash' a5-capacity \
  'U5_CAPACITY_MARKER=U5C-0123456789AB' \
  'U5_CAPACITY_APPROVAL_REF=owner-approved:2026-08-03:u5-c-v2'
assert_release_task_rejected 'capacity with a malformed preflight baseline hash' a5-capacity \
  'U5_CAPACITY_MARKER=U5C-0123456789AB' \
  'U5_CAPACITY_APPROVAL_REF=owner-approved:2026-08-03:u5-c-v2' \
  'U5_CAPACITY_BASELINE_HASH=deadbeef'
assert_release_task_rejected 'capacity authority attached to an ordinary release' release \
  'U5_CAPACITY_MARKER=U5C-0123456789AB' \
  'U5_CAPACITY_APPROVAL_REF=owner-approved:2026-08-03:u5-c-v2'
if env -u GITHUB_ACTIONS \
  DEPLOY_ENV=production AWS_ACCOUNT_ID=311414082667 RELEASE_TASK_RENDER_ONLY=true \
  DATABASE_URL_SECRET_ARN=arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/production/database-url-aaaaaa \
  U5_CAPACITY_MARKER=U5C-0123456789AB \
  U5_CAPACITY_APPROVAL_REF=owner-approved:2026-08-03:u5-c-v2 \
  bash "$repo_root/infra/prod-ecs-express/run-release-task.sh" \
    "311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@sha256:$(printf 'c%.0s' {1..64})" \
    "$allowed_sha" a5-capacity >/dev/null 2>&1; then
  echo "ERROR: A5 capacity accepted production" >&2
  exit 1
fi

# Bootstrap alone receives writer+reader credentials, runs directly without application AWS
# authority, and is structurally UAT-only. Secret creation itself lives in the separate UAT helper.
env -u GITHUB_ACTIONS \
  DEPLOY_ENV=uat \
  AWS_ACCOUNT_ID=311414082667 \
  DATABASE_URL_SECRET_ARN=arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/uat/database-url-aaaaaa \
  A5_READONLY_DATABASE_URL_SECRET_ARN=arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/uat/a5-readonly-database-url-aaaaaa \
  RELEASE_TASK_RENDER_ONLY=true \
  bash "$repo_root/infra/prod-ecs-express/run-release-task.sh" \
    "311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@sha256:$(printf 'c%.0s' {1..64})" \
    "$allowed_sha" a5-bootstrap > "$a5_task"
jq -e '
  .taskRoleArn == null
  and .containerDefinitions[0].name == "a5-bootstrap"
  and (.containerDefinitions[0].command[2] | contains("prisma/bootstrap-a5-readonly.ts"))
  and (.containerDefinitions[0].command[2] | contains("run-exclusive-release-operation.ts") | not)
  and ([.containerDefinitions[0].secrets[].name] | sort == ["A5_READONLY_DATABASE_URL","DATABASE_URL"])
' "$a5_task" >/dev/null
if env -u GITHUB_ACTIONS \
  DEPLOY_ENV=production AWS_ACCOUNT_ID=311414082667 RELEASE_TASK_RENDER_ONLY=true \
  bash "$repo_root/infra/prod-ecs-express/run-release-task.sh" \
    "311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@sha256:$(printf 'c%.0s' {1..64})" \
    "$allowed_sha" a5-bootstrap >/dev/null 2>&1; then
  echo "ERROR: A5 bootstrap accepted production" >&2
  exit 1
fi
assert_release_task_rejected 'an approved plan outside the f2-apply mode' release \
  "F2_APPROVED_PLAN_JSON=$(f2_plan_json)"
# A release plans and never writes, whatever the environment says.
render_release_task 'a release' release > "$f2_task"
jq -e '
  ([.containerDefinitions[0].environment[] | select(.name == "RELEASE_OPERATION_COMMAND") | .value][0]) | contains("normalize-entitlements.ts --dry-run")
' "$f2_task" > /dev/null

# Both deploy workflows: exact evidence, and finalization/retirement that runs on success AND failure.
for caller in "$deploy_workflow" "$uat_workflow"; do
  grep -Fq 'id: deploy-services' "$caller"
  grep -Fq 'if [ ! -f "$evidence" ]; then' "$caller"
  grep -Fq '${{ steps.deploy-services.outcome }}' "$caller"
  grep -Fq 'requires exact PRE_INTENT recovery after it becomes UNKNOWN' "$caller"
  missing_evidence_line="$(grep -n 'if \[ ! -f "$evidence" \]; then' "$caller" | tail -1 | cut -d: -f1)"
  retirement_evidence_line="$(grep -n 'validated="$(bash infra/prod-ecs-express/retirement-evidence.sh' "$caller" | tail -1 | cut -d: -f1)"
  test "$missing_evidence_line" -lt "$retirement_evidence_line"
  grep -Fq 'retirement-evidence.sh \' "$caller"
  grep -Fq -- '--file "$evidence" --service-arn "$arn" --source-sha "$SOURCE_SHA" \' "$caller"
  grep -Fq -- '--target-revision-arn "$target_revision_arn" "${legacy_args[@]}")"' "$caller"
  grep -Fq 'legacy_args=(--legacy-descriptor-file "$DEPLOYMENT_EVIDENCE_DIR/legacy-api-web.json")' "$caller"
  # Exit 75 is blocking: the held parent must remain unresolved until exact operator reconciliation.
  grep -Fq 'if [ "$rc" -eq 75 ]; then' "$caller"
  grep -Fq 'held release operation remains unresolved' "$caller"
  if [ "$caller" = "$deploy_workflow" ]; then
    grep -Fq "steps.production-target.outputs.release_mode != 'maintenance-bootstrap'" "$caller"
    grep -Fq "(steps.production-target.outputs.target == 'all' || steps.production-target.outputs.target == 'api-web')" "$caller"
  else
    grep -Fq "if: always() && (steps.target.outputs.target == 'all' || steps.target.outputs.target == 'api-web')" "$caller"
  fi
  if [ "$caller" = "$deploy_workflow" ]; then
    grep -Fq "HEALTH_VERIFIED: \${{ steps.verify-health.outcome == 'success'" "$caller"
    grep -Fq "inputs.maintenance_only && steps.verify-maintenance.outcome == 'success'" "$caller"
    grep -Fq "steps.unquiesce.outcome == 'success'" "$caller"
  else
    grep -Fq "HEALTH_VERIFIED: \${{ steps.verify-health.outcome == 'success' }}" "$caller"
  fi
  grep -Fq '[ "$HEALTH_VERIFIED" = "true" ] || mode=reconcile' "$caller"
  grep -Fq 'id: verify-health' "$caller"
  if [ "$caller" = "$deploy_workflow" ]; then
    grep -Fq 'evidence_dir="$RUNNER_TEMP/watchdog-bms-deployment-${GITHUB_RUN_ID}"' "$caller"
    grep -Fq 'echo "DEPLOYMENT_EVIDENCE_DIR=$evidence_dir" >> "$GITHUB_ENV"' "$caller"
  else
    grep -Fq 'DEPLOYMENT_EVIDENCE_DIR=$RUNNER_TEMP/watchdog-bms-deployment-${GITHUB_RUN_ID}' "$caller"
  fi
  if grep -Fq 'DEPLOYMENT_EVIDENCE_DIR: ${{ runner.temp }}' "$caller"; then
    echo "ERROR: job-level env cannot use the runner context" >&2
    exit 1
  fi
  grep -Fq 'RETIRE_DEPLOYMENT_ARN="$deployment_arn"' "$caller"
  grep -Fq 'RETIRE_SERVICE_ARN="$arn"' "$caller"
  grep -Fq 'RETIRE_TARGET_REVISION_ARN="$target_revision_arn"' "$caller"
  grep -Fq 'evidence_files=("$DEPLOYMENT_EVIDENCE_DIR/history"/*.json)' "$caller"
  grep -Fq 'RELEASE_DEPLOYMENT_MANIFEST_JSON="$(jq -cs' "$caller"
  grep -Fq 'sort_by([.service, (.deploymentArn // ""), .targetRevisionArn])' "$caller"
  grep -Fq 'release-finalize' "$caller"
  if [ "$caller" = "$deploy_workflow" ]; then
    grep -Fq 'RELEASE_DEPLOY_TARGET: ${{ steps.production-target.outputs.target }}' "$caller"
  else
    grep -Fq 'RELEASE_DEPLOY_TARGET: ${{ steps.target.outputs.target }}' "$caller"
  fi
  if grep -Fq "flatten | unique | join" "$caller"; then
    echo "ERROR: deploy workflow still derives active builds with the lossy flatten" >&2
    exit 1
  fi
done

# ── UAT r7 item 2: the F2 write is a SECOND human dispatch, not a second environment gate ──────────
# The uat and production GitHub environments carry no required reviewers, so a job-level environment
# gate after the dry run never pauses: one dispatch planned and then wrote in the same run. PLAN and
# APPLY are therefore separate workflow_dispatch entry points, and APPLY takes the approved hash out
# of the named plan run's artifact instead of from the operator's clipboard.
f2_plan_workflow="$repo_root/.github/workflows/f2-normalize.yml"
f2_apply_workflow="$repo_root/.github/workflows/f2-normalize-apply.yml"
f2_normalizer_cli="$repo_root/apps/api/prisma/normalize-entitlements.ts"
workflow_inputs() {
  awk '/^    inputs:/{found=1; next} found && /^[^ ]/{exit} found' "$1"
}
for f2_workflow in "$f2_plan_workflow" "$f2_apply_workflow"; do
  # UAT r7 item 3 — the same concurrency group string the deploy workflows use per environment
  # (watchdog-bms-uat-deploy / watchdog-bms-production-deploy); GitHub serialises only exact matches.
  grep -Fq 'group: watchdog-bms-${{ inputs.environment }}-deploy' "$f2_workflow"
  grep -Fq 'cancel-in-progress: false' "$f2_workflow"
  grep -Fq 'test "$GITHUB_REF" = "refs/heads/main"' "$f2_workflow"
  grep -Fq 'branch=develop' "$f2_workflow"
  grep -Fq 'git merge-base --is-ancestor' "$f2_workflow"
  grep -Fq 'sigstore/cosign-installer@6f9f17788090df1f26f669e9d70d6ae9567deba6' "$f2_workflow"
  grep -Fq 'signer_workflow=deploy-production.yml' "$f2_workflow"
  grep -Fq '[ "$DEPLOY_ENV" = uat ] && signer_workflow=deploy-uat.yml' "$f2_workflow"
  grep -Fq -- '--certificate-identity "https://github.com/${GITHUB_REPOSITORY}/.github/workflows/${signer_workflow}@refs/heads/main"' "$f2_workflow"
  if grep -Fq -- '--certificate-identity-regexp' "$f2_workflow"; then
    echo "ERROR: F2 accepts a cross-environment release-image signer" >&2
    exit 1
  fi
  if grep -Eq 'uses: .+@(main|v[0-9]+)$' "$f2_workflow"; then
    echo "ERROR: F2 workflow contains a mutable action reference" >&2
    exit 1
  fi
  # The Go template is already inside shell single quotes. A backslash before its inner quotes is
  # passed literally to Docker and makes `docker inspect --format` fail to parse.
  grep -Fq "docker inspect --format '{{ index .Config.Labels \"org.opencontainers.image.revision\" }}'" "$f2_workflow"
  if grep -Fq '\"org.opencontainers.image.revision\"' "$f2_workflow"; then
    echo "ERROR: F2 docker-inspect Go template contains literal backslash quotes" >&2
    exit 1
  fi
done
grep -Fq 'group: watchdog-bms-production-deploy' "$deploy_workflow"
grep -Fq 'group: watchdog-bms-uat-deploy' "$uat_workflow"
grep -Fq 'run-release-task.sh "$RELEASE_IMAGE" "$RELEASE_REF" f2-plan' "$f2_plan_workflow"
grep -Fq 'run-release-task.sh "$RELEASE_IMAGE" "$RELEASE_REF" a5-ro' "$f2_plan_workflow"
grep -Fq 'aws ecr describe-images' "$f2_plan_workflow"
grep -Fq 'name: f2-plan-${{ inputs.environment }}' "$f2_plan_workflow"
# The plan artifact is the reviewable object: per-company hashes, the aggregate, and the summary.
grep -Fq 'companyPlanHashes:' "$f2_plan_workflow"
grep -Fq 'aggregateHash: $plan.aggregateHash' "$f2_plan_workflow"
grep -Fq 'summary:' "$f2_plan_workflow"
grep -Fq 'cohortCounts: $plan.cohortCounts' "$f2_plan_workflow"
grep -Fq 'unresolvedCohorts: $plan.unresolvedCohorts' "$f2_plan_workflow"
grep -Fq 'orphanRows: $plan.orphanRows' "$f2_plan_workflow"
grep -Fq '.unresolvedCohorts == .cohortCounts.UNRESOLVED' "$f2_plan_workflow"
grep -Fq '.approvalReady == ((.failed == 0)' "$f2_plan_workflow"
grep -Fq 'cohortKind, cohortEvidence' "$f2_plan_workflow"
grep -Fq 'provenanceStamped, orphansRemoved' "$f2_plan_workflow"
grep -Fq 'cohortKind: company.cohortKind' "$f2_normalizer_cli"
grep -Fq 'cohortEvidence: company.cohortEvidence' "$f2_normalizer_cli"
grep -Fq 'orphanRows: company.orphanRows' "$f2_normalizer_cli"
grep -Fq '&& result.unresolvedCohorts === 0' "$f2_normalizer_cli"
grep -Fq 'result.unresolvedCohorts !== cohortCounts.UNRESOLVED' "$f2_normalizer_cli"
grep -Fq 'f2-artifact/f2-plan.json' "$f2_plan_workflow"
grep -Fq 'controllerSha: $controllerSha' "$f2_plan_workflow"
grep -Fq 'planActorId: $actorId' "$f2_plan_workflow"
grep -Fq 'schemaVersion: 2' "$f2_plan_workflow"
grep -Fq 'a5: $a5Evidence' "$f2_plan_workflow"
grep -Fq 'del(.generatedAt,.evidenceHash)' "$f2_plan_workflow"
grep -Fq '.f2PrecheckReady' "$f2_plan_workflow"
grep -Fq 'name: Re-pin PLAN after A5 collection' "$f2_plan_workflow"
grep -Fq 'A5/F2 is locked to isolated UAT' "$f2_plan_workflow"
grep -Fq 'org.opencontainers.image.revision' "$f2_plan_workflow"
if grep -Eq 'F2_APPLY|F2_APPROVED_HASH|f2-apply' "$f2_plan_workflow"; then
  echo "ERROR: the F2 plan dispatch can reach the writer" >&2
  exit 1
fi
if grep -Eq '^  apply:' "$f2_plan_workflow"; then
  echo "ERROR: the F2 plan workflow still carries an apply job" >&2
  exit 1
fi
if grep -Eq 'apply:$' <<< "$(workflow_inputs "$f2_plan_workflow")"; then
  echo "ERROR: the F2 plan dispatch still takes an apply toggle" >&2
  exit 1
fi
# Exact orphan feature keys stay in the downloadable full normalizer artifact. The GitHub summary
# exposes only the count, because step summaries are much more broadly visible and retained.
f2_summary_step="$(awk '/- name: Summarize the plan for the reviewer/{found=1} found {print} /- uses: actions\/upload-artifact/{exit}' "$f2_plan_workflow")"
grep -Fq '.summary.orphanRows' <<< "$f2_summary_step"
if grep -Eq 'featureKey|\.normalizer|orphanRows\[\]' <<< "$f2_summary_step"; then
  echo "ERROR: the F2 GitHub summary exposes exact orphan feature keys" >&2
  exit 1
fi
grep -Fq 'run-release-task.sh "$RELEASE_IMAGE" "$RELEASE_REF" f2-apply' "$f2_apply_workflow"
grep -Fq 'run-release-task.sh "$RELEASE_IMAGE" "$RELEASE_REF" f2-verify' "$f2_apply_workflow"
grep -Fq 'run-release-task.sh "$RELEASE_IMAGE" "$RELEASE_REF" a5-ro' "$f2_apply_workflow"
grep -Fq '.schemaVersion == 2' "$f2_apply_workflow"
grep -Fq '.a5.sourceCommit == $sha' "$f2_apply_workflow"
grep -Fq '.queryCatalogHash == $catalog' "$f2_apply_workflow"
grep -Fq 'del(.generatedAt,.evidenceHash)' "$f2_apply_workflow"
grep -Fq 'A5/F2 is locked to isolated UAT' "$f2_apply_workflow"
fresh_a5_line="$(grep -n 'name: Refresh the zero-write A5 precheck before the writer' "$f2_apply_workflow" | cut -d: -f1)"
repin_a5_line="$(grep -n 'name: Re-pin APPLY after the fresh A5 precheck' "$f2_apply_workflow" | cut -d: -f1)"
f2_writer_line="$(grep -n 'name: Apply the reviewed plan' "$f2_apply_workflow" | cut -d: -f1)"
f2_verify_line="$(grep -n 'name: Verify the estate independently' "$f2_apply_workflow" | cut -d: -f1)"
final_a5_line="$(grep -n 'name: Re-check A5 and WHT after the writer' "$f2_apply_workflow" | cut -d: -f1)"
test "$fresh_a5_line" -lt "$f2_writer_line"
test "$fresh_a5_line" -lt "$repin_a5_line"
test "$repin_a5_line" -lt "$f2_writer_line"
test "$f2_writer_line" -lt "$f2_verify_line"
test "$f2_verify_line" -lt "$final_a5_line"
grep -Fq 'and .launchHealth.wht50Bis.open == 0' "$f2_apply_workflow"
grep -Fq 'a5-readonly-evidence-final.json' "$f2_apply_workflow"
grep -Fq "if: always() && steps.apply.outcome != 'skipped'" "$f2_apply_workflow"
grep -Fq 'name: f2-plan-${{ inputs.environment }}' "$f2_apply_workflow"
grep -Fq 'run-id: ${{ inputs.plan_run_id }}' "$f2_apply_workflow"
grep -Fq 'github-token: ${{ github.token }}' "$f2_apply_workflow"
grep -Fq 'F2_APPROVED_HASH: ${{ steps.plan.outputs.aggregate_hash }}' "$f2_apply_workflow"
grep -Fq 'aggregate_hash="$(jq -r ' "$f2_apply_workflow"
# The apply hands the reviewed approval unit back to the normalizer, and refuses a plan that was
# never appliable before a task is ever started.
grep -Fq 'F2_APPROVED_PLAN_JSON="$(cat "$RUNNER_TEMP/f2-approved-plan.json")"' "$f2_apply_workflow"
grep -Fq '.approval.approvalReady' "$f2_apply_workflow"
grep -Fq 'approval: {' "$f2_plan_workflow"
grep -Fq 'planHashes: $plan.planHashes' "$f2_plan_workflow"
grep -Fq 'actions/runs/$PLAN_RUN_ID' "$f2_apply_workflow"
grep -Fq '.actor.id | tostring' "$f2_apply_workflow"
grep -Fq 'expected_workflow_ref=' "$f2_apply_workflow"
grep -Fq 'the F2 controller changed after PLAN; re-plan before applying' "$f2_apply_workflow"
grep -Fq 'org.opencontainers.image.revision' "$f2_apply_workflow"
f2_apply_inputs="$(workflow_inputs "$f2_apply_workflow")"
grep -Fq 'environment:' <<< "$f2_apply_inputs"
grep -Fq 'plan_run_id:' <<< "$f2_apply_inputs"
# The operator names a plan; they never retype a hash, a commit, an image or an apply toggle.
if grep -Eq 'hash|release_ref|release_image|apply:' <<< "$f2_apply_inputs"; then
  echo "ERROR: the F2 apply dispatch takes a value the operator would have to copy by hand" >&2
  exit 1
fi

bash -n "$resolver"
bash -n "$uat_deploy"
bash -n "$repo_root/infra/uat/lib-runtime-mutex.sh"
bash -n "$repo_root/infra/prod-ecs-express/deploy.sh"
bash -n "$repo_root/infra/prod-ecs-express/run-release-task.sh"
bash "$repo_root/infra/prod-ecs-express/run-task-idempotently.spec.sh"
bash "$repo_root/infra/prod-ecs-express/register-task-definition-with-retry.spec.sh"
bash "$repo_root/infra/prod-ecs-express/cleanup-one-shot-task.spec.sh"
bash "$repo_root/infra/prod-ecs-express/release-task-network-failover.spec.sh"
bash "$repo_root/infra/prod-ecs-express/production-ready-release-task.spec.sh"
bash "$repo_root/infra/prod-ecs-express/bounded-http-retry.spec.sh"
bash -n "$repo_root/infra/prod-ecs-express/active-release-tasks.sh"
bash -n "$repo_root/infra/prod-ecs-express/bind-express-create.sh"
bash -n "$repo_root/infra/prod-ecs-express/bind-express-deployment.sh"
bash -n "$repo_root/infra/prod-ecs-express/verify-express-noop.sh"
bash -n "$repo_root/infra/prod-ecs-express/retirement-evidence.sh"
bash -n "$repo_root/infra/prod-ecs-express/verify-deployment.sh"
bash -n "$repo_root/infra/prod-ecs-express/lib-wait-for-service-url.sh"
bash -n "$repo_root/infra/uat/setup-control-plane.sh"
bash -n "$repo_root/infra/uat/bootstrap-data.sh"
bash -n "$repo_root/infra/uat/bootstrap-a5-readonly.sh"
grep -Fq -- '--secret-string "file://${secret_file}"' "$repo_root/infra/uat/bootstrap-a5-readonly.sh"
grep -Fq 'readonly_description="UAT-only SELECT credential for A5/F2 read paths"' "$repo_root/infra/uat/bootstrap-a5-readonly.sh"
grep -Fq -- "--query '{arn:ARN,description:Description}'" "$repo_root/infra/uat/bootstrap-a5-readonly.sh"
grep -Fq 'UAT A5 secret description mismatch' "$repo_root/infra/uat/bootstrap-a5-readonly.sh"
grep -Fq 'docker_config_dir="$(mktemp -d ' "$repo_root/infra/uat/bootstrap-a5-readonly.sh"
bash "$repo_root/infra/uat/bootstrap-a5-readonly.spec.sh"
grep -Fq 'org.opencontainers.image.revision' "$repo_root/infra/uat/bootstrap-a5-readonly.sh"
grep -Fq 'git fetch --quiet origin develop --force' "$repo_root/infra/uat/bootstrap-a5-readonly.sh"
grep -Fq 'verify-serving-api-build.sh" uat "$commit"' "$repo_root/infra/uat/bootstrap-a5-readonly.sh"
grep -Fq 'cosign verify' "$repo_root/infra/uat/bootstrap-a5-readonly.sh"
grep -Fq 'deploy-uat.yml@refs/heads/main' "$repo_root/infra/uat/bootstrap-a5-readonly.sh"
grep -Fq 'DOCKER_CONFIG="$docker_config_dir" docker login --username AWS' "$repo_root/infra/uat/bootstrap-a5-readonly.sh"
grep -Fq 'DOCKER_CONFIG="$docker_config_dir" docker pull --platform' "$repo_root/infra/uat/bootstrap-a5-readonly.sh"
grep -Fq 'DOCKER_CONFIG="$docker_config_dir" docker inspect --format' "$repo_root/infra/uat/bootstrap-a5-readonly.sh"
bootstrap_login_line="$(grep -n 'DOCKER_CONFIG="$docker_config_dir" docker login --username AWS' "$repo_root/infra/uat/bootstrap-a5-readonly.sh" | cut -d: -f1)"
bootstrap_cosign_line="$(grep -n 'cosign verify' "$repo_root/infra/uat/bootstrap-a5-readonly.sh" | cut -d: -f1)"
bootstrap_pull_line="$(grep -n 'docker pull --platform' "$repo_root/infra/uat/bootstrap-a5-readonly.sh" | cut -d: -f1)"
test "$bootstrap_login_line" -lt "$bootstrap_cosign_line"
test "$bootstrap_cosign_line" -lt "$bootstrap_pull_line"
if grep -Fq -- '--secret-string "$readonly_url"' "$repo_root/infra/uat/bootstrap-a5-readonly.sh"; then
  echo "ERROR: A5 bootstrap exposes its database URL in the AWS CLI process arguments" >&2
  exit 1
fi
if grep -Eq -- '--tags|tag-resource' "$repo_root/infra/uat/bootstrap-a5-readonly.sh"; then
  echo "ERROR: A5 bootstrap depends on non-authoritative Secrets Manager tags" >&2
  exit 1
fi
bootstrap_identity_line="$(grep -n 'UAT A5 secret identity mismatch' "$repo_root/infra/uat/bootstrap-a5-readonly.sh" | head -1 | cut -d: -f1)"
bootstrap_description_line="$(grep -n 'UAT A5 secret description mismatch' "$repo_root/infra/uat/bootstrap-a5-readonly.sh" | cut -d: -f1)"
bootstrap_release_line="$(grep -n 'run-release-task.sh' "$repo_root/infra/uat/bootstrap-a5-readonly.sh" | cut -d: -f1)"
test "$bootstrap_identity_line" -lt "$bootstrap_release_line"
test "$bootstrap_description_line" -lt "$bootstrap_release_line"
bash -n "$repo_root/infra/uat/m01-actor-delegation-alert.sh"
bash -n "$repo_root/infra/ai-gateway/build-agentcore-artifact.sh"
rollout_guard_output=""
rollout_guard_code=0
rollout_guard_output="$(DEPLOY_ENV=uat ECS_CLUSTER_NAME=watchdog-bms-uat \
  bash "$repo_root/infra/prod-ecs-express/deploy.sh" api-web 2>&1)" || rollout_guard_code=$?
if [ "$rollout_guard_code" -ne 2 ] \
  || ! grep -Fq 'service rollout requires RELEASE_PARENT_OPERATION_ID' <<< "$rollout_guard_output"; then
  echo "ERROR: service rollout was not rejected before AWS without its durable release parent" >&2
  exit 1
fi
if DEPLOY_ENV=preview bash "$repo_root/infra/prod-ecs-express/deploy.sh" all >/dev/null 2>&1; then
  echo "ERROR: deploy script accepted an unknown environment" >&2
  exit 1
fi
if CONFIRM_UAT_COST=no bash "$repo_root/infra/uat/bootstrap-data.sh" >/dev/null 2>&1; then
  echo "ERROR: UAT data bootstrap bypassed its cost confirmation gate" >&2
  exit 1
fi

manifest="$fixture/production-image-manifest.json"
jq -n \
  --arg sourceCommit "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" \
  --arg registry "311414082667.dkr.ecr.ap-southeast-1.amazonaws.com" \
  '{
    schemaVersion: 1,
    sourceCommit: $sourceCommit,
    images: [
      {service:"api-web",repository:"watchdog-bms-api"},
      {service:"ai-gateway",repository:"watchdog-bms-ai-gateway"},
      {service:"workers",repository:"watchdog-bms-workers"}
    ] | map(. + {
      sourceCommit: $sourceCommit,
      digest: ("sha256:" + ("b" * 64)),
      image: ($registry + "/" + .repository + "@sha256:" + ("b" * 64))
    })
  }' > "$manifest"
test "$(bash "$repo_root/infra/docker/validate-production-manifest.sh" "$manifest" 311414082667 ap-southeast-1)" = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
if bash "$repo_root/infra/docker/validate-production-manifest.sh" "$manifest" 999999999999 ap-southeast-1 >/dev/null 2>&1; then
  echo "ERROR: manifest validator accepted the wrong AWS account" >&2
  exit 1
fi
grep -Fq 'PRODUCTION_IMAGE_MANIFEST' "$repo_root/infra/prod-ecs-express/deploy.sh"

capacity_wrapper="$repo_root/infra/uat/run-a5-capacity-mutating.sh"
bash -n "$capacity_wrapper"
grep -Fq "expected_approval='owner-approved:2026-08-03:u5-c-v2'" "$capacity_wrapper"
grep -Fq "attempt_parameter='/watchdog-bms/uat/evidence/u5-capacity-v2'" "$capacity_wrapper"
grep -Fq -- '--no-overwrite' "$capacity_wrapper"
grep -Fq 'a5-capacity-cleanup' "$capacity_wrapper"
grep -Fq 'cleanup_verified' "$capacity_wrapper"
grep -Fq 'workers intentionally remain paused' "$capacity_wrapper"
grep -Fq 'CPUUtilization' "$capacity_wrapper"
grep -Fq 'high_cpu_samples' "$capacity_wrapper"
if grep -Fq 'DEPLOY_ENV=production' "$capacity_wrapper"; then
  echo "ERROR: U5 capacity wrapper contains a production execution path" >&2
  exit 1
fi

bash "$repo_root/infra/prod-ecs-express/list-service-deployments-all.spec.sh"
bash "$repo_root/infra/prod-ecs-express/release-safety.spec.sh"
bash "$repo_root/infra/uat/select-deploy-target.spec.sh"
bash "$repo_root/infra/prod-ecs-express/uat-fast-rollout.spec.sh"
bash "$repo_root/infra/prod-ecs-express/prod-rollout-config.spec.sh"
bash "$repo_root/infra/uat/fast-selective-workflow.spec.sh"
bash "$repo_root/infra/uat/verify-deploy-readiness.spec.sh"
bash "$repo_root/infra/docker/production-fast-promotion.spec.sh"
bash "$repo_root/infra/security/uat-release-passport-v2.spec.sh"
bash "$repo_root/infra/security/production-a5-readonly-bootstrap.spec.sh"
bash "$repo_root/infra/security/production-promotion-bootstrap.spec.sh"
bash "$repo_root/infra/security/production-promotion-resources.spec.sh"
bash "$repo_root/infra/security/production-migration-catalog-readiness.spec.sh"
bash "$repo_root/infra/security/production-runtime-readiness-v2.spec.sh"
bash "$repo_root/infra/security/production-release-ready-v2.spec.sh"
bash "$repo_root/infra/security/production-ready-baseline-v2.spec.sh"
bash "$repo_root/infra/security/production-a5-stage-context-producer.spec.sh"
bash "$repo_root/infra/security/signed-evidence.spec.sh"
bash "$repo_root/infra/ai-gateway/h15-trust-boundary.spec.sh"
bash -c 'node "$1"' _ "$repo_root/infra/cloudflare/mangmee-host-proxy.worker.spec.mjs"
bash "$repo_root/infra/security/production-a5-private-network.spec.sh"
bash "$repo_root/infra/security/production-a5-clone-bootstrap.spec.sh"
bash "$repo_root/infra/security/production-a5-clone-runner.spec.sh"
bash "$repo_root/infra/security/production-a5-readonly-runner.spec.sh"
bash "$repo_root/infra/security/production-a5-apply-runner.spec.sh"
bash "$repo_root/infra/security/production-a5-clone-workflow.spec.sh"
bash "$repo_root/infra/security/production-readiness-workflow-v2.spec.sh"
bash "$repo_root/infra/security/production-release-prepare-wait.spec.sh"
bash "$repo_root/infra/security/production-deploy-workflow-v2.spec.sh"
bash "$repo_root/infra/security/production-release-result-v2.spec.sh"
bash "$repo_root/infra/security/production-security-preflight.spec.sh"
pnpm --filter @watchdog-bms/api exec tsx --test \
  prisma/verify-applied-migration-catalog.spec.ts \
  prisma/verify-production-ready-migration.spec.ts \
  prisma/production-a5/run-clone-rehearsal.spec.ts \
  prisma/production-a5/run-production-apply.spec.ts

echo "production image security scanner: pass"
