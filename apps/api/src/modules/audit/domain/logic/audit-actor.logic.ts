import type { AuditActorType } from '../models/audit-log.model';

export type { AuditActorType };

/**
 * Normalizes an audit actor into a storage-safe triple. Fails closed: any actor
 * that is not exactly USER must never write an id into `actorUserId` (the User
 * FK) — its identity lives only in `actorRefId`. A USER actor never carries
 * `actorRefId`. An unknown/omitted `actorType` collapses to USER.
 */
export function normalizeAuditActor(input: {
  actorType?: AuditActorType;
  actorUserId?: string | null;
  actorRefId?: string | null;
}): { actorType: AuditActorType; actorUserId: string | null; actorRefId: string | null } {
  const actorType = input.actorType ?? 'USER';
  if (actorType === 'USER') {
    return { actorType: 'USER', actorUserId: input.actorUserId ?? null, actorRefId: null };
  }
  // Fail closed: SYSTEM / CRM_CUSTOMER / SERVICE (and anything unexpected) never
  // occupy the User FK — their principal id is kept in actorRefId only.
  return { actorType, actorUserId: null, actorRefId: input.actorRefId ?? null };
}
