import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { SignupClaimInfoDto, SignupClaimResultDto } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../common/database/prisma.service';
import { hashPassword, verifyPassword } from '../../auth/domain/logic/password-credential.logic';
import { CompanySignupCoreService } from './company-signup-core.service';
import { AccountClaimTokenService } from './account-claim-token.service';
import { ProvisionSignupUseCase } from './provision-signup.use-case';
import { maskEmail, suggestedUsernameFromEmail } from '../domain/account-claim.logic';

/** One message for expired, used and unknown tokens (P11 F-EM-3) — the page is never an oracle. */
const INVALID_CLAIM = 'claim_link_invalid_or_expired';

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
    // Same lookup `setPassword` makes below. Answering it here is what lets the page lead with the
    // attach branch instead of offering a password form whose submit can only 409.
    const emailOwner = await this.prisma.client.user.findUnique({
      where: { email: request.contactEmail },
      select: { id: true },
    });
    return {
      valid: true,
      companyName: request.companyName,
      maskedEmail: maskEmail(request.contactEmail),
      ...(suggestedUsernameFromEmail(request.contactEmail)
        ? { suggestedUsername: suggestedUsernameFromEmail(request.contactEmail)! }
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

    const username = cmd.username.trim();
    const [usernameTaken, emailOwner] = await Promise.all([
      this.prisma.client.user.findUnique({ where: { username }, select: { id: true } }),
      this.prisma.client.user.findUnique({
        where: { email: preview.request.contactEmail },
        select: { id: true },
      }),
    ]);
    if (usernameTaken) throw new ConflictException('username_taken');
    // `User.email` is unique, so this address already belongs to somebody. Rather than guess that
    // it is the same person (spec §4C forbids guessing), send them to the attach branch.
    if (emailOwner) throw new ConflictException('email_already_registered_use_existing_account');

    const request = await this.tokens.consume(cmd.token);
    if (!request) throw new BadRequestException(INVALID_CLAIM);

    await this.prisma.client.companySignupRequest.update({
      where: { id: request.id },
      // Hash only — the plaintext never reaches the database (§4B).
      data: { pendingPasswordHash: hashPassword(cmd.password), attachUserId: null },
    });
    await this.core.advance(request.id, 'EMAIL_VERIFIED', cmd.correlationRequestId);

    const provisioned = await this.provision.execute({
      requestId: request.id,
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

    const request = await this.tokens.consume(cmd.token);
    if (!request) throw new BadRequestException(INVALID_CLAIM);

    await this.prisma.client.companySignupRequest.update({
      where: { id: request.id },
      // Attach carries no password of its own; clear any hash a previous branch attempt left.
      data: { attachUserId: owner.id, pendingPasswordHash: null },
    });
    await this.core.advance(request.id, 'EMAIL_VERIFIED', cmd.correlationRequestId);

    const provisioned = await this.provision.execute({
      requestId: request.id,
      correlationRequestId: cmd.correlationRequestId,
      webBaseUrl: cmd.webBaseUrl,
      apiBaseUrl: cmd.apiBaseUrl,
    });
    return toResult(provisioned);
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
