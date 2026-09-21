#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { pathToFileURL } from 'node:url';

const CONTROLLED_IDS = ['royal-pizza-printed-receipt', 'handwritten-cash-bill', 'handwritten-multi-entry-ledger'];
const ALLOWED_EXPECTATION_PATHS = new Set([
  'status',
  'fields.grandTotalAmount',
  'fields.vatAmount',
  'fields.expenseDate',
  'fields.missingFieldsIncludes',
  'classification.documentKind',
  'classification.contentKind',
  'classification.transactionState',
  'classification.requiresClarification',
  'fields.grandTotalAmountAbsent',
  // Vendor-address §7: the seller's printed address, so a real-image replay can prove the reader
  // took it off the ISSUER block. A buyer address landing here is the failure worth binding by
  // source SHA — `fields.missingFieldsIncludes` covers the gap a full tax invoice must report.
  'fields.vendorAddress',
]);
const MONEY_EXPECTATION_PATHS = new Set(['fields.grandTotalAmount', 'fields.vatAmount']);
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const CONTROLLED_HTTP_TIMEOUT_MS = 150_000;

function valuesAfter(flag) {
  return process.argv.slice(2).flatMap((value, index, values) => value === flag && values[index + 1]
    ? [values[index + 1]]
    : []);
}

function pairs(flag) {
  return new Map(valuesAfter(flag).map((value) => {
    const separator = value.indexOf('=');
    if (separator <= 0 || separator === value.length - 1) throw new Error(`LINE_AI_CONTROLLED_${flag.slice(2).toUpperCase()}_INVALID`);
    return [value.slice(0, separator), value.slice(separator + 1)];
  }));
}

function getPath(value, path) {
  return path.split('.').reduce((current, key) => current && typeof current === 'object' ? current[key] : undefined, value);
}

export function moneyMinorUnits(value) {
  const normalized = String(value).trim().replaceAll(',', '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ''] = normalized.split('.');
  return (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))).toString();
}

export function matchesExpected(path, actual, allowed) {
  if (!MONEY_EXPECTATION_PATHS.has(path)) return allowed.includes(actual);
  const actualMinorUnits = moneyMinorUnits(actual);
  return actualMinorUnits !== null
    && allowed.some((expected) => moneyMinorUnits(expected) === actualMinorUnits);
}

export function evaluateExpectation(body, path, allowed) {
  if (path === 'fields.grandTotalAmountAbsent') {
    const actual = String(getPath(body, 'fields.grandTotalAmount') === undefined);
    return { actual, passed: allowed.includes(actual) };
  }
  if (path === 'fields.missingFieldsIncludes') {
    const missingFields = getPath(body, 'fields.missingFields');
    const safeFields = Array.isArray(missingFields)
      ? missingFields.filter((field) => typeof field === 'string').sort()
      : [];
    return {
      actual: safeFields.join('|'),
      passed: allowed.every((field) => safeFields.includes(field)),
    };
  }
  const actual = String(getPath(body, path));
  return { actual, passed: matchesExpected(path, actual, allowed) };
}

function parseExpected(values) {
  const byScenario = new Map(CONTROLLED_IDS.map((id) => [id, []]));
  for (const raw of values) {
    const separator = raw.indexOf('=');
    const target = raw.slice(0, separator);
    const dot = target.indexOf('.');
    const scenarioId = target.slice(0, dot);
    const path = target.slice(dot + 1);
    if (separator <= 0 || dot <= 0 || !CONTROLLED_IDS.includes(scenarioId) || !ALLOWED_EXPECTATION_PATHS.has(path)) {
      throw new Error('LINE_AI_CONTROLLED_EXPECT_INVALID');
    }
    byScenario.get(scenarioId).push({ path, allowed: raw.slice(separator + 1).split('|') });
  }
  return byScenario;
}

