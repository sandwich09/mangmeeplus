/**
 * Reachability guard shared by the real-PostgreSQL spec suites.
 *
 * A missing `DATABASE_URL` is already a skip everywhere. A URL that is *set* but whose server does
 * not answer was an unhandled throw, so a developer whose docker database is stopped saw red tests
 * for the same "no database here" condition the unset case reports as a skip.
 *
 * It stays a failure where it matters. CI names the database it just started one step earlier, so
 * an unreachable one there is exactly the breakage the step exists to catch — never a silent skip.
 * A suite's own `*_REQUIRE_POSTGRES=true` says the same thing for a local run reproducing CI.
 *
 * Only the "set but unreachable" branch consults `CI`: `pnpm test` runs these same files in CI with
 * no `DATABASE_URL` at all, and that must keep skipping.
 */
export async function pgSpecUnreachableReason(
  probe: () => Promise<unknown>,
  requireEnvVar: string,
): Promise<string | null> {
  try {
    await probe();
    return null;
  } catch (error) {
    if (process.env.CI || process.env[requireEnvVar] === 'true') throw error;
    // Prisma's message is a multi-line block whose FIRST line is the invocation banner; the cause
    // ("Can't reach database server at …") is the last line, so a first-line slice reads empty.
    const detail = String((error as Error)?.message ?? error)
      .split('\n').map((line) => line.trim()).filter(Boolean).at(-1) ?? String(error);
    return `PostgreSQL at DATABASE_URL is unreachable — ${detail} — `
      + `set ${requireEnvVar}=true or CI=1 to fail instead of skip`;
  }
}
