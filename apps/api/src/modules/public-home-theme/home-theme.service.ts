import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { HOME_THEME_MANAGE_PERMISSION, isHomeEvent, resolveHomeEvent, type HomeThemeSetting, type SetHomeTheme } from '@watchdog-bms/contracts';
import { PrismaService } from '../../common/database/prisma.service';
import type { RequestContext } from '../auth/domain/models/request-context.model';

const ID = 'homepage';
const toSetting = (row: { event: string; version: number; updatedAt: Date } | null): HomeThemeSetting => ({
  event: resolveHomeEvent(row?.event), version: row?.version ?? 0, updatedAt: row?.updatedAt.toISOString() ?? null,
});

@Injectable()
export class HomeThemeService {
  constructor(private readonly prisma: PrismaService) {}

  async read(): Promise<HomeThemeSetting> {
    return toSetting(await this.prisma.client.publicHomeThemeSetting.findUnique({ where: { id: ID } }));
  }

  assertAdmin(context: RequestContext) {
    if (!context.roles.includes('SYSTEM_ADMIN') || !context.permissions.includes(HOME_THEME_MANAGE_PERMISSION)) {
      throw new ForbiddenException('Homepage theme management requires a platform administrator.');
    }
  }

  async set(command: SetHomeTheme, context: RequestContext): Promise<HomeThemeSetting> {
    this.assertAdmin(context);
    if (!isHomeEvent(command.event) || !Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 0) {
      throw new BadRequestException('Invalid installed theme or version.');
    }
    return this.prisma.client.$transaction(async (tx) => {
      // ponytail: one rare platform setting, so serialize its writes (including first creation).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'public-home-theme'}))`;
      const existing = await tx.publicHomeThemeSetting.findUnique({ where: { id: ID } });
      const before = toSetting(existing);
      if (before.version !== command.expectedVersion) {
        throw new ConflictException({ code: 'home_theme_conflict', message: 'Reload the current homepage theme before saving.' });
      }
      if ((existing?.event ?? 'default') === command.event) return before;
      const data = { event: command.event, version: before.version + 1, updatedBySystemAdminUserId: context.userId };
      const saved = await tx.publicHomeThemeSetting.upsert({ where: { id: ID }, create: { id: ID, ...data }, update: data });
      await tx.auditLog.create({ data: {
        actorUserId: context.userId, action: 'system.home_theme.update', targetType: 'public_home_theme', targetId: ID,
        requestId: context.requestId, result: 'SUCCESS', riskLevel: 'HIGH',
        metadataJson: { fromEvent: existing?.event ?? 'default', toEvent: saved.event, fromVersion: before.version, toVersion: saved.version },
      } });
      return toSetting(saved);
    });
  }
}
