# Agent Memory: Production deploy workflow

Status: Activated with `main` as the production release authority; one manual production workflow smoke remains pending explicit deployment authorization.
Owner: Platform/Security release owner.
Scope: GitHub Actions orchestration, reusable CI source binding, exact-commit release task, ECS Express manifest deployment, post-deploy verification, and deploy-role templates.
Decisions:
- `Production Deploy` accepts only a `release-*` tag or lowercase full SHA reachable from `origin/main`, and supports `all`, `api-web`, `ai-gateway`, and `workers`. Both tags and raw SHAs must satisfy the ancestry check.
- Every run rebuilds and republishes all three runtime images through the existing CI gates; target selection limits the live ECS services changed, not verification coverage.
- The release task always runs first and is bound to the same full commit and exact ECR digest. It runs as `node`, has no task role, receives only `DATABASE_URL`, and must exit `0` before deploy.
- Runtime deployment consumes only the validated CI manifest. The final gate compares active image digest and `GIT_SHA`, then checks service health.
- All third-party actions reachable from the production workflow are pinned to full commit SHAs; mutable major tags and `main` are rejected by the security spec.
- Image publication keeps `AWS_ROLE_ARN`; live deployment uses separate `AWS_DEPLOY_ROLE_ARN`. The deploy role cannot mutate IAM. Existing non-secret runtime configuration is preserved from active ECS unless GitHub environment variables explicitly override it.
- Production deployment concurrency is global and non-cancelling; a second manual run queues instead of interrupting a release.
- The GitHub `production` environment allows `main`, `develop`, and `release-*`; `main` is the recommended workflow source, while the release resolver prevents either branch context from deploying code outside `main`.
Open questions:
- Run one manual smoke against the current commit and a non-disruptive target, then retain the workflow URL and release-task/task/deployment evidence.
Artifacts:
- `.github/workflows/deploy-production.yml`
- `.github/workflows/ci.yml`
- `infra/docker/resolve-production-release-ref.sh`
- `infra/prod-ecs-express/run-release-task.sh`
- `infra/prod-ecs-express/verify-deployment.sh`
- `infra/prod-ecs-express/github-deploy-role-{trust,policy}.template.json`
- `infra/prod-ecs-express/README.md`
Verification:
- Production image security spec passes and covers allowed/non-ancestor/invalid release refs, including a `release-*` tag outside the allowed branch, plus the rendered no-task-role, node-user, one-secret release task contract.
- `actionlint`, shell syntax, workflow YAML parsing, IAM JSON parsing, scoped `git diff --check`, pinned-action and reusable CI/source-manifest assertions pass.
- AWS role `arn:aws:iam::311414082667:role/watchdog-bms-deploy-production` was created from the checked-in templates. `GetRole` confirms the exact GitHub OIDC `aud` and `production` environment `sub`; `GetRolePolicy` succeeds and its canonical JSON exactly matches the checked-in policy template.
- GitHub environment `production` has `AWS_DEPLOY_ROLE_ARN=arn:aws:iam::311414082667:role/watchdog-bms-deploy-production`.
- GitHub environment branch policy includes `main` (rule `55107977`) alongside the existing `develop` and `release-*` rules.
- Promotion PR #22 merged `develop` into `main` at `8c42afc9c72738c973b931ac2d1090a1b15fb185`. GitHub registers `Production Deploy` as active, and post-merge CI run `29724992759` passes.
Next: Choose `main` in **Use workflow from**; configure UAT as a separate environment, and run the first manual production smoke only when explicitly authorized.
