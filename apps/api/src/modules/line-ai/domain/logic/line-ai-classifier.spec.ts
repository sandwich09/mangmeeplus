import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLineText, classifyIntent, chooseAgent, hashMessagePreview, parseBareCompanySelection, parseLineCompanyCommand, isPendingFieldAnswer, lineWorkflowPickerText, isLineWorkflowCountRead } from './line-ai-classifier.logic';

describe('normalizeLineText', () => {
  it('trims and collapses whitespace', () => {
    assert.equal(normalizeLineText('  hello   world  '), 'hello world');
  });
  it('lowercases text', () => {
    assert.equal(normalizeLineText('Hello World'), 'hello world');
  });
});

describe('classifyIntent', () => {
  it('returns mutation_request for Thai mutation keyword', () => {
    assert.equal(classifyIntent('ชำระเงิน'), 'mutation_request');
  });
  it('returns mutation_request for English mutation keyword', () => {
    assert.equal(classifyIntent('please approve this'), 'mutation_request');
  });
  it('returns unsupported_module for accounting keyword', () => {
    assert.equal(classifyIntent('ดูบัญชีบริษัท'), 'unsupported_module');
  });
  it('returns unsupported_module for Thai payroll keyword', () => {
    assert.equal(classifyIntent('เงินเดือนเดือนนี้'), 'unsupported_module');
  });
  it('returns read_detail for inventory keyword', () => {
    assert.equal(classifyIntent('ดูสต็อกสินค้า'), 'read_detail');
  });
  it('returns read_detail for stock keyword in English', () => {
    assert.equal(classifyIntent('check stock balance'), 'read_detail');
  });
  it('returns read_summary for notification keyword', () => {
    assert.equal(classifyIntent('มีแจ้งเตือนอะไรบ้าง'), 'read_summary');
  });
  it('returns read_summary for unknown general query', () => {
    assert.equal(classifyIntent('how is business today'), 'read_summary');
  });
});

describe('chooseAgent', () => {
  it('returns inventory agent for inventory intent', () => {
    assert.equal(chooseAgent('read_detail', 'ดูสต็อก'), 'inventory');
  });
  it('returns notifications agent for alert text', () => {
    assert.equal(chooseAgent('read_summary', 'มีการแจ้งเตือน'), 'notifications');
  });
  it('returns general for mutation_request', () => {
    assert.equal(chooseAgent('mutation_request', 'ชำระเงิน'), 'general');
  });
  it('returns general for unsupported_module', () => {
    assert.equal(chooseAgent('unsupported_module', 'บัญชี'), 'general');
  });
  it('returns general for generic text', () => {
    assert.equal(chooseAgent('read_summary', 'ธุรกิจเป็นยังไงบ้าง'), 'general');
  });
});

describe('hashMessagePreview', () => {
  it('returns 16-char hex string', () => {
    const h = hashMessagePreview('hello world');
    assert.equal(h.length, 16);
    assert.match(h, /^[0-9a-f]+$/);
  });
  it('is deterministic', () => {
    assert.equal(hashMessagePreview('same text'), hashMessagePreview('same text'));
  });
  it('differs for different text', () => {
    assert.notEqual(hashMessagePreview('text a'), hashMessagePreview('text b'));
  });
});

describe('parseLineCompanyCommand', () => {
  it('parses the list form', () => {
    assert.deepEqual(parseLineCompanyCommand('/companies'), { kind: 'list' });
    assert.deepEqual(parseLineCompanyCommand(' /company '), { kind: 'list' });
    assert.deepEqual(parseLineCompanyCommand(' เปลี่ยนบริษัท '), { kind: 'list' });
    assert.deepEqual(parseLineCompanyCommand('/companies page 2'), { kind: 'list', page: 2 });
  });
  it('parses the select form with index or id', () => {
    assert.deepEqual(parseLineCompanyCommand('/company 2'), { kind: 'select', value: '2' });
    assert.deepEqual(parseLineCompanyCommand('/company comp-abc'), { kind: 'select', value: 'comp-abc' });
  });
  it('returns null for normal text and non-leading slash', () => {
    assert.equal(parseLineCompanyCommand('ขอรายชื่อลูกค้า'), null);
    assert.equal(parseLineCompanyCommand('ขอ /company 2'), null);
  });
});

