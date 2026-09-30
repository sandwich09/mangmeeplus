import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLineAiInputEvidence, extractValueCandidates } from '@watchdog-bms/contracts';
import { ROUTER_ENABLED_TOOLS } from './intent-router.agent';
import { parseLineIntakeCompactDecision } from './line-intake-compact-decision';

const PREPARED_FAMILIES = new Set(['expense.list_recent::single_metric']);

async function fixture(messageText: string) {
  const created = await createLineAiInputEvidence({
    turnKey: 'turn-compact-test',
    parts: [{ partId: 'part-0', eventIdHash: 'a'.repeat(64), acceptedAtMs: Date.parse('2026-09-27T04:00:00.000Z'), rawText: messageText }],
  });
  assert.ok(created);
  return created;
}

function decision(messageText: string, filters: Record<string, unknown> = {}, simpleRead: Record<string, unknown> | undefined = {
  subrequest: 0, tool: 'expense.list_recent', subject: 'expense', agent: 'accounting', answerShape: 'single_metric', confidence: 0.96,
}) {
  return {
    subrequests: [{ kind: 'read', goal: messageText, sources: [{ part: 0, whole: true }], filters }],
    ...(simpleRead ? { simpleRead } : {}),
  };
}

describe('compact LINE intake decision', () => {
  it('expands one grounded read to canonical semantic and prepared contracts', async () => {
    const text = 'เดือนนี้ใช้เงินไปเท่าไหร่แล้ว เฉพาะยืนยันแล้ว';
    const created = await fixture(text);
    const candidates = extractValueCandidates(text, '2026-09-27');
    const period = (candidates.periods ?? [])[0]!;
    const parsed = parseLineIntakeCompactDecision({
      raw: decision(text, { fromDate: period.fromDate, toDate: period.toDate, documentStatus: 'confirmed' }),
      messageText: text, inputEvidence: created.inputEvidence, enabledTools: ROUTER_ENABLED_TOOLS, enabledPreparedFamilies: PREPARED_FAMILIES, language: 'th', valueCandidates: candidates,
    });
    assert.ok(parsed?.preparedPlan);
    assert.deepEqual(parsed.semanticSubrequests[0]?.requestedFilters,
      { fromDate: period.fromDate, toDate: period.toDate, documentStatus: 'CONFIRMED' });
    assert.deepEqual(parsed.preparedPlan.proposedCalls[0]?.input, parsed.semanticSubrequests[0]?.requestedFilters);
    assert.deepEqual(parsed.semanticSubrequests[0]?.evidenceRefs, [{
      partId: 'part-0', startUtf16: 0, endUtf16: text.length, rawSha256: created.inputEvidence.parts[0]!.rawSha256,
    }]);
  });

  it('keeps canonical semantics but never prepares an unknown enum value', async () => {
    const text = 'เดือนนี้ใช้เงินไปเท่าไหร่ เฉพาะสถานะแปลก';
    const created = await fixture(text);
    const candidates = extractValueCandidates(text, '2026-09-27');
    const period = candidates.periods?.[0]!;
    const parsed = parseLineIntakeCompactDecision({
      raw: decision(text, { fromDate: period.fromDate, toDate: period.toDate, documentStatus: 'UNKNOWN_STATUS' }),
      messageText: text, inputEvidence: created.inputEvidence, enabledTools: ROUTER_ENABLED_TOOLS,
      enabledPreparedFamilies: PREPARED_FAMILIES, language: 'th', valueCandidates: candidates,
    });
    assert.equal(parsed?.preparedPlan, undefined);
    assert.equal(parsed?.simpleReadRejection, 'filter_not_grounded');
    assert.equal(parsed?.semanticSubrequests[0]?.requestedFilters.documentStatus, 'UNKNOWN_STATUS');
  });

  it('item 2b: grounds a categoryName after NFC + lowercase + collapsed whitespace, not only raw equality', async () => {
    const text = 'เดือนนี้ค่าใช้จ่ายหมวด   อาหาร   เท่าไหร่';
    const created = await fixture(text);
    const candidates = extractValueCandidates(text, '2026-09-27');
    const period = candidates.periods?.[0]!;
    const parsed = parseLineIntakeCompactDecision({
      raw: decision(text, { fromDate: period.fromDate, toDate: period.toDate, categoryName: 'อาหาร' }),
      messageText: text, inputEvidence: created.inputEvidence, enabledTools: ROUTER_ENABLED_TOOLS,
      enabledPreparedFamilies: PREPARED_FAMILIES, language: 'th', valueCandidates: candidates,
    });
    assert.ok(parsed?.preparedPlan);
    assert.equal(parsed.preparedPlan.proposedCalls[0]?.input['categoryName'], 'อาหาร');
  });

  it('item 2b: rejects a vendorName the model invented that never appears in the message', async () => {
    const text = 'เดือนนี้ค่าใช้จ่ายเท่าไหร่';
    const created = await fixture(text);
    const candidates = extractValueCandidates(text, '2026-09-27');
    const period = candidates.periods?.[0]!;
    const parsed = parseLineIntakeCompactDecision({
      raw: decision(text, { fromDate: period.fromDate, toDate: period.toDate, vendorName: 'ร้านสมใจ' }),
      messageText: text, inputEvidence: created.inputEvidence, enabledTools: ROUTER_ENABLED_TOOLS,
      enabledPreparedFamilies: PREPARED_FAMILIES, language: 'th', valueCandidates: candidates,
    });
    assert.equal(parsed?.preparedPlan, undefined);
    assert.equal(parsed?.simpleReadRejection, 'filter_not_grounded');
  });

  it('does not prepare a read from dates mixed across two candidate periods', async () => {
    // tuning-5b (B3): this message also says "เปรียบเทียบ" (compare), so the deterministic why/compare/
    // advice guard now rejects it before the mixed-period filter check ever runs — a more specific and
    // equally safe reason for the exact same "never prepare this" outcome (see the guard's own dedicated
    // test below for a message that isolates just the mixed-period path).
    const text = 'เปรียบเทียบค่าใช้จ่ายเดือนนี้กับเดือนที่แล้ว';
    const created = await fixture(text);
    const candidates = extractValueCandidates(text, '2026-09-27');
    const periods = candidates.periods ?? [];
    assert.equal(periods.length, 2);
    const parsed = parseLineIntakeCompactDecision({
      raw: decision(text, { fromDate: periods[0]!.fromDate, toDate: periods[1]!.toDate }),
      messageText: text, inputEvidence: created.inputEvidence, enabledTools: ROUTER_ENABLED_TOOLS, enabledPreparedFamilies: PREPARED_FAMILIES, language: 'th', valueCandidates: candidates,
    });
    assert.equal(parsed?.preparedPlan, undefined);
    assert.equal(parsed?.simpleReadRejection, 'why_compare_advice_question');
  });

  it('accepts a monthKey selected from a relative named-period candidate', async () => {
    const text = 'ค่าใช้จ่ายเดือนที่แล้ว';
    const created = await fixture(text);
    const candidates = extractValueCandidates(text, '2026-09-27');
    const monthKey = candidates.periods?.[0]?.monthKey;
    assert.equal(monthKey, '2026-08');
    const parsed = parseLineIntakeCompactDecision({
      raw: decision(text, { periodKey: monthKey }), messageText: text, inputEvidence: created.inputEvidence,
      enabledTools: ROUTER_ENABLED_TOOLS, enabledPreparedFamilies: PREPARED_FAMILIES, language: 'th', valueCandidates: candidates,
    });
    assert.ok(parsed?.preparedPlan);
    assert.deepEqual(parsed.preparedPlan.proposedCalls[0]?.input, { periodKey: '2026-08' });
  });

  it('rejects unknown filters even when simpleRead is absent or names an unknown tool', async () => {
    const text = 'ขอค่าใช้จ่ายตามสีใบเสร็จ';
    const created = await fixture(text);
    const absent = decision(text, { receiptColor: 'blue' });
    delete (absent as { simpleRead?: unknown }).simpleRead;
    assert.equal('simpleRead' in absent, false);
    for (const raw of [absent, decision(text, { receiptColor: 'blue' },
      { subrequest: 0, tool: 'unknown.read', subject: 'expense', agent: 'accounting', answerShape: 'list', confidence: 0.95 })]) {
      const parsed = parseLineIntakeCompactDecision({
        raw, messageText: text,
        inputEvidence: created.inputEvidence, enabledTools: ROUTER_ENABLED_TOOLS, enabledPreparedFamilies: PREPARED_FAMILIES, language: 'th',
      });
      assert.equal(parsed, undefined);
    }
  });

  it('keeps a file clause whose filters carry stray keys, which a read clause still may not (regression slice 2026-09-30, NAT-05 t2, NAT-06 t3)', async () => {
    const text = 'หน้าสองเขียนว่าไง';
    const created = await fixture(text);
    const parse = (kind: string, filters: Record<string, unknown>) => parseLineIntakeCompactDecision({
      raw: { subrequests: [{ kind, goal: text, sources: [{ part: 0, whole: true }], filters }] },
      messageText: text, inputEvidence: created.inputEvidence, enabledTools: ROUTER_ENABLED_TOOLS, enabledPreparedFamilies: PREPARED_FAMILIES, language: 'th',
    });
    assert.deepEqual(parse('file', { attachmentId: 'cmumxw9vb002tqvk1dbp9on5w', page: 2 })?.semanticSubrequests[0]?.requestedFilters,
      { attachmentId: 'cmumxw9vb002tqvk1dbp9on5w', page: 2 });
    assert.deepEqual(parse('file', { taskRef: null })?.semanticSubrequests[0]?.requestedFilters, {});
    assert.equal(parse('read', { attachmentId: 'cmumxw9vb002tqvk1dbp9on5w' }), undefined);
    assert.equal(parse('read', { taskRef: null }), undefined);
    assert.equal(parse('file', JSON.parse('{"__proto__":null}') as Record<string, unknown>), undefined);
  });

  it('drops a stray filter on a claim write clause instead of failing the decision (NAT-04 2026-09-29)', async () => {
    const text = 'บิลร้านเครื่องเขียนที่ส่งไว้สองใบอะ';
    const created = await fixture(text);
    const parsed = parseLineIntakeCompactDecision({
      raw: { subrequests: [{ kind: 'write', goal: text, sources: [{ part: 0, whole: true }], writeIntent: 'REIMBURSEMENT_REQUEST_START',
        filters: { expenseIds: ['NAT-STATIONERY-1', 'NAT-STATIONERY-2'] } }] },
      messageText: text, inputEvidence: created.inputEvidence, enabledTools: ROUTER_ENABLED_TOOLS, enabledPreparedFamilies: PREPARED_FAMILIES, language: 'th',
    });
    assert.deepEqual(parsed?.semanticSubrequests[0]?.requestedFilters, {});
    assert.equal(parsed?.semanticSubrequests[0]?.writeIntent, 'REIMBURSEMENT_REQUEST_START');
  });

  it('rejects prototype keys instead of silently dropping a constraint', async () => {
    const text = 'ดูค่าใช้จ่ายเดือนนี้';
    const created = await fixture(text);
    const filters = JSON.parse('{"__proto__":null}') as Record<string, unknown>;
    const parsed = parseLineIntakeCompactDecision({
      raw: decision(text, filters), messageText: text, inputEvidence: created.inputEvidence,
      enabledTools: ROUTER_ENABLED_TOOLS, enabledPreparedFamilies: PREPARED_FAMILIES, language: 'th',
    });
    assert.equal(parsed, undefined);
  });

  it('names taskref_malformed for a bare id string, a partial object, an extra key, or a wrong-typed field', async () => {
    const text = 'ทำต่อเลย';
    const created = await fixture(text);
    const validRef = { taskId: 'task-1', taskRevision: 3, subrequestIndex: 0 };
    for (const badTaskRef of ['task-1', { taskId: 'task-1' }, { ...validRef, extra: 1 }, { ...validRef, taskRevision: '3' }]) {
      const reasons: string[] = [];
      const parsed = parseLineIntakeCompactDecision({
        raw: { subrequests: [{ kind: 'read', goal: text, sources: [{ part: 0, whole: true }], filters: {}, taskRef: badTaskRef }] },
        messageText: text, inputEvidence: created.inputEvidence,
        enabledTools: ROUTER_ENABLED_TOOLS, enabledPreparedFamilies: PREPARED_FAMILIES, language: 'th',
        onReject: (reason) => reasons.push(reason),
      });
      assert.equal(parsed, undefined, JSON.stringify(badTaskRef));
      assert.deepEqual(reasons, ['taskref_malformed'], JSON.stringify(badTaskRef));
    }
  });

  it('accepts a well-formed taskRef object and carries it through to the canonical subrequest', async () => {
    const text = 'ทำต่อเลย';
    const created = await fixture(text);
    const validRef = { taskId: 'task-1', taskRevision: 3, subrequestIndex: 0 };
    const reasons: string[] = [];
    const parsed = parseLineIntakeCompactDecision({
      raw: { subrequests: [{ kind: 'read', goal: text, sources: [{ part: 0, whole: true }], filters: {}, taskRef: validRef }] },
      messageText: text, inputEvidence: created.inputEvidence,
      enabledTools: ROUTER_ENABLED_TOOLS, enabledPreparedFamilies: PREPARED_FAMILIES, language: 'th',
      onReject: (reason) => reasons.push(reason),
    });
    assert.deepEqual(parsed?.semanticSubrequests[0]?.taskRef, validRef);
    assert.deepEqual(reasons, []);
  });

  // N1 (tuning-8, T-068-a run 8): both router attempts on this turn ("รายการที่ 3 คือร้านอะไรครับ")
  // produced a correct decision the decoder still rejected — attempt 1 sent "taskRef": null.
  it('N1 (T-068-a): treats a null taskRef as absent, never as malformed', async () => {
    const text = 'รายการที่ 3 คือร้านอะไรครับ';
    const created = await fixture(text);
    const reasons: string[] = [];
    const parsed = parseLineIntakeCompactDecision({
      raw: { subrequests: [{ kind: 'read', goal: text, sources: [{ part: 0, whole: true }], filters: {}, taskRef: null }] },
      messageText: text, inputEvidence: created.inputEvidence,
      enabledTools: ROUTER_ENABLED_TOOLS, enabledPreparedFamilies: PREPARED_FAMILIES, language: 'th',
      onReject: (reason) => reasons.push(reason),
    });
    assert.deepEqual(reasons, []);
    assert.equal(parsed?.semanticSubrequests[0]?.taskRef, undefined);
  });

  it('strictly rejects malformed or conflicting compact source modes', async () => {
    const text = 'ดูค่าใช้จ่าย';
    const created = await fixture(text);
    for (const source of [{ part: 0, whole: true, quote: null }, { part: 0, quote: 123 }, { part: 0, whole: false }]) {
      const parsed = parseLineIntakeCompactDecision({
        raw: { subrequests: [{ kind: 'read', goal: text, sources: [source], filters: {} }] },
        messageText: text, inputEvidence: created.inputEvidence, enabledTools: ROUTER_ENABLED_TOOLS, enabledPreparedFamilies: PREPARED_FAMILIES, language: 'th',
      });
      assert.equal(parsed, undefined);
    }
  });

  // N1 (tuning-8, T-068-a run 8 attempt 2): the router's second attempt sent {"part":"part-0"} instead
  // of {"part":0} on an otherwise-correct decision.
  it('N1 (T-068-a): accepts a "part-N" string source naming an existing part, as the number N', async () => {
    const text = 'รายการที่ 3 คือร้านอะไรครับ';
    const created = await fixture(text);
    const parsed = parseLineIntakeCompactDecision({
      raw: { subrequests: [{ kind: 'read', goal: text, sources: [{ part: 'part-0', whole: true }], filters: {} }] },
      messageText: text, inputEvidence: created.inputEvidence,
      enabledTools: ROUTER_ENABLED_TOOLS, enabledPreparedFamilies: PREPARED_FAMILIES, language: 'th',
    });
    assert.deepEqual(parsed?.semanticSubrequests[0]?.evidenceRefs, [{
      partId: 'part-0', startUtf16: 0, endUtf16: text.length, rawSha256: created.inputEvidence.parts[0]!.rawSha256,
    }]);
  });

  it('N1: still rejects a "part-N" source string naming a part that does not exist, and any other non-numeric shape', async () => {
    const text = 'ดูค่าใช้จ่าย';
    const created = await fixture(text);
    for (const part of ['part-9', 'part-0x', 'partition-0', 'part-', 'part0', 0.5]) {
      const parsed = parseLineIntakeCompactDecision({
        raw: { subrequests: [{ kind: 'read', goal: text, sources: [{ part, whole: true }], filters: {} }] },
        messageText: text, inputEvidence: created.inputEvidence,
        enabledTools: ROUTER_ENABLED_TOOLS, enabledPreparedFamilies: PREPARED_FAMILIES, language: 'th',
      });
      assert.equal(parsed, undefined, JSON.stringify(part));
    }
  });

  it('keeps canonical semantics but omits prepared execution for an unknown tool or task continuation', async () => {
    const text = 'ดูค่าใช้จ่ายต่อ';
    const created = await fixture(text);
    const unsupportedFamily = parseLineIntakeCompactDecision({
      raw: decision(text, {}, { subrequest: 0, tool: 'expense.get_breakdown', subject: 'expense', agent: 'accounting', answerShape: 'single_metric', confidence: 0.95 }),
      messageText: text, inputEvidence: created.inputEvidence, enabledTools: ROUTER_ENABLED_TOOLS,
      enabledPreparedFamilies: PREPARED_FAMILIES, language: 'th',
    });
    assert.equal(unsupportedFamily?.semanticSubrequests.length, 1);
    assert.equal(unsupportedFamily?.preparedPlan, undefined);
    assert.equal(unsupportedFamily?.simpleReadRejection, 'formatter_family_not_allowed');

    const unknownTool = parseLineIntakeCompactDecision({
      raw: decision(text, {}, { subrequest: 0, tool: 'unknown.read', subject: 'expense', agent: 'accounting', answerShape: 'list', confidence: 0.95 }),
      messageText: text, inputEvidence: created.inputEvidence, enabledTools: ROUTER_ENABLED_TOOLS, enabledPreparedFamilies: PREPARED_FAMILIES, language: 'th',
    });
    assert.equal(unknownTool?.semanticSubrequests.length, 1);
    assert.equal(unknownTool?.preparedPlan, undefined);
    assert.equal(unknownTool?.simpleReadRejection, 'tool_not_enabled');

    const task = parseLineIntakeCompactDecision({
      raw: { ...decision(text), subrequests: [{ kind: 'read', goal: text, sources: [{ part: 0, whole: true }], filters: {},
        taskRef: { taskId: 'task-1', taskRevision: 4, subrequestIndex: 0 } }] },
      messageText: text, inputEvidence: created.inputEvidence, enabledTools: ROUTER_ENABLED_TOOLS, enabledPreparedFamilies: PREPARED_FAMILIES, language: 'th',
    });
    assert.equal(task?.preparedPlan, undefined);
    assert.equal(task?.simpleReadRejection, 'not_single_independent_read');
  });

  it('derives one exact quoted source and rejects a duplicate quote', async () => {
    const uniqueText = 'ดูรายจ่ายเดือนนี้ แล้วสรุปสั้นๆ';
    const unique = await fixture(uniqueText);
    const parsed = parseLineIntakeCompactDecision({
      raw: { subrequests: [{ kind: 'read', goal: 'ดูรายจ่ายเดือนนี้', sources: [{ part: 0, quote: 'ดูรายจ่ายเดือนนี้' }], filters: {} }] },
      messageText: uniqueText, inputEvidence: unique.inputEvidence, enabledTools: ROUTER_ENABLED_TOOLS, enabledPreparedFamilies: PREPARED_FAMILIES, language: 'th',
    });
    assert.deepEqual(parsed?.semanticSubrequests[0]?.evidenceRefs, [{
      partId: 'part-0', startUtf16: 0, endUtf16: 'ดูรายจ่ายเดือนนี้'.length,
      rawSha256: unique.inputEvidence.parts[0]!.rawSha256,
    }]);

    const duplicateText = 'ดูรายจ่าย แล้วดูรายจ่ายอีกที';
    const duplicate = await fixture(duplicateText);
    assert.equal(parseLineIntakeCompactDecision({
      raw: { subrequests: [{ kind: 'read', goal: 'ดูรายจ่าย', sources: [{ part: 0, quote: 'ดูรายจ่าย' }], filters: {} }] },
      messageText: duplicateText, inputEvidence: duplicate.inputEvidence, enabledTools: ROUTER_ENABLED_TOOLS, enabledPreparedFamilies: PREPARED_FAMILIES, language: 'th',
    }), undefined);
  });

  it('keeps every compound clause but never prepares it as one simple read', async () => {
    const text = 'ดูรายจ่ายเดือนนี้ แล้วอธิบายว่ากำไรขั้นต้นคืออะไร';
    const created = await fixture(text);
    const parsed = parseLineIntakeCompactDecision({
      raw: {
        subrequests: [
          { kind: 'read', goal: 'ดูรายจ่ายเดือนนี้', sources: [{ part: 0, quote: 'ดูรายจ่ายเดือนนี้' }], filters: {} },
          { kind: 'general', goal: 'อธิบายกำไรขั้นต้น', sources: [{ part: 0, quote: 'อธิบายว่ากำไรขั้นต้นคืออะไร' }], filters: {} },
        ],
        simpleRead: { subrequest: 0, tool: 'expense.list_recent', subject: 'expense', agent: 'accounting', answerShape: 'single_metric', confidence: 0.96 },
      },
      messageText: text, inputEvidence: created.inputEvidence, enabledTools: ROUTER_ENABLED_TOOLS, enabledPreparedFamilies: PREPARED_FAMILIES, language: 'th',
    });
    assert.deepEqual(parsed?.semanticSubrequests.map((item) => item.kind), ['read', 'general']);
    assert.equal(parsed?.preparedPlan, undefined);
    assert.equal(parsed?.simpleReadRejection, 'not_single_independent_read');
  });

  it('spec §4 R-M5: a filter equal to a recentReads applied value is grounded, even with no period/filter words of its own', async () => {
    const text = 'แล้วหมวดนี้ล่ะ';
    const created = await fixture(text);
    const recentReads = [{
      tool: 'expense.list_recent', answerShape: 'single_metric' as const, asOf: '2026-09-27T09:00:00.000Z',
      period: { fromDate: '2026-08-01', toDate: '2026-08-31' }, categoryId: 'c1', categoryName: 'อาหาร',
    }];
    const parsed = parseLineIntakeCompactDecision({
      raw: decision(text, { fromDate: '2026-08-01', toDate: '2026-08-31', categoryId: 'c1' }),
      messageText: text, inputEvidence: created.inputEvidence, enabledTools: ROUTER_ENABLED_TOOLS,
      enabledPreparedFamilies: PREPARED_FAMILIES, language: 'th', recentReads,
    });
    assert.ok(parsed?.preparedPlan, 'a period and categoryId equal to the remembered read are both grounded');
    assert.equal(parsed.preparedPlan.proposedCalls[0]?.input['categoryId'], 'c1');
  });

  it('spec §4 R-M5: expense.get_detail\'s expenseId is grounded only by a recentReads shownItems id', async () => {
    const text = 'รายการแรกจ่ายหรือยัง';
    const created = await fixture(text);
    const detailFamilies = new Set(['expense.get_detail::single_metric']);
    const recentReads = [{
      tool: 'expense.list_recent', answerShape: 'list' as const, asOf: '2026-09-27T09:00:00.000Z',
      shownItems: [{ ordinal: 1, id: 'e1', label: 'ร้านสมใจ', date: '2026-08-05' }],
    }];
    const grounded = parseLineIntakeCompactDecision({
      raw: decision(text, { expenseId: 'e1' }, { subrequest: 0, tool: 'expense.get_detail', subject: 'expense', agent: 'accounting', answerShape: 'single_metric', confidence: 0.96 }),
      messageText: text, inputEvidence: created.inputEvidence, enabledTools: ROUTER_ENABLED_TOOLS,
      enabledPreparedFamilies: detailFamilies, language: 'th', recentReads,
    });
    assert.ok(grounded?.preparedPlan, 'e1 is in the newest recentReads entry\'s shownItems');

    const guessed = parseLineIntakeCompactDecision({
      raw: decision(text, { expenseId: 'e2' }, { subrequest: 0, tool: 'expense.get_detail', subject: 'expense', agent: 'accounting', answerShape: 'single_metric', confidence: 0.96 }),
      messageText: text, inputEvidence: created.inputEvidence, enabledTools: ROUTER_ENABLED_TOOLS,
      enabledPreparedFamilies: detailFamilies, language: 'th', recentReads,
    });
    assert.equal(guessed?.preparedPlan, undefined, 'e2 was never shown this chat — never grounded by messageText or memory');
    assert.equal(guessed?.simpleReadRejection, 'filter_not_grounded');
  });
});

