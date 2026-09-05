import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceUnavailableException, ValidationPipe } from '@nestjs/common';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../../../../common/pipes/validation-pipe.options';
import { encodeQueueCursor } from '../../application/signup-admin-queue.use-case';
import { SignupQueueQueryDto, SystemSignupRequestController } from './system-signup-request.controller';

// The Origin an admin's browser sends is client-suppliable, and approving a LINE application
// PERSISTS this base as the shop owner's way back in (review L-1).
const REQ = {
  headers: { origin: 'https://evil.example.com', 'x-forwarded-host': 'evil.example.com' },
  protocol: 'https',
  get: () => 'evil.example.com',
  context: { userId: 'admin-1', requestId: 'req-1' },
} as any;

function harness(sesWebBaseUrl: string | null = 'https://app.mangmeeplus.com') {
  const decisions: any[] = [];
  const queue = {
    decide: async (...args: any[]) => { decisions.push(args); return { requestId: 'signup-1', state: 'COMPLETED' }; },
  } as any;
  return {
    controller: new SystemSignupRequestController(queue, { sesWebBaseUrl: sesWebBaseUrl ?? undefined } as any),
    decisions,
  };
}

describe('SystemSignupRequestController — the handoff base an approval persists', () => {
  it('takes the web base from configuration, never from the caller headers', async () => {
    const h = harness();
    await h.controller.decide('signup-1', { action: 'APPROVE' } as any, REQ);

    // Scoped to the web base on purpose: `apiBaseUrl` uses `trustedPublicApiBase`, which prefers
    // PUBLIC_BASE_URL and only derives from headers when that is unset (unchanged, pre-existing).
    assert.equal(h.decisions[0][4].webBaseUrl, 'https://app.mangmeeplus.com');
    assert.equal(h.decisions[0][4].webBaseUrl.includes('evil.example.com'), false);
  });

  it('refuses rather than approving a shop whose owner link would point nowhere', async () => {
    const h = harness(null);
    // Wrapped: `decide` is not async, so the guard throws synchronously — either shape reaches
    // Nest as a 503, and the test should not care which.
    await assert.rejects(
      async () => h.controller.decide('signup-1', { action: 'APPROVE' } as any, REQ),
      ServiceUnavailableException,
    );
    assert.deepEqual(h.decisions, []);
  });

  // Review L-4: only APPROVE provisions, so only APPROVE needs a handoff base. Resolving it for
  // every decision made an unset WEB_BASE_URL break the emergency stop as well.
  it('still rejects and suspends when no web origin is configured', async () => {
    for (const action of ['REJECT', 'SUSPEND'] as const) {
      const h = harness(null);
      const result = await h.controller.decide('signup-1', { action } as any, REQ);
      assert.equal(result.requestId, 'signup-1');
      assert.equal(h.decisions[0][4], undefined, 'no handoff base is needed or resolved');
    }
  });
});

// F10 follow-up. The cursor stopped being a cuid and became base64url of `createdAt|id`, which is
// 67 characters — three past the bound the DTO still carried. Every "โหลดเพิ่ม" was a 400 before
// the query reached the use case, and nothing pinned the bound, so widening it silently was
// possible. This validates through the REAL global pipe, which is what rejected it.
describe('SignupQueueQueryDto — the cursor the queue actually mints', () => {
  const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);
  const metadata = { type: 'query' as const, metatype: SignupQueueQueryDto };

  it('accepts a real cursor for a real row', async () => {
    const cursor = encodeQueueCursor(new Date('2026-09-05T17:31:07.412Z'), 'cmtgzg42a000x4k5xje8ot9mg');
    assert.ok(cursor.length > 64, `a cursor is ${cursor.length} chars; the old bound was 64`);

    const parsed = await pipe.transform({ tab: 'PROBLEM', cursor }, metadata) as SignupQueueQueryDto;
    assert.equal(parsed.cursor, cursor);
    assert.equal(parsed.tab, 'PROBLEM');
  });

  it('still refuses a cursor that is not one', async () => {
    // The bound is wider, not absent: this arrives on a query string from anyone with the page.
    await assert.rejects(() => pipe.transform({ cursor: 'a'.repeat(200) }, metadata));
    await assert.rejects(() => pipe.transform({ cursor: 'not a cursor' }, metadata));
    await assert.rejects(() => pipe.transform({ tab: 'EVERYTHING' }, metadata));
  });
});
