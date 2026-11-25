import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { UnauthorizedException, BadRequestException, RequestMethod } from '@nestjs/common';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { defer, firstValueFrom } from 'rxjs';
import { AI_BUDGET_STEP_BOUNDS, AI_BUDGET_IMAGE_TOKEN_CEILING, aiBudgetInvocationKey } from '@watchdog-bms/contracts';
import { runWithUsageContext, drainUsage, appendUsage } from '../../../../common/usage/usage-context';
import { providerInputTokenUpperBound } from '../../../../common/usage/ai-budget-provider';
import { AiUsageInterceptor } from '../../../../common/usage/ai-usage.interceptor';
import { BASE64_MEDIA_ROUTES, LineAiInternalController, receiptIssuerText, parseReceiptOcrJson, parseUtilityDocuments, receiptRereadImage, receiptItemsMismatch, shouldRereadReceiptImage, validateIntakeOnePassReceipt } from './line-ai-internal.controller';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { IntentRouterAgent } from '../../agents/intent-router.agent';
import type { BusinessDocumentClassification, LineAiTurnRequest, ReceiptOcrFieldResult } from '@watchdog-bms/contracts';
import { gateBusinessDocumentClassification, parseBusinessDocumentClassification } from '../../domain/logic/business-document-classification.logic';

const linkedUserReq: LineAiTurnRequest = {
  requestId: 'req-ctrl',
  webhookEventId: 'evt-ctrl',
  messageText: 'ดูสต็อก',
  messagePreviewHash: 'abc',
  userContext: {
    lineUserId: 'line-1',
    internalUserId: 'user-1',
    companyId: 'company-1',
    membershipId: 'mem-1',
    permissions: ['inventory.product.read'],
    roles: ['owner'],
    locale: 'th-TH',
  },
};