describe('tuning-3 item 2: a groupBy-only follow-up carries the latest matching read\'s other filters (spec §4 R-M4)', () => {
  const BREAKDOWN_LIST_FAMILY = new Set(['expense.get_breakdown::list']);
  const breakdownSimpleRead = (confidence = 0.9) => ({
    subrequest: 0, tool: 'expense.get_breakdown', subject: 'expense', agent: 'accounting', answerShape: 'list', confidence,
  });

  it('T-004#2: "แยกตามหมวดให้ดูหน่อย" after a documentStatus filter carries documentStatus into the new groupBy request', async () => {
    const text = 'แยกตามหมวดให้ดูหน่อย';
    const created = await fixture(text);
    const recentReads = [{
      tool: 'expense.list_recent', answerShape: 'list' as const, asOf: '2026-09-27T23:06:36.944Z',
      period: { fromDate: '2026-09-01', toDate: '2026-09-28' }, documentStatus: 'NEEDS_REVIEW',
    }];
    const parsed = parseLineIntakeCompactDecision({
      raw: decision(text, { fromDate: '2026-09-01', toDate: '2026-09-28', groupBy: 'category' }, breakdownSimpleRead(0.91)),
      messageText: text, inputEvidence: created.inputEvidence, enabledTools: ROUTER_ENABLED_TOOLS,
      enabledPreparedFamilies: BREAKDOWN_LIST_FAMILY, language: 'th', recentReads,
    });
    assert.ok(parsed?.preparedPlan, 'the carried documentStatus must still ground as a recentReads-equal value');
    assert.equal(parsed.preparedPlan.proposedCalls[0]?.input['documentStatus'], 'NEEDS_REVIEW');
    assert.equal(parsed.semanticSubrequests[0]?.requestedFilters['documentStatus'], 'NEEDS_REVIEW');
  });

  it('T-013#2: "จ่ายร้านไหนเยอะสุดคะ" carries a recentReads paymentStatus even though this message never says "จ่ายแล้ว"', async () => {
    const text = 'จ่ายร้านไหนเยอะสุดคะ';
    const created = await fixture(text);
    const recentReads = [{
      tool: 'expense.get_breakdown', answerShape: 'list' as const, asOf: '2026-09-27T23:11:35.571Z',
      period: { fromDate: '2026-09-01', toDate: '2026-09-28' }, groupBy: 'category' as const, paymentStatus: 'PAID',
    }];
    const parsed = parseLineIntakeCompactDecision({
      raw: decision(text, { fromDate: '2026-09-01', toDate: '2026-09-28', groupBy: 'vendor' }, breakdownSimpleRead()),
      messageText: text, inputEvidence: created.inputEvidence, enabledTools: ROUTER_ENABLED_TOOLS,
      enabledPreparedFamilies: BREAKDOWN_LIST_FAMILY, language: 'th', recentReads,
    });
    assert.ok(parsed?.preparedPlan, 'paymentStatus must fall back to recentReads when the text names no payment-state word');
    assert.equal(parsed.preparedPlan.proposedCalls[0]?.input['paymentStatus'], 'PAID');
  });

  it('never carries a different business subject\'s recentReads filter (reimbursement into an expense groupBy request)', async () => {
    const text = 'แยกตามหมวดให้ดูหน่อย';
    const created = await fixture(text);
    const recentReads = [
      // Same subject (expense) grounds the period but has no status of its own to carry.
      { tool: 'expense.list_recent', answerShape: 'list' as const, asOf: '2026-09-27T23:06:30.000Z',
        period: { fromDate: '2026-09-01', toDate: '2026-09-28' } },
      // A different subject's status must never leak in even though it is the ONLY documentStatus in memory.
      { tool: 'reimbursement.list_pending_approvals', answerShape: 'list' as const, asOf: '2026-09-27T23:06:36.944Z',
        documentStatus: 'NEEDS_REVIEW' },
    ];
    const parsed = parseLineIntakeCompactDecision({
      raw: decision(text, { fromDate: '2026-09-01', toDate: '2026-09-28', groupBy: 'category' }, breakdownSimpleRead(0.91)),
      messageText: text, inputEvidence: created.inputEvidence, enabledTools: ROUTER_ENABLED_TOOLS,
      enabledPreparedFamilies: BREAKDOWN_LIST_FAMILY, language: 'th', recentReads,
    });
    assert.ok(parsed?.preparedPlan);
    assert.equal(parsed.preparedPlan.proposedCalls[0]?.input['documentStatus'], undefined);
  });

  it('never overrides a filter the current clause already names of its own', async () => {
    const text = 'แยกตามหมวดเฉพาะที่ยืนยันแล้วให้ดูหน่อย';
    const created = await fixture(text);
    const recentReads = [{
      tool: 'expense.list_recent', answerShape: 'list' as const, asOf: '2026-09-27T23:06:36.944Z',
      period: { fromDate: '2026-09-01', toDate: '2026-09-28' }, documentStatus: 'NEEDS_REVIEW',
    }];
    const parsed = parseLineIntakeCompactDecision({
      raw: decision(text, { fromDate: '2026-09-01', toDate: '2026-09-28', groupBy: 'category', documentStatus: 'CONFIRMED' }, breakdownSimpleRead(0.91)),
      messageText: text, inputEvidence: created.inputEvidence, enabledTools: ROUTER_ENABLED_TOOLS,
      enabledPreparedFamilies: BREAKDOWN_LIST_FAMILY, language: 'th', recentReads,
    });
    assert.ok(parsed?.preparedPlan);
    assert.equal(parsed.preparedPlan.proposedCalls[0]?.input['documentStatus'], 'CONFIRMED');
  });

  it('does not carry when the clause names no groupBy at all (unrelated to this rule)', async () => {
    const text = 'เดือนนี้ยอดรวมเท่าไหร่คะ';
    const created = await fixture(text);
    const recentReads = [{
      tool: 'expense.list_recent', answerShape: 'list' as const, asOf: '2026-09-27T23:06:36.944Z',
      period: { fromDate: '2026-09-01', toDate: '2026-09-28' }, documentStatus: 'NEEDS_REVIEW',
    }];
    const parsed = parseLineIntakeCompactDecision({
      raw: decision(text, { fromDate: '2026-09-01', toDate: '2026-09-28' }),
      messageText: text, inputEvidence: created.inputEvidence, enabledTools: ROUTER_ENABLED_TOOLS,
      enabledPreparedFamilies: PREPARED_FAMILIES, language: 'th', recentReads,
    });
    assert.ok(parsed?.preparedPlan);
    assert.equal(parsed.preparedPlan.proposedCalls[0]?.input['documentStatus'], undefined);
  });
});

