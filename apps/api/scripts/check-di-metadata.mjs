#!/usr/bin/env node
// Nest resolves constructor dependencies from the `design:paramtypes` metadata the compiler emits
// next to `@Injectable()`. TypeScript and swc alike write that metadata only for the class that
// DECLARES the constructor. So an `@Injectable()` class whose constructor lives on an undecorated
// abstract base gets no metadata of its own, and none to inherit — Nest builds it with ZERO
// arguments and every `this.dep` is undefined at the first call.
//
// Five draft-edit tools shipped in exactly that shape. Nothing caught it:
//
//   - The unit suite runs under `tsx --test`, whose esbuild transform emits no decorator metadata
//     at all. `Reflect.getMetadata('design:paramtypes', …)` is undefined there for EVERY class,
//     healthy or broken, so a runtime probe from a spec reports confident false alarms. The specs
//     also build their subject with `new`, passing the dependencies by hand, so they stay green.
//   - `pnpm test:boot` (`src/scripts/boot-di-smoke.ts`) resolves the real provider graph, but a
//     zero-dependency class resolves FINE. It catches unresolvable tokens, not missing ones.
//   - `injectable-di-token.spec.ts` scans constructor parameters for annotations that erase to
//     `Object`. A class with no constructor at all has no parameters to scan.
//
// That leaves the swc emit as the only honest witness, which is what this script reads. It is not
// a spec: it needs the build compiler, and `tsx` is not it.
//
// Two distinct failure modes, one per guard — see docs/agent-memory/di-metadata-guard.md:
//   arity              → metadata absent, Nest injects nothing   → THIS script
//   unresolvable token → metadata present but erased to `Object` → injectable-di-token.spec.ts
//
// Usage: node apps/api/scripts/check-di-metadata.mjs [path …]   (default: apps/api/src)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSync, transformSync } from '@swc/core';

const API_ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const DEFAULT_ROOT = join(API_ROOT, 'src');

// The build compiler's own configuration, so this check cannot drift from what `pnpm build` emits.
const swcrc = JSON.parse(readFileSync(join(API_ROOT, '.swcrc'), 'utf8'));
delete swcrc.$schema;
const TRANSFORM = { ...swcrc, sourceMaps: false, swcrc: false, configFile: false };
const PARSE = { ...swcrc.jsc.parser, target: swcrc.jsc.target };

// Everything the injector constructs from `design:paramtypes`, not just providers: `@Controller()`
// and `@Catch()` classes take constructor dependencies, and so does a `@Module()` class that injects
// something for `configure()` or `onModuleInit()`. All four break identically.
const PROVIDER_DECORATORS = new Set(['Injectable', 'Controller', 'Catch', 'Module']);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'generated' || entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

function decoratorNames(node) {
  return (node.decorators ?? []).map((d) => {
    const callee = d.expression.type === 'CallExpression' ? d.expression.callee : d.expression;
    return callee.type === 'Identifier' ? callee.value : '';
  });
}

/** Every top-level class in one file, keyed by name, with what decides its metadata. */
function classesIn(ast) {
  const found = new Map();
  for (const item of ast.body) {
    const decl = item.type === 'ExportDeclaration' ? item.declaration : item;
    if (decl?.type !== 'ClassDeclaration') continue;
    const ctor = decl.body.find((member) => member.type === 'Constructor');
    found.set(decl.identifier.value, {
      // null means "declares no constructor", which is the whole point: it is the case that
      // inherits an implementation but not the metadata.
      ownParams: ctor ? ctor.params.length : null,
      hasSuper: decl.superClass != null,
      superName: decl.superClass?.type === 'Identifier' ? decl.superClass.value : null,
      decorators: decoratorNames(decl),
    });
  }
  return found;
}

/**
 * The class whose emitted decorator block has to carry `design:paramtypes`, mirroring how Nest
 * reads it: `Reflect.getMetadata` walks the prototype chain, so a decorated base serves its
 * children. `none` means the effective constructor takes no arguments — nothing to inject.
 *
 * `unresolved` is a base that lives in another file (or behind a mixin call). Nothing on develop
 * hits it today, and it is reported rather than skipped on purpose: a silent hole in exactly the
 * shape this guard polices is how the bug shipped the first time. Declaring the constructor on the
 * decorated class is the fix either way, and it is what Nest's own docs ask for.
 */
