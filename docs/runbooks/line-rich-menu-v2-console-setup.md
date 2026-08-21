# LINE Rich Menu V2 Ver1 — Console Setup

Status: Repository artifact ready; activation pending backend deploy and device UAT  
Owner: thawatchai  
Profile: `line-rich-menu-v2-ver1`

## Files

- Bitmap: `apps/web/public/assets/line/mangmeeplus-line-rich-menu-v2-ver1-2500x1686.png`
- Action manifest: `scripts/line-oa/rich-menu-v2-ver1.manifest.json`
- Behavior spec: [[specs/line-rich-menu-v2-spec|LINE Rich Menu V2 Spec]]

The bitmap is `2500 x 1686`, opaque PNG, 797,457 bytes, SHA-256 `4a5154a59f53bcebbbbb4f43e64b28c4d4720ab719e72cbdbc5dd610fb423180`. The drawn bottom `เมนู` strip has already been removed. Do not crop, resize, or add another chat bar to the file.

## Required setup path

Use the Messaging API for this profile, not only the LINE Official Account Manager template editor. Area C uses a postback action with `inputOption=openKeyboard`; LINE documents postback actions as an advanced Messaging API capability. A rich menu created by one tool cannot be retrieved or edited by the other tool.

Use the employee OA's long-lived channel access token and follow LINE's standard sequence:

1. Get and record the currently active default rich-menu ID. Keep that rich menu and its image as the rollback target.
2. Validate the `lineRichMenu` object from the committed manifest with `POST /v2/bot/richmenu/validate`.
3. Create a new rich menu with `POST /v2/bot/richmenu`; record the returned `richMenuId` beside the logical profile ID.
4. Upload the committed PNG to `POST https://api-data.line.me/v2/bot/richmenu/{richMenuId}/content` with `Content-Type: image/png`.
5. Do not set the new resource as default until the backend commit containing the V2 handlers is deployed.
6. After deploy, set it as default with `POST /v2/bot/user/all/richmenu/{richMenuId}`.
7. Reopen the LINE chat. A new default may take up to about one minute to appear; a per-user menu has higher priority and can hide the new default.

Never paste or commit the channel access token, API responses containing credentials, or user IDs into this repository.

## Exact area/action mapping

| Area | Bounds `(x,y,w,h)` | Action |
|---|---|---|
| บริษัทของฉัน | `0,0,1667,843` | message `/companies` |
| ถ่ายใบเสร็จ | `1667,0,833,843` | message `ถ่ายใบเสร็จ` |
| คุยกับน้องมั่งมี | `0,843,625,843` | postback `action=line-rich-talk`, `inputOption=openKeyboard` |
| สรุปค่าใช้จ่าย | `625,843,625,843` | message `ดูค่าใช้จ่ายเดือนนี้` |
| เริ่มต้นใช้งานฟรี | `1250,843,625,843` | URI `https://official.mangmeeplus.com/` |
| ติดต่อเรา | `1875,843,625,843` | message `ติดต่อเรา` |

Set `chatBarText` to `เมนู`. This is LINE UI metadata and is not part of the bitmap.

## Pre-activation gate

- The repository manifest test passes.
- The API typecheck and focused LINE tests pass on the exact deploy candidate.
- The old default rich-menu ID is recorded and still exists.
- The new `richMenuId`, image checksum, backend commit SHA, environment, operator, and timestamp are recorded in rollout evidence.
- The backend containing `staff_menu_contact`, `staff_menu_services`, `staff_menu_receipt`, and the owner company-context response is deployed.

## Device smoke

Test on current LINE iOS and Android clients using both linked and unlinked accounts where relevant:

1. บริษัทของฉัน: current company, display name, and human role labels only; an owner also sees every owner company and can switch safely.
2. ถ่ายใบเสร็จ: enabled + allowed gets the camera/camera-roll prompt; disabled and forbidden states remain distinct.
3. คุยกับน้องมั่งมี: opens the keyboard and sends no model turn until the user submits text.
4. สรุปค่าใช้จ่าย: returns the scoped current-month result or its honest empty/forbidden state.
5. เริ่มต้นใช้งานฟรี: opens only `https://official.mangmeeplus.com/`.
6. ติดต่อเรา: works while unlinked and shows the approved email, phone, telephone action, and official website.
7. Close and reopen the chat, then confirm labels, image crop, tap boundaries, and chat bar on both devices.

Capture screenshots and record all six results. Do not delete the old menu until this evidence is accepted.

## Rollback

Set the previously recorded rich-menu ID back as the default. Reopen the chat and verify it appears. Keep the failed Ver1 resource for diagnosis; do not overwrite history or delete either resource during the incident.

Official references:

- [Rich menus overview](https://developers.line.biz/en/docs/messaging-api/rich-menus-overview/)
- [Use rich menus](https://developers.line.biz/en/docs/messaging-api/using-rich-menus/)
- [Messaging API rich-menu reference](https://developers.line.biz/en/reference/messaging-api/#rich-menu)
