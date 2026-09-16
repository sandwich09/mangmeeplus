import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { SignupAdminQueueUseCase, encodeQueueCursor } from './signup-admin-queue.use-case';
import { STALE_PROVISIONING_MS } from '../domain/company-signup.logic';

const NOW = new Date('2026-09-01T00:00:00.000Z');

const REQUEST = {
  id: 'signup-1',
  version: 1,
  state: 'PENDING_REVIEW',
  companyName: 'ร้านมั่งมี',
  ownerDisplayName: 'สมชาย ใจดี',
  contactEmail: 'somchai@example.com',
  phoneNumber: '0982565628',
  businessType: 'ร้านค้าปลีก',
  vatRegistered: false,
  taxId: '0105555000012',
  requestedOfferKey: 'FREE_TRIAL',
  mxValid: true,
  createdAt: new Date('2026-08-25T00:00:00.000Z'),
  approvedAt: null as Date | null,
  claimEmailLastSentAt: null as Date | null,
  pendingPasswordHash: 'scrypt$salt$hash',
  source: 'official-site',
  companyId: null,
  resolvedExistingCompanyId: null,
  provisioningAttemptId: null,
  reviewResolution: null,
  resolutionNote: null,
  repeatTrialGrantedAt: null,
  sharedContactReviewedAt: null,
};

function harness(options: {
  request?: any;
  requests?: any[];
  users?: any[];
  emailReviewEvidence?: Array<{ targetId: string }>;
  companies?: any[];
  companiesByPhone?: Array<{ phone: string; name: string }>;
  membershipsByPhone?: Array<{ user: { phoneNumber: string | null }; company: { name: string } }>;
  /** Rows in the unique LINE slot, in ANY status — that is what the repeat-trial hint reads. */
  identities?: Array<{ providerUserId: string; providerChannelId: string; userId: string }>;
  /**
   * What those accounts already belong to, oldest first. `owner: false` is an employee membership —
   * their EMPLOYER's shop, which must never be named as a trial this applicant already had.
   */
  /** R13: `groupBy(['state','source'])` rows behind the tab counts. */
  stateCounts?: Array<{ state: string; source: string; _count: { _all: number } }>;
  /** R13: abandoned PROVISIONING runs, which no state count can see (the clock decides). */
  staleProvisioningCount?: number;
  priorMemberships?: Array<{
    userId: string;
    owner: boolean;
    /** Defaults to ACTIVE. `DRAFT` is an employee draft nobody finished — never a shop. */
    status?: string;
    company: { name: string; status: string; planTerm: { termDisabledAt: Date | null } | null };
  }>;
  priorOwnedCompany?: boolean;
  existingMembership?: boolean;
  contactEmailConflict?: boolean;
  liveSupport?: { id: string; assignedToUserId: string | null } | null;
} = {}) {
  const audits: any[] = [];
  const updates: any[] = [];
  const advances: any[] = [];
  const enqueued: any[] = [];
  const revoked: string[] = [];
  const userQueries: any[] = [];
  const provisioned: any[] = [];
  const requestQueries: any[] = [];
  const supportCreates: any[] = [];
  const supportUpdates: any[] = [];
  const lineNotifications: any[] = [];
  const contextUpserts: any[] = [];
  let currentRequest = options.request === undefined ? { ...REQUEST } : options.request ? { ...options.request } : null;
  let liveSupport = options.liveSupport ?? null;

  const prisma = {
    client: {
      companySignupRequest: {
        findUnique: async () => currentRequest,
        findMany: async (args: any) => { requestQueries.push(args); return options.requests ?? []; },
        update: async (args: any) => {
          updates.push(args);
          const data = args.data;
          currentRequest = {
            ...currentRequest,
            ...data,
            version: data.version?.increment ? currentRequest.version + data.version.increment : currentRequest.version,
          };
          return currentRequest;
        },
        // R13: the tab counts are read from the whole table, never from the page just fetched.
        groupBy: async () => options.stateCounts ?? [],
        count: async () => options.staleProvisioningCount ?? 0,
      },
      user: { findMany: async (args: any) => { userQueries.push(args); return options.users ?? []; } },
      company: {
        findMany: async (args: any) => (args?.where?.phone
          ? options.companiesByPhone ?? []
          : options.companies ?? []),
      },
      // Review A-01: the second phone rail — a member of an existing shop carries the number.
      // Owner 2026-09-05 added a second reader keyed by user id: the repeat-trial hint.
      companyMembership: {
        findMany: async (args: any) => {
          if (!args?.where?.userId) return options.membershipsByPhone ?? [];
          // Both filters are HONOURED: dropping the OWNER role makes the employee case red, and
          // dropping the DRAFT exclusion makes the abandoned-draft case red.
          return (options.priorMemberships ?? []).filter((m) => {
            if (args?.where?.roles?.some?.role?.key === 'OWNER' && !m.owner) return false;
            if (args?.where?.status?.not && (m.status ?? 'ACTIVE') === args.where.status.not) return false;
            return true;
          });
        },
        count: async () => options.priorOwnedCompany ? 1 : 0,
        findFirst: async () => options.existingMembership ? { id: 'membership-1' } : null,
      },
      externalIdentity: {
        findMany: async () => options.identities ?? [],
        findFirst: async () => currentRequest?.lineProviderUserId
          ? { userId: currentRequest.attachUserId ?? 'line-user-1', status: 'ACTIVE', user: { status: 'ACTIVE' } }
          : null,
      },
      lineSupportRequest: {
        findFirst: async () => liveSupport,
        create: async (args: any) => {
          supportCreates.push(args);
          liveSupport = { id: 'support-1', assignedToUserId: args.data.assignedToUserId ?? null };
          return { id: liveSupport.id };
        },
        update: async (args: any) => {
          supportUpdates.push(args);
          liveSupport = {
            id: liveSupport?.id ?? args.where.id,
            assignedToUserId: args.data.assignedToUserId ?? liveSupport?.assignedToUserId ?? null,
          };
          return { id: liveSupport.id };
        },
      },
      lineCompanyContext: {
        upsert: async (args: any) => { contextUpserts.push(args); return {}; },
      },
      auditLog: {
        create: async (args: any) => { audits.push(args); return {}; },
        findMany: async (args: any) => {
          if (args.where.action === 'signup.line.reapplication_review') return [];
          assert.equal(args.where.action, 'signup.line.submitted');
          assert.deepEqual(args.where.metadataJson, { path: ['emailPreviouslyUsed'], equals: true });
          return (options.emailReviewEvidence ?? []).filter((row) => args.where.targetId.in.includes(row.targetId));
        },
      },
      $executeRaw: async () => 0,
      $queryRaw: async () => options.contactEmailConflict ? [{ id: 'conflict-1' }] : [],
      $transaction: async (fn: any) => fn(prisma.client),
    },
  } as any;

  const core = {
    // R08: `extras` is how a transition carries the facts that make it true — the approval stamp
    // and the claim email now ride the same transaction, so the stub has to honour both.
    advance: async (
      id: string, state: string, _corr: string, failureCode?: string, _expect?: unknown,
      extras?: { data?: Record<string, unknown>; alsoInTransaction?: (tx: unknown) => Promise<void> },
    ) => {
      advances.push({
        id, state,
        ...(failureCode ? { failureCode } : {}),
        ...(extras?.data ? { data: extras.data } : {}),
      });
      // F8: the audit and the letter both write through the transaction client, so the stub hands
      // over the same store — an `{}` here would hide a missing audit as a TypeError.
      await extras?.alsoInTransaction?.(prisma.client);
      currentRequest = { ...currentRequest, state, version: currentRequest.version + 1, ...(extras?.data ?? {}) };
      return { request: currentRequest, replayed: false };
    },
  } as any;
  const tokens = { revokeAll: async (id: string) => { revoked.push(id); return 2; } } as any;
  const claimEmail = {
    enqueue: async (id: string, reason: string) => { enqueued.push({ id, reason }); },
    enqueueRejectionNotice: async (id: string, rejectionReason?: string) => {
      enqueued.push({ id, reason: 'rejection-notice', rejectionReason });
    },
  } as any;

  const provision = {
    execute: async (cmd: any) => {
      provisioned.push(cmd);
      currentRequest = { ...currentRequest, state: 'COMPLETED', companyId: currentRequest.companyId ?? 'co-1' };
      return {};
    },
  } as any;

  // P10-L: a LINE rejection rides the push rail, not the mailer — recorded in the same list so the
  // "one notice, on the right rail" assertions stay in one place.
  const lineNotify = {
    enqueue: async (id: string, kind: string, now?: Date, options?: unknown) => {
      enqueued.push({ id, reason: `line-push:${kind}` });
      lineNotifications.push({ id, kind, now, options });
    },
  } as any;

  return {
    useCase: new SignupAdminQueueUseCase(prisma, core, tokens, claimEmail, provision, lineNotify),
    audits, updates, advances, enqueued, revoked, userQueries, provisioned, requestQueries,
    current: () => currentRequest, supportCreates, supportUpdates, lineNotifications, contextUpserts,
  };
}

