import { Injectable } from '@nestjs/common';
import type { AiDraftGenerationRequest, AiDraftGenerationResult, AiRiskLevel } from '@watchdog-bms/contracts';
import type { IModelProvider } from '../line-ai/infrastructure/provider/provider.port';
import { extractJson } from '../../common/ai/extract-json';

// Authors an AI draft/suggestion from the grounded evidence the API supplies. The AI
// Gateway is the model boundary (no DB access): it only sees the bounded evidence in the
// request, calls the model, and returns validated structured output. The API keeps the
// source ids/citations and validates again before persistence.

const ALLOWED_RISK = new Set<AiRiskLevel>(['LOW', 'MEDIUM', 'HIGH']);

const SYSTEM_PROMPT = [
  'You are น้องมั่งมี (Nong Mangmee), a careful female Thai SME back-office AI assistant.',
  'When writing Thai, refer to yourself as น้องมั่งมี and use polite feminine particles (ค่ะ/คะ) as fits the context.',
  'You write a short business SUGGESTION grounded ONLY on the FACTS provided.',
  'Never invent numbers, record ids, customers, or facts that are not in FACTS/CITATIONS.',
  'You may recommend a draft action but you never approve, post, pay, issue, file, or finalize anything.',
  'Reply with ONLY a JSON object, no prose, no markdown fences, with keys:',
  '{"title":string,"summary":string,"recommendation":string,"riskLevel":"LOW"|"MEDIUM"|"HIGH","confidence":number(0..1),"actionTitle":string,"checklistItems":string[]}',
  'Write title/summary/recommendation in the requested language. Keep them concise and specific to the facts.',
].join('\n');

@Injectable()
export class GenerateDraftUseCase {
  async execute(provider: IModelProvider, req: AiDraftGenerationRequest): Promise<AiDraftGenerationResult> {
    const userPayload = {
      language: req.language,
      template: req.templateKey,
      agent: req.agent,
      domain: req.domain,
      defaultTitle: req.defaultTitle,
      wantsChecklist: req.wantsChecklist,
      FACTS: req.facts,
      CITATIONS: req.citations,
    };

    const out = await provider.generateText({
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: 'user', text: JSON.stringify(userPayload) }],
      maxTokens: 900,
      usageTag: 'ai.draft',
    });
    if (!out.ok) {
      return { ok: false, error: { code: out.error.code, message: out.error.message, retryable: out.error.retryable } };
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(extractJson(out.text)) as Record<string, unknown>;
    } catch {
      return { ok: false, error: { code: 'MODEL_OUTPUT_INVALID', message: 'Model did not return valid JSON', retryable: false } };
    }

    const summary = typeof parsed['summary'] === 'string' ? (parsed['summary'] as string) : '';
    const recommendation = typeof parsed['recommendation'] === 'string' ? (parsed['recommendation'] as string) : '';
    if (!summary && !recommendation) {
      return { ok: false, error: { code: 'MODEL_OUTPUT_INVALID', message: 'Model output missing summary/recommendation', retryable: false } };
    }
    const rawRisk = parsed['riskLevel'];
    const riskLevel = typeof rawRisk === 'string' && ALLOWED_RISK.has(rawRisk as AiRiskLevel) ? (rawRisk as AiRiskLevel) : undefined;
    const rawConfidence = parsed['confidence'];
    const confidence = typeof rawConfidence === 'number' ? Math.max(0, Math.min(1, rawConfidence)) : undefined;
    const checklistItems = Array.isArray(parsed['checklistItems'])
      ? (parsed['checklistItems'] as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 20)
      : undefined;

    return {
      ok: true,
      provider: 'bedrock',
      title: typeof parsed['title'] === 'string' ? (parsed['title'] as string) : req.defaultTitle,
      summary: summary || recommendation,
      recommendation,
      riskLevel,
      confidence,
      actionTitle: typeof parsed['actionTitle'] === 'string' ? (parsed['actionTitle'] as string) : undefined,
      checklistItems,
    };
  }
}
