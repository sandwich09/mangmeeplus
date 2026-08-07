import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { emitSecurityEvent, SECURITY_EVENT } from '../../../../common/logger/security-event';
import { AuditService } from '../../../audit/application/audit.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import { pushSystemLineMessage } from '../../infrastructure/system-line-push';

// Identical reply for unknown, ineligible, owner and notified accounts: the
// caller must not be able to tell accounts apart (no enumeration).
const GENERIC_MESSAGE = 'If the account is eligible, an administrator has been notified.';

@Injectable()
export class NotifyPasswordResetRequestUseCase {
  private readonly logger = new Logger(NotifyPasswordResetRequestUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    @Optional() @Inject(AuditService) private readonly audit: AuditService | null = null,
  ) {}

  /**
   * L-06: fixed minimum-duration envelope. The body, status and headers are already
   * identical for every outcome; what still leaked was the round-trip count — one query
   * for an unknown identifier against four to six for an eligible one. The floor is a
   * single constant for all branches: per-branch floors or added jitter would themselves
   * be a signal.
   */
  async execute(input: { username: string; requestId?: string }): Promise<{ message: string }> {
    const startedAt = Date.now();
    try {
      return await this.notify(input);
    } finally {
      const remainingMs = this.config.passwordResetResponseMinMs - (Date.now() - startedAt);
      if (remainingMs > 0) await delay(remainingMs);
    }
  }

  private async notify(input: { username: string; requestId?: string }): Promise<{ message: string }> {
    const username = input.username.trim().toLowerCase();
    const requestId = input.requestId ?? 'system';

    const deny = async (reason: string, userId?: string, companyId?: string): Promise<{ message: string }> => {
      emitSecurityEvent(this.logger, SECURITY_EVENT.authPasswordResetDenied, 'HIGH', { reason, requestId });
      await this.audit?.log({
        action: AuditAction.AUTH_PASSWORD_RESET_REQUEST,
        actorUserId: userId,
        companyId,
        targetType: 'User',
        targetId: userId,
        requestId,
        result: 'DENIED',
        riskLevel: 'MEDIUM',
        metadataJson: { reason },
      });
      return { message: GENERIC_MESSAGE };
    };

    const user = await this.prisma.client.user.findFirst({
      where: { username },
      include: { credential: true },
    });
    if (!user) return deny('unknown_username');
    if (user.status !== 'ACTIVE' || !user.credential || user.credential.status === 'DISABLED') {
      return deny('ineligible_account', user.id);
    }

    // Same membership selection as password login: oldest ACTIVE membership in an
    // ACTIVE company is the one the account actually signs in with.
    const membership = await this.prisma.client.companyMembership.findFirst({
      where: { userId: user.id, status: 'ACTIVE', company: { status: 'ACTIVE' } },
      select: {
        companyId: true,
        roles: { select: { role: { select: { key: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!membership) return deny('no_active_company', user.id);

    const roles = membership.roles.map((mr) => mr.role.key);
    // Owners have nobody above them in the company; the support line covers them.
    if (roles.includes('OWNER')) return deny('owner_requester', user.id, membership.companyId);

    let targets = await this.deliverableLineUserIds(membership.companyId, roles.includes('ADMIN') ? 'OWNER' : 'ADMIN');
    if (targets.length === 0 && !roles.includes('ADMIN')) {
      targets = await this.deliverableLineUserIds(membership.companyId, 'OWNER');
    }

    // Detached: awaiting LINE would make a real account answer seconds slower
    // than an unknown one, so response time itself would leak existence.
    void this.deliverAndAudit({
      text: `🔐 ${user.displayName} (${username}) ขอรีเซ็ตรหัสผ่าน\nไปที่ ตั้งค่า → ภาพรวมสิทธิ์ เลือกพนักงานคนนี้ แล้วกดเมนู "รีเซ็ตรหัสผ่าน"`,
      targets,
      userId: user.id,
      companyId: membership.companyId,
      requestId,
    }).catch(() => undefined);

    return { message: GENERIC_MESSAGE };
  }

  /** Runs after the response is on the wire; audits how many pushes actually landed. */
  private async deliverAndAudit(params: {
    text: string;
    targets: string[];
    userId: string;
    companyId: string;
    requestId: string;
  }): Promise<void> {
    const token = this.config.lineMessagingChannelAccessToken;
    let recipientCount = 0;
    if (token && params.targets.length > 0) {
      const results = await Promise.all(params.targets.map((lineUserId) => pushSystemLineMessage(token, lineUserId, params.text)));
      recipientCount = results.filter(Boolean).length;
    }

    await this.audit?.log({
      action: AuditAction.AUTH_PASSWORD_RESET_REQUEST,
      actorUserId: params.userId,
      companyId: params.companyId,
      targetType: 'User',
      targetId: params.userId,
      requestId: params.requestId,
      result: 'SUCCESS',
      riskLevel: 'MEDIUM',
      metadataJson: { channel: 'line', recipientCount },
    });
  }

  private async deliverableLineUserIds(companyId: string, roleKey: string): Promise<string[]> {
    const memberships = await this.prisma.client.companyMembership.findMany({
      where: { companyId, status: 'ACTIVE', roles: { some: { role: { key: roleKey } } } },
      select: { userId: true },
    });
    if (memberships.length === 0) return [];

    const identities = await this.prisma.client.externalIdentity.findMany({
      where: { userId: { in: memberships.map((m) => m.userId) }, provider: 'LINE', status: 'ACTIVE' },
      select: { providerUserId: true },
    });
    return [...new Set(identities.map((identity) => identity.providerUserId))];
  }
}
