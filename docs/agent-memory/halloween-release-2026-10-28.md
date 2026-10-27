# Agent Memory: Halloween UAT and Production release

Status: COMPLETE. Owner authorized UAT and Production: “โอเค เอาขึ้น uat และ prod ได้”.
Owner: Root; Sol performed a bounded read-only application review.
Scope: Approved Halloween activity, 23 cards and sharing, server random draw without signing keys, theme gate, loading/smoke/audio; previously authorized dependency security updates.
Decisions: Use the existing local Kamal UAT release then promote its signed immutable images to Production. No new infrastructure, game key, database schema or theme-setting change. Preserve customer OPEN and perform current administrator acceptance. Read both mandatory cloud/deployment runbooks before operations. Owner explicitly directs “แบ่ง agent มา merge เข้า main+develop ด้วยนะ ไม่ต้องเปิด pr merge เลย”; Sol owns direct integration without PR or force push after root verifies the final source.
Open questions: Production MFA identity verified after owner completed the Terminal command. No remote CI pass claimed: GitHub's most recent run 39645146882 is startup_failure with zero jobs/checks. Local verification is retained; no manual CI reruns or workflow/protection changes. Historical queued READY 31611733340 is unchanged since 2026-08-12 with zero jobs, not a newly running release; leave untouched. Do not redispatch a failed deployment.
Artifacts: Current app spec/plan and 53-test/build/browser evidence are in the Halloween documents. Release verification in docs/evidence/halloween-release-2026-10-28/. No PR per owner instruction.
Verification: UAT and Production serve exact source `9a3deb73104eb9ffabf8f6f72916229801280657`. Final web suite 5,082 pass / zero failed, standalone web TypeScript and focused 21 share/lifecycle tests pass. Signed Production acceptance and all 18 evidence hashes verified; same four images and AgentCore artifact as UAT. All runtime/deep-readiness/customer OPEN checks pass and four owned SSM sessions terminated. One unchanged API security alarm is explicitly accepted by the owner for this release only; no all-alarms-OK claim.
Next: No pending release work. Final integration into main+develop is docs/evidence only; deployed source remains 9a3deb73104eb9ffabf8f6f72916229801280657. Parent will archive the temporary integration worktree.

## Source verification

- Existing portable verify.sh completed all stages. The first web run found raw caught Error.message display in the game/share UI. Sol replaced these with safe fixed retry copy, preserved timeout wording and added a regression for internal canvas diagnostics. No guard allowlist or suppression added.
- Corrected web full suite: 5,078 pass, zero failed. Other full-suite stages: contracts 487; API 12,163 pass / 200 intentional skipped DB cases; harness 33; LINE whole-chain 5,166; M01 109; P1 30; AI gateway 2,583. All other verify stages pass, including both app typechecks, other package typechecks, migration review and maintenance pins. Counts overlap; not a unique test-case count.
- Sol focused error/lifecycle/share/draw tests: 19 pass. Earlier current feature's 53 focused tests and production build/browser remain retained; the release image build will compile the final safe-copy change again.
- Staged only runtime assets, application/dependency changes, specs/plans/memory and reproducible textual evidence, required JPEG test fixture and current screenshots. Large output/archives and redundant historical screenshots remain local; generated Next files are not included.
- UAT read-only preflight 20261027T194227Z-94dc7a47 passed in 11.347 s, two SSM sessions terminated. No deployment or Production mutation.

## Current release ledger

