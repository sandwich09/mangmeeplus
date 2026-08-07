import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../../common/security/public.decorator';
import { GetHealthUseCase } from '../../application/use-cases/get-health.use-case';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly getHealthUseCase: GetHealthUseCase) {}

  @Get()
  @ApiOkResponse({ description: 'ERP core API health status.' })
  getHealth() {
    return this.getHealthUseCase.execute();
  }
}
