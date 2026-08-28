import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { LineLoginTokenClient } from '../../infrastructure/line-login-token.client';
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
    return this.linkLineIdentity.execute({
      userId: input.userId,
      idToken,
      requestId: input.requestId,
      expectedNonce: input.nonce,
      ...(input.companyId ? { companyId: input.companyId } : {}),
    });
  }
}
