import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { subscribeToastBus, type ToastEvent } from '@/common/feedback/toast-bus';
import { NOTIFICATIONS_CHANGED_EVENT } from '@/features/dashboard-notifications/dashboard-notifications.api';
import { createDisbursementVoucherDraft, updateDisbursementVoucherDraft, listDisbursementPayees, listDisbursementPayableExpenses, deleteDisbursementVoucherDraft, getDisbursementVoucher, listDisbursementVouchers } from './disbursement-vouchers.api';

const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else delete (globalThis as Record<string, unknown>)['window'];
});

test('successful document commands refresh the bell immediately; reads and refusals do not', async () => {
  const target = new EventTarget(); let changes = 0;
  target.addEventListener(NOTIFICATIONS_CHANGED_EVENT, () => changes++);
  Object.defineProperty(globalThis, 'window', { value: target, configurable: true });
  globalThis.fetch = (async () => Response.json({ id: 'doc', version: 2 })) as typeof fetch;
  const api = await import('./disbursement-vouchers.api');
  const body = { commandId: 'command', expectedVersion: 1 };
  for (const command of [api.submitDisbursementVoucher, api.approveDisbursementVoucher, api.withdrawDisbursementVoucher, api.cancelDisbursementVoucher, api.returnDisbursementVoucher, api.payDisbursementVoucher]) {
    await command('shop', 'doc', body); // The server's body validation is covered separately.
  }
  await api.remindDisbursementVoucher('shop', 'doc', { ...body, approverUserId: 'approver' });
  await api.createDisbursementVoucherDraft('shop', { commandId: 'command', payeeName: 'ร้าน ก', lines: [] });
  await api.updateDisbursementVoucherDraft('shop', 'doc', { ...body, payeeName: 'ร้าน ก', lines: [] });
  await api.issueDisbursementVoucherFromPayment('shop', { commandId: 'command', expenseId: 'expense', paymentId: 'payment' });
  await api.reissueDisbursementVoucher('shop', 'doc', { commandId: 'command' });
  await api.attachDisbursementVoucherSlip('shop', 'doc', 'slip');
  await api.deleteDisbursementVoucherDraft('shop', 'doc');
  assert.equal(changes, 13);
  await api.getDisbursementVoucher('shop', 'doc'); assert.equal(changes, 13);
  globalThis.fetch = (async () => Response.json({ code: 'disbursement_version_conflict' }, { status: 409 })) as typeof fetch;
  await assert.rejects(() => api.approveDisbursementVoucher('shop', 'doc', body)); assert.equal(changes, 13);
});

test('list requests the selected status and page and preserves server counts and primary actions', async () => {
  const answer = { data: [{ id: 'draft', primaryAction: 'submit' }], counts: { DRAFT: 1 }, page: 2, pageSize: 20, total: 21 };
  globalThis.fetch = (async (input, init) => {
    assert.equal(String(input), '/api/v1/companies/shop%2Fone/disbursement-vouchers?status=DRAFT&page=2&pageSize=20');
    assert.equal(init?.credentials, 'include');
    return Response.json(answer);
  }) as typeof fetch;
  assert.deepEqual(await listDisbursementVouchers('shop/one', { status: 'DRAFT', page: 2, pageSize: 20 }), answer);
});

test('detail preserves the server actions and encodes the document path', async () => {
  const answer = { header: { status: 'DRAFT' }, lines: [], revisions: [], actions: { edit: true, delete: false } };
  globalThis.fetch = (async (input) => {
    assert.equal(String(input), '/api/v1/companies/shop/disbursement-vouchers/draft%2Fone');
    return Response.json(answer);
  }) as typeof fetch;
  assert.deepEqual(await getDisbursementVoucher('shop', 'draft/one'), answer);
});

