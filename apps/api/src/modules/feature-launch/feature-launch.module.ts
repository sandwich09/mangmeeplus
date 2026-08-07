import { Module } from '@nestjs/common';
import { LoggerModule } from '../../common/logger/logger.module';
import { LaunchGateController } from './presentation/http/launch-gate.controller';
import { RunoffInternalController } from './presentation/http/runoff-internal.controller';
import { LaunchGateCommandUseCase } from './application/use-cases/launch-gate-command.use-case';
import { GetLaunchHealthUseCase } from './application/use-cases/get-launch-health.use-case';
import { LaunchGateGuardService } from './application/launch-gate.guard';
import { ExecutionAttemptService } from './application/execution-attempt.service';
import { LaunchShadowProbe } from './application/launch-shadow.probe';

@Module({
  // LoggerModule supplies LOGGER_TOKEN for the shadow would_block counter and terminal events.
  imports: [LoggerModule],
  // The runoff sweep is worker-token protected (SYSTEM actor), the gate command is system-admin
  // permission protected — two authorities, so two controllers.
  controllers: [LaunchGateController, RunoffInternalController],
  providers: [
    LaunchGateCommandUseCase,
    GetLaunchHealthUseCase,
    LaunchGateGuardService,
    ExecutionAttemptService,
    LaunchShadowProbe,
  ],
  // Consumers inject the guard to fence root/final mutations, the attempt service to stamp and
  // claim durable work, and the shadow probe to measure would_block before enforcement flips.
  exports: [LaunchGateGuardService, ExecutionAttemptService, LaunchShadowProbe],
})
export class FeatureLaunchModule {}
