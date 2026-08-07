import { Module } from '@nestjs/common';
import { GetHealthUseCase } from './application/use-cases/get-health.use-case';
import { HealthController } from './presentation/http/health.controller';
import { HealthInternalController } from './presentation/http/health-internal.controller';
import { ProtectedTestController } from './presentation/http/protected-test.controller';

@Module({
  controllers: [HealthController, HealthInternalController, ProtectedTestController],
  providers: [GetHealthUseCase],
})
export class HealthModule {}
