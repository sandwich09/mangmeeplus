#!/usr/bin/env tsx
/**
 * Capture read benchmark (contract appendix §15 item 5, plan W08 "A75–A82 ต้องมีผลจริง").
 *
 * Every wave before this one proved the capture reader against fakes. This script is the opposite:
 * it builds the synthetic fixtures of appendix §13 at run time and drives them through the REAL
 * pipeline in-process — W03's `planCapturePreprocessing`, the gateway's own `capture-read` and
 * `capture-extract` handlers against a real `BedrockProvider`, W03's `planWindows`, and W03's
 * `assembleCaptureObservations`. No API, no database, no HTTP, no LINE: only the model calls are
 * real, and the fixtures are generated here so nothing of a customer's ever reaches a provider.
 *
 * NEVER run in CI. It spends real money.
 *
 * Run it from `apps/ai-gateway` (that workspace's tsconfig carries `experimentalDecorators`, which
 * the Nest controller needs, and its `pnpm exec` resolves `sharp`):
 *
 *   cd apps/ai-gateway
 *   MODEL_PROVIDER=bedrock AWS_PROFILE=watchdog-bedrock AWS_SDK_LOAD_CONFIG=1 \
 *     BEDROCK_REGION=ap-southeast-1 BEDROCK_MODEL_ID=global.anthropic.claude-sonnet-4-6 \
 *     pnpm exec tsx ../../scripts/expense-capture-read-benchmark.ts --label capture-read --out <dir>
 *
 * Options:
 *   --smoke           2-page fixture only, guarded at THB 2. Proves credentials and the whole chain.
 *   --only a,b,c      run these fixture ids only.
 *   --max-thb X       hard stop (default 100). The guard counts THIS TASK's prior ledger spend too,
 *                     so re-running cannot walk past the authorised total one run at a time.
 *   --thb-per-usd X   fixed FX for pricing (default 33) — the same number the intake benchmark uses.
 *   --out DIR         output directory (default ./.capture-read-out); one JSONL + one summary.
 *   --ledger FILE     cumulative spend ledger appended by every run.
 *   --label NAME      run label, also the ledger prefix the guard sums (default capture-read).
 *   --dry-run         build the fixtures and print their shape WITHOUT any provider call.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import sharp from 'sharp';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import {
  EXPENSE_CAPTURE_CONTRACT_VERSION,
  type ExpenseCaptureAssembledObservations,
  type ExpenseCaptureObservations,
} from '@watchdog-bms/contracts';
import {
  documentPageLines, expectationOf, fixtureMimeType, fixtureSpecs, scoreFixture,
  type FixtureScore, type FixtureSpec, type PlannedDocument,
} from './expense-capture-read.fixtures';
import { LineAiInternalController } from '../apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller';
import { BedrockProvider } from '../apps/ai-gateway/src/modules/line-ai/infrastructure/provider/bedrock.provider';
import { drainUsage, runWithUsageContext } from '../apps/ai-gateway/src/common/usage/usage-context';
import { computeCostSatang } from '../apps/api/src/modules/line-ai/application/ai-model-pricing';
import {
  planCapturePreprocessing,
  type CaptureChunkPlan,
} from '../apps/api/src/modules/expenses/domain/logic/expense-capture-preprocess.logic';
import { assembleCaptureObservations, planWindows, priorDocuments } from '../apps/api/src/modules/expenses/domain/logic/expense-capture-assembly.logic';

// ── options ──────────────────────────────────────────────────────────────────

const flag = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const has = (name: string): boolean => process.argv.includes(`--${name}`);

const OPTS = {
  only: (flag('only') ?? '').split(',').map((value) => value.trim()).filter(Boolean),
  /**
   * Real files instead of the synthetic fixtures: `--files a.pdf,b.jpg`. No expectation, so no score —
   * the record carries what the reader assembled (documents, issuers, totals) for a person to judge.
   * Same preprocessing, same gateway routes, same spend guard and ledger as a fixture run.
   */
  files: (flag('files') ?? '').split(',').map((value) => value.trim()).filter(Boolean),
  maxThb: Number(flag('max-thb') ?? '100'),
  thbPerUsd: Number(flag('thb-per-usd') ?? '33'),
  out: resolve(flag('out') ?? '.capture-read-out'),
  label: flag('label') ?? 'capture-read',
  smoke: has('smoke'),
  dryRun: has('dry-run'),
};
const LEDGER = resolve(flag('ledger') ?? join(dirname(OPTS.out), 'spend-ledger.jsonl'));
const MAX_PAGES = 60;