describe('parseBareCompanySelection', () => {
  it('accepts one bare Arabic or Thai number as a selection candidate', () => {
    assert.deepEqual(parseBareCompanySelection(' 2 '), { kind: 'select', value: '2' });
    assert.deepEqual(parseBareCompanySelection('๒'), { kind: 'select', value: '2' });
    assert.equal(parseBareCompanySelection('บริษัท 2'), null);
    assert.equal(parseBareCompanySelection('1 2 3'), null);
  });
});

for (const [text, description, amount, date] of [
    ['ค่าแท็กซี่ 250 บาท เมื่อวาน', 'ค่าแท็กซี่', '250', '2026-11-03'],
    ['ค่าแท็กซี่ 250 บาท', 'ค่าแท็กซี่', '250', undefined],
    ['ค่าแท็กซี่ 250 บาท 3/11', 'ค่าแท็กซี่', '250', '2026-11-03'],
    ['ค่าแท็กซี่ 250 บาท 28/12', 'ค่าแท็กซี่', '250', '2025-12-28'],
    ['ค่าแท็กซี่ ๒๕๐ บาท ๓/๑๑', 'ค่าแท็กซี่', '250', '2026-11-03'],
    ['ค่าแท็กซี่ 250 บาท 3 พ.ย.', 'ค่าแท็กซี่', '250', '2026-11-03'],
    ['Taxi fare 250 บาท เมื่อวานค่ะ', 'Taxi fare', '250', '2026-11-03'],
  ]) {
  it(`R5 manual claim USER_TEXT proofs: ${text}`, async () => {
    const { createLineAiInputEvidence, extractValueCandidatesV2, parseLineReimbursementDraftProposalV1 } = await import('@watchdog-bms/contracts');
    const { parseManualClaimLine } = await import('./line-ai-classifier.logic');
    const evidence = (await createLineAiInputEvidence({ turnKey: 'manual-line', parts: [{ partId: 'part', eventIdHash: 'a'.repeat(64), acceptedAtMs: Date.now(), rawText: text! }] }))!.inputEvidence;
    const candidates = (await extractValueCandidatesV2(evidence, '2026-11-04'))!;
    const parsed = await parseManualClaimLine(evidence, candidates);
    assert.ok(parsed);
    assert.equal(parsed.values.description?.value, description);
    assert.equal(parsed.values.amount?.value, amount);
    assert.equal(parsed.values.incurredDate?.value, date);
    assert.equal(parsed.question, undefined);
    for (const value of Object.values(parsed.values)) if (value && typeof value === 'object') assert.equal(value.proof.kind, 'USER_TEXT');
    const candidateValues = Object.fromEntries([...candidates.amounts.map(item => [item.candidateId, item.value]),
      ...candidates.dates.map(item => [item.candidateId, item.isoDate]), ...candidates.periods.map(item => [item.candidateId, item.fromDate])]);
    const candidateSources = Object.fromEntries([...candidates.amounts, ...candidates.dates, ...candidates.periods].map(item => [item.candidateId, item.source]));
    assert.ok(parseLineReimbursementDraftProposalV1({ schemaVersion: 1, taskId: '018fbad0-4d4e-7cc7-8e43-0123456789ac', taskRevision: 0,
      operation: 'CREATE', fields: {}, lineChanges: [{ operation: 'ADD', values: parsed.values }] }, { evidence, candidateValues, candidateSources }));
    assert.equal(await parseManualClaimLine(evidence, { ...candidates, inputDigest: 'b'.repeat(64) }), null);
  });
}

