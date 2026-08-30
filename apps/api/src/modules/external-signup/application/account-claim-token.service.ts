import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { AccountClaimToken, CompanySignupRequest } from '../../../generated/prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import { CLAIM_TOKEN_TTL_HOURS, hashClaimToken } from '../domain/account-claim.logic';

/** 32 bytes of randomness, URL-safe. Matches the entropy of the reset-token pattern (P11 §2). */
const CLAIM_TOKEN_BYTES = 32;

export type MintedClaimToken = Readonly<{ rawToken: string; expiresAt: Date }>;

@Injectable()
export class AccountClaimTokenService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Mint-at-send (P11 F-EM-3): the raw token exists only in the caller's memory long enough to be
   * put in one email. Only its hash is persisted, and any earlier unused token for the request is
   * revoked in the same transaction, so a resend always invalidates the link that came before.
   */
  async mint(signupRequestId: string, now = new Date()): Promise<MintedClaimToken> {
    const rawToken = randomBytes(CLAIM_TOKEN_BYTES).toString('base64url');
    const expiresAt = new Date(now.getTime() + CLAIM_TOKEN_TTL_HOURS * 3_600_000);

    await this.prisma.client.$transaction(async (tx) => {
      await tx.accountClaimToken.updateMany({
        where: { signupRequestId, usedAt: null, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.accountClaimToken.create({
        data: { signupRequestId, tokenHash: hashClaimToken(rawToken), expiresAt },
      });
    });

    return { rawToken, expiresAt };
  }

  /** Revoke every live token for a request without minting a replacement (reject / reissue). */
  async revokeAll(signupRequestId: string, now = new Date()): Promise<number> {
    const { count } = await this.prisma.client.accountClaimToken.updateMany({
      where: { signupRequestId, usedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    return count;
  }

  /**
   * Read-only lookup for the claim page. Expired, used and unknown tokens are indistinguishable to
   * the caller by design (P11 F-EM-3) — this returns null for all three and the route renders one
   * message, so the page is never an oracle for which tokens ever existed.
   */
  async peek(rawToken: string, now = new Date()): Promise<
    { token: AccountClaimToken; request: CompanySignupRequest } | null
  > {
    const token = await this.prisma.client.accountClaimToken.findUnique({
      where: { tokenHash: hashClaimToken(rawToken) },
      include: { signupRequest: true },
    });
    if (!token || token.usedAt || token.revokedAt || token.expiresAt <= now) return null;
    if (token.signupRequest.state !== 'EMAIL_PENDING') return null;
    const { signupRequest, ...rest } = token;
    return { token: rest as AccountClaimToken, request: signupRequest };
  }

  /**
   * Single-use claim (H-09 shape): the CAS is the whole guarantee. Two concurrent submissions of
   * the same link produce exactly one winner, because only one `updateMany` can move `usedAt` off
   * null. The loser is told the link is spent rather than being allowed a second provisioning.
   */
  async consume(rawToken: string, now = new Date()): Promise<CompanySignupRequest | null> {
    const tokenHash = hashClaimToken(rawToken);
    const claimed = await this.prisma.client.accountClaimToken.updateMany({
      where: { tokenHash, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) return null;

    const token = await this.prisma.client.accountClaimToken.findUnique({
      where: { tokenHash },
      include: { signupRequest: true },
    });
    return token?.signupRequest ?? null;
  }
}
