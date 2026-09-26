// Audit evidence only. Run from repo root with pnpm exec tsx <this file>.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { AI_BUDGET_STEP_BOUNDS, aiBudgetInvocationKey, parseAiBudgetEnvelope } from '../../../packages/contracts/src/ai-budget-bounds';
import { providerInputTokenUpperBound } from '../../../apps/ai-gateway/src/common/usage/ai-budget-provider';

const baseline = 'f932b57766f5dd22c0d28aedd4bc06f210e374ef';
const sources = ['packages/contracts/src/ai-budget-bounds.ts', 'apps/ai-gateway/src/common/usage/ai-budget-provider.ts'];
assert.equal(execFileSync('git', ['diff', '--name-only', baseline, '--', ...sources], { encoding: 'utf8' }).trim(), '', 'Re-audit source changes before reusing baseline evidence');
const company = 'synthetic-audit-company';
const step = 'line-intake-text';
const bounds = AI_BUDGET_STEP_BOUNDS[step];
const env = { attemptKey: 'synthetic-audit-attempt', stepKind: step, invocationKey: aiBudgetInvocationKey(company, 'synthetic-audit-attempt', step, 0), bucket: 'CHAT', monthKey: '2026-09', modelId: 'synthetic-model', bounds, maxCalls: bounds.maxCalls };
assert.ok(parseAiBudgetEnvelope(env, company));
assert.equal(parseAiBudgetEnvelope({ ...env, invocationKey: aiBudgetInvocationKey(company, env.attemptKey, step, 1) }, company, 1), undefined);
assert.equal(parseAiBudgetEnvelope({ ...env, bounds: { ...bounds, maxCalls: 2 }, maxCalls: 2 }, company), undefined);
assert.equal(parseAiBudgetEnvelope({ ...env, stepKind: 'public-lookup' }, company), undefined);
const estimate = providerInputTokenUpperBound({ systemPrompt: 'x'.repeat(4000), messages: [{ role: 'user', text: 'ก'.repeat(5461) }], maxTokens: 100 });
assert.equal(estimate, 20383);
assert.ok(estimate > bounds.maxInputTokens);
console.log(JSON.stringify({ baseline, passed: 5, contextEstimate: estimate, intakeBound: bounds.maxInputTokens, network: false }));
