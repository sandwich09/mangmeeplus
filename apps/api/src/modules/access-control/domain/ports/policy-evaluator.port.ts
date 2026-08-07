import type { PolicyContext, PolicyResult } from '../models/policy-decision.model';

export const POLICY_EVALUATOR_TOKEN = 'POLICY_EVALUATOR_TOKEN';

export interface IPolicyEvaluatorPort {
  evaluate(context: PolicyContext): Promise<PolicyResult>;
}
