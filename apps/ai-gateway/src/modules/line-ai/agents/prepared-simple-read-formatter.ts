/**
 * Compiled deterministic formatters for the Phase-4 prepared simple-read lane (spec §6.2, plan Phase 5).
 *
 * This is the EXACT `${tool}::${answerShape}` allowlist of families that have a verified, model-free
 * grounded formatter. It is the source of truth for which reads may skip the model answer layer; the
 * operator env allowlist (`LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES`) can only NARROW this set, never add
 * an arbitrary family. With the env empty (default) `activePreparedFamilies` is empty and no read is
 * eligible, so the whole lane is dormant.
 *
 * A formatter reads ONLY the specialist's already-grounded output (facts + bounded toolData + as-of) and
 * returns a deterministic Thai/English answer with source reference, as-of state, and link — or
 * `unverified` when the output does not match the family's exact shape, so the caller falls back to an
 * honest terminal without claiming success. No provider, no tool re-invocation.
 */
import type { LineAiWebLink, SourceRef, SpecialistOutput } from '@watchdog-bms/contracts';
import { preparedFamilyKey } from '../domain/logic/prepared-simple-read.logic';

export type PreparedFormatResult =
  | { kind: 'answer'; replyText: string; sourceRefs: SourceRef[]; webLinks: LineAiWebLink[] }
  /** The output did not match this family's verified shape — do not claim success; caller stays honest. */
  | { kind: 'unverified' };

export type PreparedFormatContext = {
  language: string;
  locale: string;
  /** The VALIDATED proposed tool input (post-sanitizer, exact-equality checked). Its fromDate/toDate name
   *  the requested period so the answer is never period-ambiguous. Never authorization — DATA only. */
  proposedInput?: Record<string, unknown>;
};

const isEnglish = (ctx: PreparedFormatContext): boolean =>
  ctx.language.toLowerCase().startsWith('en') || (!/[฀-๿]/.test(ctx.language) && ctx.locale.toLowerCase().startsWith('en'));

/** Group the source thousands like the ERP does; leaves a non-numeric string untouched. */
function groupThousands(value: string): string {
  if (!/^-?\d+(\.\d+)?$/.test(value)) return value;
  const [intPart, frac] = value.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? `${grouped}.${frac}` : grouped;
}

function asOfLine(asOf: string | undefined, english: boolean): string {
  if (!asOf) return '';
  const day = asOf.slice(0, 10);
  return english ? `\nData as of ${day}` : `\nข้อมูล ณ ${day}`;
}

function rangePhrase(from: string | undefined, to: string | undefined): string | undefined {
  if (from && to) return from === to ? from : `${from} – ${to}`;
  return from ?? to;
}

/**
 * The period this metric covers — stated so the answer is never period-ambiguous. It PREFERS the validated
 * proposed input (the period the user requested and the server re-validated), then falls back to the tool's
 * own echoed effective period. It NEVER fabricates: when neither names a period, it returns '' and the reply
 * simply omits the period line rather than asserting a default the tool may not have used.
 */
function periodLine(proposedInput: Record<string, unknown> | undefined, data: Record<string, unknown> | undefined, english: boolean): string {
  const from = typeof proposedInput?.['fromDate'] === 'string' ? proposedInput['fromDate'] as string : undefined;
  const to = typeof proposedInput?.['toDate'] === 'string' ? proposedInput['toDate'] as string : undefined;
  let phrase = rangePhrase(from, to);
  if (!phrase) {
    const echoed = data?.['period'];
    if (typeof echoed === 'string' && echoed.trim()) phrase = echoed;
    else if (echoed && typeof echoed === 'object') {
      const e = echoed as Record<string, unknown>;
      phrase = rangePhrase(
        typeof e['fromDate'] === 'string' ? e['fromDate'] as string : undefined,
        typeof e['toDate'] === 'string' ? e['toDate'] as string : undefined,
      );
    }
  }
  if (!phrase) return '';
  return english ? `\nPeriod: ${phrase}` : `\nช่วง: ${phrase}`;
}

function sourceData(output: SpecialistOutput, tool: string): Record<string, unknown> | undefined {
  const entry = output.toolData?.find((d) => d.tool === tool);
  return entry && entry.data && typeof entry.data === 'object' && !Array.isArray(entry.data)
    ? (entry.data as Record<string, unknown>)
    : undefined;
}

