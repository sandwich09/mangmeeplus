import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateSnapshot, getDashboard, getExpenseMonths, normalizeNotification, normalizeRule, markRead, markAllRead, dismissNotification, NOTIFICATIONS_CHANGED_EVENT } from './dashboard-notifications.api';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe('notification mutation events', () => {
  it('notifies the bell only after a successful read, read-all or dismiss', async () => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const target = new EventTarget();
    let changes = 0;
    target.addEventListener(NOTIFICATIONS_CHANGED_EVENT, () => changes++);
    Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
    try {
      for (const mutate of [() => markRead('c1', 'n1'), () => markAllRead('c1'), () => dismissNotification('c1', 'n1')]) {
        const before = changes;
        globalThis.fetch = async () => new Response(null, { status: 204 });
        await mutate();
        assert.equal(changes, before + 1);
        globalThis.fetch = async () => new Response(JSON.stringify({ message: 'Service unavailable' }), { status: 503 });
        await assert.rejects(mutate);
        assert.equal(changes, before + 1, 'a failure must not announce a successful read-state change');
      }
    } finally {
      if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
      else Reflect.deleteProperty(globalThis, 'window');
    }
  });
});

function captureRequest(): { url?: string; body?: string } {
  const request: { url?: string; body?: string } = {};
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    request.url = String(input);
    if (init?.body) request.body = String(init.body);
    return new Response(JSON.stringify({ widgets: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return request;
}

it('HOME-RANGE reads and refreshes custom civil dates without dropping the branch', async () => {
  const range = { customStart: '2026-09-01', customEnd: '2026-09-30' };
  const request = captureRequest();
  await getDashboard('c1', 'custom', 'b1', range);
  assert.equal(request.url, '/api/v1/companies/c1/dashboard?periodKind=custom&branchId=b1&customStart=2026-09-01&customEnd=2026-09-30');
  await generateSnapshot('c1', 'custom', 'b1', range);
  assert.deepEqual(JSON.parse(request.body!), { periodKind: 'custom', branchId: 'b1', ...range });
});

describe('dashboard-notifications.api branch scope', () => {
  it('sends the selected branch as a query param on the dashboard read', async () => {
    const request = captureRequest();
    await getDashboard('company-1', 'month', 'branch-1');
    assert.equal(request.url, '/api/v1/companies/company-1/dashboard?periodKind=month&branchId=branch-1');
  });

  it('omits branchId from the dashboard read when none is selected', async () => {
    const noSelection = captureRequest();
    await getDashboard('company-1', 'month');
    assert.equal(noSelection.url, '/api/v1/companies/company-1/dashboard?periodKind=month');

    const allBranches = captureRequest();
    await getDashboard('company-1', 'month', '');
    assert.equal(allBranches.url, '/api/v1/companies/company-1/dashboard?periodKind=month');
  });

  it('sends the selected branch in the generate-snapshot body', async () => {
    const request = captureRequest();
    await generateSnapshot('company-1', 'today', 'branch-1');
    assert.equal(request.url, '/api/v1/companies/company-1/dashboard/snapshots/generate');
    assert.deepEqual(JSON.parse(request.body ?? '{}'), { periodKind: 'today', branchId: 'branch-1' });
  });

  it('omits branchId from the generate-snapshot body when none is selected', async () => {
    const noSelection = captureRequest();
    await generateSnapshot('company-1', 'today');
    assert.deepEqual(JSON.parse(noSelection.body ?? '{}'), { periodKind: 'today' });

    const allBranches = captureRequest();
    await generateSnapshot('company-1', 'today', '');
    assert.deepEqual(JSON.parse(allBranches.body ?? '{}'), { periodKind: 'today' });
  });
});

describe('dashboard-notifications.api normalizers', () => {
  it('maps notification read state and source module from backend DTO', () => {
    const item = normalizeNotification({
      id: 'n1',
      companyId: 'c1',
      triggerKey: 'stock_low',
      severity: 'action',
      title: 'Low stock',
      body: 'SKU A',
      createdAt: '2026-06-25T00:00:00.000Z',
      readAt: '2026-06-25T01:00:00.000Z',
      sourceRefs: [{ module: 'inventory' }],
      deliveryChannels: ['web', 'line'],
    });

    assert.equal(item.read, true);
    assert.equal(item.sourceModule, 'inventory');
    assert.deepEqual(item.deliveryChannels, ['web', 'line']);
  });

  it('maps rule channels from channelPolicyJson', () => {
    const rule = normalizeRule({
      id: 'r1',
      companyId: 'c1',
      triggerKey: 'stock_low',
      name: 'สินค้าต่ำกว่าจุดสั่งซื้อ',
      severity: 'action',
      conditionJson: {},
      recipientPolicyJson: {},
      channelPolicyJson: { channels: ['web', 'line'] },
      cooldownMinutes: 720,
      digestPolicy: 'none',
      status: 'enabled',
    });

    assert.equal(rule.label, 'สินค้าต่ำกว่าจุดสั่งซื้อ');
    assert.deepEqual(rule.channels, ['web', 'line']);
  });
});

it('preserves the source-resolved status independently of unread history', () => {
  const item = normalizeNotification({ id: 'completed', companyId: 'c1', triggerKey: 'workflow.reimbursement_ready_for_payment', severity: 'action', status: 'resolved', title: 'old work', body: '', createdAt: '', readAt: undefined });
  assert.equal(item.status, 'resolved');
  assert.equal(item.read, false);
});

it('sends waiting, unread, severity and cursor together without dropping a filter', async () => {
  const { listNotifications } = await import('./dashboard-notifications.api');
  let requested = '';
  globalThis.fetch = async input => { requested = String(input); return Response.json({ items: [], nextCursor: 'next' }); };
  const result = await listNotifications('co', { waiting: true, read: false, severity: 'action', cursor: 'prev', pageSize: 2 });
  const query = new URL(requested, 'http://local').searchParams;
  assert.equal(query.get('waiting'), 'true'); assert.equal(query.get('read'), 'false');
  assert.equal(query.get('severity'), 'action'); assert.equal(query.get('cursor'), 'prev'); assert.equal(query.get('pageSize'), '2');
  assert.equal(result.nextCursor, 'next');
});


it('HOME-1 reads twelve expense months with Gregorian year and optional branch, preserving money strings', async () => {
  const payload = { year: 2026, months: Array.from({ length: 12 }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, '0')}`, total: '0.00', count: 0 })), years: [2025, 2026] };
  let requested = '';
  globalThis.fetch = async input => { requested = String(input); return Response.json(payload); };
  assert.deepEqual(await getExpenseMonths('c1', 2026, 'b1'), payload);
  assert.equal(requested, '/api/v1/companies/c1/dashboard/expense-months?year=2026&branchId=b1');
  await getExpenseMonths('c1', 2026);
  assert.equal(requested, '/api/v1/companies/c1/dashboard/expense-months?year=2026');
  globalThis.fetch = async () => Response.json({ message: 'Forbidden' }, { status: 403 });
  await assert.rejects(() => getExpenseMonths('c1', 2026), (error: any) => error.status === 403);
});
