import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../../common/security/public.decorator';
import { GetHealthUseCase } from '../../application/use-cases/get-health.use-case';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(@Inject(GetHealthUseCase) private readonly getHealthUseCase: GetHealthUseCase) {}

  @Get()
  @ApiOkResponse({ description: 'AI Gateway health status.' })
  getHealth() {
    return this.getHealthUseCase.execute();
  }
}