describe('R1(b): an explicit topic restart drops the recentReads carry (companion to the router rule)', () => {
  const BREAKDOWN_LIST_FAMILY = new Set(['expense.get_breakdown::list']);
  const breakdownSimpleRead = (confidence = 0.9) => ({
    subrequest: 0, tool: 'expense.get_breakdown', subject: 'expense', agent: 'accounting', answerShape: 'list', confidence,
  });

  it('an explicit "กลับมาเรื่อง" restart never carries an earlier documentStatus into a new groupBy-only clause', async () => {
    const text = 'กลับมาเรื่องรายจ่ายเดือนนี้ค่ะ แยกตามหมวดให้ดูหน่อย';
    const created = await fixture(text);
    const recentReads = [{
      tool: 'expense.list_recent', answerShape: 'list' as const, asOf: '2026-09-27T23:06:36.944Z',
      period: { fromDate: '2026-09-01', toDate: '2026-09-28' }, documentStatus: 'CONFIRMED',
    }];
    const parsed = parseLineIntakeCompactDecision({
      raw: decision(text, { fromDate: '2026-09-01', toDate: '2026-09-28', groupBy: 'category' }, breakdownSimpleRead(0.91)),
      messageText: text, inputEvidence: created.inputEvidence, enabledTools: ROUTER_ENABLED_TOOLS,
      enabledPreparedFamilies: BREAKDOWN_LIST_FAMILY, language: 'th', recentReads,
    });
    assert.ok(parsed?.preparedPlan, 'the period plus groupBy alone must still ground and prepare');
    assert.equal(parsed.preparedPlan.proposedCalls[0]?.input['documentStatus'], undefined, 'the restart must drop the old documentStatus, never carry it forward');
  });

  it('"เรื่องเดิม…อีกที" (topic word next to อีกที) also drops an earlier paymentStatus', async () => {
    const text = 'เรื่องเดิมที่คุยไว้ ขอดูอีกที แยกตามร้าน';
    const created = await fixture(text);
    const recentReads = [{
      tool: 'expense.get_breakdown', answerShape: 'list' as const, asOf: '2026-09-27T23:11:35.571Z',
      period: { fromDate: '2026-09-01', toDate: '2026-09-28' }, groupBy: 'category' as const, paymentStatus: 'PAID',
    }];
    const parsed = parseLineIntakeCompactDecision({
      raw: decision(text, { fromDate: '2026-09-01', toDate: '2026-09-28', groupBy: 'vendor' }, breakdownSimpleRead()),
      messageText: text, inputEvidence: created.inputEvidence, enabledTools: ROUTER_ENABLED_TOOLS,
      enabledPreparedFamilies: BREAKDOWN_LIST_FAMILY, language: 'th', recentReads,
    });
    assert.ok(parsed?.preparedPlan);
    assert.equal(parsed.preparedPlan.proposedCalls[0]?.input['paymentStatus'], undefined, 'a topic word next to อีกที is a restart, so paymentStatus must not carry');
  });

  it('a bare "อีกที" with no nearby topic word is NOT a restart and still carries (regression guard)', async () => {
    const text = 'แยกตามหมวดอีกทีค่ะ';
    const created = await fixture(text);
    const recentReads = [{
      tool: 'expense.list_recent', answerShape: 'list' as const, asOf: '2026-09-27T23:06:36.944Z',
      period: { fromDate: '2026-09-01', toDate: '2026-09-28' }, documentStatus: 'NEEDS_REVIEW',
    }];
    const parsed = parseLineIntakeCompactDecision({
      raw: decision(text, { fromDate: '2026-09-01', toDate: '2026-09-28', groupBy: 'category' }, breakdownSimpleRead(0.91)),
      messageText: text, inputEvidence: created.inputEvidence, enabledTools: ROUTER_ENABLED_TOOLS,
      enabledPreparedFamilies: BREAKDOWN_LIST_FAMILY, language: 'th', recentReads,
    });
    assert.ok(parsed?.preparedPlan);
    assert.equal(parsed.preparedPlan.proposedCalls[0]?.input['documentStatus'], 'NEEDS_REVIEW', 'an ordinary "again" follow-up with no topic word must keep carrying exactly as before');
  });

  it('"เริ่มใหม่" also blocks the carry, but a status the clause names of its own is untouched either way', async () => {
    const text = 'เริ่มใหม่ค่ะ แยกตามหมวดเฉพาะที่ยืนยันแล้วให้ดูหน่อย';
    const created = await fixture(text);
    const recentReads = [{
      tool: 'expense.list_recent', answerShape: 'list' as const, asOf: '2026-09-27T23:06:36.944Z',
      period: { fromDate: '2026-09-01', toDate: '2026-09-28' }, documentStatus: 'NEEDS_REVIEW',
    }];
    const parsed = parseLineIntakeCompactDecision({
      raw: decision(text, { fromDate: '2026-09-01', toDate: '2026-09-28', groupBy: 'category', documentStatus: 'CONFIRMED' }, breakdownSimpleRead(0.91)),
      messageText: text, inputEvidence: created.inputEvidence, enabledTools: ROUTER_ENABLED_TOOLS,
      enabledPreparedFamilies: BREAKDOWN_LIST_FAMILY, language: 'th', recentReads,
    });
    assert.ok(parsed?.preparedPlan);
    assert.equal(parsed.preparedPlan.proposedCalls[0]?.input['documentStatus'], 'CONFIRMED', 'a status the clause names itself is never blocked by the restart guard');
  });
});

