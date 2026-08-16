import { Inject, Injectable } from '@nestjs/common';
import { AiGatewayConfigService } from '../config/ai-gateway-config.service';
import type { ToolPolicy } from './tool-policy.model';

@Injectable()
export class ToolPolicyEnforcerService {
  constructor(@Inject(AiGatewayConfigService) private readonly config: AiGatewayConfigService) {}

  assertToolCanExecute(policy: ToolPolicy): void {
    if (!this.config.aiToolPolicyEnforced) {
      throw new Error('AI_TOOL_POLICY_ENFORCED must be true before tool execution.');
    }
    if (!this.config.aiToolAuditEnabled) {
      throw new Error('AI_TOOL_AUDIT_ENABLED must be true before tool execution.');
    }
    if (!policy.requiresErpCorePermissionCheck) {
      throw new Error(`Tool "${policy.toolName}" must repeat permission checks in ERP core.`);
    }
    if (!policy.allowedWhenFinalMutationDisabled && !this.config.aiFinalMutationEnabled) {
      throw new Error(
        `Tool "${policy.toolName}" requires final mutation but AI_FINAL_MUTATION_ENABLED=false.`,
      );
    }
  }
}
