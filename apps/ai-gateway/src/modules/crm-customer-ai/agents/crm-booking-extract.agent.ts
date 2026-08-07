/**
 * CrmBookingExtractAgent — semantic booking-slot extraction to normalized fields.
 * Boundary (hard): ALLOWED_TOOLS is empty, no LINE_TOOL_REGISTRY / ERP tool client, no DB.
 * The bounded context and Bangkok "today" date arrive fully assembled in the request.
 * The gateway extracts only; the API owns validation, availability, and booking mutation.
 */
import type { CrmBookingExtractRequest, CrmBookingExtractResult } from '@watchdog-bms/contracts';
import { CRM_AI_MAX_WINDOW } from '@watchdog-bms/contracts';
import type { IModelProvider } from '../../line-ai/infrastructure/provider/provider.port';
import { extractJson } from '../../../common/ai/extract-json';
import { CRM_BOOKING_EXTRACT_SYSTEM_PROMPT } from './crm-prompts';

export const ALLOWED_TOOLS = new Set<string>([]);

export class CrmBookingExtractAgent {
  async run(provider: IModelProvider, req: CrmBookingExtractRequest): Promise<CrmBookingExtractResult> {
    const window = (req.window ?? [])
      .slice(-CRM_AI_MAX_WINDOW)
      .map((m) => ({ role: m.role, text: m.text, at: m.at }));

    const out = await provider.generateText({
      systemPrompt: CRM_BOOKING_EXTRACT_SYSTEM_PROMPT,
      messages: [{ role: 'user', text: JSON.stringify({ consent: req.consent, todayBangkok: req.todayBangkok, catalog: (req.catalog ?? []).slice(0, 50), window }) }],
      maxTokens: 300,
      usageTag: 'crm.booking-extract',
    });
    if (!out.ok) return unclear(req.requestId);

    const parsed = parseBookingExtract(out.text);
    if (!parsed) return unclear(req.requestId);
    return parsed.status === 'ok' ? { requestId: req.requestId, ...parsed } : { requestId: req.requestId, ...parsed };
  }
}

type ParsedBookingExtract =
  | {
      status: 'ok';
      catalogItemId?: string;
      serviceName?: string;
      date: string;
      timeHHmm?: string;
      durationMinutes?: number;
      confidence: number;
    }
  | { status: 'unclear'; confidence: number };

function parseBookingExtract(text: string): ParsedBookingExtract | null {
  try {
    const raw = JSON.parse(extractJson(text)) as Record<string, unknown>;
    const confidence = confidenceOf(raw['confidence']);
    if (raw['status'] === 'unclear') return { status: 'unclear', confidence };
    if (raw['status'] !== 'ok' || typeof raw['date'] !== 'string' || !isYyyyMmDd(raw['date'])) return null;

    const result: Extract<ParsedBookingExtract, { status: 'ok' }> = {
      status: 'ok',
      date: raw['date'],
      confidence,
    };
    if (typeof raw['catalogItemId'] === 'string' && raw['catalogItemId'].trim()) {
      result.catalogItemId = safeSlice(raw['catalogItemId'].trim(), 200);
    }
    if (typeof raw['serviceName'] === 'string' && raw['serviceName'].trim()) {
      result.serviceName = safeSlice(raw['serviceName'].trim(), 200);
    }
    if (typeof raw['timeHHmm'] === 'string' && isHHmm(raw['timeHHmm'])) result.timeHHmm = raw['timeHHmm'];
    if (typeof raw['durationMinutes'] === 'number' && Number.isFinite(raw['durationMinutes']) && raw['durationMinutes'] > 0) {
      result.durationMinutes = Math.round(raw['durationMinutes']);
    }
    return result;
  } catch {
    return null;
  }
}

function unclear(requestId: string): CrmBookingExtractResult {
  return { status: 'unclear', requestId, confidence: 0 };
}

function confidenceOf(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
}

function isYyyyMmDd(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function isHHmm(v: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

function safeSlice(s: string, n: number): string {
  return [...s].slice(0, n).join('');
}
