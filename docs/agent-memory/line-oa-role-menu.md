# Agent Memory: LINE OA Role Menu

Status: Production deployed 2026-07-15; focused and live infrastructure verification passed; real-device Rich Menu tap pending owner smoke
Owner: Codex
Scope: Shared LINE OA staff-side design parity for role-aware Quick Reply, receipt camera capture, and safe approval navigation.
Decisions:
- The LINE client chrome is native and is not recreated by web code.
- Main and query menus are composed from server-resolved permissions after identity and company context checks.
- Receipt capture uses LINE native camera and camera-roll actions and continues through the existing receipt/OCR draft flow.
- Approval remains a high-risk web mutation. LINE shows a Flex card deep-linking to the tenant-scoped approval page; it does not bypass approval policy or amount ceilings.
- The permanent three-slot Rich Menu remains configured in LINE OA Manager as documented in `docs/runbooks/b1-b2-line-external-setup.md`.
- The employee Rich Menu is a single launcher that sends `เมนูหลัก`; the backend returns one horizontally scrollable, permission-filtered Quick Reply row with up to nine actions.
Artifacts:
- `apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.ts`
- `apps/api/src/modules/line-ai/infrastructure/line-reply.adapter.ts`
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts`
- `apps/web/public/assets/line/mangmeeplus-staff-menu-2500x843.png`
Verification:
- `tsx --test` for staff menu logic and LINE payload adapter: 5/5 passed.
- API typecheck has unrelated pre-existing failures in dirty CRM/employee work; no remaining error points to the LINE staff-menu files after the local type fix.
- Commit `21859e82` deployed as `watchdog-bms-api:ecs-api-web-21859e82`; ECS deployment `iYrx0ZXd-G8xDY48zpJpm` finished `SUCCESSFUL` at 2026-07-15 10:48:58 +07 with rollback alarm monitoring complete and no triggered alarms.
- Production smoke: `GET https://mangmeeplus.com/v1/health` = 200; Rich Menu PNG asset = 200 `image/png` (2,125,758 bytes); LINE `POST /v2/bot/channel/webhook/test` = `success:true`, status 200.
Next:
- Tap the published `เมนูหลัก` Rich Menu from a linked employee account and confirm the permission-filtered Quick Reply row on a real LINE client.
