import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseTaxCodeImportContent, TaxCodeImportUseCase } from './tax-code-import.use-case.js';

const json = JSON.stringify([{ externalCode: 'O1', displayName: 'Output VAT 7%', taxRegime: 'VAT', direction: 'OUTPUT', treatment: 'STANDARD', transactionContexts: ['DOMESTIC_SALE'], rate: '7', calculationMethod: 'EXCLUSIVE', claimabilityDefault: 'NOT_APPLICABLE', effectiveFrom: '2026-01-01' }]);
const ctx = { companyId: 'c1', userId: 'u1', requestId: 'r1', permissions: ['tax.config.manage'], scopes: {} } as any;

describe('TaxCodeImportUseCase', () => {
  it('parses canonical JSON and quoted CSV without a new parser dependency', () => {
    assert.equal(parseTaxCodeImportContent('JSON', json).length, 1);
    const csv = 'externalCode,displayName,taxRegime,direction,treatment,transactionContexts,rate,calculationMethod,claimabilityDefault,effectiveFrom\nO1,"Output, VAT 7%",VAT,OUTPUT,STANDARD,DOMESTIC_SALE,7,EXCLUSIVE,NOT_APPLICABLE,2026-01-01';
    assert.equal(parseTaxCodeImportContent('CSV', csv)[0]?.displayName, 'Output, VAT 7%');
  });

  it('previews a clean import and blocks an overlapping existing code', async () => {
    let existing: any[] = [];
    const repo = { findProfile: async () => ({ id: 'p1', companyId: 'c1', status: 'DRAFT', version: 1, updatedAt: '2026-07-14' }), listDefinitions: async () => existing } as any;
    const useCase = new TaxCodeImportUseCase(repo, {} as any, {} as any);
    const clean = await useCase.preview(ctx, { profileId: 'p1', format: 'JSON', content: json });
    assert.equal(clean.canApply, true);
    assert.equal(clean.rows[0]?.definition?.externalCode, 'O1');
    existing = [{ id: 'd1', version: 1, externalCode: 'O1', direction: 'OUTPUT', effectiveFrom: '2026-01-01', effectiveTo: null }];
    const conflict = await useCase.preview(ctx, { profileId: 'p1', format: 'JSON', content: json });
    assert.equal(conflict.canApply, false);
    assert.equal(conflict.rows[0]?.conflict, true);
    assert.notEqual(conflict.checksum, clean.checksum);
  });
});
