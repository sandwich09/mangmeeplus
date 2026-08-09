import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ExactObjectVersionInventory } from '../ports/attachment-storage.port';
import {
  buildExactObjectVersionPurgeDryRun,
  verifyExactObjectVersionPurge,
} from './object-version-inventory.logic';

const inventory: ExactObjectVersionInventory = {
  bucket: 'evidence',
  objectKey: 'company/receipt.pdf',
  objectLockConfiguration: 'ENABLED',
  versions: [
    {
      versionId: 'version-current',
      isLatest: false,
      objectLockMode: 'GOVERNANCE',
      objectLockRetainUntil: new Date('2026-08-01T00:00:00.000Z'),
      objectLockLegalHoldStatus: 'OFF',
      objectLockMetadataVerified: true,
    },
    {
      versionId: 'version-held',
      isLatest: false,
      objectLockMode: 'COMPLIANCE',
      objectLockRetainUntil: new Date('2026-09-01T00:00:00.000Z'),
      objectLockLegalHoldStatus: 'ON',
      objectLockMetadataVerified: true,
    },
  ],
  deleteMarkers: [{ versionId: 'delete-marker-latest', isLatest: true }],
  pagesScanned: 2,
  complete: true,
};

describe('object-version-inventory.logic', () => {
  it('builds an exact, read-only dry run and blocks active retention and legal hold', () => {
    const result = buildExactObjectVersionPurgeDryRun(inventory, {
      expectedObjectVersionId: 'version-current',
      asOf: new Date('2026-08-09T00:00:00.000Z'),
    });

    assert.equal(result.expectedObjectVersionFound, true);
    assert.equal(result.objectVersionCount, 2);
    assert.equal(result.deleteMarkerCount, 1);
    assert.deepEqual(result.targets, [
      { kind: 'OBJECT_VERSION', versionId: 'version-current' },
      { kind: 'OBJECT_VERSION', versionId: 'version-held' },
      { kind: 'DELETE_MARKER', versionId: 'delete-marker-latest' },
    ]);
    assert.deepEqual(result.blockers, [
      { reason: 'LEGAL_HOLD_ACTIVE', versionId: 'version-held' },
      {
        reason: 'RETENTION_ACTIVE',
        versionId: 'version-held',
        mode: 'COMPLIANCE',
        retainUntil: new Date('2026-09-01T00:00:00.000Z'),
      },
    ]);
    assert.equal(result.storageMetadataAllowsPurge, false);
  });

  it('fails closed when the recorded version or retention metadata cannot be verified', () => {
    const result = buildExactObjectVersionPurgeDryRun({
      ...inventory,
      versions: [{
        versionId: 'different-version',
        isLatest: true,
        objectLockMode: 'GOVERNANCE',
        objectLockMetadataVerified: undefined as unknown as true,
      }],
      deleteMarkers: [],
    }, {
      expectedObjectVersionId: 'recorded-version',
      asOf: new Date('2026-08-09T00:00:00.000Z'),
    });

    assert.deepEqual(result.blockers, [
      { reason: 'EXPECTED_VERSION_NOT_FOUND', versionId: 'recorded-version' },
      { reason: 'OBJECT_LOCK_METADATA_INCOMPLETE', versionId: 'different-version' },
    ]);
    assert.equal(result.storageMetadataAllowsPurge, false);
  });

  it('allows a dry run when the recorded version is present and retention has expired', () => {
    const result = buildExactObjectVersionPurgeDryRun({
      ...inventory,
      versions: [inventory.versions[0]!],
    }, {
      expectedObjectVersionId: 'version-current',
      asOf: new Date('2026-08-09T00:00:00.000Z'),
    });

    assert.deepEqual(result.blockers, []);
    assert.equal(result.storageMetadataAllowsPurge, true);
  });

  it('allows a verified Object-Lock-disabled provider inventory without lock headers', () => {
    const result = buildExactObjectVersionPurgeDryRun({
      ...inventory,
      objectLockConfiguration: 'DISABLED',
      versions: [{
        versionId: 'version-current',
        isLatest: true,
        objectLockMetadataVerified: true,
      }],
      deleteMarkers: [],
    }, {
      expectedObjectVersionId: 'version-current',
      asOf: new Date('2026-08-09T00:00:00.000Z'),
    });

    assert.deepEqual(result.blockers, []);
    assert.equal(result.storageMetadataAllowsPurge, true);
  });

  it('only verifies physical absence when both versions and delete markers are gone', () => {
    assert.deepEqual(verifyExactObjectVersionPurge(inventory), {
      bucket: 'evidence',
      objectKey: 'company/receipt.pdf',
      verifiedAbsent: false,
      remainingObjectVersionIds: ['version-current', 'version-held'],
      remainingDeleteMarkerVersionIds: ['delete-marker-latest'],
    });

    assert.equal(verifyExactObjectVersionPurge({
      ...inventory,
      versions: [],
      deleteMarkers: [],
    }).verifiedAbsent, true);
  });

  it('refuses to verify absence from an incomplete inventory', () => {
    assert.throws(
      () => verifyExactObjectVersionPurge({ ...inventory, complete: false as true }),
      /complete object-version inventory is required/i,
    );
  });
});
