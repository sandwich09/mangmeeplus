import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { LineLoginTokenClient } from '../../infrastructure/line-login-token.client';
import { LineLoginVerifierAdapter } from '../../infrastructure/line-login-verifier.adapter';
import { generateRawToken, hashToken } from '../../domain/logic/secure-token.logic';
import { ACCOUNT_MERGE_TICKET_TTL_MS } from './account-merge.use-case';
import { LinkLineIdentityUseCase } from './link-line-identity.use-case';

/** Web link-after-password: spend the OAuth code server-side, then link the
 *  nonce-verified LINE identity to the already-authenticated user through the
 *  same LinkLineIdentityUseCase every LINE surface uses. */
@Injectable()
export class LineLinkOauthUseCase {
  constructor(
    private readonly tokenClient: LineLoginTokenClient,
    private readonly config: AppConfigService,
    private readonly linkLineIdentity: LinkLineIdentityUseCase,
    private readonly prisma: PrismaService,
    private readonly lineVerifier: LineLoginVerifierAdapter,
  ) {}

  async execute(input: { userId: string; code: string; codeVerifier: string; nonce: string; requestId: string; companyId?: string }): Promise<{ linked: true; providerUserId: string }> {
    const webBase = this.config.webBaseUrl;
    if (!webBase && this.config.isProduction) {
      throw new ServiceUnavailableException('Web base URL is not configured.');
    }
    const redirectUri = `${(webBase ?? 'http://localhost:3000').replace(/\/+$/, '')}/api/auth/line-login/callback`;
    const { idToken } = await this.tokenClient.exchangeAuthorizationCode({
      code: input.code,
      codeVerifier: input.codeVerifier,
      redirectUri,
    });
    try {
      return await this.linkLineIdentity.execute({
        userId: input.userId,
        idToken,
        requestId: input.requestId,
        expectedNonce: input.nonce,
        ...(input.companyId ? { companyId: input.companyId } : {}),
      });
    } catch (error) {
      throw await this.withMergeOffer(error, input, idToken);
    }
  }

  /**
   * Spec §4F: this one conflict — "the LINE you just proved you control belongs to another account"
   * — is the merge offer, so the 409 carries the ticket that lets the user take it. Only this web
   * lane does; the LIFF and QR surfaces call LinkLineIdentityUseCase directly and their conflict
   * body is unchanged.
   *
   * Naming the other account is a disclosure, and it is bounded by what the caller already proved:
   * they hold that LINE account. Display name and company names only — never an email or username.
   */
  private async withMergeOffer(
    error: unknown,
    input: { userId: string; requestId: string; nonce: string },
    idToken: string,
  ): Promise<unknown> {
    if (!(error instanceof ConflictException)) return error;
    const body = error.getResponse();
    if (typeof body !== 'object' || body === null || (body as { code?: string }).code !== 'line_linked_elsewhere') return error;

    try {
      // ponytail: a second call to LINE's stateless verify endpoint, on a rare error path only.
      // The alternative is threading the verified subject out of the shared link use case, which
      // would change what the LIFF and QR surfaces return.
      const { subject: lineProviderUserId } = await this.lineVerifier.verify(idToken, { nonce: input.nonce });
      const identity = await this.prisma.client.externalIdentity.findFirst({
        where: { provider: 'LINE', providerUserId: lineProviderUserId, status: 'ACTIVE' },
        select: { userId: true, user: { select: { displayName: true, status: true } } },
      });
      // Nothing to merge into if the owner vanished between the link attempt and here, or if the
      // conflict was in fact with this same session's user.
      if (!identity || identity.user.status !== 'ACTIVE' || identity.userId === input.userId) return error;

      const companies = await this.prisma.client.companyMembership.findMany({
        where: { userId: identity.userId, status: 'ACTIVE', company: { status: 'ACTIVE' } },
        select: { company: { select: { name: true } } },
      });
      const rawToken = generateRawToken();
      await this.prisma.client.accountMergeTicket.create({
        data: {
          tokenHash: hashToken(rawToken),
          newUserId: input.userId,
          existingUserId: identity.userId,
          lineProviderUserId,
          requestId: input.requestId,
          expiresAt: new Date(Date.now() + ACCOUNT_MERGE_TICKET_TTL_MS),
        },
      });
      return new ConflictException({
        ...body,
        mergeTicket: rawToken,
        existingAccount: { displayName: identity.user.displayName, companyNames: companies.map((m) => m.company.name) },
      });
    } catch (mintError) {
      // A failed offer must still be the original conflict: the dialog then shows its
      // "press เชื่อมกับ LINE again" state rather than turning a 409 into a 500.
      console.warn(`[account-merge] merge_ticket_mint_failed reason=${(mintError as Error)?.message ?? 'unknown'}`);
      return error;
    }
  }
}
