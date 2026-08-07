import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { RequestContext } from '@watchdog-bms/contracts';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import { assertRouteCompany } from '../../../data-model-core/presentation/http/assert-route-company';
import { ReleasePp36InputVatClaimUseCase } from '../../application/use-cases/pp36-input-claim.use-case';

@ApiTags('transaction-tax')
@Controller('companies/:companyId/accounts-payable/vendor-bills/:vendorBillId/lines/:lineId/pp36-input-claim')
export class Pp36InputClaimController {
  constructor(private readonly release: ReleasePp36InputVatClaimUseCase) {}

  @Post()
  @HttpCode(200)
  @RequirePermissions('tax.review_issue.resolve')
  @ApiOperation({ summary: 'Release payment-recognized PP36 input VAT after verified Revenue Department receipt' })
  execute(
    @ReqCtx() ctx: RequestContext,
    @Param('companyId') companyId: string,
    @Param('vendorBillId') vendorBillId: string,
    @Param('lineId') lineId: string,
    @Body() body: { supplierPaymentId?: string; evidenceId: string; claimDate: string; reason: string },
  ) {
    assertRouteCompany(ctx, companyId);
    return this.release.execute(ctx, { vendorBillId, vendorBillLineId: lineId,
      ...(body.supplierPaymentId ? { supplierPaymentId: body.supplierPaymentId } : {}),
      evidenceId: body.evidenceId, claimDate: body.claimDate, reason: body.reason });
  }
}
