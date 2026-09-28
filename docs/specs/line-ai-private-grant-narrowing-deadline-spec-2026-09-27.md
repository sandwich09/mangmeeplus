# LINE AI private grant narrowing deadline

Status: approved for scoped implementation
Date: 2026-09-27
Parent contracts: [Input/provider/budget contract](mangmee-ai-input-provider-budget-contract-2026-09-27.md) and [understanding/reliability spec](mangmee-ai-understanding-and-advisor-reliability-spec-th.md)

## Problem

A private text turn receives one signed pre-classification envelope that permits intake within the admitted maximum. After the paid intake classifies the request, `narrow` currently recomputes a shorter absolute lane deadline from the original `admittedAt`. In observed NAT09 turns, the only intake call completed at 7.084–8.016 seconds and had no retry. General narrowing then rewrote the work deadline to accepted plus 7 seconds and refused before the permitted answer call, although the original admitted envelope still had work time.

This is an authority-narrowing failure, not a model-quality, provider, permission, quota, or delivery failure.

## Required behavior

1. Narrowing a private admitted grant preserves the authenticated durable authority row's exact `admittedAtMs`, `workDeadlineAtMs`, and `finalDeadlineAtMs`. The observed single-text envelope is 40 seconds final and 37 seconds work; coalescing, media, direct public-general, and QA envelopes retain exactly the values issued for their own contracts.
2. Narrowing changes only the permitted profiles, maximum global slots for the selected lane, durable `nextOrdinal`, and the signature over the new grant. General/simple retain two total slots; mixed/public retain four. Profile calls, token ceilings, one shared repair, priced rendered bounds, tariff, money holds, model, owner, input, and counters do not widen or reset.
3. The durable row is the deadline authority. The service authenticates its stored grant and derives the narrowed grant from that stored object. A caller cannot alter deadlines, reuse an old signature, or rely on matching nonce text to extend authority.
4. The same lane/profile retry returns the same persisted narrowed grant while its stored work deadline remains open. A changed lane/profile is refused. At the stored work deadline, first narrowing and idempotent replay both refuse; no retry calculates a new deadline.
5. The original broader grant becomes unspendable as soon as the narrowed signature is persisted. Reservation order, cost evidence, unresolved provider calls, owner/lifecycle checks, and CAS fencing remain unchanged.
6. When narrowing refuses specifically because the authenticated durable work deadline elapsed, the webhook records `DEADLINE_EXCEEDED` with the existing timeout response. Other narrowing refusal causes keep their existing admission/budget-unavailable result.

## Deadline interpretation

For private turns that require paid semantic intake before lane selection, general 10 seconds, simple 15 seconds, and mixed 30 seconds remain latency objectives and diagnostic miss thresholds. They are not recomputed hard cutoffs after intake. The already-issued admitted envelope is the immutable hard cutoff and retains the existing three-second delivery reserve.

Directly issued `PUBLIC_GENERAL` remains on its existing 10-second final / 7-second work envelope because it does not run this private narrowing transition. Document QA transfer and its fixed foreground/job deadlines are unchanged.

## Acceptance

- Narrowing just before and just after accepted plus 7 seconds succeeds when the stored original work deadline remains open and preserves both stored deadline fields exactly.
- General, simple, and mixed narrowing changes only profiles, slots, cursor, and signature; no `now + lane budget` value appears.
- Repeating the same narrowing returns the exact persisted grant; a changed lane/profile and an expired stored grant refuse.
- A grant object with altered deadline fields and a reused signature cannot authenticate or change the durable envelope.
- Intake ordinal 0 and answer ordinal 1 still produce exactly two reservations/usage rows, with shared repair and money counters unchanged. The old broad grant cannot spend ordinal 1.
- The webhook distinguishes authoritative deadline expiry from other narrowing failures without starting a provider/tool call.

## Scope

This repair covers the supported private expense/general Starter flow. It does not activate advisor, report, sales, public lookup, a new model, a new profile, extra calls, package entitlements, or longer authority than was already issued. It adds no schema, flag, dependency, service, or retry state.
