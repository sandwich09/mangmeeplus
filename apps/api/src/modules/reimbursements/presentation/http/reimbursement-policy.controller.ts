import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RequireAnyPermission, RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext } from '@watchdog-bms/contracts';
import { GetReimbursementPolicyUseCase, ListReimbursementApproverOptionsUseCase, UpdateReimbursementPolicyUseCase } from '../../application/use-cases/reimbursement-policy.use-case';
import { ReimbursementWriteQuiesceGuard } from './reimbursement-write-quiesce.guard';
import { UpdateReimbursementPolicyDto } from './reimbursement.dtos';

@ApiTags('reimbursements')
@UseGuards(ReimbursementWriteQuiesceGuard)
@Controller('companies/:companyId/reimbursement-policy')
export class ReimbursementPolicyController {
  constructor(
    private readonly getPolicy: GetReimbursementPolicyUseCase,
    private readonly listApproverOptions: ListReimbursementApproverOptionsUseCase,
    private readonly updatePolicy: UpdateReimbursementPolicyUseCase,
  ) {}

  @Get('approver-options')
  @RequirePermissions('reimbursement.policy.manage')
  @ApiOperation({ summary: 'List roles ready to approve reimbursements' })
  approverOptions(@ReqCtx() ctx: RequestContext) {
    return this.listApproverOptions.execute(ctx);
  }

  @Get()
  @RequireAnyPermission('reimbursement.policy.read', 'reimbursement.policy.manage')
  @ApiOperation({ summary: 'Get reimbursement policy settings' })
  get(@ReqCtx() ctx: RequestContext) {
    return this.getPolicy.execute(ctx);
  }

  @Put()
  @RequirePermissions('reimbursement.policy.manage')
  @ApiOperation({ summary: 'Update reimbursement policy settings' })
  update(@ReqCtx() ctx: RequestContext, @Body() body: UpdateReimbursementPolicyDto) {
    return this.updatePolicy.execute(ctx, body);
  }
}
