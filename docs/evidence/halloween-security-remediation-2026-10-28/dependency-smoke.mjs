// Run from any directory: node /absolute/repo/docs/evidence/halloween-security-remediation-2026-10-28/dependency-smoke.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(join(root, 'apps/api/package.json'));
const cliPackage = require.resolve('@swc/cli/package.json');
const swc = createRequire(cliPackage);
const wrapper = createRequire(swc.resolve('@xhmikosr/bin-wrapper'));
const downloader = createRequire(wrapper.resolve('@xhmikosr/downloader'));
const { default: decompress } = await import(pathToFileURL(downloader.resolve('@xhmikosr/decompress')));
const { default: archiveType } = await import(pathToFileURL(downloader.resolve('@xhmikosr/archive-type')));
const temporary = mkdtempSync(join(tmpdir(), 'halloween-dependency-smoke-'));
try {
  execFileSync('python3', ['-c', `
import io, pathlib, sys, tarfile, zipfile
folder = pathlib.Path(sys.argv[1])
content = b'patched archive compatibility'
for suffix, mode in [('tar', 'w'), ('tar.gz', 'w:gz'), ('tar.bz2', 'w:bz2')]:
    with tarfile.open(folder / ('sample.' + suffix), mode, format=tarfile.USTAR_FORMAT) as archive:
        entry = tarfile.TarInfo('fixture.txt')
        entry.size = len(content)
        archive.addfile(entry, io.BytesIO(content))
with zipfile.ZipFile(folder / 'sample.zip', 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    archive.writestr('fixture.txt', content)
`, temporary]);
  console.log(`Node ${process.version}; SWC CLI ${swc('./package.json').version}`);
  for (const [suffix, extension] of [['tar', 'tar'], ['tar.gz', 'tar.gz'], ['tar.bz2', 'bz2'], ['zip', 'zip']]) {
    const input = readFileSync(join(temporary, `sample.${suffix}`));
    assert.equal((await archiveType(input))?.ext, extension);
    const files = await decompress(input);
    assert.equal(files.length, 1);
    assert.equal(files[0].path, 'fixture.txt');
    assert.equal(files[0].data.toString(), 'patched archive compatibility');
    console.log(`PASS detection and extraction: ${suffix}`);
  }
  const input = join(temporary, 'input');
  const output = join(temporary, 'compiled');
  mkdirSync(input);
  writeFileSync(join(input, 'value.ts'), 'export const patchedValue: number = 42;\n');
  const cli = join(dirname(cliPackage), swc('./package.json').bin.swc);
  execFileSync(process.execPath, [cli, '.', '--config-file', join(root, 'apps/api/.swcrc'), '-d', output, '--strip-leading-paths', '--out-file-extension', 'cjs'], { cwd: input, stdio: 'pipe' });
  assert.equal(require(join(output, 'value.cjs')).patchedValue, 42);
  console.log('PASS SWC directory compilation and emitted runtime export');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
