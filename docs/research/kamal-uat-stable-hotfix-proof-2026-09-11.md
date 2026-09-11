# หลักฐาน deploy UAT ซ้ำจาก main — 12 กันยายน 2026 (เวลาไทย)

สถานะ: สำเร็จสองรอบต่อเนื่อง โดยไม่มี error, retry หรือแก้โค้ด/config คั่นระหว่าง deployment ทั้งสองรอบ

- รอบแรก: **4 นาที 14.836 วินาที** ตั้งแต่ merge เข้า main ถึง process exit
- รอบที่สอง: **4 นาที 25.786 วินาที** ตั้งแต่เริ่มตรวจคิวก่อนสั่ง main ล่าสุดถึง process exit
- รอบที่สองเฉพาะคำสั่ง deploy: 4 นาที 21.191 วินาที; เวลาตรวจคิวก่อนคำสั่ง 4.595 วินาทีถูกนับในยอดรวมด้านบนแล้ว
- Source ทั้งสองรอบ: `6b95e50555c9905aa32d17d1372241bb4889cc1b`; [PR552](https://github.com/MangmeeDev/mangmeeplus/pull/552); [CI34623709238](https://github.com/MangmeeDev/mangmeeplus/actions/runs/34623709238) ผ่านก่อน merge
- รอบแรก merge `2026-09-11T17:06:21Z`, จบ `2026-09-11T17:10:35.835608+00:00`; GitHub ให้เวลา merge ละเอียดระดับวินาที ส่วน clock ของคำสั่งใช้ monotonic time
- รอบสองเริ่ม `2026-09-11T17:10:53.390723+00:00`, จบ `2026-09-11T17:15:19.193168+00:00`

ทุกจำนวนในตารางเป็นวินาที เวลาส่วนที่ทำงานขนานกันอยู่ภายใน phase จึงไม่บวกซ้ำ

| ขั้นตอน | รอบแรก | รอบที่สอง |
| --- | ---: | ---: |
| ตรวจ target / สิทธิ์ / เครื่อง | 11.035 | 9.855 |
| checkout main + TypeScript + build ทุก artifact | 60.681 | 65.142 |
| อ่าน config/secret ใหม่และตรวจทุก image | 6.880 | 6.624 |
| push image และ pull ลงเครื่อง | 15.780 | 15.354 |
| ยืนยัน config/secret ยังเป็นรุ่นเดิม | 2.249 | 2.238 |
| เตรียมและตรวจ AgentCore | 17.529 | 2.828 |
| migration catalog / sync / สิทธิ์ | 49.753 | 50.177 |
| rollout ทั้ง 3 บริการและ readback | 69.631 | 89.917 |
| config / readiness / public OPEN | 7.519 | 7.695 |
| ปิดสถานะ release เก่าที่สังเกตจริง | 9.119 | 8.784 |
| เซ็นและตรวจลายเซ็น KMS | 1.183 | 1.226 |
| เวลาประสานงาน/lock/ช่องว่างระหว่าง phase และก่อนคำสั่งตามขอบเขตข้างต้น | 3.477 | 5.946 |
| **รวมทั้งหมด** | **254.836** | **265.786** |

Readiness delay ของ workers คงที่ 7 วินาทีต่อรอบและรวมอยู่ใน rollout แล้ว (ยืนยันจาก log Kamal ของทั้งสองรอบ). Poll AgentCore ใช้ช่วงละ 3 วินาทีเมื่อยังไม่พร้อม; จำนวนครั้งแปรผัน. Healthcheck interval 1 วินาทีและ timeout 5 วินาที; deploy timeout 90 วินาที, drain/stop timeout 180 วินาทีเป็นเพดาน ไม่ใช่เวลารอคงที่ที่ต้องบวกทุกครั้ง. ไม่มีการรอ login/logout ในสองรอบนี้ตาม owner approval.

พิสูจน์ config ที่จัดการครบ API 111 ค่า, AI 56 ค่า, workers 19 ค่า พร้อมตรวจ default environment ของ image และ native metadata เทียบกับ container จริง. Artifact inventory ผูก source tree 4,838 ไฟล์, migration 189 ไฟล์ และ sync/catalog 35 ไฟล์; ไม่ได้อ้างว่า docs/tests ทุกไฟล์ถูกบรรจุลง runtime image. API/DB/AI health, workers Redis PING และการเรียก internal API ผ่าน; source/image/config/proxy ตรงทั้งหมด; public OPEN และ KMS signature ผ่าน. LINE login/webhook และ business journey แบบ login/logout ไม่ได้ทดสอบในสองรอบนี้.

ก่อน deploy มี actual runtime/native/KMS rehearsal 20 จุด, fresh clean-source full build/TypeScript และ actual AWS config/native/ECR push-pull rehearsal 5 จุด พร้อม failure contracts. วิธี mutation 8 ส่วนที่ไม่เปลี่ยนใช้ signed success เดิมเป็นหลักฐานประกอบ ไม่ได้อ้างว่าซ้อม live mutation ทุกส่วนใหม่. Cache probe แรกพบ generated parent directory ยังทำให้ build ซ้ำ จึงแก้ก่อน merge. Full final build ผ่าน 76.406 วินาที และ tools-base export 0.861 วินาที. สอง live runs ใช้ cache ที่มีอยู่ จึงไม่ใช่ตัวเลข cold-cache และไม่ใช่หลักประกันเวลาเท่ากันทุก future release.

เก็บความล้มเหลวเดิมไว้: rollback20260911T162022Z-09c1f20e ล้มก่อน provider/DB/container mutation และถูก reconcile ด้วย actual unchanged readback + original signature ใน20260911T164232Z-d7577358. ก่อน merge รอบใหม่ ตัวตรวจคิวพบ exact historical GitHub ghost31611733340; jobs/check-runs/pending deployments เป็นศูนย์และตรงเอกสารเหตุการณ์เดิม จึงแยกเฉพาะ identity นี้ (ไม่ได้ลบประวัติหรือรันซ้ำ). Preparation stop อยู่ก่อน merge ไม่ได้ซ่อนอยู่ในรอบ deployment. ยังไม่มี live rollback ใหม่หลังแก้ใน proof สองรอบนี้.

นี่เป็นหลักฐาน **main → UAT ผ่าน Kamal**. Production cloud/runtime ไม่ได้ deploy หรือเปลี่ยนค่า และ dev คงสถานะ stopped. UAT/READY/Production GitHub workflow run IDs เป็น N/A เพราะสองรอบนี้เป็น local Kamal operations; operation IDs และ signed artifacts อยู่ด้านล่าง. CI job Typecheck and Test ก่อน merge ใช้ 18 นาที 17 วินาที (รวม test/security ภายใน job); การเตรียมและรายการที่หยุดก่อน merge เก็บแยกในบันทึก ไม่ใช่เวลาช่วง main → deployment. ไม่มีการสร้างเครื่องใน clock ทั้งสองรอบ.

คำสั่งที่ใช้ทั้งสองรอบ:

```sh
infra/kamal/deploy-uat --profile mangmee-kamal-uat --mode hotfix --apply --uat-smoke-acceptance
```

หลักฐาน (config/secret values ไม่ถูกคัดลอกลงเอกสาร):

- `20260911T170623Z-c8d84820`: [summary](../qa/evidence/kamal-stability-2026-09-11/20260911T170623Z-c8d84820/summary.json), [signed payload](../qa/evidence/kamal-stability-2026-09-11/20260911T170623Z-c8d84820/accepted.json); SHA256 `62ab943c84c5daa98abe36fae50a5403d7724ec1936b26892c9a31b465d42314`
- `20260911T171058Z-8c83ebfc`: [summary](../qa/evidence/kamal-stability-2026-09-11/20260911T171058Z-8c83ebfc/summary.json), [signed payload](../qa/evidence/kamal-stability-2026-09-11/20260911T171058Z-8c83ebfc/accepted.json); SHA256 `53df8c813aa4fd90713b6df8c5a390d642d868c4ee31fa90648ce8ae4a9b01ab`
