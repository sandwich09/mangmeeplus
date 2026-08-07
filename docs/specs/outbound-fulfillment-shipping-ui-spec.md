# Outbound Fulfillment and Shipping — UI Design Spec

## 1. Status

Companion to `specs/outbound-fulfillment-shipping-spec.md` (the system spec). This document covers only the web UI: screens, components, states, copy, and responsive behavior. It reuses the existing Mangmee design system verbatim and adds nothing to the visual language.

Rendered flow diagrams for this module: `Doc/diagrams/shipping-*.png`.

Active implementer target: any web dev familiar with `apps/web/src/features/*`.

## 2. Design system contract — reuse, do not invent

Everything here is built from the existing Mangmee system. Source of truth:

- Components: `apps/web/src/common/components/mangmee/` — `MangmeePage`, `MangmeeCard`, `MangmeeMutedCard`, `MangmeeBadge`, `MangmeeIconFrame`, `MangmeeStatCard`, `MangmeeBranchChip`, plus `cx`, `MangmeeTone`.
- Tokens: `packages/design-tokens/tokens.json` → `apps/web/app/globals.css` `@theme` block. Brand ramp is green (`brand-500 #22c55e`, `brand-700 #15803d`).
- CSS classes: `.mangmee-page`, `.mangmee-card`, `.mangmee-btn{-primary|-secondary|-danger}`, `.mangmee-input`, `.mangmee-table`, `.mangmee-segmented`/`.mangmee-tab`, `.mangmee-badge-{tone}`.
- State components: `common/components/state/` — `LoadingState`, `CoverLoader`, `EmptyState`, `ErrorState`, `ForbiddenState`; inline `StateBanner`/`ErrorBanner`/`InfoBanner` pattern from `features/expenses/ExpensesUi.tsx`.
- Forms: `common/components/field/` — `TextField`, `SelectField`, `ThemedSelect`, `ThemedDate`. **Never a bare `<select>` or `<input type=date>`.**
- Modal: `common/components/modal/Modal.tsx` — the only shared dialog.
- Icons: `@/common/icons`.
- i18n: `t(key, locale)` from `common/i18n/workspace-i18n.logic`, keys in `common/i18n/workspace-dictionary.ts`, `th` object is the source of truth and the default.

**Canonical reference pages to copy from:** `features/expenses/ExpensesPages.tsx` + `ExpensesUi.tsx` (richest, fully migrated), `features/tax/TaxWorkspacePage.tsx` (master–detail + tabs). **Do not** model on `ProcurementPages.tsx` — it is legacy and hand-rolls `bg-blue-600` buttons and its own status badge.

### 2.1 Decisions this module makes about system gaps

The design-system audit surfaced open choices. This module resolves them locally and, where noted, should promote the result to `common/`:

| Gap | Decision for this module |
| --- | --- |
| Two competing input classes | Use `.mangmee-input` (via `TextField`/`SelectField` from `field/`). Match Tax/Expenses, not the AddEmployee wizard's larger `h-11` variant. |
| No shared status badge | Use the Expenses pattern A: `STATUS_TONE` map → `MangmeeBadge`. Define `SHIPMENT_STATUS_TONE` in `fulfillment.constants.ts`. |
| No confirm dialog | Build void/cancel confirms on `Modal`. Do not use `window.confirm`/`window.prompt`. |
| No drawer component | The shipment detail is a route, not a drawer. The create form is a route. No new drawer primitive. |
| Thai address block not extractable | **Extract** the postal-code lookup from `AddEmployeePrototypePage` into `common/components/address/ThaiAddressFields.tsx` as part of this work — both this module and the future company-profile page need it. |

### 2.2 Module tone

Register the module tone in `mangmee-design.ts` `mangmeeMenuToneByKey`: `fulfillment: 'sky'`. Sky (`#2e90fa` text on `#edf7ff`) reads as "movement / in transit" and is not yet taken by a finance-group sibling. Carrier settings inherit the same tone.

## 3. Menu placement

Per the menu-reorg proposal (audit section 4), fulfillment belongs in the new **"รายจ่าย/คลัง"** neighbourhood, but functionally it is downstream of sales. Place it:

