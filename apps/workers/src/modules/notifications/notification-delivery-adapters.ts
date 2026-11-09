/**
 * Notification Delivery Adapters (Item 06)
 * Web and LINE delivery adapters.
 * LINE delivery requires linked ExternalIdentity and active LineChannelBinding.
 */

// Same rule as isVirtualDemoTarget in packages/contracts/src/demo-chat.ts. The workers image ships
// only @watchdog-bms/config, so the reserved virtual demo coordinates are repeated here; keep both equal.
function isVirtualDemoTarget(target?: string, channelId?: string): boolean {
  return channelId === 'demo-web' || !!target && (target.startsWith('Vdemo') || target.startsWith('vreply:'));
}

export type DeliveryResult = {
  status: 'sent' | 'failed' | 'skipped' | 'suppressed';
  providerMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
};

export type LineDeliveryInput = {
  channelId?: string;
  reportClassification?: string;
  lineUserId: string;
  channelAccessToken: string;
  message: string;
};

// ---- LINE Message Templates ----

export function buildLineMessage(params: {
  triggerKey: string;
  title: string;
  body: string;
  severity: string;
  deepLinkHref?: string;
  companyId: string;
}): string {
  const severityLabel: Record<string, string> = {
    critical: '🔴 สำคัญ',
    action: '🟡 ต้องดำเนินการ',
    insight: '🔵 ข้อมูล',
    info: '⚪ แจ้งเตือน',
  };
  const label = severityLabel[params.severity.toLowerCase()] ?? '📣';
  const baseUrl = process.env['WEB_BASE_URL'] ?? 'https://app.watchdog.local';
  const deepLink = params.deepLinkHref
    ? `${baseUrl}${params.deepLinkHref}`
    : `${baseUrl}/companies/${params.companyId}/dashboard`;

  return [
    `[มั่งมีพลัส] ${label}`,
    params.title,
    params.body,
    `เปิดแดชบอร์ด: ${deepLink}`,
  ].join('\n');
}

export function buildStockLowLineMessage(params: {
  productSku: string;
  currentBalance: number;
  reorderPoint: number;
  companyId: string;
  productId: string;
}): string {
  const baseUrl = process.env['WEB_BASE_URL'] ?? 'https://app.watchdog.local';
  return [
    '[มั่งมีพลัส] 🟡 สต็อกต่ำ',
    `SKU ${params.productSku}: ปัจจุบัน ${params.currentBalance}, Reorder Point ${params.reorderPoint}`,
    `เปิดระบบ: ${baseUrl}/companies/${params.companyId}/inventory/products/${params.productId}`,
  ].join('\n');
}

// ---- Web Delivery Adapter ----
// Web delivery: the recipient row is created and status set to 'sent' synchronously.
// The web notification center reads from NotificationRecipient/NotificationEvent tables.

export function processWebDelivery(): DeliveryResult {
  return { status: 'sent' };
}

// ---- LINE Delivery Adapter ----
// Sends a LINE push message using the Messaging API.
// Skips if no lineUserId or no channelAccessToken.

export async function processLineDelivery(input: LineDeliveryInput): Promise<DeliveryResult> {
  if (input.reportClassification === 'DEMO' || isVirtualDemoTarget(input.lineUserId, input.channelId)) {
    console.info('[notification-delivery] demo outbound suppressed');
    return { status: 'suppressed', errorCode: 'DEMO_OUTBOUND_SUPPRESSED' };
  }
  if (!input.lineUserId || !input.channelAccessToken) {
    return { status: 'skipped', errorCode: 'NO_LINE_IDENTITY', errorMessage: 'No linked LINE identity or channel config' };
  }

  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.channelAccessToken}`,
      },
      body: JSON.stringify({
        to: input.lineUserId,
        messages: [{ type: 'text', text: input.message }],
      }),
    });

    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as { sentMessages?: Array<{ id: string }> };
      return { status: 'sent', providerMessageId: data.sentMessages?.[0]?.id };
    }

    if (res.status === 429) {
      return { status: 'failed', errorCode: 'RATE_LIMIT', errorMessage: 'LINE API rate limit' };
    }
    if (res.status === 400) {
      return { status: 'failed', errorCode: 'INVALID_USER', errorMessage: 'Invalid LINE user id' };
    }
    return { status: 'failed', errorCode: `HTTP_${res.status}`, errorMessage: 'LINE API error' };
  } catch (err) {
    return { status: 'failed', errorCode: 'NETWORK_ERROR', errorMessage: 'Network error contacting LINE API' };
  }
}
