import { emailSecurityBinding } from '../../auth/domain/logic/email-otp.logic';
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../common/database/prisma.service';
import { AppConfigService } from '../../../common/config/app-config.service';
import { canonicalFingerprint } from '../../../common/security/canonical-fingerprint';
import { EmailAccessService, type EmailAccessProof } from '../../auth/application/email-access.service';
import { databaseNow, emailError, emailUserInclude, lockAccountEmail } from '../../auth/application/account-email-state';
import { CompanySignupCoreService } from './company-signup-core.service';
import { ProvisionSignupUseCase } from './provision-signup.use-case';
import { SignupAdminNotifyService } from './signup-admin-notify.service';
import { SIGNUP_SOURCE_EMAIL_OTP, SIGNUP_SOURCE_LINE_OA } from '../domain/company-signup.logic';
import { normalizeLineCompanyName, requireThaiMobile } from '../domain/line-signup.logic';
import { bangkokDayKey, bangkokDayStart } from '../domain/business-hours.logic';

@Injectable()
export class EmailSignupService {
  constructor(private readonly prisma: PrismaService, private readonly config: AppConfigService,
    private readonly access: EmailAccessService, private readonly core: CompanySignupCoreService,
    private readonly provision: ProvisionSignupUseCase, private readonly notify: SignupAdminNotifyService) {}

