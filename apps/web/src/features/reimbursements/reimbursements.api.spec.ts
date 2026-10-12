import { REIMBURSEMENT_CERTIFICATE_CANCELLATION_WORDS } from '@watchdog-bms/contracts';
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  attachReimbursementPaymentSlip,
  cancelReimbursementDraftAction,
  cancelReimbursement,
  confirmReimbursementDraftAction,
  getReimbursementDraftAction,
  getReimbursementFinanceStep,
  loadHubPage,
  requestReimbursementPayoutCorrection,
  submitReimbursement,
  submitReimbursementPayoutCorrection,
  uploadReceiptFile,
  uploadSignedClaimFormCopy,
} from './reimbursements.api';
import { errorText, hubList, hubNextPage, NO_HUB_LIST, withHubFailure, withHubPage, withHubRetry, type HubFilter, type HubList } from './reimbursements.logic';
import { subscribeToastBus, type ToastEvent } from '@/common/feedback/toast-bus';

const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else delete (globalThis as Record<string, unknown>)['window'];
});

describe('reimbursement submit error notifications', () => {
  const cases = [
    [422, 'missing_receipt', 'ยังส่งไม่ได้ตามนโยบายใบเสร็จของบริษัท กรุณาเปิดรายละเอียดเพื่อแนบใบเสร็จหรือแก้ไขคำขอ'],
    [400, 'missing_receipt_reason_required', 'มีรายการที่ยังไม่แนบหลักฐาน กรุณาระบุเหตุผลที่ไม่มีใบเสร็จก่อนส่งใบเบิก'],
    [400, 'line_incurred_date_in_future:2', 'รายการที่ 2: วันที่รายการเบิกต้องไม่เกินวันนี้ (เวลาไทย) กรุณาแก้ไขวันที่ก่อนส่งอนุมัติ'],
    [422, 'line_incurred_date_in_future:2', 'รายการที่ 2: วันที่รายการเบิกต้องไม่เกินวันนี้ (เวลาไทย) กรุณาแก้ไขวันที่ก่อนส่งอนุมัติ'],
    [422, 'line_incurred_date_invalid:1', 'รายการที่ 1: กรุณาระบุวันที่รายการเบิกให้ถูกต้อง'],
    [400, 'unreviewed_internal_rule', 'ทำรายการต่อไม่ได้ กรุณาตรวจข้อมูลที่กรอกและเงื่อนไขของรายการ แล้วลองอีกครั้ง'],
    [422, 'unreviewed_internal_rule', 'ทำรายการต่อไม่ได้ กรุณาตรวจข้อมูลที่กรอกและเงื่อนไขของรายการ แล้วลองอีกครั้ง'],
  ] as const;

  for (const [status, code, expected] of cases) {
    for (const shape of ['message', 'code'] as const) {
      it(`shows consistent safe guidance for HTTP ${status} ${code} in ${shape}`, async () => {
        const events: ToastEvent[] = [];
        const unsubscribe = subscribeToastBus((event) => events.push(event));
        const body = { statusCode: status, [shape]: code };
        let requests = 0;
        (globalThis as Record<string, unknown>)['window'] = {};
        globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
          requests++;
          assert.equal(String(input), '/api/v1/companies/co-1/reimbursements/rb-1/submit');
          assert.equal(init?.method, 'POST');
          return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
        }) as typeof fetch;
        try {
          await assert.rejects(() => submitReimbursement('co-1', 'rb-1'), (error: Error & {
            status?: number; code?: string; details?: unknown;
          }) => {
            assert.equal(error.status, status);
            assert.equal(error.message, shape === 'message' ? code : `API error ${status}`);
            assert.equal(error.code, shape === 'code' ? code : undefined);
            assert.deepEqual(error.details, body);
            assert.equal(errorText(error), expected);
            assert.deepEqual(events, [{ tone: 'error', message: expected }]);
            if (code === 'missing_receipt') {
              assert.doesNotMatch(expected, /โหลดหน้าใหม่|ข้อมูลจากหน้าจอ|ระบุเหตุผล/);
            }
            return true;
          });
          assert.equal(requests, 1, 'a policy rejection must not retry the submit');
        } finally {
          unsubscribe();
        }
      });
    }
  }
});