- Candidate/deployed source: `9a3deb73104eb9ffabf8f6f72916229801280657`; exact tested Git tree `972d909f25751a90aceba9523ff740070de35896`.
- Controller hash: `da915391c7e6b0ed488add2e655631a44f43f866304caebcc9584faa3e8aa080`.
- UAT_RUN_ID / READY_RUN_ID / PROD_RUN_ID: `NOT_DISPATCHED` (local Kamal path).
- Final UAT prepare `20261027T203541Z-3f80652b`: 254.065 s; UAT apply `20261027T204006Z-1f430a8d`: signed `ACCEPTED_LINE_DEFERRED`, 248.412 s, customer OPEN, two SSM sessions terminated.
- Final Production prepare `20261027T205106Z-3d6a28d7`: 47.178 s; apply `20261027T205355Z-e422dd3a`: signed `ACCEPTED_LINE_DEFERRED`, 1,174.921 s total, website ready at 343.313 s and browser acceptance wait 806.372 s. Finished `2026-10-27T21:13:30.612111Z` / October28 04:13 Bangkok. These include operator/browser work; do not present the website-ready time as the full release time.
- UAT accepted artifact SHA256: `d0893f76cf7409b02125e827769cfbef8274d1c44ac612f89ec606d66db1a94b`.
- Production accepted artifact SHA256: `887fa0249ac14bb2fe4ebed50d45573a3bce649ba1b9b8ae76f9bfe5e5f68901`; KMS ECDSA_SHA_256 verified. All 18 signed evidence hashes independently match retained files.
- Exact four UAT image IDs and AgentCore artifact promoted without rebuild. Full digests, phase clocks and readback are in `production-accepted-summary.json`.
- Existing `live` / `OPEN` preserved; no gate/theme mutation. Current administrator identity/permission, login200, flags false, gate canOpen/live/OPEN, logout204 and postlogout401 observed. Login's normal redirect was `/system/partners`, followed by an explicitly verified `/system/platform-access` page200. No fabricated redirect claim.
- Owner references: direct UAT/Production authorization; later pause reconciled before mutation; “แก้เลย เอาชึ้นไวๆ” resumed the release with revised sharing; “ปล่อยต่อ บันทึกข้อยกเว้น Alarm เดิม” accepted only the inherited API security alarm. No new legal artifact or generic security waiver.
- Post-deploy alarm read: 15 OK, one exact unchanged October9 API security ALARM. Root `thawatchai` used only for owner-authorized alarm reads; all deployment and container-log reads used scoped non-root access. No alarm suppression, database recheck or resend.
- LINE messaging journey and physical iPhone/Android social posting were not exercised in this release. The signed status retains LINE deferral; all required customer acceptance passed.

## Branch integration

Sol integrated directly per owner instruction, without PR or force push. Original main/develop trees were identical despite divergent history; the normal merge reported seven conflicts. Root authorized exact tested-tree resolution after confirming remote tips were unchanged. Merge 8802028dc967d3f95c2af7548bd2e652b4118a78 preserves both histories and has exact tested tree d7d2db0a800d86096c032eca5cc3402aa5f2df9c. Atomic normal push and remote readback show both main/develop at that SHA. Main stays frozen through acceptance. Production read-only preflight 20261027T194749Z-c60ce566 passed in 19.716 s.

## UAT game acceptance failure and correction

- Infrastructure release completed with signed acceptance and transport cleanup, but actual UAT browser at 390 showed the new game and failed its draw. Production promotion was not started. Historical successful infrastructure receipt is retained and is not considered game acceptance.
- Root cause: the combined container proxy sent all `/api/*` except `/api/auth/*` to Nest; the new Next draw route therefore never reached its handler. Local direct Next preview did not include this proxy.
- Sol added only exact `/api/public/halloween/draw` forwarding to Next. Other API paths, headers and maintenance denial remain unchanged. Real HTTP proxy suite: 5 pass. Parent real-Next combined-proxy before/after proof reproduces old 404 and corrected 200 with actual cardId; cross-origin remains 403 and client-selected card remains 400. Runnable proof and output are in the release evidence folder.
- Updated the existing maintenance proxy hash and its validator hash in the legacy workflow, with no policy weakening. Parent reviewed both one-line hash changes. Full production image-security fixture suite passed (exit 0) before source integration. No production cloud mutation, rollback, workflow rerun or duplicate deployment dispatched. Source change requires a new UAT build/release; do not promote the earlier receipt.

## Corrected candidate / UAT retry

