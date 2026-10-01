# การจำลอง E2E ระบบผู้บริหารมั่งมีจากหน้าจอถึงหลังบ้าน

คำที่แสดงบนหน้าจอล่าสุด: [ใช้คำที่คนทั่วไปเข้าใจ](../specs/mangmee-executive-plain-language-spec-th.md) — เมนู “รายรับ”, แท็บ “ลูกค้าที่สร้างรายรับสูง”; identifiers/สูตรเดิมคงไว้

## ขอบเขตล่าสุด 2026-10-01

Owner พักและซ่อนการลบข้อมูลทั้งหมด รายการเดิม **188 เคสเป็น baseline การจำลอง** ไม่ใช่ผลรันจริง
คง ID เดิมเพื่อ trace ได้: **47 เคส DEFERRED** ได้แก่ DR-01–32, OPS-08–16, PX-07–11 และ PAY-20
อีก **141 เคสยังอยู่ในงานรายงาน/บัญชี** โดยแยกส่วนคำร้องออกจากเคสผสมตามตารางนี้; J01–J07 active, J08–J12 deferred
API11/API12 และ case summaries ใน API06 ไม่อยู่ใน current integration scope

| เคสผสม | ขอบเขตปัจจุบัน |
|---|---|
| เคส SEC-08 | ตรวจ reader ถูกปฏิเสธ API08/API10; ส่วน API11 พัก |
| OPS-03/04 | transaction rollback/retry เฉพาะบัญชี; ส่วน case พัก |
| OPS-07/17 | read ไม่มี side effects และ log ไม่เปิด PII ยังบังคับ; ไม่ทดสอบ executor |
| เคส OPS-18 | rollback/version ของ report และ account; ส่วน deletion พัก |
| FE-04/05/15 | validation/version/pending/retry ของ report/account; ส่วน case/hold พัก |
| เคส FE-16 | detail/Back/restore ของบริษัทและบัญชี; case route เดิมต้องกลับ overview ตาม HIDE-03/04 |

เกณฑ์ตรวจซ่อนฟีเจอร์เพิ่มเติม (แยกจาก baseline 188):

| ID | Expected |
|---|---|
| HIDE-01 | admin และ reader ไม่เห็นเมนู/ปุ่ม/ข้อความสิทธิ์เกี่ยวกับลบข้อมูล |
| HIDE-02 | ประวัติบริษัทที่เคยมี DR case ไม่แสดง case/reference/reason/link/create action |
| HIDE-03 | รับ saved state event ของ requests/request/new-request แล้วกลับ overview |
| HIDE-04 | เปิดเดโมใหม่พร้อม initial saved route ทั้งสามแบบแล้วกลับ overview |

ผลรันล่าสุด: **HIDE-01–04 PASS** ด้วย `check-demo.cjs`; admin/reader, 3 บริษัทที่มีเคสเดิม, state event และ initial saved route ครบทั้ง 3 เส้นทาง
HIDE เป็นการตรวจเดโม local เท่านั้น ไม่พิสูจน์ server permission หรือเปลี่ยน existing data-rights module
DEFERRED ไม่ใช่ PASS และไม่ถือว่า bug/gap ถูกแก้; เกณฑ์ closure อยู่ใน gap audit

วันที่: 2026-10-01
สถานะ: **SPEC SIMULATION — ไม่มีการยิง executive API จริงหรือทำ mutation กับข้อมูลจริง**
อ้างอิง: [BE spec](../specs/mangmee-executive-business-backend-spec-th.md), [UI spec](../specs/mangmee-executive-business-ui-spec-th.md), [gap/impact audit](../research/mangmee-executive-business-be-gap-impact-2026-10-01-th.md)

เอกสารนี้เดินแต่ละเส้นทางตั้งแต่การกระทำบน FE → request → auth/validation → domain/source → response → FE
ระบุทั้งผลเป้าหมายและผลที่คาดจาก source ปัจจุบัน เพื่อให้เห็นว่าจะหยุดตรงไหนก่อนลงมือเขียนโค้ด
ไม่ใช้คำว่า “E2E ผ่าน” กับ API ที่ยังไม่มี และไม่ถือการเปลี่ยน local state ในเดโมเป็น backend mutation

## 1. วิธีจำลองและการอ่านผล

API01–API12 อ้าง endpoint inventory ใน BE§16; API01–10/API12 เป็นข้อเสนอ ส่วน API11 เป็น data-rights เดิม
ทุก row ด้านล่างคือ **expected scenario ที่ประเมินบนเอกสาร**; column ปัจจุบันมีความหมายดังนี้:

- **N**: endpoint/data/permission ใหม่ยังไม่มี ต้อง implement ก่อนรัน integration
- **E**: พบ guard/logic เดิมรองรับบางส่วนจาก source; ไม่แปลว่า scenario ทั้งเส้นรันจริงผ่านแล้ว
- **D**: ทำได้ใน local demo หรือเป็นข้อจำกัด demo เท่านั้น
- **Qxx**: ผลธุรกิจสุดท้ายรอมติ; มีผล fail-closed/unknown ที่ห้ามเดาไว้ให้
- **R**: จำลองความเสี่ยงจาก dependency/การแข่งขัน; ยังไม่ได้ทำ failure injection จริง

ผลที่รันจริงแยกไว้ท้ายเอกสาร: browser check ของเดโม และ existing unit/domain tests 58 เคส
ชุดนี้ไม่ใช่ข้ออ้างว่าทดสอบทุก permutation ไม่จำกัดแล้ว แต่ครอบคลุม known flows,
ทุก screen/action/API proposal, state transitions, boundary/time, auth, money, data coverage และโมดูลข้างเคียง

## 2. Fixture และ oracle ที่ตรวจยอดได้

### 2.1 เดโมเดิม 12 บริษัท

เดือน `2026-09`, `asOf=2026-09-30T12:00:00+07:00`; เป็นตัวอย่างถึงเวลานี้ ไม่ใช่จบเดือนเต็ม
หน่วยเงินในตารางเป็น **สตางค์**; ทุกบริษัทสมมติเป็น CUSTOMER สำหรับเดโม ไม่ใช่ backfill rule ของจริง

| Company | Discovery | Referrer | Credit seller | Paid ever | Usage | Receipts | Refunds | Net |
|---|---|---|---|---|---|---:|---:|---:|
| MM001 | OTHER | NONE | NONE | true | ACTIVE |149000|0|149000|
| MM002 | SALES | S001 | S001 | true | ACTIVE |149000|0|149000|
| MM003 | WEBSITE | NONE | NONE | true | NOT_STARTED |49900|0|49900|
| MM004 | FACEBOOK | NONE | NONE | false | NOT_PAID; trial มีใช้ |0|0|0|
| MM005 | SALES | S001 | S003 | true | ACTIVE |299000|0|299000|
| MM006 | SALES | S002 | S002 | true | INACTIVE |0|0|0|
| MM007 | OTHER | NONE | NONE | true | INACTIVE |49900|0|49900|
| MM008 | SALES | S003 | S003 | true | NOT_STARTED |49900|0|49900|
| MM009 | WEBSITE | NONE | NONE | true | null; activity unknown |49900|0|49900|
| MM010 | SALES | S002 | S002 | true | ACTIVE |299000|0|299000|
| MM011 | UNKNOWN | UNKNOWN | NONE | true | INACTIVE; archived |0|0|0|
| MM012 | OTHER | NONE | NONE | true | ACTIVE; fully refunded |49900|49900|0|

Oracle:

- population12; paid ever11; confirmed never paid1; receipt companies9
- confirmed active companies6 = paid active5 + active trial1; มี 1 บริษัทข้อมูลกิจกรรมไม่ครบ
  ดังนั้นเป้าหมาย BE คือ value:null,knownValue:6,coverage:partial และ FE แสดง “อย่างน้อย 6”
  ไม่ใช้ paid cohort แทน active KPI และไม่ถือ 6 เป็น exact total ทั้งประชากร
