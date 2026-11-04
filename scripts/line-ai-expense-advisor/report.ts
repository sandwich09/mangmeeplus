/**
 * Renders run-real.ts's markdown report. Pure function of already-computed data (scores, the
 * corpus, and the runtime's captured `turnEvidence`) — no network, no DB, no model — so it is
 * unit-testable the same way scorer.ts is, split out of run-real.ts specifically so a spec file can
 * import it without also running that script's module-level side effects (env defaults, reading
 * production-ai-env.json).
 */
import type { RuntimeTurnEvidence } from '../line-ai-reliability-runtime';
import type { Corpus } from './types';
import type { TurnScore, WorkflowMetrics, summarizeScores } from './scorer';
import { renderUserText } from './template';

const REPORT_REPLY_MAX_CHARS = 600;

/** D5: which latency lane a turn's model calls fall into, by the SET of `providerUsage[].usageTag`
 * values it made — "fast" is the intake-route-only path, "full" is any turn that reached the
 * orchestrator loop or the composer, "other" is everything else (e.g. OCR-only tags). */
export type LatencyLane = 'fast' | 'full' | 'other';

function laneForUsageTags(usageTags: readonly string[]): LatencyLane {
  const tags = new Set(usageTags);
  if (tags.size === 1 && tags.has('line.intake-route')) return 'fast';
  if (tags.has('line.loop') || tags.has('line.compose')) return 'full';
  return 'other';
}

/** Nearest-rank percentile (matches apps/api/src/scripts/a5-capacity-mutating.logic.ts's own
 * `percentile` — duplicated rather than imported across an app/script boundary for one function). */
function percentile(values: readonly number[], percent: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percent / 100) * sorted.length) - 1));
  return sorted[index]!;
}

export type LatencyLaneSummary = { lane: LatencyLane; n: number; p50: number; p95: number; max: number; over15s: number; over30s: number; costThb: number };

/** D5: buckets every turn that made at least one model call into fast/full/other (by usage tag) and
 * summarizes its `modelWorkCompletedAtMs - acceptedAtMs` latency plus total provider cost per lane.
 * A turn with NO provider usage at all (a deterministic reply, no model call) has no lane and is
 * skipped — this section is about MODEL latency, meaningless for a turn that never called one. */
export function summarizeLatencyByLane(turnEvidence: readonly RuntimeTurnEvidence[]): LatencyLaneSummary[] {
  const byLane = new Map<LatencyLane, { latencies: number[]; costSatang: number }>();
  for (const evidence of turnEvidence) {
    const usage = evidence.providerUsage as Array<{ usageTag?: string; costSatang?: number | null }>;
    if (!usage.length) continue;
    const lane = laneForUsageTags(usage.map((row) => row.usageTag ?? ''));
    const bucket = byLane.get(lane) ?? { latencies: [], costSatang: 0 };
    if (evidence.modelWorkCompletedAtMs !== null) bucket.latencies.push(evidence.modelWorkCompletedAtMs - evidence.acceptedAtMs);
    bucket.costSatang += usage.reduce((sum, row) => sum + (row.costSatang ?? 0), 0);
    byLane.set(lane, bucket);
  }
  return (['fast', 'full', 'other'] as const).map((lane) => {
    const bucket = byLane.get(lane) ?? { latencies: [], costSatang: 0 };
    return {
      lane, n: bucket.latencies.length,
      p50: percentile(bucket.latencies, 50), p95: percentile(bucket.latencies, 95),
      max: bucket.latencies.length ? Math.max(...bucket.latencies) : 0,
      over15s: bucket.latencies.filter((ms) => ms > 15_000).length,
      over30s: bucket.latencies.filter((ms) => ms > 30_000).length,
      costThb: bucket.costSatang / 100,
    };
  });
}

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

const thb = (satang: string) => (Number(satang) / 100).toFixed(2);
const workflowCostPerCompleted = (metrics: WorkflowMetrics) => {
  const rows = Object.values(metrics.W5.byKind);
  const completed = rows.reduce((sum, row) => sum + row.completedTasks, 0);
  const total = rows.reduce((sum, row) => sum + Number(row.providerExact), 0);
  return completed ? (total / completed / 100).toFixed(2) : '0.00';
};

