import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { getGhostCard } from '../../../apps/web/src/features/public-home/home-halloween-cards';
import { embedHalloweenProvenance, makeHalloweenImageProvenance, readHalloweenProvenance } from '../../../apps/web/src/features/public-home/home-halloween-provenance';

const bytes = readFileSync(process.argv[2]);
const metadata = readHalloweenProvenance(bytes);
assert.ok(metadata?.proof);
const card = getGhostCard(metadata.cardId)!;
const original = readFileSync(new URL(`../../../apps/web/public${card.image}`, import.meta.url));
const normalized = embedHalloweenProvenance(bytes, makeHalloweenImageProvenance(card.id, 'card'));
assert.deepEqual(Buffer.from(normalized), original);
const payload = JSON.parse(Buffer.from(metadata.proof.payload, 'base64url').toString());
assert.equal(payload.cardId, card.id);
const result = { cardId: card.id, variant: metadata.variant, algorithm: metadata.proof.algorithm, keyId: metadata.proof.keyId,
  drawId: payload.drawId, source: metadata.source, signatureBytes: Buffer.from(metadata.proof.signature, 'base64url').length,
  originalAfterRemovingProofExactMatch: true, sha256: createHash('sha256').update(bytes).digest('hex'),
  signatureVerification: 'Trusted-key cryptography exercised in server/provenance tests; preview public key is not exported by this route.' };
writeFileSync(new URL('./download-readback.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
