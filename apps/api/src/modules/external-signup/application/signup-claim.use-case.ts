import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { SignupClaimInfoDto, SignupClaimResultDto } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../common/database/prisma.service';
import { hashPassword, verifyPassword } from '../../auth/domain/logic/password-credential.logic';
import { CompanySignupCoreService, signupStateGuard } from './company-signup-core.service';
import { AccountClaimTokenService } from './account-claim-token.service';
import { ProvisionSignupUseCase } from './provision-signup.use-case';
import { maskEmail, suggestedUsernameFromEmail } from '../domain/account-claim.logic';

/** One message for expired, used and unknown tokens (P11 F-EM-3) — the page is never an oracle. */
const INVALID_CLAIM = 'claim_link_invalid_or_expired';

/**
 * Re-checked under the core's advisory lock, on the row as it is NOW. The peek that opened this
 * claim happened before the applicant typed anything, and a sweep, a reissue or a second tab may
 * have moved the row since.
 */
const STILL_AWAITING_CLAIM = signupStateGuard(INVALID_CLAIM, (current) => current.state === 'EMAIL_PENDING');

/**
 * Constant-cost verify for an unknown identifier, mirroring `PasswordLoginUseCase`: an account that
 * does not exist still pays one scrypt, so response timing cannot enumerate users from this page.
 */
const DUMMY_PASSWORD_HASH = hashPassword('watchdog.timing.equalizer');

export type ClaimSetPasswordCommand = {
  token: string;
  username: string;
  password: string;
  correlationRequestId: string;
  webBaseUrl: string;
  apiBaseUrl: string;
};

export type ClaimAttachCommand = {
  token: string;
  identifier: string;
  password: string;
  correlationRequestId: string;
  webBaseUrl: string;
  apiBaseUrl: string;
};

