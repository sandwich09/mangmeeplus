import { Injectable } from '@nestjs/common';
import { buildHealthStatus } from '../../domain/logic/health.logic';
import type { HealthStatus } from '../../domain/models/health-status.model';

@Injectable()
export class GetHealthUseCase {
  execute(): HealthStatus {
    return buildHealthStatus('ai-gateway');
  }
}
