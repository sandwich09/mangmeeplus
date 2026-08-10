/**
 * Local LINE webhook smoke – no LINE account needed.
 *
 * Computes a valid HMAC-SHA256 signature and POSTs a synthetic webhook payload
 * to the running local API. Use this before ngrok+LINE Console to prove the
 * full webhook → identity resolution → AI Gateway → reply path works.
 *
 * Usage:
 *   LINE_MESSAGING_CHANNEL_SECRET=<secret> \
 *   LINE_LOCAL_USER_ID=<userId in ExternalIdentity> \
 *   tsx apps/api/src/modules/line-ai/line-webhook-local-smoke.ts [message]
 *
 * Required env:
 *   LINE_MESSAGING_CHANNEL_SECRET  - channel secret from LINE Developers Console
 *   LINE_LOCAL_USER_ID             - LINE providerUserId seeded in ExternalIdentity table
 *
 * Optional env:
 *   API_URL  - defaults to http://localhost:3001/v1
 *   SMOKE_SCENARIO  - "query" (default) | "mutation" | "companies" | "fragments" | "multiintent"
 *                     ("fragments" posts 3 text bubbles in one delivery and must
 *                      produce ONE buffered AI turn — message buffering spec)
 *                     ("multiintent" posts the item-10F golden 3-command sentence; with
 *                      LINE_AI_TOOLUSE_LOOP_ENABLED=true expect ordered answers + value
 *                      candidates + coverage in the gateway logs)
 *
 * Prerequisites:
 *   1. API running: pnpm --filter @watchdog-bms/api dev
 *   2. AI Gateway running: pnpm --filter @watchdog-bms/ai-gateway dev
 *   3. Postgres + Redis running
 *   4. Seed: INSERT INTO "ExternalIdentity" (id, "userId", provider, "providerUserId", status, "createdAt", "updatedAt")
 *            VALUES ('seed-line-1', '<internal-user-id>', 'LINE', '<LINE_LOCAL_USER_ID>', 'ACTIVE', now(), now());
 *      The internal user must have an active company membership with 'line.ai.query' permission.
 *
 * NEVER put real LINE_MESSAGING_CHANNEL_SECRET in committed files.
 */
import { createHmac } from 'node:crypto';

const SECRET = process.env['LINE_MESSAGING_CHANNEL_SECRET'];
const LINE_USER_ID = process.env['LINE_LOCAL_USER_ID'];
const API_URL = (process.env['API_URL'] ?? 'http://localhost:3001/v1').replace(/\/$/, '');
const SCENARIO = (process.env['SMOKE_SCENARIO'] ?? 'query') as 'query' | 'mutation' | 'companies' | 'fragments' | 'multiintent';

// Multi-bubble utterance — must be buffered into ONE joined AI turn
// (docs/specs/line-ai-message-buffering-spec.md §6/§8).
const FRAGMENTS = ['ขอ', 'รายชื่อ', 'ลูกค้า'];

const MESSAGES: Record<typeof SCENARIO, string> = {
  query: process.argv[2] ?? 'ดูสต็อกสินค้าใกล้หมด',
  mutation: 'สั่งซื้อสินค้าเพิ่ม 100 ชิ้น',
  companies: '/companies',
  fragments: FRAGMENTS.join(' / '),
  // Item 10F golden sentence (spec §15): explicit BE date + Thai number words + two reads.
  multiintent: process.argv[2] ?? 'ยอดขายเดือนนี้เท่าไหร่ ของใกล้หมดมีอะไรบ้าง แล้วค่าใช้จ่ายตั้งแต่ 9/12/2537 รวมเท่าไหร่',
};

if (!SECRET) {
  console.error('[line-smoke] ERROR: LINE_MESSAGING_CHANNEL_SECRET is required');
  process.exit(1);
}
if (!LINE_USER_ID) {
  console.error('[line-smoke] ERROR: LINE_LOCAL_USER_ID is required');
  console.error('[line-smoke] Seed: INSERT INTO "ExternalIdentity" (...) VALUES (\'seed-line-1\', \'<user-id>\', \'LINE\', \'<this-value>\', \'ACTIVE\', now(), now())');
  process.exit(1);
}

