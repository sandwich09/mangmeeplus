/**
 * Compatibility seam for the pre-S-4 direct LINE correction lane.
 *
 * Existing LINE edits now go through LineDraftUpdateUseCase.preview/apply. Keep this provider
 * harmless so a flag-off or future caller cannot bypass the confirmation boundary.
 */
import { Injectable } from '@nestjs/common';
import type { LineCorrectionField, LineIntakeCorrectionCandidate, LineIntakeCorrectionHints, RequestContext } from '@watchdog-bms/contracts';
import type { ClarificationConsumption } from '../../../line-ai/application/line-ai-consumption-marker';
import type { CorrectionEvidence } from '../../domain/logic/line-correction.logic';

export type LineCorrectionOutcome =
  | { status: 'clarify'; field: LineCorrectionField }
  | { status: 'guidance'; reason: string };

export type LineCorrectionInput = {
  lineMessageIdHash: string;
  chatKeyHash: string;
  candidates: LineIntakeCorrectionCandidate[];
  hints?: LineIntakeCorrectionHints;
  evidence: CorrectionEvidence[];
  consumption?: ClarificationConsumption;
};

@Injectable()
export class CorrectLineCapturedExpenseUseCase {
  async execute(ctx: RequestContext, _input: LineCorrectionInput): Promise<LineCorrectionOutcome> {
    if (!ctx.permissions.includes('expense.update')) {
      return { status: 'guidance', reason: 'missing_update_permission' };
    }
    return { status: 'guidance', reason: 'preview_required' };
  }
}
