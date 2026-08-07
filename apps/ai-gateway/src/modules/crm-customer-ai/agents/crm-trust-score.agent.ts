/**
 * CrmTrustScoreAgent — reasons an advisory 0..100 trust score from deterministic API-side
 * signals (spec §25). The score is advisory input to the API's auto-reply gate (>80), never a
 * permission gate; the >80 comparison and every autonomy decision stay deterministic in the API.
 * Boundary (hard): ALLOWED_TOOLS is empty, no LINE_TOOL_REGISTRY / ERP tool client, no DB.
 */
import type { CrmTrustScoreRequest, CrmTrustScoreResult } from '@watchdog-bms/contracts';
import type { IModelProvider } from '../../line-ai/infrastructure/provider/provider.port';
import { CRM_TRUST_SCORE_SYSTEM_PROMPT } from './crm-prompts';
import { extractJson } from '../../../common/ai/extract-json';

export const ALLOWED_TOOLS = new Set<string>([]);

const MAX_REASONING_CHARS = 300;

export class CrmTrustScoreAgent {
  async run(provider: IModelProvider, req: CrmTrustScoreRequest): Promise<CrmTrustScoreResult> {
    const payload = {
      signals: req.signals,
      ...(typeof req.priorScore === 'number' ? { priorScore: req.priorScore } : {}),
    };

    const out = await provider.generateText({
      systemPrompt: CRM_TRUST_SCORE_SYSTEM_PROMPT,
      messages: [{ role: 'user', text: JSON.stringify(payload) }],
      maxTokens: 200,
      usageTag: 'crm.trust',
    });
    if (!out.ok) return { status: 'unavailable', requestId: req.requestId, error: out.error };

    const parsed = parseTrust(out.text);
    if (!parsed) return { status: 'uncertain', requestId: req.requestId };
    return {
      status: 'ok',
      requestId: req.requestId,
      score: parsed.score,
      ...(parsed.reasoning ? { reasoning: parsed.reasoning } : {}),
    };
  }
}

function parseTrust(text: string): { score: number; reasoning?: string } | null {
  try {
    const raw = JSON.parse(extractJson(text)) as Record<string, unknown>;
    const rawScore = raw['score'];
    if (typeof rawScore !== 'number' || !Number.isFinite(rawScore)) return null;
    const score = Math.max(0, Math.min(100, Math.round(rawScore)));
    const reasoning = typeof raw['reasoning'] === 'string' ? raw['reasoning'].trim().slice(0, MAX_REASONING_CHARS) : undefined;
    return { score, reasoning };
  } catch {
    return null;
  }
}
