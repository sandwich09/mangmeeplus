import type { CrmBroadcastGenerateRequest, CrmBroadcastGenerateResult } from '@watchdog-bms/contracts';
import type { IModelProvider } from '../../line-ai/infrastructure/provider/provider.port';
import { extractJson } from '../../../common/ai/extract-json';

const SYSTEM = `You create Thai LINE OA campaign copy for a business. Return JSON only: {"candidates":[{"headline":"...","body":"..."}]} with exactly 3 distinct candidates. Never invent prices, claims, dates, or guarantees. Use only supplied facts. Each headline <= 80 chars and body <= 1000 chars. A human reviews before sending.`;

export class CrmBroadcastAgent {
  async run(provider: IModelProvider, request: CrmBroadcastGenerateRequest): Promise<CrmBroadcastGenerateResult> {
    const out = await provider.generateText({ systemPrompt: SYSTEM, messages: [{ role: 'user', text: JSON.stringify({ topic: request.topic, price: request.price, keyPoint: request.keyPoint, tone: request.tone, locale: request.locale ?? 'th-TH' }) }], maxTokens: 1200, usageTag: 'crm.broadcast' });
    if (!out.ok) return { status: 'unavailable', requestId: request.requestId, error: out.error.message };
    try {
      const raw = JSON.parse(extractJson(out.text)) as { candidates?: Array<{ headline?: unknown; body?: unknown }> };
      const candidates = (raw.candidates ?? []).filter((item) => typeof item.headline === 'string' && typeof item.body === 'string').slice(0, 3).map((item, index) => ({ id: `candidate-${index + 1}`, headline: String(item.headline).trim().slice(0, 80), body: String(item.body).trim().slice(0, 1000) })).filter((item) => item.headline && item.body);
      return candidates.length === 3 ? { status: 'ok', requestId: request.requestId, candidates } : { status: 'uncertain', requestId: request.requestId };
    } catch { return { status: 'uncertain', requestId: request.requestId }; }
  }
}
