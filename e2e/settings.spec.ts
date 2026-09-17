import { test, expect } from './harness/fixtures';
import { gotoCompany, json, unique } from './harness/e2e-utils';
import { roleDisplayName } from '../apps/web/src/features/employee-access/role-picker.logic';
import {
  API_BASE_URL,
  WEB_BASE_URL,
  apiHeaders,
  ensureBrowserLegalAcceptance,
} from './harness/auth';

type Role = { id: string; key: string; name: string; status: string; isSystem?: boolean; permissionKeys: string[] };
type Employee = { id: string; displayName: string; roles?: Role[] };
type CreateEmployeeResult = {
  employeeId: string;
  username: string;
  temporaryPassword: string;
  mustChangePassword: boolean;
};
type Branch = { id: string; code: string; name: string };
type BranchPage = { items: Branch[] };
type AccessMatrix = {
  menus: Array<{ id: string }>;
  rows: Array<{ roleId: string; menus: Record<string, { view?: boolean }> }>;
};

test.describe('SET — settings', () => {
  test('SET-01 @smoke settings hub renders sections', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/settings');
    await expect(authedPage.getByRole('heading', { name: 'ตั้งค่า', exact: true })).toBeVisible();
    await expect(authedPage.getByRole('heading', { name: 'การตั้งค่าขั้นสูง' })).toBeVisible();
    await expect(authedPage.getByText(/พนักงาน|สิทธิ์|สาขา|แจ้งเตือน|Employees|Permissions|Branches/i).first()).toBeVisible();
  });

  test('SET-02 @smoke employees page renders and seeded staff exist', async ({ authedPage, api, companyId }) => {
    await gotoCompany(authedPage, companyId, '/settings/employees');
    await expect(authedPage.getByRole('heading', { name: /เพิ่มพนักงาน|Add employee/i })).toBeVisible();
    await expect(authedPage.getByRole('button', { name: /^ถัดไป|^Next/i }).first()).toBeVisible();

    const employees = await json<Employee[]>(await api.get(`companies/${companyId}/settings/employees`));
    for (const name of ['มายด์', 'ไนซ์', 'แพรว', 'เตย']) {
      expect(employees.some((employee) => employee.displayName === name)).toBe(true);
    }
  });

  test('SET-03 @p1 creates an employee and verifies API truth', async ({ authedPage, api, companyId }) => {
    const roles = await json<Role[]>(await api.get(`companies/${companyId}/settings/roles`));
    const role = roles.find((r) => r.status === 'ACTIVE' && !['OWNER', 'SYSTEM_ADMIN'].includes(r.key)) ?? roles[0];
    const displayName = unique('E2E employee');
    const username = `e2e.employee.${Date.now()}`;
    const employee = await json<CreateEmployeeResult>(await api.post(`companies/${companyId}/settings/employees`, {
      data: {
        displayName,
        legalName: displayName,
        username,
        dateOfBirth: '1990-01-01',
        identityType: 'PASSPORT',
        identityNumber: `E2E${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
        phoneNumber: `08${Date.now().toString().slice(-8)}`,
        roleIds: [role.id],
      },
    }));
    expect(employee.employeeId).toBeTruthy();

    await gotoCompany(authedPage, companyId, '/settings/access-overview');
    await expect(authedPage.getByText(displayName).first()).toBeVisible();

    const employees = await json<Employee[]>(await api.get(`companies/${companyId}/settings/employees`));
    expect(employees.some((item) => item.id === employee.employeeId && item.displayName === displayName)).toBe(true);
  });

  test('SET-03A @p1 creates an employee through the 4-step wizard and redirects', async ({ authedPage, api, companyId }) => {
    const suffix = Date.now().toString();
    const firstName = `E2E${suffix.slice(-6)}`;
    const lastName = 'Wizard';
    const username = `e2e.wizard.${suffix}`;

    await gotoCompany(authedPage, companyId, '/settings/employees');
    await authedPage.getByLabel(/^ชื่อ \*/).fill(firstName);
    await authedPage.getByLabel(/^นามสกุล \*/).fill(lastName);
    await authedPage.getByLabel(/^Username \*/).fill(username);
    await authedPage.getByLabel(/^วันเดือนปีเกิด/).fill('01/01/1990');
    await authedPage.getByLabel(/^เลขบัตรประชาชน/).fill(`1${suffix.slice(-12)}`);
    await authedPage.getByRole('button', { name: /^ถัดไป/ }).click();

    await authedPage.getByLabel(/^อีเมล/).fill(`e2e.${suffix}@example.com`);
    await authedPage.getByLabel(/^เบอร์โทรศัพท์/).fill(`08${suffix.slice(-8)}`);
    await authedPage.getByRole('button', { name: /^ถัดไป/ }).click();

    await authedPage.getByRole('button', { name: /ฝ่ายบัญชี|Accountant/ }).click();
    await authedPage.getByRole('button', { name: /ฝ่ายการเงิน|Finance/ }).click();
    await expect(authedPage.getByRole('button', { name: /ฝ่ายบัญชี|Accountant/ })).toHaveAttribute('aria-pressed', 'false');
    await authedPage.getByLabel(/^ตำแหน่งงาน/).fill('เจ้าหน้าที่บัญชีและการเงิน');
    await authedPage.getByRole('button', { name: /^ถัดไป/ }).click();
    await expect(authedPage.getByText(username).first()).toBeVisible();
    await expect(authedPage.getByAltText('LINE link QR')).toHaveCount(0);
    await authedPage.getByRole('button', { name: 'เสร็จสิ้น' }).click();
    await expect(authedPage.getByText('เปิดใช้งานพนักงานแล้ว')).toBeVisible();
    await expect(authedPage.getByAltText('LINE link QR')).toBeVisible();
    await expect(authedPage.getByRole('link', { name: /liff\.line\.me|\/auth\/line\/link-page\// })).toBeVisible();
    await authedPage.getByRole('button', { name: 'ไปหน้าภาพรวมสิทธิ์' }).click();
    await expect(authedPage).toHaveURL(new RegExp(`/companies/${companyId}/settings/access-overview$`));

    const employees = await json<Employee[]>(await api.get(`companies/${companyId}/settings/employees`));
    const created = employees.find((item) => item.displayName.includes(firstName) && item.displayName.includes(lastName));
    expect(created).toBeTruthy();
    expect(created!.roles.map((role) => role.key)).toEqual(['FINANCE']);
  });

  test('SET-04 @p1 roles page renders system roles and grants', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/settings/roles');
    await expect(authedPage.getByRole('heading', { name: /สิทธิ์การใช้งาน|Permissions/i })).toBeVisible();
    await expect(authedPage.getByText(/บทบาทและสิทธิ์|OWNER|ADMIN|Role/i).first()).toBeVisible();
  });

  test('SET-04A @p1 creates and edits one role with capabilities from multiple features', async ({ authedPage, api, companyId }) => {
    const roleName = unique('E2E composed role');
    await gotoCompany(authedPage, companyId, '/settings/permissions');
    await authedPage.getByRole('button', { name: 'เพิ่ม', exact: true }).click();
    await expect(authedPage.getByText(/สิทธิ์ขั้นสูง|สิทธิ์รายคีย์|Feature ".*" is not enabled|company\.setup\.manage/)).toHaveCount(0);
    await expect(authedPage.locator('form input[type="checkbox"]:disabled')).toHaveCount(0);
    await authedPage.locator('form input[required]').fill(roleName);
    await authedPage.getByRole('checkbox', { name: /บันทึกค่าใช้จ่ายของฉัน/ }).check();
    await authedPage.getByRole('button', { name: 'บันทึก', exact: true }).click();
    await expect(authedPage.getByText('สร้างบทบาทเรียบร้อยแล้ว')).toBeVisible();

    let roles = await json<Role[]>(await api.get(`companies/${companyId}/settings/roles`));
    let created = roles.find((role) => role.name === roleName);
    expect(created).toBeTruthy();
    expect(created!.permissionKeys).toEqual(expect.arrayContaining(['expense.create', 'expense.receipt.upload', 'attachment.create']));

    await authedPage.getByRole('button', { name: new RegExp(roleName) }).click();
    await authedPage.getByRole('button', { name: 'แก้ไข', exact: true }).click();
    await authedPage.getByRole('checkbox', { name: /ตรวจสอบการเบิก/ }).check();
    await authedPage.getByRole('button', { name: 'บันทึก', exact: true }).click();
    await expect(authedPage.getByText('บันทึกบทบาทเรียบร้อยแล้ว')).toBeVisible();

    roles = await json<Role[]>(await api.get(`companies/${companyId}/settings/roles`));
    created = roles.find((role) => role.name === roleName);
    expect(created!.permissionKeys).toEqual(expect.arrayContaining([
      'expense.create',
      'attachment.create',
      'reimbursement.read',
      'reimbursement.finance_review',
    ]));
    expect(created!.permissionKeys).not.toContain('reimbursement.payment.record');
  });

  test('SET-05 @p1 permissions matrix renders', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/settings/permissions');
    await expect(authedPage.getByRole('heading', { name: /สิทธิ์การใช้งาน|Permissions/i })).toBeVisible();
    await expect(authedPage.getByText(/ตารางสิทธิ์|เมนู|action|matrix|permission/i).first()).toBeVisible();
  });

  test('SET-06 @p1 branches page lists seeds and can create a branch', async ({ authedPage, api, companyId }) => {
    const code = `E2E${Date.now().toString().slice(-6)}`;
    const created = await json<Branch>(await api.post(`companies/${companyId}/branches`, {
      data: { code, name: unique('E2E branch'), type: 'BRANCH', taxBranchCode: Date.now().toString().slice(-5) },
    }));
    expect(created.code).toBe(code);

    await gotoCompany(authedPage, companyId, '/settings/branches');
    await expect(authedPage.getByRole('heading', { name: /สาขา|Branches/i })).toBeVisible();
    await expect(authedPage.getByText(/SIAM|AREE|THONG/).first()).toBeVisible();
    await expect(authedPage.getByText(code).first()).toBeVisible();

    const branches = await json<BranchPage>(await api.get(`companies/${companyId}/branches?pageSize=100`));
    expect(branches.items.some((item) => item.id === created.id)).toBe(true);
  });

  test('SET-07 @p1 parked security settings redirect to dashboard', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/settings/security');
    await expect(authedPage).toHaveURL(/\/dashboard/);
  });

  test('SET-08 @p1 access overview renders employee matrix', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/settings/access-overview');
    await expect(authedPage.getByRole('heading', { name: 'รายชื่อพนักงาน', exact: true })).toBeVisible();
    await expect(authedPage.getByText(/มายด์|ไนซ์|แพรว|เตย/).first()).toBeVisible();
    await expect(authedPage.getByText(/เมนูที่|สาขาที่เข้าถึงได้|สิทธิ์เฉพาะบุคคล/i).first()).toBeVisible();

    const summary = authedPage.getByTestId('access-permission-summary');
    const rows = summary.getByTestId('access-permission-row');
    await expect(rows.first()).toBeVisible();
    await expect(summary.getByText('ไม่เห็นเมนูนี้')).toHaveCount(0);

    const countText = await summary.getByText(/^แสดงสิทธิ์ \d+ เมนู$/).innerText();
    expect(Number.parseInt(countText.replace(/\D/g, ''), 10)).toBe(await rows.count());

    const actions = summary.getByTestId('access-permission-actions');
    await expect(actions.first()).toBeVisible();
    await expect(actions.locator('button, a, [role="button"], [tabindex]')).toHaveCount(0);

    const clippedLabels = await summary.getByTestId('access-permission-menu-label').evaluateAll((labels) => labels.flatMap((label) => {
      const style = window.getComputedStyle(label);
      return style.whiteSpace === 'nowrap' || style.textOverflow === 'ellipsis' ? [label.textContent] : [];
    }));
    expect(clippedLabels, 'permission menu labels must wrap instead of ellipsizing').toEqual([]);

    const dashboardActions = summary.locator('[data-menu-id="dashboard"]').getByTestId('access-permission-actions');
    await expect(dashboardActions.locator(':scope > span')).toHaveCount(1);
    await expect(dashboardActions).toHaveText('ดู');

    await authedPage.getByRole('button', { name: /^OW OWNER/ }).click();
    const ownerExpenseActions = summary.locator('[data-menu-id="expenses"]').getByTestId('access-permission-actions');
    await expect(ownerExpenseActions.locator(':scope > span')).toHaveText(['ดู', 'เพิ่ม', 'แก้ไข', 'ลบ', 'อนุมัติ']);
  });

  test('SET-08A @p1 matrix failure is explicit and never looks like zero access', async ({ authedPage, companyId }) => {
    await authedPage.route(`**/api/v1/companies/${companyId}/settings/access/matrix`, async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Temporary matrix outage' }),
      });
    });

    await gotoCompany(authedPage, companyId, '/settings/access-overview');
    const summary = authedPage.getByTestId('access-permission-summary');
    await expect(summary.getByTestId('access-permission-error')).toContainText('โหลดข้อมูลสิทธิ์ไม่สำเร็จ');
    await expect(summary.getByRole('button', { name: 'ลองโหลดใหม่' })).toBeVisible();
    await expect(summary.getByText(/ใช้งานได้ \d+ เมนู/)).toHaveCount(0);
    await expect(summary.getByTestId('access-permission-row')).toHaveCount(0);
  });

  test('SET-08B @p1 legacy multi-role summary remains accurate until explicitly replaced', async ({ authedPage, api, companyId }) => {
    const [roles, employees, matrix] = await Promise.all([
      json<Role[]>(await api.get(`companies/${companyId}/settings/roles`)),
      json<Employee[]>(await api.get(`companies/${companyId}/settings/employees`)),
      json<AccessMatrix>(await api.get(`companies/${companyId}/settings/access/matrix`)),
    ]);
    const assignedRoles = ['SALES', 'ACCOUNTANT'].map((key) => roles.find((role) => role.key === key)!);
    expect(assignedRoles.every(Boolean), 'seed must include SALES and ACCOUNTANT roles').toBe(true);
    const assignedRows = assignedRoles.map((role) => matrix.rows.find((row) => row.roleId === role.id)!);
    expect(assignedRows.every(Boolean), 'matrix must include both assigned role rows').toBe(true);

    const supportedMenuIds = new Set(['dashboard', 'inbox', 'customers', 'booking', 'crmreport', 'expenses', 'salesdoc']);
    const expectedMenuIds = matrix.menus
      .filter((menu) => supportedMenuIds.has(menu.id) && assignedRows.some((row) => row.menus[menu.id]?.view === true))
      .map((menu) => menu.id);
    const complementaryMenuId = expectedMenuIds.find((menuId) =>
      assignedRows.some((row) => row.menus[menuId]?.view === true)
      && assignedRows.some((row) => row.menus[menuId]?.view !== true));
    expect(complementaryMenuId, 'fixture must prove a grant that comes from only one assigned role').toBeTruthy();

    const target = employees[0]!;
    await authedPage.route(`**/api/v1/companies/${companyId}/settings/employees`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { ...target, roles: assignedRoles.map(({ id, key, name }) => ({ id, key, name })) },
          ...employees.slice(1),
        ]),
      });
    });

    await gotoCompany(authedPage, companyId, '/settings/access-overview');
    const employeeRow = authedPage.locator('button').filter({ hasText: target.displayName }).first();
    for (const role of assignedRoles) await expect(employeeRow.getByText(roleDisplayName(role), { exact: true })).toBeVisible();
    const rowWidth = await employeeRow.evaluate((element) => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }));
    expect(rowWidth.scrollWidth, 'multi-role employee row must not overflow').toBeLessThanOrEqual(rowWidth.clientWidth + 1);
    const summary = authedPage.getByTestId('access-permission-summary');
    await expect(summary).toContainText(`สิทธิ์มาจากบทบาท ${assignedRoles.map(roleDisplayName).join(', ')}`);
    await expect(summary).toContainText('ระบบรวมสิทธิ์จากทุกบทบาท');
    await expect(summary.getByText(`แสดงสิทธิ์ ${expectedMenuIds.length} เมนู`)).toBeVisible();
    await expect(authedPage.getByText('ข้อมูลเดิมมีหลายบทบาท ให้ผู้มีสิทธิ์เลือก 1 บทบาทเพื่อแทนที่ทั้งหมด')).toBeVisible();
    await expect(summary.locator(`[data-menu-id="${complementaryMenuId}"]`)).toBeVisible();
  });

  test('SET-08D @p1 replaces an employee role and refreshes the header, list and permissions', async ({ authedPage, api, companyId }) => {
    const roles = await json<Role[]>(await api.get(`companies/${companyId}/settings/roles`));
    const staff = roles.find((role) => role.key === 'STAFF')!;
    const suffix = Date.now().toString();
    const displayName = unique('E2E single-role employee');
    const created = await json<CreateEmployeeResult>(await api.post(`companies/${companyId}/settings/employees`, {
      data: {
        displayName,
        legalName: displayName,
        jobTitle: 'เจ้าหน้าที่ทดสอบ',
        username: `e2e.multi.${suffix}`,
        dateOfBirth: '1990-01-01',
        identityType: 'PASSPORT',
        identityNumber: `MULTI${suffix}`,
        phoneNumber: `09${suffix.slice(-8)}`,
        roleIds: [staff.id],
      },
    }));
    await api.post(`companies/${companyId}/settings/employees/${created.employeeId}/complete`, { data: {} });

    await gotoCompany(authedPage, companyId, '/settings/access-overview');
    await authedPage.getByLabel('ค้นหาพนักงาน').fill(displayName);
    await authedPage.getByRole('button', { name: new RegExp(displayName) }).click();
    await authedPage.getByRole('combobox', { name: 'เลือกบทบาท', exact: true }).click();
    await authedPage.getByRole('option', { name: 'พนักงาน', exact: true }).click();
    await authedPage.getByRole('button', { name: 'เปลี่ยนบทบาทพนักงาน', exact: true }).click();
    await authedPage.getByRole('option', { name: /ฝ่ายบัญชี|Accountant/ }).click();
    await expect(authedPage.getByText('บันทึกบทบาทพนักงานแล้ว')).toBeVisible();

    const employees = await json<Employee[]>(await api.get(`companies/${companyId}/settings/employees`));
    const updated = employees.find((employee) => employee.id === created.employeeId)!;
    expect(updated.roles.map((role) => role.key)).toEqual(['ACCOUNTANT']);
    const header = authedPage.getByTestId('employee-detail-card');
    await expect(header.getByLabel('บทบาทปัจจุบัน')).toContainText('ฝ่ายบัญชี');
    await expect(header).toContainText('ตำแหน่งงาน: เจ้าหน้าที่ทดสอบ');
    await expect(authedPage.getByRole('button', { name: new RegExp(displayName) })).toContainText('ฝ่ายบัญชี');
    await expect(authedPage.getByTestId('access-permission-summary')).toContainText('สิทธิ์มาจากบทบาท ฝ่ายบัญชี');
    await expect(authedPage.getByText('ระบบจะรวมสิทธิ์จากทุกบทบาท')).toHaveCount(0);
    await authedPage.reload();
    await authedPage.getByLabel('ค้นหาพนักงาน').fill(displayName);
    await expect(header.getByLabel('บทบาทปัจจุบัน')).toContainText('ฝ่ายบัญชี');

    await authedPage.route(`**/api/v1/companies/${companyId}/settings/employees/${created.employeeId}`, async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'Forbidden' }) });
    });
    await authedPage.getByRole('button', { name: 'เปลี่ยนบทบาทพนักงาน', exact: true }).click();
    const [denied] = await Promise.all([
      authedPage.waitForResponse((response) => response.url().endsWith(`/employees/${created.employeeId}`) && response.request().method() === 'PATCH'),
      authedPage.getByRole('option', { name: 'พนักงาน', exact: true }).click(),
    ]);
    expect(denied.status()).toBe(403);
    await expect(header.getByLabel('บทบาทปัจจุบัน')).toContainText('ฝ่ายบัญชี');
    await expect(authedPage.getByTestId('access-permission-summary')).toContainText('สิทธิ์มาจากบทบาท ฝ่ายบัญชี');
  });

  test('SET-08E @p1 one custom role composes permissions across real feature pages', async ({ api, browser, request, companyId }) => {
    const customRole = await json<Role>(await api.post(`companies/${companyId}/settings/roles`, {
      data: {
        name: unique('E2E cross-feature reviewer'),
        capabilityPackKeys: ['pack.expense.self', 'pack.expense.review', 'pack.reimbursement.self', 'pack.reimbursement.review'],
      },
    }));
    const suffix = Date.now().toString();
    const created = await json<CreateEmployeeResult>(await api.post(`companies/${companyId}/settings/employees`, {
      data: {
        displayName: unique('E2E permission union'),
        legalName: 'E2E Permission Union',
        username: `e2e.permission.union.${suffix}`,
        dateOfBirth: '1990-01-01',
        identityType: 'PASSPORT',
        identityNumber: `UNION${suffix}`,
        phoneNumber: `06${suffix.slice(-8)}`,
        roleIds: [customRole.id],
      },
    }));
    expect(created.mustChangePassword).toBe(true);
    expect(created.temporaryPassword).toBeTruthy();
    await json(await api.post(`companies/${companyId}/settings/employees/${created.employeeId}/complete`, { data: {} }));

    const firstLogin = await request.post(`${API_BASE_URL}/auth/password/login`, {
      data: { username: created.username, password: created.temporaryPassword },
    });
    expect(firstLogin.ok(), await firstLogin.text()).toBe(true);
    const { accessToken } = await firstLogin.json() as { accessToken: string };
    const permanentPassword = `Union@${suffix}Aa`;
    const changed = await request.post(`${API_BASE_URL}/auth/password/change`, {
      headers: apiHeaders(accessToken, companyId),
      data: { currentPassword: created.temporaryPassword, newPassword: permanentPassword },
    });
    expect(changed.ok(), await changed.text()).toBe(true);

    const verifiedLogin = await request.post(`${API_BASE_URL}/auth/password/login`, {
      data: { username: created.username, password: permanentPassword },
    });
    expect(verifiedLogin.ok(), await verifiedLogin.text()).toBe(true);
    const verifiedToken = (await verifiedLogin.json() as { accessToken: string }).accessToken;
    const meResponse = await request.get(`${API_BASE_URL}/auth/me`, {
      headers: apiHeaders(verifiedToken, companyId),
    });
    expect(meResponse.ok(), await meResponse.text()).toBe(true);
    const me = await meResponse.json() as { roles: string[]; permissions: string[] };
    expect(me.roles).toEqual([customRole.key]);
    expect(me.permissions).toEqual(expect.arrayContaining([
      'expense.create',
      'expense.review',
      'reimbursement.submit',
      'reimbursement.finance_review',
    ]));
    expect(me.permissions).not.toContain('reimbursement.payment.record');

    const context = await browser.newContext({ baseURL: WEB_BASE_URL });
    try {
      const browserLogin = await context.request.post(`${WEB_BASE_URL}/api/auth/login`, {
        data: { username: created.username, password: permanentPassword, remember: true },
      });
      expect(browserLogin.ok(), await browserLogin.text()).toBe(true);
      expect((await browserLogin.json() as { passwordChangeRequired?: boolean }).passwordChangeRequired).toBe(false);
      await ensureBrowserLegalAcceptance(context, companyId);
      const page = await context.newPage();

      await gotoCompany(page, companyId, '/expenses/manual');
      await expect(page.getByRole('heading', { name: 'บันทึกค่าใช้จ่ายด้วยมือ' })).toBeVisible();
      await page.getByLabel('รายละเอียดค่าใช้จ่าย').fill(unique('E2E union expense'));
      await page.getByLabel('ราคาต่อหน่วย').fill('123.45');
      await page.getByRole('button', { name: 'บันทึกฉบับร่าง' }).click();
      await expect(page).toHaveURL(new RegExp(`/companies/${companyId}/expenses/[^/?]+$`));
      await expect(page.getByRole('heading', { name: /ฉบับร่าง/ })).toBeVisible();

      await gotoCompany(page, companyId, '/expenses/substitute-receipts');
      await expect(page.getByRole('heading', { name: 'ใบรับรองแทนใบเสร็จรับเงิน' })).toBeVisible();
      await expect(page.getByRole('link', { name: '+ สร้างใบรับรองฉบับใหม่' })).toBeVisible();

      await gotoCompany(page, companyId, '/reimbursements');
      await expect(page.getByRole('button', { name: 'รายการที่เกี่ยวข้อง' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'คิวการเงิน' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'คิวอนุมัติ' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'ตั้งค่านโยบาย' })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('SET-08C @p1 branch failure stays scoped and does not hide a valid permission summary', async ({ authedPage, companyId }) => {
    await authedPage.route(`**/api/v1/companies/${companyId}/branches?pageSize=100`, async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Temporary branch outage' }),
      });
    });

    await gotoCompany(authedPage, companyId, '/settings/access-overview');
    const summary = authedPage.getByTestId('access-permission-summary');
    await expect(summary.getByTestId('access-permission-row').first()).toBeVisible();
    await expect(summary.getByTestId('access-permission-error')).toHaveCount(0);
    await expect(authedPage.getByTestId('branch-access-error')).toContainText('โหลดข้อมูลสาขาไม่สำเร็จ');
  });

  for (const width of [390, 1280]) {
    test(`SET-08F @p1 owner can view all-branch names without editing scope at ${width}px`, async ({ authedPage: page, api, companyId }) => {
      await page.setViewportSize({ width, height: 844 });
      const roles = await json<Role[]>(await api.get(`companies/${companyId}/settings/roles`));
      const assignedRoles = roles.filter((role) => ['FINANCE', 'ACCOUNTANT'].includes(role.key));
      expect(assignedRoles).toHaveLength(2);
      const { items: branches } = await json<BranchPage>(await api.get(`companies/${companyId}/branches?pageSize=100`));
      expect(branches.length).toBeGreaterThan(1);
      const employee = {
        id: 'e2e-branch-view-only', userId: 'e2e-branch-view-only', membershipId: 'e2e-branch-view-only',
        displayName: 'Branch view fixture', phoneNumber: '', status: 'ACTIVE',
        identityType: 'PASSPORT', identityMasked: '', mustChangePassword: false, lineLinked: false,
        roles: assignedRoles.map(({ id, key, name }) => ({ id, key, name })),
        branchScopeMode: 'ALL_BRANCHES', branchScopeBranchIds: [], defaultBranchId: branches[0]!.id,
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      };
      const writes: string[] = [];
      // Synthetic employee only; an accidental scope write must never reach the real API.
      await page.route(`**/api/v1/companies/${companyId}/settings/employees**`, async (route) => {
        if (route.request().method() !== 'GET') {
          writes.push(route.request().method());
          await route.fulfill({ status: 403, json: { message: 'Read-only fixture' } });
        } else {
          await route.fulfill({ status: 200, json: [employee] });
        }
      });

      await gotoCompany(page, companyId, '/settings/access-overview');
      const card = page.locator('section').filter({ has: page.getByRole('heading', { name: 'สาขาที่เข้าถึงได้', exact: true }) });
      await expect(card.getByTestId('employee-branch-count')).toHaveText('ทุกสาขา');
      await expect(card.getByRole('button', { name: 'เลือกสาขา', exact: true })).toHaveCount(0);
      const expand = card.getByRole('button', { name: 'ดูสาขาที่เข้าถึง', exact: true });
      await expect(expand).toBeEnabled();
      await expect(expand).toHaveAttribute('aria-expanded', 'false');
      if (width === 390) {
        const badge = await card.getByTestId('employee-branch-count').boundingBox();
        const heading = await card.getByRole('heading').boundingBox();
        expect(Math.abs(badge!.x - heading!.x), 'badge aligns with card content when wrapped').toBeLessThanOrEqual(1);
      }
      await expand.click();
      const list = card.locator('#employee-accessible-branches');
      for (const branch of branches) await expect(list.getByText(branch.name, { exact: true })).toBeVisible();
      await expect(list.locator('button, input, [role="button"]')).toHaveCount(0);
      const collapse = card.getByRole('button', { name: 'ซ่อนรายชื่อสาขา', exact: true });
      await expect(collapse).toHaveAttribute('aria-expanded', 'true');
      await collapse.click();
      await expect(list).toHaveCount(0);
      await expect(expand).toHaveAttribute('aria-expanded', 'false');
      expect(writes, 'viewing branch names must not update employee permissions').toEqual([]);
    });
  }

  // Regression guard for BUG-2: the roles screen never received the viewer's permissions and
  // inferred editability from `catalog.length > 0`. The catalog fetch is allSettled and needs
  // its own access.permission.read, so a viewer without it saw every control disabled and no
  // reason why — indistinguishable from a broken page.
  test('SET-09 @p1 roles screen is manage-only: no access.role.manage, no page', async ({ pageAs, companyId }) => {
    const owner = await pageAs('OWNER');
    await gotoCompany(owner, companyId, '/settings/permissions');
    await expect(owner.getByRole('heading', { name: /สิทธิ์การใช้งาน|Permissions/i })).toBeVisible();
    await expect(owner.getByRole('button', { name: 'เพิ่ม' })).toBeEnabled();

    // COMPANY_VIEW holds access.role.read but not access.role.manage. The old read-only
    // banner is gone — the page is invisible now: direct navigation bounces to the dashboard.
    const viewer = await pageAs('COMPANY_VIEW');
    await gotoCompany(viewer, companyId, '/settings/permissions');
    await expect(viewer).toHaveURL(new RegExp(`/companies/${companyId}/dashboard`));
    await expect(viewer.getByRole('heading', { name: /สิทธิ์การใช้งาน|Permissions/i })).toHaveCount(0);
    await expect(viewer.getByText(/อ่านอย่างเดียว/)).toHaveCount(0);
  });
});

for (const width of [1280, 390]) {
  test(`SET-BRANCH-UX focused editor and error recovery at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    await page.setViewportSize({ width, height: 900 });
    let attempts = 0;
    await page.route(`**/companies/${companyId}/branches/**`, async route => {
      if (route.request().method() !== 'PATCH') return route.continue();
      attempts++;
      await route.fulfill({ status: 409, json: { code: 'branch_last_active_required', message: 'ต้องมีสาขาที่ใช้งานอย่างน้อยหนึ่งสาขา' } });
    });
    await gotoCompany(page, companyId, '/settings/branches');
    await expect(page.getByRole('heading', { name: 'รายชื่อสาขา', exact: true })).toBeVisible();
    const edit = page.getByRole('button', { name: /^แก้ไขสาขา / }).first();
    await expect(edit).toBeVisible();
    await page.screenshot({ path: info.outputPath(`branches-${width}.png`), fullPage: true });
    await edit.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('ชื่อสาขา', { exact: true }).fill('ร่างแก้สาขา ไม่บันทึกจริง');
    await dialog.getByRole('button', { name: 'บันทึก', exact: true }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(dialog.getByLabel('ชื่อสาขา', { exact: true })).toHaveValue('ร่างแก้สาขา ไม่บันทึกจริง');
    expect(attempts).toBe(1);
    await dialog.getByRole('button', { name: 'สร้างสาขาใหม่ก่อน' }).click();
    await expect(page.getByRole('dialog', { name: 'เพิ่มสาขา', exact: true })).toBeVisible();
    await dialog.getByLabel('รหัสสาขา (A-Z, 0-9)', { exact: true }).fill('TESTUX');
    await dialog.getByLabel('ชื่อสาขา', { exact: true }).fill('สาขาทดสอบ ไม่บันทึกจริง');
    await dialog.getByLabel('รหัสสาขาภาษี (5 หลัก ไม่บังคับ)', { exact: false }).fill('123');
    await expect(dialog.getByRole('button', { name: 'บันทึกสาขาใหม่' })).toBeDisabled();
    await page.screenshot({ path: info.outputPath(`branch-editor-${width}.png`), fullPage: true });
    await dialog.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(edit).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
