import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod, type ExecutionContext } from '@nestjs/common';
import { REQUIRED_ANY_PERMISSIONS_KEY, REQUIRED_PERMISSIONS_KEY } from '../../../../common/security/permissions.decorator';
import { ReimbursementController } from './reimbursement.controller';
import { ReimbursementPolicyController } from './reimbursement-policy.controller';
import { ReimbursementReconcileInternalController } from './reimbursement-reconcile-internal.controller';
import {
  REIMBURSEMENT_UPGRADE_ERROR_CODE,
  REIMBURSEMENT_UPGRADE_MESSAGE,
  ReimbursementWriteQuiesceGuard,
} from './reimbursement-write-quiesce.guard';

function context(method: string, path = '/companies/company-1/reimbursements/request-1') {
  const headers: Record<string, string> = {};
  const ctx = {
    switchToHttp: () => ({
      getRequest: () => ({ method, path }),
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

  it('keeps the action rollback endpoint available while blocking confirmation', () => {
    const guard = new ReimbursementWriteQuiesceGuard({ reimbursementWriteQuiesce: true } as any);
    assert.equal(guard.canActivate(context('POST', '/companies/c1/reimbursements/draft-actions/a1/cancel').ctx), true);
    assert.throws(() => guard.canActivate(context('POST', '/companies/c1/reimbursements/draft-actions/a1/confirm').ctx));
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

// ---- Payment slip routes (claim payout Phase 2) ----

type Route = { handler: string; method: string; path: string; all?: string[]; any?: string[] };

/** Every route of the claim controller, in the order Nest registers them: the order they are declared. */
function claimRoutes(): Route[] {
  const proto = ReimbursementController.prototype as unknown as Record<string, object>;
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor' && Reflect.hasMetadata(PATH_METADATA, proto[name]!))
    .map((name) => ({
      handler: name,
      method: RequestMethod[Reflect.getMetadata(METHOD_METADATA, proto[name]!) as number]!,
      path: Reflect.getMetadata(PATH_METADATA, proto[name]!) as string,
      all: Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, proto[name]!) as string[] | undefined,
      any: Reflect.getMetadata(REQUIRED_ANY_PERMISSIONS_KEY, proto[name]!) as string[] | undefined,
    }));
}

/** Whether a route pattern answers a URL: same number of segments, a `:param` taking any one of them. */
function answers(route: Route, method: string, url: string): boolean {
  const pattern = route.path.split('/');
  const segments = url.split('/');
  return route.method === method && pattern.length === segments.length
    && pattern.every((part, index) => part.startsWith(':') || part === segments[index]);
}

describe('ReimbursementController payment slip routes', () => {
  const slipRoutes: Record<string, { method: string; path: string }> = {
    initPaymentSlip: { method: 'POST', path: ':requestId/payments/slip-upload-intent' },
    completePaymentSlip: { method: 'POST', path: ':requestId/payments/slip-uploads/:attachmentId/complete' },
    attachPaymentSlip: { method: 'POST', path: ':requestId/payments/:paymentId/slips' },
    paymentSlipDownloadUrl: { method: 'GET', path: ':requestId/payments/:paymentId/slips/:attachmentId/download-url' },
  };

  it('declares the four routes, with slip writes for whoever may record payments', () => {
    const routes = claimRoutes();
    for (const [handler, expected] of Object.entries(slipRoutes)) {
      const route = routes.find((candidate) => candidate.handler === handler);
      assert.ok(route, `${handler} is a route`);
      assert.deepEqual({ method: route.method, path: route.path }, expected, handler);
      assert.equal(route.any, undefined, `${handler}: one required permission, not a choice of several`);
    }
    for (const handler of ['initPaymentSlip', 'completePaymentSlip', 'attachPaymentSlip']) {
      assert.deepEqual(routes.find((route) => route.handler === handler)!.all, ['reimbursement.payment.record'], handler);
    }
    // Opening a slip is decided per claim in the use case (requester, the claim's approver, payment-record
    // and finance-review holders), like the claim detail it belongs to: the route asks only for a session.
    assert.deepEqual(routes.find((route) => route.handler === 'paymentSlipDownloadUrl')!.all, ['account.session.read']);
    // Recording and voiding keep their own rights beside them.
    assert.deepEqual(routes.find((route) => route.handler === 'createPayment')!.all, ['reimbursement.payment.record']);
    assert.deepEqual(routes.find((route) => route.handler === 'voidRequestPayment')!.all, ['reimbursement.payment.void']);
  });

  it('routes each payment URL to its own handler, whatever order the routes are declared in', () => {
    const urls: [string, string, string][] = [
      ['POST', 'rb-1/payments', 'createPayment'],
      ['POST', 'rb-1/payments/pay-1/void', 'voidRequestPayment'],
      ['POST', 'rb-1/payments/slip-upload-intent', 'initPaymentSlip'],
      ['POST', 'rb-1/payments/slip-uploads/att-1/complete', 'completePaymentSlip'],
      ['POST', 'rb-1/payments/pay-1/slips', 'attachPaymentSlip'],
      ['GET', 'rb-1/payments/pay-1/slips/att-1/download-url', 'paymentSlipDownloadUrl'],
    ];
    const routes = claimRoutes();
    for (const [method, url, handler] of urls) {
      const matching = routes.filter((route) => answers(route, method, url)).map((route) => route.handler);
      // The router takes the first match. Exactly one route answering means no `:paymentId` route can
      // capture a slip URL, and no slip route can capture the void, in this order or any other.
      assert.deepEqual(matching, [handler], `${method} ${url}`);
    }
    // The static claim routes are declared before `:requestId`, so a slip URL never reaches them either.
    assert.ok(routes.findIndex((route) => route.path === 'finance-queue') < routes.findIndex((route) => route.path === ':requestId'));
  });

  it('stops the three slip writes while writes are quiesced, and keeps opening a slip available', () => {
    const guard = new ReimbursementWriteQuiesceGuard({ reimbursementWriteQuiesce: true } as any);
    const base = '/companies/company-1/reimbursements/request-1/payments';
    for (const path of [`${base}/slip-upload-intent`, `${base}/slip-uploads/att-1/complete`, `${base}/pay-1/slips`]) {
      const { ctx, headers } = context('POST', path);
      assert.throws(() => guard.canActivate(ctx), (error: any) => error.getStatus() === 503 && error.getResponse().code === REIMBURSEMENT_UPGRADE_ERROR_CODE, path);
      assert.equal(headers['Retry-After'], '60', path);
    }
    assert.equal(guard.canActivate(context('GET', `${base}/pay-1/slips/att-1/download-url`).ctx), true);
    // The guard sits on the controller, so no slip route can be declared outside it.
    assert.ok((Reflect.getMetadata(GUARDS_METADATA, ReimbursementController) as unknown[]).includes(ReimbursementWriteQuiesceGuard));
  });
});

// ---- Carrying a decided claim on (audit B4) ----

describe('carrying a decided claim on: the web call and the scheduled run', () => {
  it('declares ดำเนินการต่อ as a claim route that asks only for a session, like approve: the use case decides who', () => {
    const routes = claimRoutes();
    const resume = routes.find((route) => route.handler === 'resumeRequest');
    assert.deepEqual({ method: resume?.method, path: resume?.path, all: resume?.all, any: resume?.any },
      { method: 'POST', path: ':requestId/resume', all: ['account.session.read'], any: undefined });
    assert.deepEqual(routes.filter((route) => answers(route, 'POST', 'rb-1/resume')).map((route) => route.handler), ['resumeRequest']);
    // It writes, so the maintenance bridge holds it with every other claim write.
    const guard = new ReimbursementWriteQuiesceGuard({ reimbursementWriteQuiesce: true } as any);
    assert.throws(() => guard.canActivate(context('POST', '/companies/c1/reimbursements/rb-1/resume').ctx));
  });

  describe('the scheduled run', () => {
    const TOKEN = 'worker-token-for-this-spec';
    const run = (quiesced: boolean) => {
      const calls: unknown[][] = [];
      const reconciler = { execute: async (...args: unknown[]) => { calls.push(args); return { completed: ['a', 'b'], failed: [{ requestId: 'c', error: 'x' }], blocked: ['d'] }; } };
      return { calls, controller: new ReimbursementReconcileInternalController(reconciler as any, { reimbursementWriteQuiesce: quiesced } as any) };
    };
    const withToken = async <T>(work: () => Promise<T>): Promise<T> => {
      const before = process.env['WORKER_INTERNAL_TOKEN'];
      process.env['WORKER_INTERNAL_TOKEN'] = TOKEN;
      try { return await work(); } finally {
        if (before === undefined) delete process.env['WORKER_INTERNAL_TOKEN']; else process.env['WORKER_INTERNAL_TOKEN'] = before;
      }
    };

    it('runs one bounded pass for the workers and answers with counts only', async () => {
      const { controller, calls } = run(false);
      assert.deepEqual(await withToken(() => controller.execute(TOKEN)), { completed: 2, failed: 1, blocked: 1 });
      assert.deepEqual(calls, [[]], 'the bound of a run is the reconciler\'s own, never a number the caller sends');
    });

    it('takes nobody without the worker token', async () => {
      const { controller, calls } = run(false);
      for (const token of [undefined, '', 'wrong']) {
        await withToken(() => assert.rejects(() => controller.execute(token), /Invalid worker token/));
      }
      assert.deepEqual(calls, []);
    });

    it('writes nothing while reimbursement writes are held, and says it skipped instead of failing the job', async () => {
      const { controller, calls } = run(true);
      assert.deepEqual(await withToken(() => controller.execute(TOKEN)), { skipped: 'reimbursement_write_quiesce' });
      assert.deepEqual(calls, []);
    });
  });
});