test('draft deletion sends a bodyless DELETE and accepts the empty successful response', async () => {
  globalThis.fetch = (async (input, init) => {
    assert.equal(String(input), '/api/v1/companies/shop/disbursement-vouchers/draft');
    assert.equal(init?.method, 'DELETE');
    assert.equal(init?.body, undefined);
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  assert.equal(await deleteDisbursementVoucherDraft('shop', 'draft'), undefined);
});

test('delete refusals are not retried or toasted so the dialog can show their actionable Thai sentence', async () => {
  (globalThis as Record<string, unknown>)['window'] = {};
  const events: ToastEvent[] = [];
  const unsubscribe = subscribeToastBus((event) => events.push(event));
  let requests = 0;
  globalThis.fetch = (async () => {
    requests++;
    return Response.json({ code: 'disbursement_numbered_delete' }, { status: 409 });
  }) as typeof fetch;
  try {
    await assert.rejects(() => deleteDisbursementVoucherDraft('shop', 'draft'), (error: Error & { status?: number }) => {
      assert.equal(error.status, 409);
      assert.equal(apiErrorMessage(error), 'ใบที่มีเลขแล้วลบไม่ได้ ให้ใช้ยกเลิกแทน');
      return true;
    });
    assert.equal(requests, 1);
    assert.deepEqual(events, []);
  } finally { unsubscribe(); }
});


test('source readers send server search, payee group and paging rather than filtering a held dropdown', async () => {
  const asked: string[] = [];
  globalThis.fetch = (async (input) => { asked.push(String(input)); return Response.json([]); }) as typeof fetch;
  await listDisbursementPayees('shop', { search: 'ร้าน ก', page: 2, pageSize: 20 });
  await listDisbursementPayableExpenses('shop', { payeeKey: 'opaque/key' });
  await listDisbursementPayableExpenses('shop', { search: 'ร้านอื่น' });
  assert.deepEqual(asked, [
    '/api/v1/companies/shop/disbursement-vouchers/payees?search=%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%99+%E0%B8%81&page=2&pageSize=20',
    '/api/v1/companies/shop/disbursement-vouchers/payable-expenses?payeeKey=opaque%2Fkey',
    '/api/v1/companies/shop/disbursement-vouchers/payable-expenses?search=%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%99%E0%B8%AD%E0%B8%B7%E0%B9%88%E0%B8%99',
  ]);
});
test('payee search sends partial Thai and Latin words unchanged and preserves server prefix order and counts', async () => {
  const result = { data: [
    { payeeKey: 'prefix', displayName: 'T3B ร้านวัสดุทวีทรัพย์', expenseCount: 2, selectableExpenseCount: 1, totalOutstanding: '10.0000', taxId: null },
    { payeeKey: 'contains', displayName: 'สาขา T3B ร้านวัสดุทวีทรัพย์', expenseCount: 1, selectableExpenseCount: 1, totalOutstanding: '500.0000', taxId: null },
  ], total: 2, page: 1, pageSize: 20 };
  globalThis.fetch = (async input => {
    const url = new URL(String(input), 'http://localhost');
    assert.equal(url.searchParams.get('search'), 't3b ร้านวัสดุ');
    assert.equal(url.searchParams.get('page'), '1');
    return Response.json(result);
  }) as typeof fetch;
  assert.deepEqual(await listDisbursementPayees('shop', { search: 't3b ร้านวัสดุ', page: 1, pageSize: 20 }), result);
});
test('draft create and edit preserve command id, exact amounts and expected version across a lost-answer retry', async () => {
  const requests: { method?: string; url: string; body: unknown }[] = [];
  let lost = true;
  globalThis.fetch = (async (input, init) => {
    requests.push({ method: init?.method, url: String(input), body: JSON.parse(String(init?.body)) });
    if (lost) { lost = false; throw new TypeError('lost answer'); }
    return Response.json({ id: 'draft', version: 8 });
  }) as typeof fetch;
  const input = { commandId: 'same-command', lines: [{ expenseId: 'expense', amount: '0.10' }], payeeName: 'ร้าน ก', payeeConfirmed: false };
  await assert.rejects(() => createDisbursementVoucherDraft('shop', input));
  await createDisbursementVoucherDraft('shop', input);
  await updateDisbursementVoucherDraft('shop', 'draft/one', { ...input, expectedVersion: 7 });
  assert.deepEqual(requests, [
    { method: 'POST', url: '/api/v1/companies/shop/disbursement-vouchers', body: input },
    { method: 'POST', url: '/api/v1/companies/shop/disbursement-vouchers', body: input },
    { method: 'PUT', url: '/api/v1/companies/shop/disbursement-vouchers/draft%2Fone', body: { ...input, expectedVersion: 7 } },
  ]);
});

test('approval endpoints send each typed command body and preserve self-approval and optional take-back reason', async () => {
  const { listDisbursementApprovers, submitDisbursementVoucher, approveDisbursementVoucher, returnDisbursementVoucher, withdrawDisbursementVoucher, cancelDisbursementVoucher } = await import('./disbursement-vouchers.api');
  const requests: { url: string; method?: string; body?: unknown }[] = [];
  globalThis.fetch = (async (input, init) => {
    requests.push({ url: String(input), method: init?.method, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    return Response.json({ id: 'doc', version: 5 });
  }) as typeof fetch;
  const base = { commandId: 'attempt', expectedVersion: 4 };
  await listDisbursementApprovers('shop/one', 'branch/one');
  await submitDisbursementVoucher('shop', 'doc/one', { ...base, requestedApproverUserId: 'person' });
  await submitDisbursementVoucher('shop', 'doc/one', { ...base, approveNow: true });
  await approveDisbursementVoucher('shop', 'doc/one', base);
  await returnDisbursementVoucher('shop', 'doc/one', { ...base, reason: 'แก้ยอด' });
  await withdrawDisbursementVoucher('shop', 'doc/one', base);
  await cancelDisbursementVoucher('shop', 'doc/one', { ...base, reason: 'รายการซ้ำ' });
  assert.deepEqual(requests, [
    { url: '/api/v1/companies/shop%2Fone/disbursement-vouchers/approvers?branchId=branch%2Fone', method: undefined },
    ...[
      ['submit', { ...base, requestedApproverUserId: 'person' }], ['submit', { ...base, approveNow: true }], ['approve', base],
      ['return', { ...base, reason: 'แก้ยอด' }], ['withdraw', base], ['cancel', { ...base, reason: 'รายการซ้ำ' }],
    ].map(([action, body]) => ({ url: `/api/v1/companies/shop/disbursement-vouchers/doc%2Fone/${action}`, method: 'POST', body })),
  ]);
});
test('all approval refusals suppress automatic toasts and keep a lost-answer retry identical', async () => {
  const api = await import('./disbursement-vouchers.api');
  (globalThis as Record<string, unknown>)['window'] = {};
  const events: ToastEvent[] = [];
  const unsubscribe = subscribeToastBus(e => events.push(e));
  const base = { commandId: 'same-attempt', expectedVersion: 7 };
  const requests: unknown[] = [];
  let lost = true;
  globalThis.fetch = (async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)));
    if (lost) { lost = false; throw new TypeError('lost answer'); }
    return Response.json({ code: 'disbursement_version_conflict', message: 'ใบนี้ถูกแก้ไขจากที่อื่นแล้ว กรุณาเปิดใหม่ก่อนทำต่อ' }, { status: 409 });
  }) as typeof fetch;
  try {
    const input = { ...base, reason: 'ยอดไม่ถูกต้อง' };
    await assert.rejects(() => api.returnDisbursementVoucher('shop', 'doc', input));
    await assert.rejects(() => api.returnDisbursementVoucher('shop', 'doc', input));
    assert.deepEqual(requests, [input, input]);
    for (const command of [api.submitDisbursementVoucher, api.approveDisbursementVoucher, api.withdrawDisbursementVoucher, api.cancelDisbursementVoucher]) await assert.rejects(() => command('shop', 'doc', base));
    assert.deepEqual(events, []);
  } finally { unsubscribe(); }
});

