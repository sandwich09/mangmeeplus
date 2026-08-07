/**
 * Guard for the contracts enum arrays that DTO classes hand to `@IsIn(...)`.
 *
 * apps/api resolves `@watchdog-bms/contracts` to its built `dist/`, so an array
 * added to the contracts source but missing from a stale build arrives as
 * `undefined`. `@IsIn(undefined)` does not throw — it rejects every value, which
 * shows up as a 400 on a payload that is entirely correct ("must be one of the
 * following values: undefined"). That is the worst kind of failure: it looks like
 * a client bug and it only appears at runtime.
 *
 * The deploy image builds contracts before the api (turbo `dependsOn: ["^build"]`),
 * so this should never fire in production — it exists so that when it does, the
 * process refuses to start with the name of the missing export instead of quietly
 * rejecting every write to the affected endpoints.
 */
export function enumValues<T extends string>(name: string, values: readonly T[] | undefined): readonly T[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(
      `Enum list "${name}" resolved to ${JSON.stringify(values)} from @watchdog-bms/contracts. ` +
      'The built contracts package is stale or missing this export — rebuild it ' +
      '(pnpm --filter @watchdog-bms/contracts build) before starting the API. ' +
      'Left alone, every DTO validating against this list would reject all values.',
    );
  }
  return values;
}
