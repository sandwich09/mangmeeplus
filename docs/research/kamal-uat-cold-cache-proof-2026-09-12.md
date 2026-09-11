# ผล cold-cache deploy จาก main เดิม — 12 กันยายน 2026 (เวลาไทย)

รอบจริงสำเร็จครั้งเดียว: **11 นาที 32.827 วินาที** ตั้งแต่เริ่มตรวจคิว/main และสร้าง builder ว่าง จนคำสั่ง deploy จบพร้อม signed acceptance. เฉพาะคำสั่ง deploy ครบต้นจนจบ **11 นาที 14.699 วินาที**. เมื่อนับ cleanup ของ builder ทดสอบอีก 6.206 วินาที ยอดงานรอบนี้ทั้งหมดเป็น **11 นาที 39.039 วินาที**. ไม่มีการสร้างหรือเริ่มเครื่อง UAT ใหม่ และไม่มี error/retry/แก้ไขระหว่าง deployment.

Source `6b95e50555c9905aa32d17d1372241bb4889cc1b` เหมือนรอบ warm ก่อนหน้า; ไม่ได้ merge ใหม่. Operation `20260911T201637Z-cb364f03` เป็น local Kamal UAT operation; UAT/READY/Production GitHub workflow IDs เป็น N/A. CI ของโค้ดเดิม [34623709238](https://github.com/MangmeeDev/mangmeeplus/actions/runs/34623709238) ผ่านก่อน merge เดิม; รอบนี้ตรวจ TypeScript ใหม่ภายใน clock แต่ไม่ได้รัน GitHub CI ทั้งชุดซ้ำ. Production ไม่ได้ deploy.

- เริ่มทั้งหมด `2026-09-11T20:16:19.391556+00:00` UTC
- เริ่มคำสั่ง deploy `2026-09-11T20:16:37.518801+00:00` UTC
- deploy จบ `2026-09-11T20:27:52.219259+00:00` UTC
- cleanup จบ `2026-09-11T20:27:58.433586+00:00` UTC

| ขั้นตอน | วินาที |
| --- | ---: |
| ตรวจคิว/main และเตรียม builder/store ว่าง | 18.127 |
| ตรวจ target / สิทธิ์ / เครื่อง | 10.741 |
| checkout main + TypeScript + build ทุก artifact | 331.891 |
| อ่าน config/secret ใหม่และตรวจ image | 13.326 |
| push image และ pull ลงเครื่อง UAT | 130.802 |
| ตรวจ config/secret freshness ก่อน mutation | 2.368 |
| ตรวจและเตรียม AgentCore | 3.246 |
| migration catalog / sync / สิทธิ์ | 58.142 |
| rollout 3 บริการและอ่าน container จริงกลับ | 105.198 |
| ตรวจ config / readiness / public OPEN | 7.466 |
| ตรวจและปิดสถานะ release เก่า | 8.775 |
| เซ็นและตรวจลายเซ็น KMS | 1.219 |
| lock / orchestration / ช่องว่างภายในคำสั่ง | 1.525 |
| **รวมถึง deploy สมบูรณ์** | **692.827** |
| เก็บผล cache และลบเฉพาะ builder ทดสอบ | 6.206 |
| บันทึกผลและช่องว่างของ harness หลังคำสั่ง | 0.007 |
| **รวมทุกขั้นตอนของรอบทดสอบ** | **699.039** |

เวลาสร้าง builder 11.124 วินาทีอยู่ใน preparation แล้ว ไม่บวกซ้ำ. การคำนวณใช้ monotonic clock; ปัดแต่ละแถว 3 ตำแหน่งทำให้ผลบวกที่แสดงอาจต่างยอดละเอียดระดับเศษมิลลิวินาที. เวลาเตรียม adapter/ทดสอบเครื่องมือก่อนเริ่ม invocation และเวลาเขียนรายงานภายหลังไม่ใช่ deployment และไม่อยู่ใน clock.

ผลเทียบเป้าหมาย: cold ครั้งนี้เกิน 10 นาที 92.827 วินาทีจน deploy สมบูรณ์; แม้ตัด preparation และ cleanup ออก เฉพาะคำสั่ง deploy ยังเกิน 10 นาที 74.699 วินาที. จึงยังรับรองเป้าหมายต่ำกว่า 10 นาทีในกรณีไม่มี cache ไม่ได้.

Readiness delay ของ workers คงที่ 7 วินาทีรวมอยู่ใน rollout. Healthcheck interval 1 วินาที, timeout 5 วินาที; deploy timeout 90 วินาทีและ drain/stop timeout 180 วินาทีเป็นเพดาน ไม่ใช่เวลารอคงที่. AgentCore เดิมตรง source/artifact จึงใช้ผล `REUSED_EXACT`; ไม่มีการอ้างเวลาสร้าง runtime ใหม่จากรอบนี้. ขั้นตอนอื่นเป็นค่าที่วัดในรอบนี้ ไม่ใช่ค่าคงที่หรือคำรับประกันรอบอนาคต.

เปรียบเทียบ warm รอบก่อน: **4 นาที 25.786 วินาที** รวม prechecks; cold ครั้งนี้ **11 นาที 32.827 วินาที** รวม prechecks และการสร้าง builder ใหม่. เฉพาะคำสั่ง deploy ขอบเขตเดียวกัน: warm 261.191 วินาที → cold 674.699 วินาที. ความต่างในคำสั่ง 413.508 วินาที. เป็นผลแต่ละรอบบนเครื่องเดิม ไม่ใช่การแยกผล cache ออกจากความแปรผัน CPU/network แบบทดลองหลายซ้ำ.

ช่วง build ทำ TypeScript และ API/web image ขนานกัน; เวลาด้านล่างเป็น breakdown ภายใน phase ไม่ให้นำไปบวกยอดรวมอีกครั้ง:

| งานใน build | วินาที |
| --- | ---: |
| install | 16.726 |
| contracts | 1.660 |
| prisma | 4.602 |
| typescript | 122.009 |
| di | 1.060 |
| agentcore | 5.382 |
| build-api-web | 235.092 |
| build-ai-gateway | 28.266 |
| build-workers | 14.783 |
| export-tools-base | 38.119 |
| build-tools | 13.841 |

พิสูจน์ว่าไม่มี build/dependency cache ก่อนเริ่มด้วย BuildKit store แยกที่มี 0 cache records และ host pnpm store ใหม่ที่มี 0 files; ไม่มี cache import. BuildKit ใช้ 0.31.2 ตรงกับ warm builder โดย pin immutable digest. Main controller และ Dockerfiles ไม่เปลี่ยน; adapter สำหรับ benchmark ส่ง source build ไป builder แยก แล้ว load image ที่สร้างในรอบนี้. tools/publication wrapper ใช้ `--no-cache` และตรวจ base image ID ว่าเพิ่งสร้างใน invocation นี้จริง. Adapter SHA256 `030a19ff7d5a36ef3489632167a0ad847d93082237f73025ab1847845384a005`; ตรวจ positive/negative controls และ actual image transfer ด้วย probe แยกก่อนจับเวลา.

Cold ในรายงานนี้หมายถึง **ไม่มี build/dependency cache จากรอบก่อน**. ใช้ stage ที่เพิ่งสร้างภายในรอบเดียวกันต่อได้ตามปกติ. เครื่อง UAT ยังคง running/rollback images และ registry/CDN เดิม; ไม่ได้วัดเครื่องเปล่าหรืออินเทอร์เน็ตที่ไม่มี cache. ตัว controller hash ใน KMS payload ผูก release controller; หลักฐาน cache ของ adapter/outer harness แยกอยู่ใน evidence และ SHA256 manifest ไม่ได้อ้างว่า KMS เซ็น cache experiment ทั้งชุด. แนวทาง builder แยกและ no-cache อ้างอิง [Docker container driver](https://docs.docker.com/build/builders/drivers/docker-container/) และ [Docker build CLI](https://docs.docker.com/reference/cli/docker/buildx/build/); ตัวเลขเวลามาจากรอบจริงนี้ทั้งหมด.

Acceptance ผ่าน: managed config API 111 ค่า, AI 56 ค่า, workers 19 ค่า; source/image/full environment/native metadata/proxy ตรง container จริง, API/DB/AI health, workers Redis PING และ internal API ผ่าน, public OPEN ผ่าน, KMS signature verified. Artifact inventory ผูก source tree 4838 ไฟล์, migrations 189 และ sync/catalog 35 ไฟล์. LINE journey เลื่อนและ login/logout ไม่จำเป็นตาม owner approval; ไม่ได้อ้างว่าทดสอบ business journey ทั้งชุด. ผลรอบนี้เป็น UAT ไม่ใช่เวลา Production.

หลักฐาน: [summary และทุก phase](../qa/evidence/kamal-cold-cache-2026-09-12/20260911T201637Z-cb364f03/summary.json), [signed acceptance](../qa/evidence/kamal-cold-cache-2026-09-12/20260911T201637Z-cb364f03/accepted.json), [คำสั่ง build ทุกครั้ง](../qa/evidence/kamal-cold-cache-2026-09-12/20260911T201637Z-cb364f03/build-ledger.json), [cache ก่อนเริ่ม](../qa/evidence/kamal-cold-cache-2026-09-12/20260911T201637Z-cb364f03/builder-cache-before.jsonl), [log เตรียม builder](../qa/evidence/kamal-cold-cache-2026-09-12/20260911T201637Z-cb364f03/builder-setup.log), [SHA256 manifest](../qa/evidence/kamal-cold-cache-2026-09-12/20260911T201637Z-cb364f03/SHA256SUMS.json). Accepted payload SHA256 `ab11ad3f1785979226f51d1acdb049ed5a16e83e1ebdf36e016a4dfe38e10ef9`. Build logs และ harness ที่ใช้จริงอยู่ใน evidence เดียวกัน; ไม่มี resolved secret values.
