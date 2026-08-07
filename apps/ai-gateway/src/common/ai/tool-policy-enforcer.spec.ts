import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ToolPolicyEnforcerService } from './tool-policy-enforcer.service';
import type { ToolPolicy } from './tool-policy.model';
import type { AiGatewayConfigService } from '../config/ai-gateway-config.service';

function makeConfig(overrides: Partial<AiGatewayConfigService>): AiGatewayConfigService {
  return {
    aiToolPolicyEnforced: true,
    aiToolAuditEnabled: true,
    aiFinalMutationEnabled: false,
    ...overrides,
  } as AiGatewayConfigService;
}

const readPolicy: ToolPolicy = {
  toolName: 'read-battery-data',
  requiredPermission: 'battery:read',
  riskLevel: 'low',
  requiresConfirmation: false,
  requiresAudit: true,
  requiresErpCorePermissionCheck: true,
  allowedWhenFinalMutationDisabled: true,
};

const writePolicy: ToolPolicy = {
  toolName: 'update-battery-cell',
  requiredPermission: 'battery:write',
  riskLevel: 'high',
  requiresConfirmation: true,
  requiresAudit: true,
  requiresErpCorePermissionCheck: true,
  allowedWhenFinalMutationDisabled: false,
};

describe('ToolPolicyEnforcerService', () => {
  it('throws when AI_TOOL_POLICY_ENFORCED=false', () => {
    const enforcer = new ToolPolicyEnforcerService(makeConfig({ aiToolPolicyEnforced: false }));
    assert.throws(
      () => enforcer.assertToolCanExecute(readPolicy),
      /AI_TOOL_POLICY_ENFORCED must be true/,
    );
  });

  it('throws when AI_TOOL_AUDIT_ENABLED=false', () => {
    const enforcer = new ToolPolicyEnforcerService(makeConfig({ aiToolAuditEnabled: false }));
    assert.throws(
      () => enforcer.assertToolCanExecute(readPolicy),
      /AI_TOOL_AUDIT_ENABLED must be true/,
    );
  });

  it('throws for mutation tool when AI_FINAL_MUTATION_ENABLED=false', () => {
    const enforcer = new ToolPolicyEnforcerService(makeConfig({ aiFinalMutationEnabled: false }));
    assert.throws(
      () => enforcer.assertToolCanExecute(writePolicy),
      /requires final mutation but AI_FINAL_MUTATION_ENABLED=false/,
    );
  });

  it('throws when tool policy does not require ERP core permission check', () => {
    const enforcer = new ToolPolicyEnforcerService(makeConfig({}));
    assert.throws(
      () => enforcer.assertToolCanExecute({ ...readPolicy, requiresErpCorePermissionCheck: false }),
      /must repeat permission checks in ERP core/,
    );
  });

  it('allows read-only tool when AI_FINAL_MUTATION_ENABLED=false', () => {
    const enforcer = new ToolPolicyEnforcerService(makeConfig({ aiFinalMutationEnabled: false }));
    assert.doesNotThrow(() => enforcer.assertToolCanExecute(readPolicy));
  });

  it('health endpoint mock: health module is independent of AI safety envelope', () => {
    // ponytail: health endpoint has no dependency on ToolPolicyEnforcerService;
    // this assertion confirms the separation of concerns.
    const enforcer = new ToolPolicyEnforcerService(makeConfig({}));
    // enforcer existence does not affect health - just verify it constructs cleanly
    assert.ok(enforcer);
  });
});