describe('compact LINE intake decision: write clauses and other coverage', () => {
  it('C4: keeps a write clause whose writeIntent no tool supports (e.g. invoicing) instead of failing the whole decision', async () => {
    const text = 'ช่วยออกใบแจ้งหนี้ให้ลูกค้าหน่อยค่ะ';
    const created = await fixture(text);
    const reasons: string[] = [];
    const parsed = parseLineIntakeCompactDecision({
      raw: { subrequests: [{ kind: 'write', goal: 'ออกใบแจ้งหนี้ให้ลูกค้า', sources: [{ part: 0, whole: true }], filters: {}, writeIntent: 'create_invoice' }] },
      messageText: text, inputEvidence: created.inputEvidence, enabledTools: ROUTER_ENABLED_TOOLS,
      enabledPreparedFamilies: PREPARED_FAMILIES, language: 'th',
      onReject: (reason) => reasons.push(reason),
    });
    // The old behavior failed the whole decision here (ROUTER_SEMANTIC_SCHEMA_INVALID, zero coverage).
    assert.deepEqual(reasons, []);
    assert.equal(parsed?.semanticSubrequests.length, 1);
    assert.equal(parsed?.semanticSubrequests[0]?.kind, 'write');
    assert.equal(parsed?.semanticSubrequests[0]?.writeIntent, undefined);
  });

  it('C4: still keeps a recognized writeIntent on a write clause', async () => {
    const text = 'ขอเบิกค่ารถ 200 บาท';
    const created = await fixture(text);
    const parsed = parseLineIntakeCompactDecision({
      raw: { subrequests: [{ kind: 'write', goal: text, sources: [{ part: 0, whole: true }], filters: {}, writeIntent: 'REIMBURSEMENT_REQUEST_START' }] },
      messageText: text, inputEvidence: created.inputEvidence, enabledTools: ROUTER_ENABLED_TOOLS,
      enabledPreparedFamilies: PREPARED_FAMILIES, language: 'th',
    });
    assert.equal(parsed?.semanticSubrequests[0]?.writeIntent, 'REIMBURSEMENT_REQUEST_START');
  });

  it('item 4: drops a writeIntent claimed on a non-write clause instead of failing the whole decision', async () => {
    // The old behavior failed the whole decision here (decision_shape_invalid, ROUTER_SEMANTIC_SCHEMA_INVALID
    // once both repair attempts repeat the same mismatch) — kind is the model's real mistake, not an
    // authority claim: writeIntent grants no execution by itself, so dropping it here is exactly as
    // safe as C4 dropping an unrecognized value above.
    const text = 'ดูค่าใช้จ่ายเดือนนี้';
    const created = await fixture(text);
    const reasons: string[] = [];
    const parsed = parseLineIntakeCompactDecision({
      raw: { subrequests: [{ kind: 'read', goal: text, sources: [{ part: 0, whole: true }], filters: {}, writeIntent: 'REIMBURSEMENT_REQUEST_START' }] },
      messageText: text, inputEvidence: created.inputEvidence, enabledTools: ROUTER_ENABLED_TOOLS,
      enabledPreparedFamilies: PREPARED_FAMILIES, language: 'th',
      onReject: (reason) => reasons.push(reason),
    });
    assert.deepEqual(reasons, []);
    assert.equal(parsed?.semanticSubrequests.length, 1);
    assert.equal(parsed?.semanticSubrequests[0]?.kind, 'read');
    assert.equal(parsed?.semanticSubrequests[0]?.writeIntent, undefined);
  });

  it('item 4 (eval T-144-b): "ช่วยอนุมัติใบเบิกของสมชายให้หน่อยค่ะ" never schema-invalids on a general+writeIntent mismatch', async () => {
    const text = 'ช่วยอนุมัติใบเบิกของสมชายให้หน่อยค่ะ';
    const created = await fixture(text);
    const reasons: string[] = [];
    const parsed = parseLineIntakeCompactDecision({
      raw: { subrequests: [{ kind: 'general', goal: 'อนุมัติใบเบิกของสมชาย', sources: [{ part: 0, whole: true }], filters: {},
        entity: 'สมชาย', writeIntent: 'REIMBURSEMENT_REQUEST_START' }] },
      messageText: text, inputEvidence: created.inputEvidence, enabledTools: ROUTER_ENABLED_TOOLS,
      enabledPreparedFamilies: PREPARED_FAMILIES, language: 'th',
      onReject: (reason) => reasons.push(reason),
    });
    assert.deepEqual(reasons, []);
    assert.equal(parsed?.semanticSubrequests[0]?.kind, 'general');
    assert.equal(parsed?.semanticSubrequests[0]?.writeIntent, undefined);
  });

  it('item 1 (eval T-001#0): rejects a PAID filter the model attached to a plain total-spending question', async () => {
    const text = 'เดือนนี้จ่ายไปเท่าไหร่แล้วคะ';
    const created = await fixture(text);
    const candidates = extractValueCandidates(text, '2026-09-27');
    const period = candidates.periods?.[0]!;
    const parsed = parseLineIntakeCompactDecision({
      raw: decision(text, { fromDate: period.fromDate, toDate: period.toDate, paymentStatus: 'PAID' }),
      messageText: text, inputEvidence: created.inputEvidence, enabledTools: ROUTER_ENABLED_TOOLS,
      enabledPreparedFamilies: PREPARED_FAMILIES, language: 'th', valueCandidates: candidates,
    });
    assert.equal(parsed?.preparedPlan, undefined);
    assert.equal(parsed?.simpleReadRejection, 'filter_not_grounded');
  });

  it('item 1: allows PAID when the message explicitly contrasts payment state (จ่ายแล้วจริงๆ)', async () => {
    const text = 'เดือนนี้ที่จ่ายแล้วจริงๆ เท่าไหร่คะ';
    const created = await fixture(text);
    const candidates = extractValueCandidates(text, '2026-09-27');
    const period = candidates.periods?.[0]!;
    const parsed = parseLineIntakeCompactDecision({
      raw: decision(text, { fromDate: period.fromDate, toDate: period.toDate, paymentStatus: 'PAID' }),
      messageText: text, inputEvidence: created.inputEvidence, enabledTools: ROUTER_ENABLED_TOOLS,
      enabledPreparedFamilies: PREPARED_FAMILIES, language: 'th', valueCandidates: candidates,
    });
    assert.ok(parsed?.preparedPlan);
    assert.equal(parsed.preparedPlan.proposedCalls[0]?.input['paymentStatus'], 'PAID');
  });

  it('item 1: allows UNPAID when the message explicitly contrasts payment state (ยังไม่จ่าย)', async () => {
    const text = 'เดือนนี้ที่ยังไม่จ่ายมีเท่าไหร่คะ';
    const created = await fixture(text);
    const candidates = extractValueCandidates(text, '2026-09-27');
    const period = candidates.periods?.[0]!;
    const parsed = parseLineIntakeCompactDecision({
      raw: decision(text, { fromDate: period.fromDate, toDate: period.toDate, paymentStatus: 'UNPAID' }),
      messageText: text, inputEvidence: created.inputEvidence, enabledTools: ROUTER_ENABLED_TOOLS,
      enabledPreparedFamilies: PREPARED_FAMILIES, language: 'th', valueCandidates: candidates,
    });
    assert.ok(parsed?.preparedPlan);
    assert.equal(parsed.preparedPlan.proposedCalls[0]?.input['paymentStatus'], 'UNPAID');
  });

  it('item 4 (eval T-102/T-103): daily-closing fast lane accepts an implicit "today" with no date filter at all', async () => {
    const text = 'วันนี้มีอะไรต้องทำบ้างคะ';
    const created = await fixture(text);
    const parsed = parseLineIntakeCompactDecision({
      raw: decision(text, {}, { subrequest: 0, tool: 'expense.get_daily_closing', subject: 'expense', agent: 'accounting', answerShape: 'single_metric', confidence: 0.95 }),
      messageText: text, inputEvidence: created.inputEvidence, enabledTools: ROUTER_ENABLED_TOOLS,
      enabledPreparedFamilies: new Set(['expense.get_daily_closing::single_metric']), language: 'th',
    });
    assert.ok(parsed?.preparedPlan);
    assert.deepEqual(parsed.preparedPlan.proposedCalls[0]?.input, {});
  });

  it('item 4 (eval T-104): grounds an explicit daily-closing "date" filter against a real today candidate', async () => {
    const text = 'closing วันนี้เป็นไงบ้างคะ';
    const created = await fixture(text);
    const candidates = extractValueCandidates(text, '2026-09-27');
    // "วันนี้" extracts as a one-day PERIOD (fromDate === toDate), never a `dates` candidate.
    const today = candidates.periods?.[0]?.fromDate;
    assert.equal(today, '2026-09-27');
    const parsed = parseLineIntakeCompactDecision({
      raw: decision(text, { date: today }, { subrequest: 0, tool: 'expense.get_daily_closing', subject: 'expense', agent: 'accounting', answerShape: 'single_metric', confidence: 0.95 }),
      messageText: text, inputEvidence: created.inputEvidence, enabledTools: ROUTER_ENABLED_TOOLS,
      enabledPreparedFamilies: new Set(['expense.get_daily_closing::single_metric']), language: 'th', valueCandidates: candidates,
    });
    assert.ok(parsed?.preparedPlan);
    assert.equal(parsed.preparedPlan.proposedCalls[0]?.input['date'], today);
  });

  it('item 4: rejects a daily-closing "date" the message never grounds', async () => {
    const text = 'closing วันนี้เป็นไงบ้างคะ';
    const created = await fixture(text);
    const candidates = extractValueCandidates(text, '2026-09-27');
    const parsed = parseLineIntakeCompactDecision({
      raw: decision(text, { date: '2026-08-15' }, { subrequest: 0, tool: 'expense.get_daily_closing', subject: 'expense', agent: 'accounting', answerShape: 'single_metric', confidence: 0.95 }),
      messageText: text, inputEvidence: created.inputEvidence, enabledTools: ROUTER_ENABLED_TOOLS,
      enabledPreparedFamilies: new Set(['expense.get_daily_closing::single_metric']), language: 'th', valueCandidates: candidates,
    });
    assert.equal(parsed?.preparedPlan, undefined);
    assert.equal(parsed?.simpleReadRejection, 'filter_not_grounded');
  });
});

