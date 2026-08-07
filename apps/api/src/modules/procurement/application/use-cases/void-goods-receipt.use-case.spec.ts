import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { VoidGoodsReceiptUseCase } from './goods-receipt.use-case';

// The spec event list carries goods_receipt.voided next to goods_receipt.posted,
// so the void path must append it, not only write an audit row — and must append
// nothing at all when the void is refused.

const ctx: any = {
  companyId: 'co_1', userId: 'u1', requestId: 'req_1',
  permissions: ['procurement.goods_receipt.void'],
};

// The shape voidGoodsReceiptTrueReversal actually returns.
const REVERSALS = [{ originalMovementId: 'mv_in', reversalMovementId: 'mv_rev' }];

describe('VoidGoodsReceiptUseCase', () => {
  let audit: { log: any };
  let outbox: { append: any };
  let repo: any;

  beforeEach(() => {
    audit = { log: mock.fn(async () => undefined) };
    outbox = { append: mock.fn(async () => undefined) };
    repo = {
      findGoodsReceiptById: mock.fn(async () => ({ id: 'gr_1', status: 'POSTED', purchaseOrderId: 'po_1', lines: [] })),
      voidGoodsReceiptTrueReversal: mock.fn(async () => ({
        goodsReceipt: { id: 'gr_1', status: 'VOIDED' },
        reversalMovements: REVERSALS,
      })),
    };
  });

  const make = () => new VoidGoodsReceiptUseCase(repo, audit as any, outbox as any);

  it('appends goods_receipt.voided with the post-path payload shape', async () => {
    const result = await make().execute(ctx, 'gr_1', 'รับของผิด');
    assert.equal(result.status, 'VOIDED');
    assert.equal(outbox.append.mock.callCount(), 1);
    const [eventType, aggregateType, aggregateId, payload] = outbox.append.mock.calls[0].arguments;
    assert.equal(eventType, 'goods_receipt.voided');
    assert.equal(aggregateType, 'goods_receipt');
    assert.equal(aggregateId, 'gr_1');
    assert.equal(payload.companyId, 'co_1');
    assert.equal(payload.actorUserId, 'u1');
    assert.equal(payload.requestId, 'req_1');
    assert.equal(payload.aggregateType, 'goods_receipt');
    assert.equal(payload.aggregateId, 'gr_1');
    assert.equal(typeof payload.occurredAt, 'string');
    assert.deepEqual(payload.data, {
      status: 'VOIDED', reason: 'รับของผิด', purchaseOrderId: 'po_1', reversalMovements: REVERSALS,
    });
  });

  // Regression guard: the void path used to write this audit row twice.
  it('writes exactly one audit row carrying the reversal evidence', async () => {
    await make().execute(ctx, 'gr_1', 'รับของผิด');
    assert.equal(audit.log.mock.callCount(), 1);
    const entry = audit.log.mock.calls[0].arguments[0];
    assert.equal(entry.action, 'procurement.goods_receipt.void');
    assert.equal(entry.riskLevel, 'HIGH');
    assert.deepEqual(entry.metadataJson.reversalMovements, REVERSALS);
  });

  it('appends nothing when the void is rejected before the reversal', async () => {
    await assert.rejects(() => make().execute({ ...ctx, permissions: [] }, 'gr_1', 'reason'), ForbiddenException);
    repo.findGoodsReceiptById = mock.fn(async () => null);
    await assert.rejects(() => make().execute(ctx, 'gr_1', 'reason'), NotFoundException);
    repo.findGoodsReceiptById = mock.fn(async () => ({ id: 'gr_1', status: 'DRAFT', purchaseOrderId: 'po_1', lines: [] }));
    await assert.rejects(() => make().execute(ctx, 'gr_1', 'reason'), BadRequestException);
    assert.equal(outbox.append.mock.callCount(), 0);
    assert.equal(repo.voidGoodsReceiptTrueReversal.mock.callCount(), 0);
  });

  it('appends nothing when the reversal itself fails closed', async () => {
    repo.voidGoodsReceiptTrueReversal = mock.fn(async () => { throw new ConflictException({ code: 'inventory_reversal_unavailable' }); });
    await assert.rejects(() => make().execute(ctx, 'gr_1', 'รับของผิด'), ConflictException);
    assert.equal(outbox.append.mock.callCount(), 0);
    assert.equal(audit.log.mock.callCount(), 0);
  });
});
