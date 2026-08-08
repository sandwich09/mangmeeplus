# Agent Memory: production first launch via path B (partial-incident)

Status: DECIDED 2026-08-08 — เจ้าของเลือกทาง B หลังทาง A (U5 promotion ceremony) เจอ dormant bug
หนาแน่นในเส้นที่ไม่เคยรันจริง
Owner: thawatchai (repo owner)

## มติ

ขึ้น production ครั้งแรกผ่าน **partial-incident mode** ของ `deploy-production.yml` ทีละ service
(`api-web` → `ai-gateway` → `workers`) แทน promotion mode (`target=all` + U5/A5 ceremony)

## ทำไมไม่ใช้ทาง A (promotion ceremony)

ทาง A ถูกออกแบบครบและมี spec test แต่ **โค้ด path ไม่เคยรันจริงกับ AWS** (A5 network SSM param เป็น
`ParameterNotFound` มาตลอด) การรัน `bootstrap-production-a5-private-network.sh --apply` เป็นครั้งแรก
เจอบั๊ก 4 ตัวติดกันภายใน ~30 นาที:

1. jq operator precedence — `.SecurityGroups|length==1 and .[0]...|length` → `boolean has no length`
   (แก้แล้ว, PR #4 `0cb42ee`)
2. `local a="$1" b="${a}"` forward-reference under `set -u` → `unbound variable`
   (แก้แล้ว, PR #4 `1d5f2f7`)
3. (เข้าใจผิดชั่วคราว — validator ผ่านจริง)
4. **AWS merge สองกฎ 443 (group + prefix) เป็น IpPermission เดียว** แต่ `normalize()` ใน
   `validate-production-a5-clone-security-groups.sh` + spec fixture คาดเป็น 2 element แยก →
   validator ปฏิเสธ SG ที่ bootstrap สร้างเอง **ยังไม่แก้** — เป็น mismatch ระหว่าง AWS behavior
   กับ evidence-chain logic ที่แก้แล้วกระทบ signed evidence + spec ไม่ควรแก้ระหว่าง ceremony

ตัวที่ 4 ต่างจาก 1–3: ไม่ใช่ crash แต่เป็น security-validator logic ที่ไม่ตรง AWS จริง และยังเหลือ
ขั้น IAM/clone/shadow/approval ที่ยังไม่แตะ คาดว่ามี dormant bug อีก การ debug security evidence
chain ทีละบั๊กระหว่างพยายามขึ้น prod ให้ทันเป็นความเสี่ยงที่ไม่คุ้ม

## ทำไมทาง B ได้สิ่งที่ต้องการครบ

เป้าเจ้าของ: **DB query ได้ / เว็บเล่นได้ / ต่อ AI ได้** — ทั้งสามไม่พึ่ง A5/U5 chain เลย
(A5/U5 = shadow-only evidence สำหรับ feature-entitlement governance ของ VAT/WHT statutory
ไม่ใช่ runtime capability) ทาง B deploy **โค้ดตัวเดียวกัน** ผ่าน CI gate เดียวกัน (typecheck/test/
security/SBOM/sign/scan) ต่างแค่ authority path

## สิ่งที่ยอมรับ (recorded risk)

- audit trail บันทึกการขึ้นครั้งแรกเป็น "incident" ไม่ใช่ "governed release" — governance บนกระดาษ
  ไม่กระทบการใช้งาน
- WHT/VAT enforcement flip ยังต้องผ่าน U5 chain แยกก่อนเปิด — ทาง B ไม่ได้เปิดสิ่งเหล่านั้น
- A5 SG 4 ตัวที่สร้างค้าง (ฟรี ไม่มี endpoint) เก็บไว้ใช้ตอนทำ A5 chain รอบหน้าที่มี fix แล้ว

## incident refs ที่ใช้

- `incident_ref`: `INC-2026-0808-first-production-launch`
- `incident_approval_ref`: `approval://owner/thawatchai/2026-08-08-first-launch`
- เหตุผลผูกกลับมาที่เอกสารนี้

## Next

- Merge candidate ไม่ต้อง (develop == main = b6eccc8)
- Deploy 3 service ทีละตัว: api-web → ai-gateway → workers
- migration item11b fix ทำแล้ว → `prisma migrate deploy` ผ่าน
- หลัง deploy: smoke (login/upload/expense/LINE) → support roles → M-01 evidence
- A5 chain (พร้อม 4 fixes) = งานแยก ไม่มี time pressure
