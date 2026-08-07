import { Module } from '@nestjs/common';
import { AiGatewayConfigService } from '../config/ai-gateway-config.service';
import { ToolPolicyEnforcerService } from './tool-policy-enforcer.service';

@Module({
  providers: [AiGatewayConfigService, ToolPolicyEnforcerService],
  exports: [AiGatewayConfigService, ToolPolicyEnforcerService],
})
export class AiModule {}
