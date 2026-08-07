import { stableJson } from '../../src/scripts/a5-readonly-evidence.logic';
import { productionA5ManifestHashes } from '../../src/scripts/production-a5-evidence.logic';
import {
  buildProductionA5ReviewedManifestArtifact,
  readProductionA5RepositoryMigrationFiles,
} from './reviewed-manifest';

const manifest = buildProductionA5ReviewedManifestArtifact({
  migrationFiles: readProductionA5RepositoryMigrationFiles(),
  preSchemaCatalogObjects: [],
  postSchemaCatalogObjects: [],
});
process.stdout.write(`${stableJson(productionA5ManifestHashes(manifest))}\n`);
