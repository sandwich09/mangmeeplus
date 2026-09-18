/**
 * The two capture contract routes (appendix §4.3), against a faked Bedrock transport.
 *
 * Nothing here calls a provider. What is under test is everything the gateway decides on its own:
 * how a multi-page read is split back into pages, what `max_tokens` costs (the LAST page, not the
 * chunk), which payload shapes are refused outright, and the value cross-check that drops a number
 * the window text never printed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { defer, firstValueFrom } from 'rxjs';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import {
  AI_BUDGET_STEP_BOUNDS,
  EXPENSE_CAPTURE_CONTRACT_VERSION,
  aiBudgetInvocationKey,
  type ExpenseCaptureExtractRequest,
  type ExpenseCaptureReadRequest,
} from '@watchdog-bms/contracts';
import { AiUsageInterceptor } from '../../../../common/usage/ai-usage.interceptor';
import { BASE64_MEDIA_ROUTES, LineAiInternalController } from './line-ai-internal.controller';
import { CAPTURE_BLANK_PAGE_MARKER, parseCaptureObservationsJson, parseCaptureReadPages } from '../../domain/logic/expense-capture-read.logic';

const config = {
  aiGatewayInternalSecret: 'secret',
  aiToolTimeoutMs: 1_000,
  modelProvider: 'bedrock',
  bedrockRegion: 'ap-southeast-1',
  documentAiModelId: 'test-model',
  erpCoreInternalUrl: 'http://api.test/v1',
} as any;

const controller = (over: Record<string, unknown> = {}) =>
  new LineAiInternalController({ ...config, ...over } as any, { execute: async () => { throw new Error('unused'); } } as any);

const readRequest = (over: Partial<ExpenseCaptureReadRequest> = {}): ExpenseCaptureReadRequest => ({
  requestId: 'req-capture', companyId: 'company-1', userId: 'user-1',
  contractVersion: EXPENSE_CAPTURE_CONTRACT_VERSION,
  chunk: {
    id: 'c1', kind: 'pdf', mimeType: 'application/pdf', contentBase64: 'ZmFrZQ==',
    pageIndexes: [0, 1, 2], fileLabel: 'file-1',
  },
  ...over,
});

const WINDOW_TEXT = [
  'ร้านตัวอย่าง จำกัด',
  'เลขที่ INV-77',
  'น้ำดื่ม 2 24.00',
  'ค่าจัดส่ง 35.00',
  'รวมทั้งสิ้น 59.00',
].join('\n');

const extractRequest = (over: Partial<ExpenseCaptureExtractRequest> = {}): ExpenseCaptureExtractRequest => ({
  requestId: 'req-extract', companyId: 'company-1', userId: 'user-1',
  contractVersion: EXPENSE_CAPTURE_CONTRACT_VERSION,
  window: { fileLabel: 'file-1', pageIndexes: [0], pages: [{ pageIndex: 0, text: WINDOW_TEXT }] },
  ...over,
});

/**
 * One Bedrock transport for both routes. The existing receipt stub classifies a call by its IMAGE
 * blocks; a capture chunk may be a DOCUMENT block instead, so this recognises both.
 */
function stubBedrock(answers: {
  read?: string;
  readStopReason?: string;
  extract?: string[];
  extractStopReason?: string;
}) {
  const original = BedrockRuntimeClient.prototype.send;
  const calls: Array<{ kind: 'read' | 'extract'; images: number; documents: number; systemPrompt: string }> = [];
  let extractIndex = 0;
  (BedrockRuntimeClient.prototype as any).send = async (command: any) => {
    const content = command.input.messages.at(-1).content;
    const images = content.filter((block: any) => block.image).length;
    const documents = content.filter((block: any) => block.document).length;
    const kind = images > 0 || documents > 0 ? 'read' : 'extract';
    calls.push({ kind, images, documents, systemPrompt: command.input.system?.[0]?.text ?? '' });
    if (kind === 'read') {
      return {
        usage: { inputTokens: 1_000, outputTokens: 200, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 },
        output: { message: { content: [{ text: JSON.stringify({ natural_text: answers.read ?? '' }) }] } },
        stopReason: answers.readStopReason ?? 'end_turn',
      };
    }
    const text = answers.extract?.[Math.min(extractIndex, (answers.extract.length - 1))] ?? '{}';
    extractIndex += 1;
    return {
      usage: { inputTokens: 900, outputTokens: 120, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 },
      output: { message: { content: [{ text }] } },
      stopReason: answers.extractStopReason ?? 'end_turn',
    };
  };
  return { calls, restore: () => { (BedrockRuntimeClient.prototype as any).send = original; } };
}

