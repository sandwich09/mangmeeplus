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
    assert.equal(parsed?.simpleReadRejection, 'filter_not_grounded');
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

  it('still rejects a writeIntent claimed on a non-write clause (structural inconsistency, not an unsupported value)', async () => {
    const text = 'ดูค่าใช้จ่ายเดือนนี้';
    const created = await fixture(text);
    const reasons: string[] = [];
    const parsed = parseLineIntakeCompactDecision({
      raw: { subrequests: [{ kind: 'read', goal: text, sources: [{ part: 0, whole: true }], filters: {}, writeIntent: 'REIMBURSEMENT_REQUEST_START' }] },
      messageText: text, inputEvidence: created.inputEvidence, enabledTools: ROUTER_ENABLED_TOOLS,
      enabledPreparedFamilies: PREPARED_FAMILIES, language: 'th',
      onReject: (reason) => reasons.push(reason),
    });
    assert.equal(parsed, undefined);
    assert.deepEqual(reasons, ['decision_shape_invalid']);
  });
});
