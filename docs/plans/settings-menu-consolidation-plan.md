# Plan: ตั้งค่า Menu Consolidation + Entitlement Control

Status: IMPLEMENTED — 2026-07-29
Owner: Claude (harness engineer) → Codex (implementation)
Scope: `apps/web` (settings landing, workspace nav) + `packages/contracts` (entitlement registry) +
`apps/api` (entitlement loading and capability-pack gates)
Surface: `/companies/{companyId}/settings` and the workspace sidebar

## What the owner asked

1. Every settings menu must be switchable on/off from the system-admin control plane (Feature Entitlements).
2. Remove **พนักงาน** from ตั้งค่าบริษัท.
3. Move **บทบาทและสิทธิ์** under **พนักงานและสิทธิ์**.
4. Remove **ภาพรวมสิทธิ์** from ตั้งค่าบริษัท.
5. Move **ใบรับรองแทนใบเสร็จ** to be one menu under **ค่าใช้จ่ายและใบเสร็จ**.

## What discovery found

### The settings landing has almost no access control

`settings/page.tsx` builds ten cards. **Only the two Tax cards are permission-gated**; the other eight
render for anyone who can reach the page, regardless of role or company plan. That is the real gap behind
request 1 — the cards are plain `<Link>`s with no `requiredAnyPermissions` equivalent.

### Three of the cards are already in the sidebar

`buildNavItems` (`web-core-workspace.logic.ts:93-127`) already puts these under the **พนักงานและสิทธิ์**
(`roles`) module:

| sidebar sub-item | route | duplicate settings card |
|---|---|---|
| รายบุคคล | `settings/access-overview` | **ภาพรวมสิทธิ์** |
| เพิ่มพนักงาน | `settings/employees` | **พนักงาน** |
| (lineoa) | `settings/line-oa` | **เชื่อมต่อ LINE OA** |

So requests 2 and 4 are removing duplicates, not removing functionality.

### บทบาทและสิทธิ์ is already the parent menu

`settings/permissions` and `settings/roles` render the **exact same component**
(`PermissionMatrixPrototypePage`) — two routes for one page. The `roles` module's own href is
`settings/permissions`, and its Thai label is พนักงานและสิทธิ์.

So request 3 is already true in substance: clicking พนักงานและสิทธิ์ opens บทบาทและสิทธิ์. The work is to
delete the duplicate card and collapse the duplicate route, not to build a new nesting.

### ใบรับรองแทนใบเสร็จ exists twice, as two different things

| surface | route | what it is | guard |
|---|---|---|---|
| tab under ค่าใช้จ่าย | `/expenses/signatures` | signature assets | `expense.signature.manage` |
| settings card | `/settings/substitute-receipt` | **policy** — approvers + minimum evidence | `company.setup.manage` |

Request 5 moves the *policy* page under ค่าใช้จ่ายและใบเสร็จ. Note its guard is `company.setup.manage`,
a company-setup key — not an expense key.

## Changes

### A. Settings landing — remove the three moved/duplicated cards

Delete the **พนักงาน**, **ภาพรวมสิทธิ์**, and **บทบาทและสิทธิ์** cards from `settings/page.tsx`. All three
remain reachable under พนักงานและสิทธิ์ in the sidebar, so nothing is lost.

Also delete the **ใบรับรองแทนใบเสร็จ** card (it moves to expenses, §C).

Remaining cards: เชื่อมต่อ LINE OA, สินค้าและบริการสำหรับ CRM, ความปลอดภัยบัญชี, สาขา, Tax Code และ Tax Profile,
Tax Account Determination.

### B. Gate every remaining card

Give each card a `requiredAnyPermissions` list and filter before render, so the landing page obeys the same
rule as the sidebar. Extract the card list and the filter into
`apps/web/src/features/web-core-workspace/settings-menu.logic.ts` (+ `.spec.ts`) — pure data and a pure
filter, no JSX — and have `settings/page.tsx` consume it.