const classification = (over: Record<string, unknown> = {}) => ({
  contentKind: 'DOCUMENT', documentFamily: 'EXPENSE_EVIDENCE', documentKind: 'RECEIPT',
  businessDirection: 'PURCHASE_EXPENSE', transactionState: 'PAID',
  evidenceRoles: ['EXPENSE_SUPPORT'], confidence: 0.9,
  evidenceSignals: ['ร้านตัวอย่าง จำกัด'], amountSignals: ['59.00'], settlementSignals: ['รวมทั้งสิ้น 59.00'],
  missingRequiredSignals: [], contradictionSignals: [], requiresClarification: false,
  ...over,
});

const observationsJson = (over: Record<string, unknown> = {}) => JSON.stringify({
  documents: [{
    ref: 'd1', pageIndexes: [0], kind: 'RECEIPT', family: 'EXPENSE_EVIDENCE',
    issuer: { name: 'ร้านตัวอย่าง จำกัด' }, documentNumber: 'INV-77', classification: classification(),
  }],
  items: [{ id: '0:1', documentRef: 'd1', description: 'น้ำดื่ม', quantity: '2', amount: '24.00', event: 'sale', evidenceSpan: 'น้ำดื่ม 2 24.00' }],
  components: [{ id: 'c1', documentRef: 'd1', label: 'ค่าจัดส่ง', amount: '35.00', role: 'charge', scope: 'shipping', appliedStatus: 'applied', evidenceSpan: 'ค่าจัดส่ง 35.00' }],
  totals: [{ documentRef: 'd1', kind: 'document_total', amount: '59.00', evidenceSpan: 'รวมทั้งสิ้น 59.00' }],
  payments: [], refunds: [],
  completeness: { itemsTruncated: false, unreadableRows: 0, pagesCovered: [0], notes: [] },
  ...over,
});

