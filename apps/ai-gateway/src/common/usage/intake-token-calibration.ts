// Finite empirical calibration, not a tokenizer ratio for arbitrary Thai/ASCII/JSON.
// Evidence and limits: docs/specs/line-ai-credit-levers-20261019.md.
import { createHash } from 'node:crypto';
import type { ProviderInput, ProviderToolsInput } from '../../modules/line-ai/infrastructure/provider/provider.port';

export const INTAKE_CALIBRATION_MODEL = 'global.anthropic.claude-sonnet-4-6';
export const INTAKE_CONSTANT_CALIBRATIONS = [
  {
    "digest": "1239bb8e4d0a8bb627c2af19c048931f33455f0857581a65b2a3644fc6ba5fae",
    "bytes": 66609,
    "tokenBound": 26681
  },
  {
    "digest": "8fdc539be3ca76063b05343c87cbf7b633a4f105834f2ba3cc5df8ac5fddf9aa",
    "bytes": 61057,
    "tokenBound": 26681
  },
  // C72 plain-word maintenance: +11 bytes per mode, same model and catalogue vocabulary.
  {
    "digest": "10a36aeb41e500cbac41dc6e4237b95ced82879366d6c2622e9fcbeab308f691",
    "bytes": 66620,
    "tokenBound": 26686
  },
  {
    "digest": "b0faf4398de09ccc8811e2e4e2e9d2f0ebbe1c2fba530179f4d368e633bbe607",
    "bytes": 61068,
    "tokenBound": 26686
  }
] as const;
// Exact reviewed catalogue vocabulary; new/edited entries retain their full byte bound.
const REVIEWED_FEATURE_DIGESTS = new Set([
  "07d6e44477d05d0c22d7513469ba8fd95e15d4680b94136558d5657ec73250d1",
  "09fc08014c1b8f1cc7d1fe13fbc240213d0278d87a4f8fa7b685e7aca3cfa6f2",
  "0dde270376efafa0cb0712a18053bba4cb6644d160438e0733704b68182802a7",
  "1f8f3cff10f80f9ad872794c6481e5b18f3fed49e74cfe74c5b7b6b032f9190d",
  "25004c8a9fa2de39e27eff7c5bdf9a5cd0a2c7cc489651193545b15dfc5fb297",
  "2a1fb65a87f261b918760bd2958cb17dabbe49a5b3d5c283662db6a230f2269d",
  "2cffa6a247e18a09e9fa002a9e797e32f341ff40d3338034e15b18b4c7f0d999",
  "2f4e5ad185d6d666e8c8074a0d58897ea7fd99b2f742444b257b260d55a41a50",
  "38a4399bfc26c794012af8b4bfcc93d47c8c9aee212ec2219a1819699f345a5c",
  "3d4e8b0d128d41def3fb47de12975904ef637f145cd77c77f8c06814f124c092",
  "3dedcd0da3b16f99cfaa0563d7409ed0973a9d9e439eba64c17d542a4e8f2367",
  "48e45c7b1518e94c8dd32ab05794024e520b29421c1d2d6df8e0f69103ba4932",
  "4986f5e523a65798f16d2b3f7f5b9a64f1c533ed5b41974be93ce120d6307fb9",
  "52965ffd26ff0e63338c687e42a6e1aed1a6d4432f6f7a50a6623d4b2077616b",
  "55af69ed347ed0c71ed58a5dd190fafbe7ad3cacb9f7e59473273181acd32e27",
  "5dc8468c0aec33f078768b48e6be29a79dcd39345c09c18df96ade26c4397389",
  "6b9edcaa1c518f42b5f6b484da47a6f3c2e73ff69bfbe1f92fed2eb30f02e97a",
  "6fcd307d7fb7d72b7af4940c23c28ebb1d88706c7db9e75dd10d8f9ca279aa73",
  "7ca33c6d2699d86ce32aa027c2294cb1dd5883360305ef43c79333ea547bc005",
  "8142528c9473f86f8d0bb5aba4f2b60668ae9807d7439c74b82d6665e8881346",
  "8688cb05181a774798533064d39e25b829442897f51f8fcdb643900c505f6282",
  "8b363d035b3fe86586085697fe91dce19a13a4c76a7a67c3f7166c9a6676d1cf",
  "92c899803f8dc675521a6a2a4c401f40c5edb57d9309a1b02ed9c843db30a95f",
  "9467ea7248a205e3f2c5647ebfd35d922224ae1fa9b43d6855bb09592139b16b",
  "9cc8350351a6d2ffd06d347704a1efe8fd4ea8adf4b545cb07be0390a9c52b9e",
  "a9f5505a388980fc9506fd6ecb10e8d9d477d4368c97d03dfa65c9d386d86090",
  "b53358b4e573645cfedca1da8accab18a646e757d146ce7a17ad3a24892d3b06",
  "b7751c45a294a32ddf3e9fc616790080c5d13a63a6635679140236b4fdc1900e",
  "ba6a27f8bd7acbf605cb91df0ee132d17302f5210c7f9968066318efcc83bc6a",
  "c1daf24c6ec10b3ef7cd7721ed437e421b98de9f2fc5238a3ecd8e86763107e0",
  "c8f039920beb8e9b54206c2c8649769f8ef718dfb97e86da5cce877de234d09d",
  "da1b7cf928a6a3bf9c9c84f872df1d603b0df426e3343b1943bd7e6fe761328a"
]);
export const REVIEWED_CATALOGUE_TOKEN_BOUND = Math.ceil(7_005 * 32_768 / 23_655);

