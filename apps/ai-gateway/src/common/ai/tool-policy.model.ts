export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type ToolPolicy = {
  toolName: string;
  requiredPermission: string;
  riskLevel: RiskLevel;
  requiresConfirmation: boolean;
  requiresAudit: boolean;
  requiresErpCorePermissionCheck: boolean;
  allowedWhenFinalMutationDisabled: boolean;
};

export type ToolPolicyDecision = 'allow' | 'deny';

export type ToolInvocationContext = {
  userId: string;
  sessionId: string;
  permissions: string[];
  toolName: string;
};

export function evaluateToolPolicy(ctx: ToolInvocationContext): ToolPolicyDecision {
  return ctx.permissions.includes('ai.tool.invoke') ? 'allow' : 'deny';
}
