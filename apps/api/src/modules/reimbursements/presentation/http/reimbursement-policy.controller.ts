import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext, UpdateReimbursementPolicyInput } from '@watchdog-bms/contracts';
import { GetReimbursementPolicyUseCase, UpdateReimbursementPolicyUseCase } from '../../application/use-cases/reimbursement-policy.use-case';
import { ReimbursementWriteQuiesceGuard } from './reimbursement-write-quiesce.guard';

@ApiTags('reimbursements')
@UseGuards(ReimbursementWriteQuiesceGuard)
@Controller('companies/:companyId/reimbursement-policy')
export class ReimbursementPolicyController {
  constructor(
    private readonly getPolicy: GetReimbursementPolicyUseCase,
    private readonly updatePolicy: UpdateReimbursementPolicyUseCase,
  ) {}

  @Get()
  @RequirePermissions('reimbursement.policy.read')
  @ApiOperation({ summary: 'Get reimbursement policy settings' })
  get(@ReqCtx() ctx: RequestContext) {
    return this.getPolicy.execute(ctx);
  }

  @Put()
  @RequirePermissions('reimbursement.policy.manage')
  @ApiOperation({ summary: 'Update reimbursement policy settings' })
  update(@ReqCtx() ctx: RequestContext, @Body() body: UpdateReimbursementPolicyInput) {
    return this.updatePolicy.execute(ctx, body);
  }
}
