import { it } from 'node:test';
import assert from 'node:assert/strict';
import { SourceStateService } from './source-state.service';
import { ListSuggestionsUseCase, GetSuggestionDetailUseCase } from './use-cases/ai-suggestion-query.use-case';
const ctx: any = { companyId: 'co1', userId: 'u1', permissions: ['ai.suggestion.read', 'bank.cash.read'], scopes: { branchIds: ['b1'] } };
it('blocks retained content from a wider or unknown branch scope, including list previews', async () => {
  const source = new SourceStateService({ execute: async () => ({ projection: 'OPERATIONAL' }) } as any);
  for (const sourceBranchIds of [undefined, null, ['b2'], ['b1', 'b2']]) assert.equal(await source.canRead(ctx, { sourceBranchIds } as any), false);
  assert.equal(await source.canRead(ctx, { sourceBranchIds: ['b1'] } as any), true);
  const suggestion: any = { id: 's1', templateKey: 'cfo_cash_risk_summary', reviewOwnerUserId: 'u1', sourceBranchIds: ['b2'], summary: 'hidden' };
  const repo: any = { listSuggestions: async () => [suggestion], findSuggestionById: async () => ({ suggestion }) };
  assert.equal((await new ListSuggestionsUseCase(repo, source).execute(ctx, {})).total, 0);
  await assert.rejects(() => new GetSuggestionDetailUseCase(repo, source).execute(ctx, 's1'), /Source is no longer readable/);
});
it('rechecks source record access after its branch or customer permissions change', async () => {
  const source = new SourceStateService({ execute: async () => { throw new Error('forbidden'); } } as any);
  const suggestion: any = { sourceModule: 'crm', sourceRecordType: 'customer', sourceRecordId: 'c1', sourceStateHash: 'old', sourceBranchIds: ['b1'] };
  assert.equal(await source.canRead(ctx, suggestion), false);
  await assert.rejects(() => source.isChanged(ctx, suggestion), /Source is no longer readable/);
});
