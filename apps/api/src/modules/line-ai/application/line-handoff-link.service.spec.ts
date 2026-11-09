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

  it('never stores the in-app-browser escape in a target, whichever door the path came in by (R-B1)', async () => {
    const { service, calls } = makeService();
    await service.wrapOutgoingLineContent(CTX, [text(`${WEB}/companies/${COMPANY}/billing?openExternalBrowser=1`)]);
    assert.equal(calls[0].targetPath, `/companies/${COMPANY}/billing`);
    assert.equal(await service.linkFor({ ...CTX, companyId: 'co-2' }, '/companies/co-2/dashboard?openExternalBrowser=1'), `${WEB}/l/tok2`);
    assert.equal(calls[1].targetPath, '/companies/co-2/dashboard');
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

describe('LineHandoffLinkService.linkFor (explicit, one company per link)', () => {
  const PICKER: LineHandoffContext = { ...CTX, companyId: 'co-2', surface: 'company_picker_open_web' };

  it('mints a link for a company the message is NOT bound to, which the walk cannot do', async () => {
    const { service, calls } = makeService();
    assert.equal(await service.linkFor(PICKER, '/companies/co-2/dashboard'), `${WEB}/l/tok1`);
    assert.deepEqual(calls, [{
      userId: 'user-1', companyId: 'co-2', lineUserId: 'Uabc',
      surface: 'company_picker_open_web', targetPath: '/companies/co-2/dashboard',
    }]);
  });

  it('mints nothing at all while the handoff feature is off', async () => {
    for (const options of [{ enabled: false }, { webBaseUrl: undefined }]) {
      const { service, calls } = makeService(options);
      assert.equal(await service.linkFor(PICKER, '/companies/co-2/dashboard'), null);
      assert.equal(calls.length, 0, 'the caller must render exactly what it rendered before');
    }
  });

  it('returns null and warns without the token when minting throws', async () => {
    const { service, warnings } = makeService({ behaviour: 'throw' });
    assert.equal(await service.linkFor(PICKER, '/companies/co-2/dashboard'), null);
    assert.equal((warnings[0] as any).msg, 'line_handoff_mint_failed');
    assert.equal((warnings[0] as any).surface, 'company_picker_open_web');
    assert.ok(!JSON.stringify(warnings).includes('tok'));
  });
});

describe('LineHandoffLinkService never double-wraps a handoff link', () => {
  /** `/l/<token>` sits OUTSIDE `/companies/`, which is exactly why the entry route was put there
   *  (line-handoff.logic.ts HANDOFF_PATH_PREFIX). The picker mints its own links before delivery,
   *  so the seam must walk straight past them: re-wrapping would burn a second token and point it
   *  at a path no mint would accept. */
  it('leaves an already-minted /l/<token> URL untouched in text and in flex', async () => {
    const { service, calls } = makeService();
    const link = `${WEB}/l/already-minted-token`;
    const [message] = await service.wrapOutgoingLineContent(CTX, [text(`เปิดเว็บที่ ${link}`)]);
    assert.equal((message as { text: string }).text, `เปิดเว็บที่ ${link}`);

    const picker: LineReplyMessage = {
      type: 'flex',
      altText: 'เลือกบริษัทที่ต้องการใช้งาน',
      contents: {
        type: 'carousel',
        contents: [{
          type: 'bubble',
          footer: { type: 'box', layout: 'vertical', contents: [
            { type: 'button', action: { type: 'message', label: 'เลือกบริษัทนี้', text: '/company co-2' } },
            { type: 'button', action: { type: 'uri', label: 'เปิดเว็บบริษัทนี้', uri: link } },
          ] },
        }],
      },
    };
    const [wrapped] = await service.wrapOutgoingLineContent(CTX, [picker]);
    assert.equal(wrapped, picker, 'nothing to rewrite means the same message object');
    assert.equal(calls.length, 0, 'not one extra token for a message that already carries its own');
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

describe('LineHandoffLinkService in the web demo chat', () => {
  it('keeps the plain tenant link, because the demo visitor is already signed in', async () => {
    const { service, calls } = makeService();
    const url = `${WEB}/companies/${COMPANY}/expenses/exp-1`;
    const [message] = await service.wrapOutgoingLineContent({ ...CTX, lineUserId: `Vdemo${COMPANY}` }, [text(`ดูรายการที่ ${url}`)]);
    assert.equal((message as any).text, `ดูรายการที่ ${url}`);
    assert.equal(calls.length, 0);
    assert.equal(await service.linkFor({ ...CTX, lineUserId: `Vdemo${COMPANY}` }, `/companies/${COMPANY}/dashboard`), `${WEB}/companies/${COMPANY}/dashboard`);
    assert.equal(calls.length, 0);
  });
});