describe('SignupAdminQueueUseCase.list', () => {
  it('shows the durable email-review reason independently of account attachment or a current email match', async () => {
    const h = harness({
      requests: [{ ...REQUEST, id: 'duplicate-line', source: 'line-oa' }, { ...REQUEST, id: 'fresh-line', source: 'line-oa' }],
      emailReviewEvidence: [{ targetId: 'duplicate-line' }, { targetId: 'outside-this-page' }],
    });
    const { items } = await h.useCase.list(NOW);
    assert.equal(items[0]!.emailPreviouslyUsed, true);
    assert.equal(items[0]!.emailMatchesExistingUser, false);
    assert.equal(items[0]!.attachesToExistingAccount, undefined);
    assert.equal(items[1]!.emailPreviouslyUsed, undefined);
    assert.deepEqual(h.provisioned, []);
  });

  it('surfaces dedupe hints without deciding anything', async () => {
    const h = harness({
      requests: [{ ...REQUEST, approvedAt: new Date('2026-08-20T00:00:00.000Z'), state: 'EMAIL_PENDING' }],
      users: [{ email: 'somchai@example.com' }],
      companies: [{ taxId: '0105555000012', name: 'ร้านเดิม' }],
    });
    const { items } = await h.useCase.list(NOW);

    assert.equal(items.length, 1);
    assert.equal(items[0]!.emailMatchesExistingUser, true);
    assert.equal(items[0]!.taxIdMatchesCompanyName, 'ร้านเดิม');
    assert.equal(items[0]!.daysSinceApproval, 12);
    assert.equal(items[0]!.emailDeliveryFailed, false);
    assert.equal(items[0]!.mxValid, true);
  });

  it('flags a bounced email and omits hints that do not apply', async () => {
    const h = harness({ requests: [{ ...REQUEST, state: 'EMAIL_FAILED', taxId: null }] });
    const { items } = await h.useCase.list(NOW);

    assert.equal(items[0]!.emailDeliveryFailed, true);
    assert.equal(items[0]!.emailMatchesExistingUser, false);
    assert.equal(items[0]!.taxIdMatchesCompanyName, undefined);
    assert.equal(items[0]!.daysSinceApproval, undefined);
  });

  // Review A-01. The commonest duplicate is a customer an admin set up by hand who then applies
  // from LINE as if they were new; approving that opens a SECOND shop for one person.
  it('warns when the phone on the form already reaches a shop of ours', async () => {
    const h = harness({
      requests: [{ ...REQUEST }],
      companiesByPhone: [{ phone: '0982565628', name: 'ร้านเดิมของนิด' }],
    });
    const { items } = await h.useCase.list(NOW);
    assert.equal(items[0]!.phoneMatchesCompanyName, 'ร้านเดิมของนิด');
  });

  it('finds the shop through its OWNER phone too, not only the company profile', async () => {
    const h = harness({
      requests: [{ ...REQUEST }],
      membershipsByPhone: [{ user: { phoneNumber: '0982565628' }, company: { name: 'ร้านของสมชาย' } }],
    });
    const { items } = await h.useCase.list(NOW);
    assert.equal(items[0]!.phoneMatchesCompanyName, 'ร้านของสมชาย');
  });

  it('omits the phone hint when nothing matches, and when no phone was given', async () => {
    const matched = await harness({ requests: [{ ...REQUEST }] }).useCase.list(NOW);
    assert.equal(matched.items[0]!.phoneMatchesCompanyName, undefined);

    const noPhone = await harness({
      requests: [{ ...REQUEST, phoneNumber: null }],
      companiesByPhone: [{ phone: '0982565628', name: 'ร้านเดิมของนิด' }],
    }).useCase.list(NOW);
    assert.equal(noPhone.items[0]!.phoneMatchesCompanyName, undefined);
  });

  // The page needs it to know a targeted suspend strands nothing, and the operator needs it to
  // know which partner page to open.
  it('carries the shop this application built, once it has built one', async () => {
    const withShop = await harness({ requests: [{ ...REQUEST, companyId: 'co-9' }] }).useCase.list(NOW);
    assert.equal(withShop.items[0]!.companyId, 'co-9');

    const withoutShop = await harness({ requests: [{ ...REQUEST, companyId: null }] }).useCase.list(NOW);
    assert.equal(withoutShop.items[0]!.companyId, undefined);
  });

  it('never leaks the stored password hash into the queue payload', async () => {
    const h = harness({ requests: [{ ...REQUEST }] });
    const { items } = await h.useCase.list(NOW);
    assert.equal(JSON.stringify(items).includes('scrypt$'), false);
  });

  // Review B-03: the LINE source has no address at all. `in: [null]` is not a query Prisma accepts,
  // and a blank string in the DTO would read to an operator as "we have an address, it is empty".
  it('lists an addressless LINE application without querying a null email', async () => {
    const h = harness({
      requests: [
        { ...REQUEST, id: 'signup-line', source: 'line-oa', contactEmail: null, mxValid: null, taxId: null },
        { ...REQUEST },
      ],
    });
    const { items } = await h.useCase.list(NOW);

    assert.equal(items.length, 2);
    assert.equal(items[0]!.contactEmail, undefined);
    assert.equal(items[0]!.emailMatchesExistingUser, false);
    assert.deepEqual(h.userQueries[0].where.email.in, ['somchai@example.com']);
  });

  /**
   * Owner 2026-09-05. The applicant unlinked and is applying again, so the identity that names them
   * is UNLINKED — invisible to any ACTIVE-only read, and precisely the case this hint exists for.
   */
  const lineRow = {
    ...REQUEST, id: 'signup-line', source: 'line-oa', contactEmail: null, taxId: null,
    lineProviderUserId: 'Uline-1', lineChannelId: 'channel-1',
  };
  const state = async (company: any, owner = true, status?: string) => {
    const h = harness({
      requests: [lineRow],
      identities: [{ providerUserId: 'Uline-1', providerChannelId: 'channel-1', userId: 'user-old' }],
      priorMemberships: [{ userId: 'user-old', owner, ...(status ? { status } : {}), company }],
    });
    const { items } = await h.useCase.list(NOW);
    return items[0]!;
  };

  it('names the shop a repeat applicant already had, and how it stands today', async () => {
    const closed = await state({ name: 'ร้านเก่า', status: 'DISABLED', planTerm: null });
    assert.equal(closed.priorCompanyName, 'ร้านเก่า');
    assert.equal(closed.priorCompanyState, 'CLOSED');
    // The same pair the LINE assistant uses to tell a term expiry from an admin-ordered close.
    const expired = await state({
      name: 'ร้านเก่า', status: 'DISABLED', planTerm: { termDisabledAt: new Date('2026-08-01') },
    });
    assert.equal(expired.priorCompanyState, 'EXPIRED');
    const running = await state({ name: 'ร้านเก่า', status: 'ACTIVE', planTerm: null });
    assert.equal(running.priorCompanyState, 'ACTIVE');
  });

  /**
   * The chat's `ownsTermExpiredCompany` requires DISABLED *and* a `termDisabledAt` stamp. Reading
   * the stamp alone called a SUSPENDED shop "หมดอายุ" while the assistant called the same shop
   * something else — and an operator told a customer to renew a suspension only an admin can lift.
   */
  it('calls a shop expired on exactly the pair the LINE assistant uses', async () => {
    const suspended = await state({
      name: 'ร้านเก่า', status: 'SUSPENDED', planTerm: { termDisabledAt: new Date('2026-08-01') },
    });
    assert.equal(suspended.priorCompanyState, 'CLOSED', 'a suspension is not an expiry');
    const disabledByHand = await state({ name: 'ร้านเก่า', status: 'DISABLED', planTerm: { termDisabledAt: null } });
    assert.equal(disabledByHand.priorCompanyState, 'CLOSED');
  });

  // An employee draft an admin started and abandoned is a half-filled form, not a shop.
  it('never names a shop from a membership that never got past DRAFT', async () => {
    const draft = await state({ name: 'ร้านร่าง', status: 'ACTIVE', planTerm: null }, true, 'DRAFT');
    assert.equal(draft.priorCompanyName, undefined);
    assert.equal(draft.priorCompanyState, undefined);
  });

  // Review B1: the employee whose LINE was linked by the staff QR. Their identity points at an
  // account holding a membership in their EMPLOYER's shop — naming it here would tell the operator
  // this person is repeating a trial they have never had, on a company that was never theirs.
  it('never names an employer shop the applicant only works at', async () => {
    const employeeOnly = await state({ name: 'ร้านนายจ้าง', status: 'ACTIVE', planTerm: null }, false);
    assert.equal(employeeOnly.priorCompanyName, undefined);
    assert.equal(employeeOnly.priorCompanyState, undefined);
  });

  it('says nothing about a prior shop when there is none', async () => {
    const h = harness({
      requests: [{
        ...REQUEST, source: 'line-oa', contactEmail: null, taxId: null,
        lineProviderUserId: 'Uline-1', lineChannelId: 'channel-1',
      }],
    });
    const { items } = await h.useCase.list(NOW);
    assert.equal(items[0]!.priorCompanyName, undefined);
    assert.equal(items[0]!.priorCompanyState, undefined);
  });

  // The "มีปัญหา" tab has to be able to say WHY. Without the code on the DTO the page could only
  // show "เปิดร้านไม่สำเร็จ" for a stale LINE identity and for a database outage alike.
  it('carries the provisioning failure code to the queue', async () => {
    const h = harness({
      requests: [{ ...REQUEST, state: 'PROVISIONING_FAILED', source: 'line-oa', failureCode: 'line_identity_already_linked' }],
    });
    const { items } = await h.useCase.list(NOW);
    assert.equal(items[0]!.failureCode, 'line_identity_already_linked');
  });
});

