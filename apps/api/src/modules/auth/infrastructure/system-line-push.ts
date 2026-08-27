/** Push messages through the system LINE OA (same channel the internal
 *  notification rail uses). Best-effort: never throws, and never logs message
 *  content or the recipient — callers pass temporary passwords and reset
 *  notices through here. Failures are logged status-only so a dead OA is not
 *  silently read as "employee has no LINE linked". */
export async function pushSystemLineMessages(token: string, lineUserId: string, messages: unknown[]): Promise<boolean> {
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ to: lineUserId, messages }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) console.warn('[system-line-push] LINE push failed', res.status);
    return res.ok;
  } catch {
    console.warn('[system-line-push] LINE push error');
    return false;
  }
}

export async function pushSystemLineMessage(token: string, lineUserId: string, text: string): Promise<boolean> {
  return pushSystemLineMessages(token, lineUserId, [{ type: 'text', text }]);
}

/**
 * Temporary-password card (Owner 2026-08-27): the code rides in a one-tap
 * "คัดลอกรหัส" clipboard button instead of being retyped from a plain text
 * bubble. The altText deliberately OMITS the password so it never appears in a
 * lock-screen notification preview — an improvement over the old text push,
 * which leaked the code into the preview. The code stays visible in the body
 * as the retype fallback for LINE clients too old for clipboard actions
 * (flex text is not long-press copyable, so the button is the copy path).
 */
export function buildTemporaryPasswordFlexMessage(temporaryPassword: string, infoLines: string[]): unknown {
  return {
    type: 'flex',
    altText: '🔐 รหัสผ่านชั่วคราวมาแล้ว เปิดดูในแชทนะคะ',
    contents: {
      type: 'bubble', size: 'kilo',
      body: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px', contents: [
        { type: 'text', text: '🔐 รหัสผ่านชั่วคราว', weight: 'bold', size: 'md', color: '#101828' },
        { type: 'text', text: temporaryPassword, weight: 'bold', size: 'xl', color: '#16A34A', wrap: true },
        ...infoLines.map((line) => ({ type: 'text', text: line, size: 'xs', color: '#667085', wrap: true })),
      ] },
      footer: { type: 'box', layout: 'vertical', contents: [
        { type: 'button', style: 'primary', color: '#22C55E', action: { type: 'clipboard', label: 'คัดลอกรหัส', clipboardText: temporaryPassword } },
      ] },
    },
  };
}
