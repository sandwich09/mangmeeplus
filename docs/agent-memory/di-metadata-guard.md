# Agent Memory: di-metadata-guard

Status: Done — guard shipped on `codex/di-metadata-guard`, green on `develop`, proven against the
commit that broke and the commit that fixed it.

Owner: Platform / API build.

Scope: `apps/api/scripts/check-di-metadata.mjs` (new), `.github/workflows/ci.yml` (one CI step).
No `package.json` edit, no new dependency, no source change.

## The defect this guard exists for

Nest builds a provider from the `design:paramtypes` metadata the compiler writes next to
`@Injectable()`. TypeScript and swc alike write that metadata **only for the class that declares the
constructor**. An `@Injectable()` class whose constructor lives on an *undecorated* abstract base
therefore has no metadata of its own and none to inherit: Nest constructs it with **zero arguments**,
and every injected field is `undefined` at the first call.

Five draft-edit tools shipped in exactly that shape
(`erp-draft-update-tools.use-case.ts` at `082521b0`, fixed at `7ab488ca`).

## Two failure modes, two guards

The repo now has one guard per mode. They are not substitutes — neither sees the other's shape.

| Failure mode | What the swc build emits | What Nest does | Caught by |
| --- | --- | --- | --- |
| **Arity** — `@Injectable()` class declares no constructor; the real one is on an undecorated base | no `design:paramtypes` at all for that class | resolves it happily with **zero args**; `this.dep` is `undefined` on first use | `apps/api/scripts/check-di-metadata.mjs` (this work) |
| **Unresolvable token** — a parameter annotated `Pick<…>` / inline object / bare default, which erases to `Object` | `design:paramtypes: [Object]`, or an `undefined` entry | **fails at `NestFactory.create`**: "can't resolve dependencies" | `apps/api/src/common/security/injectable-di-token.spec.ts` |

The distinction is the whole point: the arity mode produces a *silently wrong object*, the token mode
produces a *loud boot failure*. Only the second one has ever been visible.

## Why the existing checks cannot catch the arity mode

- **`pnpm test` (tsx/esbuild)** — esbuild does not implement `emitDecoratorMetadata`, so
  `Reflect.getMetadata('design:paramtypes', X)` is `undefined` under the test runner for **every**
  class, healthy or broken. A runtime metadata assertion in a spec is a confident false alarm, not a
  guard. (Verified: absent for all classes, not just the offenders.) The specs also build their
  subject with `new` and hand it the dependencies, so they stay green regardless.
- **`pnpm test:boot` (`src/scripts/boot-di-smoke.ts`)** — resolves the real provider graph from the
  swc build, but **a zero-dependency class resolves fine**. It catches tokens Nest cannot resolve,
  not tokens Nest was never asked for.
- **`injectable-di-token.spec.ts`** — scans constructor *parameters* for annotations that erase to
  `Object`. A class with no constructor has no parameters to scan.

That leaves the swc emit as the only honest witness, which is what the new script reads.
Compiler-independently the same defect is visible as *effective constructor arity ≥ 1 with no own
constructor*; the script uses arity to decide **what** to check and the swc emit to decide **whether
it passes**.

## How the guard works

1. Walks `apps/api/src/**/*.ts` (skipping `*.spec.ts`, `generated/`, `node_modules/`), keeping files
   that mention a provider decorator.
2. Parses each with `@swc/core`'s `parseSync` and, for every `@Injectable()` / `@Controller()` /
   `@Catch()` class, computes the **metadata owner**: the nearest class in the `extends` chain that
   *declares* a constructor. This mirrors `Reflect.getMetadata`'s prototype-chain walk, so a
   decorated base legitimately serving its children is not a false positive.
3. Compiles the file with the API's own `.swcrc` (`transformSync`) — the same config `pnpm build`
   uses, so the check cannot drift from the shipped artifact.
4. Asserts the emitted `Name = _ts_decorate([ … ], Name)` block for the metadata owner contains
   `design:paramtypes`. Prints every offender with class, base and argument count; exits non-zero.

