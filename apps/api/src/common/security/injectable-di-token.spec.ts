import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// A `Pick<>`/`Omit<>`/inline-object parameter annotation erases to `Object`, so TypeScript emits
// no usable `design:paramtypes` entry and Nest has nothing to resolve. Registering such a class
// as a provider fails at `NestFactory.create` with "can't resolve dependencies", which no unit
// test in this suite can catch. That is exactly how a `Pick<>` injection in
// RedisRateLimitService shipped: every suite stayed green while the API could not start.
//
// The check here has to be source-level, because under `tsx --test` esbuild emits no decorator
// metadata at all — `design:paramtypes` is undefined for *every* class, healthy or not — so a
// runtime probe run from this suite would report confident false positives. Only the swc build
// (`.swcrc` `decoratorMetadata: true`) emits what Nest actually reads.
//
// This is the cheap half of a pair. `pnpm test:boot` (`src/scripts/boot-di-smoke.ts`) resolves the
// real provider graph from the swc build and catches every wiring error, including shapes the scan
// below cannot see — a bare interface annotation is indistinguishable from a class without
// resolving imports. That check needs no database: Nest builds the whole graph before
// `onModuleInit`, and `PrismaService` only calls `$connect()` there, so the constructor never
// dials the connection string. This spec earns its place by running inside the normal suite
// without a build.
const SRC = join(__dirname, '../../');

// Annotations that carry no runtime constructor and therefore need an explicit token: the named
// mapped types, plus an inline object literal, which erases the same way.
const TOKENLESS_TYPE = /^\s*(?:\{|(?:Pick|Omit|Partial|Required|Readonly|Record|Extract|Exclude|NonNullable)\s*<)/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'generated' || entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

/** Split a constructor parameter list on top-level commas, so `Pick<A, 'b' | 'c'>` stays intact. */
function splitParams(params: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of params) {
    if (char === '<' || char === '(' || char === '[' || char === '{') depth += 1;
    if (char === '>' || char === ')' || char === ']' || char === '}') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

describe('Nest provider constructors expose a resolvable injection token', () => {
  const files = walk(SRC);

  // Only classes actually registered as providers can break boot; a plain helper class with a
  // structural parameter is fine because nobody asks Nest to build it.
  const registeredProviders = new Set<string>();
  for (const file of files.filter((f) => f.endsWith('.module.ts'))) {
    const source = readFileSync(file, 'utf8');
    for (const block of source.matchAll(/providers\s*:\s*\[([\s\S]*?)\]/g)) {
      for (const name of block[1]!.matchAll(/\b([A-Z][A-Za-z0-9_]*)\b/g)) registeredProviders.add(name[1]!);
    }
  }

  it('finds the provider registrations it is meant to police', () => {
    assert.ok(registeredProviders.size > 20, `expected many registered providers, saw ${registeredProviders.size}`);
    assert.ok(registeredProviders.has('RedisRateLimitService'), 'the known-affected provider must be in scope');
  });

  it('has no tokenless constructor parameter without an explicit @Inject', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      if (!source.includes('@Injectable')) continue;

      for (const match of source.matchAll(/export class ([A-Za-z0-9_]+)[^{]*\{[\s\S]*?constructor\s*\(([\s\S]*?)\)\s*\{/g)) {
        const className = match[1]!;
        if (!registeredProviders.has(className)) continue;

        for (const param of splitParams(match[2]!)) {
          const annotation = param.slice(param.indexOf(':') + 1);
          if (!param.includes(':') || !TOKENLESS_TYPE.test(annotation)) continue;
          if (param.includes('@Inject')) continue;
          offenders.push(`${file.replace(SRC, '')} → ${className}: ${param.trim().slice(0, 80)}`);
        }
      }
    }

    assert.deepEqual(
      offenders,
      [],
      `these provider parameters erase to Object and will fail Nest DI at boot:\n${offenders.join('\n')}`,
    );
  });
});
