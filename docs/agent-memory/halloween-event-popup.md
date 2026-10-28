# Agent Memory: Halloween event popup

Status: COMPLETE — UAT and Production verified 2026-10-28 14:06 Bangkok; final docs-only integration recorded below.
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
Verification: 58/58 public-home checks, full web 5,084/0, Next typegen and TypeScript pass. Corrected UAT and Production real-browser checks at 390/1280 pass: campaign auto-open, X/Escape/backdrop dismissal retaining URL and usable homepage, manual reopen, refresh, ordinary homepage manual entry, actual card draw, no horizontal overflow, three unchanged mailto anchors and zero browser errors. Caption/QR point to the campaign. Both releases are signed/verified with exact immutable artifacts, customer OPEN/deep readiness and all owned SSM cleanup passed. Production current-administrator identity/permission, live/canOpen/OPEN, logout204 and postlogout401 verified; browser/server-log evidence limits are recorded below. One unchanged API-security alarm is explicitly accepted for this release. LINE messaging, physical-device social posting and current alarm cause/delivery remain unexercised.
Next: none.

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
- Corrected candidate `8ee5e737e0b90ded61fb7955a5fe9c583dfd2f3c`, tree `3ba8534075c0391c46c6693d4ec9415851ba67f0`; Sol atomically fast-forwarded both remote branches after fresh no-active-operation checks. Branches frozen again.
- Corrected UAT prepare `20261028T063415Z-febbcba9`: PREPARED_NO_DEPLOYMENT in316.318s; all5phases and2ownedSSM cleanup passed. Source matches8ee5e737e. This is the reviewed source correction, not a duplicate run of the prior candidate.
- Corrected UAT apply `20261028T064018Z-08c3a82d`: terminal ACCEPTED_LINE_DEFERRED in251.606s; exact source8ee5e737e, signature verified, all readiness/customerOPEN pass,2ownedSSM sessions closed.
- Actual corrected UAT390/1280: auto chooser, close/manual reopen/refresh, normal homepage manual, real draw17-turbo-granny all pass. Both `/` and `/halloween` now have3proper email links, zero Cloudflare email-protection nodes, and zero browser error logs across load/reload/game. Retained `uat-hydration-after.json` and corrected screenshots; earlier failing receipt/logs preserved.
- Production promotion prepare `20261028T064700Z-ba7c1eb8`: PREPARED_NO_DEPLOYMENT in55.286s, all5phases and4ownedSSM cleanup passed; corrected UAT run only, no rebuild.
- Fresh root-read-only alarm snapshot immediately before promotion again has15OK and exactly the accepted October9 alarm (state/time/reason unchanged). Preserved `production-alarms-pre-promotion.json`.
- Production apply `20261028T064841Z-6cd1214c` running in session76231; exact corrected signed UAT artifacts, no rebuild. Branches remain frozen. Browser/customer acceptance was pending; completed below.

## Final acceptance — 2026-10-28 14:06 Bangkok

- Production `20261028T064841Z-6cd1214c` completed with exit0 and signed/verified `ACCEPTED_LINE_DEFERRED` in1,038.175s. Website ready at272.065s; browser/operator acceptance stage739.921s. All12phases passed, final readiness/API/deep DB/AI/workers/Redis/internal API checks passed, four owned SSM sessions terminated with zero failures.
- Published immutable digests for all four images match corrected UAT exactly; AgentCore artifact hash also matches. No Production rebuild. UAT accepted digest `b4f86bf0e940ccefd4f1885e4632d333bb7da36218ff0893e99f1f11709341a7`; Production accepted digest `a73526e71a98f8060bb2f5029a985d73aa49cdac4d33dfc930f0881f85f35038`. Compact hashes, timings and phases: `docs/evidence/halloween-event-popup-2026-10-28/release-summary.json`.
- Owner manually logged in as current prodmangmeeplus. Actual browser identity matches expected administrator and launch-gate permission; authenticated gate shows live/canOpen/OPEN. Actual /auth/me flags show mustChangePassword=false and legalAcceptanceRequired=false. Agent clicked logout, then observed /auth/me401, public OPEN and login marker=open. No credentials read/reset, legal action or customer-gate write.
- Current API-container HTTP logs corroborate actual browser login200, authenticated gate200, logout204 and postlogout401. No BFF Network row/login-response body is claimed. The bound operator browser attestation retains these limits; all13signed evidence-file hashes independently rechecked. Private observations remain within the ignored release directory.
- Actual Production390/1280: campaign auto-open, close retaining /halloween, manual reopen, refresh auto-open, ordinary homepage manual entry, actual draw19-jiangshi and fully loaded card pass. Loading says “กำลังเรียกวิญญาณ…”. No horizontal overflow. Both routes have3normal mailto anchors, zero Cloudflare email-protection anchors and no browser error logs. Public screenshots and sanitized observations retained.
- Post-rollout CloudWatch readback:15OK and exactly the unchanged October9 API-security ALARM. User accepted this release-specific exception; alarm unchanged. Root profile used only for the explicitly authorized alarm reads, scoped non-root role for deployment/log access. LINE messages, physical-device/native social posting and current alarm cause/delivery not exercised.
- Branch freeze can end after this signed customer acceptance. First failing UAT receipt remains retained and was not promoted. All workflow IDs remain NOT_DISPATCHED; local IDs above are authoritative. No additional build or deployment is needed for docs-only final integration.

## Final docs integration

- Owner-authorized direct atomic fast-forward integration into main and develop covers only final task memory, plan, cloud inventory and the listed sanitized release evidence under `docs/`. No application, dependency, controller or signed-evidence bytes changed; deployed application source remains `8ee5e737e0b90ded61fb7955a5fe9c583dfd2f3c`.
- Final integration follows signed terminal acceptance and cleanup. No further build or deployment is required; unrelated dirty `apps/web/AGENTS.md`, local full test logs and historical generated assets are excluded.
