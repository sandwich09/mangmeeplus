import { civilDate, civilDateToUtcDate, type CivilDate } from '@watchdog-bms/contracts';

/**
 * Advisor spec §5.1 formula `package-pace-v1` (owner decision 2026-09-30, §10 item 4b): a straight-line
 * projection of this cycle's receipt reads to the cycle's end, computed here so an answer can say
 * "likely enough" or "short by about N" without doing arithmetic of its own. Bangkok civil days;
 * `endOn` is exclusive — the day a monthly allowance resets, or the day a paid period ends.
 */
export const PACKAGE_PACE_FORMULA = 'package-pace-v1';
/** Fewer days of use than this is too little to extrapolate a whole cycle from. */
export const PACKAGE_PACE_MIN_DAYS = 7;

export type PackagePace = {
  formula: typeof PACKAGE_PACE_FORMULA;
  projectedUsed: number;
  projectedShortfall: number;
  daysElapsed: number;
  daysLeft: number;
  daysInPeriod: number;
};

const dayCount = (from: CivilDate, to: CivilDate) =>
  Math.round((civilDateToUtcDate(to).getTime() - civilDateToUtcDate(from).getTime()) / 86_400_000);

export function packagePace(input: { used: number; limit: number | null; startOn: CivilDate; endOn: CivilDate; today: CivilDate }):
  PackagePace | 'unlimited' | 'too_early' {
  if (input.limit === null) return 'unlimited';
  const daysInPeriod = dayCount(input.startOn, input.endOn);
  // Today counts as a day of use; the last day of a cycle projects exactly what was used.
  const daysElapsed = Math.min(daysInPeriod, dayCount(input.startOn, input.today) + 1);
  if (daysElapsed < PACKAGE_PACE_MIN_DAYS) return 'too_early';
  const projectedUsed = Math.ceil((input.used * daysInPeriod) / daysElapsed);
  return { formula: PACKAGE_PACE_FORMULA, projectedUsed, projectedShortfall: Math.max(0, projectedUsed - input.limit),
    daysElapsed, daysLeft: daysInPeriod - daysElapsed, daysInPeriod };
}

/** The one paid period every visible package lot shares; null when lots from different periods overlap
 *  (a carried-over or upgraded lot, a team gift), since one cycle's rate then says nothing clear. */
export function singlePaidCycle(lots: ReadonlyArray<{ serviceStart: Date; serviceEnd: Date }>): { startOn: CivilDate; endOn: CivilDate } | null {
  const windows = new Set(lots.map((lot) => `${lot.serviceStart.getTime()}|${lot.serviceEnd.getTime()}`));
  if (windows.size !== 1) return null;
  const [start, end] = [...windows][0]!.split('|').map(Number);
  return { startOn: civilDate(new Date(start!)), endOn: civilDate(new Date(end!)) };
}
