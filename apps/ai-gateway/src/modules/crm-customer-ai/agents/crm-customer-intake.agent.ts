/**
 * CrmCustomerIntakeAgent — semantic classification of the latest customer turn (spec §25).
 * Boundary (hard): ALLOWED_TOOLS is empty, no LINE_TOOL_REGISTRY / ERP tool client, no DB.
 * The bounded context arrives fully assembled in the request. The gateway returns the class
 * and the model's confidence only — the API owns every autonomy threshold (boundary rule).
 */
import type { CrmCustomerIntakeRequest, CrmCustomerIntakeResult, CrmAiTurnClass } from '@watchdog-bms/contracts';
import { CRM_AI_MAX_WINDOW, CRM_AI_TURN_CLASSES } from '@watchdog-bms/contracts';
import type { IModelProvider } from '../../line-ai/infrastructure/provider/provider.port';
import { CRM_INTAKE_SYSTEM_PROMPT } from './crm-prompts';
import { extractJson } from '../../../common/ai/extract-json';

export const ALLOWED_TOOLS = new Set<string>([]);

export class CrmCustomerIntakeAgent {
  async run(provider: IModelProvider, req: CrmCustomerIntakeRequest): Promise<CrmCustomerIntakeResult> {
    // Defensive bound at the trust boundary: the API should send ≤20, but never trust the caller.
    const window = (req.window ?? [])
      .slice(-CRM_AI_MAX_WINDOW)
      .map((m) => ({ role: m.role, text: m.text, at: m.at }));

    const out = await provider.generateText({
      systemPrompt: CRM_INTAKE_SYSTEM_PROMPT,
      messages: [{ role: 'user', text: JSON.stringify({ consent: req.consent, window }) }],
      maxTokens: 200,
      usageTag: 'crm.intake',
    });
    if (!out.ok) return { status: 'unavailable', requestId: req.requestId, error: out.error };

    const parsed = parseIntake(out.text);
    // Model responded but produced no usable class → uncertain (caller falls back to staff).
    return parsed
      ? { status: 'ok', requestId: req.requestId, turnClass: parsed.turnClass, confidence: parsed.confidence }
      : { status: 'uncertain', requestId: req.requestId };
  }
}

function parseIntake(text: string): { turnClass: CrmAiTurnClass; confidence: number } | null {
  try {
    const raw = JSON.parse(extractJson(text)) as Record<string, unknown>;
    const turnClass = raw['turnClass'];
    if (typeof turnClass !== 'string' || !CRM_AI_TURN_CLASSES.includes(turnClass as CrmAiTurnClass)) return null;
    const rawConfidence = raw['confidence'];
    const confidence = typeof rawConfidence === 'number' ? Math.max(0, Math.min(1, rawConfidence)) : 0;
    return { turnClass: turnClass as CrmAiTurnClass, confidence };
  } catch {
    return null;
  }
}