- Primary nav: group **operate**, key `fulfillment`, label `module.fulfillment` = "การจัดส่ง", after `inventory`. Gated by `fulfillment.shipment.read` and the `fulfillment_shipping` entitlement.
- Carrier config: under settings group **"บริษัท"**, route `/settings/carriers`, gated by `fulfillment.carrier.read`.
- Cross-links: an "จัดส่ง" action on an `ISSUED` accounting document; a shipments tab on Customer 360.

## 4. Screen inventory

| # | Route | Screen | Primary permission |
| --- | --- | --- | --- |
| S1 | `/companies/:companyId/fulfillment` | Shipment list | `fulfillment.shipment.read` |
| S2 | `/companies/:companyId/fulfillment/new` | Create shipment | `fulfillment.shipment.create` |
| S3 | `/companies/:companyId/fulfillment/:shipmentId` | Shipment detail | `fulfillment.shipment.read` |
| S4 | `/companies/:companyId/settings/carriers` | Carrier config | `fulfillment.carrier.read` |
| S5 | `/companies/:companyId/inventory/scan` (extended) | Parcel scan result | `fulfillment.shipment.read` |
| S6 | Customer 360 tab | Customer shipments | `fulfillment.shipment.read` |

## 5. S1 — Shipment list

### 5.1 Anatomy

```
MangmeePage
  eyebrow  = t('nav.group.operate')        // "งานประจำวัน"
  title    = t('fulfillment.page_title')   // "การจัดส่ง"
  description = t('fulfillment.page_desc')  // "จัดการพัสดุ ติดตามสถานะ และออกใบส่งของ"
  meta     = <MangmeeBranchChip label={branchLabel} />
  actions  = <button className={btnClass}> + สร้างใบจัดส่ง </button>   // if canCreate

  1. KPI row      — grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4
  2. Status tabs  — mangmee-segmented
  3. Filter row   — carrier, date range, search tracking/recipient
  4. Table card   — mangmee-table inside overflow-x-auto, paginated
```

### 5.2 KPI row — `MangmeeStatCard × 4`

| Card | value | tone | sub |
| --- | --- | --- | --- |
| รอแพ็ค | count DRAFT | slate | "ใบจัดส่ง" |
| กำลังส่ง | count HANDED_OVER + IN_TRANSIT | sky | "พัสดุ" |
| ส่งไม่สำเร็จ | count FAILED | danger | "ต้องจัดการ" |
| COD ค้างรับ | sum codAmount where codStatus=COLLECTED (not REMITTED) | amber | "บาท" |

`COD ค้างรับ` is `font-mono tabular-nums`. Hide the COD card entirely when the company has no COD-enabled carrier — do not show a permanent `฿0`.

### 5.3 Status tabs — `mangmee-segmented`

```tsx
const STATUS_TABS = ['ALL','DRAFT','PACKED','IN_TRANSIT','DELIVERED','PROBLEM'] as const;
// PROBLEM groups FAILED + RETURNED. IN_TRANSIT tab includes HANDED_OVER.
<div className="mangmee-segmented w-fit max-w-full overflow-x-auto">
  {STATUS_TABS.map(tab => (
    <button key={tab} onClick={() => setTab(tab)}
      className={cx('mangmee-tab whitespace-nowrap', tab === active ? 'mangmee-tab-active' : 'hover:text-gray-700')}>
      {t(`fulfillment.tab.${tab.toLowerCase()}`, locale)}
    </button>
  ))}
</div>
```
Default tab is not `ALL` — it is an "open work" view (`DRAFT + PACKED + IN_TRANSIT`), so staff land on what needs action. Label it `tab.open` = "ที่ต้องจัดการ" and make it the first tab.

### 5.4 Filters

Row of `ThemedSelect` (carrier), two `ThemedDate` (from/to), and a search `input.mangmee-input` for tracking number or recipient name. Layout `flex flex-wrap items-end gap-3`. On mobile they stack; each control is `min-w-0`.

### 5.5 Table

Columns (`.mangmee-table`, wrapped in `overflow-x-auto`):

