# Agent Memory: Production Kamal cutover rehearsal

Status: Consolidated controller correction passes 62 local tests; exact CI and actual rollback browser completion remain pending. No forward retry dispatched.
Owner: Codex / owner-directed first Production migration.
Scope: First-migration controller, temporary permission prerequisites, complete cutover/acceptance/signature/enrollment/rollback rehearsal. Application stays isolated0b0058ad onfc2838c4; no UAT backlog.

## Current live operation and source

- Controller PR634 admin-merged after full exact-head CI35324778464SUCCESS. Owner explicitly said
  “admin merge เลย”. Reviewed head169469d992a04ebab23ae17840e2857654f56146; main merge
  0c308982b4c3df4d1ce0e9f1b18a001174c49e8e at08:56:38UTC.
- Original controller checkout remains frozen at
  `/Users/thawatchai/.codex/worktrees/prod-kamal-two-release-paths/mangmeeplus`.
  Its task memory has additional uncommitted deployment evidence; preserve and eventually carry it forward.
- Single forward operation20260918T085755Z-860908a6 failed1044.582s after newAPI(twoAZs)/DB,
  AI,workers/Redis/internalAPI passed and oldworkersSTOPPED. CloudFormation traffic change
  `kamal-20260918T085755Z-860908a6-public` reachedEXECUTE_FAILED / UPDATE_ROLLBACK_COMPLETE.
  AWS events explicitly say missingec2:DescribeImages. Both operator-only listener rules and the
  entire original template were read back equal to the retained baseline. No duplicate execute.
- Explicit recovery20260918T091745Z-318a0d41 (execsession8800) is still alive,
  **AWAITING_BROWSER_ACCEPTANCE**. Restore phase459.939s; all3ECS services are running exactfc2838c4,
  preserved providerversion37 and old buildauthority verified. New candidate containers are stopped
  with restartdisabled. New worker601f3d8b7e3946f384d27a9d72006a44 runs original ECS image/config.
  Runtime restoration is proved; do not call the entire signed rollback complete yet.
- Recovery releaseId82da69e12c0535c99b2b9c39c4a919122cf9a1747bb1ffe74f8b868671b38e5f.
  The original checkout has its private runs, source/build/cache, locks and generated browser request.
  Both legacyProd deployment workflows are still fenced until real rollback acceptance/signing.
  UAT/READY/PROD workflow IDsNOT_DISPATCHED. No ordinary Production target.json exists.
- Owner's latest correction: “ให้จำลองไปจนจบก่อน ค่อยแก้ครั้งเดียวจะได้ไม่เสียเวลา”.
  Preserve the running recovery; collect all failures in offline/read-only rehearsal before one patch.
  No functional controller/IAM mutation has been made in this new rehearsal checkout yet.

## Diagnostic evidence

- New checkout/branch`codex/prod-kamal-cutover-rehearsal-20260918` starts at main0c308982.
  Only the new offline`infra/kamal/first_migration_rehearsal_test.py` and this memory are new.
- AWS CLI local skeleton (never sent to AWS) forcloudformationexecute-change-set returns exit0 and
  empty stdout. ExistingRelease.aws alwaysJSON-decodes and therefore mistakes this success for failure.
  The initial actual service failure is independently proved by realCF events, not inferred from parsing.
- Existingchange_traffic rejects stableUPDATE_ROLLBACK_COMPLETE; the retained real stack is in that
  state. Add a bounded stable-state acceptance, retaining exact-template/owned-condition guards.
- Offline statefulCF model uses actual empty CLI response shape; the unmodified wrapper fails.
  An explicitly labeled diagnostic transport shim allows execution past that known defect, to expose
  downstream problems without patching or dispatching live code. This chain reaches actual controller
  methods for traffic switching, browser binding, acceptance, authority preservation, signature,
  target enrollment, route restoration and signed ECS rollback. HTTP/browser/KMS answers are synthetic
  and markedSIMULATION_ONLY, never a Production acceptance artifact. The forward accepted snapshot
  stays immutable while the mutable journal is restored. Failure tests reject missing browser checks
  and unverified enrollment signatures. ModelKMS is deterministic fake, not a cryptographic proof.
- Last targeted run5tests: diagnostic end-to-end chain and negative checks pass;2intentional errors
  reproduce empty-response parsing and stable rolled-back stack rejection. Initial whole-suite64test
  run also had a fixture mistake (staging routes not captured before switch) and duplicated7imported
  tests; fixture/import corrected without touching functional code. Retain those logs, do not count
  the fixture error as another production bug. Expected full suite after deduplication57tests.
- Private evidence under this checkout`.env.kamal/rehearsal/`: before-fixes.log,
  before-fixes-complete.log, actual CloudFormationlistener-rule-schema.json, IAM input/results.
- Actual AWS registry read-onlyDescribeType using owner bootstrap profilethawatchai gives update
  handler permissions:ModifyRule,SetRulePriorities,DescribeRules,AddTags,RemoveTags,DescribeTags;
  read handler needsDescribeRules/DescribeTags. Existing role lacksDescribeImages,DescribeTags,
  SetRulePriorities and tag writes. Conditional tag/priority actions may not run for a conditions-only
  update; don't claim every listed action is necessarily called. SourceUrl points to a GitHub404.
