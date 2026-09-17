import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { defer, firstValueFrom } from 'rxjs';
import { AI_BUDGET_STEP_BOUNDS, aiBudgetInvocationKey } from '@watchdog-bms/contracts';
import { AiUsageInterceptor } from '../../../../common/usage/ai-usage.interceptor';
import { BASE64_MEDIA_ROUTES, LineAiInternalController, parseReceiptOcrJson, receiptRereadImage, receiptItemsMismatch } from './line-ai-internal.controller';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import type { BusinessDocumentClassification, LineAiTurnRequest } from '@watchdog-bms/contracts';
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

    assert.equal(result.status, 'not_configured');
    assert.equal(result.errorCode, 'PDF_PROVIDER_UNSUPPORTED');
  });

  it('receipt OCR keeps PDFs on the Bedrock document channel', async () => {
    const originalFetch = globalThis.fetch;
    let thirdPartyOcrCalled = false;
    globalThis.fetch = (async (url: any, init: any) => {
      if (String(url).includes('api.opentyphoon.ai')) thirdPartyOcrCalled = true;
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
      assert.equal(result.status, 'not_configured');
      assert.equal(result.errorCode, 'PDF_PROVIDER_UNSUPPORTED');
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
        return {
          ok: true,
          status: 200,
          json: async () => ({
            output_text: '{"natural_text":"# ใบเสร็จ ร้านกาแฟ\\nยอดก่อนค่าบริการ 55.00\\nService charge 10.00\\nหัก ณ ที่จ่าย 1.50\\nยอดรวม 65.00 บาท"}',
          }),
        };
      }
      // Stage 2: OpenAI provider (Responses API) maps OCR markdown -> draft fields.
      const extractionBody = JSON.parse(init.body);
      extractionInput = JSON.stringify(extractionBody.input);
      extractionInstructions = String(extractionBody.instructions ?? '');
      return {
        ok: true,
        status: 200,
        json: async () => ({
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
        }),
      };
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
  it('receipt OCR returns one entry per printed item row and drops the block when a row amount is unprinted', async () => {
    const originalFetch = globalThis.fetch;
    const runOcr = async (rows: unknown[]) => {
      globalThis.fetch = (async (url: any, init: any) => {
        if (JSON.parse(init.body as string).input?.some?.((item: any) => JSON.stringify(item).includes('input_image'))) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              output_text: '{"natural_text":"ใบเสร็จ ร้านอาหาร\\nพิซซ่า 1 524.00\\nปีกไก่ 2 298.00\\nรวม 822.00 PAID"}',
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            output_text: JSON.stringify({
              classification: {
                contentKind: 'DOCUMENT', documentFamily: 'EXPENSE_EVIDENCE', documentKind: 'RECEIPT',
                businessDirection: 'PURCHASE_EXPENSE', transactionState: 'PAID', evidenceRoles: ['EXPENSE_SUPPORT'],
                confidence: 0.95, evidenceSignals: ['ร้านอาหาร'], amountSignals: ['822.00'],
                settlementSignals: ['ใบเสร็จ'], missingRequiredSignals: [], contradictionSignals: [], requiresClarification: false,
              },
              fields: { grandTotalAmount: '822.00', vatMode: 'NO_VAT', lines: rows },
            }),
          }),
        };
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
      assert.equal(invented.fields?.lines, undefined, '299.00 appears nowhere in the OCR text');
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
          return {
            ok: true,
            status: 200,
            json: async () => ({ output_text: '{"natural_text":"ใบเสร็จ ร้านกาแฟ\\nTOTAL 65.00 PAID"}', }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
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
          }),
        };
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
          return { ok: true, status: 200, json: async () => ({ output_text: `{"natural_text":"${ocrText}"}`, }) };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
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
          }),
        };
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
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '{"natural_text":"# ใบเสร็จ"}' } }] }),
    })) as any;
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
    globalThis.fetch = (async () => ({ ok: false, status: 429, json: async () => ({}) })) as any;
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
        return {
          ok: true,
          status: 200,
          json: async () => ({
            output_text: '{"natural_text":"| วันที่ | รายการ | ถอน | ฝาก | คงเหลือ |\\n| 01/07/69 | รับโอน | | 1,500.00 | 11,500.00 |"}',
          }),
        };
      }
      extractionInput = JSON.stringify(JSON.parse(init.body).input);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          output_text: '{"rows":[{"postedDate":"2026-07-01","description":"รับโอน","credit":"1500.00","balance":"11500.00","confidence":0.93},{"description":"   "},{"bogus":123}]}',
        }),
      };
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
    const twoIds = 'ผู้ขาย บจก. ทดสอบ เลขประจำตัวผู้เสียภาษี 0105561000105\nผู้ซื้อ เลขประจำตัวผู้เสียภาษี 0994000163011\nรวม 100.00';
    const out = applyOcrValueCrossCheck({}, twoIds);
    assert.equal(out.vendorTaxId, '0105561000105');
    const kept = applyOcrValueCrossCheck({ vendorTaxId: '0105561000105' }, twoIds);
    assert.equal(kept.vendorTaxId, '0105561000105', 'a model selection that the text contains survives');
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
      const out = applyOcrValueCrossCheck({ documentNumber }, HOSPITAL_TEXT);
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
    const invented = applyOcrValueCrossCheck({ vendorBranchCode: '00007' }, HOSPITAL_TEXT);
    assert.equal(invented.vendorBranchCode, undefined, 'a branch the text never shows is dropped');
    assert.ok(invented.missingFields?.includes('vendorBranchCode'));
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