Guards on the guard: a run over the default root that finds fewer than 100 provider classes fails
(the scan lost its subject); and because 812 healthy classes go through the same emit-matching path
every run, a broken matcher lights up as hundreds of offenders rather than a silent pass.

## Decisions

- **A script, not a spec.** A `*.spec.ts` runs under tsx, which is precisely the compiler that
  cannot see this. It also would have forced a `package.json` edit
  (`spec-suite-coverage.spec.ts` requires every spec to be named by a script), which AGENTS.md
  rules out for non-dependency changes. `apps/api/scripts/` sits outside `src/`, so it is untouched
  by `tsc` (`include: ["src/**/*.ts"]`), by `swc src` and by both existing spec walkers, while still
  resolving `@swc/core` from `apps/api`'s own dependency (already present, `^1.13.5`).
- **Wired as a CI step next to `pnpm typecheck`**, not a package script — same reason, and it reads
  as what it is: a compile-time check that the type system cannot express.
- **`@Controller()` and `@Catch()` are included** alongside `@Injectable()`. Same container, same
  metadata, same failure. Zero extra cost, zero new offenders.
- **A base class outside the file is reported, not skipped.** Zero occurrences on `develop` today,
  so it costs nothing now; leaving it silent would put a hole in the guard in exactly the shape the
  guard exists for. "Declare the constructor" is the correct fix either way.

## Open questions

- None blocking. If a future provider legitimately extends a decorated base from another file, the
  guard will name it and the fix is to declare the constructor on the decorated class — the same fix
  `7ab488ca` applied.

## Artifacts

- `apps/api/scripts/check-di-metadata.mjs` — the guard.
- `.github/workflows/ci.yml` — step "Check Nest providers carry constructor metadata in the swc
  build", immediately after `pnpm typecheck` in `typecheck-and-test`, under the same
  `recovery_only` / `release_controller_only` guards as its neighbours.

## Verification

| Check | Result |
| --- | --- |
| `node apps/api/scripts/check-di-metadata.mjs` on `origin/develop` (`e37eb216`) | **pass** — 787 files, 829 provider classes, 812 with constructor dependencies, all carry `design:paramtypes`. **0.8–2.3 s** (well inside the 30 s budget). |
| Deliberate mutation: constructor of `InventoryGetProductDetailTool` moved onto a new undecorated `abstract class MutationProofBase` in `erp-core-detail-tools.use-case.ts` | **fails, exit 1**, naming the class: `… → InventoryGetProductDetailTool: constructor inherited from undecorated MutationProofBase (1 argument) — Nest will construct it with zero`. Mutation reverted. |
| `erp-draft-update-tools.use-case.ts` at `082521b0` (before the fix), extracted to a scratch dir | **fails, exit 1**, naming all five: `ExpenseDraftSetHeaderTool`, `ExpenseDraftSetLineTool`, `ExpenseDraftAddChargeTool`, `ExpenseDraftRemoveLineTool`, `ExpenseDraftSetVatModeTool`, each `constructor inherited from undecorated ExpenseDraftUpdateTool (2 arguments)`. |
| Same file at `7ab488ca` (after the fix — each tool declares its own constructor and calls `super`) | **pass** — 5 provider classes, 5 with constructor dependencies, all carry `design:paramtypes`. |
| `.github/workflows/ci.yml` parses; the three count-pinned strings `infra/docker/production-image-security.spec.sh` asserts are unchanged | pass — `validated_ci_run_id == ''` ×7, `generate-image-sbom.sh` ×3, `cache-from: type=gha` ×3. |

Not re-run: `pnpm test:boot` and `pnpm typecheck`. The guard adds no `src/` file and no
`package.json` entry, so neither's input changed; `test:boot`'s blindness to this mode is stated in
its own header comment (`src/scripts/boot-di-smoke.ts`) and was confirmed by reviewers.

## Next

- Nothing pending. The guard runs on every CI run that reaches `typecheck-and-test`.
- If the arity mode ever recurs behind a cross-file base, the "not in this file" branch fires first
  and the message already carries the fix.