  async submit(input: EmailAccessProof & { companyName: string; displayName: string; phoneNumber: string; consentVersion: string; requestId: string }, urls: { webBaseUrl: string; apiBaseUrl: string }) {
    let companyName: string, phoneNumber: string;
    try {
      companyName = normalizeLineCompanyName(input.companyName);
      phoneNumber = requireThaiMobile(input.phoneNumber.trim().replace(/^\+66/, '0'));
    } catch { throw emailError('EMAIL_SIGNUP_INPUT_INVALID', 'กรุณาตรวจชื่อร้านและเบอร์มือถืออีกครั้ง', 400); }
    const displayName = input.displayName.trim();
    if (!displayName || displayName.length > 160 || input.consentVersion !== 'EMAIL_SIGNUP_V1') throw emailError('EMAIL_SIGNUP_INPUT_INVALID', 'กรุณาตรวจข้อมูลที่กรอกอีกครั้ง', 400);
    const id = await this.prisma.client.$transaction(async tx => {
      const proof = await this.access.requireSignupProof(tx, input);
      const existing = await tx.companySignupRequest.findFirst({ where: { source: SIGNUP_SOURCE_EMAIL_OTP, contactEmail: proof.email } });
      if (existing) {
        if (proof.userId && proof.userId !== existing.ownerUserId) throw emailError('EMAIL_SIGNUP_CHANGED', 'กรุณาเข้าบัญชีเดิม', 409);
        await tx.emailAccessChallenge.update({ where: { id: proof.id }, data: { signupRequestId: existing.id } });
        return existing.id;
      } // Fresh mailbox proof resumes the original application, never creates another trial.
      if (!this.config.externalSignupEnabled) throw emailError('external_signup_disabled', 'ขณะนี้ยังไม่เปิดรับสมัครใหม่ กรุณาติดต่อทีมงาน', 403);
      const users = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "User" WHERE lower(email) = ${proof.email} OR lower(username) = ${proof.email} LIMIT 1`;
      if (proof.userId || users.length) throw emailError('EMAIL_ACCESS_EXISTING_ACCOUNT', 'กรุณาเข้าสู่บัญชีเดิมก่อน', 409);
      const request = await tx.companySignupRequest.create({ data: {
        id: randomUUID(), externalSignupId: `email-first:${canonicalFingerprint({ email: proof.email })}`,
        source: SIGNUP_SOURCE_EMAIL_OTP, intakePolicyVersion: 'EMAIL_SIGNUP_V1',
        payloadHash: canonicalFingerprint({ companyName, displayName, phoneNumber, email: proof.email }),
        companyName, ownerDisplayName: displayName, phoneNumber, contactEmail: proof.email,
        consentVersion: input.consentVersion, emailProofVerifiedAt: proof.verifiedAt, state: 'RECEIVED',
      } });
      await tx.emailAccessChallenge.update({ where: { id: proof.id }, data: { signupRequestId: request.id } });
      await tx.auditLog.create({ data: { actorType: 'SERVICE', actorRefId: 'email-signup', action: 'signup.email.received',
        targetType: 'company_signup_request', targetId: request.id, requestId: input.requestId, result: 'SUCCESS',
        metadataJson: { source: SIGNUP_SOURCE_EMAIL_OTP, policy: 'EMAIL_SIGNUP_V1', consentVersion: input.consentVersion } } });
      return request.id;
    });
    return this.resume(input, id, urls);
  }

  async status(input: EmailAccessProof & { requestId: string }, urls: { webBaseUrl: string; apiBaseUrl: string }) {
    const request = await this.prisma.client.$transaction(async tx => {
      const proof = await this.access.requireSignupProof(tx, input);
      const request = await tx.companySignupRequest.findFirst({ where: { source: SIGNUP_SOURCE_EMAIL_OTP, contactEmail: proof.email } });
      if (request) await tx.emailAccessChallenge.update({ where: { id: proof.id }, data: { signupRequestId: request.id } });
      return request;
    });
    if (!request) return { kind: 'NEW' as const };
    return this.resume(input, request.id, urls);
  }

  private async resume(input: EmailAccessProof & { requestId: string }, id: string, urls: { webBaseUrl: string; apiBaseUrl: string }) {
    let request = await this.prisma.client.companySignupRequest.findUniqueOrThrow({ where: { id } });
    if (request.state === 'RECEIVED') request = (await this.core.advance(id, 'VALIDATED', input.requestId)).request;
    if (request.state === 'VALIDATED' && !request.autoApproved) {
      const operator = (await this.notify.activeSystemAdmins())[0];
      await this.prisma.client.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
        const now = await databaseNow(tx);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`line-signup-auto-cap:${bangkokDayKey(now)}`}, 0))`;
        const current = await tx.companySignupRequest.findUniqueOrThrow({ where: { id } });
        if (current.state !== 'VALIDATED' || current.autoApproved) return;
        const duplicate = await tx.companySignupRequest.findFirst({ where: { id: { not: id }, OR: [
          { contactEmail: current.contactEmail }, { phoneNumber: current.phoneNumber }, { companyName: current.companyName },
        ] }, select: { id: true } });
        const users = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "User" WHERE lower(email) = ${current.contactEmail} OR lower(username) = ${current.contactEmail} LIMIT 1`;
        const count = await tx.companySignupRequest.count({ where: { source: { in: [SIGNUP_SOURCE_EMAIL_OTP, SIGNUP_SOURCE_LINE_OA] }, autoApproved: true,
          OR: [{ approvedAt: { gte: bangkokDayStart(now) } }, { approvedAt: null, createdAt: { gte: bangkokDayStart(now) } }] } });
        const auto = this.config.lineSignupApprovalMode === 'AUTO_FREE' && Boolean(operator) && !duplicate && !users.length && count < this.config.lineSignupAutoDailyCap;
        await tx.companySignupRequest.update({ where: { id }, data: auto ? { autoApproved: true, approvedAt: now, reviewResolution: 'NEW_SHOP', version: { increment: 1 } }
          : { state: 'PENDING_REVIEW', contactEmailConflict: Boolean(duplicate || users.length), version: { increment: 1 } } });
        await tx.auditLog.create({ data: { actorType: 'SERVICE', actorRefId: 'email-signup', action: auto ? 'signup.email.auto_approved' : 'signup.email.review_required',
          targetType: 'company_signup_request', targetId: id, requestId: input.requestId, result: 'SUCCESS', riskLevel: 'HIGH',
          metadataJson: { sharedDailyCount: count, duplicate: Boolean(duplicate || users.length) } } });
      });
      request = await this.prisma.client.companySignupRequest.findUniqueOrThrow({ where: { id } });
    }
    if (request.state === 'PENDING_REVIEW') await this.notify.enqueue(id);
    if ((request.state === 'VALIDATED' && request.autoApproved) || ['PROVISIONING', 'PROVISIONING_FAILED', 'READY'].includes(request.state)) {
      await this.provision.execute({ requestId: id, correlationRequestId: input.requestId, ...urls });
      request = await this.prisma.client.companySignupRequest.findUniqueOrThrow({ where: { id } });
    }
    if (request.state !== 'COMPLETED' || !request.ownerUserId) return { kind: 'STATUS' as const, state: request.state, requestId: id };
    const userId = request.ownerUserId;
    return this.prisma.client.$transaction(async tx => {
      const member = await this.access.lockMembership(tx, userId);
      await lockAccountEmail(tx, userId);
      const proof = await this.access.requireSignupProof(tx, input);
      const current = await tx.companySignupRequest.findUniqueOrThrow({ where: { id } });
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, include: emailUserInclude });
      if (current.state !== 'COMPLETED' || current.ownerUserId !== userId || current.contactEmail !== proof.email ||
          !member || member.companyId !== current.companyId || !user.emailLoginEnabledAt || !user.emailVerifiedAt ||
          user.status !== 'ACTIVE' || user.email !== proof.email || (proof.userId !== userId || proof.securityBindingHash !== emailSecurityBinding(user))) {
        throw emailError('EMAIL_SIGNUP_CHANGED', 'ข้อมูลบัญชีเปลี่ยนแล้ว กรุณาเข้าสู่ระบบอีกครั้ง', 409);
      }
      return this.access.login(tx, proof, user, member, await databaseNow(tx), input.requestId);
    });
  }
}
