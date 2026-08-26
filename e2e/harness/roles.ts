/**
 * Multi-role auth + access-matrix harness for the ACE Tennis Pro Shop E2E suite.
 *
 * The original harness (`auth.ts`) only knows how to sign in as the seeded OWNER via
 * `/api/auth/dev-login`. That endpoint hands out the *dev* token, which is owner-bound —
 * it cannot produce a SALES or STAFF session. The 247-case catalogue in
 * `docs/qa/tennis-shop-e2e-test-cases-2026-07-29.md` is almost entirely about what each of
 * ten roles may and may not see, so real credentialed login is the only usable path.
 *
 * Both helpers below use the *same* endpoints a human uses:
 *   - browser session : POST {web}/api/auth/login   (BFF → httpOnly chunked cookies)
 *   - bearer token    : POST {api}/auth/password/login
 *
 * The QA accounts are seeded by `apps/api/prisma/seed.ts` (`QA_ROLE_ACCOUNTS`) with
 * `mustChangePassword: false`, so there is no change-password interstitial. The helpers complete
 * the current versioned clickwrap after login so ordinary role/permission tests can continue to
 * focus on their business assertions; the dedicated legal suite signs in without these helpers.
 */
import { expect, type APIRequestContext, type BrowserContext } from '@playwright/test';
import {
  API_BASE_URL,
  COMPANY_ID,
  WEB_BASE_URL,
  ensureBearerLegalAcceptance,
  ensureBrowserLegalAcceptance,
} from './auth';

export type RoleKey =
  | 'OWNER'
  | 'COMPANY_VIEW'
  | 'ADMIN'
  | 'MANAGER'
  | 'SALES'
  | 'INVENTORY'
  | 'FINANCE'
  | 'ACCOUNTANT'
  | 'MARKETING'
  | 'STAFF';

/** Mirrors QA_ROLE_ACCOUNTS in apps/api/prisma/seed.ts. Re-seeding repairs these every run. */
export const QA_ACCOUNTS: Record<RoleKey, { username: string; password: string; displayName: string }> = {
  OWNER:        { username: 'qa.owner',      password: 'Qa@Owner123',      displayName: 'อรอนงค์ เจ้าของกิจการ' },
  COMPANY_VIEW: { username: 'qa.company',    password: 'Qa@Company123',    displayName: 'ชญานิศ ผู้บริหาร' },
  ADMIN:        { username: 'qa.admin',      password: 'Qa@Admin123',      displayName: 'ณัฐชา ผู้ดูแลระบบ' },
  MANAGER:      { username: 'qa.manager',    password: 'Qa@Manager123',    displayName: 'ศิริพร ผู้จัดการสาขา' },
  SALES:        { username: 'qa.sales',      password: 'Qa@Sales123',      displayName: 'พิมพ์ชนก ฝ่ายขาย' },
  INVENTORY:    { username: 'qa.inventory',  password: 'Qa@Inventory123',  displayName: 'กิตติพงษ์ คลังสินค้า' },
  FINANCE:      { username: 'qa.finance',    password: 'Qa@Finance123',    displayName: 'วราภรณ์ ฝ่ายการเงิน' },
  ACCOUNTANT:   { username: 'qa.accountant', password: 'Qa@Accountant123', displayName: 'สุภาวดี นักบัญชี' },
  MARKETING:    { username: 'qa.marketing',  password: 'Qa@Marketing123',  displayName: 'ธัญญารัตน์ การตลาด' },
  STAFF:        { username: 'qa.staff',      password: 'Qa@Staff123',      displayName: 'ปวีณ์ พนักงานทั่วไป' },
};

export const ALL_ROLES = Object.keys(QA_ACCOUNTS) as RoleKey[];

