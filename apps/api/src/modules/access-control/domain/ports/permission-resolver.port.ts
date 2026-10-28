export interface ResolvedAccess {
  membershipId: string;
  companyId: string;
  freeExpenseDrafts?: boolean;
  roles: string[];        // role keys e.g. OWNER, ADMIN
  /** Display-only package availability; never grants the reader a permission. */
  availablePermissions?: string[];
  permissions: string[];  // permission keys e.g. account.session.read
  /** Otherwise-granted permissions removed only because their owning feature is OFF. */
  entitlementDeniedPermissions?: Record<string, string>;
  /** Server-resolved company features; null means the legacy fail-open company. */
  entitledFeatureKeys?: string[] | null;
  scopes: {
    branchIds?: string[];
    locationIds?: string[];
    teamIds?: string[];
  };
}

export interface ResolvePermissionsInput {
  userId: string;
  companyId?: string; // hint; server verifies
  /** Server-selected recovery scope, never accepted from headers/query/body. */
  allowTermRecovery?: boolean;
}

export interface IPermissionResolverPort {
  resolveForUser(input: ResolvePermissionsInput): Promise<ResolvedAccess>;
}

export const PERMISSION_RESOLVER_TOKEN = 'PERMISSION_RESOLVER_TOKEN';
