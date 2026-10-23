# Ops follow-ups 2026-10-23 — plan (docs only)

Status: PLANNED. Nothing in this document has been executed. No code, infrastructure, git state or cloud
resource was changed while writing it, and no AWS call (read or write) was made.
Source tree: `main` 6c54ba208 (same tree as develop b27180990).
Task memory: [`docs/agent-memory/ops-followups-2026-10-23.md`](../agent-memory/ops-followups-2026-10-23.md).

Read before writing: `AGENTS.md`, `docs/runbooks/cloud-environment-operations.md`,
`docs/runbooks/uat-production-v2-deployment.md`, `infra/kamal/README.md`,
`docs/agent-memory/security-fix-plan-2026-10-21.md`, section ก of
`docs/research/expense-leadership-verified-backlog-2026-10-23-th.md`, the private change-set folders under
`~/.codex/edge-operations/` (read only), and the source files named in each item.

Rules for whoever executes this plan:

- Read the two runbooks again before any cloud step. They win over this plan if the two disagree.
- Every Production or UAT AWS action needs the owner's 6-digit MFA code first. Production needs the
  owner's explicit go given after his own UAT check ("ห้ามเอาขึ้นเอง"), and his own browser sign-in for
  acceptance.
- GitHub Actions stay off (owner 2026-10-20). Releases use the local Kamal path. UAT/READY/PROD workflow
  IDs are `NOT_DISPATCHED`. Record the local operation IDs instead.
