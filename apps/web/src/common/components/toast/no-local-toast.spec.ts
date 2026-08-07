import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../features');
const legacyLocalToast = /function (ActionToast|Toast)\(/;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : extname(path) === '.tsx' ? [path] : [];
  });
}

test('features do not declare local toast components', () => {
  const offenders = sourceFiles(sourceRoot).filter((path) => legacyLocalToast.test(readFileSync(path, 'utf8')));
  assert.deepEqual(offenders, []);
});
