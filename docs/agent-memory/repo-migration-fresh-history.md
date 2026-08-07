# Agent Memory: repo-migration-fresh-history

Status: Phase 0–5 + 6.1 เสร็จ — repo ใหม่ `MangmeeDev/mangmeeplus` CI เขียวแล้ว
ถัดไป 6.2 deploy UAT
Owner: thawatchai
Scope: ย้าย `sandwich09/WatchDog-BMS` ไป repo ใหม่แบบไม่มี git history ยก CI/CD + environment config ไปด้วย

## Decisions

- ทิ้ง git history ทั้งหมด → snapshot commit เดียว (`.git` 43MB → ~0)
- branch model ใหม่: `main` = production source + deploy controller, `develop` = UAT source
  - เท่ากับโมเดลเดิม แค่เปลี่ยนชื่อ `develop-with-ai` → `develop`
  - `main` ต้องคงเป็น controller branch: cosign pin `@refs/heads/main`,
    `deploy-uat.yml` hard-error ถ้า dispatch จาก branch อื่น,
    environment branch policy อนุญาตแค่ `main`
  - `develop` เป็น **source branch เท่านั้น** ห้ามใส่ใน environment branch policy
- ต้อง merge `origin/main` เข้า `develop-with-ai` ก่อน snapshot —
  main มี 9 patches ที่ยังไม่มีบน develop-with-ai (neutral controller / F2 evidence / AgentCore builder)
- IAM trust policy ใส่ทั้ง sub claim เก่าและใหม่ระหว่าง cutover แล้วค่อยลบของเก่า (rollback ได้)
- repo เดิม: archive ไว้ ห้ามลบ จนกว่า production ใหม่จะ green

## Baseline (ตรวจ 2026-08-07)

| รายการ | ค่า |
|---|---|
| repo เดิม | `sandwich09/WatchDog-BMS` (private, default `main`) |
| divergence | `main` +10 / `develop-with-ai` +637 |
| patches บน main ที่ยังไม่มีบน develop-with-ai | 9 (`git cherry` — มีแค่ 311bd791 security fix ที่ซ้ำ) |
| merge conflicts ที่คาดไว้ | 6 ไฟล์ |
| tags | 0 (local และ remote) — deploy ใช้ SHA ล้วน |
| workflows | 12 ไฟล์ |
| environments | `production`, `uat` — branch policy = `main` เท่านั้น |
| variables | production 28, uat 37 (อ่านค่าคืนได้ → ก๊อปอัตโนมัติ) |
| secrets | `TYPHOON_OCR_API_KEY` (env `uat`) 1 ตัว — อ่านค่าคืนไม่ได้ |
| ไฟล์ที่ hardcode `sandwich09/WatchDog-BMS` | 21 |
| ไฟล์ที่ hardcode `develop-with-ai` | 115 |
| IAM roles ที่ผูก sub claim | 5 trust templates → `watchdog-bms-{ci,deploy}-{uat,production}` + a5/security roles |

---

# Runbook

ตั้งค่าก่อนเริ่มทุก phase:

```bash
export OLD_REPO=sandwich09/WatchDog-BMS
export NEW_REPO=<owner>/<repo>          # <<< ปลายทาง
export AWS_ACCT=311414082667
```

## ข้อควรระวังตลอดงาน: gh มี 2 account

เครื่องนี้ตั้ง `credential.https://github.com.helper = !gh auth git-credential`
แปลว่า **`git push`/`git fetch` auth ด้วย active account ของ gh** ไม่ใช่ keychain

| ทำอะไร | ต้อง active เป็น |
|---|---|
| push/fetch repo เดิม, `phase4a-export.sh` | `sandwich09` |
| `phase3-snapshot-push.sh`, `phase4b-import.sh` | account ใหม่ (`MangmeeDev`) |

อาการเวลาผิด account: `remote: Repository not found` หรือ `gh api` ตอบ 404
ทั้งที่ repo มีอยู่ — เป็น auth failure ที่ GitHub ซ่อนเป็น 404 สำหรับ private repo

push repo เดิมให้ใช้:

```bash
gh auth switch --user sandwich09 && git push origin develop-with-ai; gh auth switch --user MangmeeDev
```

`phase3` และ `phase4b` มี guard เช็ค active account ให้แล้ว