- paid cohorts2 NOT_STARTED +3 INACTIVE +5 ACTIVE +1 unassessable =11
- receipts1,145,500 −refunds49,900 =net1,095,600 สตางค์ =10,956 บาท
- discovery net: SALES796900 +OTHER198900 +WEBSITE99800 +FACEBOOK0 +UNKNOWN0 =1095600
- referrer net: S001448000 +S002299000 +S00349900 +NONE298700 +UNKNOWN0 =1095600
- จำนวนเอกสารที่ยืนยันจาก 11 แถวที่มี usage=2147; AI requests=3466
  มี 1 บริษัท unknown จึงห้ามประกาศตัวเลขนี้เป็น exact total ทั้ง 12 บริษัท
- paidEver หลังคืนเงินและ trial-before-paid ใน fixture เป็นข้อเสนอ Q03 ไม่ใช่มติที่ผู้ใช้ตอบแล้ว
- credited amount ใน fixture ไม่ใช่ oracle ของ salesflags/refundpolicy;ใช้ domainfixtures แยก

### 2.2 Fixtures เพิ่มสำหรับจำลอง BE

| Set | ข้อมูลที่ต้องจัดใน isolated test environment ภายหลัง | Oracle |
|---|---|---|
| F-AUTH | reader A, account manager B, operator C/D, tenant owner T, customrole ชื่อเหมือน platform, revokeduser, multi-membershipuser | role name อย่างเดียวไม่เพิ่ม authority; reader ไม่ mutate |
| F-POP | CUSTOMER12 +TEST1 +INTERNAL1 +UNKNOWN1;owner เดียวมี 2 บริษัท;signup ซ้ำ 2 แถวในบริษัทเดียว | eligible12, excluded2, unclassified1; companycount ไม่คูณ |
| F-MONEY | receipt149000 เวลา 31 ส.ค.23:59 ไทย;refund49900 เวลา 1 ก.ย.00:00; replayevent; secondrefund99900 เดือนต.ค. | ส.ค.+149000;ก.ย.−49900;ต.ค.−99900; lifetime net0 |
| F-USAGE | humancommitsame commandretry3 ครั้ง; deriveddocument2records; failedOCR; modelcalls3 ต่อ turn; trialuse; unknown history | logical business action/เอกสารหนึ่งหน่วยตาม taxonomy;ไม่บวก modelcalls |
| F-SALES | one first activation, renewal, unresolvedflag, clearedflag, referrer≠credited,5001eligibleattributions | salesrules เดิม;completeaggregate หรือ incompleteexplicit |
| F-HOLD | เคสมี hold end=T;nullanchor;retentionexpired;scopechanged;overlap;creator/approver/executor แยก | T−1msdeny;Texact ผ่าน time gate เท่านั้น;missingpolicydeny |
| F-DELETE | companyA/Bshareuser; objectcurrent+versions; externalunknown; queuedwriter; restoredbackup; retained billing fact | scope ไม่ข้าม B;no early purge;no resurrection;no false completion |

## 3. Walkthrough รายเส้นทางจาก FE ไป BE

### J01 เข้ารายงานและกรองถึงบริษัท

1. ผู้บริหารเปิด EX-01 → session helper → auth/me → API01 context
2. BE ตรวจ session, User.status, active platform membership/system-owned role และ executive.read
3. FE ส่ง API02 `month=2026-09&industry=ALL&discovery=ALL&referringSales=ALL`
4. BE สร้าง population/facts/snapshot เดียว → response company12/knownActive6/receiptCompanies9/net1095600
   และ cohorts2/3/5/unknown1; active KPI เป็น partial ตาม§2.1 ไม่ใช่ exact6
5. ผู้ใช้กด NOT_STARTED → API03 month เดิม,snapshot เดิม,usageGroup=NOT_STARTED,pageSize25
6. FE เห็น MM003/MM008,total2 →กด MM008→API05 → กลับรายการได้ context เดิม

ปัจจุบัน: D ผ่านใน browserdemo; N หยุดที่ role/shell/API ใหม่ G01/G02
pass หลัง implementation ต้องตรวจ networkpayload และ DBread-model จริง ไม่ใช้ JSONfixture แทน

### J02 ชื่อเดือนเปลี่ยนระหว่าง response กำลังกลับ

API02 เดือนก.ย.requestA ช้า; ผู้ใช้เลือกส.ค.ส่ง requestB → B กลับก่อน
FE รับเฉพาะ generation/filtersHash ของ B; A กลับทีหลังไม่ทับ
ถ้าส.ค.ไม่มี coverage→แสดง unavailable พร้อมเดือนส.ค. ห้ามคงยอดก.ย.ใต้ label ส.ค.
หลัง revokepermission ทั้ง A/B ห้าม renderprotected data; client ต้อง clear และ BErequest ถัดไป 403
ปัจจุบัน: demo มี mode จำลอง loading/error แต่ไม่มี HTTPordering จริง G23/G27

### J03 Source หรือ seller และเครดิตอีกคน

API04 discovery=SALES → originalreferrerS001 มี MM002/MM005; net448000
MM005detail→referrerS001,creditedS003;เครดิตไม่ทำให้ discovery กลายเป็นอื่น
เปลี่ยน discovery=FACEBOOK พร้อม referringSales=S001→200empty ไม่เลือกค่าใหม่เอง
OTHERdetail ข้อความ“LINE Official Account”ไม่สร้าง enumLINE และไม่ resolve ข้อความเป็น seller
ปัจจุบัน: D ผ่าน; Esignupnormalizer รองรับ sourceconditional; Naggregate ใหม่

### J04 เงินรับข้ามเดือน คืนเงิน และ webhook ส่งซ้ำ

F-MONEY receipt→billing ยืนยัน nativeidentity/effectiveAt→projection หนึ่ง fact
API02 ก.ย.→receipts0/refunds49900/net−49900;กราฟต้องต่ำกว่า baseline
webhookreceipt/refund ซ้ำ→factcount เท่าเดิม; refund ต.ค.ไม่ย้อนลดยอดก.ย.snapshot เดิม
snapshot ใหม่ก.ย.ถ้ามี lateevidence ต้องบอก revision;existinginvoice.refundedSatang149000 ใช้แทน refund ก.ย.ไม่ได้
ปัจจุบัน: G11/G12/G24; E มี billingverification แต่ Ncashprojection ครบทุก path

### J05 จ่ายแล้ว ยังไม่เริ่มใช้ เทียบเคยใช้และข้อมูลไม่พอ

MM003 มี paidproof และ complete history ไม่พบ qualifyingevent→NOT_STARTED
MM006 มี everpaid/history ก่อนเดือนแต่ไม่มีกิจกรรมเดือนนี้และ coverage ครบ→INACTIVE
MM009 ไม่มี event แต่ history ไม่ครบ→usageGroup:null และหมายเหตุ;ไม่เพิ่ม UNKNOWNcard
MM004trialactive→NOT_PAID แต่ activeCompanies นับ;MM012fullrefund→paidEver ตาม Q03
ปัจจุบัน: D ผ่าน labels; Nactivityfacts; Q03 ต้องยืนยัน trial/refund/successdefinition

### J06 เพิ่มผู้บริหารใหม่และเชื่อมผู้ใช้เดิม

EX-08name/email/profile→API08 ตรวจ managergrant,canonicalemail,userexistence,commandId
case ใหม่→identity+platform enrollment+audit(+outbox ถ้า Q01 เลือก invite)commit ร่วมกัน
response มี userId/enrollmentStatus/activationStatus แสดงตามจริง ไม่สมมติว่า login พร้อม
caseemail มีแล้ว→result ที่ให้ managerreview/link ตาม Q01;ห้ามสร้าง User ซ้ำหรือ reactivateglobaldisableduser
timeout หลัง commit→ส่ง commandId เดิม→ผลเดิม;ไม่ส่ง invite ซ้ำ
ปัจจุบัน: localdemo สร้าง active ทันที; NAPI และ Q01activation G05/G26

### J07 ระงับผู้บริหารระหว่างเปิด dashboard

manager อ่าน API09version5→API10statusSUSPENDED,expectedVersion5,commandIdX
transaction ตรวจ target/self/last manager/currentpermission→update executive enrollment+audit+invalidate
reader เปิด snapshot เก่าต่อ→403;tenantmembership อื่นของ user ไม่ถูก disable โดยปริยาย
manager อีกคนส่ง version5 หลัง update→409;หาก response หายส่ง X เดิมได้ผลเดิม
ปัจจุบัน: D แค่ boolean; Nversion/invalidation;Q01sessionpolicy

