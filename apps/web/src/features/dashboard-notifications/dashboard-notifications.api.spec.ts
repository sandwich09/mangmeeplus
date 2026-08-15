import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateSnapshot, getDashboard, normalizeNotification, normalizeRule } from './dashboard-notifications.api';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function captureRequest(): { url?: string; body?: string } {
  const request: { url?: string; body?: string } = {};
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    request.url = String(input);
    if (init?.body) request.body = String(init.body);
    return new Response(JSON.stringify({ widgets: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return request;
}

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
      name: 'Low Stock Alert',
      severity: 'action',
      conditionJson: {},
      recipientPolicyJson: {},
      channelPolicyJson: { channels: ['web', 'line'] },
      cooldownMinutes: 720,
      digestPolicy: 'none',
      status: 'enabled',
    });

    assert.equal(rule.label, 'Low Stock Alert');
    assert.deepEqual(rule.channels, ['web', 'line']);
  });
});
