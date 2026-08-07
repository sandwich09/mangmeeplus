import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCondition, validateConditionTree } from './workflow-condition.logic';
import type { WorkflowConditionNode } from '@watchdog-bms/contracts';

const NOW = new Date('2026-07-01T00:00:00.000Z');

describe('validateConditionTree', () => {
  it('accepts a valid ALL/leaf tree', () => {
    const tree: WorkflowConditionNode = {
      type: 'ALL',
      conditions: [
        { field: 'amount', op: 'GT', value: 100 },
        { field: 'status', op: 'EQ', value: 'PENDING' },
      ],
    };
    assert.deepEqual(validateConditionTree(tree), []);
  });

  it('rejects unknown group type', () => {
    const tree = { type: 'XOR', conditions: [{ field: 'a', op: 'EXISTS' }] } as unknown as WorkflowConditionNode;
    assert.ok(validateConditionTree(tree).length > 0);
  });

  it('rejects unknown operator (blocks arbitrary code smuggling via op field)', () => {
    const tree = { field: 'a', op: 'EVAL_JS', value: 'process.exit()' } as unknown as WorkflowConditionNode;
    assert.ok(validateConditionTree(tree).some((e) => e.includes('Unknown condition operator')));
  });

  it('requires NOT group to have exactly one child', () => {
    const tree: WorkflowConditionNode = { type: 'NOT', conditions: [{ field: 'a', op: 'EXISTS' }, { field: 'b', op: 'EXISTS' }] };
    assert.ok(validateConditionTree(tree).some((e) => e.includes('NOT group')));
  });

  it('requires IN/NOT_IN value to be an array', () => {
    const tree: WorkflowConditionNode = { field: 'status', op: 'IN', value: 'PENDING' };
    assert.ok(validateConditionTree(tree).some((e) => e.includes('requires an array value')));
  });

  it('requires BETWEEN value to be a 2-element array', () => {
    const tree: WorkflowConditionNode = { field: 'amount', op: 'BETWEEN', value: [1] };
    assert.ok(validateConditionTree(tree).some((e) => e.includes('BETWEEN')));
  });

  it('requires OLDER_THAN/WITHIN_NEXT to carry a duration object', () => {
    const tree: WorkflowConditionNode = { field: 'dueAt', op: 'OLDER_THAN', value: 3 };
    assert.ok(validateConditionTree(tree).some((e) => e.includes('OLDER_THAN')));
  });

  it('rejects trees nested past the depth limit', () => {
    let tree: WorkflowConditionNode = { field: 'a', op: 'EXISTS' };
    for (let i = 0; i < 10; i++) tree = { type: 'ALL', conditions: [tree] };
    assert.ok(validateConditionTree(tree).some((e) => e.includes('nesting depth')));
  });
});

