import { randomBytes } from 'node:crypto';
import { hashToken } from '../domain/logic/secure-token.logic';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import { AppConfigService } from '../../../common/config/app-config.service';
import { LineLoginTokenClient } from '../infrastructure/line-login-token.client';
import { LineLoginVerifierAdapter } from '../infrastructure/line-login-verifier.adapter';
import { emailReauthBinding } from '../domain/logic/email-otp.logic';
import { accountEmailState, emailError, lockAccountEmail } from './account-email-state';

@Injectable()
export class AccountEmailReauthService {
  constructor(private readonly prisma: PrismaService, private readonly config: AppConfigService,
    private readonly tokens: LineLoginTokenClient, private readonly verifier: LineLoginVerifierAdapter) {}

  async begin(input: { userId: string; tokenId: string }) {
    const channelId = this.config.lineLoginChannelId;
    if (!channelId || !this.config.lineLoginChannelSecret) throw emailError('EMAIL_DELIVERY_UNAVAILABLE', 'ยังยืนยันตัวตนผ่าน LINE ไม่ได้ กรุณาลองใหม่ภายหลัง', 503);
    const nonce = randomBytes(32).toString('base64url');
    await this.prisma.client.$transaction(async tx => {
      await lockAccountEmail(tx, input.userId);
      const { user, now } = await accountEmailState(tx, input.userId);
      if (!user.externalIdentities.some(i => i.provider === 'LINE' && i.status === 'ACTIVE' && i.providerChannelId === (this.config.lineMessagingChannelId ?? channelId))) {
        throw emailError('EMAIL_REAUTH_REQUIRED', 'กรุณาใช้ LINE ที่ผูกกับบัญชีนี้ หรือติดต่อทีมงานเพื่อตรวจการผูกบัญชี', 403);
      }
      const changed = await tx.authSession.updateMany({ where: { userId: user.id, status: 'ACTIVE', expiresAt: { gt: now },
        OR: [{ tokenId: input.tokenId }, { previousTokenId: input.tokenId }] }, data: {
          emailReauthNonceHash: hashToken(nonce), emailReauthExpiresAt: new Date(now.getTime() + 600_000),
          emailReauthenticatedAt: null, emailReauthBindingHash: emailReauthBinding(user),
        } });
      if (!changed.count) throw emailError('EMAIL_REAUTH_REQUIRED', 'กรุณาเข้าสู่ระบบอีกครั้ง', 401);
    });
    return { nonce, channelId };
  }

  async execute(input: { userId: string; tokenId: string; code: string; codeVerifier: string; nonce: string }) {
    const started = await this.prisma.client.authSession.findFirst({ where: {
      userId: input.userId, status: 'ACTIVE', emailReauthNonceHash: hashToken(input.nonce),
      emailReauthExpiresAt: { gt: new Date() }, expiresAt: { gt: new Date() },
      OR: [{ tokenId: input.tokenId }, { previousTokenId: input.tokenId }],
    } });
    if (!started) throw emailError('EMAIL_REAUTH_REQUIRED', 'กรุณาเริ่มยืนยันตัวตนผ่าน LINE ใหม่', 403);
    const { idToken } = await this.tokens.exchangeAuthorizationCode({ code: input.code, codeVerifier: input.codeVerifier,
      redirectUri: `${(this.config.webBaseUrl ?? 'http://localhost:3000').replace(/\/+$/, '')}/api/auth/line-login/callback` });
    const verified = await this.verifier.verify(idToken, { nonce: input.nonce });
    return this.prisma.client.$transaction(async tx => {
      await lockAccountEmail(tx, input.userId);
      const { user, now } = await accountEmailState(tx, input.userId);
      if (typeof verified.authenticatedAt !== 'number' || verified.authenticatedAt * 1000 < now.getTime() - 300_000 ||
          verified.authenticatedAt * 1000 > now.getTime() + 30_000 || started.emailReauthBindingHash !== emailReauthBinding(user)) {
        throw emailError('EMAIL_REAUTH_REQUIRED', 'กรุณายืนยันตัวตนผ่าน LINE ใหม่', 403);
      }
      const identity = user.externalIdentities.find(i => i.status === 'ACTIVE' && i.provider === 'LINE' &&
        i.providerUserId === verified.subject && i.providerChannelId === (this.config.lineMessagingChannelId ?? this.config.lineLoginChannelId));
      if (!identity) throw emailError('EMAIL_REAUTH_REQUIRED', 'กรุณาใช้ LINE ที่ผูกกับบัญชีนี้', 403);
      const changed = await tx.authSession.updateMany({ where: { userId: user.id, status: 'ACTIVE', expiresAt: { gt: now },
        id: started.id, emailReauthNonceHash: hashToken(input.nonce), emailReauthExpiresAt: { gt: now },
        OR: [{ tokenId: input.tokenId }, { previousTokenId: input.tokenId }] },
        data: { emailReauthenticatedAt: now, emailReauthBindingHash: emailReauthBinding(user), emailReauthNonceHash: null, emailReauthExpiresAt: null } });
      if (!changed.count) throw emailError('EMAIL_REAUTH_REQUIRED', 'กรุณาเข้าสู่ระบบอีกครั้ง', 401);
      return { reauthenticated: true };
    });
  }
}
