import { LEDGER_GROUP, type LedgerRedis } from './line-ai-ledger.service';

// Shared unit fixture (the `line-messaging-credentials.fixture.ts` precedent): the ledger spec owns
// the behaviour, the combined LINE-AI regression suite needs the same faithful fake, and a second
// copy of Redis Streams semantics would be the one thing guaranteed to drift.

/** Stream ids sort numerically, not lexicographically: '10-0' precedes '9-0' as a string. */
export function cmpId(a: string, b: string): number {
  const [aMs, aSeq] = a.split('-').map(Number);
  const [bMs, bSeq] = b.split('-').map(Number);
  return aMs - bMs || aSeq - bSeq;
}

// In-memory Redis Streams fake: only the surface the ledger uses (XADD MAXLEN, consumer group
// PEL semantics, XAUTOCLAIM idle/delivery counting, XRANGE/XPENDING/EXISTS/SCAN/EXPIRE).
//
// Faithful about the thing the UAT incident turned on: real Redis does NOT answer an empty list
// for a group that does not exist, it raises `NOGROUP No such key ... or consumer group ...`.
// The old fake returned `[]`, which is exactly why "a brand-new chat cannot start" passed CI.
export class FakeRedis implements LedgerRedis {
  nowMs = 1_000_000;
  streams = new Map<string, Array<{ id: string; fields: string[] }>>();
  pels = new Map<string, Map<string, { deliveryCount: number; lastDeliveryMs: number }>>();
  delivered = new Map<string, Set<string>>();
  ttls = new Map<string, number>();
  failing = false;
  /** Outage/protocol simulation hooks, each scoped to one shape of failure. */
  failExists = false;
  existsReply: number | undefined;
  wrongType = new Set<string>();
  malformedPending: unknown | undefined;
  failKeys = new Set<string>();
  /** Keys SCAN reports that no longer hold a stream — the expired-between-scan-and-claim race. */
  scanExtraKeys: string[] = [];
  /** Fires at the top of EXISTS, so a test can create the key/group between XPENDING and EXISTS. */
  beforeExists: (() => void) | undefined;
  calls: string[] = [];
  xpendingArgs: Array<{ key: string; start: string; count: number }> = [];
  private seq = 0;

  private assertUp(): void {
    if (this.failing) throw new Error('connection refused');
  }

  /** The PEL, or the error real Redis raises for a key/group that is not there. */
  private groupOrThrow(key: string, command: string): Map<string, { deliveryCount: number; lastDeliveryMs: number }> {
    const pel = this.pels.get(key);
    if (pel) return pel;
    throw new Error(`NOGROUP No such key '${key}' or consumer group '${LEDGER_GROUP}' in ${command} with GROUP option`);
  }

  /** TTL expiry: the stream and its group both vanish, exactly as an expired key does. */
  expireKey(key: string): void {
    this.streams.delete(key); this.pels.delete(key); this.delivered.delete(key); this.ttls.delete(key);
  }

  /** XGROUP DESTROY: the entries survive, the group does not. */
  destroyGroup(key: string): void {
    this.pels.delete(key); this.delivered.delete(key);
  }

  async xgroup(...args: Array<string | number>): Promise<unknown> {
    this.assertUp();
    const key = String(args[1]);
    this.calls.push('xgroup');
    if (this.pels.has(key)) throw new Error('BUSYGROUP Consumer Group name already exists');
    this.streams.set(key, this.streams.get(key) ?? []);
    this.pels.set(key, new Map());
    this.delivered.set(key, new Set());
    return 'OK';
  }

  async xadd(...args: Array<string | number>): Promise<string | null> {
    this.assertUp();
    const key = String(args[0]);
    const maxlen = Number(args[3]);
    const pairs = args.slice(5).map(String);
    const id = `${++this.seq}-0`;
    const stream = this.streams.get(key) ?? [];
    stream.push({ id, fields: pairs });
    while (stream.length > maxlen) {
      const dropped = stream.shift();
      if (dropped) {
        this.pels.get(key)?.delete(dropped.id);
        this.delivered.get(key)?.delete(dropped.id);
      }
    }
    this.streams.set(key, stream);
    return id;
  }

