import type {
  CrmCustomerProfileExtractRequest,
  CrmCustomerProfileExtractResult,
} from '@watchdog-bms/contracts';
import type { IModelProvider } from '../../line-ai/infrastructure/provider/provider.port';
import { extractJson } from '../../../common/ai/extract-json';
import { CRM_CUSTOMER_PROFILE_EXTRACT_SYSTEM_PROMPT } from './crm-prompts';

export const ALLOWED_TOOLS = new Set<string>([]);

const MAX = { displayName: 160, primaryPhone: 40, primaryEmail: 254, notes: 500 } as const;

export class CrmCustomerProfileExtractAgent {
  async run(
    provider: IModelProvider,
    req: CrmCustomerProfileExtractRequest,
  ): Promise<CrmCustomerProfileExtractResult> {
    const out = await provider.generateText({
      systemPrompt: CRM_CUSTOMER_PROFILE_EXTRACT_SYSTEM_PROMPT,
      messages: [{ role: 'user', text: JSON.stringify({ text: req.text, locale: req.locale ?? 'th-TH' }) }],
      maxTokens: 350,
      usageTag: 'crm.profile-extract',
    });
    if (!out.ok) return { status: 'unavailable', requestId: req.requestId, error: out.error };

    const parsed = parseProfile(out.text);
    return parsed
      ? { status: 'ok', requestId: req.requestId, suggested: parsed.suggested, confidence: parsed.confidence }
      : { status: 'uncertain', requestId: req.requestId };
  }
}

function boundedString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function parseProfile(text: string): {
  suggested: { displayName?: string; primaryPhone?: string; primaryEmail?: string; notes?: string };
  confidence: number;
} | null {
  try {
    const raw = JSON.parse(extractJson(text)) as Record<string, unknown>;
    const suggested = {
      displayName: boundedString(raw['displayName'], MAX.displayName),
      primaryPhone: boundedString(raw['primaryPhone'], MAX.primaryPhone),
      primaryEmail: boundedString(raw['primaryEmail'], MAX.primaryEmail),
      notes: boundedString(raw['notes'], MAX.notes),
    };
    if (!suggested.displayName && !suggested.primaryPhone && !suggested.primaryEmail) return null;
    const rawConfidence = raw['confidence'];
    const confidence = typeof rawConfidence === 'number' && Number.isFinite(rawConfidence)
      ? Math.max(0, Math.min(1, rawConfidence))
      : 0;
    return { suggested, confidence };
  } catch {
    return null;
  }
}