- Correction 0fc4d88923a20ec0601777f0b7b31b39018d810d passed the full image-security fixture suite and real-Next combined-proxy proof. Sol merged and atomically pushed both main/develop to 21a8f75a0bd419e020d50c6142419689ed0ee941; exact tested tree e21e239aac991a273015a9d76ddaff0891ce23b5. No PR or force push. Main remains frozen.
- Read-only sibling review confirms Cloudflare Workers preserve the draw pathname, query, POST body and original public X-Forwarded-Host; no edge change required.
- Re-read mandatory deployment protocol; previous UAT operation is terminal and both owned SSM sessions were terminated; no current local operation. New UAT prepare 20261027T201201Z-b6eb7735 started against the corrected candidate. The prior signed infrastructure receipt is not a promotion input.

- Corrected UAT prepare completed PREPARED_NO_DEPLOYMENT in 205.417 s, exact source21a8f75a0bd419e020d50c6142419689ed0ee941, all five phases passed and owned SSM cleanup passed. Proceeding once with that exact prepared build.

- Corrected UAT apply operation: 20261027T201606Z-8c17a366; single apply using prepare20261027T201201Z-b6eb7735.

- Corrected UAT apply20261027T201606Z-8c17a366 ACCEPTED_LINE_DEFERRED in220.38s, KMS verified, all phases and public OPEN passed, both owned SSM sessions terminated. Actual browser390 draw13-frankenstein and1280 redraw21-chonggak-gwishin passed; smoke/back-only spin observed. Download is byte-identical to approved PNG and contains five-field mangmeeplus origin metadata. Screenshots and sanitized receipt summary retained. This exact corrected receipt is the Production promotion input.

- Production promotion prepare: 20261027T202044Z-e6eb95e6 (same signed UAT artifacts, no rebuild).

- Production prepare20261027T202044Z-e6eb95e6 PREPARED_NO_DEPLOYMENT in49.676s, all phases and owned SSM cleanup passed; exact corrected signed UAT artifacts verified. Starting one promotion apply; main remains frozen.

## Owner pause — 2026-10-28

- Owner said “แปบนึง อย่าพึ่งขึ้น prod” after promotion apply began. Root immediately stopped only that controller with SIGINT. Operation20261027T202146Z-24ec654a ended FAILED/Interrupted in46.777s during host-storage-capacity, before publish/provider/database/rollout. productionMutated=false, all four owned SSM sessions terminated, process no longer running, local active guard removed. No Production version change. No retry or rollback dispatched.
- UAT corrected release remains accepted; main/develop remain21a8f75a0bd419e020d50c6142419689ed0ee941. Integration agent instructed to stop pushes/deploys. Retain interrupted receipt and integration checkout. Only resume Production on owner's explicit instruction after reconciling this receipt; do not automatically retry.
- Owner's next question asks how the current share buttons and copied caption/link work; answer from source without changing implementation.

## Sharing change and release resumed

Owner “แก้เลย เอาชึ้นไวๆ” explicitly resumes release after approving image+caption sharing for all social icons and best-effort automatic caption copying. Update spec/plan before implementation. New source invalidates older prepared/promotion inputs; prepare/apply UAT once after verification/integration, then promote its exact signed artifacts. Preserve interrupted Production receipt and reconcile it before any new apply.

- Reconciled interrupted Production run from original terminal phases, no publication/provider/database/rollout and productionMutated=false; controller cleanup removed its owned remote/local lock and terminated all4SSM sessions. Fresh read-only preflight20261027T203012Z-dbce2de6 passed18.364s with cleanup; no rollback/repair needed. New source requires new UAT after owner resumes.

- Sharing refinement: Sol changed only component+spec; root reviewed actual handlers. All four triggers pass preparedJPEG/caption/homepage and start clipboard without awaiting; copy failures remain independent, manual fallback does not steal focus, card/unmount cancels late feedback. PurePNG save unchanged. Focused21tests and standalone webTypeScript pass; root fullweb suite5082/0 and diff-check pass.
- Real browser390/1280: no sideways overflow, primary action group48px high/equal widths, social icons48×48. Clipboard readback equals exact zombie caption+homepage+LINE. Native Chrome on macOS: Facebook, Instagram and TikTok each open the OS share sheet; confirmed copied-caption feedback; Escape restores retryable card. No app post sent and no claim of physical iPhone/Android social acceptance.

