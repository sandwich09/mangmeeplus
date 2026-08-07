# Agent Memory: H-09 — เลิกส่ง LINE-link bearer token ให้ third party และแก้ claim race

Status: DONE (implementation + tests + live verify + 8-angle review + fixes; checklist ticked 2026-07-18)
Owner: Claude (security remediation session, 2026-07-18)
Scope: `employee-access/domain/logic/employee-access.logic.ts`, `auth/.../complete-employee-line-link.use-case.ts`, `auth/.../link-line-identity.use-case.ts`, `auth/infrastructure/line-login-verifier.adapter.ts`, `common/http/public-api-base.ts`, `employee.controller.ts`, `system-onboarding.controller.ts`, `create-company-onboarding.use-case.ts` (comment), specs, `apps/api/package.json` (+`qrcode-generator`, +regenerate spec ลง test list)

## Decisions

- **QR local**: `buildLineLinkPackage` สร้าง QR เองด้วย `qrcode-generator@2.0.4` (zero-dependency, no install scripts, bundled types, sync API) → `qrImageUrl` = `data:image/svg+xml;base64,...` **พร้อม `<rect fill="#ffffff">` พื้นหลัง** (createSvgTag เดิมโปร่งใส — save ไปวางพื้นมืดจะสแกนไม่ได้); contract `EmployeeLineLinkPackage` เดิม ฝั่ง web `<img src>` ใช้ได้ทุกจุดโดยไม่แก้ web
- **TTL owner 72h → 24h** (`OWNER_LINE_LINK_TOKEN_TTL_MS`): QR เป็น bearer credential; หมดอายุ → SYSTEM_ADMIN reissue ผ่าน `POST /system/company-onboardings/:id/reissue-owner-line-link` (QR-only, ไม่แตะ password; ปิด chip task_4a57dd18 แล้ว 2026-07-18 — `reissue-owner-line-link.use-case.ts` + ปุ่มแยกใน SystemOnboardingNewPage; permission key เดิม `system.company_onboarding.regenerate_temporary_password`)
- **Claim ก่อน link**: CAS `{id, status:PENDING} → USED` ก่อน `linkLineIdentity` — 2 identities แย่ง QR → ผู้ชนะรายเดียว ผู้แพ้ไม่มี side effect
- **Compensation แบบ whitelist (สำคัญ)**: คืน `USED → PENDING` **เฉพาะ** `ConflictException`/`ForbiddenException` (พิสูจน์ได้ว่าเกิดก่อน identity write ใน link ที่ไม่มี transaction) — error อื่น (verify fail/timeout, transient DB) **เผา token** เพราะ (1) link อาจ persist ไปแล้ว (เช่น lineCompanyContext upsert ล้มหลัง create identity) — restore จะชุบชีวิต QR ที่บริโภคแล้ว (2) attacker ส่ง idToken ขยะเพื่อ hold token ใน USED ให้ revoke sweep (แตะเฉพาะ PENDING) มองข้าม แล้วชุบด้วย restore
- **Reissue-race reconcile**: หลัง restore สำเร็จ เช็ค token ใหม่กว่า (`createdAt > ours`) ใน membership เดียวกัน → self-REVOKE ตัวเอง (sweep ตอน reissue เห็นแค่ PENDING จึงพลาดเราไป)
- **Cardinality sever**: หลัง link สำเร็จ sever LINE identity อื่นที่ ACTIVE ของ user (findMany → updateMany by id + `AUTH_IDENTITY_UNLINK` audit ต่อแถว ระบุ severed/kept providerUserId — count เปล่าไม่พอสำหรับ forensics); sever ล้ม → ยัง success + `lineIdentitySeverFailed` ใน audit; **self-heal**: rescan-grace ของ token USED รัน sever ซ้ำ
- **Grace path จำกัดด้วย `linkedAt >= usedAt`**: identity ที่ link ก่อน claim = มือถือเครื่องเก่า — ห้ามใช้ QR ที่ใช้แล้ว เข้า grace ไป sever เครื่องใหม่ (พบตอน implement self-heal)
- **P2002 → Conflict** ใน `link-line-identity` create (race ข้าม flow LINE account เดียวกัน; นอก transaction จึง catch ได้ — [[feedback_prisma_txn_p2002_abort]])
- **Verify timeout 5s** (`AbortSignal.timeout`) — claim window ไม่โตตาม LINE API hang
- **`trustedPublicApiBase`**: จุดออก QR (employee.controller ×2, system-onboarding.controller ×2) ใช้ `PUBLIC_BASE_URL` ก่อน X-Forwarded-Host — กัน crafted XFH ทำ QR ชี้ token จริงไป host attacker; LIFF page paths อื่นยังใช้ `publicApiBase` เดิม (จำกัด blast radius)
- membership check อยู่ก่อน claim — membership inactive ไม่เผา token

