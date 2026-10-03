import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { ExecutiveReportBuildUseCase } from './application/executive-report-build.use-case';
import { ExecutiveInternalController } from './presentation/http/executive-internal.controller';

/**
 * Executive report — the build half (executive backend spec §12.3, plan stage S2): the summary
 * tables and the worker endpoint that fills them. The executive roles, account commands and read
 * API live in their own module class of this folder.
 *
 * BillingModule: money reaches the report only through billing's own reader
 * (`BillingCashMovementsService`); nothing here reads a billing table or the provider.
 * The use case is exported for the read API, which answers from the rows it writes.
 */
@Module({
  imports: [BillingModule],
  controllers: [ExecutiveInternalController],
  providers: [ExecutiveReportBuildUseCase],
  exports: [ExecutiveReportBuildUseCase],
})
export class ExecutiveReportBuildModule {}