describe('capture-read', () => {
  it('is registered on the 16 MB media body parser, like every other base64 route', () => {
    assert.ok(BASE64_MEDIA_ROUTES.test('/v1/internal/ai/capture-read'));
    assert.ok(BASE64_MEDIA_ROUTES.test('/v1/internal/ai/capture-extract'));
    assert.ok(!BASE64_MEDIA_ROUTES.test('/v1/internal/ai/capture-readx'));
  });

  it('splits the reading back into the chunk pages the API asked for', async () => {
    const bedrock = stubBedrock({
      read: ['=== PAGE 1 ===', 'HEADER', '=== PAGE 2 ===', 'ROWS', '=== PAGE 3 ===', 'TOTAL 100.00'].join('\n'),
    });
    try {
      const result = await controller().captureRead('secret', readRequest());
      assert.equal(result.status, 'ok');
      assert.equal(result.contractVersion, EXPENSE_CAPTURE_CONTRACT_VERSION);
      assert.deepEqual(result.pages?.map((page) => page.pageIndex), [0, 1, 2], 'pages map onto the chunk, not onto the model numbering');
      assert.deepEqual(result.pages?.map((page) => page.text), ['HEADER', 'ROWS', 'TOTAL 100.00']);
      assert.ok(result.pages?.every((page) => !page.truncated && !page.blank));
      assert.equal(bedrock.calls.length, 1, 'one chunk, one provider call');
      assert.equal(bedrock.calls[0]!.documents, 1);
      assert.ok(bedrock.calls[0]!.systemPrompt.includes('=== PAGE n ==='));
    } finally { bedrock.restore(); }
  });

  it('marks only the LAST page truncated when the model runs out of tokens', async () => {
    const bedrock = stubBedrock({
      read: ['=== PAGE 1 ===', 'COMPLETE', '=== PAGE 2 ===', 'CUT OFF HERE'].join('\n'),
      readStopReason: 'max_tokens',
    });
    try {
      const result = await controller().captureRead('secret', readRequest());
      assert.deepEqual(result.pages?.map((page) => page.truncated), [false, true],
        'a page that finished must not be thrown away with the one that did not');
      assert.equal(result.pages?.[0]!.text, 'COMPLETE');
    } finally { bedrock.restore(); }
  });

  it('reports a blank page as blank rather than as a failed read', async () => {
    const bedrock = stubBedrock({
      read: ['=== PAGE 1 ===', 'ROWS', '=== PAGE 2 ===', CAPTURE_BLANK_PAGE_MARKER].join('\n'),
    });
    try {
      const result = await controller().captureRead('secret', readRequest());
      assert.deepEqual(result.pages?.map((page) => page.blank), [false, true]);
      assert.equal(result.pages?.[1]!.text, '');
    } finally { bedrock.restore(); }
  });

  it('sends a tile set as images, overview first, in one call', async () => {
    const bedrock = stubBedrock({ read: '=== PAGE 1 ===\nROWS' });
    try {
      const result = await controller().captureRead('secret', readRequest({
        chunk: {
          id: 'c1', kind: 'tiles', mimeType: 'image/jpeg', pageIndexes: [4], fileLabel: 'file-1',
          images: [
            { contentBase64: 'dGlsZTI=', mimeType: 'image/jpeg', role: 'tile', index: 2 },
            { contentBase64: 'b3ZlcnZpZXc=', mimeType: 'image/jpeg', role: 'overview', index: 0 },
            { contentBase64: 'dGlsZTE=', mimeType: 'image/jpeg', role: 'tile', index: 1 },
          ],
        },
      }));
      assert.equal(result.status, 'ok');
      assert.deepEqual(result.pages?.map((page) => page.pageIndex), [4]);
      assert.equal(bedrock.calls[0]!.images, 3);
      assert.equal(bedrock.calls[0]!.documents, 0);
      assert.ok(bedrock.calls[0]!.systemPrompt.includes('overview of ONE page'));
    } finally { bedrock.restore(); }
  });

  it('refuses a PDF chunk when the configured provider cannot carry one', async () => {
    const result = await controller({ modelProvider: 'openai', openAiModel: 'gpt' }).captureRead('secret', readRequest());
    assert.equal(result.status, 'not_configured');
    assert.equal(result.errorCode, 'PDF_PROVIDER_UNSUPPORTED');
  });

  it('refuses an unknown contract version and an empty chunk instead of guessing', async () => {
    const version = await controller().captureRead('secret', readRequest({ contractVersion: 99 as never }));
    assert.equal(version.errorCode, 'CAPTURE_CONTRACT_VERSION_UNSUPPORTED');
    const empty = await controller().captureRead('secret', readRequest({
      chunk: { id: 'c1', kind: 'image', mimeType: 'image/jpeg', pageIndexes: [0], fileLabel: 'f' },
    }));
    assert.equal(empty.errorCode, 'CAPTURE_CHUNK_EMPTY');
    await assert.rejects(
      () => controller().captureRead('secret', { ...readRequest(), chunk: undefined as never }),
      (error: unknown) => error instanceof BadRequestException,
    );
  });
});

describe('capture-extract', () => {
  it('returns observations the window text can prove', async () => {
    const bedrock = stubBedrock({ extract: [observationsJson()] });
    try {
      const result = await controller().captureExtract('secret', extractRequest());
      assert.equal(result.status, 'ok');
      assert.equal(result.observations?.documents.length, 1);
      assert.equal(result.observations?.items[0]!.amount, '24.00');
      assert.equal(result.observations?.totals[0]!.amount, '59.00');
      assert.equal(bedrock.calls.length, 1);
      assert.ok(bedrock.calls[0]!.systemPrompt.includes('NEVER compute'));
    } finally { bedrock.restore(); }
  });

  it('spends its one repair retry on a broken answer and only on that', async () => {
    const broken = stubBedrock({ extract: ['{not json at all', observationsJson()] });
    try {
      const result = await controller().captureExtract('secret', extractRequest());
      assert.equal(result.status, 'ok');
      assert.equal(broken.calls.length, 2, 'exactly one repair');
    } finally { broken.restore(); }

    const hopeless = stubBedrock({ extract: ['{not json at all', 'still not json'] });
    try {
      const result = await controller().captureExtract('secret', extractRequest());
      assert.equal(result.status, 'failed');
      assert.equal(result.errorCode, 'OCR_JSON_PARSE_FAILED');
      assert.equal(hopeless.calls.length, 2, 'never a third attempt');
    } finally { hopeless.restore(); }

    const truncated = stubBedrock({ extract: [observationsJson()], extractStopReason: 'max_tokens' });
    try {
      const result = await controller().captureExtract('secret', extractRequest());
      assert.equal(result.errorCode, 'OCR_OUTPUT_TRUNCATED');
      assert.equal(truncated.calls.length, 1, 'a truncated answer is not a parse failure');
    } finally { truncated.restore(); }
  });

  it('refuses a window past the declared character ceiling instead of truncating it', async () => {
    const result = await controller().captureExtract('secret', extractRequest({
      window: { fileLabel: 'f', pageIndexes: [0], pages: [{ pageIndex: 0, text: 'x'.repeat(13_000) }] },
    }));
    assert.equal(result.status, 'failed');
    assert.equal(result.errorCode, 'CAPTURE_WINDOW_TOO_LARGE');
  });
});

