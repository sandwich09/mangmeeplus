/**
 * OPS-01 — cross-layer tool reachability gate.
 *
 * A tool that is router-enabled but absent from every specialist allowlist is
 * offered to the model yet can never execute (the exact TOOL-01 defect class:
 * notifications.* and inventory.search_products). This guard fails the build if
 * an enabled tool becomes unreachable, EXCEPT for an explicit, documented set of
 * known-unreachable non-MVP1 tools — which the test also pins, so fixing one
 * forces its removal here and a newly-broken tool is caught immediately.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ROUTER_ENABLED_TOOLS } from './intent-router.agent';
import { ALLOWED_TOOLS as ACCOUNTING_TOOLS } from './accounting-summary.agent';
import { ALLOWED_TOOLS as INVENTORY_TOOLS } from './inventory.agent';

const SPECIALIST_REACHABLE = new Set<string>([...ACCOUNTING_TOOLS, ...INVENTORY_TOOLS]);

// Known router-enabled tools not yet wired into any specialist (TOOL-01 residual,
// non-MVP1). Tracked explicitly so the gap is never silent. Shrink this set as
// each is wired; do not grow it without a reason.
const KNOWN_UNREACHABLE = new Set<string>([
]);

const ITEM_11B_READ_TOOLS = new Set<string>([
  'tax.get_tax_code_profile',
  'tax.get_transaction_tax_summary',
  'tax.get_reconciliation_summary',
]);

describe('OPS-01 tool reachability parity', () => {
  it('every router-enabled tool is reachable through a specialist (except the pinned known-unreachable set)', () => {
    const unreachable = [...ROUTER_ENABLED_TOOLS].filter((name) => !SPECIALIST_REACHABLE.has(name));
    const unexpected = unreachable.filter((name) => !KNOWN_UNREACHABLE.has(name));
    assert.deepEqual(
      unexpected,
      [],
      `Router-enabled but unreachable (no specialist allowlist): ${unexpected.join(', ')}`,
    );
  });

  it('the known-unreachable set contains no tool that is actually reachable now', () => {
    const stale = [...KNOWN_UNREACHABLE].filter((name) => SPECIALIST_REACHABLE.has(name));
    assert.deepEqual(stale, [], `These are now reachable — remove from KNOWN_UNREACHABLE: ${stale.join(', ')}`);
  });

  it('the known-unreachable set only lists tools that are actually router-enabled', () => {
    const notEnabled = [...KNOWN_UNREACHABLE].filter((name) => !ROUTER_ENABLED_TOOLS.has(name));
    assert.deepEqual(notEnabled, [], `KNOWN_UNREACHABLE lists non-enabled tools: ${notEnabled.join(', ')}`);
  });

  it('reimbursement.list_pending_approvals (TOOL-06) is enabled and reachable', () => {
    assert.ok(ROUTER_ENABLED_TOOLS.has('reimbursement.list_pending_approvals'));
    assert.ok(SPECIALIST_REACHABLE.has('reimbursement.list_pending_approvals'));
  });

  it('accounting.get_summary (TOOL-01) is enabled and reachable', () => {
    assert.ok(ROUTER_ENABLED_TOOLS.has('accounting.get_summary'));
    assert.ok(SPECIALIST_REACHABLE.has('accounting.get_summary'));
  });

  it('item-11B read tools are specialist-known and router-enabled after API wiring', () => {
    for (const name of ITEM_11B_READ_TOOLS) {
      assert.ok(SPECIALIST_REACHABLE.has(name), `${name} must be known to the tax/accounting specialist`);
      assert.equal(ROUTER_ENABLED_TOOLS.has(name), true, `${name} must be enabled after its API read use case is wired`);
    }
  });
});
