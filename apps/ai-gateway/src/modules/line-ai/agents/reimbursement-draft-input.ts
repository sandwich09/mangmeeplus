import type { LineAiTurnRequest, ToolResult } from '@watchdog-bms/contracts';

function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }

const TEXT_FIELDS = ['title', 'reason', 'missingReceiptReason'];
const LINE_TEXT_FIELDS = ['description', 'purpose'];

/** The draft locator and task revision the API itself issued in this turn's latest successful get_options. */
function issuedLocator(results: ReadonlyArray<{ result: ToolResult }>) {
  for (const { result } of [...results].reverse()) {
    if (result.toolName !== 'reimbursement.draft.get_options' || result.status !== 'ok' || !object(result.data)) continue;
    const locator = result.data['actionLocator'], options = result.data['options'];
    if (!object(locator) || typeof locator['taskId'] !== 'string' || typeof locator['actionId'] !== 'string') continue;
    return { taskId: locator['taskId'], actionId: locator['actionId'],
      ...(typeof locator['operation'] === 'string' ? { operation: locator['operation'] } : {}),
      ...(object(options) && Number.isSafeInteger(options['taskRevision']) ? { taskRevision: Number(options['taskRevision']) } : {}) };
  }
  return undefined;
}

/** The user's own words bound to their one exact span — the unique-substring rule the compact intake decoder
 *  applies to its quotes. Words that are not in the message exactly once are left as planned; the API decides. */
function userText(raw: unknown, evidence: LineAiTurnRequest['inputEvidence']): unknown {
  const value = typeof raw === 'string' ? raw : object(raw) && typeof raw['value'] === 'string' ? raw['value'] : undefined;
  if (!value || object(raw) && object(raw['proof']) && raw['proof']['kind'] !== 'USER_TEXT') return raw;
  const spans = (evidence?.parts ?? []).flatMap(part => {
    const start = part.rawText.indexOf(value);
    return start >= 0 && part.rawText.indexOf(value, start + 1) < 0
      ? [{ partId: part.partId, startUtf16: start, endUtf16: start + value.length, rawSha256: part.rawSha256 }] : [];
  });
  return spans.length === 1 ? { value, proof: { kind: 'USER_TEXT', refs: spans } } : raw;
}

/**
 * NAT04 (2026-09-30). The planner picks the bill and names the user's words; the ids and offsets around them are
 * the API's and the message's, never the model's to recall or count:
 * - get_options keeps a taskId/actionId only when the API issued it (this turn's locator, or the draft action the
 *   conversation task remembers). A taskRef id names the conversation, not a draft; without it the API resumes
 *   this chat's own draft under its usual owner and task checks.
 * - a preview takes the action locator and task revision from this turn's get_options result, and each text value
 *   the user typed gets its exact span. The API still validates every id, value and proof.
 */
export function completeReimbursementDraftInput(toolName: string, input: unknown, results: ReadonlyArray<{ result: ToolResult }>,
  req: LineAiTurnRequest): unknown {
  if (!object(input)) return input;
  const issued = issuedLocator(results);
  if (toolName === 'reimbursement.draft.get_options') {
    const remembered = new Set((req.taskProjection?.tasks ?? []).flatMap(task => Object.entries(task.slots ?? {})
      .filter(([key]) => key.startsWith('reimbursementActionId')).map(([, value]) => value)));
    const next = { ...input };
    if (next['taskId'] !== undefined && next['taskId'] !== issued?.taskId) delete next['taskId'];
    if (next['actionId'] !== undefined && next['actionId'] !== issued?.actionId && !remembered.has(next['actionId'] as string)) delete next['actionId'];
    return next;
  }
  if (!issued || !toolName.startsWith('reimbursement.draft.preview_')) return input;
  const proposal = object(input['proposal']) ? { ...input['proposal'] } : {};
  const fields = object(proposal['fields']) ? { ...proposal['fields'] } : {};
  for (const key of TEXT_FIELDS) if (fields[key] !== undefined && fields[key] !== null) fields[key] = userText(fields[key], req.inputEvidence);
  const lineChanges = Array.isArray(proposal['lineChanges']) ? proposal['lineChanges'].map(change => object(change) && object(change['values'])
    ? { ...change, values: Object.fromEntries(Object.entries(change['values']).map(([key, value]) =>
      [key, LINE_TEXT_FIELDS.includes(key) && value !== null && value !== undefined ? userText(value, req.inputEvidence) : value])) }
    : change) : undefined;
  return { ...input,
    // The action is the API's own locator and nothing else: a key the planner added (round 10: the options
    // `revision`) made the API's exact-key parser refuse the whole preview.
    action: { taskId: issued.taskId, actionId: issued.actionId, ...(issued.operation ? { operation: issued.operation } : {}) },
    proposal: { ...proposal, schemaVersion: 1, taskId: issued.taskId, ...(issued.taskRevision !== undefined ? { taskRevision: issued.taskRevision } : {}),
      ...(issued.operation ? { operation: issued.operation } : {}), fields, ...(lineChanges ? { lineChanges } : {}) } };
}
