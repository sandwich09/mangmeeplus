/**
 * The executive report's build, asked for by the worker timer (executive backend spec §12.3, Q30).
 * Same worker-token shape as every other cross-company sweep (`internal/sales/*`): no user, no
 * company scope. The worker only decides WHEN; what a round builds, and whether another round is
 * already running, is decided behind this endpoint, so calling it again changes no figure.
 */
import { Controller, Headers, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '../../../../common/security/public.decorator';
import { assertWorkerToken } from '../../../../common/security/worker-token';
import { ExecutiveReportBuildUseCase, type ExecutiveRebuildResult } from '../../application/executive-report-build.use-case';

@Public()
@Controller('internal/executive')
export class ExecutiveInternalController {
  constructor(private readonly build: ExecutiveReportBuildUseCase) {}

  @Post('rebuild')
  @ApiOperation({ summary: 'Build the executive report summary tables: every hour the recent months, once a day every month (idempotent)' })
  @ApiResponse({ status: 201, description: 'The build this call wrote, or SKIPPED when another round holds the lock' })
  rebuild(@Headers('x-worker-token') token: string | undefined): Promise<ExecutiveRebuildResult> {
    assertWorkerToken(token);
    return this.build.rebuild();
  }
}
