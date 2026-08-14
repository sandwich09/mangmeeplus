import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), '../../features');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!entry.isFile() || !['.ts', '.tsx'].includes(extname(path)) || path.endsWith('.spec.ts') || path.endsWith('.spec.tsx')) return [];
    return [path];
  });
}

type Exemption = { path: string; snippet: string; reason: string };

// These messages are produced entirely in the browser and do not contain an API response.
// Keep exemptions exact so a second `.message` access in the same file is still rejected.
const LOCAL_ONLY_EXEMPTIONS: Exemption[] = [
  {
    path: 'expenses/SignaturePad.tsx',
    snippet: 'setError(cause instanceof Error ? cause.message',
    reason: 'signature canvas/file processing throws reviewed browser-only validation copy',
  },
  {
    path: 'reimbursements/ReimbursementsPages.tsx',
    snippet: 'setError(e instanceof Error ? e.message',
    reason: 'signature image decoding throws reviewed browser-only validation copy',
  },
  {
    path: 'system-partners/PartnerDetailPage.tsx',
    snippet: "showToast(parsed.message, 'error')",
    reason: 'parseBudgetBahtInput returns reviewed client-side validation copy',
  },
  {
    path: 'system-partners/PlatformAiBudgetPage.tsx',
    snippet: 'toast.error(parsed.message)',
    reason: 'parseBudgetBahtInput returns reviewed client-side validation copy',
  },
  {
    path: 'reimbursements/reimbursements.logic.ts',
    snippet: "return errorMessage(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด', e);",
    reason: 'the domain mapper consumes the diagnostic and returns reviewed Thai copy',
  },
  {
    path: 'accounts-payable/AccountsPayablePages.tsx',
    snippet: 'setError(outcome.message)',
    reason: 'whtLinkErrorOutcome returns reviewed domain copy after applying apiErrorMessage fallback',
  },
];

const displayCall = /\b(?:set(?:Error|Message|Msg|[A-Z][A-Za-z0-9_]*(?:Error|Message|Msg))|toast\.error|showToast)\s*\([^;]{0,500}\)/g;
const returnStatement = /\breturn\s+[^;]{0,500};/g;
const terminalMessageAccess = /(?:\([^)]*\bas\s+(?:Error|ApiError)[^)]*\)|\b[A-Za-z_$][\w$]*)\.message\b(?!\s*\.)/;
const persistedDiagnosticInJsx = /\{[^{}\n]{0,180}\.(?:errorMessage|deliveryError|failureReason|failureMessage|lastErrorMessage|lastErrorCode)\b[^{}\n]{0,180}\}/g;
const reviewedDiagnosticRenderer = /\b(?:apiErrorMessage|sendErrorMessage|displayedChannelError|workflowDiagnosticMessage)\s*\(/;
const rawDiagnosticJoin = /\.(?:warnings|errors)\??\.join\s*\([^)]*\)/g;
const rawDiagnosticElement = /\.(?:warnings|errors)\.map\s*\(\(([A-Za-z_$][\w$]*)\)\s*=>\s*\(?\s*<[^;]{0,500}?>\s*\{\1\}\s*</g;
const rawCloseCheckMessage = /\{\s*check\.message\s*\}/g;
const rawSuccessPayloadPatterns = [rawDiagnosticJoin, rawDiagnosticElement, rawCloseCheckMessage];

function rawSuccessPayloadDiagnostics(source: string): string[] {
  return rawSuccessPayloadPatterns.flatMap((pattern) => {
    pattern.lastIndex = 0;
    return [...source.matchAll(pattern)].map((match) => match[0]);
  });
}

function isExempt(path: string, snippet: string): boolean {
  const relativePath = relative(sourceRoot, path);
  return LOCAL_ONLY_EXEMPTIONS.some((exemption) =>
    exemption.path === relativePath && snippet.includes(exemption.snippet));
}

function finding(path: string, source: string, index: number, snippet: string): string {
  const line = source.slice(0, index).split('\n').length;
  return `${relative(sourceRoot, path)}:${line}: ${snippet.replace(/\s+/g, ' ').trim().slice(0, 220)}`;
}

test('feature UI does not display caught Error.message without a reviewed renderer', () => {
  const offenders: string[] = [];
  for (const path of sourceFiles(sourceRoot)) {
    const source = readFileSync(path, 'utf8');
    for (const pattern of [displayCall, returnStatement]) {
      pattern.lastIndex = 0;
      for (const match of source.matchAll(pattern)) {
        const snippet = match[0];
        if (!terminalMessageAccess.test(snippet) || snippet.includes('apiErrorMessage(') || isExempt(path, snippet)) continue;
        offenders.push(finding(path, source, match.index ?? 0, snippet));
      }
    }
  }

  assert.deepEqual(offenders, [], `raw error messages can expose implementation details:\n  ${offenders.join('\n  ')}`);
});

test('persisted workflow and delivery diagnostics are rendered through safe copy', () => {
  const offenders: string[] = [];
  for (const path of sourceFiles(sourceRoot)) {
    const source = readFileSync(path, 'utf8');
    persistedDiagnosticInJsx.lastIndex = 0;
    for (const match of source.matchAll(persistedDiagnosticInJsx)) {
      if (reviewedDiagnosticRenderer.test(match[0])) continue;
      offenders.push(finding(path, source, match.index ?? 0, match[0]));
    }
  }

  assert.deepEqual(offenders, [], `persisted diagnostics must not be rendered verbatim:\n  ${offenders.join('\n  ')}`);
});

test('success-payload diagnostics are rendered through reviewed copy', () => {
  const offenders: string[] = [];
  for (const path of sourceFiles(sourceRoot)) {
    const source = readFileSync(path, 'utf8');
    for (const match of rawSuccessPayloadDiagnostics(source)) {
      offenders.push(finding(path, source, source.indexOf(match), match));
    }
  }

  assert.deepEqual(offenders, [], `success-payload diagnostics must not be rendered verbatim:\n  ${offenders.join('\n  ')}`);
});

test('success-payload guard catches raw fixtures without rejecting reviewed renderers', () => {
  for (const fixture of [
    '{preview.warnings.map((warning) => <p key={warning}>{warning}</p>)}',
    '{preview.errors.map((message) => (<p>{message}</p>))}',
    "{row.errors.join(', ')}",
    '{check.message}',
  ]) assert.equal(rawSuccessPayloadDiagnostics(fixture).length, 1, fixture);

  for (const fixture of [
    '{preview.warnings.map((warning) => <p key={warning}>{transactionTaxDiagnosticMessage(warning)}</p>)}',
    "{row.errors.map(statementRowErrorMessage).join(', ')}",
    '{checkMessage}',
  ]) assert.deepEqual(rawSuccessPayloadDiagnostics(fixture), [], fixture);
});
