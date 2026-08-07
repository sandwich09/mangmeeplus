import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LINE_TOOL_REGISTRY, MENU_REGISTRY } from '@watchdog-bms/contracts';
import { ALLOWED_TOOLS as ACCOUNTING_TOOLS } from './accounting-summary.agent';
import { ALLOWED_TOOLS as INVENTORY_TOOLS } from './inventory.agent';
import { ROUTER_ENABLED_TOOLS } from './intent-router.agent';
import { LINE_AI_FEATURE_COVERAGE } from './line-ai-feature-coverage';

const manifestTools = LINE_AI_FEATURE_COVERAGE.flatMap((row) => row.tools.map((tool) => ({ row, tool })));
const specialistTools = new Set([...ACCOUNTING_TOOLS, ...INVENTORY_TOOLS]);

describe('LINE AI feature-to-tool coverage manifest', () => {
  it('classifies every registry tool exactly once with registry-owned metadata', () => {
    const counts = new Map<string, number>();
    for (const { tool } of manifestTools) {
      counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
      const registryTool = LINE_TOOL_REGISTRY.find((entry) => entry.name === tool.name);
      assert.ok(registryTool, `Manifest references unknown tool ${tool.name}`);
      assert.deepEqual(tool.requiredPermissions, registryTool.requiredPermissions, `${tool.name} permissions drifted`);
      assert.deepEqual(tool.anyOfPermissions, registryTool.anyOfPermissions, `${tool.name} any-of permissions drifted`);
      assert.equal(tool.sourceModule, registryTool.sourceModule, `${tool.name} source module drifted`);
    }

    assert.deepEqual(
      [...counts.entries()].filter(([, count]) => count !== 1),
      [],
      'A registry tool must not appear in more than one capability row',
    );
    assert.deepEqual(
      LINE_TOOL_REGISTRY.map((tool) => tool.name).filter((name) => counts.get(name) !== 1),
      [],
      'Every registry tool must appear exactly once in the manifest',
    );
  });

  it('claims covered only when router and a specialist both expose the tool', () => {
    for (const { row, tool } of manifestTools.filter(({ row }) => row.status === 'covered')) {
      assert.ok(ROUTER_ENABLED_TOOLS.has(tool.name), `${row.id} claims router-disabled ${tool.name} is covered`);
      assert.ok(specialistTools.has(tool.name), `${row.id} claims specialist-unreachable ${tool.name} is covered`);
    }
  });

  it('explicitly classifies every router-enabled but specialist-unreachable tool as not covered', () => {
    const unreachable = [...ROUTER_ENABLED_TOOLS].filter((name) => !specialistTools.has(name));
    for (const name of unreachable) {
      const claim = manifestTools.find(({ tool }) => tool.name === name);
      assert.ok(claim, `${name} has no coverage claim`);
      assert.notEqual(claim.row.status, 'covered', `${name} is router-enabled but cannot execute through a specialist`);
      assert.ok(claim.row.reason, `${name} gap needs an explicit reason`);
    }
  });

  it('does not claim a router-disabled registry tool is covered', () => {
    for (const { row, tool } of manifestTools) {
      if (!ROUTER_ENABLED_TOOLS.has(tool.name)) {
        assert.notEqual(row.status, 'covered', `${tool.name} is disabled but ${row.id} claims coverage`);
      }
    }
  });

  it('classifies every shared navigation row once and preserves its view permission when one exists', () => {
    const menuClaims = LINE_AI_FEATURE_COVERAGE.flatMap((row) => (row.navigationMenuIds ?? []).map((menuId) => ({ menuId, row })));
    for (const menu of MENU_REGISTRY) {
      const claims = menuClaims.filter((claim) => claim.menuId === menu.id);
      assert.equal(claims.length, 1, `${menu.id} must have exactly one LINE coverage claim`);
      const viewPermissions = menu.actions.view ?? [];
      if (viewPermissions.length > 0) {
        assert.ok(
          viewPermissions.some((permission) => claims[0]!.row.requiredPermissions.includes(permission)),
          `${menu.id} coverage must retain one shared view permission`,
        );
      }
    }
    assert.deepEqual(menuClaims.filter((claim) => !MENU_REGISTRY.some((menu) => menu.id === claim.menuId)), []);
  });

  it('requires an owner and reason for every feature-gated row and a reason for every web-only row', () => {
    for (const row of LINE_AI_FEATURE_COVERAGE) {
      if (row.status === 'feature_gated') {
        assert.ok(row.owningItem, `${row.id} feature gate has no owner`);
        assert.ok(row.reason, `${row.id} feature gate has no reason`);
      }
      if (row.status === 'web_only') assert.ok(row.reason, `${row.id} web-only gap has no reason`);
    }
  });
});
