import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AppConfigService } from '../../../common/config/app-config.service';
import { LineLoginVerifierAdapter } from '../infrastructure/line-login-verifier.adapter';

export type VerifiedLineIdToken = Readonly<{
  providerUserId: string;
  /** LINE profile name from the VERIFIED token, never from whatever the client page displayed. */
  displayName?: string;
  /** The channel an ExternalIdentity row for this person belongs to. */
  channelId: string;
}>;

/**
 * Review SEC-01: one place that turns a LIFF ID token into an identity, so every surface gets the
 * same signature check, the same audience check (`LineLoginVerifierAdapter`, AUTH-02) and the same
 * channel resolution. Nothing a client sends about itself — display name, user id, picture — is
 * ever trusted; only what came back verified.
 */
@Injectable()
export class LineIdTokenService {
  constructor(
    private readonly verifier: LineLoginVerifierAdapter,
    private readonly config: AppConfigService,
  ) {}

  async verify(idToken: string): Promise<VerifiedLineIdToken> {
    const { subject, name } = await this.verifier.verify(idToken);
    // Messaging user ids are channel-scoped; the Login channel only proves identity. Same
    // resolution order as LinkLineIdentityUseCase, so both write into the same identity slot.
    const canonicalChannelId = this.config.lineMessagingChannelId ?? this.config.lineLoginChannelId;
    if (!canonicalChannelId && this.config.isProduction) {
      // P12.1: production must never create or resolve an 'unknown'-channel identity.
      throw new ServiceUnavailableException('LINE channel configuration is missing.');
    }
    return {
      providerUserId: subject,
      ...(name ? { displayName: name } : {}),
      // ponytail: 'unknown' survives for local/dev only; production fails closed above
      channelId: canonicalChannelId ?? 'unknown',
    };
  }
}
