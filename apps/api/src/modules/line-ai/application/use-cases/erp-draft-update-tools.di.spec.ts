/**
 * The five draft tools must be CONSTRUCTIBLE BY NEST, which is a different claim from "the class
 * works when a spec hands it two fakes".
 *
 * `emitDecoratorMetadata` — swc's `decoratorMetadata` and TypeScript's alike — writes
 * `design:paramtypes` only for the class that DECLARES a constructor. An `@Injectable()` subclass
 * that merely inherits one emits no metadata at all, so Nest resolves zero dependencies, builds it
 * with no arguments, and the first `expense.draft.*` call dies on an undefined `draftUpdate`. That
 * failure exists only in the built image: every spec in this repo constructs these classes by hand
 * and would stay green through it.
 *
 * The runnable invariant is constructor ARITY. A subclass with no constructor of its own reports
 * `length === 0` (its implicit `constructor(...args)` declares no parameters); one that declares
 * `constructor(a, b)` reports 2. `Reflect.getMetadata('design:paramtypes', …)` would be the more
 * direct assertion, but the repo's test runner is tsx/esbuild, which does not implement
 * `emitDecoratorMetadata` at all — it reports ABSENT for every class here, including ones that are
 * perfectly wired, so it can only produce a false alarm. Arity is compiler-independent and fails
 * for exactly the mistake this guards.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LINE_DRAFT_UPDATE_TOOLS } from '@watchdog-bms/contracts';
import {
  ExpenseDraftSetHeaderTool,
  ExpenseDraftSetLineTool,
  ExpenseDraftAddChargeTool,
  ExpenseDraftRemoveLineTool,
  ExpenseDraftSetVatModeTool,
} from './erp-draft-update-tools.use-case';

/** Every dependency the base class takes: the draft use case and the expense repository. */
const EXPECTED_DEPENDENCY_COUNT = 2;

const TOOLS = [
  ExpenseDraftSetHeaderTool,
  ExpenseDraftSetLineTool,
  ExpenseDraftAddChargeTool,
  ExpenseDraftRemoveLineTool,
  ExpenseDraftSetVatModeTool,
] as const;

describe('draft update tools — Nest constructibility', () => {
  it('every concrete tool DECLARES its own constructor, so DI metadata is emitted for it', () => {
    for (const tool of TOOLS) {
      assert.equal(
        tool.length,
        EXPECTED_DEPENDENCY_COUNT,
        `${tool.name} must declare constructor(draftUpdate, repo) itself — an inherited constructor `
        + 'emits no design:paramtypes, and Nest would build it with no dependencies',
      );
    }
  });

  it('covers all five registered draft tools, so a sixth cannot be added untested', () => {
    const names = TOOLS.map((tool) => new (tool as never as new (a: unknown, b: unknown) => { toolName: string })(null, null).toolName);
    assert.deepEqual([...names].sort(), [...LINE_DRAFT_UPDATE_TOOLS].sort());
  });

  it('wires the dependencies it was given, in the base class\'s order', () => {
    const draftUpdate = { enabled: true } as never;
    const repo = { listRecentLineCaptures: async () => [] } as never;
    for (const tool of TOOLS) {
      const instance = new (tool as never as new (a: unknown, b: unknown) => Record<string, unknown>)(draftUpdate, repo);
      assert.equal(instance['draftUpdate'], draftUpdate, `${tool.name} must pass draftUpdate through super()`);
      assert.equal(instance['repo'], repo, `${tool.name} must pass repo through super()`);
    }
  });
});
