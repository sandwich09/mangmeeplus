/**
 * L-13: deep readiness (database status) lives here, behind the shared worker-token assert,
 * instead of on the public @Public() /v1/health route. Mirrors the other internal controllers
 * in this repo (crm-internal, line-ai-ledger-internal): @Public() + assertWorkerToken, and no
 * Swagger decorators so the route stays off the published surface.
 */
import { Controller, Get, Headers } from '@nestjs/common';
import { Public } from '../../../../common/security/public.decorator';
import { assertWorkerToken } from '../../../../common/security/worker-token';
import { GetHealthUseCase } from '../../application/use-cases/get-health.use-case';

@Public()
@Controller('internal/health')
export class HealthInternalController {
  constructor(private readonly getHealthUseCase: GetHealthUseCase) {}

  @Get('readiness')
  readiness(@Headers('x-worker-token') token: string | undefined) {
    assertWorkerToken(token);
    return this.getHealthUseCase.readiness();
  }
}
