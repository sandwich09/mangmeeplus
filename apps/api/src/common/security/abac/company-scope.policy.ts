import { Injectable } from '@nestjs/common';
import type { RequestContext } from '../../../modules/auth/domain/models/request-context.model';
import type { AbacPolicy } from './abac-policy.port';

// ponytail: placeholder - real policy per feature module when resource shape is known
@Injectable()
export class CompanyScopePolicy implements AbacPolicy<{ companyId: string }> {
  can(context: RequestContext, resource: { companyId: string }): boolean {
    return resource.companyId === context.companyId;
  }
}