| Header (th) | Cell |
| --- | --- |
| เลขที่ | `shipmentNumber`, brand-700 link to S3 |
| ผู้รับ | `recipientName` + gray-400 `provinceTh` line below |
| ขนส่ง | carrier name + tracking; tracking is a link to `carrier.trackingUrlTemplate` (new tab) |
| สถานะ | `<StatusBadge status={s.status} />` |
| COD | `codAmount` right-aligned `font-mono tabular-nums`, badge if pending; `—` if none |
| วันที่ | `createdAt` short Thai date |

Row: `border-b last:border-0 hover:bg-gray-50 cursor-pointer` → navigates to S3.
Empty: `<EmptyRow cols={6} text={t('fulfillment.empty', locale)} />` = "ยังไม่มีใบจัดส่งในช่วงนี้".
Loading: `CoverLoader scope="table"` over the card.
Pagination: `Pagination` component in the card footer.

### 5.6 States

- No permission → the nav item is absent; a direct URL shows `ForbiddenState`.
- Entitlement off → nav absent; direct URL shows `ForbiddenState` with copy "แพ็กเกจของบริษัทยังไม่เปิดฟีเจอร์การจัดส่ง".
- Error → `StateBanner` at top (permission-aware), keep last data dimmed.

## 6. S2 — Create shipment

The highest-friction screen. Optimize for "invoice → shipment in three taps".

### 6.1 Flow

```
Step feel, but single scroll page (not a wizard — one source doc, short form):

  ┌ เลือกเอกสารต้นทาง ────────────────────────┐
  │ ThemedSelect: pick an ISSUED invoice/receipt │  → on select, auto-fill everything below
  │ or "ไม่อ้างอิงเอกสาร" (MANUAL)               │
  └───────────────────────────────────────────┘
  ┌ ผู้รับและที่อยู่ ──────────────────────────┐
  │ recipientName, recipientPhone               │  pre-filled from shippingAddressJson
  │ <ThaiAddressFields/>  (extracted component)  │  validated vs ThaiAddressMaster
  │ addressNote                                  │
  └───────────────────────────────────────────┘
  ┌ รายการสินค้า ─────────────────────────────┐
  │ line editor: product, location, qty  [+ เพิ่มรายการ] │  pre-filled from doc lines
  └───────────────────────────────────────────┘
  ┌ ขนส่งและ COD (ไม่บังคับตอนสร้าง) ──────────┐
  │ ThemedSelect carrier · codAmount            │  can be left blank; set at handover
  └───────────────────────────────────────────┘

  [ ยกเลิก ]  [ บันทึกร่าง ]  [ บันทึกและแพ็คเลย ]
```

### 6.2 Source document picker

`ThemedSelect` listing recent `ISSUED` accounting documents (number + customer + total). Selecting one calls the create-shipment prefill: recipient and address snapshot from `shippingAddressJson` (fall back to `CrmCustomer.shippingAddressJson`), lines from document lines. A "ไม่อ้างอิงเอกสาร" option sets `sourceType='MANUAL'` and leaves the form blank.

### 6.3 Address — extracted `ThaiAddressFields` component

Build `common/components/address/ThaiAddressFields.tsx` by lifting the logic from `AddEmployeePrototypePage.tsx` (lines ~305–390):

- Props: `{ value: ShipmentAddress, onChange, companyId, disabled?, locale? }`.
- Behavior preserved exactly: postal `>= 3` digits triggers `listThaiAddresses` with 300 ms debounce; auto-cascade province → district → subdistrict; changing postal clears the three; graceful degradation to free-text when master data misses (`addressFreeform`), with the warning copy `'ไม่พบข้อมูลใน master กรุณากรอกที่อยู่เอง'`.
- Layout: `grid gap-4 sm:grid-cols-2 xl:grid-cols-3`; address line spans full width.
- Adds two fields not in the employee version: `recipientName`, `recipientPhone` at the top, and `addressNote` ("ฝากไว้ที่ รปภ.") at the bottom.

This is the one genuinely reusable extraction and the company-profile page (audit) needs it too.

### 6.4 Line editor

