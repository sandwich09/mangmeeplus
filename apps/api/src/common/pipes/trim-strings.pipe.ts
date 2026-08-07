import { Injectable } from '@nestjs/common';
import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';

// ponytail: depth cap only guards pathological payloads; JSON bodies cannot cycle
const MAX_DEPTH = 32;

export function deepTrimStrings(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return value;
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map((item) => deepTrimStrings(item, depth + 1));
  if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      result[key] = deepTrimStrings(entry, depth + 1);
    }
    return result;
  }
  return value;
}

// Trims leading/trailing whitespace on every string in request bodies so
// " admin " and "admin" resolve to the same account and stored fields stay clean.
// Runs before ValidationPipe (registration order in main.ts).
@Injectable()
export class TrimStringsPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (metadata.type !== 'body') return value;
    return deepTrimStrings(value);
  }
}
