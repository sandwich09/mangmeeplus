import { createHash } from 'node:crypto';
import { publicSourceUrl, type PublicLookupResult, type PublicLookupSourcePolicy } from '@watchdog-bms/contracts';

type Citation = { type?: string; url?: unknown; title?: unknown; start_index?: unknown; end_index?: unknown };
type SearchItem = { type?: string; status?: string; action?: { type?: string; url?: unknown; sources?: Array<{ url?: unknown }> };
  content?: Array<{ type?: string; text?: string; annotations?: Citation[] }> };
export type PublicSearchResponse = { status?: string; output?: SearchItem[] };

/** Count only actual returned hosted operations. An incomplete/unreported response cannot prove
 * zero external cost. No retries or separate fetches are performed by this normalizer. */
export function publicLookupExternalUnits(body: PublicSearchResponse): number | null {
  if (body.status !== 'completed' || !Array.isArray(body.output)) return null;
  const calls = body.output.filter(item => item.type === 'web_search_call');
  return calls.length && calls.every(item => item.status === 'completed' && ['search', 'open_page', 'find_in_page'].includes(item.action?.type ?? ''))
    ? calls.length : null;
}

export function normalizePublicLookupOutput(body: PublicSearchResponse, policy: PublicLookupSourcePolicy, now = new Date()): PublicLookupResult {
  const externalUnits = publicLookupExternalUnits(body), asOf = now.toISOString();
  const unavailable = (errorCode: PublicLookupResult['errorCode']): PublicLookupResult => ({ status: 'unavailable', sources: [], claims: [], asOf, externalUnits, errorCode });
  if (externalUnits !== null && externalUnits > 2) return unavailable('PUBLIC_LOOKUP_LIMIT_EXCEEDED');
  if (body.status !== 'completed' || externalUnits === null) return unavailable('PUBLIC_LOOKUP_UNAVAILABLE');
  const actionUrls = new Set<string>();
  for (const item of body.output ?? []) {
    if (item.type !== 'web_search_call') continue;
    for (const candidate of [item.action?.url, ...(item.action?.sources ?? []).map(source => source.url)]) {
      const url = publicSourceUrl(candidate, policy); if (url) actionUrls.add(url);
    }
  }
  const sources: PublicLookupResult['sources'] = [], claims: PublicLookupResult['claims'] = [];
  let partial = false, reportsConflict = false;
  for (const content of (body.output ?? []).filter(item => item.type === 'message').flatMap(item => item.content ?? [])) {
    if (content.type !== 'output_text' || typeof content.text !== 'string') continue;
    const text = content.text;
    for (const paragraph of text.matchAll(/[^\r\n]+/gu)) {
      const start = paragraph.index!, end = start + paragraph[0].length, claimText = paragraph[0].trim();
      if (!claimText) continue;
      if (claimText === '[PUBLIC_SOURCE_CONFLICT]') { reportsConflict = true; continue; }
      const citations = (content.annotations ?? []).filter(citation => citation.type === 'url_citation'
        && Number.isSafeInteger(citation.start_index) && Number.isSafeInteger(citation.end_index)
        && Number(citation.start_index) >= start && Number(citation.end_index) <= end && Number(citation.end_index) > Number(citation.start_index));
      const sourceIds: string[] = [];
      for (const citation of citations) {
        const url = publicSourceUrl(citation.url, policy);
        if (!url || !actionUrls.has(url) || typeof citation.title !== 'string' || !citation.title.trim() || citation.title.length > 300) { partial = true; continue; }
        if (sources.length >= 5 || claimText.length > 4000) { partial = true; continue; }
        const id = `public-${sources.length + 1}`;
        sources.push({ id, url, title: citation.title, publisher: new URL(url).hostname, retrievedAt: asOf,
          supportingText: claimText, contentHash: createHash('sha256').update(`${url}\n${claimText}`).digest('hex') });
        sourceIds.push(id);
      }
      if (!sourceIds.length) { partial = true; continue; }
      if (claims.length >= 5) { partial = true; continue; }
      claims.push({ text: claimText, sourceIds });
    }
  }
  if (!claims.length) return unavailable('UNVERIFIED_SOURCE');
  // We preserve explicit conflict wording as evidence; do not infer the absence of disagreement
  // from an uncited statement. The composer may explain conflicting cited paragraphs.
  const conflict = reportsConflict && new Set(sources.map(source => source.url)).size >= 2;
  return { status: conflict ? 'conflict' : partial || reportsConflict ? 'partial' : 'verified', claims, sources, asOf, externalUnits };
}