test('pay posts approved details without amounts and preserves the attempt after a lost answer', async () => {
  const { payDisbursementVoucher } = await import('./disbursement-vouchers.api');
  const requests: { url: string; method?: string; body: unknown }[] = [];
  let lost = true;
  const answer = { id: 'doc', status: 'PAID', documentNumber: 'DV-1', version: 8 };
  globalThis.fetch = (async (input, init) => {
    requests.push({ url: String(input), method: init?.method, body: JSON.parse(String(init?.body)) });
    if (lost) { lost = false; throw new TypeError('lost answer'); }
    return Response.json(answer);
  }) as typeof fetch;
  const body = { commandId: 'same-attempt', expectedVersion: 7, paidDate: '2026-10-12', paymentMethod: 'BANK_TRANSFER' as const, paidFromRef: 'บัญชีร้าน' };
  await assert.rejects(() => payDisbursementVoucher('shop/one', 'doc/one', body));
  assert.deepEqual(await payDisbursementVoucher('shop/one', 'doc/one', body), answer);
  assert.deepEqual(requests, [0, 1].map(() => ({ url: '/api/v1/companies/shop%2Fone/disbursement-vouchers/doc%2Fone/pay', method: 'POST', body })));
});
test('pay refusals keep the server sentence and suppress automatic error toasts', async () => {
  const { payDisbursementVoucher } = await import('./disbursement-vouchers.api');
  (globalThis as Record<string, unknown>)['window'] = {};
  const events: ToastEvent[] = [];
  const unsubscribe = subscribeToastBus(event => events.push(event));
  try {
    for (const [code, message] of [
      ['disbursement_payment_source_changed', 'รายจ่าย EX-1 เปลี่ยนไปหลังส่งอนุมัติ กด "กลับไปแก้" เพื่อปรับรายการ แล้วส่งใหม่'],
      ['expense_changed_retry', 'บันทึกไม่สำเร็จ ยังไม่มีการบันทึกจ่ายรายการใด ลองอีกครั้ง'],
      ['disbursement_version_conflict', 'ใบนี้ถูกแก้ไขจากที่อื่นแล้ว กรุณาเปิดใหม่ก่อนทำต่อ'],
    ]) {
      globalThis.fetch = (async () => Response.json({ code, message }, { status: 409 })) as typeof fetch;
      await assert.rejects(() => payDisbursementVoucher('shop', 'doc', { commandId: 'attempt', expectedVersion: 7 }), (error: Error) => {
        assert.equal(apiErrorMessage(error), message); return true;
      });
    }
    assert.deepEqual(events, []);
  } finally { unsubscribe(); }
});

