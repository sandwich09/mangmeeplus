import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LineHandoffLinkService, type LineHandoffContext } from './line-handoff-link.service';
import type { LineReplyMessage } from '../infrastructure/line-reply.adapter';

const WEB = 'https://uat.mangmeeplus.com';
const COMPANY = 'co-1';
const CTX: LineHandoffContext = {
  userId: 'user-1', companyId: COMPANY, lineUserId: 'Uabc', surface: 'line_ai_reply',
};

/** Deterministic minter: one token per call, so a test can name the URL it expects. */
function makeMint(behaviour: 'ok' | 'throw' = 'ok') {
  const calls: any[] = [];
  let n = 0;
  return {
    calls,
    mint: {
      execute: async (input: unknown) => {
        calls.push(input);
        if (behaviour === 'throw') throw new Error('mint exploded');
        n += 1;
        return { rawToken: `tok${n}`, expiresAt: new Date(Date.now() + 60_000) };
      },
    } as any,
  };
}

function makeService(options: {
  enabled?: boolean;
  webBaseUrl?: string | undefined;
  behaviour?: 'ok' | 'throw';
} = {}) {
  const { calls, mint } = makeMint(options.behaviour);
  const config = {
    lineWebHandoffEnabled: options.enabled ?? true,
    webBaseUrl: 'webBaseUrl' in options ? options.webBaseUrl : WEB,
  } as any;
  const warnings: unknown[] = [];
  const service = new LineHandoffLinkService(config, mint);
  (service as any).logger = { warn: (entry: unknown) => warnings.push(entry) };
  return { service, calls, warnings };
}

const text = (value: string): LineReplyMessage => ({ type: 'text', text: value });

describe('LineHandoffLinkService with the flag off', () => {
  it('returns the very same array, so behaviour is byte-identical to today', async () => {
    const { service, calls } = makeService({ enabled: false });
    const messages = [text(`ดูรายการที่ ${WEB}/companies/${COMPANY}/expenses/exp-1`)];
    const result = await service.wrapOutgoingLineContent(CTX, messages);
    assert.equal(result, messages, 'the identical array reference must come back');
    assert.equal(calls.length, 0, 'no token may be minted while the flag is off');
  });

  it('returns the same array when no web base URL is configured', async () => {
    const { service, calls } = makeService({ webBaseUrl: undefined });
    const messages = [text('https://uat.mangmeeplus.com/companies/co-1/expenses/exp-1')];
    assert.equal(await service.wrapOutgoingLineContent(CTX, messages), messages);
    assert.equal(calls.length, 0);
  });

  it('returns the same array when the send has no resolved recipient', async () => {
    const { service, calls } = makeService();
    const messages = [text(`${WEB}/companies/${COMPANY}/expenses/exp-1`)];
    assert.equal(await service.wrapOutgoingLineContent(null, messages), messages);
    assert.equal(calls.length, 0, 'no identity means no token — the plain link ships');
  });
});

describe('LineHandoffLinkService text rewriting', () => {
  it('replaces a tenant URL with <web>/l/<token> and keeps the surrounding copy', async () => {
    const { service, calls } = makeService();
    const [message] = await service.wrapOutgoingLineContent(
      CTX,
      [text(`บันทึกแล้วค่ะ ดูรายการที่ ${WEB}/companies/${COMPANY}/expenses/exp-1 นะคะ`)],
    );
    assert.equal((message as { text: string }).text, `บันทึกแล้วค่ะ ดูรายการที่ ${WEB}/l/tok1 นะคะ`);
    assert.deepEqual(calls, [{
      userId: 'user-1',
      companyId: COMPANY,
      lineUserId: 'Uabc',
      surface: 'line_ai_reply',
      targetPath: `/companies/${COMPANY}/expenses/exp-1`,
    }]);
  });

  it('carries the query string into the stored target path', async () => {
    const { service, calls } = makeService();
    await service.wrapOutgoingLineContent(CTX, [text(`${WEB}/companies/${COMPANY}/expenses?status=DRAFT`)]);
    assert.equal(calls[0].targetPath, `/companies/${COMPANY}/expenses?status=DRAFT`);
  });

  it('mints one token per distinct URL and reuses it for a repeat of the same URL', async () => {
    const { service, calls } = makeService();
    const url = `${WEB}/companies/${COMPANY}/expenses/exp-1`;
    const [message] = await service.wrapOutgoingLineContent(CTX, [text(`${url} และอีกครั้ง ${url}`)]);
    assert.equal((message as { text: string }).text, `${WEB}/l/tok1 และอีกครั้ง ${WEB}/l/tok1`);
    assert.equal(calls.length, 1, 'the same destination twice is one destination');
  });

  it('rewrites several distinct destinations independently', async () => {
    const { service, calls } = makeService();
    const [message] = await service.wrapOutgoingLineContent(CTX, [text(
      `${WEB}/companies/${COMPANY}/expenses/exp-1 กับ ${WEB}/companies/${COMPANY}/expenses/exp-2`,
    )]);
    assert.equal((message as { text: string }).text, `${WEB}/l/tok1 กับ ${WEB}/l/tok2`);
    assert.equal(calls.length, 2);
  });

  it('leaves URLs on any other origin untouched, including the API upload links', async () => {
    const { service, calls } = makeService();
    const original = 'อัปโหลดที่ https://api.mangmeeplus.com/v1/uploads/abc และ https://line.me/R/ti/p/@oa';
    const [message] = await service.wrapOutgoingLineContent(CTX, [text(original)]);
    assert.equal((message as { text: string }).text, original);
    assert.equal(calls.length, 0);
  });

  it('leaves a web URL outside the tenant root untouched', async () => {
    const { service, calls } = makeService();
    const original = `${WEB}/login และ ${WEB}/terms`;
    const [message] = await service.wrapOutgoingLineContent(CTX, [text(original)]);
    assert.equal((message as { text: string }).text, original);
    assert.equal(calls.length, 0);
  });

  it('keeps the original URL when minting throws — a broken handoff never costs the link', async () => {
    const { service, calls, warnings } = makeService({ behaviour: 'throw' });
    const original = `ดูที่ ${WEB}/companies/${COMPANY}/expenses/exp-1`;
    const [message] = await service.wrapOutgoingLineContent(CTX, [text(original)]);
    assert.equal((message as { text: string }).text, original);
    assert.equal(calls.length, 1, 'the mint was attempted');
    assert.equal((warnings[0] as any).msg, 'line_handoff_mint_failed');
  });

  it('leaves a message with no URL exactly as it was', async () => {
    const { service, calls } = makeService();
    const messages = [text('บันทึกค่าใช้จ่ายเรียบร้อยแล้วค่ะ')];
    const result = await service.wrapOutgoingLineContent(CTX, messages);
    assert.equal(result[0], messages[0], 'an untouched message keeps its identity');
    assert.equal(calls.length, 0);
  });
});