describe('tuning-5b: confidence floor, why/compare/advice guard, and derived subject/agent/shape', () => {
  it('B3 (eval T-107-b): a why-question never takes the fast lane even with a single period and high confidence', async () => {
    const text = 'ทำไมค่าเดินทางเดือนนี้พุ่งขนาดนี้คะ';
    const created = await fixture(text);
    const candidates = extractValueCandidates(text, '2026-09-27');
    const period = candidates.periods?.[0]!;
    const parsed = parseLineIntakeCompactDecision({
      raw: decision(text, { fromDate: period.fromDate, toDate: period.toDate, categoryName: 'ค่าเดินทาง' }),
      messageText: text, inputEvidence: created.inputEvidence, enabledTools: ROUTER_ENABLED_TOOLS,
      enabledPreparedFamilies: PREPARED_FAMILIES, language: 'th', valueCandidates: candidates,
    });
    assert.equal(parsed?.preparedPlan, undefined);
    assert.equal(parsed?.simpleReadRejection, 'why_compare_advice_question');
    assert.equal(parsed?.semanticSubrequests.length, 1, 'the full clause still survives for normal planning');
  });

  it('B3: an advice question ("ควร") is also blocked from the fast lane', async () => {
    const text = 'เดือนนี้ควรลดค่าใช้จ่ายหมวดไหนดีคะ';
    const created = await fixture(text);
    const parsed = parseLineIntakeCompactDecision({
      raw: decision(text, {}),
      messageText: text, inputEvidence: created.inputEvidence, enabledTools: ROUTER_ENABLED_TOOLS,
      enabledPreparedFamilies: PREPARED_FAMILIES, language: 'th',
    });
    assert.equal(parsed?.preparedPlan, undefined);
    assert.equal(parsed?.simpleReadRejection, 'why_compare_advice_question');
  });

  it('UAT 2026-09-29: a draft list that also asks "any problem?" is not a fast-lane list', async () => {
    // Routed prepared at UAT, then answered "ยังดึงข้อมูลส่วนนี้ไม่ได้" with zero calls: no list formatter can
    // say what is wrong with each draft, so the question keeps the full path.
    const text = 'ร่างค่าใช้จ่ายมีอะไรบ้าง ติดปัญหาอะไรไหม';
    const created = await fixture(text);
    const parsed = parseLineIntakeCompactDecision({
      raw: decision(text, { documentStatus: 'draft' }, { subrequest: 0, tool: 'expense.list_recent', answerShape: 'list', confidence: 0.9 }),
      messageText: text, inputEvidence: created.inputEvidence, enabledTools: ROUTER_ENABLED_TOOLS,
      enabledPreparedFamilies: PREPARED_FAMILIES, language: 'th',
    });
    assert.equal(parsed?.preparedPlan, undefined);
    assert.equal(parsed?.simpleReadRejection, 'why_compare_advice_question');
    assert.equal(parsed?.semanticSubrequests.length, 1, 'the question itself still reaches normal planning');
  });

  it('B3a (eval T-090-a): a 0.75-0.85 simple read now reaches a preparedPlan (0.70 is still invalid_simple_shape)', async () => {
    // The shared contract floor (LINE_AI_PREPARED_PLAN_BOUNDS.simpleConfidenceFloor) moved 0.85 -> 0.75
    // together with this decoder's own floor, so 0.80 now builds a plan end to end.
    const text = 'ใบเบิกที่ขอไปได้รึยังอ่ะคะ';
    const created = await fixture(text);
    const families = new Set(['reimbursement.get_summary::single_metric']);
    const simpleReadAt = (confidence: number) => ({
      subrequest: 0, tool: 'reimbursement.get_summary', subject: 'reimbursement', agent: 'accounting', answerShape: 'single_metric', confidence,
    });

    const clearsThisGate = parseLineIntakeCompactDecision({
      raw: decision(text, {}, simpleReadAt(0.80)),
      messageText: text, inputEvidence: created.inputEvidence, enabledTools: ROUTER_ENABLED_TOOLS,
      enabledPreparedFamilies: families, language: 'th',
    });
    assert.equal(clearsThisGate?.simpleReadRejection, undefined);
    assert.equal(clearsThisGate?.preparedPlan?.confidence, 0.80);

    const rejected = parseLineIntakeCompactDecision({
      raw: decision(text, {}, simpleReadAt(0.70)),
      messageText: text, inputEvidence: created.inputEvidence, enabledTools: ROUTER_ENABLED_TOOLS,
      enabledPreparedFamilies: families, language: 'th',
    });
    assert.equal(rejected?.preparedPlan, undefined);
    assert.equal(rejected?.simpleReadRejection, 'invalid_simple_shape', '0.70 is still below this file\'s own 0.75 floor');
  });

  it('B1c/B2 (eval T-143-a): derives subject/agent/answerShape from the registry, ignoring a mismatched model value', async () => {
    const text = 'ใบเบิกของฉันถึงไหนแล้ว';
    const created = await fixture(text);
    const families = new Set(['reimbursement.get_summary::single_metric']);
    // The model sends agent "general" (never listed first for this tool) and answerShape "list" (this
    // tool's only enabled family is single_metric) — both used to reject; both are now ignored/normalized.
    const parsed = parseLineIntakeCompactDecision({
      raw: decision(text, {}, { subrequest: 0, tool: 'reimbursement.get_summary', subject: 'reimbursement', agent: 'general', answerShape: 'list', confidence: 0.9 }),
      messageText: text, inputEvidence: created.inputEvidence, enabledTools: ROUTER_ENABLED_TOOLS,
      enabledPreparedFamilies: families, language: 'th',
    });
    assert.ok(parsed?.preparedPlan);
    assert.equal(parsed.preparedPlan.answerShape, 'single_metric');
    assert.equal(parsed.preparedPlan.intentPlan.intents[0]?.agent, 'accounting');
    assert.equal(parsed.preparedPlan.intentPlan.intents[0]?.subject, 'reimbursement');
  });

  it('B4e (eval T-004-b): a filter-removal phrase drops a documentStatus the carry logic would otherwise re-add', async () => {
    const text = 'ไม่เอาตัวกรองแล้วครับ ดูรวมทุกสถานะเลย';
    const created = await fixture(text);
    const recentReads = [{
      tool: 'expense.list_recent', answerShape: 'list' as const, asOf: '2026-09-28T02:00:00.000Z',
      period: { fromDate: '2026-09-01', toDate: '2026-09-28' }, documentStatus: 'NEEDS_REVIEW',
    }];
    const breakdownListFamily = new Set(['expense.get_breakdown::list']);
    const parsed = parseLineIntakeCompactDecision({
      raw: decision(text, { fromDate: '2026-09-01', toDate: '2026-09-28', groupBy: 'category' },
        { subrequest: 0, tool: 'expense.get_breakdown', subject: 'expense', agent: 'accounting', answerShape: 'list', confidence: 0.9 }),
      messageText: text, inputEvidence: created.inputEvidence, enabledTools: ROUTER_ENABLED_TOOLS,
      enabledPreparedFamilies: breakdownListFamily, language: 'th', recentReads,
    });
    assert.ok(parsed?.preparedPlan, 'period + groupBy alone are still grounded and gave a valid plan');
    assert.equal(parsed.preparedPlan.proposedCalls[0]?.input['documentStatus'], undefined,
      'the removal phrase must win over the recentReads carry');
    assert.equal(parsed.preparedPlan.proposedCalls[0]?.input['groupBy'], 'category', 'grouping itself is untouched');
  });
});
