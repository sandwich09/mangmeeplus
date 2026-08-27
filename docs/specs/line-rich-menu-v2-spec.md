# Feature: LINE Rich Menu V2 (versioned shortcuts)

## 1. Status

- **IMPLEMENTED IN REPOSITORY — LINE Console activation and real-device UAT pending.**
- Owner: thawatchai
- Decision date: 2026-08-21
- Scope: the shared employee LINE OA rich menu, its versioned presentation profiles, and the deterministic cards/actions reached from it.
- This target replaces the older 3-slot and Ask AI/Daily Summary/Alerts/Link Account rich-menu proposals when V2 is implemented. Until then, the currently configured LINE OA menu remains the live behavior.

## 2. Goal

Provide a versioned LINE rich menu whose current `Ver1` profile exposes six actions:

1. บริษัทของฉัน (large `หน้าหลัก` hero)
2. ถ่ายใบเสร็จ
3. คุยกับน้องมั่งมี
4. สรุปค่าใช้จ่าย
5. เริ่มต้นใช้งานฟรี
6. ติดต่อเรา

Every data-bearing shortcut must return an honest result for the linked user, selected company, enabled feature set, and current permissions. Public links must use an approved destination. LINE remains a concise entry point; final approval, payment, posting, configuration, and other high-risk mutations remain on the web.

The presentation may change frequently to follow product or seasonal trends. Labels, artwork, geometry, and action selection therefore belong to a versioned presentation manifest. Stable behavior IDs, payload semantics, authorization, and result-card contracts do not change merely because a new skin is published.

## 3. Source of truth and reuse