Repeatable row: `ThemedSelect product` · `ThemedSelect location` · `input qty` (`font-mono tabular-nums`, decimal) · a `TrashIcon` remove button. A `+ เพิ่มรายการ` ghost button appends. When prefilled from a source document, rows are populated but the location select starts empty and is required — packing must know where stock leaves from.

Inline validation: qty > 0, product and location required. Errors show under the row in `text-error-600 text-xs`.

### 6.5 Submit buttons

- `บันทึกร่าง` (`btnClass`) → creates `DRAFT`, navigates to S3.
- `บันทึกและแพ็คเลย` (`successBtn` from Expenses) → creates then immediately calls `pack`; on insufficient stock it stays on the form and shows the failing lines (see 6.6).
- `ยกเลิก` (`ghostClass`) → back to S1.

### 6.6 Insufficient-stock error

When pack fails closed, show an `ErrorBanner` naming each offending line: "สต๊อกไม่พอ: [สินค้า] ที่ [ที่จัดเก็บ] คงเหลือ X ต้องการ Y". Highlight those line rows with `border-error-300`. Because there is no reservation (system spec D13), add a muted hint under the banner: "ระบบยังไม่จองสต๊อกล่วงหน้า สินค้าอาจถูกใบจัดส่งอื่นตัดไปก่อน".

## 7. S3 — Shipment detail

Master–detail is not needed here; it is a single record with a timeline. Layout: two columns on `xl`, stacked below.

```
MangmeePage (alternate header: breadcrumb "มั่งมี / การจัดส่ง / SH-xxxx" + MangmeeBranchChip)
  title = shipmentNumber, with <StatusBadge> beside it
  actions = context actions computed from SHIPMENT_TRANSITIONS ∩ permissions

  grid gap-6 xl:grid-cols-[1.6fr_1fr]
  ├ LEFT
  │   MangmeeCard "ผู้รับและที่อยู่"     — recipient, structured address, phone, note, map hint (lat/long)
  │   MangmeeCard "รายการสินค้า"          — lines table; each line shows its inventoryMovementId once packed
  │   MangmeeCard "ขนส่งและ COD"          — carrier, tracking (link), weight/dims, COD status
  └ RIGHT
      MangmeeCard "ไทม์ไลน์"             — ShipmentEvent list, newest first, source-tagged
      MangmeeCard "เอกสาร"               — print delivery note PDF, print parcel QR
```

### 7.1 Action buttons — the transition contract

Buttons are derived, never hard-coded:

```tsx
const allowed = SHIPMENT_TRANSITIONS[shipment.status];          // from @watchdog-bms/contracts
const canDo = (to: ShipmentStatus, perm: string) =>
  allowed.includes(to) && permissions.includes(perm);

// render a button ONLY when canDo(...) is true — never a disabled button that 403s
{canDo('PACKED', 'fulfillment.shipment.pack')      && <button className={btnClass}   onClick={pack}>แพ็ค</button>}
{canDo('HANDED_OVER','fulfillment.shipment.handover') && <button className={btnClass} onClick={openHandover}>ส่งมอบขนส่ง</button>}
{canDo('VOIDED','fulfillment.shipment.void')       && <button className={dangerClass} onClick={openVoid}>ยกเลิกเอกสาร</button>}
{canDo('CANCELLED','fulfillment.shipment.update')  && <button className={ghostClass}  onClick={openCancel}>ยกเลิก</button>}
```

The discount-policy and role-matrix pages render buttons that 403 on submit. This module must not repeat that: a button the viewer cannot use must not render. This is an acceptance criterion.

### 7.2 Handover modal

`Modal size="md" title="ส่งมอบให้ขนส่ง"`:
- `ThemedSelect carrier` (required) · `input trackingNumber` (required) · `ThemedSelect serviceLevel` (optional) · weight + 3 dimension inputs (`font-mono`, optional) · `ThemedDate handedOverAt` (default today).
- Footer: `ghostClass` ยกเลิก + `btnClass` ยืนยันส่งมอบ.
- On confirm → `handover` endpoint → close, refresh, timeline gains a USER event.
- If the selected carrier has a `trackingPattern`, validate the tracking number against it and show `text-warning-600` "รูปแบบเลขพัสดุอาจไม่ถูกต้อง" — a warning, never a block (system spec D5).

