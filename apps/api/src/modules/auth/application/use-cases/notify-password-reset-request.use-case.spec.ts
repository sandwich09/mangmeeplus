import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NotifyPasswordResetRequestUseCase } from './notify-password-reset-request.use-case';

const GENERIC_MESSAGE = 'If the account is eligible, an administrator has been notified.';
const COMPANY_ID = 'company-1';

type MembershipRow = { userId: string; roles: string[] };

function makePrisma(options: {
  user?: Record<string, unknown> | null;
  memberships?: MembershipRow[];
  identities?: Array<{ userId: string; providerUserId: string }>;
  onUserQuery?: (args: any) => void;
}) {
  const memberships = options.memberships ?? [];
  const identities = options.identities ?? [];
  const requesterId = (options.user as { id?: string } | null | undefined)?.id;

  return {
    client: {
      user: {
        findFirst: async (args: any) => { options.onUserQuery?.(args); return options.user ?? null; },
      },
      companyMembership: {
        findFirst: async () => {
          const requester = memberships.find((m) => m.userId === requesterId);
          return requester
            ? { companyId: COMPANY_ID, roles: requester.roles.map((key) => ({ role: { key } })) }
            : null;
        },
        findMany: async ({ where }: any) => memberships
          .filter((m) => m.roles.includes(where.roles.some.role.key))
          .map((m) => ({ userId: m.userId })),
      },
      externalIdentity: {
        findMany: async ({ where }: any) => identities
          .filter((identity) => where.userId.in.includes(identity.userId))
          .map((identity) => ({ providerUserId: identity.providerUserId })),
      },
    },
  } as any;
}

/** `gate` holds every push unsettled until the test releases it. */
function captureLinePushes(gate?: Promise<void>) {
  const pushes: Array<{ to: string; text: string }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init: any) => {
    const body = JSON.parse(init.body as string);
    pushes.push({ to: body.to, text: body.messages[0].text });
    if (gate) await gate;
    return { ok: true } as Response;
  }) as typeof fetch;
  return { pushes, restore: () => { globalThis.fetch = original; } };
}

/** LINE delivery and its SUCCESS audit are detached, so they land after execute() returns. */
function flushDetached(): Promise<void> {
  return new Promise((resolve) => { setImmediate(resolve); });
}

const ACTIVE_USER = { id: 'user-1', displayName: 'สมชาย ใจดี', status: 'ACTIVE', credential: { status: 'TEMPORARY' } };
// L-06: the envelope floor is off for the behavioural tests; one dedicated test measures it.
const TOKEN_CONFIG = { lineMessagingChannelAccessToken: 'system-oa-token', passwordResetResponseMinMs: 0 } as any;

async function run(prisma: any, config: any = TOKEN_CONFIG, username = 'staff.one') {
  const audits: any[] = [];
  const audit = { log: async (entry: unknown) => { audits.push(entry); } } as any;
  const result = await new NotifyPasswordResetRequestUseCase(prisma, config, audit).execute({ username, requestId: 'req-1' });
  return { result, audits };
}