// P10-L §5/§8. What "approve" MEANS depends on the source: the web form still has a mailbox to
// prove, a LINE application proved its human at submit and goes straight to provisioning.
const LINE_REQUEST = {
  ...REQUEST,
  source: 'line-oa',
  contactEmail: null,
  mxValid: null,
  taxId: null,
  pendingPasswordHash: null,
  lineDisplayName: 'นิด',
  lineProviderUserId: 'Uline-1',
  lineChannelId: 'channel-1',
  autoApproved: false,
  legalAcceptedAt: new Date('2026-08-31T04:00:00.000Z'),
};
const URLS = { webBaseUrl: 'https://app.example.com', apiBaseUrl: 'https://api.example.com/v1' };

// R10: the PDPA health tripwire is dead for Thai free text ("คลินิก" maps to OTHER), so the enum is
// chosen by the human who is already reading that word — at review, never by a heuristic.
describe('SignupAdminQueueUseCase.decide — business category at review', () => {
  it('stores the category the admin picked alongside the approval', async () => {
    const h = harness();
    await h.useCase.decide(
      'signup-1', { action: 'APPROVE', businessCategory: 'CLINIC' }, 'admin-1', 'req-1', URLS,
    );
    // R08: the approval facts ride the state transition's own transaction, so the category the
    // reviewer picked commits with the state and the letter or not at all.
    const approval = h.advances.find((a: any) => a.state === 'EMAIL_PENDING');
    assert.equal(approval.data.businessCategory, 'CLINIC');
    assert.equal(approval.data.approvedByUserId, 'admin-1');
    // And it is evidence: a health-category decision an operator made has to be auditable.
    const auditRow = h.audits.find((a) => a.data.action === 'signup.request.approved');
    assert.equal(auditRow.data.metadataJson.businessCategory, 'CLINIC');
  });

  it('leaves the column alone when review did not pick one', async () => {
    const h = harness();
    await h.useCase.decide('signup-1', { action: 'APPROVE' }, 'admin-1', 'req-1', URLS);
    const approval = h.advances.find((a: any) => a.state === 'EMAIL_PENDING');
    assert.equal('businessCategory' in approval.data, false);
  });

  // F3: the enum re-check is the line that decides whether a PDPA safeguard can be armed by a
  // string nobody validated. Replacing it with `body.businessCategory ?? null` must not pass.
  it('refuses a category the enum does not know, at the use case and not only at the DTO', async () => {
    const h = harness();
    await h.useCase.decide(
      'signup-1', { action: 'APPROVE', businessCategory: 'HOSPITAL' }, 'admin-1', 'req-1', URLS,
    );
    const written = h.advances.find((a: any) => a.state === 'EMAIL_PENDING');
    assert.equal('businessCategory' in written.data, false, 'nothing unvalidated is stored');
    const auditRow = h.audits.find((a) => a.data.action === 'signup.request.approved');
    assert.equal(auditRow.data.metadataJson.businessCategory, null);
    // Same for an empty string and for a case that only LOOKS like the enum.
    for (const bad of ['', 'clinic', ' CLINIC ']) {
      const other = harness();
      await other.useCase.decide(
        'signup-1', { action: 'APPROVE', businessCategory: bad }, 'admin-1', 'req-1', URLS,
      );
      const badWrite = other.advances.find((a: any) => a.state === 'EMAIL_PENDING');
      assert.equal('businessCategory' in badWrite.data, false, bad);
    }
  });

  it('carries the choice into a LINE approval, which provisions inline', async () => {
    const h = harness({ request: LINE_REQUEST });
    await h.useCase.decide(
      'signup-1', { action: 'CREATE_NEW_SHOP', version: 1, businessCategory: 'WELLNESS_SPA' },
      'admin-1', 'req-1', URLS,
    );
    assert.equal(h.updates[0].data.businessCategory, 'WELLNESS_SPA');
  });
});

