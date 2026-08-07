import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AiGatewayConfigService } from '../common/config/ai-gateway-config.service';
import { WatchdogContextVerifier } from './watchdog-context-verifier';
import { AiToolGuard } from './ai-tool.guard';

@Module({
  providers: [
    AiGatewayConfigService,
    WatchdogContextVerifier,
    {
      provide: APP_GUARD,
      useClass: AiToolGuard,
    },
  ],
  exports: [WatchdogContextVerifier],
})
export class AiAuthModule {}
