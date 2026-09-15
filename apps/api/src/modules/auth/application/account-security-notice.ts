import type { LineMessagingCredentialsService } from '../../../common/config/line-messaging-credentials.service';
import type { PrismaService } from '../../../common/database/prisma.service';
import { pushSystemLineMessage } from '../infrastructure/system-line-push';

/** Where to reach a human, repeated in the notice because it is the only action it asks for. */
export const ACCOUNT_SECURITY_CONTACT = 'โทร 098-256-5628';

export const PASSWORD_SET_NOTICE =
  `มีการตั้งรหัสผ่านให้บัญชีนี้เมื่อสักครู่ค่ะ ถ้าไม่ใช่คุณ ติดต่อทีมงานทันทีที่ ${ACCOUNT_SECURITY_CONTACT}`;

export const EMAIL_VERIFIED_NOTICE =
  `มีการเพิ่มอีเมลให้บัญชีนี้เมื่อสักครู่ค่ะ ถ้าไม่ใช่คุณ ติดต่อทีมงานทันทีที่ ${ACCOUNT_SECURITY_CONTACT}`;

/**
 * Out-of-band notice for a change to how an account can be logged into.
 *
 * A LINE-first owner has no email to send a security notice to and no password whose change they
 * would notice — LINE is the only channel that reaches them, so a stolen session that quietly
 * added a password would otherwise leave no trace the owner could see. Sent to the linked LINE
 * identity only; an account without one gets nothing rather than an error.
 *
 * Best-effort by construction: `pushSystemLineMessage` never throws, and a failed notice must not
 * roll back the change the user actually asked for.
 */
export async function notifyAccountSecurityChange(
  prisma: PrismaService,
  credentials: LineMessagingCredentialsService,
  userId: string,
  text: string,
): Promise<boolean> {
  try {
  const {accessToken: channelAccessToken, channelId} = await credentials.get();
  if (!channelAccessToken || !channelId) return false;
  // ACTIVE only: an unlinked or revoked identity belongs to a LINE account that no longer speaks
  // for this user, and "a password was set on your account" is the last message to send there.
  const identity = await prisma.client.externalIdentity.findFirst({
    where: { userId, provider: 'LINE', providerChannelId: channelId, status: 'ACTIVE' },
    select: { providerUserId: true },
  });
  if (!identity) return false;
  return await pushSystemLineMessage(channelAccessToken, identity.providerUserId, text);
  } catch { return false; }
}