describe('SignupAdminQueueUseCase.decide — LINE-first source', () => {
  it('provisions only from the explicit new-shop outcome', async () => {
    const h = harness({ request: LINE_REQUEST });
    const result = await h.useCase.decide(
      'signup-1', { action: 'CREATE_NEW_SHOP', version: 1 }, 'admin-1', 'req-1', URLS,
    );

    assert.equal(result.state, 'COMPLETED');
    assert.equal(result.resolution, 'NEW_SHOP');
    assert.deepEqual(h.enqueued, [], 'no letter is queued for an application with no address');
    assert.deepEqual(h.advances, [], 'provisioning owns the PROVISIONING transition, not advance');
    assert.equal(h.provisioned[0].requestId, 'signup-1');
    // The stamp lands before provisioning, which reads it as the actor for what it creates.
    assert.equal(h.updates[0].data.approvedByUserId, 'admin-1');
  });

  it('rejects legacy generic approval for LINE', async () => {
    const h = harness({ request: LINE_REQUEST });
    await assert.rejects(
      () => h.useCase.decide('signup-1', { action: 'APPROVE', version: 1 }, 'admin-1', 'req-1', URLS),
      /line_signup_resolution_required/,
    );
    assert.deepEqual(h.provisioned, []);
  });

  it('requests all missing information through one versioned LINE event and one owned support case', async () => {
    const h = harness({ request: LINE_REQUEST });
    const first = await h.useCase.decide(
      'signup-1',
      { action: 'REQUEST_INFO', version: 1, resolutionNote: 'กรุณาส่งชื่อร้านและเบอร์โทรศัพท์ให้ครบถ้วน' },
      'admin-1', 'req-info-1', URLS, NOW,
    );

    assert.deepEqual(first, {
      requestId: 'signup-1', state: 'PENDING_REVIEW', version: 2,
      resolution: 'REQUEST_INFO', customerNotification: 'QUEUED', supportRequestId: 'support-1',
    });
    assert.equal(h.supportCreates.length, 1);
    assert.equal(h.supportCreates[0].data.signupRequestId, 'signup-1');
    assert.equal(h.supportCreates[0].data.lineUserId, 'Uline-1');
    assert.equal(h.supportCreates[0].data.assignedToUserId, 'admin-1');
    assert.equal('requestText' in h.supportCreates[0].data, false);
    assert.equal('lastMessageText' in h.supportCreates[0].data, false);
    assert.equal(h.lineNotifications[0].kind, 'requested_info');
    assert.equal(h.lineNotifications[0].options.reviewVersion, 2);

    const second = await h.useCase.decide(
      'signup-1',
      { action: 'REQUEST_INFO', version: 2, resolutionNote: 'กรุณาส่งอีเมลติดต่อที่ถูกต้องด้วย' },
      'admin-2', 'req-info-2', URLS, NOW,
    );
    assert.equal(second.version, 3);
    assert.equal(second.supportRequestId, 'support-1');
    assert.equal(h.supportCreates.length, 1, 'a repeated question reuses the live case');
    assert.equal(h.supportUpdates.length, 1);
    assert.equal(h.lineNotifications[1].options.reviewVersion, 3, 'a later real question has a distinct outbox key');
  });

  it('keeps the existing support owner when another admin asks for information', async () => {
    const h = harness({ request: LINE_REQUEST, liveSupport: { id: 'support-old', assignedToUserId: 'admin-owner' } });
    const result = await h.useCase.decide(
      'signup-1',
      { action: 'REQUEST_INFO', version: 1, resolutionNote: 'กรุณาส่งข้อมูลที่ขาดให้ครบในข้อความเดียว' },
      'admin-2', 'req-info-owner', URLS, NOW,
    );

    assert.equal(result.supportRequestId, 'support-old');
    assert.deepEqual(h.supportUpdates[0].data, { signupRequestId: 'signup-1' });
  });

  it('returns only to a currently proven shop and never provisions or stamps it as newly created', async () => {
    const h = harness({ request: LINE_REQUEST, existingMembership: true });
    const result = await h.useCase.decide(
      'signup-1',
      { action: 'RETURN_EXISTING', version: 1, targetCompanyId: 'company-existing' },
      'admin-1', 'req-return', URLS, NOW,
    );

    assert.equal(result.state, 'COMPLETED');
    assert.equal(result.resolution, 'RETURN_EXISTING');
    assert.equal(result.entryCompanyId, 'company-existing');
    assert.equal(h.current().companyId, null);
    assert.equal(h.current().resolvedExistingCompanyId, 'company-existing');
    assert.deepEqual(h.provisioned, []);
    assert.equal(h.contextUpserts[0].update.companyId, 'company-existing');
  });

  it('parks a repeat trial for plan review until an admin separately grants it with a note', async () => {
    const h = harness({ request: LINE_REQUEST, priorOwnedCompany: true });
    const parked = await h.useCase.decide(
      'signup-1', { action: 'CREATE_NEW_SHOP', version: 1 }, 'admin-1', 'req-plan', URLS, NOW,
    );
    assert.equal(parked.state, 'PENDING_REVIEW');
    assert.equal(parked.resolution, 'PLAN_REVIEW');
    assert.deepEqual(h.provisioned, [], 'plan review must not create an empty unusable shop');

    const completed = await h.useCase.decide(
      'signup-1', {
        action: 'CREATE_NEW_SHOP', version: 2, grantRepeatTrial: true,
        trialGrantNote: 'อนุมัติทดลองใช้งานรอบใหม่ตามแผนช่วยเหลือลูกค้า',
      }, 'admin-1', 'req-grant', URLS, NOW,
    );
    assert.equal(completed.state, 'COMPLETED');
    assert.equal(h.updates[1].data.repeatTrialGrantedByUserId, 'admin-1');
    assert.equal(h.provisioned.length, 1);
  });

  it('requires an explicit shared-contact acknowledgement before creating a conflicting shop', async () => {
    const h = harness({ request: { ...LINE_REQUEST, contactEmail: 'shared@example.test' }, contactEmailConflict: true });
    await assert.rejects(
      () => h.useCase.decide(
        'signup-1', { action: 'CREATE_NEW_SHOP', version: 1 }, 'admin-1', 'req-shared-missing', URLS, NOW,
      ),
      /line_signup_shared_contact_review_required/,
    );
    await h.useCase.decide(
      'signup-1', {
        action: 'CREATE_NEW_SHOP', version: 1, acknowledgeSharedContact: true,
        sharedContactNote: 'ตรวจสอบแล้วว่าเป็นอีเมลกลางที่ผู้สมัครมีสิทธิใช้',
      }, 'admin-1', 'req-shared-ok', URLS, NOW,
    );
    assert.equal(h.updates[0].data.sharedContactReviewedByUserId, 'admin-1');
    assert.equal(h.provisioned.length, 1);
  });

  it('refuses to provision without the bases the owner handoff needs', async () => {
    const h = harness({ request: LINE_REQUEST });
    await assert.rejects(
      () => h.useCase.decide('signup-1', { action: 'CREATE_NEW_SHOP', version: 1 }, 'admin-1', 'req-1'),
      /signup_provisioning_urls_required/,
    );
    assert.deepEqual(h.provisioned, []);
  });

  // Review HIGH-1: READY looked settled and was not. Treating it as done meant the queue never
  // listed the row, approve returned early without provisioning, and the customer's LINE account
  // stayed fenced by the open-application index with no admin path at all.
  it('finishes a READY application instead of calling it done', async () => {
    const h = harness({ request: {
      ...LINE_REQUEST, state: 'READY', companyId: 'co-1', reviewResolution: 'NEW_SHOP',
    } });
    const result = await h.useCase.decide(
      'signup-1', { action: 'CREATE_NEW_SHOP', version: 1 }, 'admin-1', 'req-1', URLS,
    );

    assert.equal(h.provisioned.length, 1, 'the finish path has to actually be called');
    assert.equal(h.provisioned[0].requestId, 'signup-1');
    assert.equal(result.state, 'COMPLETED');
  });

  it('tells the page which provisioning rows are abandoned and which are live', async () => {
    const h = harness({
      requests: [
        { ...LINE_REQUEST, id: 'stale', state: 'PROVISIONING', provisioningStartedAt: new Date(NOW.getTime() - STALE_PROVISIONING_MS - 1_000) },
        { ...LINE_REQUEST, id: 'live', state: 'PROVISIONING', provisioningStartedAt: new Date(NOW.getTime() - 1_000) },
      ],
    });
    const { items } = await h.useCase.list(NOW);

    // The server owns the clock the fence uses, so the page must not have to guess this.
    assert.equal(items[0]!.staleProvisioning, true);
    assert.equal(items[1]!.staleProvisioning, undefined);
  });

  it('lists a READY LINE application so an admin can reach it', async () => {
    const h = harness({ requests: [{ ...LINE_REQUEST, state: 'READY' }] });
    const { items } = await h.useCase.list(NOW);
    assert.equal(items.length, 1);
    assert.deepEqual(h.requestQueries[0].where.OR[1], {
      state: { in: ['READY', 'PROVISIONING'] }, source: { in: ['line-oa', 'email-otp'] },
    });
  });

  // Review HIGH-1 (fourth pass): the stale re-claim in the fence was unreachable because the queue
  // refused to approve a PROVISIONING row at all. These assert at the DECIDE level, which is the
  // only level an admin can actually reach — the previous test called provision.execute directly
  // and so proved nothing about reachability.
  it('finishes an abandoned provisioning run when an admin approves it', async () => {
    const h = harness({
      request: {
        ...LINE_REQUEST,
        state: 'PROVISIONING',
        provisioningStartedAt: new Date(NOW.getTime() - STALE_PROVISIONING_MS - 1_000), reviewResolution: 'NEW_SHOP',
      },
    });
    const result = await h.useCase.decide(
      'signup-1', { action: 'CREATE_NEW_SHOP', version: 1 }, 'admin-1', 'req-1', URLS, NOW,
    );

    assert.equal(h.provisioned.length, 1, 'the fence would re-claim it, so the queue must offer it');
    assert.equal(result.state, 'COMPLETED');
  });

  it('refuses while a provisioning run is plausibly still going', async () => {
    const h = harness({
      request: {
        ...LINE_REQUEST,
        state: 'PROVISIONING',
        provisioningStartedAt: new Date(NOW.getTime() - 1_000), reviewResolution: 'NEW_SHOP',
      },
    });
    await assert.rejects(
      () => h.useCase.decide(
        'signup-1', { action: 'CREATE_NEW_SHOP', version: 1 }, 'admin-1', 'req-1', URLS, NOW,
      ),
      /invalid_signup_create_new_shop:PROVISIONING/,
    );
    assert.deepEqual(h.provisioned, []);
  });

  it('treats a second tap on a finished application as a no-op', async () => {
    const h = harness({ request: { ...LINE_REQUEST, state: 'COMPLETED', reviewResolution: 'NEW_SHOP' } });
    const result = await h.useCase.decide(
      'signup-1', { action: 'CREATE_NEW_SHOP', version: 1 }, 'admin-1', 'req-1', URLS,
    );
    assert.equal(result.state, 'COMPLETED');
    assert.deepEqual(h.provisioned, [], 'COMPLETED must not provision twice');
  });

  it('stamps the explicit decision once and reuses it for provisioning recovery', async () => {
    const first = harness({ request: LINE_REQUEST });
    await first.useCase.decide(
      'signup-1', { action: 'CREATE_NEW_SHOP', version: 1 }, 'admin-1', 'req-1', URLS,
    );
    assert.equal(first.updates[0].data.approvedByUserId, 'admin-1');

    for (const state of ['PROVISIONING_FAILED', 'READY'] as const) {
      const h = harness({ request: { ...LINE_REQUEST, state, reviewResolution: 'NEW_SHOP' } });
      await h.useCase.decide(
        'signup-1', { action: 'CREATE_NEW_SHOP', version: 1 }, 'admin-2', 'req-2', URLS,
      );
      assert.deepEqual(h.updates, [], `${state} must not rewrite the approval stamp`);
    }
  });

  it('sends the rejection on the rail this source actually has (P10-L §7)', async () => {
    const h = harness({ request: LINE_REQUEST });
    const result = await h.useCase.decide(
      'signup-1', { action: 'REJECT', version: 1, notifyApplicant: true }, 'admin-1', 'req-1', URLS,
    );

    assert.equal(result.state, 'REJECTED');
    // Exactly one notice, and it is the LINE push: the applicant has no address for a letter.
    assert.deepEqual(h.enqueued, [{ id: 'signup-1', reason: 'line-push:rejected' }]);
    assert.deepEqual(h.advances, [{ id: 'signup-1', state: 'REJECTED' }]);
  });

  it('sends nothing when the admin cleared the notify toggle', async () => {
    const h = harness({ request: LINE_REQUEST });
    await h.useCase.decide('signup-1', { action: 'REJECT', version: 1 }, 'admin-1', 'req-1', URLS);
    assert.deepEqual(h.enqueued, [], 'silent by default stays silent on this rail too');
  });

  // Review HIGH-2: the fence releases on failure precisely so the row can be retried. A row nobody
  // can see is a row nobody retries, and for a LINE application that also leaves the customer's
  // LINE account fenced by the open-application index with no way out.
  it('surfaces a failed provisioning in the queue instead of stranding it', async () => {
    const h = harness({ requests: [{ ...LINE_REQUEST, state: 'PROVISIONING_FAILED' }] });
    const { items } = await h.useCase.list(NOW);
    assert.equal(items.length, 1);
    assert.equal(items[0]!.state, 'PROVISIONING_FAILED');
  });

  // Review MEDIUM-D: only for THIS source. A web-form row in the same state has no retry an admin
  // could reach — approve, reject and reissue all 409 — so listing it offers three dead ends.
  // Review F2: PROVISIONING_FAILED moved into the source-independent list. READY and PROVISIONING
  // stay LINE-only — a web row in either has no action an admin can take on it.
  it('asks for a failed provisioning on every source, and the other two on LINE alone', async () => {
    const h = harness({ requests: [] });
    await h.useCase.list(NOW);

    assert.deepEqual(h.requestQueries[0].where.OR, [
      { state: { in: ['PENDING_REVIEW', 'EMAIL_PENDING', 'EMAIL_FAILED', 'EXPIRED', 'PROVISIONING_FAILED'] } },
      { state: { in: ['READY', 'PROVISIONING'] }, source: { in: ['line-oa', 'email-otp'] } },
      { source: 'line-oa', state: { in: ['RECEIVED', 'VALIDATED'] } },
    ]);
  });

  it('retries provisioning when an admin approves a failed LINE application', async () => {
    const h = harness({ request: {
      ...LINE_REQUEST, state: 'PROVISIONING_FAILED', autoApproved: true, reviewResolution: 'NEW_SHOP',
    } });
    const result = await h.useCase.decide(
      'signup-1', { action: 'CREATE_NEW_SHOP', version: 1 }, 'admin-1', 'req-1', URLS,
    );

    assert.equal(result.state, 'COMPLETED');
    assert.equal(h.provisioned[0].requestId, 'signup-1');
    // The retry is what gives an AUTO_FREE row that failed a real operator of record.
    assert.equal(h.provisioned[0].actorUserId, 'admin-1');
    // Review LOW-3: a retry does not rewrite when the application was decided.
    assert.deepEqual(h.updates, []);
    assert.deepEqual(h.audits, [], 'provision recovery is not recorded as a second decision');
  });

  // Review F2: the web form gets the same retry. What it does NOT get is the READY close-out —
  // that row's last step belongs to the applicant's own welcome page.
  it('still refuses the READY close-out to the web form, whose last step is the applicant\'s', async () => {
    const h = harness({ request: { ...REQUEST, state: 'READY' } });
    await assert.rejects(
      () => h.useCase.decide('signup-1', { action: 'APPROVE' }, 'admin-1', 'req-1', URLS),
      /invalid_signup_decision:READY/,
    );
  });

  it('shows the operator which source a row came from', async () => {
    const h = harness({ requests: [LINE_REQUEST] });
    const { items } = await h.useCase.list(NOW);

    assert.equal(items[0]!.source, 'line-oa');
    assert.equal(items[0]!.lineDisplayName, 'นิด');
    assert.equal(items[0]!.legalAcceptedAt, '2026-08-31T04:00:00.000Z');
    assert.equal(items[0]!.contactEmail, undefined);
  });
});