const MESSAGE = MESSAGES[SCENARIO];
const eventId = `smoke-${SCENARIO}-${Date.now()}`;

const events = SCENARIO === 'fragments'
  ? FRAGMENTS.map((text, index) => ({
      type: 'message',
      webhookEventId: `${eventId}-${index}`,
      replyToken: `smoke-reply-${eventId}-${index}`,
      timestamp: Date.now() + index,
      source: { type: 'user', userId: LINE_USER_ID },
      message: { type: 'text', id: `msg-${eventId}-${index}`, text },
    }))
  : [
      {
        type: 'message',
        webhookEventId: eventId,
        replyToken: `smoke-reply-${eventId}`,
        timestamp: Date.now(),
        source: { type: 'user', userId: LINE_USER_ID },
        message: { type: 'text', id: `msg-${eventId}`, text: MESSAGE },
      },
    ];

const payload = JSON.stringify({
  destination: 'U0000000000000000000000000000000',
  events,
});

const signature = createHmac('sha256', SECRET).update(payload).digest('base64');

const EXPECTED: Record<typeof SCENARIO, string> = {
  query: 'AI Gateway call attempted; check API logs for turn result',
  mutation: 'mutation_blocked refusal; expect: ขออภัยค่ะ น้องมั่งมีไม่สามารถดำเนินการนี้ผ่าน LINE ได้',
  companies: 'company list returned; expect: 🏢 บริษัทที่คุณเข้าถึงได้ (or UNLINKED if no membership)',
  fragments: `ONE buffered AI turn after ~2.5s debounce with joined text "${FRAGMENTS.join('\\n')}" — check API logs for a single requestLineTurn`,
  multiintent: 'item 10F: with LINE_AI_TOOLUSE_LOOP_ENABLED=true expect parallel tool calls + coverage verdicts in gateway logs; date 9/12/2537 must reach tools as 1994-12-09 only; with LINE_AI_LEDGER_ENABLED=true expect ai.line.ledger.appended/acked audit rows',
};

void (async () => {
  console.log(`[line-smoke] scenario=${SCENARIO} message="${MESSAGE}"`);
  console.log(`[line-smoke] endpoint=${API_URL}/line/webhook eventId=${eventId}`);
  console.log(`[line-smoke] expected: ${EXPECTED[SCENARIO]}`);

  let response: Response;
  try {
    response = await fetch(`${API_URL}/line/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Line-Signature': signature,
      },
      body: payload,
    });
  } catch (err) {
    console.error(`[line-smoke] FAIL: connection error: ${(err as Error).message}`);
    console.error(`[line-smoke] Is the API running at ${API_URL}?`);
    process.exit(1);
  }

  const status = response.status;
  let body = '';
  try { body = await response.text(); } catch {}

  if (status === 200) {
    console.log(`[line-smoke] PASS: status=200 body=${body || '{}'}`);
    console.log('[line-smoke] Check API logs for AI Gateway call result and LINE reply attempt.');
    process.exit(0);
  }

  if (status === 401) {
    const text = body.slice(0, 300);
    if (text.includes('signature')) {
      console.error('[line-smoke] FAIL: 401 signature invalid – LINE_MESSAGING_CHANNEL_SECRET mismatch with API env');
    } else if (text.includes('secret not configured')) {
      console.error('[line-smoke] FAIL: 401 – API LINE_MESSAGING_CHANNEL_SECRET not set in API env');
    } else {
      console.error(`[line-smoke] FAIL: 401 body=${text}`);
    }
    process.exit(1);
  }

  console.error(`[line-smoke] FAIL: status=${status} body=${body.slice(0, 300)}`);
  process.exit(1);
})();
