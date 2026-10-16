import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EXECUTIVE_ACCOUNT_STATUSES, type ExecutiveUserView } from '@watchdog-bms/contracts';
import { apiErrorMessage } from '../../common/api/api-error-message';

const logic = () => import('./executive-users.logic');
const user: ExecutiveUserView = { userId: 'u', username: 'executive', displayName: 'ผู้บริหาร', email: null, phoneNumber: null,
  status: 'ACTIVE', canRead: true, canExport: false, canSeeContacts: true, lastWebEntryAt: null, temporaryPasswordExpiresAt: null };

test('account URL round trip keeps search/status and resets paging on filter changes', async () => {
  const { executiveFilters, executiveListUrl } = await logic();
  assert.deepEqual(executiveFilters(new URLSearchParams('q=ชื่อ&filter_status=SUSPENDED&page=3')), { q: 'ชื่อ', status: 'SUSPENDED', page: 3, pageSize: 20 });
  assert.equal(executiveListUrl({ q: 'ชื่อ', status: 'ACTIVE', page: 3 }, { status: 'REVOKED' }), '/system/executive-users?q=%E0%B8%8A%E0%B8%B7%E0%B9%88%E0%B8%AD&filter_status=REVOKED');
  for (const page of ['0', '-1', '1.5', 'Infinity', '9007199254740992']) assert.equal(executiveFilters(new URLSearchParams(`page=${page}&filter_status=invalid`)).page, 1);
  assert.equal(executiveFilters(new URLSearchParams('filter_status=invalid')).status, undefined);
  assert.equal(executiveListUrl({ q: 'a', status: 'ACTIVE', page: 3 }, { q: '', status: undefined }), '/system/executive-users');
});

test('all four server statuses have Thai words and allow only supported actions', async () => {
  const { executiveStatus, executiveActions } = await logic();
  assert.deepEqual(EXECUTIVE_ACCOUNT_STATUSES.map(executiveStatus), ['รอเปิดใช้งาน', 'เปิดใช้งาน', 'ระงับ', 'ถอนสิทธิ์แล้ว']);
  for (const status of EXECUTIVE_ACCOUNT_STATUSES) {
    const actions = executiveActions({ ...user, status });
    assert.deepEqual(actions, status === 'REVOKED' ? [] : ['export', 'contacts', 'note', status === 'SUSPENDED' ? 'activate' : 'suspend', 'credential']);
  }
  assert.deepEqual(executiveActions(user, true), []);
});

test('account command toggles only its chosen right and requires a bounded reason', async () => {
  const { executiveCommand } = await logic();
  assert.deepEqual(executiveCommand(user, 'export', ' ตรวจแล้ว '), { path: 'access', body: { canExport: true, canSeeContacts: true, reason: 'ตรวจแล้ว' } });
  assert.deepEqual(executiveCommand(user, 'contacts', 'เหตุผล'), { path: 'access', body: { canExport: false, canSeeContacts: false, reason: 'เหตุผล' } });
  // The note right is sent only when it is the one being changed: the server keeps it otherwise, whatever this page last read.
  assert.deepEqual(executiveCommand(user, 'note', 'เหตุผล'), { path: 'access', body: { canExport: false, canSeeContacts: true, canEditCompanyNote: true, reason: 'เหตุผล' } });
  assert.deepEqual(executiveCommand({ ...user, canEditCompanyNote: true }, 'note', 'เหตุผล'), { path: 'access', body: { canExport: false, canSeeContacts: true, canEditCompanyNote: false, reason: 'เหตุผล' } });
  for (const action of ['export', 'contacts'] as const) assert.ok(!('canEditCompanyNote' in executiveCommand({ ...user, canEditCompanyNote: true }, action, 'เหตุผล')!.body));
  assert.deepEqual(executiveCommand(user, 'suspend', 'เหตุผล'), { path: 'status', body: { status: 'SUSPENDED', reason: 'เหตุผล' } });
  assert.deepEqual(executiveCommand({ ...user, status: 'SUSPENDED' }, 'activate', 'เหตุผล'), { path: 'status', body: { status: 'ACTIVE', reason: 'เหตุผล' } });
  assert.deepEqual(executiveCommand(user, 'credential', 'เหตุผล'), { path: 'credential', body: { reason: 'เหตุผล' } });
  for (const reason of ['', ' ', 'ก'.repeat(501)]) assert.equal(executiveCommand(user, 'export', reason), null);
  assert.equal(executiveCommand({ ...user, status: 'REVOKED' }, 'credential', 'เหตุผล'), null);
  assert.equal(executiveCommand(user, 'activate', 'เหตุผล'), null);
});