### J08 รับคำขอลบจากหน้าบริษัท — DEFERRED

demo มี companyId/reference/reason แต่ existingCreateCaseDto ต้องการ payload อย่างน้อยดังตัวอย่าง
ค่าตัวอย่างนี้เป็นเอกสารสัญญา ไม่เคยส่งเข้าระบบ:

```json
{
  "commandId": "exec-case-create-001",
  "requestKey": "support-case-001",
  "caseType": "COMPANY_WORKSPACE_OFFBOARDING",
  "requestSource": "EMAIL",
  "companyId": "MM003",
  "requesterContact": "requester@example.com",
  "receivedAt": "2026-10-01T03:00:00Z",
  "dueAt": "2026-10-15T03:00:00Z"
}
```

dueAt ตัวอย่างเป็น deadline ที่ operator กำหนดเพื่อจำลองเท่านั้น ไม่ใช่ข้อสรุปกฎหมายหรือ hold end
reason/reference ไม่อยู่ CreateCaseDto จึงต้องตกลง field/reference เพิ่มหรือใช้ existing form;
requesterContact ถูก hash อ่านกลับเป็นอีเมลเดิมไม่ได้
BE ตรวจ scope/target/overlap→201 `{caseId,replayed:false,case:{status:RECEIVED,...}}`
retry เดิม→canonicalcase เดียว; no deletion/ไม่มี automatic billing change
ปัจจุบัน: EAPI มี; G06 ถ้าต่อ demobody ตรง ๆ จะไม่ผ่าน strictDTO;Q06 เรื่องผู้สร้าง

### J09 ตรวจและอนุมัติครบขั้น — DEFERRED

API11verify-identity พร้อม method/reference→IDENTITY_VERIFIED
verify-authority สำหรับ company→authority timestamp;begin-retention-review→RETENTION_REVIEW
recorddecision ครบ 12categories ใช้ disposition ที่ scope อนุญาตและ retentionbasis/end/restriction จริง
approve โดย authorizedactor ที่ไม่ใช่ creator ตาม current policy→APPROVED
holddates สร้างได้เมื่อ Q07anchor ยืนยัน;policy ยังไม่พร้อม→readinessblocked
ปัจจุบัน: Eguard เดิม tested; demoapprove ข้ามทั้งหมด G07;single admin ต่างจาก code G09

### J10 รอ 14 วันและแข่งขันกับคำสั่งยกเลิก — DEFERRED

ที่ serverNow=T−1ms ส่ง start-execution→target422HOLD_NOT_ELAPSED ไม่มี state/mutation
ที่ T ส่ง start-execution พร้อม cancel อีกคำสั่ง→lockcase/scope;คำสั่งชนะกำหนด state;อีกคำสั่ง 409
cancel ชนะ→noexecution;execute ชนะ→cancel ไม่อ้าง rollback งานที่ทำลายแล้วได้
client เปลี่ยนนาฬิกาหรือส่ง holdEndsAt เองไม่มีผล;approvedscope เปลี่ยน→ต้อง review ใหม่ตาม Q07
ปัจจุบัน: currentstartExecution ไม่มี timecheck G08;Q07anchor/cancelpolicy ยังเปิด

### J11 ลบได้บางส่วนหรือ provider ไม่ตอบ — DEFERRED

หลัง time gate และ readiness ครบ→jobclaim พร้อม fencingtoken→inventoryversion ตรวจซ้ำ
DBscope สำเร็จ แต่ objectversion ล้ม/processorunknown→checkpointfailed/pending;ไม่ COMPLETED
retry เฉพาะ remainingwork ด้วย sameexecutionidentity;staleleaseworker ห้ามลบเพิ่ม
หลักฐาน verify ต้อง resolve ได้และสอดคล้อง counts;retainedlawfuldata แสดง reason/end/access
ปัจจุบัน: Nexecutor/checkpoints/machine evidence;Q08retention G10/G29/G30

### J12 ลบแล้วรายงาน บัญชีร่วม และ restore — DEFERRED

companyA ถูกลบ→profile/snapshotA หมดสิทธิ์ทันที;user ที่ยังอยู่ companyB ไม่หาย
retainedbillingmovement ถ้า Q08 อนุญาตต้องยังอยู่ platformmoney total แบบไม่เปิด profilePII
latewebhook/LINEjob/restorebackup ห้ามสร้าง A กลับ;restore ต้อง reapplymanifest ก่อนเปิด access
ปัจจุบัน: R/Q08;ไม่มีการ restore/deletion จริงในรอบนี้

## 4. Scenario catalog

ทุก expectedresponse ด้านล่างรวมเงื่อนไขร่วม: mutation ที่ถูกปฏิเสธต้องไม่เปลี่ยน domainstate,
ไม่ส่ง outbox/providercall และไม่สร้าง successaudit; อาจมี deny/securitylog ที่ปลอดภัย
ทุก successcommand ตรวจ canonicalreadback+audit;ทุก read ต้องไม่มี businessmutation

### 4.1 Authentication และ permission

| ID | FE → request/เงื่อนไข | Expected BE → FE | ปัจจุบัน / gap |
|---|---|---|---|
| SEC-01 | EX-01 ไม่มี session→API01 |401/login รักษา returnURL ไม่มีรายงาน | E/N G02 |
| SEC-02 | cookie มีแต่ token ปลอม/ไม่มี sessionclaim |401 ไม่ถือ cookie เป็นหลักฐาน | E E02 |
| SEC-03 | expiredaccess+validrefresh | refresh ตาม helper เดิมครั้งที่กำหนด;ต่อ request เดิม ไม่ loop | E/N G02 |
| SEC-04 | revoked/expiredsession→API02 |401;clear protected state | E/N G27 |
| SEC-05 | tenantOWNER→API02/API05direct |403 หรือ 404 ตาม scope ไม่มี crosscompanydata | N G04 |
| SEC-06 | customerrole ชื่อ MANGMEE_EXECUTIVE และ permission คล้ายจริง |403 จาก platformprovenance | N G04 |
| SEC-07 | reader จริง→EX-01–04 |อ่าน allowedprojections;ไม่เห็น manageactions | N/D G01/G02 |
| SEC-08 | reader เรียก API08/10/11POST เอง |403;ไม่มี mutation | E/N G25 |
| SEC-09 | manager ไม่มี reportread→API02 |403;manage ไม่ implyread | N/Q01 G05 |
| SEC-10 | billingdelegate มี companyscope จำกัด→executiveall |403 เว้นได้ executivepermission แยก | N G04 |
| SEC-11 | salesagent→executiveanalysis |403;เห็น salesconsole ตามเดิม | E/N G04 |
| SEC-12 | multi-membershipuser เปิด deep link |เลือก platformcontext ตามสิทธิ์ ไม่ใช้ oldest tenant | N G03 |
| SEC-13 | targetcompanyB แต่ actorheadercompanyA ที่ไม่ใช่ platform |reject context mismatch;ไม่ใช้ URL เป็น authority | E/N G03/G04 |
| SEC-14 | globalUserSUSPENDED/role inactive |401/403 ก่อน queryreport;ข้อมูลเดิม clear | E/N G27 |
| SEC-15 | legal acceptance required/temporarypassword |ผ่าน gate เดิมแล้วกลับ executivedeep link | E/N G02 |
| SEC-16 | platformCLOSED |ผลตาม Q01;จนตัดสินคง existinggate ไม่ให้ admin เพิ่ม | E/Q01 G02 |
| SEC-17 | withdrawrole ขณะมี snapshot/cursor |nextread403;invalidatecache;ไม่คืน PII ใน error | N/R G27 |
| SEC-18 | reader เปิด businessdocument/providerreceipt/credentials จาก link |ปฏิเสธด้วย modulepermission เดิม;noURLleak | E/N G04/G25 |

### 4.2 Overview directory analysis detail

