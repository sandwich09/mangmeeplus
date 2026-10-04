# Isolated Official OA publication

This service publishes only MangmeePlus Official @107ewccg Contact/Social cards.
It reuses the existing mapper, signature verifier, JSON and PNGs. It neither deploys
the current ERP main backlog nor changes databases, system OA, workers or customer gates.
The owner explicitly chose this scope and local checks on 2026-10-04.

Build and check locally, without cloud credentials:

~~~sh
python3 -B infra/line-official/build.py --output <private-output-directory>
OFFICIAL_BUNDLE_PATH=<private-output-directory>/index.cjs \
  node --test infra/line-official/handler.spec.cjs
~~~

The output is an inline CloudFormation template below 51,200 bytes and a manifest
binding source, input hashes and bundle hash. sourceDirty:true is development
evidence; commit/review the source and rebuild before publishing. No secret is
included. No dependency/manifest/lockfile change is needed. The repository's
esbuild bundles the shared helpers, card JSON and images; Lambda supplies SDK v3.

Read the current cloud/deployment runbooks before operations. Use a non-root
platform/deployment session for account 311414082667, region ap-southeast-1.
Existing watchdog-bedrock-dev denied CreateSecret and ValidateTemplate. For this
2026-10-04 publication only, the owner explicitly selected profile thawatchai
(account root) after the non-root platform-session request. Use that scoped owner
override solely for the new OA stack; do not broaden ERP roles. Acceptance signing
still uses the existing non-root Production KMS authority. Check both dedicated
names before deployment; channel-secret was previously verified absent.
If either already exists, reconcile its owner/version instead of overwriting it.
The stack declares only these names:

- watchdog-bms/production/line-official/channel-secret
- watchdog-bms/production/line-official/channel-access-token

Stack/function/role name is watchdog-bms-line-official-oa-prod. The runtime role
can read only those two secret ARNs and write only its own 14-day log group.
It has no VPC/ERP/DB/AI/IAM-write access. Runtime is Node.js24/arm64, 256MB, 10s,
the current account concurrency limit is10. No reserved concurrency is requested
because AWS requires an unreserved allowance and this account quota is only10. Parameters use NoEcho; values come from the private
owner-approved credential file, never argv, Git, logs, Outputs or chat.

Publication boundaries:

1. Verify the owner-approved account identity, clean reviewed manifest and zero active operation.
   Run provider ValidateTemplate; create one scoped CREATE change set with
   PromoteLive=false and CAPABILITY_NAMED_IAM. Retain its ID and exact resource diff.
   Execute that change set once and monitor it to terminal.
2. Retain the immutable version/source and provider CodeSha256. Verify the three
   staging PNG URLs against local SHA256 and wrong/missing signature rejection.
   LINE's configured-URL test can target staging /webhook without replacing the
   current endpoint; it exercises actual HMAC/secret loading with an empty event list.
   Validate both cards with staging icon URLs; staging never sends replies.
3. Create one UPDATE change set using the same template/source with
   PromoteLive=true and existing credential parameters (UsePreviousValue:true).
   Review that it only adds the live alias/URL/permissions, then execute once.
   Prove staging/live aliases reference the same immutable version and CodeSha256.
4. Verify live icons and signed-empty webhook through LINE. Set/read back the
   Official endpoint and enable webhook only after those checks pass. Stop only
   native Social81694321 and Contact81694430. How-to/package/welcome/manual chat stay native.
   Record owner phone observations separately; never call mocks a sent LINE card.
5. Retain exact stack/change-set/source/bundle/version/provider IDs and sign the
   isolated acceptance digest through the existing approved non-root Production
   KMS authority, verifying the signature. ERP UAT/READY/PROD workflow IDs are
   NOT_DISPATCHED, not borrowed from an old ERP deployment.

Secrets, logs and previous immutable versions are retained on failure/deletion.
If a change set fails, inspect its events/resources and retain the first failure
before any retry; do not overwrite a dedicated credential created by another
operation. Leave the existing native replies live until publication succeeds.

The public URL uses transport auth NONE, with both URL-invoke permissions
scoped to its alias. POST /webhook separately enforces LINE raw-body HMAC.
Only GET of the three exact PNG paths is unauthenticated. See the official
[URL permission contract](https://docs.aws.amazon.com/lambda/latest/dg/urls-auth.html),
[CloudFormation permission properties](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-lambda-permission.html)
and [runtime SDK support](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-package.html).