describe('SignupAdminQueueUseCase.decide — suspend', () => {
  it('stops an auto-approved shop after the fact and revokes anything outstanding', async () => {
    const h = harness({ request: { ...LINE_REQUEST, state: 'COMPLETED', autoApproved: true } });
    const result = await h.useCase.decide('signup-1', { action: 'SUSPEND', version: 1 }, 'admin-1', 'req-1', URLS);

    assert.deepEqual(result, { requestId: 'signup-1', state: 'SUSPENDED' });
    // A failure state needs a reason code, and the reason is that an admin said so.
    assert.deepEqual(h.advances, [{ id: 'signup-1', state: 'SUSPENDED', failureCode: 'admin_suspended' }]);
    assert.deepEqual(h.revoked, ['signup-1']);
    assert.equal(h.updates[0].data.pendingPasswordHash, null);
    const audit = h.audits[0].data;
    assert.equal(audit.action, 'signup.line.suspended');
    assert.equal(audit.metadataJson.wasAutoApproved, true);
    assert.equal(audit.metadataJson.fromState, 'COMPLETED');
  });

  // Review MEDIUM-2: SUSPENDED is terminal. A row mid-provisioning may already have a company whose
  // trial guards never ran — suspending it would leave an unlimited shop with the application shut
  // behind it — and against a live attempt it races work still in flight.
  it('refuses to suspend a LIVE provisioning run, however fresh or stale it looks', async () => {
    for (const [ageMs, companyId] of [
      [1_000, null], // still running: racing work in flight
      [1_000, 'co-1'], // still running and a shop already exists
      [STALE_PROVISIONING_MS + 1_000, 'co-1'], // abandoned, but the shop it built is standing
    ] as const) {
      const h = harness({
        request: {
          ...LINE_REQUEST, state: 'PROVISIONING', companyId,
          provisioningStartedAt: new Date(NOW.getTime() - ageMs),
        },
      });
      await assert.rejects(
        () => h.useCase.decide('signup-1', { action: 'SUSPEND', version: 1 }, 'admin-1', 'req-1', URLS, NOW),
        /suspend_not_allowed_in_flight/,
      );
      assert.deepEqual(h.advances, [], `age ${ageMs}ms / company ${companyId} must not settle the row`);
    }
  });

  // Plan note (L-A review rounds 5–6): the ONE safe targeted suspend. `companyId` is stamped inside
  // the company transaction, so its absence on an abandoned attempt means no company was ever
  // created — there is nothing to strand, and without this the row is a dead end whose only exit is
  // opening a shop the operator has already decided not to want.
  it('allows a targeted suspend of an abandoned attempt that never built a shop', async () => {
    const h = harness({
      request: {
        ...LINE_REQUEST, state: 'PROVISIONING', companyId: null,
        provisioningStartedAt: new Date(NOW.getTime() - STALE_PROVISIONING_MS - 1_000),
      },
    });
    const result = await h.useCase.decide('signup-1', { action: 'SUSPEND', version: 1 }, 'admin-1', 'req-1', URLS, NOW);

    assert.deepEqual(result, { requestId: 'signup-1', state: 'SUSPENDED' });
    assert.deepEqual(h.advances, [{ id: 'signup-1', state: 'SUSPENDED', failureCode: 'admin_suspended' }]);
    assert.equal(h.audits[0].data.metadataJson.fromState, 'PROVISIONING');
  });

  it('is a no-op when the application is already suspended', async () => {
    const h = harness({ request: { ...LINE_REQUEST, state: 'SUSPENDED' } });
    const result = await h.useCase.decide('signup-1', { action: 'SUSPEND', version: 1 }, 'admin-1', 'req-1', URLS);

    assert.equal(result.state, 'SUSPENDED');
    assert.deepEqual(h.advances, []);
    assert.deepEqual(h.audits, []);
  });
});