// The hub names its third tab by the company's finance step. A session that may not read the policy (an accountant)
// is told that one fact by the claims list answer.
describe('the finance step for a session that may not read the policy', () => {
  const answering = (body: unknown, status = 200) => {
    const asked: string[] = [];
    (globalThis as Record<string, unknown>)['window'] = {};
    globalThis.fetch = (async (input: string | URL | Request) => {
      asked.push(String(input));
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    return asked;
  };
  const listAnswer = { items: [], total: 0, page: 1, pageSize: 1, hub: { counts: { all: 0 } } };

  it('asks the claims list for one row in the session\'s own scope, and reads the one fact off the answer', async () => {
    let asked = answering({ ...listAnswer, financeReviewRequired: false });
    assert.deepEqual(await getReimbursementFinanceStep('co-1'), { financeReviewRequired: false });
    assert.deepEqual(asked, ['/api/v1/companies/co-1/reimbursements?pageSize=1']);
    asked = answering({ ...listAnswer, financeReviewRequired: true, approvalRequiredFromAmount: '5000.00' });
    // Only the fact is handed on, whatever else an answer carries.
    assert.deepEqual(await getReimbursementFinanceStep('co-1', 'own'), { financeReviewRequired: true });
    assert.deepEqual(asked, ['/api/v1/companies/co-1/reimbursements?scope=own&pageSize=1']);
  });

  it('refuses an answer without the fact rather than reading it as no finance step, and raises no toast for a refusal', async () => {
    const events: ToastEvent[] = [];
    const unsubscribe = subscribeToastBus((event) => events.push(event));
    try {
      // An API from before the fact was added: the hub then keeps the wording of the right the session holds.
      answering(listAnswer);
      await assert.rejects(() => getReimbursementFinanceStep('co-1'));
      // A session that holds the finance-review right and no right to list claims.
      answering({ statusCode: 403, message: 'Missing permission to read reimbursements' }, 403);
      await assert.rejects(() => getReimbursementFinanceStep('co-1'), (error: Error & { status?: number }) => error.status === 403);
      assert.deepEqual(events, []);
    } finally { unsubscribe(); }
  });
});

describe('reimbursement receipt upload', () => {
  it('normalizes image/jpg metadata to a server-valid JPEG before creating the intent', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith('/attachments/upload-intent')) {
        return new Response(JSON.stringify({
          attachmentId: 'att-1',
          uploadUrl: 'https://storage.example.test/receipt',
          uploadMethod: 'PUT',
          uploadHeaders: { 'If-None-Match': '*' },
        }), { headers: { 'content-type': 'application/json' } });
      }
      if (url === 'https://storage.example.test/receipt') return new Response(null, { status: 200 });
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    const source = new File([Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])], 'dime-slip.jpg', { type: 'image/jpg' });

    const attachmentId = await uploadReceiptFile('co-1', source, 'source-branch');

    assert.equal(attachmentId, 'att-1');
    assert.equal(requests.length, 3);
    assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
      originalFileName: 'dime-slip.jpg',
      mimeType: 'image/jpeg',
      byteSize: 4,
      visibility: 'INTERNAL',
      branchId: 'source-branch',
    });
    const uploaded = requests[1]?.init?.body as File;
    assert.equal(uploaded.type, 'image/jpeg');
    assert.equal(uploaded.name, 'dime-slip.jpg');
    assert.deepEqual(JSON.parse(String(requests[2]?.init?.body)), { byteSize: 4 });
  });

  it('sends the paper-signed declaration only when the attacher confirmed the claim number (A4)', async () => {
    const links: unknown[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/attachments/upload-intent')) {
        return Response.json({ attachmentId: 'att-scan', uploadUrl: 'https://storage.example.test/scan', uploadMethod: 'PUT', uploadHeaders: {} });
      }
      if (url.endsWith('/claim-form/signed-copies')) { links.push(JSON.parse(String(init?.body))); return Response.json([]); }
      return new Response(null, { status: url.startsWith('https://') ? 200 : 204 });
    }) as typeof fetch;
    const scan = () => new File([new TextEncoder().encode('%PDF-1.7')], 'signed.pdf', { type: 'application/pdf' });

    await uploadSignedClaimFormCopy('co-1', 'rb-1', scan(), 'br-1', 'RB-202609-00001');
    await uploadSignedClaimFormCopy('co-1', 'rb-1', scan(), 'br-1');

    assert.deepEqual(links, [
      { attachmentId: 'att-scan', acknowledgedComplete: true, confirmedRequestNo: 'RB-202609-00001' },
      { attachmentId: 'att-scan' },
    ]);
  });

  it('does not upload receipt bytes without the saved claim branch', async () => {
    let requests = 0;
    globalThis.fetch = (async () => { requests++; return new Response(null); }) as typeof fetch;
    const file = new File(['receipt'], 'receipt.png', { type: 'image/png' });
    for (const branchId of [null, undefined, '', '  ']) {
      await assert.rejects(() => uploadReceiptFile('co-1', file, branchId), /สาขา/);
    }
    assert.equal(requests, 0);
  });
});

