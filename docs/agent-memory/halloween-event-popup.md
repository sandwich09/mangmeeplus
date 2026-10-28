# Agent Memory: Halloween event popup

Status: LOCAL_VERIFIED; UAT/Production release authorized and being prepared, 2026-10-28.
Owner: root; Sol implements the route/modal; root reviews and verifies sharing/browser behavior.
Scope: campaign `/halloween` opens the existing three-door dialog over the public homepage; ordinary `/` remains manual.
Decisions:
- Closing leaves `/halloween` unchanged and the homepage usable; normal rerenders do not reopen it. Refresh/new entry opens it again while Halloween is active.
- Theme-off bare `/halloween` shows the normal homepage without any event. Preserve unknown-card and disabled direct-card not-found behavior, server theme checks and development-only preview.
- Eyebrow: “กิจกรรมฮาโลวีนจากมั่งมีพลัส”; heading: “ก๊อก ก๊อก… กล้าเปิดไหม?”; description: “หลังประตูนี้มีเรื่องหลอนรออยู่ เลือกบานที่อยากลองได้เลย”. Omit “เล่นฟรี ไม่ต้องสมัครสมาชิก”.
- Shared links and QR lead to `/halloween`; visible image branding remains `mangmeeplus.com`. Pure saved PNGs and existing unsigned metadata stay unchanged.
- No audio without a user gesture; selecting a door/manual entry may start it, and dismissal/unmount stops it. No storage, participant records, backend changes or dependencies.
Open questions: none. Owner explicitly authorized UAT+Production after completion. Follow the mandatory release protocol; prior accepted release is recorded separately.
Artifacts: existing activity/mirror specs, route/modal/share source, `docs/evidence/halloween-event-popup-2026-10-28/`.
Verification: 57/57 public-home checks; full web 5,083/0; Next typegen and TypeScript pass. Actual IAB at 390/1280 shows correct chooser, no horizontal overflow, X/Escape/backdrop close, retained URL and usable homepage, manual reopen, refresh auto-open, normal `/` manual entry, theme-off homepage and gated unknown/disabled card paths. Actual copied caption has campaign URL and LINE; QR decoded at actual 148px export size to campaign URL. No physical-device/social-posting claim. Development React performance-measure timestamp warnings were observed during route navigation; product interaction passed. Verify built UAT again.
Next: scoped commit/direct branch integration, prepare/apply UAT, exercise actual UAT, promote exact signed artifacts to Production, current administrator/OPEN/logout acceptance and signed cleanup.

## Release authorization and preflight

- Owner: “เสร็จแล้วขึ้น uat+prod ได้เลยนะ”. Earlier direct main/develop integration without PR authorization remains applicable.
- Production MFA refreshed by owner; scoped deploy role identity verified. UAT scoped role valid.
- Root `thawatchai` authorized only for CloudWatch Alarm reads for this release after scoped role denied DescribeAlarms. Readback: 15 OK, one existing API security ALARM with unchanged 2026-10-09 transition/reason. Owner explicitly accepted a new release-scoped exception: “ปล่อยต่อ บันทึกข้อยกเว้น Alarm เดิม”. No alarm modification, suppression or cause/database recheck.
- No running GitHub release flows; historical zero-job queued READY31611733340 is unchanged and not this release. Workflow UAT_RUN_ID / READY_RUN_ID / PROD_RUN_ID: NOT_DISPATCHED (local Kamal). Candidate/controller/local operation IDs will be recorded below.

## Exact release ledger

- Source/candidate: `d8ba53da9cbf73bf01bc9ad34f99f10f48db9d98`; reviewed tree `13448ee65983e7e8f8617f125971f30bbe7a85e2`. Sol atomically fast-forwarded both main/develop from `e608a8bc...`; independent readback matches, branches frozen. No PR/force push or unrelated AGENTS changes.
- UAT prepare: `20261028T061641Z-b41cb3b2`, PREPARED_NO_DEPLOYMENT in260.854s; all5phases pass, source matches candidate, both owned SSM sessions terminated. Controller hash `da915391c7e6b0ed488add2e655631a44f43f866304caebcc9584faa3e8aa080`.
- Production read-only preflight `20261028T061802Z-00b45d95`: passed20.51s, all4ownedSSM sessions terminated; no mutation.
- UAT apply `20261028T062112Z-902951de` launched using the exact prepared build; process session92823.

## UAT application boundary — retained first result

- UAT operation `20261028T062112Z-902951de` is terminal/signed ACCEPTED_LINE_DEFERRED in263.034s, source d8ba53da9; both ownedSSM sessions terminated. Infrastructure/deep readiness and publicOPEN pass. Actual chooser, dismissal/reopen/refresh and draw21-chonggak-gwishin work at390/1280.
- Browser logs nevertheless show React418 text hydration mismatch on both new `/halloween` and ordinary `/`. Stop before Production promotion. Do not treat this signed infrastructure receipt as final application acceptance or promote it.
- Root observed initial public email anchors replaced with `/cdn-cgi/l/email-protection` and `[email protected]`, then corrected by React client recovery. Three PublicHome mailto links are unguarded. Local/server image date formats and deterministic initial countdown were checked; no clock mismatch identified.
- Root cause: Cloudflare email obfuscation changes SSR markup before hydration. Official documented per-address `<!--email_off-->...<!--/email_off-->` guard avoids rewriting these existing public contact links. Sol adds one static trusted markup helper at all3sites and a focused rendered regression. No cloud configuration, CSP relaxation, data mutation or warning suppression.
- Source correction requires a new exact UAT build/release after local checks; retain the first receipt and all failure evidence. No active controller or unresolved transport remains. Owner's current release authorization and existing-alarm exception still govern this same release.
- Correction verified locally: one no-props static HomeContactEmail helper, three literal guarded anchors. No dynamic HTML input. Public-home58/58, fullweb5084/0 and Next typegen/TypeScript pass; live local DOM retains the exact guards and three unchanged mailto links. Actual first-UAT console error logs retained in `uat-hydration-before.json`. A terminal public-HTML read returned403 and was not retried; browser observations provide the live evidence.
