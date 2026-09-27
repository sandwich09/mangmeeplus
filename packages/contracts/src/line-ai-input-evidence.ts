/** Complete, provenance preserving LINE input evidence shared by API, Gateway and AgentCore. */
export const LINE_AI_INPUT_EVIDENCE_LIMITS = {
  version: 2,
  maxParts: 20,
  maxUtf16Units: 12_000,
  maxUtf8Bytes: 48_000,
  maxIdChars: 128,
  normalizationVersion: 'lookup-v2',
} as const;

export type LineAiInputPartV2 = {
  partId: string;
  eventIdHash: string;
  acceptedAtMs: number;
  rawText: string;
  rawSha256: string;
};

export type LineAiInputEvidenceV2 = {
  version: 2;
  turnKey: string;
  parts: LineAiInputPartV2[];
  joinedSha256: string;
  complete: true;
  utf16Units: number;
  utf8Bytes: number;
  normalizationVersion: 'lookup-v2';
};

export type LineAiSourceRefV2 = {
  partId: string;
  startUtf16: number;
  endUtf16: number;
  rawSha256: string;
};

const HASH = /^[0-9a-f]{64}$/u;
const ID = /^[\x21-\x7e]{1,128}$/u;
const EVIDENCE_KEYS = new Set(['version', 'turnKey', 'parts', 'joinedSha256', 'complete', 'utf16Units', 'utf8Bytes', 'normalizationVersion']);
const PART_KEYS = new Set(['partId', 'eventIdHash', 'acceptedAtMs', 'rawText', 'rawSha256']);
const SOURCE_REF_KEYS = new Set(['partId', 'startUtf16', 'endUtf16', 'rawSha256']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function wellFormedText(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const unit = value.charCodeAt(i);
    if (unit <= 0x1f && unit !== 0x09 && unit !== 0x0a && unit !== 0x0d) return false;
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}

/** Strict structural/bounds parse. Receivers must also call verifyLineAiInputEvidence to check hashes. */
export function parseLineAiInputEvidence(value: unknown, messageText: string): LineAiInputEvidenceV2 | undefined {
  if (!isPlainObject(value)
    || Object.keys(value).some((key) => !EVIDENCE_KEYS.has(key))
    || value['version'] !== 2
    || value['complete'] !== true
    || value['normalizationVersion'] !== LINE_AI_INPUT_EVIDENCE_LIMITS.normalizationVersion
    || typeof value['turnKey'] !== 'string' || !ID.test(value['turnKey'])
    || !Array.isArray(value['parts']) || value['parts'].length < 1
    || value['parts'].length > LINE_AI_INPUT_EVIDENCE_LIMITS.maxParts
    || typeof messageText !== 'string') return undefined;

  const seen = new Set<string>();
  const parts: LineAiInputPartV2[] = [];
  for (const item of value['parts']) {
    if (!isPlainObject(item)
      || Object.keys(item).some((key) => !PART_KEYS.has(key))
      || typeof item['partId'] !== 'string' || !ID.test(item['partId']) || seen.has(item['partId'])
      || typeof item['eventIdHash'] !== 'string' || !HASH.test(item['eventIdHash'])
      || !Number.isSafeInteger(item['acceptedAtMs']) || Number(item['acceptedAtMs']) < 0
      || typeof item['rawText'] !== 'string' || !wellFormedText(item['rawText'])
      || typeof item['rawSha256'] !== 'string' || !HASH.test(item['rawSha256'])) return undefined;
    seen.add(item['partId']);
    parts.push({
      partId: item['partId'], eventIdHash: item['eventIdHash'], acceptedAtMs: Number(item['acceptedAtMs']),
      rawText: item['rawText'], rawSha256: item['rawSha256'],
    });
  }

  const joined = parts.map((part) => part.rawText).join('\n');
  const utf16Units = parts.reduce((sum, part) => sum + part.rawText.length, 0) + parts.length - 1;
  const utf8Bytes = new TextEncoder().encode(joined).byteLength;
  if (joined !== messageText
    || value['joinedSha256'] !== undefined && (typeof value['joinedSha256'] !== 'string' || !HASH.test(value['joinedSha256']))
    || !Number.isSafeInteger(value['utf16Units']) || value['utf16Units'] !== utf16Units
    || !Number.isSafeInteger(value['utf8Bytes']) || value['utf8Bytes'] !== utf8Bytes
    || utf16Units > LINE_AI_INPUT_EVIDENCE_LIMITS.maxUtf16Units
    || utf8Bytes > LINE_AI_INPUT_EVIDENCE_LIMITS.maxUtf8Bytes
    || typeof value['joinedSha256'] !== 'string' || !HASH.test(value['joinedSha256'])) return undefined;

  return {
    version: 2,
    turnKey: value['turnKey'],
    parts,
    joinedSha256: value['joinedSha256'],
    complete: true,
    utf16Units,
    utf8Bytes,
    normalizationVersion: 'lookup-v2',
  };
}

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Recompute every source and joined digest before a v2 input can cross a process boundary. */
export async function verifyLineAiInputEvidence(value: unknown, messageText: string): Promise<LineAiInputEvidenceV2 | undefined> {
  const parsed = parseLineAiInputEvidence(value, messageText);
  if (!parsed) return undefined;
  for (const part of parsed.parts) if (await sha256(part.rawText) !== part.rawSha256) return undefined;
  if (await sha256(parsed.parts.map((part) => part.rawText).join('\n')) !== parsed.joinedSha256) return undefined;
  return parsed;
}

/** Build evidence from the server's already ordered, deduplicated webhook parts. */
export async function createLineAiInputEvidence(input: {
  turnKey: string;
  parts: Array<Omit<LineAiInputPartV2, 'rawSha256'>>;
}): Promise<{ messageText: string; inputEvidence: LineAiInputEvidenceV2 } | undefined> {
  if (!ID.test(input.turnKey) || input.parts.length === 0 || input.parts.length > LINE_AI_INPUT_EVIDENCE_LIMITS.maxParts) return undefined;
  const parts: LineAiInputPartV2[] = [];
  const seen = new Set<string>();
  for (const part of input.parts) {
    if (!ID.test(part.partId) || seen.has(part.partId) || !HASH.test(part.eventIdHash) || !Number.isSafeInteger(part.acceptedAtMs)
      || part.acceptedAtMs < 0 || !wellFormedText(part.rawText)) return undefined;
    seen.add(part.partId);
    parts.push({ ...part, rawSha256: await sha256(part.rawText) });
  }
  const messageText = parts.map((part) => part.rawText).join('\n');
  const utf16Units = messageText.length;
  const utf8Bytes = new TextEncoder().encode(messageText).byteLength;
  if (utf16Units > LINE_AI_INPUT_EVIDENCE_LIMITS.maxUtf16Units || utf8Bytes > LINE_AI_INPUT_EVIDENCE_LIMITS.maxUtf8Bytes) return undefined;
  return {
    messageText,
    inputEvidence: {
      version: 2, turnKey: input.turnKey, parts, joinedSha256: await sha256(messageText),
      complete: true, utf16Units, utf8Bytes, normalizationVersion: 'lookup-v2',
    },
  };
}

/** Exact original-substring check; offsets are UTF-16 and cannot bisect a surrogate pair. */
export function validateLineAiSourceRefV2(ref: unknown, evidence: LineAiInputEvidenceV2): string | undefined {
  if (!isPlainObject(ref) || Object.keys(ref).some((key) => !SOURCE_REF_KEYS.has(key)) || typeof ref['partId'] !== 'string'
    || !Number.isSafeInteger(ref['startUtf16']) || !Number.isSafeInteger(ref['endUtf16'])
    || typeof ref['rawSha256'] !== 'string' || !HASH.test(ref['rawSha256'])) return undefined;
  const part = evidence.parts.find((candidate) => candidate.partId === ref['partId']);
  const start = Number(ref['startUtf16']);
  const end = Number(ref['endUtf16']);
  if (!part || part.rawSha256 !== ref['rawSha256'] || start < 0 || end <= start || end > part.rawText.length) return undefined;
  const boundary = (offset: number) => offset === 0 || offset === part.rawText.length
    || !(part.rawText.charCodeAt(offset - 1) >= 0xd800 && part.rawText.charCodeAt(offset - 1) <= 0xdbff
      && part.rawText.charCodeAt(offset) >= 0xdc00 && part.rawText.charCodeAt(offset) <= 0xdfff);
  return boundary(start) && boundary(end) ? part.rawText.slice(start, end) : undefined;
}
