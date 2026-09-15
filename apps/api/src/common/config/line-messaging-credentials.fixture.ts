import { LineMessagingCredentialsService } from './line-messaging-credentials.service';
import type { AppConfigService } from './app-config.service';
import type { PrismaService } from '../database/prisma.service';

/** Unit-only environment fixture. AppModule/HTTP tests use the real database-backed provider. */
export function lineMessagingCredentialsFixture(config?: Partial<AppConfigService> | null) {
  return new LineMessagingCredentialsService({ client: { platformLineCredential: { findUnique: async () => null } } } as unknown as PrismaService,
    (config ?? {}) as AppConfigService);
}
