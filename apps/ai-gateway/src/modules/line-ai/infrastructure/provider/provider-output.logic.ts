import type { ProviderToolCall, ProviderToolSpec } from './provider.port';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/** The registry currently uses the JSON Schema core subset: object/required/properties/type/enum. */
function matchesSchema(value: unknown, schema: unknown, depth = 0): boolean {
  if (depth > 8 || !isPlainObject(schema)) return false;
  const type = schema['type'];
  if (type === 'object') {
    if (!isPlainObject(value)) return false;
    if (Object.hasOwn(value, '__proto__') || Object.hasOwn(value, 'constructor')) return false;
    const required = schema['required'];
    if (required !== undefined && (!Array.isArray(required) || required.some((key) => typeof key !== 'string' || !Object.hasOwn(value, key)))) return false;
    const properties = schema['properties'];
    if (properties !== undefined && !isPlainObject(properties)) return false;
    if (isPlainObject(properties)) {
      for (const [key, child] of Object.entries(properties)) {
        if (Object.hasOwn(value, key) && !matchesSchema(value[key], child, depth + 1)) return false;
      }
      if (schema['additionalProperties'] === false && Object.keys(value).some((key) => !Object.hasOwn(properties, key))) return false;
    }
  } else if (type === 'string') {
    if (typeof value !== 'string') return false;
  } else if (type === 'integer') {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) return false;
  } else if (type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  } else if (type === 'boolean') {
    if (typeof value !== 'boolean') return false;
  } else if (type === 'array') {
    if (!Array.isArray(value)) return false;
    if (schema['items'] !== undefined && value.some((item) => !matchesSchema(item, schema['items'], depth + 1))) return false;
  } else if (type === 'null') {
    if (value !== null) return false;
  } else if (type !== undefined) {
    return false;
  }
  if (Array.isArray(schema['enum']) && !schema['enum'].some((choice) => JSON.stringify(choice) === JSON.stringify(value))) return false;
  if (typeof value === 'string') {
    if (typeof schema['minLength'] === 'number' && value.length < schema['minLength']) return false;
    if (typeof schema['maxLength'] === 'number' && value.length > schema['maxLength']) return false;
  }
  if (typeof value === 'number') {
    if (typeof schema['minimum'] === 'number' && value < schema['minimum']) return false;
    if (typeof schema['maximum'] === 'number' && value > schema['maximum']) return false;
  }
  return true;
}

export function validateProviderToolCalls(calls: ProviderToolCall[], tools: readonly ProviderToolSpec[]): boolean {
  const specs = new Map(tools.map((tool) => [tool.name, tool]));
  return calls.every((call) => {
    const spec = specs.get(call.name);
    return Boolean(call.toolUseId && call.toolUseId.length <= 128 && spec
      && matchesSchema(call.input, spec.inputSchema));
  });
}

/** Structured text must parse and satisfy the same schema subset as tool arguments. */
export function validateProviderStructuredText(text: string, schema: Record<string, unknown>): boolean {
  try { return matchesSchema(JSON.parse(text), schema); }
  catch { return false; }
}

/** Parse and validate the entire provider tool batch; any bad call invalidates every call in it. */
export function parseProviderToolCalls(
  calls: Array<{ callId?: unknown; name?: unknown; arguments?: unknown }>,
  tools: readonly ProviderToolSpec[],
): ProviderToolCall[] | undefined {
  const parsed: ProviderToolCall[] = [];
  for (const call of calls) {
    if (typeof call.callId !== 'string' || !call.callId || call.callId.length > 128
      || typeof call.name !== 'string' || call.name.length > 64 || typeof call.arguments !== 'string') return undefined;
    const spec = tools.find((tool) => tool.name === call.name);
    if (!spec) return undefined;
    let input: unknown;
    try { input = JSON.parse(call.arguments); } catch { return undefined; }
    if (!isPlainObject(input) || !matchesSchema(input, spec.inputSchema)) return undefined;
    parsed.push({ toolUseId: call.callId, name: call.name, input });
  }
  return parsed;
}

export function providerCompletion(stopReason: unknown): 'complete' | 'output_limit' | 'blocked' | 'unknown' {
  if (stopReason === 'end_turn' || stopReason === 'completed') return 'complete';
  if (stopReason === 'max_tokens' || stopReason === 'max_output_tokens') return 'output_limit';
  if (stopReason === 'guardrail_intervened' || stopReason === 'content_filter' || stopReason === 'refusal') return 'blocked';
  return 'unknown';
}