| ID | FE → request/เงื่อนไข | Expected BE → FE | ปัจจุบัน / gap |
|---|---|---|---|
| REP-01 | API02baseline12fixtures | company12/knownActive6 แบบ partial/receiptCompanies9/net1095600 และ period/asOf ตรง | D/N G01/G16 |
| REP-02 | F-POPclassification |eligible12/excluded2/unclassified1 พร้อม partial | N/Q02 G13 |
| REP-03 | company มีหลาย owner/member/signup/invoice |countdistinctcompany1 | N/R G18 |
| REP-04 | owner เดียวมี 2company |นับ 2workspace ไม่ dedup ด้วย user/taxId | N G13 |
| REP-05 | companyACTIVE/SUSPENDED/DISABLED/ARCHIVED |ALL รวมทุก status;กรอง status ได้แยก service | D/N G13 |
| REP-06 | month ก่อน joinedAt |detailNOT_YET_REGISTERED;exclude จาก population เดือนนั้น | D/N G01 |
| REP-07 | month ปัจจุบันยังไม่จบ |effectiveEnd=snapshotAsOf;partialmonthlabel | N G23 |
| REP-08 | futuremonth/2026-13/ปีพ.ศ.ส่งเป็น 2569 |400invalidmonth ไม่ตีความเงียบ | N G01 |
| REP-09 | เดือนก่อนเริ่มเก็บข้อมูล |unavailable/earliestAvailableMonth ไม่ 0 | D/N G16 |
| REP-10 | industry+discovery+seller ตรงกัน |KPI/groups/list ใช้ filter เดียวและ normalizedecho | D/N G23 |
| REP-11 | validfilters แต่ intersection ว่าง |200items[],total0;ไม่ล้าง filter เอง | D/N G22 |
| REP-12 | discovery/industry invalid enum |400 ไม่ fallthroughALL | N G01 |
| REP-13 | q ชื่อไทย/ชื่อร้าน/รหัส/province/space |trim และ searchallowlist;ไม่มี contactsearch แถม | D/N G35 |
| REP-14 | q เกิน 120 หรือ SQL-likeinput |เกิน limit400;string อื่นเป็น parameter ไม่ execute | N G35 |
| REP-15 | ชื่อบริษัทซ้ำ 2 แห่ง |ใช้ id แยก row/detail;ไม่มี rowkeycollision | N G35 |
| REP-16 | sort เงินเท่ากัน/nullactivity |stabletiecompanyId;nullslast;page ไม่ซ้ำ | N G23 |
| REP-17 | pageSize0/101/cursor ปลอม |400/409 ตาม contract;ไม่ scanunbounded | N G23 |
| REP-18 | cursor จาก filter/snapshot/user อื่น |reject;ไม่ revealrow นอก scope | N G23/G27 |
| REP-19 | insert/update ระหว่าง page1/page2 |snapshot ชุดเดียว;refresh จึงเห็น revision ใหม่ | N/R G23 |
| REP-20 | drilldown หลังมี entity/usage/servicefilter เก่า |resetirrelevant/chips ชัด;count ตรงการ์ด | D gap G22 |
| REP-21 | detail→Back/refresh/bookmark |month/filter/sort/cursor context restore;expired snapshot prompt refresh | D/N G23/G35 |
| REP-22 | groupsunknown/rounding/denominator0 |unknownrow รวมครบ;percent0denominator—;rounddisplayonly | N G14/G15/G18 |

### 4.3 เงินรับ คืนเงิน ต้นทุน และเครดิต

| ID | FE → request/เงื่อนไข | Expected BE → FE | ปัจจุบัน / gap |
|---|---|---|---|
| PAY-01 | verified package cash→API02/05 |receipts ตาม amount/effectivetime จริง | E/N/Q04 G11 |
| PAY-02 | renewal/addon ในเดือน |รวม platformcash;ไม่เพิ่ม salesactivationcredit | E/N G11/G21 |
| PAY-03 | unpaidinvoice/checkoutcreated/quotagrant |ไม่เป็น cashreceipt | E/N G11 |
| PAY-04 | payment สำเร็จแต่ entitlement apply failed |เงินนับ;serviceissue แยก;ไม่กลับ unpaid | E/N G11 |
| PAY-05 | fullrefund เดือนเดียวกัน |receipts/refunds เท่ากัน net0;receiptcompany ยังนับ | D/N/Q03 G12 |
| PAY-06 | partialrefund ข้ามเดือน F-MONEY |ก.ย.net−49900;ไม่ย้อนเปลี่ยนส.ค.เป็น net สะสม | N/Q04 G12 |
| PAY-07 | refundpending/failed/canceled |ไม่นับ cashrefund สำเร็จ | E/N G12 |
| PAY-08 | creditnote กับ refundnative เดียวกัน |หักเงินครั้งเดียว | E/N G12 |
| PAY-09 | refund2 ครั้งคนละเดือน |แต่ละ movement ลงเดือนจริง;reconcilecumulative ได้ | N G12 |
| PAY-10 | webhook/reconcile duplicate |unique provider identity;total ไม่เพิ่ม | E/N G12 |
| PAY-11 | latepayment/refundevent |ลง effectiveperiod;revision/lag ชัด | N G11/G23 |
| PAY-12 | event ตรง Thai00:00 และ UTC17:00 |ลงเดือนใหม่;periodhalf-open | E/N G11 |
| PAY-13 | LIVE/TEST/provideraccount ต่างกัน nativeid ซ้ำ |scopekey แยก;LIVE ไม่ปน TEST | E/N G11 |
| PAY-14 | nonTHB หรือ unsafe integeraggregate |coverage/error explicit;ไม่ sumcurrency หรือ truncate | N G11 |
| PAY-15 | feeunknown/partialrecords |null/partial;ไม่ 0 หรือ 3%fixture | N/D gap G21 |
| PAY-16 | taxincluded/excluded/manualcash/dispute |ตาม Q04;unknown ไม่เดา;ไม่เรียกกำไร | Q04 G11/G12 |
| PAY-17 | AIcostcorrectionnegative |costsum รวม correction;call/activitycount ไม่เพิ่ม | E/N G16 |
| PAY-18 | first activation sales flag/unflag/refundwindow |reusecountableAmountSatang;renewalsexcluded | E/N G21 |
| PAY-19 |5001attributions ตรง range |completeaggregate หรือ explicitincomplete;ไม่เงียบ 5000 | E BUG G19 |
| PAY-20 | company ถูกลบแต่ retainedcashfact |total ไม่หาย;detail ไม่เปิด PII;policyQ08 | **DEFERRED** · R/Q08 G31 |

### 4.4 การใช้งานและ coverage

| ID | FE → request/เงื่อนไข | Expected BE → FE | ปัจจุบัน / gap |
|---|---|---|---|
| USE-01 | paid+complete history ไม่มี event |NOT_STARTED กลุ่มเดียว | D/N/Q03 G16 |
| USE-02 | paid+used ก่อนเดือนแต่เดือนนี้ 0 ครบ |INACTIVE | D/N G16 |
| USE-03 | paid+qualifyingevent เดือนนี้ |ACTIVE | D/N G16 |
| USE-04 | paid+historyunknown ไม่มี event |usageGroup:null;note/—;ไม่ NOT_STARTED | D/N G16 |
| USE-05 | paymenthistoryunknown แต่ activityknown |usageGroup:null paymentreason;activity แสดงได้ | N G11/G16 |
| USE-06 | trialnotpaid แต่ active |NOT_PAID;activeKPI นับ 1;paidcards ไม่นับ | D/N/Q03 G16 |
| USE-07 | เคยใช้ trial แล้วเพิ่งจ่าย |ไม่ neverused ตามข้อเสนอ;รอมติ Q03 ก่อนจริง | Q03 G16 |
| USE-08 | paidannual เดือนก่อนเดือนนี้ไม่มี receipt |ยังอยู่ paidpopulation | D/N G11 |
| USE-09 | fullrefund หลังใช้งาน |everpaid/cohort ตาม Q03;ไม่ใช้ net0 แทน neverpaid | D/Q03 G12 |
| USE-10 | login อย่างเดียว/refreshsession |ไม่ active;loginlabel มีหลักฐานแยก | N G17 |
| USE-11 | OCRadmission แล้ว providerfailed |ไม่ qualifyOCRsuccess;quota/cost ยังตาม owner | E/N G16 |
| USE-12 | AIturn เดียวเรียก model3 ครั้ง |logicalrequest1;cost3calls แยก | E/N G16 |
| USE-13 | retry/replaycommand เดียว 3 ครั้ง |qualifyingaction1;ไม่ dedup ด้วย transportid ที่เปลี่ยน | E/N/R G16 |
| USE-14 | expenseconfirmed มี derived accounting record |document1 ตาม canonicalkey | N/Q03 G18 |
| USE-15 | systemcron/support/admin/executiveread |ไม่ทำให้ customeractive โดยปริยาย;Q03actorpolicy | N/Q03 G16 |
| USE-16 | user เดียวใช้ companyA/B วันเดียว |per-company ถูก;platformusers/daysdistinct ใหม่ | N G18 |
| USE-17 | late event/error→success/rolled back transaction |นับเฉพาะ commit สำเร็จครั้งเดียวใน occurredperiod | N/R G16/G23 |
| USE-18 | coverage บาง feature ครบแต่ feature อื่นขาด |positiveactivity ยืนยัน active ได้;exact counts/neverused ต้องมี coverage พอ | N G16 |

