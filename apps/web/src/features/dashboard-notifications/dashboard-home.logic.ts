/** The manual force-generate endpoint is gated by this key on the API; everyone else refreshes via the plain GET. */
export const SNAPSHOT_GENERATE_PERMISSION = 'dashboard.snapshot.generate';

export function canForceGenerateSnapshot(permissions: readonly string[]): boolean {
  return permissions.includes(SNAPSHOT_GENERATE_PERMISSION);
}
