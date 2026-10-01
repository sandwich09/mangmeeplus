import type { AuditActorType } from '../models/audit-log.model';

export type { AuditActorType };

/** `userId` of a context with no person behind it: `systemWorkerContext` and the capture services. */
const SYSTEM_CONTEXT_USER_ID = 'system';

/**
 * The actor of a row whose writer may be a worker. A worker's `userId` is no User row: as a USER
 * actor it fails the `actorUserId` FK, and `AuditService.log` then drops the row without throwing.
 * Such a writer is the SYSTEM actor, named by its subsystem like every other system-written row.
 */
export function auditActorOf(
  userId: string,
  subsystem: string,
): { actorUserId: string } | { actorType: 'SYSTEM'; actorRefId: string } {
  return userId === SYSTEM_CONTEXT_USER_ID ? { actorType: 'SYSTEM', actorRefId: subsystem } : { actorUserId: userId };
}

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
    // The backstop for a caller that reaches an `actorUserId: ctx.userId` site under a worker
    // context without `auditActorOf`: the row is kept as the SYSTEM actor it is, not lost to the FK.
    if (input.actorUserId === SYSTEM_CONTEXT_USER_ID) {
      return { actorType: 'SYSTEM', actorUserId: null, actorRefId: SYSTEM_CONTEXT_USER_ID };
    }
    return { actorType: 'USER', actorUserId: input.actorUserId ?? null, actorRefId: null };
  }
  // Fail closed: SYSTEM / CRM_CUSTOMER / SERVICE (and anything unexpected) never
  // occupy the User FK — their principal id is kept in actorRefId only.
  return { actorType, actorUserId: null, actorRefId: input.actorRefId ?? null };
}