describe('capture observation parser', () => {
  const parse = (over: Record<string, unknown>) => parseCaptureObservationsJson(observationsJson(over), WINDOW_TEXT);

  it('drops a number the window never printed and keeps the row', () => {
    const parsed = parse({
      items: [{ id: '0:1', documentRef: 'd1', description: 'น้ำดื่ม', amount: '999.99', event: 'sale', evidenceSpan: 'น้ำดื่ม 2 24.00' }],
    });
    assert.equal(parsed?.items.length, 1);
    assert.equal(parsed?.items[0]!.amount, undefined, 'an unprinted amount is unknown, never recorded');
  });

  it('drops a row whose evidence span is not in the window text', () => {
    const parsed = parse({
      items: [{ id: '0:1', documentRef: 'd1', description: 'ผี', amount: '24.00', event: 'sale', evidenceSpan: 'ไม่มีอยู่จริง' }],
    });
    assert.deepEqual(parsed?.items, []);
  });

  it('drops a total with no printed amount rather than recording an unprovable one', () => {
    const parsed = parse({
      totals: [{ documentRef: 'd1', kind: 'document_total', amount: '1234.00', evidenceSpan: 'รวมทั้งสิ้น 59.00' }],
    });
    assert.deepEqual(parsed?.totals, []);
  });

  it('refuses an unknown event, role or scope rather than mapping it to something safe', () => {
    const badEvent = parse({
      items: [{ id: '0:1', documentRef: 'd1', description: 'น้ำดื่ม', amount: '24.00', event: 'refund_maybe', evidenceSpan: 'น้ำดื่ม 2 24.00' }],
    });
    assert.deepEqual(badEvent?.items, []);
    const badRole = parse({
      components: [{ id: 'c1', documentRef: 'd1', label: 'ค่าจัดส่ง', amount: '35.00', role: 'shipping_fee', scope: 'shipping', appliedStatus: 'applied', evidenceSpan: 'ค่าจัดส่ง 35.00' }],
    });
    assert.deepEqual(badRole?.components, []);
  });

  it('caps items and components and says so instead of cutting silently', () => {
    const items = Array.from({ length: 130 }, (_, index) => ({
      id: `0:${index}`, documentRef: 'd1', description: 'น้ำดื่ม', amount: '24.00', event: 'sale', evidenceSpan: 'น้ำดื่ม 2 24.00',
    }));
    const parsed = parse({ items });
    assert.equal(parsed?.items.length, 120);
    assert.equal(parsed?.completeness.itemsTruncated, true);
  });

  it('never invents an issuer or a date the window does not print', () => {
    const parsed = parse({
      documents: [{
        ref: 'd1', pageIndexes: [0], kind: 'RECEIPT', family: 'EXPENSE_EVIDENCE',
        issuer: { name: 'ร้านที่ไม่มีในเอกสาร' }, documentNumber: 'INV-999', documentDate: '2019-01-01',
        classification: classification(),
      }],
    });
    assert.equal(parsed?.documents[0]!.issuer.name, undefined);
    assert.equal(parsed?.documents[0]!.documentNumber, undefined);
    assert.equal(parsed?.documents[0]!.documentDate, undefined);
  });

  it('returns null when nothing survives, so the caller can spend its repair', () => {
    assert.equal(parseCaptureObservationsJson('{"documents":[]}', WINDOW_TEXT), null);
    assert.equal(parseCaptureObservationsJson('not json', WINDOW_TEXT), null);
  });
});

