# Production Kamal migration and two release paths

Status: infrastructure staged; controller and two release paths implemented with local checks and fresh ECS rollback readback. Review/CI and live application cutover remain outstanding.
Owner: thawatchai / Codex.

## Authorized outcome

The owner explicitly selected migration of Production from ECS Express to Kamal, then requested
two paths: an isolated hotfix and promotion of a release that passed UAT. The immediate application
release combines the LINE trial-pricing and cancelled-certificate confirmation fixes only. Migration does not authorize deploying the newer
UAT/main application backlog, changing billing/data, or modifying unrelated working changes.

Current Production application source is `fc2838c4cb691033f41595c0d43587f10377d33c`.
The owner subsequently supplied combined candidate `0b0058adbc7353ec906a33746867af2a235b0934`,
directly after pricing fix `8f5b508ac3754c72acf10165c7db82a9d1749371`. It adds the cancelled-certificate
confirmation fix across API, web and shared contracts. The complete15-file diff contains no schema,
dependency, build-input, workflow or infra change. Integration PR629 is separate and must not become
the Production source.

## Product and operator contracts

1. Hotfix explicitly pins a full candidate SHA and the observed Production baseline. It proves
   ancestry and the complete diff, rejects migration/dependency/build-policy changes, runs source
   typechecks and regression checks, and builds/signs that candidate. Neither `origin/main` nor
   UAT silently selects the application. Production config comes from the current verified baseline;
   unrelated main config/Postmark changes must not ride with an old-source hotfix.
2. UAT promotion takes an exact accepted, signed UAT release artifact. It verifies the trusted UAT
   signer, source and all image/tool/AgentCore digests, then uses those artifacts without rebuilding.
   Production configuration is separately validated against the same images. Pending migrations
   use the existing normal-mode safety/rehearsal rules; code rollback never down-migrates a DB.
3. Both paths share the existing Kamal executor, account/environment boundaries, locks, configuration
   freshness, build authority, native rollout/readback, deep readiness, signed result and customer
   OPEN plus authenticated acceptance. UAT smoke acceptance is not Production acceptance.
4. Historical UAT receipts currently bind runtime image IDs but do not include a complete signed
   publication manifest/tools bundle. Do not treat unsigned neighboring `publication.json` as signed
   promotion authority. Extend the producer and consumer together; unsupported receipts fail closed.

## Infrastructure and first cutover

- Preserve current ECS services, RDS, Redis, secrets, application data and current public routing
  while preparing the new environment. Use the existing bootstrap and runtime configuration helpers.
- Enroll two Production API hosts in distinct AZs, with AI/workers on separate hosts to retain IAM
  boundaries. Reuse reviewed UAT topology patterns with actual Production resources and least
  privilege. Do not reuse UAT hosts, keys, signing authority, database or cache.
- Establish ingress/TLS, DB/cache reachability, runtime permissions, monitoring and a Production
  signing key. Owner supplied the root-backed `thawatchai` profile for initial infrastructure
  provisioning after the existing roles denied it. Limit that profile to the reviewed bootstrap;
  create a scoped non-root Production deployment role and keep the ordinary release non-root
  guard. Do not expand or repurpose the UAT deployment role.
- Separate preparation/staging from customer cutover. Current `cutoverComplete=true` validation is
  for an already migrated target: do not toggle it to manufacture first-cutover evidence. The first
  migration needs explicit staged target/traffic verification and a retained ECS rollback baseline.
- Candidate workers must not consume real queues during rehearsal alongside live ECS workers.
  Provider callbacks must remain bound to their serving source. Test on isolated data before any
  shared-Production authority or worker mutation. Preserve accepted ECS builds until rollback is
  proved and the migration observation boundary is complete; existing Kamal-only retirement is
  insufficient while ECS remains the rollback target.
- Save exact old routing/config/image/source/authority state. Verify the candidate before switching
  customer ingress, verify OPEN/authenticated acceptance after switching, and retain a concrete
  rollback to ECS. Do not call the initial migration an ordinary Kamal container rollback.

## Implementation and evidence sequence

1. Inspect the existing script, target/history and live inventory; record resource and permission
   gaps. No known-failing deployment dispatches or invented target identifiers.
2. Implement/test explicit source selection and a signed UAT artifact producer/consumer in the
   shared controller; preserve default UAT behavior and existing safety checks.
