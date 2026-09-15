import type { LineUserContext } from '@watchdog-bms/contracts';
import { createHash } from 'node:crypto';
import type { ResolvedAccess } from '../../access-control/domain/ports/permission-resolver.port';

/** Actor authority only, never proof that a particular source record is still accessible. */
export function lineDeliveryAccessFingerprint(context: LineUserContext, entitled: ReadonlySet<string> | null): string {
  const sorted = (values: readonly string[] | null | undefined) => values == null ? values : [...new Set(values)].sort();
  return JSON.stringify({
    userId: context.internalUserId,
    companyId: context.companyId,
    membershipId: context.membershipId,
    roles: sorted(context.roles),
    permissions: sorted(context.permissions),
    branchIds: sorted(context.branchIds),
    locationIds: sorted(context.locationIds),
    resolvedEntitlements: sorted(context.entitledFeatureKeys),
    currentEntitlements: entitled === null ? null : sorted([...entitled]),
  });
}

export function resolvedLineDeliveryAccessFingerprint(userId: string, companyId: string, access: ResolvedAccess, entitled: ReadonlySet<string> | null): string {
  return lineDeliveryAccessFingerprint({
    internalUserId: userId, companyId, membershipId: access.membershipId,
    roles: access.roles, permissions: access.permissions, entitledFeatureKeys: access.entitledFeatureKeys,
    branchIds: access.scopes.branchIds, locationIds: access.scopes.locationIds,
    lineUserId: '[REDACTED]', locale: 'th-TH',
  }, entitled);
}

export type LineReadDeliveryAuthorization = {
  userId: string; companyId: string; fingerprint: string; requestId: string; ids: string[];
  webhookEventId: string; recipientHash: string; channelId: string;
};

export function lineDeliveryRecipientHash(lineUserId: string, chatId: string, channelId: string): string {
  return createHash('sha256').update(JSON.stringify([lineUserId, chatId, channelId])).digest('hex');
}

export function parseLineReadDeliveryAuthorization(value: unknown): LineReadDeliveryAuthorization | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const envelope = value as { v?: unknown; producerId?: unknown; read?: unknown };
  if (envelope.v !== 1 || typeof envelope.producerId !== 'string' || !envelope.producerId
    || !envelope.read || typeof envelope.read !== 'object' || Array.isArray(envelope.read)) return null;
  const read = envelope.read as LineReadDeliveryAuthorization;
  if (['userId', 'companyId', 'requestId', 'webhookEventId'].some(key => typeof read[key as keyof typeof read] !== 'string'
    || !(read[key as keyof typeof read] as string).length || (read[key as keyof typeof read] as string).length > 200)
    || typeof read.fingerprint !== 'string' || !read.fingerprint || read.fingerprint.length > 32768
    || typeof read.channelId !== 'string' || read.channelId.length > 200
    || typeof read.recipientHash !== 'string' || !/^[a-f0-9]{64}$/.test(read.recipientHash)
    || !Array.isArray(read.ids) || !read.ids.length || read.ids.length > 64 || new Set(read.ids).size !== read.ids.length
    || read.ids.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id))) return null;
  return read;
}