/** Sign a browser context in as `role` through the real BFF login route. */
export async function loginAs(context: BrowserContext, role: RoleKey): Promise<void> {
  const account = QA_ACCOUNTS[role];
  const res = await context.request.post(`${WEB_BASE_URL}/api/auth/login`, {
    data: { username: account.username, password: account.password, remember: true },
  });
  expect(
    res.ok(),
    `login as ${role} (${account.username}) failed (${res.status()}): ${await res.text()}\n` +
      `Re-seed the DB — QA credentials are repaired on every seed run.`,
  ).toBe(true);
  const body = (await res.json()) as {
    passwordChangeRequired?: boolean;
    companyId?: string | null;
  };
  expect(
    body.passwordChangeRequired ?? false,
    `${role} was asked to change password; seed sets mustChangePassword=false — DB is stale`,
  ).toBe(false);
  await ensureBrowserLegalAcceptance(context, body.companyId ?? COMPANY_ID);
}

/** Bearer access token for `role`, for direct API assertions. */
export async function getRoleToken(request: APIRequestContext, role: RoleKey): Promise<string> {
  const account = QA_ACCOUNTS[role];
  const res = await request.post(`${API_BASE_URL}/auth/password/login`, {
    data: { username: account.username, password: account.password },
  });
  expect(res.ok(), `password login as ${role} failed (${res.status()}): ${await res.text()}`).toBe(true);
  const body = (await res.json()) as { accessToken?: string };
  expect(body.accessToken, `accessToken present for ${role}`).toBeTruthy();
  await ensureBearerLegalAcceptance(request, body.accessToken!, COMPANY_ID);
  return body.accessToken!;
}

// ---------------------------------------------------------------------------
// Access matrix — the single source of truth for every permission assertion.
//
// Derived from apps/api/src/modules/auth/permission-registry.ts (ROLE_GRANTS) and
// apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts
// (WORKSPACE_MODULES.requiredAnyPermissions) — not from reading the UI.
// If a test disagrees with this table, one of the three is wrong; find out which
// before editing anything.
// ---------------------------------------------------------------------------

export type MenuSpec = {
  key: string;
  /** Sidebar label, Thai (the default locale) and English. */
  th: string;
  en: string;
  /** Path under /companies/:companyId. */
  path: string;
  /** Roles whose sidebar contains this entry, and who may open the route directly. */
  visibleTo: RoleKey[];
};

const ALL = ALL_ROLES;

/** Top-level menus in the catalogue's scope. */
export const MENUS: MenuSpec[] = [
  { key: 'dashboard',   th: 'แดชบอร์ด',              en: 'Dashboard',                 path: 'dashboard',              visibleTo: ALL },
  { key: 'booking',     th: 'การจองออนไลน์',          en: 'Online Booking',            path: 'bookings',               visibleTo: ['OWNER', 'ADMIN', 'MANAGER', 'SALES'] },
  // Plan P4.6: `salesdoc` is still `status: 'planned'`, so it is out of the launch navigation
  // (WorkspaceLayout DESIGN_HANDOFF_NAV_ORDER) even though every company role can reach the route.
  // Permission-wise nothing changed: each session still only sees documents related to that person.
  { key: 'salesdoc',    th: 'เอกสารขายและรับชำระ',     en: 'Sales Documents',           path: 'sales-documents',        visibleTo: [] },
  { key: 'crmsettings', th: 'สินค้าและบริการ',         en: 'Products & Services',       path: 'settings/crm-catalog',   visibleTo: ['OWNER', 'ADMIN', 'MANAGER', 'SALES', 'INVENTORY', 'FINANCE', 'ACCOUNTANT', 'MARKETING'] },
  { key: 'expenses',    th: 'ค่าใช้จ่ายและใบเสร็จ',     en: 'Expenses & Receipts',       path: 'expenses',               visibleTo: ALL },
  // Accounting screens are intentionally presentation-hidden in this launch, even for holders.
  { key: 'journal',     th: 'สมุดรายวัน',             en: 'Journal',                   path: 'journal',                visibleTo: [] },
  { key: 'reports',     th: 'รายงานการเงิน',          en: 'Financial Reports',         path: 'reports',                visibleTo: ALL },
  { key: 'closing',     th: 'ปิดงวด',                 en: 'Period Closing',            path: 'period-closing',         visibleTo: [] },
  // The roles parent renders when ANY child survives its per-child registry key and points at
  // the first visible child. COMPANY_VIEW holds only access.role.read — no child, no parent.
  // SALES reaches it through นโยบายส่วนลด (crm.customer.update); MANAGER through
  // รายชื่อพนักงาน/เพิ่มพนักงาน (access.employee.read).
  { key: 'roles',       th: 'พนักงานและสิทธิ์',        en: 'Employees & Access',        path: 'settings/permissions',   visibleTo: ['OWNER', 'ADMIN', 'MANAGER', 'SALES'] },
  // The hub key list (web-core-workspace.constants.ts `settings`) includes tax.config.read and
  // ledger read keys, so MANAGER / FINANCE / ACCOUNTANT see the hub too — matching the cards
  // (accounting/tax setup) they can actually open inside it.
  { key: 'settings',    th: 'ตั้งค่าบริษัท',           en: 'Company Settings',          path: 'settings',               visibleTo: ['OWNER', 'COMPANY_VIEW', 'ADMIN', 'MANAGER', 'FINANCE', 'ACCOUNTANT'] },
];

