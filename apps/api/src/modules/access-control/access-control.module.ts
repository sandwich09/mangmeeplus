import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../../common/database/database.module';
import { PrismaPermissionResolverRepository } from './infrastructure/prisma-permission-resolver.repository';
import { PrismaMembershipAccessRepository } from './infrastructure/prisma-membership-access.repository';
import { PermissionResolverService } from './application/permission-resolver.service';
import { PERMISSION_RESOLVER_TOKEN } from './domain/ports/permission-resolver.port';
import { MEMBERSHIP_ACCESS_TOKEN } from './domain/ports/membership-access.port';
import { OwnRecordPolicy } from './infrastructure/policies/own-record.policy';
import { TenantBoundaryPolicy } from './infrastructure/policies/tenant-boundary.policy';
import { CompositePolicyEvaluator } from './infrastructure/policies/composite-policy-evaluator';
import { POLICY_EVALUATOR_TOKEN } from './domain/ports/policy-evaluator.port';

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: PERMISSION_RESOLVER_TOKEN,
      useClass: PrismaPermissionResolverRepository,
    },
    {
      provide: MEMBERSHIP_ACCESS_TOKEN,
      useClass: PrismaMembershipAccessRepository,
    },
    PermissionResolverService,
    OwnRecordPolicy,
    TenantBoundaryPolicy,
    {
      provide: POLICY_EVALUATOR_TOKEN,
      useFactory: (own: OwnRecordPolicy, tenant: TenantBoundaryPolicy) =>
        new CompositePolicyEvaluator([own, tenant]),
      inject: [OwnRecordPolicy, TenantBoundaryPolicy],
    },
  ],
  exports: [PermissionResolverService, POLICY_EVALUATOR_TOKEN],
})
export class AccessControlModule {}
