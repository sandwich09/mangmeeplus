import { Controller, Get, Post, Patch, Param, Body, Query, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type {
  RequestContext,
  CreateCrmFollowUpInput,
  UpdateCrmFollowUpInput,
  CompleteCrmFollowUpInput,
  SnoozeCrmFollowUpInput,
  CancelCrmFollowUpInput,
  ListCrmFollowUpsFilter,
  CrmFollowUpStatus,
} from '@watchdog-bms/contracts';
import {
  ListCrmFollowUpsUseCase,
  CreateCrmFollowUpUseCase,
  UpdateCrmFollowUpUseCase,
  CompleteCrmFollowUpUseCase,
  SnoozeCrmFollowUpUseCase,
  CancelCrmFollowUpUseCase,
} from '../../application/use-cases/crm-follow-up.use-case';

@ApiTags('crm')
@Controller('companies/:companyId/crm/follow-ups')
export class CrmFollowUpController {
  constructor(
    private readonly listFollowUps: ListCrmFollowUpsUseCase,
    private readonly createFollowUp: CreateCrmFollowUpUseCase,
    private readonly updateFollowUp: UpdateCrmFollowUpUseCase,
    private readonly completeFollowUp: CompleteCrmFollowUpUseCase,
    private readonly snoozeFollowUp: SnoozeCrmFollowUpUseCase,
    private readonly cancelFollowUp: CancelCrmFollowUpUseCase,
  ) {}

  @Get()
  @RequirePermissions('crm.follow_up.read')
  @ApiOperation({ summary: 'List CRM follow-ups' })
  list(
    @ReqCtx() ctx: RequestContext,
    @Query('scope') scope?: 'own' | 'all',
    @Query('status') status?: CrmFollowUpStatus,
    @Query('view') view?: 'due_today' | 'overdue' | 'upcoming',
    @Query('customerId') customerId?: string,
    @Query('opportunityId') opportunityId?: string,
    @Query('ownerUserId') ownerUserId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const filter: ListCrmFollowUpsFilter = { scope, status, view, customerId, opportunityId, ownerUserId, page: page ? Number(page) : undefined, pageSize: pageSize ? Number(pageSize) : undefined };
    return this.listFollowUps.execute(ctx, filter);
  }

  @Post()
  @RequirePermissions('crm.follow_up.create')
  @ApiOperation({ summary: 'Create CRM follow-up' })
  create(@ReqCtx() ctx: RequestContext, @Body() body: CreateCrmFollowUpInput) {
    return this.createFollowUp.execute(ctx, body);
  }

  @Patch(':followUpId')
  @RequirePermissions('crm.follow_up.update')
  @ApiOperation({ summary: 'Update CRM follow-up' })
  update(@ReqCtx() ctx: RequestContext, @Param('followUpId') followUpId: string, @Body() body: UpdateCrmFollowUpInput) {
    return this.updateFollowUp.execute(ctx, followUpId, body);
  }

  @Post(':followUpId/complete')
  @RequirePermissions('crm.follow_up.complete')
  @HttpCode(200)
  @ApiOperation({ summary: 'Complete CRM follow-up (optionally chain next task)' })
  complete(@ReqCtx() ctx: RequestContext, @Param('followUpId') followUpId: string, @Body() body: CompleteCrmFollowUpInput) {
    return this.completeFollowUp.execute(ctx, followUpId, body ?? {});
  }

  @Post(':followUpId/snooze')
  @RequirePermissions('crm.follow_up.update')
  @HttpCode(200)
  @ApiOperation({ summary: 'Snooze CRM follow-up' })
  snooze(@ReqCtx() ctx: RequestContext, @Param('followUpId') followUpId: string, @Body() body: SnoozeCrmFollowUpInput) {
    return this.snoozeFollowUp.execute(ctx, followUpId, body);
  }

  @Post(':followUpId/cancel')
  @RequirePermissions('crm.follow_up.update')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel CRM follow-up' })
  cancel(@ReqCtx() ctx: RequestContext, @Param('followUpId') followUpId: string, @Body() body: CancelCrmFollowUpInput) {
    return this.cancelFollowUp.execute(ctx, followUpId, body);
  }
}