### 4.5 ช่องทาง เซลล์ และประเภทบริษัท

| ID | FE → request/เงื่อนไข | Expected BE → FE | ปัจจุบัน / gap |
|---|---|---|---|
| SRC-01 | SALES+validseller |แสดง canonicalsource และ sellerid/code | E/D/N G20 |
| SRC-02 | FACEBOOK+salescodesent |signup เดิม normalize ตาม B6;report ไม่เพิ่ม seller เอง | E/D G20 |
| SRC-03 | OTHER รายละเอียด LINE/event |เก็บ OTHERtext ไม่เปลี่ยน enum/resolveagent | E/D/N G15 |
| SRC-04 | originalsignup2 แถว/returnexisting |เลือก originallinkedrow ไม่ latestrequest | E/N G18 |
| SRC-05 | nooriginalsignup |discoveryUNKNOWN ไม่เดาจาก rail | E/N G20 |
| SRC-06 | SALES แต่ sellerid หาย |UNKNOWN ไม่ NONE | N/D gap G20 |
| SRC-07 | seller profile deleted/suspended |history คง attribution พร้อม unresolvedlabel | E/N gap G20 |
| SRC-08 | historicalnonSALES+admin referrer repair |แสดง provenance/discrepancy;ไม่ rewritehistory | N G20 |
| SRC-09 | referrerS001/creditedS003 |คนละ field/table;filtersreferrer ไม่สลับ credit | D/N G21 |
| SRC-10 | seller ชื่อซ้ำ/เปลี่ยนชื่อ |idstable;ชื่อ+code แยก;ไม่ doublegroup | N G20 |
| SRC-11 | businessCategoryCLINIC แต่ commercialmapping ต่าง |privacycategory ไม่เป็น commercialindustry | N/Q05 G15 |
| SRC-12 | businessTypeOTHER/ไม่มี code/mappingversion เปลี่ยน |UNKNOWN/OTHERexplicit;version bind snapshot | N/Q05 G15/G23 |
| SRC-13 | entity/province ไม่มี canonicalproof |UNKNOWN;ไม่เดาจากชื่อ/taxId;ยังนับ population | N/Q05 G14 |
| SRC-14 | ไม่มี currentsalesteam/contactpermission |null/hidden;ไม่ copyreferrer หรือเปิด payroll/contact | N/Q01 G20/G25 |

### 4.6 บัญชีผู้บริหาร

| ID | FE → request/เงื่อนไข | Expected BE → FE | ปัจจุบัน / gap |
|---|---|---|---|
| USR-01 | manager เปิด API07 |เฉพาะ executiveenrollments+paging/capabilities | D/N G05 |
| USR-02 | create valid new email |canonicaluser/enrollment/audit;activation state ตามจริง | D/N/Q01 G05 |
| USR-03 | nameblank/whitespace/emailmalformed |400fieldErrors;FE คงค่า/focuserror | D/N G26 |
| USR-04 | name/email เกิน bounds หรือ unicode |validate ตาม identitypolicy;ไม่ truncate เงียบ | N G26 |
| USR-05 | email ต่าง case/space บัญชี executive เดิม |409alreadyenrolled ไม่สร้างซ้ำ | D/N G26 |
| USR-06 | email เป็น existingtenantuser |review/linkuserId ตาม Q01;ไม่ takeover | Q01 G05 |
| USR-07 | existingglobaluserDISABLED |ไม่ reactivate ด้วย createexecutive | Q01/R G05 |
| USR-08 | submit พร้อมกัน 2tab/sameemail |หนึ่ง canonicalidentity;conflict/replay ที่อธิบายได้ | N/R G26 |
| USR-09 | same commandId/same payloadretry |ผลเดิม;noaudit/inviteduplicate | N/R G26 |
| USR-10 | same key different payload/actor |409commandconflict;ไม่คืนข้อมูลเกินสิทธิ์ | N G26 |
| USR-11 | requestroleSYSTEM_ADMIN/arbitrary permissions |403/400;managergrant เฉพาะ profileallowlist | N G04/G05 |
| USR-12 | cancel ฟอร์ม/dirtyback |ไม่มี APIcommand;confirmation ตาม UX ถ้าต้องรักษาค่า | D/N G35 |
| USR-13 | invite ส่งล้มหลัง identitycommit |pendingdelivery;retryoutbox ไม่ createaccount ซ้ำ | Q01/R G05 |
| USR-14 | status change valid version |commitstatus+audit;readback ตรง | D/N G26 |
| USR-15 | status stale version/doubleclick |409 หรือ samekeyreplay;no lostupdate | N/R G26 |
| USR-16 | suspendself/last manager พร้อมกัน |ตาม Q01;ข้อเสนอ denyunderrosterlock | Q01/R G26 |
| USR-17 | suspendexecutive ที่มี tenantrole ด้วย |ไม่ globaldisable;session/cache ตาม Q01 | N/Q01 G05/G27 |
| USR-18 | user detail not found/searchstatus/page/lastloginunknown |404 หรือ empty;null—;ไม่มี credential/tempPasswordfield | D/N G05/G35 |

### 4.7 คำขอลบ การอนุมัติ และช่วงคงข้อมูล