it('R5 manual claim line asks one missing-field question without choosing among amounts', async () => {
  const { createLineAiInputEvidence, extractValueCandidatesV2 } = await import('@watchdog-bms/contracts');
  const { parseManualClaimLine } = await import('./line-ai-classifier.logic');
  for (const [text, question] of [['ค่าแท็กซี่ 100 บาท หรือ 250 บาท', 'รายการนี้ยอดเท่าไรคะ'], ['250 บาทค่ะ', 'เป็นค่าอะไรคะ'], ['ค่าแท็กซี่', 'ยอดเท่าไรคะ']]) {
    const evidence = (await createLineAiInputEvidence({ turnKey: 'manual-missing', parts: [{ partId: 'part', eventIdHash: 'a'.repeat(64), acceptedAtMs: Date.now(), rawText: text! }] }))!.inputEvidence;
    const candidates = (await extractValueCandidatesV2(evidence, '2026-11-04'))!;
    const parsed = await parseManualClaimLine(evidence, candidates);
    assert.ok(parsed);
    assert.equal(parsed.question, question);
    if (candidates.amounts.length > 1) {
      assert.equal(parsed.values.amount, undefined);
      assert.equal(parsed.amountChoices.length, 2);
    }
  }
});

it('A3b pending field guard accepts numbered addresses and rejects questions and new commands', async () => {
  for (const text of ['88 ถนนสีลม', 'ไปพบลูกค้า', 'Taxi fare 250 บาท']) assert.equal(isPendingFieldAnswer(text, 'claim'), true, text);
  for (const text of ['ทำอะไรได้บ้าง', 'ค่ารถ 250 บาทเบิกได้ไหม', 'What is VAT?', 'ช่วยสร้างใบเบิก', 'ติดต่อเจ้าหน้าที่', '']) assert.equal(isPendingFieldAnswer(text, 'claim'), false, text);
});


it('A3b reason fields accept command verbs as ordinary words and reject exact commands', () => {
  for (const text of ['บันทึกซ้ำ', 'ยกเลิกการซื้อ', 'ซื้อผิด', 'แก้ยอดผิด']) {
    assert.equal(isPendingFieldAnswer(text, 'reason'), true, text);
    assert.equal(isPendingFieldAnswer(text, 'claim'), text === 'ซื้อผิด', text);
  }
  for (const text of ['ยกเลิก', 'ไม่ทำแล้ว', 'บันทึกรายจ่าย', 'ทำใบเบิกให้หน่อย', 'ติดต่อเจ้าหน้าที่', 'ใบเบิกคืออะไร', 'เมนูหลัก', 'ช่วยสร้างใบเบิกให้หน่อย'])
    assert.equal(isPendingFieldAnswer(text, 'reason'), false, text);
  assert.equal(isPendingFieldAnswer('88 ถนนสีลม', 'payee'), true);
});