test('confirmation names both identifiers, sessions and irretrievable files truthfully', async () => {
  const { executiveConfirmation, executiveRights } = await logic();
  const reset = executiveConfirmation(user, 'credential');
  assert.ok(reset.includes(user.displayName) && reset.includes(user.username));
  assert.match(reset, /การเข้าระบบที่ค้างอยู่.*ยกเลิก/);
  for (const action of ['export', 'contacts'] as const) assert.match(executiveConfirmation({ ...user, canExport: true }, action), /ดาวน์โหลดไปแล้วเรียกคืนไม่ได้/);
  assert.equal(executiveRights({ ...user, canRead: false, canSeeContacts: false }), 'ไม่มีสิทธิ์รายงาน');
  // The note right: named by the note's own shared words in the list of rights, the switch and the action; its effect is said truthfully.
  const { COMPANY_TEAM_NOTE_WORDS: NOTE } = await import('@watchdog-bms/contracts');
  const { executiveRightList, executiveActionLabel, EXECUTIVE_RIGHTS } = await logic();
  assert.equal(EXECUTIVE_RIGHTS.canEditCompanyNote, NOTE.permissionDescription);
  assert.deepEqual(executiveRightList(user), ['ดูรายงานผู้บริหาร', 'ดูข้อมูลติดต่อเจ้าของร้าน']);
  assert.deepEqual(executiveRightList({ ...user, canExport: true, canEditCompanyNote: true }), ['ดูรายงานผู้บริหาร', 'ส่งออก Excel', 'ดูข้อมูลติดต่อเจ้าของร้าน', NOTE.permissionDescription]);
  assert.equal(executiveActionLabel(user, 'note'), `เปิดสิทธิ์${NOTE.permissionDescription}`); assert.equal(executiveActionLabel({ ...user, canEditCompanyNote: true }, 'note'), `ปิดสิทธิ์${NOTE.permissionDescription}`);
  const note = executiveConfirmation(user, 'note');
  assert.ok(note.includes(user.displayName) && note.includes(user.username)); assert.ok(note.includes(NOTE.description)); assert.doesNotMatch(note, /ดาวน์โหลด|ข้อมูลส่วนบุคคล/);
});

test('create defaults are unticked; validation and payload preserve optional contact semantics', async () => {
  const { emptyExecutiveForm, validateExecutiveForm, executiveCreateBody } = await logic();
  const empty = emptyExecutiveForm();
  assert.equal(empty.canExport, false); assert.equal(empty.canSeeContacts, false); assert.equal(empty.canEditCompanyNote, false);
  assert.deepEqual(Object.keys(validateExecutiveForm(empty)).sort(), ['displayName', 'username']);
  const valid = { ...empty, username: ' Admin_1 ', displayName: ' ชื่อ ', email: ' ', phoneNumber: ' ' };
  assert.deepEqual(validateExecutiveForm(valid), {});
  assert.deepEqual(executiveCreateBody(valid), { username: 'admin_1', displayName: 'ชื่อ', canExport: false, canSeeContacts: false, canEditCompanyNote: false });
  assert.equal(executiveCreateBody({ ...valid, canEditCompanyNote: true }).canEditCompanyNote, true);
  assert.deepEqual(Object.keys(validateExecutiveForm({ ...valid, username: 'ก', displayName: 'ก'.repeat(121), email: 'invalid', phoneNumber: '0'.repeat(21) })).sort(), ['displayName', 'email', 'phoneNumber', 'username']);
});

test('API field errors attach duplicate username or email to the correct input', async () => {
  const { executiveFieldErrors } = await logic();
  for (const field of ['username', 'email']) {
    const errors = executiveFieldErrors({ code: 'ACCOUNT_ALREADY_EXISTS', details: { fieldErrors: { [field]: 'ACCOUNT_ALREADY_EXISTS' } } });
    assert.deepEqual(Object.keys(errors), [field]); assert.match(Object.values(errors)[0] as string, /ถูกใช้แล้ว/);
  }
  assert.deepEqual(executiveFieldErrors({ code: 'INVALID_INPUT', details: { fieldErrors: { passwordHash: 'INVALID_INPUT' } } }), {});
});

test('pending expiry never claims a suspended or revoked account can sign in', async () => {
  const { executiveExpiryNotice } = await logic();
  const now = Date.parse('2026-10-03T00:00:00Z');
  assert.match(executiveExpiryNotice({ ...user, status: 'PENDING_ACTIVATION', temporaryPasswordExpiresAt: '2026-10-02T00:00:00Z' }, now)!, /หมดอายุแล้ว/);
  assert.match(executiveExpiryNotice({ ...user, status: 'PENDING_ACTIVATION' }, now)!, /ไม่ระบุวันหมดอายุ/);
  for (const status of ['SUSPENDED', 'REVOKED', 'ACTIVE'] as const) assert.equal(executiveExpiryNotice({ ...user, status }, now), null);
});

const codes = {
  ACCOUNT_ALREADY_EXISTS: 'ชื่อผู้ใช้หรืออีเมลนี้ถูกใช้แล้ว', ACCOUNT_REVOKED: 'บัญชีนี้ถูกปิดจากทางอื่นของระบบ หน้านี้เปิดคืนไม่ได้',
  ACCOUNT_PROTECTED: 'บัญชีผู้ดูแลระบบระงับหรือแก้สิทธิ์จากหน้านี้ไม่ได้', ACCOUNT_NOT_FOUND: 'ไม่พบบัญชีผู้บริหาร',
  INVALID_INPUT: 'ข้อมูลไม่ถูกต้อง ตรวจสอบแล้วลองอีกครั้ง', EXECUTIVE_QUERY_INVALID: 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบแล้วลองใหม่',
  EXECUTIVE_ACCESS_DENIED: 'คุณไม่มีสิทธิ์ใช้งานส่วนนี้', SOURCE_UNAVAILABLE: 'ระบบยังอ่านข้อมูลส่วนนี้ไม่ได้ กรุณาลองใหม่ภายหลัง',
};
for (const [code, words] of Object.entries(codes)) test(`maps ${code} without raw diagnostic text`, () => {
  assert.equal(apiErrorMessage({ code, message: 'raw technical diagnostic' }), words);
});
