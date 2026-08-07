/**
 * CrmInsightsAgent — advisory intent/sentiment/risk/lead-score extraction (spec §25/§27).
 * Boundary (hard): ALLOWED_TOOLS is empty, no LINE_TOOL_REGISTRY / ERP tool client, no DB.
 */
import type {
  CrmAiCustomerRisk,
  CrmAiSentiment,
  CrmAiTurnClass,
  CrmInsightsRequest,
  CrmInsightsResult,
} from '@watchdog-bms/contracts';
import { CRM_AI_CUSTOMER_RISKS, CRM_AI_MAX_WINDOW, CRM_AI_SENTIMENTS, CRM_AI_TURN_CLASSES } from '@watchdog-bms/contracts';
import type { IModelProvider } from '../../line-ai/infrastructure/provider/provider.port';
import { extractJson } from '../../../common/ai/extract-json';
import { CRM_INSIGHTS_SYSTEM_PROMPT } from './crm-prompts';

export const ALLOWED_TOOLS = new Set<string>([]);

const MAX_NEXT_ACTION_CHARS = 300;

export class CrmInsightsAgent {
  async run(provider: IModelProvider, req: CrmInsightsRequest): Promise<CrmInsightsResult> {
    const window = (req.window ?? [])
      .slice(-CRM_AI_MAX_WINDOW)
      .map((m) => ({ role: m.role, text: m.text, at: m.at }));

    const out = await provider.generateText({
      systemPrompt: CRM_INSIGHTS_SYSTEM_PROMPT,
      messages: [{ role: 'user', text: JSON.stringify({ consent: req.consent, window }) }],
      maxTokens: 600,
      usageTag: 'crm.insights',
    });
    if (!out.ok) return { status: 'unavailable', requestId: req.requestId, error: out.error };

    const parsed = parseInsights(out.text);
    return parsed ? { status: 'ok', requestId: req.requestId, ...parsed } : { status: 'uncertain', requestId: req.requestId };
  }
}

function parseInsights(text: string): Omit<Extract<CrmInsightsResult, { status: 'ok' }>, 'status' | 'requestId'> | null {
  try {
    const raw = JSON.parse(extractJson(text)) as Record<string, unknown>;
    const intent = raw['intent'];
    const sentiment = raw['sentiment'];
    const risk = raw['risk'];
    const rawLeadScore = raw['leadScore'];
    const nextBestAction = typeof raw['nextBestAction'] === 'string' ? safeSlice(raw['nextBestAction'].trim(), MAX_NEXT_ACTION_CHARS) : '';
    if (typeof intent !== 'string' || !CRM_AI_TURN_CLASSES.includes(intent as CrmAiTurnClass)) return null;
    if (typeof sentiment !== 'string' || !CRM_AI_SENTIMENTS.includes(sentiment as CrmAiSentiment)) return null;
    if (typeof risk !== 'string' || !CRM_AI_CUSTOMER_RISKS.includes(risk as CrmAiCustomerRisk)) return null;
    if (typeof rawLeadScore !== 'number' || !Number.isFinite(rawLeadScore) || !nextBestAction) return null;
    const rawConfidence = raw['confidence'];
    const confidence = typeof rawConfidence === 'number' ? Math.max(0, Math.min(1, rawConfidence)) : 0;
    const leadScore = Math.max(0, Math.min(100, Math.round(rawLeadScore)));
    return {
      intent: intent as CrmAiTurnClass,
      sentiment: sentiment as CrmAiSentiment,
      risk: risk as CrmAiCustomerRisk,
      leadScore,
      nextBestAction,
      confidence,
    };
  } catch {
    return null;
  }
}

function safeSlice(s: string, n: number): string {
  return [...s].slice(0, n).join('');
}
