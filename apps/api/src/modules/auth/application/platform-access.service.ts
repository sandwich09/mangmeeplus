import { ConflictException, Injectable } from '@nestjs/common';
import type { PlatformAccessState } from '../../../generated/prisma/client';
import { AppConfigService } from '../../../common/config/app-config.service';
import { PrismaService } from '../../../common/database/prisma.service';
import { AuditService } from '../../audit/application/audit.service';
import { AuditAction } from '../../audit/domain/models/audit-action';

const PLATFORM_ACCESS_ID = 'platform';

export type PlatformAccessStatus = {
  requestedState: PlatformAccessState;
  effectiveState: PlatformAccessState;
  canOpen: boolean;
  servingMode: 'live' | 'maintenance_only' | 'non-production' | 'unknown';
  updatedAt: string | null;
  updatedBySystemAdminUserId: string | null;
  reason: string | null;
};

@Injectable()
export class PlatformAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
  ) {}

  private runtime(): { production: boolean; servingMode: PlatformAccessStatus['servingMode']; canOpen: boolean } {
    const production = this.config.deploymentIdentity.targetEnvironment === 'production';
    if (!production) return { production, servingMode: 'non-production', canOpen: true };
    const servingMode = this.config.productionServingMode ?? 'unknown';
    return { production, servingMode, canOpen: servingMode === 'live' };
  }

  async getStatus(): Promise<PlatformAccessStatus> {
    const runtime = this.runtime();
    let row: {
      state: PlatformAccessState;
      updatedAt: Date;
      updatedBySystemAdminUserId: string | null;
      reason: string | null;
    } | null = null;
    let readable = true;
    try {
      row = await this.prisma.client.platformAccessControl.findUnique({ where: { id: PLATFORM_ACCESS_ID } });
    } catch {
      // A maintenance bootstrap deliberately does not migrate production. The onboarding admin
      // may still log in, but unreadable control state must never become permission to open.
      readable = false;
    }

    const requestedState = row?.state ?? (runtime.production ? 'CLOSED' : 'OPEN');
    const forcedClosed = runtime.production && runtime.servingMode !== 'live';
    return {
      requestedState,
      effectiveState: forcedClosed || !readable ? 'CLOSED' : requestedState,
      canOpen: readable && runtime.canOpen,
      servingMode: runtime.servingMode,
      updatedAt: row?.updatedAt.toISOString() ?? null,
      updatedBySystemAdminUserId: row?.updatedBySystemAdminUserId ?? null,
      reason: row?.reason ?? null,
    };
  }

  async setState(input: {
    state: PlatformAccessState;
    reason?: string;
    actorUserId: string;
    requestId: string;
  }): Promise<PlatformAccessStatus> {
    const before = await this.getStatus();
    if (input.state === 'OPEN' && !before.canOpen) {
      throw new ConflictException({
        code: 'platform_access_open_unavailable',
        message: 'Customer access can open only after a verified live production release.',
      });
    }
    const reason = input.reason?.trim() || null;
    await this.prisma.client.$transaction(async (tx) => {
      await tx.platformAccessControl.upsert({
        where: { id: PLATFORM_ACCESS_ID },
        create: {
          id: PLATFORM_ACCESS_ID,
          state: input.state,
          reason,
          updatedBySystemAdminUserId: input.actorUserId,
        },
        update: {
          state: input.state,
          reason,
          updatedBySystemAdminUserId: input.actorUserId,
        },
      });
      await this.audit.log({
        actorUserId: input.actorUserId,
        action: AuditAction.PLATFORM_ACCESS_STATE_UPDATE,
        targetType: 'platform_access_control',
        targetId: PLATFORM_ACCESS_ID,
        requestId: input.requestId,
        result: 'SUCCESS',
        riskLevel: 'CRITICAL',
        metadataJson: { from: before.requestedState, to: input.state, reason },
      }, tx);
    });
    return this.getStatus();
  }
}