## Review (8 มุมมอง → CONFIRMED 8 แก้ครบ)

restore-after-persisted-link → whitelist compensation; revoke/reissue TOCTOU + garbage-idToken resurrect → burn-on-unknown + newer-token self-revoke; sever ไม่ atomic + grace ข้าม sever → self-heal + best-effort flag; audit count-only → AUTH_IDENTITY_UNLINK ต่อแถว; XFH QR poisoning → trustedPublicApiBase; verify ไม่มี timeout → 5s; QR โปร่งใส → white rect; doc เก่าอ้าง qrserver → strike-through พร้อมคำเตือน

## Residual / accepted

- Admin **revoke แบบไม่ reissue** ตรง window claim→link ที่ล้มด้วย Conflict/Forbidden → token restore ได้ (bounded expiresAt 15m/24h; revoke ซ้ำได้; เคส reissue ปิดแล้ว); Conflict/Forbidden ไม่ใช่ของที่ attacker force ได้ถูก ๆ (ต้องมี DISABLED identity หรือ P2002 race เป๊ะ)
- Verify failure ชั่วคราว (LINE brownout) เผา QR ที่กำลัง scan — fail closed โดยเจตนา, admin reissue หนึ่งคลิก
- แลก UX: P2002-Conflict race → user เห็น 409 แล้ว rescan สำเร็จ (token ถูก restore)
- Prod ต้องตั้ง `PUBLIC_BASE_URL` ให้ host pinning ทำงาน (ไม่ตั้ง = header fallback เดิม) — ใส่ตอน batch deploy
- ~~regenerate rotate password เสมอ → chip task_4a57dd18 (QR-only reissue)~~ ปิดแล้ว 2026-07-18: `ReissueOwnerLineLinkUseCase` reissue QR โดยไม่แตะ credential (revoke PENDING → token ใหม่ 24h → audit CRITICAL `system.company_onboarding.reissue_owner_line_link`)

## Verification

- Focused specs 60/60: complete-employee-line-link 22 (claim-order, race one-winner, burn-on-unknown, forbidden-restore, self-revoke-on-newer, restore-throws burned, sever+per-row audit, sever-fail flag, grace self-heal, old-phone deny), link-line-identity (+P2002), employee-access.logic (+QR data URI/white-rect/TTL), onboarding 10, **regenerate-temporary-password 4 (ใหม่ — ลงทะเบียน test list แล้ว)**
- Full API suite **2146/2146**; typecheck clean (error อื่นเป็นไฟล์ H-11 in-flight)
- Live DB (docker :15432) `h09-live-verify.ts` 7/7 — 2-way + 10-way stampede ผู้ชนะรายเดียว, restore ครั้งเดียว, reclaim ได้
- QR สแกนจริง: rasterize SVG production (qlmanage) → decode ด้วย Apple CoreImage CIDetector ได้ link URL ตรงเป๊ะ (ทั้งก่อน/หลังเพิ่ม white rect); `grep qrserver` ทั้ง source = 0

## Next

- Commit แล้ว (ดู git log H-09) — prod deploy รวม batch remediation + ตั้ง `PUBLIC_BASE_URL`
