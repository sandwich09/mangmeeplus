import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../features');
const legacyInteractiveAccent = /(?:bg|border)-(?:blue|indigo|sky)-600|hover:bg-(?:blue|indigo|sky)-700|border-t-blue-600/;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : extname(path) === '.tsx' ? [path] : [];
  });
}

test('feature interactions use the Mangmee brand accent', () => {
  const offenders = sourceFiles(sourceRoot).filter((path) => legacyInteractiveAccent.test(readFileSync(path, 'utf8')));
  assert.deepEqual(offenders, []);
});
