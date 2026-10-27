import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GHOST_CARDS, SECRET_CARD_BACK, STANDARD_CARD_BACK } from '../apps/web/src/features/public-home/home-halloween-cards';
import { embedHalloweenProvenance, makeHalloweenImageProvenance, readHalloweenProvenance } from '../apps/web/src/features/public-home/home-halloween-provenance';

// Local file labels only: no uploads, download records, or authenticity claims.
const root = fileURLToPath(new URL('..', import.meta.url));
const [command, ...files] = process.argv.slice(2);
try {
  if (command === 'stamp' && files.length === 0) {
    const assets = [
      ...GHOST_CARDS.map(card => ({ id: card.id, path: card.image, variant: 'card' as const })),
      { id: 'back-standard', path: STANDARD_CARD_BACK, variant: 'back' as const },
      { id: 'back-secret', path: SECRET_CARD_BACK, variant: 'back' as const },
    ];
    let changed = 0;
    for (const asset of assets) {
      const path = resolve(root, `apps/web/public${asset.path}`);
      const original = readFileSync(path);
      const marked = embedHalloweenProvenance(original, makeHalloweenImageProvenance(asset.id, asset.variant));
      if (!original.equals(marked)) { writeFileSync(path, marked); changed++; }
    }
    console.log(JSON.stringify({ marked: assets.length, changed, pixels: 'unchanged' }));
  } else if (command === 'inspect' && files.length) {
    for (const file of files) {
      const path = resolve(file);
      if (statSync(path).size > 20 * 1024 * 1024) throw new Error('File exceeds 20 MiB inspection limit');
      const metadata = readHalloweenProvenance(readFileSync(path));
      console.log(JSON.stringify({ file: path, status: metadata ? 'label-found' : 'no-label', metadata, authenticated: false }));
      if (!metadata) process.exitCode = 1;
    }
  } else {
    throw new Error('Usage: pnpm exec tsx scripts/halloween-image-origin.ts stamp | inspect <image.png|image.jpg> [...]');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
