/**
 * The two capture contract routes (appendix §4.3), against a faked Bedrock transport.
 *
 * Nothing here calls a provider. What is under test is everything the gateway decides on its own:
 * how a multi-page read is split back into pages, what `max_tokens` costs (the LAST page, not the
 * chunk), which payload shapes are refused outright, and the value cross-check that drops a number
 * the window text never printed.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
  BUSINESS_DOCUMENT_CONTENT_KINDS,
  BUSINESS_DOCUMENT_DIRECTIONS,
  BUSINESS_DOCUMENT_EVIDENCE_ROLES,
  BUSINESS_DOCUMENT_TRANSACTION_STATES,
  type ExpenseCaptureExtractRequest,
  type ExpenseCaptureReadRequest,
} from '@watchdog-bms/contracts';
import { AiUsageInterceptor } from '../../../../common/usage/ai-usage.interceptor';
import { BASE64_MEDIA_ROUTES, LineAiInternalController } from './line-ai-internal.controller';
import {
  CAPTURE_BLANK_PAGE_MARKER, CAPTURE_EXTRACT_PROMPT, CAPTURE_PARTIAL_KEY, captureReadPrompt, receiptIssuerText,
  parseCaptureNaturalText, parseCaptureObservationsJson, parseCaptureReadPages,
} from '../../domain/logic/expense-capture-read.logic';

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
  readRaw?: string;
  /** W10 D3: what the model puts in the stage-1 `partial` key when it could not read part of a page. */
  readPartial?: string | true;
  readStopReason?: string;
  readOutputTokens?: number;
  extract?: string[];
  extractStopReason?: string;
}) {
  const original = BedrockRuntimeClient.prototype.send;
  const calls: Array<{ kind: 'read' | 'extract'; images: number; documents: number; systemPrompt: string; userText: string; maxTokens: number }> = [];
  let extractIndex = 0;
  (BedrockRuntimeClient.prototype as any).send = async (command: any) => {
    const content = command.input.messages.at(-1).content;
    const images = content.filter((block: any) => block.image).length;
    const documents = content.filter((block: any) => block.document).length;
    const kind = images > 0 || documents > 0 ? 'read' : 'extract';
    calls.push({
      maxTokens: command.input.inferenceConfig.maxTokens, kind, images, documents, systemPrompt: command.input.system?.[0]?.text ?? '',
      userText: content.map((block: any) => block.text ?? '').join('\n'),
    });
    if (kind === 'read') {
      return {
        usage: { inputTokens: 1_000, outputTokens: answers.readOutputTokens ?? 200, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 },
        output: { message: { content: [{ text: answers.readRaw ?? JSON.stringify({
          natural_text: answers.read ?? '',
          ...(answers.readPartial !== undefined ? { [CAPTURE_PARTIAL_KEY]: answers.readPartial } : {}),
        }) }] } },
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

it('OCR-C admits the benchmark formatted issuer IDs and address, never a changed digit or buyer ID', () => {
  for (const [printed, digits] of [['0-1054-73325-38-5', '0105473325385'],
    ['0-1054-53059-06-0', '0105453059060'], ['0-1059-37316-07-9', '0105937316079']]) {
    const text = `[SELLER]\nบริษัท ออฟฟิศซัพพลายจำลอง จำกัด\n326/24 ถนนจำลอง\nเลขประจำตัวผู้เสียภาษีอากร ${printed}\n[/SELLER]\n[BUYER]\n0105912524204\n[/BUYER]`;
    const parse = (taxId: string) => parseCaptureObservationsJson(observationsJson({ documents: [{ ref: 'd1', pageIndexes: [0],
      issuer: { name: 'บริษัท ออฟฟิศซัพพลายจำลอง จำกัด', taxId, address: '326/24 ถนนจำลอง' }, classification: classification() }] }), text);
    assert.equal(parse(digits!)!.documents[0]!.issuer.taxId, digits);
    assert.equal(parse(digits!)!.documents[0]!.issuer.address, '326/24 ถนนจำลอง');
    assert.equal(parse('0105912524204')!.documents[0]!.issuer.taxId, undefined);
    assert.equal(parse('9999999999999')!.documents[0]!.issuer.taxId, undefined);
  }
});

describe('receiptIssuerText identified seller footers', () => {
  const header = 'โรงพยาบาลทดสอบราษฎร์';
  const patient = `${header}\nผู้ป่วย นายทดสอบ\nเลขประจำตัวผู้เสียภาษี 1100700000001`;
  it('recovers an identified hospital footer while excluding patient identity', () => {
    for (const footer of [`${header}\nเลขประจำตัวผู้เสียภาษี 0994000163011`, 'เลขประจำตัวผู้เสียภาษีอากรของโรงพยาบาล 0994000163011', 'เลขประจำตัวผู้เสียภาษีอากร ของ โรงพยาบาล 0994000163011']) {
      const text = receiptIssuerText(`${patient}\nรวม 180.00\n${footer}`);
      assert.ok(text.includes('0994000163011')); assert.ok(!text.includes('1100700000001'));
      const parsed = parseCaptureObservationsJson(observationsJson({ documents: [{ ref: 'd1', pageIndexes: [0],
        issuer: { name: header, taxId: '0994000163011' }, classification: classification() }] }), `${patient}\n${footer}`);
      assert.equal(parsed!.documents[0]!.issuer.taxId, '0994000163011');
    }
  });
  it('blank lines and stray patient tax IDs cannot reopen an issuer block', () => {
    for (const tail of ['\n\n1100700000001', '\n\nเลขประจำตัวผู้เสียภาษี 1100700000001', `\nรับการรักษาที่ ${header}\nเลขประจำตัวผู้เสียภาษี 1100700000001`]) {
      assert.equal(receiptIssuerText(patient + tail), header);
    }
    for (const label of ['ชื่อผู้ป่วย', 'Patient']) {
      assert.equal(receiptIssuerText(`${header}\n${label} นายทดสอบ\n\nเลขประจำตัวผู้เสียภาษี 1100700000001`), header);
    }

  });
});

describe('capture read pages', () => {
  it('never shifts page three into page two when the transcription skipped a section', () => {
    assert.deepEqual(parseCaptureReadPages('=== PAGE 1 ===\nA\n=== PAGE 3 ===\nC', [7, 8, 9], false).map(page => ({ page: page.pageIndex, text: page.text })), [{ page: 7, text: 'A' }]);
    assert.deepEqual(parseCaptureReadPages('=== PAGE 2 ===\nB\n=== PAGE 1 ===\nA', [0, 1], false), []);
  });
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

  it('retains a narrative partial reason without inventing a provider output limit', async () => {
    const bedrock = stubBedrock({
      read: '=== PAGE 1 ===\nITEM 7,000.00',
      readPartial: 'the totals block at the bottom is too small to read',
    });
    try {
      const result = await controller().captureRead('secret', readRequest({
        chunk: { id: 'c1', kind: 'image', mimeType: 'image/jpeg', pageIndexes: [0], fileLabel: 'f', contentBase64: 'aW1n' },
      }));
      assert.equal(result.status, 'ok');
      assert.deepEqual(result.pages?.map((page) => page.truncated), [false]);
      assert.equal(result.pages?.[0]!.text, 'ITEM 7,000.00', 'what WAS read is still kept');
    } finally { bedrock.restore(); }
  });

  it('asks stage 1 for every printed line and offers the way to admit a partial read', () => {
    const prompt = captureReadPrompt('BASE', 1, 'image');
    assert.ok(prompt.includes('Include the summary and total block at the bottom'),
      'the totals block is the thing that went missing');
    assert.ok(prompt.includes('even when it is printed much smaller than the item rows'));
    assert.ok(prompt.includes(`\`${CAPTURE_PARTIAL_KEY}\``), 'and the model is told how to say it could not');
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

  /**
   * Owner 2026-09-29 ("หมวดหมู่ AI ควรจับได้เลย"): the API always sent this route a catalogue, but the
   * route never asked for a category and the parser had nowhere to keep one, so no PDF draft ever got
   * the category a photo of the same receipt gets.
   */
  it('reads the document category from the catalogue the API sent, and from nothing else', async () => {
    const answer = (expenseCategoryId: string) => observationsJson({
      documents: [{
        ref: 'd1', pageIndexes: [0], kind: 'RECEIPT', family: 'EXPENSE_EVIDENCE', issuer: { name: 'ร้านตัวอย่าง จำกัด' },
        documentNumber: 'INV-77', categorySuggestion: { expenseCategoryId, confidence: 0.91, evidenceSignals: ['น้ำดื่ม'] },
        classification: classification(),
      }],
    });
    const offer = extractRequest({
      activeCategories: [{ id: 'cmumxahlk0005kwk1d8lunr6r', name: 'ค่าเครื่องดื่ม' }, { id: 'cmumxahll0006kwk1imv1lko3', name: 'ค่าขนส่ง' }],
    });
    const keyed = stubBedrock({ extract: [answer('c1')] });
    try {
      const result = await controller().captureExtract('secret', offer);
      assert.equal(result.status, 'ok');
      assert.deepEqual(result.observations?.documents[0]!.categorySuggestion,
        { expenseCategoryId: 'cmumxahlk0005kwk1d8lunr6r', confidence: 0.91, evidenceSignals: ['น้ำดื่ม'] },
        'the short key the model named maps back to the id the API sent');
      // Ids created in one bootstrap differ in a few characters; a real read copied the next row's.
      assert.ok(keyed.calls[0]!.userText.includes('[{"id":"c1","name":"ค่าเครื่องดื่ม"},{"id":"c2","name":"ค่าขนส่ง"}]'));
      assert.ok(!keyed.calls[0]!.userText.includes('cmumxahl'), 'the model never sees a database id');
    } finally { keyed.restore(); }

    const copiedId = stubBedrock({ extract: [answer('cmumxahlk0005kwk1d8lunr6r')] });
    try {
      const result = await controller().captureExtract('secret', offer);
      assert.equal(result.observations?.documents[0]!.categorySuggestion, undefined, 'only an offered key is read');
    } finally { copiedId.restore(); }

    const notOffered = stubBedrock({ extract: [answer('c1')] });
    try {
      const result = await controller().captureExtract('secret', extractRequest());
      assert.equal(result.status, 'ok');
      assert.equal(result.observations?.documents[0]!.categorySuggestion, undefined, 'no catalogue, no category');
      assert.ok(notOffered.calls[0]!.userText.includes('ACTIVE_CATEGORY_CATALOG_START\n[]\n'));
    } finally { notOffered.restore(); }
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

  it('keeps a category pick only when it clears the photo reader\'s bar', () => {
    const catalogue = new Set(['cat-water']);
    const withPick = (categorySuggestion: unknown) => parseCaptureObservationsJson(observationsJson({
      documents: [{
        ref: 'd1', pageIndexes: [0], kind: 'RECEIPT', family: 'EXPENSE_EVIDENCE',
        issuer: { name: 'ร้านตัวอย่าง จำกัด' }, categorySuggestion, classification: classification(),
      }],
    }), WINDOW_TEXT, undefined, catalogue)?.documents[0]!.categorySuggestion;
    const pick = { expenseCategoryId: 'cat-water', confidence: 0.9, evidenceSignals: ['น้ำดื่ม 2 24.00'] };
    assert.deepEqual(withPick(pick), pick);
    assert.equal(withPick({ ...pick, expenseCategoryId: 'cat-invented' }), undefined, 'an id outside the catalogue');
    assert.equal(withPick({ ...pick, confidence: 1.4 }), undefined, 'a confidence outside [0, 1]');
    assert.equal(withPick({ ...pick, evidenceSignals: ['ค่าเครื่องดื่ม'] }), undefined, 'evidence the window never printed');
    assert.equal(withPick({ ...pick, evidenceSignals: [] }), undefined, 'no evidence at all');
    assert.equal(parseCaptureObservationsJson(observationsJson({
      documents: [{ ref: 'd1', pageIndexes: [0], kind: 'RECEIPT', family: 'EXPENSE_EVIDENCE', issuer: {}, categorySuggestion: pick, classification: classification() }],
    }), WINDOW_TEXT)?.documents[0]!.categorySuggestion, undefined, 'no catalogue, no category');
    assert.ok(CAPTURE_EXTRACT_PROMPT.includes('"categorySuggestion":{"expenseCategoryId"'), 'and the prompt asks for it');
    assert.ok(CAPTURE_EXTRACT_PROMPT.includes('Omit categorySuggestion when the catalogue is empty or no category is clearly supported'));
  });

  it('returns null when nothing survives, so the caller can spend its repair', () => {
    assert.equal(parseCaptureObservationsJson('{"documents":[]}', WINDOW_TEXT), null);
    assert.equal(parseCaptureObservationsJson('not json', WINDOW_TEXT), null);
  });

  /**
   * W08 benchmark defect, 2026-09-19. The prompt described the classification object by NAMING its
   * keys and left every enum open, so a real Bedrock read of a clean two-page receipt answered
   * `contentKind: "RECEIPT"`, `businessDirection: "EXPENSE"`, `transactionState: "COMPLETED"` —
   * plausible words, none of them in the allowlist. `parseBusinessDocumentClassification` dropped
   * the document, the parser then had none, and the whole window came back OCR_SCHEMA_INVALID
   * after a wasted repair retry. The prompt must carry the allowlist itself, from the contract.
   */
  /**
   * W08 benchmark defect, 2026-09-19. `printedPages` is what §16.8 reconciliation reads to decide
   * "this document says it has 3 pages and I have seen 1 and 3". Nothing produced it: the prompt
   * asked only for `printedPage`, the parser never looked, and the assembly's only source was the
   * merge of two window observations. A complete 20-page receipt read in ONE window therefore knew
   * page 1 of 20 and reported the other nineteen as missing.
   */
  it('reads every printed page number the window covered, sorted and bounded (W08)', () => {
    const parsed = parseCaptureObservationsJson(observationsJson({
      documents: [{
        ref: 'd1', pageIndexes: [0, 1], kind: 'RECEIPT', family: 'EXPENSE_EVIDENCE',
        issuer: { name: 'ร้านตัวอย่าง จำกัด' }, classification: classification(),
        printedPage: { number: 1, of: 2 }, printedPages: [2, 1, 2, 0, -3, 'x'],
      }],
    }), WINDOW_TEXT);
    assert.deepEqual(parsed?.documents[0]!.printedPages, [1, 2], 'deduped, sorted, junk dropped');
    assert.ok(CAPTURE_EXTRACT_PROMPT.includes('"printedPages":[1,2]'), 'and the prompt asks for it');
  });

  it('leaves printedPages absent when the model reports none', () => {
    const parsed = parseCaptureObservationsJson(observationsJson({}), WINDOW_TEXT);
    assert.equal(parsed?.documents[0]!.printedPages, undefined);
  });

  it('spells out every classification value the parser will accept (W08)', () => {
    for (const value of [
      ...BUSINESS_DOCUMENT_CONTENT_KINDS,
      ...BUSINESS_DOCUMENT_DIRECTIONS,
      ...BUSINESS_DOCUMENT_TRANSACTION_STATES,
      ...BUSINESS_DOCUMENT_EVIDENCE_ROLES,
    ]) {
      assert.ok(CAPTURE_EXTRACT_PROMPT.includes(`"${value}"`), `the prompt never offers ${value}`);
    }
    assert.ok(CAPTURE_EXTRACT_PROMPT.includes('CLOSED'), 'and it says the lists are closed');
  });

  it('drops a document whose classification is outside the allowlist, exactly as production did', () => {
    const invented = parseCaptureObservationsJson(observationsJson({
      documents: [{
        ref: 'd1', pageIndexes: [0], kind: 'RECEIPT', family: 'EXPENSE_EVIDENCE',
        issuer: { name: 'ร้านค้าตัวอย่าง' },
        classification: {
          contentKind: 'RECEIPT', documentFamily: 'EXPENSE_EVIDENCE', documentKind: 'RECEIPT',
          businessDirection: 'EXPENSE', transactionState: 'COMPLETED', evidenceRoles: ['EXPENSE_EVIDENCE'],
          confidence: 0.95, evidenceSignals: [], amountSignals: [], settlementSignals: [],
          missingRequiredSignals: [], contradictionSignals: [], requiresClarification: false,
        },
      }],
    }), WINDOW_TEXT);
    assert.equal(invented, null, 'which is why the prompt has to name the values');
  });
});

/** W10 D2: the prompt is the first of the two layers; the API assembly never trusts it alone. */
describe('capture-extract prompt — the retail N/V summary vocabulary', () => {
  it('names every Thai summary row of the 7-Eleven / Lotus\'s / Big C / Makro layout', () => {
    for (const row of [
      'มูลค่าสินค้ารวม', 'หักส่วนลด', 'สินค้าไม่เสียภาษีมูลค่าเพิ่ม',
      'มูลค่าสินค้าก่อนภาษีมูลค่าเพิ่ม', 'มูลค่าสินค้ารวมภาษีมูลค่าเพิ่ม', 'รวมเงินทั้งสิ้น',
    ]) {
      assert.ok(CAPTURE_EXTRACT_PROMPT.includes(row), `the prompt never mentions ${row}`);
    }
  });

  it('says which kind each of them is, so a goods subtotal is never a discount or the tax', () => {
    assert.match(CAPTURE_EXTRACT_PROMPT, /ONLY a row that says หักส่วนลด \/ ส่วนลด \/ Discount is "applied_discount"/);
    assert.match(CAPTURE_EXTRACT_PROMPT, /สินค้าไม่เสียภาษีมูลค่าเพิ่ม[\s\S]{0,220}is "summary"/);
    assert.match(CAPTURE_EXTRACT_PROMPT, /สินค้าไม่เสียภาษีมูลค่าเพิ่ม[\s\S]{0,260}never a discount and never a tax/);
    assert.match(CAPTURE_EXTRACT_PROMPT, /bare "ภาษีมูลค่าเพิ่ม <amount>"[\s\S]{0,160}kind "tax"/);
    assert.match(CAPTURE_EXTRACT_PROMPT, /รวมเงินทั้งสิ้น[\s\S]{0,120}"document_total"/);
    assert.match(CAPTURE_EXTRACT_PROMPT, /มูลค่าสินค้ารวม[\s\S]{0,140}"merchandise"/);
  });

  it('tells the model to read each row with its OWN amount, which is how the block shifted by one', () => {
    assert.ok(CAPTURE_EXTRACT_PROMPT.includes('ON ITS OWN LINE'));
    assert.ok(CAPTURE_EXTRACT_PROMPT.includes('shifts the whole block by one'));
  });
});

/** W10 D3: the stage-1 unwrapper, which is where a declared partial enters the pipeline. */
describe('capture natural-text parser', () => {
  const parse = (text: string) => parseCaptureNaturalText(text, 100);

  it('unwraps the JSON contract and reports no partial when the model declared none', () => {
    assert.deepEqual(parse(JSON.stringify({ natural_text: 'ROWS' })), { text: 'ROWS' });
    assert.deepEqual(parse(JSON.stringify({ natural_text: 'ROWS', partial: false })), { text: 'ROWS' });
    assert.deepEqual(parse('ROWS without a wrapper'), { text: 'ROWS without a wrapper' });
  });

  it('carries the model\'s reason for a partial transcription', () => {
    assert.deepEqual(parse(JSON.stringify({ natural_text: 'ROWS', partial: 'totals too small' })),
      { text: 'ROWS', partialReason: 'totals too small' });
  });

  it('accepts a bare admission with no reason', () => {
    assert.deepEqual(parse(JSON.stringify({ natural_text: 'ROWS', partial: true })),
      { text: 'ROWS', partialReason: 'declared' });
  });

  it('still refuses an empty answer and still applies the caller\'s ceiling', () => {
    assert.equal(parse(JSON.stringify({ natural_text: '   ' })), null);
    assert.equal(parseCaptureNaturalText(JSON.stringify({ natural_text: 'x'.repeat(50) }), 10)!.text.length, 10);
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

describe('W07A local numeric evidence', () => {
  const evidence = `${WINDOW_TEXT}\nTOTAL 1,177.00\nCASH 1,200.00\nCHANGE 23.00\nDISCOUNT -23.00\nlarge 9007199254740993.00`;
  const totals = (amount: string, evidenceSpan: string) => parseCaptureObservationsJson(observationsJson({
    totals: [{ documentRef: 'd1', kind: 'document_total', amount, evidenceSpan }],
  }), evidence)!;

  it('does not borrow a number from another row or accept a mismatched tender/change role', () => {
    for (const [amount, span] of [['1200.00', 'TOTAL 1,177.00'], ['1200.00', 'CASH 1,200.00'], ['23.00', 'CHANGE 23.00'],
      ['1200.00', 'TOTAL 1,177.00\nCASH 1,200.00\nCHANGE 23.00']]) {
      const result = totals(amount!, span!);
      assert.deepEqual(result.totals, []);
      assert.ok(result.completeness.notes.some(note => note.startsWith('rejected_unproven_fields:')));
    }
    assert.equal(totals('1177.00', 'TOTAL 1,177.00').totals[0]?.amount, '1177.00');
  });

  it('rejects prefix parsing, lost signs and floating point collisions', () => {
    for (const [amount, span] of [['1177garbage', 'TOTAL 1,177.00'], ['-1177', 'TOTAL 1,177.00'],
      ['23', 'DISCOUNT -23.00'], ['9007199254740992', 'large 9007199254740993.00']]) {
      assert.deepEqual(totals(amount!, span!).totals, []);
    }
    assert.equal(totals('9007199254740993.00', 'large 9007199254740993.00').totals[0]?.amount, '9007199254740993.00');
  });

  it('retains a signed discount and drops only unproven fields on an otherwise readable row', () => {
    const result = parseCaptureObservationsJson(observationsJson({ items: [{ id: '0:9', documentRef: 'd1',
      description: 'DISCOUNT', amount: '-23.00', unitPrice: '1200.00', event: 'discount', evidenceSpan: 'DISCOUNT -23.00' }],
    }), evidence)!;
    assert.equal(result.items[0]?.amount, '-23.00');
    assert.equal(result.items[0]?.unitPrice, undefined);
    assert.ok(result.completeness.notes.length);
  });

  it('marks local text and page clipping as incomplete', () => {
    assert.equal(parseCaptureNaturalText('x'.repeat(101), 100)?.partialReason, 'local_text_limit');
    const pages = parseCaptureReadPages(`=== PAGE 1 ===\n${'x'.repeat(20001)}\n=== PAGE 2 ===\ncomplete`, [0, 1], false);
    assert.deepEqual(pages.map(page => page.truncated), [true, false]);
    assert.equal(pages[0]?.text.length, 20000);
  });
});


it('Z2: recorded cut off; no totals block on an intermediate PDF page does not trigger a resplit loop', async () => {
  const bedrock = stubBedrock({ read: '=== PAGE 1 ===\nPAGE 1 OF 2\nSERVICE 60.00\n=== PAGE 2 ===\nTOTAL 100.00',
    readPartial: 'cut off; no totals block', readStopReason: 'end_turn', readOutputTokens: 2200 });
  try {
    const result = await controller().captureRead('secret', readRequest({ chunk: { ...readRequest().chunk, pageIndexes: [0, 1] } }));
    assert.deepEqual(result.pages?.map(page => page.truncated), [false, false]);
    assert.equal(result.pages?.[0]?.text, 'PAGE 1 OF 2\nSERVICE 60.00');
    assert.equal(result.pages?.[1]?.text, 'TOTAL 100.00');
    assert.equal(bedrock.calls.length, 1);
    assert.match(bedrock.calls[0]!.systemPrompt, /only where printed/);
  } finally { bedrock.restore(); }
});

it('Z2: genuinely incomplete JSON still marks the last available page truncated', async () => {
  const bedrock = stubBedrock({ readRaw: '{"natural_text":"=== PAGE 1 ===\\nSERVICE 60.00', readStopReason: 'end_turn' });
  try {
    const result = await controller().captureRead('secret', readRequest({ chunk: { ...readRequest().chunk, pageIndexes: [0] } }));
    assert.equal(result.pages?.[0]?.truncated, true);
    assert.equal(parseCaptureNaturalText('{"natural_text":"unfinished', 100)?.truncated, true);
    assert.equal(parseCaptureNaturalText(JSON.stringify({ natural_text: 'x'.repeat(101), partial: 'no totals' }), 100)?.truncated, true);
  } finally { bedrock.restore(); }
});

it('Y3: a dense intermediate A4 page at the recorded ~2,200-token scale is complete without a printed total', async () => {
  const text = '=== PAGE 1 ===\n' + Array.from({ length: 110 }, (_, index) => `Line ${index + 1} service description quantity 1 amount 10.00`).join('\n');
  const bedrock = stubBedrock({ read: text, readOutputTokens: 2_200 });
  try {
    const result = await controller().captureRead('secret', readRequest({ chunk: { ...readRequest().chunk, pageIndexes: [0] } }));
    assert.equal(result.status, 'ok'); assert.equal(result.pages?.[0]?.truncated, false);
    assert.ok(result.pages?.[0]?.text.includes('Line 110'));
    assert.equal(bedrock.calls[0].maxTokens, 8192, 'the recorded 2,200 tokens is below the actual call cap');
    assert.match(bedrock.calls[0].systemPrompt, /complete intermediate page may have no totals/);
    assert.match(bedrock.calls[0].systemPrompt, /Dense A4 pages must be transcribed in full/);
    assert.doesNotMatch(bedrock.calls[0].systemPrompt, /A page whose totals you did not transcribe is not a read page/);
  } finally { bedrock.restore(); }
});

it('R10 Q2: header window keeps the printed Buddhist date when the model omits documentDate', () => {
  const fixture = JSON.parse(readFileSync(resolve(__dirname, '../../../../../../api/src/modules/expenses/domain/logic/fixtures/live-r10-pdf-excerpts.json'), 'utf8'));
  const header = `บริษัท ตัวอย่าง จำกัด\nเลขที่ INV-26\n${fixture.twoPageHeader}\nสินค้า 100.00`;
  const read = (text: string, documents?: any[]) => parseCaptureObservationsJson(observationsJson({
    documents: documents ?? [{ ref: 'd1', pageIndexes: [0], issuer: { name: 'บริษัท ตัวอย่าง จำกัด' }, classification: classification() }],
    items: [], components: [], totals: [],
  }), text, '2026-10-16')!;
  assert.equal(read(header).documents[0]!.documentDate, '2026-09-26');
  assert.equal(read(header + '\nครบกำหนด 30/09/2569', [{ ref: 'd1', pageIndexes: [0], issuer: {}, documentDate: '2026-09-30', classification: classification() }]).documents[0]!.documentDate, '2026-09-26');
  assert.equal(read('บริษัท ตัวอย่าง จำกัด\nรวมทั้งสิ้น 100.00').documents[0]!.documentDate, undefined);
  assert.equal(read(header + '\nวันที่ 27/09/2569').documents[0]!.documentDate, undefined, 'conflicting header dates ask instead');
});

it('R10 Q3: the recorded signature-only page is a stored empty-facts window; unread invoices still fail closed', () => {
  const fixture = JSON.parse(readFileSync(resolve(__dirname, '../../../../../../api/src/modules/expenses/domain/logic/fixtures/live-r10-pdf-excerpts.json'), 'utf8'));
  const empty = { documents: [], items: [], components: [], totals: [], payments: [], refunds: [],
    completeness: { itemsTruncated: false, unreadableRows: 0, pagesCovered: [2], notes: [] } };
  const parsed = parseCaptureObservationsJson(JSON.stringify(empty), `=== PAGE 2 ===\n${fixture.signaturePage}`)!;
  assert.ok(parsed); assert.deepEqual(parsed.documents, []); assert.deepEqual(parsed.completeness.pagesCovered, [2]);
  for (const text of ['ใบเสร็จ สินค้า 100.00 ผู้รับเงิน', 'ผู้รับเงิน [unreadable]', fixture.signaturePage + '\nวันที่ 26/09/2569']) {
    assert.equal(parseCaptureObservationsJson(JSON.stringify(empty), text), null, text);
  }
});