it('R8 picker text reads requester names up to the next locator and treats Thai questions as questions', () => {
  for (const [text, name] of [['ของสมชายยอด 1,877 บาท', 'สมชาย'], ['ของสมชายรอบ 12 ยอด 2721', 'สมชาย'], ['ของสมชาย ใจดี สาขา 2', 'สมชาย'], ['ของสมชายนะคะ', 'สมชาย'], ['ของฉันรอบ 1', 'ฉัน']] as const)
    assert.equal(lineWorkflowPickerText(text, true).requester, name, text);
  assert.equal(lineWorkflowPickerText('ของสมชาย', false).requester, undefined);
  for (const text of ['ใบแรกใครเป็นคนเบิกคะ', 'อันนี้จ่ายรึยัง', 'ทำไมยอดไม่ตรง', 'ใบนี้ยังไง?']) assert.equal(lineWorkflowPickerText(text).question, true, text);
  for (const text of ['อนุมัติใบแรกหน่อยได้ไหม', 'ใบเลขที่ ทดสอบ-0003 ค่ะ', 'อันที่ 2']) assert.equal(lineWorkflowPickerText(text).question, false, text);
  // Everyday words that contain a question word are answers, not questions.
  for (const text of ['เบิกค่าน้ำเปล่า 30 บาท', 'ค่าใช้จ่ายเกี่ยวกับงานลูกค้า', 'ค่าผ้าไหม 500 บ.', 'ซื้อไหมพรม 2 ม้วน']) {
    assert.equal(lineWorkflowPickerText(text).question, false, text);
    assert.equal(isPendingFieldAnswer(text, 'reason'), true, text);
  }
  for (const text of ['ใช้ได้หรือเปล่า', 'ใบที่ 1 เปล่า', 'ต้องแนบกี่ใบ', 'ใส่ชื่อร้านได้ไหม']) assert.equal(lineWorkflowPickerText(text).question, true, text);
  assert.equal(lineWorkflowPickerText('อันแรกเลยค่ะ').ordinal, 1);
  assert.equal(isLineWorkflowCountRead('ตอนนี้มีใบเบิกรออนุมัติกี่ใบ รวมเท่าไหร่'), true);
  assert.equal(isLineWorkflowCountRead('อนุมัติใบเบิก 1,877 บาทให้หน่อย'), false);
  assert.equal(isLineWorkflowCountRead('มีใบเบิกรออนุมัติไหม'), false);
});

it('R12 manual claims accept abbreviated baht and never collect a question as a field', async () => {
  const { createLineAiInputEvidence, extractValueCandidatesV2 } = await import('@watchdog-bms/contracts');
  const { parseManualClaimLine } = await import('./line-ai-classifier.logic');
  for (const text of ['เบิกค่าจอดรถ 60 บ. วันนี้', 'เบิกค่าจอดรถ 60บ วันนี้']) {
    const evidence = (await createLineAiInputEvidence({ turnKey: 'r12', parts: [{ partId: 'part-0', eventIdHash: 'a'.repeat(64), acceptedAtMs: Date.now(), rawText: text }] }))!.inputEvidence;
    const parsed = await parseManualClaimLine(evidence, (await extractValueCandidatesV2(evidence, '2026-11-06'))!);
    assert.equal(Number(parsed?.values.amount?.value), 60);
  }
  for (const field of ['claim', 'payee', 'reason'] as const) for (const text of ['ชื่อผู้รับเงินใส่ชื่อร้านได้ไหม', 'ถ้าต้องเลือกหมวดอะไรให้บอกด้วย', 'ยอดค้างทั้งหมดเท่าไหร่', 'Can the payee be a shop name', 'ขอถามว่าชื่อผู้รับเงินใส่ชื่อร้านได้ไหม'])
    assert.equal(isPendingFieldAnswer(text, field), false, `${field}: ${text}`);
});

it('R12 repair descriptions and indefinite answers are not side questions', () => {
  assert.equal(lineWorkflowPickerText('ค่าปะยาง').question, false);
  assert.equal(lineWorkflowPickerText('อะไรก็ได้').question, false);
});

it('R12 a pending expense price accepts abbreviated baht', async () => {
  const { buildInitialLineExpenseDraftContinuation, applyLineExpenseDraftAnswer } = await import('../../../expenses/domain/logic/line-expense-draft-conversation.logic');
  const categories: any[] = [{ id: 'cat-office', companyId: 'c1', name: 'กระดาษ', status: 'ACTIVE', sortOrder: 1 }];
  for (const messageText of ['60 บ.', '60บ']) {
    const state = buildInitialLineExpenseDraftContinuation({ workflowId: 'wf-price', companyId: 'c1', userId: 'u1', expenseId: 'e1', chatKeyHash: 'chat', targetRevision: '2026-08-18T00:00:00.000Z', provisionalExpenseDate: '2026-08-18', messageText: 'ซื้อกระดาษ', webhookEventId: 'price', categories, now: '2026-08-18T01:00:00.000Z', hints: { confidence: 1, description: 'กระดาษ' } });
    assert.equal(state.items.length, 1);
    const result = applyLineExpenseDraftAnswer({ state, messageText, categories, now: '2026-08-18T02:00:00.000Z' });
    assert.equal(Number(result.state.items[0]!.totalAmount), 60, messageText);
  }
});

