import type { RequestContext } from '../models/request-context.model';

/**
 * Request context for background workers acting without a human actor (H-14).
 * Carries only the explicit permissions the job needs — never a synthesized
 * membership role, so role-gated paths (OWNER/ADMIN overrides) stay closed to
 * anyone holding the worker token.
 */
export function systemWorkerContext(input: {
  requestId: string;
  companyId: string;
  permissions: readonly string[];
  /** Names the initiating subsystem for audit/trace provenance (default 'worker'). */
  authSubject?: string;
}): RequestContext {
  return {
    requestId: input.requestId,
    authSubject: input.authSubject ?? 'worker',
    userId: 'system',
    companyId: input.companyId,
    membershipId: 'system',
    roles: [],
    permissions: [...input.permissions],
    scopes: {},
    authProvider: 'system',
  };
}
