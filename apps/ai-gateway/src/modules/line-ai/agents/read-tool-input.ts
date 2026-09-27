import { LINE_AI_VALUE_CANDIDATES_V2_LIMITS, extractValueCandidates, isAmbiguousDateCandidate, isAmbiguousPeriodCandidate } from '@watchdog-bms/contracts';
import type { LineAiConversationContext, LineAiValueCandidates, ToolMeta } from '@watchdog-bms/contracts';

export type ConversationReadCandidates = {
  turns: Array<{ at: string; todayIso: string; dates: LineAiValueCandidates['dates']; periods: NonNullable<LineAiValueCandidates['periods']> }>;
  candidates: LineAiValueCandidates;
};

function currentScopeBlocksHistory(candidates?: LineAiValueCandidates): boolean {
  return !!candidates && (('completeness' in candidates && candidates.completeness === 'overflow')
    || candidates.dates.length > 0 || (candidates.periods?.length ?? 0) > 0);
}

export function conversationReadCandidates(
  context?: LineAiConversationContext,
  current?: LineAiValueCandidates,
): ConversationReadCandidates | undefined {
  if (!context || currentScopeBlocksHistory(current)) return undefined;
  const turns: ConversationReadCandidates['turns'] = [];
  for (const turn of context.recentTurns) {
    if (turn.userMessagePreviewComplete !== true || !turn.userMessagePreview) continue;
    const at = new Date(turn.at);
    if (!Number.isFinite(at.getTime())) continue;
    const todayIso = at.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    if (new TextEncoder().encode(turn.userMessagePreview).length > LINE_AI_VALUE_CANDIDATES_V2_LIMITS.utf8Bytes) continue;
    const extracted = extractValueCandidates(turn.userMessagePreview, todayIso, { scan: {
      observe() {}, datePositions: new WeakMap(),
    } });
    if (extracted.dates.length > LINE_AI_VALUE_CANDIDATES_V2_LIMITS.dates
      || (extracted.periods?.length ?? 0) > LINE_AI_VALUE_CANDIDATES_V2_LIMITS.periods) continue;
    const dates = extracted.dates.filter(candidate => !isAmbiguousDateCandidate(candidate));
    const periods = (extracted.periods ?? []).filter(candidate => !isAmbiguousPeriodCandidate(candidate));
    if (dates.length || periods.length) turns.push({ at: turn.at, todayIso, dates, periods });
  }
  if (!turns.length) return undefined;
  const dates = [...new Map(turns.flatMap(turn => turn.dates).map(date => [date.isoDate, date])).values()];
  const periods = [...new Map(turns.flatMap(turn => turn.periods)
    .map(period => [`${period.fromDate}:${period.toDate}:${period.monthKey ?? ''}`, period])).values()];
  return { turns, candidates: { amounts: [], dates, periods } };
}

export function canonicalizeReadToolEnums(
  meta: Pick<ToolMeta, 'inputEnumValues'>,
  raw: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const canonical = { ...raw };
  for (const [key, values] of Object.entries(meta.inputEnumValues ?? {})) {
    if (!(key in raw)) continue;
    const value = raw[key];
    if (typeof value !== 'string') return undefined;
    const matches = values.filter(candidate => candidate.toLocaleLowerCase('en-US') === value.toLocaleLowerCase('en-US'));
    if (matches.length !== 1) return undefined;
    canonical[key] = matches[0];
  }
  return canonical;
}
