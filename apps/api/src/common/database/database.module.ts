import { Global, Module } from '@nestjs/common';
import { LineMessagingCredentialsService } from '../config/line-messaging-credentials.service';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService, LineMessagingCredentialsService],
  exports: [PrismaService, LineMessagingCredentialsService],
})
export class DatabaseModule {}
