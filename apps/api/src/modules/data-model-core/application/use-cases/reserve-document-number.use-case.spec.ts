import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ReserveDocumentNumberUseCase } from './reserve-document-number.use-case';
import type { ReserveDocumentNumberInput } from '../../domain/models/document-sequence.model';

const makeInput = (extra: Partial<ReserveDocumentNumberInput> = {}): ReserveDocumentNumberInput => ({
  companyId: 'co-1',
  documentType: 'invoice',
  periodKey: 'ALL',
  idempotencyKey: 'idem-1',
  reservedByUserId: 'user-1',
  ...extra,
});

const existingRecord = {
  id: 'num-existing',
  companyId: 'co-1',
  sequenceId: 'seq-1',
  documentType: 'invoice',
  documentNumber: 'INV-00001',
  status: 'RESERVED',
  idempotencyKey: 'idem-1',
  reservedByUserId: 'user-1',
  reservedAt: new Date(),
};

const newRecord = {
  id: 'num-new',
  companyId: 'co-1',
  sequenceId: 'seq-1',
  documentType: 'invoice',
  documentNumber: 'INV-00002',
  status: 'RESERVED',
  idempotencyKey: 'idem-2',
  reservedByUserId: 'user-1',
  reservedAt: new Date(),
};

const makeRepo = (returnRecord: any) => ({
  reserveNumber: mock.fn(async () => returnRecord),
  upsertConfig: mock.fn(),
  list: mock.fn(),
  commitNumber: mock.fn(),
  cancelReservation: mock.fn(),
});

const makeAudit = () => ({ log: mock.fn(async () => {}) });

describe('ReserveDocumentNumberUseCase', () => {
  it('returns existing reservation when idempotency key already exists (repo handles idempotency)', async () => {
    const repo = makeRepo(existingRecord);
    const uc = new ReserveDocumentNumberUseCase(repo as any, makeAudit() as any);
    const result = await uc.execute(makeInput({ idempotencyKey: 'idem-1' }));
    assert.equal(result.id, 'num-existing');
    assert.equal(result.documentNumber, 'INV-00001');
  });

  it('returns new reservation when idempotency key is new', async () => {
    const repo = makeRepo(newRecord);
    const uc = new ReserveDocumentNumberUseCase(repo as any, makeAudit() as any);
    const result = await uc.execute(makeInput({ idempotencyKey: 'idem-2' }));
    assert.equal(result.id, 'num-new');
    assert.equal(result.documentNumber, 'INV-00002');
  });

  it('calls audit log on success', async () => {
    const audit = makeAudit();
    const repo = makeRepo(newRecord);
    const uc = new ReserveDocumentNumberUseCase(repo as any, audit as any);
    await uc.execute(makeInput());
    assert.equal((audit.log.mock.calls as any[]).length, 1);
    assert.equal(((audit.log.mock.calls as any[])[0]?.arguments[0] as any).action, 'document.number.reserve');
  });
});