// The hub's list is asked for a page at a time. What the hub holds is `HubList` (reimbursements.logic.ts); this is the
// part that talks to the API, and the part that drops an answer nobody is waiting for any more.
describe('loadHubPage and the hub list it fills', () => {
  const hub = (all: number) => ({ counts: { all, draft: 0, review: 0, payment: all, duplicate_blocked: 0, paid: 0, closed: 0 }, totalAmount: '0.0000', blockedDraftCount: 0 });
  /** A list endpoint over `rows`, answering `pageSize` rows a page whatever was asked; `failing` pages answer 500. */
  function server(rows: Array<{ id: string }>, pageSize = 100, failing: number[] = []) {
    const urls: string[] = [];
    (globalThis as Record<string, unknown>)['window'] = {};
    globalThis.fetch = (async (input: string | URL | Request) => {
      urls.push(String(input));
      const page = Number(new URL(String(input), 'http://web.test').searchParams.get('page'));
      if (failing.includes(page)) return Response.json({ statusCode: 500, message: 'Internal server error' }, { status: 500 });
      return Response.json({ items: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize, hub: hub(rows.length) });
    }) as typeof fetch;
    return { urls, failing };
  }
  const claims = (count: number, from = 0) => Array.from({ length: count }, (_, index) => ({ id: `rb-${from + index}` }));
  const page = (number: number, scope?: string, filter: HubFilter = 'all', search?: string) => new Promise<any>((resolve, reject) => {
    loadHubPage('co-1', { scope, filter, search, page: number }, { onPage: resolve, onError: reject });
  });
  /** The hub's own loop, as its effect runs it: ask for the page the list needs, add it, until nothing is needed. */
  async function fill(held: HubList, key: string, need = Infinity, scope?: string, filter: HubFilter = 'all', search?: string): Promise<HubList> {
    for (;;) {
      const next = hubNextPage(hubList(held, key), need);
      if (next === null) return hubList(held, key);
      try { held = withHubPage(held, key, await page(next, scope, filter, search)); }
      catch (error) { held = withHubFailure(held, key, errorText(error)); }
    }
  }

  it('opens with one call, and takes more only as the table page shown needs them', async () => {
    // Before: the hub walked the whole list on every open, 20 calls for 2,000 claims.
    const { urls } = server(claims(230));
    const opened = await fill(NO_HUB_LIST, 'list', 10, 'related');
    assert.deepEqual([opened.rows.length, opened.total, opened.nextPage, opened.failed], [100, 230, 2, undefined]);
    assert.deepEqual(urls, ['/api/v1/companies/co-1/reimbursements?scope=related&page=1&pageSize=100']);
    // The cards print the server's counts of the whole scope from that first answer.
    assert.equal(opened.summary?.counts.all, 230);
    // Table page 10 still fits in what is held; table page 11 asks for exactly one more page.
    assert.equal((await fill(opened, 'list', 100, 'related')).rows.length, 100);
    assert.equal(urls.length, 1);
    const further = await fill(opened, 'list', 110, 'related');
    assert.deepEqual([further.rows.length, further.nextPage], [200, 3]);
    assert.deepEqual(urls.slice(1), ['/api/v1/companies/co-1/reimbursements?scope=related&page=2&pageSize=100']);
    // The last table page takes the last page of the list.
    const all = await fill(further, 'list', 230, 'related');
    assert.deepEqual([all.rows.length, all.total, all.nextPage], [230, 230, null]);
    assert.deepEqual(urls.slice(2), ['/api/v1/companies/co-1/reimbursements?scope=related&page=3&pageSize=100']);
  });

  // Review 2026-10-01: a search was run in the browser, over every page of its filter loaded first.
  it('sends the search to the API and opens it with one call, however many claims the filter holds', async () => {
    // Before: 30 calls for a shop of 3,000 claims, each of them counting the scope again.
    const { urls } = server(claims(3000));
    const searched = await fill(NO_HUB_LIST, 'searched', 10, 'related', 'payment', 'สมศรี 1,500');
    assert.deepEqual(urls, [`/api/v1/companies/co-1/reimbursements?scope=related&bucket=payment&search=${encodeURIComponent('สมศรี 1,500').replace(/%20/g, '+')}&page=1&pageSize=100`]);
    assert.equal(new URL(urls[0]!, 'http://web.test').searchParams.get('search'), 'สมศรี 1,500');
    assert.deepEqual([searched.rows.length, searched.nextPage], [100, 2]);
    // No search typed, or a blank one: no search parameter at all.
    urls.length = 0;
    await fill(NO_HUB_LIST, 'plain', 10, undefined, 'all', '');
    await fill(NO_HUB_LIST, 'plain-too', 10, undefined, 'all', undefined);
    assert.deepEqual(urls, ['/api/v1/companies/co-1/reimbursements?page=1&pageSize=100', '/api/v1/companies/co-1/reimbursements?page=1&pageSize=100']);
  });

  it('asks the API for the bucket of the card or chip that is open, and for no bucket under ทั้งหมด', async () => {
    const { urls } = server(claims(3));
    await fill(NO_HUB_LIST, 'payment-list', 10, undefined, 'payment');
    await fill(NO_HUB_LIST, 'all-list', 10, undefined, 'all');
    await fill(NO_HUB_LIST, 'closed-list', 10, 'own', 'closed');
    assert.deepEqual(urls, [
      '/api/v1/companies/co-1/reimbursements?bucket=payment&page=1&pageSize=100',
      '/api/v1/companies/co-1/reimbursements?page=1&pageSize=100',
      '/api/v1/companies/co-1/reimbursements?scope=own&bucket=closed&page=1&pageSize=100',
    ]);
  });

  it('treats an answer without the server\'s counts as a page that did not arrive, never as a scope of zero claims', async () => {
    (globalThis as Record<string, unknown>)['window'] = {};
    globalThis.fetch = (async () => Response.json({ items: claims(2), total: 2, page: 1, pageSize: 100 })) as typeof fetch;
    const list = await fill(NO_HUB_LIST, 'list', 10);
    assert.deepEqual([list.rows.length, list.summary, list.failed], [0, null, 'ข้อมูลที่ได้รับไม่ครบ']);
  });

  it('ends on the server\'s total and the server\'s page size, never on the 100 it asked for', async () => {
    // Before: `page * 100 >= total` stopped after page 2 of a server that answers 50 a page, and 20 claims were never seen.
    const capped = server(claims(120), 50);
    assert.equal((await fill(NO_HUB_LIST, 'list')).rows.length, 120);
    assert.equal(capped.urls.length, 3);
    // A full last page ends on the total: no extra call to find an empty page.
    const exact = server(claims(200));
    assert.equal((await fill(NO_HUB_LIST, 'list')).rows.length, 200);
    assert.equal(exact.urls.length, 2);
    // One call for a short list, and for an empty one.
    const short = server(claims(3));
    assert.deepEqual((await fill(NO_HUB_LIST, 'list')).rows, claims(3));
    assert.equal(short.urls.length, 1);
    const none = server([]);
    assert.deepEqual([(await fill(NO_HUB_LIST, 'list')).rows.length, none.urls.length], [0, 1]);
  });

  it('ends on a short or empty page even when the total says more, and never repeats a claim that shifted between two calls', async () => {
    (globalThis as Record<string, unknown>)['window'] = {};
    const answer = (pages: Record<number, Array<{ id: string }>>, total: number) => {
      const urls: string[] = [];
      globalThis.fetch = (async (input: string | URL | Request) => {
        urls.push(String(input));
        const number = Number(new URL(String(input), 'http://web.test').searchParams.get('page'));
        return Response.json({ items: pages[number] ?? [], total, page: number, pageSize: 100, hub: hub(total) });
      }) as typeof fetch;
      return urls;
    };
    // A claim filed between the calls pushes rb-99 onto page 2 as well.
    answer({ 1: claims(100), 2: claims(2, 99) }, 101);
    assert.equal((await fill(NO_HUB_LIST, 'list')).rows.length, 101);
    // An empty page ends the list even when the total says more.
    const empty = answer({ 1: claims(100) }, 500);
    assert.equal((await fill(NO_HUB_LIST, 'list')).rows.length, 100);
    assert.equal(empty.length, 2);
    // So does a short one.
    const shortPage = answer({ 1: claims(100), 2: claims(40, 100) }, 500);
    assert.equal((await fill(NO_HUB_LIST, 'list')).rows.length, 140);
    assert.equal(shortPage.length, 2);
  });

  // Review 2026-10-01: a claim that left the list between two page loads moved the rest up one place, and the claim
  // that slid onto the page already read was never loaded.
  it('reads the list again from its first page when its total changed between two pages, so no waiting claim is skipped', async () => {
    (globalThis as Record<string, unknown>)['window'] = {};
    /** A list endpoint over rows that `change` after the first call: what a claim approved or filed in between does. */
    const changing = (before: Array<{ id: string }>, after: Array<{ id: string }>) => {
      const pages: string[] = [];
      globalThis.fetch = (async (input: string | URL | Request) => {
        const number = Number(new URL(String(input), 'http://web.test').searchParams.get('page'));
        const rows = pages.length === 0 ? before : after;
        pages.push(String(number));
        return Response.json({ items: rows.slice((number - 1) * 100, number * 100), total: rows.length, page: number, pageSize: 100, hub: hub(rows.length) });
      }) as typeof fetch;
      return pages;
    };
    // 101 claims wait; after page 1 is read, rb-5 is approved and leaves the filter. rb-100 moves from page 2 onto page 1.
    const left = changing(claims(101), claims(101).filter((claim) => claim.id !== 'rb-5'));
    const afterRemoval = await fill(NO_HUB_LIST, 'list');
    // Before: page 2 came back empty, and the hub held rb-5 (gone) and never showed rb-100 (still waiting).
    assert.deepEqual(afterRemoval.rows.map((row) => row.id), claims(101).map((claim) => claim.id).filter((id) => id !== 'rb-5'));
    assert.deepEqual([afterRemoval.total, afterRemoval.nextPage, afterRemoval.summary?.counts.all], [100, null, 100]);
    assert.deepEqual(left, ['1', '2', '1'], 'page 2 showed the change, and the list was read again from page 1');

    // A claim filed in between is taken the same way: every claim once, the new one included.
    const joined = changing(claims(150), [{ id: 'rb-new' }, ...claims(150)]);
    const afterAddition = await fill(NO_HUB_LIST, 'list');
    assert.deepEqual(afterAddition.rows.map((row) => row.id), ['rb-new', ...claims(150).map((claim) => claim.id)]);
    assert.deepEqual(joined, ['1', '2', '1', '2']);

    // The same total on every page is no change: nothing is read twice.
    const steady = server(claims(230));
    assert.equal((await fill(NO_HUB_LIST, 'list')).rows.length, 230);
    assert.equal(steady.urls.length, 3);

    // A list that changes on every single call is read again three times, then taken as it comes: no endless loop.
    let calls = 0;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const number = Number(new URL(String(input), 'http://web.test').searchParams.get('page'));
      calls += 1;
      const rows = claims(150 + calls);
      return Response.json({ items: rows.slice((number - 1) * 100, number * 100), total: rows.length, page: number, pageSize: 100, hub: hub(rows.length) });
    }) as typeof fetch;
    const restless = await fill(NO_HUB_LIST, 'list');
    assert.deepEqual([calls, restless.nextPage, restless.failed], [8, null, undefined]);
    assert.ok(restless.rows.length >= 150);
  });

  it('keeps what was loaded when a later page fails, and a retry asks for that page again', async () => {
    const down = server(claims(230), 100, [2]);
    const failed = await fill(NO_HUB_LIST, 'list');
    // Before: the whole load was thrown away and the hub said "ยังไม่มีคำขอเบิก".
    assert.deepEqual([failed.rows.length, failed.total, failed.nextPage], [100, 230, 2]);
    assert.equal(typeof failed.failed, 'string');
    assert.doesNotMatch(failed.failed!, /500|Internal|error/i, 'the reason is said in Thai, never as a status code');
    assert.equal(hubNextPage(failed, Infinity), null, 'nothing more is asked until someone retries');
    assert.equal(down.urls.length, 2);
    // Retry: the same page, not the list from the start.
    down.failing.length = 0;
    const whole = await fill(withHubRetry(failed), 'list');
    assert.deepEqual([whole.rows.length, whole.nextPage, whole.failed], [230, null, undefined]);
    assert.deepEqual(down.urls.slice(2).map((url) => new URL(url, 'http://web.test').searchParams.get('page')), ['2', '3']);
    // The first page failing leaves an empty list that is failed, which is not the same as an empty list.
    server(claims(5), 100, [1]);
    const nothing = await fill(NO_HUB_LIST, 'list');
    assert.deepEqual([nothing.rows.length, nothing.nextPage, typeof nothing.failed], [0, 1, 'string']);
  });

  it('starts another list from its first page and shows none of the rows held for the list before it', async () => {
    server(claims(150));
    const first = await fill(NO_HUB_LIST, 'before-reload');
    assert.equal(first.rows.length, 150);
    // The counts on the cards stay while the next list arrives.
    assert.deepEqual(hubList(first, 'after-reload'), { key: 'after-reload', rows: [], total: 0, nextPage: 1, summary: hub(150) });
    const { urls } = server(claims(2, 500));
    const second = await fill(first, 'after-reload');
    assert.deepEqual(second.rows, claims(2, 500));
    assert.deepEqual(urls.map((url) => new URL(url, 'http://web.test').searchParams.get('page')), ['1']);
  });

  it('hands nothing over once the caller has let go: a late answer, or a late failure, changes nothing', async () => {
    (globalThis as Record<string, unknown>)['window'] = {};
    for (const outcome of ['answers', 'fails'] as const) {
      let settle!: () => void;
      const settled = new Promise<void>((resolve) => { settle = resolve; });
      globalThis.fetch = (async () => {
        await settled;
        return outcome === 'answers' ? Response.json({ items: claims(1), total: 1, page: 1, pageSize: 100, hub: hub(1) })
          : Response.json({ statusCode: 500, message: 'Internal server error' }, { status: 500 });
      }) as typeof fetch;
      const calls: string[] = [];
      const letGo = loadHubPage('co-1', { filter: 'all', page: 1 }, { onPage: () => calls.push('page'), onError: () => calls.push('error') });
      // The hub asked for another list, reloaded, or unmounted while the request was in flight.
      letGo();
      settle();
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.deepEqual(calls, [], outcome);
      // The same request, still wanted, is handed over.
      const kept: string[] = [];
      loadHubPage('co-1', { filter: 'all', page: 1 }, { onPage: () => kept.push('page'), onError: () => kept.push('error') });
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.deepEqual(kept, [outcome === 'answers' ? 'page' : 'error'], outcome);
    }
  });

  it('reports a page the caller cannot take the way it reports a page that did not arrive', async () => {
    server(claims(1));
    const reported = await new Promise<unknown>((resolve) => {
      loadHubPage('co-1', { filter: 'all', page: 1 }, { onPage: () => { throw new Error('unreadable page'); }, onError: resolve });
    });
    assert.match(String(reported), /unreadable page/);
  });
});

