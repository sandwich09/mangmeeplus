/**
 * Spec support: an in-memory stand-in for the two payout tables, shaped like the Prisma delegates
 * `reimbursement-payout.ts` calls. Use-case specs run the real payout functions over it, so they
 * exercise the same code as production instead of a hand-written imitation of it.
 *
 * It keeps the two database rules that matter to those specs: one row per (claim, version), and a
 * frozen version whose account can no longer change (the migration's trigger).
 */
const ATTESTATION_COLUMNS = new Set(['verifiedByUserId', 'verifiedAt', 'verifiedVia', 'approvalStepId']);

function matches(row: Record<string, unknown>, where: Record<string, unknown> = {}): boolean {
  return Object.entries(where).every(([column, expected]) => {
    const actual = row[column] ?? null;
    if (expected && typeof expected === 'object' && !(expected instanceof Date) && 'not' in expected) {
      return actual !== ((expected as { not: unknown }).not ?? null);
    }
    return actual === (expected ?? null);
  });
}

function pick(row: Record<string, unknown>, select?: Record<string, boolean>): any {
  return select ? Object.fromEntries(Object.keys(select).map((column) => [column, row[column] ?? null])) : { ...row };
}

export function fakePayoutTables() {
  const accounts: Record<string, any>[] = [];
  const destinations: Record<string, any>[] = [];

  /** The frozen-snapshot trigger: after `frozenAt` is set, only the attestation columns may change. */
  function change(row: Record<string, any>, data: Record<string, unknown>): void {
    if (row.frozenAt && Object.entries(data).some(([column, value]) => !ATTESTATION_COLUMNS.has(column) && (row[column] ?? null) !== (value ?? null))) {
      throw new Error('reimbursement_payout_destination_frozen');
    }
    Object.assign(row, data);
  }

  const client = {
    // `SELECT … FOR UPDATE` on the default account: nothing runs concurrently in memory.
    $queryRaw: async () => [],
    memberPayoutAccount: {
      findFirst: async ({ where, select }: any) => {
        const row = accounts.find((candidate) => matches(candidate, where));
        return row ? pick(row, select) : null;
      },
      upsert: async ({ where, create, update, select }: any) => {
        const row = accounts.find((candidate) => matches(candidate, where.companyId_userId));
        if (!row) {
          const created = { version: 1, updatedAt: new Date(), ...create };
          accounts.push(created);
          return pick(created, select);
        }
        const { version, ...columns } = update;
        Object.assign(row, columns, { version: row.version + (version?.increment ?? 0), updatedAt: new Date() });
        return pick(row, select);
      },
      deleteMany: async ({ where }: any) => {
        const kept = accounts.filter((row) => !matches(row, where));
        const count = accounts.length - kept.length;
        accounts.splice(0, accounts.length, ...kept);
        return { count };
      },
    },
    reimbursementPayoutDestination: {
      findFirst: async ({ where, select }: any) => {
        const row = destinations.find((candidate) => matches(candidate, where));
        return row ? pick(row, select) : null;
      },
      findMany: async ({ where, select }: any) => destinations
        .filter((row) => matches(row, where))
        .sort((a, b) => b.version - a.version)
        .map((row) => pick(row, select)),
      create: async ({ data }: any) => {
        if (destinations.some((row) => row.reimbursementRequestId === data.reimbursementRequestId && row.version === data.version)) {
          throw new Error('ReimbursementPayoutDestination_request_version_key');
        }
        const row = { id: `destination-${destinations.length + 1}`, frozenAt: null, ...data };
        destinations.push(row);
        return { ...row };
      },
      update: async ({ where, data }: any) => {
        const row = destinations.find((candidate) => matches(candidate, where));
        if (!row) throw new Error('payout destination not found');
        change(row, data);
        return { ...row };
      },
      updateMany: async ({ where, data }: any) => {
        const rows = destinations.filter((row) => matches(row, where));
        for (const row of rows) change(row, data);
        return { count: rows.length };
      },
      deleteMany: async ({ where }: any) => {
        const kept = destinations.filter((row) => !matches(row, where));
        const count = destinations.length - kept.length;
        destinations.splice(0, destinations.length, ...kept);
        return { count };
      },
    },
  };
  return { accounts, destinations, client };
}
