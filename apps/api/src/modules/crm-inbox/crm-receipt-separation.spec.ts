/**
 * RECEIPT-04 — company-OA customer path must never reach shared-OA employee
 * receipt/expense intake.
 *
 * The two channels are separated by construction: the company-OA webhook
 * (crm-inbox) resolves a CrmCustomer via per-channel secrets and owns customer
 * conversation only; the shared-OA webhook (line-ai) resolves an employee via
 * ExternalIdentity and owns receipt/expense intake (executeReceiptUpload →
 * expenses module). This source-scan fails the build if any crm-inbox source
 * file starts importing the employee receipt-intake surface, which would let a
 * customer message create an ExpenseRecord.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MODULE_DIR = __dirname;

// Symbols/paths that belong exclusively to the shared-OA employee receipt intake.
const FORBIDDEN_PATTERNS: RegExp[] = [
  /executeReceiptUpload/,
  /InitReceiptUploadUseCase/,
  /CompleteReceiptUploadUseCase/,
  /RequestReceiptExtractionUseCase/,
  /modules\/expenses\/application/,
  /line-ai\/application\/use-cases\/process-line-webhook/,
];

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

describe('RECEIPT-04 shared-OA / company-OA receipt intake separation', () => {
  it('no crm-inbox source file references the employee receipt-intake surface', () => {
    for (const file of sourceFiles(MODULE_DIR)) {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const pattern of FORBIDDEN_PATTERNS) {
        assert.equal(
          pattern.test(code),
          false,
          `${file} references shared-OA employee receipt intake (${pattern}); company-OA customer path must not reach expense intake`,
        );
      }
    }
  });

  it('the scan actually inspects crm-inbox source (guard against an empty sweep)', () => {
    const files = sourceFiles(MODULE_DIR);
    assert.ok(files.length > 5, `expected to scan crm-inbox sources, found ${files.length}`);
  });
});