// ── fixture rendering ────────────────────────────────────────────────────────

async function buildTextPdf(spec: FixtureSpec): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Courier);
  const pagesPerDocument = Math.max(1, Math.floor(spec.pages / spec.documents.length));
  for (const document of spec.documents) {
    for (const lines of documentPageLines(document, pagesPerDocument)) {
      const page = pdf.addPage([595, 842]);
      lines.forEach((line, index) => {
        page.drawText(line, { x: 42, y: 790 - index * 15, size: 10, font, color: rgb(0.06, 0.06, 0.06) });
      });
    }
  }
  return Buffer.from(await pdf.save());
}

/** A page of "scanned" paper: sharp rasterises the SVG (Thai included) and adds grain, so the
 *  result is a photograph of printing rather than a text layer the reader could cheat with. */
async function scanPageJpeg(
  document: PlannedDocument,
  lines: string[],
  { width, height, quality, grainAmplitude, type }: {
    width: number; height: number; quality: number; grainAmplitude: number;
    /** W10 D3: the printed type GEOMETRY, so a low-resolution fixture really is hard to read.
     *  The default is the original page: 34 px rows from y=170, a 44 px shop name at y=100. */
    type?: { x: number; headerY: number; headerSize: number; firstLineY: number; body: number; step: number };
  },
): Promise<Buffer> {
  const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const size = type ?? { x: 90, headerY: 100, headerSize: 44, firstLineY: 170, body: 34, step: 62 };
  const body = lines.map((line, index) =>
    `<text x="${size.x}" y="${size.firstLineY + index * size.step}" font-size="${size.body}" font-family="monospace" fill="#101010" xml:space="preserve">${escape(line)}</text>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
    + `<rect width="${width}" height="${height}" fill="#fbfaf6"/>`
    + `<text x="${size.x}" y="${size.headerY}" font-size="${size.headerSize}" font-family="sans-serif" fill="#101010">${escape(document.issuer)}</text>`
    + `${body}</svg>`;
  const page = await sharp(Buffer.from(svg)).png().toBuffer();
  // Grain: without it a flat synthetic page compresses to a few hundred KB and the fixture would
  // not be the ~10 MB original the size rules of A75/A76 are about.
  const grain = Buffer.alloc(width * height * 3);
  const floor = 128 - grainAmplitude / 2;
  for (let index = 0; index < grain.length; index += 1) grain[index] = floor + ((Math.random() * grainAmplitude) | 0);
  return sharp(page)
    .composite([{ input: grain, raw: { width, height, channels: 3 }, blend: 'overlay' }])
    .jpeg({ quality, chromaSubsampling: '4:4:4' })
    .toBuffer();
}

async function buildScanPdf(spec: FixtureSpec): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const pageLines = documentPageLines(spec.documents[0]!, spec.pages);
  for (const lines of pageLines) {
    // ~1.85 MB a page, so the file lands near the ~9.9 MB of appendix §13 and stays inside the
    // product's own 10 MiB original bound.
    const jpeg = await scanPageJpeg(spec.documents[0]!, lines, { width: 2400, height: 3400, quality: 97, grainAmplitude: 105 });
    const image = await pdf.embedJpg(jpeg);
    const page = pdf.addPage([595, 842]);
    page.drawImage(image, { x: 0, y: 0, width: 595, height: 842 });
  }
  return Buffer.from(await pdf.save());
}

/** One page whose natural long edge is 8,500 pt: `renderLongEdgePx / 8500 < tileScaleFloor`, so
 *  W03 must read it as an overview plus 2xN tiles rather than shrink the printing away (A76). */
async function buildBigPagePdf(spec: FixtureSpec): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const lines = documentPageLines(spec.documents[0]!, 1)[0]!;
  // Over `scannedPageBytes`, so W03 must RENDER this page instead of shipping it as a document
  // block — which is the only way the tiling decision below is ever reached.
  const jpeg = await scanPageJpeg(spec.documents[0]!, lines, { width: 4400, height: 1500, quality: 100, grainAmplitude: 160 });
  const image = await pdf.embedJpg(jpeg);
  const page = pdf.addPage([8500, 2800]);
  page.drawImage(image, { x: 0, y: 0, width: 8500, height: 2800 });
  return Buffer.from(await pdf.save());
}

/**
 * W10 D3: the 896x533 screenshot lane — the size of the real Leceipt sample whose whole totals block
 * came back untranscribed. The type is deliberately ~8-11 px, so this fixture is only legible once
 * `planCapturePreprocessing` has enlarged it to the declared legibility floor.
 */
async function buildLowResScan(spec: FixtureSpec): Promise<Buffer> {
  const lines = documentPageLines(spec.documents[0]!, 1)[0]!;
  return scanPageJpeg(spec.documents[0]!, lines, {
    width: 896, height: 533, quality: 88, grainAmplitude: 12,
    type: { x: 24, headerY: 22, headerSize: 15, firstLineY: 46, body: 11, step: 24 },
  });
}

async function buildFixture(spec: FixtureSpec): Promise<Buffer> {
  if (spec.kind === 'scan-pdf') return buildScanPdf(spec);
  if (spec.kind === 'big-page-pdf') return buildBigPagePdf(spec);
  if (spec.kind === 'low-res-scan') return buildLowResScan(spec);
  return buildTextPdf(spec);
}

// ── gateway wiring (duck-typed config, exactly the getters the routes read) ───

const ENV = {
  modelProvider: process.env['MODEL_PROVIDER'] ?? 'disabled',
  bedrockRegion: process.env['BEDROCK_REGION'],
  bedrockModelId: process.env['BEDROCK_MODEL_ID'],
  documentAiModelId: process.env['DOCUMENT_AI_MODEL_ID'] ?? process.env['BEDROCK_MODEL_ID'],
};
const INTERNAL_SECRET = 'capture-read-benchmark-secret';
const config = {
  modelProvider: ENV.modelProvider,
  bedrockRegion: ENV.bedrockRegion,
  bedrockModelId: ENV.bedrockModelId,
  documentAiModelId: ENV.documentAiModelId,
  openAiApiKey: undefined,
  openAiModel: '',
  openAiProcessingRegion: undefined,
  approvedAiProviders: [ENV.modelProvider],
  approvedAiModelIds: [...new Set([ENV.bedrockModelId, ENV.documentAiModelId].filter(Boolean))] as string[],
  approvedAiRegions: [ENV.bedrockRegion].filter(Boolean) as string[],
  aiGatewayInternalSecret: INTERNAL_SECRET,
} as never;

const chunkPayload = (chunk: CaptureChunkPlan) => ({
  id: chunk.id,
  kind: chunk.kind,
  mimeType: chunk.mimeType,
  pageIndexes: chunk.pageIndexes,
  fileLabel: 'benchmark-file',
  ...(chunk.bytes ? { contentBase64: chunk.bytes.toString('base64') } : {}),
  ...(chunk.images ? {
    images: chunk.images.map((image) => ({
      contentBase64: image.bytes.toString('base64'), mimeType: image.mimeType, role: image.role, index: image.index,
    })),
  } : {}),
});

// ── run ──────────────────────────────────────────────────────────────────────

type FixtureRecord = {
  runId: string;
  label: string;
  fixtureId: string;
  proves: string;
  fileBytes: number;
  pageCount: number;
  chunks: number;
  chunkKinds: string[];
  windows: number;
  providerCalls: number;
  inputTokens: number;
  outputTokens: number;
  costSatang: number;
  costThb: string;
  wallMs: number;
  blankPages: number;
  failedChunks: number;
  score: FixtureScore | null;
  errors: string[];
  /** The assembled facts themselves. Synthetic input, so this is auditable without any privacy
   *  question — and a score with no facts behind it is not evidence. */
  assembled: ExpenseCaptureAssembledObservations;
  /** `--files` only: what the read route transcribed per page, so a missed total can be traced to
   *  the transcription or to the extraction. Never persisted for a synthetic fixture (no need). */
  pageText?: Record<string, string>;
};

const thb = (value: number): string => (value / 100).toFixed(2);

/** A real file on disk (`--files`): its bytes and mime are what a customer would have sent. */
type ExternalSpec = { id: string; proves: string; external: { path: string; mimeType: string } };
type RunSpec = FixtureSpec | ExternalSpec;
const isExternal = (spec: RunSpec): spec is ExternalSpec => 'external' in spec;

function externalSpecs(paths: string[]): ExternalSpec[] {
  const mimeByExtension: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };
  return paths.map((path) => {
    const extension = path.toLowerCase().split('.').pop() ?? '';
    const mimeType = mimeByExtension[extension];
    if (!mimeType) throw new Error(`--files: unsupported extension on ${path} (pdf, jpg, jpeg, png)`);
    if (!existsSync(path)) throw new Error(`--files: ${path} does not exist`);
    const id = path.split('/').pop()!.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 40);
    return { id, proves: `external: ${path.split('/').pop()}`, external: { path: resolve(path), mimeType } };
  });
}

/** What a real file yielded, for the console and the report: no score, only the assembled facts. */
function factsLine(assembled: ExpenseCaptureAssembledObservations): string {
  const docs = assembled.documents.map((document) => {
    const total = assembled.totals.find((row) => row.documentRef === document.ref && row.kind === 'document_total')?.amount ?? '?';
    const items = assembled.items.filter((row) => row.documentRef === document.ref).length;
    return `${document.kind}${document.issuer?.name ? ` «${document.issuer.name}»` : ''}${document.documentNumber ? ` #${document.documentNumber}` : ''}${document.documentDate ? ` ${document.documentDate}` : ''} total=${total} items=${items}`;
  });
  const diffs = assembled.reconciliation.filter((row) => row.status !== 'ok').length;
  return `docs=${assembled.documents.length}${assembled.multiDocument ? ' (multi)' : ''} [${docs.join(' | ')}] reconciliationIssues=${diffs}`;
}

async function runFixture(controller: LineAiInternalController, spec: RunSpec, runId: string): Promise<FixtureRecord> {
  const startedAt = Date.now();
  const errors: string[] = [];
  const bytes = isExternal(spec) ? readFileSync(spec.external.path) : await buildFixture(spec);
  const mimeType = isExternal(spec) ? spec.external.mimeType : fixtureMimeType(spec);
  const plan = await planCapturePreprocessing(bytes, mimeType, { maxPages: MAX_PAGES });
  if (plan.failure) errors.push(`preprocess:${plan.failure}`);

  const pages: Record<string, { text: string; truncated?: boolean; blank?: boolean }> = {};
  const windowObservations: Record<string, ExpenseCaptureObservations> = {};
  let failedChunks = 0;
  let blankPages = 0;

  const usage = await runWithUsageContext({ companyId: 'capture-read-benchmark' }, async () => {
    for (const chunk of plan.chunks) {
      const read = await controller.captureRead(INTERNAL_SECRET, {
        requestId: `${runId}:${spec.id}:${chunk.id}`, companyId: 'co-benchmark', userId: 'user-benchmark',
        contractVersion: EXPENSE_CAPTURE_CONTRACT_VERSION, chunk: chunkPayload(chunk) as never,
      });
      if (read.status !== 'ok' || !read.pages) {
        failedChunks += 1;
        errors.push(`read:${chunk.id}:${read.errorCode ?? read.status}`);
        continue;
      }
      for (const page of read.pages) {
        if (page.blank) blankPages += 1;
        pages[String(page.pageIndex)] = {
          text: page.text, ...(page.truncated ? { truncated: true } : {}), ...(page.blank ? { blank: true } : {}),
        };
      }
    }
    for (const window of planWindows(pages)) {
      const extracted = await controller.captureExtract(INTERNAL_SECRET, {
        requestId: `${runId}:${spec.id}:${window.id}`, companyId: 'co-benchmark', userId: 'user-benchmark',
        contractVersion: EXPENSE_CAPTURE_CONTRACT_VERSION,
        window: {
          fileLabel: spec.id, pageIndexes: window.pageIndexes, pages: window.pages,
          ...(priorDocuments(windowObservations).length > 0 ? { priorDocuments: priorDocuments(windowObservations) } : {}),
        },
      });
      if (extracted.status !== 'ok' || !extracted.observations) {
        errors.push(`extract:${window.id}:${extracted.errorCode ?? extracted.status}`);
        continue;
      }
      windowObservations[window.id] = extracted.observations;
    }
    return drainUsage();
  });

  const assembled = assembleCaptureObservations(
    Object.entries(windowObservations).map(([id, observations]) => ({ id, observations })),
    { pageCount: plan.pageCount },
  );
  const costSatang = usage.reduce((sum, entry) => sum + computeCostSatang(entry, OPTS.thbPerUsd).costSatang, 0);
  return {
    runId, label: OPTS.label, fixtureId: spec.id, proves: spec.proves,
    fileBytes: bytes.byteLength, pageCount: plan.pageCount,
    chunks: plan.chunks.length, chunkKinds: plan.chunks.map((chunk) => chunk.kind),
    windows: Object.keys(windowObservations).length,
    providerCalls: usage.length,
    inputTokens: usage.reduce((sum, entry) => sum + (entry.inputTokens ?? 0), 0),
    outputTokens: usage.reduce((sum, entry) => sum + (entry.outputTokens ?? 0), 0),
    costSatang, costThb: thb(costSatang),
    wallMs: Date.now() - startedAt,
    blankPages, failedChunks,
    score: !isExternal(spec) && Object.keys(windowObservations).length > 0 ? scoreFixture(expectationOf(spec), assembled) : null,
    errors,
    assembled,
    ...(isExternal(spec) ? { pageText: Object.fromEntries(Object.entries(pages).map(([index, page]) => [index, page.text])) } : {}),
  };
}

function ledgerTaskSatang(): number {
  if (!existsSync(LEDGER)) return 0;
  return readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean).reduce((total, line) => {
    try {
      const row = JSON.parse(line) as { label?: string; costSatang?: number };
      // THIS task's spend only: the ledger is shared with earlier authorised benchmarks.
      return String(row.label ?? '').startsWith(OPTS.label) ? total + (row.costSatang ?? 0) : total;
    } catch { return total; }
  }, 0);
}

function appendLedger(runId: string, costSatang: number, calls: number): void {
  mkdirSync(dirname(LEDGER), { recursive: true });
  appendFileSync(LEDGER, `${JSON.stringify({
    at: new Date().toISOString(), runId, label: OPTS.label, calls, costSatang, thbPerUsd: OPTS.thbPerUsd,
  })}\n`);
}

function gitRevision(): string {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return 'unknown'; }
}

function markdown(records: FixtureRecord[]): string {
  const header = '| Fixture | Proves | Bytes | Pages | Chunks (kind) | Windows | Calls | In/Out tokens | THB | Docs | Items | Totals | Discount/VAT/Reconciled | Missing-pages | Wall |';
  const rows = records.map((record) => {
    const score = record.score;
    return `| ${record.fixtureId} | ${record.proves} | ${record.fileBytes.toLocaleString()} | ${record.pageCount} `
      + `| ${record.chunks} (${[...new Set(record.chunkKinds)].join('+') || '-'}) | ${record.windows} | ${record.providerCalls} `
      + `| ${record.inputTokens.toLocaleString()} / ${record.outputTokens.toLocaleString()} | ${record.costThb} `
      + `| ${score ? `${score.documentsFound}/${score.documentsExpected}` : '-'} `
      + `| ${score ? `${score.itemsFound}/${score.itemsExpected}` : '-'} `
      + `| ${score ? `${score.totalsMatched}/${score.totalsExpected}` : '-'} `
      + `| ${score ? `${score.discountsMatched}/${score.discountsExpected} · ${score.vatMatched}/${score.vatExpected} · ${score.reconciledDocuments}/${score.reconciledDocumentsExpected}` : '-'} `
      + `| ${score ? `${score.suspectedMissingPages} (want ${score.suspectedMissingPagesExpected})` : '-'} `
      + `| ${(record.wallMs / 1000).toFixed(1)}s |`
      + (record.proves.startsWith('external:') ? `\n| | ${factsLine(record.assembled).replace(/\|/g, '/')} | | | | | | | | | | | | | |` : '');
  });
  return `${[header, '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|', ...rows].join('\n')}\n`;
}

async function main(): Promise<void> {
  mkdirSync(OPTS.out, { recursive: true });
  const specs: RunSpec[] = OPTS.files.length > 0 ? externalSpecs(OPTS.files) : fixtureSpecs().filter((spec) => {
    if (OPTS.smoke) return spec.id === 'FX-PDF-02';
    return OPTS.only.length === 0 || OPTS.only.includes(spec.id);
  });
  if (specs.length === 0) throw new Error('no fixtures selected');

  if (OPTS.dryRun) {
    for (const spec of specs) {
      const bytes = isExternal(spec) ? readFileSync(spec.external.path) : await buildFixture(spec);
      const mimeType = isExternal(spec) ? spec.external.mimeType : fixtureMimeType(spec);
      const plan = await planCapturePreprocessing(bytes, mimeType, { maxPages: MAX_PAGES });
      if (!isExternal(spec)) writeFileSync(join(OPTS.out, `${spec.id}.${mimeType === 'image/jpeg' ? 'jpg' : 'pdf'}`), bytes);
      console.log(JSON.stringify({
        id: spec.id, mimeType, bytes: bytes.byteLength, pageCount: plan.pageCount, failure: plan.failure ?? null,
        chunks: plan.chunks.map((chunk) => ({ id: chunk.id, kind: chunk.kind, pages: chunk.pageIndexes, bytes: chunk.byteLength })),
        expect: isExternal(spec) ? null : expectationOf(spec),
      }));
    }
    return;
  }

  if (ENV.modelProvider !== 'bedrock') throw new Error('set MODEL_PROVIDER=bedrock for a real measurement run');
  if (!ENV.bedrockRegion || !ENV.bedrockModelId) throw new Error('BEDROCK_REGION and BEDROCK_MODEL_ID are required');
  // Touch the provider constructor once so a credential problem fails before any fixture is built.
  void new BedrockProvider({ region: ENV.bedrockRegion, modelId: ENV.bedrockModelId, timeoutMs: 10_000 });

  // Two ceilings, because they answer different questions. The TASK ceiling is the authorisation
  // (appendix §15 item 5) and counts every run this task has already paid for; the RUN ceiling is
  // what `--smoke` promises about THIS invocation, and a smoke after a smoke must still be allowed.
  const taskCeilingSatang = OPTS.maxThb * 100;
  const runCeilingSatang = OPTS.smoke ? 200 : taskCeilingSatang;
  const priorSatang = ledgerTaskSatang();
  if (priorSatang >= taskCeilingSatang) {
    throw new Error(`spend guard: this task has already spent THB ${thb(priorSatang)} of ${thb(taskCeilingSatang)}`);
  }
  const maxSatang = taskCeilingSatang;

  const controller = new LineAiInternalController(config, { execute: async () => { throw new Error('unused'); } } as never);
  const runId = `${OPTS.label}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const jsonlPath = join(OPTS.out, `${runId}.jsonl`);
  const records: FixtureRecord[] = [];
  let spentSatang = 0;
  let stopped = false;

  for (const spec of specs) {
    if (priorSatang + spentSatang >= taskCeilingSatang || spentSatang >= runCeilingSatang) {
      stopped = true;
      console.log(`SKIPPED ${spec.id}: spend guard reached`);
      continue;
    }
    const record = await runFixture(controller, spec, runId);
    spentSatang += record.costSatang;
    records.push(record);
    appendFileSync(jsonlPath, `${JSON.stringify(record)}\n`);
    const score = record.score;
    console.log(`${record.fixtureId.padEnd(18)} calls=${String(record.providerCalls).padStart(2)} THB=${record.costThb.padStart(6)} `
      + `docs=${score ? `${score.documentsFound}/${score.documentsExpected}` : '-'} `
      + `items=${score ? `${score.itemsFound}/${score.itemsExpected}` : '-'} `
      + `totals=${score ? `${score.totalsMatched}/${score.totalsExpected}` : '-'} `
      + `disc=${score ? `${score.discountsMatched}/${score.discountsExpected}` : '-'} `
      + `vat=${score ? `${score.vatMatched}/${score.vatExpected}` : '-'} `
      + `rec=${score ? `${score.reconciledDocuments}/${score.reconciledDocumentsExpected}` : '-'} `
      + `${(record.wallMs / 1000).toFixed(1)}s cumulative=THB ${thb(priorSatang + spentSatang)}`
      + (record.errors.length ? ` errors=${record.errors.join(',')}` : ''));
    if (isExternal(spec)) console.log(`  ${factsLine(record.assembled)}`);
  }

  appendLedger(runId, spentSatang, records.reduce((sum, record) => sum + record.providerCalls, 0));
  const meta = {
    runId, label: OPTS.label, gitRevision: gitRevision(),
    modelId: ENV.bedrockModelId, documentModelId: ENV.documentAiModelId, region: ENV.bedrockRegion,
    thbPerUsd: OPTS.thbPerUsd, maxThb: thb(maxSatang), fixtures: specs.length,
    runCostThb: thb(spentSatang), priorTaskLedgerThb: thb(priorSatang),
    taskCumulativeThb: thb(priorSatang + spentSatang), budgetStopped: stopped,
    finishedAt: new Date().toISOString(),
  };
  writeFileSync(join(OPTS.out, `${runId}.summary.json`), `${JSON.stringify({ meta, records }, null, 2)}\n`);
  writeFileSync(join(OPTS.out, `${runId}.md`), markdown(records));
  console.log(`\nrun THB ${thb(spentSatang)} | task cumulative THB ${thb(priorSatang + spentSatang)} of ${thb(maxSatang)}`);
  console.log(`outputs: ${jsonlPath}`);
  if (stopped) console.log('WARNING: stopped on the spend guard; some fixtures were not run.');
}

void main().catch((error: unknown) => {
  console.error('CAPTURE_READ_BENCHMARK_ERROR', (error as Error)?.stack ?? error);
  process.exit(1);
});