/**
 * sales.get_sales_summary as a single revenue metric. Renders the total (grouped, honestly showing zero
 * as an explicit-empty period) plus the optional transaction count, with the specialist's permission-
 * checked source reference, the tool as-of, and the source link. Returns `unverified` if the total is
 * absent so the lane emits an honest terminal instead of a fabricated number.
 */
function formatSalesSummarySingleMetric(output: SpecialistOutput, ctx: PreparedFormatContext): PreparedFormatResult {
  const data = sourceData(output, 'sales.get_sales_summary');
  const total = data?.['totalSales'];
  if (total === undefined || total === null || (typeof total !== 'string' && typeof total !== 'number')) {
    return { kind: 'unverified' };
  }
  const english = isEnglish(ctx);
  const totalText = groupThousands(String(total));
  const basisIsCash = data?.['basis'] === 'recorded_received_payments';
  const count = data?.['transactionCount'];
  const hasCount = typeof count === 'number' || typeof count === 'string';

  const sourceRef = output.facts.find((fact) => fact.sourceRef)?.sourceRef;
  const sourceRefs = sourceRef ? [sourceRef] : [];
  const webLinks: LineAiWebLink[] = sourceRef?.webPath ? [{ label: sourceRef.label, path: sourceRef.webPath }] : [];

  const label = english ? (basisIsCash ? 'Actual received' : 'Sales') : (basisIsCash ? 'ยอดรับเงินจริง' : 'ยอดขาย');
  const amount = english ? `${totalText} THB` : `${totalText} บาท`;
  const countText = hasCount
    ? (english ? ` (${String(count)} transactions)` : ` (${String(count)} รายการ)`)
    : '';
  const sourceText = sourceRef
    ? (english ? `\nSource: ${sourceRef.label}` : `\nที่มา: ${sourceRef.label}`)
    : '';

  const replyText = `${label}: ${amount}${countText}${periodLine(ctx.proposedInput, data, english)}${sourceText}${asOfLine(output.asOf, english)}`;
  return { kind: 'answer', replyText, sourceRefs, webLinks };
}

/**
 * Authoritative deterministic terminal copy for a prepared read that did NOT reach a verified success —
 * an unavailable/error/failed source, or a success the compiled formatter could not verify. It states an
 * honest outcome with NO fabricated facts, numbers, source, or completion, and instantiates no composer /
 * router / critic / model. `PERMISSION_DENIED` (a post-plan state change) gets the forbidden line.
 */
export function preparedTerminalReply(output: SpecialistOutput, ctx: PreparedFormatContext): string {
  const english = isEnglish(ctx);
  if (output.status === 'PERMISSION_DENIED') {
    return english ? '🔒 You do not have permission to view this information.' : '🔒 คุณไม่มีสิทธิ์เข้าถึงข้อมูลนี้ค่ะ';
  }
  return english
    ? '⏳ This information is not available right now. Please check the web app.'
    : '⏳ ตอนนี้ยังดึงข้อมูลส่วนนี้ไม่ได้ กรุณาตรวจสอบในเว็บแอปนะคะ';
}

/** Exact compiled registry: `${tool}::${answerShape}` → formatter. Add one verified family at a time. */
const COMPILED_FORMATTERS: ReadonlyMap<string, (output: SpecialistOutput, ctx: PreparedFormatContext) => PreparedFormatResult> =
  new Map([
    [preparedFamilyKey('sales.get_sales_summary', 'single_metric'), formatSalesSummarySingleMetric],
  ]);

/** The exact set of families that have a compiled formatter (before operator narrowing). */
export const COMPILED_PREPARED_FAMILY_KEYS: ReadonlySet<string> = new Set(COMPILED_FORMATTERS.keys());

/**
 * Active families = the compiled registry NARROWED by the operator allowlist. An allowlist entry that
 * is not a compiled family is ignored (it can never activate an arbitrary family); an empty allowlist
 * (default) yields the empty set, so the lane is off.
 */
export function activePreparedFamilies(allowlist: readonly string[]): ReadonlySet<string> {
  const allowed = new Set(allowlist);
  return new Set([...COMPILED_PREPARED_FAMILY_KEYS].filter((key) => allowed.has(key)));
}

/** Format via the compiled family, or `unverified` when the family/shape has no formatter. */
export function formatPreparedSimpleRead(familyKey: string, output: SpecialistOutput, ctx: PreparedFormatContext): PreparedFormatResult {
  return (COMPILED_FORMATTERS.get(familyKey) ?? (() => ({ kind: 'unverified' as const })))(output, ctx);
}
