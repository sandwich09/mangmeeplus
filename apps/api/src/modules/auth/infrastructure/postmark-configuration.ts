type IdentityCheck = 'MATCHED' | 'MISMATCH' | 'UNKNOWN';
export type PostmarkConfigurationFacts = {
  server: IdentityCheck;
  stream: IdentityCheck;
  mode: 'LIVE' | 'SANDBOX' | 'UNKNOWN';
  transactional: boolean | null;
  archived: boolean | null;
};

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Native /server includes API tokens: return only facts bound to the configured identities. */
export function postmarkConfigurationFacts(expected: { serverId: number; stream: string }, server: unknown, stream: unknown): PostmarkConfigurationFacts {
  const facts: PostmarkConfigurationFacts = { server: 'UNKNOWN', stream: 'UNKNOWN', mode: 'UNKNOWN', transactional: null, archived: null };
  if (!Number.isSafeInteger(expected.serverId) || expected.serverId <= 0 || typeof expected.stream !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(expected.stream)) return facts;
  const s = record(server), m = record(stream);
  if (typeof s.ID !== 'number' || !Number.isSafeInteger(s.ID) || s.ID <= 0) return facts;
  facts.server = s.ID === expected.serverId ? 'MATCHED' : 'MISMATCH';
  if (facts.server !== 'MATCHED') return facts;
  facts.mode = s.DeliveryType === 'Live' ? 'LIVE' : s.DeliveryType === 'Sandbox' ? 'SANDBOX' : 'UNKNOWN';
  if (typeof m.ServerID !== 'number' || !Number.isSafeInteger(m.ServerID) || m.ServerID <= 0 ||
      typeof m.ID !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(m.ID)) return facts;
  facts.stream = m.ServerID === expected.serverId && m.ID === expected.stream ? 'MATCHED' : 'MISMATCH';
  if (facts.stream !== 'MATCHED') return facts;
  facts.transactional = m.MessageStreamType === 'Transactional' ? true :
    m.MessageStreamType === 'Inbound' || m.MessageStreamType === 'Broadcasts' ? false : null;
  facts.archived = m.ArchivedAt === null ? false :
    typeof m.ArchivedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(m.ArchivedAt) && Number.isFinite(Date.parse(m.ArchivedAt)) ? true : null;
  return facts;
}
