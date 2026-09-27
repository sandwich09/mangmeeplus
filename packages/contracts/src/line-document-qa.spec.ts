import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LINE_DOCUMENT_QA_LIMITS,
  LINE_DOCUMENT_QA_READER_VERSION,
  LINE_DOCUMENT_QA_UNREADABLE_ANSWER,
  parseLineDocumentQaResult,
  parseLineDocumentQaQuestions,
  lineDocumentQaQuestionsCovered,
  validateLineDocumentQaAttachmentMeta,
} from './line-document-qa.js';

const page = {
  attachmentId: 'att-1', page: 1, visibleText: 'TOTAL 1177',
  facts: [{ attachmentId: 'att-1', page: 1, text: '1177', role: 'total', localSpan: { start: 6, end: 10 }, confidence: 'high' }],
  evidence: [{ attachmentId: 'att-1', page: 1, role: 'visible_text', text: 'TOTAL 1177', localSpan: { start: 0, end: 10 } }],
};

test('W07B result parser preserves page-local evidence and bounded coverage', () => {
  const result = parseLineDocumentQaResult({
    version: 1, readerVersion: LINE_DOCUMENT_QA_READER_VERSION, answer: 'ยอดรวม 1,177 บาท', answerPageRefs: [{ attachmentId: 'att-1', page: 1 }], pages: [page],
    coverage: { requested: [{ attachmentId: 'att-1', page: 1 }], read: [{ attachmentId: 'att-1', page: 1 }], failed: [] },
  });
  assert.equal(result?.pages[0]?.facts[0]?.text, '1177');
  assert.equal(result?.pages[0]?.evidence[0]?.localSpan?.end, 10);
});

test('W07B parser rejects ungrounded, duplicate, oversized and invalid page claims', () => {
  const base = {
    version: 1, readerVersion: LINE_DOCUMENT_QA_READER_VERSION, answer: 'x', pages: [],
    coverage: { requested: [{ attachmentId: 'att-1', page: 1 }], read: [], failed: [] },
  };
  assert.equal(parseLineDocumentQaResult({ ...base, coverage: { ...base.coverage, requested: [{ attachmentId: 'att-1', page: 1 }, { attachmentId: 'att-1', page: 1 }] } }), undefined);
  assert.equal(parseLineDocumentQaResult({ ...base, pages: [{ ...page, page: 2 }] }), undefined);
  assert.equal(parseLineDocumentQaResult({ ...base, answer: 'x'.repeat(LINE_DOCUMENT_QA_LIMITS.maxAnswerBytes + 1) }), undefined);
});

test('W07B input admits only bounded PDF pages and page one for images', () => {
  assert.equal(validateLineDocumentQaAttachmentMeta({ mimeType: 'application/pdf', byteSize: 1, requestedPages: [1, 20] }), null);
  assert.equal(validateLineDocumentQaAttachmentMeta({ mimeType: 'image/jpeg', byteSize: 1, requestedPages: [2] }), 'QA_IMAGE_PAGE_INVALID');
  assert.equal(validateLineDocumentQaAttachmentMeta({ mimeType: 'image/webp', byteSize: 1, requestedPages: [1] }), null);
  assert.equal(validateLineDocumentQaAttachmentMeta({ mimeType: 'application/pdf', byteSize: 1, requestedPages: [21] }), 'QA_PAGE_SELECTION_INVALID');
});

test('W07B never delivers a model factual claim when no selected page was read', () => {
  const parsed = parseLineDocumentQaResult({ version: 1, readerVersion: LINE_DOCUMENT_QA_READER_VERSION,
    answer: 'ยอดรวม 99000 บาท', answerPageRefs: [], pages: [], coverage: {
      requested: [{ attachmentId: 'att-1', page: 1 }], read: [], failed: [{ attachmentId: 'att-1', page: 1, code: 'UNREADABLE' }],
    } });
  assert.equal(parsed?.answer, LINE_DOCUMENT_QA_UNREADABLE_ANSWER);
});

test('QA file clauses keep exact original indices and each requires independent bounded answer evidence', () => {
  const question = 'ยอดรวมเท่าไร และมีวันที่ไหม';
  const questions = [{ subrequestIndex: 1, question: 'ยอดรวมเท่าไร' }, { subrequestIndex: 3, question: 'มีวันที่ไหม' }];
  assert.deepEqual(parseLineDocumentQaQuestions(questions, question), questions);
  assert.equal(parseLineDocumentQaQuestions([{ subrequestIndex: 1, question: 'invented' }], question), undefined);
  assert.equal(parseLineDocumentQaQuestions([questions[0], questions[0]], question), undefined);
  const base = { version: 1, readerVersion: LINE_DOCUMENT_QA_READER_VERSION, answer: 'ignored whole answer',
    answerPageRefs: [{ attachmentId: 'att-1', page: 1 }], pages: [page],
    coverage: { requested: [{ attachmentId: 'att-1', page: 1 }], read: [{ attachmentId: 'att-1', page: 1 }], failed: [] },
    questionCoverage: [
      { subrequestIndex: 1, status: 'answered', answer: '1177', answerPageRefs: [{ attachmentId: 'att-1', page: 1 }] },
      { subrequestIndex: 3, status: 'unreadable', answer: 'invented date', answerPageRefs: [] },
    ] };
  const parsed = parseLineDocumentQaResult(base)!; assert.ok(parsed);
  assert.equal(lineDocumentQaQuestionsCovered(parsed, questions), true);
  assert.ok(parsed.answer.includes('1177')); assert.ok(!parsed.answer.includes('invented date'));
  assert.equal(lineDocumentQaQuestionsCovered({ ...parsed, questionCoverage: parsed.questionCoverage!.slice(0, 1) }, questions), false);
  assert.equal(parseLineDocumentQaResult({ ...base, questionCoverage: [{ ...base.questionCoverage[0], answerPageRefs: [] }] }), undefined);
  assert.equal(parseLineDocumentQaResult({ ...base, questionCoverage: [base.questionCoverage[0], base.questionCoverage[0]] }), undefined);
});
