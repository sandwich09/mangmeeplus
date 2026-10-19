import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { SearchParamsContext, PathnameContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { ToastContext } from '@/common/components/toast/use-toast';
import { certificateHarness, h, mutable } from '../expenses/expense-certificate-test-harness';

require.extensions['.svg'] = module => { module.exports = () => null; };
require.extensions['.css'] = module => { module.exports = { menu: 'menu', panel: 'panel' }; };
// Navigation transport and browser listeners are outside these server-rendered form checks.
require('next/link');
require.cache[require.resolve('next/link')]!.exports = { __esModule: true, default: ({ href, children, ...props }: any) => h('a', { ...props, href }, children) };
mock.method(mutable('@/common/hooks/use-close-on-outside-click'), 'useCloseOnOutsideClick', noop);
mock.method(mutable('@/common/components/unsaved-navigation/use-unsaved-navigation'), 'useUnsavedNavigation', () => ({ dialog: null, allowNavigation: noop, requestNavigation: (go: () => void) => go() }));
const api = mutable('../employee-access/employee-access.api');
const branchApi = mutable('../branch-settings/branches.api');
const confirmUi = mutable('@/common/components/modal');
const { AddEmployeePrototypePage } = require('./AddEmployeePrototypePage');
const { IndividualPermissionsPrototypePage } = require('./IndividualPermissionsPrototypePage');
const { PermissionMatrixPrototypePage } = require('./PermissionMatrixPrototypePage');
const { RoleBuilder } = require('./EmployeeAccessPages');
function noop() {}
const role = { id: 'r', key: 'CUSTOM', name: 'ผู้ช่วยร้าน', permissionKeys: [], isSystem: false, status: 'ACTIVE', assignableByCurrentUser: true, activeEmployeeCount: 0 };
const employee = { id: 'person', userId: 'member', displayName: 'มีนา ใจดี', firstName: 'มีนา', lastName: 'ใจดี', titlePrefix: 'นางสาว',
  dateOfBirth: '1995-02-01T00:00:00.000Z', phoneNumber: '0812345678', email: 'shop@example.com', jobTitle: 'หน้าร้าน',
  identityType: 'THAI_NATIONAL_ID', identityMasked: '***1234', status: 'ACTIVE', roles: [{ id: role.id, key: role.key, name: role.name }],
  branchScopeMode: 'SELECTED_BRANCHES', defaultBranchId: 'branch', branchScopeBranchIds: ['branch'] };

function viewOf(Page: any, props: object) {
  const view = certificateHarness(() => h(AppRouterContext.Provider, { value: { push: noop, prefetch: noop } as never },
    h(PathnameContext.Provider, { value: '/companies/shop/settings/access-overview' },
      h(SearchParamsContext.Provider, { value: new URLSearchParams('role=r') },
        h(ToastContext.Provider, { value: { success: noop, error: noop } as never }, h(Page, { companyId: 'shop', ...props }))))));
  // Like state, refs survive a React render; concurrent reads retain the same generation counter.
  const refs: { current: unknown }[] = [];
  const runtime = require('react') as typeof import('react');
  return { ...view, render(runEffects = false) {
    let cursor = 0;
    const original = runtime.useRef;
    const patch = mock.method(runtime, 'useRef', (initial: unknown) => {
      const value = original(initial);
      return refs[cursor++] ??= value;
    });
    try { return view.render(runEffects); } finally { patch.mock.restore(); }
  } };
}

async function withPage(Page: any, props: object, person: object, roles: object[], run: (view: ReturnType<typeof viewOf>) => Promise<void> | void, failingReads = new Set<string>()) {
  const read = <T,>(name: string, value: T) => { if (failingReads.has(name)) throw new Error("Unavailable"); return value; };
  const mocks = [
    mock.method(api, 'getEmployee', async () => person),
    mock.method(api, 'listEmployees', async () => read('employees', [person])),
    mock.method(api, 'listRoles', async () => read('roles', roles)),
    mock.method(api, 'getAccessMatrix', async () => read('matrix', { rows: roles.map((role: any) => ({ roleId: role.id, menus: {} })), menus: [] })),
    mock.method(api, 'listCapabilityPacks', async () => ({ modules: [] })),
    mock.method(api, 'listRoleTemplates', async () => []),
    mock.method(branchApi, 'listBranches', async () => [{ id: 'branch', name: 'สาขาหลัก', status: 'ACTIVE' }, { id: 'other', name: 'สาขาสอง', status: 'ACTIVE' }]),
  ];
  const view = viewOf(Page, props);
  try { view.render(true); await view.settle(); view.render(); await run(view); }
  finally { view.cleanup(); mocks.forEach(item => item.mock.restore()); }
}

test('FIX-R2 managers cannot switch privileged roles off; role managers can', async () => {
  const privileged = { ...role, key: 'MANAGER', permissionKeys: ['access.employee.update'] };
  const person = { ...employee, roles: [{ id: role.id, key: 'MANAGER', name: 'ผู้จัดการ' }] };
  for (const canManage of [false, true]) {
    await withPage(IndividualPermissionsPrototypePage, { viewerPermissions: ['access.employee.read', 'access.employee.disable', ...(canManage ? ['access.role.manage'] : [])] }, person, [privileged], view => {
      assert.equal(/role="switch"/.test(view.render()), canManage);
    });
  }
});

test('FIX-R2 shared accounts offer the account holders own password reset instead of an administrator reset', async () => {
  for (const sharedAccount of [false, true]) {
    await withPage(IndividualPermissionsPrototypePage, { viewerPermissions: ['access.employee.read', 'access.employee.credential.issue'] }, { ...employee, sharedAccount }, [role], view => {
      const html = view.render();
      assert.equal(html.includes('>รีเซ็ตรหัสผ่าน</button>'), !sharedAccount);
      if (sharedAccount) {
        assert.match(html, /ให้เจ้าของบัญชีตั้งรหัสผ่านเอง/);
        assert.match(html, /href="\/forgot-password"/);
      }
    });
  }
});

test('FIX-R2 legacy main-branch employees show one branch in the row and detail', async () => {
  await withPage(IndividualPermissionsPrototypePage, { viewerPermissions: ['access.employee.read'] },
    { ...employee, branchScopeMode: 'DEFAULT_BRANCH_ONLY', branchScopeBranchIds: [] }, [role], view => {
      const html = view.render();
      assert.doesNotMatch(html, /0 สาขา/);
      assert.match(html, /1 สาขา/);
      const accessible = html.match(/<div id="employee-accessible-branches"[^>]*>([\s\S]*?)<\/div>/)?.[1];
      assert.ok(accessible);
      assert.match(accessible, /สาขาหลัก/);
      assert.doesNotMatch(accessible, /สาขาสอง/);
    });
});

test('FIX-R2 a role in use shows its blocking count and links to its employees instead of offering disable', async () => {
  await withPage(PermissionMatrixPrototypePage, { viewerPermissions: ['access.role.manage', 'access.employee.read'] }, employee,
    [{ ...role, activeEmployeeCount: 2 }], view => {
      const html = view.render();
      assert.doesNotMatch(html, />ปิดใช้งานบทบาท<\/button>/);
      assert.match(html, /ยังมีพนักงานใช้บทบาทนี้ 2 คน/);
      assert.match(html, /href="\/companies\/shop\/settings\/access-overview\?role=r"/);
      assert.match(html, /ย้ายพนักงานไปบทบาทอื่น/);
    });
});

test('FIX-R2 a new role assignment during disable refreshes the count and explains how to move staff', async () => {
  const confirm = mock.method(confirmUi, 'useConfirm', () => ({ confirm: async () => true, confirmDialog: null }));
  const disable = mock.method(api, 'disableRole', async () => { throw Object.assign(new Error('Role is still assigned to active employees. Reassign before disabling.'), { status: 409 }); });
  try {
    await withPage(PermissionMatrixPrototypePage, { viewerPermissions: ['access.role.manage', 'access.employee.read'] }, employee, [role], async view => {
      const reload = mock.method(api, 'listRoles', async () => [{ ...role, activeEmployeeCount: 1 }]);
      try {
        view.find('button', props => props.children.includes('ปิดใช้งานบทบาท')).onClick();
        await view.settle();
        const html = view.render();
        assert.match(html, /ยังมีพนักงานใช้บทบาทนี้ 1 คน/);
        assert.match(html, /บทบาทนี้ยังมีพนักงานใช้อยู่ ย้ายพนักงานไปบทบาทอื่นก่อนปิดใช้งาน/);
        assert.doesNotMatch(html, /ข้อมูลซ้ำกับที่มีอยู่ในระบบ/);
        assert.match(html, /ย้ายพนักงานไปบทบาทอื่น<\/a>/);
      } finally { reload.mock.restore(); }
    });
  } finally { confirm.mock.restore(); disable.mock.restore(); }
});

test('FIX-R2 saving a disabled employee keeps the disabled state and re-enables through the status endpoint', async () => {
  const person = { ...employee, status: 'DISABLED' };
  let completed = 0, switched = 0;
  const mocks = [
    mock.method(api, 'updateEmployee', async () => person),
    mock.method(api, 'issueEmployeeLineLinkToken', async () => null),
    mock.method(api, 'completeEmployee', async () => { completed++; }),
    mock.method(api, 'setEmployeeStatus', async (_company: string, _id: string, status: string) => { assert.equal(status, 'ACTIVE'); switched++; return { ...person, status }; }),
  ];
  try {
    await withPage(AddEmployeePrototypePage, { editEmployeeId: person.id, viewerPermissions: ['access.employee.read', 'access.employee.update', 'access.employee.disable', 'access.role.manage'] }, person, [role], async view => {
      view.find('button', props => props.children.includes('บันทึก')).onClick();
      await view.settle();
      const html = view.render();
      assert.match(html, /ยังปิดใช้งานอยู่/);
      assert.doesNotMatch(html, /ยังเป็นร่าง|เป็นร่างแล้ว/);
      view.find('button', props => props.children.includes('เปิดใช้งานพนักงาน')).onClick();
      await view.settle(); view.render();
      assert.equal(completed, 0);
      assert.equal(switched, 1);
    });
  } finally { mocks.forEach(item => item.mock.restore()); }
});

test('FIX-R2 the email field distinguishes shared-shop email from a local login email', async () => {
  for (const sharedAccount of [false, true]) {
    await withPage(AddEmployeePrototypePage, { editEmployeeId: employee.id, viewerPermissions: ['access.employee.update'] }, { ...employee, sharedAccount }, [role], view => {
      const field = view.find('TextField', props => props.id === 'employee-email');
      assert.equal(field.label, sharedAccount ? 'อีเมลสำหรับร้านนี้' : 'อีเมล (ใช้เข้าสู่ระบบ)');
    });
  }
});


for (const [Page, failedRead, title, empty] of [
  [IndividualPermissionsPrototypePage, 'employees', 'โหลดรายชื่อพนักงานไม่สำเร็จ', 'ยังไม่มีพนักงานในร้านนี้'],
  [PermissionMatrixPrototypePage, 'roles', 'โหลดบทบาทไม่สำเร็จ', 'ยังไม่มีบทบาทในร้านนี้'],
] as const) test(`FIX-R3 ${failedRead}: a failed first read has retry and never says the list is empty`, async () => {
  const failed = new Set([failedRead]);
  await withPage(Page, { viewerPermissions: ['access.employee.read'] }, employee, [role], async view => {
    const html = view.render();
    assert.match(html, new RegExp(title));
    assert.doesNotMatch(html, new RegExp(empty));
    failed.clear();
    view.find('Button', props => props.children.includes('ลองอีกครั้ง')).onClick();
    assert.match(view.render(), /กำลังโหลด/);
    await view.settle();
    const retried = view.render();
    assert.doesNotMatch(retried, new RegExp(title));
    assert.match(retried, new RegExp(failedRead === 'employees' ? employee.displayName : role.name));
  }, failed);
});

test('FIX-R3 a missing permission read never renders an unticked or stale matrix and retry restores it', async () => {
  const failed = new Set(['matrix']);
  await withPage(PermissionMatrixPrototypePage, { viewerPermissions: ['access.role.read'] }, employee, [role], async view => {
    const html = view.render();
    assert.match(html, /โหลดตารางสิทธิ์ไม่สำเร็จ/);
    assert.doesNotMatch(html, /data-testid="role-permission-matrix"|ไม่ได้เปิดสิทธิ์/);
    failed.clear();
    view.find('Button', props => props.children.includes('ลองอีกครั้ง')).onClick();
    await view.settle();
    assert.match(view.render(), /data-testid="role-permission-matrix"/);
    failed.add('matrix');
    view.render(true); await view.settle();
    assert.doesNotMatch(view.render(), /data-testid="role-permission-matrix"/);
  }, failed);
});

test('FIX-R3 long role lists and employee role choices are searchable inside a bounded scroll area', async () => {
  const roles = [role, ...Array.from({ length: 8 }, (_, index) => ({ ...role, id: `role-${index}`, name: `ผู้ช่วย ${index}` }))];
  await withPage(PermissionMatrixPrototypePage, { viewerPermissions: ['access.role.read'] }, employee, roles, view => {
    view.find('input', props => props['aria-label'] === 'ค้นหาบทบาท').onChange({ target: { value: 'ผู้ช่วย 7' } });
    view.render();
    const choices = view.nodes.filter(node => node.tag === 'button' && node.props.className?.includes('min-h-14'));
    assert.equal(choices.length, 1);
    assert.match(view.render(), /max-h-\[60vh\].*overflow-y-auto/);
    view.find('input', props => props['aria-label'] === 'ค้นหาบทบาท').onChange({ target: { value: 'ไม่มีชื่อนี้' } });
    assert.match(view.render(), /ไม่พบบทบาทที่ตรงกับคำค้น/);
  });
  await withPage(IndividualPermissionsPrototypePage, { viewerPermissions: ['access.employee.read', 'access.employee.update'] }, employee, roles, view => {
    view.find('button', props => props['aria-label'] === 'เปลี่ยนบทบาทพนักงาน').onClick(); view.render();
    view.find('input', props => props['aria-label'] === 'ค้นหาบทบาทพนักงาน').onChange({ target: { value: 'ผู้ช่วย 7' } }); view.render();
    const listbox = view.render().match(/<div role="listbox" class="max-h-64[^>]*>([\s\S]*?)<\/div>/)?.[1];
    assert.ok(listbox);
    assert.equal((listbox.match(/role="option"/g) ?? []).length, 1);
    assert.match(listbox, /ผู้ช่วย 7/);
    assert.match(view.render(), /role="listbox"[^>]*max-h-64[^>]*overflow-y-auto/);
    view.find('input', props => props['aria-label'] === 'ค้นหาบทบาทพนักงาน').onChange({ target: { value: 'ไม่มีชื่อนี้' } });
    assert.match(view.render(), /ไม่พบบทบาทที่ตรงกับคำค้น/);
  });
});

test('FIX-R3 employee form role search preserves a selected role while it is hidden', async () => {
  const roles = [role, ...Array.from({ length: 8 }, (_, index) => ({ ...role, id: `role-${index}`, name: `ผู้ช่วย ${index}` }))];
  await withPage(AddEmployeePrototypePage, { editEmployeeId: employee.id, viewerPermissions: ['access.employee.update'] }, employee, roles, view => {
    view.find('input', props => props['aria-label'] === 'ค้นหาบทบาทในฟอร์มพนักงาน').onChange({ target: { value: 'ผู้ช่วย 7' } }); view.render();
    assert.equal(view.nodes.filter(node => node.tag === 'input' && node.props.name === 'employee-role').length, 1);
    view.find('input', props => props['aria-label'] === 'ค้นหาบทบาทในฟอร์มพนักงาน').onChange({ target: { value: '' } }); view.render();
    assert.equal(view.find('input', props => props.name === 'employee-role' && props.value === role.id).checked, true);
    assert.match(view.render(), /max-h-64[^>]*overflow-y-auto/);
  });
});

test('FIX-R3 employee and role form actions use the shared form bar and the job title has full width', async () => {
  for (const editEmployeeId of [undefined, employee.id]) await withPage(AddEmployeePrototypePage,
    { editEmployeeId, viewerPermissions: ['access.employee.read', 'access.employee.update', 'access.employee.create'] }, employee, [role], view => {
      assert.match(view.render(), /data-form-action-bar/);
      if (editEmployeeId) assert.doesNotMatch(view.find('TextField', props => props.id === 'employee-job-title').className ?? '', /max-w-/);
    });
  const view = viewOf(RoleBuilder, { packModules: [], allPacks: [], templates: [], roleOptionsAvailable: true, onCancel: noop, onSubmit: async () => {} });
  try { assert.match(view.render(), /data-form-action-bar/); } finally { view.cleanup(); }
});


test('employee disable gives the icon ปิด and the safe outcome ไม่ปิด without changing status on cancel', async () => {
  let request: any, writes = 0;
  const confirm = mock.method(confirmUi, 'useConfirm', () => ({ confirm: async (input: any) => { request = input; return false; }, confirmDialog: null }));
  const save = mock.method(api, 'setEmployeeStatus', async () => { writes++; });
  try {
    await withPage(IndividualPermissionsPrototypePage, { viewerPermissions: ['access.employee.read', 'access.employee.disable'] }, employee, [role], async view => {
      view.find('button', props => props.role === 'switch').onClick(); await view.settle();
      assert.equal(request.closeLabel, 'ปิด');
      assert.equal(request.cancelLabel, 'ไม่ปิด');
      assert.equal(writes, 0);
    });
  } finally { confirm.mock.restore(); save.mock.restore(); }
});


for (const [Page, failedRead, endpoint, latest, visible] of [
  [IndividualPermissionsPrototypePage, 'employees', 'listEmployees', [{ ...employee, displayName: 'ข้อมูลพนักงานล่าสุด' }], /ข้อมูลพนักงานล่าสุด/],
  [PermissionMatrixPrototypePage, 'roles', 'listRoles', [{ ...role, name: 'บทบาทล่าสุด' }], /บทบาทล่าสุด/],
  [PermissionMatrixPrototypePage, 'matrix', 'getAccessMatrix', { rows: [{ roleId: role.id, menus: {} }], menus: [] }, /data-testid="role-permission-matrix"/],
] as const) test(`read race ${failedRead}: an older failure cannot overwrite the successful retry`, async () => {
  await withPage(Page, { viewerPermissions: ['access.employee.read'] }, employee, [role], async view => {
    let rejectOlder!: (reason: unknown) => void;
    const older = new Promise((_resolve, reject) => { rejectOlder = reject; });
    let reads = 0;
    const read = mock.method(api, endpoint, () => ++reads === 1 ? older : Promise.resolve(latest));
    try {
      // A second mount read is still pending when the visible failure's retry starts a newer read.
      view.render(true);
      view.find('Button', props => props.children.includes('ลองอีกครั้ง')).onClick();
      await view.settle();
      assert.equal(reads, 2);
      assert.match(view.render(), visible);
      rejectOlder(new Error('Older read failed late'));
      await view.settle();
      const html = view.render();
      assert.match(html, visible);
      assert.doesNotMatch(html, /โหลดรายชื่อพนักงานไม่สำเร็จ|โหลดบทบาทไม่สำเร็จ|โหลดตารางสิทธิ์ไม่สำเร็จ/);
    } finally { read.mock.restore(); }
  }, new Set([failedRead]));
});
