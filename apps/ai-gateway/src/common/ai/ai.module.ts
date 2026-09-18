import { Module } from '@nestjs/common';
import { AiGatewayConfigService } from '../config/ai-gateway-config.service';
import { ToolPolicyEnforcerService } from './tool-policy-enforcer.service';
import { AiBudgetShutdownService } from '../usage/ai-budget-shutdown.service';

@Module({
  // `AiBudgetShutdownService` is not exported: nothing injects it, Nest only needs it instantiated
  // so `enableShutdownHooks` reaches its `onApplicationShutdown` (hold spec §3).
  providers: [AiGatewayConfigService, ToolPolicyEnforcerService, AiBudgetShutdownService],
  exports: [AiGatewayConfigService, ToolPolicyEnforcerService],
})
export class AiModule {}