describe('evaluateCondition', () => {
  it('ALL matches only when every child matches', () => {
    const tree: WorkflowConditionNode = { type: 'ALL', conditions: [{ field: 'a', op: 'EQ', value: 1 }, { field: 'b', op: 'EQ', value: 2 }] };
    assert.equal(evaluateCondition(tree, { a: 1, b: 2 }, NOW).matched, true);
    assert.equal(evaluateCondition(tree, { a: 1, b: 3 }, NOW).matched, false);
  });

  it('ANY matches when at least one child matches', () => {
    const tree: WorkflowConditionNode = { type: 'ANY', conditions: [{ field: 'a', op: 'EQ', value: 1 }, { field: 'b', op: 'EQ', value: 2 }] };
    assert.equal(evaluateCondition(tree, { a: 9, b: 2 }, NOW).matched, true);
    assert.equal(evaluateCondition(tree, { a: 9, b: 9 }, NOW).matched, false);
  });

  it('NOT negates its single child', () => {
    const tree: WorkflowConditionNode = { type: 'NOT', conditions: [{ field: 'a', op: 'EQ', value: 1 }] };
    assert.equal(evaluateCondition(tree, { a: 1 }, NOW).matched, false);
    assert.equal(evaluateCondition(tree, { a: 2 }, NOW).matched, true);
  });

  it('EXISTS/MISSING handle absent and null fields', () => {
    assert.equal(evaluateCondition({ field: 'x', op: 'EXISTS' }, {}, NOW).matched, false);
    assert.equal(evaluateCondition({ field: 'x', op: 'MISSING' }, {}, NOW).matched, true);
    assert.equal(evaluateCondition({ field: 'x', op: 'EXISTS' }, { x: null }, NOW).matched, false);
    assert.equal(evaluateCondition({ field: 'x', op: 'EXISTS' }, { x: 0 }, NOW).matched, true);
  });

  it('supports dot-path field lookup', () => {
    const tree: WorkflowConditionNode = { field: 'customer.name', op: 'EQ', value: 'Acme' };
    assert.equal(evaluateCondition(tree, { customer: { name: 'Acme' } }, NOW).matched, true);
  });

  it('numeric comparisons (GT/GTE/LT/LTE)', () => {
    assert.equal(evaluateCondition({ field: 'n', op: 'GT', value: 10 }, { n: 11 }, NOW).matched, true);
    assert.equal(evaluateCondition({ field: 'n', op: 'GTE', value: 10 }, { n: 10 }, NOW).matched, true);
    assert.equal(evaluateCondition({ field: 'n', op: 'LT', value: 10 }, { n: 9 }, NOW).matched, true);
    assert.equal(evaluateCondition({ field: 'n', op: 'LTE', value: 10 }, { n: 10 }, NOW).matched, true);
  });

  it('IN / NOT_IN', () => {
    assert.equal(evaluateCondition({ field: 'status', op: 'IN', value: ['A', 'B'] }, { status: 'A' }, NOW).matched, true);
    assert.equal(evaluateCondition({ field: 'status', op: 'NOT_IN', value: ['A', 'B'] }, { status: 'C' }, NOW).matched, true);
  });

  it('CONTAINS on array and string', () => {
    assert.equal(evaluateCondition({ field: 'tags', op: 'CONTAINS', value: 'urgent' }, { tags: ['urgent', 'vip'] }, NOW).matched, true);
    assert.equal(evaluateCondition({ field: 'title', op: 'CONTAINS', value: 'overdue' }, { title: 'Invoice overdue' }, NOW).matched, true);
  });

  it('STARTS_WITH', () => {
    assert.equal(evaluateCondition({ field: 'code', op: 'STARTS_WITH', value: 'INV-' }, { code: 'INV-2026' }, NOW).matched, true);
  });

  it('BETWEEN is inclusive', () => {
    assert.equal(evaluateCondition({ field: 'amount', op: 'BETWEEN', value: [10, 20] }, { amount: 20 }, NOW).matched, true);
    assert.equal(evaluateCondition({ field: 'amount', op: 'BETWEEN', value: [10, 20] }, { amount: 21 }, NOW).matched, false);
  });

  it('OLDER_THAN compares age against now', () => {
    const dueAt = new Date(NOW.getTime() - 4 * 3_600_000).toISOString(); // 4 hours old
    assert.equal(evaluateCondition({ field: 'dueAt', op: 'OLDER_THAN', value: { amount: 3, unit: 'hours' } }, { dueAt }, NOW).matched, true);
    assert.equal(evaluateCondition({ field: 'dueAt', op: 'OLDER_THAN', value: { amount: 5, unit: 'hours' } }, { dueAt }, NOW).matched, false);
  });

  it('WITHIN_NEXT compares a future date against a forward window', () => {
    const dueAt = new Date(NOW.getTime() + 2 * 86_400_000).toISOString(); // due in 2 days
    assert.equal(evaluateCondition({ field: 'dueAt', op: 'WITHIN_NEXT', value: { amount: 3, unit: 'days' } }, { dueAt }, NOW).matched, true);
    assert.equal(evaluateCondition({ field: 'dueAt', op: 'WITHIN_NEXT', value: { amount: 1, unit: 'days' } }, { dueAt }, NOW).matched, false);
  });

  it('is deterministic and side-effect free: same input always yields same output', () => {
    const tree: WorkflowConditionNode = { type: 'ALL', conditions: [{ field: 'a', op: 'GT', value: 1 }] };
    const payload = { a: 5 };
    const r1 = evaluateCondition(tree, payload, NOW);
    const r2 = evaluateCondition(tree, payload, NOW);
    assert.deepEqual(r1, r2);
  });

  it('missing field surfaces as not-matched, not a thrown error', () => {
    assert.doesNotThrow(() => evaluateCondition({ field: 'missing.deep.path', op: 'GT', value: 1 }, {}, NOW));
    assert.equal(evaluateCondition({ field: 'missing.deep.path', op: 'GT', value: 1 }, {}, NOW).matched, false);
  });
});
