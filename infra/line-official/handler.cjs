const { officialOaReplyForText } = require('../../apps/api/src/modules/auth/domain/logic/line-official-menu.logic.ts');
const { verifyLineWebhookSignature } = require('../../apps/api/src/modules/auth/infrastructure/line-webhook-verifier.ts');
const images = {
  '/assets/line/official-oa-instagram.png': require('../../apps/web/public/assets/line/official-oa-instagram.png'),
  '/assets/line/official-oa-facebook.png': require('../../apps/web/public/assets/line/official-oa-facebook.png'),
  '/assets/line/official-oa-tiktok.png': require('../../apps/web/public/assets/line/official-oa-tiktok.png'),
};

let credentialsPromise;
let expiresAt = 0;
async function loadCredentials() {
  if (credentialsPromise && Date.now() < expiresAt) return credentialsPromise;
  // ponytail: Lambda provides SDK v3; the bundle adds no application dependency.
  const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
  const client = new SecretsManagerClient({ region: 'ap-southeast-1', maxAttempts: 1 });
  credentialsPromise = Promise.all(['OFFICIAL_SECRET_ARN', 'OFFICIAL_TOKEN_ARN'].map(key =>
    client.send(new GetSecretValueCommand({ SecretId: process.env[key], VersionStage: 'AWSCURRENT' }),
      { abortSignal: AbortSignal.timeout(3000) }))).then(([secret, token]) => {
    if (!secret.SecretString?.trim() || !token.SecretString?.trim()) throw new Error('Missing Official credentials');
    return { secret: secret.SecretString, token: token.SecretString };
  }).catch(() => { credentialsPromise = undefined; expiresAt = 0; throw new Error('Official credentials unavailable'); });
  expiresAt = Date.now() + 60000;
  return credentialsPromise;
}

const response = (statusCode, body = '{}') => ({
  statusCode, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body,
});

async function handle(event, context, getCredentials = loadCredentials) {
  const method = event.requestContext?.http?.method;
  if (method === 'GET' && Object.hasOwn(images, event.rawPath)) return {
    statusCode: 200, headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=300' },
    isBase64Encoded: true, body: images[event.rawPath],
  };
  if (method !== 'POST' || event.rawPath !== '/webhook') return response(404);
  const signature = event.headers?.['x-line-signature'];
  if (typeof signature !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(signature)) return response(401);
  if (typeof event.body !== 'string') return response(400);
  const raw = Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8');
  if (raw.length > 1024 * 1024) return response(413);
  let credentials;
  try { credentials = await getCredentials(); } catch { console.error('official.credentials_unavailable'); return response(503); }
  if (!verifyLineWebhookSignature(raw, signature, credentials.secret)) return response(401);
  let body;
  try { body = JSON.parse(raw.toString('utf8')); } catch { return response(400); }
  if (!Array.isArray(body?.events)) return response(200);
  // Staging exercises this exact immutable version without sending customer messages.
  if (!context.invokedFunctionArn?.endsWith(':live')) return response(200);
  const domain = event.requestContext.domainName;
  if (!/^[a-z0-9]+\.lambda-url\.ap-southeast-1\.on\.aws$/.test(domain || '')) return response(503);
  for (const item of body.events) {
    if (item?.type !== 'message' || item.source?.type !== 'user' ||
      item.message?.type !== 'text' || typeof item.message.text !== 'string' ||
      typeof item.replyToken !== 'string' || !item.replyToken) continue;
    const reply = officialOaReplyForText(item.message.text, 'https://' + domain);
    if (!reply) continue;
    try {
      const result = await fetch('https://api.line.me/v2/bot/message/reply', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
        headers: { authorization: 'Bearer ' + credentials.token, 'content-type': 'application/json' },
        body: JSON.stringify({ replyToken: item.replyToken, messages: [reply] }),
      });
      if (result.ok || (result.status === 400 && /invalid reply token/i.test(await result.text()))) continue;
      console.error('official.reply_rejected', result.status);
    } catch { console.error('official.reply_unavailable'); }
    return response(502);
  }
  return response(200);
}

exports.handler = async (event, context) => handle(event, context);
exports.handle = handle;