describe('receipt OCR image re-read for missing critical printed money', () => {
  // Typhoon reads a warped photo and loses the printed total line; stage 2 can only report an
  // ambiguous number, which the API's expense gate refuses. The receipt's real total is 180.00.
  const TYPHOON_TEXT_WITHOUT_TOTAL = '# Starbucks Coffee\n| Sub Total | 160.00 |\n| Total Discount | -15.00 |';
  const BEDROCK_REREAD_TEXT = '# Starbucks Coffee\nSub Total 195.00\nTotal Discount -15.00\nTotal Amount 180.00\nPayment 180.00';

  const classification = (total: string, requiresClarification: boolean, contentKind = 'DOCUMENT') => ({
    contentKind, documentFamily: 'EXPENSE_EVIDENCE', documentKind: 'TAX_INVOICE',
    businessDirection: 'PURCHASE_EXPENSE', transactionState: 'PAID', evidenceRoles: ['EXPENSE_SUPPORT'],
    confidence: 0.9, evidenceSignals: ['Starbucks Coffee'], amountSignals: [total],
    settlementSignals: ['Payment'],
    missingRequiredSignals: requiresClarification ? ['MISSING_TRANSACTION_TOTAL'] : [],
    contradictionSignals: [], requiresClarification,
  });

  function stubTyphoon(documentText = TYPHOON_TEXT_WITHOUT_TOTAL) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: any, init: any) => {
      const requested = String(url);
      if (requested.includes('api.opentyphoon.ai')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ choices: [{ message: { content: JSON.stringify({ natural_text: documentText }) } }] }),
        };
      }
      // OpenAI stage 2 over whatever text it was given.
      const input = JSON.stringify(JSON.parse(init.body).input);
      const total = input.includes('180.00') ? '180.00' : '160.00';
      return {
        ok: true,
        status: 200,
        json: async () => ({
          output_text: JSON.stringify({
            classification: classification(total, total === '160.00'),
            fields: { vendorName: 'Starbucks Coffee', grandTotalAmount: total },
          }),
        }),
      };
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
  } = {}) {
    const firstReadText = options.firstReadText ?? TYPHOON_TEXT_WITHOUT_TOTAL;
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
      if (isRead) {
        readCount += 1;
        const text = readCount === 1 ? firstReadText : rereadText;
        return { output: { message: { content: [{ text: JSON.stringify({ natural_text: text }) }] } } };
      }
      const rereadMarker = options.rereadVatAmount ?? 'Total Amount 180.00';
      const sawRereadText = JSON.stringify(content).includes(rereadMarker);
      const total = sawRereadText ? secondTotal : firstTotal;
      const fields = {
        vendorName: 'Starbucks Coffee',
        grandTotalAmount: total,
        ...(options.rereadVatAmount ? {
          vatMode: 'VAT_INCLUDED', vatRate: '0.07',
          ...(sawRereadText ? { vatAmount: options.rereadVatAmount } : { missingFields: ['vatAmount'] }),
        } : {}),
      };
      return {
        output: {
          message: {
            content: [{
              text: JSON.stringify({
                classification: classification(total, sawRereadText ? false : (options.firstRequiresClarification ?? true), options.contentKind),
                fields,
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

  it('recovers the printed total from one Bedrock vision re-read', async () => {
    const restoreFetch = stubTyphoon();
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
      assert.equal(result.fields?.grandTotalAmount, '180.00');
      assert.equal(result.classification?.requiresClarification, false);
      assert.deepEqual(bedrock.calls, ['read', 'extract', 'read', 'extract'], 'one vision read, then exactly one re-read');
    } finally {
      bedrock.restore();
      restoreFetch();
    }
  });

  it('recovers one printed VAT amount only when the re-read confirms the same total', async () => {
    const firstText = '# Royal Pizza\nTotal 2890.00\nVAT 7% (รวม)\nPayment 2890.00';
    const rereadText = '# Royal Pizza\nTotal 2890.00\nVAT 7% (รวม) 189.07\nPayment 2890.00';
    const restoreFetch = stubTyphoon();
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
      assert.equal(result.fields?.vatAmount, '189.07');
      assert.ok(!result.fields?.missingFields?.includes('vatAmount'));
      assert.deepEqual(bedrock.calls, ['read', 'extract', 'read', 'extract'], 'one bounded re-read after the stage-1 read');
    } finally {
      bedrock.restore();
      restoreFetch();
    }
  });

  it('never returns single-expense fields or vision-rereads a multi-entry ledger', async () => {
    const restoreFetch = stubTyphoon();
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

  it('keeps the first reading when the provider has no vision re-read', async () => {
    const restoreFetch = stubTyphoon();
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
 * bill scraped through at 15,003ms). These cases pin BOTH directions of the fix.
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
    (BedrockRuntimeClient.prototype as any).send = (_command: any, options: any) =>
      new Promise((_resolve, reject) => {
        options.abortSignal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    return () => { (BedrockRuntimeClient.prototype as any).send = original; };
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

      t.mock.timers.tick(15_100);
      await settle();
      assert.equal(settled, false, 'the old 15s chat budget must no longer abort a photo intake');

      t.mock.timers.tick(30_000);
      await settle();
      const plan = await pending;
      assert.equal(plan.status, 'UNAVAILABLE', 'the document budget still bounds it — it does not hang forever');
    } finally {
      restore();
      t.mock.timers.reset();
    }
  });

  it('a text-only intake keeps the chat budget, so ordinary chat latency is untouched', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const restore = hangUntilAborted();
    try {
      const controller = new LineAiInternalController(bedrockConfig, { execute: async () => { throw new Error('no turn'); } } as any);
      let settled = false;
      const pending = controller.lineIntakeRoute('secret', { ...baseBody, messageText: 'ยอดขายวันนี้' } as any)
        .then((plan) => { settled = true; return plan; });

      t.mock.timers.tick(14_900);
      await settle();
      assert.equal(settled, false);

      t.mock.timers.tick(200);
      await settle();
      const plan = await pending;
      assert.equal(plan.status, 'UNAVAILABLE', 'text intake still aborts at the 15s chat budget');
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
      if (isRead) return { output: { message: { content: [{ text: JSON.stringify({ natural_text: PAGE }) }] } } };
      return { output: { message: { content: [{ text: JSON.stringify({
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
    (BedrockRuntimeClient.prototype as any).send = async () => ({ output: { message: { content: [{ text: JSON.stringify({
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
        return {
          ok: true,
          status: 200,
          json: async () => (step.ok
            ? {
              ok: true,
              envelope: {
                ...envelope,
                invocationKey: aiBudgetInvocationKey(body.companyId, body.attemptKey, body.stepKind, body.ordinal),
              },
            }
            : { ok: false, code: step.code, budgetScope: step.budgetScope }),
        };
      }
      if (requested.endsWith('/internal/ai/budget-settle')) {
        seen.push(`settle:${body.invocationKey}:${body.sourceRoute}:${body.usage.tag}`);
        return { ok: true, status: 200, json: async () => ({ result: 'settled' }) };
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