  async xreadgroup(...args: Array<string | number>): Promise<unknown> {
    this.assertUp();
    const key = String(args[6]);
    const pel = this.groupOrThrow(key, 'XREADGROUP');
    const stream = this.streams.get(key) ?? [];
    const seen = this.delivered.get(key) ?? new Set<string>();
    const fresh = stream.filter((e) => !seen.has(e.id));
    for (const entry of fresh) {
      seen.add(entry.id);
      pel.set(entry.id, { deliveryCount: 1, lastDeliveryMs: this.nowMs });
    }
    this.delivered.set(key, seen);
    this.pels.set(key, pel);
    return fresh.length > 0 ? [[key, fresh.map((e) => [e.id, e.fields])]] : null;
  }

  async xack(key: string, _group: string, id: string): Promise<number> {
    this.assertUp();
    return this.pels.get(key)?.delete(id) ? 1 : 0;
  }

  async xautoclaim(...args: Array<string | number>): Promise<unknown> {
    this.assertUp();
    const key = String(args[0]);
    this.calls.push(`xautoclaim:${key}`);
    if (this.failKeys.has(key)) throw new Error('connection refused');
    const minIdle = Number(args[3]);
    const count = Number(args[6]);
    const pel = this.groupOrThrow(key, 'XAUTOCLAIM');
    const stream = this.streams.get(key) ?? [];
    const claimed: Array<[string, string[]]> = [];
    for (const [id, meta] of pel) {
      if (claimed.length >= count) break;
      if (this.nowMs - meta.lastDeliveryMs < minIdle) continue;
      meta.deliveryCount += 1;
      meta.lastDeliveryMs = this.nowMs;
      const entry = stream.find((e) => e.id === id);
      if (entry) claimed.push([entry.id, entry.fields]);
    }
    return ['0-0', claimed, []];
  }

  async xrange(key: string, start: string, end: string): Promise<Array<[string, string[]]>> {
    this.assertUp();
    const stream = this.streams.get(key) ?? [];
    return stream
      .filter((e) => (start === '-' || cmpId(e.id, start) >= 0) && (end === '+' || cmpId(e.id, end) <= 0))
      .map((e) => [e.id, e.fields]);
  }

  /** `XPENDING key group <start> + <count>`, with the Redis 6.2 exclusive `(<id>` start form. */
  async xpending(...args: Array<string | number>): Promise<unknown> {
    this.assertUp();
    const key = String(args[0]);
    const start = String(args[2]);
    const count = Number(args[4]);
    this.calls.push('xpending');
    this.xpendingArgs.push({ key, start, count });
    if (this.wrongType.has(key)) throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    if (this.failKeys.has(key)) throw new Error('connection refused');
    const pel = this.groupOrThrow(key, 'XPENDING');
    if (this.malformedPending !== undefined) return this.malformedPending;
    const exclusive = start.startsWith('(');
    const from = exclusive ? start.slice(1) : start;
    return [...pel.entries()]
      .sort(([a], [b]) => cmpId(a, b))
      .filter(([id]) => from === '-' || (exclusive ? cmpId(id, from) > 0 : cmpId(id, from) >= 0))
      .slice(0, count)
      .map(([id, meta]) => [id, 'consumer', this.nowMs - meta.lastDeliveryMs, meta.deliveryCount]);
  }

  async exists(key: string): Promise<number> {
    this.calls.push('exists');
    this.beforeExists?.();
    this.assertUp();
    if (this.failExists) throw new Error('connection refused');
    if (this.existsReply !== undefined) return this.existsReply;
    return this.streams.has(key) ? 1 : 0;
  }

  async expire(key: string, seconds: number): Promise<number> {
    this.assertUp();
    this.ttls.set(key, seconds);
    return 1;
  }

  async scan(_cursor: string, ...args: Array<string | number>): Promise<[string, string[]]> {
    this.assertUp();
    const pattern = String(args[1]).replace('*', '');
    return ['0', [...this.streams.keys(), ...this.scanExtraKeys].filter((k) => k.startsWith(pattern))];
  }

  async quit(): Promise<unknown> { return 'OK'; }
}