/**
 * Sub-menu entries. `routeGuard` matters:
 *   'own'    — the route has its own rule in canAccessWorkspacePath, so a role outside
 *              `visibleTo` is bounced on direct navigation.
 *   'parent' — the route only inherits the parent module's gate. A role outside
 *              `visibleTo` still *loads* the page and must be refused by the page itself
 *              (expenses uses canAccessExpenseTab). Assert the in-page refusal, NOT a redirect.
 */
export type SubMenuSpec = MenuSpec & { parent: string; routeGuard: 'own' | 'parent' };

export const SUB_MENUS: SubMenuSpec[] = [
  // ค่าใช้จ่ายและใบเสร็จ — 7 children (the catalogue lists 6; ลายเซ็นของฉัน is the 7th)
  { parent: 'expenses', routeGuard: 'parent', key: 'expenses.list',       th: 'รายการค่าใช้จ่าย',        en: 'Expenses',        path: 'expenses',            visibleTo: ALL },
  { parent: 'expenses', routeGuard: 'parent', key: 'expenses.upload',     th: 'อัปโหลดใบเสร็จ',          en: 'Upload receipt',  path: 'expenses/upload',     visibleTo: ['OWNER', 'ADMIN', 'SALES', 'INVENTORY', 'FINANCE', 'ACCOUNTANT', 'MARKETING', 'STAFF'] },
  { parent: 'expenses', routeGuard: 'parent', key: 'expenses.manual',     th: 'บันทึกด้วยมือ',           en: 'Manual entry',    path: 'expenses/manual',     visibleTo: ['OWNER', 'ADMIN', 'SALES', 'INVENTORY', 'FINANCE', 'ACCOUNTANT', 'MARKETING', 'STAFF'] },
  { parent: 'expenses', routeGuard: 'parent', key: 'expenses.categories', th: 'หมวดหมู่',                en: 'Categories',      path: 'expenses/categories', visibleTo: ['OWNER', 'ADMIN', 'FINANCE'] },
  // "ลายเซ็นของฉัน" (owner decision 2026-08-20, superseding the 2026-08-05 park): a signature is a
  // personal asset, so the entry belongs to whoever performs either signing act, plus the
  // housekeeping holder. Roles granting expense.review / expense.confirm / expense.signature.manage.
  { parent: 'expenses', routeGuard: 'parent', key: 'expenses.signatures', th: 'ลายเซ็นของฉัน',           en: 'My signature',    path: 'expenses/signatures', visibleTo: ['OWNER', 'ADMIN', 'MANAGER', 'SALES', 'INVENTORY', 'FINANCE', 'ACCOUNTANT', 'MARKETING', 'STAFF'] },
  { parent: 'expenses', routeGuard: 'parent', key: 'expenses.substitute_receipts', th: 'ใบรับรองแทนใบเสร็จ', en: 'Substitute receipts', path: 'expenses/substitute-receipts', visibleTo: ALL },
  { parent: 'expenses', routeGuard: 'own',    key: 'expenses.substitute', th: 'ตั้งค่าใบรับรองแทนใบเสร็จ', en: 'Substitute receipt settings', path: 'settings/substitute-receipt', visibleTo: ['OWNER', 'ADMIN'] },
  { parent: 'expenses', routeGuard: 'parent', key: 'expenses.evidence',   th: 'หลักฐานทางบัญชี',         en: 'Accounting evidence', path: 'expenses/evidence', visibleTo: ['OWNER', 'COMPANY_VIEW', 'ADMIN', 'MANAGER', 'FINANCE', 'ACCOUNTANT'] },

  // พนักงานและสิทธิ์ — visibility mirrors route-permissions.ts (the single web registry):
  // permissions/roles need access.role.manage (OWNER only), access-overview + employees need
  // access.employee.read, po-approval needs procurement.purchase_order.manage, discount-policy
  // needs crm.customer.update, LINE OA needs crm.channel.manage.
  { parent: 'roles', routeGuard: 'own', key: 'roles.permissions', th: 'บทบาทและสิทธิ์',   en: 'Roles & permissions', path: 'settings/permissions',      visibleTo: ['OWNER'] },
  { parent: 'roles', routeGuard: 'own', key: 'roles.individual',  th: 'รายชื่อพนักงาน',   en: 'Employee directory',  path: 'settings/access-overview',  visibleTo: ['OWNER', 'ADMIN', 'MANAGER'] },
  { parent: 'roles', routeGuard: 'own', key: 'roles.employees',   th: 'เพิ่มพนักงาน',      en: 'Add employee',        path: 'settings/employees',        visibleTo: ['OWNER', 'ADMIN', 'MANAGER'] },
  { parent: 'roles', routeGuard: 'own', key: 'roles.poapproval',  th: 'อนุมัติคำสั่งซื้อ',  en: 'PO Approval',         path: 'settings/po-approval',      visibleTo: ['OWNER', 'ADMIN'] },
  { parent: 'roles', routeGuard: 'own', key: 'roles.discount',    th: 'นโยบายส่วนลด',     en: 'Discount policy',     path: 'settings/discount-policy',  visibleTo: ['OWNER', 'ADMIN', 'SALES'] },
  { parent: 'roles', routeGuard: 'own', key: 'roles.lineoa',      th: 'เชื่อมต่อ LINE OA', en: 'LINE OA',            path: 'settings/line-oa',          visibleTo: ['OWNER', 'ADMIN'] },

  // ตั้งค่าบริษัท. The สาขา page keeps its own rule (company.branch.read, which every role holds),
  // so it stays reachable by direct URL even for roles that no longer see the hub — the hub is
  // the only way in through the UI. Left as-is deliberately; raise it if that leak matters.
  { parent: 'settings', routeGuard: 'own', key: 'settings.branches', th: 'สาขา', en: 'Branches', path: 'settings/branches', visibleTo: ALL },
];