// R13: the queue read 200 rows and the page filtered and counted whatever came back — so a backlog
// past 200 was invisible, a tab could show "ไม่มีคำขอในกลุ่มนี้" over rows the database was holding,
// and REJECTED/SUSPENDED applications could not be found at all.
describe('SignupAdminQueueUseCase.list — filtering, paging and counts', () => {
  // Review F2 moved PROVISIONING_FAILED to every source; READY and a live PROVISIONING stay
  // LINE-only, because a web row in either has no action an admin could take.
  const queueWhereForDefaultTab = () => ({
    OR: [
      { state: { in: ['PENDING_REVIEW', 'EMAIL_PENDING', 'EMAIL_FAILED', 'EXPIRED', 'PROVISIONING_FAILED'] } },
      { state: { in: ['READY', 'PROVISIONING'] }, source: { in: ['line-oa', 'email-otp'] } },
      { state: { in: ['RECEIVED', 'VALIDATED'] }, source: 'line-oa' },
    ],
  });
  const page = (n: number) => Array.from({ length: n }, (_, i) => ({
    ...REQUEST,
    id: `signup-${i + 1}`,
    createdAt: new Date(NOW.getTime() - (n - i) * 60_000),
  }));

  it('asks the database for one tab rather than filtering a truncated page in the browser', async () => {
    const h = harness({ requests: [] });
    await h.useCase.list(NOW, { tab: 'PENDING_REVIEW' });
    assert.deepEqual(h.requestQueries[0].where, { state: 'PENDING_REVIEW' });

    const claim = harness({ requests: [] });
    await claim.useCase.list(NOW, { tab: 'AWAITING_CLAIM' });
    assert.deepEqual(claim.requestQueries[0].where, { state: 'EMAIL_PENDING' });
  });

  it('offers an archive so a rejected or suspended application can still be found', async () => {
    const h = harness({ requests: [] });
    await h.useCase.list(NOW, { tab: 'ARCHIVED' });
    assert.deepEqual(h.requestQueries[0].where, { state: { in: ['REJECTED', 'SUSPENDED', 'EXPIRED'] } });
  });

  it('hands back a cursor when more rows exist, and nothing when they do not', async () => {
    const rows = page(6);
    const full = harness({ requests: rows });
    const first = await full.useCase.list(NOW, { limit: 5 });
    assert.equal(first.items.length, 5, 'the extra row is a probe, never rendered');
    assert.equal(first.nextCursor, encodeQueueCursor(rows[4]!.createdAt, rows[4]!.id));
    assert.equal(full.requestQueries[0].take, 6);

    const last = harness({ requests: page(3) });
    const rest = await last.useCase.list(NOW, { limit: 5 });
    assert.equal(rest.items.length, 3);
    assert.equal(rest.nextCursor, null);
  });

  // F10: the cursor carries the ORDERING VALUES, not a row to look up. A row-id cursor is resolved
  // by Prisma against the same filtered query, so a row that left the tab between pages (an admin
  // approved it, a sweep parked it) makes the next page come back empty — and the operator sees a
  // tab that has silently stopped, with no way on but a reload.
  it('continues from the ordering values, so a row leaving the tab cannot strand the page', async () => {
    const h = harness({ requests: page(2) });
    const at = new Date('2026-08-30T10:00:00.000Z');
    const cursor = encodeQueueCursor(at, 'signup-40');
    await h.useCase.list(NOW, { cursor, limit: 5 });

    const where = h.requestQueries[0].where;
    // Never a row lookup: nothing here has to still exist, or still match the tab.
    assert.equal(h.requestQueries[0].cursor, undefined);
    assert.equal(h.requestQueries[0].skip, undefined);
    // The tab predicate first, the page boundary second — the default tab has an `OR` of its own,
    // so the boundary is identified by position, not by "the clause with an OR in it".
    assert.deepEqual(where.AND[0], queueWhereForDefaultTab());
    assert.deepEqual(where.AND[1].OR, [
      { createdAt: { gt: at } },
      { createdAt: at, id: { gt: 'signup-40' } },
    ]);
    // Deterministic ordering, or a cursor can skip or repeat rows between pages.
    assert.deepEqual(h.requestQueries[0].orderBy, [{ createdAt: 'asc' }, { id: 'asc' }]);
  });

  it('hands back a cursor made of the last row values, and ignores a corrupt one', async () => {
    const rows = page(6);
    const h = harness({ requests: rows });
    const first = await h.useCase.list(NOW, { limit: 5 });
    assert.equal(first.nextCursor, encodeQueueCursor(rows[4]!.createdAt, rows[4]!.id));

    // A cursor that cannot be read is the first page, never a crash and never an empty tab.
    const garbled = harness({ requests: page(2) });
    await garbled.useCase.list(NOW, { cursor: 'not-a-cursor', limit: 5 });
    assert.equal(garbled.requestQueries[0].where.AND, undefined);
  });

  it('caps what one page may ask for, whatever the caller sends', async () => {
    const h = harness({ requests: [] });
    await h.useCase.list(NOW, { limit: 100_000 });
    assert.ok(h.requestQueries[0].take <= 201, `asked for ${h.requestQueries[0].take}`);
  });

  // F5: the "มีปัญหา" tab exists to surface rows an operator must act on, and an ABANDONED
  // provisioning run is the one they most need to find. It is decided by the clock, not by a
  // state, so it has to be part of the tab's predicate — otherwise the tab's own count (which
  // does include it) promises rows the list can never show.
  it('puts abandoned provisioning runs on the problem tab, agreeing with its count', async () => {
    const h = harness({ requests: [] });
    await h.useCase.list(NOW, { tab: 'PROBLEM' });

    const branches = h.requestQueries[0].where.OR;
    const stale = branches.find((b: any) => b.provisioningStartedAt);
    assert.ok(stale, 'the problem tab must ask for abandoned runs, not only for failed states');
    assert.equal(stale.state, 'PROVISIONING');
    assert.deepEqual(stale.source, { in: ['line-oa', 'email-otp'] });
    // The same clock the fence uses, or the queue and the fence disagree about what abandoned is.
    assert.equal(NOW.getTime() - (stale.provisioningStartedAt.lt as Date).getTime(), STALE_PROVISIONING_MS);
    // And the states that are problems by state alone are still there. Review F2 made a failed
    // provisioning an EVERY-source row, so it is asked for by state — not behind the LINE filter,
    // which would have hidden a Flow B failure from the one tab that exists to surface it.
    assert.deepEqual(branches[0], { state: { in: ['EMAIL_FAILED', 'EXPIRED', 'PROVISIONING_FAILED'] } });
    assert.deepEqual(branches[1], { state: { in: ['READY'] }, source: { in: ['line-oa', 'email-otp'] } });
  });

  it('counts the WHOLE queue, not the page it just read', async () => {
    const h = harness({
      requests: page(2),
      stateCounts: [
        { state: 'PENDING_REVIEW', source: 'official-site', _count: { _all: 240 } },
        { state: 'EMAIL_PENDING', source: 'official-site', _count: { _all: 31 } },
        { state: 'EMAIL_FAILED', source: 'official-site', _count: { _all: 4 } },
        { state: 'EXPIRED', source: 'official-site', _count: { _all: 7 } },
        { state: 'PROVISIONING_FAILED', source: 'line-oa', _count: { _all: 2 } },
        // F2: a Flow B provisioning failure is a queue row too, so it is counted like one.
        { state: 'PROVISIONING_FAILED', source: 'official-site', _count: { _all: 6 } },
        { state: 'READY', source: 'line-oa', _count: { _all: 1 } },
        // 8 runs in flight, 5 of them abandoned by the clock: the 3 live ones are in the queue and
        // are NOT a problem, which is the one distinction a state count cannot make on its own.
        { state: 'PROVISIONING', source: 'line-oa', _count: { _all: 8 } },
        // A web-form row in a LINE-only state is not in the queue, so it is in no count either.
        { state: 'READY', source: 'official-site', _count: { _all: 99 } },
        { state: 'REJECTED', source: 'official-site', _count: { _all: 12 } },
        { state: 'SUSPENDED', source: 'line-oa', _count: { _all: 3 } },
      ],
      staleProvisioningCount: 5,
    });
    const { counts } = await h.useCase.list(NOW);

    assert.equal(counts!.PENDING_REVIEW, 240);
    assert.equal(counts!.AWAITING_CLAIM, 31);
    // Bounced, expired, failed provisioning, stranded READY, and the abandoned runs.
    assert.equal(counts!.PROBLEM, 4 + 7 + 2 + 6 + 1 + 5);
    assert.equal(counts!.ARCHIVED, 12 + 3 + 7);
    // Everything actionable, live provisioning runs included, and nothing that is not in the queue.
    assert.equal(counts!.ALL, 240 + 31 + 4 + 7 + 2 + 6 + 1 + 8);
  });
});

