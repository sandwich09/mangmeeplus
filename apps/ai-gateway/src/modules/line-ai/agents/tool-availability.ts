import type { AgentIntentPlan, LineAiRefusalReason, LineUserContext, ToolMeta } from '@watchdog-bms/contracts';
import { LINE_TOOL_REGISTRY, hasToolFeature, hasToolPermissions } from '@watchdog-bms/contracts';

export type ToolAccessOutcome = 'allowed' | 'feature_disabled' | 'forbidden';

/** Server-derived access only. The model never sees or decides these outcomes. */
export function toolAccessOutcome(tool: ToolMeta, user: LineUserContext): ToolAccessOutcome {
  if (!hasToolPermissions(tool, user.permissions)) {
    const restored = [...new Set([
      ...user.permissions,
      ...Object.keys(user.entitlementDeniedPermissions ?? {}),
    ])];
    return hasToolPermissions(tool, restored) ? 'feature_disabled' : 'forbidden';
  }
  if (user.entitledFeatureKeys !== undefined
    && !hasToolFeature(tool, user.entitledFeatureKeys === null ? null : new Set(user.entitledFeatureKeys))) {
    return 'feature_disabled';
  }
  return 'allowed';
}

export type NormalizedToolAccess = {
  plan: AgentIntentPlan;
  featureDisabledTools: string[];
  forbiddenTools: string[];
};

export function normalizePlanToolAccess(
  plan: AgentIntentPlan,
  messageText: string,
  user: LineUserContext,
): NormalizedToolAccess {
  const featureDisabledTools: string[] = [];
  const forbiddenTools: string[] = [];
  const intents = plan.intents.flatMap((intent) => {
    const requiredTools = intent.requiredTools.filter((name) => {
      const tool = LINE_TOOL_REGISTRY.find((entry) => entry.name === name);
      if (!tool) return false;
      const outcome = toolAccessOutcome(tool, user);
      if (outcome === 'feature_disabled') featureDisabledTools.push(name);
      if (outcome === 'forbidden') forbiddenTools.push(name);
      return outcome === 'allowed';
    });
    return intent.requiredTools.length > 0 && requiredTools.length === 0
      ? []
      : [{ ...intent, requiredTools }];
  });

  return {
    plan: withAccessRefusals(plan, intents, messageText, featureDisabledTools, forbiddenTools),
    featureDisabledTools: [...new Set(featureDisabledTools)],
    forbiddenTools: [...new Set(forbiddenTools)],
  };
}

/** Handles a feature switch that changed after planning but before the authoritative API call. */
export function removeRuntimeBlockedTools(
  plan: AgentIntentPlan,
  messageText: string,
  featureDisabledTools: readonly string[],
): AgentIntentPlan {
  const blocked = new Set(featureDisabledTools);
  const intents = plan.intents.flatMap((intent) => {
    const requiredTools = intent.requiredTools.filter((name) => !blocked.has(name));
    return intent.requiredTools.length > 0 && requiredTools.length === 0
      ? []
      : [{ ...intent, requiredTools }];
  });
  return withAccessRefusals(plan, intents, messageText, [...blocked], []);
}

function withAccessRefusals(
  plan: AgentIntentPlan,
  intents: AgentIntentPlan['intents'],
  messageText: string,
  featureDisabledTools: readonly string[],
  forbiddenTools: readonly string[],
): AgentIntentPlan {
  if (featureDisabledTools.length === 0 && forbiddenTools.length === 0) return plan;
  const refusals = [...plan.refusals];
  const add = (reason: LineAiRefusalReason) => {
    if (!refusals.some((refusal) => refusal.reason === reason)) refusals.push({ request: messageText, reason });
  };
  if (featureDisabledTools.length > 0) add('feature_disabled');
  if (forbiddenTools.length > 0) add('forbidden');
  return {
    ...plan,
    status: intents.length === 0 ? 'UNROUTABLE' : 'PARTIAL',
    intents,
    refusals,
  };
}
