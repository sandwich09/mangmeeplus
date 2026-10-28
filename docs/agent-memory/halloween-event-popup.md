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