describe('SignupAdminQueueUseCase.listAutoApproved', () => {
  it('shows what the machine let through, without inventing dedupe hints for it', async () => {
    const h = harness({ requests: [{ ...LINE_REQUEST, state: 'COMPLETED', autoApproved: true }] });
    const { items } = await h.useCase.listAutoApproved(14, NOW);

    assert.equal(items.length, 1);
    assert.equal(items[0]!.autoApproved, true);
    // These rows are settled, so the queue's "is this a duplicate" hints do not apply.
    assert.equal(items[0]!.emailMatchesExistingUser, false);
    assert.equal(items[0]!.taxIdMatchesCompanyName, undefined);
  });
});

describe('SignupAdminQueueUseCase.decide — approve', () => {
  it('approves once, records the approver, and queues exactly one email', async () => {
    const h = harness();
    const result = await h.useCase.decide('signup-1', { action: 'APPROVE' }, 'admin-1', 'req-1');

    assert.deepEqual(result, { requestId: 'signup-1', state: 'EMAIL_PENDING' });
    assert.equal(h.advances.length, 1);
    assert.equal(h.advances[0].state, 'EMAIL_PENDING');
    // R08: the approval facts ride the transition itself, never a second update that can be lost.
    assert.equal(h.advances[0].data.approvedByUserId, 'admin-1');
    assert.ok(h.advances[0].data.approvedAt instanceof Date);
    // R09: the activation window the sweep reads starts here, beside the audit fact.
    assert.ok(h.advances[0].data.claimWindowStartedAt instanceof Date);
    assert.deepEqual(h.updates, [], 'nothing about the approval is written outside the transition');
    assert.deepEqual(h.enqueued, [{ id: 'signup-1', reason: 'approve' }]);
  });

  it('repairs an already-approved application instead of reporting success over a missing email', async () => {
    const h = harness({ request: { ...REQUEST, state: 'EMAIL_PENDING' } });
    const result = await h.useCase.decide('signup-1', { action: 'APPROVE' }, 'admin-1', 'req-2');

    assert.equal(result.state, 'EMAIL_PENDING');
    // R08: no second transition and no second approver stamp — but the letter is re-enqueued,
    // because the outbox key is the request id and the alternative is an applicant who waits
    // forever for an email the first, half-failed approve never queued.
    assert.deepEqual(h.advances, []);
    assert.deepEqual(h.updates, []);
    assert.deepEqual(h.enqueued, [{ id: 'signup-1', reason: 'approve' }]);
    // F8: a repair is an operator action and leaves its own record — the alternative is evidence
    // that consists only of the absence of a second email.
    assert.equal(h.audits.length, 1);
    assert.equal(h.audits[0].data.action, 'signup.request.claim_email_repaired');
    assert.equal(h.audits[0].data.metadataJson.fromState, 'EMAIL_PENDING');
  });

  /**
   * Review F2. A Flow B applicant who claimed their link and then hit a failed provisioning was a
   * dead end: the row was listed for LINE only, the token was spent, and resend and reissue both
   * refuse from PROVISIONING_FAILED. The retry is the same action on both sources.
   */
  it('retries a failed provisioning on the web form, without asking for the mailbox again', async () => {
    const h = harness({ request: { ...REQUEST, state: 'PROVISIONING_FAILED', approvedAt: NOW } });

    const result = await h.useCase.decide('signup-1', { action: 'APPROVE' }, 'admin-1', 'req-1', URLS);

    assert.equal(result.state, 'LINE_LINK_PENDING', 'a web shop parks at its own LINE step');
    assert.equal(h.provisioned.length, 1);
    assert.equal(h.provisioned[0].requestId, 'signup-1');
    // The claim already happened: no new letter, and no trip back to EMAIL_PENDING.
    assert.deepEqual(h.enqueued, []);
    assert.deepEqual(h.advances, []);
    // The original decision time is history and is not rewritten by the retry.
    assert.deepEqual(h.updates, []);
    // Review F16: a retry files under its own action. As a second `signup.request.approved` the
    // trail read as two approvals of one application, when the approval happened days earlier.
    assert.equal(h.audits[0].data.action, 'signup.request.provisioning_retried');
    assert.equal(h.audits[0].data.metadataJson.retryOfFailedProvisioning, true);
    assert.equal(h.audits[0].data.metadataJson.finishedStrandedRow, false);
  });

  it('lists a failed provisioning for every source, not just LINE', async () => {
    const h = harness({
      requests: [
        { ...REQUEST, id: 'web-1', state: 'PROVISIONING_FAILED', source: 'official-site', failureCode: 'boom' },
      ],
    });

    const queue = await h.useCase.list(NOW);

    assert.equal(queue.items.length, 1, 'the row an operator most needs to find must be listed');
    assert.equal(queue.items[0]!.state, 'PROVISIONING_FAILED');
    assert.equal(queue.items[0]!.failureCode, 'boom');
    // The states the list asks for include it unconditionally rather than only for `line-oa`.
    assert.ok(h.requestQueries[0].where.OR[0].state.in.includes('PROVISIONING_FAILED'));
  });

  it('refuses to approve an application that is past review', async () => {
    for (const state of ['REJECTED', 'COMPLETED', 'READY']) {
      const h = harness({ request: { ...REQUEST, state } });
      await assert.rejects(
        () => h.useCase.decide('signup-1', { action: 'APPROVE' }, 'admin-1', 'req-3'),
        ConflictException,
      );
      assert.deepEqual(h.enqueued, []);
    }
  });

  it('writes a HIGH audit row with booleans only', async () => {
    const h = harness();
    await h.useCase.decide('signup-1', { action: 'APPROVE' }, 'admin-1', 'req-1');

    const audit = h.audits[0].data;
    assert.equal(audit.action, 'signup.request.approved');
    assert.equal(audit.riskLevel, 'HIGH');
    assert.equal(audit.actorUserId, 'admin-1');
    assert.equal(audit.targetId, 'signup-1');
    // R10: null records that this reviewer did not pick a category — an enum key or nothing, and
    // never the applicant's own words, which are the PII this row must not carry.
    assert.deepEqual(audit.metadataJson, { hadTaxId: true, mxValid: true, businessCategory: null });
    // Applicant PII must never reach evidence.
    const evidence = JSON.stringify(h.audits);
    for (const pii of ['somchai@example.com', 'ร้านมั่งมี', '0105555000012', '0982565628']) {
      assert.equal(evidence.includes(pii), false, `audit leaked ${pii}`);
    }
  });
});

