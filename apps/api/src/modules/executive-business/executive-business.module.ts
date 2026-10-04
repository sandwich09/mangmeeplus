import { CompanyTeamNoteModule } from '../system-partner-management/company-team-note.module';
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { BillingModule } from '../billing/billing.module';
import { ExecutiveReportReadService } from './application/executive-report-read.service';
import { ExecutiveUsersService } from './application/executive-users.service';
import { ExecutiveReportController, ExecutiveReportExceptionFilter } from './presentation/http/executive-report.controller';
import { ExecutiveUsersController } from './presentation/http/executive-users.controller';

/** Executive accounts (E1) and the report's read API (E3). BillingModule: the company history reads purchases through billing's own reader. */
@Module({
  imports: [AuditModule, BillingModule, CompanyTeamNoteModule],
  controllers: [ExecutiveUsersController, ExecutiveReportController],
  providers: [ExecutiveUsersService, ExecutiveReportReadService, ExecutiveReportExceptionFilter],
})
export class ExecutiveBusinessModule {}
