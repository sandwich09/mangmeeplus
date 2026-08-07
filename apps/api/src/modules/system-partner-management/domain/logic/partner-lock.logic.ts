// DISABLED/ARCHIVED partner companies are metadata-frozen: profile, feature
// entitlements, and AI model are read-only; only lifecycle transitions may change them.
export function partnerMetadataLockError(status: string): string | null {
  if (status !== 'DISABLED' && status !== 'ARCHIVED') return null;
  return `Company is ${status}: profile, features, and AI model are read-only. Only lifecycle transitions are allowed.`;
}