export function calibrationJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(calibrationJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${calibrationJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
const bytes = (value: unknown): number => Buffer.byteLength(calibrationJson(value), 'utf8');
const digest = (value: unknown): string => createHash('sha256').update(calibrationJson(value)).digest('hex');

export function intakeConstantParts(input: Pick<ProviderInput, 'systemPrompt' | 'cacheableContext'>): {
  digest: string; bytes: number; text: string; variable: Record<string, unknown>;
} | undefined {
  try {
    const { businessGlossary, chatActions, ...variable } = JSON.parse(input.cacheableContext ?? '');
    if (!Array.isArray(businessGlossary) || !Array.isArray(chatActions)) return undefined;
    const constant = { systemPrompt: input.systemPrompt ?? '', businessGlossary, chatActions };
    return { digest: digest(constant), bytes: bytes(constant), text: calibrationJson(constant), variable };
  } catch { return undefined; }
}

export function calibratedIntakeTextBound(input: ProviderInput | ProviderToolsInput, modelId: string): number | undefined {
  // Haiku 5.5 has no paired calibration evidence. v2RenderedInput retains full UTF-8 bytes.
  if (modelId !== INTAKE_CALIBRATION_MODEL || input.usageTag !== 'line.intake-route' || 'tools' in input) return undefined;
  const parts = intakeConstantParts(input);
  const calibration = INTAKE_CONSTANT_CALIBRATIONS.find(row => row.digest === parts?.digest);
  if (!parts || !calibration) return undefined;
  let variableBound = bytes(calibrationJson(parts.variable));
  const { enabledFeatures, ...other } = parts.variable;
  if (Array.isArray(enabledFeatures) && Array.isArray(parts.variable.disabledFeatures) && parts.variable.disabledFeatures.length === 0) {
    const reviewed = enabledFeatures.filter(feature => REVIEWED_FEATURE_DIGESTS.has(digest(feature)));
    // A duplicate or arbitrary catalogue cannot inherit evidence for a permission-filtered subset.
    if (new Set(reviewed.map(digest)).size === reviewed.length) {
      const unfamiliar = enabledFeatures.filter(feature => !REVIEWED_FEATURE_DIGESTS.has(digest(feature)));
      variableBound = bytes(calibrationJson(other))
        + Math.min(bytes(calibrationJson(reviewed)), REVIEWED_CATALOGUE_TOKEN_BOUND)
        + bytes(calibrationJson(unfamiliar));
    }
  }
  return calibration.tokenBound + variableBound + bytes({ messages: input.messages });
}

/** Small reviewed edits only. Large/mixed/model/semantic changes require paired live evidence. */
export function scaleIntakeCalibration(old: { bytes: number; tokenBound: number }, newBytes: number): number {
  if (old.bytes <= 0 || !Number.isSafeInteger(newBytes) || newBytes <= 0 || newBytes > old.bytes * 1.1) {
    throw new Error('Live measurement required: constant parts grew more than 10% or byte counts are invalid.');
  }
  return Math.ceil(old.tokenBound * Math.max(1, newBytes / old.bytes));
}