## Phase 0 — Backup + merge main เข้า develop-with-ai

**0.1 backup ก่อนแตะอะไร** (bundle เก็บทุก ref กู้ได้ 100%)

```bash
git bundle create ~/watchdog-bms-full-backup.bundle --all
```

**0.2 merge**

```bash
git checkout develop-with-ai
git fetch origin main
git merge origin/main
```

conflict ที่คาดไว้ 6 ไฟล์ — หลักการ resolve:

| ไฟล์ | เอาฝั่งไหน |
|---|---|
| `.github/workflows/ci.yml` | รวมมือ — develop-with-ai ใหม่กว่า (556 vs 545) แต่ main มี F2 controller ที่ต้องเก็บ |
| `.github/workflows/deploy-uat.yml` | รวมมือ — develop-with-ai ใหม่กว่ามาก (638 vs 498) |
| `infra/docker/production-image-security.spec.sh` | รวมมือ — spec ต้องครอบทั้งสองฝั่ง |
| `apps/web/package.json` | เอา version ที่สูงกว่า (เป็น security bump — เข้าข้อยกเว้น dependency ของ AGENTS.md) |
| `pnpm-lock.yaml` | อย่า merge มือ — resolve package.json ก่อน แล้ว `pnpm install` ให้ generate ใหม่ |
| `docs/agent-memory/security-audit-high-2026-07-25.md` | รวมเนื้อหาทั้งสองฝั่ง |

**0.3 verify** — ต้องผ่านทุกข้อก่อนไป phase ถัดไป

```bash
pnpm install --frozen-lockfile=false && pnpm security:audit && bash infra/docker/production-image-security.spec.sh
```

**0.4 commit + push** (ผู้ใช้ push เอง)

```bash
git add -A && git commit -m "chore: merge main controllers into develop-with-ai before repo migration"
git push origin develop-with-ai
```

> Gate: ถ้า 0.3 ไม่ผ่าน **หยุด** อย่าไป phase 1 — repo ใหม่จะเกิดมาพร้อม CI แดง

---

## Phase 1 — เปลี่ยนชื่อ branch `develop-with-ai` → `develop`

กระทบ 115 ไฟล์ รวม spec ที่ assert สตริงตรงๆ:
`production-image-security.spec.sh:190,191,195,196` (grep -Fq),
`production-image-security.spec.sh:812` (ECS task def `RELEASE_SOURCE_BRANCH`),
`run-release-task.sh:31`, guard ancestry ใน `deploy-uat.yml` / `a5-capacity-uat.yml` /
`recover-release-intent.yml` / `f2-normalize*.yml`

**กับดัก:** `ci.yml:43` = `branches: [main, develop, develop-with-ai]` — sed ตรงๆ จะได้ `[main, develop, develop]`
สคริปต์ phase 1 จัดการให้แล้ว

```bash
bash <scratchpad>/phase1-rename-branch.sh
```

**verify**

```bash
grep -rl "develop-with-ai" . | grep -v node_modules | grep -v '^./.git/'   # ต้องว่าง
grep -n "branches: \[" .github/workflows/ci.yml                            # ต้องไม่มี develop ซ้ำ
bash infra/docker/production-image-security.spec.sh
```

---

## Phase 2 — เปลี่ยน owner/repo

กระทบ 21 ไฟล์ ส่วนใหญ่คือ IAM trust template (OIDC sub claim) + `OWNER_ACTOR` gate

```bash
bash <scratchpad>/phase2-rename-owner.sh
```

**verify**

```bash
grep -rl "sandwich09" . | grep -v node_modules | grep -v '^./.git/'        # ต้องว่าง
git diff --stat
```

---

## Phase 3 — snapshot + push repo ใหม่

```bash
bash <scratchpad>/phase3-snapshot-push.sh
```

ทำ: orphan commit (ไม่มี parent = ไม่มีประวัติ) → `gh repo create --private` →
push เป็น `main` และ `develop` → ตั้ง default branch = `main`

**verify**

```bash
gh api repos/$NEW_REPO/commits --jq 'length'          # = 1
gh api repos/$NEW_REPO --jq '.visibility, .default_branch'   # private, main
```

---

## Phase 4 — GitHub config (environments / variables / protection / secret)

