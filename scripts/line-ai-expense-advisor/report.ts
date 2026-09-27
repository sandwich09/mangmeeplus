/**
 * Renders run-real.ts's markdown report. Pure function of already-computed data (scores, the
 * corpus, and the runtime's captured `turnEvidence`) — no network, no DB, no model — so it is
 * unit-testable the same way scorer.ts is, split out of run-real.ts specifically so a spec file can
 * import it without also running that script's module-level side effects (env defaults, reading
 * production-ai-env.json).
 */
import type { RuntimeTurnEvidence } from '../line-ai-reliability-runtime';
import type { Corpus } from './types';
import type { TurnScore, summarizeScores } from './scorer';
import { renderUserText } from './template';

const REPORT_REPLY_MAX_CHARS = 600;

/** Every text a delivered LINE message could carry a fact in: a plain text bubble's `text`, and a
 * Flex message's `altText` plus any `text` node inside its `contents` tree. Duplicated from
 * run-real.ts's own `extractDeliveredText` (kept private there) — small enough, and about
 * *rendering* evidence rather than *scoring* it, that a shared import would be the wrong coupling. */
function extractDeliveredText(messages: unknown): string {
  const parts: string[] = [];
  const visit = (value: unknown, depth: number): void => {
    if (!value || typeof value !== 'object' || depth > 12) return;
    if (Array.isArray(value)) { for (const item of value) visit(item, depth + 1); return; }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if ((key === 'text' || key === 'altText') && typeof child === 'string') parts.push(child);
      else visit(child, depth + 1);
    }
  };
  visit(messages, 0);
  return parts.join('\n');
}

function findTurnEvidence(turnEvidence: RuntimeTurnEvidence[], conversationId: string, turnIndex: number): RuntimeTurnEvidence | undefined {
  return turnEvidence.find((row) => row.scenarioId === conversationId && row.turnIndex === turnIndex);
}

/** The assistant's delivered reply for one turn — every sink receipt's Flex altText/text,
 * truncated to keep a multi-turn transcript section readable. Never throws on missing evidence
 * (a crashed turn has none): says so instead, rather than leaving a blank line a reader could
 * mistake for an empty reply. */
export function deliveredReplyForReport(evidence: RuntimeTurnEvidence | undefined, maxChars = REPORT_REPLY_MAX_CHARS): string {
  if (!evidence) return '_(no evidence captured for this turn)_';
  const text = evidence.receipts.map((receipt) => extractDeliveredText(receipt.messages)).join('\n').trim();
  if (!text) return '_(no reply delivered)_';
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

/** `{status, reasonCode}` per semantic subrequest the Gateway reported for this turn — read off
 * whichever `gatewayResponses[].response.semanticCoverage` array is present (the shape
 * `requestLineTurn` returns; other Gateway methods carry none, which is not an error). */
export function gatewayCoverageForReport(evidence: RuntimeTurnEvidence | undefined): Array<{ status: string; reasonCode?: string }> {
  if (!evidence) return [];
  return evidence.gatewayResponses.flatMap((call) => {
    const response = call.response as { semanticCoverage?: Array<{ status: string; reasonCode?: string }> } | undefined;
    return response?.semanticCoverage ?? [];
  });
}

export function renderReport(input: {
  sourceCommit: string;
  now: Date;
  summary: ReturnType<typeof summarizeScores>;
  scores: TurnScore[];
  corpus: Corpus;
  turnEvidence: RuntimeTurnEvidence[];
  /** Task item "re-run a subset": present only when MANGMEE_EVAL_ONLY selected fewer than the
   * corpus's full conversation list — the report must say so, never look like a full run. */
  subset?: { onlyIds: string[]; description: string };
  /** run-rescore.ts (task item "offline rescore"): present when this report re-scores a PREVIOUS
   * run's saved turnEvidence against the current scorer/corpus, rather than a fresh model run —
   * the report must say so just as plainly as a subset run. */
  rescoredFrom?: { evidencePath: string; sourceCommit: string; startedAt: string };
}): string {
  const { sourceCommit, now, summary, scores, corpus, turnEvidence, subset, rescoredFrom } = input;
  const subsetBanner = subset
    ? `> **Subset run — not the full corpus.** ${corpus.conversations.length} conversation(s) selected from ${subset.description}: ${subset.onlyIds.join(', ')}\n\n`
    : '';
  const rescoredBanner = rescoredFrom
    ? `> **Rescored — no model calls made.** Re-scored \`${rescoredFrom.evidencePath}\` (originally run at `
      + `${rescoredFrom.startedAt} from commit \`${rescoredFrom.sourceCommit}\`) against the CURRENT scorer/corpus `
      + `(commit \`${sourceCommit}\`).\n\n`
    : '';
  const byCategoryRows = Object.entries(summary.byCategory).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([category, row]) => `| ${category} | ${row.passed}/${row.total} |`).join('\n');
  const failureSections = summary.failures.map((failure) => {
    const conversation = corpus.conversations.find((row) => row.id === failure.conversationId)!;
    const turn = conversation.turns[failure.turnIndex]!;
    const transcript = conversation.turns.slice(0, failure.turnIndex + 1).map((row, index) => {
      const reply = deliveredReplyForReport(findTurnEvidence(turnEvidence, failure.conversationId, index));
      return `${index}. **user:** ${renderUserText(row.user, now)}\n   **assistant:** ${reply}`;
    }).join('\n');
    const failingEvidence = findTurnEvidence(turnEvidence, failure.conversationId, failure.turnIndex);
    const toolsCalled = (failingEvidence?.toolResults ?? [])
      .map((call) => `\`${call.tool}\`: ${JSON.stringify(call.input)}`).join('; ') || '_none_';
    const coverage = gatewayCoverageForReport(failingEvidence);
    const coverageText = coverage.length
      ? coverage.map((item) => item.reasonCode ? `${item.status} (${item.reasonCode})` : item.status).join(', ')
      : '_none reported_';
    return `### ${failure.conversationId} turn ${failure.turnIndex} (category ${failure.category})\n\n`
      + `Transcript so far:\n\n${transcript}\n\n`
      + `Tools called (this turn): ${toolsCalled}\n\n`
      + `Gateway coverage (this turn): ${coverageText}\n\n`
      + `Gold: \`${JSON.stringify(turn.expect)}\`\n\nReasons: ${failure.reasons.join(', ')}\n`;
  }).join('\n');
  return `# LINE AI expense-advisor eval report\n\n`
    + `- Source commit: \`${sourceCommit}\`\n- Run started: ${now.toISOString()}\n- Corpus: ${corpus.conversations.length} conversations, ${scores.length} turns\n\n`
    + subsetBanner
    + rescoredBanner
    + `## Summary\n\n| | |\n|---|---|\n| Passed | ${summary.passed} |\n| Failed | ${summary.failed} |\n| Pass rate | ${(summary.passRate * 100).toFixed(1)}% |\n\n`
    + `## By category (spec §3 row)\n\n| Category | Passed/Total |\n|---|---|\n${byCategoryRows}\n\n`
    + `## Failures\n\n${failureSections || '_none_'}\n`;
}