- Sol integrated tested commit1732f71d099b86942cd773d68cfa9fc8dbdff3a1; both main/develop now9a3deb73104eb9ffabf8f6f72916229801280657, exact tree972d909f25751a90aceba9523ff740070de35896. Atomic normal push, noPR/force; frozen through acceptance. No running workflow; only unchanged August12 orphan READY31611733340 remains queued.

- Share refinement UAT prepare operation: 20261027T203541Z-3f80652b.

- Share UAT prepare20261027T203541Z-3f80652b passed254.065s, all phases and cleanup; single apply follows using exact prepared build9a3deb73.

- Share UAT apply operation: 20261027T204006Z-1f430a8d.

- Share UAT apply20261027T204006Z-1f430a8d signedACCEPTED_LINE_DEFERRED in248.412s; allphase/readiness/OPEN/cleanup pass. Real390 copy returns exactzombie caption/homepage/LINE, redrawing shows smoke/twoapprovedbacks. Productionpreparation may proceed read-only; apply waits alarm disposition.
- Owner explicitly authorized thawatchai readCloudWatch only, then confirmed an exception after it was identified as root. AWSlogin renewed by owner. Root used only STSidentity and CloudWatchDescribeAlarms, noAWSmutation. FreshOct28 readback16productionalarms:15OK; APIsecurityALARMlasttransitionOct9. Evidence retained; no claimallalarmsOK and no reuseOct9waiver. Deploy continues to use scopednonrootrole only.

- FinalProduction prepare20261027T205106Z-3d6a28d7 passed47.178s with4SSM cleanup. Owner explicitly accepts inherited APIsecurity alarm for thisrelease: “ปล่อยต่อ บันทึกข้อยกเว้น Alarm เดิม”. Currentalarm transition/reason exactmatch retainedOct9 proof; currentDB not rechecked. Record scopedownerdecision and freshalarmreadback in signed browser evidence; do not claimallalarmsOK or suppressalarm. All otheracceptance remainsrequired.

- FinalProduction apply operation: 20261027T205355Z-e422dd3a; exact signedUAT sharecandidate, no rebuild, scopednonrootprofile.

## Final Production acceptance and browser evidence

- Actual public game on Production: random results `10-werewolf` and `02-krahang`; observed loading “กำลังเรียกวิญญาณ…”, successful reveal, pure PNG save, social icon buttons, caption/homepage/LINE copy, and responsive no-overflow layouts at actual 390/1280 widths. Native share cancellation leaves the card retryable. No social post was published.
- Saved `mangmee-10-werewolf.png` is byte-identical to the approved 1122×1402 asset and retains five-field mangmeeplus origin metadata. This is origin attribution, not a signed draw receipt; the approved final implementation does not claim cryptographic authenticity of a client image.
- Current administrator form already contained username/password when observed. Root clicked login once without entering a credential. The owner asked how login occurred; root explained the prefilled form and uncertainty about autofill versus prior entry. Owner replied “โอเค”. No credential reset or password persistence. User was logged out after acceptance.
- Browser Network retained login200, me200 and gate200. Native Network capture was unreliable for the final logout row; scoped read-only logs from the two current API containers corroborated the actual UI logout at request `e955eb6e-5a68-4780-9aab-f08585a11620` with 204, then browser me401 at `a3b842ca-acab-4a95-90d0-49892a99e4ee`. BFF logout status itself was not retained, and this limitation is in the signed observations. No second login or password extraction was needed.
- Controller rechecked all runtime/config/deep-health fields after the browser wait, reread public OPEN/login200, retired 19 observed old builds, signed/verified the accepted receipt and closed 4/4 owned SSM sessions. Original exec session54543 exited0. The private run directory contains full signed evidence; only sanitized summaries and public game screenshots are committed.
- Freeze ended only after signed acceptance and cleanup. Final integration is docs/evidence only and does not require another deployment.