แยกเป็น export/import เพราะ **อ่านจาก repo เก่าและเขียน repo ใหม่ใช้คนละ account**
gh มี active account ได้ทีละอันเดียว สคริปต์เดียวจบไม่ได้

**4a — รันตอน `sandwich09` active**

```bash
gh auth switch --user sandwich09
bash <scratchpad>/phase4a-export.sh          # -> ~/watchdog-bms-config-export.json
```

**4b — รันตอน account ใหม่ active**

```bash
gh auth switch --user MangmeeDev
NEW_REPO=<owner>/<repo> bash <scratchpad>/phase4b-import.sh
```

สคริปต์ทั้งคู่มี guard เช็ค active account ก่อนทำงาน และ 4b replay branch protection
จากของจริงที่ export มา ไม่ใช่ค่า hardcode

**4c secret — รันเอง ห้ามให้ agent แตะค่า**

```bash
gh secret set TYPHOON_OCR_API_KEY -R <owner>/<repo> -e uat
```

**verify**

```bash
gh variable list -R $NEW_REPO -e production | wc -l    # 28
gh variable list -R $NEW_REPO -e uat | wc -l           # 37
gh secret list -R $NEW_REPO -e uat                     # TYPHOON_OCR_API_KEY
```

> **กับดัก pagination:** endpoint `environments/<env>/variables` ตัดที่ **30 รายการต่อหน้าเงียบๆ**
> `per_page=100` ไม่มีผล ถ้าไม่ `--paginate` จะได้ uat มาแค่ 30 จาก 37 โดยไม่มี error อะไรเลย
> (`--slurp` ใช้ร่วมกับ `--jq` ไม่ได้ ต้อง pipe เข้า jq แยก)
> `phase4a-export.sh` เทียบกับ `total_count` แล้ว fail ทันทีถ้าไม่ครบ

---

## Phase 5 — AWS IAM trust policy

ถ้าไม่ทำ: deploy เด้ง `sts:AssumeRoleWithWebIdentity` ทุกครั้ง

ใส่ทั้ง sub claim เก่าและใหม่ (rollback ได้ระหว่าง cutover) แล้วค่อยลบของเก่าใน phase 6.5

```bash
bash <scratchpad>/phase5-aws-trust.sh          # ต้อง aws sso login ก่อน
```

**verify**

```bash
aws sts get-caller-identity
# ต้องเห็นทั้ง repo:<old> และ repo:<new> ใน trust policy ของทุก role
```

---

## Phase 6 — verify end-to-end + cutover

ลำดับนี้ห้ามสลับ — UAT ต้องเขียวก่อนแตะ production

| ขั้น | ทำอะไร | เกณฑ์ผ่าน |
|---|---|---|
| 6.1 | push `develop` → CI ทำงานเอง | 6 required checks เขียว |
| 6.2 | Actions → `deploy-uat.yml` → **Use workflow from = main**, `release_ref` = SHA ของ `develop` | deploy สำเร็จ |
| 6.3 | UAT acceptance | `https://uat.mangmeeplus.com` ใช้งานได้ |
| 6.4 | Actions → `deploy-production.yml` → from `main`, `release_ref` = SHA ของ `main` | deploy สำเร็จ |
| 6.5 | **soak 1–2 สัปดาห์** — repo เดิมยัง deploy ได้ ห้ามแตะ IAM | prod นิ่งบน repo ใหม่ |
| 6.6 | `MODE=prune bash phase5-aws-trust.sh` ลบ sub claim เก่า | — |
| 6.7 | repo เดิม: archive (ห้ามลบ) | `gh repo edit $OLD_REPO --archived` |

> **ทำไมต้อง soak:** repo ใหม่มี commit เดียว → `resolve-production-release-ref.sh`
> resolve SHA ก่อนย้ายไม่ได้เลย ถ้า prod พังหลังย้าย **rollback ต้อง dispatch จาก repo เดิมเท่านั้น**
> ซึ่งทำได้ก็ต่อเมื่อ sub claim เก่ายังอยู่ใน IAM trust policy
> ห้ามรัน `MODE=prune` จนกว่าจะมั่นใจว่าไม่ต้องถอยกลับแล้ว

> **artifact เก่า verify ไม่ผ่าน**: cosign ผูก identity กับ `${GITHUB_REPOSITORY}`
> image ที่ sign ไว้ใต้ชื่อ repo เดิมจะ verify ไม่ผ่านกับ repo ใหม่ →
> 6.2 และ 6.4 ต้องเป็น build + sign + deploy ใหม่ทั้งคู่ ไม่ใช่ re-deploy ของเดิม