- LINE assistant boundary: [[specs/line-ai-assistant-ux-spec|LINE AI Assistant UX Spec]]
- Rich-menu artwork: [[specs/line-rich-menu-v2-image-spec|LINE Rich Menu V2 Visual Asset Spec]]
- LINE access and company context: [[adr/0008-line-ai-access-and-auth|ADR 0008]]
- Receipt draft boundary: [[specs/expense-receipt-upload-spec|Expense Receipt Upload Spec]]
- Feature availability: `FEATURE_CATALOG` and the canonical `loadEntitledFeatureKeys` evaluator
- Existing commands and cards to extend, not replace: `line-staff-menu.logic.ts`, `line-ai-classifier.logic.ts`, and `process-line-webhook.use-case.ts`
- LINE action constraints: [LINE Messaging API actions](https://developers.line.biz/en/docs/messaging-api/actions/) and [Messaging API reference](https://developers.line.biz/en/reference/messaging-api/nojs/)

## 4. Current rich-menu profile and actions

The current profile ID is `line-rich-menu-v2-ver1`. Its visual order follows the owner-provided `Ver1.png` reference after removing the drawn LINE menu/chat bar. `หน้าหลัก` is a visual section heading inside the large company tile; it is not a seventh action.

| Position | Stable behavior ID | Visible label | LINE action | Payload/URI | Expected result |
|---|---|---|---|---|---|
| Top hero, two-thirds width | `company-context` | `หน้าหลัก` + `บริษัทของฉัน` | Message | `/companies` | Current company/user/role card; owner also receives the company switcher |
| Top-right | `receipt-capture` | `ถ่ายใบเสร็จ` | Message | `ถ่ายใบเสร็จ` | Permission-checked capture prompt with camera and camera-roll Quick Replies |
| Bottom 1 | `assistant-chat` | `คุยกับน้องมั่งมี` | Postback | `action=line-rich-talk`, `inputOption=openKeyboard` | Open the keyboard and send the deterministic welcome; do not generate an AI turn |
| Bottom 2 | `expense-summary-current-month` | `สรุปค่าใช้จ่าย` | Message | `ดูค่าใช้จ่ายเดือนนี้` | Permission- and scope-checked current-month expense summary |
| Bottom 3 | `free-start` | `เริ่มต้นใช้งานฟรี` | URI | `https://official.mangmeeplus.com/` | Open the public official-site onboarding entry point |
| Bottom 4 | `contact` | `ติดต่อเรา` | Message | `ติดต่อเรา` | Public contact card |

Camera and camera-roll actions are valid only on Quick Reply buttons, not rich-menu areas. Therefore the rich-menu receipt shortcut sends the existing deterministic command first; the returned prompt owns the native camera actions.

The image is static for each deployed version. Visibility of a tile is not authorization: every server-handled action repeats identity, company, feature, permission, and scope checks before reading or creating data.

`บริการของเรา` remains a supported deterministic message command and keeps the contract in §6.1, but it is not a direct tile in `Ver1`. A future presentation profile may map a tile back to that stable behavior without changing the card contract.

### 4.1 Presentation-version change policy

- Keep a versioned manifest for every release containing profile ID, canvas size, image filename and checksum, each rectangular area, stable behavior ID, visible label, LINE action type, exact payload/URI, accessibility label, and rollback profile ID.
- A skin-only refresh may change colors, illustrations, typography, shadows, and decorative copy without changing behavior IDs or payloads. It requires image/manifest validation and real-device visual smoke checks, not a rewrite of server behavior.
- A geometry or visible-label refresh must update the visual profile and coordinate/action mapping tests.
- Adding, removing, or repurposing an action, changing a payload/URI, or changing a result-card rule must update this behavior spec and its focused server tests.
- Publish a refresh as a new LINE rich-menu resource. Keep the last accepted profile available for rollback until the new profile passes UAT; do not overwrite history or delete the rollback target during rollout.
- Trend or campaign artwork must not introduce an unapproved price, claim, promotion, destination, licensed character, or business mutation.

## 5. Gate order

1. Verify the LINE webhook signature and event idempotency before all command handling.
2. `เริ่มต้นใช้งานฟรี` is a public URI action handled by LINE and opens only the approved HTTPS destination. It sends no company or user data in the URL.
3. `ติดต่อเรา` is public and may render without a linked account. It contains no company or user data.
4. `คุยกับน้องมั่งมี` opens the keyboard and returns the public static welcome in §6.4. The normal account-link and AI gates apply only when the user sends a message.
5. `บริษัทของฉัน`, `ถ่ายใบเสร็จ`, `สรุปค่าใช้จ่าย`, and the secondary `บริการของเรา` command require a linked active user.
6. Resolve the selected company from active membership. If company context is ambiguous, return the existing company-selection flow before the requested card.
7. Re-resolve company entitlements, membership roles, permissions, and scopes on every tap. Never trust rich-menu payloads as authority.
8. Legal-acceptance, AI opt-out, feature-disabled, and permission-denied behavior follows the existing LINE specs for the action being requested.

## 6. Card and interaction contracts

### 6.1 บริการของเรา (secondary command)

Purpose: show only services the selected company has switched on. This is not a marketing catalog and is not the same surface as the permission-filtered question “ทำอะไรได้บ้าง”.

This behavior remains available through the `บริการของเรา` message command and may be surfaced by Quick Reply or a later rich-menu profile. It is not a direct tile in `Ver1`.

Card title:

> บริการที่บริษัทของคุณเปิดใช้

Rules:

- Use the selected company's result from `loadEntitledFeatureKeys`.
- Reuse `FEATURE_CATALOG` order and `labelTh`; do not maintain a second hand-written service catalog.
- Render only top-level catalog entries with `sellable === true` whose feature key is entitled.
- Do not render platform-baseline entries such as employee/access and company settings as purchased services.
- Do not render a disabled top-level feature, its name, its description, a placeholder, or an upsell.
- V2 lists feature names only. It does not use a parent description that could accidentally advertise an explicitly disabled submenu.
- `entitled === null` retains the repository's legacy fail-open meaning: all sellable top-level features are treated as enabled.
- Order is deterministic. Split a long result across bounded Flex carousel bubbles; no enabled feature may be silently dropped.
- This card is filtered by company entitlement, not personal permission. It answers “บริษัทเปิดบริการอะไร”; any later data/action button must still pass the user's permission checks.
- V2 adds no per-feature action buttons. Existing rich-menu shortcuts and the web workspace already provide navigation.

Example for an expenses + LINE AI company:

> **บริการที่บริษัทของคุณเปิดใช้**  
> ✓ ค่าใช้จ่าย+ใบเสร็จ  
> ✓ ผู้ช่วย AI ทาง LINE

Empty result:

> บริษัทนี้ยังไม่มีบริการที่เปิดใช้งานผ่าน LINE

### 6.2 บริษัทของฉัน

Every linked active user receives one compact current-context card containing only:

> **บริษัทของฉัน**  
> 🏢 `{currentCompanyName}`  
> 👤 `คุณ{displayName}`  
> 💼 `{resolvedRoleLabels}`

Rules:

- Use the active selected company, authenticated user display name, and resolved human-readable role labels.
- Multiple roles are joined in a stable order. Never expose internal role keys, membership IDs, company IDs, branch scope, permission counts, or entitlement keys.
- Non-owner users receive only the current-context card.
- If the user has active `OWNER` memberships, also return every company in which that user is currently an owner, so the owner can see the names and switch context.
- The current company appears first and is marked `กำลังใช้งาน`; it has no redundant switch button.
- Every other owner company has a `เปลี่ยนมาใช้บริษัทนี้` message action backed by its immutable `companyId`.
- Re-check active membership and the `OWNER` role at switch time, then audit the successful context change. A stale or forbidden choice returns the refreshed allowed list without changing context.
- If the owner has only one owner company, do not send a second switcher card.
- If the list exceeds one LINE carousel, paginate deterministically and keep every allowed company reachable; never silently omit a company name.

### 6.3 ถ่ายใบเสร็จ

- The rich-menu tile sends `ถ่ายใบเสร็จ`.
- The server checks `expenses.upload` and any existing receipt-intake permission accepted by the canonical LINE capture path.
- Allowed users receive a short instruction card plus the native Quick Reply actions `เปิดกล้อง`, `แนบรูปใบเสร็จ`, and a safe way back to the menu.
- The instruction card must not render a decorative drop-zone, paperclip, or other element that looks tappable but has no LINE action. The native Quick Reply actions are the only upload affordances.
- A submitted image follows the existing receipt validation, storage, OCR, duplicate detection, draft creation, and web-review flow.
- A media-only receipt starts its own serial background lane after durable acceptance. It immediately tells the sender that the image was received and that normal chat can continue; later text and rich-menu commands must not wait for OCR. Receipt jobs from the same chat remain serial, and captioned media stays on the ordered main lane so its text cannot be detached from the image it describes.
- The final receipt result may therefore arrive after a later text answer. This is intentional and must be distinguishable as the result of the earlier image.
- LINE capture never confirms, approves, pays, exports, voids, or posts the expense automatically.
- Feature-disabled and permission-denied states remain distinct and do not expose internal keys.

### 6.4 คุยกับน้องมั่งมี

- Use a postback action with `inputOption=openKeyboard`; tapping the tile sends the static welcome below but does not invoke a model or read ERP data.
- Exact welcome: `สวัสดีค่ะ 😊 น้องมั่งมีมาแล้วนะคะ\nวันนี้มีอะไรให้น้องช่วยแบ่งเบาบ้าง บอกได้เลยค่ะ 💚`
- Once the user sends text, the normal LINE assistant pipeline handles casual conversation, capability help, and business questions.
- An unlinked user's first sent message receives the existing account-link prompt.
- Unsupported LINE clients still leave the normal chat input available; no business state changes on the tile tap.

### 6.5 สรุปค่าใช้จ่าย

- The tile sends `ดูค่าใช้จ่ายเดือนนี้` through the existing semantic query pipeline.
- Require the expense feature and one of the canonical expense-read permissions.
- Apply the selected company plus current branch/own scope.
- Return the grounded current-month expense summary already defined by the LINE expense tool contract; do not expose attachment bytes or internal evidence.
- Empty data is a successful zero-state card. Feature-disabled, forbidden, and temporarily unavailable remain distinct states.

### 6.6 ติดต่อเรา

This card is public and deterministic.

Visible content:

> **ติดต่อมั่งมี Plus**  
> ✉️ contact@mangmeeplus.com  
> 📱 **098-256-5628**

Actions:

- The phone row uses `tel:0982565628`.
- The email remains visible as fallback and may use a Clipboard action with `clipboardText=contact@mangmeeplus.com` on supported LINE clients.
- Do not use `mailto:`: LINE URI actions support `http`, `https`, `line`, and `tel` schemes.
- Footer button label: `เว็บไซต์อย่างเป็นทางการ`.
- Footer URI: `https://official.mangmeeplus.com/`.
- `altText`: `ติดต่อมั่งมี Plus: contact@mangmeeplus.com โทร 098-256-5628`.

### 6.7 เริ่มต้นใช้งานฟรี

- This is a public URI action; it does not require a linked LINE account or selected company.
- Visible label: `เริ่มต้นใช้งานฟรี`.
- `Ver1` URI: `https://official.mangmeeplus.com/`.
- Use HTTPS only. Do not append user, company, membership, role, entitlement, or other tenant data to the URL.
- A future dedicated onboarding landing page may replace this URI only through a new versioned manifest and link smoke test.
- `ฟรี` is an approved CTA label for this tile, not a statement that every feature, package, or future service is free. The destination must provide the current commercial terms.

## 7. Presentation rules

- Thai-first copy, Mangmee visual tokens, concise mobile layout, and readable contrast.
- Every Flex message has useful `altText`; icons never carry meaning without adjacent text.
- Company and service names are bounded and wrapped safely.
- No raw tenant URL appears in visible card text; web destinations use URI buttons.
- A card may be rendered differently across LINE clients, so acceptance requires mobile screenshot verification on current iOS and Android clients.
- Completed business replies may restore the existing permission-filtered Quick Reply menu. Public contact and owner-switcher cards do not need unrelated completion actions.
- Trend-driven rich-menu skins may vary, but each action remains visually recognizable, Thai-first, and legible at phone width.

## 8. Security and mutation boundaries

- Rich-menu labels and payloads grant no permission.
- Company names are returned only from the caller's active memberships.
- Owner switching is allowed only to an active company where the caller is still `OWNER` at tap time.
- Feature names come only from the selected company's entitlement result; no other company's configuration is observable.
- Receipt upload keeps the existing media validation, malware/content checks, idempotency, provenance, and draft-only boundary.
- Expense summary remains read-only and permission/ABAC checked.
- Contact content is static public business information and may be handled before identity resolution, but never before webhook signature verification.
- The public free-start link contains no tenant data and grants no entitlement, permission, trial, or account state by itself.

## 9. Edge cases

- Unlinked user taps each of the six tiles.
- Linked user has no valid company or must choose among companies.
- Selected company or membership was disabled after the menu was opened.
- Feature entitlement changes between two taps.
- Company has no entitlement rows (`null`, legacy fail-open).
- Company has entitlement rows but no sellable feature enabled.
- Non-owner has one or multiple memberships.
- Owner has one, several, or more companies than fit in one carousel.
- Owner loses a membership between list and switch.
- Receipt upload feature is on but the user lacks capture permission, and vice versa.
- Expense feature is on but the user lacks read permission.
- Clipboard action is unsupported by the recipient's LINE version.
- AI/provider is unavailable; deterministic company, service, receipt prompt, talk welcome, and contact cards must not depend on model generation.
- A trend refresh changes artwork but accidentally maps an area to the wrong stable behavior or stale URI.
- The active profile fails UAT and must roll back to the last accepted rich-menu resource.

## 10. Acceptance criteria

- [ ] AC-1 `line-rich-menu-v2-ver1` renders one company hero, one receipt tile, and four bottom tiles with the exact six actions in §4; `หน้าหลัก` is not a separate action.
- [ ] AC-2 Every server-handled tap is behind LINE signature and event-idempotency checks.
- [ ] AC-3 `บริการของเรา` lists every and only enabled sellable top-level feature for the selected company, in catalog order.
- [ ] AC-4 An explicitly disabled feature never appears in the service card; a legacy `null` company follows fail-open semantics.
- [ ] AC-5 The service card uses no personal permission filter and contains no disabled-feature upsell or internal key.
- [ ] AC-6 Every linked user sees only current company name, display name, and resolved role labels in the primary company card.
- [ ] AC-7 A non-owner receives no company switcher.
- [ ] AC-8 An owner receives every active owner-company name, current-company marker, and safe switch controls; overflow is reachable through pagination.
- [ ] AC-9 Every company switch re-checks active owner membership, uses immutable `companyId`, changes context once, and writes an audit event.
- [ ] AC-10 `ถ่ายใบเสร็จ` returns native camera/camera-roll Quick Replies only after the feature and permission gates pass.
- [ ] AC-11 Receipt intake creates/reuses a draft and never performs a final approval, payment, export, void, or posting.
- [ ] AC-12 `คุยกับน้องมั่งมี` opens the keyboard, immediately returns the exact welcome in §6.4, and creates no AI turn until the user sends text.
- [ ] AC-13 `สรุปค่าใช้จ่าย` returns a scoped current-month summary or the correct empty/disabled/forbidden/unavailable state.
- [ ] AC-14 An unlinked user can receive the contact card; the other data-bearing actions use the existing link/context flow.
- [ ] AC-15 The contact card shows the exact approved email, phone, and official website; phone and website actions open the correct destinations.
- [ ] AC-16 All cards have useful alt text and pass real LINE iOS/Android visual smoke checks.
- [ ] AC-17 `เริ่มต้นใช้งานฟรี` opens `https://official.mangmeeplus.com/` without exposing tenant or user data.
- [ ] AC-18 Every deployed presentation has an immutable versioned manifest, image checksum, exact behavior mapping, recorded UAT result, and usable rollback target.

## 11. Verification matrix for implementation

At minimum, implementation must leave focused automated checks for:

- the six `Ver1` area-to-behavior mappings, including the non-action `หน้าหลัก` heading;
- service entitlement filtering: all-on, expenses-only, explicit-off, empty, and legacy-null;
- company card: non-owner, one-company owner, multi-company owner, pagination, stale switch, and forbidden switch;
- receipt feature/permission combinations;
- expense summary permission and zero-state behavior;
- public contact behavior before identity resolution while signature verification remains mandatory;
- exact contact values and URI schemes;
- exact free-start HTTPS destination and absence of tenant/user query data;
- manifest coordinate validation, image checksum, and rollback profile metadata;
- model provider not called for deterministic cards or the keyboard-opening welcome.

Real LINE UAT must capture the six rich-menu taps on current iOS and Android clients. A repository-only Flex snapshot is not sufficient release evidence.

## 12. Non-goals

- No automated LINE OA provisioning or activation in this change; the versioned bitmap and manifest are committed for the manual Console flow.
- No per-user rich-menu variants; authorization stays server-side.
- No pricing, package upsell, or disabled-feature advertising in `บริการของเรา`; the separate approved `เริ่มต้นใช้งานฟรี` CTA does not alter that rule.
- No email form, ticketing system, or live-agent handoff in `ติดต่อเรา`.
- No final business mutation from LINE.
- No assumption that one artwork geometry or trend skin is permanent.

## 13. Open questions

None for product behavior. LINE OA activation, rollback-target capture, and iOS/Android UAT evidence remain rollout work.

## Ver2 profile (Owner design 2026-08-27)

Profile `line-rich-menu-v2-ver2` (`scripts/line-oa/rich-menu-v2-ver2.manifest.json`) supersedes Ver1 as the
next skin. Equal 3×2 grid on the same 2500×1686 canvas. Deltas against Ver1, all Owner-directed:

| ช่อง | Ver1 | Ver2 |
|---|---|---|
| Promotion Package ทดลองใช้ฟรี | (ไม่มี — เดิมคือ URI เริ่มต้นใช้งานฟรี) | message `โปรโมชั่น` → การ์ดโปสเตอร์แพ็กเกจ (`staff_menu_promotion`, public เหมือน `contact`) พร้อมปุ่ม ทดลองใช้ฟรี → official site |
| ถ่ายใบเสร็จ | message `ถ่ายใบเสร็จ` → การ์ดถาม แนบรูป/เปิดกล้อง | URI `https://line.me/R/nv/camera/` เปิดกล้อง LINE ทันที ไม่มี bot round-trip (camera action ใช้ได้เฉพาะ quick reply จึงใช้ URI scheme) |
| บริษัทของฉัน / คุยกับน้องมั่งมี / สรุปค่าใช้จ่าย / ติดต่อเรา | — | action เดิมทุกประการ ย้ายตำแหน่งตาม grid ใหม่ |

Typed `ถ่ายใบเสร็จ` text still returns the attach/camera helper card — only the tile stops asking.

Related deterministic behavior added with Ver2 (independent of the menu skin): a SHORT standalone
capability question ("ทำอะไรได้บ้าง" and bounded variants — `isCapabilityQuestion`) is answered by the
curated `buildCapabilityCard` listing ONLY the six real functions, because a model-composed answer
advertised features that do not exist (Owner report 2026-08-27). Business questions that merely contain a
stem keep the full AI route; the matcher requires the system as subject for the generic "ใช้ยังไง" stems.

Pending assets (Owner-supplied design exports, not yet committed):

1. `apps/web/public/assets/line/mangmeeplus-line-rich-menu-v2-ver2-2500x1686.png` — menu bitmap; record
   sha256/byteSize into the manifest when committed (the manifest spec enforces this pairing).
2. `apps/web/public/assets/line/mangmeeplus-package-promo-1080x1350.png` — package poster served by the web
   app for the promotion card hero (4:5; keep under ~1 MB for fast chat loading).
