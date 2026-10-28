/**
 * Shared unit fixture for the SPLIT money engine (the `line-messaging-credentials.fixture.ts`
 * precedent). `ai-gateway.client.spec.ts` owns the seam behaviour and the combined LINE-AI
 * regression suite drives the same engine through the real webhook use case; a second in-memory
 * reservation table would be the one thing guaranteed to drift from this one.
 */

/** The single approved model a SPLIT fixture company is pinned to, so the envelope can name it. */
export const SPLIT_FIXTURE_MODEL_ID = 'apac.anthropic.claude-3-haiku-20240307-v1:0';
const HAIKU = SPLIT_FIXTURE_MODEL_ID;

/**
 * Reservation-capable ledger fake. Only what the engine touches: a SPLIT config row, the two
 * aggregates, and an in-memory reservation table with the unique invocation fence.
 */
export function splitPrisma(
  policy: { total: number; chat: number; ocr: number; spentChat?: number; spentOcr?: number },
  /** Extra delegates merged into the transaction object — e.g. the OCR-count governance tables a
   *  caller that drives `admitCompanyOcr` through this same client needs. */
  extra: Record<string, unknown> = {},
) {
  const reservations = new Map<string, any>();
  const events = new Map<string, any>();
  const buckets = new Map<string, { costSatang: number; callCount: number }>();
  const configRow = {
    modelId: HAIKU, monthlyBudgetSatang: policy.total, budgetMode: 'SPLIT',
    chatMonthlyBudgetSatang: policy.chat, ocrMonthlyBudgetSatang: policy.ocr,
    budgetConfigVersion: 1, pendingBudgetPolicy: null,
  };
  buckets.set('CHAT', { costSatang: policy.spentChat ?? 0, callCount: 0 });
  buckets.set('OCR', { costSatang: policy.spentOcr ?? 0, callCount: 0 });
  const reservationDelegate = {
    findUnique: async (args: any) => (args.where.invocationKey !== undefined
      ? [...reservations.values()].find((r) => r.invocationKey === args.where.invocationKey) ?? null
      : reservations.get(args.where.id) ?? null),
    findFirst: async () => null,
    groupBy: async () => [...new Set([...reservations.values()].map((r) => r.bucket))].map((bucket) => ({
      bucket, status: 'RESERVED',
      _sum: { upperBoundSatang: [...reservations.values()]
        .filter((r) => r.bucket === bucket && ['RESERVED', 'DISPATCHED', 'UNRESOLVED'].includes(r.status))
        .reduce((sum, r) => sum + r.upperBoundSatang, 0) },
      _count: { _all: 1 },
    })),
    count: async () => 0,
    create: async (args: any) => {
      if ([...reservations.values()].some((r) => r.invocationKey === args.data.invocationKey)) throw new Error('unique');
      const row = { id: `res-${reservations.size + 1}`, ...args.data };
      reservations.set(row.id, row);
      return { id: row.id };
    },
    update: async (args: any) => Object.assign(reservations.get(args.where.id), args.data),
    updateMany: async (args: any) => {
      const matched = [...reservations.values()].filter((r) =>
        (args.where.id === undefined || r.id === args.where.id)
        && (args.where.ownerToken === undefined || r.ownerToken === args.where.ownerToken)
        && (args.where.status === undefined
          || (typeof args.where.status === 'string' ? r.status === args.where.status : args.where.status.in.includes(r.status)))
        && args.where.createdAt === undefined && args.where.dispatchedAt === undefined);
      for (const row of matched) Object.assign(row, args.data);
      return { count: matched.length };
    },
  };
  // LIVE aggregates: a settlement really increments them, so a caller can assert that OCR money
  // moved while CHAT did not. `increment` is the only update shape the three writers use.
  const monthUsage = { costSatang: (policy.spentChat ?? 0) + (policy.spentOcr ?? 0), callCount: 0 };
  const applyIncrements = (row: Record<string, number>, update: Record<string, any>) => {
    for (const [field, value] of Object.entries(update ?? {})) {
      const increment = (value as { increment?: number } | undefined)?.increment;
      if (typeof increment === 'number') row[field] = (row[field] ?? 0) + increment;
    }
  };
  const tx = {
    $executeRaw: async () => 0,
    company: { findUnique: async () => null },
    companyAiConfiguration: { findUnique: async () => configRow },
    platformAiBudgetConfig: { findUnique: async () => null },
    aiBudgetReservation: reservationDelegate,
    companyAiMonthlyUsage: {
      findUnique: async () => ({ ...monthUsage }),
      upsert: async (args: any) => { applyIncrements(monthUsage, args.update); return { ...monthUsage }; },
    },
    companyAiMonthlyBucketUsage: {
      findUnique: async (args: any) => {
        const row = buckets.get(args.where.companyId_monthKey_bucket.bucket);
        return row ? { ...row } : null;
      },
      upsert: async (args: any) => {
        const bucket = args.where.companyId_monthKey_bucket.bucket;
        const row = buckets.get(bucket) ?? { costSatang: 0, callCount: 0 };
        applyIncrements(row as unknown as Record<string, number>, args.update);
        buckets.set(bucket, row);
        return { ...row };
      },
    },
    aiUsageEvent: {
      findUnique: async (args: any) => events.get(args.where.invocationKey) ?? null,
      create: async (args: any) => { events.set(args.data.invocationKey, args.data); return args.data; },
      // The unheld path. Keyed so an unenveloped row is still countable rather than invisible.
      createMany: async (args: any) => {
        for (const [index, row] of (args.data as any[]).entries()) {
          events.set(row.invocationKey ?? `unheld-${events.size}-${index}`, row);
        }
        return { count: args.data.length };
      },
    },
    ...extra,
  };
  const client = {
    ...tx,
    $transaction: async (fn: (t: any) => Promise<any>) => fn(tx),
  };
  return { prisma: { client } as any, reservations, events, buckets, monthUsage };
}