function metadataOwner(name, classes, seen = new Set()) {
  if (seen.has(name)) return { kind: 'none' };
  seen.add(name);
  const cls = classes.get(name);
  if (cls.ownParams !== null) {
    return cls.ownParams > 0 ? { kind: 'owner', name, params: cls.ownParams } : { kind: 'none' };
  }
  if (!cls.hasSuper) return { kind: 'none' };
  if (!cls.superName || !classes.has(cls.superName)) {
    return { kind: 'unresolved', base: cls.superName ?? 'a computed base class' };
  }
  return metadataOwner(cls.superName, classes, seen);
}

/**
 * swc emits `Name = _ts_decorate([ … ], Name);` — anchored on the class name at both ends, so the
 * body can never run past its own block into another class's metadata.
 */
function decorateBody(code, className) {
  const block = new RegExp(
    `\\b${className}\\s*=\\s*_ts_decorate\\(\\[([\\s\\S]*?)\\],\\s*${className}\\s*\\)`,
  ).exec(code);
  return block ? block[1] : null;
}

const targets = process.argv.slice(2).map((arg) => resolve(arg));
const roots = targets.length > 0 ? targets : [DEFAULT_ROOT];
const files = roots.flatMap((root) => (statSync(root).isDirectory() ? walk(root) : [root]));

const offenders = [];
let providerClasses = 0;
let checkedClasses = 0;

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  if (![...PROVIDER_DECORATORS].some((name) => source.includes(`@${name}`))) continue;

  const classes = classesIn(parseSync(source, PARSE));
  const providers = [...classes].filter(([, cls]) =>
    cls.decorators.some((name) => PROVIDER_DECORATORS.has(name)),
  );
  if (providers.length === 0) continue;
  providerClasses += providers.length;

  const needMetadata = providers
    .map(([name]) => ({ name, owner: metadataOwner(name, classes) }))
    .filter((entry) => entry.owner.kind !== 'none');
  if (needMetadata.length === 0) continue;
  checkedClasses += needMetadata.length;

  const inTree = relative(API_ROOT, file);
  const where = inTree.startsWith('..') ? file : inTree;
  // Only compile a file that has something to prove — the emit is the evidence, not the scan.
  const emitted = transformSync(source, { ...TRANSFORM, filename: file }).code;

  for (const { name, owner } of needMetadata) {
    if (owner.kind === 'unresolved') {
      offenders.push(
        `${where} → ${name}: declares no constructor and extends ${owner.base}, which is not in` +
          ' this file — its metadata cannot be verified here. Declare the constructor.',
      );
      continue;
    }
    if (decorateBody(emitted, owner.name)?.includes('design:paramtypes')) continue;
    const args = owner.params === 1 ? '1 argument' : `${owner.params} arguments`;
    offenders.push(
      owner.name === name
        ? `${where} → ${name}: ${args} to inject, no emitted design:paramtypes`
        : `${where} → ${name}: constructor inherited from undecorated ${owner.name}` +
          ` (${args}) — Nest will construct it with zero`,
    );
  }
}

if (targets.length === 0 && providerClasses < 100) {
  console.error(
    `check-di-metadata: found only ${providerClasses} decorated classes under ${DEFAULT_ROOT} —` +
      ' the scan lost its subject, not the codebase its providers.',
  );
  process.exit(1);
}

if (offenders.length > 0) {
  console.error(
    'These providers carry no constructor metadata in the swc build. Nest will build them with' +
      ' zero arguments and every injected field will be undefined at the first call.\n' +
      'Fix: declare the constructor on the decorated class itself (and call super), or put' +
      ' @Injectable() on the base that declares it.\n\n' +
      offenders.map((line) => `  ${line}`).join('\n'),
  );
  process.exit(1);
}

console.log(
  `check-di-metadata: ${files.length} files, ${providerClasses} decorated classes,` +
    ` ${checkedClasses} with constructor dependencies — all carry design:paramtypes.`,
);
