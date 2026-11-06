import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { BillingRecipientOtpChallenge, BillingRecipientOtpProof } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../common/database/prisma.service';
import { AppConfigService } from '../../../common/config/app-config.service';
import type { Prisma } from '../../../generated/prisma/client';
import type { RequestContext } from '../../auth/domain/models/request-context.model';
import { requireLineContactEmail } from '../../external-signup/domain/line-signup.logic';
import { hashToken } from '../../auth/domain/logic/secure-token.logic';
import { EMAIL_OTP_COOLDOWN_MS, EMAIL_OTP_TTL_MS, newEmailOtp } from '../../auth/domain/logic/email-otp.logic';
import { databaseNow, emailError } from '../../auth/application/account-email-state';
import { activeSessionOf, assertEmailOtpDeliveryReady, emailOtpEnvironment, emailOtpRetryAfterSeconds, OTP_WRONG_ACTION } from '../../auth/application/account-email-otp.service';
import { EmailDeliveryService } from '../../auth/application/email-delivery.service';
import { renderEmailOtp } from '../../auth/infrastructure/auth-email.templates';
import { PostmarkSendError } from '../../auth/infrastructure/postmark.client';
import { billingError } from '../domain/billing-policy';
import { BILLING_RECIPIENT_PROOF_TTL_MS, matchesRecipientOtp, recipientOtpDigest, type RecipientOtpBinding } from '../domain/billing-recipient-otp.logic';
import { BillingService } from './billing.service';

type Caller = { companyId: string; userId: string; tokenId: string; requestId: string };
const PROOF_KIND = 'BILLING_RECIPIENT';
// Same Thai as the account email OTP confirm (account-email-otp.service.ts), for the codes this flow reuses.
const MESSAGES: Record<string, string> = { EMAIL_REAUTH_REQUIRED: 'กรุณายืนยันรหัสในอุปกรณ์และบัญชีที่ใช้ขอรหัส', EMAIL_OTP_NOT_FOUND: 'ไม่พบรายการยืนยันอีเมลนี้',
  EMAIL_STATE_CHANGED: 'รายการยืนยันเปลี่ยนแล้ว กรุณาขอรหัสใหม่', EMAIL_OTP_EXPIRED: 'รหัสหมดอายุแล้ว กรุณาขอรหัสใหม่',
  EMAIL_OTP_INVALID: 'รหัสไม่ถูกต้อง กรุณาลองอีกครั้ง', EMAIL_OTP_ATTEMPTS_EXCEEDED: 'กรอกรหัสผิดครบจำนวนแล้ว กรุณาขอรหัสใหม่',
  EMAIL_DELIVERY_UNAVAILABLE: 'ยังยืนยันอีเมลไม่ได้ กรุณาลองใหม่ภายหลัง' };
