import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createLineAiInputEvidence,
  parseLineAiInputEvidence,
  validateLineAiSourceRefV2,
  verifyLineAiInputEvidence,
} from './line-ai-input-evidence.js';
import { lineAiRetainedTaskSourceMatchesProjection, lineAiRetainedTaskSourceText, verifyLineAiRetainedTaskSource } from './line-ai.js';

const hash = 'a'.repeat(64);

describe('LineAiInputEvidenceV2', () => {
  it('round-trips original parts and exact UTF-16 source spans', async () => {
    const built = await createLineAiInputEvidence({
      turnKey: 'turn:1',
      parts: [
        { partId: 'part-1', eventIdHash: hash, acceptedAtMs: 1, rawText: 'สรุป A\nยอด 1,200' },
        { partId: 'part-2', eventIdHash: hash, acceptedAtMs: 2, rawText: 'แก้เป็น 1,250 ไม่รวม VAT' },
      ],
    });
    assert.ok(built);
    assert.equal(built.messageText, 'สรุป A\nยอด 1,200\nแก้เป็น 1,250 ไม่รวม VAT');
    assert.deepEqual(await verifyLineAiInputEvidence(built.inputEvidence, built.messageText), built.inputEvidence);

    const correction = built.inputEvidence.parts[1]!;
    const startUtf16 = correction.rawText.indexOf('1,250');
    assert.equal(validateLineAiSourceRefV2({
      partId: correction.partId, startUtf16, endUtf16: startUtf16 + 5, rawSha256: correction.rawSha256,
    }, built.inputEvidence), '1,250');
  });

  it('rejects digest/text/span mutation, missing complete evidence and legacy overflow', async () => {
    const built = await createLineAiInputEvidence({
      turnKey: 'turn-2', parts: [{ partId: 'p', eventIdHash: hash, acceptedAtMs: 1, rawText: '😀 42' }],
    });
    assert.ok(built);
    const tampered = structuredClone(built.inputEvidence);
    tampered.parts[0]!.rawText = '😀 43';
    assert.equal(await verifyLineAiInputEvidence(tampered, '😀 43'), undefined);
    assert.equal(parseLineAiInputEvidence(built.inputEvidence, '😀 42!'), undefined);
    assert.equal(validateLineAiSourceRefV2({
      partId: 'p', startUtf16: 1, endUtf16: 2, rawSha256: built.inputEvidence.parts[0]!.rawSha256,
    }, built.inputEvidence), undefined, 'a span may not bisect a surrogate pair');
    assert.equal(await createLineAiInputEvidence({
      turnKey: 'turn-3', parts: [{ partId: 'p', eventIdHash: hash, acceptedAtMs: 1, rawText: 'a'.repeat(12_001) }],
    }), undefined);
  });

  it('verifies and extracts only the selected historical write clause', async () => {
    const rawText = 'บันทึกค่ากาแฟ 120 บาท วันที่ 26/9/2569\nบันทึกค่าเดินทาง 999 บาท';
    const built = await createLineAiInputEvidence({
      turnKey: 'old-turn', parts: [{ partId: 'old-part', eventIdHash: hash, acceptedAtMs: Date.parse('2026-09-27T01:00:00Z'), rawText }],
    });
    assert.ok(built);
    const firstEnd = rawText.indexOf('\n');
    const retained = await verifyLineAiRetainedTaskSource({
      taskRef: { taskId: 'task-1', taskRevision: 4, subrequestIndex: 0 },
      inputEvidence: built.inputEvidence,
      semanticSubrequest: {
        index: 1, kind: 'write', writeIntent: 'EXPENSE_DOCUMENT_CAPTURE', goal: 'บันทึกค่ากาแฟ',
        requiredEvidence: [], requestedFilters: {}, dependsOn: [0],
        evidenceRefs: [{ partId: 'old-part', startUtf16: 0, endUtf16: firstEnd, rawSha256: built.inputEvidence.parts[0]!.rawSha256 }],
      },
    });
    assert.ok(retained);
    assert.equal(retained.semanticSubrequest.index, 1, 'original index stays independent of projection-local index');
    const projection = { tasks: [{ taskId: 'task-1', revision: 4, state: 'waiting_user', subrequests: [{ index: 0, kind: 'write', status: 'pending' }] }] } as any;
    assert.equal(lineAiRetainedTaskSourceMatchesProjection(retained, projection), true);
    assert.equal(lineAiRetainedTaskSourceMatchesProjection(retained, projection, 'turn'), false);
    projection.tasks[0].revision = 5; projection.tasks[0].state = 'active';
    assert.equal(lineAiRetainedTaskSourceMatchesProjection(retained, projection), false);
    assert.equal(lineAiRetainedTaskSourceMatchesProjection(retained, projection, 'turn'), true);
    projection.tasks[0].revision = 6;
    assert.equal(lineAiRetainedTaskSourceMatchesProjection(retained, projection, 'turn'), false);
    assert.equal(lineAiRetainedTaskSourceText(retained), 'บันทึกค่ากาแฟ 120 บาท วันที่ 26/9/2569');
    const tampered = structuredClone(retained);
    tampered.inputEvidence.parts[0]!.rawText = rawText.replace('120', '121');
    assert.equal(await verifyLineAiRetainedTaskSource(tampered), undefined);
  });
});
