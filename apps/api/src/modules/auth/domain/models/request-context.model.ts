export const REQUEST_CONTEXT = Symbol('REQUEST_CONTEXT');

export type AuthProvider = 'watchdog' | 'line' | 'dev' | 'system';

export type RequestContext = {
  requestId: string;
  authSubject: string;
  sessionId?: string;
  userId: string;
  companyId: string;
  membershipId: string;
  roles: string[];
  /** Display-only package availability; never grants the reader a permission. */
  availablePermissions?: string[];
  permissions: string[];
  entitlementDeniedPermissions?: Record<string, string>;
  scopes: {
    branchIds?: string[];
    locationIds?: string[];
    teamIds?: string[];
  };
  authProvider: AuthProvider;
};