export function menu(key: string): MenuSpec {
  const found = [...MENUS, ...SUB_MENUS].find((m) => m.key === key);
  if (!found) throw new Error(`unknown menu key: ${key}`);
  return found;
}

/** Menus this role should see, as a set of keys — for whole-sidebar comparisons. */
export function expectedMenuKeys(role: RoleKey): string[] {
  return MENUS.filter((m) => m.visibleTo.includes(role)).map((m) => m.key);
}

export function href(companyId: string, key: string): string {
  return `/companies/${companyId}/${menu(key).path}`;
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

type Page = import('@playwright/test').Page;

/** The sidebar renders more modules than this catalogue covers (inbox, tax, reimbursements…),
 *  so assert per-menu presence/absence — never set equality against the whole nav. */
function topLevelNavLabel(page: Page, label: string) {
  return page.locator('aside nav .menu-item').getByText(label, { exact: true });
}

function subMenuLabel(page: Page, label: string) {
  return page.locator('aside nav .menu-dropdown-item').getByText(label, { exact: true });
}

/**
 * Assert the sidebar shows exactly the in-scope top-level menus this role is entitled to.
 * Call after landing on any workspace page.
 */
export async function expectSidebarMatchesRole(page: Page, role: RoleKey): Promise<void> {
  for (const spec of MENUS) {
    const shouldSee = spec.visibleTo.includes(role);
    await expect(
      topLevelNavLabel(page, spec.th),
      `${role} ${shouldSee ? 'should see' : 'must NOT see'} sidebar menu "${spec.th}"`,
    ).toHaveCount(shouldSee ? 1 : 0);
  }
}

/**
 * Expand `parentKey` in the sidebar and assert its children match the role.
 * The submenu container is height:0 (not removed) when collapsed, so the parent
 * has to be clicked before visibility means anything.
 */
export async function expectSubMenuMatchesRole(page: Page, role: RoleKey, parentKey: string): Promise<void> {
  const parent = menu(parentKey);
  if (!parent.visibleTo.includes(role)) {
    await expect(topLevelNavLabel(page, parent.th), `${role} must not see parent "${parent.th}"`).toHaveCount(0);
    return;
  }
  await expectSubmenuExpanded(page, parent.th);
  for (const child of SUB_MENUS.filter((s) => s.parent === parentKey)) {
    const shouldSee = child.visibleTo.includes(role);
    // toHaveCount, not toBeVisible: a child inside the collapsed (height:0, overflow-hidden)
    // drawer still reports a bounding box, so toBeVisible() passes even when it is hidden.
    // Presence/absence is what the matrix is about; drawer state is asserted separately.
    await expect(
      subMenuLabel(page, child.th),
      `${role} ${shouldSee ? 'should see' : 'must NOT see'} sub-menu "${child.th}"`,
    ).toHaveCount(shouldSee ? 1 : 0);
  }
}

/**
 * Names of parents whose submenu is expanded, read from `aria-expanded` on the parent button.
 *
 * The two obvious alternatives both lie: the drawer's inline height is measured in a layout
 * effect so it trails state, and `toBeVisible()` on a child returns true even when the drawer is
 * collapsed, because a child inside `height:0; overflow-hidden` still reports a bounding box.
 */
export function openSubmenuLabels(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    document.querySelectorAll('aside nav li > button[aria-expanded="true"]').forEach((button) => {
      out.push((button.textContent ?? '').replace(/\s+/g, ' ').trim());
    });
    return out;
  });
}