// Payout spec §14: sending a claim back for its payout account, and giving that account. Both are made from a form
// inside the claim's step card, which shows the refusal in its own banner beside what the person typed.
describe('the two calls of a payout account correction round', () => {
  const answering = (status: number, body: unknown) => {
    const requests: Array<{ url: string; method?: string; body: unknown }> = [];
    (globalThis as Record<string, unknown>)['window'] = {};
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    return requests;
  };

  it('sends the reason and note to the send-back endpoint, and the receiving choice to the account endpoint', async () => {
    const requests = answering(200, { id: 'rb-1', status: 'PENDING_APPROVAL' });
    await requestReimbursementPayoutCorrection('co-1', 'rb-1', { reasonCode: 'ACCOUNT_NUMBER_WRONG', note: 'ธนาคารแจ้งว่าไม่พบบัญชีนี้' });
    await submitReimbursementPayoutCorrection('co-1', 'rb-1', { mode: 'DEFAULT', defaultToken: 'a1b2c3' });
    await submitReimbursementPayoutCorrection('co-1', 'rb-1', { mode: 'CASH' });
    assert.deepEqual(requests, [
      { url: '/api/v1/companies/co-1/reimbursements/rb-1/payout-correction', method: 'POST', body: { reasonCode: 'ACCOUNT_NUMBER_WRONG', note: 'ธนาคารแจ้งว่าไม่พบบัญชีนี้' } },
      { url: '/api/v1/companies/co-1/reimbursements/rb-1/payout-destination', method: 'PUT', body: { mode: 'DEFAULT', defaultToken: 'a1b2c3' } },
      { url: '/api/v1/companies/co-1/reimbursements/rb-1/payout-destination', method: 'PUT', body: { mode: 'CASH' } },
    ]);
  });

  // Every refusal of the hand-off table: the form's banner reads the Thai sentence, and no second, global toast says it again.
  it('answers every refusal of a round with its Thai sentence and raises no global toast', async () => {
    const events: ToastEvent[] = [];
    const unsubscribe = subscribeToastBus((event) => events.push(event));
    try {
      for (const [status, code, sentence] of [
        [409, 'payout_correction_in_progress', 'ใบนี้ถูกส่งกลับเรื่องวิธีรับเงินคืน และยังไม่กลับมารอจ่าย จึงยังทำรายการนี้ไม่ได้ เปิดใบใหม่เพื่อดูว่าตอนนี้ใบรอใคร'],
        [409, 'payout_correction_not_allowed', 'ใบนี้ส่งกลับไม่ได้ในตอนนี้ ส่งกลับได้เฉพาะใบที่รอจ่ายและยังไม่ได้บันทึกจ่าย ถ้าบันทึกจ่ายแล้วต้องยกเลิกการจ่ายก่อน'],
        [403, 'payout_correction_denied', 'คุณไม่มีสิทธิ์ส่งกลับหรือเลือกวิธีรับเงินคืนของใบนี้'],
        [409, 'payout_correction_not_requested', 'ใบนี้ไม่ได้ถูกส่งกลับเรื่องวิธีรับเงินคืน กรุณาเปิดใบใหม่เพื่อดูสถานะล่าสุด'],
        [400, 'payout_correction_reason_required', 'กรุณาเลือกเหตุผลที่ส่งกลับ'],
        [400, 'payout_correction_note_too_long', 'หมายเหตุต้องไม่เกิน 500 ตัวอักษร'],
        [409, 'reimbursement_changed', 'คำขอถูกแก้ไขระหว่างทำรายการ กรุณาเปิดรายการใหม่แล้วลองอีกครั้ง'],
      ] as const) {
        for (const call of [
          () => requestReimbursementPayoutCorrection('co-1', 'rb-1', { reasonCode: 'OTHER' }),
          () => submitReimbursementPayoutCorrection('co-1', 'rb-1', { mode: 'CASH' }),
        ]) {
          const requests = answering(status, { statusCode: status, message: code });
          await assert.rejects(call, (error: Error & { status?: number }) => {
            assert.equal(error.status, status);
            assert.equal(errorText(error), sentence, code);
            return true;
          });
          assert.equal(requests.length, 1, `${code}: a refusal is not retried`);
        }
      }
      // The other refusals these two calls can meet read as sentences too, never as the fallback or a code.
      for (const code of ['note_contains_account_number', 'reimbursement_cancellation_pending', 'payout_method_required', 'payout_destination_changed',
        'payout_destination_invalid', 'payout_account_member_not_active', 'self_approval_denied']) {
        const sentence = errorText(Object.assign(new Error(code), { status: 409 }));
        assert.notEqual(sentence, 'ทำรายการไม่สำเร็จ กรุณาลองอีกครั้ง', code);
        assert.doesNotMatch(sentence, /[a-z]_[a-z]/, code);
      }
      assert.deepEqual(events, []);
    } finally { unsubscribe(); }
  });
});

