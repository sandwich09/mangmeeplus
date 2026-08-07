import { Injectable } from '@nestjs/common';
import type { PolicyContext, PolicyResult } from '../../domain/models/policy-decision.model';

@Injectable()
export class TenantBoundaryPolicy {
  async evaluate(context: PolicyContext): Promise<PolicyResult> {
    if (context.resourceCompanyId === undefined) {
      return { decision: 'not_applicable' };
    }
    if (context.resourceCompanyId === context.companyId) {
      return { decision: 'allow', reason: 'same tenant' };
    }
    return { decision: 'deny', reason: 'cross-tenant access denied' };
  }
}
