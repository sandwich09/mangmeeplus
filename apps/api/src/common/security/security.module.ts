import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from '../../modules/auth/auth.module';
import { AuthGuard } from '../../modules/auth/presentation/auth.guard';
import { AccessControlModule } from '../../modules/access-control/access-control.module';
import { DenyByDefaultGuard } from './deny-by-default.guard';

// Guard order matters: AuthGuard runs first (sets request.context), then DenyByDefaultGuard checks permissions
@Module({
  imports: [AuthModule, AccessControlModule],
  providers: [
    {
      provide: APP_GUARD,
      useExisting: AuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: DenyByDefaultGuard,
    },
  ],
})
export class SecurityModule {}
