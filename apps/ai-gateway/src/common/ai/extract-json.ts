/** Extracts a JSON object from a model response that may wrap it in prose or a ```json fence.
 *  Shared by every gateway agent/use-case that parses model output (line-ai, ai-draft, crm) —
 *  one hardening surface instead of four divergent copies. */
export function extractJson(text: string): string {
  const current = legacyExtract(text);
  if (parsesAsObject(current)
    && !/^,\s*"fields"\s*:\s*\{/.test(text.slice(text.indexOf('{') + current.length).trim())) return current;
  // tuning-6a (E1, eval run 5 malformedRouter): the legacy slice above only ever grabs from the
  // FIRST '{' to the LAST '}', so it overshoots whenever the current candidate fails to parse.
  // Try progressively more invasive repairs and return the first one that actually parses;
  // `current` is untouched above and returned unchanged below, so a caller that already handles a
  // parse failure keeps failing exactly the same way it does today.
  for (const escapeStrayQuotes of [false, true]) {
    const object = firstBalancedObject(text, escapeStrayQuotes);
    if (object === undefined) continue;
    const candidate = escapeControlCharsInStrings(object);
    if (parsesAsObject(candidate)) {
      // Receipt extraction sometimes closes the root after classification, then writes fields.
      // Rejoin only this shape, before the generic fallback discards the financial fields.
      const head = JSON.parse(candidate) as Record<string, unknown>;
      const tail = text.slice(text.indexOf('{') + object.length).trim().replace(/\s*```$/, '');
      if (Object.keys(head).length === 1 && head['classification']
        && /^,\s*"fields"\s*:\s*\{/.test(tail)) {
        const joined = escapeControlCharsInStrings(object.slice(0, -1) + tail);
        if (parsesAsObject(joined)) return joined;
        return candidate + tail; // A truncated financial sibling still needs the normal repair path.
      }
      return candidate;
    }
  }
  return current;
}

/** Today's original extraction, kept verbatim so its output stays byte-identical whenever it
 *  already parses — `extractJson` only reaches for the repairs below once this has failed. */
function legacyExtract(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return escapeControlCharsInStrings(fenced[1].trim());
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? escapeControlCharsInStrings(text.slice(start, end + 1)) : text;
}

function parsesAsObject(candidate: string): boolean {
  try { const value: unknown = JSON.parse(candidate); return !!value && typeof value === 'object' && !Array.isArray(value); }
  catch { return false; }
}

// The only characters valid JSON ever places right after a string closes: end of a value/array
// element (`,`/`}`/`]`) or end of a key (`:`).
const STRING_CLOSING_DELIMITERS = new Set([',', '}', ']', ':']);

/**
 * tuning-6a (E1a, run 5 malformedRouter: 6 of 8, e.g. "ใบเสร็จต้องเก็บไว้กี่ปีอ่ะคะ"): the model
 * closed its object one brace early (`…"answerText":"…"}}` where a single '}' was meant) and then
 * kept writing a trailing sibling field (`,"resolvedClarificationIds":[]}`) — the legacy
 * slice-to-LAST-'}' swallowed that trailing junk as if it were still part of the same object, so
 * the whole thing failed to parse. A string-aware scan that stops the instant bracket depth
 * returns to zero finds the model's actual (accidentally short) object and simply discards
 * whatever it wrote after — both router attempts failed this way for that same message, and the
 * customer waited 16s for "ขอโทษค่ะ น้องมั่งมียังไม่แน่ใจว่าหมายถึงอะไร…".
 *
 * tuning-6a (E1b, run 5 malformedRouter: 2 of 8, "หัก ณ ที่จ่ายคืออะไรครับ" / the delivery-note
 * question): the other two outputs typed a literal '"' as a Thai-style quotation mark INSIDE a
 * string value (`ผู้รับจะได้รับ "ใบรับรองการหัก ณ ที่จ่าย" ไว้เป็นหลักฐาน…`) instead of escaping
 * it, which a naive scan reads as the string closing early. `escapeStrayQuotes` re-runs the same
 * scan, but before accepting a '"' as a real close it peeks past optional whitespace: a genuine
 * closing quote is always followed by one of `, } ] :` — anything else means the model meant a
 * literal quote mark, so it is escaped in place and the string keeps going.
 */
function firstBalancedObject(text: string, escapeStrayQuotes: boolean): string | undefined {
  const start = text.indexOf('{');
  if (start < 0) return undefined;
  let depth = 0, inString = false, escapedNext = false, out = '';
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escapedNext) { escapedNext = false; out += ch; continue; }
      if (ch === '\\') { escapedNext = true; out += ch; continue; }
      if (ch === '"') {
        let lookahead = i + 1;
        while (lookahead < text.length && /\s/u.test(text[lookahead]!)) lookahead++;
        const closes = !escapeStrayQuotes || lookahead >= text.length || STRING_CLOSING_DELIMITERS.has(text[lookahead]!);
        out += closes ? '"' : '\\"';
        if (closes) inString = false;
        continue;
      }
      out += ch;
      continue;
    }
    // NAT06 (2026-09-29): a Thai-keyboard model once separated two array elements with a fullwidth comma
    // "，" — outside a string that is always the ASCII separator it meant.
    out += ch === '，' ? ',' : ch === '：' ? ':' : ch;
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') { depth--; if (depth === 0) return out; }
  }
  return undefined;
}

/**
 * The one malformation a chatty model produces on purpose: a multi-line "answerText" typed with real
 * newlines/tabs inside the string literal, which JSON forbids (UAT 2026-09-06: ROUTER_JSON_PARSE_FAILED
 * on a tutorial-shaped answer). Escape raw control characters that sit INSIDE a string literal and touch
 * nothing else. Valid JSON never contains one, so it passes through byte-identical; prose that merely
 * looks like JSON still fails to parse afterwards — a bounded repair, not a parser.
 */
function escapeControlCharsInStrings(json: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (const ch of json) {
    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      continue;
    }
    if (escaped) escaped = false;
    else if (ch === '\\') escaped = true;
    else if (ch === '"') inString = false;
    else if (ch < ' ') {
      out += ch === '\n' ? '\\n' : ch === '\r' ? '\\r' : ch === '\t' ? '\\t' : `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`;
      continue;
    }
    out += ch;
  }
  return out;
}
