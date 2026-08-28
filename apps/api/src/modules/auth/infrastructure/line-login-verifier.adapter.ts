import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AppConfigService } from '../../../common/config/app-config.service';
import { LINE_ID_TOKEN_MAX_LENGTH, LINE_ID_TOKEN_PATTERN } from '../../../common/security/liff-page.security';
import type { IJwtVerifier } from '../domain/ports/jwt-verifier.port';

type LineVerifyResponse = {
  sub?: string;
  name?: string;
  /** LINE echoes the channel id the ID token was minted for. */
  aud?: string;
  /** Seconds since epoch. */
  exp?: number;
  error?: string;
  error_description?: string;
};

// ponytail: uses native fetch (Node 18+), no axios needed for single endpoint
@Injectable()
export class LineLoginVerifierAdapter implements IJwtVerifier {
  constructor(private readonly config: AppConfigService) {}

  // `nonce` is optional so every existing caller is unchanged; the web OAuth callback passes
  // the one it minted, and LINE rejects a token whose nonce claim does not match.
  async verify(token: string, opts?: { nonce?: string }): Promise<{ subject: string; name?: string }> {
    if (token.length > LINE_ID_TOKEN_MAX_LENGTH || !LINE_ID_TOKEN_PATTERN.test(token)) {
      throw new UnauthorizedException('LINE Login token format is invalid.');
    }
    const channelId = this.config.lineLoginChannelId;
    if (!channelId) {
      throw new UnauthorizedException('LINE Login channel is not configured.');
    }

    const body = new URLSearchParams({ id_token: token, client_id: channelId });
    if (opts?.nonce) body.set('nonce', opts.nonce);

    let res: Response;
    try {
      res = await fetch('https://api.line.me/oauth2/v2.1/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        // The employee-link flow holds a claimed single-use token across this call;
        // an unbounded hang would widen that window (H-09).
        signal: AbortSignal.timeout(5000),
      });
    } catch (err) {
      throw new UnauthorizedException('LINE Login verification request failed.');
    }

    if (!res.ok) {
      throw new UnauthorizedException('LINE Login token verification failed.');
    }

    const data = (await res.json()) as LineVerifyResponse;
    if (!data.sub) {
      throw new UnauthorizedException('LINE Login token has no subject.');
    }
    // L-04: re-check the verified result before any identity work. LINE's endpoint is the
    // signature authority, but the response is still data — a token minted for another
    // channel, or one that has since expired, must not be trusted here.
    if (data.aud !== channelId) {
      throw new UnauthorizedException('LINE Login token audience does not match the configured channel.');
    }
    if (typeof data.exp !== 'number' || data.exp * 1000 <= Date.now()) {
      throw new UnauthorizedException('LINE Login token is expired.');
    }

    return {
      subject: data.sub,
      ...(typeof data.name === 'string' ? { name: data.name } : {}),
    };
  }
}