### 7.3 Void / cancel modals

`Modal` with a required reason `textarea.mangmee-input`. Void copy warns "การยกเลิกเอกสารจะคืนสต๊อกกลับคลัง" and is a `dangerClass` confirm. Cancel (DRAFT only) has no stock effect and uses `btnClass`.

### 7.4 Timeline

`ShipmentEvent` rows, newest first:

```tsx
<li className="flex gap-3 border-b border-gray-100 py-3 last:border-0">
  <MangmeeIconFrame tone={eventTone(ev)}><DotIcon/></MangmeeIconFrame>
  <div className="min-w-0">
    <div className="text-sm font-semibold text-gray-800">{eventLabel(ev)}</div>
    <div className="text-xs text-gray-400">{sourceLabel(ev.source)} · {thaiDateTime(ev.occurredAt)}</div>
    {ev.statusApplied === false && <span className="text-xs text-warning-600">บันทึกไว้ แต่ยังไม่เปลี่ยนสถานะ (มาก่อนลำดับ)</span>}
  </div>
</li>
```
`eventTone`: SYSTEM→slate, USER→brand, CARRIER→sky, SCAN→cyan. An out-of-order carrier event (`statusApplied:false`) is shown but visibly annotated — this is how staff understand a `DELIVERED`-then-late-`IN_TRANSIT` case.

### 7.5 Documents card

- `พิมพ์ใบส่งของ` → opens the delivery-note PDF (item 08 document engine, company header from the company-profile page). Disabled until `PACKED`.
- `พิมพ์ QR ติดกล่อง` → generates/loads the `SHIPMENT` QR label and opens the print view. Idempotent.
- A source-mismatch warning banner appears here if the source document was voided after packing (system spec edge case): "เอกสารต้นทางถูกยกเลิกหลังแพ็คแล้ว — ตรวจสอบก่อนจัดส่ง".

## 8. S4 — Carrier config

Settings page under "บริษัท". Simple CRUD list.

```
MangmeePage title="ผู้ให้บริการขนส่ง" description="ตั้งค่าขนส่งที่ร้านใช้ เปิด/ปิด และลิงก์ติดตามพัสดุ"
  actions = + เพิ่มขนส่ง
  MangmeeCard > mangmee-table:
    ชื่อ | ประเภท (CarrierKind badge) | รองรับ COD (✓/—) | สถานะ (ACTIVE/DISABLED badge) | จัดการ
```

Create/edit in a `Modal`: code, name, nameTh, `ThemedSelect kind`, `SwitchField supportsCod`, `trackingUrlTemplate` (with `{trackingNumber}` hint), optional `trackingPattern`, `sortOrder`. Disable action is blocked with a toast "มีใบจัดส่งที่ยังไม่ปิด ใช้ขนส่งนี้อยู่ N รายการ" when open shipments reference it. Seed carriers (Kerry, Flash, J&T, ไปรษณีย์ไทย, Lalamove, Grab, ส่งเอง, รับเองที่ร้าน) appear as editable rows.

Phase 2 adds a webhook section per carrier: webhook URL (read-only, copyable), rotate key button (mirrors the LINE OA rotate UX in `LineOaSettingsPage`), enable toggle.

## 9. S5 — Parcel scan (extends existing scan page)

The current `/inventory/scan` is a text input. Phase 1 keeps it but makes a `WD1:SHP:` payload resolve to the shipment: on resolve, show a compact shipment summary card with the same derived action buttons as S3 (§7.1). Phase 2 replaces the text input with a live camera scanner (`getUserMedia` + a barcode-detector). The camera work is called out as net-new in the system spec; the UI target is a full-bleed camera view with a scan reticle, a torch toggle, and a fallback "พิมพ์รหัสเอง" link that reveals the current text input.

## 10. S6 — Customer 360 shipments tab

