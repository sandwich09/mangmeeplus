import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { LineLoginTokenClient } from '../../infrastructure/line-login-token.client';
import { ExchangeLineTokenUseCase, type ExchangeLineTokenResult } from './exchange-line-token.use-case';

/** Web OAuth (Authorization Code + PKCE) callback: exchange the code server-side,
 *  then resolve identity through the same exchange rules as every LINE surface. */
@Injectable()
export class LineLoginCallbackUseCase {
  constructor(
    private readonly tokenClient: LineLoginTokenClient,
    private readonly config: AppConfigService,
    private readonly exchangeLineToken: ExchangeLineTokenUseCase,
  ) {}

  async execute(input: { code: string; codeVerifier: string; nonce: string }): Promise<ExchangeLineTokenResult> {
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
    return this.exchangeLineToken.execute(idToken, 'web-oauth', { expectedNonce: input.nonce });
  }
}