// A file of ใบเบิกที่เซ็นแล้ว used as a slip leaves that list for good, and a declared copy loses its declaration: the
// API refuses a declared copy unless the call says the payer confirmed it.
describe('adding a slip to a recorded payment', () => {
  const answering = (status: number, body: unknown) => {
    const requests: Array<{ url: string; method?: string; body: unknown }> = [];
    (globalThis as Record<string, unknown>)['window'] = {};
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    return requests;
  };

  it('sends the payer\'s confirmation only when the caller has it, and nothing in its place', async () => {
    const requests = answering(200, { id: 'rb-1', status: 'PAID' });
    await attachReimbursementPaymentSlip('co-1', 'rb-1', 'pay-1', 'att-upload');
    await attachReimbursementPaymentSlip('co-1', 'rb-1', 'pay-1', 'att-copy', true);
    await attachReimbursementPaymentSlip('co-1', 'rb-1', 'pay-1', 'att-copy', false);
    const url = '/api/v1/companies/co-1/reimbursements/rb-1/payments/pay-1/slips';
    assert.deepEqual(requests, [
      { url, method: 'POST', body: { attachmentId: 'att-upload' } },
      { url, method: 'POST', body: { attachmentId: 'att-copy', confirmSignedCopyWithdrawal: true } },
      { url, method: 'POST', body: { attachmentId: 'att-copy' } },
    ]);
  });

  // A page loaded before the picker asked: it is told nothing was moved, why, and to reload, in a sentence and not a code.
  it('answers the refusal of an unconfirmed declared copy with its own Thai sentence', async () => {
    const requests = answering(409, { statusCode: 409, message: 'payment_slip_signed_copy_unconfirmed', error: 'Conflict' });
    await assert.rejects(() => attachReimbursementPaymentSlip('co-1', 'rb-1', 'pay-1', 'att-copy'), (error: Error & { status?: number }) => {
      assert.equal(error.status, 409);
      const sentence = errorText(error);
      for (const part of ['ไฟล์นี้ถูกยืนยันไว้ว่าเป็นใบเบิกที่ลงนามครบ', 'จึงยังไม่ได้ใช้เป็นสลิป', 'โหลดหน้านี้ใหม่', 'ย้ายกลับไม่ได้']) assert.ok(sentence.includes(part), `${part} in ${sentence}`);
      assert.doesNotMatch(sentence, /[a-z]_[a-z]|[A-Za-z]{3,}/, sentence);
      return true;
    });
    assert.equal(requests.length, 1, 'a refusal is not retried');
  });
});