3. Prepare a reviewable Production infrastructure/cutover plan with actual resource bindings,
   scoped authority and no traffic mutation. Verify permissions before provisioning.
4. Build and rehearse the isolated hotfix, verify complete Production config, prepare rollback,
   and run the approved first cutover only when prerequisites are evidenced.
5. Record actual operation IDs, source/digests, signature verification, timings, acceptance and
   rollback evidence. Integrate the application fix into main/develop/UAT after Production as requested.

## Required verification

Source-selection tests must reject stale baseline, unrelated diffs, dirty source, invalid hashes,
and missing regression evidence. Promotion tests must reject wrong signer/environment, tampering,
missing tools, mixed source/digests, stale or incomplete acceptance, and any rebuild fallback.
Exercise orchestration boundaries and failure retention, not just argument parsing. Run the existing
Kamal controller/stability tests and focused application checks. Keep mock, local rehearsal,
cloud staging and live customer acceptance results distinct.

## Initial migration execution boundary

Infrastructure staging is complete; it is not an application release. The first migration still needs
its own tested operation before ordinary `deploy-prod-hotfix` may run. Keep target enrollment false
until that operation's signed acceptance succeeds. Do not reuse ordinary Kamal rollback for ECS.

The implementation must retain exact ECS service bodies/running task digests, the two original ECS
listener rules, and the operator-only Kamal rules. First stage API/AI with the new artifacts while
candidate workers remain stopped. Apply only the existing SYSTEM build attestations after verifying
the unchanged182-migration catalog; never fabricate HUMAN approvals or retire the ECS baseline.
Check new-host DB/cache reachability and provider identity, health on both API AZs and AI, and a
staged routing return to the existing ECS targets before public handover.

At handover, freeze the release controller/main and exclude concurrent legacy ECS releases. Park
only the existing ECS workers by round-tripping their exact service body and changing capacity to0/0.
Wait for all previously observed worker tasks to reachSTOPPED before starting candidate workers.
Switch only the two owned Kamal listener rules from operator /32 to public host matching, keeping
the original ECS routes/instances available. Preserve provider callbacks and drain behavior across
the transition. Record intent before each mutation and reconcile actual state after an uncertain
response; no blind retry or replacement operation.

Route changes must be reflected in retained CloudFormation configuration, not left as undocumented
manual drift. Use the same exact stack template with only those two rule conditions changed; review
the provider change set to reject any additional resource change. Use a time-bounded scoped non-root
migration authority for exact new rule ARNs and the one ECS worker service, separate from root
bootstrap. Ordinary deployments do not need infrastructure or ECS mutation privileges.

Rollback reverses this handover: stop and verify candidate workers, restore the two operator-only
route conditions, restore the exact ECS worker capacity/body, wait for the old workers, and verify
the original source plus customer OPEN. It does not down-migrate or delete new infrastructure.
Retain the old API build's acceptance while ECS is the rollback target. After successful handover,
prove complete source/config/image readback, DB/cache/internal-API readiness, signed result and
authenticated SYSTEM_ADMIN/OPEN/logout acceptance before recording cutoverComplete=true.

The local PostgreSQL18.3/TLS rehearsal verifies catalog/sync/authority behavior on synthetic data;
the browser regression uses mocked expense responses. Neither is live Production cutover, provider,
managed Redis, or customer acceptance evidence.

## Current verification and remaining release boundary

- Combined candidate build360.504s; subsequent preparation`20260918T080339Z-c854a9c3`64.852s,
 425focused app tests. No application publication/deployment occurred.
-51controller tests pass, including worker ordering, partial-publication recovery inputs,
 signed-UAT rejection, exact source/config preservation and the actual ECS weighted100/0 route shape.
 Fresh read-only probe08:19UTC verifies all three old tasks/digests, both original healthy routes,
 operator-only new routes and the old READY provider. No live rollback drill is claimed.
- CI discovers the entire Kamal suite. Current main requires one approving review; prepare a
 concrete PR and pass checks before requesting any exceptional merge decision.
- Deployment remains one tracked operation with main frozen. Keep Production recovery idle while
 the migration holds the legacy deployment fence. Do not disable shared UAT recovery as a side effect.
- After signed/OPEN acceptance, retain the explicit ECS rollback window. Ordinary releases are
 refused until reviewed closure/cleanup updates enrollment; closing it is not part of initial staging.
