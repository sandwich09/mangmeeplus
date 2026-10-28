# Agent Memory: free-expense-drafts

Status: DEPLOYED TO UAT — signed normal-mode release and migration/deep readiness passed; authenticated UAT business journey pending
Owner: thawatchai
Scope: ร้านเปิดสำเร็จที่ยังไม่เคยซื้อแพ็กเกจ อ่านเอกสารรายจ่ายฟรี 3 ใบต่อบริษัท/เดือน ใช้ร่วมเว็บ/LINE; ดู/แก้ source drafts; no-model commands; guard/copy correctness

Decisions:
- ผู้ใช้เริ่มจาก discussion → spec/plan/audit → อนุญาต “implement ได้เลย ให้ luna sol ช่วยตามความเหมาะสมของงาน” วันที่ 2026-10-28
- ไม่รวมคนยังไม่เปิดร้าน ร้านเคยซื้อแล้วหมดอายุ ร้าน admin/security hold หรือ purchase evidence ที่ไม่ชัดเจน
- ไม่ต้อง opt-in ไม่ส่งข้อความชวนใช้ฟรี/ซื้อ ใบ 1–2 ตอบผลปกติ ใบ 3 แจ้งครบจาก success ที่บันทึกแล้ว; ครบแล้วยังดู/แก้ร่างเดิมได้
- ไม่มี free open chat/semantic edits/manual empty expense/final review/approval/payment/post/export; OCR เป็นข้อยกเว้นที่ใช้ cost/rate/switch เดิม
- ไม่เปลี่ยน company lifecycle/term/paid grants หรือ active legacy trial/manual/grandfathered เพื่อให้เข้าฟรี
- ใช้ Ponytail full จาก .agents/skills/ponytail/SKILL.md (hardcoded path /Users/spare058/WatchDog-BMS/... ไม่พบ)
- Sol ดู access/auth และ quota/capture; Luna ดู web; root รวม LINE/source writers/copy/docs ตามที่ผู้ใช้อนุญาต ไม่ใช้ legacy role-gate
- Preserve pre-existing dirty working tree; ไม่มี package.json change, dependency, commit, push หรือ cloud/deploy action

Implementation:
- Shared eligibility ตรวจ all historical billing accounts/invoices/grants/package requests/sales attribution และ term-only disable audit; intersect active membership/branch/permissions + exact HTTP routes
- Source-only WEB/LINE draft editor ใช้ CAS, source ownership/current actor, skip vendor master; ปิด financial actions แม้ caller ส่ง permissions กว้างหรือเรียก use case ตรง
- Existing CompanyOcrUsageEvent เพิ่ม quotaSource=FREE_MONTHLY_3/succeededAt; term เพิ่ม freeQuotaNoticeSentMonthKey; additive migration 20261028090000_free_expense_monthly_documents
- Admission จำกัด used+in-flight<=3 โดย company/month locks แม้ shadow mode; freeze event/source/month; exact refund/replacement identity; ไม่ refund หลัง usable result
- Source facts/usable observation และ quota completion commit พร้อมกัน; failed terminal/refund/outbox commit พร้อมกัน; free source transaction ใช้ OCR-config→Company→source lock order และ recheck actor ก่อน write
- LINE synchronous image จองก่อน storage จึงส่ง freeOcrReservation แบบ server-only ที่ผูก company/event/message/month; actual InitReceiptUpload→CreateUploadIntent ตรวจ source อีกครั้ง ไม่ปฏิเสธใบที่3เพราะ reservation ของตัวเอง
- Pending upload bounded3ต่อ frozen month ภายใน storage retention24h เดิม; retry ใช้ไฟล์เดิม ไม่เปิดคลัง pending ไม่จำกัด; multi-document file ไม่ auto-split/free handoff
- LINE text gate ก่อนโมเดล, media ข้าม semantic routerไป governed OCR; public/support/menu/company picker คง handlerเดิม; legal/opt-out/security/launch/final-action refusal ไม่ถูก free copy ทับ
- Third-success current-month notice retryจาก saved facts ไม่อ่านใหม่; web sync/async allowance projection ใช้ shared contract ไม่ claim LINE notice marker
- แก้ shell/banner/login/legal return/LINE handoff/LIFF/company switcher ให้ free landingอยู่expenses รักษา billing recovery และ paid-expired renewal; signup/FAQ ไม่อ้างว่าต้องจ่ายก่อนใช้และไม่แทรก sales CTA ใน free policy

