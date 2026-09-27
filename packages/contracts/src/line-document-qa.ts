/** W07B question-only image/PDF contract. Financial capture is deliberately absent. */

export const LINE_DOCUMENT_QA_TARGET_TYPE = 'LINE_DOCUMENT_QA' as const;
export const LINE_DOCUMENT_QA_READER_VERSION = 'line-document-qa/1' as const;
export const LINE_DOCUMENT_QA_UNREADABLE_ANSWER = 'ยังอ่านหน้าที่เลือกไม่ได้ จึงยังยืนยันข้อมูลจากไฟล์นี้ไม่ได้ กรุณาส่งภาพที่ชัดขึ้นหรือเลือกหน้าใหม่' as const;

export const LINE_DOCUMENT_QA_LIMITS = Object.freeze({
  maxAttachments: 5,
  maxSelectedPages: 20,
  maxPagesPerPdf: 20,
  maxFileBytes: 10 * 1024 * 1024,
  maxResultBytes: 64 * 1024,
  maxQuestionBytes: 48 * 1024,
  maxAnswerBytes: 32 * 1024,
  maxVisibleTextBytes: 20 * 1024,
  maxClaimBytes: 2 * 1024,
  maxClaimsPerPage: 64,
} as const);

export const LINE_DOCUMENT_QA_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;
export type LineDocumentQaMimeType = (typeof LINE_DOCUMENT_QA_MIME_TYPES)[number];

export const LINE_DOCUMENT_QA_JOB_STATUSES = [
  'QUEUED',
  'READING',
  'ANSWER_READY',
  'FAILED',
  'EXPIRED',
  'CANCELED',
] as const;
export type LineDocumentQaJobStatus = (typeof LINE_DOCUMENT_QA_JOB_STATUSES)[number];

export type LineDocumentQaAttachment = {
  attachmentId: string;
  contentHash: string;
  mimeType: LineDocumentQaMimeType;
  byteSize: number;
  requestedPages: number[];
};

export type LineDocumentQaPageCoverage = {
  requested: Array<{ attachmentId: string; page: number }>;
  read: Array<{ attachmentId: string; page: number }>;
  failed: Array<{ attachmentId: string; page: number; code: string }>;
};

export type LineDocumentQaLocalSpan = {
  start: number;
  end: number;
};

export type LineDocumentQaEvidence = {
  attachmentId: string;
  page: number;
  role: 'answer' | 'fact' | 'visible_text';
  text: string;
  localSpan?: LineDocumentQaLocalSpan;
};

export type LineDocumentQaFact = {
  attachmentId: string;
  page: number;
  text: string;
  role: string;
  localSpan?: LineDocumentQaLocalSpan;
  confidence?: 'high' | 'medium' | 'low' | 'unknown';
};

export type LineDocumentQaPageResult = {
  attachmentId: string;
  page: number;
  visibleText: string;
  facts: LineDocumentQaFact[];
  evidence: LineDocumentQaEvidence[];
};

export type LineDocumentQaQuestion = { subrequestIndex: number; question: string };
export type LineDocumentQaQuestionCoverage = {
  subrequestIndex: number;
  status: 'answered' | 'unreadable' | 'needs_input';
  answer: string;
  answerPageRefs: Array<{ attachmentId: string; page: number }>;
};

/** Questions preserve original semantic indices and exact user text; no invented or duplicate clause. */
export function parseLineDocumentQaQuestions(value: unknown, question: string): LineDocumentQaQuestion[] | undefined {
  if (typeof question !== 'string' || !Array.isArray(value) || value.length < 1 || value.length > 8) return undefined;
  const indices = new Set<number>();
  const result: LineDocumentQaQuestion[] = [];
  for (const item of value) {
    if (!isObject(item) || !Number.isSafeInteger(item.subrequestIndex) || Number(item.subrequestIndex) < 0 || Number(item.subrequestIndex) > 7
      || indices.has(Number(item.subrequestIndex)) || typeof item.question !== 'string' || !item.question.trim()
      || !question.includes(item.question)) return undefined;
    indices.add(Number(item.subrequestIndex)); result.push({ subrequestIndex: Number(item.subrequestIndex), question: item.question });
  }
  return result;
}

