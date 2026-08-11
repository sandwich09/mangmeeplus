import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  compatibleAppliedMigrationCatalog,
  exactAppliedMigrationCatalog,
} from './verify-applied-migration-catalog';

const sourceCommit = 'a'.repeat(40);
const repository = [
  { name: '20260101000000_first', fileSha256: '1'.repeat(64) },
  { name: '20260102000000_second', fileSha256: '2'.repeat(64) },
];
const applied = repository.map((row, index) => ({
  name: row.name, checksum: row.fileSha256, appliedOrder: index + 1,
}));

describe('exactAppliedMigrationCatalog', () => {
  it('accepts one exact complete byte-for-byte catalog', () => {
    const result = exactAppliedMigrationCatalog({ repository, applied, sourceCommit });
    assert.equal(result.status, 'EXACT_MATCH');
    assert.equal(result.migrationCount, 2);
    assert.match(result.repositoryCatalogHash, /^[0-9a-f]{64}$/);
  });

  for (const [name, changed] of [
    ['pending candidate migration', applied.slice(0, 1)],
    ['unknown production migration', [...applied, {
      name: '20260103000000_unknown', checksum: '3'.repeat(64), appliedOrder: 3,
    }]],
    ['edited checksum', [{ ...applied[0]!, checksum: 'f'.repeat(64) }, applied[1]!]],
    ['changed order', [applied[1]!, applied[0]!]],
  ] as const) {
    it(`rejects ${name}`, () => {
      assert.throws(
        () => exactAppliedMigrationCatalog({ repository, applied: changed, sourceCommit }),
        /release_catalog_not_exactly_applied/,
      );
    });
  }
});

describe('compatibleAppliedMigrationCatalog', () => {
  it('accepts the exact catalog without inventing pending work', () => {
    const result = compatibleAppliedMigrationCatalog({ repository, applied, sourceCommit });
    assert.equal(result.status, 'EXACT_MATCH');
    assert.equal(result.appliedMigrationCount, 2);
    assert.equal(result.pendingMigrationCount, 0);
  });

  it('accepts only a checksum-matching ordered prefix with pending append-only migrations', () => {
    const result = compatibleAppliedMigrationCatalog({
      repository, applied: applied.slice(0, 1), sourceCommit,
    });
    assert.equal(result.status, 'APPEND_ONLY_PENDING');
    assert.equal(result.appliedMigrationCount, 1);
    assert.equal(result.pendingMigrationCount, 1);
    assert.match(result.pendingCatalogHash, /^[0-9a-f]{64}$/);
  });

  for (const [name, changed] of [
    ['unknown production migration', [...applied, {
      name: '20260103000000_unknown', checksum: '3'.repeat(64), appliedOrder: 3,
    }]],
    ['edited applied checksum', [{ ...applied[0]!, checksum: 'f'.repeat(64) }]],
    ['missing-middle migration', [{ ...applied[1]!, appliedOrder: 1 }]],
    ['changed applied order', [applied[1]!, applied[0]!]],
  ] as const) {
    it(`rejects ${name}`, () => {
      assert.throws(
        () => compatibleAppliedMigrationCatalog({ repository, applied: changed, sourceCommit }),
        /release_catalog_not_compatible_applied_prefix/,
      );
    });
  }
});
