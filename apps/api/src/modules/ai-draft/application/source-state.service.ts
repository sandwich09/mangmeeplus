import { Injectable } from '@nestjs/common';
import type { RequestContext } from '@watchdog-bms/contracts';
import { GetCrmCustomerUseCase } from '../../crm/application/use-cases/crm-customer.use-case';
import type { AiSuggestionRecord } from '../domain/models/ai-draft.model';
import { buildSourceStateHash } from '../domain/logic/ai-draft-idempotency.logic';

// Recomputes the current source-state hash for a suggestion so we can detect whether
// the underlying source record changed materially after generation. Mirrors the parts
// used by the generator. Returns undefined when the source is not tracked (checklists,
// CFO summaries) — meaning "no change detectable", never a false positive.
@Injectable()
export class SourceStateService {
  constructor(private readonly getCustomer: GetCrmCustomerUseCase) {}

  async currentHash(ctx: RequestContext, suggestion: AiSuggestionRecord): Promise<string | undefined> {
    if (suggestion.sourceModule === 'crm' && suggestion.sourceRecordType === 'customer' && suggestion.sourceRecordId) {
      try {
        const result = await this.getCustomer.execute(ctx, suggestion.sourceRecordId);
        if (result.projection !== 'OPERATIONAL') return undefined;
        const c = result.customer;
        return buildSourceStateHash(['crm-customer', c.id, c.status, c.nextFollowUpAt ?? '']);
      } catch {
        return undefined; // cannot read now — do not claim a change
      }
    }
    return undefined;
  }

  async isChanged(ctx: RequestContext, suggestion: AiSuggestionRecord): Promise<boolean> {
    if (!suggestion.sourceStateHash) return false;
    const current = await this.currentHash(ctx, suggestion);
    if (current === undefined) return false;
    return current !== suggestion.sourceStateHash;
  }
}