## Rollback

| พังที่ phase | ทำ |
|---|---|
| 0 | `git merge --abort` |
| 1–2 | `git checkout -- .` (ยังไม่ commit) |
| 3–4 | `gh repo delete $NEW_REPO` แล้วเริ่ม phase 3 ใหม่ |
| 5–6 | repo เดิมยังใช้ได้ปกติ (sub claim เก่ายังอยู่จนถึง 6.6) — deploy/rollback จาก repo เดิมได้ทันที |
| หมดทาง | `git clone ~/watchdog-bms-full-backup.bundle` |

## Open questions

- ชื่อ repo ปลายทาง (`NEW_REPO`) ยังไม่กำหนด
- ย้าย owner ข้าม account หรือแค่เปลี่ยนชื่อ repo ใต้ `sandwich09` ยังไม่ระบุ

## Artifacts

- สคริปต์ phase 1–5: scratchpad ของ session (ยังไม่ commit เข้า repo)
- backup bundle: `~/watchdog-bms-full-backup.bundle` (สร้างใน 0.1)

## Verification

**Phase 0 — ผ่านครบ (2026-08-07)**

| ขั้น | ผล |
|---|---|
| 0.1 backup | `~/watchdog-bms-full-backup.bundle` 38MB, `git bundle verify` = "complete history" |
| 0.2 merge | conflict 6 ไฟล์ตามที่คาด resolve ครบ commit `8346c7ac` (2 parents) |
| 0.3 `pnpm install` | "Lockfile is up to date" — lockfile ของ HEAD ตรงกับ package.json ที่ merge แล้ว ไม่ต้อง regenerate |
| 0.3 `pnpm audit --audit-level=high` | exit 0 (เหลือ 6 moderate ซึ่งไม่ใช่ gate) |
| 0.3 `production-image-security.spec.sh` | exit 0 — "production image security scanner: pass" |
| ตรวจซ้ำ | `git merge-base --is-ancestor origin/main HEAD` = true, conflict marker ทั้ง repo = 0 |

**ผลจริงของ merge — ได้จาก main 118 บรรทัด ไม่แตะ TypeScript เลย**

| ไฟล์ | |
|---|---|
| `.github/workflows/ci.yml` | +53 — one-shot bridge `neutral_recovery_update` + `neutral_f2_plan_update` |
| `infra/docker/production-image-security.spec.sh` | +65 — assertion ของ main ที่ auto-merge |
| `docs/agent-memory/security-audit-high-2026-07-25.md` | สถานะ PR #33 |

`git cherry` รายงาน 9 patches ว่าไม่มีบน develop-with-ai แต่ที่จริงเนื้อหาส่วนใหญ่มีอยู่แล้วผ่าน commit คนละตัว
(`recover-release-intent.yml`, `f2-normalize*.yml`, `build-agentcore-artifact.sh` เหมือนกันทั้งสองฝั่งอยู่แล้ว)
ของที่จะหายจริงถ้าไม่ merge คือ 118 บรรทัดข้างบน

**วิธี resolve ที่ใช้ (union — ไม่ทิ้งฝั่งใดฝั่งหนึ่ง)**

- `ci.yml` — เก็บ flag ครบ 4 ตัว, บล็อก one-shot bridge ของทั้งสองฝั่งเรียงต่อกัน, ตัวปิดเช็คครบทั้ง 4
- `deploy-uat.yml` — HEAD เป็น superset ของ main ทุก hunk ผลลัพธ์ตรงกับ HEAD ทุกบรรทัด
- `production-image-security.spec.sh` — เก็บ assertion ของ HEAD (ยืนยันแล้วว่า `cache-from: type=gha` ใน ci.yml = 2 จริง)
- `apps/web/package.json` — เก็บ `heic-to` (ใช้จริงที่ `expense-upload.logic.ts:59`)

## Known issue — one-shot bridge จะตายหลังย้าย