test('direct-payment issue and reissue send exact typed bodies and keep the same command on retry', async () => {
  const { issueDisbursementVoucherFromPayment, reissueDisbursementVoucher } = await import('./disbursement-vouchers.api');
  const requests: { url: string; method?: string; body: unknown }[] = [];
  let lost = true;
  const answer = { id: 'new', documentNumber: 'DV-2', status: 'PAID' };
  globalThis.fetch = (async (input, init) => {
    requests.push({ url: String(input), method: init?.method, body: JSON.parse(String(init?.body)) });
    if (lost) { lost = false; throw new TypeError('lost answer'); }
    return Response.json(answer);
  }) as typeof fetch;
  const issue = { commandId: 'same-issue', expenseId: 'expense', paymentId: 'payment' };
  await assert.rejects(() => issueDisbursementVoucherFromPayment('shop/one', issue));
  assert.deepEqual(await issueDisbursementVoucherFromPayment('shop/one', issue), answer);
  const reissue = { commandId: 'same-reissue' };
  assert.deepEqual(await reissueDisbursementVoucher('shop/one', 'old/one', reissue), answer);
  assert.deepEqual(requests, [
    ...[0, 1].map(() => ({ url: '/api/v1/companies/shop%2Fone/disbursement-vouchers/from-payment', method: 'POST', body: issue })),
    { url: '/api/v1/companies/shop%2Fone/disbursement-vouchers/old%2Fone/reissue', method: 'POST', body: reissue },
  ]);
});
test('issue and reissue refusals show the server sentence once without an automatic toast', async () => {
  const { issueDisbursementVoucherFromPayment, reissueDisbursementVoucher } = await import('./disbursement-vouchers.api');
  (globalThis as Record<string, unknown>)['window'] = {};
  const events: ToastEvent[] = [];
  const unsubscribe = subscribeToastBus(event => events.push(event));
  const message = 'รายจ่ายเปลี่ยนไปแล้ว กรุณาโหลดข้อมูลล่าสุดแล้วลองอีกครั้ง';
  globalThis.fetch = (async () => Response.json({ code: 'disbursement_source_changed', message }, { status: 409 })) as typeof fetch;
  try {
    for (const request of [
      () => issueDisbursementVoucherFromPayment('shop', { commandId: 'issue', expenseId: 'expense', paymentId: 'payment' }),
      () => reissueDisbursementVoucher('shop', 'old', { commandId: 'reissue' }),
    ]) await assert.rejects(request, (error: Error) => { assert.equal(apiErrorMessage(error), message); return true; });
    assert.deepEqual(events, []);
  } finally { unsubscribe(); }
});