Customer 360 (`features/crm/Customer360Page`) currently renders a `PlaceholderCard` for service jobs. Do not add another placeholder. The shipments tab is either real or absent. When present: a compact `mangmee-table` of that customer's shipments (number, status badge, carrier+tracking link, date), read-only, each row linking to S3. Gated by `fulfillment.shipment.read`; if the viewer lacks it, the tab is not rendered.

## 11. Status → tone mapping

`fulfillment.constants.ts`:

```ts
import type { MangmeeTone } from '@/common/components/mangmee';
export const SHIPMENT_STATUS_TONE: Record<string, MangmeeTone> = {
  DRAFT:       'slate',
  PACKED:      'indigo',
  HANDED_OVER: 'sky',
  IN_TRANSIT:  'sky',
  DELIVERED:   'brand',
  FAILED:      'danger',
  RETURNED:    'amber',
  CANCELLED:   'slate',
  VOIDED:      'slate',
};
export const COD_STATUS_TONE: Record<string, MangmeeTone> = {
  NOT_APPLICABLE: 'slate', PENDING: 'amber', COLLECTED: 'sky', REMITTED: 'brand',
};
```

`StatusBadge` and `CodBadge` follow the Expenses pattern A exactly: `<MangmeeBadge tone={SHIPMENT_STATUS_TONE[s] ?? 'slate'}>{label}</MangmeeBadge>` with labels from the dictionary.

## 12. i18n keys to add

Append to the `th` object in `workspace-dictionary.ts` (then mirror in `en`). Namespace `fulfillment.*` and `module.fulfillment`:

```
module.fulfillment            = การจัดส่ง
fulfillment.page_title        = การจัดส่ง
fulfillment.page_desc         = จัดการพัสดุ ติดตามสถานะ และออกใบส่งของ
fulfillment.create            = สร้างใบจัดส่ง
fulfillment.tab.open          = ที่ต้องจัดการ
fulfillment.tab.all           = ทั้งหมด
fulfillment.tab.draft         = รอแพ็ค
fulfillment.tab.packed        = แพ็คแล้ว
fulfillment.tab.in_transit    = กำลังส่ง
fulfillment.tab.delivered     = ส่งถึงแล้ว
fulfillment.tab.problem       = มีปัญหา
fulfillment.empty             = ยังไม่มีใบจัดส่งในช่วงนี้
fulfillment.status.DRAFT      = ร่าง
fulfillment.status.PACKED     = แพ็คแล้ว
fulfillment.status.HANDED_OVER= ส่งมอบขนส่งแล้ว
fulfillment.status.IN_TRANSIT = กำลังจัดส่ง
fulfillment.status.DELIVERED  = ส่งถึงแล้ว
fulfillment.status.FAILED     = ส่งไม่สำเร็จ
fulfillment.status.RETURNED   = ตีกลับ
fulfillment.status.CANCELLED  = ยกเลิก
fulfillment.status.VOIDED     = ยกเลิกเอกสาร
fulfillment.action.pack       = แพ็ค
fulfillment.action.handover   = ส่งมอบขนส่ง
fulfillment.action.void       = ยกเลิกเอกสาร
fulfillment.insufficient      = สต๊อกไม่พอ
fulfillment.no_reservation_hint = ระบบยังไม่จองสต๊อกล่วงหน้า สินค้าอาจถูกใบจัดส่งอื่นตัดไปก่อน
... (carrier.*, cod.*, handover.* as needed)
```

All copy is Thai-first. The accounting module's English drift must not be repeated anywhere in this feature.

## 13. Responsive behavior

Follows the shell contract (`.mangmee-content` `overflow-x: clip`, `.mangmee-page > * { min-width: 0 }`):

- **< 768 (mobile):** KPI cards `grid-cols-2`; status tabs scroll horizontally (`overflow-x-auto whitespace-nowrap`); filter controls stack; the table scrolls inside its own `overflow-x-auto` (never the body); S3 columns stack (timeline drops below the detail cards); action buttons wrap under the title. This is the primary target — warehouse staff pack on phones.
- **768–1024 (tablet):** KPI `grid-cols-2`; S3 stays single column until `xl`.
- **≥ 1280 (`xl`):** KPI `grid-cols-4`; S3 becomes `grid-cols-[1.6fr_1fr]`; create form address block `xl:grid-cols-3`.