บล็อก `neutral_*` ใน `ci.yml` ทั้ง 4 ตัว pin ไว้กับ `BASE_SHA` และ blob hash ที่เจาะจง
(`26c8c851`, `afde4270`, `ee1c61dd`, `b91fb84b`) — commit พวกนี้ **ไม่มีใน repo ใหม่**
และ merge นี้ก็เปลี่ยน blob ของ `ci.yml` ไปแล้ว จึงยิงไม่ได้อีกทั้งหมด

ยังไม่ลบใน Phase 0 เพราะ merge ควรรักษาพฤติกรรมเดิมไว้ก่อน
ตัดสินใจว่าจะลบทิ้งตอน Phase 1 หรือไม่ — ถ้าลบ ต้องแก้ `production-image-security.spec.sh` ที่ assert บล็อกพวกนี้ด้วย

## Phase 1–5 + 6.1 — ผ่านครบ (2026-08-07)

ปลายทาง: **`MangmeeDev/mangmeeplus`** (personal Pro, ย้ายเข้า org Team ภายหลัง)
`OWNER_ACTOR` = `MangmeeDev`

| Phase | ผล |
|---|---|
| 1 rename branch | 115 ไฟล์ · `develop-with-ai` เหลือ 0 · `ci.yml:43` ไม่มี develop ซ้ำ |
| 2 rename owner | slug 23 ไฟล์ + actor 8 ไฟล์ใน `infra/` · spec **5/5 exit 0** |
| 3 snapshot | commit `668a2d08` · **0 parents** · 2732 ไฟล์ · push เป็น `main` + `develop` · default=main · private |
| 4 config | environments `production`/`uat` branch policy=main · vars **28/28** + **37/37** · branch protection ตรงทุกฟิลด์ |
| 4c secret | `TYPHOON_OCR_API_KEY` ตั้งแล้วที่ env `uat` |
| 5 IAM | 4 roles มี sub claim ทั้งเก่าและใหม่ |
| 6.1 CI | run 31190822100 (main) + 31190823113 (develop) — **success ทั้งคู่** required checks 6/6 |

IAM roles ที่แก้: `watchdog-bms-{ci,deploy}-{production,uat}`
trust template ใน `infra/security/` อีก 3 ตัวยังไม่มี role จริงบน AWS — ไฟล์ถูก rename แล้ว
ตอน bootstrap จริงจะได้ slug ใหม่เอง

## บั๊กที่เจอในสคริปต์เอง (แก้แล้วทุกตัว)

| อาการ | สาเหตุ |
|---|---|
| phase1/phase2 ตายตอน verify | `set -o pipefail` + `grep` ที่หาไม่เจอคืน exit 1 ซึ่งเป็นเคส**สำเร็จ** |
| phase2 พลาด actor 8 ไฟล์ | แทนแค่ slug เต็ม `owner/repo` — `sandwich09` เดี่ยวๆ อยู่ใน gate จริง (`validate-u5-capacity-authorization.sh`, `run-a5-capacity-mutating.sh`) และ fixture ของ spec |
| `\b` ใน sed ไม่ทำงาน | BSD sed บน macOS ไม่รู้จัก word boundary |
| phase3 บอก "repo ไม่ว่าง" ทั้งที่ว่าง | repo ว่าง commits API ตอบ **409 + JSON error** ไม่ใช่ `[]` → `--jq length` พัง ใช้ branches API แทน |
| phase4a ได้ uat มา 30/37 เงียบๆ | endpoint `environments/<env>/variables` ตัดที่ 30 ต่อหน้า `per_page=100` ไม่มีผล |
| push/gh api ตอบ 404 ทั้งที่ repo มีอยู่ | git ใช้ `gh auth git-credential` → auth ด้วย **active gh account** |
| phase5 AccessDenied | `watchdog-bedrock-dev` อ่าน IAM ได้แต่เขียนไม่ได้ ต้องใช้ `AWS_PROFILE=thawatchai` (root) |

## Next

**6.2** Actions → `deploy-uat.yml` — **Use workflow from = main**,
`release_ref` = SHA ของ `develop` (`668a2d08...` เต็ม 40 ตัว), `target = all`

**6.3** UAT acceptance → **6.4** deploy production → **6.5 soak 1–2 สัปดาห์**
→ **6.6** `MODE=prune` → **6.7** archive repo เดิม

local clone ย้ายมาทำงานบน branch `develop` ที่ track `newremote` แล้ว
`origin` ยังชี้ repo เดิมไว้เป็นทางถอย