it('R12 expense free-text and model hints cannot turn questions into draft fields', async () => {
  const { buildInitialLineExpenseDraftContinuation, applyLineExpenseDraftAnswer } = await import('../../../expenses/domain/logic/line-expense-draft-conversation.logic');
  const state = buildInitialLineExpenseDraftContinuation({ workflowId: 'wf-question', companyId: 'c1', userId: 'u1', expenseId: 'e1', chatKeyHash: 'chat', targetRevision: '2026-08-18T00:00:00.000Z', provisionalExpenseDate: '2026-08-18', messageText: 'ซื้อกระดาษ', webhookEventId: 'question', categories: [], now: '2026-08-18T01:00:00.000Z', hints: { confidence: 1, description: 'กระดาษ' } });
  const result = applyLineExpenseDraftAnswer({ state, messageText: 'ร้าน ใส่ชื่อใครคะ', hints: { confidence: 1, businessPurpose: 'ใส่ชื่อใครคะ' }, categories: [] });
  assert.equal(result.state.header.vendorName, undefined); assert.equal(result.state.header.businessPurpose, undefined);
  assert.deepEqual(result.acceptedFields, []);
});

it('R13 date parts never compete with the explicitly denominated claim amount', async () => {
  const { createLineAiInputEvidence, extractValueCandidatesV2 } = await import('@watchdog-bms/contracts');
  const { parseManualClaimLine } = await import('./line-ai-classifier.logic');
  for (const date of ['วัน 5 เดือนนี้', 'วันที่ 5', '5 พ.ย.', '5/11']) {
    const text = `สร้างใบเบิกค่ารถ 260 บ. ${date}`;
    const evidence = (await createLineAiInputEvidence({ turnKey: 'r13', parts: [{ partId: 'p', eventIdHash: 'a'.repeat(64), acceptedAtMs: Date.now(), rawText: text }] }))!.inputEvidence;
    const parsed = await parseManualClaimLine(evidence, (await extractValueCandidatesV2(evidence, '2026-11-07'))!);
    assert.equal(Number(parsed?.values.amount?.value), 260, date);
    assert.equal(parsed?.values.incurredDate?.value, '2026-11-05', date);
    assert.equal(parsed?.amountChoices.length, 0);
  }
});

it('R13 self-reference is never treated as another requester name', () => {
  for (const self of ['ฉัน', 'ผม', 'ผมเอง', 'เรา', 'ตัวเอง', 'หนู', 'เค้า'])
    for (const text of [`ค่าออฟฟิศ รอบ 3 ของ${self}`, `ค่าออฟฟิศรอบ3ของ${self}`])
      assert.equal(lineWorkflowPickerText(text, true).requester, 'ฉัน');
});

it('R13 a claim number is a locator rather than a claim amount', async () => {
  const { createLineAiInputEvidence, extractValueCandidatesV2 } = await import('@watchdog-bms/contracts');
  const { matchLineClaimTargets } = await import('./line-ai-classifier.logic');
  const text = 'ใบเบิกเลขที่ RB-0002';
  const evidence = (await createLineAiInputEvidence({ turnKey: 'r13-number', parts: [{ partId: 'p', eventIdHash: 'a'.repeat(64), acceptedAtMs: Date.now(), rawText: text }] }))!.inputEvidence;
  const candidates = (await extractValueCandidatesV2(evidence, '2026-11-07'))!;
  const row = { id: 'claim', requestNo: 'RB-0002', amount: '1877', currency: 'THB' };
  assert.deepEqual(matchLineClaimTargets(text, [row], candidates.amounts, 'user'), [row]);
});
