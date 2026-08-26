import { HttpException } from '@nestjs/common';
import type { AuditService } from '../../modules/audit/application/audit.service';

type JourneyAudit = Pick<AuditService, 'log'> | null;

export type JourneyTerminal = Readonly<{
  outcome: string;
  failureClass?: string;
}>;

type JourneyInput = Readonly<{
  key: string;
  requestId: string;
  targetType: string;
  targetId?: string;
  companyId?: string;
  actorUserId?: string;
}>;

export function customerJourneyFailure(error: unknown): JourneyTerminal {
  if (!(error instanceof HttpException)) return { outcome: 'failed', failureClass: 'unexpected' };
  const status = error.getStatus();
  if (status === 401 || status === 403) return { outcome: 'denied', failureClass: 'permission' };
  if (status === 404) return { outcome: 'not_found', failureClass: 'not_found' };
  if (status === 409) return { outcome: 'conflict', failureClass: 'conflict' };
  if (status === 429) return { outcome: 'rate_limited', failureClass: 'rate_limit' };
  if (status >= 400 && status < 500) return { outcome: 'rejected', failureClass: 'validation' };
  return { outcome: 'failed', failureClass: 'unexpected' };
}

/** One accepted audit row and exactly one terminal row around an existing application boundary. */
export async function observeCustomerJourney<T>(
  audit: JourneyAudit,
  input: JourneyInput,
  operation: () => Promise<T>,
  success: (result: T) => JourneyTerminal,
): Promise<T> {
  if (!audit) return operation();
  const acceptedAt = Date.now();
  const action = `journey.${input.key.replaceAll('-', '.')}`;
  const common = {
    ...(input.companyId ? { companyId: input.companyId } : {}),
    ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
    targetType: input.targetType,
    ...(input.targetId ? { targetId: input.targetId } : {}),
    requestId: input.requestId,
    riskLevel: 'MEDIUM' as const,
  };
  await audit.log({
    ...common,
    action: `${action}.accepted`,
    result: 'SUCCESS',
    metadataJson: { journey: input.key, stage: 'accepted' },
  });
  try {
    const result = await operation();
    const terminal = success(result);
    await audit.log({
      ...common,
      action: `${action}.terminal`,
      result: terminal.failureClass ? 'FAILED' : 'SUCCESS',
      metadataJson: { journey: input.key, stage: 'terminal', ...terminal, durationMs: Date.now() - acceptedAt },
    });
    return result;
  } catch (error) {
    const terminal = customerJourneyFailure(error);
    await audit.log({
      ...common,
      action: `${action}.terminal`,
      result: 'FAILED',
      metadataJson: { journey: input.key, stage: 'terminal', ...terminal, durationMs: Date.now() - acceptedAt },
    });
    throw error;
  }
}
