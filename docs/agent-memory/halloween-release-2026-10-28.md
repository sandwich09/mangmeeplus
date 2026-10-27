# Agent Memory: Halloween UAT and Production release

Status: SOURCE_READY. Owner authorized UAT and Production: “โอเค เอาขึ้น uat และ prod ได้”.
Owner: Root; Sol performed a bounded read-only application review.
Scope: Approved Halloween activity, 23 cards and sharing, server random draw without signing keys, theme gate, loading/smoke/audio; previously authorized dependency security updates.
Decisions: Use the existing local Kamal UAT release then promote its signed immutable images to Production. No new infrastructure, game key, database schema or theme-setting change. Preserve customer OPEN and perform current administrator acceptance. Read both mandatory cloud/deployment runbooks before operations. Owner explicitly directs “แบ่ง agent มา merge เข้า main+develop ด้วยนะ ไม่ต้องเปิด pr merge เลย”; Sol owns direct integration without PR or force push after root verifies the final source.
Open questions: Production MFA session pending user completion in their Terminal. No remote CI pass claimed: GitHub's most recent run 39645146882 is startup_failure with zero jobs/checks. Local verification is retained; no manual CI reruns or workflow/protection changes. Historical queued READY 31611733340 is unchanged since 2026-08-12 with zero jobs, not a newly running release; leave untouched. Do not redispatch a failed deployment.
Artifacts: Current app spec/plan and 53-test/build/browser evidence are in the Halloween documents. Release verification in docs/evidence/halloween-release-2026-10-28/. No PR per owner instruction.
Verification: Local source is current origin/main 86e0e47366617954f6f37f079d9fe18363437096. Release controller hashes match the last accepted Production operation 20261024T170243Z-6e84b33b. Shared private .env.kamal state is in the primary checkout; its old application/controller checkout must not be used. Existing UAT scoped identity verified. No active.json file for either environment; workflow release runs not dispatched.
Next: Finish release checks and source integration, UAT prepare/apply, verify game on UAT, promote same images, administrator/browser/logout and public OPEN acceptance, retain signed results and timings.

## Source verification

- Existing portable verify.sh completed all stages. The first web run found raw caught Error.message display in the game/share UI. Sol replaced these with safe fixed retry copy, preserved timeout wording and added a regression for internal canvas diagnostics. No guard allowlist or suppression added.
- Corrected web full suite: 5,078 pass, zero failed. Other full-suite stages: contracts 487; API 12,163 pass / 200 intentional skipped DB cases; harness 33; LINE whole-chain 5,166; M01 109; P1 30; AI gateway 2,583. All other verify stages pass, including both app typechecks, other package typechecks, migration review and maintenance pins. Counts overlap; not a unique test-case count.
- Sol focused error/lifecycle/share/draw tests: 19 pass. Earlier current feature's 53 focused tests and production build/browser remain retained; the release image build will compile the final safe-copy change again.
- Staged only runtime assets, application/dependency changes, specs/plans/memory and reproducible textual evidence, required JPEG test fixture and current screenshots. Large output/archives and redundant historical screenshots remain local; generated Next files are not included.
- UAT read-only preflight 20261027T194227Z-94dc7a47 passed in 11.347 s, two SSM sessions terminated. No deployment or Production mutation.

## Release ledger

- candidate: NOT_COMMITTED
- controller: 86e0e47366617954f6f37f079d9fe18363437096 (before integration)
- UAT_RUN_ID / READY_RUN_ID / PROD_RUN_ID: NOT_DISPATCHED (local Kamal path)
- UAT prepare / apply operation: NOT_STARTED
- Production prepare / promotion operation: NOT_STARTED
- Signed artifacts/digests and final customer acceptance: PENDING
- serving mode: preserve existing live/OPEN; no gate mutation inferred from this request
- owner reference: this chat, direct UAT/Production authorization on 2026-10-28; no new legal artifact or waiver claimed