/** Owner-facing before/after table from measurement spec §10. */
export function renderWorkflowSummary(input: { before: WorkflowMetrics; after: WorkflowMetrics; ready?: string; remaining?: string }): string {
  const before = input.before, after = input.after;
  const beforeComplete = before.W3.total ? `${(100 * before.W3.passed / before.W3.total).toFixed(0)}%` : '0%';
  const afterComplete = after.W3.total ? `${(100 * after.W3.passed / after.W3.total).toFixed(0)}%` : '0%';
  const beforeWrong = before.W6.wrongApplied + before.W6.wrongPreview, afterWrong = after.W6.wrongApplied + after.W6.wrongPreview;
  const beforeFast = ((before.W8['0']?.p50 ?? 0) / 1000).toFixed(1), afterFast = ((after.W8['0']?.p50 ?? 0) / 1000).toFixed(1);
  return `## ผลวัดงานซ้ำ\n\n| | ก่อน | หลัง |\n|---|---:|---:|\n`
    + `| ต้นทุนต่องานที่เสร็จ | ${workflowCostPerCompleted(before)} บาท | ${workflowCostPerCompleted(after)} บาท |\n`
    + `| ต้นทุนรวมชุดงานเดียวกัน | ${thb(before.W13.candidateExact)} บาท | ${thb(after.W13.candidateExact)} บาท |\n`
    + `| งานจบโดยไม่ติด | ${beforeComplete} | ${afterComplete} |\n| ทำผิดรายการ | ${beforeWrong} ครั้ง | ${afterWrong} ครั้ง |\n`
    + `| ตอบเร็ว (ปุ่ม) | ${beforeFast} วิ | ${afterFast} วิ |\n\nพร้อมแล้ว: ${input.ready ?? '—'}\n\nยังเหลือ: ${input.remaining ?? '—'}\n`;
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
  workflowSummary?: { before: WorkflowMetrics; after: WorkflowMetrics; ready?: string; remaining?: string };
}): string {
  const { sourceCommit, now, summary, scores, corpus, turnEvidence, subset, rescoredFrom, workflowSummary } = input;
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
  // D3: every `machine_token:<kind>` reason any turn carries, regardless of whether that turn also
  // failed for other reasons — one turn can contribute more than one kind, never more than once per
  // kind (scorer.ts scoreMachineTokens already dedupes per kind).
  const machineTokenKindsByTurn = scores.map((score) => score.reasons.filter((reason) => reason.startsWith('machine_token:')).map((reason) => reason.slice('machine_token:'.length)));
  const machineTokenTurnCount = machineTokenKindsByTurn.filter((kinds) => kinds.length > 0).length;
  const machineTokenCountsByKind = new Map<string, number>();
  for (const kinds of machineTokenKindsByTurn) for (const kind of kinds) machineTokenCountsByKind.set(kind, (machineTokenCountsByKind.get(kind) ?? 0) + 1);
  const machineTokenBreakdown = [...machineTokenCountsByKind.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([kind, count]) => `${kind}: ${count}`).join(', ') || 'none';
  const latencyRows = summarizeLatencyByLane(turnEvidence)
    .map((row) => `| ${row.lane} | ${row.n} | ${row.p50} | ${row.p95} | ${row.max} | ${row.over15s} | ${row.over30s} | ${row.costThb.toFixed(2)} |`).join('\n');
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
    + `## Summary\n\n| | |\n|---|---|\n| Passed | ${summary.passed} |\n| Failed | ${summary.failed} |\n| Pass rate | ${(summary.passRate * 100).toFixed(1)}% |\n`
    + `| Turns with machine tokens (D3) | ${machineTokenTurnCount} (${machineTokenBreakdown}) |\n\n`
    + `## By category (spec §3 row)\n\n| Category | Passed/Total |\n|---|---|\n${byCategoryRows}\n\n`
    + `## Latency by lane (D5)\n\n| Lane | n | p50 ms | p95 ms | max ms | >15s | >30s | Cost (THB) |\n|---|---|---|---|---|---|---|---|\n${latencyRows}\n\n`
    + `## Failures\n\n${failureSections || '_none_'}\n`
    + (workflowSummary ? `\n${renderWorkflowSummary(workflowSummary)}` : '');
}