- IAM read-only simulations used owner bootstrap principal only; no policy was installed. Initial
  call combining`*`and named resources wasInvalidInput; split calls retained. Proposedv3 adds the
  full declared handler permissions only on2ownedrules plus region/time-boundedDescribeImages.
  Mixed aggregate output uses a placeholderARN: inspectResourceSpecificResults, not onlyEvalDecision.
  Proposed24resource-specific checks:16pass,8fail. DescribeRules/DescribeTags requireResource`*`
  per official service authorization; put read-onlyDescribeTags in the bounded global read statement.
  Exact-ruleAddTags/RemoveTags still showimplicitDeny even in a single-actionSimulateCustomPolicy,
  despite officialELBv2 docs supporting listener-rule ARNs. Do not turn tag writes intoResource`*`
  just to make simulationgreen. This gap remains to reconcile before any live cutover retry.
- Existing temporary policy expiry stays2026-09-18T13:53:49.513914Z. No IAM change yet.
- Actual KMS sign/verify was already proved before the initial deploy under the non-root role;
  originalprivate signing-preflight/result.json explicitly says not release acceptance.
- Additional start-of-next-run prerequisite: first migration deliberately rejects every existing
  app container, including stopped ones. After signed rollback, retain metadata/log evidence, then
  remove only the exact failed-candidate stopped/restart=no containers under the release lock before
  the next preparation. Do not weaken that guard or remove running/unknown containers.

## Current browser limitations and owner input

- CUA bindings: browser5developer/profilemangmeeplus.com, prodAdminTab325833565 at
  https://mangmeeplus.com/system/platform-access. Browser4Thawatchai/prodExpenseTab325833568 is
  the incomplete SndPrd845baht substitute form. Both were re-markedhandoff this turn.
- NativeChromeDevTools Network UI baseline before cutover showed actual authenticatedGET
  /api/v1/system/platform-access200 withOPEN/live/canOpentrue. No gate write.
  Direct auth/me navigation was blocked by client; exact current user/permissions are not proved.
  Do not bypass browser restrictions, extractcookies/passwords, or create true acceptance from headings.
- Async owner question now pending: from their existingChromeDeveloper session, send onlyauth/me
  userId,roles,launch-gate permission andmustChangePassword/legalAcceptanceRequired. No passwords,
  cookies/tokens requested. Current recovery also still needs real logout204 and session rejection401.
  No browser-acceptance.json has been issued. Keep the same recovery process alive while collecting it.
- Older financial-facts question for the845baht LeoPard receipt remains unanswered. No substitute
  certificate/signature/cancellation or original final confirmation has been performed.

## Next

1. Finish permission/transport/state/cleanup audit and remaining failure injections before functional edits.
2. Apply one smallest consolidated correction with focused/complete tests; never edit the original
   controller while its recovery is alive. Use the new checkout for all corrections.
3. Complete actual admin acceptance for the existing recovery; preserve original failed forward run.
4. Keep main frozen until recovery customer acceptance completes. A correction PR/CI may be prepared,
   but no merge/newforwardapply before required proof. Add later evidence docs from the original checkout.
5. Only after complete rehearsal, exact CI/main match, scoped permission proof and safe stopped-container
   cleanup, run one new forward operation using original0b build; never import unrelated main/UAT code.

References: AWS [listener rule permissions](https://docs.aws.amazon.com/service-authorization/latest/reference/list_elbv2.html),
[IAM simulator limits](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_testing-policies.html).

## Consolidated correction and actual identity — 09:46UTC

- Before functional edits, completed the diagnostic chain through traffic, browser binding,
  authority preservation, signature, enrollment, route restoration and signed rollback. Full61tests
  had only2errors: the intentionally reproduced empty-response and rolled-back-stack defects.
  Additional negative probes passed for failed CFexecution/no duplicate, invalid KMSverify,
  customerCLOSED, missing browser checks and fail-closed malformed/empty read/error responses.
- One functional correction adds narrow empty-output handling only for ExecuteChangeSet,
  accepts stableUPDATE_ROLLBACK_COMPLETE with all existing scope/readback guards, and exercises
  CFparameterAMI/owned-ruletag reads during preflight before publication or worker handover.
- The final rehearsal removes the diagnostic transport shim: complete forward/rollback tests now
  use the real Release.aws parser. Full62tests PASS (0.972s). This remains an offline provider model,
  with synthetic HTTP/browser/KMS; it is not live CFcutover or administrator acceptance proof.
- Proposed temporary IAMv4, not installed, keeps the original expiry and exact2ownedrules for
  ModifyRule/SetRulePriorities/AddTags/RemoveTags; global read actions add DescribeImages/DescribeTags.
  SHA256:3ebd43982a39fd1d941c1d425087e7765e0af01493c49c8667093510ca47e88e.
  Correct resource-specific simulations pass4globalreads and4ownedModifyRule/SetRulePriorities.
  Minimal no-condition tag simulations still deny exactARN and allowstar; official ELBv2 explicitly
  supports listener-rule tagging. Keep this discrepancy visible: do not broaden writes tostar.
  After accepted rollback and a single scoped IAMinstallation, verify actual tag API permission
  on the2ownedstagingrules with retained unchanged business tags before any forward retry.
  No stack/application/traffic/IAM change was made during this correction; current recovery stays alive.
- Owner supplied the actual currentauth/me response. Independently read the rendered JSON from
  their existing ChromeDeveloper tab325833587: exactcmt8k20fs00000q319isxwkc5,SYSTEM_ADMIN,
  system.launch_gate.manage,mustChangePasswordfalse,legalAcceptanceRequiredfalse. No credentials.
  Fresh admin page showsOPEN/deploymentlive. NativeChrome window has no readableAX/screenshot,
  so actual freshcanOpen/logout204/postlogout401 remain pending in one precise owner question.
  Original recovery run retains identity-observation.json only; no complete browser attestation
  was fabricated. This supersedes the earlier missing-identity note, not the pending HTTP statuses.
