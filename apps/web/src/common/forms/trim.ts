// Every user-facing input is trimmed before submit (explicit product rule —
// applies to identifiers, names, and passwords alike; the API's TrimStringsPipe
// mirrors this server-side so both layers agree).
export function trimmed(value: string): string {
  return value.trim();
}

export function trimValues<T extends Record<string, unknown>>(input: T): T {
  const result: Record<string, unknown> = { ...input };
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === 'string') result[key] = value.trim();
  }
  return result as T;
}