The scan screen (S5) is mobile-first by nature; design the camera view for a phone held vertically.

## 14. Accessibility & interaction

- Every action button states its exact effect; toasts confirm in past tense ("แพ็คแล้ว", "ส่งมอบแล้ว").
- `Modal` already provides focus trap, Escape close, and focus restore — reuse it, do not roll a new dialog.
- Status is never encoded by colour alone: each badge carries a Thai label. The timeline pairs an icon frame with text.
- Tracking-number links open in a new tab with `rel="noopener"`.
- Numeric columns use `font-variant-numeric: tabular-nums` so COD amounts align.
- Respect `prefers-reduced-motion` — the shell already gates its animations; add none that ignore it.

## 15. Component build list

New files, all under existing conventions:

- `common/components/address/ThaiAddressFields.tsx` — extracted, reusable. **Shared win.**
- `features/fulfillment/FulfillmentListPage.tsx` (S1)
- `features/fulfillment/CreateShipmentPage.tsx` (S2)
- `features/fulfillment/ShipmentDetailPage.tsx` (S3)
- `features/fulfillment/components/{StatusBadge,CodBadge,ShipmentTimeline,LineEditor,HandoverModal,VoidModal}.tsx`
- `features/fulfillment/fulfillment.api.ts` — authed-fetch client, typed against `@watchdog-bms/contracts` (not `any`, unlike banking/AP).
- `features/fulfillment/fulfillment.model.ts` / `.constants.ts` / `.logic.ts`
- `features/carrier-settings/CarrierSettingsPage.tsx` (S4)
- Route files under `apps/web/app/(workspace)/companies/[companyId]/fulfillment/*` and `.../settings/carriers/page.tsx` — thin wrappers.

Reused as-is: `MangmeePage`, `MangmeeCard`, `MangmeeBadge`, `MangmeeStatCard`, `MangmeeBranchChip`, `Modal`, `TextField`/`SelectField`/`ThemedSelect`/`ThemedDate`, all `state/` components, `Pagination`, icons, `useBranchFilter`, `useWorkspaceLocale`.

## 16. Acceptance criteria (UI)

1. Every screen renders in Thai; no English leaks into visible copy.
2. Action buttons on S3 are derived from `SHIPMENT_TRANSITIONS` ∩ permissions — a viewer never sees a button that 403s.
3. With the `fulfillment_shipping` entitlement off, the nav item is absent and direct URLs show `ForbiddenState`.
4. The create form pre-fills recipient, address, and lines from a selected issued invoice, and the address validates against `ThaiAddressMaster` with graceful free-text fallback.
5. Insufficient-stock on pack keeps the user on the form, names the failing lines, and shows the no-reservation hint.
6. `ThaiAddressFields` is a standalone `common/` component consumed by this feature (and available to company-profile).
7. Status and COD badges use the Expenses `MangmeeBadge` pattern, not hand-rolled Tailwind pairs.
8. Tables scroll inside their own container; the page body never scrolls horizontally at any breakpoint from 360 px up.
9. Void and cancel use `Modal` with a required reason; no `window.confirm`/`window.prompt` anywhere.
10. The module tone `fulfillment: 'sky'` is registered and the sidebar icon renders with it.

## 17. Rendered flow diagrams

Exported PNGs in `Doc/diagrams/`, Mangmee green theme, Thai labels:

| File | Diagram |
| --- | --- |
| `shipping-1-boundary.png` | Module ownership and boundaries |
| `shipping-2-asis.png` | Current state — stock leaves with no document |
| `shipping-3-target.png` | Target flow, source document → delivered |
| `shipping-4-state.png` | Shipment state machine |
| `shipping-5-scan.png` | Parcel QR scan sequence |
| `shipping-6-webhook.png` | Carrier webhook ingestion sequence (phase 2) |

Source `.mmd` files are regenerable; the render command uses `@mermaid-js/mermaid-cli` with the base theme recoloured to the brand ramp.
