import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { uniqueConstraintFields } from '../../../../common/database/prisma-error';
import { hashPassword } from '../../domain/logic/password-credential.logic';
// Cross-module, deliberately: this is the same Thai-mobile rule the LINE signup form applies, and
// a second copy of it here is how the two would drift apart. Pure function, no DI, no cycle.
import { normalizeThaiMobile } from '../../../external-signup/domain/line-signup.logic';
import { AuditService } from '../../../audit/application/audit.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { revokeActiveSessions } from '../../domain/logic/session-revocation.logic';
import { notifyAccountSecurityChange, PASSWORD_SET_NOTICE } from '../account-security-notice';

// Codes are written as literals, not constants, because `api-error-coverage.spec.ts` scans this
// source for `code: '…'` to prove every one of them has Thai copy. A constant hides them from it.

/** Mirrored client-side by `USERNAME_PATTERN` in `apps/web/src/features/company-profile/company-profile.logic.ts`. */
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
    @Optional() @Inject(AppConfigService) private readonly config: AppConfigService | null = null,
  ) {}

  /** Blank clears the number: "I would rather you did not keep it" is a legitimate answer (§9 DATA-MIN-01). */
  async setPhoneNumber(userId: string, phoneNumber: string | undefined, requestId?: string): Promise<{ phoneNumber: string | null }> {
    let normalized: string | null;
    try {
      normalized = normalizeThaiMobile(phoneNumber);
    } catch {
      throw new BadRequestException({ code: 'invalid_phone_number', message: 'phoneNumber must be a 10-digit Thai mobile number.' });
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
  async setInitialPassword(
    userId: string,
    password: string,
    username: string | undefined,
    requestId?: string,
    currentTokenId?: string,
  ): Promise<{ username: string | null }> {
    const desiredUsername = username?.trim().toLowerCase() || null;
    if (desiredUsername !== null && !USERNAME_PATTERN.test(desiredUsername)) {
      // Coded: a Thai owner typing สมชาย was getting an English sentence through the generic
      // fallback, which named neither the rule nor the fix.
      throw new BadRequestException({
        code: 'invalid_username',
        message: 'username must be 4-64 characters of a-z, 0-9, dot, dash or underscore.',
      });
    }

    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true, username: true, email: true, emailVerifiedAt: true, credential: { select: { id: true } } },
    });
    if (!user || user.status !== 'ACTIVE') throw new NotFoundException('User not found.');
    if (user.credential) {
      throw new ConflictException({ code: 'password_already_set', message: 'This account already has a password. Use change password instead.' });
    }

    // `PasswordLoginUseCase` finds the account by username OR verified email. A LINE-first owner
    // has neither, so a password saved without a username would be a credential nobody can ever
    // log in with — and the second attempt answers 409 `password_already_set`, so they could not
    // even fix it. Refuse up front rather than store a dead credential.
    const hasLoginIdentifier = user.username !== null || (user.email !== null && user.emailVerifiedAt !== null);
    if (desiredUsername === null && !hasLoginIdentifier) {
      throw new BadRequestException({
        code: 'username_required',
        message: 'Set a username: this account has no verified email to log in with.',
      });
    }

    if (desiredUsername !== null && desiredUsername !== user.username) {
      // The unique index is a plain B-tree and therefore case-sensitive, so this read is the only
      // thing stopping "somchai" and "SomChai" becoming two login names for two different people.
      //
      // It is deliberately NOT Prisma's `mode: 'insensitive'`: that compiles to `ILIKE` with the
      // value bound raw, and `_` — which the username charset allows — is a LIKE wildcard. On real
      // Postgres that refused `som_hai` because `somchai` exists, and refused `somchai_gmail.com`
      // because it matched somebody's EMAIL, which made this an address-enumeration oracle. An
      // exact `lower()` comparison has no pattern semantics at all.
      const taken = await this.prisma.client.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "User" WHERE "id" <> ${userId} AND lower("username") = ${desiredUsername} LIMIT 1
      `;
      if (taken.length > 0) throw new ConflictException({ code: 'username_taken', message: 'This username is already taken.' });
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
        // Same rule as ChangePassword, same transaction: a new way into the account invalidates
        // every session that was open before it. If a stolen session set this password, revoking
        // is what stops it from also being the session that keeps using the account.
        await revokeActiveSessions(tx.authSession, { userId, ...(currentTokenId ? { exceptTokenId: currentTokenId } : {}) });
      });
    } catch (error) {
      // `UserCredential.userId` and `User.username` are both unique, so the database — not the
      // read above — is what actually decides a race between two taps.
      // `meta.target` alone was blind under `@prisma/adapter-pg`, which leaves it undefined and puts
      // the columns on `meta.driverAdapterError` — see `uniqueConstraintFields`.
      const fields = uniqueConstraintFields(error);
      if (fields) {
        if (fields.some((field) => field.includes('username'))) {
          throw new ConflictException({ code: 'username_taken', message: 'This username is already taken.' });
        }
        throw new ConflictException({ code: 'password_already_set', message: 'This account already has a password. Use change password instead.' });
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

    // Out of band and after the commit: LINE is the only channel a LINE-first owner has, so this
    // is the only way they can find out that a password now exists on their account.
    await notifyAccountSecurityChange(this.prisma, this.config?.lineMessagingChannelAccessToken, userId, PASSWORD_SET_NOTICE);

    // The stored form, which is what they must type at the login box — it is lower-cased here and
    // `PasswordLoginUseCase` matches the username case-sensitively.
    return { username: desiredUsername ?? user.username };
  }
}
