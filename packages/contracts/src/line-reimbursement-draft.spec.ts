import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLineAiInputEvidence } from './line-ai-input-evidence.js';
import {
  LINE_REIMBURSEMENT_DRAFT_LIMITS,
  parseLineReimbursementDraftControlV1,
  parseLineReimbursementDraftProposalV1,
  parseLineReimbursementSourceProofV1,
} from './line-reimbursement-draft.js';
import { LINE_REIMBURSEMENT_DRAFT_TOOL_NAMES, LINE_TOOL_REGISTRY, lineToolRegistryFor } from './ai-tools.js';

const hash = 'a'.repeat(64);
const taskId = '018fbad0-4d4e-7cc7-8e43-0123456789ab';
const actionId = '018fbad0-4d4e-7cc7-8e43-0123456789ac';

describe('Line reimbursement draft contract', () => {
  it('offers only the three preview/options tools and keeps them default-off', () => {
    const reimbursementDraftTools = LINE_TOOL_REGISTRY.filter(tool => tool.name.startsWith('reimbursement.draft.'));
    assert.deepEqual(reimbursementDraftTools.map(tool => tool.name), [...LINE_REIMBURSEMENT_DRAFT_TOOL_NAMES]);
    assert.deepEqual(lineToolRegistryFor().filter(tool => tool.name.startsWith('reimbursement.draft.')), []);
    assert.deepEqual(lineToolRegistryFor({ reimbursementDraftWriteEnabled: true })
      .filter(tool => tool.name.startsWith('reimbursement.draft.')).map(tool => tool.name), [...LINE_REIMBURSEMENT_DRAFT_TOOL_NAMES]);
    assert.equal(reimbursementDraftTools.some(tool => ['approval_request', 'final_mutation'].includes(tool.category)), false);
  });

  it('keeps exact text/candidate provenance and rejects model-minted numeric readings', async () => {
    const built = await createLineAiInputEvidence({
      turnKey: 'turn:claim',
      parts: [{ partId: 'p1', eventIdHash: hash, acceptedAtMs: 1, rawText: 'ค่าทางด่วน 120 บาท ไปพบลูกค้า' }],
    });
    assert.ok(built);
    const part = built.inputEvidence.parts[0]!;
    const amountStart = part.rawText.indexOf('120');
    const description = 'ค่าทางด่วน';
    const candidateId = 'b'.repeat(64);
    const ref = (startUtf16: number, endUtf16: number) => ({ partId: part.partId, startUtf16, endUtf16, rawSha256: part.rawSha256 });
    const proposal = {
      schemaVersion: 1, taskId, taskRevision: 1, operation: 'CREATE', fields: {
        reason: { value: 'ไปพบลูกค้า', proof: { kind: 'USER_TEXT', refs: [ref(part.rawText.indexOf('ไป'), part.rawText.length)] } },
      },
      lineChanges: [{ operation: 'ADD', values: {
        description: { value: description, proof: { kind: 'USER_TEXT', refs: [ref(0, description.length)] } },
        amount: { value: '120', proof: { kind: 'USER_TEXT', refs: [ref(amountStart, amountStart + 3)], candidateId } },
      } }],
    };
    assert.ok(parseLineReimbursementDraftProposalV1(proposal, { evidence: built.inputEvidence, candidateValues: { [candidateId]: '120' }, candidateSources: { [candidateId]: ref(amountStart, amountStart + 3) } }));
    // Real model, 2026-11-05: a first claim message without an amount arrived as `amount: null`.
    // A bare null is "not given"; it must not block the typed description, and adds no value.
    const unknownAmount = parseLineReimbursementDraftProposalV1({ ...proposal, fields: { reason: null, title: null }, lineChanges: [{ operation: 'ADD', values: {
      description: proposal.lineChanges[0]!.values.description, amount: null, incurredDate: null, purpose: null, categoryChoiceId: null } }] }, { evidence: built.inputEvidence });
    assert.ok(unknownAmount);
    assert.deepEqual(unknownAmount.fields, {});
    assert.deepEqual(Object.keys(unknownAmount.lineChanges![0]!.operation === 'ADD' ? unknownAmount.lineChanges![0]!.values : {}).sort(), ['categoryChoiceId', 'description']);
    assert.equal(parseLineReimbursementDraftProposalV1({ ...proposal, lineChanges: [{ ...proposal.lineChanges[0], values: { ...proposal.lineChanges[0]!.values, amount: { ...proposal.lineChanges[0]!.values.amount, value: '999' } } }] }, { evidence: built.inputEvidence, candidateValues: { [candidateId]: '120' }, candidateSources: { [candidateId]: ref(amountStart, amountStart + 3) } }), undefined);
  });

  it('rejects unknown fields, over-limit values, duplicate line refs and non-exact controls', async () => {
    const built = await createLineAiInputEvidence({ turnKey: 'turn:limits', parts: [{ partId: 'p', eventIdHash: hash, acceptedAtMs: 1, rawText: 'เหตุผล' }] });
    assert.ok(built);
    const ref = { partId: 'p', startUtf16: 0, endUtf16: 6, rawSha256: built.inputEvidence.parts[0]!.rawSha256 };
    const base = { schemaVersion: 1, taskId, taskRevision: 1, operation: 'UPDATE', targetRef: 'target-1', fields: {} };
    assert.ok(parseLineReimbursementDraftProposalV1({ ...base, lineChanges: [
      { operation: 'REMOVE', lineRef: 'api-line-ref-1', proof: { kind: 'USER_TEXT', refs: [ref] } },
    ] }, { evidence: built.inputEvidence }), 'human removal proof is exact without pretending the user typed the opaque line ref');
    assert.equal(parseLineReimbursementDraftProposalV1({ ...base, extra: true }, { evidence: built.inputEvidence }), undefined);
    assert.equal(parseLineReimbursementDraftProposalV1({ ...base, fields: { title: { value: 'x'.repeat(LINE_REIMBURSEMENT_DRAFT_LIMITS.titleUtf16 + 1), proof: { kind: 'USER_TEXT', refs: [ref] } } } }, { evidence: built.inputEvidence }), undefined);
    assert.equal(parseLineReimbursementDraftProposalV1({ ...base, lineChanges: [
      { operation: 'REMOVE', lineRef: 'line-1', proof: { kind: 'USER_TEXT', refs: [ref] } },
      { operation: 'SET', lineRef: 'line-1', values: { purpose: { value: 'เหตุผล', proof: { kind: 'USER_TEXT', refs: [ref] } } } },
    ] }, { evidence: built.inputEvidence }), undefined);

    const control = { action: 'reimbursement_draft_confirm', actionId, previewRevision: 2, confirmationDigest: hash };
    assert.deepEqual(parseLineReimbursementDraftControlV1(control), control);
    assert.equal(parseLineReimbursementDraftControlV1({ ...control, requestId: 'model-minted' }), undefined);
    assert.equal(parseLineReimbursementDraftControlV1({ ...control, previewRevision: 1.5 }), undefined);
  });

  it('accepts only API validation receipts with typed proof variants and unique paths', () => {
    const receipt = { fieldPath: 'lines.0.amount', valueDigest: hash, validatedAt: '2026-09-27T04:00:00.000Z',
      proof: { kind: 'ATTACHMENT', attachmentRef: 'att-1', revision: 'r1', page: 1, extractionRef: 'x1', fieldPath: 'total' } };
    assert.deepEqual(parseLineReimbursementSourceProofV1({ schemaVersion: 1, receipts: [receipt] }), { schemaVersion: 1, receipts: [receipt] });
    assert.equal(parseLineReimbursementSourceProofV1({ schemaVersion: 1, receipts: [receipt, receipt] }), undefined);
    assert.equal(parseLineReimbursementSourceProofV1({ schemaVersion: 1, receipts: [{ ...receipt, rawText: 'must not persist' }] }), undefined);
  });

  it('enforces the exact 200/1000/500 UTF-16 field boundaries', async () => {
    const parts = [
      ['title-ok', 't'.repeat(200)], ['title-long', 't'.repeat(201)],
      ['reason-ok', 'r'.repeat(1_000)], ['reason-long', 'r'.repeat(1_001)],
      ['missing-ok', 'm'.repeat(500)], ['missing-long', 'm'.repeat(501)],
      ['description-ok', 'd'.repeat(500)], ['description-long', 'd'.repeat(501)],
    ].map(([partId, rawText], index) => ({ partId: partId!, eventIdHash: hash, acceptedAtMs: index + 1, rawText: rawText! }));
    const built = await createLineAiInputEvidence({ turnKey: 'turn:exact-limits', parts });
    assert.ok(built);
    const proposed = (partId: string) => {
      const part = built.inputEvidence.parts.find(item => item.partId === partId)!;
      return { value: part.rawText, proof: { kind: 'USER_TEXT', refs: [{ partId, startUtf16: 0,
        endUtf16: part.rawText.length, rawSha256: part.rawSha256 }] } };
    };
    const base = { schemaVersion: 1, taskId, taskRevision: 1, operation: 'CREATE', fields: {} };
    assert.ok(parseLineReimbursementDraftProposalV1({ ...base, fields: {
      title: proposed('title-ok'), reason: proposed('reason-ok'), missingReceiptReason: proposed('missing-ok'),
    }, lineChanges: [{ operation: 'ADD', values: { description: proposed('description-ok') } }] }, { evidence: built.inputEvidence }));
    for (const proposal of [
      { ...base, fields: { title: proposed('title-long') } },
      { ...base, fields: { reason: proposed('reason-long') } },
      { ...base, fields: { missingReceiptReason: proposed('missing-long') } },
      { ...base, lineChanges: [{ operation: 'ADD', values: { description: proposed('description-long') } }] },
    ]) assert.equal(parseLineReimbursementDraftProposalV1(proposal, { evidence: built.inputEvidence }), undefined);
  });
});


