import { Controller, Get, Headers, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../../../common/security/public.decorator';
import { assertWorkerToken } from '../../../../common/security/worker-token';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { GetPlanTermNoticeUseCase } from '../../application/use-cases/company-plan-term.use-cases';
import { PlanTermSweepUseCase } from '../../application/use-cases/plan-term-sweep.use-case';

type AuthedRequest = Request & { context: RequestContext };

/**
 * The customer's own read of their term. Any member may call it — the payload carries no limits
 * and no tier, only the state the shell needs to render the yellow banner (OWNER) or the neutral
 * expired screen (staff). AuthGuard exempts this path from the expiry block, so it keeps
 * answering after the deadline; that is the whole point of it.
 */
@Controller('plan-term')
export class PlanTermNoticeController {
  constructor(private readonly notice: GetPlanTermNoticeUseCase) {}

  @Get('notice')
  @RequirePermissions('account.session.read')
  @ApiOperation({ summary: 'Plan term state of the caller\'s current company (null when unlimited)' })
  @ApiResponse({ status: 200 })
  async get(@Req() req: AuthedRequest, @Res() res: Response) {
    // Nest's default null response has an empty body; clients require JSON null for unlimited terms.
    return res.json(await this.notice.execute(req.context.companyId, req.context.roles));
  }
}

@Public()
@Controller('internal/plan-term')
export class PlanTermInternalController {
  constructor(private readonly sweep: PlanTermSweepUseCase) {}

  // ponytail: no request body. The worker posts `{}` and the batch bound belongs to the sweep,
  // not to an unvalidated caller-supplied number.
  @Post('sweep')
  execute(@Headers('x-worker-token') token: string | undefined) {
    assertWorkerToken(token);
    return this.sweep.execute();
  }
}