- Post each command the owner must type exactly once. In later messages refer to it ("คำสั่งที่ 2
  ด้านบน"); never paste it again. A repeated block made him rotate the JWT keys twice on 2026-10-22.
- Messages to the owner are in plain Thai, with no hashes, IDs, paths or code. End with "พร้อมแล้ว / ยังเหลือ".
- Stop only processes you started, by PID or port. Never `pkill` by pattern.

## สรุปสำหรับเจ้าของ

| ข้อ | เรื่อง | ลูกค้าเห็นอะไรตอนนี้ | ทำเมื่อไร | คุณต้องทำอะไร |
|---|---|---|---|---|
| 1 | เอาหน้าเว็บใหม่ขึ้น UAT แล้วขึ้นเว็บจริง | เห็นหน้าเว็บเก่า มีตารางเทียบแพ็กเกจแบบเก่า ยังไม่มีเสียงเล่า | รอบที่คุณว่าง ประมาณ 1 ชั่วโมง | พิมพ์รหัส 6 หลัก 2 ครั้ง, บอก "เอาขึ้นได้", ล็อกอินเว็บจริงตอนตรวจรับ |
| 2 | เปลี่ยนข้อความ "Production restoration in progress" | คนนอกที่ยิงทางเข้า AI เห็นข้อความนี้ ใน UAT ก็มีข้อความ "UAT restoration in progress" | รอบเดียวกับข้อ 1 ประมาณ 15 นาที | อนุมัติคำสั่ง |
| 3 | ปิดทางเข้า AI ของ UAT ให้เหมือน Production | คนนอกเข้าถึงทางเข้า AI ของ UAT ได้ (ระบบยังขอรหัสลับก่อนอ่านข้อมูล) | รอบเดียวกับข้อ 1 ตอน UAT เปิดอยู่ ประมาณ 30 นาที | อนุมัติสองขั้น และเลือกเรื่องค่าใช้จ่ายเพิ่มราว 3.6 ดอลลาร์ต่อเดือน |
| 4 | เปลี่ยนกุญแจ AWS บนเครื่อง | ไม่มีผลกับลูกค้า | ราว 4 พ.ย. (พุธ) | ทำเองใน AWS: ลบกุญแจเก่า สร้างกุญแจใหม่ ใส่ในเครื่อง พิมพ์รหัส |
| 5 | ทบทวนคำตอบวิธีใช้ของน้องมั่งมี | ถ้าไม่ทำ ตั้งแต่ 27 ธ.ค. 00:00 (คืนวันเสาร์) น้องมั่งมีจะไม่ส่งคำตอบวิธีใช้ที่อนุมัติแล้ว 68 ใบ ส่วนคำแนะนำขั้นตอนทำงานในแชต (เช่น วิธีส่งหรืออนุมัติใบเบิก) และงานอื่นในแชตยังทำได้ตามเดิม | เตือน 1 ธ.ค. ตรวจสัปดาห์ 7 ธ.ค. ขึ้นเว็บจริงไม่เกิน 18 ธ.ค. | อ่านและอนุมัติคำตอบ 68 ใบ, บอก "เอาขึ้นได้" |
| 6 | ชุดทดสอบเครดิต AI ที่เคยว่าจะแดงวันที่ 1 พ.ย. | ไม่มีผลกับลูกค้า | ไม่เร่ง | ไม่ต้องทำอะไร: แก้ไปแล้วตั้งแต่ 1 ต.ค. |

## Findings that change urgency

1. **Item 6 is already fixed.** Commit 6cd02ffee (2026-10-01 13:13 Bangkok, "make five specs that expire
   before 2027 independent of the real date") replaced the 30-day renewal fixture with one whole calendar
   month. The content is in `main`'s tree. The 2026-10-01 sweep note was written about 20 minutes before
   that commit. By reading, the spec does not fail on 2026-11-01. No pin is needed. An optional Date-shift
   proof run is described below.
2. **Item 2 cannot be a stack change set.** Neither `mangmee-kamal-production` nor `mangmee-kamal-uat`
   contains the ALB or its listener. Both stacks only add listener rules to hard-coded listener ARNs. The
   restoration of 2026-10-09 created the ALB and its "default503" HTTPS listener with owner authority,
   outside these stacks. **UAT has the same problem.** A probe with a non-matching Host header returns
   `503 UAT restoration in progress`. Once item 3 is done, that is the text outsiders will see on
   `uat-ai-origin`, so fix both listeners in item 2, before item 3.
3. **Item 3 has a small running cost.** An Elastic IP is billed as a public IPv4 address even while the
   host is stopped: about 0.005 USD/hour, about 3.6 USD/month. Paused UAT pays that every hour, against
   about 0.10 USD for 20 running hours with today's auto-assigned address. (This is AWS's public rate;
   check current pricing.) The owner decides.
4. **Item 1 tooling is not in git.** `infra/kamal/power-uat` is absent from `main` 6c54ba208. So is the
   README anchor that the runbook cites (`#uat-power-and-cost-plan-a--october10`). The tool lives only in
   the owner's working checkout, which this plan did not read. Confirm where it is before the window.
   Landing it in git is a separate follow-up.
5. **Item 1 is the first real-browser check of the narrated walkthrough.** The homepage memory records
   that browser autoplay/visual QA was blocked during development
   (`docs/agent-memory/public-home-content-copy.md`). The UAT browser check is therefore a real gate, not
   a formality.
6. **Item 1 and item 5 cannot use the hotfix path.** Hotfix paths allow only `docs/`, `src/**/*.{ts,tsx,js,jsx,css}`,
   e2e specs and raster images under `apps/web/public/assets/`. Item 1 ships `apps/web/public/home/*.m4a`
   and `home-faq.json`. Item 5 must re-pin `apps/web/src/features/public-home/home-help-v6.json`. Both
   need the normal UAT → Production path, so item 5 must not be left to the last days. The deadline falls
   on a weekend.
7. **Item 4 may not be the biggest key risk.** A 2026-09-01 note
   (`docs/agent-memory/owner-line-qr-expired-workaround.md`) says the laptop profile `thawatchai` is a
   **root access key**, "to be deleted". The 2026-10-09 restoration record instead describes an expiring
   owner login session with MFA. Find out which it is. A static root key outranks the `...7DOT` rotation.
   It is not covered by the 2026-10-21 MFA guardrails.

## Common preconditions

- The owner is at the keyboard. He has typed the MFA code for each profile the window needs, with
  `aws sts get-caller-identity --profile mangmee-kamal-uat` and `--profile mangmee-kamal-production` in his
  Terminal tab (from memory `aws-deploy-needs-owner-mfa-code`). Each profile prompts once, and the CLI
  cache then serves the release tooling for 8 hours.
- Peer sessions are told "freeze main and develop until UAT and Production are done", not just "deploy
  starting". On 2026-10-20 a peer push during a prepare made the apply refuse.
- Create a fresh controller worktree from `origin/main` and link the private `.env.kamal` into it.
  `/private/tmp` worktrees rot. `power-uat` must be run from wherever it actually lives (see Finding 4).
- No other release, power or stack operation is running, and no stale `active.json` is present.

## Recommended order

| Window | Items | Owner presence |
|---|---|---|
| A — next session the owner can give about 1.5–2 hours | 1 (UAT, then Production) → 2 (both listeners) → 3 (UAT allow-list, while UAT is still running) → pause UAT | MFA codes at the start, the go, Production sign-in, approval of the item 2 and 3 changes |
| B — Wednesday 2026-11-04 (start of day, no MFA session cached) | 4 (first half); delete the old key at least 24 h later | Owner does every key step |
| C — reminder Tuesday 2026-12-01; review week of 2026-12-07; ship by Friday 2026-12-18 | 5 | Owner reviews 68 cards, gives the go, signs in |
| Any time, local only | 6 (optional proof run) | none |

---

## Item 1 — Release today's homepage to UAT, then Production

**Goal.** Serve `main` with commit 789547f9b ("feat(home): refine homepage copy and add narrated receipt
walkthrough"; develop twin e879d5561). The diff against serving Production `8d7cdca01` is 10 web files
under `apps/web/src/features/public-home/` plus `apps/web/public/home/mangmee-receipt-story.m4a`
(208,995 bytes), and documentation/evidence. There are no migrations and no API/AI/worker code. None of
the 10 files is hashed in the W00 manifest (`grep -c public-home` = 0), so no manifest refresh is needed.

**Baseline (anonymous probes 2026-10-23 16:16Z).** `https://mangmeeplus.com/home/mangmee-receipt-story.m4a`
returns 404 (`cf-cache-status: DYNAMIC`, so the 404 is not edge-cached). `/` returns 200. It contains
"เทียบทุกแพ็กเกจ" twice and "AI อ่านใบเสร็จผิดได้ไหม" 5 times. It has 0 references to
`mangmee-receipt-story` and 0 of the new question "น้องมั่งมีอ่านใบเสร็จผิดได้ไหม". UAT answers 504 (paused).

**Preconditions.**

- The common preconditions, with both MFA profiles fresh.
- Run `node infra/security/sync-production-maintenance-release-pins.mjs --check` on the release worktree
  (runbook §2). It was not run while writing this plan because the check was refused by the session's
  permission policy. Stale pins broke a release round before, and this commit touched `apps/web`.
- Optional, by the owner's sizing rule: one web unit suite run. The homepage specs (26/26) and
  `tsc --noEmit` were recorded green by the author. The full web suite was not recorded.
- The UAT resume baseline is source `8d7cdca01`. That is the `sourceCommit` in the private
  `.env.kamal/uat/power-runtime.json`, written by the latest pause `20261022T133726Z-0bf75cba`. The runbook
  heading "Current UAT power state — paused 2026-10-22" still names `733f77864`, from the earlier pause
  `20261021T180137Z-0ccc30e3`. Reconcile that heading when recording this round. `power-uat start`
  restores exactly the saved baseline. The release then moves UAT to current `main`.
- The owner chooses the UAT acceptance mode, and the same flag goes on the preflight, the prepare and the
  apply. The release tool refuses a UAT command without one, because the UAT target enrolls
  `browserAcceptanceUserId` but no `acceptanceCredentials` (`validate_acceptance_target`,
  `infra/kamal/release.py`):
  - `--uat-smoke-acceptance` needs no login. It is the mode the recent UAT rounds in the runbook used.
  - `--uat-browser-acceptance` needs his sign-in on UAT.

**Steps.** Commands come from the cloud runbook and `infra/kamal/README.md`. `[OWNER]` marks steps
that only the owner can do.

1. `[OWNER]` MFA codes for `mangmee-kamal-uat` and `mangmee-kamal-production`.
2. Start UAT: `python3 infra/kamal/power-uat start` (scoped UAT profile). Wait for `UAT_RUNNING_OPEN`.
   Record the power operation ID.
3. Read-only preflight: `infra/kamal/deploy-uat --profile mangmee-kamal-uat --uat-smoke-acceptance`.
   Use `--uat-browser-acceptance` instead if the owner chose browser acceptance. Steps 4 and 5 then use the
   same flag.
4. Prepare, then publish images:
   `infra/kamal/deploy-uat --profile mangmee-kamal-uat --prepare --publish-images --uat-smoke-acceptance`.
   Expect `PREPARED_NO_DEPLOYMENT`. Record the prepare operation ID and confirm that the pinned source is
   the expected `origin/main`.
5. Apply:
   `infra/kamal/deploy-uat --profile mangmee-kamal-uat --apply --prepared-build <prepare-run>/build --uat-smoke-acceptance`.
   Expect a signed `ACCEPTED_LINE_DEFERRED`. Record the apply operation ID, its run directory
   `.env.kamal/uat/runs/<id>`, the seconds, and the AgentCore UAT endpoint/version it reports.
6. UAT verification (all must pass; see below).
7. Prepare the Production promotion, which makes no deployment:
   `infra/kamal/promote-prod --profile mangmee-kamal-production --uat-release .env.kamal/uat/runs/<uat-apply-id> --production-browser-acceptance --prepare`.
   `--uat-release` takes the run PATH, not the bare ID. Expect `PREPARED_NO_DEPLOYMENT` in about 1 minute.
8. `[OWNER]` Message him in plain Thai: what goes live, that he must sign in when told, and that the
   window closes 24 hours after the UAT signing. Wait for an explicit go.
9. Apply the promotion:
   `infra/kamal/promote-prod --profile mangmee-kamal-production --uat-release .env.kamal/uat/runs/<uat-apply-id> --mode normal --production-browser-acceptance --apply`.
   Do not add `--prepared-build`, which a promotion refuses.
10. `[OWNER]` When the run reports website-ready (`AWAITING_BROWSER_ACCEPTANCE`), ask him to sign in at
    `https://mangmeeplus.com` right away. Acceptance must start within about 5 minutes of website-ready.
    If the wait is long, reopen the release's own tunnels on its local ports before writing
    `browser-acceptance.json` (lesson of 2026-10-05 and 2026-10-20). Expect a signed
    `ACCEPTED_LINE_DEFERRED`.
11. Production verification (below).
12. Do item 2 and item 3 now if the window allows. Otherwise pause UAT now:
    `python3 infra/kamal/power-uat pause`, and expect `UAT_POWER_PAUSED_WITH_DATABASE`. UAT power pauses are
    the owner's call: confirm he wants it paused.

**Verification.**

- UAT (`https://uat.mangmeeplus.com`):
  - `/home/mangmee-receipt-story.m4a` returns 200, an `audio/*` content type and `Content-Length: 208995`.
  - A `Range: bytes=0-1` request returns 206. iOS Safari needs range support for audio.
  - `/` returns 200. "เทียบทุกแพ็กเกจ" is absent. "น้องมั่งมีอ่านใบเสร็จผิดได้ไหม" is present and "AI อ่านใบเสร็จผิดได้ไหม"
    is absent. The page references `/home/mangmee-receipt-story.m4a`.
  - `/login` returns 200, health is OK, and platform access is `OPEN` (the release tool also checks these).
- UAT in a real browser at 390 px and 1280 px (both mandatory, `docs/guidelines/thai-ux-standard.md:114`)
  and at about 1556 px (the owner's own width), looking at a picture of each. This is the first
  real-browser QA of the autoplay (Finding 5):
  - The walkthrough section renders and muted playback starts once on scroll-in.
  - The sound toggle works, pause/resume works, and blocked autoplay shows the manual-start hint.
  - There are no CSP errors in the console (`default-src 'self'` covers same-origin media) and no sideways
    overflow.
  - UAT is on the Halloween theme. Check the default theme too if it can be switched back afterwards.
- Production (`https://mangmeeplus.com`): the same HTTP probes as UAT. Note the `.m4a`'s `cf-cache-status`
  and `cache-control`; today `robots.txt` is edge-cached for 4 hours. If the edge caches the audio, any
  later change to it must use a new file name. Never overwrite a served file.
- Production release readback, as in previous releases: the signed result, the owner's ten browser
  checks, public `/`, `/login` and platform access 200/OPEN, and 0 level-50 log lines in 15 minutes on
  every container.

**What to record.**

- One new entry at the top of `docs/runbooks/cloud-environment-operations.md`, plus this task memory:
  - the power-uat start/pause operation IDs;
  - the UAT prepare and apply operation IDs and their seconds;
  - the Production prepare and apply operation IDs, their seconds and the website-ready time;
  - the AgentCore endpoint/version on both environments;
  - the source SHA;
  - UAT/READY/PROD workflow IDs `NOT_DISPATCHED` (local Kamal path);
  - the owner's go in his words.

**Rollback.**

- No data or migration is involved. The rollback is a revert commit through the same UAT → Production
  path, about 1 hour. Explicit `--rollback` is for migration-free hotfix operations only.
- A failed apply is reconciled, not retried. Read `result.json`, read the host, release the lock only with
  the owner assertion when nothing changed, and retire `active.json` into the run directory
  (`infra/kamal/README.md`, "Evidence and failure").

**Stop conditions.**

- `power-uat start` does not end `UAT_RUNNING_OPEN`. Reconcile that exact operation; no second start.
- Any prepare phase fails. Stop at that boundary. Two exceptions:
  - host-storage-capacity on the UAT host: deleting old release images there is pre-approved; keep the
    running image and the one before it;
  - the ECR scan gate reports a new CRITICAL/HIGH CVE: this needs an owner waiver with an approval ID.
- The apply ends `FAILED*` or `FAILED_RECONCILIATION_REQUIRED`. Reconcile; never run a second apply.
- Any UAT verification fails (audio not 200, old table present, autoplay broken). Do not promote. Fix,
  then do a new UAT round.
- A peer pushes to main during the prepare/apply. The apply refuses; prepare again from the new main
  after checking what landed.
- The owner gives no go, or cannot sign in within the window. Stop after step 7. A UAT receipt older than
  24 hours means a fresh UAT run.
- Production prepare stops at host-storage-capacity. Production cleanup opens SSM sessions that e-mail
  the owner, so announce it and ask first.

**Risk.** Low. The change is public-page content and one static file. Kamal rollouts keep serving
throughout.

**Duration.**

| Step | Time |
|---|---|
| UAT start | 5–10 min |
| UAT prepare with images | 7–9 min |
| UAT apply | 6–7 min |
| UAT checks | about 10 min |
| Production prepare | about 1 min |
| Production apply, including the owner's sign-in | 6–14 min |
| Production checks | about 5 min |
| UAT pause | 5–10 min |
| **Total** | **about 55–75 min plus waiting for the owner** |

---

## Item 2 — Replace the ALB default "… restoration in progress" response

**Goal.** Requests that match no listener rule get a neutral body instead of "Production restoration in
progress" (Production) or "UAT restoration in progress" (UAT). This includes every outsider on
`ai-origin` since the 2026-10-21 allow-list. Keep status 503 and `text/plain` and change only the
message body. A 503 keeps the API's existing error mapping if an API host ever loses its EIP.
Suggested body: `Service unavailable`. The owner picks the words.

**Where it is defined (verified by reading).**

- It is not in the repo. `git grep "restoration in progress"` finds only the memory note.
- It is not in either stack template (`~/.codex/edge-operations/20261021-ai-ingress/production-template-active.json`,
  `20261021-uat-role/template-mfa.compact.json`). Their ELBv2 resources are only `ListenerRule` and
  `TargetGroup`.
- The listener ARNs are hard-coded in the rules:
  - Production `arn:aws:elasticloadbalancing:ap-southeast-1:311414082667:listener/app/mangmee-production-gateway/d6bafd8004eb771b/ed822f84961d7885`
  - UAT `arn:aws:elasticloadbalancing:ap-southeast-1:311414082667:listener/app/mangmee-uat-gateway/b6a50da4251b1b58/14790ac86738e3eb`
- `docs/agent-memory/production-offline-restore-2026-10-09.md` records that the ALB was created with a
  "default503" HTTPS listener during the owner-authority reconstruction. The private helpers are in
  `~/.codex/offline-restores/20261009-production/` (not read here). UAT followed the same pattern.
- Only HTTPS listeners exist. Port 80 on both AI origins does not answer.

**Preconditions.**

- The owner's `thawatchai` profile is usable. Deploy profiles cannot read ALB rules (runbook,
  2026-10-21 section).
- Confirm that no stack owns the listener: CloudFormation `DescribeStackResources` by physical resource
  ID for each listener ARN must return "not a stack resource". If a stack does own it, stop and plan a
  change set instead.
- Create a new private folder `~/.codex/edge-operations/<date>-alb-default-text/` with intent/before/after
  files, mirroring the change-set evidence pattern.

**Steps.** There is no runbook command for this, so they are described rather than written out.

1. Read each listener's full description (`DescribeListeners`) into `before-<env>.json`. Confirm that
   the default action is a single `fixed-response` with 503, `text/plain` and the old body, and record the
   certificate and SSL policy.
2. Write the exact replacement (only `DefaultActions`, a single fixed-response with 503, `text/plain` and
   the new body) into `intent-<env>.json`.
3. `[OWNER]` He approves both intents as shown.
4. UAT first: one `ModifyListener` call that changes only the default actions on the UAT listener. Every
   property that is not specified (port, protocol, certificates, SSL policy) stays unchanged. Read back.
5. Production: the same, once. Read back.

**Verification.**

- Anonymous probe with an unmatched Host header (`-H 'Host: default-probe.invalid'`) on
  `https://ai-origin.mangmeeplus.com/` and `https://uat-ai-origin.mangmeeplus.com/` returns 503 with the new
  body.
- Plain `https://ai-origin.mangmeeplus.com/` from outside also gets the new body.
- From both Production API containers: AI agents with the real key 200, without the key 401 (allow-list
  intact).
- Public `/`, `/login` and platform access are unchanged. The listener rules are byte-identical to before.

**Rollback.** The same call with the saved old body from `before-<env>.json`. No instance, target or rule
is touched.

**Stop conditions.**

- A stack owns the listener.
- The default action is not the single fixed-response that was expected.
- The readback shows any change besides the body.
- Any public check regresses.

**Risk.** Very low. Only the response for unmatched requests changes.

**Duration.** About 15 minutes for both.

---

## Item 3 — Source-IP allow-list for UAT `ai-origin`

**Goal.** Mirror the Production pair of 2026-10-21 (`ai-ingress-20261021-prod-stage` / `-prod-active`).
Only the UAT API host may reach `uat-ai-origin`. Everyone else gets the ALB default response from item 2.

**Facts (from the private templates).**

- UAT has one API host, `ApiServer` (`i-0248e3a31d9b75ad1`, 10.92.0.10, `AssociatePublicIpAddress: true`),
  and one AI/workers host, `AiServer` (`i-0ef193d594e475a65`).
- `AiUatRoute` (priority 261) has only a host-header condition `uat-ai-origin.mangmeeplus.com`.
- Only the API calls the AI gateway (`AI_GATEWAY_INTERNAL_URL`). Workers have no AI gateway URL. The web
  only lists the AI URL in CSP. Production has worked with the API-only allow-list since 2026-10-21.
- UAT targets use the SSM transport, so the release tool matches hosts by private address. A public IP
  change does not break enrollment.
- The current UAT template should equal `20261021-uat-role/template-mfa.compact.json`. That is the
  SEO-stage template plus only the `DeployRole` MFA change.

**Preconditions.**

- UAT is running (it is needed for verification); best right after item 1 and item 2.
- No release or power operation is in progress. Associating the EIP changes the API host's public address
  and drops its open outbound connections for a moment.
- Confirm from the private enrolled UAT config baseline that the API's `AI_GATEWAY_INTERNAL_URL` is
  `https://uat-ai-origin.mangmeeplus.com/v1`. The AI internal URL must end in `/v1`
  (`infra/kamal/README.md:237`, `infra/kamal/release.py:222`).
- Schedule the change when no UAT LINE traffic is expected, and tell any testers. A request that was
  admitted and then refused at the ALB during the change leaves a LINE AI credit hold. UNRESOLVED holds
  keep counting until evidence or an audited operator decision closes them
  (`apps/api/src/modules/line-ai/application/company-ai-budget-reservation.ts:260`). A refused receipt
  OCR surfaces as `AI_GATEWAY_ERROR_<status>`
  (`apps/api/src/modules/expenses/infrastructure/receipt-ocr.client.ts:186`).
- `[OWNER]` He accepts the EIP cost (Finding 3).
- Private folder `~/.codex/edge-operations/<date>-uat-ai-ingress/`, containing a copy of
  `20261021-ai-ingress/ai-ingress-cfn-prod.py` adapted to:
  - stack `mangmee-kamal-uat`;
  - change-set names `ai-ingress-<date>-uat-stage|active`;
  - parameter `EnableUatRoutes` with `UsePreviousValue`;
  - expected stage change exactly `[('Add','ApiEip','AWS::EC2::EIP')]`;
  - expected active change exactly one `Modify AiUatRoute`, `Replacement False`, Details only `Conditions`.
- Three compact templates:
  - `before`: the current `get-template`. It must equal the expected template, or reconcile first.
  - `stage`:
    - add `ApiEip` with `Domain: vpc`, `InstanceId: {Ref: ApiServer}`, and tags Environment uat / Name
      mangmee-kamal-uat / ManagedBy CloudFormation / Component application-runtime / Purpose "fixed source
      address for the AI origin allow-list";
    - add output `ApiFixedPublicIp: {Ref: ApiEip}`.
  - `active`: `AiUatRoute` conditions gain
    `{Field: source-ip, SourceIpConfig: {Values: [{Fn::Sub: '${ApiEip}/32'}]}}`.

**Steps.** These use the helper's own usage line,
`python3 <helper> create|review|execute|status stage|active`, run with the owner's profile as on 2026-10-21.

1. `create stage`, then `review stage`. The helper asserts that the template equals `before`, that the
   stack is `UPDATE_COMPLETE`, and that the change list is exact.
2. `[OWNER]` He approves the reviewed stage change set.
3. `execute stage` (it executes once, through an exclusive intent file). Wait for `UPDATE_COMPLETE`. Read
   the new EIP and confirm that the instance's public IP equals it.
4. Check that the API host still reaches `uat-ai-origin` through its new address. Expect agents 200 with
   the key and 401 without it (from inside the API container).
5. `create active`, then `review active`.
6. `[OWNER]` He approves.
7. `execute active`. Wait for `UPDATE_COMPLETE`.
8. Pause UAT if the owner wants it paused (item 1, step 12).

**Verification.**

- Outsider: anonymous `https://uat-ai-origin.mangmeeplus.com/` and `/v1/internal/...` both return 503
  with the item 2 body. Before this item they returned app responses (401).
- From the UAT API container, as in the 2026-10-21 readback:
  - `GET /internal/ai/agents` returns 200 with the real key and 401 without it;
  - a malformed body returns 400;
  - one receipt OCR through API→AI succeeds.
- Both UAT ALB targets are healthy and the template readback equals `active`.
- Read the UAT LINE AI credit holds created during the change window, in the system's AI-credit holds
  view (`PartnerAiCreditHoldsUseCase`). Expect none UNRESOLVED. Search the API logs of that window for
  `AI_GATEWAY_ERROR_` and expect none.
- After the next `power-uat pause` and `start`, the EIP is still associated (EIPs survive stop/start) and
  the API→AI check still passes.

**How a replaced host keeps its EIP.**

- The EIP resource names its instance by `Ref ApiServer`. If CloudFormation ever replaces `ApiServer`
  (for example a new AMI, subnet or private IP), CloudFormation re-associates the same EIP resource with
  the new instance. The address stays the same, because only the EIP resource's `InstanceId` changes.
- UserData updates restart the instance but do not replace it.
- The address changes only if the EIP resource itself is removed, replaced or released. Never release it
  by hand.
- If a host is ever rebuilt outside CloudFormation, associate the same EIP with the new instance before
  starting the API. Otherwise LINE AI and OCR on that environment stop (same rule as the runbook gives for
  Production).
- Record the address in the runbook next to the Production EIPs.

**Rollback.** Execute a change set back to the `stage` template. It removes only the source-IP condition,
and outsiders reach the app again. Removing the EIP as well is a second change set back to `before`. That
releases the address and restores the auto-assigned IP behaviour. An UNRESOLVED credit hold left by the
change is closed by evidence or by an audited operator release in the holds view. Never delete the rows.

**Stop conditions.**

- The template differs from `before`.
- A change list has anything beyond the expected entries.
- Any `Replacement` other than `False`.
- The stack is not `UPDATE_COMPLETE`.
- The API cannot reach AI after the stage step. Do not run the active step; investigate first.

**Risk.** Low. The pattern is proven on Production, and UAT has test data only.

**Duration.** About 30 minutes, including verification.

---

## Item 4 — Rotate the laptop deploy key around 2026-11-04

**Goal.** Replace the long-lived access key `...7DOT` of IAM user `watchdog-bedrock-dev` without losing
the MFA-gated release profiles.

**Facts.**

- `...EXE7` was created 2026-06-26, last used 2026-08-04 by ECS, and set INACTIVE on 2026-10-21.
- AWS allows two keys per user, so `...EXE7` must be deleted first.
- The reason for the date was not found in the repo. It is consistent with 90 days from about 2026-08-06
  (unverified). The owner can confirm `...7DOT`'s creation date in the IAM console.
- Deploy profiles cannot read IAM, so every IAM step is the owner's.

**Preconditions.**

- No release, power operation or MFA-dependent job is running.
- Do it at the start of a day, when no 8-hour MFA session is cached. The first MFA prompt after the swap
  then proves the new key. Temporary credentials already issued from the old key stay valid until they
  expire, so a cached session proves nothing.
- `~/.aws/config.bak-20261021-mfa` exists. The base profile's name is read from `~/.aws/config`
  `source_profile` lines (names only; never print values).
- Find every local copy of the old key: search the controller's and owner's local config/env files for the
  key ID ending `7DOT`, printing file names only (`grep -l`), never lines. Places to search: `~/.aws`,
  local `.env*` files, local Docker env files and the Codex configuration.

**Steps.** Every key step is the owner's own. Post each command once.

1. `[OWNER]` Sign in to the AWS console. Under IAM → Users → `watchdog-bedrock-dev` → Security
   credentials, confirm `...EXE7` Inactive and `...7DOT` Active, and note `...7DOT`'s "last used".
2. `[OWNER]` Delete `...EXE7`. This is a permanent delete, so only the owner does it.
3. `[OWNER]` Create a new access key (CLI use). Do not download the `.csv`, and never paste the secret into
   chat or into a command line.
4. `[OWNER]` Back up the credentials file with a timestamped copy kept at mode 600. Then enter the new ID and
   secret at the prompts of `aws configure --profile <base profile>`, pressing Enter to keep the region and
   output. Prompts keep the secret out of argv and shell history.
5. Verify the base profile: `aws sts get-caller-identity --profile <base profile>` shows the user ARN. STS
   needs no MFA.
6. `[OWNER]` Verify each MFA profile. `aws sts get-caller-identity --profile mangmee-kamal-uat` should
   prompt; he types a code. Then `--profile mangmee-kamal-production` with a new code (the same code cannot
   be reused). Run each once more: no prompt the second time means the cache serves the release tooling.
7. Update every other local copy found in the preconditions, or restart the local stacks that read
   `~/.aws` at start.
8. `[OWNER]` Deactivate `...7DOT`. Wait at least 24 hours, covering one normal work session with an AWS
   step if possible. Confirm that its "last used" no longer advances and nothing failed.
9. `[OWNER]` Delete `...7DOT`. Delete the credentials backup, which holds the dead key.
10. Record the dates, the last four characters of the new key and the result in
    `docs/agent-memory/security-fix-plan-2026-10-21.md` and the runbook's 2026-10-21 section.

**Verification.** Steps 5–6 pass, the next real UAT/Production operation runs normally, and the IAM
console shows exactly one active key.

**Rollback.**

| When | What to do |
|---|---|
| Before step 8 | Restore the backed-up credentials file (the old key is still active). |
| Between steps 8 and 9 | Reactivate `...7DOT`. |
| After step 9 | Create another key. With one key left, the limit allows it. |

**Stop conditions.**

- The base-profile STS call fails. Restore the backup, then investigate.
- An MFA profile denies access after a correct code. Check that `mfa_serial` and `source_profile` are
  unchanged against the config backup. Never work around it with another profile.
- An unknown consumer of `...7DOT` shows up in "last used" after the swap. Reactivate, find it, update it,
  then try again.

**Risk.** Medium: it can lock the release tooling out, though every step is reversible until step 9.
Customers are not affected.

**Duration.** About 20 minutes of owner time on day 1, and about 5 minutes for the deletion at least
24 hours later.

**Related, possibly more urgent.** See Finding 7. If `thawatchai` is a static root access key, plan its
replacement before or with this item. Options are console sign-in with MFA, a short-lived login session,
or an MFA-gated admin role. The change-set helpers use `--profile thawatchai`.

---

## Item 5 — Review the approved LINE help pack before 2026-12-27 00:00 Bangkok

**Goal.** Keep น้องมั่งมี's how-to answers alive past their review deadline with a real review, not a date
bump alone.

**Facts (from reading).**

- `apps/ai-gateway/src/modules/line-ai/agents/approved-product-help.ts:41`: the v4 record
  `PRODUCT_HELP_PACK` has `effectiveFrom 2026-09-27T00:00:00+07:00`, and `effectiveTo` and `reviewDueAt`
  both at `2026-12-27T00:00:00+07:00`. That is 2026-12-26 17:00 UTC, the night of Saturday to Sunday.
- The active pack is `PRODUCT_HELP_DRAFT_PACK`: v6, 68 cards, `APPROVED`, reviewers
  `['owner-review:2026-10-21']`. It inherits those dates through two object spreads.
- `approved-knowledge.ts:110` (`eligibleKnowledgeCards`) returns **no cards** once
  `now >= effectiveTo` or `now >= reviewDueAt`. It also returns none outside `releaseRange` 2.4.0–2.5.0,
  so do not bump `KNOWLEDGE_RELEASE`.
- After the deadline, only the approved knowledge-card answers stop. What stops and what keeps working:
  - **Stops:** no card is offered to the router or rendered. A pure how-to question falls back to the
    existing "no reviewed guide" result.
  - **Keeps answering:** registry-backed action instructions (`productHelpAction`,
    `semantic-turn-v2.ts:1276-1278`), for example how to submit or approve a claim.
  - **Unaffected:** reads, drafts and confirmations, which do not use the pack's dates.
  - **Diverges:** the website's help snapshot does not depend on dates and keeps showing, so LINE and the
    website would disagree.
- The spec that fails on purpose is
  `apps/ai-gateway/src/modules/line-ai/application/use-cases/line-ai-turn-v2.integration.spec.ts`,
  test "answers pure help from the deterministic guide boundary without control or composition". It uses
  the real clock and is run by `node scripts/run-line-ai-whole-chain-acceptance.mjs` (catalog line 354).
  **Never pin it.** It is the alarm.
- `approved-knowledge.spec.ts` uses a fixed `now` (2026-10-01) and asserts that the **v4** record keeps
  2026-12-27. Leave v4 unchanged.

**Who reviews.**

1. The controller prepares a review table in the format of
   `docs/agent-memory/line-help-cards-review-2026-10-20.md`: each card's body checked against current
   facts, with every mismatch marked. The facts to check against:
   - `TIER_FEATURE_PRESETS`, `PLAN_TIER_PRESETS` and the live billing catalog (prices; 1,999 is now
     purchasable);
   - `LINE_CHAT_ACTIONS` and `LINE_TOOL_REGISTRY`;
   - button and menu labels on the sold screens;
   - the user-guide content files behind `sourceHash`;
   - the tax cards against current rules, for example the e-WHT 1% decree 402 in backlog item 7.
2. The owner reads and approves the bodies, as on 2026-10-21. The reviewer string is
   `owner-review:YYYY-MM-DD`. An AI-only approval does not cover v6 or later.

**Steps.**

1. **2026-12-01 (Tuesday): reminder to the owner** in plain Thai, and propose a review slot.
2. Week of 2026-12-07: produce the review table, then get the owner's approval or edits.
3. Make the code change, the smallest that follows the file's existing pattern:
   - Keep the v4 record unchanged.
   - On the active pack, set `version: 7` and `reviewers: ['owner-review:<date>']`.
   - Set `effectiveTo` and `reviewDueAt` to the next deadline, for example `2027-03-27T00:00:00+07:00`
     (the same about-3-month cadence; the owner chooses). Leave `effectiveFrom` at or before the deploy
     time. The validator needs `from < to`, `review > from` and `review ≤ to`.
   - Changed bodies get their card `version + 1`. Unchanged cards keep theirs.
   - `contentHash` values are computed at load by `knowledgeCardHash` / `knowledgePackHash`, so do not edit
     them by hand.
4. Re-pin what the new pack hash and version break (one data file and four specs):
   - `apps/web/src/features/public-home/home-help-v6.json` `sourcePackHash`, after re-reviewing the
     website summaries and `llms-full.txt` for changed cards (size cap 40 KiB);
   - `home-help-v6.spec.ts` (`pack.version`);
   - `agent-tools.registry.spec.ts`:
     - the active pack version and reviewers, and the `activeProductHelpPack() === ...` identity;
     - the card version-increment assertion (`:382`, `draft.version === original.version + 1`);
     - the review-sheet assertion (`:434`, `/Status: APPROVED.*2026-10-21/` against
       `docs/agent-memory/line-help-cards-review-2026-10-20.md`). Rebind it to the new review sheet.
   - `line-ai-turn-v2.integration.spec.ts` (`/:6:expense\.status:/` → `:7:`);
   - `orchestrator.agent.spec.ts:1905` (`/:6:expense\.status:/` → `:7:`).
5. W00: `approved-product-help.ts` is hashed in
   `docs/research/mangmee-ai-capability-manifest-2026-09-27.json`. Regenerate it with
   `UPDATE_LINE_AI_CAPABILITY_MANIFEST=1 pnpm --filter @watchdog-bms/api exec tsx --test src/modules/line-ai/line-ai-capability-manifest.spec.ts`,
   then rerun without the variable for parity (memory `w00-manifest-hashes-web-files`).
6. Checks:
   - `node scripts/run-line-ai-whole-chain-acceptance.mjs` (its catalog includes the integration spec);
   - the gateway agent specs touched;
   - the web public-home specs and the web suite;
   - both typechecks;
   - `node infra/security/sync-production-maintenance-release-pins.mjs --check`.
   Then land on develop and main by direct push (owner 2026-10-20 rule).
7. Release through the normal UAT → Production path (item 1 steps 1–12). On UAT, ask a how-to question in
   LINE, for example "ยืนยันแล้วแปลว่าจ่ายแล้วไหม". The card answer must come with its source. Production
   must be live **by Friday 2026-12-18**, which leaves a week of buffer before a weekend deadline.

**Verification.**

- The integration spec stays green when run with a Date shift to 2026-12-27T00:30+07:00.
- On Production, the owner's LINE how-to question gets the card answer.
- The source reference reads `mangmee-product-help:7:<card>:<version>` in the audit trail. The customer
  only sees the card title.

**Rollback.** The previous release (v6, ending 2026-12-27) is the fallback until the deadline. After the
deadline, a rollback means no help cards.

**Stop conditions.**

- The owner has not approved the bodies. Do not ship a date-only bump labelled as a review.
- The web summaries changed without review.
- W00 parity or whole-chain is red.

**Risk.** Medium if late: the approved card answers stop on a weekend, and the hotfix path cannot carry
the `.json` re-pin. Low if done on schedule.

**Duration.**

| Work | Time |
|---|---|
| Review table | about 2 h controller |
| Owner reading | about 1 h |
| Code and re-pins | about 30 min |
| Checks | about 30 min |
| Release | about 1 h |

---

## Item 6 — AI-credit real-PostgreSQL spec and the date-rot calendar

**Goal.** Decide whether `apps/api/src/modules/line-ai/application/ai-credit-funding.pg.spec.ts` fails on
2026-11-01 UTC, and list the other date-sensitive specs with their status.

**Verdict by reading: it does not fail on 2026-11-01.**

- The reported cause was the renewal test fixture `[now-31d, now-1d]`. That fixture is only 30 days, so
  on the 1st after a 31-day month its renewal cycle was already over.
- Commit 6cd02ffee (2026-10-01 13:13 +0700) replaced it with `months(daysFromNow(-32), 1)`: one whole
  Bangkok-anchored calendar month, ending 1–4 days before `now` for any month length. The renewal invoice
  starts where that month ended. Lines 269–271 carry this, and the content is in `main`'s tree
  (6c54ba208). The later edits of 2026-10-09, 10-17 and 10-19 kept it.
- Worked example for `now` = 2026-11-01T00:00Z:
  - start = 2026-09-30T00:00Z (Bangkok day 30), end = 2026-10-30T00:00Z, so the period ended 2 days ago;
  - the renewal cycle `[Oct 30, Nov 30)` contains `now`, and grace runs to `now + 5 d`.
  For `now` = 2026-11-01T20:00Z (Bangkok Nov 2 03:00): start falls on Bangkok Oct 1, end is
  2026-10-31T20:00Z (1 day ago), and the cycle again contains `now`.
- The other fixtures are relative to the injected `now` and hold for 28- to 31-day months:
  - default "began 10 days ago";
  - boundary −45 d × 2 months, with `t0` −20 d inside cycle A;
  - promotions −40 d / −75 d;
  - gift −35 d;
  - holds −100 d / −130 d.
- The only residue is a run that straddles Bangkok midnight on a month's last day (17:00Z). There, the
  `monthKey` captured once at describe time could differ from a code path that reads the real clock. This
  window is seconds wide and not specific to the 1st.

**Decision: do not add a Date pin.** The 2026-10-01 fix (6cd02ffee) fixed the renewal fixture. The spec
passes its `now` to most calls but not all. `settle()` (line 124) omits it, so settlement uses
`input.now ?? new Date()` (`company-ai-budget-reservation.ts:832`). That remaining real-clock use is not
known to fail on any date and is left as is. Mocking `Date` in a real-PostgreSQL spec would mix mocked JS
time with the database's real `now()` defaults and the Prisma driver internals.

**If the owner still wants a pin.** The minimal form is module-level `mock.timers.enable({ apis: ['Date'], now })`
in `before()`, with `now` fixed, plus `mock.timers.reset()` in `after()`. The `t.mock` form cannot reach
the describe-level `const now`. Two drawbacks: the spec would then cover only one calendar position, and
any DB-default timestamp compared with `now` would need checking first.

**Optional proof (local only, about 10 minutes).**

- Use a disposable local test database, never the owner's trial stack. The host must be
  localhost/127.0.0.1, which the spec enforces. Its schema must be migrated. CI uses a `watchdog_p27_ci`
  database (`.github/workflows/extended-tests.yml:136`).
- Take the heavy-job mutex (`mkdir /tmp/mangmee-heavy.lock`, release in the same command).
- Run the CI line (`extended-tests.yml:175–177`):
  `AI_BUDGET_RESERVATION_TEST_DATABASE_URL=<local url> pnpm --filter @watchdog-bms/api exec tsx --test src/modules/line-ai/application/ai-credit-funding.pg.spec.ts`.
  Run it once unshifted, then with a `NODE_OPTIONS=--require <scratchpad>/date-shift.cjs` preload that moves
  `Date`/`Date.now` by a fixed offset to `SHIFT_TO`. The preload is not in the repo; write it in the
  scratchpad.
- Instants to test:
  - `2026-10-31T17:30Z` (Bangkok Nov 1 00:30);
  - `2026-11-01T00:30Z`;
  - `2026-11-01T23:30Z`;
  - `2026-12-01T00:30Z`;
  - `2027-03-01T00:30Z` (after a 28-day February);
  - `2027-03-31T17:30Z` (Bangkok Apr 1).
- Expect 16/16 at every instant. Check the reported test count (zsh unsplit-variable lesson).
- A failure only under the shift that involves a DB-default timestamp is a tooling artefact. Confirm that
  before calling it date rot.

**Date-rot calendar.** The list exists only in session memory from the 2026-10-01 sweep; it is not in
`docs/`. Status below is from reading `main` 6c54ba208.

| When it bites | Spec | Status |
|---|---|---|
| 1st of every month, 00:00 Bangkok (17:00Z the day before) | `orchestrator.agent.spec.ts`, `line-ai-turn.use-case.spec.ts` | Pinned to 2026-09-15 (`mock.timers`); both compute "today" in Asia/Bangkok (`orchestrator.agent.spec.ts:491`, `line-ai-turn.use-case.spec.ts:284`) |
| 2026-10-01 | `partner-support-tools.spec.ts` | Pinned (2 timers) |
| 2026-10-10 | `billing-end-package.spec.ts` | Pinned (6cd02ffee); date already passed |
| 2026-10-31 17:00Z | `generate-tax-filing-package.use-case.spec.ts` | Pinned (6cd02ffee) |
| 2026-11-01 and later 1sts after 31-day months | `ai-credit-funding.pg.spec.ts` | Fixture fixed (6cd02ffee); no pin needed |
| 2026-11-30 17:00Z (Dec 1 Bangkok) | `orchestrator-model-loop.agent.spec.ts` | Pinned to 2026-09-25 (6cd02ffee) |
| 2026-12-26 17:00Z (Dec 27 Bangkok) | `line-ai-turn-v2.integration.spec.ts` | Intentional product alarm; never pin (item 5) |
| 2026-12-31 / 2027-01-01 | `company-vat-registration.use-case.spec.ts` | Pinned (6cd02ffee) |
| 2027-01-01 | `orchestrator.agent.spec.ts` (sweep note: "5 ส.ค." without the year) | **Unverified.** The year-less "5 ส.ค." lines are in `prepared-simple-read-formatter.spec.ts` and take the year from the fixture `asOf` (date-independent). The orchestrator spec does stub tools with a real-clock `asOf` (line 142). Confirm with a Date-shift run at 2027-01-01T00:30+07:00 |
| 2027-06-30 | `agentcore/runtime.spec.ts` | Open; no pin; not re-verified |
| 2030 | `data-rights.service.spec.ts` (dueAt 2030-09-01), `partner-support-tools.spec.ts` (2030-01-01 terms) | Open; far future |

**Risk.** None for customers. **Duration.** About 10 minutes for the optional proof run. No code change.

---

## Evidence gathered for this plan

- Anonymous HTTPS probes, 2026-10-23 16:16–16:18Z:
  - `ai-origin` returns `503 text/plain` "Production restoration in progress" (34 bytes, `server: awselb/2.0`);
  - `uat-ai-origin` returns 504 (paused hosts);
  - an unmatched Host header returns `503 Production restoration in progress` on the Production ALB and
    `503 UAT restoration in progress` on the UAT ALB;
  - port 80 does not answer on either AI origin;
  - the homepage markers are as listed under item 1;
  - Production CSP is `default-src 'self'`.
- Two further anonymous GETs went outside the three hosts named for this task: `uat.mangmeeplus.com`
  (504) and `uat-origin.mangmeeplus.com` (301). Both are our own hosts.
- `~/.codex/edge-operations/` was read only:
  - the 2026-10-21 Production ai-ingress helper, its intents and reviewed change lists;
  - the Production and UAT templates;
  - the UAT MFA template.
- Not done:
  - the release pins `--check`, refused by the session's permission policy;
  - any AWS read;
  - reading `power-uat` (not in git) and `~/.codex/offline-restores/` (outside this task's allowed reads).