export function lineDocumentQaQuestionsCovered(result: LineDocumentQaResult, questions?: LineDocumentQaQuestion[]): boolean {
  if (!questions) return result.questionCoverage === undefined;
  return result.questionCoverage?.length === questions.length
    && questions.every(question => result.questionCoverage!.some(item => item.subrequestIndex === question.subrequestIndex));
}

export type LineDocumentQaResult = {
  version: 1;
  readerVersion: typeof LINE_DOCUMENT_QA_READER_VERSION;
  answer: string;
  answerPageRefs: Array<{ attachmentId: string; page: number }>;
  pages: LineDocumentQaPageResult[];
  coverage: LineDocumentQaPageCoverage;
  questionCoverage?: LineDocumentQaQuestionCoverage[];
};

export type LineDocumentQaGatewayPage = {
  attachmentId: string;
  page: number;
  mimeType: 'image/jpeg' | 'image/png' | 'application/pdf';
  contentHash: string;
  contentBase64: string;
  /** Original source metadata stays stable through PDF/WebP rendering. */
  sourceMimeType: LineDocumentQaMimeType;
  renderedSha256: string;
};

export type LineDocumentQaGatewayRequest = {
  requestId: string;
  companyId: string;
  userId: string;
  messageText: string;
  jobId: string;
  jobRevision: number;
  turnId: string;
  question: string;
  questions?: LineDocumentQaQuestion[];
  pages: LineDocumentQaGatewayPage[];
  inputDigest: string;
  inputSetHash: string;
  questionDigest: string;
  readerVersion: typeof LINE_DOCUMENT_QA_READER_VERSION;
  inputEvidence: unknown;
  contractCapabilities: ['input-evidence-v2', 'budget-envelope-v2'];
  budgetGrantV2: unknown;
};

export type LineDocumentQaGatewayResponse =
  | { status: 'ok'; result: LineDocumentQaResult; usage?: unknown[] }
  | { status: 'failed'; errorCode: string; budgetScope?: 'CHAT' | 'OCR' | 'TOTAL'; usage?: unknown[] };

/** Stable, non-content input manifest used to bind the v2 evidence digest to the admitted bytes. */
export function lineDocumentQaInputEvidenceText(
  question: string,
  pages: Array<Pick<LineDocumentQaGatewayPage, 'attachmentId' | 'page' | 'sourceMimeType' | 'contentHash'>>,
  questions?: LineDocumentQaQuestion[],
): string {
  return JSON.stringify({ question, ...(questions ? { questions: questions.map(({ subrequestIndex, question }) => ({ subrequestIndex, question })) } : {}), pages: pages.map(({ attachmentId, page, sourceMimeType, contentHash }) => ({ attachmentId, page, sourceMimeType, contentHash })) });
}

export type LineDocumentQaAdmission = {
  kind: 'QUESTION_ONLY';
  jobId: string;
  jobRevision: number;
  turnId: string;
  inputSetHash: string;
  questionDigest: string;
  foregroundDeadlineAt: string;
  jobDeadlineAt: string;
  status: LineDocumentQaJobStatus;
};

export type LineDocumentQaClarification = {
  kind: 'ASK_CAPTURE_OR_QUESTION';
  pendingMediaId: string;
  question: string;
};

export type LineDocumentQaAdmissionResult = LineDocumentQaAdmission | LineDocumentQaClarification;

