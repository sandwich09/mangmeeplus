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
import { SalesRenewalService, type SalesRenewalSweepResult } from '../../application/sales-renewal.service';

@Public()
@Controller('internal/sales')
export class SalesInternalController {
  constructor(private readonly deals: SalesDealsService, private readonly renewals: SalesRenewalService) {}

  @Post('deals/expire-sweep')
  @ApiOperation({ summary: 'Close APPROVED deals past their 3-day window (idempotent)' })
  @ApiResponse({ status: 201, description: 'How many rows this run closed' })
  expireSweep(@Headers('x-worker-token') token: string | undefined): Promise<{ expired: number }> {
    assertWorkerToken(token);
    return this.deals.expireSweep();
  }

  @Post('deals/renewal-sweep')
  @ApiOperation({ summary: 'D3: write the next round as PENDING_APPROVAL 14 days out, chase it at 7' })
  @ApiResponse({ status: 201, description: 'How many renewals this run created and reminded' })
  renewalSweep(@Headers('x-worker-token') token: string | undefined): Promise<SalesRenewalSweepResult> {
    assertWorkerToken(token);
    return this.renewals.sweep();
  }

  @Post('daily-digest')
  @ApiOperation({ summary: '§17.2: yesterday in one SYSTEM_ADMIN console notice (07:00 Bangkok)' })
  @ApiResponse({ status: 201, description: 'How many admins were notified, and for which Bangkok day' })
  dailyDigest(@Headers('x-worker-token') token: string | undefined): Promise<{ notified: number; periodKey: string }> {
    assertWorkerToken(token);
    return this.renewals.dailyDigest();
  }
}
