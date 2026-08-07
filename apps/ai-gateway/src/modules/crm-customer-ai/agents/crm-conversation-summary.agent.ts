/**
 * CrmConversationSummaryAgent — Thai staff-facing conversation summary (spec §25/§27).
 * Boundary (hard): ALLOWED_TOOLS is empty, no LINE_TOOL_REGISTRY / ERP tool client, no DB.
 */
import type { CrmConversationSummaryRequest, CrmConversationSummaryResult } from '@watchdog-bms/contracts';
import { CRM_AI_MAX_WINDOW } from '@watchdog-bms/contracts';
import type { IModelProvider } from '../../line-ai/infrastructure/provider/provider.port';
import { extractJson } from '../../../common/ai/extract-json';
import { CRM_SUMMARY_SYSTEM_PROMPT } from './crm-prompts';

export const ALLOWED_TOOLS = new Set<string>([]);

const MAX_SUMMARY_CHARS = 2000;

export class CrmConversationSummaryAgent {
  async run(provider: IModelProvider, req: CrmConversationSummaryRequest): Promise<CrmConversationSummaryResult> {
    const window = (req.window ?? [])
      .slice(-CRM_AI_MAX_WINDOW)
      .map((m) => ({ role: m.role, text: m.text, at: m.at }));

    const out = await provider.generateText({
      systemPrompt: CRM_SUMMARY_SYSTEM_PROMPT,
      messages: [{ role: 'user', text: JSON.stringify({ window }) }],
      maxTokens: 1600,
      usageTag: 'crm.summary',
    });
    if (!out.ok) return { status: 'unavailable', requestId: req.requestId, error: out.error };

    const parsed = parseSummary(out.text);
    return parsed
      ? { status: 'ok', requestId: req.requestId, summaryText: parsed.summaryText, confidence: parsed.confidence }
      : { status: 'uncertain', requestId: req.requestId };
  }
}

function parseSummary(text: string): { summaryText: string; confidence: number } | null {
  try {
    const raw = JSON.parse(extractJson(text)) as Record<string, unknown>;
    const summaryText = typeof raw['summaryText'] === 'string' ? safeSlice(raw['summaryText'].trim(), MAX_SUMMARY_CHARS) : '';
    if (!summaryText) return null;
    const rawConfidence = raw['confidence'];
    const confidence = typeof rawConfidence === 'number' ? Math.max(0, Math.min(1, rawConfidence)) : 0;
    return { summaryText, confidence };
  } catch {
    return null;
  }
}

function safeSlice(s: string, n: number): string {
  return [...s].slice(0, n).join('');
}
