const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { test } = require('node:test');
const { handle } = require(process.env.OFFICIAL_BUNDLE_PATH);
const secret = 'official-only-local-test-secret';
const domain = 'localtest.lambda-url.ap-southeast-1.on.aws';
const credentials = async () => ({ secret, token: 'official-only-test-token' });
const context = { invokedFunctionArn: 'arn:aws:lambda:ap-southeast-1:311414082667:function:watchdog-bms-line-official-oa-prod:live' };
function request(events, key = secret) {
  const body = JSON.stringify({ events });
  return { rawPath: '/webhook', body, requestContext: { http: { method: 'POST' }, domainName: domain },
    headers: { 'x-line-signature': createHmac('sha256', key).update(body).digest('base64') } };
}
const message = text => ({ type: 'message', source: { type: 'user' }, message: { type: 'text', text }, replyToken: 'test-reply-token' });

test('three exact icons serve PNG without credential access; other paths stay closed', async () => {
  for (const name of ['instagram', 'facebook', 'tiktok']) {
    const result = await handle({ rawPath: '/assets/line/official-oa-' + name + '.png', requestContext: { http: { method: 'GET' } } }, context, async () => assert.fail('asset read requested credentials'));
    assert.equal(result.statusCode, 200);
    assert.equal(result.headers['content-type'], 'image/png');
    assert.equal(Buffer.from(result.body, 'base64').subarray(1, 4).toString(), 'PNG');
  }
  assert.equal((await handle({ rawPath: '/assets/line/../secret', requestContext: { http: { method: 'GET' } } }, context)).statusCode, 404);
});

test('missing/system signature cannot send and signed base64 verification works', async () => {
  const missing = request([]); missing.headers = {};
  assert.equal((await handle(missing, context, async () => assert.fail('missing signature loaded credentials'))).statusCode, 401);
  assert.equal((await handle(request([], 'system-secret'), context, credentials)).statusCode, 401);
  const encoded = request([]); encoded.body = Buffer.from(encoded.body).toString('base64'); encoded.isBase64Encoded = true;
  assert.equal((await handle(encoded, context, credentials)).statusCode, 200);
});

test('staging and unrelated/group messages never call LINE', async () => {
  const original = global.fetch; global.fetch = async () => assert.fail('unexpected LINE call');
  try {
    assert.equal((await handle(request([message('Social Media')]), { invokedFunctionArn: 'function:staging' }, credentials)).statusCode, 200);
    assert.equal((await handle(request([message('hello'), { ...message('Social Media'), source: { type: 'group' } }]), context, credentials)).statusCode, 200);
  } finally { global.fetch = original; }
});

test('live sends original compact cards with exact three actions and own icon origin', async () => {
  const calls = []; const original = global.fetch;
  global.fetch = async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return new Response('{}'); };
  try {
    assert.equal((await handle(request([message('ติดต่อมั่งมีทีม'), message('Social Media')]), context, credentials)).statusCode, 200);
    assert.equal(calls.length, 2);
    for (const call of calls) {
      assert.equal(call.url, 'https://api.line.me/v2/bot/message/reply');
      assert.equal(call.init.redirect, 'error');
      assert.equal(call.init.headers.authorization, 'Bearer official-only-test-token');
      assert.equal(call.body.messages.length, 1);
      assert.equal(call.body.messages[0].contents.size, 'kilo');
      assert.equal(call.body.messages[0].contents.footer.contents.length, 3);
    }
    const contact = calls[0].body.messages[0];
    assert.equal(contact.contents.footer.contents[0].action.clipboardText, 'contact@mangmeeplus.com');
    assert.equal(contact.contents.footer.contents[1].action.uri, 'tel:0982565628');
    assert.equal(contact.contents.footer.contents[2].action.uri, 'https://official.mangmeeplus.com/');
    assert.equal(JSON.stringify(contact.contents.body).includes('contact@mangmeeplus.com'), false);
    const rows = calls[1].body.messages[0].contents.footer.contents;
    assert.equal(rows[0].action.uri, 'https://www.instagram.com/mangmee_plus?stkn=MXR2M2kwdjl0MnV2');
    assert.equal(rows[1].action.uri, 'https://www.facebook.com/share/17k2DsH7TJ/');
    assert.equal(rows[2].action.uri, 'https://www.tiktok.com/@mangmee_plus?_r=1&_t=ZS-9AGf8zsKkJY');
    assert.ok(rows.every(row => new URL(row.contents[0].url).origin === 'https://' + domain));
  } finally { global.fetch = original; }
});

test('provider failure returns 502; reused single-use reply token is acknowledged', async () => {
  const original = global.fetch;
  try {
    global.fetch = async () => new Response('{}', { status: 503 });
    assert.equal((await handle(request([message('Social Media')]), context, credentials)).statusCode, 502);
    global.fetch = async () => new Response('{"message":"Invalid reply token"}', { status: 400 });
    assert.equal((await handle(request([message('Social Media')]), context, credentials)).statusCode, 200);
  } finally { global.fetch = original; }
});
