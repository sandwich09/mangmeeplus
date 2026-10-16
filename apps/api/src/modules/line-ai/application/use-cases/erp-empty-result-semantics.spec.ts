import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NotFoundException } from '@nestjs/common';
import {
  InventoryGetStockBalanceTool,
  InventoryListLowStockTool,
  InventorySearchProductsTool,
} from './erp-tools.use-case';
import { DashboardGetHealthSummaryTool, claimOfApprovalNotice, NotificationsListOpenAlertsTool } from './erp-dashboard-tools.use-case';
import { REIMBURSEMENT_REQUEST_LINK, WORKFLOW_TEMPLATE_CATALOG } from '../../../workflow/domain/workflow-template-catalog';
import {
  WorkflowExplainRunTool,
  WorkflowListAssignedTasksTool,
  WorkflowListRecentFailuresTool,
  WorkflowSummarizeRuleHealthTool,
} from './erp-workflow-tools.use-case';

const base = { companyId: 'c1', userId: 'u1', permissions: [] as string[] };

function assertGroundedEmpty(result: any): void {
  assert.equal(result.status, 'ok');
  assert.ok(result.sourceRefs.length > 0);
  assert.ok(result.sourceRefs.every((ref: any) => ref.permissionChecked === true));
}

describe('ERP LINE tools – empty is a grounded success', () => {
  it('keeps zero-item inventory reads distinct from forbidden/unavailable', async () => {
    const cases = [
      new InventorySearchProductsTool({ execute: async () => ({ total: 0, items: [] }) } as any)
        .execute({ ...base, permissions: ['inventory.product.read'] } as any, {}),
      new InventoryListLowStockTool({ execute: async () => ({ items: [] }) } as any)
        .execute({ ...base, permissions: ['inventory.product.read', 'inventory.report.read'] } as any),
      new InventoryGetStockBalanceTool({ execute: async () => [] } as any)
        .execute({ ...base, permissions: ['inventory.product.read'] } as any, {}),
    ];
    for (const result of await Promise.all(cases)) assertGroundedEmpty(result);
  });

  it('keeps zero notifications and workflow lists grounded', async () => {
    const results = await Promise.all([
      new NotificationsListOpenAlertsTool({ execute: async () => ({ items: [] }) } as any)
        .execute({ ...base, permissions: ['notification.read'] } as any),
      new WorkflowListAssignedTasksTool({ execute: async () => ({ items: [], total: 0 }) } as any)
        .execute({ ...base, permissions: ['workflow.task.read'] } as any),
      new WorkflowListRecentFailuresTool({ execute: async () => ({ items: [], total: 0 }) } as any)
        .execute({ ...base, permissions: ['workflow.run.read'] } as any),
      new WorkflowSummarizeRuleHealthTool({ execute: async () => ({ items: [], total: 0 }) } as any)
        .execute({ ...base, permissions: ['workflow.rule.read'] } as any),
    ]);
    for (const result of results) assertGroundedEmpty(result);
  });

  it('returns ok plus found=false for a missing workflow run', async () => {
    const tool = new WorkflowExplainRunTool({ execute: async () => { throw new NotFoundException(); } } as any);
    const result = await tool.execute({ ...base, permissions: ['workflow.run.read'] } as any, { runId: 'missing' });
    assertGroundedEmpty(result);
    assert.deepEqual(result.data, { found: false });
  });
});

