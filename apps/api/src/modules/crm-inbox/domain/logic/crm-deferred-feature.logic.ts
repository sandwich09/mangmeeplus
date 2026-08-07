import { BadRequestException, ForbiddenException } from '@nestjs/common';

export const BROADCAST_FEATURE_KEY = 'crm_broadcast';

export function isBroadcastEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CRM_BROADCAST_ENABLED === 'true';
}

export function assertBroadcastEnabled(env: NodeJS.ProcessEnv = process.env): void {
  if (!isBroadcastEnabled(env)) throw new ForbiddenException('Broadcast is not enabled for this release');
}

export function assertReleaseOneBroadcastPayload(input: { imageUrl?: string; scheduledAt?: string }): void {
  if (input.imageUrl?.trim()) throw new BadRequestException('Broadcast poster is deferred to a future release');
  if (input.scheduledAt) throw new BadRequestException('Broadcast scheduling is deferred to a future release');
}