@Injectable()
export class SignupClaimUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: CompanySignupCoreService,
    private readonly tokens: AccountClaimTokenService,
    private readonly provision: ProvisionSignupUseCase,
  ) {}

  /** Read-only page load. Returns `{ valid: false }` — identically — for every unusable token. */
  async info(rawToken: string): Promise<SignupClaimInfoDto> {
    const found = await this.tokens.peek(rawToken);
    if (!found) return { valid: false };
    const { token, request } = found;
    // A claim link only ever exists for an address-bearing (Flow B) application; a `line-oa` row
    // has no EMAIL_* edge and so no token. An addressless row here is unusable, not a page.
    const contactEmail = request.contactEmail;
    if (!contactEmail) return { valid: false };
    // Same lookup `setPassword` makes below. Answering it here is what lets the page lead with the
    // attach branch instead of offering a password form whose submit can only 409.
    const emailOwner = await this.prisma.client.user.findUnique({
      where: { email: contactEmail },
      select: { id: true },
    });
    return {
      valid: true,
      companyName: request.companyName,
      maskedEmail: maskEmail(contactEmail),
      ...(suggestedUsernameFromEmail(contactEmail)
        ? { suggestedUsername: suggestedUsernameFromEmail(contactEmail)! }
        : {}),
      expiresAt: token.expiresAt.toISOString(),
      emailMatchesExistingUser: !!emailOwner,
    };
  }

  /** Branch "I do not have an account yet" (spec §4B): set a password, then provision. */
  async setPassword(cmd: ClaimSetPasswordCommand): Promise<SignupClaimResultDto> {
    // Validate everything the applicant can get wrong BEFORE consuming the link, so a taken
    // username does not burn their single-use token and strand them.
    const preview = await this.tokens.peek(cmd.token);
    if (!preview) throw new BadRequestException(INVALID_CLAIM);

    const contactEmail = preview.request.contactEmail;
    if (!contactEmail) throw new BadRequestException(INVALID_CLAIM);

    const username = cmd.username.trim();
    const [usernameTaken, emailOwner] = await Promise.all([
      this.prisma.client.user.findUnique({ where: { username }, select: { id: true } }),
      this.prisma.client.user.findUnique({
        where: { email: contactEmail },
        select: { id: true },
      }),
    ]);
    if (usernameTaken) throw new ConflictException('username_taken');
    // `User.email` is unique, so this address already belongs to somebody. Rather than guess that
    // it is the same person (spec §4C forbids guessing), send them to the attach branch.
    if (emailOwner) throw new ConflictException('email_already_registered_use_existing_account');

    await this.recordClaim(cmd.token, preview.request.id, cmd.correlationRequestId, {
      // Hash only — the plaintext never reaches the database (§4B).
      pendingPasswordHash: hashPassword(cmd.password),
      attachUserId: null,
    });

    const provisioned = await this.provision.execute({
      requestId: preview.request.id,
      username,
      correlationRequestId: cmd.correlationRequestId,
      webBaseUrl: cmd.webBaseUrl,
      apiBaseUrl: cmd.apiBaseUrl,
    });
    return toResult(provisioned);
  }

  /** Branch "I already have an account" (spec §4B): prove the existing credential, then attach. */
  async attach(cmd: ClaimAttachCommand): Promise<SignupClaimResultDto> {
    const preview = await this.tokens.peek(cmd.token);
    if (!preview) throw new BadRequestException(INVALID_CLAIM);

    const owner = await this.authenticate(cmd.identifier, cmd.password);

    await this.recordClaim(cmd.token, preview.request.id, cmd.correlationRequestId, {
      // Attach carries no password of its own; clear any hash a previous branch attempt left.
      attachUserId: owner.id,
      pendingPasswordHash: null,
    });

    const provisioned = await this.provision.execute({
      requestId: preview.request.id,
      correlationRequestId: cmd.correlationRequestId,
      webBaseUrl: cmd.webBaseUrl,
      apiBaseUrl: cmd.apiBaseUrl,
    });
    return toResult(provisioned);
  }

  /**
   * Review R04: spending the single-use link, writing the claim material and moving the state are
   * ONE transaction. As three writes, a request that moved on between the page load and the submit
   * — or a process that died in the window — left the applicant holding a burnt token and a request
   * that had never claimed, with no way forward but an admin reissue.
   *
   * `expect` is what makes the link single-use here: the row is re-read under the core's advisory
   * lock, and a second submission of the same link finds a state that is no longer EMAIL_PENDING
   * and is refused with the one sentence this whole boundary answers with.
   */
  private async recordClaim(
    rawToken: string,
    requestId: string,
    correlationRequestId: string,
    data: { pendingPasswordHash: string | null; attachUserId: string | null },
  ): Promise<void> {
    try {
      await this.core.advance(requestId, 'EMAIL_VERIFIED', correlationRequestId, undefined, STILL_AWAITING_CLAIM, {
        data,
        alsoInTransaction: async (tx) => {
          if (!await this.tokens.consume(rawToken, new Date(), tx)) throw new BadRequestException(INVALID_CLAIM);
        },
      });
    } catch (error) {
      // Every refusal from this boundary reads the same, so a second submission of a spent link
      // learns nothing a first one would not (P11 F-EM-3).
      if (error instanceof ConflictException) throw new BadRequestException(INVALID_CLAIM);
      throw error;
    }
  }

  /**
   * The same identifier lookup and scrypt verification `PasswordLoginUseCase` performs, minus the
   * parts that do not belong here: no session is issued (the success page sends the user to login)
   * and no active-membership requirement, because an existing account whose only membership is
   * inactive must still be able to take ownership of the company it just paid attention to.
   *
   * Throttling is NOT weakened: the controller consumes and records the very same
   * `password-login-*` buckets, so guessing through this page costs what guessing through
   * `/v1/auth/login` costs.
   */
  private async authenticate(identifier: string, password: string): Promise<{ id: string }> {
    const trimmed = identifier.trim();
    const user = await this.prisma.client.user.findFirst({
      where: { OR: [{ username: trimmed }, { email: trimmed.toLowerCase() }] },
      include: { credential: true },
    });
    const matches = verifyPassword(password, user?.credential?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!user || user.status !== 'ACTIVE' || !user.credential || user.credential.status === 'DISABLED' || !matches) {
      throw new UnauthorizedException('Invalid username or password.');
    }
    if (user.credential.expiresAt && user.credential.expiresAt <= new Date()) {
      throw new UnauthorizedException('Invalid username or password.');
    }
    return { id: user.id };
  }
}

function toResult(provisioned: {
  companyId: string;
  companyName: string;
  attachedToExistingUser: boolean;
}): SignupClaimResultDto {
  return {
    companyId: provisioned.companyId,
    companyName: provisioned.companyName,
    // Same shape `PasswordLoginUseCase` redirects to, so the success page and a fresh login agree.
    homePath: `/companies/${provisioned.companyId}/dashboard`,
    attachedToExistingUser: provisioned.attachedToExistingUser,
  };
}
