/** Extracts a JSON object from a model response that may wrap it in prose or a ```json fence.
 *  Shared by every gateway agent/use-case that parses model output (line-ai, ai-draft, crm) —
 *  one hardening surface instead of four divergent copies. */
export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return escapeControlCharsInStrings(fenced[1].trim());
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? escapeControlCharsInStrings(text.slice(start, end + 1)) : text;
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
