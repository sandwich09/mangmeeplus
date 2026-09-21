/**
 * S17 — the daily sweep that closes expired offers. Same worker-token shape as every other
 * cross-company sweep (`internal/notifications/*`): no user JWT, no company scope.
 *
 * Reads already derive EXPIRED on their own, so a sweep that is late or skipped changes what the
 * row says, never what the customer sees.
 */
import { Controller, Headers, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '../../../../common/security/public.decorator';
import { assertWorkerToken } from '../../../../common/security/worker-token';
import { SalesDealsService } from '../../application/sales-deals.service';

@Public()
@Controller('internal/sales')
export class SalesInternalController {
  constructor(private readonly deals: SalesDealsService) {}

  @Post('deals/expire-sweep')
  @ApiOperation({ summary: 'Close APPROVED deals past their 3-day window (idempotent)' })
  @ApiResponse({ status: 201, description: 'How many rows this run closed' })
  expireSweep(@Headers('x-worker-token') token: string | undefined): Promise<{ expired: number }> {
    assertWorkerToken(token);
    return this.deals.expireSweep();
  }
}