describe('LineAiInternalController', () => {
  it('reports only this authenticated serving runtime draft-edit flag', async () => {
    assert.deepEqual(await new LineAiInternalController(
      { aiGatewayInternalSecret: 'secret', lineAiDraftEditEnabled: true } as any,
      { execute: async () => { throw new Error('not a model turn'); }, lineDraftEditCapabilityEnabled: async () => true } as any,
    ).lineDraftEditCapability('secret', { requestId: 'probe-1' }), { enabled: true });
    assert.deepEqual(await new LineAiInternalController(
      { aiGatewayInternalSecret: 'secret', lineAiDraftEditEnabled: false } as any,
      { execute: async () => { throw new Error('not a model turn'); }, lineDraftEditCapabilityEnabled: async () => false } as any,
    ).lineDraftEditCapability('secret', { requestId: 'probe-2' }), { enabled: false });
    await assert.rejects(() => new LineAiInternalController(
      { aiGatewayInternalSecret: 'secret', lineAiDraftEditEnabled: true } as any,
      { execute: async () => { throw new Error('not a model turn'); }, lineDraftEditCapabilityEnabled: async () => true } as any,
    ).lineDraftEditCapability('wrong', { requestId: 'probe-3' }), UnauthorizedException);
  });

  it('fails closed when internal secret is not configured', async () => {
    const controller = new LineAiInternalController(
      { aiGatewayInternalSecret: undefined } as any,
      { execute: async () => { throw new Error('should not execute'); } } as any,
    );

    await assert.rejects(
      () => controller.lineTurn(undefined, linkedUserReq),
      (error: unknown) => error instanceof UnauthorizedException,
    );
  });

  it('fails closed when secret does not match', async () => {
    const controller = new LineAiInternalController(
      { aiGatewayInternalSecret: 'correct-secret' } as any,
      { execute: async () => { throw new Error('should not execute'); } } as any,
    );

    await assert.rejects(
      () => controller.lineTurn('wrong-secret', linkedUserReq),
      (error: unknown) => error instanceof UnauthorizedException,
    );
  });

  it('rejects missing requestId with BadRequestException', async () => {
    const controller = new LineAiInternalController(
      { aiGatewayInternalSecret: 'secret' } as any,
      { execute: async () => { throw new Error('should not execute'); } } as any,
    );

    await assert.rejects(
      () => controller.lineTurn('secret', { userContext: { companyId: 'c1' } } as any),
      (error: unknown) => error instanceof BadRequestException,
    );
  });

  it('linked user happy path delegates to use case and returns response', async () => {
    const expectedReply = 'สต็อกสินค้า: 5 รายการ';
    const mockUseCase = {
      execute: async (req: LineAiTurnRequest) => ({
        requestId: req.requestId,
        replyText: expectedReply,
        sourceRefs: [],
        sourceLabels: [],
        webLinks: [],
        intent: 'read_detail' as const,
        agent: 'inventory' as const,
        refused: false,
        toolsInvoked: ['inventory.list_low_stock'],
        durationMs: 10,
      }),
    };

    const controller = new LineAiInternalController(
      { aiGatewayInternalSecret: 'secret', aiAgentRegistryEnabled: true } as any,
      mockUseCase as any,
    );

    const result = await controller.lineTurn('secret', linkedUserReq);
    assert.equal(result.replyText, expectedReply);
    assert.equal(result.refused, false);
  });

  it('rejects the local agent registry without the internal secret', () => {
    const controller = new LineAiInternalController(
      { aiGatewayInternalSecret: 'secret', aiAgentRegistryEnabled: true } as any,
      { execute: async () => { throw new Error('should not execute'); } } as any,
    );

    assert.throws(() => controller.agents(undefined), UnauthorizedException);
  });

  it('returns the local agent registry with the internal secret', () => {
    const controller = new LineAiInternalController(
      { aiGatewayInternalSecret: 'secret', aiAgentRegistryEnabled: true } as any,
      { execute: async () => { throw new Error('should not execute'); } } as any,
    );

    const result = controller.agents('secret');

    assert.equal(result.registryEnabled, true);
    const tax = result.agents.find((agent) => agent.agent === 'tax');
    assert.equal(tax?.status, 'limited');
    assert.ok(tax?.tools.some((tool) => tool.name === 'tax.get_tax_code_profile'));
    assert.ok(JSON.stringify(result).includes('local-ai-internal-secret') === false);
  });

  // Owner 2026-08-28: no separate OCR vendor key exists any more — the page is read by the
  // configured vision provider. A PDF is the one media type that still needs Bedrock, because
  // only its Converse document block can carry one; that door stays closed and typed.
  it('receipt OCR returns not_configured for a PDF when the provider has no document channel', async () => {
    const controller = new LineAiInternalController(
      {
        aiGatewayInternalSecret: 'secret',
        modelProvider: 'openai',
        openAiApiKey: 'should-not-be-used',
        aiToolTimeoutMs: 1000,
      } as any,
      { execute: async () => { throw new Error('should not execute'); } } as any,
    );

    const result = await controller.receiptOcr('secret', {
      requestId: 'req-ocr',
      companyId: 'company-1',
      userId: 'user-1',
      attachment: { id: 'att-1', mimeType: 'application/pdf', purpose: 'receipt', contentBase64: 'ZmFrZQ==' },
    });

    assert.equal(result.status, 'failed');
    assert.equal(result.errorCode, 'PDF_CAPTURE_REQUIRED');
  });

  it('receipt OCR keeps PDFs on the Bedrock document channel', async () => {
    const originalFetch = globalThis.fetch;
    let thirdPartyOcrCalled = false;
    globalThis.fetch = (async () => {
      thirdPartyOcrCalled = true;
      throw new Error('no network in test');
    }) as any;

    try {
      const controller = new LineAiInternalController(
        {
          aiGatewayInternalSecret: 'secret',
          modelProvider: 'openai',
          openAiApiKey: 'should-not-be-used',
          aiToolTimeoutMs: 1000,
        } as any,
        { execute: async () => { throw new Error('should not execute'); } } as any,
      );

      const result = await controller.receiptOcr('secret', {
        requestId: 'req-pdf',
        companyId: 'company-1',
        userId: 'user-1',
        attachment: { id: 'att-pdf', mimeType: 'application/pdf', purpose: 'receipt', contentBase64: 'JVBERi0=' },
      });

      // Only Bedrock has a document channel; anything else must fail typed, not silently
      // send the PDF to any image-only third-party OCR endpoint.
      assert.equal(result.status, 'failed');
      assert.equal(result.errorCode, 'PDF_CAPTURE_REQUIRED');
      assert.equal(thirdPartyOcrCalled, false, 'no third-party OCR vendor is called any more');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('receipt OCR runs two stages: a vision natural_text read then provider field extraction', async () => {
    const originalFetch = globalThis.fetch;
    let stageOneBody: any = {};
    let stageOneAuth = '';
    let extractionInput = '';
    let extractionInstructions = '';
    globalThis.fetch = (async (url: any, init: any) => {
      const requestedUrl = String(url);
      if (JSON.parse(init.body as string).input?.some?.((item: any) => JSON.stringify(item).includes('input_image'))) {
        stageOneAuth = init.headers.Authorization;
        stageOneBody = JSON.parse(init.body);
        return new Response(JSON.stringify({ status: 'completed',
            output_text: '{"natural_text":"# ใบเสร็จ ร้านกาแฟ\\nยอดก่อนค่าบริการ 55.00\\nService charge 10.00\\nหัก ณ ที่จ่าย 1.50\\nยอดรวม 65.00 บาท"}',
          }), { status: 200 });
      }
      // Stage 2: OpenAI provider (Responses API) maps OCR markdown -> draft fields.
      const extractionBody = JSON.parse(init.body);
      extractionInput = JSON.stringify(extractionBody.input);
      extractionInstructions = String(extractionBody.instructions ?? '');
      return new Response(JSON.stringify({ status: 'completed',
          output_text: JSON.stringify({
            classification: {
              contentKind: 'DOCUMENT', documentFamily: 'EXPENSE_EVIDENCE', documentKind: 'RECEIPT',
              businessDirection: 'PURCHASE_EXPENSE', transactionState: 'PAID', evidenceRoles: ['EXPENSE_SUPPORT'],
              confidence: 0.95, evidenceSignals: ['ร้านกาแฟ'], amountSignals: ['ยอดรวม 65.00'],
              settlementSignals: ['ใบเสร็จ'], missingRequiredSignals: [], contradictionSignals: [], requiresClarification: false,
            },
            fields: {
              vendorName: 'ร้านกาแฟ',
              subtotalAmount: '55.00',
              grandTotalAmount: '65.00',
              whtRate: '0.03',
              whtAmount: '1.50',
              vatMode: 'NO_VAT',
              additionalCharges: [{
                kind: 'SERVICE_CHARGE',
                description: 'Service charge',
                amount: '10.00',
                vatRate: '0',
                evidenceSignal: 'Service charge 10.00',
                confidence: 0.96,
              }],
              categorySuggestion: {
                expenseCategoryId: 'cat-meals',
                confidence: 0.92,
                evidenceSignals: ['ร้านกาแฟ'],
              },
              missingFields: ['vendorTaxId'],
            },
          }),
        }), { status: 200 });
    }) as any;

    try {
      const controller = new LineAiInternalController(
        {
          aiGatewayInternalSecret: 'secret',
          aiToolTimeoutMs: 1000,
          modelProvider: 'openai',
          openAiApiKey: 'openai-key',
          openAiModel: 'gpt-test',
        } as any,
        { execute: async () => { throw new Error('should not execute'); } } as any,
      );
      const result = await controller.receiptOcr('secret', {
        requestId: 'req-ocr',
        companyId: 'company-1',
        userId: 'user-1',
        activeCategories: [{ id: 'cat-meals', name: 'ค่าอาหาร' }],
        attachment: { id: 'att-1', mimeType: 'image/jpeg', purpose: 'receipt', contentBase64: 'ZmFrZQ==' },
      });

      assert.equal(result.status, 'ok');
      assert.equal(result.fields?.vendorName, 'ร้านกาแฟ');
      assert.equal(result.fields?.grandTotalAmount, '65.00');
      assert.equal(result.fields?.whtAmount, '1.50');
      assert.deepEqual(result.fields?.additionalCharges, [{
        kind: 'SERVICE_CHARGE',
        description: 'Service charge',
        amount: '10.00',
        vatRate: '0',
        evidenceSignal: 'Service charge 10.00',
        confidence: 0.96,
      }]);
      assert.deepEqual(result.fields?.categorySuggestion, {
        expenseCategoryId: 'cat-meals',
        confidence: 0.92,
        evidenceSignals: ['ร้านกาแฟ'],
      });
      assert.equal(result.classification?.documentKind, 'RECEIPT');
      assert.deepEqual(result.classification?.settlementSignals, ['ใบเสร็จ']);
      assert.equal(stageOneAuth, 'Bearer openai-key', 'stage 1 reads on the configured provider, not a separate OCR vendor');
      assert.ok(JSON.stringify(stageOneBody.input).includes('input_image'), 'stage 1 must send the page as vision input');
      assert.ok(String(stageOneBody.instructions).includes('natural_text'), 'stage 1 keeps the {"natural_text"} read contract');
      assert.ok(extractionInput.includes('ใบเสร็จ ร้านกาแฟ'), 'stage 2 must receive the OCR markdown, not the image');
      assert.ok(extractionInstructions.includes('multiple independent expense transactions'), 'stage 2 must forbid collapsing a multi-entry ledger into one expense');
      assert.ok(extractionInput.includes('cat-meals'), 'stage 2 must receive the bounded active category catalogue');
      assert.ok(!extractionInput.includes('ZmFrZQ=='), 'image bytes must not reach stage 2');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // UAT 2026-08-14: a two-item bill returned one line. The item block now travels as `lines`, and
  // like every other extracted number each row's money must appear in the stage-1 OCR text.
  it('receipt OCR keeps printed sibling rows and flags an unprinted row amount', async () => {
    const originalFetch = globalThis.fetch;
    const runOcr = async (rows: unknown[]) => {
      globalThis.fetch = (async (url: any, init: any) => {
        if (JSON.parse(init.body as string).input?.some?.((item: any) => JSON.stringify(item).includes('input_image'))) {
          return new Response(JSON.stringify({ status: 'completed',
              output_text: '{"natural_text":"ใบเสร็จ ร้านอาหาร\\nพิซซ่า 1 524.00\\nปีกไก่ 2 298.00\\nรวม 822.00 PAID"}',
            }), { status: 200 });
        }
        return new Response(JSON.stringify({ status: 'completed',
            output_text: JSON.stringify({
              classification: {
                contentKind: 'DOCUMENT', documentFamily: 'EXPENSE_EVIDENCE', documentKind: 'RECEIPT',
                businessDirection: 'PURCHASE_EXPENSE', transactionState: 'PAID', evidenceRoles: ['EXPENSE_SUPPORT'],
                confidence: 0.95, evidenceSignals: ['ร้านอาหาร'], amountSignals: ['822.00'],
                settlementSignals: ['ใบเสร็จ'], missingRequiredSignals: [], contradictionSignals: [], requiresClarification: false,
              },
              fields: { grandTotalAmount: '822.00', vatMode: 'NO_VAT', lines: rows },
            }),
          }), { status: 200 });
      }) as any;
      const controller = new LineAiInternalController(
        {
          aiGatewayInternalSecret: 'secret', aiToolTimeoutMs: 1000,
          modelProvider: 'openai', openAiApiKey: 'openai-key', openAiModel: 'gpt-test',
        } as any,
        { execute: async () => { throw new Error('should not execute'); } } as any,
      );
      return controller.receiptOcr('secret', {
        requestId: 'req-ocr-lines',
        companyId: 'company-1',
        userId: 'user-1',
        attachment: { id: 'att-1', mimeType: 'image/jpeg', purpose: 'receipt', contentBase64: 'ZmFrZQ==' },
      });
    };

    try {
      const split = await runOcr([
        { description: 'พิซซ่า', quantity: '1', amount: '524.00', evidenceSignal: 'พิซซ่า 1 524.00', confidence: 0.94 },
        { description: 'ปีกไก่', quantity: '2', amount: '298.00', evidenceSignal: 'ปีกไก่ 2 298.00', confidence: 0.92 },
      ]);
      assert.deepEqual(split.fields?.lines, [
        { description: 'พิซซ่า', quantity: '1', amount: '524.00', evidenceSignal: 'พิซซ่า 1 524.00', confidence: 0.94 },
        { description: 'ปีกไก่', quantity: '2', amount: '298.00', evidenceSignal: 'ปีกไก่ 2 298.00', confidence: 0.92 },
      ]);

      const invented = await runOcr([
        { description: 'พิซซ่า', quantity: '1', amount: '524.00', evidenceSignal: 'พิซซ่า 1 524.00' },
        { description: 'ปีกไก่', quantity: '2', amount: '299.00', evidenceSignal: 'ปีกไก่ 2 298.00' },
      ]);
      assert.deepEqual(invented.fields?.lines?.map((line) => line.amount), ['524.00']);
      assert.ok(invented.fields?.missingFields?.includes('lines'), '299.00 appears nowhere in the OCR text');
      assert.equal(invented.fields?.grandTotalAmount, '822.00', 'the printed total still survives');

      const single = await runOcr([
        { description: 'พิซซ่า', quantity: '1', amount: '524.00', evidenceSignal: 'พิซซ่า 1 524.00' },
      ]);
      assert.equal(single.fields?.lines, undefined, 'one row says nothing the summary line does not');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('receipt OCR drops category suggestions outside the active catalogue or without exact OCR evidence', async () => {
    const originalFetch = globalThis.fetch;
    const runOcr = async (expenseCategoryId: string, evidenceSignals: string[]) => {
      globalThis.fetch = (async (url: any, init: any) => {
        if (JSON.parse(init.body as string).input?.some?.((item: any) => JSON.stringify(item).includes('input_image'))) {
          return new Response(JSON.stringify({ status: 'completed',  output_text: '{"natural_text":"ใบเสร็จ ร้านกาแฟ\\nTOTAL 65.00 PAID"}', }), { status: 200 });
        }
        return new Response(JSON.stringify({ status: 'completed',
            output_text: JSON.stringify({
              classification: {
                contentKind: 'DOCUMENT', documentFamily: 'EXPENSE_EVIDENCE', documentKind: 'RECEIPT',
                businessDirection: 'PURCHASE_EXPENSE', transactionState: 'PAID', evidenceRoles: ['EXPENSE_SUPPORT'],
                confidence: 0.95, evidenceSignals: ['ร้านกาแฟ'], amountSignals: ['65.00'],
                settlementSignals: ['ใบเสร็จ'], missingRequiredSignals: [], contradictionSignals: [], requiresClarification: false,
              },
              fields: {
                grandTotalAmount: '65.00',
                categorySuggestion: { expenseCategoryId, confidence: 0.95, evidenceSignals },
              },
            }),
          }), { status: 200 });
      }) as any;
      const controller = new LineAiInternalController(
        {
          aiGatewayInternalSecret: 'secret', aiToolTimeoutMs: 1000,
          modelProvider: 'openai', openAiApiKey: 'openai-key', openAiModel: 'gpt-test',
        } as any,
        { execute: async () => { throw new Error('should not execute'); } } as any,
      );
      return controller.receiptOcr('secret', {
        requestId: 'req-ocr-category',
        companyId: 'company-1',
        userId: 'user-1',
        activeCategories: [{ id: 'cat-meals', name: 'ค่าอาหาร' }],
        attachment: { id: 'att-1', mimeType: 'image/jpeg', purpose: 'receipt', contentBase64: 'ZmFrZQ==' },
      });
    };

    try {
      const unknown = await runOcr('cat-foreign', ['ร้านกาแฟ']);
      assert.equal(unknown.fields?.categorySuggestion, undefined);

      const inventedEvidence = await runOcr('cat-meals', ['ข้อความที่ไม่มีในใบเสร็จ']);
      assert.equal(inventedEvidence.fields?.categorySuggestion, undefined);
      assert.equal(inventedEvidence.fields?.grandTotalAmount, '65.00', 'invalid category must not discard sibling OCR fields');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // Spec §19c: a card slip prints TAX RATE 7% — the rate must reach the draft as "0.07"
  // even though "0.07" itself is never printed (rates are exempt from the numeric cross-check).
  it('receipt OCR keeps a printed VAT rate as a decimal fraction and drops percentage misreads', async () => {
    const originalFetch = globalThis.fetch;
    const ocrText = 'BENLAI ใบเสร็จรับเงิน\\nTAX RATE 7%\\nTAX AMT 37.94\\nTAX Exclude 542.06\\nTOTAL 580.00 PAID';
    const runOcr = async (rawVatRate: string) => {
      globalThis.fetch = (async (url: any, init: any) => {
        if (JSON.parse(init.body as string).input?.some?.((item: any) => JSON.stringify(item).includes('input_image'))) {
          return new Response(JSON.stringify({ status: 'completed',  output_text: `{"natural_text":"${ocrText}"}`, }), { status: 200 });
        }
        return new Response(JSON.stringify({ status: 'completed',
            output_text: JSON.stringify({
              classification: {
                contentKind: 'DOCUMENT', documentFamily: 'EXPENSE_EVIDENCE', documentKind: 'RECEIPT',
                businessDirection: 'PURCHASE_EXPENSE', transactionState: 'PAID', evidenceRoles: ['EXPENSE_SUPPORT'],
                confidence: 0.95, evidenceSignals: ['BENLAI'], amountSignals: ['580.00'],
                settlementSignals: ['PAID'], missingRequiredSignals: [], contradictionSignals: [], requiresClarification: false,
              },
              fields: {
                vendorName: 'BENLAI', vatRate: rawVatRate, taxableAmount: '542.06',
                vatAmount: '37.94', grandTotalAmount: '580.00', vatMode: 'VAT_EXCLUDED',
              },
            }),
          }), { status: 200 });
      }) as any;
      const controller = new LineAiInternalController(
        {
          aiGatewayInternalSecret: 'secret', aiToolTimeoutMs: 1000,
          modelProvider: 'openai', openAiApiKey: 'openai-key', openAiModel: 'gpt-test',
        } as any,
        { execute: async () => { throw new Error('should not execute'); } } as any,
      );
      return controller.receiptOcr('secret', {
        requestId: 'req-ocr',
        companyId: 'company-1',
        userId: 'user-1',
        attachment: { id: 'att-1', mimeType: 'image/jpeg', purpose: 'receipt', contentBase64: 'ZmFrZQ==' },
      });
    };

    try {
      const kept = await runOcr('0.07');
      assert.equal(kept.fields?.vatRate, '0.07', 'a decimal-fraction rate survives even though "0.07" is not printed');
      assert.equal(kept.fields?.vatAmount, '37.94');
      assert.equal(kept.fields?.grandTotalAmount, '580.00');
      assert.equal(kept.fields?.missingFields, undefined);

      // Spec §19g decision 2: a printed "0" is a zero-rated supply — export, international transport,
      // services used abroad. The prompt asks for it and additionalCharges already accept it, so
      // dropping it here left those documents indistinguishable from an unread rate.
      const zeroRated = await runOcr('0');
      assert.equal(zeroRated.fields?.vatRate, '0', 'a printed zero rate is data, not an unknown');

      for (const bad of ['7', '1.5', 'seven']) {
        const dropped = await runOcr(bad);
        assert.equal(dropped.fields?.vatRate, undefined, `percentage or garbage rate ${bad} must not reach the draft`);
        assert.equal(dropped.fields?.taxableAmount, '542.06', 'sibling money fields survive');
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('receipt OCR fails typed when the page reads but the extraction provider is disabled', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => (new Response(JSON.stringify({ choices: [{ message: { content: '{"natural_text":"# ใบเสร็จ"}' } }] }), { status: 200 }))) as any;
    try {
      const controller = new LineAiInternalController(
        { aiGatewayInternalSecret: 'secret', aiToolTimeoutMs: 1000, modelProvider: 'disabled' } as any,
        { execute: async () => { throw new Error('should not execute'); } } as any,
      );
      const result = await controller.receiptOcr('secret', {
        requestId: 'req-ocr',
        companyId: 'company-1',
        userId: 'user-1',
        attachment: { id: 'att-1', mimeType: 'image/jpeg', purpose: 'receipt', contentBase64: 'ZmFrZQ==' },
      });
      assert.equal(result.status, 'failed');
      assert.equal(result.errorCode, 'PROVIDER_DISABLED');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('receipt OCR maps a provider throttle to failed with bounded error code', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => (new Response(JSON.stringify({}), { status: 429 }))) as any;
    try {
      const controller = new LineAiInternalController(
        {
          aiGatewayInternalSecret: 'secret', aiToolTimeoutMs: 1000,
          modelProvider: 'openai', openAiApiKey: 'openai-key', openAiModel: 'gpt-test',
        } as any,
        { execute: async () => { throw new Error('should not execute'); } } as any,
      );
      const result = await controller.receiptOcr('secret', {
        requestId: 'req-ocr',
        companyId: 'company-1',
        userId: 'user-1',
        attachment: { id: 'att-1', mimeType: 'image/png', purpose: 'receipt', contentBase64: 'ZmFrZQ==' },
      });
      assert.equal(result.status, 'failed');
      assert.equal(result.errorCode, 'PROVIDER_THROTTLED');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('line intake route fails closed on wrong secret and bad payload', async () => {
    const controller = new LineAiInternalController(
      { aiGatewayInternalSecret: 'secret', modelProvider: 'disabled' } as any,
      { execute: async () => { throw new Error('should not execute'); } } as any,
    );
    await assert.rejects(
      () => controller.lineIntakeRoute('wrong', { requestId: 'r', companyId: 'c', userId: 'u', locale: 'th', messageText: 'x', permissions: [] }),
      (error: unknown) => error instanceof UnauthorizedException,
    );
    await assert.rejects(
      () => controller.lineIntakeRoute('secret', { requestId: 'r' } as any),
      (error: unknown) => error instanceof BadRequestException,
    );
  });

  it('line intake route returns typed UNAVAILABLE when provider is disabled', async () => {
    const controller = new LineAiInternalController(
      { aiGatewayInternalSecret: 'secret', modelProvider: 'disabled' } as any,
      { execute: async () => { throw new Error('should not execute'); } } as any,
    );
    const plan = await controller.lineIntakeRoute('secret', {
      requestId: 'req-route',
      companyId: 'company-1',
      userId: 'user-1',
      locale: 'th',
      messageText: 'ค่ากาแฟ 65 บาท',
      permissions: ['expense.receipt.line_upload'],
    });
    assert.equal(plan.status, 'UNAVAILABLE');
    assert.equal(plan.errorCode, 'PROVIDER_DISABLED');
  });

  it('the HTTP receiver BOUNDS the trusted capabilities in place — malformed/unknown input is discarded, only literal true survives', async () => {
    const controller = new LineAiInternalController(
      { aiGatewayInternalSecret: 'secret', modelProvider: 'disabled' } as any,
      { execute: async () => { throw new Error('should not execute'); } } as any,
    );
    // A hostile body: truthy non-booleans + unknown keys. The receiver must strip them to {} before routing.
    const hostile: any = {
      requestId: 'req-cap', companyId: 'c', userId: 'u', locale: 'th', messageText: 'ยอดขาย', permissions: [],
      capabilities: { fusedPlan: 1, substituteSemantic: 'true', evil: true, nested: { fusedPlan: true } },
    };
    await controller.lineIntakeRoute('secret', hostile);
    assert.deepEqual(hostile.capabilities, {}, 'no coerced/unknown capability survives the receiver boundary');

    // A legit literal-true body is preserved (the guard is not over-broad).
    const legit: any = {
      requestId: 'req-cap-2', companyId: 'c', userId: 'u', locale: 'th', messageText: 'ยอดขาย', permissions: [],
      capabilities: { fusedPlan: true, substituteSemantic: false },
    };
    await controller.lineIntakeRoute('secret', legit);
    assert.deepEqual(legit.capabilities, { fusedPlan: true }, 'literal-true survives; false is dropped');
  });

  it('preserves the request-scoped offered tool catalog through the HTTP receiver', async () => {
    const controller = new LineAiInternalController(
      { aiGatewayInternalSecret: 'secret', modelProvider: 'disabled' } as any,
      { execute: async () => { throw new Error('should not execute'); } } as any,
    );
    const body: any = {
      requestId: 'req-tools', companyId: 'c', userId: 'u', locale: 'th', messageText: 'ดูรายจ่าย',
      permissions: ['ai.tool.invoke', 'expense.read'], enabledFeatures: ['expenses', 'expenses.list'],
      offeredToolNames: ['expense.list_recent'],
    };
    await controller.lineIntakeRoute('secret', body);
    assert.deepEqual(body.offeredToolNames, ['expense.list_recent']);
  });

  it('bank statement extract rejects non-image mime types and fails typed with no provider', async () => {
    const controller = new LineAiInternalController(
      { aiGatewayInternalSecret: 'secret', modelProvider: 'disabled', aiToolTimeoutMs: 1000 } as any,
      { execute: async () => { throw new Error('should not execute'); } } as any,
    );

    const pdfAttempt = await controller.bankStatementExtract('secret', {
      requestId: 'req-stmt',
      companyId: 'company-1',
      userId: 'user-1',
      attachment: { mimeType: 'application/pdf' as any, contentBase64: 'ZmFrZQ==' },
    });
    assert.equal(pdfAttempt.status, 'failed');
    assert.equal(pdfAttempt.errorCode, 'UNSUPPORTED_MIME_TYPE');

    const noKey = await controller.bankStatementExtract('secret', {
      requestId: 'req-stmt',
      companyId: 'company-1',
      userId: 'user-1',
      attachment: { mimeType: 'image/jpeg', contentBase64: 'ZmFrZQ==' },
    });
    assert.equal(noKey.status, 'failed');
    assert.equal(noKey.errorCode, 'PROVIDER_DISABLED');
  });

  it('bank statement extract runs two stages and returns bounded rows with model id', async () => {
    const originalFetch = globalThis.fetch;
    let extractionInput = '';
    globalThis.fetch = (async (url: any, init: any) => {
      if (JSON.parse(init.body as string).input?.some?.((item: any) => JSON.stringify(item).includes('input_image'))) {
        return new Response(JSON.stringify({ status: 'completed',
            output_text: '{"natural_text":"| วันที่ | รายการ | ถอน | ฝาก | คงเหลือ |\\n| 01/07/69 | รับโอน | | 1,500.00 | 11,500.00 |"}',
          }), { status: 200 });
      }
      extractionInput = JSON.stringify(JSON.parse(init.body).input);
      return new Response(JSON.stringify({ status: 'completed',
          output_text: '{"rows":[{"postedDate":"2026-07-01","description":"รับโอน","credit":"1500.00","balance":"11500.00","confidence":0.93},{"description":"   "},{"bogus":123}]}',
        }), { status: 200 });
    }) as any;

    try {
      const controller = new LineAiInternalController(
        {
          aiGatewayInternalSecret: 'secret',
          aiToolTimeoutMs: 1000,
          modelProvider: 'openai',
          openAiApiKey: 'openai-key',
          openAiModel: 'gpt-test',
        } as any,
        { execute: async () => { throw new Error('should not execute'); } } as any,
      );
      const result = await controller.bankStatementExtract('secret', {
        requestId: 'req-stmt',
        companyId: 'company-1',
        userId: 'user-1',
        attachment: { mimeType: 'image/jpeg', contentBase64: 'ZmFrZQ==' },
      });

      assert.equal(result.status, 'ok');
      assert.equal(result.modelId, 'gpt-test');
      assert.deepEqual(result.modelLineage?.map((item) => item.provider), ['openai', 'openai']);
      assert.deepEqual(result.modelLineage?.map((item) => item.purpose), [
        'bank_statement_ocr_read',
        'bank_statement_extract',
      ]);
      assert.equal(result.rows?.length, 1);
      assert.equal(result.rows?.[0].credit, '1500.00');
      assert.equal(result.rows?.[0].confidence, 0.93);
      assert.ok(extractionInput.includes('รับโอน'), 'stage 2 must receive the OCR markdown, not the image');
      assert.ok(!extractionInput.includes('ZmFrZQ=='), 'image bytes must not reach stage 2');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ── Item 10F: OCR value cross-check – fields must exist in the OCR text ──────

import { applyOcrValueCrossCheck } from './line-ai-internal.controller';

describe('applyOcrValueCrossCheck (item 10F)', () => {
  const RECEIPT_TEXT = 'ร้านกาแฟ ใบเสร็จ 09/12/2537\nกาแฟ 2 x 30.00 = 60.00\nVAT 7% 4.20\nรวม ๖๔.๒๐ บาท';

  it('keeps values printed in the OCR text, including Thai digits', () => {
    const out = applyOcrValueCrossCheck({ grandTotalAmount: '64.20', vatAmount: '4.20', quantity: '2', expenseDate: '1994-12-09' }, RECEIPT_TEXT);
    assert.equal(out.grandTotalAmount, '64.20');
    assert.equal(out.vatAmount, '4.20');
    assert.equal(out.expenseDate, '1994-12-09');
    assert.equal(out.missingFields, undefined);
  });

  it('drops a hallucinated total to missingFields', () => {
    const out = applyOcrValueCrossCheck({ grandTotalAmount: '640.20', vatAmount: '4.20' }, RECEIPT_TEXT);
    assert.equal(out.grandTotalAmount, undefined);
    assert.ok(out.missingFields?.includes('grandTotalAmount'));
    assert.equal(out.vatAmount, '4.20', 'honest sibling fields survive');
  });

  it('drops an expenseDate the OCR text cannot support (kept-as-BE corruption)', () => {
    const out = applyOcrValueCrossCheck({ expenseDate: '2537-12-09' }, RECEIPT_TEXT);
    assert.equal(out.expenseDate, undefined);
    assert.ok(out.missingFields?.includes('expenseDate'));
  });

  it('verifies Thai number words on handwritten bills via the shared normalizer', () => {
    const out = applyOcrValueCrossCheck({ grandTotalAmount: '60' }, 'บิลเงินสด รวมหกสิบบาทถ้วน');
    assert.equal(out.grandTotalAmount, '60');
  });

  // Spec `line-ai-draft-control-spec-th.md` §5.2. Receipt mode makes a Thai `03/09/69` usable, but
  // only by applying the DD/MM convention and choosing an era. The ISO string cannot carry that, so
  // the assumptions travel beside it — without them the API reports the date as plainly stated and
  // the card prints "3 ก.ย. 2569" as fact.
  it('carries what the reading had to assume, beside the date it produced', () => {
    const out = applyOcrValueCrossCheck({ missingFields: ['expenseDate'] }, 'ใบเสร็จ BHC\nวันที่ 03/09/69\nรวม 1,789.04', '2026-09-30');
    assert.equal(out.expenseDate, '2026-09-03', 'the Thai DD/MM convention makes it readable at all');
    assert.deepEqual(out.expenseDateAssumptions, ['order_assumed_day_month', 'two_digit_year_resolved_plausible_era']);
  });

  it('carries no assumptions for a date the page stated outright', () => {
    const out = applyOcrValueCrossCheck({ expenseDate: '2026-08-23' }, 'วันที่ 23 ส.ค. 69\nTOTAL 333.00', '2026-09-30');
    assert.equal(out.expenseDate, '2026-08-23');
    assert.equal((out.expenseDateAssumptions ?? []).includes('order_assumed_day_month'), false,
      'a named month leaves nothing to guess about the order');
  });

  it('clears the assumptions with the date it can no longer support', () => {
    const out = applyOcrValueCrossCheck(
      { expenseDate: '2026-09-03', expenseDateAssumptions: ['order_assumed_day_month'] },
      'ใบเสร็จ ไม่มีวันที่ รวม 60.00',
      '2026-09-30',
    );
    assert.equal(out.expenseDate, undefined);
    assert.equal(out.expenseDateAssumptions, undefined, 'assumptions about a dropped date are noise');
  });

  it('drops values against an ambiguous printed date (9/11/37) – review decides', () => {
    const out = applyOcrValueCrossCheck({ expenseDate: '1994-11-09' }, 'ใบเสร็จ 9/11/37 รวม 60.00');
    assert.equal(out.expenseDate, undefined);
    assert.ok(out.missingFields?.includes('expenseDate'));
  });

  it('keeps locale-backed named-month dates in English and punctuation-lost Thai', () => {
    for (const text of ['Date Aug 23 26', '**Date:** Aug 23 26', '| Date | Aug 23 26 |', 'Date 23 Aug. ’26', 'วันที่ 23 ส.ค. 69', 'วันที่ 23 สค 69']) {
      const out = applyOcrValueCrossCheck({ expenseDate: '2026-08-23' }, `${text}\nTOTAL 333.00`);
      assert.equal(out.expenseDate, '2026-08-23', text);
      const recovered = applyOcrValueCrossCheck({ missingFields: ['expenseDate'] }, `${text}\nTOTAL 333.00`);
      assert.equal(recovered.expenseDate, '2026-08-23', `single labeled date recovery: ${text}`);
      assert.ok(!recovered.missingFields?.includes('expenseDate'), text);
    }
  });

  it('does not recover an unlabeled or multiply-labeled date when stage 2 omitted it', () => {
    const unlabeled = applyOcrValueCrossCheck({ missingFields: ['expenseDate'] }, 'Starbucks Aug 23 26 TOTAL 333.00');
    assert.equal(unlabeled.expenseDate, undefined);
    const multiple = applyOcrValueCrossCheck(
      { missingFields: ['expenseDate'] },
      'Receipt Date Aug 23 26\nIssue Date Aug 24 26\nTOTAL 333.00',
    );
    assert.equal(multiple.expenseDate, undefined);
    assert.ok(multiple.missingFields?.includes('expenseDate'));
  });

  it('prefers the one printed sale date over a later issue or print date', () => {
    for (const text of [
      'เวลาขาย: 15-08-2569 13:37\nเวลาออก: 16-08-2569 11:23',
      '| Sale Date | Aug 15 26 |\n| Issue Date | Aug 16 26 |',
    ]) {
      const corrected = applyOcrValueCrossCheck({ expenseDate: '2026-08-16' }, text);
      assert.equal(corrected.expenseDate, '2026-08-15', text);
      const recovered = applyOcrValueCrossCheck({ missingFields: ['expenseDate'] }, text);
      assert.equal(recovered.expenseDate, '2026-08-15', text);
      assert.ok(!recovered.missingFields?.includes('expenseDate'), text);
    }
  });

  it('does not guess when more than one transaction-labeled date survives', () => {
    const out = applyOcrValueCrossCheck(
      { expenseDate: '2026-08-15' },
      'Sale Date Aug 15 26\nTransaction Date Aug 16 26',
    );
    assert.equal(out.expenseDate, undefined);
    assert.ok(out.missingFields?.includes('expenseDate'));
  });

  it('recovers one printed VAT money amount without requiring a percentage', () => {
    for (const text of [
      'VAT AMT 21.79',
      '21.79 VAT TTL',
      'TOTAL VAT: THB 21.79',
      'ภาษีมูลค่าเพิ่ม ๒๑.๗๙ บาท',
      'VAT 7% 21.79',
      'vat 7% (รวม) 21.79',
      '| vat | 7% | (รวม) | 21.79 |',
    ]) {
      const out = applyOcrValueCrossCheck({ vatMode: 'VAT_INCLUDED', missingFields: ['vatAmount'] }, text);
      assert.equal(out.vatAmount, '21.79', text);
      assert.ok(!out.missingFields?.includes('vatAmount'), text);
      assert.equal(out.vatRate, undefined, 'amount recovery must never invent a rate');
    }
  });

  it('does not turn a VAT rate or multiple tax components into one guessed amount', () => {
    const rateOnly = applyOcrValueCrossCheck({ missingFields: ['vatAmount'] }, 'VAT 7.00%');
    assert.equal(rateOnly.vatAmount, undefined);
    assert.ok(rateOnly.missingFields?.includes('vatAmount'));

    const multiple = applyOcrValueCrossCheck(
      { missingFields: ['vatAmount'] },
      'VAT AMT 21.79\nLOCAL TAX AMT 2.50',
    );
    assert.equal(multiple.vatAmount, undefined);
    assert.ok(multiple.missingFields?.includes('vatAmount'));
  });

  it('non-numeric fields pass through untouched, including the printed rate (spec §19c)', () => {
    const out = applyOcrValueCrossCheck({ vendorName: 'ร้านกาแฟ', vatMode: 'VAT_INCLUDED', vatRate: '0.07', grandTotalAmount: '64.20' }, RECEIPT_TEXT);
    assert.equal(out.vendorName, 'ร้านกาแฟ');
    assert.equal(out.vatMode, 'VAT_INCLUDED');
    assert.equal(out.vatRate, '0.07', 'rates print as "7%", so the verbatim numeric check must not touch them');
    assert.equal(out.missingFields, undefined);
  });

  it('keeps only additional charges whose amount appears in the OCR text', () => {
    const out = applyOcrValueCrossCheck({
      additionalCharges: [
        {
          kind: 'SERVICE_CHARGE',
          description: 'Service charge',
          amount: '5.00',
          evidenceSignal: 'Service charge 5.00',
        },
        {
          kind: 'OTHER',
          description: 'Invented fee',
          amount: '999.00',
          evidenceSignal: 'Invented fee 999.00',
        },
      ],
    }, `${RECEIPT_TEXT}\nService charge 5.00`);
    assert.deepEqual(out.additionalCharges, [{
      kind: 'SERVICE_CHARGE',
      description: 'Service charge',
      amount: '5.00',
      evidenceSignal: 'Service charge 5.00',
    }]);
    assert.ok(out.missingFields?.includes('additionalCharges'));
  });
});

// ── §19j: identity field gates – tax id / document number / branch ───────────

describe('applyOcrValueCrossCheck identity fields (spec §19j)', () => {
  // The reported UAT shape: footer tax id in dashed small type, HN near the header,
  // เลขที่/วันที่ adjacent, carbon-book เล่มที่/เลขที่ pair.
  const HOSPITAL_TEXT = [
    'โรงพยาบาลทดสอบราษฎร์',
    'HN 123456 วันที่ 10/08/2569',
    'เล่มที่ 12 เลขที่ 345',
    'ค่ายา 289.00',
    'รวมทั้งสิ้น 289.00 บาท',
    'เลขประจำตัวผู้เสียภาษีอากร 0-9940-0016-30-11 (สำนักงานใหญ่)',
  ].join('\n');

  it('recovers the only printed 13-digit tax id when stage 2 missed it', () => {
    const out = applyOcrValueCrossCheck({ grandTotalAmount: '289.00', missingFields: ['vendorTaxId'] }, HOSPITAL_TEXT);
    assert.equal(out.vendorTaxId, '0994000163011');
    assert.ok(!out.missingFields?.includes('vendorTaxId'));
  });

  it('normalizes a dash-grouped model tax id to digits only', () => {
    const out = applyOcrValueCrossCheck({ vendorTaxId: '0-9940-0016-30-11' }, HOSPITAL_TEXT);
    assert.equal(out.vendorTaxId, '0994000163011');
  });

  it('replaces an invented tax id with the single printed candidate', () => {
    const out = applyOcrValueCrossCheck({ vendorTaxId: '1234567890123' }, HOSPITAL_TEXT);
    assert.equal(out.vendorTaxId, '0994000163011', 'gate drops the invention, recovery selects the printed run');
  });

  it('recovers only the seller tax id when both parties are explicitly labelled', () => {
    const twoIds = 'ผู้ขาย บจก. ทดสอบ เลขประจำตัวผู้เสียภาษี 0105561000101\nผู้ซื้อ เลขประจำตัวผู้เสียภาษี 0994000163011\nรวม 100.00';
    const out = applyOcrValueCrossCheck({}, twoIds);
    assert.equal(out.vendorTaxId, '0105561000101');
    const kept = applyOcrValueCrossCheck({ vendorTaxId: '0105561000101' }, twoIds);
    assert.equal(kept.vendorTaxId, '0105561000101', 'a model selection that the text contains survives');
  });

  it('rejects a date-valued documentNumber in printed and ISO forms (the reported bug)', () => {
    for (const documentNumber of ['10/08/2569', '2026-08-10']) {
      const out = applyOcrValueCrossCheck({ documentNumber }, HOSPITAL_TEXT);
      assert.equal(out.documentNumber, undefined, `${documentNumber} must not survive as a document number`);
      assert.ok(out.missingFields?.includes('documentNumber'));
    }
  });

  it('keeps running numbers that are not dates, including the carbon-book composition', () => {
    for (const documentNumber of ['123/2569', '12/345']) {
      const text = documentNumber === '123/2569' ? `${HOSPITAL_TEXT}\nเลขที่ 123/2569` : HOSPITAL_TEXT;
      const out = applyOcrValueCrossCheck({ documentNumber }, text);
      assert.equal(out.documentNumber, documentNumber);
    }
  });

  it('drops a documentNumber whose digits the OCR text never printed', () => {
    const out = applyOcrValueCrossCheck({ documentNumber: 'INV-9998877' }, HOSPITAL_TEXT);
    assert.equal(out.documentNumber, undefined);
    assert.ok(out.missingFields?.includes('documentNumber'));
  });

  it('normalizes branch designations: head-office words and numbered branches', () => {
    const hq = applyOcrValueCrossCheck({ vendorBranchCode: 'สำนักงานใหญ่' }, HOSPITAL_TEXT);
    assert.equal(hq.vendorBranchCode, '00000');
    const branchText = 'ร้านสะดวกซื้อ สาขาที่ 3 ใบกำกับภาษีอย่างย่อ รวม 60.00';
    const branch = applyOcrValueCrossCheck({ vendorBranchCode: 'สาขาที่ 3' }, branchText);
    assert.equal(branch.vendorBranchCode, '00003');
    const invented = applyOcrValueCrossCheck({ vendorBranchCode: '00007' }, HOSPITAL_TEXT.replace('(สำนักงานใหญ่)', ''));
    assert.equal(invented.vendorBranchCode, undefined, 'a branch the text never shows is dropped');
    assert.ok(invented.missingFields?.includes('vendorBranchCode'));
  });
});

describe('export cleanup receipt identity evidence', () => {
  it('document numbers require source evidence and preserve book-number composition', () => {
    const cases: Array<[string, string, string | undefined]> = [
      ['FAKE', 'เลขที่ FAKE รวม 180.00', undefined],
      ['FAKE-180', 'รวม 180.00 บาท', undefined],
      ['INV-0012', 'เลขที่ INV - 0012 รวม 180.00', 'INV-0012'],
      ['INV_0012', 'เลขที่ INV . 0012 รวม 180.00', 'INV_0012'],
      ['12/345', 'เล่มที่ 12 เลขที่ 345 รวม 180.00', '12/345'],
      ['12/345', 'เล่มที่ 13 เลขที่ 345 รวม 12.00', undefined],
      ['12/345', 'จำนวน 12 ยอด 345.00', undefined],
      ['123/2569', 'เลขที่ 123/2569 รวม 180.00', '123/2569'],
      ['10/08/2569', 'เลขที่ 10/08/2569', undefined],
      ['2026-08-10', 'เลขที่ 2026-08-10', undefined],
      ['A'.repeat(256) + '1', 'A'.repeat(256) + '1', undefined],
    ];
    for (const [documentNumber, text, expected] of cases) {
      const result = applyOcrValueCrossCheck({ documentNumber }, text, '2026-11-04', 'RECEIPT');
      assert.equal(result.documentNumber, expected, `${documentNumber}: ${text}`);
      if (expected === undefined) assert.ok(result.missingFields?.includes('documentNumber'));
    }
    assert.equal(applyOcrValueCrossCheck({ documentNumber: 'FAKE' }, 'รหัสอ้างอิง FAKE', '2026-11-04', 'TRANSFER_SLIP').documentNumber, 'FAKE');
  });

  it('issuer branch and footer cannot be inferred from buyer or patient identifiers', () => {
    const header = 'โรงพยาบาลทดสอบราษฎร์';
    const noBranch = `${header}\nเลขประจำตัวผู้เสียภาษี 0994000163011`;
    assert.equal(applyOcrValueCrossCheck({ vendorBranchCode: '00016' }, noBranch).vendorBranchCode, undefined);
    assert.equal(applyOcrValueCrossCheck({ vendorBranchCode: '00016' }, `${noBranch} สำนักงานใหญ่`).vendorBranchCode, '00000');
    for (const label of ['สาขาที่', 'สาขา', 'Branch']) {
      assert.equal(applyOcrValueCrossCheck({ vendorBranchCode: '00016' }, `${header} ${label} 16`).vendorBranchCode, '00016');
      assert.equal(applyOcrValueCrossCheck({ vendorBranchCode: '00016' }, `${header} ${label} 0994000163011`).vendorBranchCode, undefined);
    }
    const patient = `${header}\nผู้ป่วย นายทดสอบ\nเลขประจำตัวผู้เสียภาษี 1100700000001`;
    for (const footer of [`${header}\nเลขประจำตัวผู้เสียภาษี 0994000163011`, 'เลขประจำตัวผู้เสียภาษีอากรของโรงพยาบาล 0994000163011']) {
      const text = `${patient}\nรวม 180.00\n${footer}`;
      assert.equal(applyOcrValueCrossCheck({}, text).vendorTaxId, '0994000163011');
      assert.equal(applyOcrValueCrossCheck({ vendorTaxId: '0994000163011' }, text).vendorTaxId, '0994000163011');
    }
    for (const tail of ['\n\n1100700000001', '\n\nเลขประจำตัวผู้เสียภาษี 1100700000001', `\nรับการรักษาที่ ${header}\nเลขประจำตัวผู้เสียภาษี 1100700000001`, '\nBranch 16']) {
      const result = applyOcrValueCrossCheck({ vendorTaxId: '1100700000001', vendorBranchCode: '00016' }, patient + tail);
      assert.equal(result.vendorTaxId, undefined); assert.equal(result.vendorBranchCode, undefined);
    }
  });
});

// ── Marketplace order image: seller block, tax id grounding, coupon rows, misread numbers ─────

describe('receipt OCR marketplace order grounding (2026-11-04)', () => {
  const SHOP_ADDRESS = '9/9 หมู่ 9 ตำบลสมมติ อำเภอตัวอย่าง จังหวัดตัวอย่าง 50000';
  const PLATFORM_ADDRESS = '1 อาคารสมมติ ถนนตัวอย่าง แขวงตัวอย่าง เขตตัวอย่าง กรุงเทพฯ 10000';
  /** Synthetic TikTok-layout step-1 text: platform and courier header, a ผู้ขาย block with a +66
   *  phone, the buyer, two items, a delivery charge and two minus-signed คูปอง rows. */
  const tiktokText = (rows: string[] = ['| เสื้อยืดตัวอย่าง | 1 | 600.00 |', '| กางเกงตัวอย่าง | 1 | 400.00 |'], orderNumber = '5781-2604-3321-0088') => [
    'TikTok Shop',
    'บริษัท ตัวอย่างแพลตฟอร์ม (ประเทศไทย) จำกัด',
    `ที่อยู่ ${PLATFORM_ADDRESS}`,
    'เลขประจำตัวผู้เสียภาษี 0105556012341',
    'ขนส่งโดย บริษัท ขนส่งตัวอย่าง จำกัด',
    'ใบเสร็จรับเงิน',
    `เลขที่คำสั่งซื้อ ${orderNumber}`,
    'ผู้ขาย: ร้านตัวอย่างดีช็อป',
    'โทร +66 81 234 5678 18',
    `ที่อยู่ ${SHOP_ADDRESS}`,
    'ผู้ซื้อ: ลูกค้าตัวอย่าง',
    'ที่อยู่จัดส่ง 5/5 ถนนสมมติ กรุงเทพฯ 10900',
    '| สินค้า | จำนวน | ราคา |',
    ...rows,
    'ยอดรวมสินค้า 1,000.00',
    'ค่าจัดส่ง 40.00',
    'คูปองส่วนลดจากร้านค้า -฿50.00',
    'คูปองส่วนลดค่าจัดส่ง -฿40.00',
    'ยอดชำระทั้งหมด 950.00',
  ].join('\n');
  const modelFields = (overrides: Record<string, unknown> = {}) => ({
    vendorName: 'ร้านตัวอย่างดีช็อป',
    // Built from the seller's +66 phone: printed only as a phone, and the old substring check let it through.
    vendorTaxId: '6681234567818',
    vendorAddress: SHOP_ADDRESS,
    documentNumber: '5781-2604-3321-0088',
    subtotalAmount: '1,000.00',
    grandTotalAmount: '950.00',
    lines: [
      { description: 'เสื้อยืดตัวอย่าง', quantity: '1', amount: '600.00', evidenceSignal: 'เสื้อยืดตัวอย่าง' },
      { description: 'กางเกงตัวอย่าง', quantity: '1', amount: '400.00', evidenceSignal: 'กางเกงตัวอย่าง' },
    ],
    additionalCharges: [{ kind: 'DELIVERY', description: 'ค่าจัดส่ง', amount: '40.00', evidenceSignal: 'ค่าจัดส่ง 40.00' }],
    ...overrides,
  });
  const read = (fields: Record<string, unknown>, documentText: string, documentKind = 'MARKETPLACE_ORDER') => {
    const parsed = parseReceiptOcrJson(JSON.stringify({ fields }), documentText, new Set());
    return applyOcrValueCrossCheck(parsed!.fields!, documentText, '2026-11-04', documentKind);
  };

  it('takes the vendor from the ผู้ขาย block, no phone tax id, and the coupon sum as the discount', () => {
    const out = read(modelFields(), tiktokText());
    assert.equal(out.vendorName, 'ร้านตัวอย่างดีช็อป');
    assert.equal(out.vendorAddress, SHOP_ADDRESS);
    assert.equal(out.vendorTaxId, undefined, 'neither the phone nor the platform header tax id is the shop’s');
    assert.equal(out.discountAmount, '90.00', 'shop coupon 50.00 + shipping coupon 40.00');
    assert.equal(out.documentNumber, '5781-2604-3321-0088');
    assert.equal(receiptItemsMismatch(out), false, 'the item rows now balance against the printed total');
  });

  it('never takes the platform header as the vendor; its name, address and tax id go to review', () => {
    const out = read(modelFields({
      vendorName: 'บริษัท ตัวอย่างแพลตฟอร์ม (ประเทศไทย) จำกัด',
      vendorIdentityEvidence: 'บริษัท ตัวอย่างแพลตฟอร์ม (ประเทศไทย) จำกัด',
      vendorTaxId: '0105556012341',
      vendorAddress: PLATFORM_ADDRESS,
    }), tiktokText());
    assert.equal(out.vendorName, undefined);
    assert.equal(out.vendorEntityKind, undefined);
    assert.equal(out.vendorTaxId, undefined);
    assert.equal(out.vendorAddress, undefined);
    assert.ok(out.missingFields?.includes('vendorName'));
    assert.ok(out.missingFields?.includes('vendorTaxId'));
  });

  it('keeps today’s review state when the coupon arithmetic does not prove itself', () => {
    const shortRows = read(modelFields({ lines: [
      { description: 'เสื้อยืดตัวอย่าง', quantity: '1', amount: '600.00', evidenceSignal: 'เสื้อยืดตัวอย่าง' },
      { description: 'กางเกงตัวอย่าง', quantity: '1', amount: '399.94', evidenceSignal: 'กางเกงตัวอย่าง' },
    ] }), tiktokText(['| เสื้อยืดตัวอย่าง | 1 | 600.00 |', '| กางเกงตัวอย่าง | 1 | 399.94 |']));
    assert.equal(shortRows.discountAmount, undefined, 'item rows 0.06 under the subtotal: the coupon sum is not proven');
    assert.equal(receiptItemsMismatch(shortRows), true, 'and the rows still go to review');
    const offTotal = tiktokText().replace('ยอดชำระทั้งหมด 950.00', 'ยอดชำระทั้งหมด 950.06');
    const unproven = read(modelFields({ grandTotalAmount: '950.06' }), offTotal);
    assert.equal(unproven.discountAmount, undefined, 'subtotal − coupons + charges misses the total by 0.06');
    assert.equal(receiptItemsMismatch(unproven), true);
  });

  it('sends a receipt number with I, O or l between digits to review', () => {
    const misread = '5781-26O4-332I-0088';
    const out = read(modelFields({ documentNumber: misread }), tiktokText(undefined, misread));
    assert.equal(out.documentNumber, undefined);
    assert.ok(out.missingFields?.includes('documentNumber'));
    for (const number of ['5I78O2', '12l45']) {
      const result = applyOcrValueCrossCheck({ documentNumber: number }, `เลขที่ ${number} รวม 180.00`, '2026-11-04', 'RECEIPT');
      assert.equal(result.documentNumber, undefined, number);
    }
    assert.equal(applyOcrValueCrossCheck({ documentNumber: 'INV-0012' }, 'เลขที่ INV - 0012 รวม 180.00', '2026-11-04', 'RECEIPT').documentNumber, 'INV-0012');
  });

  it('accepts a seller tax id only as a whole, check-digit-valid run that is not a phone', () => {
    const page = (line: string) => `ร้านทดสอบ\n${line}\nรวม 100.00`;
    for (const line of [
      'เลขประจำตัวผู้เสียภาษี 0105556012342', // bad check digit
      'เลขที่ 1234 0105556012341', // a window of a longer run
      'โทร +66 81 234 5678 18', 'Tel 6681234567818', 'Phone: (+66) 6681234567818', 'มือถือ 6681234567818',
      'ติดต่อ 0812345678 / 6681234567818', // beside a phone-shaped run
    ]) {
      const digits = collapseDigits(line).match(/\d{13}(?!\d)/)?.[0] ?? '';
      assert.equal(applyOcrValueCrossCheck({ vendorTaxId: digits }, page(line)).vendorTaxId, undefined, line);
      assert.equal(applyOcrValueCrossCheck({}, page(`เลขประจำตัวผู้เสียภาษี ${line}`)).vendorTaxId, undefined, `recovered: ${line}`);
    }
    for (const line of ['เลขประจำตัวผู้เสียภาษี 0-1055-56012-34-1', 'เลขประจำตัวผู้เสียภาษี 0105556012341 โทร 02-123-4567']) {
      assert.equal(applyOcrValueCrossCheck({ vendorTaxId: '0105556012341' }, page(line)).vendorTaxId, '0105556012341', line);
      assert.equal(applyOcrValueCrossCheck({}, page(line)).vendorTaxId, '0105556012341', `recovered: ${line}`);
    }
  });

  it('leaves the ordinary regressions alone: POS discount, delivery charge, no seller label', () => {
    const pos = 'ใบเสร็จรับเงิน\nกาแฟ 1 120.00\nยอดรวม 120.00\nส่วนลดสมาชิก -15.00\nรวมทั้งสิ้น 105.00';
    assert.equal(applyOcrValueCrossCheck({ subtotalAmount: '120.00', discountAmount: '15.00', grandTotalAmount: '105.00' }, pos).discountAmount, '15.00');
    const delivery = 'ใบเสร็จรับเงิน\nข้าวผัด 1 100.00\nยอดรวม 100.00\nค่าจัดส่ง 20.00\nรวมทั้งสิ้น 120.00';
    const charged = read({ subtotalAmount: '100.00', grandTotalAmount: '120.00',
      additionalCharges: [{ kind: 'DELIVERY', description: 'ค่าจัดส่ง', amount: '20.00', evidenceSignal: 'ค่าจัดส่ง 20.00' }] }, delivery, 'RECEIPT');
    assert.equal(charged.discountAmount, undefined);
    assert.equal(charged.additionalCharges?.[0]?.amount, '20.00');
    const header = 'บริษัท ตัวอย่างวัสดุ จำกัด\nเลขประจำตัวผู้เสียภาษี 0105556012341\nรวม 100.00\nผู้ขาย ..............';
    const plain = applyOcrValueCrossCheck({ vendorName: 'บริษัท ตัวอย่างวัสดุ จำกัด' }, header);
    assert.equal(plain.vendorName, 'บริษัท ตัวอย่างวัสดุ จำกัด', 'a bare signature label is not a seller block');
    assert.equal(plain.vendorTaxId, '0105556012341');
    for (const caption of ['ผู้ขาย ผู้รับเงิน', 'Seller Signature ________', 'ผู้ขาย ลงชื่อ ..........', 'ผู้ขาย: ผู้รับเงิน', 'Seller: Authorized signature']) {
      const invoice = `บริษัท ตัวอย่างวัสดุ จำกัด\nเลขประจำตัวผู้เสียภาษี 0105556012341\nรวม 100.00\n${caption}`;
      const kept = applyOcrValueCrossCheck({ vendorName: 'บริษัท ตัวอย่างวัสดุ จำกัด', vendorTaxId: '0105556012341' }, invoice);
      assert.equal(kept.vendorName, 'บริษัท ตัวอย่างวัสดุ จำกัด', `a signature caption is not a seller block: ${caption}`);
      assert.equal(kept.vendorTaxId, '0105556012341', caption);
    }
  });
});

const collapseDigits = (text: string) => text.replace(/(?<=\d)[- ]+(?=\d)/g, '');

// ── Vendor address §7/§8: the printed seller address, and the buyer block kept apart ─────────

describe('receipt OCR printed addresses (vendor-address spec §7)', () => {
  /** (a) A full tax invoice: it prints BOTH parties' addresses, as it prints both tax ids. */
  const FULL_TAX_INVOICE_TEXT = [
    'ใบกำกับภาษี/ใบเสร็จรับเงิน',
    'บริษัท สยามวัสดุก่อสร้าง จำกัด (สำนักงานใหญ่)',
    'ที่อยู่ 199/8 ถนนพระราม 3 แขวงบางโพงพาง เขตยานนาวา กรุงเทพฯ 10120',
    'เลขประจำตัวผู้เสียภาษี 0105561000101',
    'เลขที่ IV-2569-0412 วันที่ 12/09/2569',
    'ผู้ซื้อ บริษัท มั่งมีพลัส จำกัด (สำนักงานใหญ่)',
    'ที่อยู่ผู้ซื้อ 55/3 ซอยลาดพร้าว 15 แขวงจอมพล เขตจตุจักร กรุงเทพฯ 10900',
    'เลขประจำตัวผู้เสียภาษีผู้ซื้อ 0994000163011',
    'ปูนซีเมนต์ 10 ถุง 1,400.00',
    'รวมเงิน 1,400.00',
    'ภาษีมูลค่าเพิ่ม 7% 98.00',
    'รวมทั้งสิ้น 1,498.00',
  ].join('\n');
  const SELLER_ADDRESS = '199/8 ถนนพระราม 3 แขวงบางโพงพาง เขตยานนาวา กรุงเทพฯ 10120';
  const BUYER_ADDRESS = '55/3 ซอยลาดพร้าว 15 แขวงจอมพล เขตจตุจักร กรุงเทพฯ 10900';

  const read = (fields: Record<string, unknown>, documentText: string, documentKind?: string) => {
    const parsed = parseReceiptOcrJson(JSON.stringify({ fields }), documentText, new Set());
    return applyOcrValueCrossCheck(parsed!.fields!, documentText, '2026-09-21', documentKind);
  };

  it('keeps the seller address in vendorAddress and our own block in buyerAsPrinted', () => {
    const out = read({
      vendorName: 'บริษัท สยามวัสดุก่อสร้าง จำกัด',
      vendorTaxId: '0105561000101',
      vendorAddress: SELLER_ADDRESS,
      buyerAsPrinted: {
        name: 'บริษัท มั่งมีพลัส จำกัด', taxId: '0994000163011', branchCode: '00000', addressText: BUYER_ADDRESS,
      },
      grandTotalAmount: '1,498.00',
    }, FULL_TAX_INVOICE_TEXT, 'TAX_INVOICE');
    assert.equal(out.vendorAddress, SELLER_ADDRESS);
    assert.equal(out.vendorTaxId, '0105561000101', 'the seller tax id stays the seller’s');
    assert.deepEqual(out.buyerAsPrinted, {
      name: 'บริษัท มั่งมีพลัส จำกัด', addressText: BUYER_ADDRESS, taxId: '0994000163011', branchCode: '00000',
    });
    assert.notEqual(out.vendorAddress, out.buyerAsPrinted?.addressText, 'neither address crosses over');
    assert.ok(!out.missingFields?.includes('vendorAddress'));
  });

  it('refuses a buyer address offered as the seller address, and reports the gap', () => {
    const out = read({ vendorAddress: BUYER_ADDRESS, grandTotalAmount: '1,498.00' }, FULL_TAX_INVOICE_TEXT, 'TAX_INVOICE');
    assert.equal(out.vendorAddress, undefined, 'a buyer address must never be saved against the vendor');
    assert.ok(out.missingFields?.includes('vendorAddress'));
  });

  it('drops a buyer block the page never printed', () => {
    const out = read({
      vendorAddress: SELLER_ADDRESS,
      buyerAsPrinted: { name: 'บริษัท ที่ไม่มีบนใบ จำกัด', addressText: '1 ถนนสมมติ', taxId: '1111111111111' },
      grandTotalAmount: '1,498.00',
    }, FULL_TAX_INVOICE_TEXT, 'TAX_INVOICE');
    assert.equal(out.buyerAsPrinted, undefined);
    assert.equal(out.vendorAddress, SELLER_ADDRESS, 'the honest sibling field survives');
  });

  it('reports a full tax invoice with no readable address, and nothing else about it', () => {
    const out = read({ grandTotalAmount: '1,498.00' }, FULL_TAX_INVOICE_TEXT, 'TAX_INVOICE');
    assert.equal(out.vendorAddress, undefined);
    assert.deepEqual(out.missingFields, ['vendorAddress']);
  });

  /** (b) An abbreviated tax invoice identifies no buyer and legally needs no address. */
  it('treats a missing address on an abbreviated tax invoice as no gap at all', () => {
    const abbreviated = 'ใบกำกับภาษีอย่างย่อ\nร้านสะดวกซื้อ สาขาที่ 3\nนม 1 กล่อง 25.00\nรวม 60.00\nVAT 7% 3.93';
    const out = read({ vendorName: 'ร้านสะดวกซื้อ', grandTotalAmount: '60.00' }, abbreviated, 'ABBREVIATED_TAX_INVOICE');
    assert.equal(out.vendorAddress, undefined);
    assert.equal(out.buyerAsPrinted, undefined);
    assert.ok(!out.missingFields?.includes('vendorAddress'), 'no reason code where the law asks for no address');
  });

  it('strips a vendorAddress gap the model reported on a document that needs no address', () => {
    const abbreviated = 'ใบกำกับภาษีอย่างย่อ\nร้านสะดวกซื้อ สาขาที่ 3\nรวม 60.00';
    const out = read({ grandTotalAmount: '60.00', missingFields: ['vendorAddress'] }, abbreviated, 'ABBREVIATED_TAX_INVOICE');
    assert.ok(!out.missingFields?.includes('vendorAddress'));
  });

  /** (c) A handwritten cash bill: a short address, written by hand, still counts as printed. */
  it('keeps a short handwritten address on a cash bill without asking for more', () => {
    const cashBill = 'บิลเงินสด\nร้านลุงชัย 12/3 ถนนสุขุมวิท ชลบุรี\nเล่มที่ 021 เลขที่ 1037\nค่าแรง 3,500\nรวม 3,500';
    const out = read({
      vendorName: 'ร้านลุงชัย', vendorAddress: '12/3 ถนนสุขุมวิท ชลบุรี', grandTotalAmount: '3,500',
    }, cashBill, 'HANDWRITTEN_CASH_BILL');
    assert.equal(out.vendorAddress, '12/3 ถนนสุขุมวิท ชลบุรี');
    assert.ok(!out.missingFields?.includes('vendorAddress'));
  });

  it('flattens a wrapped seller address and refuses one longer than the column', () => {
    const wrapped = read({ grandTotalAmount: '1,498.00', vendorAddress: '199/8 ถนนพระราม 3\n  แขวงบางโพงพาง เขตยานนาวา กรุงเทพฯ 10120' }, FULL_TAX_INVOICE_TEXT, 'TAX_INVOICE');
    assert.equal(wrapped.vendorAddress, SELLER_ADDRESS, 'the page wraps the address; the column stores one line');
    const tooLong = read({ grandTotalAmount: '1,498.00', vendorAddress: `${SELLER_ADDRESS} ${'ก'.repeat(500)}` }, FULL_TAX_INVOICE_TEXT, 'TAX_INVOICE');
    assert.equal(tooLong.vendorAddress, undefined, 'over 500 characters is refused, never silently cut');
    assert.ok(tooLong.missingFields?.includes('vendorAddress'));
  });
});

function classification(overrides: Partial<BusinessDocumentClassification> = {}): BusinessDocumentClassification {
  return {
    contentKind: 'DOCUMENT',
    documentFamily: 'EXPENSE_EVIDENCE',
    documentKind: 'RECEIPT',
    businessDirection: 'PURCHASE_EXPENSE',
    transactionState: 'PAID',
    evidenceRoles: ['EXPENSE_SUPPORT'],
    confidence: 0.95,
    evidenceSignals: [],
    amountSignals: ['ยอดรวม 65.00'],
    settlementSignals: ['ชำระแล้ว'],
    missingRequiredSignals: [],
    contradictionSignals: [],
    requiresClarification: false,
    ...overrides,
  };
}

describe('validated one-pass receipt', () => {
  const documentText = [
    'ใบเสร็จ', 'ร้านกาแฟ', 'วันที่ 21/09/2026', 'ลาเต้ 1 40.00', 'เค้ก 1 25.00', 'ยอดรวม 65.00', 'ชำระแล้ว',
  ].join('\n');
  const plan = (overrides: Record<string, unknown> = {}) => ({
    status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.96,
    documentText,
    documentClassification: classification({
      evidenceSignals: ['ใบเสร็จ', 'ร้านกาแฟ'], amountSignals: ['65.00'], settlementSignals: ['ชำระแล้ว'],
    }),
    ...overrides,
  } as any);
  const candidate = (overrides: Record<string, unknown> = {}) => ({
    vendorName: 'ร้านกาแฟ', vendorIdentityEvidence: 'ร้านกาแฟ', expenseDate: '2026-09-21',
    description: 'ลาเต้', grandTotalAmount: '65.00', vatMode: 'NO_VAT', confidence: 0.96,
    missingFields: [],
    lines: [
      { description: 'ลาเต้', quantity: '1', amount: '40.00', evidenceSignal: 'ลาเต้ 1 40.00', confidence: 0.96 },
      { description: 'เค้ก', quantity: '1', amount: '25.00', evidenceSignal: 'เค้ก 1 25.00', confidence: 0.96 },
    ],
    ...overrides,
  });

  it('accepts 20 one-pass item rows and sends 21, 31 and 200 to the full OCR path', () => {
    for (const count of [20, 21, 31, 200]) {
      const lines = Array.from({ length: count }, (_, i) => ({ description: `รายการ${i + 1}`, quantity: '1', amount: '10.00',
        evidenceSignal: `รายการ${i + 1} 1 10.00`, confidence: 0.96 }));
      const total = `${count * 10}.00`;
      const text = ['ใบเสร็จ', 'ร้านกาแฟ', 'วันที่ 21/09/2026', ...lines.map(line => line.evidenceSignal), `ยอดรวม ${total}`, 'ชำระแล้ว'].join('\n');
      const result = validateIntakeOnePassReceipt(plan({ documentText: text,
        documentClassification: classification({ amountSignals: [total], settlementSignals: ['ชำระแล้ว'] }) }),
      candidate({ lines, grandTotalAmount: total }), []);
      if (count === 20) assert.equal(result?.fields.lines?.length, 20);
      else assert.equal(result, undefined);
    }
  });

  it('extracts all 31 and 200 rows after the router declines the bounded one-pass candidate', async () => {
    const originalRoute = IntentRouterAgent.prototype.routeIntake;
    const originalSend = BedrockRuntimeClient.prototype.send;
    try {
      for (const count of [31, 200]) {
        const lines = Array.from({ length: count }, (_, i) => ({ description: `สินค้า ${i + 1}`, quantity: '1', amount: '10.00',
          evidenceSignal: `สินค้า ${i + 1} 1 10.00`, confidence: 0.96 }));
        const total = `${count * 10}.00`;
        const text = ['ใบเสร็จ', 'ร้านกาแฟ', 'วันที่ 21/09/2026', ...lines.map(line => line.evidenceSignal), `ยอดรวม ${total}`, 'ชำระแล้ว'].join('\n');
        const docClassification = classification({ evidenceSignals: ['ใบเสร็จ', 'ร้านกาแฟ'], amountSignals: [total], settlementSignals: ['ชำระแล้ว'] });
        const fields = candidate({ lines, description: 'สินค้า', grandTotalAmount: total });
        IntentRouterAgent.prototype.routeIntake = async () => plan({ documentText: text,
          documentClassification: docClassification, receiptCandidate: fields });
        let extractionCalls = 0;
        (BedrockRuntimeClient.prototype as any).send = async (command: any) => {
          extractionCalls += 1;
          const content = command.input.messages.at(-1).content;
          assert.ok(content.every((block: any) => !block.image && !block.document), 'full extraction reuses the complete intake read');
          const input = JSON.stringify(content);
          for (const line of lines) assert.ok(input.includes(line.evidenceSignal));
          return { stopReason: 'end_turn', output: { message: { content: [{ text: JSON.stringify({ classification: docClassification, fields }) }] } } };
        };
        const controller = new LineAiInternalController({ aiGatewayInternalSecret: 'secret', modelProvider: 'bedrock',
          bedrockRegion: 'ap-southeast-1', bedrockModelId: 'test-model', documentAiModelId: 'test-model', aiToolTimeoutMs: 15_000 } as any, {} as any);
        const routed = await controller.lineIntakeRoute('secret', { requestId: `route-${count}`, companyId: 'company-1',
          userId: 'user-1', messageText: 'บันทึกบิลนี้', locale: 'th', permissions: ['expense.receipt.line_upload'] });
        assert.equal(routed.onePassReceipt, undefined);
        assert.equal(routed.documentText, text);
        const result = await controller.receiptOcr('secret', { requestId: `read-${count}`, companyId: 'company-1', userId: 'user-1',
          documentText: routed.documentText, attachment: { id: 'att-1', mimeType: 'image/jpeg', purpose: 'receipt', contentBase64: 'ZmFrZQ==' } });
        assert.equal(result.status, 'ok');
        assert.deepEqual(result.fields?.lines?.map(line => line.description), lines.map(line => line.description));
        assert.equal(result.fields?.grandTotalAmount, total);
        assert.equal(extractionCalls, 1);
      }
    } finally {
      IntentRouterAgent.prototype.routeIntake = originalRoute;
      BedrockRuntimeClient.prototype.send = originalSend;
    }
  });

  it('accepts a high-confidence settled receipt only after the existing evidence gates pass', () => {
    const result = validateIntakeOnePassReceipt(plan(), candidate(), []);
    assert.equal(result?.fields.grandTotalAmount, '65.00');
    assert.equal(result?.fields.lines?.length, 2);
    assert.equal(result?.classification.documentKind, 'RECEIPT');
  });

  it('recovers exact table/settlement/total evidence and drops an unprinted computed unit price', () => {
    const tableText = [
      'ร้านกาแฟ', 'ใบเสร็จรับเงิน', 'วันที่ 16/09/2026',
      '| ลาเต้ | 2 | 130.00 |', '| เค้ก | 1 | 55.00 |', 'ยอดรวม 185.00',
    ].join('\n');
    const result = validateIntakeOnePassReceipt(plan({
      documentText: tableText,
      documentClassification: classification({
        amountSignals: [], settlementSignals: [], missingRequiredSignals: ['MISSING_VENDOR_TAX_ID'],
      }),
    }), candidate({
      expenseDate: '2026-09-16', grandTotalAmount: '185.00', missingFields: ['vendorTaxId'],
      lines: [
        { description: 'ลาเต้', quantity: '2', unitPrice: '65.00', amount: '130.00', evidenceSignal: 'ลาเต้ 2 130.00', confidence: 0.96 },
        { description: 'เค้ก', quantity: '1', amount: '55.00', evidenceSignal: 'เค้ก 1 55.00', confidence: 0.96 },
      ],
    }), []);
    assert.equal(result?.fields.lines?.length, 2);
    assert.equal(result?.fields.lines?.[0]?.unitPrice, undefined);
    assert.deepEqual(result?.classification.settlementSignals, ['ใบเสร็จรับเงิน']);
    assert.deepEqual(result?.classification.amountSignals, ['185.00']);
  });

  it('recovers only one unambiguous printed receipt date when the candidate omitted it', () => {
    const unlabeledDateText = documentText.replace('วันที่ 21/09/2026', '21/09/2026');
    const result = validateIntakeOnePassReceipt(
      plan({ documentText: unlabeledDateText }),
      candidate({ expenseDate: undefined, missingFields: ['expenseDate'] }),
      [],
    );
    assert.equal(result?.fields.expenseDate, '2026-09-21');
    assert.deepEqual(result?.fields.missingFields, []);
  });

  it('rejects a buyer name presented as the vendor even when it is printed elsewhere on the page', () => {
    const sellerBuyerText = [
      '[SELLER]บริษัท ผู้ขาย จำกัด[/SELLER]', '[BUYER]ร้านกาแฟ[/BUYER]',
      'ใบเสร็จ', 'วันที่ 21/09/2026', 'ลาเต้ 1 40.00', 'เค้ก 1 25.00', 'ยอดรวม 65.00', 'ชำระแล้ว',
    ].join('\n');
    assert.equal(validateIntakeOnePassReceipt(plan({ documentText: sellerBuyerText }), candidate(), []), undefined);
  });

  it('rejects check bills and non-document images even when a model supplied receipt-looking fields', () => {
    assert.equal(validateIntakeOnePassReceipt(plan({ documentClassification: classification({
      documentFamily: 'COMMERCIAL_DOCUMENT', documentKind: 'ORDER_OR_CHECK_BILL', transactionState: 'DUE',
      settlementSignals: [], missingRequiredSignals: ['ORDER_ONLY'],
    }) }), candidate(), []), undefined);
    assert.equal(validateIntakeOnePassReceipt(plan({ documentClassification: classification({
      contentKind: 'NON_DOCUMENT_IMAGE', documentFamily: 'NON_BUSINESS', documentKind: 'NON_FINANCIAL_IMAGE',
      transactionState: 'UNKNOWN', businessDirection: 'UNKNOWN', settlementSignals: [],
    }) }), candidate(), []), undefined);
    assert.equal(validateIntakeOnePassReceipt(plan({ documentClassification: classification({
      documentKind: 'TAX_INVOICE', evidenceRoles: ['TAX_EVIDENCE_CANDIDATE'],
    }) }), candidate({ vatMode: 'VAT_EXCLUDED', vatAmount: '4.25' }), []), undefined,
    'tax documents keep the specialist OCR fallback even when a candidate looks complete');
  });

  it('accepts one reconciled item but rejects incomplete/overlong item detail and missing tax VAT', () => {
    assert.equal(validateIntakeOnePassReceipt(plan(), candidate({ lines: [] }), []), undefined);
    const oneItemText = ['ใบเสร็จ', 'ร้านกาแฟ', 'วันที่ 21/09/2026', 'ชุดอาหาร 1 65.00', 'ยอดรวม 65.00', 'ชำระแล้ว'].join('\n');
    const oneItem = candidate({
      description: 'ชุดอาหาร',
      lines: [{ description: 'ชุดอาหาร', quantity: '1', amount: '65.00', evidenceSignal: 'ชุดอาหาร 1 65.00', confidence: 0.96 }],
    });
    assert.equal(validateIntakeOnePassReceipt(plan({ documentText: oneItemText }), oneItem, [])?.fields.lines?.length, 1);
    assert.equal(validateIntakeOnePassReceipt(plan(), candidate({ lines: [candidate().lines[0]] }), []), undefined,
      'a one-row candidate whose item amount does not reconcile must fall back');
    assert.equal(validateIntakeOnePassReceipt(plan(), candidate({ lines: Array.from({ length: 31 }, () => candidate().lines[0]) }), []), undefined,
      'long receipts stay on the bounded OCR path instead of risking route truncation');
    const taxText = `${documentText}\nVAT 7%`;
    assert.equal(validateIntakeOnePassReceipt(plan({
      documentText: taxText,
      documentClassification: classification({ documentKind: 'ABBREVIATED_TAX_INVOICE' }),
    }), candidate({ vatMode: 'VAT_INCLUDED', vatRate: '0.07' }), []), undefined);
  });

  it('falls back when printed discount, charge, WHT or currency was omitted', () => {
    for (const signal of ['ส่วนลด 5.00', 'Service charge 10.00', 'หัก ณ ที่จ่าย 1.50', 'USD 65.00']) {
      assert.equal(validateIntakeOnePassReceipt(plan({ documentText: `${documentText}\n${signal}` }), candidate(), []), undefined, signal);
    }
    const usdText = `${documentText}\nUSD 65.00`;
    assert.equal(validateIntakeOnePassReceipt(plan({ documentText: usdText }), candidate({ currency: 'THB' }), []), undefined);
    assert.equal(validateIntakeOnePassReceipt(plan({ documentText: usdText }), candidate({ currency: 'USD' }), [])?.fields.currency, 'USD');
  });
});

describe('business document classification gate', () => {
  it('retains only exact bounded OCR spans, clamps confidence, and rejects unknown enums', () => {
    const parsed = parseBusinessDocumentClassification({
      ...classification({ confidence: 2 }),
      evidenceSignals: ['ร้านกาแฟ', 'invented evidence'],
      amountSignals: ['ยอดรวม 65.00'],
      settlementSignals: ['ชำระแล้ว', 'PAID'],
    }, 'ร้านกาแฟ\nยอดรวม 65.00\nชำระแล้ว');
    assert.equal(parsed?.confidence, 1);
    assert.deepEqual(parsed?.evidenceSignals, ['ร้านกาแฟ']);
    assert.deepEqual(parsed?.settlementSignals, ['ชำระแล้ว']);
    assert.equal(parseBusinessDocumentClassification({ ...classification(), documentKind: 'MAGIC_RECEIPT' }, 'ชำระแล้ว'), null);
  });

  // Spec §19h: the kind the prompt now asks for has to survive the strict parser, or every
  // abbreviated invoice would be rejected outright instead of recorded as non-creditable evidence.
  it('accepts ABBREVIATED_TAX_INVOICE as a known document kind', () => {
    const parsed = parseBusinessDocumentClassification(
      { ...classification(), documentKind: 'ABBREVIATED_TAX_INVOICE' },
      'ร้านกาแฟ\nยอดรวม 65.00\nชำระแล้ว',
    );
    assert.equal(parsed?.documentKind, 'ABBREVIATED_TAX_INVOICE');
  });

  // Owner decision 2026-08-15: a POS slip headed plainly "Bill" is the customer's paid copy, so the
  // prompt now reads that title as settlement evidence. The gate must let it through — the Royal
  // Pizza UAT slip carries no ชำระแล้ว/PAID stamp, only its own title.
  it('keeps a Bill-titled POS slip as settled expense evidence', () => {
    const text = 'Royal Pizza - Narathiwas 24\nTax ID: 0115559007535\nBill\nSubtotal 822.00\nTotal 797.00';
    const gated = gateBusinessDocumentClassification(
      classification({
        documentKind: 'ABBREVIATED_TAX_INVOICE',
        amountSignals: ['797.00'],
        settlementSignals: ['Bill'],
      }),
      { vendorName: 'Royal Pizza - Narathiwas 24', vendorTaxId: '0115559007535', grandTotalAmount: '797.00' },
      text,
    );
    assert.equal(gated.documentKind, 'ABBREVIATED_TAX_INVOICE');
    assert.equal(gated.documentFamily, 'EXPENSE_EVIDENCE');
    assert.equal(gated.transactionState, 'PAID');
    assert.ok(!gated.missingRequiredSignals.includes('MISSING_PAYMENT_EVIDENCE'));

    // The title only counts when the model quotes it verbatim; an unpaid billing note still falls
    // through to the payment-evidence gate rather than riding on the word บิล.
    const billingNote = gateBusinessDocumentClassification(
      classification({ settlementSignals: [], amountSignals: ['797.00'] }),
      { vendorName: 'Royal Pizza - Narathiwas 24', grandTotalAmount: '797.00' },
      'Royal Pizza - Narathiwas 24\nใบวางบิล\nTotal 797.00',
    );
    assert.equal(billingNote.documentKind, 'SUPPLIER_INVOICE_OR_BILL');
    assert.ok(billingNote.missingRequiredSignals.includes('MISSING_PAYMENT_EVIDENCE'));
  });

  it('downgrades a quantity-only receipt candidate to ORDER_OR_CHECK_BILL', () => {
    const gated = gateBusinessDocumentClassification(
      classification({ missingRequiredSignals: ['QUANTITY_ONLY'] }),
      { vendorName: 'ร้านอาหาร', description: 'ข้าวผัด', quantity: '2' },
      'ร้านอาหาร\nข้าวผัด x 2',
    );
    assert.equal(gated.documentKind, 'ORDER_OR_CHECK_BILL');
    assert.equal(gated.documentFamily, 'COMMERCIAL_DOCUMENT');
    assert.ok(gated.missingRequiredSignals.includes('MISSING_MONETARY_AMOUNT'));
    assert.equal(gated.requiresClarification, true);

    const quantityMisreadAsTotal = gateBusinessDocumentClassification(
      classification({ amountSignals: [] }),
      { vendorName: 'ร้านอาหาร', quantity: '2', grandTotalAmount: '2' },
      'ร้านอาหาร\nข้าวผัด x 2\nชำระแล้ว',
    );
    assert.equal(quantityMisreadAsTotal.documentKind, 'ORDER_OR_CHECK_BILL');
  });

  it('does not retain RECEIPT when total was dropped or settlement evidence is absent', () => {
    const noTotal = gateBusinessDocumentClassification(
      classification(),
      { vendorName: 'ร้านกาแฟ' },
      'ร้านกาแฟ\nใบเสร็จ',
    );
    assert.equal(noTotal.documentKind, 'NEEDS_REVIEW');

    const noSettlement = gateBusinessDocumentClassification(
      classification({ settlementSignals: [] }),
      { vendorName: 'ร้านกาแฟ', grandTotalAmount: '65.00' },
      'ร้านกาแฟ\nยอดรวม 65.00',
    );
    assert.equal(noSettlement.documentKind, 'SUPPLIER_INVOICE_OR_BILL');
    assert.ok(noSettlement.missingRequiredSignals.includes('MISSING_PAYMENT_EVIDENCE'));

    const notPaid = gateBusinessDocumentClassification(
      classification({ transactionState: 'DUE' }),
      { vendorName: 'ร้านกาแฟ', grandTotalAmount: '65.00' },
      'ร้านกาแฟ\nยอดรวม 65.00\nชำระแล้ว',
    );
    assert.equal(notPaid.documentKind, 'SUPPLIER_INVOICE_OR_BILL');
    assert.ok(notPaid.missingRequiredSignals.includes('MISSING_PAYMENT_EVIDENCE'));
  });

  it('never upgrades non-expense kinds and blocks sales-direction receipts from expense mutation', () => {
    const quotation = classification({ documentFamily: 'COMMERCIAL_DOCUMENT', documentKind: 'QUOTATION' });
    assert.deepEqual(gateBusinessDocumentClassification(quotation, { grandTotalAmount: '100.00' }, '100.00'), quotation);

    const salesReceipt = gateBusinessDocumentClassification(
      classification({ businessDirection: 'SALES_RECEIVABLE', amountSignals: ['ยอดรวม 100.00'] }),
      { vendorName: 'บริษัทเรา', grandTotalAmount: '100.00' },
      'บริษัทเรา\nยอดรวม 100.00\nชำระแล้ว',
    );
    assert.equal(salesReceipt.documentKind, 'RECEIPT');
    assert.equal(salesReceipt.requiresClarification, true);
    assert.ok(salesReceipt.missingRequiredSignals.includes('AMBIGUOUS_BUSINESS_DIRECTION'));
  });
});

describe('utility document parts from one image', () => {
  const page = 'การประปานครหลวง\nใบแจ้งค่าน้ำประปา งวด กันยายน 2569\nรวมทั้งสิ้น 110.05\nใบเสร็จรับเงิน/ใบกำกับภาษี งวด สิงหาคม 2569\nรวมทั้งสิ้น 82.28';
  const parts = [
    { role: 'BILL_DUE', period: 'กันยายน 2569', amount: '110.05', titleEvidence: 'ใบแจ้งค่าน้ำประปา', amountEvidence: 'รวมทั้งสิ้น 110.05' },
    { role: 'RECEIPT_PAID', period: 'สิงหาคม 2569', amount: '82.28', titleEvidence: 'ใบเสร็จรับเงิน/ใบกำกับภาษี', amountEvidence: 'รวมทั้งสิ้น 82.28' },
  ];

  it('keeps invoice and prior receipt amounts separate', () => {
    assert.deepEqual(parseUtilityDocuments(JSON.stringify({ utilityDocuments: parts }), page), parts);
    const alternateTitle = 'ใบสรุปรับเงิน/ใบกำกับภาษี';
    const alternatePage = page.replace('ใบเสร็จรับเงิน/ใบกำกับภาษี', alternateTitle);
    const alternateParts = [parts[0], { ...parts[1], titleEvidence: alternateTitle }];
    assert.deepEqual(parseUtilityDocuments(JSON.stringify({ utilityDocuments: alternateParts }), alternatePage), alternateParts);
  });

  it('accepts two evidence roles for one billing period without summing them', () => {
    const samePeriod = parts.map((part) => ({ ...part, period: 'กันยายน 2569' }));
    const samePeriodPage = page.replace('สิงหาคม 2569', 'กันยายน 2569');
    assert.equal(parseUtilityDocuments(JSON.stringify({ utilityDocuments: samePeriod }), samePeriodPage)?.length, 2);
  });

  it('separates an electricity invoice and receipt without treating a coupon as a third part', () => {
    const electricity = 'การไฟฟ้านครหลวง\nใบแจ้งค่าไฟฟ้า งวด 09/2569\nยอดที่ต้องชำระ 1,234.56\nส่วนชำระ 1,234.56\nใบเสร็จรับเงิน งวด 08/2569\nรับชำระ 980.00';
    const electricityParts = [
      { role: 'BILL_DUE', period: '09/2569', amount: '1,234.56', titleEvidence: 'ใบแจ้งค่าไฟฟ้า', amountEvidence: 'ยอดที่ต้องชำระ 1,234.56' },
      { role: 'RECEIPT_PAID', period: '08/2569', amount: '980.00', titleEvidence: 'ใบเสร็จรับเงิน', amountEvidence: 'รับชำระ 980.00' },
    ];
    assert.deepEqual(parseUtilityDocuments(JSON.stringify({ utilityDocuments: electricityParts }), electricity), electricityParts);
    assert.equal(parseUtilityDocuments(JSON.stringify({ utilityDocuments: [...electricityParts, electricityParts[0]] }), electricity)?.length, 2);
  });

  it('does not turn a coupon, usage history, or an invented amount into another document', () => {
    const coupon = `${page.split('ใบเสร็จรับเงิน')[0]}ส่วนชำระเงิน 110.05\nประวัติการใช้น้ำ 82.28`;
    assert.equal(parseUtilityDocuments(JSON.stringify({ utilityDocuments: parts }), coupon), undefined);
    assert.equal(parseUtilityDocuments(JSON.stringify({ utilityDocuments: [parts[0], { ...parts[1], amount: '999.99' }] }), page), undefined);
    assert.equal(parseUtilityDocuments(JSON.stringify({ utilityDocuments: [parts[0], parts[0]] }), page), undefined);
    const singleBill = 'การประปาส่วนภูมิภาค\nใบแจ้งค่าน้ำประปา (ไม่ใช่ใบเสร็จรับเงิน)\nงวด 09/65\nรวม 454.75';
    assert.equal(parseUtilityDocuments(JSON.stringify({ utilityDocuments: [
      { role: 'BILL_DUE', period: '09/65', amount: '454.75', titleEvidence: 'ใบแจ้งค่าน้ำประปา', amountEvidence: 'รวม 454.75' },
      { role: 'RECEIPT_PAID', period: '09/65', amount: '454.75', titleEvidence: 'ใบเสร็จรับเงิน', amountEvidence: 'รวม 454.75' },
    ] }), singleBill), undefined);
  });

  it('keeps unrelated ledgers and one ordinary bill outside this summary', () => {
    assert.equal(parseUtilityDocuments(JSON.stringify({ utilityDocuments: parts }), 'รายจ่าย 110.05\nรายจ่าย 82.28'), undefined);
    assert.equal(parseUtilityDocuments(JSON.stringify({ utilityDocuments: [parts[0]] }), page), undefined);
  });
});

describe('receipt OCR image re-read for missing critical printed money', () => {
  // The first read of a warped photo loses the printed total line; stage 2 can only report an
  // ambiguous number, which the API's expense gate refuses. The receipt's real total is 180.00.
  const FIRST_READ_TEXT_WITHOUT_TOTAL = '# Starbucks Coffee\n| Sub Total | 160.00 |\n| Total Discount | -15.00 |';
  const BEDROCK_REREAD_TEXT = '# Starbucks Coffee\nSub Total 195.00\nTotal Discount -15.00\nTotal Amount 180.00\nPayment 180.00';

  const classification = (total: string, requiresClarification: boolean, contentKind = 'DOCUMENT') => ({
    contentKind, documentFamily: 'EXPENSE_EVIDENCE', documentKind: 'TAX_INVOICE',
    businessDirection: 'PURCHASE_EXPENSE', transactionState: 'PAID', evidenceRoles: ['EXPENSE_SUPPORT'],
    confidence: 0.9, evidenceSignals: ['Starbucks Coffee'], amountSignals: [total],
    settlementSignals: ['Payment'],
    missingRequiredSignals: requiresClarification ? ['MISSING_TRANSACTION_TOTAL'] : [],
    contradictionSignals: [], requiresClarification,
  });

  function stubStageTwoFetch() {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: any, init: any) => {
      // OpenAI stage 2 over whatever text it was given.
      const input = JSON.stringify(JSON.parse(init.body).input);
      const total = input.includes('180.00') ? '180.00' : '160.00';
      return new Response(JSON.stringify({ status: 'completed',
          output_text: JSON.stringify({
            classification: classification(total, total === '160.00'),
            fields: { vendorName: 'Starbucks Coffee', grandTotalAmount: total },
          }),
        }), { status: 200 });
    }) as any;
    return () => { globalThis.fetch = originalFetch; };
  }

  /** Bedrock serves every role here now (Owner 2026-08-28): the stage-1 vision read, the single
   *  vision re-read, and stage 2 (text only). The first image call is the page as first read. */
  function stubBedrock(options: {
    firstReadText?: string;
    rereadText?: string;
    firstTotal?: string;
    secondTotal?: string;
    rereadVatAmount?: string;
    firstRequiresClarification?: boolean;
    contentKind?: string;
    firstLines?: Array<Record<string, unknown>>;
    secondLines?: Array<Record<string, unknown>>;
    rereadMarker?: string;
    utilityDocuments?: Array<Record<string, unknown>>;
    utilityFallbackParts?: Array<Record<string, unknown>>;
    malformedUtilityExtraction?: boolean;
  } = {}) {
    const firstReadText = options.firstReadText ?? FIRST_READ_TEXT_WITHOUT_TOTAL;
    const rereadText = options.rereadText ?? BEDROCK_REREAD_TEXT;
    let readCount = 0;
    const firstTotal = options.firstTotal ?? '160.00';
    const secondTotal = options.secondTotal ?? '180.00';
    const original = BedrockRuntimeClient.prototype.send;
    const calls: string[] = [];
    (BedrockRuntimeClient.prototype as any).send = async (command: any) => {
      const content = command.input.messages.at(-1).content;
      const isRead = content.some((block: any) => block.image);
      calls.push(isRead ? 'read' : 'extract');
      if (isRead && readCount === 0) {
        readCount += 1;
        const text = readCount === 1 ? firstReadText : rereadText;
        return { stopReason: 'end_turn', output: { message: { content: [{ text: JSON.stringify({ natural_text: text }) }] } } };
      }
      const extractCount = calls.filter((call) => call === 'extract').length;
      if (options.malformedUtilityExtraction && extractCount <= 2) {
        return { stopReason: 'end_turn', output: { message: { content: [{ text: JSON.stringify({ fields: { grandTotalAmount: firstTotal } }) }] } } };
      }
      if (options.utilityFallbackParts && extractCount > (options.malformedUtilityExtraction ? 2 : 1)) {
        return { stopReason: 'end_turn', output: { message: { content: [{ text: JSON.stringify({ utilityDocuments: options.utilityFallbackParts }) }] } } };
      }
      const rereadMarker = options.rereadMarker ?? options.rereadVatAmount ?? 'Total Amount 180.00';
      const sawRereadText = isRead || JSON.stringify(content).includes(rereadMarker);
      const total = sawRereadText ? secondTotal : firstTotal;
      const fields = {
        vendorName: 'Starbucks Coffee',
        grandTotalAmount: total,
        ...((sawRereadText ? options.secondLines : options.firstLines)
          ? { lines: sawRereadText ? options.secondLines : options.firstLines }
          : {}),
        ...(options.rereadVatAmount ? {
          vatMode: 'VAT_INCLUDED', vatRate: '0.07',
          ...(sawRereadText ? { vatAmount: options.rereadVatAmount } : { missingFields: ['vatAmount'] }),
        } : {}),
      };
      return { stopReason: 'end_turn',
        output: {
          message: {
            content: [{
              text: JSON.stringify({
                ...(isRead ? { natural_text: rereadText } : {}),
                classification: classification(total, sawRereadText ? false : (options.firstRequiresClarification ?? true), options.contentKind),
                fields,
                ...(options.utilityDocuments ? { utilityDocuments: options.utilityDocuments } : {}),
              }),
            }],
          },
        },
      };
    };
    return { calls, restore: () => { (BedrockRuntimeClient.prototype as any).send = original; } };
  }

  const request = {
    requestId: 'req-reread',
    companyId: 'company-1',
    userId: 'user-1',
    attachment: { id: 'att-1', mimeType: 'image/jpeg' as const, purpose: 'receipt' as const, contentBase64: 'ZmFrZQ==' },
  };

  it('keeps a total requiring clarification without another image pass', async () => {
    const restoreFetch = stubStageTwoFetch();
    const bedrock = stubBedrock();
    try {
      const controller = new LineAiInternalController(
        {
          aiGatewayInternalSecret: 'secret', aiToolTimeoutMs: 1000,
          modelProvider: 'bedrock', bedrockRegion: 'ap-southeast-1', documentAiModelId: 'test-model',
        } as any,
        { execute: async () => { throw new Error('should not execute'); } } as any,
      );

      const result = await controller.receiptOcr('secret', request);

      assert.equal(result.status, 'ok');
      assert.equal(result.fields?.grandTotalAmount, '160.00');
      assert.equal(result.classification?.requiresClarification, true);
      assert.equal(result.fallbackReasons, undefined);
      assert.deepEqual(bedrock.calls, ['read', 'extract']);
    } finally {
      bedrock.restore();
      restoreFetch();
    }
  });

  it('leaves an unprinted VAT amount unknown without another image pass', async () => {
    const firstText = '# Royal Pizza\nTotal 2890.00\nVAT 7% (รวม)\nPayment 2890.00';
    const rereadText = '# Royal Pizza\nTotal 2890.00\nVAT 7% (รวม) 189.07\nPayment 2890.00';
    const restoreFetch = stubStageTwoFetch();
    const bedrock = stubBedrock({
      firstReadText: firstText,
      rereadText,
      firstTotal: '2890.00',
      secondTotal: '2,890.00',
      rereadVatAmount: '189.07',
      firstRequiresClarification: false,
    });
    try {
      const controller = new LineAiInternalController(
        {
          aiGatewayInternalSecret: 'secret', aiToolTimeoutMs: 1000,
          modelProvider: 'bedrock', bedrockRegion: 'ap-southeast-1', documentAiModelId: 'test-model',
        } as any,
        { execute: async () => { throw new Error('should not execute'); } } as any,
      );

      const result = await controller.receiptOcr('secret', request);

      assert.equal(result.fields?.grandTotalAmount, '2890.00', 'retain the first cross-checked display value');
      assert.equal(result.fields?.vatAmount, undefined);
      assert.ok(result.fields?.missingFields?.includes('vatAmount'));
      assert.equal(result.fallbackReasons, undefined);
      assert.deepEqual(bedrock.calls, ['read', 'extract']);
    } finally {
      bedrock.restore();
      restoreFetch();
    }
  });

  it('records item mismatch before the bounded image re-read', async () => {
    const text = '# Starbucks Coffee\nLatte 1 40.00\nCake 1 20.00\nTotal 65.00\nPayment 65.00';
    const rereadText = `${text.replace('Cake 1 20.00', 'Cake 1 25.00')}\nImage re-read`;
    const firstLines = [
      { description: 'Latte', quantity: '1', amount: '40.00', evidenceSignal: 'Latte 1 40.00' },
      { description: 'Cake', quantity: '1', amount: '20.00', evidenceSignal: 'Cake 1 20.00' },
    ];
    const secondLines = [
      firstLines[0]!,
      { description: 'Cake', quantity: '1', amount: '25.00', evidenceSignal: 'Cake 1 25.00' },
    ];
    const restoreFetch = stubStageTwoFetch();
    const bedrock = stubBedrock({
      firstReadText: text, rereadText, rereadMarker: 'Image re-read', firstTotal: '65.00', secondTotal: '65.00',
      firstRequiresClarification: false, firstLines, secondLines,
    });
    try {
      const controller = new LineAiInternalController(
        {
          aiGatewayInternalSecret: 'secret', aiToolTimeoutMs: 1000,
          modelProvider: 'bedrock', bedrockRegion: 'ap-southeast-1', documentAiModelId: 'test-model',
        } as any,
        { execute: async () => { throw new Error('should not execute'); } } as any,
      );

      const result = await controller.receiptOcr('secret', request);

      assert.equal(result.fields?.lines?.[1]?.amount, '25.00');
      assert.deepEqual(result.fallbackReasons, ['ITEMS_INCOMPLETE']);
      assert.deepEqual(bedrock.calls, ['read', 'extract', 'read']);
    } finally {
      bedrock.restore();
      restoreFetch();
    }
  });

  it('never returns single-expense fields or vision-rereads a multi-entry ledger', async () => {
    const restoreFetch = stubStageTwoFetch();
    const bedrock = stubBedrock({
      firstTotal: '4214',
      firstRequiresClarification: true,
      contentKind: 'MULTI_DOCUMENT',
    });
    try {
      const controller = new LineAiInternalController(
        {
          aiGatewayInternalSecret: 'secret', aiToolTimeoutMs: 1000,
          modelProvider: 'bedrock', bedrockRegion: 'ap-southeast-1', documentAiModelId: 'test-model',
        } as any,
        { execute: async () => { throw new Error('should not execute'); } } as any,
      );

      const result = await controller.receiptOcr('secret', request);

      assert.equal(result.classification?.contentKind, 'MULTI_DOCUMENT');
      assert.equal(result.classification?.requiresClarification, true);
      assert.equal(result.fields, undefined, 'a multi-entry page cannot expose one expense draft');
      assert.deepEqual(bedrock.calls, ['read', 'extract'], 'multi-entry classification must not be weakened by a total re-read');
    } finally {
      bedrock.restore();
      restoreFetch();
    }
  });

  it('forces a combined MWA sheet to multi-document and returns only verified parts', async () => {
    const page = 'การประปานครหลวง\nใบแจ้งค่าน้ำประปา งวด กันยายน 2569\nรวมทั้งสิ้น 110.05\nใบเสร็จรับเงิน งวด สิงหาคม 2569\nรวมทั้งสิ้น 82.28';
    const utilityDocuments = [
      { role: 'BILL_DUE', period: 'กันยายน 2569', amount: '110.05', titleEvidence: 'ใบแจ้งค่าน้ำประปา', amountEvidence: 'รวมทั้งสิ้น 110.05' },
      { role: 'RECEIPT_PAID', period: 'สิงหาคม 2569', amount: '82.28', titleEvidence: 'ใบเสร็จรับเงิน', amountEvidence: 'รวมทั้งสิ้น 82.28' },
    ];
    const restoreFetch = stubStageTwoFetch();
    const bedrock = stubBedrock({ firstReadText: page, firstTotal: '110.05', contentKind: 'DOCUMENT', utilityDocuments });
    try {
      const controller = new LineAiInternalController(
        { aiGatewayInternalSecret: 'secret', aiToolTimeoutMs: 1000,
          modelProvider: 'bedrock', bedrockRegion: 'ap-southeast-1', documentAiModelId: 'test-model' } as any,
        { execute: async () => { throw new Error('should not execute'); } } as any,
      );
      const result = await controller.receiptOcr('secret', request);
      assert.equal(result.classification?.contentKind, 'MULTI_DOCUMENT');
      assert.equal(result.fields, undefined);
      assert.deepEqual(result.utilityDocuments, utilityDocuments);
      assert.deepEqual(bedrock.calls, ['read', 'extract']);
    } finally {
      bedrock.restore();
      restoreFetch();
    }
  });

  it('UAT 2026-09-29: a tax receipt that sells water, fuel or appliances stays one readable expense', async () => {
    // Synthetic stand-ins for the owner's receipt (real photos stay out of the repo). "Still water",
    // "Tax Invoice (ABB)" and the ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ header used to read as a combined water
    // bill: every field was dropped and the customer was told the photo held more than one document.
    // ค่าน้ำมัน (fuel) and เครื่องใช้ไฟฟ้า (appliances) hit the same utility words.
    const pages = [
      ['SAMPLE HOMEMADE CO.,LTD.', 'ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ', 'Tax Invoice (ABB):TEST-0001',
        '1 G9.เนื้อผัดกระเทียม 380.00', '1 R1.Still water 60.00', 'ยอดรวม: 440.00', 'ค่าบริการ 10%: 44.00', 'ยอดสุทธิ: 484.00',
        'CC-Other(VISA)-0000: 484.00', 'VAT INCLUDED'],
      ['ร้านตัวอย่างการค้า', 'ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ', 'TAX INVOICE (ABB) NO. TEST-0002',
        'ค่าน้ำมันรถส่งของ 300.00', 'ปลั๊กพ่วง (เครื่องใช้ไฟฟ้า) 184.00', 'รวมทั้งสิ้น 484.00', 'VAT INCLUDED'],
    ];
    for (const lines of pages) {
      const page = lines.join('\n');
      const restoreFetch = stubStageTwoFetch();
      const bedrock = stubBedrock({ firstReadText: page, firstTotal: '484.00', firstRequiresClarification: false });
      try {
        const controller = new LineAiInternalController(
          { aiGatewayInternalSecret: 'secret', aiToolTimeoutMs: 1000,
            modelProvider: 'bedrock', bedrockRegion: 'ap-southeast-1', documentAiModelId: 'test-model' } as any,
          { execute: async () => { throw new Error('should not execute'); } } as any,
        );
        const result = await controller.receiptOcr('secret', request);
        assert.equal(result.status, 'ok', lines[0]);
        assert.equal(result.classification?.contentKind, 'DOCUMENT', lines[0]);
        assert.equal(result.fields?.grandTotalAmount, '484.00', lines[0]);
        assert.equal(result.fallbackReasons, undefined, 'no utility-parts detour');
        assert.deepEqual(bedrock.calls, ['read', 'extract'], lines[0]);
      } finally {
        bedrock.restore();
        restoreFetch();
      }
    }
  });

  it('recovers MWA parts when extraction selected only the current invoice', async () => {
    const page = 'การประปานครหลวง ใบแจ้งค่าน้ำประปา\nงวด 09/69\nรวม 110.05\nใบเสร็จรับเงิน/ใบกำกับภาษี\nงวด 08/69\nรวม 82.28';
    const parts = [
      { role: 'BILL_DUE', period: '09/69', amount: '110.05', titleEvidence: 'ใบแจ้งค่าน้ำประปา', amountEvidence: 'รวม 110.05' },
      { role: 'RECEIPT_PAID', period: '08/69', amount: '82.28', titleEvidence: 'ใบเสร็จรับเงิน/ใบกำกับภาษี', amountEvidence: 'รวม 82.28' },
    ];
    const restoreFetch = stubStageTwoFetch();
    const bedrock = stubBedrock({ firstReadText: page, firstTotal: '110.05', contentKind: 'DOCUMENT', utilityFallbackParts: parts });
    try {
      const controller = new LineAiInternalController(
        { aiGatewayInternalSecret: 'secret', aiToolTimeoutMs: 1000,
          modelProvider: 'bedrock', bedrockRegion: 'ap-southeast-1', documentAiModelId: 'test-model' } as any,
        { execute: async () => { throw new Error('should not execute'); } } as any,
      );
      const result = await controller.receiptOcr('secret', request);
      assert.equal(result.classification?.contentKind, 'MULTI_DOCUMENT');
      assert.equal(result.fields, undefined);
      assert.deepEqual(result.utilityDocuments, parts);
      assert.deepEqual(result.fallbackReasons, ['UTILITY_PARTS_MISSING']);
      assert.deepEqual(bedrock.calls, ['read', 'extract', 'extract']);
    } finally {
      bedrock.restore();
      restoreFetch();
    }
  });

  it('uses the utility-only read after two malformed general extractions', async () => {
    const page = 'การประปานครหลวง ใบแจ้งค่าน้ำประปา\nงวด 09/69\nรวม 110.05\nใบเสร็จรับเงิน/ใบกำกับภาษี\nงวด 08/69\nรวม 82.28';
    const parts = [
      { role: 'BILL_DUE', period: '09/69', amount: '110.05', titleEvidence: 'ใบแจ้งค่าน้ำประปา', amountEvidence: 'รวม 110.05' },
      { role: 'RECEIPT_PAID', period: '08/69', amount: '82.28', titleEvidence: 'ใบเสร็จรับเงิน/ใบกำกับภาษี', amountEvidence: 'รวม 82.28' },
    ];
    const restoreFetch = stubStageTwoFetch();
    const bedrock = stubBedrock({ firstReadText: page, firstTotal: '110.05', malformedUtilityExtraction: true, utilityFallbackParts: parts });
    try {
      const controller = new LineAiInternalController(
        { aiGatewayInternalSecret: 'secret', aiToolTimeoutMs: 1000,
          modelProvider: 'bedrock', bedrockRegion: 'ap-southeast-1', documentAiModelId: 'test-model' } as any,
        { execute: async () => { throw new Error('should not execute'); } } as any,
      );
      const result = await controller.receiptOcr('secret', request);
      assert.equal(result.classification?.contentKind, 'MULTI_DOCUMENT');
      assert.equal(result.fields, undefined);
      assert.deepEqual(result.utilityDocuments, parts);
      assert.deepEqual(result.fallbackReasons, ['JSON_INCOMPLETE_OR_INVALID', 'UTILITY_PARTS_MISSING']);
      assert.deepEqual(bedrock.calls, ['read', 'extract', 'extract', 'extract']);
    } finally {
      bedrock.restore();
      restoreFetch();
    }
  });

  it('does not mistake a single utility invoice saying it is not a receipt for two parts', async () => {
    const page = 'ใบแจ้งค่าน้ำประปา (ไม่ใช่ใบเสร็จรับเงิน)\nการประปาส่วนภูมิภาค\nงวด 09/65\nรวมเงินที่ต้องชำระ 454.75';
    const restoreFetch = stubStageTwoFetch();
    const bedrock = stubBedrock({ firstReadText: page, firstTotal: '454.75', firstRequiresClarification: false, contentKind: 'DOCUMENT' });
    try {
      const controller = new LineAiInternalController(
        { aiGatewayInternalSecret: 'secret', aiToolTimeoutMs: 1000,
          modelProvider: 'bedrock', bedrockRegion: 'ap-southeast-1', documentAiModelId: 'test-model' } as any,
        { execute: async () => { throw new Error('should not execute'); } } as any,
      );
      const result = await controller.receiptOcr('secret', request);
      assert.equal(result.classification?.contentKind, 'DOCUMENT');
      assert.equal(result.fields?.grandTotalAmount, '454.75');
      assert.equal(result.utilityDocuments, undefined);
      assert.deepEqual(bedrock.calls, ['read', 'extract']);
    } finally {
      bedrock.restore();
      restoreFetch();
    }
  });

  it('keeps the first reading when the provider has no vision re-read', async () => {
    const restoreFetch = stubStageTwoFetch();
    try {
      const controller = new LineAiInternalController(
        {
          aiGatewayInternalSecret: 'secret', aiToolTimeoutMs: 1000,
          modelProvider: 'openai', openAiApiKey: 'openai-key', openAiModel: 'gpt-test',
        } as any,
        { execute: async () => { throw new Error('should not execute'); } } as any,
      );

      const result = await controller.receiptOcr('secret', request);

      assert.equal(result.status, 'ok');
      assert.equal(result.fields?.grandTotalAmount, '160.00');
      assert.equal(result.classification?.requiresClarification, true);
    } finally {
      restoreFetch();
    }
  });

  it('grants the 16mb body limit to every base64-media route and nothing else', () => {
    for (const path of [
      '/v1/internal/ai/receipt-ocr',
      '/v1/internal/ai/bank-statement-extract',
      '/v1/internal/ai/line-intake-route',
    ]) {
      assert.ok(BASE64_MEDIA_ROUTES.test(path), `${path} must accept base64 media payloads`);
    }
    assert.ok(!BASE64_MEDIA_ROUTES.test('/v1/internal/ai/line-turn'), 'text turns stay at HTTP_BODY_LIMIT');
  });
});

/**
 * UAT 2026-08-27: intake carrying a photo was still timed on the chat/tool budget, so real
 * receipts died at the 15-second line (two fuel bills aborted at 15,011ms / 15,006ms; a milk-tea
 * bill scraped through at 15,003ms). UAT 2026-09-29: a text-only route plan died on the same line
 * (aborted at 15,002ms while Bedrock took 21.9s on a cold cache). These cases pin each budget from both sides.
 */
describe('intake route timeout budget', () => {
  const bedrockConfig = {
    aiGatewayInternalSecret: 'secret',
    modelProvider: 'bedrock',
    bedrockRegion: 'ap-southeast-1',
    bedrockModelId: 'global.anthropic.claude-sonnet-4-6',
    aiToolTimeoutMs: 15_000,
  } as any;

  const baseBody = {
    requestId: 'req-budget', companyId: 'company-1', userId: 'user-1', locale: 'th',
    messageText: '', permissions: ['expense.receipt.line_upload'],
  };

  /** Never answers; only the provider's own abort ends the call — so the wall clock IS the budget. */
  function hangUntilAborted() {
    const original = BedrockRuntimeClient.prototype.send;
    let calls = 0;
    (BedrockRuntimeClient.prototype as any).send = (_command: any, options: any) =>
      new Promise((_resolve, reject) => {
        calls++;
        options.abortSignal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    return Object.assign(() => { (BedrockRuntimeClient.prototype as any).send = original; }, { calls: () => calls });
  }

  async function settle() {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  }

  it('an intake WITH an attachment survives past the chat budget and uses the document budget', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const restore = hangUntilAborted();
    try {
      const controller = new LineAiInternalController(bedrockConfig, { execute: async () => { throw new Error('no turn'); } } as any);
      let settled = false;
      const pending = controller.lineIntakeRoute('secret', {
        ...baseBody,
        attachments: [{ id: 'att-fuel', mimeType: 'image/jpeg', purpose: 'unknown', contentBase64: 'ZmFrZQ==' }],
      } as any).then((plan) => { settled = true; return plan; });

      while (restore.calls() < 1) await new Promise<void>(resolve => setImmediate(resolve));
      t.mock.timers.tick(15_100);
      await settle();
      assert.equal(settled, false, 'the old 15s chat budget must no longer abort a photo intake');

      t.mock.timers.tick(30_000);
      await settle();
      while (restore.calls() < 2) await new Promise<void>(resolve => setImmediate(resolve));
      t.mock.timers.tick(45_100);
      await settle();
      const plan = await pending;
      assert.equal(plan.status, 'UNAVAILABLE', 'the document budget still bounds it — it does not hang forever');
    } finally {
      restore();
      t.mock.timers.reset();
    }
  });

  it('a text-only intake outlives the 15s chat budget and is bounded by its own 25s budget', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const restore = hangUntilAborted();
    try {
      const controller = new LineAiInternalController(bedrockConfig, { execute: async () => { throw new Error('no turn'); } } as any);
      let settled = false;
      const pending = controller.lineIntakeRoute('secret', { ...baseBody, messageText: 'ยอดขายวันนี้' } as any)
        .then((plan) => { settled = true; return plan; });

      while (restore.calls() < 1) await new Promise<void>(resolve => setImmediate(resolve));
      t.mock.timers.tick(15_100);
      await settle();
      assert.equal(settled, false, 'the old 15s chat budget must no longer abort a text intake');

      t.mock.timers.tick(9_800);
      await settle();
      assert.equal(settled, false);

      t.mock.timers.tick(200);
      await settle();
      const plan = await pending;
      assert.equal(plan.status, 'UNAVAILABLE', 'text intake still aborts at its 25s budget');
      assert.equal(plan.errorCode, 'PROVIDER_TIMEOUT');
    } finally {
      restore();
      t.mock.timers.reset();
    }
  });
});

/**
 * Per-row VAT admission (Owner 2026-08-28). A UAT survey of 38 real receipts found three that tax
 * some rows and not others, always marked on the row itself: `V` on a taxed price, `N` or `P` on an
 * exempt one. The gateway therefore admits a per-row rate ONLY when that row's evidence span
 * carries the marker it claims — an unmarked row inherits the document rate, which is what 25 of
 * the 38 receipts print.
 */
describe('receipt OCR per-row VAT', () => {
  const parse = (lines: unknown[], documentText: string) => parseReceiptOcrJson(
    JSON.stringify({ fields: { grandTotalAmount: '200.00', lines } }),
    documentText,
    new Set<string>(),
  );
  const doc = 'ข้าวผัด 100.00V\nนมสด 100.00N';

  it('keeps a marked mixed bill: taxed row keeps its rate, exempt row keeps rate 0 + treatment', () => {
    const out = parse([
      { description: 'ข้าวผัด', quantity: '1', amount: '100.00', vatRate: '0.07', evidenceSignal: 'ข้าวผัด 100.00V' },
      { description: 'นมสด', quantity: '1', amount: '100.00', vatRate: '0', vatTreatment: 'EXEMPT', evidenceSignal: 'นมสด 100.00N' },
    ], doc);
    assert.equal(out?.fields?.lines?.length, 2);
    assert.equal(out?.fields?.lines?.[0]?.vatRate, '0.07');
    assert.equal(out?.fields?.lines?.[1]?.vatRate, '0');
    assert.equal(out?.fields?.lines?.[1]?.vatTreatment, 'EXEMPT');
  });

  it('drops a per-row rate whose evidence span shows no marker — the row inherits the document rate', () => {
    const plain = 'ข้าวผัด 100.00\nนมสด 100.00';
    const out = parse([
      { description: 'ข้าวผัด', quantity: '1', amount: '100.00', vatRate: '0.07', evidenceSignal: 'ข้าวผัด 100.00' },
      { description: 'นมสด', quantity: '1', amount: '100.00', evidenceSignal: 'นมสด 100.00' },
    ], plain);
    assert.equal(out?.fields?.lines?.length, 2);
    assert.equal(out?.fields?.lines?.[0]?.vatRate, undefined, 'no printed marker, no per-row tax claim');
  });

  it('never keeps a treatment without a zero rate, and never a rate outside 0..1', () => {
    const withTreatmentOnTaxedRate = parse([
      { description: 'ข้าวผัด', quantity: '1', amount: '100.00', vatRate: '0.07', vatTreatment: 'EXEMPT', evidenceSignal: 'ข้าวผัด 100.00V' },
      { description: 'นมสด', quantity: '1', amount: '100.00', evidenceSignal: 'นมสด 100.00N' },
    ], doc);
    assert.equal(withTreatmentOnTaxedRate?.fields?.lines?.[0]?.vatTreatment, undefined);
    assert.equal(withTreatmentOnTaxedRate?.fields?.lines?.[0]?.vatRate, '0.07');

    const percentNotFraction = parse([
      { description: 'ข้าวผัด', quantity: '1', amount: '100.00', vatRate: '7', evidenceSignal: 'ข้าวผัด 100.00V' },
      { description: 'นมสด', quantity: '1', amount: '100.00', evidenceSignal: 'นมสด 100.00N' },
    ], doc);
    assert.equal(percentNotFraction?.fields?.lines?.[0]?.vatRate, undefined, '7 is not 7%');
  });

  it('a zero rate with no treatment is not a silent exemption', () => {
    const out = parse([
      { description: 'ข้าวผัด', quantity: '1', amount: '100.00', vatRate: '0', evidenceSignal: 'ข้าวผัด 100.00V' },
      { description: 'นมสด', quantity: '1', amount: '100.00', evidenceSignal: 'นมสด 100.00N' },
    ], doc);
    assert.equal(out?.fields?.lines?.[0]?.vatRate, undefined);
  });
});

/**
 * Foreign-currency detection (Owner 2026-08-29). A $200.00 USD invoice was read on UAT and recorded
 * as 200 บาท — silently wrong by the exchange rate. The read now reports the document's own
 * currency so the reviewer is warned; nothing here converts an amount, and an unread currency must
 * stay absent rather than defaulting to THB.
 */
describe('receipt OCR document currency', () => {
  const doc = 'INVOICE\nConsulting service\nTOTAL USD 200.00';
  const parse = (fields: Record<string, unknown>) => parseReceiptOcrJson(
    JSON.stringify({ fields: { grandTotalAmount: '200.00', ...fields } }),
    doc,
    new Set<string>(),
  );

  it('keeps an ISO code and normalizes its case and padding', () => {
    assert.equal(parse({ currency: 'USD' })?.fields?.currency, 'USD');
    assert.equal(parse({ currency: ' usd ' })?.fields?.currency, 'USD');
    assert.equal(parse({ currency: 'THB' })?.fields?.currency, 'THB');
    assert.equal(parse({ currency: 'EUR' })?.fields?.currency, 'EUR');
  });

  it('leaves an unread currency absent instead of defaulting to THB', () => {
    assert.equal(parse({})?.fields?.currency, undefined);
    assert.equal(parse({ currency: 'UNKNOWN' })?.fields?.currency, undefined, 'UNKNOWN is not a code');
    assert.equal(parse({ currency: '' })?.fields?.currency, undefined);
    assert.equal(parse({ currency: '$' })?.fields?.currency, undefined, 'a symbol is not a code');
    assert.equal(parse({ currency: 'US Dollars' })?.fields?.currency, undefined);
    assert.equal(parse({ currency: 'ดอลลาร์' })?.fields?.currency, undefined);
  });

  it('survives the §13 cross-check, which never sees "USD" printed on a symbol-only page', () => {
    const symbolOnly = 'INVOICE\nConsulting service\nTOTAL $200.00';
    const parsed = parseReceiptOcrJson(
      JSON.stringify({ fields: { grandTotalAmount: '200.00', currency: 'USD' } }),
      symbolOnly,
      new Set<string>(),
    );
    const checked = applyOcrValueCrossCheck(parsed!.fields!, symbolOnly);
    assert.equal(checked.currency, 'USD');
    assert.equal(checked.grandTotalAmount, '200.00', 'the printed figure is copied, never converted');
  });
});

/**
 * Reusing the intake read (Owner 2026-08-28, speed work). The intake router already reads the photo
 * to classify it; UAT measured 12.8s of intake followed by a 16.6s re-read of the identical image.
 * When that read is forwarded, this route must skip its own — and must still fall back to reading
 * whenever what arrives is not usable as a page.
 */
describe('receipt OCR reuses the intake read', () => {
  const config = {
    aiGatewayInternalSecret: 'secret', modelProvider: 'bedrock', bedrockRegion: 'ap-southeast-1',
    bedrockModelId: 'm', documentAiModelId: 'm', aiToolTimeoutMs: 15_000,
  } as any;
  const PAGE = '# ร้านกาแฟ\nลาเต้ 1 65.00\nรวม 65.00';

  /** Counts vision reads (image blocks) separately from text-only extraction calls. */
  function stubReads() {
    const original = BedrockRuntimeClient.prototype.send;
    const calls: string[] = [];
    (BedrockRuntimeClient.prototype as any).send = async (command: any) => {
      const content = command.input.messages.at(-1).content;
      const isRead = content.some((block: any) => block.image || block.document);
      calls.push(isRead ? 'read' : 'extract');
      if (isRead) return { stopReason: 'end_turn', output: { message: { content: [{ text: JSON.stringify({ natural_text: PAGE }) }] } } };
      return { stopReason: 'end_turn', output: { message: { content: [{ text: JSON.stringify({
        classification: {
          contentKind: 'DOCUMENT', documentFamily: 'EXPENSE_EVIDENCE', documentKind: 'RECEIPT',
          businessDirection: 'PURCHASE_EXPENSE', transactionState: 'PAID', confidence: 0.9,
          evidenceRoles: [], evidenceSignals: ['รวม 65.00'], amountSignals: ['65.00'],
          settlementSignals: ['รวม 65.00'], missingRequiredSignals: [], contradictionSignals: [],
          requiresClarification: false,
        },
        fields: { vendorName: 'ร้านกาแฟ', grandTotalAmount: '65.00' },
      }) }] } } };
    };
    return { calls, restore: () => { (BedrockRuntimeClient.prototype as any).send = original; } };
  }

  const request = (over: Record<string, unknown> = {}) => ({
    requestId: 'req-reuse', companyId: 'company-1', userId: 'user-1',
    attachment: { id: 'att-1', mimeType: 'image/jpeg', purpose: 'receipt', contentBase64: 'ZmFrZQ==' },
    ...over,
  });

  it('skips its own read when the intake hands the page over, and still extracts the same fields', async () => {
    const bedrock = stubReads();
    try {
      const controller = new LineAiInternalController(config, { execute: async () => { throw new Error('x'); } } as any);
      const result = await controller.receiptOcr('secret', request({ documentText: PAGE }) as any);
      assert.equal(result.status, 'ok');
      assert.equal(result.fields?.grandTotalAmount, '65.00');
      assert.deepEqual(bedrock.calls, ['extract'], 'the image must not be read a second time');
    } finally { bedrock.restore(); }
  });

  it('reuses usable transcription even for a clearly landscape photo', async () => {
    const sharp = (await import('sharp')).default;
    const contentBase64 = (await sharp({ create: { width: 1800, height: 1000, channels: 3, background: '#ffffff' } }).jpeg().toBuffer()).toString('base64');
    const bedrock = stubReads();
    try {
      const controller = new LineAiInternalController(config, {} as any);
      const result = await controller.receiptOcr('secret', request({ documentText: PAGE,
        attachment: { id: 'att', mimeType: 'image/jpeg', purpose: 'receipt', contentBase64 } }) as any);
      assert.equal(result.status, 'ok'); assert.deepEqual(bedrock.calls, ['extract']);
    } finally { bedrock.restore(); }
  });

  it('reads the image itself when no intake read is forwarded (unchanged behaviour)', async () => {
    const bedrock = stubReads();
    try {
      const controller = new LineAiInternalController(config, { execute: async () => { throw new Error('x'); } } as any);
      const result = await controller.receiptOcr('secret', request() as any);
      assert.equal(result.status, 'ok');
      assert.deepEqual(bedrock.calls, ['read', 'extract']);
    } finally { bedrock.restore(); }
  });

  it('falls back to reading when the forwarded text is too short to be a page', async () => {
    const bedrock = stubReads();
    try {
      const controller = new LineAiInternalController(config, { execute: async () => { throw new Error('x'); } } as any);
      const result = await controller.receiptOcr('secret', request({ documentText: 'ok' }) as any);
      assert.equal(result.status, 'ok');
      assert.deepEqual(bedrock.calls, ['read', 'extract'], 'a caption-length string is not a read');
    } finally { bedrock.restore(); }
  });

  it('still cross-checks extraction against the forwarded page, not against itself', async () => {
    const original = BedrockRuntimeClient.prototype.send;
    (BedrockRuntimeClient.prototype as any).send = async () => ({ stopReason: 'end_turn', output: { message: { content: [{ text: JSON.stringify({
      classification: classification(),
      fields: { vendorName: 'ร้านกาแฟ', grandTotalAmount: '9999.00' },
    }) }] } } });
    try {
      const controller = new LineAiInternalController(config, { execute: async () => { throw new Error('x'); } } as any);
      const result = await controller.receiptOcr('secret', request({ documentText: PAGE }) as any);
      assert.equal(result.fields?.grandTotalAmount, undefined, 'a total absent from the page cannot survive');
      assert.ok(result.fields?.missingFields?.includes('grandTotalAmount'));
    } finally { (BedrockRuntimeClient.prototype as any).send = original; }
  });
});


describe('receipt tax integrity evidence and recovery', () => {
  it('excludes the buyer and patient even when their tax ID is the only printed number', () => {
    const page = '[SELLER]บริษัท ผู้ขายตัวอย่าง จำกัด[/SELLER]\n[BUYER]บริษัท ลูกค้า จำกัด\nTax ID 0100000000001[/BUYER]\nรวม 100.00';
    const out = applyOcrValueCrossCheck({ vendorName: 'บริษัท ผู้ขายตัวอย่าง จำกัด', vendorIdentityEvidence: 'บริษัท ผู้ขายตัวอย่าง จำกัด', vendorTaxId: '0100000000001' }, page);
    assert.equal(out.vendorTaxId, undefined);
    assert.equal(out.vendorEntityKind, 'JURISTIC');
    assert.equal(applyOcrValueCrossCheck({ vendorName: 'บริษัท ลูกค้า จำกัด', vendorIdentityEvidence: 'บริษัท ลูกค้า จำกัด', vendorEntityKind: 'JURISTIC' }, page).vendorEntityKind, undefined);
    assert.equal(applyOcrValueCrossCheck({ vendorName: 'นาย สมชาย ตัวอย่าง', vendorIdentityEvidence: 'นาย สมชาย ตัวอย่าง' }, '[SELLER]นาย สมชาย ตัวอย่าง[/SELLER]\nรวม 100.00').vendorEntityKind, 'INDIVIDUAL');
    assert.equal(applyOcrValueCrossCheck({}, 'ร้านตัวอย่าง\nเลขบัญชี 0100000000001\nรวม 100.00').vendorTaxId, undefined);
  });

  it('does not turn a no-VAT subtotal or withholding into VAT', () => {
    const page = 'ใบเสร็จ\nVAT ไม่มี\nมูลค่าไม่มีหรือยกเว้นภาษี 70.50\nภาษีหัก ณ ที่จ่าย 2.71\nรวม 70.50';
    const out = applyOcrValueCrossCheck({ vatMode: 'NO_VAT', vatAmount: '70.50', whtAmount: '2.71', whtRate: '0.03', grandTotalAmount: '70.50' }, page);
    assert.equal(out.vatAmount, undefined);
    assert.equal(out.whtAmount, '2.71');
    assert.equal(out.whtRate, undefined, 'no printed percentage is no asserted rate');
    assert.equal(out.vatMode, 'NO_VAT');
  });

  it('recovers the row marker only from one matching physical line and preserves signed rounding', () => {
    const page = 'ผลไม้ 1 N 20.00\nเครื่องดื่ม 1 107.00\nRounding -0.72\nรวม 126.28';
    const fields = { grandTotalAmount: '126.28', lines: [
      { description: 'ผลไม้', quantity: '1', amount: '20.00', vatRate: '0', vatTreatment: 'NON_VAT', evidenceSignal: 'ผลไม้' },
      { description: 'เครื่องดื่ม', quantity: '1', amount: '107.00', evidenceSignal: 'เครื่องดื่ม' },
    ], additionalCharges: [{ kind: 'ROUNDING', description: 'Rounding', amount: '-0.72', vatRate: '0', evidenceSignal: 'Rounding -0.72' }] };
    const parsed = parseReceiptOcrJson(JSON.stringify({ fields }), page, new Set());
    assert.equal(parsed?.fields?.lines?.[0]?.vatRate, '0');
    assert.equal(parsed?.fields?.lines?.[0]?.evidenceSignal, 'ผลไม้ 1 N 20.00');
    assert.equal(parsed?.fields?.additionalCharges?.[0]?.amount, '-0.72');
    const checked = applyOcrValueCrossCheck(parsed!.fields!, page);
    assert.equal(checked.additionalCharges?.[0]?.amount, '-0.72');
    assert.equal(receiptItemsMismatch({ ...fields, vatMode: 'VAT_INCLUDED' } as any), false);
  });

  it('accepts the early classification brace locally and sends the corrected extract definitions once', async () => {
    const original = BedrockRuntimeClient.prototype.send;
    const page = 'ใบเสร็จ ร้านตัวอย่าง\nยอดรวม 65.00\nชำระแล้ว';
    const payload = { classification: classification(), fields: { vendorName: 'ร้านตัวอย่าง', grandTotalAmount: '65.00' } };
    let count = 0;
    try {
      (BedrockRuntimeClient.prototype as any).send = async (command: any) => {
        count++;
        assert.ok(!command.input.messages.at(-1).content.some((part: any) => part.image));
        const prompt = command.input.system.map((part: any) => part.text).join('\n');
        for (const definition of ['at most 200 printed item rows', 'unitPrice ONLY when', '168.-', 'รวมภาษีมูลค่าเพิ่มแล้ว', 'restaurant-style percentage surcharge', 'ค่าบริการติดตั้งระบบ', 'zero-width characters']) assert.ok(prompt.includes(definition), definition);
        return { stopReason: 'end_turn', output: { message: { content: [{ text: JSON.stringify(payload).replace('},"fields":', '}},"fields":') }] } } };
      };
      const controller = new LineAiInternalController({ aiGatewayInternalSecret: 'secret', modelProvider: 'bedrock', bedrockRegion: 'ap-southeast-1', bedrockModelId: 'm', documentAiModelId: 'm' } as any, {} as any);
      const result = await controller.receiptOcr('secret', { requestId: 'early-brace', companyId: 'co', userId: 'u', documentText: page,
        attachment: { mimeType: 'image/jpeg', contentBase64: 'ZmFrZQ==' } } as any);
      assert.equal(result.status, 'ok');
      assert.equal(result.fields?.grandTotalAmount, '65.00');
      assert.equal(result.fallbackReasons, undefined);
      assert.equal(count, 1, 'forwarded LINE text needs only extraction, no repair or image read');
    } finally { (BedrockRuntimeClient.prototype as any).send = original; }
  });

  it('repairs invalid structure once without extra image reads and preserves typed exhaustion', async () => {
    const original = BedrockRuntimeClient.prototype.send;
    const page = 'ใบเสร็จ ร้านตัวอย่าง\nยอดรวม 65.00\nชำระแล้ว';
    const payload = { classification: classification(), fields: { grandTotalAmount: '65.00' } };
    try {
      for (const failure of ['truncated', 'schema', 'json', 'exhausted']) {
        let count = 0;
        (BedrockRuntimeClient.prototype as any).send = async (command: any) => {
          count++;
          assert.ok(!command.input.messages.at(-1).content.some((part: any) => part.image));
          const failedText = failure === 'schema' ? JSON.stringify({ fields: payload.fields }) : '{"fields":';
          return { stopReason: count === 1 && failure === 'truncated' ? 'max_tokens' : 'end_turn',
            output: { message: { content: [{ text: count === 1 || failure === 'exhausted' ? failedText : JSON.stringify(payload) }] } } };
        };
        const controller = new LineAiInternalController({ aiGatewayInternalSecret: 'secret', modelProvider: 'bedrock', bedrockRegion: 'ap-southeast-1', bedrockModelId: 'm', documentAiModelId: 'm' } as any, {} as any);
        const result = await controller.receiptOcr('secret', { requestId: 'repair', companyId: 'co', userId: 'u', documentText: page,
          attachment: { mimeType: 'image/jpeg', contentBase64: 'ZmFrZQ==' } } as any);
        assert.equal(count, 2);
        assert.equal(result.status, failure === 'exhausted' ? 'failed' : 'ok');
        assert.deepEqual(result.fallbackReasons, ['JSON_INCOMPLETE_OR_INVALID']);
        if (failure === 'exhausted') assert.equal(result.errorCode, 'OCR_JSON_PARSE_FAILED');
      }
    } finally { (BedrockRuntimeClient.prototype as any).send = original; }
  });

  it('offers an upright alternate view without modifying the original receipt bytes', async () => {
    const sharp = (await import('sharp')).default;
    const image = await sharp({ create: { width: 80, height: 40, channels: 3, background: '#ffffff' } }).png().toBuffer();
    const original = image.toString('base64');
    const alternate = await receiptRereadImage('image/png', original);
    const meta = await sharp(Buffer.from(alternate.contentBase64, 'base64')).metadata();
    assert.equal(meta.width, 40); assert.equal(meta.height, 80);
    assert.equal(image.toString('base64'), original);
  });

  it('does not extract financial facts from a truncated first-stage page', async () => {
    const original = BedrockRuntimeClient.prototype.send;
    let calls = 0;
    try {
      (BedrockRuntimeClient.prototype as any).send = async () => {
        calls++;
        return { stopReason: 'max_tokens', output: { message: { content: [{ text: '{"natural_text":"ใบเสร็จ รายการแรก 65' }] } } };
      };
      const controller = new LineAiInternalController({ aiGatewayInternalSecret: 'secret', modelProvider: 'bedrock',
        bedrockRegion: 'ap-southeast-1', bedrockModelId: 'm', documentAiModelId: 'm' } as any, {} as any);
      const result = await controller.receiptOcr('secret', { requestId: 'incomplete-read', companyId: 'co', userId: 'u',
        attachment: { mimeType: 'image/jpeg', contentBase64: 'ZmFrZQ==' } } as any);
      assert.equal(calls, 1);
      assert.equal(result.status, 'failed');
      assert.equal(result.errorCode, 'OCR_OUTPUT_TRUNCATED');
      assert.equal(result.fields, undefined);
    } finally { (BedrockRuntimeClient.prototype as any).send = original; }
  });
});

/**
 * Phase E1c end to end: the real `receipt-ocr` route, through the real usage interceptor, with a
 * real `createProvider` and the money decorator active. Everything outside the gateway is faked —
 * Bedrock's transport and the API's two internal money seams — and nothing calls a real provider.
 */
describe('receipt-ocr under a SPLIT budget envelope (E1c)', () => {
  const OCR_BOUNDS = AI_BUDGET_STEP_BOUNDS['receipt-ocr'];
  const envelope = {
    attemptKey: 'line-image:abc',
    stepKind: 'receipt-ocr',
    invocationKey: aiBudgetInvocationKey('company-1', 'line-image:abc', 'receipt-ocr', 0),
    bucket: 'OCR',
    monthKey: '2026-09',
    modelId: 'test-model',
    bounds: { ...OCR_BOUNDS },
    maxCalls: OCR_BOUNDS.maxCalls,
  };

  const config = {
    aiGatewayInternalSecret: 'secret',
    aiToolTimeoutMs: 1000,
    modelProvider: 'bedrock',
    bedrockRegion: 'ap-southeast-1',
    documentAiModelId: 'test-model',
    erpCoreInternalUrl: 'http://api.test/v1',
  } as any;

  const request = {
    requestId: 'req-e1c',
    companyId: 'company-1',
    userId: 'user-1',
    attachment: { id: 'att-1', mimeType: 'image/jpeg' as const, purpose: 'receipt' as const, contentBase64: 'ZmFrZQ==' },
  };

  /** Fakes `POST /internal/ai/budget-step` and `/budget-settle` on the gateway's own transport. */
  function stubMoneySeams(step: { ok: boolean; code?: string; budgetScope?: string }) {
    const originalFetch = globalThis.fetch;
    const seen: string[] = [];
    globalThis.fetch = (async (url: any, init: any) => {
      const requested = String(url);
      const body = JSON.parse(init.body);
      if (requested.endsWith('/internal/ai/budget-step')) {
        seen.push(`step:${body.ordinal}:${body.monthKey}:${body.companyId}`);
        return new Response(JSON.stringify(step.ok
            ? {
              ok: true,
              envelope: {
                ...envelope,
                invocationKey: aiBudgetInvocationKey(body.companyId, body.attemptKey, body.stepKind, body.ordinal),
              },
            }
            : { ok: false, code: step.code, budgetScope: step.budgetScope }), { status: 200 });
      }
      if (requested.endsWith('/internal/ai/budget-settle')) {
        seen.push(`settle:${body.invocationKey}:${body.sourceRoute}:${body.usage.tag}`);
        return new Response(JSON.stringify({ result: 'settled' }), { status: 200 });
      }
      throw new Error(`unexpected fetch to ${requested}`);
    }) as any;
    return { seen, restore: () => { globalThis.fetch = originalFetch; } };
  }

  /** One Bedrock transport for the whole route: image blocks read, text blocks extract. */
  function stubBedrockChain() {
    const original = BedrockRuntimeClient.prototype.send;
    const calls: string[] = [];
    (BedrockRuntimeClient.prototype as any).send = async (command: any) => {
      const content = command.input.messages.at(-1).content;
      const isRead = content.some((block: any) => block.image);
      calls.push(isRead ? 'read' : 'extract');
      if (isRead) {
        return {
          usage: { inputTokens: 2_100, outputTokens: 400, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 },
          output: { message: { content: [{ text: JSON.stringify({ natural_text: '# Starbucks Coffee\nSub Total 195.00\nTotal Discount -15.00\nTotal Amount 180.00\nPayment 180.00' }) }] } },
          stopReason: 'end_turn',
        };
      }
      return {
        usage: { inputTokens: 900, outputTokens: 120, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 },
        output: {
          message: {
            content: [{
              text: JSON.stringify({
                classification: {
                  contentKind: 'DOCUMENT', documentFamily: 'EXPENSE_EVIDENCE', documentKind: 'RECEIPT',
                  businessDirection: 'PURCHASE_EXPENSE', transactionState: 'PAID',
                  evidenceRoles: ['EXPENSE_SUPPORT'], confidence: 0.9,
                  evidenceSignals: ['Starbucks Coffee'], amountSignals: ['Total Amount 180.00'],
                  settlementSignals: ['Payment 180.00'], missingRequiredSignals: [],
                  contradictionSignals: [], requiresClarification: false,
                },
                fields: { vendorName: 'Starbucks Coffee', grandTotalAmount: '180.00' },
              }),
            }],
          },
        },
        stopReason: 'end_turn',
      };
    };
    return { calls, restore: () => { (BedrockRuntimeClient.prototype as any).send = original; } };
  }

  /** Runs the route the way Nest does: inside the usage interceptor, with the envelope on the body. */
  function routeWithEnvelope(body: unknown): Promise<any> {
    const controller = new LineAiInternalController(config, { execute: async () => { throw new Error('unused'); } } as any);
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ body, url: '/v1/internal/ai/receipt-ocr' }) }),
    } as unknown as ExecutionContext;
    return firstValueFrom(new AiUsageInterceptor().intercept(ctx, {
      handle: () => defer(() => controller.receiptOcr('secret', body as any)),
    } as CallHandler)) as Promise<any>;
  }

  it('steps before the extract call, settles both invocations, and tags the response rows', async () => {
    const money = stubMoneySeams({ ok: true });
    const bedrock = stubBedrockChain();
    try {
      const result = await routeWithEnvelope({ ...request, budgetEnvelope: envelope });

      assert.equal(result.status, 'ok');
      assert.equal(result.fields.grandTotalAmount, '180.00');
      assert.deepEqual(bedrock.calls, ['read', 'extract']);
      // Call 0 uses the invocation the API reserved; call 1 asks first, in the PINNED month.
      assert.deepEqual(money.seen, [
        'settle:company-1#line-image:abc#receipt-ocr#0:receipt-ocr:ocr.receipt.image-read',
        'step:1:2026-09:company-1',
        'settle:company-1#line-image:abc#receipt-ocr#1:receipt-ocr:ocr.receipt.extract',
      ]);
      // The rows on the response carry their own key, so the API's response path is a duplicate
      // of the evidence path rather than a second charge (ADR 0013 §7).
      assert.deepEqual(result.usage.map((u: any) => [u.tag, u.invocationKey]), [
        ['ocr.receipt.image-read', 'company-1#line-image:abc#receipt-ocr#0'],
        ['ocr.receipt.extract', 'company-1#line-image:abc#receipt-ocr#1'],
      ]);
    } finally {
      bedrock.restore();
      money.restore();
    }
  });

  it('keeps the read it already paid for when the extract step cannot be funded', async () => {
    const money = stubMoneySeams({ ok: false, code: 'AI_BUDGET_INSUFFICIENT', budgetScope: 'OCR' });
    const bedrock = stubBedrockChain();
    try {
      const result = await routeWithEnvelope({ ...request, budgetEnvelope: envelope });

      // Spec §12.3: the route answers with the money vocabulary and its scope — never "ok" with
      // empty fields, and never a generic failure the caller would retry into the same gate.
      assert.equal(result.status, 'failed');
      assert.equal(result.errorCode, 'AI_BUDGET_INSUFFICIENT');
      assert.equal(result.budgetScope, 'OCR');
      assert.equal(result.fields, undefined);
      // The refused step never reached a provider, and the read that DID run is still billed.
      assert.deepEqual(bedrock.calls, ['read']);
      assert.deepEqual(money.seen, [
        'settle:company-1#line-image:abc#receipt-ocr#0:receipt-ocr:ocr.receipt.image-read',
        'step:1:2026-09:company-1',
      ]);
      assert.deepEqual(result.usage.map((u: any) => [u.tag, u.invocationKey]), [
        ['ocr.receipt.image-read', 'company-1#line-image:abc#receipt-ocr#0'],
      ]);
    } finally {
      bedrock.restore();
      money.restore();
    }
  });

  it('refuses the whole request when the envelope does not validate, before any provider call', async () => {
    const money = stubMoneySeams({ ok: true });
    const bedrock = stubBedrockChain();
    try {
      const result = await routeWithEnvelope({
        ...request,
        budgetEnvelope: { ...envelope, bounds: { ...OCR_BOUNDS, maxInputTokens: 900_000 } },
      });

      assert.equal(result.status, 'failed');
      assert.equal(result.errorCode, 'AI_BUDGET_UNAVAILABLE');
      assert.deepEqual(bedrock.calls, [], 'a request whose money cannot be proven never calls a provider');
      assert.deepEqual(money.seen, []);
      assert.equal(result.usage, undefined);
    } finally {
      bedrock.restore();
      money.restore();
    }
  });

  it('runs byte-for-byte as before when the same request carries no envelope', async () => {
    const money = stubMoneySeams({ ok: true });
    const bedrock = stubBedrockChain();
    try {
      const result = await routeWithEnvelope({ ...request });

      assert.equal(result.status, 'ok');
      assert.equal(result.fields.grandTotalAmount, '180.00');
      assert.deepEqual(bedrock.calls, ['read', 'extract']);
      assert.deepEqual(money.seen, [], 'no step, no settle: SHARED companies never touch the seams');
      assert.deepEqual(result.usage.map((u: any) => u.invocationKey), [undefined, undefined]);
    } finally {
      bedrock.restore();
      money.restore();
    }
  });
});

// Synthetic benchmark spans copied here so registered tests do not depend on .ocr-bench.
describe('OCR-A partial row gates and field definitions', () => {
  const row = (description: string, amount: string, evidenceSignal = description, extra = {}) => ({ description, quantity: '1', amount, evidenceSignal, ...extra });
  const parse = (fields: Record<string, unknown>, text: string) => parseReceiptOcrJson(JSON.stringify({ fields }), text, new Set())?.fields;

  it('keeps quantity/amount when the model derived an unprinted unit price', () => {
    const text = '2 x ข้าวผัดกะเพราหมูสับไข่ดาว    359.00\nซีอิ๊วขาว 500 มล.    140.00';
    const parsed = parse({ lines: [row('ข้าวผัดกะเพราหมูสับไข่ดาว', '359.00', '2 x ข้าวผัดกะเพราหมูสับไข่ดาว', { quantity: '2', unitPrice: '179.50' }), row('ซีอิ๊วขาว 500 มล.', '140.00')] }, text)!;
    const out = applyOcrValueCrossCheck(parsed, text);
    assert.deepEqual(out.lines?.map(({ quantity, amount, unitPrice }) => ({ quantity, amount, unitPrice })), [
      { quantity: '2', amount: '359.00', unitPrice: undefined }, { quantity: '1', amount: '140.00', unitPrice: undefined },
    ]);
    assert.ok(!out.missingFields?.includes('lines'));
    assert.equal(parsed.lines?.[0]?.unitPrice, '179.50', 'cross-check must not mutate input');
  });

  it('drops only an invalid optional unit-price shape', () => {
    const parsed = parse({ lines: [row('ผักชี 100 ก.', '168.-', 'ผักชี 100 ก.', { unitPrice: 'เดา' }), row('น้ำเปล่า', '172.-')] }, 'ผักชี 100 ก. 168.-\nน้ำเปล่า 172.-')!;
    assert.equal(parsed.lines?.length, 2);
    assert.equal(parsed.lines?.[0]?.unitPrice, undefined);
  });

  it('binds row quotes across table pipes, joined cells and whitespace to an exact source span', () => {
    for (const source of [
      '| 1 | P1000 | ปูนซีเมนต์ผสม 50 กก. | 12 | 991.00 | 11,892.00 |',
      '|1|P1000|ปูนซีเมนต์ผสม 50 กก.|12|991.00|11,892.00|',
      '1   P1000   ปูนซีเมนต์ผสม 50 กก.  12  991.00  11,892.00',
    ]) {
      const text = source + '\nถุงมือผ้า (โหล) 6 1,957.50 11,745.00';
      const out = parse({ lines: [row('ปูนซีเมนต์ผสม 50 กก.', '11,892.00', 'P1000 ปูนซีเมนต์ผสม 50 กก.'), row('ถุงมือผ้า (โหล)', '11,745.00')] }, text)!;
      assert.equal(out.lines?.length, 2, source);
      assert.ok(text.includes(out.lines![0]!.evidenceSignal), 'retain source evidence, including original pipes');
      assert.ok(!out.missingFields?.includes('lines'));
    }
  });

  it('keeps one surviving row and flags a failing quote, without joining separate source rows', () => {
    const text = 'ผักชี 100 ก. 168.-\nน้ำเปล่า 172.-';
    for (const evidenceSignal of ['ไม่มีข้อความนี้', 'ผักชี 100 ก. 168.- น้ำเปล่า 172.-']) {
      const out = parse({ lines: [row('ผักชี 100 ก.', '168.-'), row('น้ำเปล่า', '172.-', evidenceSignal)] }, text)!;
      assert.deepEqual(out.lines?.map((line) => line.description), ['ผักชี 100 ก.']);
      assert.ok(out.missingFields?.includes('lines'));
      assert.equal(receiptItemsMismatch(out), true, 'partial evidence stays incomplete');
    }
  });

  it('drops only a row with an unsupported amount and retains its sibling evidence', () => {
    const fields = { grandTotalAmount: '340.00', lines: [row('ผักชี 100 ก.', '168.00'), row('น้ำเปล่า', '173.00')] };
    const out = applyOcrValueCrossCheck(fields, 'ผักชี 100 ก. 168.-\nน้ำเปล่า 172.-\nรวม 340.00');
    assert.deepEqual(out.lines?.map((line) => line.amount), ['168.00']);
    assert.ok(out.missingFields?.includes('lines'));
    assert.equal(out.grandTotalAmount, '340.00');
  });

  it('retains the partial-row flag even when the model already filled the missing-field bound', () => {
    const missingFields = Array.from({ length: 20 }, (_, i) => `unknown-${i}`);
    const text = 'ผักชี 100 ก. 168.-\nน้ำเปล่า 172.-\nรวม 340.00';
    const quoteFailure = parse({ missingFields, lines: [row('ผักชี 100 ก.', '168.00'), row('น้ำเปล่า', '172.00', 'ไม่มีข้อความนี้')] }, text)!;
    const amountFailure = applyOcrValueCrossCheck({ missingFields, lines: [row('ผักชี 100 ก.', '168.00'), row('น้ำเปล่า', '173.00')] }, text);
    for (const out of [quoteFailure, amountFailure]) {
      assert.equal(out.missingFields?.length, 20);
      assert.ok(out.missingFields?.includes('lines'));
      assert.equal(out.lines?.length, 1);
    }
  });

  it('admits 31, 45, 60 and 200 printed rows but flags an over-bound block', () => {
    for (const count of [31, 45, 60, 200, 201]) {
      const lines = Array.from({ length: count }, (_, i) => row(`สินค้า ${i + 1}`, '10.00', `สินค้า ${i + 1} 10.00`));
      const text = lines.map((line) => line.evidenceSignal).join('\n');
      const out = parse({ lines }, text)!;
      assert.equal(out.lines?.length ?? 0, count <= 200 ? count : 0);
      assert.equal(out.missingFields?.includes('lines') ?? false, count > 200);
    }
  });

  it('normalizes exact cash-bill shorthand in row and document money', () => {
    const text = '| 2 | ผักชี 100 ก. | 84 | 168.- |\n| 1 | น้ำเปล่า | 172 | 172.- |\nรวมเงิน 340.-';
    const parsed = parse({ subtotalAmount: '340.-', grandTotalAmount: '340.-', lines: [row('ผักชี 100 ก.', '168.-', 'ผักชี 100 ก.', { quantity: '2', unitPrice: '84' }), row('น้ำเปล่า', '172.-', 'น้ำเปล่า', { unitPrice: '172' })] }, text)!;
    const out = applyOcrValueCrossCheck(parsed, text);
    assert.deepEqual(out.lines?.map((line) => line.amount), ['168.00', '172.00']);
    assert.equal(out.lines?.[0]?.unitPrice, '84');
    assert.equal(out.grandTotalAmount, '340.00');
    assert.equal(out.subtotalAmount, '340.00');
    assert.equal(receiptItemsMismatch(out), false);
  });

  it('honors explicit included-VAT wording even when a pre-tax base is also printed', () => {
    for (const label of ['VAT INCLUDED', 'รวมภาษีมูลค่าเพิ่มแล้ว']) {
      const out = applyOcrValueCrossCheck({ vatMode: 'VAT_EXCLUDED', taxableAmount: '635.28', vatAmount: '44.47', grandTotalAmount: '679.75' }, `มูลค่าสินค้าก่อนภาษี: 635.28\nภาษีมูลค่าเพิ่ม 7%: 44.47\nรวมทั้งสิ้น: 679.75\n${label}`);
      assert.equal(out.vatMode, 'VAT_INCLUDED');
      assert.equal(out.vatAmount, '44.47');
      assert.equal(out.grandTotalAmount, '679.75');
    }
    for (const label of ['NOT VAT INCLUDED', 'ไม่รวมภาษีมูลค่าเพิ่มแล้ว']) {
      assert.equal(applyOcrValueCrossCheck({ vatMode: 'VAT_EXCLUDED' }, label).vatMode, 'VAT_EXCLUDED');
    }
  });

  it('compacts slip references without inventing letters or digits and preserves printed dates', () => {
    const text = 'โอนเงินสำเร็จ\n16 ก.ย. 69 14:10 น.\nเลขที่รายการ: 202609161 9918297X3845';
    const out = applyOcrValueCrossCheck({ documentNumber: '202609161 9918297X3845', expenseDate: '2026-09-16' }, text, '2026-10-15', 'TRANSFER_SLIP');
    assert.equal(out.documentNumber, '2026091619918297X3845');
    assert.equal(out.expenseDate, '2026-09-16');
    const zeroWidth = applyOcrValueCrossCheck({ documentNumber: '202609158\u200b6765600K4322' }, 'เลขที่รายการ: 202609158\u200b6765600K4322', '2026-10-15', 'TRANSFER_SLIP');
    assert.equal(zeroWidth.documentNumber, '2026091586765600K4322');
    const invented = applyOcrValueCrossCheck({ documentNumber: '2026091619918297Y3845' }, text, '2026-10-15', 'TRANSFER_SLIP');
    assert.equal(invented.documentNumber, undefined);
    assert.ok(invented.missingFields?.includes('documentNumber'));
  });

  it('removes optional tax-ID gaps while preserving a full invoice gap', () => {
    for (const kind of ['RECEIPT', 'HANDWRITTEN_CASH_BILL', 'TRANSFER_SLIP', 'TAX_INVOICE']) {
      const out = applyOcrValueCrossCheck({ missingFields: ['vendorTaxId'] }, 'รวมเงิน 836.50', '2026-10-15', kind);
      assert.equal(out.missingFields?.includes('vendorTaxId'), kind === 'TAX_INVOICE');
    }
  });
});

describe('OCR-A image reread decision table', () => {
  const classification: BusinessDocumentClassification = {
    contentKind: 'DOCUMENT', documentFamily: 'EXPENSE_EVIDENCE', documentKind: 'TAX_INVOICE',
    businessDirection: 'PURCHASE_EXPENSE', transactionState: 'PAID', evidenceRoles: ['EXPENSE_SUPPORT'],
    confidence: 0.95, evidenceSignals: [], amountSignals: ['65.00'], settlementSignals: [],
    missingRequiredSignals: [], contradictionSignals: [], requiresClarification: false,
  };
  const fields: ReceiptOcrFieldResult = { grandTotalAmount: '65.00', vatMode: 'NO_VAT', lines: [
    { description: 'Latte', quantity: '1', amount: '40.00', evidenceSignal: 'Latte 1 40.00' },
    { description: 'Cake', quantity: '1', amount: '20.00', evidenceSignal: 'Cake 1 20.00' },
  ] };
  const cases: Array<[string, Partial<ReceiptOcrFieldResult>, Partial<BusinessDocumentClassification>, boolean]> = [
    ['all rows admitted with a real gap', {}, {}, true],
    ['rows reconcile', { grandTotalAmount: '60.00' }, {}, false],
    ['gates dropped a row', { missingFields: ['lines'] }, {}, true],
    ['no admitted block', { lines: undefined }, {}, false],
    ['total missing', { grandTotalAmount: undefined }, {}, false],
    ['clarification', {}, { requiresClarification: true }, false],
    ['multiple documents', {}, { contentKind: 'MULTI_DOCUMENT' }, false],
    ['VAT mode explains gap', { vatMode: 'VAT_INCLUDED', vatAmount: '5.00' }, {}, false],
    ['VAT mode uncertain', { vatMode: 'NEEDS_REVIEW' }, {}, false],
    ['VAT amount missing', { vatMode: 'VAT_EXCLUDED', vatRate: '0.07' }, {}, false],
    ['charge rejected by gate', { missingFields: ['additionalCharges'] }, {}, false],
  ];
  for (const [name, fieldChanges, classChanges, expected] of cases) {
    it(name, () => assert.equal(shouldRereadReceiptImage({ ok: true, fields: { ...fields, ...fieldChanges }, classification: { ...classification, ...classChanges } }), expected));
  }
  it('does not reread a failed extraction', () => assert.equal(shouldRereadReceiptImage({ ok: false, errorCode: 'OCR_SCHEMA_INVALID' }), false));
});

describe('OCR-B media bounds and timeout policy', () => {
  it('OCR-C retries the initial read/extract and spends at most one recovery call within the unchanged budget', async () => {
    const sharp = (await import('sharp')).default;
    const { runWithUsageContext, drainUsage } = await import('../../../../common/usage/usage-context');
    const { AI_RECEIPT_OCR_MAX_PROVIDER_CALLS, AI_RECEIPT_OCR_CLIENT_TIMEOUT_MS, AI_BUDGET_STEP_BOUNDS } = await import('@watchdog-bms/contracts');
    const image = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    const original = BedrockRuntimeClient.prototype.send;
    const calls: string[] = [];
    (BedrockRuntimeClient.prototype as any).send = async (command: any) => {
      const read = command.input.messages.at(-1).content.some((part: any) => part.image);
      calls.push(read ? 'read' : 'extract');
      if (calls.length % 2 === 1) throw Object.assign(new Error('fixture timeout'), { name: 'ProviderTimeout' });
      const amount = calls.length <= 4 ? '30.00' : '35.00';
      const lines = [{ description: 'น้ำดื่ม', amount, evidenceSignal: `น้ำดื่ม ${amount}` },
        { description: 'ขนม', amount: '30.00', evidenceSignal: 'ขนม 30.00' }];
      const page = `ใบเสร็จ ร้านตัวอย่าง\n${lines.map(line => line.evidenceSignal).join('\n')}\nรวม 65.00\nชำระแล้ว`;
      return { stopReason: 'end_turn', usage: { inputTokens: 1000, outputTokens: 100 },
        output: { message: { content: [{ text: JSON.stringify(read ? { natural_text: page } : {
          classification: classification({ amountSignals: ['65.00'], settlementSignals: ['ชำระแล้ว'] }),
          fields: { vendorName: 'ร้านตัวอย่าง', grandTotalAmount: '65.00', vatMode: 'NO_VAT', lines },
        }) }] } } };
    };
    try {
      await runWithUsageContext({ companyId: 'company' }, async () => {
        const controller = new LineAiInternalController({ aiGatewayInternalSecret: 'secret', modelProvider: 'bedrock',
          bedrockRegion: 'ap-southeast-1', documentAiModelId: 'm' } as any, {} as any);
        const result = await controller.receiptOcr('secret', { requestId: 'extract-timeouts', companyId: 'company', userId: 'u',
          attachment: { mimeType: 'image/jpeg', contentBase64: image.toString('base64') } } as any);
        assert.equal(result.status, 'ok'); assert.equal(result.fields?.lines?.[0]?.amount, '30.00', 'a failed recovery preserves the initial read');
        assert.deepEqual(calls, ['read', 'read', 'extract', 'extract', 'read']);
        const usage = drainUsage();
        assert.deepEqual(usage.map(entry => entry.ok), [false, true, false, true, false]);
        assert.deepEqual(usage.map(entry => entry.tag), ['ocr.receipt.image-read', 'ocr.receipt.image-read', 'ocr.receipt.extract', 'ocr.receipt.extract',
          'ocr.receipt.image-reread']);
        assert.ok(AI_RECEIPT_OCR_MAX_PROVIDER_CALLS >= calls.length);
        assert.equal(AI_BUDGET_STEP_BOUNDS['receipt-ocr'].maxCalls, AI_RECEIPT_OCR_MAX_PROVIDER_CALLS);
        assert.ok(AI_RECEIPT_OCR_CLIENT_TIMEOUT_MS > calls.length * 90000);
      });
    } finally { (BedrockRuntimeClient.prototype as any).send = original; }
  });

  it('OCR-C stops after the second extract timeout and does not retry other provider failures', async () => {
    const original = BedrockRuntimeClient.prototype.send;
    try {
      for (const timeout of [false, true]) {
        let calls = 0;
        (BedrockRuntimeClient.prototype as any).send = async () => { calls++;
          throw Object.assign(new Error('fixture failure'), { name: timeout ? 'ProviderTimeout' : 'ValidationException' }); };
        const controller = new LineAiInternalController({ aiGatewayInternalSecret: 'secret', modelProvider: 'bedrock',
          bedrockRegion: 'ap-southeast-1', documentAiModelId: 'm' } as any, {} as any);
        const result = await controller.receiptOcr('secret', { requestId: 'extract-failed', companyId: 'company', userId: 'u',
          documentText: 'ใบเสร็จ ร้านตัวอย่าง\nรวม 65.00\nชำระแล้ว', attachment: { mimeType: 'image/jpeg', contentBase64: 'AA==' } } as any);
        assert.equal(result.status, 'failed'); assert.equal(calls, timeout ? 2 : 1);
      }
    } finally { (BedrockRuntimeClient.prototype as any).send = original; }
  });
  it('retries a downscaled landscape read once, then attempts partial-row recovery once and preserves the first result on failure', async () => {
    const sharp = (await import('sharp')).default;
    const { runWithUsageContext, drainUsage } = await import('../../../../common/usage/usage-context');
    const bytes = await sharp({ create: { width: 3200, height: 1800, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
    const contentBase64 = bytes.toString('base64');
    const lines = Array.from({ length: 45 }, (_, index) => ({ description: `สินค้า ${index + 1}`, quantity: '1',
      amount: '10.00', unitPrice: '7.50', evidenceSignal: `สินค้า ${index + 1} 1 10.00` }));
    const page = ['ใบเสร็จ ร้านตัวอย่าง', ...lines.map(line => line.evidenceSignal), 'ยอดรวม 450.00', 'ชำระแล้ว'].join('\n');
    lines[44]!.evidenceSignal = 'ไม่มีข้อความนี้';
    const payload = { classification: classification({ amountSignals: ['450.00'] }),
      fields: { grandTotalAmount: '450.00', vatMode: 'NO_VAT', missingFields: ['vendorTaxId'], lines } };
    const original = BedrockRuntimeClient.prototype.send;
    const calls: string[] = [];
    (BedrockRuntimeClient.prototype as any).send = async (command: any) => {
      const images = command.input.messages.at(-1).content.filter((part: any) => part.image);
      calls.push(images.length ? 'read' : 'extract');
      if (calls.length === 1) throw Object.assign(new Error('fixture timeout'), { name: 'ProviderTimeout' });
      for (const image of images) {
        const meta = await sharp(Buffer.from(image.image.source.bytes)).metadata();
        assert.ok(Math.max(meta.width!, meta.height!) <= 2400);
      }
      if (images.length) assert.equal(images.length, calls.length <= 2 ? 2 : 1, 'initial landscape read carries the alternate view');
      return { stopReason: 'end_turn', output: { message: { content: [{ text: images.length
        ? JSON.stringify({ natural_text: page }) : JSON.stringify(payload).replace('},"fields":', '}},"fields":') }] } } };
    };
    try {
      await runWithUsageContext({ companyId: 'co' }, async () => {
        const controller = new LineAiInternalController({ aiGatewayInternalSecret: 'secret', modelProvider: 'bedrock',
          bedrockRegion: 'ap-southeast-1', bedrockModelId: 'm', documentAiModelId: 'm' } as any, {} as any);
        const result = await controller.receiptOcr('secret', { requestId: 'merged-ocr', companyId: 'co', userId: 'u',
          attachment: { mimeType: 'image/jpeg', contentBase64 } } as any);
        assert.equal(result.status, 'ok');
        assert.equal(result.fields?.lines?.length, 44, 'admit beyond 40 and retain supported siblings');
        assert.ok(result.fields?.lines?.every(line => line.unitPrice === undefined));
        assert.ok(result.fields?.missingFields?.includes('lines'));
        assert.ok(!result.fields?.missingFields?.includes('vendorTaxId'));
        assert.equal(result.fields?.grandTotalAmount, '450.00');
        assert.deepEqual(result.fallbackReasons, ['ITEMS_INCOMPLETE']);
        assert.deepEqual(calls, ['read', 'read', 'extract', 'read']);
        assert.deepEqual(drainUsage().map(entry => entry.ok), [false, true, true, true]);
      });
      assert.equal(bytes.toString('base64'), contentBase64, 'original bytes are preserved');
    } finally { (BedrockRuntimeClient.prototype as any).send = original; }
  });

  it('selects time by work size and keeps outer waits above the whole chain', async () => {
    const { aiDocumentOcrTimeoutMs, aiGatewayClientTimeoutMs, AI_RECEIPT_OCR_CLIENT_TIMEOUT_MS } = await import('@watchdog-bms/contracts');
    for (const [mimeType, width, height, expected] of [
      ['image/jpeg', 1200, 1600, 45000], ['image/png', 1000, 1000, 45000],
      ['image/jpeg', 1654, 2339, 90000], ['image/jpeg', 800, 4000, 90000],
      ['image/jpeg', 2339, 1654, 90000], ['application/pdf', 0, 0, 90000],
    ] as const) assert.equal(aiDocumentOcrTimeoutMs({ mimeType, width, height }), expected);
    assert.ok(aiGatewayClientTimeoutMs(2) > 2 * 90000);
    assert.ok(AI_RECEIPT_OCR_CLIENT_TIMEOUT_MS > 8 * 90000);
  });

  it('shrinks a photo to 2400px, keeps aspect and original bytes, and never upscales', async () => {
    const sharp = (await import('sharp')).default;
    const { prepareDocumentImage } = await import('../../domain/logic/document-media.logic');
    for (const [width, height, targetWidth, targetHeight] of [[4000, 3000, 2400, 1800], [600, 800, 600, 800]]) {
      const bytes = await sharp({ create: { width: width!, height: height!, channels: 3, background: '#eeeddd' } }).jpeg().toBuffer();
      const original = Buffer.from(bytes);
      const result = await prepareDocumentImage({ mimeType: 'image/jpeg', contentBase64: bytes.toString('base64') });
      const meta = await sharp(Buffer.from(result.contentBase64, 'base64')).metadata();
      assert.equal(meta.width, targetWidth); assert.equal(meta.height, targetHeight);
      assert.deepEqual(bytes, original);
      assert.ok(Buffer.from(result.contentBase64, 'base64').length <= 3500000);
    }
  });

  it('adds an alternate view only beyond the landscape ratio boundary', async () => {
    const sharp = (await import('sharp')).default;
    const { isLandscapeDocument } = await import('../../domain/logic/document-media.logic');
    const { receiptRereadImage } = await import('./line-ai-internal.controller');
    for (const [width, height, expected] of [[100, 100, false], [125, 100, false], [126, 100, true], [100, 140, false]] as const) {
      assert.equal(isLandscapeDocument(width, height), expected);
      const bytes = await sharp({ create: { width, height, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
      const contentBase64 = bytes.toString('base64');
      const result = await receiptRereadImage('image/jpeg', contentBase64);
      assert.equal(result.contentBase64 !== contentBase64, expected);
    }
  });

  it('retries only a timeout and never more than once', async () => {
    const { readWithTimeoutRetry } = await import('../../domain/logic/document-media.logic');
    for (const code of ['PROVIDER_TIMEOUT', 'PROVIDER_UNKNOWN', 'PROVIDER_BUDGET_EXHAUSTED'] as const) {
      let calls = 0;
      await readWithTimeoutRetry({ generateText: async () => { calls++; return { ok: false, error: { code, message: 'fixture', retryable: true } }; } }, { messages: [] });
      assert.equal(calls, code === 'PROVIDER_TIMEOUT' ? 2 : 1);
    }
    let calls = 0;
    const recovered = await readWithTimeoutRetry({ generateText: async () => ++calls === 1
      ? { ok: false, error: { code: 'PROVIDER_TIMEOUT', message: 'fixture', retryable: true } }
      : { ok: true, text: 'complete page' } }, { messages: [] });
    assert.equal(recovered.ok, true); assert.equal(calls, 2);
  });
});

// Actual gateway model-result JSON from the 2026-10-16 synthetic full-field benchmark.
// Corrections below are explicit mocked responses, not a claim that a live model was rerun.
describe('Fix-up 16 full-field OCR trace regressions', () => {
  const D3 = {"fields":{"vendorName":"ห้างหุ้นส่วนจำกัด ช่างเหล็กวัสดุ","vendorIdentityEvidence":"ห้างหุ้นส่วนจำกัด ช่างเหล็กวัสดุ","vendorEntityKind":"JURISTIC","vendorTaxId":"0123556033444","vendorBranchCode":"00000","vendorAddress":"15/2 หมู่ 4 ต.บางกระสอ อ.เมือง จ.นนทบุรี 11000","documentNumber":"CL-6910-0098","expenseDate":"2026-10-02","description":"วัสดุก่อสร้าง (ปูนซีเมนต์ ทรายหยาบ ตะปู ถุงมือผ้า และอื่นๆ)","vatRate":"0.07","subtotalAmount":"3,039.50","taxableAmount":"2,889.50","vatAmount":"202.27","grandTotalAmount":"3,091.00","currency":"THB","vatMode":"VAT_EXCLUDED","lines":[{"description":"ปูนซีเมนต์ 50 กก.","quantity":"10","amount":"1,450.00","unitPrice":"145.00","evidenceSignal":"ปูนซีเมนต์ 50 กก.","confidence":0.95},{"description":"ทรายหยาบ (คิว)","quantity":"2","amount":"1,300.00","unitPrice":"650.00","evidenceSignal":"ทรายหยาบ (คิว)","confidence":0.95},{"description":"ตะปู 2 นิ้ว (กก.)","quantity":"3","amount":"145.50","unitPrice":"48.50","evidenceSignal":"ตะปู 2 นิ้ว (กก.)","confidence":0.95},{"description":"ถุงมือผ้า","quantity":"12","amount":"144.00","unitPrice":"12.00","evidenceSignal":"ถุงมือผ้า","confidence":0.95}],"confidence":0.93,"categorySuggestion":{"expenseCategoryId":"category-a-other","confidence":0.62,"evidenceSignals":["ปูนซีเมนต์ 50 กก.","ทรายหยาบ (คิว)","ตะปู 2 นิ้ว (กก.)","ช่างเหล็กวัสดุ"]},"expenseDateAssumptions":["order_assumed_day_month","era_resolved_ce"],"missingFields":["discountAmount","additionalCharges"]},"classification":{"contentKind":"DOCUMENT","documentFamily":"EXPENSE_EVIDENCE","documentKind":"ABBREVIATED_TAX_INVOICE","businessDirection":"PURCHASE_EXPENSE","transactionState":"PAID","evidenceRoles":["EXPENSE_SUPPORT","TAX_EVIDENCE_CANDIDATE","PAYMENT_PROOF"],"confidence":0.93,"evidenceSignals":["บิลเงินสด/ใบกำกับภาษีอย่างย่อ","เลขที่ CL-6910-0098","ห้างหุ้นส่วนจำกัด ช่างเหล็กวัสดุ","เลขประจำตัวผู้เสียภาษี 0123556033444"],"amountSignals":["3,091.00"],"settlementSignals":["บิลเงินสด/ใบกำกับภาษีอย่างย่อ","ชำระโดย เงินโอน"],"missingRequiredSignals":[],"contradictionSignals":[],"requiresClarification":false}};
  const R4 = {"fields":{"vendorName":"บริษัท สุกี้นานา จำกัด","vendorIdentityEvidence":"บริษัท สุกี้นานา จำกัด","vendorEntityKind":"JURISTIC","vendorTaxId":"0105563098761","vendorBranchCode":"00017","documentNumber":"SN17-2610-1188","expenseDate":"2026-10-14","description":"อาหารสุกี้และเครื่องดื่ม (โต๊ะ 21)","vatRate":"0.07","subtotalAmount":"1155.00","taxableAmount":"1270.50","vatAmount":"88.94","grandTotalAmount":"1359.00","currency":"THB","vatMode":"VAT_EXCLUDED","lines":[{"description":"ชุดสุกี้รวมมิตร","quantity":"2","amount":"718.00","unitPrice":"359.00","evidenceSignal":"ชุดสุกี้รวมมิตร","confidence":0.97},{"description":"หมูสไลซ์","quantity":"2","amount":"238.00","unitPrice":"119.00","evidenceSignal":"หมูสไลซ์","confidence":0.97},{"description":"เกี้ยวกุ้ง","quantity":"1","amount":"89.00","unitPrice":"89.00","evidenceSignal":"เกี้ยวกุ้ง","confidence":0.97},{"description":"ชาเขียวเย็น","quantity":"2","amount":"110.00","unitPrice":"55.00","evidenceSignal":"ชาเขียวเย็น","confidence":0.97}],"additionalCharges":[{"kind":"SERVICE_CHARGE","description":"ค่าบริการ (Service Charge) 10%","amount":"115.50","evidenceSignal":"ค่าบริการ (Service Charge) 10%","vatRate":"0.07","confidence":0.97}],"categorySuggestion":{"expenseCategoryId":"category-a-other","confidence":0.72,"evidenceSignals":["ชุดสุกี้รวมมิตร","ชาเขียวเย็น","บริษัท สุกี้นานา จำกัด"]},"expenseDateAssumptions":["era_resolved_ce"],"missingFields":["additionalCharges"]},"classification":{"contentKind":"DOCUMENT","documentFamily":"EXPENSE_EVIDENCE","documentKind":"ABBREVIATED_TAX_INVOICE","businessDirection":"PURCHASE_EXPENSE","transactionState":"PAID","evidenceRoles":["EXPENSE_SUPPORT","TAX_EVIDENCE_CANDIDATE","PAYMENT_PROOF"],"confidence":0.97,"evidenceSignals":["ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ","SN17-2610-1188","บริษัท สุกี้นานา จำกัด"],"amountSignals":["1,359.00"],"settlementSignals":["ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ","ชำระโดย QR พร้อมเพย์"],"missingRequiredSignals":[],"contradictionSignals":[],"requiresClarification":false}};
  const S4 = {"fields":{"vendorName":"บริษัท ไฟฟ้าทดสอบ จำกัด","vendorIdentityEvidence":"บริษัท ไฟฟ้าทดสอบ จำกัด","vendorEntityKind":"JURISTIC","documentNumber":"000941782301","expenseDate":"2026-10-14","description":"ชำระค่าไฟฟ้า","currency":"THB","confidence":0.9,"categorySuggestion":{"expenseCategoryId":"category-a-other","confidence":0.72,"evidenceSignals":["บริษัท ไฟฟ้าทดสอบ จำกัด","Ref.1: 020004571236"]},"missingFields":["grandTotalAmount"],"expenseDateAssumptions":["era_read_be"]},"classification":{"contentKind":"DOCUMENT","documentFamily":"PAYMENT_EVIDENCE","documentKind":"TRANSFER_SLIP","businessDirection":"PURCHASE_EXPENSE","transactionState":"PAID","evidenceRoles":["PAYMENT_PROOF"],"confidence":0.93,"evidenceSignals":["ชำระเงินสำเร็จ","ธนาคารกรุงไทย"],"amountSignals":["4,127.15"],"settlementSignals":["ชำระเงินสำเร็จ"],"missingRequiredSignals":[],"contradictionSignals":[],"requiresClarification":false}};
  const P1 = {"fields":{"vendorName":"บริษัท ก๋วยเตี๋ยวเรือทองคำ จำกัด","vendorIdentityEvidence":"บริษัท ก๋วยเตี๋ยวเรือทองคำ จำกัด","vendorEntityKind":"JURISTIC","vendorTaxId":"0105561135791","vendorBranchCode":"00002","documentNumber":"TK2-0007714","expenseDate":"2026-10-06","description":"อาหารและเครื่องดื่ม ร้านก๋วยเตี๋ยวเรือทองคำ","vatRate":"0.07","subtotalAmount":"490.00","taxableAmount":"539.00","vatAmount":"37.73","grandTotalAmount":"576.73","currency":"THB","vatMode":"VAT_EXCLUDED","lines":[{"description":"ก๋วยเตี๋ยวเรือหมู","quantity":"4","amount":"90.00","unitPrice":"60.00","evidenceSignal":"ก๋วยเตี๋ยวเรือหมู","confidence":0.6},{"description":"หมูสะเต๊ะ","quantity":"1","amount":"160.00","unitPrice":"90.00","evidenceSignal":"หมูสะเต๊ะ","confidence":0.6}],"additionalCharges":[{"kind":"SERVICE_CHARGE","description":"ค่าบริการ (Service Charge) 10%","amount":"49.00","evidenceSignal":"ค่าบริการ (Service Charge) 10%","vatRate":"0.07","confidence":0.85}],"confidence":0.88,"categorySuggestion":{"expenseCategoryId":"category-a-other","confidence":0.72,"evidenceSignals":["ก๋วยเตี๋ยวเรือหมู","หมูสะเต๊ะ","ชาไทยเย็น"]},"missingFields":["lines","category"],"expenseDateAssumptions":["order_assumed_day_month","era_resolved_ce"]},"classification":{"contentKind":"DOCUMENT","documentFamily":"EXPENSE_EVIDENCE","documentKind":"ABBREVIATED_TAX_INVOICE","businessDirection":"PURCHASE_EXPENSE","transactionState":"PAID","evidenceRoles":["EXPENSE_SUPPORT","TAX_EVIDENCE_CANDIDATE"],"confidence":0.88,"evidenceSignals":["ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ","เลขประจำตัวผู้เสียภาษี 0105561135791","เลขที่ TK2-0007714"],"amountSignals":["576.73","490.00"],"settlementSignals":["ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ","ชำระโดย เงินสด"],"missingRequiredSignals":[],"contradictionSignals":["CONTRADICTORY_SIGNALS"],"requiresClarification":true}};

  const textFor = (fields: any) => [
    fields.vendorName, fields.vendorTaxId, fields.vendorBranchCode, fields.documentNumber,
    'วันที่ 14/10/2026',
    ...(fields.lines ?? []).map((line: any) => `${line.description} ${line.quantity} ${line.unitPrice ?? ''} ${line.amount}`),
    `ยอดรวม ${fields.subtotalAmount ?? ''}`, `มูลค่าก่อนภาษี ${fields.taxableAmount ?? ''}`,
    `ภาษีมูลค่าเพิ่ม 7% ${fields.vatAmount ?? ''}`,
    ...(fields.additionalCharges ?? []).map((charge: any) => `${charge.description} ${charge.amount}`),
    `รวมทั้งสิ้น ${fields.grandTotalAmount ?? ''}`, 'ชำระแล้ว',
  ].join('\n');

  async function replay(read: string, first: any, recovery?: any) {
    const original = BedrockRuntimeClient.prototype.send;
    const calls: any[] = [];
    (BedrockRuntimeClient.prototype as any).send = async (command: any) => {
      calls.push(command.input);
      const answer = calls.length === 1 ? { natural_text: read } : calls.length === 2 ? first : recovery;
      assert.ok(answer, 'at most one additional provider call');
      return { stopReason: 'end_turn', output: { message: { content: [{ text: JSON.stringify(answer) }] } } };
    };
    try {
      const controller = new LineAiInternalController({ aiGatewayInternalSecret: 'secret', modelProvider: 'bedrock',
        bedrockRegion: 'ap-southeast-1', documentAiModelId: 'test-model' } as any, {} as any);
      const result = await controller.receiptOcr('secret', { requestId: 'full-field-regression', companyId: 'company', userId: 'owner',
        attachment: { id: 'photo', mimeType: 'image/jpeg', purpose: 'receipt', contentBase64: 'AA==' } });
      return { result, calls };
    } finally { (BedrockRuntimeClient.prototype as any).send = original; }
  }

  it('O1/O2: requests and retains D3 line + bill discount and signed final rounding', async () => {
    assert.equal('discountAmount' in D3.fields, false);
    const fields = { ...D3.fields, discountAmount: '150.00', missingFields: [], additionalCharges: [
      { kind: 'ROUNDING', description: 'ปัดเศษ', amount: '-0.77', vatRate: '0', evidenceSignal: 'ปัดเศษ -0.77' },
    ] };
    const read = textFor(fields) + '\nส่วนลด ราคาส่ง -50.00\nรวมส่วนลดรายการ -50.00\nส่วนลดท้ายบิล -100.00';
    const { result, calls } = await replay(read, { ...D3, fields });
    assert.equal(result.fields?.discountAmount, '150.00', 'aggregate is not a separately printed amount');
    assert.equal(result.fields?.additionalCharges?.[0]?.amount, '-0.77');
    assert.equal(receiptItemsMismatch(result.fields), false);
    assert.equal(calls.length, 2);
    assert.match(calls[0].system[0].text, /สตางค์ปัดเศษ/);
    assert.match(calls[1].system[0].text, /line discounts AND a bill-level discount/);
  });

  it('O2: refuses an unprinted aggregate that the admitted settlement cannot prove', async () => {
    const { applyOcrValueCrossCheck } = await import('./line-ai-internal.controller');
    const fields = { ...D3.fields, discountAmount: '149.00', missingFields: [], additionalCharges: [
      { kind: 'ROUNDING' as const, description: 'ปัดเศษ', amount: '-0.77', vatRate: '0', evidenceSignal: 'ปัดเศษ -0.77' }] };
    const checked = applyOcrValueCrossCheck(fields as any, textFor(fields) + '\nส่วนลดรายการ -50.00\nส่วนลดท้ายบิล -100.00', '2026-10-16');
    assert.equal(checked.discountAmount, undefined);
    assert.ok(checked.missingFields?.includes('discountAmount'));
  });

  it('O1: retains R4 negative rounding alongside the service charge', async () => {
    assert.equal(R4.fields.additionalCharges.length, 1);
    const fields = { ...R4.fields, missingFields: [], additionalCharges: [...R4.fields.additionalCharges,
      { kind: 'ROUNDING', description: 'สตางค์ปัดเศษ', amount: '-0.44', vatRate: '0', evidenceSignal: 'สตางค์ปัดเศษ -0.44' }] };
    const { result, calls } = await replay(textFor(fields), { ...R4, fields });
    assert.deepEqual(result.fields?.additionalCharges?.map(charge => charge.kind), ['SERVICE_CHARGE', 'ROUNDING']);
    assert.equal(receiptItemsMismatch(result.fields), false);
    assert.equal(calls.length, 2);
  });

  it('O3: requests the paid amount on the S4 Ref.1/Ref.2 bill-payment slip', async () => {
    assert.equal('grandTotalAmount' in S4.fields, false);
    const read = `${textFor(S4.fields)}\nชำระบิล\nชำระเงินสำเร็จ\nธนาคารกรุงไทย\nRef.1: 020004571236\nRef.2: 000941782301\nจำนวนเงิน 4,127.15 บาท`;
    const { result, calls } = await replay(read, { ...S4, fields: { ...S4.fields, grandTotalAmount: '4,127.15', missingFields: [] } });
    assert.equal(result.fields?.grandTotalAmount, '4,127.15');
    assert.equal(result.classification?.documentFamily, 'PAYMENT_EVIDENCE');
    assert.match(calls[1].system[0].text, /On TRANSFER_SLIP, including bill-payment slips/);
    assert.equal(calls.length, 2);
  });

  it('O4: the real P1 incomplete/clarification result qualifies for row recovery', () => {
    assert.equal(shouldRereadReceiptImage({ ok: true, ...P1 } as any), true);
  });

  for (const failure of [undefined, 'total', 'document', 'rows', 'transcription'] as const) {
    it(`O4: one combined visual recovery ${failure ? 'rejects changed ' + failure : 'restores all three P1 rows'}`, async () => {
      const truth = { ...P1.fields, missingFields: [], lines: [
        { description: 'ก๋วยเตี๋ยวเรือหมู', quantity: '4', unitPrice: '60.00', amount: '240.00', evidenceSignal: 'ก๋วยเตี๋ยวเรือหมู 4 60.00 240.00' },
        { description: 'หมูสะเต๊ะ', quantity: '1', unitPrice: '90.00', amount: '90.00', evidenceSignal: 'หมูสะเต๊ะ 1 90.00 90.00' },
        { description: 'ชาไทยเย็น', quantity: '4', unitPrice: '40.00', amount: '160.00', evidenceSignal: 'ชาไทยเย็น 4 40.00 160.00' },
      ] };
      if (failure === 'total') truth.grandTotalAmount = '600.00';
      if (failure === 'document') truth.documentNumber = 'OTHER-2';
      if (failure === 'rows') truth.lines.pop();
      const recovery = { fields: truth, classification: { ...P1.classification, contradictionSignals: [], requiresClarification: false },
        ...(failure === 'transcription' ? {} : { natural_text: textFor(truth) }) };
      const { result, calls } = await replay(textFor(P1.fields), P1, recovery);
      assert.equal(calls.length, 3);
      assert.deepEqual(result.fallbackReasons, ['ITEMS_INCOMPLETE']);
      assert.equal(result.fields?.lines?.length, failure ? 2 : 3);
      assert.equal(result.fields?.grandTotalAmount, '576.73');
      assert.equal(result.classification?.requiresClarification, !!failure);
      if (!failure) assert.deepEqual(result.fields?.lines?.map(({ quantity, unitPrice, amount }) => ({ quantity, unitPrice, amount })), [
        { quantity: '4', unitPrice: '60.00', amount: '240.00' },
        { quantity: '1', unitPrice: '90.00', amount: '90.00' },
        { quantity: '4', unitPrice: '40.00', amount: '160.00' },
      ]);
    });
  }
});

// Exact gateway fields received by API on 2026-10-16; text transcribed from the local paper images.
describe('Fix-up 18 printed money evidence', () => {
  const fixtures = JSON.parse(readFileSync(resolve(__dirname, '../../../../../../../docs/research/fixtures/receipt-fx18-printed-money.json'), 'utf8')) as Array<{ id: string; fields: ReceiptOcrFieldResult; printedText: string }>;
  for (const fixture of fixtures) {
    it(`${fixture.id}: preserves captured paper money and recovers only the labelled subtotal`, () => {
      const out = applyOcrValueCrossCheck(fixture.fields, fixture.printedText, '2026-10-16');
      assert.equal(out.grandTotalAmount, fixture.fields.grandTotalAmount);
      assert.equal(out.vatAmount, fixture.fields.vatAmount);
      assert.equal(Number(out.subtotalAmount?.replace(/,/g, '')), fixture.id === 'A1' ? 156 : Number(fixture.fields.subtotalAmount!.replace(/,/g, '')));
    });
  }
  for (const id of ['R4', 'D3', 'D2']) {
    const fixture = fixtures.find((row) => row.id === id)!;
    const magnitude = id === 'R4' ? '0.44' : id === 'D3' ? '0.77' : '0.10';
    for (const label of ['ปัดเศษ', 'สตางค์ปัดเศษ', 'Rounding']) {
      for (const printed of [`-${magnitude}`, `(${magnitude})`, `${magnitude}-`, magnitude]) {
        it(`${id}: proves ${label} ${printed} from settlement with a label-only or mismatched quote`, () => {
          const printedText = fixture.printedText.replace(/ปัดเศษ -[\d.]+/, `${label} | ${printed}`);
          // Reconstruct the model candidate removed by the old cross-check; the captured fields
          // themselves remain unchanged in the fixture and are exercised separately above.
          const fields = { ...fixture.fields, ...(id === 'D3' ? { discountAmount: '150.00' } : {}), additionalCharges: [
            ...(fixture.fields.additionalCharges ?? []).filter((charge) => charge.kind !== 'ROUNDING'),
            { kind: 'ROUNDING', description: label, amount: magnitude, vatRate: '0', evidenceSignal: printed === magnitude ? label : `${label} -${magnitude}` },
          ] };
          const parsed = parseReceiptOcrJson(JSON.stringify({ fields }), printedText, new Set())!;
          assert.ok(parsed.fields?.additionalCharges?.some((charge) => charge.kind === 'ROUNDING'));
          const out = applyOcrValueCrossCheck(parsed.fields!, printedText, '2026-10-16');
          assert.equal(out.additionalCharges?.at(-1)?.amount, `-${magnitude}`);
          assert.equal(out.additionalCharges?.at(-1)?.evidenceSignal, `${label} | ${printed}`);
          if (id === 'D3') assert.equal(out.discountAmount, '150.00');
          assert.equal(out.grandTotalAmount, fixture.fields.grandTotalAmount);
        });
      }
    }
  }
  it('proves positive rounding from arithmetic rather than trusting the candidate sign', () => {
    const out = applyOcrValueCrossCheck({ subtotalAmount: '100', vatMode: 'NO_VAT', grandTotalAmount: '100.44',
      additionalCharges: [{ kind: 'ROUNDING', description: 'Rounding', amount: '-0.44', evidenceSignal: 'Rounding' }] }, 'Sub Total 100.00\nRounding 0.44\nTotal 100.44');
    assert.equal(out.additionalCharges?.[0]?.amount, '0.44');
  });
  it('rejects unrelated, ambiguous and arithmetically contradictory rounding evidence', () => {
    for (const text of ['Rounding\nOther -0.44', 'Other -0.44', 'Rounding -0.44\nRounding -0.44', 'Rounding -0.45']) {
      const out = applyOcrValueCrossCheck({ subtotalAmount: '100.00', grandTotalAmount: '99.56', vatMode: 'NO_VAT',
        additionalCharges: [{ kind: 'ROUNDING', description: 'Rounding', amount: '-0.44', evidenceSignal: 'Rounding' }] }, `Sub Total 100.00\nTotal 99.56\n${text}`);
      assert.equal(out.additionalCharges, undefined);
      assert.ok(out.missingFields?.includes('additionalCharges'));
    }
  });
  it('leaves conflicting subtotals and an unlabelled item sum unknown', () => {
    for (const text of ['Sub Total 150.00\nยอดรวม 156.00\nTotal 156.00', 'Item A 100.00\nItem B 56.00\nTotal 156.00']) {
      assert.equal(applyOcrValueCrossCheck({ grandTotalAmount: '156.00' }, text).subtotalAmount, undefined);
    }
  });
});


import { createHash } from 'node:crypto';
import { AI_BUDGET_PROFILE_TABLE_DIGEST_V2, LINE_DOCUMENT_QA_READER_VERSION, createLineAiInputEvidence, lineDocumentQaInputEvidenceText,
  type AiBudgetGrantV2, type LineDocumentQaGatewayRequest } from '@watchdog-bms/contracts';
import { DocumentQaUseCase } from '../../application/document-qa.use-case';
const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const r6QaConfig: any = { lineAiDocumentQaEnabled: true, modelProvider: 'openai', openAiApiKey: 'synthetic', openAiModel: 'gpt-4.1-mini',
  openAiProcessingRegion: 'US', approvedAiProviders: ['openai'], approvedAiModelIds: ['gpt-4.1-mini'], approvedAiRegions: ['US'],
  erpCoreInternalUrl: 'http://api.test/v1', aiGatewayInternalSecret: 'synthetic', aiToolTimeoutMs: 1000 };
const output = () => ({ version: 1, readerVersion: LINE_DOCUMENT_QA_READER_VERSION, answer: 'ยอดรวม1177จากหน้า2',
  answerPageRefs: [{ attachmentId: 'file-1', page: 2 }], pages: [{ attachmentId: 'file-1', page: 2, visibleText: 'TOTAL 1177',
    facts: [{ attachmentId: 'file-1', page: 2, text: '1177', role: 'total', localSpan: { start: 6, end: 10 } }],
    evidence: [{ attachmentId: 'file-1', page: 2, role: 'visible_text', text: 'TOTAL 1177', localSpan: { start: 0, end: 10 } }] }],
  coverage: { requested: [{ attachmentId: 'file-1', page: 2 }], read: [{ attachmentId: 'file-1', page: 2 }], failed: [] } });
async function r6QaRequest(cursor = 1, questions?: Array<{subrequestIndex:number;question:string}>): Promise<LineDocumentQaGatewayRequest & { budgetGrantV2: AiBudgetGrantV2 }> {
  const source = Buffer.from('synthetic-rendered-page');
  const pages = [{ attachmentId: 'file-1', page: 2, mimeType: 'image/png' as const, sourceMimeType: 'application/pdf' as const,
    contentHash: sha('original-pdf'), renderedSha256: sha(source), contentBase64: source.toString('base64') }];
  const question = 'หน้า2ยอดรวมเท่าไร', text = lineDocumentQaInputEvidenceText(question, pages, questions), now = Date.now();
  const evidence = await createLineAiInputEvidence({ turnKey: 'turn-1', parts: [{ partId: 'qa-manifest', eventIdHash: sha('event'), rawText: text, acceptedAtMs: now }] }); assert.ok(evidence);
  return { requestId: 'request', companyId: 'company', userId: 'user', jobId: 'job', jobRevision: 1, turnId: 'turn-1', question, pages, ...(questions ? { questions } : {}),
    messageText: evidence.messageText, inputEvidence: evidence.inputEvidence, inputDigest: evidence.inputEvidence.joinedSha256,
    inputSetHash: sha('set'), questionDigest: sha(question), readerVersion: LINE_DOCUMENT_QA_READER_VERSION,
    contractCapabilities: ['input-evidence-v2', 'budget-envelope-v2'], budgetGrantV2: { version: 2, authorityKind: 'qa_job', authorityId: 'job',
      turnKey: 'turn-1', channelOwnerDigest: sha('owner'), attemptKey: 'attempt', monthKey: '2026-09', payerCompanyId: 'company',
      model: { provider: 'openai', modelId: 'gpt-4.1-mini', region: 'US' }, allowedProfileIds: ['document-qa/2'], profileTableDigest: AI_BUDGET_PROFILE_TABLE_DIGEST_V2,
      maxTurnSlots: 2, maxRepairs: 1, admittedAtMs: now, workDeadlineAtMs: now + 897000, finalDeadlineAtMs: now + 900000,
      nonce: 'nonce', issuerVersion: 'fixture:1', nextOrdinal: cursor, membershipEpoch: 0, signature: sha('synthetic-signature') } };
}
async function r6QaExecute(input: Awaited<ReturnType<typeof r6QaRequest>>, responses: unknown[]) {
  const original = globalThis.fetch, reservations: any[] = [], vendor: any[] = [], settlements: any[] = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body));
    if (String(url).endsWith('/budget-step')) {
      reservations.push(body);
      return new Response(JSON.stringify({ ok: true, envelope: { ...body.invocation, version: 2, reservationId: `reservation-${body.invocation.ordinal}`,
        invocationKey: `company#attempt#provider-v2#${body.invocation.ordinal}`, tariffVersion: 'fixture:1' } }));
    }
    if (String(url).endsWith('/budget-settle')) { settlements.push(body); return new Response(JSON.stringify({ result: 'settled' })); }
    assert.equal(String(url), 'https://api.openai.com/v1/responses'); vendor.push(body);
    const answer = responses[Math.min(vendor.length - 1, responses.length - 1)];
    return new Response(JSON.stringify({ status: 'completed', usage: { input_tokens: 100, output_tokens: 50 },
      output: [{ type: 'message', status: 'completed', content: [{ type: 'output_text', text: typeof answer === 'string' ? answer : JSON.stringify(answer) }] }] }));
  };
  try {
    const result = await runWithUsageContext({ companyId: input.companyId, budget: { status: 'active-v2', grant: input.budgetGrantV2,
      inputDigest: input.inputDigest, sourceRoute: 'line-document-qa', calls: input.budgetGrantV2.nextOrdinal!, repairCount: 0 } },
    () => new DocumentQaUseCase(r6QaConfig).execute(input));
    return { result, reservations, vendor, settlements };
  } finally { globalThis.fetch = original; }
}

it('R6 invalid router and QA outputs preserve repair', async () => {
  const actual = await r6QaExecute(await r6QaRequest(0), ['{bad', output()]);
  assert.equal(actual.result.status, 'ok');
  assert.equal(actual.vendor.length, 2);
  assert.deepEqual(actual.settlements.map(row => [row.usage.ok, row.usage.errorCode]), [[false, 'OUTPUT_UNUSABLE'], [true, undefined]]);
  assert.deepEqual(actual.settlements.map(row => [row.usage.inputTokens, row.usage.outputTokens]), [[100, 50], [100, 50]]);
  const missing = output(); missing.coverage.read = [];
  const rejected = await r6QaExecute(await r6QaRequest(1), [missing]);
  assert.equal(rejected.result.status, 'failed');
  assert.equal(rejected.settlements[0].usage.ok, false);
});

it('R6 public general rejects are absorbed', async () => {
  for (const text of ['', '{"answer":"hello"}', 'x'.repeat(8001), 'สวัสดีค่ะ']) {
    const qa = await r6QaRequest(0), grant = { ...qa.budgetGrantV2, authorityKind: 'webhook_event' as const, allowedProfileIds: ['line-answer/2' as const] };
    const body = { requestId: 'public-r6', webhookEventId: 'event', kind: 'PUBLIC_GENERAL' as const, messageText: qa.messageText,
      inputEvidence: qa.inputEvidence, contractCapabilities: qa.contractCapabilities, budgetGrantV2: grant,
      publicAdmission: { channelKind: 'USER' as const, channelKeyHash: sha('channel'), payerCompanyId: 'company', admissionId: 'admission' } };
    const original = globalThis.fetch, settlements: any[] = [];
    globalThis.fetch = async (url, init) => {
      const payload = JSON.parse(String(init?.body));
      if (String(url).endsWith('/budget-step')) return new Response(JSON.stringify({ ok: true, envelope: { ...payload.invocation, version: 2,
        reservationId: 'reservation', invocationKey: 'company#attempt#provider-v2#0', tariffVersion: 'fixture:1' } }));
      if (String(url).endsWith('/budget-settle')) { settlements.push(payload); return new Response(JSON.stringify({ result: 'settled' })); }
      assert.equal(payload.acceptOutput, undefined);
      return new Response(JSON.stringify({ status: 'completed', usage: { input_tokens: 100, output_tokens: 50 },
        output: [{ type: 'message', status: 'completed', content: [{ type: 'output_text', text }] }] }));
    };
    try {
      await runWithUsageContext({ companyId: 'company', budget: { status: 'active-v2', grant, inputDigest: qa.inputDigest,
        sourceRoute: 'line-public-general', calls: 0, repairCount: 0 } },
        () => new LineAiInternalController(r6QaConfig, {} as any).linePublicGeneral('synthetic', body as any));
      assert.equal(settlements.length, 1);
      assert.equal(settlements[0].usage.ok, text === 'สวัสดีค่ะ');
    } finally { globalThis.fetch = original; }
  }
});

describe('marketplace receipt identity from real-layout synthetic transcription', () => {
  for (const label of ['ผู้ขาย', '## ผู้ขาย', '**ผู้ขาย**', '## **ผู้ขาย**']) {
    for (const nameLabel of ['', '**ชื่อ**\n\n']) it(`reads multiline ${label} with name label ${Boolean(nameLabel)}`, () => {
      const page = `บริษัท แพลตฟอร์มสังเคราะห์ จำกัด\nใบเสร็จรับเงิน\n${label}\n\n${nameLabel}ร้านสินค้าสังเคราะห์ ((+66) 81-234-5678)\nที่อยู่\n9 ถนนสมมติ\nผู้ซื้อ: ลูกค้าสังเคราะห์\nรวม 100.00`;
      const out = applyOcrValueCrossCheck({ vendorName: 'บริษัท แพลตฟอร์มสังเคราะห์ จำกัด' }, page);
      assert.equal(out.vendorName, 'ร้านสินค้าสังเคราะห์');
      assert.ok(!receiptIssuerText(page).includes('บริษัท แพลตฟอร์มสังเคราะห์ จำกัด'));
    });
  }

  for (const layout of ['ผู้ขาย\nชื่อ: ร้านสินค้าสังเคราะห์', 'ผู้ขาย ชื่อ: ร้านสินค้าสังเคราะห์',
    '## **ผู้ขาย**\n**ชื่อ:** ร้านสินค้าสังเคราะห์', 'ผู้ขาย ชื่อ ： ร้านสินค้าสังเคราะห์']) {
    it(`strips the seller name label in ${layout.replace(/\n/g, ' / ')}`, () => {
      const page = `บริษัท แพลตฟอร์มสังเคราะห์ จำกัด\n${layout} ((+66) 81-234-5678)\nที่อยู่\n9 ถนนสมมติ`;
      const result = applyOcrValueCrossCheck({ vendorName: 'บริษัท แพลตฟอร์มสังเคราะห์ จำกัด' }, page);
      assert.equal(result.vendorName, 'ร้านสินค้าสังเคราะห์');
    });
  }

  it('keeps ชื่อ inside an actual seller name when no name-label delimiter is printed', () => {
    const out = applyOcrValueCrossCheck({}, 'ผู้ขาย\nชื่อดีสังเคราะห์ ((+66) 81-234-5678)\nที่อยู่\n9 ถนนสมมติ');
    assert.equal(out.vendorName, 'ชื่อดีสังเคราะห์');
  });

  it('removes a trailing phone while keeping parentheses belonging to the seller name', () => {
    for (const suffix of ['', ' ((+66) 81-234-5678)', ' (081-234-5678)']) {
      const out = applyOcrValueCrossCheck({ vendorName: 'บริษัท แพลตฟอร์มสังเคราะห์ จำกัด' },
        `บริษัท แพลตฟอร์มสังเคราะห์ จำกัด\nผู้ขาย\nชื่อ\nร้านสินค้าสังเคราะห์ (2024)${suffix}\nที่อยู่\n9 ถนนสมมติ`);
      assert.equal(out.vendorName, 'ร้านสินค้าสังเคราะห์ (2024)');
    }
  });

  it('excludes a bare multiline buyer block from the recovered seller evidence', () => {
    const page = 'ผู้ขาย\nชื่อ\nร้านสินค้าสังเคราะห์\nที่อยู่\n9 ถนนสมมติ\n## **ผู้ซื้อ**\nชื่อ\nบริษัท ผู้ซื้อสังเคราะห์ จำกัด\nที่อยู่\n8 ถนนสมมติ';
    const seller = receiptIssuerText(page);
    assert.ok(seller.includes('ร้านสินค้าสังเคราะห์'));
    assert.ok(!seller.includes('บริษัท ผู้ซื้อสังเคราะห์ จำกัด'));
    assert.ok(!seller.includes('8 ถนนสมมติ'));
  });

  it('keeps a normal tax invoice header when its seller caption ends the page', () => {
    for (const caption of ['ผู้ขาย ผู้รับเงิน', 'ลงชื่อ .......... ผู้ขาย', '**ผู้ขาย**\nลงชื่อ ..........']) {
      const page = `บริษัท ผู้ขายสังเคราะห์ จำกัด\nใบกำกับภาษี\nรวม 100.00\n${caption}`;
      assert.equal(applyOcrValueCrossCheck({ vendorName: 'บริษัท ผู้ขายสังเคราะห์ จำกัด' }, page).vendorName,
        'บริษัท ผู้ขายสังเคราะห์ จำกัด');
    }
  });

  it('selects the receipt number over an extracted order number on either side of the page', () => {
    for (const receiptLine of ['หมายเลขใบเสร็จ: RC-1234', '**หมายเลขใบเสร็จ**\nRC-1234', 'เลขที่ใบเสร็จ RC-1234', 'หมายเลขใบเสร็จ: RC - 1234']) {
      for (const lines of [[receiptLine, 'หมายเลขคำสั่งซื้อ: 987-654'], ['หมายเลขคำสั่งซื้อ: 987-654', receiptLine]]) {
        const out = applyOcrValueCrossCheck({ documentNumber: '987-654' }, lines.join('\n'));
        assert.equal(out.documentNumber, 'RC-1234');
      }
    }
  });

  it('requires review when a receipt label exists without one clean receipt value', () => {
    for (const receiptLine of ['หมายเลขใบเสร็จ\n[unreadable]', 'หมายเลขใบเสร็จ: 123O', 'หมายเลขใบเสร็จ: RC-1 RC-2']) {
      const out = applyOcrValueCrossCheck({ documentNumber: '987-654' }, `${receiptLine}\nหมายเลขคำสั่งซื้อ: 987-654`);
      assert.equal(out.documentNumber, undefined);
      assert.ok(out.missingFields?.includes('documentNumber'));
    }
  });

  it('rejects I/O/l at either edge of numeric-looking document numbers while preserving prefixes', () => {
    for (const documentNumber of ['123O', 'O123', '123I', 'I123', '123l', 'l123', '12-O3']) {
      const out = applyOcrValueCrossCheck({ documentNumber }, `หมายเลขใบเสร็จ ${documentNumber}`);
      assert.equal(out.documentNumber, undefined, documentNumber);
      assert.ok(out.missingFields?.includes('documentNumber'));
    }
    for (const documentNumber of ['SO-123', 'ORDER-1O', '12.O']) {
      assert.equal(applyOcrValueCrossCheck({ documentNumber }, `เลขที่ ${documentNumber}`).documentNumber, documentNumber);
    }
  });
});

describe('receipt OCR tall-image reading', () => {
  it('cuts a tall synthetic page into full-width overlapping images in top-to-bottom order', async () => {
    const sharp = (await import('sharp')).default;
    const { prepareReceiptReadImages } = await import('../../domain/logic/document-media.logic');
    const width = 1190, height = 3796;
    const pixels = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) pixels.fill(Math.floor(y * 255 / height), y * width * 3, (y + 1) * width * 3);
    const page = await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
    const tiles = await prepareReceiptReadImages({ mimeType: 'image/png', contentBase64: page.toString('base64') });
    assert.equal(tiles.length, 5);
    const textOnlyBound = providerInputTokenUpperBound({ messages: [{ role: 'user', text: 'read' }] })!;
    assert.equal(providerInputTokenUpperBound({ messages: [{ role: 'user', text: 'read' }], images: tiles }),
      textOnlyBound + tiles.length * AI_BUDGET_IMAGE_TOKEN_CEILING, 'budget admission counts every tile');
    const decoded = await Promise.all(tiles.map(tile => sharp(Buffer.from(tile.contentBase64, 'base64')).raw().toBuffer({ resolveWithObject: true })));
    assert.deepEqual(decoded.map(tile => tile.info.width), [1190, 1190, 1190, 1190, 1190]);
    assert.deepEqual(decoded.map(tile => tile.info.height), [966, 966, 966, 966, 320]);
    for (const [index, tile] of decoded.entries()) {
      assert.ok(Math.max(tile.info.width, tile.info.height) <= 1568);
      assert.ok(tile.info.width * tile.info.height <= 1_150_000);
      if (index === 0) continue;
      const previous = decoded[index - 1]!;
      assert.equal(previous.data[(869 * width + 500) * 3], tile.data[500 * 3], '97 px overlap starts 869 rows into the previous tile');
      assert.ok(previous.data[0]! < tile.data[0]!, 'top-to-bottom order');
    }
  });

  it('scales a 2000-wide tall source to 1568 before making bounded tiles', async () => {
    const sharp = (await import('sharp')).default;
    const { prepareReceiptReadImages } = await import('../../domain/logic/document-media.logic');
    const bytes = await sharp({ create: { width: 2000, height: 6000, channels: 3, background: '#fff' } }).png().toBuffer();
    const original = Buffer.from(bytes);
    const tiles = await prepareReceiptReadImages({ mimeType: 'image/png', contentBase64: bytes.toString('base64') });
    assert.ok(tiles.length > 1);
    for (const tile of tiles) {
      const size = await sharp(Buffer.from(tile.contentBase64, 'base64')).metadata();
      assert.equal(size.width, 1568);
      assert.ok(size.height! <= 1568);
      assert.ok(size.width! * size.height! <= 1_150_000);
    }
    assert.deepEqual(bytes, original);
  });

  it('keeps a normal receipt and the ratio-two boundary as one image', async () => {
    const sharp = (await import('sharp')).default;
    const { prepareReceiptReadImages } = await import('../../domain/logic/document-media.logic');
    for (const height of [800, 2000]) {
      const page = await sharp({ create: { width: 1000, height, channels: 3, background: 'white' } }).png().toBuffer();
      const original = { mimeType: 'image/png' as const, contentBase64: page.toString('base64') };
      assert.deepEqual(await prepareReceiptReadImages(original), [await (await import('../../domain/logic/document-media.logic')).prepareDocumentImage(original)]);
    }
  });

  it('reads tall tiles despite a forwarded overview and extracts from their combined transcription', async () => {
    const sharp = (await import('sharp')).default;
    const page = await sharp({ create: { width: 1190, height: 3796, channels: 3, background: 'white' } }).png().toBuffer();
    const calls: any[] = [];
    const original = BedrockRuntimeClient.prototype.send;
    const text = 'ร้านสินค้าสังเคราะห์\nสินค้าเหนือ 1 40.00\nสินค้าใต้ 1 60.00\nรวม 100.00';
    (BedrockRuntimeClient.prototype as any).send = async (command: any) => {
      calls.push(command.input);
      const imageCount = command.input.messages.at(-1).content.filter((block: any) => block.image).length;
      return { stopReason: 'end_turn', usage: { inputTokens: imageCount ? imageCount * 1000 : 1000, outputTokens: 200 },
        output: { message: { content: [{ text: JSON.stringify(imageCount ? { natural_text: text } : {
          classification: classification(), fields: { vendorName: 'ร้านสินค้าสังเคราะห์', grandTotalAmount: '100.00',
            lines: [{ description: 'สินค้าเหนือ', amount: '40.00', evidenceSignal: 'สินค้าเหนือ' },
              { description: 'สินค้าใต้', amount: '60.00', evidenceSignal: 'สินค้าใต้' }] },
        }) }] } } };
    };
    try {
      const controller = new LineAiInternalController({ aiGatewayInternalSecret: 'secret', modelProvider: 'bedrock',
        bedrockRegion: 'ap-southeast-1', bedrockModelId: 'm', documentAiModelId: 'm' } as any, {} as any);
      const readLogs: any[] = [];
      (controller as any).logger = { log: (entry: unknown) => readLogs.push(entry), warn: () => {} };
      let recorded: any[] = [];
      const result = await runWithUsageContext({ companyId: 'co' }, async () => {
        const result = await controller.receiptOcr('secret', { requestId: 'tall-synthetic', companyId: 'co', userId: 'u',
        documentText: 'ข้อความจากภาพรวมที่ย่อแล้ว ซึ่งต้องอ่านใหม่',
        attachment: { id: 'a', mimeType: 'image/png', purpose: 'receipt', contentBase64: page.toString('base64') } });
        recorded = drainUsage();
        return result;
      });
      assert.equal(recorded.length, 2);
      assert.equal(recorded[0].inputTokens, 5000, 'usage includes the provider tokens for all five tiles');
      assert.equal(recorded[0].tag, 'ocr.receipt.image-read');
      assert.equal(result.status, 'ok');
      assert.equal(calls.length, 2);
      assert.equal(calls[0].messages.at(-1).content.filter((block: any) => block.image).length, 5);
      const tiledLog = readLogs.find(entry => entry.requestId === 'tall-synthetic');
      assert.equal(tiledLog?.tileCount, 5);
      assert.equal(tiledLog?.imageCount, 5);
      assert.equal(tiledLog?.imageBytes, calls[0].messages.at(-1).content
        .filter((block: any) => block.image).reduce((sum: number, block: any) => sum + block.image.source.bytes.byteLength, 0));
      assert.match(calls[0].messages.at(-1).content[0].text, /overlapping|overlap/i);
      assert.match(calls[1].system[0].text, /หมายเลขใบเสร็จ/);
      assert.match(calls[1].system[0].text, /select the receipt number, never the order number/);
      assert.match(calls[1].messages.at(-1).content[0].text, /สินค้าเหนือ/);
      assert.match(calls[1].messages.at(-1).content[0].text, /สินค้าใต้/);
      assert.equal(calls[1].messages.at(-1).content.filter((block: any) => block.image).length, 0);
      calls.length = 0;
      const normal = await sharp({ create: { width: 1190, height: 1500, channels: 3, background: 'white' } }).png().toBuffer();
      await controller.receiptOcr('secret', { requestId: 'normal-synthetic', companyId: 'co', userId: 'u',
        attachment: { id: 'b', mimeType: 'image/png', purpose: 'receipt', contentBase64: normal.toString('base64') } });
      assert.equal(calls[0].messages.at(-1).content.filter((block: any) => block.image).length, 1);
      const normalLog = readLogs.find(entry => entry.requestId === 'normal-synthetic');
      assert.equal(normalLog?.tileCount, 0);
      assert.equal(normalLog?.imageCount, 1);
      assert.equal(normalLog?.imageBytes, calls[0].messages.at(-1).content.find((block: any) => block.image).image.source.bytes.byteLength);
    } finally { BedrockRuntimeClient.prototype.send = original; }
  });
});


describe('receipt header recovery from the same synthetic transcription', () => {
  const PAGE = 'ใบเสร็จรับเงิน\nร้านสินค้าสังเคราะห์\nสินค้าก 1 120.00\nสินค้าข 1 112.00\nยอดรวมสินค้า 232.00\nคูปองส่วนลด -82.80\nการจัดส่ง 48.00\nจ่ายแล้ว รวม 197.20';
  const first = { vendorName: 'ร้านสินค้าสังเคราะห์', subtotalAmount: '232.00', grandTotalAmount: '197.20', vatMode: 'NO_VAT' as const,
    missingFields: ['discountAmount', 'additionalCharges'], lines: [
      { description: 'สินค้าก', quantity: '1', amount: '120.00', evidenceSignal: 'สินค้าก 1 120.00' },
      { description: 'สินค้าข', quantity: '1', amount: '112.00', evidenceSignal: 'สินค้าข 1 112.00' }] };
  const recovered = { ...first, missingFields: [], discountAmount: '82.80',
    additionalCharges: [{ kind: 'DELIVERY', description: 'การจัดส่ง', amount: '48.00', evidenceSignal: 'การจัดส่ง 48.00' }] };
  const classification = (requiresClarification = false) => ({ contentKind: 'DOCUMENT', documentFamily: 'EXPENSE_EVIDENCE',
    documentKind: 'RECEIPT', businessDirection: 'PURCHASE_EXPENSE', transactionState: 'PAID', confidence: 0.95,
    evidenceRoles: ['EXPENSE_SUPPORT'], evidenceSignals: ['ใบเสร็จรับเงิน'], amountSignals: ['197.20'],
    settlementSignals: ['จ่ายแล้ว'], missingRequiredSignals: [], contradictionSignals: [], requiresClarification });

  for (const retry of ['closed', 'open', 'rows-only'] as const) it(`uses one text recovery and ${retry === 'closed' ? 'keeps the closed header and rows' : retry === 'open' ? 'retains review when the retry is still open' : 'rejects closed rows with an open header'}`, async () => {
    const closes = retry === 'closed';
    const original = BedrockRuntimeClient.prototype.send;
    const calls: any[] = [];
    (BedrockRuntimeClient.prototype as any).send = async (command: any) => {
      calls.push(command.input);
      return { stopReason: 'end_turn', usage: { inputTokens: 100, outputTokens: 100 },
        output: { message: { content: [{ text: JSON.stringify({ fields: calls.length === 1 || retry === 'open' ? first
          : retry === 'rows-only' ? { ...recovered, subtotalAmount: '240.00' } : recovered,
          classification: classification(calls.length === 1 || retry === 'open') }) }] } } };
    };
    try {
      const controller = new LineAiInternalController({ aiGatewayInternalSecret: 'secret', modelProvider: 'bedrock',
        bedrockRegion: 'ap-southeast-1', bedrockModelId: 'm', documentAiModelId: 'm' } as any, {} as any);
      const result = await runWithUsageContext({ companyId: 'co' }, async () => {
        const result = await controller.receiptOcr('secret', { requestId: 'synthetic-header', companyId: 'co', userId: 'u',
          documentText: PAGE, attachment: { id: 'a', mimeType: 'image/jpeg', purpose: 'receipt', contentBase64: 'ZmFrZQ==' } });
        assert.equal(drainUsage().length, 2, 'both extractions are accounted for');
        return result;
      });
      assert.equal(calls.length, 2, 'one extraction plus one recovery');
      assert.ok(calls.every(call => call.messages.at(-1).content.every((block: any) => !block.image)));
      assert.match(calls[1].messages.at(-1).content[0].text, /34\.80/);
      assert.match(calls[1].messages.at(-1).content[0].text, /discount|coupon|shipping/i);
      assert.match(calls[1].messages.at(-1).content[0].text, /คูปองส่วนลด -82\.80/);
      assert.equal(result.status, 'ok');
      assert.equal(receiptItemsMismatch(result.fields), !closes);
      assert.equal(result.fields?.discountAmount, closes ? '82.80' : undefined);
      assert.equal(result.fields?.additionalCharges?.[0]?.amount, closes ? '48.00' : undefined);
      assert.equal(result.fields?.lines?.length, 2);
    } finally { BedrockRuntimeClient.prototype.send = original; }
  });

  it('keeps the header tolerance and counts additional VAT once', () => {
    const page = 'ส่วนลด / การจัดส่ง';
    for (const [grandTotalAmount, expected] of [['231.95', false], ['231.94', true]] as const) {
      assert.equal(shouldRereadReceiptImage({ ok: true, fields: { ...first, grandTotalAmount },
        classification: classification(true) as any }, page), expected);
    }
    assert.equal(shouldRereadReceiptImage({ ok: true, fields: { ...first, subtotalAmount: '100.00',
      grandTotalAmount: '107.00', vatMode: 'VAT_EXCLUDED', vatAmount: '7.00' },
      classification: classification(true) as any }, page), false);
  });

  it('leaves a header gap without adjustment evidence on the existing review path', () => {
    assert.equal(shouldRereadReceiptImage({ ok: true, fields: first as any, classification: classification(true) as any },
      'ใบเสร็จรับเงิน\nยอดรวมสินค้า 232.00\nรวม 197.20'), false);
  });
});

import { PATH_METADATA, METHOD_METADATA, INTERCEPTORS_METADATA } from '@nestjs/common/constants';
import { validate } from 'class-validator';
import { LineWorkflowClassifyDto } from './line-ai-internal.dtos';
import { WorkflowClassifierAgent } from '../../agents/workflow-classifier.agent';

async function b3ClassifyBody(): Promise<LineWorkflowClassifyDto> {
  const qa = await r6QaRequest(0);
  const text = 'ส่งใบเบิกของฉันให้อนุมัติหน่อย';
  const built = await createLineAiInputEvidence({ turnKey: qa.turnId, parts: [{ partId: 'part-0', eventIdHash: 'a'.repeat(64), acceptedAtMs: Date.now(), rawText: text }] });
  assert.ok(built);
  return Object.assign(new LineWorkflowClassifyDto(), {
    requestId: 'classifier-controller', companyId: qa.companyId, userId: qa.userId, locale: 'th-TH',
    messageText: text, inputEvidence: built.inputEvidence,
    budgetGrantV2: { ...qa.budgetGrantV2, authorityKind: 'webhook_classify', allowedProfileIds: ['line-classify/2'],
      model: { provider: 'bedrock', modelId: 'test-model', region: 'ap-southeast-1' } },
    contractCapabilities: ['input-evidence-v2', 'budget-envelope-v2'],
  });
}

function b3Intercept(controller: LineAiInternalController, body: LineWorkflowClassifyDto) {
  const context = { switchToHttp: () => ({ getRequest: () => ({ body, url: '/v1/internal/ai/line-workflow-classify' }) }) } as unknown as ExecutionContext;
  return firstValueFrom(new AiUsageInterceptor().intercept(context, {
    handle: () => defer(() => controller.lineWorkflowClassify('secret', body)),
  } as CallHandler)) as Promise<any>;
}

describe('B3 workflow classify endpoint', () => {
  const controller = () => new LineAiInternalController({ aiGatewayInternalSecret: 'secret', modelProvider: 'disabled', aiToolTimeoutMs: 4000 } as any, {} as any);

  it('publishes the POST route under the usage interceptor and validates a concrete DTO', async () => {
    const handler = LineAiInternalController.prototype.lineWorkflowClassify;
    assert.equal(Reflect.getMetadata(PATH_METADATA, LineAiInternalController), 'internal/ai');
    assert.equal(Reflect.getMetadata(PATH_METADATA, handler), 'line-workflow-classify');
    assert.equal(Reflect.getMetadata(METHOD_METADATA, handler), RequestMethod.POST);
    assert.ok(Reflect.getMetadata(INTERCEPTORS_METADATA, LineAiInternalController).includes(AiUsageInterceptor));
    const body = await b3ClassifyBody();
    assert.deepEqual(await validate(body), []);
    assert.ok((await validate(Object.assign(new LineWorkflowClassifyDto(), body, { messageText: 'ก'.repeat(1001) }))).length);
    assert.ok((await validate(Object.assign(new LineWorkflowClassifyDto(), body, { locale: 'unknown' }))).length);
    assert.ok((await validate(Object.assign(new LineWorkflowClassifyDto(), body, { contractCapabilities: ['input-evidence-v2', 'input-evidence-v2'] }))).length);
  });

  it('refuses another authority kind or profile, mismatched evidence, or absent budget context before calling the agent', async () => {
    const original = WorkflowClassifierAgent.prototype.classify;
    let calls = 0;
    WorkflowClassifierAgent.prototype.classify = async () => { calls += 1; return { status: 'UNAVAILABLE', errorCode: 'PROVIDER_UNKNOWN', usage: [] }; };
    try {
      const valid = await b3ClassifyBody();
      await assert.rejects(() => controller().lineWorkflowClassify('wrong', valid), UnauthorizedException);
      assert.equal((await controller().lineWorkflowClassify('secret', valid)).status, 'UNAVAILABLE');
      for (const change of [
        { budgetGrantV2: { ...valid.budgetGrantV2, authorityKind: 'webhook_event' } },
        { budgetGrantV2: { ...valid.budgetGrantV2, allowedProfileIds: ['line-intake-text/2'] } },
        { budgetGrantV2: { ...valid.budgetGrantV2, allowedProfileIds: ['line-classify/2', 'line-answer/2'] } },
        { messageText: valid.messageText + ' forged' },
        { companyId: 'other-company' },
      ]) {
        const result = await b3Intercept(controller(), Object.assign(new LineWorkflowClassifyDto(), valid, change));
        assert.equal(result.status, 'UNAVAILABLE');
        assert.equal(result.errorCode, 'AI_CONTRACT_UNSUPPORTED');
      }
      assert.equal(calls, 0);
    } finally { WorkflowClassifierAgent.prototype.classify = original; }
  });

  it('runs a valid request through the interceptor with the pinned classifier authority', async () => {
    const original = WorkflowClassifierAgent.prototype.classify;
    const body = await b3ClassifyBody();
    let seen: unknown;
    WorkflowClassifierAgent.prototype.classify = async request => {
      seen = request;
      appendUsage({ tag: 'line.workflow-classify', modelId: 'test-model', ok: false, inputTokens: 1, outputTokens: 0,
        cacheReadInputTokens: 0, cacheWriteInputTokens: 0, durationMs: 1, errorCode: 'PROVIDER_TIMEOUT' });
      return { status: 'UNAVAILABLE', errorCode: 'PROVIDER_TIMEOUT', usage: [] };
    };
    try {
      const response = await b3Intercept(controller(), body);
      assert.equal(response.status, 'UNAVAILABLE');
      assert.equal(response.usage.length, 1);
      assert.equal(response.usage[0].ok, false);
      assert.equal((seen as LineWorkflowClassifyDto).budgetGrantV2.authorityKind, 'webhook_classify');
    } finally { WorkflowClassifierAgent.prototype.classify = original; }
  });
});

it('B3 serves structured output through Bedrock and settles rejected classifier output before returning', async () => {
  const originalSend = BedrockRuntimeClient.prototype.send, originalFetch = globalThis.fetch;
  let sent: any;
  const settlements: any[] = [];
  const answer = { label: 'reimbursement_submit', second_label: 'reimbursement_submit', confidence: 0.99, second_confidence: 0.9,
    reference: 'this', ordinal: 0, person_name: '', vendor_name: '', description_text: '', amount_text: '', date_text: '', reason_text: '', category_text: '' };
  (BedrockRuntimeClient.prototype as any).send = async (command: any) => {
    sent = command.input;
    return { stopReason: 'end_turn', output: { message: { content: [{ text: JSON.stringify(answer) }] } },
      usage: { inputTokens: 100, outputTokens: 70, cacheReadInputTokens: 2000, cacheWriteInputTokens: 0 } };
  };
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body));
    if (String(url).endsWith('/budget-step')) {
      const invocation = body.invocation;
      assert.equal(invocation.profileId, 'line-classify/2');
      assert.equal(body.repair, false);
      return new Response(JSON.stringify({ ok: true, envelope: { ...invocation, version: 2, reservationId: 'classify-reservation',
        invocationKey: `${invocation.grant.payerCompanyId}#${invocation.grant.attemptKey}#provider-v2#${invocation.ordinal}`, tariffVersion: 'test:1' } }));
    }
    assert.ok(String(url).endsWith('/budget-settle'));
    settlements.push(body.usage);
    return new Response(JSON.stringify({ result: 'settled' }));
  };
  const controller = new LineAiInternalController({ aiGatewayInternalSecret: 'secret', modelProvider: 'bedrock',
    bedrockRegion: 'ap-southeast-1', bedrockModelId: 'test-model', aiToolTimeoutMs: 4000, erpCoreInternalUrl: 'http://api.test/v1' } as any, {} as any);
  try {
    const response = await b3Intercept(controller, await b3ClassifyBody());
    assert.equal(response.status, 'CLASSIFIED');
    assert.equal(response.schemaEnforcement, 'output_config');
    assert.equal(response.secondLabel, 'none');
    assert.equal(response.rawDecision.second_label, 'reimbursement_submit');
    assert.equal(response.usage.length, 1, 'the interceptor does not duplicate usage already returned by the agent');
    assert.equal(settlements[0].ok, true);
    assert.equal(sent.outputConfig.textFormat.type, 'json_schema');
    assert.equal(sent.inferenceConfig.maxTokens, 256);
    assert.ok(sent.system.some((block: any) => block.cachePoint));
    assert.equal(sent.additionalModelRequestFields, undefined, 'Sonnet thinking stays at its disabled default');
    answer.confidence = 1.1;
    const rejected = await b3Intercept(controller, await b3ClassifyBody());
    assert.equal(rejected.status, 'UNAVAILABLE');
    assert.equal(rejected.usage[0].ok, false);
    assert.equal(settlements[1].ok, false, 'invalid confidence is refused before billing settlement');
  } finally { BedrockRuntimeClient.prototype.send = originalSend; globalThis.fetch = originalFetch; }
});
