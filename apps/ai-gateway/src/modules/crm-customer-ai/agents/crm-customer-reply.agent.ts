/**
 * CrmCustomerReplyAgent — composes a Thai brand-voice reply draft (spec §25).
 * Serves STAFF_ASSIST (draft for a human to send) and AUTONOMOUS (gated auto-reply); it only
 * composes — the deterministic decision to send stays in the API. Grounds every specific in
 * the window/templates and never invents; reports `needsHuman` as a signal for API policy.
 * Boundary (hard): ALLOWED_TOOLS is empty, no LINE_TOOL_REGISTRY / ERP tool client, no DB.
 */
import type { CrmReplyDraftRequest, CrmReplyDraftResult } from '@watchdog-bms/contracts';
import { CRM_AI_MAX_WINDOW } from '@watchdog-bms/contracts';
import type { IModelProvider } from '../../line-ai/infrastructure/provider/provider.port';
import { CRM_REPLY_SYSTEM_PROMPT } from './crm-prompts';
import { extractJson } from '../../../common/ai/extract-json';

export const ALLOWED_TOOLS = new Set<string>([]);

const MAX_TEMPLATES = 10;
const MAX_CATALOG_ITEMS = 50;
const MAX_DRAFT_CHARS = 1000; // defensive output bound before this feeds the send path (B5)

export class CrmCustomerReplyAgent {
  async run(provider: IModelProvider, req: CrmReplyDraftRequest): Promise<CrmReplyDraftResult> {
    const window = (req.window ?? [])
      .slice(-CRM_AI_MAX_WINDOW)
      .map((m) => ({ role: m.role, text: m.text, at: m.at }));
    const templates = (req.templates ?? [])
      .slice(0, MAX_TEMPLATES)
      .map((t) => ({ title: t.title, body: t.body }));
    const catalog = (req.catalog ?? []).slice(0, MAX_CATALOG_ITEMS);
    const payload = {
      mode: req.mode,
      locale: req.locale ?? 'th-TH',
      brand: req.brand,
      templates,
      catalog,
      window,
    };
    const tone = req.tone === undefined ? '' : String(req.tone).slice(0, 100);
    const userText = `${JSON.stringify(payload)}${tone ? `\nTone override: ${tone}` : ''}`;

    const out = await provider.generateText({
      systemPrompt: CRM_REPLY_SYSTEM_PROMPT,
      messages: [{ role: 'user', text: userText }],
      maxTokens: 500,
      usageTag: 'crm.reply',
    });
    if (!out.ok) return { status: 'unavailable', requestId: req.requestId, error: out.error };

    const parsed = parseReply(out.text);
    if (!parsed) return { status: 'uncertain', requestId: req.requestId };

    if (req.mode === 'AUTONOMOUS') {
      // M-03: the model supplies a signal, never the send authorization. The API
      // applies that signal together with deterministic content policy.
      return {
        status: 'ok',
        requestId: req.requestId,
        draftText: parsed.draftText.slice(0, MAX_DRAFT_CHARS),
        confidence: parsed.confidence,
        needsHumanSignal: parsed.needsHuman,
      };
    }
    // STAFF_ASSIST: a human reviews and edits every draft, so needsHuman is advisory — hand over
    // whatever the model composed, and fall back to 'uncertain' (staff write from scratch) only
    // when there is no draft. Never 'refused' here: nothing is auto-sent, so nothing to refuse.
    if (!parsed.draftText) return { status: 'uncertain', requestId: req.requestId };
    return { status: 'ok', requestId: req.requestId, draftText: parsed.draftText.slice(0, MAX_DRAFT_CHARS), confidence: parsed.confidence };
  }
}

function parseReply(text: string): { draftText: string; confidence: number; needsHuman: boolean } | null {
  try {
    const raw = JSON.parse(extractJson(text)) as Record<string, unknown>;
    // Require the two safety fields explicitly. The AUTONOMOUS caller no longer
    // gates on a confidence threshold, so a draft missing confidence or needsHuman
    // must stay 'uncertain' (never coerced to 0/false and auto-sent). This is what
    // silently made a fieldless draft look 'ok' before the reply-confidence gate.
    const rawConfidence = raw['confidence'];
    if (typeof rawConfidence !== 'number' || !Number.isFinite(rawConfidence)) return null;
    const confidence = Math.max(0, Math.min(1, rawConfidence));
    if (typeof raw['needsHuman'] !== 'boolean') return null;
    const needsHuman = raw['needsHuman'];
    const draftText = typeof raw['draftText'] === 'string' ? raw['draftText'].trim() : '';
    // A response with neither a draft nor an explicit needsHuman signal is unusable.
    if (!draftText && !needsHuman) return null;
    return { draftText, confidence, needsHuman };
  } catch {
    return null;
  }
}
