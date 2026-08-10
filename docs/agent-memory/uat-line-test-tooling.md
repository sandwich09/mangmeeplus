# Agent Memory: UAT LINE test tooling (DB tunnel + per-account LINE link reset)

Status: done 2026-08-10
Owner: thawatchai + Claude
Scope: two ops scripts, no app code touched
Decisions:
- `infra/uat/db-port-forward.sh` — SSM port-forward through `watchdog-bms-ssm-bastion` to
  `watchdog-bms-uat-db` on 127.0.0.1:55432; `--url` prints the secret URL rewritten to the
  tunnel (`sslmode=require` because verify-full cannot pass on 127.0.0.1). Pre-checks the DB SG
  admits the bastion SG on 5432 and prints the authorize command if not (rule may not exist yet —
  bastion was provisioned for production support).
- `scripts/heal/line-link-reset.sh <url> <LINE_USER_ID> [--apply]` — survey-then-apply (same shape
  as scripts/heal goods-receipt pair). Deletes only `ExternalIdentity` (provider=LINE),
  `LineCompanyContext`, and `LineWebhookEventLog` rows for that one LINE user id. Webhook rows are
  matched via sha256-hex-16 of the id, verified identical to `hashMessagePreview()`.
  Left alone on purpose: `EmployeeLineLinkToken` (per-membership, reissue a fresh QR),
  CRM identities (customer domain). Refuses URLs containing "prod".
Open questions: none
Artifacts: infra/uat/db-port-forward.sh, scripts/heal/line-link-reset.sh,
  docs/runbooks/cloud-environment-operations.md §4 "UAT DB จากเครื่อง dev"
Verification: bash -n both; sed rewrite tested against the exact secret format
  bootstrap-data.sh writes; shell hash == node hashMessagePreview (HASH_MATCH).
  Live 2026-08-10: tunnel opened against the real bastion (session started, port 55432
  bound) — so ssm:StartSession is permitted and the UAT DB SG already admits the bastion
  SG on 5432; no authorize command was needed.
Gotchas found while running it for real:
- This workstation had no psql at all. `brew install libpq` (client-only, keg-only);
  the reset script falls back to /opt/homebrew/opt/libpq/bin/psql when PATH has none.
- libpq rejects the stored URL: `invalid URI query parameter: "schema"`. schema=public is
  Prisma-only and is now stripped in --url, alongside verify-full → require.
- `--fields` prints the RDS host, but DBeaver must point at 127.0.0.1:55432 (the tunnel),
  not that host.
Next: nothing pending on the scripts. The DB password lives only in
  secretsmanager watchdog-bms/uat/database-url — read it with --fields, never copy it into
  a file.
