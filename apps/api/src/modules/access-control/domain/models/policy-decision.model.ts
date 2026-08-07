export type PolicyDecision = 'allow' | 'deny' | 'not_applicable';

export interface PolicyContext {
  userId: string;
  companyId: string;
  membershipId: string;
  roles: string[];
  permissions: string[];
  resourceOwnerId?: string;
  resourceCompanyId?: string;
}

export interface PolicyResult {
  decision: PolicyDecision;
  reason?: string;
}
