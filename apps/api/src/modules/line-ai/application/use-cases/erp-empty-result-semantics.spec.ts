import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NotFoundException } from '@nestjs/common';
import {
  InventoryGetStockBalanceTool,
  InventoryListLowStockTool,
  InventorySearchProductsTool,
} from './erp-tools.use-case';
import { NotificationsListOpenAlertsTool } from './erp-dashboard-tools.use-case';
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