| card | requiredAnyPermissions |
|---|---|
| เชื่อมต่อ LINE OA | `crm.channel.read` |
| สินค้าและบริการสำหรับ CRM | `inventory.product.read` |
| สาขา | `company.branch.read`, `company.branch.manage` |
| Tax Code และ Tax Profile | (keep the existing tax list) |
| Tax Account Determination | (keep the existing list) |
| ความปลอดภัยบัญชี | `account.password.change`, `account.identity.link`, `account.identity.unlink` (§E) |

Because these permission keys already flow through `filterPermissionsByEntitlement`, gating the cards on
them is what makes request 1 true: turning `crm`, `inventory`, or `thai_tax` off in the system-admin
Feature Entitlements screen now removes the corresponding settings card too, with no new mechanism.

### C. ใบรับรองแทนใบเสร็จ becomes an expenses sub-menu

Add a seventh sub-item to the `expenses` branch of `buildNavItems`, after ใบรับรองแทนใบเสร็จ (signatures):

- key `expenses.substitute_receipt_policy`
- label ตั้งค่าใบรับรองแทนใบเสร็จ
- href `/companies/{companyId}/settings/substitute-receipt`
- gated on `company.setup.manage` (its real API guard)

Keep the route where it is — moving the page file is churn with no user-visible benefit and would break the
existing deep link at `ExpensesPages.tsx:595`.

**Entitlement note:** do *not* add a dedicated child key to `FEATURE_CATALOG` for this. Its only permission
is `company.setup.manage`, which follows the `company_settings` parent through its existing capability
pack. The sidebar placement still follows `expenses`, so both the Expenses menu and the company-settings
permission must remain available.

Add the route to `canAccessWorkspacePath`'s `exactSettingsRules` so opening it by URL is checked too.

### D. Sidebar — collapse the duplicate roles route

`settings/roles` and `settings/permissions` render the same component. Make `settings/roles` a redirect to
`settings/permissions` (the canonical one the module already points at), following the existing redirect
pattern in `expenses/[expenseId]/page.tsx`. One page, one URL.

### E. Gate the foundation areas too — owner decision 2026-07-29

I initially recommended leaving ความปลอดภัยบัญชี and พนักงานและสิทธิ์ ungated on lockout grounds. **The
owner corrected the premise and is right**: these switches live on the Partner Companies screen in
WatchDog System Admin, i.e. they are set by the *platform operator* to match what each company pays for —
never by the company itself.

That removes the lockout argument. A company cannot switch its own administration off, and the platform
admin can restore any switch from the same screen at any time. "No in-product way back" was simply false.

So **every settings menu becomes gateable**, including พนักงานและสิทธิ์ and ความปลอดภัยบัญชี.

#### The real hazard this exposes: new parent keys are deny-by-default

Foundation permissions today live in packs with **no `featureEntitlementKey`**, which is what makes them
ungated. Attaching them to a new parent feature key changes their default in a dangerous direction:

`loadEntitledFeatureKeys` builds the entitled set from the rows a company actually has. Existing companies
have rows only for the current 12 keys. A brand-new key therefore resolves to **absent → not entitled →
permissions stripped**. Shipping new parent keys naively would silently remove employee management,
branches, and account security from **every existing tenant** on deploy.

The child-inheritance rule already solved the same problem one level down. Apply the same shape here:

- Add `DEFAULT_ON_FEATURE_KEYS` — feature keys that are treated as enabled when the company has **no
  explicit row** for them. Only an explicit `enabled: false` row turns them off.
- Materialize that in `loadEntitledFeatureKeys` next to the existing child inheritance, so
  `filterPermissionsByEntitlement` and all its call sites stay untouched.
- Every new key in this section goes in that set. The original 12 keys do **not** — their deny-by-default
  behavior is deliberate and must not change.

#### New feature keys

