import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { IsString, Length, Matches, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import type { SalesEventClaimResult } from '@watchdog-bms/contracts';
import { Public } from '../../../../common/security/public.decorator';
import { LINE_ID_TOKEN_MAX_LENGTH, LINE_ID_TOKEN_PATTERN } from '../../../../common/security/liff-page.security';
import { ClaimEventDiscountUseCase } from '../../application/claim-event-discount.use-case';
import { SALES_EVENT_QR_TOKEN_PATTERN } from '../../domain/sales-event-claim.logic';

export class SalesEventClaimDto {
  @IsString() @MaxLength(LINE_ID_TOKEN_MAX_LENGTH) @Matches(LINE_ID_TOKEN_PATTERN) idToken!: string;
  @IsString() @Matches(SALES_EVENT_QR_TOKEN_PATTERN) qrToken!: string;
  @IsString() @Length(16, 120) @Matches(/^[A-Za-z0-9_-]+$/) requestKey!: string;
}

/**
 * Sales-event discounts, SD-B (spec §3.3, §7.1). Called only by the API-served LIFF page after a scan.
 * Public because the LIFF ID token in the body IS the credential; the per-LINE-account bucket is
 * spent inside, once the token proves whose it is. The QR token never reaches a URL of this API:
 * the page reads it from its own query string and posts it here.
 */
@Public()
@Controller('public/event-discounts')
export class PublicEventDiscountsController {
  constructor(private readonly claimEventDiscount: ClaimEventDiscountUseCase) {}

  @Post('claim')
  @HttpCode(200)
  @ApiOperation({ summary: 'Claim a sales-event discount with a LIFF ID token and a booth QR token' })
  @ApiResponse({ status: 200, description: 'The ticket this LINE account holds from the batch (new or replayed)' })
  @ApiResponse({ status: 401, description: 'LINE ID token invalid, expired or for another channel' })
  @ApiResponse({ status: 403, description: 'SALES_EVENT_SELF_CLAIM: the LINE account belongs to the sales team' })
  @ApiResponse({ status: 409, description: 'SALES_EVENT_QR_INVALID, SALES_EVENT_CLAIM_CLOSED, SALES_EVENT_AGENT_INACTIVE or SALES_EVENT_ISSUE_FULL' })
  claim(@Body() dto: SalesEventClaimDto, @Req() req: Request): Promise<SalesEventClaimResult> {
    return this.claimEventDiscount.execute({
      idToken: dto.idToken,
      qrToken: dto.qrToken,
      requestKey: dto.requestKey,
      requestId: (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
    });
  }
}
