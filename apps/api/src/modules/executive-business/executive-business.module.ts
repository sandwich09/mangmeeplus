import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ExecutiveUsersService } from './application/executive-users.service';
import { ExecutiveUsersController } from './presentation/http/executive-users.controller';

@Module({ imports: [AuditModule], controllers: [ExecutiveUsersController], providers: [ExecutiveUsersService] })
export class ExecutiveBusinessModule {}
