/** Push one text message through the system LINE OA (same channel the internal
 *  notification rail uses). Best-effort: never throws, and never logs `text` or
 *  the recipient — callers pass temporary passwords and reset notices through
 *  here. Failures are logged status-only so a dead OA is not silently read as
 *  "employee has no LINE linked". */
export async function pushSystemLineMessage(token: string, lineUserId: string, text: string): Promise<boolean> {
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ to: lineUserId, messages: [{ type: 'text', text }] }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) console.warn('[system-line-push] LINE push failed', res.status);
    return res.ok;
  } catch {
    console.warn('[system-line-push] LINE push error');
    return false;
  }
}