Open questions:
- ไม่มี product decision ค้างสำหรับ implementation นี้
- Actual Chrome desktop/mobile viewport + real local HTTP/DB free-cohort journey ผ่านแล้วตาม browser evidence; ยังไม่ครอบคลุม native LINE/LIFF/guest, real provider, PDF/HEIC async UI หรือ live rollout/rollback จึงไม่รับรอง AC15 ทั้งหมดหรือ AC20 live

Artifacts:
- [Spec](../specs/free-expense-drafts-spec-th.md)
- [Plan](../plans/free-expense-drafts-plan-th.md)
- [Impact / gap audit](../research/free-expense-drafts-impact-audit-2026-10-28-th.md)
- [Verification and scoped hashes](../evidence/free-expense-drafts-2026-10-28/verification.json)
- [Quota implementation memory](free-expense-drafts-quota.md)
- Scoped amendments ใน locked-signup/term/package/OCR/credit wording/receipt UX/handoff/manual entry/support specs

Verification:
- Baseline HEAD 4a5817b4238379c2e3e3a24df996dd7168411eda; source hashes เป็น full current working-tree files รวมงานค้างก่อนหน้า ไม่ใช่ claim ว่า diff ทั้งไฟล์มาจาก taskนี้
- Final API scoped21 test files:923 tests passed,0failed,0skipped
- Final web scoped test files:344 tests passed,0failed,0skipped
- Final isolated local PostgreSQL:11 tests passed,0failed,0skipped (access/source6 + quota5); includes real history/lifecycle, source writer, actor revoke, concurrent upload, third LINE reserved upload, four-route quota race, rollback and source/month identity
- Contracts build, API TypeScript (NODE_OPTIONS=--max-old-space-size=8192) และ web TypeScript passed; default API compilerครั้งก่อน heapเต็ม แล้ว larger final check exit0
- Default-budget readiness ใช้ existing shipped SHARED total200000satang;3 mocked document reads/6 OCR calls settle165satang,0CHAT usage/0budget-grant-override writes; ไม่ใช่ผลราคา/พฤติกรรม providerจริง
- Final scoped whitespace and docs link/mapping checks recorded in evidence; ไม่รัน legacy agent:gates เพราะ plan ใหม่ไม่มี legacy role-gate
- PostgreSQL ทดสอบเฉพาะ disposable local database และหยุด container หลัง final tests; ไม่ migrate live ไม่ส่ง LINE จริง ไม่อ่าน/แก้ cloud ไม่มี paid side effectจากการทดสอบ
- ชุดก่อนหน้า overlapกับfinalrun จึงไม่บวกจำนวนagent runsซ้ำเป็นยอดรวม

Next:
- Implementation รวมเข้า main/develop แล้ว; รายงาน main-browser ด้านล่างเป็นหลักฐาน source ที่รวมจริง
- ก่อนเปิดจริง ต้องเติม native LINE/LIFF และเส้นทาง browser ที่ยังไม่ครอบคลุมตาม browser report จากนั้น follow docs/runbooks/cloud-environment-operations.md และ docs/runbooks/uat-production-v2-deployment.md เมื่อได้รับคำสั่ง deploy; เก็บ UAT/READY/Production run IDs และ signed/customer OPEN acceptance
- Rollback รักษา additive usage columns/events/drafts/attachments ห้าม dropข้อมูลเพื่อย้อน code

## Browser acceptance follow-up — 2026-10-28

Status: COMPLETE FOR SCOPED LOCAL WEB JOURNEY
- User requested actual clicking on screen after implementation.
- Chrome UI on loopback web3080 and actual API3081; separate cloned local fake-data database. No cloud deployment or real customer/provider/LINE calls.
- Root operates UI; Sol prepares real backend cohorts and local OCR provider fixture where available.
- Target cases: password login/landing, free-only navigation, source edit/save/reload, original evidence, third usable read/fourth denial, draft editing after exhaustion, paid-expired/admin-held/no-shop distinctions, narrow/mobile layout.
- Evidence and any discovered corrections will be recorded separately from prior unit/PG verification.

