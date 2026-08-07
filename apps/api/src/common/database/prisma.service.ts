import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type PrismaClient as PrismaClientType } from '../../generated/prisma/client';
import { AppConfigService } from '../config/app-config.service';

// ponytail: composition over inheritance - Prisma 7 uses adapter-based client
//           which is a factory-produced constructor, not a plain class to extend.
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly client: PrismaClientType;

  constructor(@Inject(AppConfigService) config: AppConfigService) {
    const adapter = new PrismaPg({
      connectionString: config.databaseUrl,
    });
    this.client = new PrismaClient({ adapter });
  }

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
