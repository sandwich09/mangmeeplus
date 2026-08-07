const SECRET_FIELD_PATTERNS = [
  /token/i, /secret/i, /password/i, /credential/i, /apikey/i, /api_key/i,
  /signed_url/i, /signedUrl/i, /objectKey/i, /object_key/i, /access_key/i,
];

export function redactOutboxPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    const isSecret = SECRET_FIELD_PATTERNS.some((p) => p.test(key));
    if (isSecret) {
      result[key] = '[REDACTED]';
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = redactOutboxPayload(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function validateOutboxPayload(payload: Record<string, unknown>): string | null {
  const str = JSON.stringify(payload);
  if (str.length > 64_000) {
    return 'Outbox payload exceeds 64 KB limit.';
  }
  return null;
}
