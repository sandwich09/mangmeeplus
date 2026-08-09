import type { ExactObjectVersionInventory } from '../ports/attachment-storage.port';

export type ObjectVersionPurgeTarget = {
  kind: 'OBJECT_VERSION' | 'DELETE_MARKER';
  versionId: string;
};

export type ObjectVersionPurgeBlocker =
  | { reason: 'EXPECTED_VERSION_NOT_FOUND'; versionId: string }
  | { reason: 'LEGAL_HOLD_ACTIVE'; versionId: string }
  | { reason: 'RETENTION_ACTIVE'; versionId: string; mode: 'GOVERNANCE' | 'COMPLIANCE'; retainUntil: Date }
  | { reason: 'OBJECT_LOCK_METADATA_INCOMPLETE'; versionId: string };

export type ExactObjectVersionPurgeDryRun = {
  bucket: string;
  objectKey: string;
  expectedObjectVersionId: string;
  expectedObjectVersionFound: boolean;
  objectVersionCount: number;
  deleteMarkerCount: number;
  targets: ObjectVersionPurgeTarget[];
  blockers: ObjectVersionPurgeBlocker[];
  storageMetadataAllowsPurge: boolean;
};

export type ExactObjectVersionPurgeVerification = {
  bucket: string;
  objectKey: string;
  verifiedAbsent: boolean;
  remainingObjectVersionIds: string[];
  remainingDeleteMarkerVersionIds: string[];
};

/** Pure dry-run only: this function never calls storage and never deletes an object. */
export function buildExactObjectVersionPurgeDryRun(
  inventory: ExactObjectVersionInventory,
  input: { expectedObjectVersionId: string; asOf?: Date },
): ExactObjectVersionPurgeDryRun {
  assertCompleteInventory(inventory);
  if (!input.expectedObjectVersionId) throw new Error('expectedObjectVersionId is required.');
  const asOf = input.asOf ?? new Date();
  if (Number.isNaN(asOf.getTime())) throw new Error('asOf must be a valid date.');

  const expectedObjectVersionFound = inventory.versions.some(
    (version) => version.versionId === input.expectedObjectVersionId,
  );
  const blockers: ObjectVersionPurgeBlocker[] = expectedObjectVersionFound
    ? []
    : [{ reason: 'EXPECTED_VERSION_NOT_FOUND', versionId: input.expectedObjectVersionId }];

  for (const version of inventory.versions) {
    if (version.objectLockMetadataVerified !== true) {
      blockers.push({ reason: 'OBJECT_LOCK_METADATA_INCOMPLETE', versionId: version.versionId });
      continue;
    }
    if (
      inventory.objectLockConfiguration === 'DISABLED'
      && (
        version.objectLockMode !== undefined
        || version.objectLockRetainUntil !== undefined
        || version.objectLockLegalHoldStatus !== undefined
      )
    ) {
      blockers.push({ reason: 'OBJECT_LOCK_METADATA_INCOMPLETE', versionId: version.versionId });
      continue;
    }
    if (
      inventory.objectLockConfiguration === 'ENABLED'
      && version.objectLockLegalHoldStatus === undefined
    ) {
      blockers.push({ reason: 'OBJECT_LOCK_METADATA_INCOMPLETE', versionId: version.versionId });
      continue;
    }
    if (version.objectLockLegalHoldStatus === 'ON') {
      blockers.push({ reason: 'LEGAL_HOLD_ACTIVE', versionId: version.versionId });
    }

    const hasRetentionMode = version.objectLockMode !== undefined;
    const hasRetainUntil = version.objectLockRetainUntil !== undefined;
    if (hasRetentionMode !== hasRetainUntil || (hasRetainUntil && Number.isNaN(version.objectLockRetainUntil!.getTime()))) {
      blockers.push({ reason: 'OBJECT_LOCK_METADATA_INCOMPLETE', versionId: version.versionId });
      continue;
    }
    if (
      version.objectLockMode
      && version.objectLockRetainUntil
      && version.objectLockRetainUntil.getTime() > asOf.getTime()
    ) {
      blockers.push({
        reason: 'RETENTION_ACTIVE',
        versionId: version.versionId,
        mode: version.objectLockMode,
        retainUntil: version.objectLockRetainUntil,
      });
    }
  }

  return {
    bucket: inventory.bucket,
    objectKey: inventory.objectKey,
    expectedObjectVersionId: input.expectedObjectVersionId,
    expectedObjectVersionFound,
    objectVersionCount: inventory.versions.length,
    deleteMarkerCount: inventory.deleteMarkers.length,
    targets: [
      ...inventory.versions.map((version) => ({
        kind: 'OBJECT_VERSION' as const,
        versionId: version.versionId,
      })),
      ...inventory.deleteMarkers.map((marker) => ({
        kind: 'DELETE_MARKER' as const,
        versionId: marker.versionId,
      })),
    ],
    blockers,
    storageMetadataAllowsPurge: blockers.length === 0,
  };
}

/** Verifies absence only from an adapter-proven complete inventory; partial input throws. */
export function verifyExactObjectVersionPurge(
  inventory: ExactObjectVersionInventory,
): ExactObjectVersionPurgeVerification {
  assertCompleteInventory(inventory);
  return {
    bucket: inventory.bucket,
    objectKey: inventory.objectKey,
    verifiedAbsent: inventory.versions.length === 0 && inventory.deleteMarkers.length === 0,
    remainingObjectVersionIds: inventory.versions.map((version) => version.versionId),
    remainingDeleteMarkerVersionIds: inventory.deleteMarkers.map((marker) => marker.versionId),
  };
}

function assertCompleteInventory(inventory: ExactObjectVersionInventory): void {
  if (inventory.complete !== true || !Number.isInteger(inventory.pagesScanned) || inventory.pagesScanned < 1) {
    throw new Error('A complete object-version inventory is required.');
  }
  if (inventory.objectLockConfiguration !== 'DISABLED' && inventory.objectLockConfiguration !== 'ENABLED') {
    throw new Error('A verified bucket Object Lock configuration is required.');
  }
  const seen = new Set<string>();
  for (const entry of [...inventory.versions, ...inventory.deleteMarkers]) {
    if (!entry.versionId || seen.has(entry.versionId)) {
      throw new Error('Object-version inventory contains a missing or duplicate version id.');
    }
    seen.add(entry.versionId);
  }
}