/**
 * Ensure a parent's submenu is expanded, then assert it.
 *
 * The app opens the parent of the route you landed on, so give that a chance to happen before
 * clicking: reading once straight after `goto` races the sync effect, and a click at that
 * instant *collapses* the menu that was about to open.
 */
export async function expectSubmenuExpanded(page: Page, parentLabel: string): Promise<void> {
  const button = page.locator('aside nav').getByRole('button', { name: parentLabel });
  await button.waitFor({ state: 'visible' });
  const isOpen = async () => (await openSubmenuLabels(page)).includes(parentLabel);
  try {
    await expect.poll(isOpen, { timeout: 2_000 }).toBe(true);
    return;
  } catch {
    await button.click();
  }
  await expect.poll(isOpen, { message: `"${parentLabel}" submenu should expand` }).toBe(true);
}

/**
 * Navigate straight to a menu's URL and assert the outcome for this role.
 *
 * A denied route is not a 403 page: WorkspaceLayout calls
 * `router.replace('/companies/:id/dashboard')`, so the observable result is a
 * redirect to the dashboard with the guarded content never painted.
 *
 * Only valid for entries whose guard is 'own' (or top-level menus). Sub-pages marked
 * routeGuard:'parent' inherit the parent module gate and DO load — assert the page's own
 * refusal instead (see HANDOFF §5).
 */
export async function expectRouteAccess(
  page: Page,
  companyId: string,
  key: string,
  role: RoleKey,
): Promise<void> {
  const spec = menu(key);
  const target = href(companyId, key);
  await page.goto(target);
  if (spec.visibleTo.includes(role)) {
    await expect(page, `${role} should stay on ${target}`).toHaveURL(new RegExp(`${spec.path.replace(/\//g, '\\/')}(\\?|$|\\/)`));
  } else {
    await expect(page, `${role} must be bounced off ${target}`).toHaveURL(
      new RegExp(`/companies/${companyId}/dashboard`),
    );
  }
}
