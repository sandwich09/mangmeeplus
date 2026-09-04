import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { hashPassword } from '../../domain/logic/password-credential.logic';
import { normalizeThaiMobile } from '../../../external-signup/domain/line-signup.logic';
import { AuditService } from '../../../audit/application/audit.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';

/** Stable codes the web maps to Thai copy, so a rejection names the rule that fired. */
export const INVALID_PHONE_NUMBER = 'invalid_phone_number';
export const PASSWORD_ALREADY_SET = 'password_already_set';
export const USERNAME_TAKEN = 'username_taken';

const USERNAME_PATTERN = /^[a-z0-9._-]{4,64}$/;

/**
 * The two self-service writes a LINE-first owner needs and nothing else has (P10-L §15.4):
 * a contact number to be found by, and a first password so a lost phone is not a lost shop.
 *
 * Both act only on the caller's own row — the userId comes from the verified session, never
 * from the body — so neither takes a company or a target id.
 */
@Injectable()
export class AccountProfileUseCase {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(AuditService) private readonly audit: AuditService | null = null,
  ) {}

  /** Blank clears the number: "I would rather you did not keep it" is a legitimate answer (§9 DATA-MIN-01). */
  async setPhoneNumber(userId: string, phoneNumber: string | undefined, requestId?: string): Promise<{ phoneNumber: string | null }> {
    let normalized: string | null;
    try {
      normalized = normalizeThaiMobile(phoneNumber);
    } catch {
      throw new BadRequestException({ code: INVALID_PHONE_NUMBER, message: 'phoneNumber must be a 10-digit Thai mobile number.' });
    }

    const updated = await this.prisma.client.user.updateMany({
      where: { id: userId, status: 'ACTIVE' },
      data: { phoneNumber: normalized },
    });
    if (updated.count !== 1) throw new NotFoundException('User not found.');

    await this.audit?.log({
      action: AuditAction.AUTH_ACCOUNT_CONTACT_UPDATE,
      actorUserId: userId,
      targetType: 'User',
      targetId: userId,
      requestId: requestId ?? 'system',
      result: 'SUCCESS',
      riskLevel: 'LOW',
      // The number itself is contact data, not audit evidence: whether one is now held is the fact.
      metadataJson: { phoneNumberPresent: normalized !== null },
    });

    return { phoneNumber: normalized };
  }

  /**
   * First password only. An account that already has a credential is sent to the ordinary
   * change-password route instead — this one cannot overwrite a password, so it can safely
   * skip the current-password proof that a LINE-first user is unable to give.
   */
  async setInitialPassword(userId: string, password: string, username: string | undefined, requestId?: string): Promise<void> {
    const desiredUsername = username?.trim().toLowerCase() || null;
    if (desiredUsername !== null && !USERNAME_PATTERN.test(desiredUsername)) {
      throw new BadRequestException('username must be 4-64 characters of a-z, 0-9, dot, dash or underscore.');
    }

    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true, username: true, credential: { select: { id: true } } },
    });
    if (!user || user.status !== 'ACTIVE') throw new NotFoundException('User not found.');
    if (user.credential) {
      throw new ConflictException({ code: PASSWORD_ALREADY_SET, message: 'This account already has a password. Use change password instead.' });
    }
    if (desiredUsername !== null && desiredUsername !== user.username) {
      const taken = await this.prisma.client.user.findFirst({
        where: { username: desiredUsername, id: { not: userId } },
        select: { id: true },
      });
      if (taken) throw new ConflictException({ code: USERNAME_TAKEN, message: 'This username is already taken.' });
    }

    const passwordHash = hashPassword(password);
    try {
      await this.prisma.client.$transaction(async (tx) => {
        await tx.userCredential.create({
          data: { userId, passwordHash, status: 'ACTIVE', mustChangePassword: false },
        });
        if (desiredUsername !== null && desiredUsername !== user.username) {
          await tx.user.update({ where: { id: userId }, data: { username: desiredUsername } });
        }
      });
    } catch (error) {
      // `UserCredential.userId` and `User.username` are both unique, so the database — not the
      // read above — is what actually decides a race between two taps.
      const target = (error as { code?: string; meta?: { target?: unknown } })?.code === 'P2002'
        ? (error as { meta?: { target?: unknown } }).meta?.target
        : null;
      if (target) {
        const fields = Array.isArray(target) ? target.map(String) : [String(target)];
        if (fields.some((field) => field.includes('username'))) {
          throw new ConflictException({ code: USERNAME_TAKEN, message: 'This username is already taken.' });
        }
        throw new ConflictException({ code: PASSWORD_ALREADY_SET, message: 'This account already has a password. Use change password instead.' });
      }
      throw error;
    }

    await this.audit?.log({
      action: AuditAction.AUTH_PASSWORD_SET,
      actorUserId: userId,
      targetType: 'User',
      targetId: userId,
      requestId: requestId ?? 'system',
      result: 'SUCCESS',
      riskLevel: 'HIGH',
      metadataJson: { usernameSet: desiredUsername !== null },
    });
  }
}
