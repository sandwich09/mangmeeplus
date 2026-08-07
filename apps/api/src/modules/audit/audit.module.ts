import { Module } from '@nestjs/common';
import { LoggerModule } from '../../common/logger/logger.module';
import { AuditService, AUDIT_REPOSITORY_TOKEN } from './application/audit.service';
import { PrismaAuditRepository } from './infrastructure/prisma-audit.repository';
import { AuditController } from './presentation/audit.controller';

@Module({
  // LoggerModule supplies LOGGER_TOKEN for the audit.persist.failed event (L-10).
  imports: [LoggerModule],
  controllers: [AuditController],
  providers: [
    {
      provide: AUDIT_REPOSITORY_TOKEN,
      useClass: PrismaAuditRepository,
    },
    AuditService,
  ],
  exports: [AuditService],
})
export class AuditModule {}
