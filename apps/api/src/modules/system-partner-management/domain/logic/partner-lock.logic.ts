// DISABLED/ARCHIVED partner companies are metadata-frozen: profile, feature
// entitlements, and AI model are read-only; only lifecycle transitions may change them.
//
// PR E (R-E3, RV26): a company the SWEEP disabled for a term that ran out (`termDisabledAt` set)
// is a customer state, not an operator hold — the shop may still fix its own registered
// name/tax id/address, and an admin may fix them for it, while features/AI stay read-only (RV25).
// An admin hold (`termDisabledAt` empty) and ARCHIVED both keep the full freeze.
export function partnerMetadataLockError(status: string, termDisabled = false): string | null {
  if (status !== 'DISABLED' && status !== 'ARCHIVED') return null;
  if (status === 'DISABLED' && termDisabled) return null;
  return `Company is ${status}: profile, features, and AI model are read-only. Only lifecycle transitions are allowed.`;
}