| ID | FE → request/เงื่อนไข | Expected BE → FE | ปัจจุบัน / gap |
|---|---|---|---|
| DR-01 | EX-05/06 reader → API12 list/summary; operator → API11 full detail | reader เห็นสรุปทุกบริษัทแต่ไม่มี contact/reason/evidence; operator ผ่าน guard เดิม; paging/status/due filter ตามแต่ละ API | **DEFERRED** · E/N/Q06 G25 |
| DR-02 | EX-06 ส่ง body ของ demo ตรง API11 | reject required fields/unknown fields; FE ไม่ขึ้น success | **DEFERRED** · E/D gap G06 |
| DR-03 | สร้าง company case ด้วย body ครบ | RECEIVED, canonical caseId, ไม่มีการลบ/ระงับ/คืนเงิน | **DEFERRED** · E G06 |
| DR-04 | target company ไม่มี/ไม่ตรง scope type |404/422; company case รับ companyId เท่านั้น | **DEFERRED** · E G29 |
| DR-05 | membership exit ที่ user/company/member ไม่สัมพันธ์กัน |422; ไม่เปลี่ยน membership ใด | **DEFERRED** · E G29 |
| DR-06 | user erasure ส่ง companyId หรือ company offboard ส่ง userId |422 scope mismatch; ไม่ขยายไป global user | **DEFERRED** · E G29 |
| DR-07 | commandId เดิม payload/actor เดิม | replay case/action เดียว ไม่มี duplicate | **DEFERRED** · E G33 |
| DR-08 | commandId เดิม payload/actor/target ต่าง |409 command conflict | **DEFERRED** · E G33 |
| DR-09 | requestKey ซ้ำคนละ command |409 request-key conflict ไม่สร้าง case ใหม่ | **DEFERRED** · E G33 |
| DR-10 | user/company/member case ซ้อน scope ที่ยัง active |409 overlapping scope; linked remediation ตามกฎเดิม | **DEFERRED** · E G33 |
| DR-11 | receivedAt/dueAt ผิดรูปหรือ due ก่อน received | validation error; due ไม่ใช้แทน hold end | **DEFERRED** · E G32 |
| DR-12 | requesterContact/email อย่างเดียว |ยังไม่ identity verified; hash ไม่ส่งกลับเป็น rawcontact | **DEFERRED** · E G06/G33 |
| DR-13 | verify identity ไม่มี method/reference ที่อนุญาต |400/422; state ไม่เปลี่ยน | **DEFERRED** · E G07 |
| DR-14 | company case ไม่มี authority แล้ว begin review |422; FE บอกให้ตรวจอำนาจก่อน | **DEFERRED** · E G07 |
| DR-15 | user erasure ขอ authority NOT_REQUIRED ผ่าน endpoint | current service ปฏิเสธ unnecessary authority command; ใช้ flow ตาม case type | **DEFERRED** · E E11 |
| DR-16 | approve ตรงจาก RECEIVED |409 invalid transition; demo action ใช้แทนไม่ได้ | **DEFERRED** · E/D gap G07 |
| DR-17 | retention decisions ขาด 1 ใน 12category |422 พร้อม missingcategories;ไม่ APPROVED | **DEFERRED** · E G07 |
| DR-18 | disposition DELETE นอก scope เช่นลบ globaluser จาก companycase |422 disposition out of scope | **DEFERRED** · E G29 |
| DR-19 | RETAIN/RESTRICT ไม่มี basis/end/access หรือหมดอายุ |422 ก่อน approve และ recheck ก่อน execute | **DEFERRED** · E G10 |
| DR-20 | creator approve / approver execute / executor verify เอง |403 ตาม current policy; single-admin mode รอมติ | **DEFERRED** · E/Q06 G09 |
| DR-21 | holdStartsAt/holdEndsAt/policyVersion ไม่มี | readiness=false; targetPOLICY_NOT_READY;ไม่เดาจาก approvedAt | **DEFERRED** · N/Q07 G08 |
| DR-22 | now=end−1ms | targetHOLD_NOT_ELAPSED;คงทุกข้อมูล/stateAPPROVED | **DEFERRED** · N G08 |
| DR-23 | now=end ตรงหรือ end+1ms |ผ่านเฉพาะ time gate;ต้องผ่าน permission/retention/scope/inventory ด้วย | **DEFERRED** · N G08/G10 |
| DR-24 | clientclock เร็ว/ส่ง holdEnd ปลอม/เปลี่ยน timezone |client ไม่มีอำนาจเวลา;requestextra fields ถูก reject | **DEFERRED** · E/N G08/G32 |
| DR-25 | scope/decision/source เปลี่ยนหลัง approval |invalidate readiness;409/blocked;review/reset ตาม Q07 | **DEFERRED** · N/Q07 G32 |
| DR-26 | cancel ก่อน execute/withdrawrequest |allowedtransition ตาม Q07;ไม่ลบ;rollback บริการเฉพาะที่ policy ระบุ | **DEFERRED** · E/Q07 G32 |
| DR-27 | cancel กับ execute พร้อมกัน |serialize;หนึ่ง transition ชนะ อีกคำสั่ง 409;ไม่มี execute หลัง cancel ชนะ | **DEFERRED** · R/N G32 |
| DR-28 | startExecution timeout แล้ว retry |same command replay;ไม่สร้าง job ซ้ำ;HTTP200 ไม่ใช่ลบสำเร็จ | **DEFERRED** · E/N G10 |
| DR-29 | DB ลบได้แต่ object/provider ล้มบางส่วน |partial checkpoints/BLOCKED;ไม่ COMPLETED | **DEFERRED** · N G10/G29 |
| DR-30 | evidenceURI/hashsyntax ถูกแต่ resolve ไม่ได้/คนละ scope |targetreject verification;current format-only ไม่พอ | **DEFERRED** · E gap/N G10 |
| DR-31 | มี retaineddata แต่ส่ง outcomeCOMPLETED |422;ใช้ COMPLETED_WITH_EXCEPTION พร้อม basis/end/access จริง | **DEFERRED** · E/Q08 G10 |
| DR-32 | BLOCKED case เปิดใหม่/independent verification/ครบทุก proof |linkedcase ตามกฎเดิม;complete เมื่อ verifiedoutcome ครบ ไม่ใช้ elapsedtime แทน | **DEFERRED** · E/N G10/G32 |

### 4.8 Failure recovery และผลข้ามโมดูล

| ID | FE → request/เงื่อนไข | Expected BE → FE | ปัจจุบัน / gap |
|---|---|---|---|
| OPS-01 | report source หนึ่งช้าหรือล่ม | sectionpartial/unavailable;authfailure ต้อง fail ทั้ง request | N/R G27 |
| OPS-02 | billing observation เก่า |dataThrough/lag แสดงจริง ไม่ประทับ now แล้วอ้างสด | N G11 |
| OPS-03 | account/case transaction rollback |ไม่มี partialdomain+successaudit+outbox | E/N/R G26/G33 |
| OPS-04 | commandcommit แล้ว network หลุด |same key retry/readback;no duplicate mutation | E/N/R G26/G33 |
| OPS-05 | snapshot หมดอายุหรือ source version เปลี่ยน |409;FErefresh ทั้งชุด ไม่ผสมเงินกับ population คนละ revision | N G23 |
| OPS-06 | scale เกิน 5000/ข้อมูล 1 ล้าน events |ไม่มี silentcap;measurelatency/queryplan;timeout มี error ชัด | N/R/Q09 G19/G23 |
| OPS-07 | report GET ถูกเรียกซ้ำ/หลาย tab |ไม่ trigger billing reconcile, invite, mutation หรือ activity ลูกค้า | N G16/G28 |
| OPS-08 | archive แล้ว billing ยัง active |แสดง service/billing แยก;offboarding ต้องมี cancellationpolicy แยก | **DEFERRED** · E/R/Q07 G28 |
| OPS-09 | latepaidwebhook หลัง purge/ระหว่าง execution |ไม่ recreatecompany/term;financialevidence ตาม retentionpolicy | **DEFERRED** · R/Q08 G28/G31 |
| OPS-10 | queued LINE/outbox/AI worker เริ่มก่อน hold สิ้นสุด |ทุก writer เคารพ scope/fence;hold ห้าม earlypurge | **DEFERRED** · R/Q07 G28/G30 |
| OPS-11 | stale executor lease หลัง retryworker ใหม่ |stale worker ถูก fence ก่อน destructiveeffect | **DEFERRED** · N/R G29 |
| OPS-12 | current+noncurrent object versions/locator ถูกลบก่อน/schema เพิ่ม model หลัง inventory เดิม |manifest ครบจาก schema ปัจจุบันก่อน;ลบ exactversions ตาม policy;ไม่อ้างแค่ row count | **DEFERRED** · N/R G29/G34 |
| OPS-13 | user เดียวอยู่ companyA/B แล้วลบ A |B/user/LINE access ของ B คงตามสิทธิ์;scope ไม่ข้าม | **DEFERRED** · E/N/R G29 |
| OPS-14 | cleanup/TTL/storage lifecycle ระหว่าง 14 วัน |ไม่ลบข้อมูลใน hold scope;conflict กับ TTL ต้องปิดก่อนเปิด flow | **DEFERRED** · N/R/Q07 G30 |
| OPS-15 | restorebackup ก่อนลบแล้วเปิดระบบ |reapplyerasure/restrictionsmanifest ก่อนเปิด access;no resurrection | **DEFERRED** · N/R/Q08 G30 |
| OPS-16 | export/cache/materializedsnapshot ยังมี companyPII |invalidate/purge ตาม scope;ไม่ให้ cache bypass retention | **DEFERRED** · N/R/Q08 G31 |
| OPS-17 | audit/logs/errorpayload |มี correlation และ safeactor/target;ไม่มี password/token/contact/AItext | E/N/R G25 |
| OPS-18 | rollback executive feature/oldclient |ปิด reader/account/deletion แยก;ไม่ย้อนลบ facts/audit;unknown version fail closed | N/R G01/G08 |

### 4.9 FE state และธีมขณะเชื่อม API

