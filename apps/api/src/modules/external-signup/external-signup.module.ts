import { Module } from '@nestjs/common';
import { CompanySignupCoreService } from './application/company-signup-core.service';

@Module({
  providers: [CompanySignupCoreService],
  exports: [CompanySignupCoreService],
})
export class ExternalSignupModule {}
