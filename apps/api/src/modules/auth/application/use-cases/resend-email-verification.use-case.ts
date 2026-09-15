import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { generateRawToken, hashToken } from '../../domain/logic/secure-token.logic';
import { AUTH_MAILER_TOKEN, type AuthMailerPort } from '../../domain/ports/auth-mailer.port';
import { AuditService } from '../../../audit/application/audit.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { assertEmailDeliveryEnabled } from '../email-delivery.policy';

const EMAIL_VERIFICATION_TTL_MS = 15 * 60 * 1000;

@Injectable()
export class ResendEmailVerificationUseCase {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUTH_MAILER_TOKEN) private readonly mailer: AuthMailerPort,
    @Optional() @Inject(AuditService) private readonly audit: AuditService | null = null,
    @Optional() @Inject(AppConfigService) private readonly config: AppConfigService | null = null,
  ) {}

  async execute(input: { userId: string; requestId?: string }): Promise<{ email: string; expiresAt: string }> {
    // Refused before the pending token is revoked: a resend the environment cannot honour must
    // not burn the link that was already sent.
    assertEmailDeliveryEnabled(this.config);
    const now = new Date();
    const pending = await this.prisma.client.emailVerificationToken.findFirst({
      where: {
        userId: input.userId,
        status: 'PENDING',
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!pending) {
      throw new NotFoundException('No pending email verification request was found.');
    }

    const rawToken = generateRawToken();
    const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS);

    await this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`account-email:${input.userId}`}))`;
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${input.userId} FOR UPDATE`;
      const current = await tx.user.findUnique({ where: { id: input.userId }, select: { status: true } });
      const original = await tx.emailVerificationToken.findFirst({
        where: { id: pending.id, userId: input.userId, status: 'PENDING', expiresAt: { gt: new Date() } },
      });
      if (current?.status !== 'ACTIVE' || !original || original.newEmail !== pending.newEmail) {
        throw new NotFoundException('No pending email verification request was found.');
      }
      await tx.emailVerificationToken.updateMany({
        where: { userId: input.userId, status: 'PENDING' },
        data: { status: 'REVOKED' },
      });
      await tx.emailVerificationToken.create({
        data: {
          userId: input.userId,
          newEmail: pending.newEmail,
          tokenHash: hashToken(rawToken),
          expiresAt,
        },
      });
    });

    await this.mailer.sendEmailVerification({ toEmail: pending.newEmail, rawToken, expiresAt });
    await this.audit?.log({
      action: AuditAction.AUTH_EMAIL_CHANGE_REQUEST,
      actorUserId: input.userId,
      targetType: 'User',
      targetId: input.userId,
      requestId: input.requestId ?? 'system',
      result: 'SUCCESS',
      riskLevel: 'MEDIUM',
      metadataJson: { email: pending.newEmail, resend: true },
    });

    return { email: pending.newEmail, expiresAt: expiresAt.toISOString() };
  }
}