| key | labelTh | children (sub-menus) | permission keys |
|---|---|---|---|
| `employee_access` | พนักงานและสิทธิ์ | `employee_access.employees` (พนักงาน), `employee_access.roles` (บทบาทและสิทธิ์), `employee_access.overview` (ภาพรวมสิทธิ์) | `access.employee.*` / `access.role.*`, `access.capability_pack.read`, `access.role_template.*` / `access.effective.read` |
| `company_settings` | ตั้งค่าบริษัท | `company_settings.branches` (สาขา), `company_settings.security` (ความปลอดภัยบัญชี) | `company.branch.read`, `company.branch.manage` / `account.password.change`, `account.identity.link`, `account.identity.unlink` |

Both go in `DEFAULT_ON_FEATURE_KEYS`, and both appear in the admin Feature Entitlements screen with their
sub-menus, exactly like the existing features.

#### Correction after implementation — gate at the submenu, not at the pack

The instruction above said to attach the feature keys to `pack.people.view`, `pack.people.manage`,
`pack.company.settings.view`, and `pack.company.settings.manage`. **That was wrong and has been reverted.**
It was written without checking what else those packs carry.

`pack.company.settings.manage` also grants `attachment.create`, `attachment.delete`,
`company.setup.manage`, `document.sequence.manage`, and `outbox.event.read`. Tagging it means turning
ตั้งค่าบริษัท off strips all of them. `attachment.create` is granted by **no other pack** and guards every
upload endpoint in the product (`create-upload-intent`, `complete-attachment-upload`, `link-attachment`,
`attachment.controller`), so the switch would silently break receipt upload for a company whose Expenses
plan is still fully paid for. It would also remove `company.setup.manage`, which is the guard on the
ตั้งค่าใบรับรองแทนใบเสร็จ menu that §C just moved under ค่าใช้จ่าย.

The four packs therefore stay **untagged**. Gating is done entirely by the submenu rules in
`feature-gate.logic.ts`, which name the exact permissions each menu needs and are evaluated before pack
membership — so they still strip `company.branch.*` and `account.password.change` / `account.identity.*`
even though those permissions now sit in an ungated pack. Everything else the packs carry stays on.

One consequence: `access.permission.read` was only reachable through the pack, so it moves into
`employee_access.roles`'s permission list. With that, the three `employee_access` children cover all
fifteen `access.*` permissions and the toggle still strips the whole set.

`account.session.read` stays in `pack.core.basics` and ungated — a user must always be able to hold a
session and sign out, or the tenant cannot be operated at all while the switch is off.

#### One caveat, stated once

Turning `company_settings.security` off removes the in-app password-change and recovery-email screens for
that company. The separate forgot-password flow on the login page is unaffected, so users are not locked
out — but support load moves to the platform operator. That is a pricing decision to make with open eyes,
not a defect.

## Constraints

- No API surface change, Prisma migration, or new permission key.
- Add only the five entitlement child keys listed in §E; do not add one for substitute-receipt policy.
- Pure data/logic in `*.logic.ts` with a `*.spec.ts` sibling; `settings/page.tsx` stays presentational.
- Do not disturb the expense hard-delete or upload fixes already on this branch.

## Verification

1. `corepack pnpm --filter @watchdog-bms/contracts build`
2. `corepack pnpm --filter @watchdog-bms/api test` — run alone
3. `corepack pnpm --filter @watchdog-bms/web test`
4. `corepack pnpm --filter @watchdog-bms/web typecheck`
5. `corepack pnpm --filter @watchdog-bms/web build`
6. Settings landing renders six cards for a full-permission user; security requires a
   `company_settings.security` permission.
7. พนักงานและสิทธิ์ and its direct routes disappear without `employee_access` permissions.
8. ค่าใช้จ่ายและใบเสร็จ lists ตั้งค่าใบรับรองแทนใบเสร็จ for a `company.setup.manage` holder and hides it otherwise.
9. `/settings/roles` redirects to `/settings/permissions`.
10. e2e `SET-08` (settings heading) still passes — check before changing the page title/description.

Baseline: API 0 fail, web 487 pass / 0 fail.

## Out of scope

Moving page files between folders, redesigning the settings landing layout, new permission keys, and
feature keys beyond those explicitly listed in §E.