describe('NotifyPasswordResetRequestUseCase', () => {
  it('returns the generic message and pushes nothing for an unknown username', async () => {
    const line = captureLinePushes();
    try {
      const { result, audits } = await run(makePrisma({ user: null }));
      await flushDetached();
      assert.equal(result.message, GENERIC_MESSAGE);
      assert.equal(line.pushes.length, 0);
      assert.equal(audits[0].result, 'DENIED');
      assert.equal(audits[0].metadataJson.reason, 'unknown_username');
    } finally {
      line.restore();
    }
  });

  it('normalizes the username before lookup', async () => {
    const line = captureLinePushes();
    let queried: any;
    try {
      await run(makePrisma({ user: null, onUserQuery: (args) => { queried = args; } }), TOKEN_CONFIG, '  Staff.One  ');
    } finally {
      line.restore();
    }
    assert.equal(queried.where.username, 'staff.one');
  });

  it('never notifies anyone in-company when the requester is an OWNER', async () => {
    const line = captureLinePushes();
    try {
      const { result, audits } = await run(makePrisma({
        user: ACTIVE_USER,
        memberships: [{ userId: 'user-1', roles: ['OWNER'] }],
        identities: [{ userId: 'user-1', providerUserId: 'line-owner' }],
      }));
      await flushDetached();
      assert.equal(result.message, GENERIC_MESSAGE);
      assert.equal(line.pushes.length, 0);
      assert.equal(audits[0].result, 'DENIED');
      assert.equal(audits[0].metadataJson.reason, 'owner_requester');
    } finally {
      line.restore();
    }
  });

  it('pushes to every ADMIN with a linked LINE identity for an employee requester', async () => {
    const line = captureLinePushes();
    try {
      const { result, audits } = await run(makePrisma({
        user: ACTIVE_USER,
        memberships: [
          { userId: 'user-1', roles: ['STAFF'] },
          { userId: 'admin-1', roles: ['ADMIN'] },
          { userId: 'admin-2', roles: ['ADMIN'] },
          { userId: 'owner-1', roles: ['OWNER'] },
        ],
        identities: [
          { userId: 'admin-1', providerUserId: 'line-admin-1' },
          { userId: 'admin-2', providerUserId: 'line-admin-2' },
          { userId: 'owner-1', providerUserId: 'line-owner' },
        ],
      }));
      await flushDetached();

      assert.equal(result.message, GENERIC_MESSAGE);
      assert.deepEqual(line.pushes.map((p) => p.to), ['line-admin-1', 'line-admin-2']);
      assert.match(line.pushes[0]!.text, /สมชาย ใจดี \(staff\.one\) ขอรีเซ็ตรหัสผ่าน/);
      assert.equal(audits[0].result, 'SUCCESS');
      assert.deepEqual(audits[0].metadataJson, { channel: 'line', recipientCount: 2 });
    } finally {
      line.restore();
    }
  });

  it('pushes to OWNER members when the requester is an ADMIN', async () => {
    const line = captureLinePushes();
    try {
      await run(makePrisma({
        user: ACTIVE_USER,
        memberships: [
          { userId: 'user-1', roles: ['ADMIN'] },
          { userId: 'admin-2', roles: ['ADMIN'] },
          { userId: 'owner-1', roles: ['OWNER'] },
        ],
        identities: [
          { userId: 'admin-2', providerUserId: 'line-admin-2' },
          { userId: 'owner-1', providerUserId: 'line-owner' },
        ],
      }));
      await flushDetached();
      assert.deepEqual(line.pushes.map((p) => p.to), ['line-owner']);
    } finally {
      line.restore();
    }
  });

  it('falls back to OWNER members when no ADMIN is deliverable', async () => {
    const line = captureLinePushes();
    try {
      const { audits } = await run(makePrisma({
        user: ACTIVE_USER,
        memberships: [
          { userId: 'user-1', roles: ['SALES'] },
          { userId: 'admin-1', roles: ['ADMIN'] },
          { userId: 'owner-1', roles: ['OWNER'] },
        ],
        // The ADMIN never linked LINE, so only the owner can be reached.
        identities: [{ userId: 'owner-1', providerUserId: 'line-owner' }],
      }));
      await flushDetached();
      assert.deepEqual(line.pushes.map((p) => p.to), ['line-owner']);
      assert.equal(audits[0].metadataJson.recipientCount, 1);
    } finally {
      line.restore();
    }
  });

  it('skips pushes but still audits SUCCESS when no system channel token is configured', async () => {
    const line = captureLinePushes();
    try {
      const { result, audits } = await run(
        makePrisma({
          user: ACTIVE_USER,
          memberships: [
            { userId: 'user-1', roles: ['STAFF'] },
            { userId: 'admin-1', roles: ['ADMIN'] },
          ],
          identities: [{ userId: 'admin-1', providerUserId: 'line-admin-1' }],
        }),
        { lineMessagingChannelAccessToken: undefined, passwordResetResponseMinMs: 0 } as any,
      );
      await flushDetached();
      assert.equal(result.message, GENERIC_MESSAGE);
      assert.equal(line.pushes.length, 0);
      assert.equal(audits[0].result, 'SUCCESS');
      assert.equal(audits[0].metadataJson.recipientCount, 0);
    } finally {
      line.restore();
    }
  });

  // L-06: the body/status were already uniform; the remaining signal was the round-trip
  // count — one query for an unknown identifier against four to six for an eligible one.
  it('answers no sooner than the configured floor on the fast branch, and identically on every branch', async () => {
    const FLOOR_MS = 150;
    const config = { lineMessagingChannelAccessToken: 'system-oa-token', passwordResetResponseMinMs: FLOOR_MS } as any;
    const eligible = makePrisma({
      user: ACTIVE_USER,
      memberships: [{ userId: 'user-1', roles: ['STAFF'] }, { userId: 'admin-1', roles: ['ADMIN'] }],
      identities: [{ userId: 'admin-1', providerUserId: 'line-admin-1' }],
    });
    const branches: Array<[string, any]> = [
      ['unknown', makePrisma({ user: null })],
      ['ineligible', makePrisma({ user: { ...ACTIVE_USER, status: 'SUSPENDED' } })],
      ['eligible', eligible],
    ];

    const line = captureLinePushes();
    try {
      for (const [label, prisma] of branches) {
        const startedAt = Date.now();
        const { result } = await run(prisma, config);
        const elapsed = Date.now() - startedAt;
        assert.equal(result.message, GENERIC_MESSAGE, `${label} must answer identically`);
        // Timer granularity: node's setTimeout may fire a hair early on some platforms.
        assert.ok(elapsed >= FLOOR_MS - 5, `${label} answered in ${elapsed}ms, under the ${FLOOR_MS}ms floor`);
      }
      await flushDetached();
    } finally {
      line.restore();
    }
  });

  it('answers before the LINE pushes settle, then audits the real delivery count', async () => {
    let release!: () => void;
    const line = captureLinePushes(new Promise<void>((resolve) => { release = resolve; }));
    try {
      const { result, audits } = await run(makePrisma({
        user: ACTIVE_USER,
        memberships: [
          { userId: 'user-1', roles: ['STAFF'] },
          { userId: 'admin-1', roles: ['ADMIN'] },
          { userId: 'admin-2', roles: ['ADMIN'] },
        ],
        identities: [
          { userId: 'admin-1', providerUserId: 'line-admin-1' },
          { userId: 'admin-2', providerUserId: 'line-admin-2' },
        ],
      }));

      // Response time must not depend on LINE: both pushes are still in flight here.
      assert.equal(result.message, GENERIC_MESSAGE);
      assert.equal(line.pushes.length, 2);
      assert.equal(audits.length, 0, 'execute() must not wait for LINE delivery');

      release();
      await flushDetached();

      assert.equal(audits.length, 1);
      assert.equal(audits[0].result, 'SUCCESS');
      assert.equal(audits[0].metadataJson.recipientCount, 2);
    } finally {
      line.restore();
    }
  });
});
