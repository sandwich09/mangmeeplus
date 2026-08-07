import { ForbiddenException } from '@nestjs/common';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';

export function assertRouteCompany(ctx: RequestContext, routeCompanyId: string): void {
  if (ctx.companyId !== routeCompanyId) {
    throw new ForbiddenException('Route company does not match request context.');
  }
}
