import { Injectable } from '@nestjs/common';
import type { PolicyContext, PolicyResult } from '../../domain/models/policy-decision.model';

@Injectable()
export class OwnRecordPolicy {
  async evaluate(context: PolicyContext): Promise<PolicyResult> {
    if (context.resourceOwnerId === undefined) {
      return { decision: 'not_applicable' };
    }
    if (context.resourceOwnerId === context.userId) {
      return { decision: 'allow', reason: 'own record' };
    }
    if (context.roles.some((r) => r === 'OWNER' || r === 'ADMIN')) {
      return { decision: 'allow', reason: 'admin override' };
    }
    return { decision: 'deny', reason: 'not own record' };
  }
}
