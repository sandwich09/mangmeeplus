import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { AppConfigService } from '../../../common/config/app-config.service';

// ponytail: native fetch, single endpoint — mirrors line-login-verifier.adapter
@Injectable()
export class LineLoginTokenClient {
  constructor(private readonly config: AppConfigService) {}

  async exchangeAuthorizationCode(input: { code: string; codeVerifier: string; redirectUri: string }): Promise<{ idToken: string }> {
    const channelId = this.config.lineLoginChannelId;
    const channelSecret = this.config.lineLoginChannelSecret;
    if (!channelId || !channelSecret) {
      throw new ServiceUnavailableException('LINE Login channel is not configured.');
    }
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: channelId,
      client_secret: channelSecret,
      code_verifier: input.codeVerifier,
    });
    let res: Response;
    try {
      res = await fetch('https://api.line.me/oauth2/v2.1/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new UnauthorizedException('LINE Login token request failed.');
    }
    if (!res.ok) {
      throw new UnauthorizedException('LINE Login code exchange failed.');
    }
    const data = (await res.json()) as { id_token?: string };
    if (typeof data.id_token !== 'string' || data.id_token.length === 0) {
      throw new UnauthorizedException('LINE Login response has no ID token.');
    }
    return { idToken: data.id_token };
  }
}
