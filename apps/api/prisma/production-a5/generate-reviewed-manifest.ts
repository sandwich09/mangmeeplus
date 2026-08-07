/** Deterministically binds reviewed catalog facts to current repository migration bytes. */
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { stableJson } from '../../src/scripts/a5-readonly-evidence.logic';
import type { ProductionA5SchemaObject } from '../../src/scripts/production-a5-evidence.logic';
import {
  buildProductionA5ReviewedManifestArtifact,
  readProductionA5RepositoryMigrationFiles,
} from './reviewed-manifest';

const MAX_CATALOG_BYTES = 32 * 1024 * 1024;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim() ?? '';
  if (value === '') throw new Error(`production_a5_${name.toLowerCase()}_required`);
  return value;
}

function schemaCatalog(path: string, label: string): ProductionA5SchemaObject[] {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_CATALOG_BYTES) {
    throw new Error(`production_a5_${label}_file_invalid`);
  }
  let value: unknown;
  try { value = JSON.parse(readFileSync(path, 'utf8')); } catch { throw new Error(`production_a5_${label}_json_invalid`); }
  if (!Array.isArray(value)) throw new Error(`production_a5_${label}_array_required`);
  return value as ProductionA5SchemaObject[];
}

function main(): void {
  const manifest = buildProductionA5ReviewedManifestArtifact({
    migrationFiles: readProductionA5RepositoryMigrationFiles(),
    preSchemaCatalogObjects: schemaCatalog(
      requiredEnv('PRODUCTION_A5_PRE_SCHEMA_CATALOG_PATH'), 'pre_schema_catalog',
    ),
    postSchemaCatalogObjects: schemaCatalog(
      requiredEnv('PRODUCTION_A5_POST_SCHEMA_CATALOG_PATH'), 'post_schema_catalog',
    ),
  });
  const bytes = `${stableJson(manifest)}\n`;
  writeFileSync(requiredEnv('PRODUCTION_A5_REVIEWED_MANIFEST_PATH'), bytes, { mode: 0o600, flag: 'wx' });
  process.stdout.write(bytes);
}

try { main(); } catch {
  console.error('Production A5 manifest generation failed: production_a5_manifest_generation_failed');
  process.exitCode = 1;
}
