import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { EmailVerificationToken, Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import { AppConfigService } from '../../../common/config/app-config.service';
import { requireLineContactEmail } from '../../external-signup/domain/line-signup.logic';
import { hashToken } from '../domain/logic/secure-token.logic';
import { verifyPassword } from '../domain/logic/password-credential.logic';
import { revokeActiveSessions } from '../domain/logic/session-revocation.logic';
import { emailOtpDigest, emailReauthBinding, emailSecurityBinding, matchesEmailOtp, newEmailOtp,
  EMAIL_OTP_COOLDOWN_MS, EMAIL_OTP_TTL_MS, EMAIL_REAUTH_TTL_MS, type OtpBinding } from '../domain/logic/email-otp.logic';
import { accountEmailState, databaseNow, emailError, emailUserInclude, lockAccountEmail } from './account-email-state';
import { EmailDeliveryService } from './email-delivery.service';
import { renderEmailOtp } from '../infrastructure/auth-email.templates';
import { PostmarkSendError } from '../infrastructure/postmark.client';

export const EMAIL_SECURITY_NOTICE_EVENT = 'auth.email.security_notice';
const OTP_REQUEST_ACTION = 'auth.email.otp.requested';
/** Shared with the company recipient OTP (billing): one wrong-code budget of 20 per hour per user. */
export const OTP_WRONG_ACTION = 'auth.email.otp.invalid';
type Caller = { companyId?: string; userId: string; tokenId: string; requestId: string };
type RequestInput = Caller & { newEmail: string; requestKey: string; expectedEmailRevision: number; currentPassword?: string };
type OtpConfig = Pick<AppConfigService, 'isLocal' | 'appEnv' | 'deploymentIdentity' | 'emailProvider' | 'postmarkServerId' |
  'emailOtpHmacKey' | 'emailOtpHmacKeyVersion' | 'postmarkUatAllowedRecipients'>;

export function emailOtpEnvironment(config: OtpConfig): string {
  if (config.isLocal || config.appEnv === 'local') return 'local';
  const environment = config.deploymentIdentity?.targetEnvironment;
  if (!['uat', 'production'].includes(environment)) throw emailError('EMAIL_DELIVERY_UNAVAILABLE', 'ยังส่งรหัสยืนยันไม่ได้ กรุณาลองใหม่ภายหลัง', 503);
  return environment;
}

export function assertEmailOtpDeliveryReady(config: OtpConfig, email: string): void {
  if (config.emailProvider !== 'postmark' || !config.postmarkServerId ||
      !/^[a-f0-9]{64}$/.test(config.emailOtpHmacKey ?? '') || !config.emailOtpHmacKeyVersion) {
    throw emailError('EMAIL_DELIVERY_UNAVAILABLE', 'ยังส่งรหัสยืนยันไม่ได้ กรุณาลองใหม่ภายหลัง', 503);
  }
  // The shared transport also enforces environment identity at its final send boundary.
  if (emailOtpEnvironment(config) === 'uat') {
    if (!config.postmarkUatAllowedRecipients.includes(email)) {
      throw emailError('EMAIL_DELIVERY_UNAVAILABLE', 'อีเมลนี้ยังไม่ได้รับอนุญาตให้รับเมลทดสอบ UAT', 503);
    }
  }
}

export async function activeSessionOf(tx: Prisma.TransactionClient, caller: { userId: string; tokenId: string }, now: Date) {
  await tx.$queryRaw`SELECT id FROM "AuthSession" WHERE "userId" = ${caller.userId}
    AND ("tokenId" = ${caller.tokenId} OR "previousTokenId" = ${caller.tokenId}) FOR SHARE`;
  const session = await tx.authSession.findFirst({ where: { userId: caller.userId, status: 'ACTIVE', expiresAt: { gt: now },
    OR: [{ tokenId: caller.tokenId }, { previousTokenId: caller.tokenId }] } });
  if (!session) throw emailError('EMAIL_REAUTH_REQUIRED', 'กรุณาเข้าสู่ระบบอีกครั้งเพื่อยืนยันอีเมล', 401);
  return session;
}

/**
 * Mail budget for one OTP request: 1/minute, 5/hour and 10/day per user and code kind, plus 5/hour per
 * recipient shared by account OTP, company recipient OTP and email access. Locks the recipient too,
 * so several accounts cannot exceed its budget. A positive result is the wait in seconds.
 */
export async function emailOtpRetryAfterSeconds(tx: Prisma.TransactionClient,
  input: { userId: string; email: string; now: Date; proofKind: string }): Promise<number> {
  const { now, email } = input;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`email-otp-recipient:${email}`}, 0))`;
  const recent = await tx.emailVerificationToken.findMany({ where: { userId: input.userId, proofKind: input.proofKind,
    createdAt: { gt: new Date(now.getTime() - 86_400_000) } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
  const hourly = recent.filter(t => t.createdAt.getTime() > now.getTime() - 3_600_000);
  const recipientRecent = await tx.emailVerificationToken.findMany({ where: { newEmail: email, proofKind: { in: ['OTP', 'BILLING_RECIPIENT'] },
    createdAt: { gt: new Date(now.getTime() - 3_600_000) } }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } });
  const accessRecent = await tx.emailAccessChallenge.findMany({ where: { email, createdAt: { gt: new Date(now.getTime() - 3_600_000) } }, select: { createdAt: true } });
  const sharedRecent = [...recipientRecent, ...accessRecent].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const retryTimes = [
    recent[0] ? recent[0].createdAt.getTime() + EMAIL_OTP_COOLDOWN_MS : 0,
    hourly.length >= 5 ? hourly[hourly.length - 1]!.createdAt.getTime() + 3_600_000 : 0,
    recent.length >= 10 ? recent[recent.length - 1]!.createdAt.getTime() + 86_400_000 : 0,
    sharedRecent.length >= 5 ? sharedRecent[0]!.createdAt.getTime() + 3_600_000 : 0,
  ];
  return Math.ceil((Math.max(...retryTimes) - now.getTime()) / 1000);
}

@Injectable()
export class AccountEmailOtpService {
  constructor(private readonly prisma: PrismaService, private readonly config: AppConfigService,
    private readonly delivery: EmailDeliveryService) {}

  private environment(): string { return emailOtpEnvironment(this.config); }

  private assertReady(email: string) { assertEmailOtpDeliveryReady(this.config, email); }

  private async session(tx: Prisma.TransactionClient, caller: Caller, now: Date) { return activeSessionOf(tx, caller, now); }

  private async audit(tx: Prisma.TransactionClient, caller: Caller, action: string, challengeId: string) {
    await tx.auditLog.create({ data: { actorType: 'USER', actorUserId: caller.userId, action,
      targetType: 'EmailVerificationToken', targetId: challengeId, requestId: caller.requestId, result: 'SUCCESS',
      riskLevel: 'HIGH', metadataJson: { challengeId } } });
  }

  private binding(token: EmailVerificationToken): OtpBinding {
    return { environment: this.environment(), id: token.id, userId: token.userId, email: token.newEmail,
      emailRevision: token.emailRevision!, securityBindingHash: token.securityBindingHash!, sessionId: token.sessionId!,
      keyVersion: token.keyVersion!, expiresAt: token.expiresAt };
  }

  private async currentBinding(tx: Prisma.TransactionClient, token: EmailVerificationToken, now: Date): Promise<boolean> {
    const user = await tx.user.findUnique({ where: { id: token.userId }, include: emailUserInclude });
    if (tx !== this.prisma.client && token.sessionId) await tx.$queryRaw`SELECT id FROM "AuthSession" WHERE id = ${token.sessionId} FOR SHARE`;
    const session = token.sessionId && await tx.authSession.findFirst({
      where: { id: token.sessionId, userId: token.userId, status: 'ACTIVE', expiresAt: { gt: now } },
    });
    return Boolean(user?.status === 'ACTIVE' && session && token.proofKind === 'OTP' &&
      token.keyVersion === this.config.emailOtpHmacKeyVersion && token.emailRevision === user.emailRevision &&
      token.securityBindingHash === emailSecurityBinding(user));
  }

  async status(userId: string, challengeId?: string) {
    const { user, pending, now, requirement } = await accountEmailState(this.prisma.client, userId);
    const token = challengeId ? await this.prisma.client.emailVerificationToken.findFirst({
      where: { id: challengeId, userId, proofKind: 'OTP' },
    }) : pending;
    if (challengeId && !token) throw emailError('EMAIL_OTP_NOT_FOUND', 'ไม่พบรายการยืนยันอีเมลนี้', 404);
    const attempt = token?.sendAttemptId && await this.prisma.client.emailSendAttempt.findUnique({ where: { id: token.sendAttemptId } });
    return { serverNow: now.toISOString(), email: user.email, emailVerified: Boolean(user.email?.trim() && user.emailVerifiedAt),
      emailRevision: user.emailRevision, emailRequirement: requirement, emailLoginEnabled: Boolean(user.emailLoginEnabledAt),
      hasPassword: Boolean(user.credential && user.credential.status !== 'DISABLED' && (!user.credential.expiresAt || user.credential.expiresAt > now)),
      lineLinked: user.externalIdentities.some(i => i.status === 'ACTIVE' && i.provider === 'LINE'),
      challenge: token ? { id: token.id, email: token.newEmail,
        status: token.status === 'PENDING' ? (token.expiresAt <= now ? 'EXPIRED' : await this.currentBinding(this.prisma.client, token, now) ? 'PENDING' : 'REVOKED') : token.status,
        expiresAt: token.expiresAt.toISOString(), retryAt: new Date(token.createdAt.getTime() + EMAIL_OTP_COOLDOWN_MS).toISOString(),
        attemptsRemaining: Math.max(0, 5 - token.failedAttempts), deliveryStatus: attempt ? attempt.status : 'CONFIG',
        delivered: Boolean(attempt && attempt.deliveredAt),
      } : null };
  }

  async setEmailLogin(input: Caller & { enabled: boolean; currentPassword?: string }) {
    await this.prisma.client.$transaction(async tx => {
      await lockAccountEmail(tx, input.userId);
      const { user, now, requirement } = await accountEmailState(tx, input.userId);
      const session = await this.session(tx, input, now);
      const credential = user.credential;
      const passwordUsable = Boolean(credential && credential.status === 'ACTIVE' && !credential.mustChangePassword && (!credential.expiresAt || credential.expiresAt > now));
      const fresh = session.emailReauthenticatedAt && now.getTime() - session.emailReauthenticatedAt.getTime() <= EMAIL_REAUTH_TTL_MS && session.emailReauthBindingHash === emailReauthBinding(user);
      if (!(passwordUsable && input.currentPassword && verifyPassword(input.currentPassword, credential!.passwordHash)) && !fresh) {
        throw emailError('EMAIL_REAUTH_REQUIRED', 'กรุณายืนยันรหัสผ่านปัจจุบัน หรือยืนยันตัวตนอีกครั้งก่อนเปลี่ยนวิธีเข้าสู่ระบบ', 403);
      }
      if (input.enabled) {
        if (requirement !== 'READY') throw emailError('EMAIL_VERIFICATION_REQUIRED', 'กรุณายืนยันอีเมลให้เรียบร้อยก่อน', 409);
        if (user.isSystemProtected || await tx.companyMembership.findFirst({ where: { userId: user.id, roles: { some: { role: { key: 'SYSTEM_ADMIN' } } } }, select: { id: true } })) {
          throw emailError('EMAIL_LOGIN_NOT_ALLOWED', 'บัญชีผู้ดูแลระบบต้องใช้วิธีเข้าสู่ระบบเดิม', 403);
        }
      } else if (!passwordUsable && !user.externalIdentities.some(i => i.provider === 'LINE' && i.status === 'ACTIVE')) {
        throw emailError('LAST_LOGIN_REQUIRED', 'กรุณาตั้งรหัสผ่านสำรองหรือเชื่อม LINE ก่อนปิดการเข้าด้วยอีเมล', 409);
      }
      const updated = await tx.user.update({ where: { id: user.id }, data: { emailLoginEnabledAt: input.enabled ? (user.emailLoginEnabledAt ?? now) : null }, include: emailUserInclude });
      await tx.emailAccessChallenge.updateMany({ where: { userId: user.id, status: { in: ['PENDING', 'VERIFIED'] } }, data: { status: 'REVOKED' } });
      await tx.authSession.update({ where: { id: session.id }, data: { emailReauthenticatedAt: now, emailReauthBindingHash: emailReauthBinding(updated) } });
      await this.audit(tx, input, input.enabled ? 'auth.email_login.enabled' : 'auth.email_login.disabled', user.id);
    });
    return this.status(input.userId);
  }

  async request(input: RequestInput) {
    let email: string;
    try { email = requireLineContactEmail(input.newEmail); }
    catch { throw emailError('EMAIL_OTP_TARGET_INVALID', 'กรุณาระบุอีเมลให้ถูกต้อง', 400); }
    const fingerprint = hashToken(JSON.stringify([email, input.expectedEmailRevision]));
    const code = newEmailOtp();
    const reserved = await this.prisma.client.$transaction(async tx => {
      await lockAccountEmail(tx, input.userId);
      const { user, now } = await accountEmailState(tx, input.userId);
      const session = await this.session(tx, input, now);
      const replay = await tx.emailVerificationToken.findUnique({ where: { userId_requestKey: { userId: input.userId, requestKey: input.requestKey } } });
      if (replay) {
        if (replay.requestFingerprint !== fingerprint) throw emailError('EMAIL_STATE_CHANGED', 'รายการนี้เปลี่ยนแล้ว กรุณาตรวจข้อมูลอีกครั้ง');
        return { id: replay.id, send: false };
      }
      if (user.emailRevision !== input.expectedEmailRevision) throw emailError('EMAIL_STATE_CHANGED', 'ข้อมูลอีเมลเปลี่ยนแล้ว กรุณาตรวจข้อมูลอีกครั้ง');
      if (user.email === email && user.emailVerifiedAt) return { id: undefined, send: false };
      this.assertReady(email);
      const credential = user.credential;
      const freshReauth = session.emailReauthenticatedAt && now.getTime() - session.emailReauthenticatedAt.getTime() <= EMAIL_REAUTH_TTL_MS &&
        session.emailReauthBindingHash === emailReauthBinding(user);
      const usablePassword = credential && credential.status !== 'DISABLED' && (!credential.expiresAt || credential.expiresAt > now);
      if (usablePassword && input.currentPassword && verifyPassword(input.currentPassword, credential.passwordHash)) {
        await tx.authSession.update({ where: { id: session.id }, data: { emailReauthenticatedAt: now, emailReauthBindingHash: emailReauthBinding(user) } });
      } else if (!freshReauth) {
        throw emailError('EMAIL_REAUTH_REQUIRED', usablePassword ? 'กรุณายืนยันรหัสผ่านปัจจุบัน' : 'กรุณายืนยันตัวตนผ่าน LINE อีกครั้ง', 403);
      }
      const taken = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "User" WHERE id <> ${user.id}
        AND (lower(email) = ${email} OR lower(username) = ${email}) LIMIT 1`;
      if (taken.length) throw emailError('EMAIL_CONFLICT', 'อีเมลนี้ใช้กับบัญชีอื่นแล้ว กรุณาใช้อีเมลอื่น');
      // Lock recipient as well as user so multiple accounts cannot exceed its mail budget.
      const retryAfterSeconds = await emailOtpRetryAfterSeconds(tx, { userId: user.id, email, now, proofKind: 'OTP' });
      if (retryAfterSeconds > 0) throw emailError('EMAIL_OTP_RATE_LIMITED', 'กรุณารอก่อนขอรหัสใหม่', 429, { retryAfterSeconds });
      const id = randomUUID(), expiresAt = new Date(now.getTime() + EMAIL_OTP_TTL_MS);
      // prepare/audit failures roll back replacement, preserving the previous working code.
      const attempt = await this.delivery.prepare({ companyId: input.companyId, purpose: 'email_verification', recipient: email, deadlineAt: expiresAt,
        intentKey: `email-otp:${id}` }, tx).catch(error => {
          if (error instanceof PostmarkSendError) throw emailError('EMAIL_DELIVERY_UNAVAILABLE', 'ยังส่งรหัสไม่ได้ กรุณาตรวจอีเมลหรือติดต่อทีมงาน', 503);
          throw error;
        });
      await tx.emailVerificationToken.updateMany({ where: { userId: user.id, status: 'PENDING' }, data: { status: 'REVOKED' } });
      const updated = await tx.user.update({ where: { id: user.id }, data: { emailRevision: { increment: 1 } }, include: emailUserInclude });
      const binding: OtpBinding = { environment: this.environment(), id, userId: user.id, email,
        emailRevision: updated.emailRevision, securityBindingHash: emailSecurityBinding(updated),
        sessionId: session.id, keyVersion: this.config.emailOtpHmacKeyVersion!, expiresAt };
      await tx.emailVerificationToken.create({ data: { id, userId: user.id, newEmail: email,
        tokenHash: emailOtpDigest(code, binding, this.config.emailOtpHmacKey!), proofKind: 'OTP',
        emailRevision: binding.emailRevision, securityBindingHash: binding.securityBindingHash,
        sessionId: session.id, keyVersion: binding.keyVersion, sendAttemptId: attempt.id,
        requestKey: input.requestKey, requestFingerprint: fingerprint, expiresAt, createdAt: now } });
      await this.audit(tx, input, OTP_REQUEST_ACTION, id);
      return { id, send: true, attempt, expiresAt };
    });
    if (reserved.send && reserved.attempt && reserved.expiresAt) {
      try {
        await this.delivery.send(reserved.attempt, renderEmailOtp(code, reserved.expiresAt), async () => {
          // Authorize after provider preflight, immediately before the only POST. Cancellation
          // after this point cannot recall mail, but it still makes its proof unusable.
          await this.prisma.client.$transaction(async tx => {
            await lockAccountEmail(tx, input.userId);
            const token = await tx.emailVerificationToken.findUniqueOrThrow({ where: { id: reserved.id } });
            const now = await databaseNow(tx);
            if (token.status !== 'PENDING' || token.expiresAt <= now || !await this.currentBinding(tx, token, now)) {
              throw new PostmarkSendError('PERMANENT', 'otp_state_changed');
            }
            await this.audit(tx, input, 'auth.email.dispatch_authorized', token.id);
          });
        });
      } catch {
        // Status/attempt owns recovery. Never replay raw code after an uncertain send.
        await this.prisma.client.emailSendAttempt.updateMany({ where: { id: reserved.attempt.id, status: 'READY', dispatchStartedAt: null },
          data: { status: 'PERMANENT', errorCode: 'otp_not_dispatched' } });
      }
    }
    return this.status(input.userId, reserved.id);
  }

  async cancel(input: Caller & { challengeId: string }) {
    await this.prisma.client.$transaction(async tx => {
      await lockAccountEmail(tx, input.userId);
      const { now } = await accountEmailState(tx, input.userId);
      await this.session(tx, input, now);
      const token = await tx.emailVerificationToken.findFirst({ where: { id: input.challengeId, userId: input.userId, proofKind: 'OTP' } });
      if (!token) throw emailError('EMAIL_OTP_NOT_FOUND', 'ไม่พบรายการยืนยันอีเมลนี้', 404);
      if (token.status !== 'PENDING') return;
      await tx.emailVerificationToken.update({ where: { id: token.id }, data: { status: 'REVOKED' } });
      await tx.user.update({ where: { id: input.userId }, data: { emailRevision: { increment: 1 } } });
      await this.audit(tx, input, 'auth.email.otp.cancelled', token.id);
    });
    return this.status(input.userId);
  }

  async resend(input: RequestInput & { challengeId: string }) {
    const previous = await this.prisma.client.emailVerificationToken.findFirst({
      where: { id: input.challengeId, userId: input.userId, proofKind: 'OTP' },
    });
    if (!previous || previous.status === 'USED' || previous.newEmail !== input.newEmail.trim().toLowerCase()) {
      throw emailError('EMAIL_STATE_CHANGED', 'รายการยืนยันเปลี่ยนแล้ว กรุณาตรวจอีเมลอีกครั้ง');
    }
    return this.request(input);
  }

  async confirm(input: Caller & { challengeId: string; code: string }) {
    const result = await this.prisma.client.$transaction(async tx => {
      await lockAccountEmail(tx, input.userId);
      const { user, now } = await accountEmailState(tx, input.userId);
      const session = await this.session(tx, input, now);
      const token = await tx.emailVerificationToken.findFirst({ where: { id: input.challengeId, userId: input.userId, proofKind: 'OTP' } });
      if (!token) return 'EMAIL_OTP_NOT_FOUND';
      if (token.sessionId !== session.id) return 'EMAIL_REAUTH_REQUIRED';
      if (token.status === 'USED' && user.email === token.newEmail && user.emailVerifiedAt?.getTime() === token.usedAt?.getTime()) return null;
      if (token.status !== 'PENDING') return 'EMAIL_STATE_CHANGED';
      if (token.expiresAt <= now) {
        await tx.emailVerificationToken.update({ where: { id: token.id }, data: { status: 'EXPIRED' } });
        return 'EMAIL_OTP_EXPIRED';
      }
      if (!await this.currentBinding(tx, token, now)) return 'EMAIL_STATE_CHANGED';
      const wrong = await tx.auditLog.count({ where: { actorUserId: input.userId, action: OTP_WRONG_ACTION,
        createdAt: { gt: new Date(now.getTime() - 3_600_000) } } });
      if (wrong >= 20) {
        const first = await tx.auditLog.findFirstOrThrow({ where: { actorUserId: input.userId, action: OTP_WRONG_ACTION, createdAt: { gt: new Date(now.getTime() - 3_600_000) } }, orderBy: { createdAt: 'asc' } });
        throw emailError('EMAIL_OTP_RATE_LIMITED', 'กรุณารอก่อนลองยืนยันใหม่', 429, { retryAfterSeconds: Math.max(1, Math.ceil((first.createdAt.getTime() + 3_600_000 - now.getTime()) / 1000)) });
      }
      if (!this.config.emailOtpHmacKey) return 'EMAIL_DELIVERY_UNAVAILABLE';
      if (!matchesEmailOtp(input.code, token.tokenHash, this.binding(token), this.config.emailOtpHmacKey)) {
        const failedAttempts = token.failedAttempts + 1;
        await tx.emailVerificationToken.update({ where: { id: token.id }, data: {
          failedAttempts, ...(failedAttempts >= 5 ? { status: 'REVOKED' } : {}),
        } });
        await this.audit(tx, input, OTP_WRONG_ACTION, token.id);
        return failedAttempts >= 5 ? 'EMAIL_OTP_ATTEMPTS_EXCEEDED' : 'EMAIL_OTP_INVALID';
      }
      const taken = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "User" WHERE id <> ${user.id}
        AND (lower(email) = ${token.newEmail} OR lower(username) = ${token.newEmail}) LIMIT 1`;
      if (taken.length) return 'EMAIL_CONFLICT';
      await tx.user.update({ where: { id: user.id }, data: { email: token.newEmail, emailVerifiedAt: now, emailRevision: { increment: 1 } } });
      await tx.emailVerificationToken.update({ where: { id: token.id }, data: { status: 'USED', usedAt: now } });
      await tx.emailVerificationToken.updateMany({ where: { userId: user.id, status: 'PENDING' }, data: { status: 'REVOKED' } });
      await tx.passwordResetToken.updateMany({ where: { userId: user.id, status: 'PENDING' }, data: { status: 'REVOKED' } });
      await revokeActiveSessions(tx.authSession, { userId: user.id, exceptTokenId: session.tokenId, now });
      await this.audit(tx, input, 'auth.email.verified', token.id);
      // No OTP in outbox. The old trusted recipient lives in the existing delivery record.
      let noticeAttemptId: string | undefined;
      if (user.email && user.emailVerifiedAt) {
        const notice = await tx.emailSendAttempt.create({ data: { id: randomUUID(), intentKey: `email-security:${token.id}`, generation: 1,
          companyId: input.companyId, purpose: 'account_security', recipient: user.email, provider: 'postmark', providerServerId: this.config.postmarkServerId!,
          stream: this.config.postmarkMessageStream } });
        noticeAttemptId = notice.id;
      }
      const line = user.externalIdentities.find(i => i.provider === 'LINE' && i.status === 'ACTIVE');
      for (const channel of [...(noticeAttemptId ? ['email'] : []), ...(line ? ['line'] : [])]) {
        await tx.outboxEvent.create({ data: { eventType: EMAIL_SECURITY_NOTICE_EVENT,
          eventKey: `email-security:${token.id}:${channel}`, aggregateType: 'User', aggregateId: user.id,
          payloadJson: { userId: user.id, challengeId: token.id, channel,
            ...(noticeAttemptId ? { noticeAttemptId } : {}), ...(line ? { lineIdentityId: line.id } : {}) } } });
      }
      return null;
    }).catch((error: unknown) => {
      if ((error as { code?: string }).code === 'P2002') return 'EMAIL_CONFLICT';
      throw error;
    });
    if (result) {
      const messages: Record<string, string> = { EMAIL_REAUTH_REQUIRED: 'กรุณายืนยันรหัสในอุปกรณ์และบัญชีที่ใช้ขอรหัส', EMAIL_OTP_NOT_FOUND: 'ไม่พบรายการยืนยันอีเมลนี้',
        EMAIL_STATE_CHANGED: 'รายการยืนยันเปลี่ยนแล้ว กรุณาขอรหัสใหม่', EMAIL_OTP_EXPIRED: 'รหัสหมดอายุแล้ว กรุณาขอรหัสใหม่',
        EMAIL_OTP_INVALID: 'รหัสไม่ถูกต้อง กรุณาลองอีกครั้ง', EMAIL_OTP_ATTEMPTS_EXCEEDED: 'กรอกรหัสผิดครบจำนวนแล้ว กรุณาขอรหัสใหม่',
        EMAIL_OTP_RATE_LIMITED: 'กรุณารอก่อนลองยืนยันใหม่', EMAIL_CONFLICT: 'อีเมลนี้ใช้กับบัญชีอื่นแล้ว',
        EMAIL_DELIVERY_UNAVAILABLE: 'ยังยืนยันอีเมลไม่ได้ กรุณาลองใหม่ภายหลัง' };
      throw emailError(result, messages[result]!, result === 'EMAIL_OTP_RATE_LIMITED' ? 429 : 409,
        result === 'EMAIL_OTP_RATE_LIMITED' ? { retryAfterSeconds: 3600 } : {});
    }
    return this.status(input.userId, input.challengeId);
  }
}