| ID | FE → request/เงื่อนไข | Expected BE → FE | ปัจจุบัน / gap |
|---|---|---|---|
| FE-01 | เปิด EX-01/02/03 pending |scope loader;ไม่มีตัวเลขเก่าใต้ context ใหม่ | D/N G27 |
| FE-02 | API timeout/503/retry |unavailable แยก empty;retry ตาม helper ไม่ loop | D/N G27 |
| FE-03 | API403 หลังเคยเห็นข้อมูล |clear protected content;action หาย/disabled มีเหตุผล | D/N G25/G27 |
| FE-04 | API400fieldErrors จาก createuser/case |field เดิมธีมเดิม;คงค่า;focuserror;ไม่ toastsuccess | D/N G06/G26 |
| FE-05 | API409source/version/snapshotchanged |โหลด state ใหม่และให้ review ไม่ submit ใหม่เงียบ | N G23/G26/G32 |
| FE-06 | API429 |แสดงรอพร้อม retryafter;ไม่ submit ซ้ำถี่ | N G35 |
| FE-07 | data:null/partial/zero |—/coverage หมายเหตุ/0 ตามความหมาย;ไม่มี UNKNOWNcohortcard | D/N G16 |
| FE-08 | dropdownsearch/keyboard/Escape/outside/switch |sharedThemedSelect;focus/selected/menu อยู่ใน theme | D ผ่าน;integration รอ G35 |
| FE-09 | Thai/longtext/noresults/unknownoption |label อ่านได้;id เป็น value;search ไม่เปลี่ยน sourceenum | D/N G15/G35 |
| FE-10 | text/textarea focus/error/disabled/readonly/autofill |sharedfieldtokens ทุก state;autofill ต้องตรวจ browser จริง | D บางส่วน;autofill รอ G35 |
| FE-11 | monthpicker พ.ศ./ค.ศ./timezone |UIlocale ถูก;APIYYYY-MM ค.ศ.;dayboundary ถูก | D/N G11 |
| FE-12 | viewport1440/1024/768/390/320 |noouteroverflow;table contained scroll;popover ไม่ clip | D ผ่าน;shell จริงรอ G35 |
| FE-13 | darkOS/zoom200%/keyboard-only |apptheme เดิม;focus และ label ไม่หาย;zoom ยังต้องตรวจ | DdarkOS;zoom รอ G35 |
| FE-14 | negative financial trend/largeamount |bar ใต้ baseline/formatexact;ไม่ clip เป็น positivebar | D gap/N G24 |
| FE-15 | doubleclicksubmit/pending/timeoutback |disabledpending;stablecommandId;ไม่มี optimistic success | D/N G26/G33 |
| FE-16 | detailtab/Back/URLrestore/read-only deep link |context ถูก;GET ไม่มี mutation;reader ไม่เห็น casePII ที่ไม่ได้สิทธิ์ | D/N/Q06 G25/G35 |

## 5. เคสผสมที่เสี่ยงสูง

ใช้เคสผสมเพิ่มจาก equivalence/boundary ใน§4 ไม่อ้างว่าเป็น formal pairwise covering array ของทุก dimension

| ID | ชุดเงื่อนไขร่วม | ผลที่ต้องได้ | อ้างอิง |
|---|---|---|---|
| PX-01 | reader +หลาย membership +old home cookie +expired customer term |เข้า executive ด้วย platformcontext ถ้าสิทธิ์ถูก;ไม่ใช้ customerterm เป็น scope รายงาน | SEC-12, REP-21; G03 |
| PX-02 | refund-onlymonth +sourceUNKNOWN +archivedcompany |net ติดลบยังรวมใน unknown/sourcegroup;ไม่ drop จาก status หรือกราฟ | PAY-06, REP-05; G12/G24 |
| PX-03 | annualpaid +trialuse ก่อนจ่าย +noactivity เดือนนี้ |INACTIVE ตาม Q03;ไม่ NOT_PAID หรือ NOT_STARTED จาก receipt เดือนนี้ 0 | USE-02/07/08; G16 |
| PX-04 | oldentityfilter +cohortdrilldown +emptycombination |context/chips ชัดและ drillcount สอดคล้อง;ไม่ hiddenfilter | REP-11/20; G22 |
| PX-05 | manager2 คน createemail ต่าง case +response คนหนึ่งหาย |identity เดียว;stableidempotency และ readback | USR-05/08/09; G26 |
| PX-06 | manager2 คนปิดกันเอง +last manager protection |commit ไม่ทำให้เหลือ 0manager ตาม Q01 | USR-16; G26 |
| PX-07 | approve สำเร็จ +hold policy ไม่พร้อม +clientclock เร็ว |canExecute=false;noearlydeletion | **DEFERRED** · DR-21/24; G08 |
| PX-08 | hold end ตรงขอบ +permission ถอน +executequeued |authorization ล่าสุด deny ก่อน sideeffect แม้ time gate ผ่าน | **DEFERRED** · SEC-17, DR-23; G08/G27 |
| PX-09 | scope เปลี่ยน +cancel +execute พร้อมกัน |source version/lock กำหนดผลแน่นอน;ไม่มี bypasshold | **DEFERRED** · DR-25/27; G32 |
| PX-10 | partial purge +late billing webhook +workerlease เก่า |checkpoint/fence กัน recreate และ doubledelete;ไม่ complete | **DEFERRED** · DR-29, OPS-09/11; G28/G29 |
| PX-11 | deletedcompany +retainedcash +snapshotcache +restoredbackup |cash ตาม Q08 ยัง reconcile;PII ไม่กลับ;manifest ก่อน access | **DEFERRED** · PAY-20, OPS-15/16; G30/G31 |
| PX-12 | SALESsellerdeleted +creditedseller ต่าง +flaggedcredit +renewal |referrerunresolved ยังอยู่;credit ตาม flag;renewal เพิ่ม cash เท่านั้น | SRC-07/09, PAY-02/18; G20/G21 |

## 6. Traceability ของหน้าจอ ข้อกำหนด และ module

| Screen/requirement | API | Scenario families | Dependency/regression |
|---|---|---|---|
| EX-01 R01–07/R15–16 | API01/02/03 | SEC,REP,PAY,USE,FE,PX01–04 | auth/shell/company/billing/activity/cache |
| EX-02 R02–10/R15–16 | API03/05 | REP,SRC,USE,FE | partnerdirectory/signup/companyidentity |
| EX-03 R07–09 | API04/03 | PAY,SRC,REP22,PX12 | salesreports/billing/industrymapping |
| EX-04 R03–10/R12 | API05/API06 | REP06/21,SRC,USE,PAY,SEC18,FE16 | profile/service/authorizedhistory |
| EX-05/06 R12–16 | API11/API12/API06 | DR,OPS,PX07–11 | data-rights/P31/identity/storage/billing/LINE/restore |
| EX-07/08 R11/R15–16 | API07–10 | USR,SEC08/09/14/17,FE04/05/15,PX05/06 | identity/membership/roles/outbox/audit |

Regression paths เดิมที่ต้องรันภายหลังเมื่อแตะ module นั้น:

- `e2e/system-admin.spec.ts`: partnerlist/detail/search/status/paging; tenant owner blocked
- `e2e/sales-console.spec.ts`: createagent/deal/approve ไม่ถูกขยายสิทธิ์โดย executiverole
- `e2e/billing-admin-directory.spec.ts`, `e2e/billing-admin-menu-ux.spec.ts`: billingdelegate scope/menu
- `apps/api/src/modules/auth/auth.guard.spec.ts`, permission registry/resolver และ web session gate tests
- data-rights service/controller/contract + actual API journey ต้องเพิ่ม hold tests หลังมติครบ
- billing financial/refund source/receipt/apply tests; AI usage/quota tests หากเพิ่ม activityadapters
- sharedfield/theme tests และ browser เปิด popover ทุก state ใน systemshell จริง

## 7. ผลจริง ข้อจำกัด และเกณฑ์ปิดงาน QA

Catalog มี **176 scenario รายหมวด +12 เคสผสม =188 เคสจำลอง** และ 12walkthroughs
ยังไม่มี scenario ของ executive API ใหม่ที่รันแบบ FE→HTTP→DB จริง

ผลรันจริง baseline 2026-10-01 (ก่อนพัก deletion; 58 BE tests ไม่ได้รันซ้ำในรอบซ่อนฟีเจอร์):