function mimeTypeFor(path) {
  const extension = extname(path).toLowerCase();
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.png') return 'image/png';
  throw new Error('LINE_AI_CONTROLLED_IMAGE_MIME_UNSUPPORTED');
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log('Usage: --fixture <scenario>=<absolute path> --expected-sha <scenario>=<sha256> --human-reviewed <scenario> --expect <scenario>.<allowed.path>=<value|alternative>');
    return;
  }
  const gatewayUrl = (process.env['AI_GATEWAY_URL'] ?? 'http://127.0.0.1:3002/v1').replace(/\/$/, '');
  const secret = process.env['AI_GATEWAY_INTERNAL_SECRET'];
  if (!secret) throw new Error('LINE_AI_CONTROLLED_INTERNAL_SECRET_REQUIRED');
  const fixtures = pairs('--fixture');
  const expectedHashes = pairs('--expected-sha');
  const humanReviewed = new Set(valuesAfter('--human-reviewed'));
  const expected = parseExpected(valuesAfter('--expect'));

  for (const id of CONTROLLED_IDS) {
    if (!fixtures.has(id) || !expectedHashes.has(id) || !humanReviewed.has(id) || expected.get(id).length === 0) {
      throw new Error(`LINE_AI_CONTROLLED_FIXTURE_INCOMPLETE:${id}`);
    }
    if (!/^[0-9a-f]{64}$/.test(expectedHashes.get(id))) throw new Error(`LINE_AI_CONTROLLED_SHA_INVALID:${id}`);
  }

  const reports = [];
  for (const id of CONTROLLED_IDS) {
    const bytes = await readFile(fixtures.get(id));
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) throw new Error(`LINE_AI_CONTROLLED_IMAGE_SIZE_INVALID:${id}`);
    const sourceSha256 = createHash('sha256').update(bytes).digest('hex');
    if (sourceSha256 !== expectedHashes.get(id)) throw new Error(`LINE_AI_CONTROLLED_SOURCE_HASH_MISMATCH:${id}`);
    const response = await fetch(`${gatewayUrl}/internal/ai/receipt-ocr`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
      signal: AbortSignal.timeout(CONTROLLED_HTTP_TIMEOUT_MS),
      body: JSON.stringify({
        requestId: `controlled-${id}-${sourceSha256.slice(0, 12)}`,
        companyId: 'controlled-local-company', userId: 'controlled-local-reviewer', activeCategories: [],
        attachment: { id: `controlled-${id}`, mimeType: mimeTypeFor(fixtures.get(id)), purpose: 'receipt', contentBase64: bytes.toString('base64') },
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`LINE_AI_CONTROLLED_HTTP_${response.status}:${id}`);
    const assertions = expected.get(id).map(({ path, allowed }) => ({
      path,
      ...evaluateExpectation(body, path, allowed),
    }));
    const report = {
      scenarioId: id,
      sourceSha256,
      sourceBytes: bytes.length,
      humanReviewed: true,
      status: body.status,
      errorCode: body.errorCode ?? null,
      classification: body.classification ? {
        contentKind: body.classification.contentKind,
        documentKind: body.classification.documentKind,
        transactionState: body.classification.transactionState,
        requiresClarification: body.classification.requiresClarification,
      } : null,
      observedFieldKeys: body.fields && typeof body.fields === 'object' ? Object.keys(body.fields).sort() : [],
      assertions,
    };
    reports.push(report);
    if (assertions.some(({ passed }) => !passed)) {
      console.error(JSON.stringify({ event: 'line_ai_controlled_expectation_mismatch', report }, null, 2));
      throw new Error(`LINE_AI_CONTROLLED_EXPECTATION_MISMATCH:${id}`);
    }
  }
  console.log(JSON.stringify({ event: 'line_ai_controlled_image_replay_complete', gatewayUrl, reports }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    const message = error instanceof Error ? error.message : 'LINE_AI_CONTROLLED_REPLAY_FAILED';
    console.error(JSON.stringify({ event: 'line_ai_controlled_image_replay_failed', errorCode: message.split(':')[0] }));
    process.exitCode = 1;
  });
}