it('R14 text particle trimming preserves exact user proofs and leaves particle-only fields missing', async () => {
  for (const text of ['ไปส่งของจ้ะนะคะ', 'จ้ะจ้ะ']) {
    const built = (await createLineAiInputEvidence({ turnKey: 'r14-fields', parts: [{ partId: 'p', eventIdHash: hash, acceptedAtMs: 1, rawText: text }] }))!;
    const value = { value: text, proof: { kind: 'USER_TEXT', refs: [{ partId: 'p', rawSha256: built.inputEvidence.parts[0]!.rawSha256, startUtf16: 0, endUtf16: text.length }] } };
    const parsed = parseLineReimbursementDraftProposalV1({ schemaVersion: 1, taskId, taskRevision: 1, operation: 'CREATE', fields: { reason: value, missingReceiptReason: value, title: value }, lineChanges: [{ operation: 'ADD', values: { description: value, purpose: value } }] }, { evidence: built.inputEvidence });
    assert.ok(parsed);
    if (text === 'จ้ะจ้ะ') {
      assert.deepEqual(parsed.fields, {}); assert.deepEqual(parsed.lineChanges?.[0]?.operation === 'ADD' && parsed.lineChanges[0].values, {});
    } else {
      for (const field of Object.values(parsed.fields ?? {})) {
        assert.equal(field?.value, 'ไปส่งของ');
        assert.equal(field?.proof.kind === 'USER_TEXT' && field.proof.refs[0]?.endUtf16, 'ไปส่งของ'.length);
      }
      const line = parsed.lineChanges?.[0];
      assert.equal(line?.operation === 'ADD' && line.values.description?.value, 'ไปส่งของ');
      assert.equal(line?.operation === 'ADD' && line.values.purpose?.value, 'ไปส่งของ');
    }
  }
});
