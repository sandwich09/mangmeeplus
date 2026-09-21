/**
 * Q9 — the customer's half of the bank-transfer fallback, on the package page.
 *
 * Guarded by `company.setup.manage`, the same permission the package page already needs: attaching
 * a transfer slip is a settings action on your own shop, not a new authority. The routes are also
 * in `isBillingRecoveryRoute`, because a locked shop is exactly the shop that needs to pay.
 */
import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import type { Request } from 'express';
import { SALES_SLIP_MIME_TYPES, type SalesDealSlipUploadIntent } from '@watchdog-bms/contracts';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { SalesSlipService } from '../../application/sales-slip.service';

/** 20 MB matches the platform upload ceiling; the storage layer re-checks the real bytes anyway. */
const SLIP_MAX_BYTES = 20 * 1024 * 1024;

export class DealSlipUploadIntentDto {
  @IsString() @IsNotEmpty() @MaxLength(255) originalFileName!: string;
  @IsIn([...SALES_SLIP_MIME_TYPES]) mimeType!: string;
  @IsInt() @Min(1) @Max(SLIP_MAX_BYTES) byteSize!: number;
}

export class DealSlipCompleteDto {
  @IsString() @IsNotEmpty() @MaxLength(40) attachmentId!: string;
  /**
   * The browser's own digest of the bytes it uploaded. `forbidNonWhitelisted` is on globally, so
   * this must be declared even though the completion re-hashes the stored object itself — and
   * passing it through is what makes a mid-flight swap fail rather than pass as the shop's slip.
   */
  @IsString() @IsOptional() @Matches(/^[a-f0-9]{64}$/) checksumSha256?: string;
}

@Controller('companies/:companyId/package-change-requests/:dealId/slip')
export class CompanyDealSlipController {
  constructor(private readonly slips: SalesSlipService) {}

  @Post('upload-intent')
  @HttpCode(201)
  @RequirePermissions('company.setup.manage')
  @ApiOperation({ summary: 'Sign an upload for a transfer slip on a live deal offer' })
  @ApiResponse({ status: 409, description: 'SALES_SLIP_STATE_CONFLICT / SALES_DEAL_EXPIRED' })
  uploadIntent(
    @Param('companyId') companyId: string,
    @Param('dealId') dealId: string,
    @Body() dto: DealSlipUploadIntentDto,
    @Req() req: Request & { context: RequestContext },
  ): Promise<SalesDealSlipUploadIntent> {
    return this.slips.uploadIntent(req.context, companyId, dealId, dto);
  }

  @Post('complete')
  @HttpCode(200)
  @RequirePermissions('company.setup.manage')
  @ApiOperation({ summary: 'Finish the upload (scanned there) and put the deal in SLIP_PENDING' })
  complete(
    @Param('companyId') companyId: string,
    @Param('dealId') dealId: string,
    @Body() dto: DealSlipCompleteDto,
    @Req() req: Request & { context: RequestContext },
  ) {
    return this.slips.complete(req.context, companyId, dealId, dto.attachmentId, dto.checksumSha256);
  }

  @Get('url')
  @RequirePermissions('company.setup.manage')
  @ApiOperation({ summary: 'A short-lived inline URL for the slip this shop attached' })
  slipUrl(
    @Param('companyId') companyId: string,
    @Param('dealId') dealId: string,
    @Req() req: Request & { context: RequestContext },
  ) {
    return this.slips.customerSlipUrl(req.context, companyId, dealId);
  }
}
