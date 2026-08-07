# WatchDog-BMS UAT

UAT uses the production-grade images and checks, but isolated AWS state. It never copies production data. The current acceptance cycle has an owner-approved temporary copy of production LINE values in the UAT secret namespace; replace production LINE credentials after acceptance.

## Release flow

1. Bootstrap only the neutral controller files listed in
   `infra/uat/neutral-main-bootstrap-files.txt` into `main`; choose `main` in
   **Use workflow from**. The shared CI controller is included because `deploy-uat` calls it, while
   the allow-list intentionally excludes production deployment and app code.
2. Enter a lowercase full SHA or `uat-*` tag reachable from `develop`.
3. Select `all`, `api-web`, `ai-gateway`, or `workers`. For an actor-delegation acceptance run,
   select `all` and enable `run_m01_acceptance`; the default is off for ordinary/hotfix deploys.
4. `UAT Deploy` tests and publishes immutable digests/SBOMs, migrates the UAT database, deploys, and verifies health.
5. After acceptance, merge the same commit to `main`; production still rejects commits outside `main`.

The controller runs from `main`, but it does not execute `main` application scripts: it resolves a
full SHA reachable from `develop`, checks out that exact detached commit, rechecks ancestry,
and only then runs CI, release, lease/bind/finalize and deployment scripts from that checkout. The
shared CI workflow receives that full SHA as its required `source_ref`; its resolver and every build/
test/publish job check out the resolved SHA (or verify an exact successful push-CI run for it), never
the controller's `main` application tree. The
same neutral bootstrap also makes the two F2 PLAN/APPLY controllers dispatchable; it does not promote
the UAT application commit or copy `.github/workflows/deploy-production.yml`/`apps/**` into `main`.

## One-time control plane

Create UAT-only GitHub OIDC and ECS runtime roles:

```sh
AWS_PROFILE=watchdog-bedrock AWS_SDK_LOAD_CONFIG=1 \
  bash infra/uat/setup-control-plane.sh
```

For the one audited upgrade case where `watchdog-bms-deploy-uat` exists but the dedicated
`watchdog-bms-uat-release-task-role` is absent and the operator cannot yet read the two inline
policies, run the explicit bridge once:

```sh
UAT_IAM_BOOTSTRAP_APPLY_UNVERIFIED=true \
AWS_PROFILE=watchdog-bedrock AWS_SDK_LOAD_CONFIG=1 \
  bash infra/uat/setup-control-plane.sh
```

It may create only that missing role with the exact ECS-task trust and write only the two named
deploy/release policies. Exit `75` with `APPLIED_BUT_UNVERIFIED` is expected. Do not deploy from the
workstation; the next `UAT Deploy` controller must exact-readback both policies before its first
environment mutation. Any other missing role, trust drift, `AccessDenied`, or partial write is an
operator/admin stop condition rather than permission to broaden the bootstrap.

Create the GitHub `uat` environment, restrict it to the `main` workflow source, then set:

```sh
gh api --method PUT repos/MangmeeDev/mangmeeplus/environments/uat \
  -F 'deployment_branch_policy[protected_branches]=false' \
  -F 'deployment_branch_policy[custom_branch_policies]=true'
gh api --method POST repos/MangmeeDev/mangmeeplus/environments/uat/deployment-branch-policies \
  -f name=main -f type=branch
gh variable set AWS_ACCOUNT_ID --env uat --body 311414082667
gh variable set AWS_REGION --env uat --body ap-southeast-1
gh variable set AWS_ROLE_ARN --env uat --body arn:aws:iam::311414082667:role/watchdog-bms-ci-uat
gh variable set AWS_DEPLOY_ROLE_ARN --env uat --body arn:aws:iam::311414082667:role/watchdog-bms-deploy-uat
```

Add these non-secret UAT LINE variables (the current approved cycle temporarily uses the production values):

- `LINE_LOGIN_CHANNEL_ID`
- `LINE_LIFF_ID`
- `LINE_MESSAGING_CHANNEL_ID`

Optional variables include `PUBLIC_DOMAIN_URL`, LINE links/images, and AI provider settings. The defaults keep CRM auto-reply and AI providers disabled.

## Isolated data services

This creates a dedicated encrypted `db.t4g.micro` RDS instance, `cache.t4g.micro` Redis, S3 bucket, UAT-only security groups, secrets, and ECS cluster. It reuses only the existing private subnets/NAT and adds recurring AWS cost. Export UAT LINE secrets without putting them on the command line; temporary production values require explicit owner approval and mandatory production rotation after acceptance:

```sh
export LINE_LOGIN_CHANNEL_SECRET='...'
export LINE_MESSAGING_CHANNEL_SECRET='...'
export LINE_MESSAGING_CHANNEL_ACCESS_TOKEN='...'
CONFIRM_UAT_COST=CREATE_ISOLATED_UAT \
AWS_PROFILE=watchdog-bedrock AWS_SDK_LOAD_CONFIG=1 \
  bash infra/uat/bootstrap-data.sh
unset LINE_LOGIN_CHANNEL_SECRET LINE_MESSAGING_CHANNEL_SECRET LINE_MESSAGING_CHANNEL_ACCESS_TOKEN
```

Secrets are stored only under `watchdog-bms/uat/*`. The deployment runs containers with `APP_ENV=production` for production security validation while `DEPLOY_ENV=uat` selects isolated cloud resources.

## M-01 actor-delegation acceptance

The UAT bootstrap creates the dedicated actor-delegation signing key. A clean CI run
retains `agentcore-runtime-<full-sha>` alongside the immutable image release. Enable
`run_m01_acceptance` only with `target=all`: after health and the durable release finalizer pass,
the exact `deploy-uat.yml@refs/heads/main` controller starts the short-lived `m01-live` task for
the same full source SHA. Workstation/manual invocation is rejected. The task exercises accepted,
substitution, replay, cross-company, wrong-audience, and unreachable-Redis cases against UAT and
writes only sanitized evidence/audit; it never syncs launch gates or opens a route/feature. A failed
M-01 task makes the workflow and its UAT acceptance evidence fail even when service health already
passed. `m01-actor-delegation-alert.sh` installs and verifies the correlated UAT denial alarm. Both
scripts fail closed outside UAT; production has no M-01 mode.

## Required LINE console changes

After the first `api-web` URL is known, configure the UAT LINE Login callback/LIFF endpoint and UAT Messaging webhook to that URL, verify the webhook, then rerun `api-web` if a custom `PUBLIC_DOMAIN_URL` is added.
