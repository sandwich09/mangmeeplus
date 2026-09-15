import { HttpException } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { emailRequirement, emailSecurityBinding, EMAIL_OTP_POLICY, type EmailProof } from '../domain/logic/email-otp.logic';

export const emailUserInclude = { credential: true, externalIdentities: true } satisfies Prisma.UserInclude;
export function emailError(code: string, message: string, status = 409, extra: Record<string, unknown> = {}) {
  return new HttpException({ code, message, ...extra }, status);
}
export async function databaseNow(tx: Prisma.TransactionClient): Promise<Date> {
  const [row] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  return row!.now;
}

/** Same order as password/email recovery. Billing acquires its company/authority locks first. */
export async function lockAccountEmail(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`account-email:${userId}`}))`;
  const credential = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "UserCredential" WHERE "userId" = ${userId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
  if (!credential.length) await tx.$queryRaw`SELECT id FROM "UserCredential" WHERE "userId" = ${userId} FOR UPDATE`;
}

export async function accountEmailState(tx: Prisma.TransactionClient, userId: string) {
  const user = await tx.user.findUnique({ where: { id: userId }, include: emailUserInclude });
  if (!user || user.status !== 'ACTIVE') throw emailError('EMAIL_ACCOUNT_UNAVAILABLE', 'บัญชีนี้ไม่สามารถยืนยันอีเมลได้', 403);
  const now = await databaseNow(tx);
  let pending = await tx.emailVerificationToken.findFirst({
    where: { userId, proofKind: 'OTP', status: 'PENDING', expiresAt: { gt: now } }, orderBy: { createdAt: 'desc' },
  });
  if (pending) {
    const originalSession = await tx.authSession.findFirst({ where: { id: pending.sessionId!, userId, status: 'ACTIVE', expiresAt: { gt: now } } });
    if (!originalSession || pending.emailRevision !== user.emailRevision || pending.securityBindingHash !== emailSecurityBinding(user)) pending = null;
  }
  return { user, pending, now, requirement: emailRequirement(user, pending, now) };
}

export async function verifiedAccountEmailProof(tx: Prisma.TransactionClient, userId: string): Promise<EmailProof> {
  const { user, requirement } = await accountEmailState(tx, userId);
  if (requirement !== 'READY') throw emailError('BILLING_EMAIL_VERIFICATION_REQUIRED',
    'กรุณาผูกและยืนยันอีเมลก่อนชำระเงิน', 409, { emailRequirement: requirement });
  return { policyVersion: EMAIL_OTP_POLICY, userId, email: user.email!,
    verifiedAt: user.emailVerifiedAt!.toISOString(), emailRevision: user.emailRevision,
    securityBindingHash: emailSecurityBinding(user) };
}

export async function assertAccountEmailProof(tx: Prisma.TransactionClient, userId: string, proof?: EmailProof): Promise<void> {
  const current = await verifiedAccountEmailProof(tx, userId);
  if (!proof || proof.policyVersion !== current.policyVersion || proof.userId !== current.userId ||
      proof.email !== current.email || proof.verifiedAt !== current.verifiedAt ||
      proof.emailRevision !== current.emailRevision || proof.securityBindingHash !== current.securityBindingHash) {
    throw emailError('BILLING_EMAIL_CHANGED', 'ข้อมูลอีเมลเปลี่ยนแล้ว กรุณาตรวจสรุปการชำระเงินอีกครั้ง');
  }
}