Results:
- Actual Chrome clicks: password login/landing, source edit with missing price, reload persistence, original fullscreen, PNG upload1/2/3 and fourth refusal, draft edit after exhaustion, mobile390×844, directmanualroute denial, retainedpaid-history and realisticpaid-expired, adminhold.
- Fixed UI leaks (substitute/export/guides), free draft count/labels, third-notice info suppression + StrictMode double-consumption, and async freeAllowance contract projection. No new API policy/state changes in browser followup.
- Final thirdsuccess notice visibly verified on desktop/mobile in a newcohort; originals never had counters reset to force a pass.
- Final web13files:395passed/0failed/0skipped; webtsc exit0. DB comparisons passed:5localfixture reads total,0actualmodelcalls, no fourthprovider/orphan, no new financial/master/paidgrant/confirmed writes.
- Evidence: [actual browser report and screenshots](../evidence/free-expense-drafts-2026-10-28/browser/README.md), [DB evidence](../evidence/free-expense-drafts-2026-10-28/browser/db-evidence-notes.md). Prior implementation verification.json remains its original snapshot; followup verification captures latest files separately.
- No usablemembership passwordfixture blocked with existing membership-denial message; this is not anonymous LINE guest coverage.
- Cleanup: signed out, viewport reset, local API/Web/OCR fixture and three task containers stopped; synthetic DB retained. Removed only task-specific generated Next dist path; preserved existing working-tree changes.

## Direct main/develop merge — 2026-10-28

- Owner authorized direct merge to main and develop without PR, then rerun checks and actual browser on main.
- Clean managed worktree starts at shared remote tip 48295b57c6219da8d58fd4eec1e12489ee04d137; original dirty checkout remains untouched.
- Feature-only patches ported onto current upstream. Prior evidence records the old checkout and is not verification of this port. Preserve upstream billing add-on accounting, LINE delivery plans, actor guards, and newer paid UI.
- No deployment is included.

- Port verification before push: API root964/964 +2 delivery-plan/source-card regressions; latest receipt/copy222/222 overlap. Access447/447, quota300/300 plus notifier75/75 updated suite (overlap), real PostgreSQL6access+16quota/add-on, web421/421. API8GiB TypeScript, web TypeScript, config/contracts builds, scoped whitespace and68 doc links pass. Default API compiler hit its4GiB heap ceiling, retried at8GiB successfully.
- Current-main integration additionally preserves signed LINE delivery plans, blocks free pending claim/payment/substitute paths, keeps free notice claim while a durable plan owns retry, uses neutral no-button signup fallback, and updates existing English policy to match Thai.

## Post-merge main acceptance

- Main/develop pushed atomically to049aa51dea4e69307f35e3f82adda544141ec5fb without PR. Local main/develop safely fast-forwarded; clean managed verification worktree now checks out main.
- Reran on that exact source: rootAPI1063, access447, quota301, realPG22, web484; all passed. Web TypeScript passed; API8GiB TypeScript passed before push with unchanged code afterward.
- Actual Chrome main journey passed: login, expense-only navigation, upload1/2/3, third notice, fourth denial, source unknown price/save/reload, mobile save after limit, original file, manual-route boundary, paid expiry, admin hold/no-membership.
- DB proof confirms3fixture reads, no fourthprovider/draft/orphan, no extra financial/master/grant writes. No real model/LINE/customer calls or deploy.
- [Merged-main browser/evidence report](../evidence/free-expense-drafts-2026-10-28/main-browser/README.md); [verification](../evidence/free-expense-drafts-2026-10-28/main-browser/verification.json).
- Local runtimes stopped, signed out and viewport reset; preserved synthetic DB/dump/evidence. Original dirty checkout untouched. Subsequent evidence commit changes docs only.

## UAT release — 2026-10-29

- Exact latest main/develop `56cdb4ee50bedf3f0c22451faf1583ffb6ec252c` deployed to retained Kamal UAT in `normal` mode. Migration `20261028090000_free_expense_monthly_documents` is additive only: three nullable columns and one index, with no drop/delete/rename.
- Prepare `20261028T165147Z-fa6b78fb` passed in 317.413 seconds. Apply `20261028T165734Z-fcdabc54` completed signed/verified `ACCEPTED_LINE_DEFERRED` in 288.906 seconds; migration/feature authority, API/DB, AI, Workers/Redis/internal API, public OPEN, retirement and SSM cleanup passed. All runtime services read back exact source `56cdb4ee5`.
- The owner-authorized UAT smoke does not claim an authenticated free-cohort web, native LINE/LIFF or real provider journey. Those remain explicit acceptance limits; no Production deployment occurred.
