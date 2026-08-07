/** Extracts a JSON object from a model response that may wrap it in prose or a ```json fence.
 *  Shared by every gateway agent/use-case that parses model output (line-ai, ai-draft, crm) —
 *  one hardening surface instead of four divergent copies. */
export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}
