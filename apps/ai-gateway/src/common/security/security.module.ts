import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DenyByDefaultGuard } from './deny-by-default.guard';

@Module({
  providers: [
    {
      provide: APP_GUARD,
      useClass: DenyByDefaultGuard,
    },
  ],
})
export class SecurityModule {}
