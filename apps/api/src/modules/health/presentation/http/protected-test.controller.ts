import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';

@Controller('test')
export class ProtectedTestController {
  @Get('protected')
  @RequirePermissions('health.read')
  protectedRoute(@Req() req: Request & { context: RequestContext }): object {
    return { ok: true, userId: req.context.userId };
  }
}
