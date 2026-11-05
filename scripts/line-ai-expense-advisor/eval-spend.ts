import assert from 'node:assert/strict';
import { appendFileSync, closeSync, fsyncSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { assertIsolatedReplayDatabase } from '../line-ai-reliability-runtime';
import { providerCostExact } from './scorer';

export type EvalPgClient = { query(sql: string, values?: unknown[]): Promise<{ rows: Array<Record<string, any>> }> };
const spendSatang = (row: Record<string, any>) => {
  if (['RESERVED', 'DISPATCHED', 'UNRESOLVED'].includes(row.status)) return Number(row.upperBoundSatang);
  const evidence = row.evidenceJson ?? {};
  if (row.status === 'SETTLED' || evidence.reason === 'COMPANY_ABSORBED')
    return Number(evidence.customerChargedSatang ?? 0) + Number(evidence.companyAbsorbedSatang ?? evidence.absorbedCostSatang ?? 0) + 1;
  return 0;
};
const boundSatang = (value: string) => {
  assert.match(value, /^\d+(?:\.\d{1,2})?$/, 'MANGMEE_EVAL_MAX_THB_INVALID');
  const [baht, fraction = ''] = value.split('.');
  return BigInt(baht!) * 100n + BigInt(fraction.padEnd(2, '0'));
};

export async function installEvalGuard(client: EvalPgClient, databaseUrl: string, maxThb: string): Promise<void> {
  assertIsolatedReplayDatabase(databaseUrl);
  const maxSatang = boundSatang(maxThb);
  assert.ok(maxSatang > 0n && maxSatang <= BigInt(Number.MAX_SAFE_INTEGER), 'MANGMEE_EVAL_MAX_THB_INVALID');
  const expected = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  assert.equal((await client.query('SELECT current_database() AS name')).rows[0]?.name, expected, 'EVAL_GUARD_DATABASE_MISMATCH');
  await client.query(`CREATE SCHEMA IF NOT EXISTS eval_guard;
    CREATE TABLE IF NOT EXISTS eval_guard.settings (id boolean PRIMARY KEY DEFAULT true CHECK (id), max_satang bigint NOT NULL);
    CREATE TABLE IF NOT EXISTS eval_guard.ledger_satang (id boolean PRIMARY KEY DEFAULT true CHECK (id), amount bigint NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS eval_guard.captured (invocation_key text PRIMARY KEY);
    CREATE SEQUENCE IF NOT EXISTS eval_guard.cap_rejections;
    INSERT INTO eval_guard.ledger_satang (id, amount) VALUES (true, 0) ON CONFLICT (id) DO NOTHING;
    CREATE OR REPLACE FUNCTION eval_guard.enforce_run_cap() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE ledger bigint; existing bigint; cap bigint;
    BEGIN
      SELECT amount INTO ledger FROM eval_guard.ledger_satang WHERE id = true;
      SELECT max_satang INTO cap FROM eval_guard.settings WHERE id = true FOR UPDATE;
      SELECT COALESCE(SUM(CASE
        WHEN r."status" IN ('RESERVED','DISPATCHED','UNRESOLVED') THEN r."upperBoundSatang"
        WHEN r."status" = 'SETTLED' OR r."evidenceJson"->>'reason' = 'COMPANY_ABSORBED'
          THEN COALESCE((r."evidenceJson"->>'customerChargedSatang')::bigint, 0)
             + COALESCE((r."evidenceJson"->>'companyAbsorbedSatang')::bigint, (r."evidenceJson"->>'absorbedCostSatang')::bigint, 0) + 1
        ELSE 0 END), 0) INTO existing
        FROM public."AiBudgetReservation" r
        WHERE NOT EXISTS (SELECT 1 FROM eval_guard.captured c WHERE c.invocation_key = r."invocationKey");
      IF ledger + existing + NEW."upperBoundSatang" > cap THEN
        PERFORM nextval('eval_guard.cap_rejections');
        RAISE EXCEPTION 'EVAL_RUN_CAP' USING ERRCODE = 'P0001';
      END IF;
      RETURN NEW;
    END $$;
    DROP TRIGGER IF EXISTS eval_guard_before_reservation ON public."AiBudgetReservation";
    CREATE TRIGGER eval_guard_before_reservation BEFORE INSERT ON public."AiBudgetReservation"
      FOR EACH ROW EXECUTE FUNCTION eval_guard.enforce_run_cap();`);
  await client.query('INSERT INTO eval_guard.settings (id, max_satang) VALUES (true, $1) ON CONFLICT (id) DO UPDATE SET max_satang = EXCLUDED.max_satang', [String(maxSatang)]);
}

export async function capRejectionCount(client: EvalPgClient): Promise<string> {
  return String((await client.query("SELECT CASE WHEN is_called THEN last_value ELSE 0 END AS value FROM eval_guard.cap_rejections")).rows[0]?.value ?? '0');
}

export async function captureSpend(client: EvalPgClient, databaseUrl: string, spendPath: string, attemptId: string,
  scope: 'currentRun' | 'previousRun' = 'currentRun'): Promise<{ totalSatang: string; invocationKeys: string[] }> {
  assertIsolatedReplayDatabase(databaseUrl);
  const expected = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  assert.equal((await client.query('SELECT current_database() AS name')).rows[0]?.name, expected, 'EVAL_SPEND_DATABASE_MISMATCH');
  const [reservations, usage] = await Promise.all([
    client.query('SELECT "invocationKey", "sourceRoute", "stepKind", "status", "upperBoundSatang", "settledCostSatang", "usageBasis", "pricingSnapshot", "evidenceJson", "createdAt", "updatedAt" FROM public."AiBudgetReservation" ORDER BY "updatedAt"'),
    client.query('SELECT "invocationKey", "eventKind", "usageBasis", "pricingSnapshot", "createdAt" FROM public."AiUsageEvent" WHERE "invocationKey" IS NOT NULL ORDER BY "createdAt"'),
  ]);
  const latestUsage = new Map<string, Record<string, any>>();
  for (const event of usage.rows) latestUsage.set(event.invocationKey, event);
  const latest = new Map<string, Record<string, any>>();
  for (const row of reservations.rows) latest.set(row.invocationKey, row);
  const ledger = new Map<string, Record<string, any>>(readJsonLines<Record<string, any>>(spendPath).map(entry => [entry.invocationKey, entry]));
  const capturedAt = new Date().toISOString();
  const entries = [...latest.values()].map(row => {
    const prior = ledger.get(row.invocationKey);
    const evidence = row.evidenceJson ?? {}, pricing = row.pricingSnapshot ?? {}, usageRow = latestUsage.get(row.invocationKey);
    const tariff = pricing.tariff, tokens = { input: evidence.inputTokens, output: evidence.outputTokens,
      cacheRead: evidence.cacheReadInputTokens, cacheWrite: evidence.cacheWriteInputTokens };
    const measured = row.usageBasis === 'PROVIDER_REPORTED' || evidence.providerUsageBasis === 'PROVIDER_REPORTED';
    const exact = measured && tariff && Object.values(tokens).every(Number.isSafeInteger) && Number.isSafeInteger(evidence.externalUnits)
      ? providerCostExact({ tokens, externalUnits: evidence.externalUnits, tariff, recordedCostSatang: Number(row.settledCostSatang ?? evidence.absorbedCostSatang ?? 0) }) : null;
    return { attemptId: prior?.attemptId ?? attemptId, capturedAt, ...(prior?.scope === 'previousRun' || !prior && scope === 'previousRun' ? { scope: 'previousRun' } : {}),
      invocationKey: row.invocationKey, sourceRoute: row.sourceRoute, stepKind: row.stepKind,
      status: row.status, usageBasis: row.usageBasis ?? evidence.providerUsageBasis ?? null,
      upperBoundSatang: Number(row.upperBoundSatang), settledCostSatang: row.settledCostSatang,
      customerSatang: evidence.customerChargedSatang ?? null, companyAbsorbedSatang: evidence.companyAbsorbedSatang ?? evidence.absorbedCostSatang ?? null,
      providerCostExactSatang: exact?.exactSatang ?? null, roundingMatches: exact?.roundingMatches ?? null,
      providerCostBasis: measured ? 'measured' : ['RESERVED', 'DISPATCHED', 'UNRESOLVED'].includes(row.status) || row.usageBasis === 'OPERATOR_CHARGED_AT_BOUND' ? 'estimated' : 'unknown',
      ledgerSatang: spendSatang(row), tokens, externalUnits: evidence.externalUnits ?? null,
      usageEventKind: usageRow?.eventKind ?? null, usageEventBasis: usageRow?.usageBasis ?? null };
  }).filter(entry => {
    const prior = ledger.get(entry.invocationKey);
    return !prior || JSON.stringify({ ...prior, capturedAt: undefined }) !== JSON.stringify({ ...entry, capturedAt: undefined });
  });
  mkdirSync(dirname(spendPath), { recursive: true });
  if (entries.length) {
    const fd = openSync(spendPath, 'a');
    try { for (const entry of entries) appendFileSync(fd, `${JSON.stringify(entry)}\n`); fsyncSync(fd); } finally { closeSync(fd); }
  }
  for (const entry of entries) ledger.set(entry.invocationKey, entry);
  const keys = [...ledger.keys()];
  const total = [...ledger.values()].filter(row => row.scope !== 'previousRun').reduce((sum, row) => sum + BigInt(Math.trunc(row.ledgerSatang)), 0n);
  await client.query('UPDATE eval_guard.ledger_satang SET amount = $1 WHERE id = true', [String(total)]);
  for (const key of keys) await client.query('INSERT INTO eval_guard.captured(invocation_key) VALUES ($1) ON CONFLICT DO NOTHING', [key]);
  return { totalSatang: String(total), invocationKeys: keys };
}

export function readJsonLines<T>(path: string): T[] {
  try { return readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as T); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}

export function appendJsonLine(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(path, 'a');
  try { appendFileSync(fd, `${JSON.stringify(value)}\n`); fsyncSync(fd); } finally { closeSync(fd); }
}
