import sharp from 'sharp';

/**
 * Certification refuses a signature image over 2 MB (`loadOwnedSignature` in
 * substitute-receipt.use-case), while LINE intake accepts 10 MB. A phone photo therefore lands in
 * the library and then cannot sign anything, with nothing in either message explaining why.
 */
export const SIGNATURE_MAX_BYTES = 2_000_000;

/** Widest edge kept, then a second, smaller attempt if the first still busts the budget. */
const SIGNATURE_EDGES = [1600, 1000];

/** Paper, on the normalised luminance mask below. The web canvas uses the same number. */
const BACKGROUND_THRESHOLD = 235;

const MAX_INPUT_PIXELS = 40_000_000;

export type SignatureImage = { bytes: Buffer; mimeType: 'image/png' | 'image/jpeg' };

/**
 * Fits a signature image into what certification will accept, and — when asked — makes its paper
 * transparent so it does not print as an opaque rectangle across the certificate.
 *
 * `removeBackground` always returns PNG (JPEG has no alpha channel at all, which is the whole
 * reason a LINE photo needed this). Without it the source mime is preserved unless the smaller
 * re-encode is the only way under the budget.
 *
 * Returns undefined when sharp cannot read the bytes, AND when no attempt lands under
 * `SIGNATURE_MAX_BYTES`: a derived image the certify gate would refuse is worse than none, because
 * the reusable-signature lookup prefers the derived attachment over the perfectly good original.
 * Callers treat undefined as "keep the original" — this is polish, and losing it must never lose
 * the upload.
 */
export async function normalizeSignatureImage(
  bytes: Buffer,
  mimeType: string,
  options: { removeBackground: boolean },
): Promise<SignatureImage | undefined> {
  for (const edge of SIGNATURE_EDGES) {
    try {
      const encoded = options.removeBackground
        ? await encodeTransparent(bytes, edge)
        : await encodeOpaque(bytes, mimeType, edge);
      if (encoded && encoded.bytes.byteLength <= SIGNATURE_MAX_BYTES) return encoded;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function resized(bytes: Buffer, edge: number): ReturnType<typeof sharp> {
  return sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate() // EXIF orientation: a sideways phone photo signs sideways otherwise.
    .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' });
}

/**
 * Two renditions of the same resize: the colours to keep, and a separate single-channel mask that
 * decides what is paper.
 *
 * The mask is greyscale FIRST, then normalised. Normalising the colour image instead applies one
 * shared scale to all three channels, so a warm phone photo keeps its blue deficit — and an
 * all-three-channels test then lets the blue channel alone decide, which on real paper
 * (around [246,247,236]) erases almost nothing. Collapsing to luminance before stretching makes a
 * colour cast structurally unable to gate the mask.
 *
 * ponytail: a global threshold on normalised luminance. Ceiling: a heavy shadow or a coloured
 * tablecloth in frame drags the stretch and leaves speckle; upgrade to an adaptive/Otsu threshold
 * if real samples come back dirty.
 */
async function encodeTransparent(bytes: Buffer, edge: number): Promise<SignatureImage | undefined> {
  const [colour, mask] = await Promise.all([
    resized(bytes, edge).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    resized(bytes, edge).greyscale().normalise().raw().toBuffer({ resolveWithObject: true }),
  ]);
  const pixels = mask.info.width * mask.info.height;
  // Same source and same resize options, so this cannot differ — but reading past the end of the
  // mask would silently produce garbage alpha, and garbage alpha signs legal documents.
  if (colour.data.length !== pixels * 4 || mask.data.length !== pixels) return undefined;
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    if (mask.data[pixel]! >= BACKGROUND_THRESHOLD) colour.data[(pixel * 4) + 3] = 0;
  }
  const png = await sharp(colour.data, { raw: { width: colour.info.width, height: colour.info.height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return { bytes: png, mimeType: 'image/png' };
}

async function encodeOpaque(bytes: Buffer, mimeType: string, edge: number): Promise<SignatureImage> {
  const pipeline = resized(bytes, edge);
  if (mimeType === 'image/png') {
    const png = await pipeline.png({ compressionLevel: 9 }).toBuffer();
    // A photographic PNG can stay over budget at any sane edge; JPEG is the only honest way down,
    // and both mimes are equally acceptable to certification and to the reusable-signature lookup.
    if (png.byteLength <= SIGNATURE_MAX_BYTES) return { bytes: png, mimeType: 'image/png' };
    return { bytes: await resized(bytes, edge).jpeg({ quality: 82 }).toBuffer(), mimeType: 'image/jpeg' };
  }
  return { bytes: await pipeline.jpeg({ quality: 82 }).toBuffer(), mimeType: 'image/jpeg' };
}
