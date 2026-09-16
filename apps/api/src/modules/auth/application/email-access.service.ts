import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { EmailAccessChallenge, Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import { AppConfigService } from '../../../common/config/app-config.service';
import { requireLineContactEmail } from '../../external-signup/domain/line-signup.logic';
import { hashToken } from '../domain/logic/secure-token.logic';
import { emailAccessDigest, matchesEmailAccessCode, matchesEmailBrowserSecret } from '../domain/logic/email-access.logic';
import { emailReauthBinding, emailSecurityBinding, newEmailOtp, EMAIL_OTP_TTL_MS, EMAIL_OTP_COOLDOWN_MS } from '../domain/logic/email-otp.logic';
import { databaseNow, emailError, emailUserInclude, lockAccountEmail } from './account-email-state';
import { EmailDeliveryService } from './email-delivery.service';
import { PostmarkSendError } from '../infrastructure/postmark.client';
import { renderEmailOtp } from '../infrastructure/auth-email.templates';
import { IssueTokenUseCase } from './use-cases/issue-token.use-case';
import { LegalAcceptanceService } from './legal-acceptance.service';
import { PlatformAccessService } from './platform-access.service';

export type EmailAccessProof = { challengeId: string; browserSecret: string };
const invalid = () => emailError('EMAIL_ACCESS_INVALID', 'รหัสไม่ถูกต้องหรือหมดอายุ กรุณาขอรหัสใหม่', 401);

@Injectable()
export class EmailAccessService {
  constructor(private readonly prisma: PrismaService, private readonly config: AppConfigService,
    private readonly delivery: EmailDeliveryService, private readonly tokens: IssueTokenUseCase,
    private readonly legal: LegalAcceptanceService, private readonly platform: PlatformAccessService) {}

  private environment() {
    const value = this.config.isLocal || this.config.appEnv === 'local' ? 'local' : this.config.deploymentIdentity?.targetEnvironment;
    if (!value || !['local', 'uat', 'production'].includes(value)) throw emailError('EMAIL_DELIVERY_UNAVAILABLE', 'ยังส่งรหัสไม่ได้ กรุณาลองใหม่ภายหลัง', 503);
    return value;
  }
  private ready(email: string) {
    if (this.config.emailProvider !== 'postmark' || !this.config.postmarkServerId ||
        !/^[a-f0-9]{64}$/.test(this.config.emailOtpHmacKey ?? '') || !this.config.emailOtpHmacKeyVersion ||
        (this.environment() === 'uat' && !this.config.postmarkUatAllowedRecipients.includes(email))) {
      throw emailError('EMAIL_DELIVERY_UNAVAILABLE', 'ยังส่งรหัสไม่ได้ กรุณาลองใหม่ภายหลัง', 503);
    }
  }
  private async emailUsers(tx: Prisma.TransactionClient, email: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "User" WHERE lower(email) = ${email} OR lower(username) = ${email} LIMIT 2`;
    return tx.user.findMany({ where: { id: { in: rows.map(r => r.id) } }, include: emailUserInclude });
  }
  private lockRecipient(tx: Prisma.TransactionClient, email: string) {
    // Also used by authenticated email OTP: one recipient cannot bypass its mail budget.
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`email-otp-recipient:${email}`}, 0))`;
  }
  private async audit(tx: Prisma.TransactionClient, action: string, id: string, requestId: string, userId?: string) {
    await tx.auditLog.create({ data: { actorType: userId ? 'USER' : 'SERVICE', actorUserId: userId,
      actorRefId: userId ? undefined : 'email-access', action, targetType: 'EmailAccessChallenge', targetId: id,
      requestId, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { policy: 'EMAIL_ACCESS_V1' } } });
  }

  async request(input: { email: string; browserSecret: string; requestKey: string; requestId: string }) {
    let email: string;
    try { email = requireLineContactEmail(input.email); } catch { throw emailError('EMAIL_SIGNUP_INPUT_INVALID', 'กรุณาตรวจอีเมลอีกครั้ง', 400); }
    if (!/^[A-Za-z0-9_-]{43}$/.test(input.browserSecret)) throw invalid();
    this.ready(email);
    const code = newEmailOtp();
    const result = await this.prisma.client.$transaction(async tx => {
      await this.lockRecipient(tx, email);
      const replay = await tx.emailAccessChallenge.findUnique({ where: { requestKey: input.requestKey } });
      if (replay) {
        if (replay.email !== email || !matchesEmailBrowserSecret(input.browserSecret, replay.browserSecretHash)) throw invalid();
        return { token: replay, attempt: null };
      }
      const now = await databaseNow(tx);
      const recent = await tx.emailAccessChallenge.findMany({ where: { email, createdAt: { gt: new Date(now.getTime() - 86_400_000) } }, orderBy: { createdAt: 'desc' } });
      const hour = recent.filter(t => t.createdAt.getTime() > now.getTime() - 3_600_000);
      const other = await tx.emailVerificationToken.findMany({ where: { newEmail: email, proofKind: 'OTP', createdAt: { gt: new Date(now.getTime() - 3_600_000) } }, select: { createdAt: true } });
      const combined = [...hour, ...other].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      const retryAt = Math.max(recent[0] ? recent[0].createdAt.getTime() + EMAIL_OTP_COOLDOWN_MS : 0,
        combined.length >= 5 ? combined[0]!.createdAt.getTime() + 3_600_000 : 0,
        recent.length >= 10 ? recent[recent.length - 1]!.createdAt.getTime() + 86_400_000 : 0);
      if (retryAt > now.getTime()) throw emailError('EMAIL_OTP_RATE_LIMITED', 'กรุณารอก่อนขอรหัสใหม่', 429, { retryAfterSeconds: Math.ceil((retryAt - now.getTime()) / 1000) });
      const users = await this.emailUsers(tx, email);
      const user = users.length === 1 ? users[0] : null;
      const id = randomUUID(), expiresAt = new Date(now.getTime() + EMAIL_OTP_TTL_MS);
      let attempt;
      try { attempt = await this.delivery.prepare({ purpose: 'email_access', recipient: email, intentKey: `email-access:${id}`, deadlineAt: expiresAt }, tx); }
      catch (error) {
        if (error instanceof PostmarkSendError) throw emailError('EMAIL_DELIVERY_UNAVAILABLE', 'ยังส่งรหัสไม่ได้ กรุณาตรวจอีเมลหรือติดต่อทีมงาน', 503);
        throw error;
      }
      await tx.emailAccessChallenge.updateMany({ where: { email, status: { in: ['PENDING', 'VERIFIED'] } }, data: { status: 'REVOKED' } });
      const binding = { id, email, browserSecretHash: hashToken(input.browserSecret), keyVersion: this.config.emailOtpHmacKeyVersion!, environment: this.environment(),
        userId: user?.id ?? null, securityBindingHash: user ? emailSecurityBinding(user) : null, expiresAt };
      const token = await tx.emailAccessChallenge.create({ data: { ...binding, requestKey: input.requestKey,
        codeHash: emailAccessDigest(code, binding, this.config.emailOtpHmacKey!), sendAttemptId: attempt.id, createdAt: now } });
      await this.audit(tx, 'auth.email_access.requested', id, input.requestId);
      return { token, attempt };
    });
    if (result.attempt) {
      try {
        const content = renderEmailOtp(code, result.token.expiresAt);
        await this.delivery.send(result.attempt, { ...content, subject: 'รหัสสมัครหรือเข้าสู่ระบบมั่งมี' }, async () => {
          const token = await this.prisma.client.emailAccessChallenge.findUnique({ where: { id: result.token.id } });
          if (!token || token.status !== 'PENDING' || token.expiresAt <= new Date()) throw invalid();
        });
      } catch {
        await this.prisma.client.emailSendAttempt.updateMany({ where: { id: result.attempt.id, status: 'READY', dispatchStartedAt: null }, data: { status: 'PERMANENT', errorCode: 'email_access_not_dispatched' } });
      }
    }
    const attempt = result.token.sendAttemptId ? await this.prisma.client.emailSendAttempt.findUnique({ where: { id: result.token.sendAttemptId } }) : null;
    return { challengeId: result.token.id, expiresAt: result.token.expiresAt.toISOString(),
      retryAt: new Date(result.token.createdAt.getTime() + EMAIL_OTP_COOLDOWN_MS).toISOString(), deliveryStatus: attempt?.status ?? 'CONFIG' };
  }

  async inspect(input: EmailAccessProof) {
    const token = await this.prisma.client.emailAccessChallenge.findUnique({ where: { id: input.challengeId } });
    if (!token || !matchesEmailBrowserSecret(input.browserSecret, token.browserSecretHash) || token.expiresAt <= new Date() ||
        token.environment !== this.environment() || token.keyVersion !== this.config.emailOtpHmacKeyVersion) throw invalid();
    if (token.status === 'VERIFIED') return { kind: 'SIGNUP' as const };
    if (token.status !== 'PENDING') throw invalid();
    const attempt = token.sendAttemptId ? await this.prisma.client.emailSendAttempt.findUnique({ where: { id: token.sendAttemptId } }) : null;
    return { kind: 'CODE' as const, email: token.email, retryAt: new Date(token.createdAt.getTime() + EMAIL_OTP_COOLDOWN_MS).toISOString(), deliveryStatus: attempt?.status ?? 'CONFIG' };
  }

  async requireSignupProof(tx: Prisma.TransactionClient, input: EmailAccessProof) {
    const candidate = await tx.emailAccessChallenge.findUnique({ where: { id: input.challengeId } });
    if (!candidate) throw invalid();
    if (candidate.userId) await lockAccountEmail(tx, candidate.userId);
    await this.lockRecipient(tx, candidate.email);
    const token = await tx.emailAccessChallenge.findUniqueOrThrow({ where: { id: candidate.id } });
    if (token.status !== 'VERIFIED' || token.expiresAt <= await databaseNow(tx) ||
        token.environment !== this.environment() || token.keyVersion !== this.config.emailOtpHmacKeyVersion ||
        !matchesEmailBrowserSecret(input.browserSecret, token.browserSecretHash)) throw invalid();
    // A concurrent provisioning bind requires a fresh read/OTP, never inverted recipient→account locks.
    if (token.userId !== candidate.userId) throw invalid();
    if (token.userId) {
      const user = await tx.user.findUnique({ where: { id: token.userId }, include: emailUserInclude });
      if (!user || user.status !== 'ACTIVE' || !user.emailLoginEnabledAt || !user.emailVerifiedAt ||
          user.email?.toLowerCase() !== token.email || user.isSystemProtected || user.credential?.status === 'DISABLED' ||
          emailSecurityBinding(user) !== token.securityBindingHash || await tx.companyMembership.findFirst({
            where: { userId: user.id, roles: { some: { role: { key: 'SYSTEM_ADMIN' } } } }, select: { id: true },
          })) throw invalid();
    }
    return token;
  }

  async confirm(input: EmailAccessProof & { code: string; requestId: string }) {
    const candidate = await this.prisma.client.emailAccessChallenge.findUnique({ where: { id: input.challengeId } });
    if (!candidate) throw invalid();
    const result = await this.prisma.client.$transaction(async tx => {
      // Company/member first, then account, then recipient. Password/email writers use account→recipient.
      const membership = candidate.userId ? await this.lockMembership(tx, candidate.userId) : null;
      if (candidate.userId) await lockAccountEmail(tx, candidate.userId);
      await this.lockRecipient(tx, candidate.email);
      const token = await tx.emailAccessChallenge.findUniqueOrThrow({ where: { id: candidate.id } });
      const now = await databaseNow(tx);
      if (token.status !== 'PENDING' || token.expiresAt <= now || token.environment !== this.environment() ||
          token.keyVersion !== this.config.emailOtpHmacKeyVersion || !matchesEmailBrowserSecret(input.browserSecret, token.browserSecretHash)) return { error: true } as const;
      if (!matchesEmailAccessCode(input.code, token.codeHash, token, this.config.emailOtpHmacKey ?? '')) {
        const failedAttempts = token.failedAttempts + 1;
        await tx.emailAccessChallenge.update({ where: { id: token.id }, data: { failedAttempts, ...(failedAttempts >= 5 ? { status: 'REVOKED' } : {}) } });
        await this.audit(tx, 'auth.email_access.invalid', token.id, input.requestId);
        return { error: true, attemptsRemaining: 5 - failedAttempts } as const;
      }
      const users = await this.emailUsers(tx, token.email);
      if (!token.userId && !users.length) {
        await tx.emailAccessChallenge.update({ where: { id: token.id }, data: { status: 'VERIFIED', verifiedAt: now, expiresAt: new Date(now.getTime() + EMAIL_OTP_TTL_MS) } });
        await this.audit(tx, 'auth.email_access.signup_verified', token.id, input.requestId);
        return { kind: 'SIGNUP' as const };
      }
      const user = users.length === 1 ? users[0] : null;
      if (!user || user.id !== token.userId || user.status !== 'ACTIVE' ||
          token.securityBindingHash !== emailSecurityBinding(user)) return { error: true } as const;
      const privileged = user.isSystemProtected || await tx.companyMembership.findFirst({ where: { userId: user.id, roles: { some: { role: { key: 'SYSTEM_ADMIN' } } } }, select: { id: true } });
      const unfinished = user.emailLoginEnabledAt && await tx.companySignupRequest.findFirst({ where: { source: 'email-otp', contactEmail: token.email,
        ownerUserId: user.id, state: { in: ['PROVISIONING', 'PROVISIONING_FAILED', 'READY'] } }, select: { id: true } });
      if (unfinished && !privileged) {
        await tx.emailAccessChallenge.update({ where: { id: token.id }, data: { status: 'VERIFIED', verifiedAt: now, signupRequestId: unfinished.id, expiresAt: new Date(now.getTime() + EMAIL_OTP_TTL_MS) } });
        return { kind: 'SIGNUP' as const };
      }
      if (!user.emailLoginEnabledAt || !user.emailVerifiedAt || user.email?.trim().toLowerCase() !== token.email || !membership || privileged || user.credential?.status === 'DISABLED') {
        await tx.emailAccessChallenge.update({ where: { id: token.id }, data: { status: 'USED', usedAt: now } });
        return { kind: 'EXISTING_LOGIN_REQUIRED' as const };
      }
      return this.login(tx, token, user, membership, now, input.requestId);
    });
    if ('error' in result) {
      if ('attemptsRemaining' in result && typeof result.attemptsRemaining === 'number' && result.attemptsRemaining > 0) throw emailError('EMAIL_OTP_INVALID', 'รหัสไม่ถูกต้อง กรุณาตรวจรหัสจากอีเมลล่าสุด', 400, { attemptsRemaining: result.attemptsRemaining });
      throw invalid();
    }
    return result;
  }

  async lockMembership(tx: Prisma.TransactionClient, userId: string) {
    const eligible = { userId, status: 'ACTIVE' as const, company: { OR: [{ status: 'ACTIVE' as const }, { status: 'DISABLED' as const, planTerm: { termDisabledAt: { not: null } } }] } };
    const candidate = await tx.companyMembership.findFirst({ where: eligible, orderBy: { createdAt: 'asc' }, select: { id: true, companyId: true } });
    if (!candidate) return null;
    await tx.$queryRaw`SELECT id FROM "Company" WHERE id = ${candidate.companyId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "CompanyMembership" WHERE id = ${candidate.id} FOR SHARE`;
    return tx.companyMembership.findFirst({ where: { ...eligible, id: candidate.id }, include: { roles: { include: { role: true } } } });
  }

  async login(tx: Prisma.TransactionClient, token: EmailAccessChallenge,
    user: Prisma.UserGetPayload<{ include: typeof emailUserInclude }>,
    membership: NonNullable<Awaited<ReturnType<EmailAccessService['lockMembership']>>>, now: Date, requestId: string) {
    if ((await this.platform.getStatus()).effectiveState === 'CLOSED') throw emailError('platform_access_closed', 'ระบบยังไม่เปิดให้เข้าใช้งาน กรุณาลองใหม่ภายหลัง', 403);
    const legal = await this.legal.getStatus({ userId: user.id, companyId: membership.companyId, membershipId: membership.id });
    await tx.emailAccessChallenge.update({ where: { id: token.id }, data: { status: 'USED', usedAt: now } });
    const tokens = await this.tokens.execute(user.id, 'email', { tx, reauthBinding: emailReauthBinding(user), now });
    await this.audit(tx, 'auth.email_access.login', token.id, requestId, user.id);
    return { kind: 'LOGIN' as const, ...tokens, companyId: membership.companyId,
      passwordChangeRequired: Boolean(user.credential?.mustChangePassword), legalAcceptanceRequired: legal.required,
      redirectPath: `/companies/${membership.companyId}/dashboard` };
  }
}