- localdemo `check-demo.cjs`: PASS ตาม [audit§6](../research/mangmee-executive-business-be-gap-impact-2026-10-01-th.md#6-หลักฐานที่รันจริงในรอบนี้)
- existing focused tests:58PASS/0FAIL/0SKIP;ไม่ใช่ 188 เคสด้านบน
- static source/contract walkthrough:ครบ screen/APIproposals ตาม§6 และพบ G01–G35
- fixture arithmetic/เอกสาร/IDs/links ตรวจแยกตาม taskmemory

ยังไม่รัน: HTTP/DB integration ใหม่, real concurrency locks, source backfill,
real provider/refund/erasure, restore, large-data performance, nativezoom/autofill ใน shell จริง
ทั้งหมดต้องเป็น isolatedfixtures ไม่ใช้ customerdata ทดสอบ destructive flows

การรับ implementation ภายหลังต้องมีหลักฐานแต่ละ scenario ที่เกี่ยวข้อง: fixtureversion,
actor/scope, sanitizedrequest/response/status, DBbefore/after หรือ queryresult,
audit/command replay, FE screenshot/visiblelabel และ sideeffectabsence ใน negativecases
สำหรับ case ที่รอมติให้สถานะ BLOCKED_DECISION จน Owner ตอบ ห้าม markPASS จาก assumption
ห้ามลบ case ออกเพียงเพราะยังไม่มี UI ปุ่มหรือทำ automation ยาก;ระบุ manual/integrationlevel และเหตุผลแทน

ผลรันหลังพัก deletion: rebuild + sandbox preview + `check-demo.cjs` PASS; ตรวจ HIDE-01–04 และรายงาน/บัญชี/controls/responsive/theme เดิม. ไม่มี real FE→HTTP→DB E2E เพิ่ม

## ส่วนเพิ่มกราฟการใช้งานและ 80/20 (2026-10-01)

ดู [spec extension](../specs/mangmee-executive-usage-pareto-spec-th.md) สำหรับกราฟแยกสี/คลิกเจาะข้อมูล/อันดับ/Top spender และ fixtureใหม่72บริษัทหลังตัดทดสอบ. ตัวเลข12บริษัทในเอกสารนี้เป็น historical baseline; ไม่ใช่เดโมรุ่นล่าสุด. ผล spec simulation เดิมยังไม่ใช่ integration PASS. Deletion ยังคงซ่อน


## Navigation/comparison extension — 2026-10-01

อ้าง [specและผลตรวจ](../specs/mangmee-executive-navigation-comparison-spec-th.md). EX-03 เดิมแตกเป็นusage/revenue/customers/compare; 188baselinecasesยังคงเป็นsimulationไม่ใช่ผลรันruntime

| ID | Current local expected / verification |
|---|---|
| UX-01 | overview4KPI/2หัวข้อ/ไม่มีlongtable; desktopmain785px |
| UX-02 | แต่ละanalysisroute/tabมีเฉพาะเนื้อหาที่เลือก |
| UX-03 | chart→list→detail→Backรักษาsort/page/subview |
| UX-04 | reportsharedfilterคงอยู่/มีlabelแม้พับ; comparisonใช้ฐานแยกชัด |
| UX-05 | industry14vs13, rawnet58464vs54464และper-company4176vs4189.54ถูก |
| UX-06 | rate delta17.6percentagepoints; swapกลับเครื่องหมาย |
| UX-07 | samegroupให้เลือกใหม่; unknownไม่มีfalsezero/delta |
| UX-08 | comparisonA/B→memberlist/detail→comparisonกลับค่าฝั่งเดิม |
| UX-09 | monthcomparisonunavailable ไม่แสดงgrowthปลอม |
| UX-10 | legacyanalysis→usage/revenue, newviewstate restore, olddeletionroutes→overview |
| UX-11 | responsive menu/dropdown/theme/keyboard1440–320px ไม่มีouteroverflow |
| UX-12 | reader/accountpermission, loading/error/forbiddenของทุกหน้าใหม่, deletionยังซ่อน |

UXrowsเป็นชุดเพิ่มจากbaseline188; testscriptปัจจุบันอยู่ในพื้นที่เดโมตามmemory. การตรวจBEsource/HTTP/DBของcomparativecontractยังไม่เกิดขึ้น


## Excel export UX extension — EXL-01–14

รายละเอียดและ expected results อยู่ใน [Excel spec §7](../specs/mangmee-executive-excel-export-spec-th.md#7-เกณฑ์ตรวจรับและ-gap-ใหม่)
EXL-01–09 ส่วน local UX/manifest ตรวจผ่าน `check-export.cjs` ตามผลที่บันทึกใน memory; รวม all-page40, Pareto15/13, A/B27, detail1, source/unknown/empty/role/error/expired และ mobile theme
EXL-10–12 เป็น NOT_IMPLEMENTED: real auth/HTTP/snapshot/typed XLSX/parser/render/limits/audit และ shared writer regression; ไม่อ้างผลจากเดโมเป็นผลไฟล์จริง
ไม่เปลี่ยน188baseline/47deferredหรือ UX-01–12; เพิ่ม12case IDsเดิมและEXL13–14ตามแม่แบบv4แยกต่างหาก. Deletionยังhidden และไม่มี workbook sheet สำหรับข้อมูลคำร้อง


### Owner template amendment — Excel Dashboard v4

Ownerระบุ `outputs/company-infographic-20261001/company-receipts-dashboard-v4.xlsx` เป็นแม่แบบตาม [Excel spec §8](../specs/mangmee-executive-excel-export-spec-th.md#8-แม่แบบและหลักฐานตรวจอ่าน-2026-10-01)
มตินี้แทนsummary-only/optional-company/values-only: ค่าเริ่มต้นเป็นDashboardเขียว–ทอง + nativecharts/สูตร + รายบริษัทที่เป็นsource, 2ชีตหลัก; ตารางคำนวณใต้Dashboardและmetadataในsource
ต้องแยกsource28ก.ย.ของแม่แบบจากfictional30ก.ย.ของเดโม; ไม่ยกสูตรblank=0หรือreceiptทุกสถานะมาเปลี่ยนBE Q03โดยปริยาย
API13รับtemplateKeyแทนincludeCompanies; serverเลือกversion/hash. XG03ต้องตรวจnativechart/formula/cache/renderเพิ่ม; writerเดิมsingle-sheetยังทำไม่ได้
EXL13–14เพิ่มintegrationacceptance; baseline188/47deferredไม่เปลี่ยนและไม่มีgapimplementationปิดจากการอ่านแม่แบบ. ไม่แก้ไฟล์อ้างอิงและไม่สร้างXLSXใหม่รอบนี้

Current local evidence: `check-export.cjs` v6 and `check-demo.cjs` PASS; fixed2-sheet manifest/Dashboard/source preview, all scopes/subviews, unknown and permission/error/expiry/mobile/theme verified. EXL13–14 native XLSX generation/recalculation/render acceptance remains NOT_IMPLEMENTED; inspected reference workbook is read-only evidence, not export-service evidence.

EXL-15 เพิ่ม contact columns ตาม [Excel spec §9](../specs/mangmee-executive-excel-export-spec-th.md#9-มติข้อมูลติดต่อ--2026-10-01); Q-EXL-CONTACT RESOLVED เป็น User.email/phoneNumber ล่าสุดของบัญชีเจ้าของ ผ่าน active membership/canonical OWNER/stable ID. เคส (a)–(l) ใน §9.2 ครอบคลุมชื่อซ้ำ/หลายบริษัท/หลาย role ไม่คูณ KPI, OWNER เดียว/หลาย/ไม่มี/tenant role ปลอม, account suspended กับ membership ถูกถอด, contact แก้หรือล้างแยก field, unverified/invalid/null/source error, เปลี่ยนเจ้าของ และ FE/detail/Excel snapshot ตรงกัน. ห้าม fallback Company/signup/Gmail/Sheet; phone literal text รักษา 0 และ preserve rows/formulas/charts. เป็น design acceptance ยังไม่ได้รัน API จริง; v5 จาก Sheet ไม่ผ่าน system-source acceptance. Local demo ใช้ข้อมูลสมมติเพื่อตรวจ label/contact consistency เท่านั้น
