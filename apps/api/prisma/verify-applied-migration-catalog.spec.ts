import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  completedMigrationLedger,
  compatibleAppliedMigrationCatalog,
  exactAppliedMigrationCatalog,
  pendingRepositoryMigrations,
} from './verify-applied-migration-catalog';

const sourceCommit = 'a'.repeat(40);
const repository = [
  { name: '20260101000000_first', fileSha256: '1'.repeat(64) },
  { name: '20260102000000_second', fileSha256: '2'.repeat(64) },
  { name: '20260103000000_third', fileSha256: '3'.repeat(64) },
];
const applied = repository.map((row, index) => ({
  name: row.name, checksum: row.fileSha256, appliedOrder: index + 1,
}));

describe('exactAppliedMigrationCatalog', () => {
  it('accepts one exact complete byte-for-byte catalog', () => {
    const result = exactAppliedMigrationCatalog({ repository, applied, sourceCommit });
    assert.equal(result.status, 'EXACT_MATCH');
    assert.equal(result.migrationCount, 3);
    assert.match(result.repositoryCatalogHash, /^[0-9a-f]{64}$/);
  });

  it('accepts a complete checksum-valid catalog in historical database order', () => {
    const historicalOrder = [repository[1]!, repository[0]!, repository[2]!].map((row, index) => ({
      name: row.name, checksum: row.fileSha256, appliedOrder: index + 1,
    }));
    const result = exactAppliedMigrationCatalog({
      repository, applied: historicalOrder, sourceCommit,
    });
    assert.equal(result.status, 'EXACT_MATCH');
    assert.notEqual(result.appliedCatalogHash, exactAppliedMigrationCatalog({
      repository, applied, sourceCommit,
    }).appliedCatalogHash);
  });

  for (const [name, changed] of [
    ['pending candidate migration', applied.slice(0, 2)],
    ['unknown production migration', [...applied, {
      name: '20260104000000_unknown', checksum: '4'.repeat(64), appliedOrder: 4,
    }]],
    ['edited checksum', [{ ...applied[0]!, checksum: 'f'.repeat(64) }, applied[1]!, applied[2]!]],
    ['duplicate applied migration', [applied[0]!, { ...applied[0]!, appliedOrder: 2 }, applied[2]!]],
    ['non-sequential applied order', [applied[0]!, { ...applied[1]!, appliedOrder: 3 }, applied[2]!]],
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
    assert.equal(result.appliedMigrationCount, 3);
    assert.equal(result.pendingMigrationCount, 0);
  });

  it('accepts a checksum-valid historical subset and derives pending repository order', () => {
    const historicalApplied = [{
      name: repository[1]!.name, checksum: repository[1]!.fileSha256, appliedOrder: 1,
    }];
    const result = compatibleAppliedMigrationCatalog({
      repository, applied: historicalApplied, sourceCommit,
    });
    assert.equal(result.status, 'APPEND_ONLY_PENDING');
    assert.equal(result.appliedMigrationCount, 1);
    assert.equal(result.pendingMigrationCount, 2);
    assert.match(result.pendingCatalogHash, /^[0-9a-f]{64}$/);
    assert.deepEqual(
      pendingRepositoryMigrations(repository, historicalApplied).map((row) => row.name),
      [repository[0]!.name, repository[2]!.name],
    );
    assert.deepEqual(completedMigrationLedger(repository, historicalApplied), [
      historicalApplied[0],
      { name: repository[0]!.name, checksum: repository[0]!.fileSha256, appliedOrder: 2 },
      { name: repository[2]!.name, checksum: repository[2]!.fileSha256, appliedOrder: 3 },
    ]);
  });

  it('accepts historical order among multiple applied migrations', () => {
    const historicalApplied = [repository[1]!, repository[0]!].map((row, index) => ({
      name: row.name, checksum: row.fileSha256, appliedOrder: index + 1,
    }));
    const result = compatibleAppliedMigrationCatalog({
      repository, applied: historicalApplied, sourceCommit,
    });
    assert.equal(result.status, 'APPEND_ONLY_PENDING');
    assert.equal(result.pendingMigrationCount, 1);
    assert.deepEqual(
      pendingRepositoryMigrations(repository, historicalApplied).map((row) => row.name),
      [repository[2]!.name],
    );
  });

  for (const [name, changed] of [
    ['unknown production migration', [...applied, {
      name: '20260104000000_unknown', checksum: '4'.repeat(64), appliedOrder: 4,
    }]],
    ['edited applied checksum', [{ ...applied[0]!, checksum: 'f'.repeat(64) }]],
    ['duplicate applied migration', [applied[0]!, { ...applied[0]!, appliedOrder: 2 }]],
    ['invalid applied order', [{ ...applied[1]!, appliedOrder: 2 }]],
  ] as const) {
    it(`rejects ${name}`, () => {
      assert.throws(
        () => compatibleAppliedMigrationCatalog({ repository, applied: changed, sourceCommit }),
        /release_catalog_not_compatible_applied_set/,
      );
    });
  }
});