describe('LINE reimbursement draft action API', () => {
  it('uses the same action URL and exact revision/digest for read, confirm and cancel', async () => {
    const requests: Array<{ url: string; method: string; body?: unknown }> = [];
    (globalThis as Record<string, unknown>)['window'] = {};
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), method: init?.method ?? 'GET', ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
      return Response.json({ status: 'cancelled', actionId: 'action-1' });
    }) as typeof fetch;
    const exact = { previewRevision: 3, confirmationDigest: 'a'.repeat(64) };
    await getReimbursementDraftAction('co-1', 'action-1');
    await confirmReimbursementDraftAction('co-1', 'action-1', exact);
    await cancelReimbursementDraftAction('co-1', 'action-1', exact);
    assert.deepEqual(requests, [
      { url: '/api/v1/companies/co-1/reimbursements/draft-actions/action-1', method: 'GET' },
      { url: '/api/v1/companies/co-1/reimbursements/draft-actions/action-1/confirm', method: 'POST', body: exact },
      { url: '/api/v1/companies/co-1/reimbursements/draft-actions/action-1/cancel', method: 'POST', body: exact },
    ]);
  });
});

describe('certificate claim cancellation', () => {
  it('sends attestation only when given, and suppresses automatic error toasts for dialog refusals', async () => {
    const bodies: unknown[] = [];
    const events: ToastEvent[] = [];
    const unsubscribe = subscribeToastBus(event => events.push(event));
    (globalThis as Record<string, unknown>)['window'] = {};
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ code: 'reimbursement_cancellation_certificate_attestation_required' }), { status: 422, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    try {
      await assert.rejects(() => cancelReimbursement('co', 'claim', 'แก้ข้อมูล', true));
      await assert.rejects(() => cancelReimbursement('co', 'claim', 'แก้ข้อมูล'));
      await assert.rejects(() => cancelReimbursement('co', 'claim'));
      assert.deepEqual(bodies, [{ reason: 'แก้ข้อมูล', taxFilingAttested: true }, { reason: 'แก้ข้อมูล' }, {}]);
      assert.deepEqual(events, []);
    } finally { unsubscribe(); }
  });
});

it('claim cancellation errors preserve the server kind, certificate number and month exactly', () => {
  for (const kind of ['SYSTEM', 'EXTERNAL'] as const) {
    for (const [code, message] of [
      ['reimbursement_cancellation_certificate_permission_missing', REIMBURSEMENT_CERTIFICATE_CANCELLATION_WORDS.permissionMissing({ kind, number: 'WHT-2' })],
      ['reimbursement_cancellation_tax_period_locked', REIMBURSEMENT_CERTIFICATE_CANCELLATION_WORDS.periodLocked(kind, '2026-10', 'PND53')],
      ['reimbursement_cancellation_certificate_attestation_required', REIMBURSEMENT_CERTIFICATE_CANCELLATION_WORDS.attestationRequired],
      ['reimbursement_cancellation_certificate_issued', REIMBURSEMENT_CERTIFICATE_CANCELLATION_WORDS.taxWorkspaceCertificate],
    ]) assert.equal(errorText({ code, details: { code, message, requestId: 'hidden' } }), message);
  }
});
