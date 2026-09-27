/**
 * Runs every gold call in a corpus through the SAME real, in-process oracle preflight uses (the
 * compiled API as a Nest application context, no HTTP, no gateway, no model), against a freshly
 * truncated-and-reseeded copy of the eval database. Shared by run-real.ts (run once, before its
 * live replay) and run-rescore.ts (the whole job: re-score saved evidence against this same pass,
 * with no model calls and no gateway).
 *
 * This is the source of truth for what "never hand-type expected numbers" requires:
 *  - `factsByTurn`: the facts a delivered reply must contain, extracted from the GOLD call's own
 *    result, never the model's possibly-wrong one;
 *  - `resultsByTurn`: the gold call's own resolved category/vendor/branch, for the "judge by what
 *    the API resolved" scorer rule (scorer.ts `resolvedOutcome`);
 *  - `resolvedCallsByTurn`: each gold call with its `$period`/`$fromShownItems` markers resolved to
 *    the concrete values the oracle actually ran — what the scorer must compare the model's actual
 *    call against. Comparing the model's resolved `expenseId` string against gold's UNRESOLVED
 *    `{ $fromShownItems: 2 }` marker object always fails (`String()` on an object is
 *    `"[object Object]"`), which is exactly the T-068 bug this fixes: the model called
 *    `expense.get_detail` with the correct id and the score still said `missing_or_wrong_call`.
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { buildCompanySeed, applySeedRows, truncateAllTables, SHARED_ACCESS_ROWS, type CompanySeed, type PgClientLike } from './seed';
import { bootOracle, resolveGoldCallInput, extractShownItems, extractExpectedFactsForCall, type ShownItem } from './oracle';
import type { ExpectedFact, ToolResultLike } from './scorer';
import type { Corpus, EvalCompany, GoldCall } from './types';

export const turnKey = (conversationId: string, turnIndex: number): string => `${conversationId}#${turnIndex}`;

export type GoldOraclePass = {
  resultsByTurn: Map<string, Array<ToolResultLike | undefined>>;
  factsByTurn: Map<string, ExpectedFact[]>;
  resolvedCallsByTurn: Map<string, GoldCall[]>;
};

export async function collectGoldResults(
  repoRoot: string, corpus: Corpus, companies: Record<EvalCompany, CompanySeed>,
  databaseUrl: string, redisUrl: string, secretsPath: string, now: Date,
): Promise<GoldOraclePass> {
  const apiRoot = resolve(repoRoot, 'apps/api');
  const requireApi = createRequire(resolve(apiRoot, 'package.json'));
  const { Client } = requireApi('pg') as { Client: new (opts: { connectionString: string }) => PgClientLike & { connect(): Promise<void>; end(): Promise<void> } };
  const pg = new Client({ connectionString: databaseUrl });
  await pg.connect();
  try { await truncateAllTables(pg); } finally { await pg.end(); }

  const oracle = await bootOracle({ repoRoot, databaseUrl, redisUrl, secretsPath });
  const resultsByTurn = new Map<string, Array<ToolResultLike | undefined>>();
  const factsByTurn = new Map<string, ExpectedFact[]>();
  const resolvedCallsByTurn = new Map<string, GoldCall[]>();
  try {
    await applySeedRows(oracle.prisma as never, SHARED_ACCESS_ROWS);
    for (const company of Object.values(companies)) await applySeedRows(oracle.prisma as never, company.rows.slice(SHARED_ACCESS_ROWS.length));

    for (const conversation of corpus.conversations) {
      const company = companies[conversation.company];
      const actor = company.users[conversation.role];
      const ctx = await oracle.resolveActorContext({ userId: actor.userId, companyId: company.companyId });
      let priorShownItems: ShownItem[] = [];
      for (const [turnIndex, turn] of conversation.turns.entries()) {
        if (!turn.expect.calls?.length) continue;
        const results: Array<ToolResultLike | undefined> = [];
        const facts: ExpectedFact[] = [];
        const resolvedCalls: GoldCall[] = [];
        for (const call of turn.expect.calls) {
          const resolvedInput = resolveGoldCallInput(call, now, priorShownItems);
          const result = await oracle.invoke(call.tool, ctx, resolvedInput) as ToolResultLike;
          results.push(result);
          facts.push(...extractExpectedFactsForCall(call.tool, result, call, turn.expect.requiredFacts));
          resolvedCalls.push({ ...call, input: resolvedInput });
          const shown = extractShownItems(call.tool, result);
          if (shown.length) priorShownItems = shown;
        }
        resultsByTurn.set(turnKey(conversation.id, turnIndex), results);
        factsByTurn.set(turnKey(conversation.id, turnIndex), facts);
        resolvedCallsByTurn.set(turnKey(conversation.id, turnIndex), resolvedCalls);
      }
    }
  } finally {
    await oracle.close();
  }
  return { resultsByTurn, factsByTurn, resolvedCallsByTurn };
}
