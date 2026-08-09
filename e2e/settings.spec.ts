import { test, expect } from './harness/fixtures';
import { gotoCompany, json, unique } from './harness/e2e-utils';

type Role = { id: string; key: string; status: string; isSystem?: boolean };
type Employee = { id: string; displayName: string; roles?: Role[] };
type CreateEmployeeResult = { employeeId: string; username: string };
type Branch = { id: string; code: string; name: string };
type BranchPage = { items: Branch[] };

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

    await authedPage.getByRole('button', { name: 'Accountant', exact: true }).click();
    await authedPage.getByRole('button', { name: 'บันทึกแบบร่าง' }).click();
    await expect(authedPage.getByText(username).first()).toBeVisible();
    await expect(authedPage.getByAltText('LINE link QR')).toHaveCount(0);
    await authedPage.getByRole('button', { name: 'เสร็จสิ้น' }).click();
    await expect(authedPage.getByText('เปิดใช้งานพนักงานแล้ว')).toBeVisible();
    await expect(authedPage.getByAltText('LINE link QR')).toBeVisible();
    await expect(authedPage.getByRole('link', { name: /liff\.line\.me|\/auth\/line\/link-page\// })).toBeVisible();
    await authedPage.getByRole('button', { name: 'ไปหน้าภาพรวมสิทธิ์' }).click();
    await expect(authedPage).toHaveURL(new RegExp(`/companies/${companyId}/settings/access-overview$`));

    const employees = await json<Employee[]>(await api.get(`companies/${companyId}/settings/employees`));
    expect(employees.some((item) => item.displayName.includes(firstName) && item.displayName.includes(lastName))).toBe(true);
  });

  test('SET-04 @p1 roles page renders system roles and grants', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/settings/roles');
    await expect(authedPage.getByRole('heading', { name: /สิทธิ์การใช้งาน|Permissions/i })).toBeVisible();
    await expect(authedPage.getByText(/บทบาทและสิทธิ์|OWNER|ADMIN|Role/i).first()).toBeVisible();
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
    await expect(authedPage.getByRole('heading', { name: /สิทธิ์รายบุคคล|Individual/i })).toBeVisible();
    await expect(authedPage.getByText(/มายด์|ไนซ์|แพรว|เตย/).first()).toBeVisible();
    await expect(authedPage.getByText(/เมนูที่|สาขาที่เข้าถึงได้|สิทธิ์เฉพาะบุคคล/i).first()).toBeVisible();
  });

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
