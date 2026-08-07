import { Injectable } from '@nestjs/common';
import type { PolicyContext, PolicyResult } from '../../domain/models/policy-decision.model';
import type { IPolicyEvaluatorPort } from '../../domain/ports/policy-evaluator.port';

interface IPolicy {
  evaluate(context: PolicyContext): Promise<PolicyResult>;
}

// ponytail: first deny wins; collects allows; not_applicable if nothing matched
@Injectable()
export class CompositePolicyEvaluator implements IPolicyEvaluatorPort {
  constructor(private readonly policies: IPolicy[]) {}

  async evaluate(context: PolicyContext): Promise<PolicyResult> {
    let firstAllow: PolicyResult | undefined;
    for (const policy of this.policies) {
      const result = await policy.evaluate(context);
      if (result.decision === 'deny') return result;
      if (result.decision === 'allow' && !firstAllow) firstAllow = result;
    }
    return firstAllow ?? { decision: 'not_applicable' };
  }
}