const lockRecipientOtp = (tx: Prisma.TransactionClient, companyId: string) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`billing-recipient-otp:${companyId}`}))`;

/**
 * R-A8/R-D2: change the company's document recipient to a new mailbox, proven by a code sent there.
 * Deliberately no password/LINE reauth (DQ11): the caller holds a session and `company.plan.manage`,
 * the code proves the new mailbox, and the old recipient plus every plan manager are told at once.
 */
@Injectable()
export class BillingRecipientOtpService {
  constructor(private readonly prisma: PrismaService, private readonly config: AppConfigService,
    private readonly delivery: EmailDeliveryService, private readonly billing: BillingService) {}

  private owner(input: Caller) { return { companyId: input.companyId, userId: input.userId, requestId: input.requestId } as RequestContext; }

  private async audit(tx: Prisma.TransactionClient, input: Caller, action: string, challengeId: string) {
    await tx.auditLog.create({ data: { companyId: input.companyId, actorType: 'USER', actorUserId: input.userId, action,
      targetType: 'EmailVerificationToken', targetId: challengeId, requestId: input.requestId, result: 'SUCCESS',
      riskLevel: 'HIGH', metadataJson: { challengeId } } });
  }

  private async challenge(input: Caller, id: string): Promise<BillingRecipientOtpChallenge> {
    const token = await this.prisma.client.emailVerificationToken.findFirstOrThrow({ where: { id, userId: input.userId,
      companyId: input.companyId, proofKind: PROOF_KIND } });
    const attempt = token.sendAttemptId ? await this.prisma.client.emailSendAttempt.findUnique({ where: { id: token.sendAttemptId } }) : null;
    return { challengeId: token.id, email: token.newEmail, expiresAt: token.expiresAt.toISOString(),
      retryAt: new Date(token.createdAt.getTime() + EMAIL_OTP_COOLDOWN_MS).toISOString(),
      attemptsRemaining: Math.max(0, 5 - token.failedAttempts), deliveryStatus: attempt ? attempt.status : 'CONFIG',
      delivered: Boolean(attempt?.deliveredAt) };
  }

  async request(input: Caller & { email: string; requestKey: string }): Promise<BillingRecipientOtpChallenge> {
    await this.billing.assertOwner(this.owner(input));
    let email: string;
    try { email = requireLineContactEmail(input.email); }
    catch { throw emailError('EMAIL_OTP_TARGET_INVALID', 'กรุณาระบุอีเมลให้ถูกต้อง', 400); }
    const account = await this.billing.account(input.companyId);
    if (!account?.customerId) throw billingError('BILLING_RECIPIENT_UNAVAILABLE', 'ยังไม่มีเอกสารให้ตั้งอีเมลรับ กรุณาซื้อแพ็กเกจก่อน');
    if (account.recipientEmail === email) throw billingError('BILLING_RECIPIENT_UNCHANGED', 'อีเมลนี้เป็นอีเมลรับเอกสารปัจจุบันอยู่แล้ว');
    const fingerprint = hashToken(JSON.stringify([input.companyId, email])), code = newEmailOtp();
    const reserved = await this.prisma.client.$transaction(async tx => {
      await lockRecipientOtp(tx, input.companyId);
      const now = await databaseNow(tx), session = await activeSessionOf(tx, input, now);
      const replay = await tx.emailVerificationToken.findUnique({ where: { userId_requestKey: { userId: input.userId, requestKey: input.requestKey } } });
      if (replay) {
        if (replay.requestFingerprint !== fingerprint || replay.proofKind !== PROOF_KIND) throw emailError('EMAIL_STATE_CHANGED', 'รายการนี้เปลี่ยนแล้ว กรุณาตรวจข้อมูลอีกครั้ง');
        return { id: replay.id, send: false as const };
      }
      assertEmailOtpDeliveryReady(this.config, email);
      const retryAfterSeconds = await emailOtpRetryAfterSeconds(tx, { userId: input.userId, email, now, proofKind: PROOF_KIND });
      if (retryAfterSeconds > 0) throw emailError('EMAIL_OTP_RATE_LIMITED', 'กรุณารอก่อนขอรหัสใหม่', 429, { retryAfterSeconds });
      const id = randomUUID(), expiresAt = new Date(now.getTime() + EMAIL_OTP_TTL_MS);
      // prepare/audit failures roll back the replacement, keeping the previous working code.
      const attempt = await this.delivery.prepare({ companyId: input.companyId, purpose: 'email_verification', recipient: email, deadlineAt: expiresAt,
        intentKey: `billing-recipient-otp:${id}` }, tx).catch(error => {
          if (error instanceof PostmarkSendError) throw emailError('EMAIL_DELIVERY_UNAVAILABLE', 'ยังส่งรหัสไม่ได้ กรุณาตรวจอีเมลหรือติดต่อทีมงาน', 503);
          throw error;
        });
      await tx.emailVerificationToken.updateMany({ where: { userId: input.userId, companyId: input.companyId, proofKind: PROOF_KIND, status: 'PENDING' },
        data: { status: 'REVOKED' } });
      const binding: RecipientOtpBinding = { environment: emailOtpEnvironment(this.config), id, userId: input.userId, companyId: input.companyId,
        email, sessionId: session.id, keyVersion: this.config.emailOtpHmacKeyVersion!, expiresAt };
      await tx.emailVerificationToken.create({ data: { id, userId: input.userId, companyId: input.companyId, newEmail: email,
        tokenHash: recipientOtpDigest(code, binding, this.config.emailOtpHmacKey!), proofKind: PROOF_KIND, sessionId: session.id,
        keyVersion: binding.keyVersion, sendAttemptId: attempt.id, requestKey: input.requestKey, requestFingerprint: fingerprint, expiresAt, createdAt: now } });
      await this.audit(tx, input, 'billing.recipient.otp.requested', id);
      return { id, send: true as const, attempt, expiresAt };
    });
    if (reserved.send) {
      try {
        await this.delivery.send(reserved.attempt, renderEmailOtp(code, reserved.expiresAt), async () => {
          // Authorize after provider preflight, immediately before the only POST.
          await this.prisma.client.$transaction(async tx => {
            await lockRecipientOtp(tx, input.companyId);
            await this.billing.assertOwner(this.owner(input), tx);
            const token = await tx.emailVerificationToken.findUniqueOrThrow({ where: { id: reserved.id } });
            const now = await databaseNow(tx);
            const session = token.sessionId && await tx.authSession.findFirst({ where: { id: token.sessionId, userId: input.userId, status: 'ACTIVE', expiresAt: { gt: now } } });
            if (token.status !== 'PENDING' || token.expiresAt <= now || !session || token.keyVersion !== this.config.emailOtpHmacKeyVersion)
              throw new PostmarkSendError('PERMANENT', 'otp_state_changed');
            await this.audit(tx, input, 'billing.recipient.otp.dispatch_authorized', token.id);
          });
        });
      } catch {
        // The challenge status owns recovery. Never replay a raw code after an uncertain send.
        await this.prisma.client.emailSendAttempt.updateMany({ where: { id: reserved.attempt.id, status: 'READY', dispatchStartedAt: null },
          data: { status: 'PERMANENT', errorCode: 'otp_not_dispatched' } });
      }
    }
    return this.challenge(input, reserved.id);
  }

  async confirm(input: Caller & { challengeId: string; code: string }): Promise<BillingRecipientOtpProof> {
    await this.billing.assertOwner(this.owner(input));
    const result = await this.prisma.client.$transaction(async tx => {
      await lockRecipientOtp(tx, input.companyId);
      const now = await databaseNow(tx), session = await activeSessionOf(tx, input, now);
      const token = await tx.emailVerificationToken.findFirst({ where: { id: input.challengeId, userId: input.userId,
        companyId: input.companyId, proofKind: PROOF_KIND } });
      if (!token) return 'EMAIL_OTP_NOT_FOUND';
      if (token.sessionId !== session.id) return 'EMAIL_REAUTH_REQUIRED';
      if (token.status === 'USED') return null;
      if (token.status !== 'PENDING') return 'EMAIL_STATE_CHANGED';
      if (token.expiresAt <= now) {
        await tx.emailVerificationToken.update({ where: { id: token.id }, data: { status: 'EXPIRED' } });
        return 'EMAIL_OTP_EXPIRED';
      }
      if (token.keyVersion !== this.config.emailOtpHmacKeyVersion) return 'EMAIL_STATE_CHANGED';
      // One wrong-code budget with the account email OTP: 20 per hour per user.
      const wrong = await tx.auditLog.count({ where: { actorUserId: input.userId, action: OTP_WRONG_ACTION,
        createdAt: { gt: new Date(now.getTime() - 3_600_000) } } });
      if (wrong >= 20) throw emailError('EMAIL_OTP_RATE_LIMITED', 'กรุณารอก่อนลองยืนยันใหม่', 429, { retryAfterSeconds: 3600 });
      if (!this.config.emailOtpHmacKey) return 'EMAIL_DELIVERY_UNAVAILABLE';
      const binding: RecipientOtpBinding = { environment: emailOtpEnvironment(this.config), id: token.id, userId: token.userId,
        companyId: input.companyId, email: token.newEmail, sessionId: token.sessionId!, keyVersion: token.keyVersion!, expiresAt: token.expiresAt };
      if (!matchesRecipientOtp(input.code, token.tokenHash, binding, this.config.emailOtpHmacKey)) {
        const failedAttempts = token.failedAttempts + 1;
        await tx.emailVerificationToken.update({ where: { id: token.id }, data: { failedAttempts, ...(failedAttempts >= 5 ? { status: 'REVOKED' } : {}) } });
        await this.audit(tx, input, OTP_WRONG_ACTION, token.id);
        return failedAttempts >= 5 ? 'EMAIL_OTP_ATTEMPTS_EXCEEDED' : 'EMAIL_OTP_INVALID';
      }
      await tx.emailVerificationToken.update({ where: { id: token.id }, data: { status: 'USED', usedAt: now } });
      await this.audit(tx, input, 'billing.recipient.otp.verified', token.id);
      return null;
    });
    if (result) throw emailError(result, MESSAGES[result]!, result === 'EMAIL_OTP_NOT_FOUND' ? 404 : 409);
    const token = await this.prisma.client.emailVerificationToken.findUniqueOrThrow({ where: { id: input.challengeId } });
    return { recipientProofId: token.id, email: token.newEmail, expiresAt: new Date(token.usedAt!.getTime() + BILLING_RECIPIENT_PROOF_TTL_MS).toISOString() };
  }
}
