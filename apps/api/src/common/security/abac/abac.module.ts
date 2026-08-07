import { Module } from '@nestjs/common';
import { OwnRecordPolicy } from './own-record.policy';
import { CompanyScopePolicy } from './company-scope.policy';

@Module({
  providers: [OwnRecordPolicy, CompanyScopePolicy],
  exports: [OwnRecordPolicy, CompanyScopePolicy],
})
export class AbacModule {}
