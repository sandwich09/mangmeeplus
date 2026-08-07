import type { WorkflowConditionEvalResult, WorkflowConditionGroup, WorkflowConditionLeaf, WorkflowConditionNode } from '@watchdog-bms/contracts';
import { WORKFLOW_CONDITION_GROUP_TYPES, WORKFLOW_CONDITION_OPERATORS } from '../workflow.constants';

// Deterministic, side-effect-free condition validation and evaluation.
// No eval/Function/SQL — only fixed group types and a fixed operator allow-list.

function isGroup(node: WorkflowConditionNode): node is WorkflowConditionGroup {
  return typeof node === 'object' && node !== null && 'type' in node && 'conditions' in node;
}

function isLeaf(node: WorkflowConditionNode): node is WorkflowConditionLeaf {
  return typeof node === 'object' && node !== null && 'field' in node && 'op' in node;
}

const DURATION_UNIT_MS: Record<string, number> = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 };

function durationMs(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as { amount?: unknown; unit?: unknown };
  if (typeof v.amount !== 'number' || typeof v.unit !== 'string' || !(v.unit in DURATION_UNIT_MS)) return null;
  return v.amount * DURATION_UNIT_MS[v.unit];
}

export function validateConditionTree(node: WorkflowConditionNode, depth = 0): string[] {
  const errors: string[] = [];
  if (depth > 8) return ['Condition tree exceeds maximum nesting depth (8)'];
  if (node == null || typeof node !== 'object') return ['Condition node must be an object'];

  if (isGroup(node)) {
    if (!WORKFLOW_CONDITION_GROUP_TYPES.includes(node.type)) {
      errors.push(`Unknown condition group type: ${String(node.type)}`);
    }
    if (!Array.isArray(node.conditions) || node.conditions.length === 0) {
      errors.push('Condition group must have at least one child condition');
    } else {
      if (node.type === 'NOT' && node.conditions.length !== 1) {
        errors.push('NOT group must have exactly one child condition');
      }
      for (const child of node.conditions) {
        errors.push(...validateConditionTree(child, depth + 1));
      }
    }
    return errors;
  }

  if (isLeaf(node)) {
    if (!node.field || typeof node.field !== 'string') errors.push('Condition leaf must have a non-empty string field');
    if (!WORKFLOW_CONDITION_OPERATORS.includes(node.op)) errors.push(`Unknown condition operator: ${String(node.op)}`);
    if (node.op === 'IN' || node.op === 'NOT_IN') {
      if (!Array.isArray(node.value)) errors.push(`Operator ${node.op} requires an array value`);
    }
    if (node.op === 'BETWEEN') {
      if (!Array.isArray(node.value) || node.value.length !== 2) errors.push('Operator BETWEEN requires a 2-element [min, max] array value');
    }
    if (node.op === 'OLDER_THAN' || node.op === 'WITHIN_NEXT') {
      if (durationMs(node.value) == null) errors.push(`Operator ${node.op} requires a { amount, unit } duration value`);
    }
    return errors;
  }

  return ['Condition node must be a group ({type, conditions}) or a leaf ({field, op, value})'];
}

function getPath(payload: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc == null || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[key];
  }, payload);
}

function toComparable(value: unknown): number | string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' || typeof value === 'boolean') return value as number;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? value : parsed;
  }
  return null;
}

function evalLeaf(leaf: WorkflowConditionLeaf, payload: Record<string, unknown>, now: Date): { matched: boolean; error?: string } {
  const fieldValue = getPath(payload, leaf.field);
  const exists = fieldValue !== undefined && fieldValue !== null;

  switch (leaf.op) {
    case 'EXISTS':
      return { matched: exists };
    case 'MISSING':
      return { matched: !exists };
    case 'EQ':
      return { matched: exists && toComparable(fieldValue) === toComparable(leaf.value) };
    case 'NEQ':
      return { matched: !exists || toComparable(fieldValue) !== toComparable(leaf.value) };
    case 'GT':
    case 'GTE':
    case 'LT':
    case 'LTE': {
      if (!exists) return { matched: false };
      const a = toComparable(fieldValue);
      const b = toComparable(leaf.value);
      if (typeof a !== 'number' || typeof b !== 'number') return { matched: false, error: `Cannot compare non-numeric/date field ${leaf.field}` };
      if (leaf.op === 'GT') return { matched: a > b };
      if (leaf.op === 'GTE') return { matched: a >= b };
      if (leaf.op === 'LT') return { matched: a < b };
      return { matched: a <= b };
    }
    case 'IN':
      return { matched: exists && Array.isArray(leaf.value) && leaf.value.some((v) => toComparable(v) === toComparable(fieldValue)) };
    case 'NOT_IN':
      return { matched: !exists || !Array.isArray(leaf.value) || !leaf.value.some((v) => toComparable(v) === toComparable(fieldValue)) };
    case 'CONTAINS':
      if (!exists) return { matched: false };
      if (Array.isArray(fieldValue)) return { matched: fieldValue.some((v) => toComparable(v) === toComparable(leaf.value)) };
      if (typeof fieldValue === 'string') return { matched: fieldValue.includes(String(leaf.value)) };
      return { matched: false };
    case 'STARTS_WITH':
      return { matched: exists && typeof fieldValue === 'string' && fieldValue.startsWith(String(leaf.value)) };
    case 'BETWEEN': {
      if (!exists || !Array.isArray(leaf.value) || leaf.value.length !== 2) return { matched: false };
      const a = toComparable(fieldValue);
      const [lo, hi] = leaf.value.map(toComparable);
      if (typeof a !== 'number' || typeof lo !== 'number' || typeof hi !== 'number') return { matched: false };
      return { matched: a >= lo && a <= hi };
    }
    case 'OLDER_THAN': {
      if (!exists) return { matched: false };
      const ms = durationMs(leaf.value);
      const a = toComparable(fieldValue);
      if (ms == null || typeof a !== 'number') return { matched: false, error: `Invalid OLDER_THAN duration for field ${leaf.field}` };
      return { matched: now.getTime() - a >= ms };
    }
    case 'WITHIN_NEXT': {
      if (!exists) return { matched: false };
      const ms = durationMs(leaf.value);
      const a = toComparable(fieldValue);
      if (ms == null || typeof a !== 'number') return { matched: false, error: `Invalid WITHIN_NEXT duration for field ${leaf.field}` };
      return { matched: a <= now.getTime() + ms };
    }
    default:
      return { matched: false, error: `Unsupported operator: ${String(leaf.op)}` };
  }
}

function evalNode(node: WorkflowConditionNode, payload: Record<string, unknown>, now: Date, errors: string[]): boolean {
  if (isGroup(node)) {
    const results = node.conditions.map((child) => evalNode(child, payload, now, errors));
    if (node.type === 'ALL') return results.every(Boolean);
    if (node.type === 'ANY') return results.some(Boolean);
    if (node.type === 'NOT') return !results[0];
    return false;
  }
  if (isLeaf(node)) {
    const { matched, error } = evalLeaf(node, payload, now);
    if (error) errors.push(error);
    return matched;
  }
  errors.push('Invalid condition node shape');
  return false;
}

// Pure and deterministic given (node, payload, now) — no Date.now(), no I/O.
export function evaluateCondition(node: WorkflowConditionNode, payload: Record<string, unknown>, now: Date): WorkflowConditionEvalResult {
  const errors: string[] = [];
  const matched = evalNode(node, payload, now, errors);
  return { matched, errors: errors.length > 0 ? errors : undefined };
}
