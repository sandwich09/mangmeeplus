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
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { buildCompanySeed, applySeedRows, truncateAllTables, SHARED_ACCESS_ROWS, type CompanySeed, type PgClientLike } from './seed';
import { bootOracle, resolveGoldCallInput, extractShownItems, extractExpectedFactsForCall, extractOfferedChoices } from './oracle';
import type { ShownItem } from './oracle';
import { scoreTurn, factsForMatchedCandidate, type CapturedEvidence, type ExpectedFact, type ToolResultLike, type TurnScore } from './scorer';
import type { Conversation, Corpus, EvalCompany, GoldCall, Turn } from './types';
import { assertIsolatedReplayDatabase, type RuntimeTurnEvidence } from '../line-ai-reliability-runtime';

export const turnKey = (conversationId: string, turnIndex: number): string => `${conversationId}#${turnIndex}`;

/** Every text a delivered LINE message could carry a fact in: a plain text bubble's `text`, and a
 * Flex message's `altText` plus any `text` node inside its `contents` tree — INCLUDING a quick
 * reply's own item text/label, since those are LINE message JSON too (`excludeQuickReplies` below
 * is the variant that skips them, for the one check that must). */
function extractDeliveredText(messages: unknown, excludeQuickReplies = false): string {
  const parts: string[] = [];
  const visit = (value: unknown, depth: number): void => {
    if (!value || typeof value !== 'object' || depth > 12) return;
    if (Array.isArray(value)) { for (const item of value) visit(item, depth + 1); return; }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (excludeQuickReplies && key === 'quickReply') continue;
      if ((key === 'text' || key === 'altText') && typeof child === 'string') parts.push(child);
      else visit(child, depth + 1);
    }
  };
  visit(messages, 0);
  return parts.join('\n');
}

/** Shared by run-real.ts (evidence just captured from a live replay) and run-rescore.ts (the SAME
 * shape read back from a saved `*.evidence.json`) — scoring must treat both identically. */
export function toCapturedEvidence(evidence: RuntimeTurnEvidence): CapturedEvidence {
  // `result` rides along on each captured call — the "one more scorer rule" category/vendor/branch
  // name-resolution equivalence check (scorer.ts resolvedOutcome) reads it directly off here.
  const toolCalls = evidence.toolResults.map((call) => ({ tool: call.tool, input: call.input as Record<string, unknown>, result: call.result as ToolResultLike | undefined }));
  const deliveredText = evidence.receipts.map((receipt) => extractDeliveredText(receipt.messages)).join('\n');
  // D3: the machine-token quality check must judge the message body a customer reads, never a
  // quick-reply button's own text/label.
  const deliveredTextExcludingQuickReplies = evidence.receipts.map((receipt) => extractDeliveredText(receipt.messages, true)).join('\n');
  const lastReceiptAt = evidence.receipts.length ? Math.max(...evidence.receipts.map((receipt) => receipt.at)) : null;
  const usage = evidence.providerUsage as Array<{ costSatang: number | null; usageBasis: string }>;
  const costSatang = usage.length && usage.every((row) => row.usageBasis === 'PROVIDER_REPORTED')
    ? usage.reduce((sum, row) => sum + (row.costSatang ?? 0), 0) : null;
  const offeredChoices = toolCalls.flatMap((call) => (call.result ? extractOfferedChoices(call.result) ?? [] : []));
  return {
    toolCalls, deliveredText, deliveredTextExcludingQuickReplies,
    latencyMs: lastReceiptAt !== null ? lastReceiptAt - evidence.acceptedAtMs : null,
    modelCalls: usage.length, costSatang,
    offeredChoices,
  };
}

/** Scores every flattened turn against a captured `turnEvidence` list and a `GoldOraclePass` —
 * the exact loop run-real.ts's live replay and run-rescore.ts's offline pass both need, so a
 * scoring-behavior change (e.g. T-068's resolved-input fix) cannot land in one and not the other. */
export function scoreAllTurns(
  flat: ReadonlyArray<{ conversation: Conversation; turnIndex: number; turn: Turn }>,
  turnEvidenceList: readonly RuntimeTurnEvidence[],
  goldPass: GoldOraclePass,
  now: Date,
): TurnScore[] {
  return flat.map(({ conversation, turnIndex, turn }) => {
    const evidence = turnEvidenceList.find((row) => row.scenarioId === conversation.id && row.turnIndex === turnIndex);
    if (!evidence) throw new Error(`no captured evidence for ${conversation.id}#${turnIndex}`);
    const captured = toCapturedEvidence(evidence);
    const key = turnKey(conversation.id, turnIndex);
    // All come from collectGoldResults' independent oracle pass — never from the model's own
    // (possibly wrong) captured result, per "never hand-type expected numbers, always the oracle".
    const goldResults = goldPass.resultsByTurn.get(key) ?? [];
    // Task item 4 ("ambiguous golds"): when the turn's (one, per today's corpus) ambiguous call has
    // `alternatives`, check facts against whichever candidate the model actually called, never
    // always the primary's — see factsForMatchedCandidate's own doc comment.
    const ambiguous = goldPass.alternativeFactsByTurn.get(key);
    const expectedFacts = ambiguous
      ? factsForMatchedCandidate(turn.expect.calls![ambiguous.callIndex]!, ambiguous.candidates, captured.toolCalls, now)
      : goldPass.factsByTurn.get(key) ?? [];
    // T-068: score against the RESOLVED input the oracle actually ran, never turn.expect.calls'
    // raw corpus literal (e.g. an unresolved `{ $fromShownItems: 2 }`) — see this file's header.
    const resolvedCalls = goldPass.resolvedCallsByTurn.get(key);
    const turnForScoring: Turn = resolvedCalls ? { ...turn, expect: { ...turn.expect, calls: resolvedCalls } } : turn;
    return scoreTurn({ conversationId: conversation.id, turnIndex }, turnForScoring, captured, expectedFacts, now, goldResults);
  });
}

