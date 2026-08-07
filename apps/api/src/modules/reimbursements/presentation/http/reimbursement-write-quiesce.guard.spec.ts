import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { ExecutionContext } from '@nestjs/common';
import { ReimbursementController } from './reimbursement.controller';
import { ReimbursementPolicyController } from './reimbursement-policy.controller';
import {
  REIMBURSEMENT_UPGRADE_ERROR_CODE,
  REIMBURSEMENT_UPGRADE_MESSAGE,
  ReimbursementWriteQuiesceGuard,
} from './reimbursement-write-quiesce.guard';

function context(method: string) {
  const headers: Record<string, string> = {};
  const ctx = {
    switchToHttp: () => ({
      getRequest: () => ({ method }),
      getResponse: () => ({ setHeader: (name: string, value: string) => { headers[name] = value; } }),
    }),
  } as unknown as ExecutionContext;
  return { ctx, headers };
}

describe('ReimbursementWriteQuiesceGuard', () => {
  it('does not change any method when the bounded switch is off', () => {
    const guard = new ReimbursementWriteQuiesceGuard({ reimbursementWriteQuiesce: false } as any);
    assert.equal(guard.canActivate(context('POST').ctx), true);
    assert.equal(guard.canActivate(context('PATCH').ctx), true);
  });

  it('keeps GET, HEAD and OPTIONS available while quiesced', () => {
    const guard = new ReimbursementWriteQuiesceGuard({ reimbursementWriteQuiesce: true } as any);
    for (const method of ['GET', 'HEAD', 'OPTIONS']) assert.equal(guard.canActivate(context(method).ctx), true);
  });

  it('rejects every mutation method with one retryable coded 503 before reading a body', () => {
    const guard = new ReimbursementWriteQuiesceGuard({ reimbursementWriteQuiesce: true } as any);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const { ctx, headers } = context(method);
      assert.throws(() => guard.canActivate(ctx), (error: any) => {
        assert.equal(error.getStatus(), 503);
        assert.deepEqual(error.getResponse(), {
          code: REIMBURSEMENT_UPGRADE_ERROR_CODE,
          message: REIMBURSEMENT_UPGRADE_MESSAGE,
        });
        return true;
      });
      assert.equal(headers['Retry-After'], '60');
    }
  });

  it('is attached to both current reimbursement mutation surfaces', () => {
    for (const controller of [ReimbursementController, ReimbursementPolicyController]) {
      const guards = Reflect.getMetadata(GUARDS_METADATA, controller) as unknown[] | undefined;
      assert.ok(guards?.includes(ReimbursementWriteQuiesceGuard));
    }
  });
});
