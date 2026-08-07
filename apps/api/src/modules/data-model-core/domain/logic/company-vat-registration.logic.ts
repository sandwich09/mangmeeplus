// VAT registration facts as a dated interval history (spec §5.3, CC4 State/Command/Fact).
//
// The model that makes this correct: a company's VAT registration is not a boolean, it is a
// series of half-open intervals `[effectiveFrom, effectiveTo)` each carrying a binary status.
// "Not registered" and "we have never been told" are different answers, and only the first one
// is a fact — the accessor returns UNKNOWN for a date no fact covers, which is what stops the
// system inventing a registration status for a document it must refuse to issue.
//
// Pure functions: the caller loads the facts, decides the locked periods, and applies the plan.
import { addCivilDays, type CivilDate, type VatFactStatus, type VatRegistrationStatus } from '@watchdog-bms/contracts';

export type VatFactRow = {
  id: string;
  status: VatFactStatus;
  effectiveFrom: CivilDate;
  /** NULL = open-ended. */
  effectiveTo: CivilDate | null;
  /** Superseded rows stay for history and are invisible to the accessor. */
  supersededAt: Date | null;
  /**
   * When this answer was given. Optional so existing callers keep compiling, but supply it: it is
   * the tiebreak that makes the accessor deterministic when two live facts share a start date.
   */
  answeredAt?: Date | null;
};

/** A tax period the company has already filed, as civil dates, half-open like the facts. */
export type LockedPeriod = { from: CivilDate; to: CivilDate };

export type UpsertFactCommand = {
  kind: 'UPSERT_FACT';
  status: VatFactStatus;
  effectiveFrom: CivilDate;
  replaceFactId?: string | null;
};

export type CancelFutureCommand = { kind: 'CANCEL_FUTURE'; replaceFactId: string };

export type VatRegistrationCommand = UpsertFactCommand | CancelFutureCommand;

export type VatFactPlan =
  | { kind: 'NO_OP'; reason: string }
  | {
      kind: 'APPLY';
      /** Future facts this command replaces. */
      supersedeFactIds: string[];
      /** Existing fact whose interval now ends where the new one begins. */
      closeFact?: { id: string; effectiveTo: CivilDate };
      /** Existing fact restored to open-ended after a cancelled future fact. */
      reopenFactId?: string;
      insertFact?: { status: VatFactStatus; effectiveFrom: CivilDate };
    };

export type VatFactRejection = {
  code:
    | 'vat_registration_future_fact_conflict'
    | 'vat_registration_backdated_crosses_filed_period'
    | 'validation';
  reason: string;
};

/** The maximum a fact may be dated ahead — §5.3(5). A year of notice is already generous. */
const MAX_FUTURE_DAYS = 365;

/**
 * Total order over facts. The previous comparator returned 1 for equal start dates — an
 * inconsistent comparator, so `sort` left equal-start rows in an unspecified order and
 * `effectiveVatStatus` could answer REGISTERED or NOT_REGISTERED for the same data depending on
 * the order the rows arrived in. Ties now break on when the answer was given, then on id, so the
 * accessor is deterministic even for overlapping history the planner should never create.
 */