// Design lock context 2 ("ปลายทางปุ่มใบเบิก"): the button "เปิดใบเบิกเพื่ออนุมัติ" opens THAT claim's own
// page. The claim comes from the notice's stored reference and link — never from the claim number in
// its title — and only for this company. The web page still checks the reader's rights when it opens.
describe('notifications.list_open_alerts – the claim a pending-approval notice opens', () => {
  const ctx = { ...base, permissions: ['notification.read'] } as any;
  const notice = (over: Record<string, unknown> = {}) => ({
    id: 'n1', companyId: 'c1', triggerKey: 'workflow.reimbursement_pending_approval', severity: 'ACTION', status: 'OPEN',
    title: 'อนุมัติเบิกจ่าย: RB-202608-00002', body: 'ยอด 40 THB · รออนุมัติจากคุณ', createdAt: '2026-09-17T10:00:00.000Z',
    // The shape the workflow runner stores (workflow-action-runner.use-case.ts): the reference and the link agree.
    sourceRefs: [{ module: 'reimbursements', type: 'reimbursement_request', id: 'rb-1', webPath: '/companies/c1/reimbursements/rb-1' }],
    deepLinkHref: '/companies/c1/reimbursements/rb-1',
    ...over,
  });
  const read = async (items: unknown[], nextCursor?: string) => {
    const calls: any[] = [];
    const tool = new NotificationsListOpenAlertsTool({ execute: async (sourceCtx: any, companyId: string, filter: any) => {
      calls.push({ userId: sourceCtx.userId, companyId, filter });
      return { items, nextCursor };
    } } as any);
    return { result: await tool.execute(ctx), calls };
  };
  const paths = (result: any) => result.sourceRefs.map((ref: any) => ref.webPath);
  const LIST = '/companies/c1/notifications';

  it('one open claim notice opens that claim, with its number and nothing guessed', async () => {
    const { result, calls } = await read([notice()]);
    assert.deepEqual(calls, [{ userId: 'u1', companyId: 'c1', filter: { status: 'open', pageSize: 10 } }], 'the same user/company-scoped, permission-checked read as before');
    assert.equal(result.status, 'ok');
    assert.deepEqual(paths(result), ['/companies/c1/reimbursements/rb-1']);
    assert.deepEqual(result.data, {
      count: 1, hasMore: false, opens: 'claim',
      items: [{ id: 'n1', title: 'อนุมัติเบิกจ่าย: RB-202608-00002', severity: 'ACTION', createdAt: '2026-09-17T10:00:00.000Z', kind: 'claim_approval', documentNo: 'RB-202608-00002' }],
    });
    assert.ok(result.sourceRefs.every((ref: any) => ref.permissionChecked === true));
  });

  it('turns the old approvals-tab link into the claim\'s own page, using the id that link carries', async () => {
    const legacy = notice({ sourceRefs: [], deepLinkHref: '/companies/c1/reimbursements?tab=approvals&focus=rb-1' });
    assert.deepEqual(claimOfApprovalNotice(legacy, 'c1'), { path: '/companies/c1/reimbursements/rb-1', documentNo: 'RB-202608-00002' });
    const { result } = await read([legacy]);
    assert.deepEqual(paths(result), ['/companies/c1/reimbursements/rb-1']);
    // A reference with no link at all is still that claim.
    assert.equal(claimOfApprovalNotice(notice({ deepLinkHref: undefined }), 'c1')?.path, '/companies/c1/reimbursements/rb-1');
    // The contract's own reference shape (sourceType/sourceId) reads the same way.
    assert.equal(claimOfApprovalNotice(notice({ sourceRefs: [{ module: 'reimbursements', sourceType: 'reimbursement_request', sourceId: 'rb-1', label: 'ใบเบิก' }] }), 'c1')?.path,
      '/companies/c1/reimbursements/rb-1');
  });

  it('never makes a link out of the claim number: a notice with no reference and no link opens the list', async () => {
    const bare = notice({ sourceRefs: [], deepLinkHref: undefined });
    assert.equal(claimOfApprovalNotice(bare, 'c1'), undefined);
    const { result } = await read([bare]);
    assert.deepEqual(paths(result), [LIST]);
    assert.equal((result.data as any).opens, 'list');
    assert.deepEqual((result.data as any).items[0], { id: 'n1', title: 'อนุมัติเบิกจ่าย: RB-202608-00002', severity: 'ACTION', createdAt: '2026-09-17T10:00:00.000Z' });
    assert.doesNotMatch(JSON.stringify(result), /reimbursements\/RB-|reimbursements\/rb-/);
  });

  it('refuses another company\'s notice, another company\'s link, and every link that is not exactly that page', async () => {
    for (const [why, unsafe] of [
      ['notice of another company', notice({ companyId: 'c2' })],
      ['link into another company', notice({ deepLinkHref: '/companies/c2/reimbursements/rb-1' })],
      ['reference and link disagree', notice({ deepLinkHref: '/companies/c1/reimbursements/rb-2' })],
      ['absolute link', notice({ deepLinkHref: 'https://evil.example/companies/c1/reimbursements/rb-1' })],
      ['protocol-relative link', notice({ deepLinkHref: '//evil.example/companies/c1/reimbursements/rb-1' })],
      ['path climbing out', notice({ sourceRefs: [], deepLinkHref: '/companies/c1/reimbursements/../../admin' })],
      ['sub-page of the claim', notice({ sourceRefs: [], deepLinkHref: '/companies/c1/reimbursements/rb-1/approve' })],
      ['query on the claim', notice({ sourceRefs: [], deepLinkHref: '/companies/c1/reimbursements/rb-1?next=https://evil.example' })],
      ['another page of the company', notice({ deepLinkHref: '/companies/c1/expenses/rb-1' })],
      ['id with a slash', notice({ sourceRefs: [{ type: 'reimbursement_request', id: 'rb-1/../x' }], deepLinkHref: undefined })],
      ['empty id', notice({ sourceRefs: [{ type: 'reimbursement_request', id: '' }], deepLinkHref: undefined })],
      ['old tab link without a focus', notice({ sourceRefs: [], deepLinkHref: '/companies/c1/reimbursements?tab=approvals' })],
      ['another kind of notice', notice({ triggerKey: 'workflow.expense_pending_review' })],
    ] as const) {
      assert.equal(claimOfApprovalNotice(unsafe, 'c1'), undefined, why);
      const { result } = await read([unsafe]);
      assert.deepEqual(paths(result), [LIST], why);
      assert.equal((result.data as any).opens, 'list', why);
      assert.equal((result.data as any).items[0].kind, undefined, why);
    }
  });

  it('several notices open the list they are all on, each claim still named', async () => {
    const { result } = await read([notice(), notice({ id: 'n2', title: 'อนุมัติเบิกจ่าย: RB-202608-00003',
      sourceRefs: [{ module: 'reimbursements', type: 'reimbursement_request', id: 'rb-2' }], deepLinkHref: '/companies/c1/reimbursements/rb-2' })]);
    assert.deepEqual(paths(result), [LIST, LIST]);
    assert.equal((result.data as any).opens, 'list');
    assert.deepEqual((result.data as any).items.map((item: any) => [item.kind, item.documentNo]),
      [['claim_approval', 'RB-202608-00002'], ['claim_approval', 'RB-202608-00003']]);
  });

  it('says when the page read was not the whole list, and never opens one claim out of an unfinished list', async () => {
    const { result } = await read([notice()], 'n1');
    assert.equal((result.data as any).count, 1);
    assert.equal((result.data as any).hasMore, true);
    assert.equal((result.data as any).opens, 'list');
    assert.deepEqual(paths(result), [LIST]);
  });

  it('shows no claim number for a title it cannot vouch for, though the reference still opens the claim', async () => {
    const renamed = notice({ title: 'มีใบเบิกใหม่ RB-202608-00002 รอคุณอยู่' });
    assert.deepEqual(claimOfApprovalNotice(renamed, 'c1'), { path: '/companies/c1/reimbursements/rb-1' });
    const { result } = await read([renamed]);
    assert.deepEqual((result.data as any).items[0], { id: 'n1', title: 'มีใบเบิกใหม่ RB-202608-00002 รอคุณอยู่', severity: 'ACTION', createdAt: '2026-09-17T10:00:00.000Z', kind: 'claim_approval' });
  });

  it('reads the title and the link the workflow catalog really writes for this notice', () => {
    const template = WORKFLOW_TEMPLATE_CATALOG.find((entry) => entry.key === 'reimbursement_pending_approval')!;
    const notify = template.defaultActionJson.find((action) => action.actionType === 'SEND_NOTIFICATION')!;
    const task = template.defaultActionJson.find((action) => typeof action.configJson['titleTemplate'] === 'string')!;
    assert.equal(notify.configJson['triggerKey'], 'workflow.reimbursement_pending_approval');
    assert.equal(notify.configJson['deepLinkPathTemplate'], REIMBURSEMENT_REQUEST_LINK);
    const title = String(task.configJson['titleTemplate']).replace('{{requestNo}}', 'RB-202610-00001');
    const href = REIMBURSEMENT_REQUEST_LINK.replace('{{companyId}}', 'c1').replace('{{requestId}}', 'cmg1abcd0000xyz');
    assert.deepEqual(claimOfApprovalNotice(notice({ title, deepLinkHref: href, sourceRefs: [{ module: 'reimbursements', type: 'reimbursement_request', id: 'cmg1abcd0000xyz', webPath: href }] }), 'c1'),
      { path: '/companies/c1/reimbursements/cmg1abcd0000xyz', documentNo: 'RB-202610-00001' });
  });

  it('a reader without the notification permission gets a refusal, never an empty list', async () => {
    const tool = new NotificationsListOpenAlertsTool({ execute: async () => { throw new Error('must not read'); } } as any);
    const result = await tool.execute({ ...base, permissions: [] } as any);
    assert.equal(result.status, 'forbidden');
    assert.equal(result.data, undefined);
    assert.deepEqual(result.sourceRefs, []);
  });
});


it('dashboard source links use the web menu name while keeping the snapshot identity', async () => {
  const tool = new DashboardGetHealthSummaryTool({ execute: async () => ({ id: 'snapshot-1', widgets: [], freshnessStatus: 'fresh', generatedAt: '2026-10-13' }) } as any);
  const result = await tool.execute({ ...base, permissions: ['dashboard.read'] } as any);
  assert.equal(result.sourceRefs[0]?.label, 'หน้าแรก (สุขภาพธุรกิจ)');
  assert.equal(result.sourceRefs[0]?.webPath, '/companies/c1/dashboard');
  assert.equal(result.sourceRefs[0]?.entityType, 'dashboard_snapshot');
});