export type LineDocumentQaDeliveryProof = {
  kind: typeof LINE_DOCUMENT_QA_TARGET_TYPE;
  jobId: string;
  jobRevision: number;
  inputSetHash: string;
  resultHash: string;
  attachments: Array<{ attachmentId: string; requestedPages: number[] }>;
  pageCoverage: LineDocumentQaPageCoverage;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function boundedText(value: unknown, maxBytes: number): value is string {
  return typeof value === 'string' && new TextEncoder().encode(value).byteLength <= maxBytes;
}

function hash(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
}

function pageKey(attachmentId: string, page: number): string {
  return `${attachmentId}:${page}`;
}

function parsePage(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= LINE_DOCUMENT_QA_LIMITS.maxPagesPerPdf
    ? Number(value)
    : undefined;
}

function parseCoverage(value: unknown): LineDocumentQaPageCoverage | undefined {
  if (!isObject(value)) return undefined;
  const parse = (candidate: unknown, failed: boolean) => {
    if (!Array.isArray(candidate)) return undefined;
    const seen = new Set<string>();
    const rows: Array<{ attachmentId: string; page: number } | { attachmentId: string; page: number; code: string }> = [];
    for (const item of candidate) {
      if (!isObject(item) || typeof item['attachmentId'] !== 'string' || item['attachmentId'].length > 128) return undefined;
      const page = parsePage(item['page']);
      if (!page) return undefined;
      const key = pageKey(item['attachmentId'], page);
      if (seen.has(key)) return undefined;
      seen.add(key);
      if (failed && !boundedText(item['code'], 128)) return undefined;
      if (failed) rows.push({ attachmentId: item['attachmentId'], page, code: item['code'] as string });
      else rows.push({ attachmentId: item['attachmentId'], page });
    }
    return rows;
  };
  const requested = parse(value['requested'], false) as Array<{ attachmentId: string; page: number }> | undefined;
  const read = parse(value['read'], false) as Array<{ attachmentId: string; page: number }> | undefined;
  const failed = parse(value['failed'], true) as Array<{ attachmentId: string; page: number; code: string }> | undefined;
  if (!requested || !read || !failed || !requested.length || requested.length > LINE_DOCUMENT_QA_LIMITS.maxSelectedPages
    || read.length > requested.length || failed.length > requested.length) return undefined;
  const requestedKeys = new Set(requested.map((item) => pageKey(item.attachmentId, item.page)));
  if (read.some((item) => !requestedKeys.has(pageKey(item.attachmentId, item.page)))
    || failed.some((item) => !requestedKeys.has(pageKey(item.attachmentId, item.page)))) return undefined;
  const readKeys = new Set(read.map(item => pageKey(item.attachmentId, item.page)));
  if (read.length + failed.length !== requested.length || failed.some(item => readKeys.has(pageKey(item.attachmentId, item.page)))) return undefined;
  return { requested, read, failed };
}

function parseLocalSpan(value: unknown, text: string): LineDocumentQaLocalSpan | undefined {
  if (!isObject(value) || !Number.isSafeInteger(value['start']) || !Number.isSafeInteger(value['end'])) return undefined;
  const start = Number(value['start']);
  const end = Number(value['end']);
  return start >= 0 && end > start && end <= text.length ? { start, end } : undefined;
}

function parseEvidence(value: unknown, attachmentId: string, page: number, text: string, role: LineDocumentQaEvidence['role']): LineDocumentQaEvidence | undefined {
  if (!isObject(value) || value['attachmentId'] !== attachmentId || value['page'] !== page || value['role'] !== role
    || !boundedText(value['text'], LINE_DOCUMENT_QA_LIMITS.maxClaimBytes)) return undefined;
  const span = value['localSpan'] === undefined ? undefined : parseLocalSpan(value['localSpan'], text);
  if (!span || text.slice(span.start, span.end) !== value['text']) return undefined;
  return { attachmentId, page, role, text: value['text'], ...(span ? { localSpan: span } : {}) };
}

function parseFact(value: unknown, attachmentId: string, page: number, visibleText: string): LineDocumentQaFact | undefined {
  if (!isObject(value) || value['attachmentId'] !== attachmentId || value['page'] !== page
    || !boundedText(value['text'], LINE_DOCUMENT_QA_LIMITS.maxClaimBytes) || !boundedText(value['role'], 64)) return undefined;
  const text = value['text'] as string;
  const span = value['localSpan'] === undefined ? undefined : parseLocalSpan(value['localSpan'], visibleText);
  if (!span || visibleText.slice(span.start, span.end) !== text || !text.trim() || !String(value['role']).trim()) return undefined;
  const confidence = value['confidence'];
  if (confidence !== undefined && !['high', 'medium', 'low', 'unknown'].includes(String(confidence))) return undefined;
  return { attachmentId, page, text, role: value['role'], ...(span ? { localSpan: span } : {}), ...(confidence ? { confidence: confidence as LineDocumentQaFact['confidence'] } : {}) };
}

/** Strict result parser used at the Gateway/API boundary; bytes are checked before persistence. */
export function parseLineDocumentQaResult(value: unknown): LineDocumentQaResult | undefined {
  if (!isObject(value) || value['version'] !== 1 || value['readerVersion'] !== LINE_DOCUMENT_QA_READER_VERSION
    || !boundedText(value['answer'], LINE_DOCUMENT_QA_LIMITS.maxAnswerBytes) || !Array.isArray(value['pages'])) return undefined;
  const coverage = parseCoverage(value['coverage']);
  if (!coverage || value['pages'].length > LINE_DOCUMENT_QA_LIMITS.maxSelectedPages) return undefined;
  const requested = new Set(coverage.requested.map((item) => pageKey(item.attachmentId, item.page)));
  const seenPages = new Set<string>();
  const pages: LineDocumentQaPageResult[] = [];
  for (const item of value['pages']) {
    if (!isObject(item) || typeof item['attachmentId'] !== 'string') return undefined;
    const attachmentId = item['attachmentId'];
    const page = parsePage(item['page']);
    if (!page || !requested.has(pageKey(attachmentId, page)) || !boundedText(item['visibleText'], LINE_DOCUMENT_QA_LIMITS.maxVisibleTextBytes)
      || !Array.isArray(item['facts']) || item['facts'].length > LINE_DOCUMENT_QA_LIMITS.maxClaimsPerPage
      || !Array.isArray(item['evidence']) || item['evidence'].length > LINE_DOCUMENT_QA_LIMITS.maxClaimsPerPage) return undefined;
    const pageKeyValue = pageKey(attachmentId, page);
    if (seenPages.has(pageKeyValue)) return undefined;
    seenPages.add(pageKeyValue);
    const facts = item['facts'].map((fact) => parseFact(fact, attachmentId, page, item['visibleText'] as string));
    const evidence = item['evidence'].map((entry) => parseEvidence(entry, attachmentId, page, item['visibleText'] as string, 'visible_text'));
    if (facts.some((fact) => !fact) || evidence.some((entry) => !entry)) return undefined;
    pages.push({ attachmentId, page, visibleText: item['visibleText'], facts: facts as LineDocumentQaFact[], evidence: evidence as LineDocumentQaEvidence[] });
  }
  const readKeys = new Set(coverage.read.map(item => pageKey(item.attachmentId, item.page)));
  if (pages.length !== readKeys.size || pages.some(item => !readKeys.has(pageKey(item.attachmentId, item.page)))) return undefined;
  if (!Array.isArray(value['answerPageRefs']) || value['answerPageRefs'].length > 20 || (readKeys.size > 0 && value['answerPageRefs'].length === 0)
    || value['answerPageRefs'].some(ref => !isObject(ref) || typeof ref['attachmentId'] !== 'string' || !parsePage(ref['page']) || !readKeys.has(pageKey(ref['attachmentId'], Number(ref['page']))))) return undefined;
  const answerPageRefs = value['answerPageRefs'].map(ref => ({ attachmentId: ref['attachmentId'] as string, page: Number(ref['page']) }));
  let questionCoverage: LineDocumentQaQuestionCoverage[] | undefined;
  if (value['questionCoverage'] !== undefined) {
    if (!Array.isArray(value['questionCoverage']) || value['questionCoverage'].length < 1 || value['questionCoverage'].length > 8) return undefined;
    const indices = new Set<number>(); questionCoverage = [];
    for (const item of value['questionCoverage']) {
      if (!isObject(item) || !Number.isSafeInteger(item.subrequestIndex) || Number(item.subrequestIndex) < 0 || Number(item.subrequestIndex) > 7
        || indices.has(Number(item.subrequestIndex)) || !['answered', 'unreadable', 'needs_input'].includes(String(item.status))
        || !boundedText(item.answer, LINE_DOCUMENT_QA_LIMITS.maxAnswerBytes) || !item.answer.trim()
        || !Array.isArray(item.answerPageRefs) || item.answerPageRefs.length > 20
        || item.status === 'answered' && item.answerPageRefs.length === 0) return undefined;
      const refs: Array<{ attachmentId: string; page: number }> = [];
      for (const ref of item.answerPageRefs) {
        if (!isObject(ref) || typeof ref.attachmentId !== 'string' || !parsePage(ref.page) || !readKeys.has(pageKey(ref.attachmentId, Number(ref.page)))
          || refs.some(saved => saved.attachmentId === ref.attachmentId && saved.page === ref.page)) return undefined;
        refs.push({ attachmentId: ref.attachmentId, page: Number(ref.page) });
      }
      indices.add(Number(item.subrequestIndex));
      questionCoverage.push({ subrequestIndex: Number(item.subrequestIndex), status: item.status as LineDocumentQaQuestionCoverage['status'],
        answer: item.status === 'unreadable' ? LINE_DOCUMENT_QA_UNREADABLE_ANSWER : item.answer, answerPageRefs: refs });
    }
  }
  const answer = questionCoverage ? questionCoverage.map(item => `คำถาม ${item.subrequestIndex + 1}: ${item.answer}`).join('\n\n')
    : readKeys.size ? value['answer'] : LINE_DOCUMENT_QA_UNREADABLE_ANSWER;
  if (!boundedText(answer, LINE_DOCUMENT_QA_LIMITS.maxAnswerBytes)) return undefined;
  const parsed: LineDocumentQaResult = { version: 1, readerVersion: LINE_DOCUMENT_QA_READER_VERSION,
    answer, answerPageRefs, pages, coverage, ...(questionCoverage ? { questionCoverage } : {}) };
  return new TextEncoder().encode(JSON.stringify(parsed)).byteLength <= LINE_DOCUMENT_QA_LIMITS.maxResultBytes ? parsed : undefined;
}

export function validateLineDocumentQaAttachmentMeta(input: { mimeType: string; byteSize: number; requestedPages: number[] }): string | null {
  if (!(LINE_DOCUMENT_QA_MIME_TYPES as readonly string[]).includes(input.mimeType)) return 'QA_UNSUPPORTED_MIME';
  if (!Number.isSafeInteger(input.byteSize) || input.byteSize <= 0 || input.byteSize > LINE_DOCUMENT_QA_LIMITS.maxFileBytes) return 'QA_FILE_TOO_LARGE';
  if (!Array.isArray(input.requestedPages) || input.requestedPages.length < 1 || input.requestedPages.length > LINE_DOCUMENT_QA_LIMITS.maxPagesPerPdf
    || input.requestedPages.some((page) => !parsePage(page)) || new Set(input.requestedPages).size !== input.requestedPages.length) return 'QA_PAGE_SELECTION_INVALID';
  if (input.mimeType !== 'application/pdf' && (input.requestedPages.length !== 1 || input.requestedPages[0] !== 1)) return 'QA_IMAGE_PAGE_INVALID';
  return null;
}

export function validateLineDocumentQaAttachment(input: LineDocumentQaAttachment): string | null {
  if (!input || typeof input.attachmentId !== 'string' || input.attachmentId.length < 1 || input.attachmentId.length > 128) return 'QA_ATTACHMENT_INVALID';
  if (!hash(input.contentHash)) return 'QA_HASH_INVALID';
  return validateLineDocumentQaAttachmentMeta(input);
}
