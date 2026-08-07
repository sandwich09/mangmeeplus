import { Injectable } from '@nestjs/common';
import type { RequestContext } from '@watchdog-bms/contracts';
import { CreateDraftRequestUseCase } from './create-draft-request.use-case';
import { ListSuggestionsUseCase } from './ai-suggestion-query.use-case';
import { AI_SUGGESTION_TEMPLATES, computeTemplateAvailability } from '../../domain/ai-draft-template-catalog';
import {
  classifyLineSuggestionIntent,
  buildLineRequestAck,
  buildLineRefusal,
  buildLinePendingSummary,
  buildLineHelp,
} from '../../domain/logic/line-ai-suggestion.logic';

export type LineSuggestionTurnResult = {
  intent: string;
  refused: boolean;
  text: string;
  requestId?: string;
};

// Composes the LINE suggestion behavior: request (origin LINE), pending summary, and
// hard refusal for any create/accept/mutation ask. Source draft creation is impossible
// from LINE — it happens only via the web CreateSourceDraftUseCase.
@Injectable()
export class LineAiSuggestionUseCase {
  constructor(
    private readonly createRequest: CreateDraftRequestUseCase,
    private readonly list: ListSuggestionsUseCase,
  ) {}

  async handleTurn(ctx: RequestContext, text: string, webBaseUrl: string): Promise<LineSuggestionTurnResult> {
    const intent = classifyLineSuggestionIntent(text);

    if (intent === 'refuse_web_only') {
      return { intent, refused: true, text: buildLineRefusal(webBaseUrl, ctx.companyId) };
    }

    if (intent === 'pending_summary') {
      const page = await this.list.execute(ctx, { scope: 'own', status: 'NEW', pageSize: 10 });
      const items = page.items.map((s) => ({ title: s.title, riskLevel: s.riskLevel, citationCount: s.citationCount }));
      return { intent, refused: false, text: buildLinePendingSummary(webBaseUrl, ctx.companyId, items) };
    }

    if (intent === 'request') {
      // Pick the first available template the user is permitted to request.
      const template = AI_SUGGESTION_TEMPLATES.find(
        (t) => computeTemplateAvailability(t).status === 'AVAILABLE' && t.requiredPermissions.every((p) => ctx.permissions.includes(p)),
      );
      if (!template) {
        return { intent, refused: false, text: buildLineHelp(webBaseUrl, ctx.companyId) };
      }
      const request = await this.createRequest.execute(ctx, { templateKey: template.key, origin: 'LINE' });
      return { intent, refused: false, text: buildLineRequestAck(webBaseUrl, ctx.companyId), requestId: request.id };
    }

    return { intent, refused: false, text: buildLineHelp(webBaseUrl, ctx.companyId) };
  }
}