export type GoldOraclePass = {
  resultsByTurn: Map<string, Array<ToolResultLike | undefined>>;
  factsByTurn: Map<string, ExpectedFact[]>;
  resolvedCallsByTurn: Map<string, GoldCall[]>;
  /** Task item 4 ("ambiguous golds"): only set for a turn whose gold call at `callIndex` declares
   * `alternatives` — `candidates[0]` is that call's own (primary) facts, `candidates[i]` (i>0) the
   * i-th alternative's, each a SEPARATE oracle run. Assumes at most one ambiguous call per turn
   * (true of every corpus turn today, and asserted where this is populated) — replaces the WHOLE
   * turn's `factsByTurn` entry at scoring time (scoreAllTurns), not spliced in alongside other
   * calls' facts, so a turn with a second, non-ambiguous call would need this extended first. */
  alternativeFactsByTurn: Map<string, { callIndex: number; candidates: Array<{ tool: string; input: Record<string, unknown>; facts: ExpectedFact[] }> }>;
};

export async function collectGoldResults(
  repoRoot: string, corpus: Corpus, companies: Record<EvalCompany, CompanySeed>,
  databaseUrl: string, redisUrl: string, secretsPath: string, now: Date, beforeTruncate?: () => Promise<void>,
): Promise<GoldOraclePass> {
  assertIsolatedReplayDatabase(databaseUrl);
  const apiRoot = resolve(repoRoot, 'apps/api');
  const requireApi = createRequire(resolve(apiRoot, 'package.json'));
  const { Client } = requireApi('pg') as { Client: new (opts: { connectionString: string }) => PgClientLike & { connect(): Promise<void>; end(): Promise<void> } };
  const pg = new Client({ connectionString: databaseUrl });
  await pg.connect();
  try { await beforeTruncate?.(); await truncateAllTables(pg); } finally { await pg.end(); }

  const oracle = await bootOracle({ repoRoot, databaseUrl, redisUrl, secretsPath });
  const resultsByTurn = new Map<string, Array<ToolResultLike | undefined>>();
  const factsByTurn = new Map<string, ExpectedFact[]>();
  const resolvedCallsByTurn = new Map<string, GoldCall[]>();
  const alternativeFactsByTurn: GoldOraclePass['alternativeFactsByTurn'] = new Map();
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
        let ambiguousCallIndex = -1;
        for (const [callIndex, call] of turn.expect.calls.entries()) {
          const resolvedInput = resolveGoldCallInput(call, now, priorShownItems);
          const result = await oracle.invoke(call.tool, ctx, resolvedInput) as ToolResultLike;
          results.push(result);
          const callFacts = extractExpectedFactsForCall(call.tool, result, call, turn.expect.requiredFacts);
          facts.push(...callFacts);
          resolvedCalls.push({ ...call, input: resolvedInput });
          const shown = extractShownItems(call.tool, result);
          if (shown.length) priorShownItems = shown;

          // Task item 4 ("ambiguous golds"): run each alternative through the SAME oracle/seed
          // state too, so scoring can check facts against whichever one the model actually called
          // (scoreAllTurns/factsForMatchedCandidate) instead of always the primary's. Its own
          // shown-items never feed `priorShownItems` — only the PRIMARY interpretation is real
          // "what happened" for a later turn's `$fromShownItems` to reference.
          if (call.alternatives?.length) {
            assert.equal(ambiguousCallIndex, -1, `${conversation.id}#${turnIndex}: more than one ambiguous (alternatives-bearing) call in one turn is not supported yet`);
            ambiguousCallIndex = callIndex;
            const candidates = [{ tool: call.tool, input: resolvedInput, facts: callFacts }];
            for (const alt of call.alternatives) {
              const altResolvedInput = resolveGoldCallInput(alt, now, priorShownItems);
              const altResult = await oracle.invoke(alt.tool, ctx, altResolvedInput) as ToolResultLike;
              candidates.push({ tool: alt.tool, input: altResolvedInput, facts: extractExpectedFactsForCall(alt.tool, altResult, alt, turn.expect.requiredFacts) });
            }
            alternativeFactsByTurn.set(turnKey(conversation.id, turnIndex), { callIndex, candidates });
          }
        }
        resultsByTurn.set(turnKey(conversation.id, turnIndex), results);
        factsByTurn.set(turnKey(conversation.id, turnIndex), facts);
        resolvedCallsByTurn.set(turnKey(conversation.id, turnIndex), resolvedCalls);
      }
    }
  } finally {
    await oracle.close();
  }
  return { resultsByTurn, factsByTurn, resolvedCallsByTurn, alternativeFactsByTurn };
}