function compareFacts(a: VatFactRow, b: VatFactRow): number {
  if (a.effectiveFrom !== b.effectiveFrom) return a.effectiveFrom < b.effectiveFrom ? -1 : 1;
  const answeredA = a.answeredAt?.getTime() ?? 0;
  const answeredB = b.answeredAt?.getTime() ?? 0;
  if (answeredA !== answeredB) return answeredA - answeredB;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function live(facts: readonly VatFactRow[]): VatFactRow[] {
  return facts.filter((fact) => fact.supersededAt === null).sort(compareFacts);
}

/**
 * The authoritative read. UNKNOWN is not a failure mode — it is the honest answer when no fact
 * covers the date, and every caller must handle it rather than defaulting to "not registered".
 */
export function effectiveVatStatus(facts: readonly VatFactRow[], asOf: CivilDate): VatRegistrationStatus {
  const covering = live(facts).filter(
    (fact) => fact.effectiveFrom <= asOf && (fact.effectiveTo === null || asOf < fact.effectiveTo),
  );
  // Latest start wins if intervals ever overlap, and the latest answer wins among equal starts.
  // They should not overlap — the planner supersedes a same-date answer rather than stacking one —
  // but an accessor is not the place to throw over historical data.
  return covering.length === 0 ? 'UNKNOWN' : covering[covering.length - 1].status;
}

/** The fact covering `asOf`, or null. Used to close an interval at the new boundary. */
export function factCovering(facts: readonly VatFactRow[], asOf: CivilDate): VatFactRow | null {
  const covering = live(facts).filter(
    (fact) => fact.effectiveFrom <= asOf && (fact.effectiveTo === null || asOf < fact.effectiveTo),
  );
  return covering.length === 0 ? null : covering[covering.length - 1];
}

function futureFacts(facts: readonly VatFactRow[], today: CivilDate): VatFactRow[] {
  return live(facts).filter((fact) => fact.effectiveFrom > today);
}

/**
 * Turns a command plus the current fact history into the exact set of writes to perform, or a
 * rejection. Separated from persistence so the interval algebra is testable without a database
 * and so the caller can run it under the same lock that will apply it.
 */
export function planVatFactChange(
  command: VatRegistrationCommand,
  facts: readonly VatFactRow[],
  options: { today: CivilDate; lockedPeriods?: readonly LockedPeriod[] },
): VatFactPlan | VatFactRejection {
  const { today } = options;
  const pendingFuture = futureFacts(facts, today);

  if (command.kind === 'CANCEL_FUTURE') {
    return planCancelFuture(command, facts, pendingFuture);
  }

  if (command.effectiveFrom > addCivilDays(today, MAX_FUTURE_DAYS)) {
    return { code: 'validation', reason: `effectiveFrom must be within ${MAX_FUTURE_DAYS} days` };
  }

  // A pending future fact must be dealt with explicitly. Writing a second one silently would
  // leave two answers for the same future date with no record of which the user meant.
  if (pendingFuture.length > 0 && !command.replaceFactId) {
    return {
      code: 'vat_registration_future_fact_conflict',
      reason: 'a future-dated registration fact is pending; replace it explicitly or cancel it first',
    };
  }
  if (command.replaceFactId) {
    const latestFuture = pendingFuture[pendingFuture.length - 1];
    if (!latestFuture || latestFuture.id !== command.replaceFactId) {
      return { code: 'validation', reason: 'replaceFactId must point at the latest pending future fact' };
    }
  }

  const backdatedRejection = rejectIfCrossesFiledPeriod(command.effectiveFrom, facts, options.lockedPeriods ?? []);
  if (backdatedRejection) return backdatedRejection;

  const supersedeFactIds = command.replaceFactId ? [command.replaceFactId] : [];
  const remaining = facts.filter((fact) => !supersedeFactIds.includes(fact.id));
  const covering = factCovering(remaining, command.effectiveFrom);

  // §5.3(6): the same status continuing with no gap is not a new fact. Recording one would
  // fragment the history into intervals that describe no change.
  if (covering && covering.status === command.status && supersedeFactIds.length === 0) {
    return { kind: 'NO_OP', reason: 'the same status already covers this date without a gap' };
  }

  // §5.3(3) closes the covering fact at F. When it already STARTS at F, closing it would leave the
  // empty interval [F, F) — invisible to the accessor but still a live row, so `futureFacts` would
  // keep seeing it and reject the next answer with `vat_registration_future_fact_conflict` against
  // a fact nobody can reach. A same-date answer replaces its predecessor instead.
  const replacedSameDay = covering && covering.effectiveFrom === command.effectiveFrom ? covering.id : null;

  return {
    kind: 'APPLY',
    supersedeFactIds: replacedSameDay ? [...supersedeFactIds, replacedSameDay] : supersedeFactIds,
    closeFact:
      covering && covering.effectiveFrom < command.effectiveFrom
        ? { id: covering.id, effectiveTo: command.effectiveFrom }
        : undefined,
    insertFact: { status: command.status, effectiveFrom: command.effectiveFrom },
  };
}

function planCancelFuture(
  command: CancelFutureCommand,
  facts: readonly VatFactRow[],
  pendingFuture: readonly VatFactRow[],
): VatFactPlan | VatFactRejection {
  const latestFuture = pendingFuture[pendingFuture.length - 1];
  if (!latestFuture || latestFuture.id !== command.replaceFactId) {
    return { code: 'validation', reason: 'replaceFactId must point at the latest pending future fact' };
  }

  // Restoring the previous fact to open-ended is the whole job. Superseding the future fact and
  // stopping would leave the interval that was closed for it ending at a date that now means
  // nothing, and the accessor would answer UNKNOWN from that day on — a company would silently
  // stop being able to issue tax invoices because someone cancelled a future change.
  const previous = live(facts).filter(
    (fact) => fact.id !== latestFuture.id && fact.effectiveFrom < latestFuture.effectiveFrom,
  );
  const restored = previous[previous.length - 1];
  return {
    kind: 'APPLY',
    supersedeFactIds: [latestFuture.id],
    reopenFactId: restored && restored.effectiveTo === latestFuture.effectiveFrom ? restored.id : undefined,
  };
}

/**
 * §5.3(4). The affected range runs from the new boundary to the end of whatever it displaces —
 * changing the status from F onwards rewrites every filed period after F, not only the one F
 * falls in. Uses the periods the caller found; when `thai_tax` is off there are none, and the
 * absence of evidence is not evidence of a filing.
 */
function rejectIfCrossesFiledPeriod(
  effectiveFrom: CivilDate,
  facts: readonly VatFactRow[],
  lockedPeriods: readonly LockedPeriod[],
): VatFactRejection | null {
  const affected = lockedPeriods.filter((period) => period.to > effectiveFrom);
  if (affected.length === 0) return null;
  // Only a change that actually alters an already-answered stretch is blocked. A first-ever
  // fact dated inside a filed period is still refused, because that period was filed on the
  // assumption the status was whatever it was.
  const earliest = affected.reduce((a, b) => (a.from < b.from ? a : b));
  return {
    code: 'vat_registration_backdated_crosses_filed_period',
    reason: `changing the VAT status from ${effectiveFrom} would rewrite a filed tax period starting ${earliest.from}`,
  };
}

/** Mirror bit maintained on `Company.vatRegistered` at write time (§5.2). May lag by design. */
export function mirrorBitFor(facts: readonly VatFactRow[], today: CivilDate): boolean {
  return effectiveVatStatus(facts, today) === 'REGISTERED';
}
