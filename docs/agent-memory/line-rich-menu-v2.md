# Agent Memory: line-rich-menu-v2

Status: Repository implementation and verification complete on 2026-08-21; PR, deploy, LINE activation, and device UAT pending.

Owner: thawatchai

Scope: Replace the earlier LINE rich-menu proposals with versioned six-action profiles. Current `line-rich-menu-v2-ver1` uses a large บริษัทของฉัน/หน้าหลัก hero, ถ่ายใบเสร็จ, คุยกับน้องมั่งมี, สรุปค่าใช้จ่าย, เริ่มต้นใช้งานฟรี, and ติดต่อเรา.

Decisions:

- `บริการของเรา` is company-specific. It lists only entitled sellable top-level features from the existing `FEATURE_CATALOG`, not a static marketing list and not the permission-filtered “ทำอะไรได้บ้าง” capability reply.
- `บริการของเรา` remains a supported secondary message command but is not a direct tile in Ver1.
- `บริษัทของฉัน` shows only current company name, user display name, and resolved role labels to every linked user. Owners additionally receive every active owner-company name and safe switch controls.
- Receipt capture uses a message action because LINE camera/camera-roll actions are Quick Reply-only.
- Talk uses native `openKeyboard` and does not spend an AI turn before the user sends text.
- Contact is public and deterministic: contact@mangmeeplus.com, 098-256-5628, and https://official.mangmeeplus.com/.
- `เริ่มต้นใช้งานฟรี` is a public URI action to https://official.mangmeeplus.com/ and may not append tenant or user data.
- `หน้าหลัก` is a visual heading inside the company hero, not a seventh action.
- Presentation profiles are versioned. Trend/seasonal skin changes may change art, labels, and geometry, while behavior IDs, payload meaning, authorization, and card contracts remain stable unless the behavior spec also changes.
- Ver1 uses a two-area top row and four-area bottom row. The drawn bottom `เมนู` bar in the supplied reference must be removed and the production image recomposed at 2500x1686 without stretching.
- Rich-menu visibility never grants authority; server-side identity, company, entitlement, permission, scope, and mutation boundaries remain mandatory.

Open questions: None for product behavior.

Artifacts:

- [[specs/line-rich-menu-v2-spec|LINE Rich Menu V2 Spec]]
- [[specs/line-rich-menu-v2-image-spec|LINE Rich Menu V2 Visual Asset Spec]]
- [[plans/line-rich-menu-v2-plan|LINE Rich Menu V2 Plan]]
- [[specs/line-ai-assistant-ux-spec|LINE AI Assistant UX Spec]]
- `apps/web/public/assets/line/mangmeeplus-line-rich-menu-v2-ver1-2500x1686.png`
- `scripts/line-oa/rich-menu-v2-ver1.manifest.json`
- `scripts/line-oa/rich-menu-v2-ver1.manifest.spec.mjs`
- [[runbooks/line-rich-menu-v2-console-setup|LINE Rich Menu V2 Console Setup]]

Verification:

- Spec checked against current `FEATURE_CATALOG`, entitlement evaluator, LINE staff-menu/company commands, receipt prompt, and LINE Messaging API action constraints.
- Internal wiki-link check passed for the new and updated documents.
- Visual spec checked against the official LINE rich-menu image limits, exact 2500x1686 asymmetric six-area integer grid, repository design tokens, and the owner-provided Ver1 reference.
- Owner reference `/Users/thawatchai/Downloads/Ver1.png` inspected at exactly 2500x1686; it is a reference, not a production-ready asset because it contains a drawn chat/menu bar.
- Production PNG is 2500x1686, opaque, 797,457 bytes, and SHA-256 `4a5154a59f53bcebbbbb4f43e64b28c4d4720ab719e72cbdbc5dd610fb423180`; the bright menu strip is replaced by the exact surrounding dark-green field.
- Implemented exact public contact card, enabled-sellable service card, compact current-company card, owner-only switcher pagination, public contact preflight bypass, deterministic receipt feature/permission gate, and versioned six-area manifest.
- Public contact remains behind controller signature verification and event idempotency while intentionally bypassing identity, legal, opt-out, entitlement, and model reads.
- Company context never falls back to an internal company or role key in visible output.
- Focused automated checks passed: image/manifest 2, staff-menu logic 29, classifier 22, message buffer 62, webhook use case 131; total 246 passing tests.
- `pnpm --filter @watchdog-bms/api typecheck` passed.
- Repository bitmap visually inspected after export; retained Ver1 artwork was not stretched and the removed strip is an exact deep-green field.

Next:

- Commit only the LINE Rich Menu V2 files, push `codex/line-rich-menu-v2`, and open the PR to `develop` without unrelated reimbursement worktree changes.
- After merge/deploy, use the Console runbook to record the existing menu, activate the new Messaging API rich menu, and capture iOS/Android evidence before deleting any rollback resource.