test('account create sends the full number once, edits omit it to keep it, clear sends empty, and reveal is an audited POST', async () => {
  const api = await import('./disbursement-vouchers.api');
  const { disbursementAccountBody, emptyDisbursementAccount } = await import('./disbursement-voucher-account.logic');
  const number = '0012345678';
  const requests: { url: string; method?: string; body?: unknown }[] = [];
  const observedToasts: ToastEvent[] = [];
  const unsubscribe = subscribeToastBus(event => observedToasts.push(event));
  const answer = { id: 'doc', payeeAccountLast4: '5678' };
  globalThis.fetch = (async (input, init) => {
    requests.push({ url: String(input), method: init?.method, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    return Response.json(String(input).split('?')[0]!.endsWith('/reveal') ? { accountNumber: number } : answer);
  }) as typeof fetch;
  const base = { commandId: 'create', lines: [{ expenseId: 'expense', amount: '100.00' }] };
  const fields = { ...emptyDisbursementAccount, payeeBankName: 'กสิกรไทย', payeeAccountName: 'ร้าน ก', payeeAccountNumber: '001-234 5678' };
  try {
    assert.deepEqual(await api.createDisbursementVoucherDraft('shop', { ...base, ...disbursementAccountBody(fields) }), answer);
    await api.updateDisbursementVoucherDraft('shop', 'doc', { ...base, commandId: 'keep', expectedVersion: 1,
      ...disbursementAccountBody({ ...fields, payeeAccountNumber: '', payeeAccountLast4: '5678' }) });
    await api.updateDisbursementVoucherDraft('shop', 'doc', { ...base, commandId: 'clear', expectedVersion: 2,
      ...disbursementAccountBody({ ...emptyDisbursementAccount, payeeAccountCleared: true }) });
    await api.payDisbursementVoucher('shop', 'doc', { commandId: 'pay', expectedVersion: 3 });
    assert.deepEqual(await api.revealDisbursementVoucherAccount('shop/one', 'doc/one'), { accountNumber: number });
    assert.equal(requests.filter(request => JSON.stringify(request.body)?.includes(number)).length, 1);
    assert.ok(requests.every(request => !request.url.includes(number)));
    assert.equal((requests[1]!.body as any).payeeAccountNumber, undefined);
    assert.equal((requests[2]!.body as any).payeeAccountNumber, '');
    assert.deepEqual(requests.at(-1), { url: '/api/v1/companies/shop%2Fone/disbursement-vouchers/doc%2Fone/payee-account/reveal', method: 'POST' });
    assert.deepEqual(await api.revealDisbursementVoucherAccount('shop/one', 'source/one', undefined, 'prefill'), { accountNumber: number });
    assert.deepEqual(requests.at(-1), { url: '/api/v1/companies/shop%2Fone/disbursement-vouchers/source%2Fone/payee-account/reveal?purpose=prefill', method: 'POST' });
    assert.deepEqual(observedToasts, []);
  } finally { unsubscribe(); }
});

test('document PDF uses authenticated bytes and the existing download helper with cleanup', async () => {
  const { downloadDisbursementVoucherDocument } = await import('./disbursement-vouchers.api');
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const createUrl = URL.createObjectURL, revokeUrl = URL.revokeObjectURL;
  const urls: string[] = [], revoked: string[] = [];
  const link = { href: '', download: '', style: { display: '' }, click: () => { urls.push(link.href); }, remove: () => {} };
  (globalThis as any).document = { cookie: '', createElement: () => link, body: { appendChild: () => {} } };
  URL.createObjectURL = blob => { assert.ok(blob instanceof Blob); assert.equal(blob.type, 'application/pdf'); return 'blob:document'; };
  URL.revokeObjectURL = url => { revoked.push(url); };
  globalThis.fetch = (async (input, init) => {
    assert.equal(String(input), '/api/v1/companies/shop%2Fone/disbursement-vouchers/doc%2Fone/document.pdf');
    assert.equal(init?.credentials, 'include');
    return new Response('%PDF-1.7\n', { headers: { 'content-type': 'application/pdf' } });
  }) as typeof fetch;
  try {
    await downloadDisbursementVoucherDocument('shop/one', 'doc/one', 'DV-1');
    assert.equal(link.download, 'DV-1.pdf'); assert.deepEqual(urls, ['blob:document']);
    await new Promise(resolve => setTimeout(resolve, 1100));
    assert.deepEqual(revoked, ['blob:document']);
  } finally {
    URL.createObjectURL = createUrl; URL.revokeObjectURL = revokeUrl;
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument); else delete (globalThis as any).document;
  }
});
test('PDF and reveal refusals preserve the server sentence without automatic toasts', async () => {
  const api = await import('./disbursement-vouchers.api');
  (globalThis as Record<string, unknown>)['window'] = {};
  const events: ToastEvent[] = [];
  const unsubscribe = subscribeToastBus(event => events.push(event));
  const message = 'ยังจัดทำไฟล์ใบสำคัญจ่ายไม่สำเร็จ การจ่ายและเลขใบยังอยู่ ลองดาวน์โหลดอีกครั้ง';
  globalThis.fetch = (async () => Response.json({ code: 'disbursement_file_unavailable', message }, { status: 503 })) as typeof fetch;
  try {
    await assert.rejects(() => api.downloadDisbursementVoucherDocument('shop', 'doc', 'DV-1'), error => { assert.equal(apiErrorMessage(error), message); return true; });
    await assert.rejects(() => api.revealDisbursementVoucherAccount('shop', 'doc'), error => { assert.equal(apiErrorMessage(error), message); return true; });
    assert.deepEqual(events, []);
  } finally { unsubscribe(); }
});

test('remind posts the chosen recipient, version and reusable command id and preserves a cooldown sentence without a toast', async () => {
  const { remindDisbursementVoucher } = await import('./disbursement-vouchers.api');
  (globalThis as Record<string, unknown>)['window'] = {};
  const calls: { url: string; body: unknown }[] = [], events: ToastEvent[] = [];
  const unsubscribe = subscribeToastBus(event => events.push(event));
  const input = { commandId: 'same-attempt', expectedVersion: 4, approverUserId: 'a' };
  const sentence = 'เพิ่งส่งเตือน คุณเอ ไปเมื่อ 10 นาทีที่แล้ว ส่งได้อีกครั้งหลัง 08:00 น. หรือเลือกผู้อนุมัติคนอื่น';
  globalThis.fetch = (async (url, init) => { calls.push({ url: String(url), body: JSON.parse(init!.body as string) });
    if (calls.length === 1) throw new TypeError('lost answer');
    return Response.json({ code: 'disbursement_reminder_cooldown', message: sentence }, { status: 409 });
  }) as typeof fetch;
  try {
    await assert.rejects(() => remindDisbursementVoucher('shop', 'doc/one', input));
    await assert.rejects(() => remindDisbursementVoucher('shop', 'doc/one', input), failure => { assert.equal(apiErrorMessage(failure), sentence); return true; });
    assert.deepEqual(calls, [1, 2].map(() => ({ url: '/api/v1/companies/shop/disbursement-vouchers/doc%2Fone/remind', body: input })));
    assert.deepEqual(events, []);
  } finally { unsubscribe(); }
});

test('document commands stay marked in flight through success or refusal, including concurrent requests', async () => {
  const api = await import('./disbursement-vouchers.api');
  const finish: ((response: Response) => void)[] = [];
  globalThis.fetch = (() => new Promise(resolve => finish.push(resolve))) as typeof fetch;
  const body = { commandId: 'attempt', expectedVersion: 1 };
  const first = api.approveDisbursementVoucher('shop', 'doc', body);
  const second = api.cancelDisbursementVoucher('shop', 'doc', body);
  assert.equal(api.isDisbursementCommandInFlight(), true);
  finish[0]!(Response.json({ version: 2 })); await first;
  assert.equal(api.isDisbursementCommandInFlight(), true);
  finish[1]!(Response.json({ code: 'disbursement_version_conflict' }, { status: 409 }));
  await assert.rejects(second); assert.equal(api.isDisbursementCommandInFlight(), false);
});