describe('capture page splitter', () => {
  it('treats an undelimited answer as the chunk\'s first page', () => {
    const pages = parseCaptureReadPages('just some text', [7, 8], false);
    assert.deepEqual(pages.map((page) => page.pageIndex), [7]);
    assert.equal(pages[0]!.text, 'just some text');
  });

  it('ignores sections past the pages the chunk actually contains', () => {
    const pages = parseCaptureReadPages('=== PAGE 1 ===\nA\n=== PAGE 2 ===\nB\n=== PAGE 3 ===\nC', [0], false);
    assert.equal(pages.length, 1, 'the model cannot invent a page the chunk never held');
  });
});

describe('capture routes under a SPLIT budget envelope', () => {
  const BOUNDS = AI_BUDGET_STEP_BOUNDS['receipt-capture-read'];

  function routeWithEnvelope(body: unknown, url: string, run: (c: LineAiInternalController) => Promise<unknown>) {
    const ctx = { switchToHttp: () => ({ getRequest: () => ({ body, url }) }) } as unknown as ExecutionContext;
    return firstValueFrom(new AiUsageInterceptor().intercept(ctx, {
      handle: () => defer(() => run(controller())),
    } as CallHandler)) as Promise<any>;
  }

  it('refuses a read whose envelope does not rebuild, rather than spending unreserved money', async () => {
    const bedrock = stubBedrock({ read: '=== PAGE 1 ===\nROWS' });
    try {
      const body = {
        ...readRequest(),
        budgetEnvelope: {
          attemptKey: 'capture:job-1:c1', stepKind: 'receipt-capture-read',
          invocationKey: aiBudgetInvocationKey('another-company', 'capture:job-1:c1', 'receipt-capture-read', 0),
          bucket: 'OCR', monthKey: '2026-09', modelId: 'test-model',
          bounds: { ...BOUNDS }, maxCalls: BOUNDS.maxCalls,
        },
      };
      const result = await routeWithEnvelope(body, '/v1/internal/ai/capture-read', (c) => c.captureRead('secret', body as any));
      assert.equal(result.status, 'failed');
      assert.equal(result.errorCode, 'AI_BUDGET_UNAVAILABLE');
      assert.equal(bedrock.calls.length, 0, 'no provider call happens under an envelope we cannot verify');
    } finally { bedrock.restore(); }
  });

  it('runs a three-page chunk inside the declared document bound and reports its usage', async () => {
    // A three-page PDF chunk is the largest the API ever sends, and it must fit `maxInputTokens`
    // at the declared per-page ceiling — otherwise the pipeline would refuse its own chunks.
    const pdf = Buffer.from('%PDF-1.7\n/Type /Pages /Count 3\n/Type /Page\n/Type /Page\n/Type /Page\n');
    const bedrock = stubBedrock({ read: '=== PAGE 1 ===\nA\n=== PAGE 2 ===\nB\n=== PAGE 3 ===\nC' });
    try {
      const body = {
        ...readRequest({ chunk: { ...readRequest().chunk, contentBase64: pdf.toString('base64') } }),
        budgetEnvelope: {
          attemptKey: 'capture:job-1:c1', stepKind: 'receipt-capture-read',
          invocationKey: aiBudgetInvocationKey('company-1', 'capture:job-1:c1', 'receipt-capture-read', 0),
          bucket: 'OCR', monthKey: '2026-09', modelId: 'test-model',
          bounds: { ...BOUNDS }, maxCalls: BOUNDS.maxCalls,
        },
      };
      const result = await routeWithEnvelope(body, '/v1/internal/ai/capture-read', (c) => c.captureRead('secret', body as any));
      assert.equal(result.status, 'ok');
      assert.equal(result.pages.length, 3);
      assert.equal(bedrock.calls.length, 1);
      assert.equal(result.usage?.[0]?.tag, 'ocr.capture.read', 'the money meter sees the call it paid for');
    } finally { bedrock.restore(); }
  });
});