describe('LineHandoffLinkService flex rewriting', () => {
  const bubble = (uri: string): LineReplyMessage => ({
    type: 'flex',
    altText: 'สรุปค่าใช้จ่าย',
    contents: {
      type: 'bubble',
      body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: 'สรุป' }] },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [{ type: 'button', action: { type: 'uri', label: 'เปิดรายการ', uri } }],
      },
    },
  });

  it('rewrites a nested uri action on the web tenant', async () => {
    const { service, calls } = makeService();
    const [message] = await service.wrapOutgoingLineContent(
      CTX,
      [bubble(`${WEB}/companies/${COMPANY}/expenses/exp-1`)],
    );
    const contents = (message as { contents: any }).contents;
    assert.equal(contents.footer.contents[0].action.uri, `${WEB}/l/tok1`);
    assert.equal(contents.footer.contents[0].action.label, 'เปิดรายการ', 'the visible label is unchanged');
    assert.equal(contents.body.contents[0].text, 'สรุป', 'untouched branches survive intact');
    assert.equal(calls[0].targetPath, `/companies/${COMPANY}/expenses/exp-1`);
  });

  it('leaves a flex uri on another origin alone', async () => {
    const { service, calls } = makeService();
    const original = bubble('https://line.me/R/ti/p/@oa');
    const [message] = await service.wrapOutgoingLineContent(CTX, [original]);
    assert.equal(message, original, 'nothing to rewrite means the same message object');
    assert.equal(calls.length, 0);
  });

  it('keeps the original uri when minting throws', async () => {
    const uri = `${WEB}/companies/${COMPANY}/expenses/exp-1`;
    const { service } = makeService({ behaviour: 'throw' });
    const [message] = await service.wrapOutgoingLineContent(CTX, [bubble(uri)]);
    assert.equal((message as { contents: any }).contents.footer.contents[0].action.uri, uri);
  });

  it('rewrites every tenant uri in a carousel of bubbles', async () => {
    const { service, calls } = makeService();
    const carousel: LineReplyMessage = {
      type: 'flex',
      altText: 'รายการ',
      contents: {
        type: 'carousel',
        contents: [
          { type: 'bubble', hero: { action: { type: 'uri', uri: `${WEB}/companies/${COMPANY}/a` } } },
          { type: 'bubble', hero: { action: { type: 'uri', uri: `${WEB}/companies/${COMPANY}/b` } } },
        ],
      },
    };
    const [message] = await service.wrapOutgoingLineContent(CTX, [carousel]);
    const bubbles = (message as { contents: any }).contents.contents;
    assert.equal(bubbles[0].hero.action.uri, `${WEB}/l/tok1`);
    assert.equal(bubbles[1].hero.action.uri, `${WEB}/l/tok2`);
    assert.equal(calls.length, 2);
  });
});

describe('LineHandoffLinkService never leaks a token', () => {
  it('logs nothing containing the minted token, on success or on failure', async () => {
    const { service, warnings } = makeService();
    await service.wrapOutgoingLineContent(CTX, [text(`${WEB}/companies/${COMPANY}/expenses/exp-1`)]);
    assert.equal(warnings.length, 0, 'a successful wrap logs nothing at all');

    const failing = makeService({ behaviour: 'throw' });
    await failing.service.wrapOutgoingLineContent(CTX, [text(`${WEB}/companies/${COMPANY}/expenses/exp-1`)]);
    const serialized = JSON.stringify(failing.warnings);
    assert.ok(!serialized.includes('/l/'), 'no handoff URL may reach a log line');
    assert.ok(!serialized.includes('tok'), 'no token may reach a log line');
  });
});
