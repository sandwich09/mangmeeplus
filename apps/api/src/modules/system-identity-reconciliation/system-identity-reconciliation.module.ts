import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { GenerateIdentityReconciliationUseCase } from './application/use-cases/generate-identity-reconciliation.use-case';
import { ReadIdentityReconciliationUseCase } from './application/use-cases/read-identity-reconciliation.use-case';
import { ResolveIdentityReconciliationUseCase } from './application/use-cases/resolve-identity-reconciliation.use-case';
import { SystemIdentityReconciliationController } from './presentation/http/system-identity-reconciliation.controller';

@Module({
  // Every resolver command writes a CRITICAL audit row in the same transaction as the mutation,
  // so AuditService is a hard dependency, not a convenience.
  imports: [AuditModule],
  controllers: [SystemIdentityReconciliationController],
  providers: [
    GenerateIdentityReconciliationUseCase,
    ReadIdentityReconciliationUseCase,
    ResolveIdentityReconciliationUseCase,
  ],
})
export class SystemIdentityReconciliationModule {}
