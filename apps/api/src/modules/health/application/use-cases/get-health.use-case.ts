import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { buildHealthStatus } from '../../domain/logic/health.logic';
import type { HealthStatus } from '../../domain/models/health-status.model';

@Injectable()
export class GetHealthUseCase {
  private readonly logger = new Logger(GetHealthUseCase.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * L-13: public liveness. No database query and no dependency detail — the public route is
   * rate-limit exempt, so a `SELECT 1` per hit made it an unauthenticated database-load amplifier
   * as well as a datastore liveness oracle.
   */
  execute(): HealthStatus {
    return buildHealthStatus('api');
  }

  /** L-13: deep readiness. Reached only through the worker-token-guarded internal route. */
  async readiness(): Promise<HealthStatus> {
    let db: 'ok' | 'error' = 'ok';
    try {
      await this.prisma.client.$queryRawUnsafe('SELECT 1');
    } catch (error) {
      // Through the pino bridge, not console.warn: a driver error can carry a DSN with credentials,
      // and only the logger pipeline redacts it.
      this.logger.warn({ msg: 'health.readiness.db_check_failed', err: error });
      db = 'error';
    }
    return buildHealthStatus('api', db);
  }
}