describe('SignupAdminQueueUseCase.decide — reject', () => {
  it('is silent by default and destroys the pending credential material', async () => {
    const h = harness();
    const result = await h.useCase.decide('signup-1', { action: 'REJECT' }, 'admin-1', 'req-1');

    assert.equal(result.state, 'REJECTED');
    assert.deepEqual(h.advances, [{ id: 'signup-1', state: 'REJECTED' }]);
    assert.equal(h.updates[0].data.pendingPasswordHash, null);
    assert.deepEqual(h.revoked, ['signup-1']);
    // The address is unverified, so no unsolicited mail leaves by default.
    assert.deepEqual(h.enqueued, []);
    assert.deepEqual(h.audits[0].data.metadataJson, { notifyApplicant: false, hadRejectionReason: false });
  });

  it('ignores a reason the admin typed and then unticked the notice for', async () => {
    const h = harness();
    await h.useCase.decide(
      'signup-1', { action: 'REJECT', rejectionReason: 'ข้อมูลไม่ครบ' }, 'admin-1', 'req-1',
    );
    assert.deepEqual(h.enqueued, [], 'a reason alone must not turn a silent reject into an email');
  });

  it('sends a notice only when the admin asks for one', async () => {
    const h = harness();
    await h.useCase.decide('signup-1', { action: 'REJECT', notifyApplicant: true }, 'admin-1', 'req-1');
    assert.deepEqual(h.enqueued, [{ id: 'signup-1', reason: 'rejection-notice', rejectionReason: undefined }]);
    assert.deepEqual(h.audits[0].data.metadataJson, { notifyApplicant: true, hadRejectionReason: false });
  });

  it('passes the admin paragraph through and records only that one existed', async () => {
    const h = harness();
    await h.useCase.decide(
      'signup-1', { action: 'REJECT', notifyApplicant: true, rejectionReason: 'ข้อมูลบริษัทไม่ครบ' },
      'admin-1', 'req-1',
    );
    assert.deepEqual(h.enqueued, [
      { id: 'signup-1', reason: 'rejection-notice', rejectionReason: 'ข้อมูลบริษัทไม่ครบ' },
    ]);
    assert.deepEqual(h.audits[0].data.metadataJson, { notifyApplicant: true, hadRejectionReason: true });
    // Copy written for one inbox is not an audit fact.
    assert.equal(JSON.stringify(h.audits).includes('ข้อมูลบริษัทไม่ครบ'), false);
  });

  it('is idempotent on repeat', async () => {
    const h = harness({ request: { ...REQUEST, state: 'REJECTED' } });
    const result = await h.useCase.decide('signup-1', { action: 'REJECT' }, 'admin-1', 'req-2');
    assert.equal(result.state, 'REJECTED');
    assert.deepEqual(h.advances, []);
    assert.deepEqual(h.audits, []);
  });
});

describe('SignupAdminQueueUseCase.reissue', () => {
  it('revives an application at any age — there is no dead end', async () => {
    for (const state of ['EMAIL_PENDING', 'EMAIL_FAILED', 'EXPIRED']) {
      // Approved two years ago: still reissuable, because the applicant already applied.
      const h = harness({ request: { ...REQUEST, state, approvedAt: new Date('2024-01-01T00:00:00.000Z') } });
      const result = await h.useCase.reissue('signup-1', 'admin-1', 'req-1');

      assert.deepEqual(result, { requestId: 'signup-1', state: 'EMAIL_PENDING', claimEmailQueued: true });
      assert.deepEqual(h.revoked, ['signup-1'], 'old links must die before a new one is sent');
      assert.deepEqual(h.advances, [{ id: 'signup-1', state: 'EMAIL_PENDING' }]);
      assert.deepEqual(h.enqueued, [{ id: 'signup-1', reason: 'reissue' }]);
      // A fresh link earns a fresh reminder.
      assert.equal(h.updates[0].data.claimReminderSentAt, null);
      assert.equal(h.audits[0].data.riskLevel, 'HIGH');
      assert.deepEqual(h.audits[0].data.metadataJson, { fromState: state, revokedTokenCount: 2 });
    }
  });

  it('refuses states where a claim link would make no sense', async () => {
    for (const state of ['PENDING_REVIEW', 'REJECTED', 'COMPLETED', 'READY']) {
      const h = harness({ request: { ...REQUEST, state } });
      await assert.rejects(() => h.useCase.reissue('signup-1', 'admin-1', 'req-1'), ConflictException);
      assert.deepEqual(h.enqueued, []);
    }
  });

  it('404s an unknown application', async () => {
    const h = harness({ request: null });
    await assert.rejects(() => h.useCase.reissue('nope', 'admin-1', 'req-1'), NotFoundException);
    await assert.rejects(() => h.useCase.decide('nope', { action: 'APPROVE' }, 'admin-1', 'req-1'), NotFoundException);
  });
});
