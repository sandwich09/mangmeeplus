/**
 * CUST-05 — atomic per-channel daily auto-reply cap.
 * Reservation replaces the count-then-send race with a single CAS increment.
 */
export interface ICrmChannelCapRepository {
  /**
   * Atomically reserve one auto-reply against today's cap for a channel.
   * Returns true when the reservation succeeded (this send is under cap), false
   * when the cap is already reached. N concurrent callers against cap K yield
   * exactly K trues.
   */
  tryReserve(companyId: string, channelId: string, dayKey: string, cap: number): Promise<boolean>;
  /** Compensate a reserved-but-unsent auto-reply; decrement, floored at 0. */
  release(companyId: string, channelId: string, dayKey: string): Promise<void>;
}
