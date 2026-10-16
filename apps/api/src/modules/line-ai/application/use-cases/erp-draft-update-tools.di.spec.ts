/**
 * The five draft tools must be CONSTRUCTIBLE BY NEST, which is a different claim from "the class
 * works when a spec hands it two fakes".
 *
 * `emitDecoratorMetadata` — swc's `decoratorMetadata` and TypeScript's alike — writes
 * `design:paramtypes` only for the class that DECLARES a constructor. An `@Injectable()` subclass
 * that merely inherits one emits no metadata at all, so Nest resolves zero dependencies, builds it
 * with no arguments, and the first `expense.draft.*` call dies on an undefined `draftUpdate`. That
 * failure exists only in the built image: every spec in this repo constructs these classes by hand
 * and would stay green through it.
 *
 * The runnable invariant is constructor ARITY. A subclass with no constructor of its own reports
 * `length === 0` (its implicit `constructor(...args)` declares no parameters); one that declares
 * `constructor(a, b)` reports 2. `Reflect.getMetadata('design:paramtypes', …)` would be the more
 * direct assertion, but the repo's test runner is tsx/esbuild, which does not implement
 * `emitDecoratorMetadata` at all — it reports ABSENT for every class here, including ones that are
 * perfectly wired, so it can only produce a false alarm. Arity is compiler-independent and fails
 * for exactly the mistake this guards.
 *
 * This spec is the ONLY guard for this failure, which is not obvious and was measured rather than
 * assumed. `pnpm test:boot` (`src/scripts/boot-di-smoke.ts`) resolves the real provider graph from
 * the swc build and is authoritative for its own class of bug — an ERASED parameter type, where
 * Nest has a token it cannot find. It does NOT catch this one: with the bug re-introduced it still
 * reported "Nest resolved every provider" and exited 0, because a class declaring zero
 * dependencies resolves perfectly. The object is broken, not unwireable, and nothing that only
 * asks "does the graph resolve?" can tell the difference.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { LINE_DRAFT_UPDATE_TOOLS } from '@watchdog-bms/contracts';
import {
  ExpenseDraftSetHeaderTool,
  ExpenseDraftSetLineTool,
  ExpenseDraftAddChargeTool,
  ExpenseDraftRemoveLineTool,
  ExpenseDraftSetVatModeTool,
} from './erp-draft-update-tools.use-case';

/** Every dependency the base class takes: the draft use case and the expense repository. */
const EXPECTED_DEPENDENCY_COUNT = 2;

const TOOLS = [
  ExpenseDraftSetHeaderTool,
  ExpenseDraftSetLineTool,
  ExpenseDraftAddChargeTool,
  ExpenseDraftRemoveLineTool,
  ExpenseDraftSetVatModeTool,
] as const;

describe('draft update tools — Nest constructibility', () => {
  it('every concrete tool DECLARES its own constructor, so DI metadata is emitted for it', () => {
    for (const tool of TOOLS) {
      assert.equal(
        tool.length,
        EXPECTED_DEPENDENCY_COUNT,
        `${tool.name} must declare constructor(draftUpdate, repo) itself — an inherited constructor `
        + 'emits no design:paramtypes, and Nest would build it with no dependencies',
      );
    }
  });

  it('covers all five registered draft tools, so a sixth cannot be added untested', () => {
    const names = TOOLS.map((tool) => new (tool as never as new (a: unknown, b: unknown) => { toolName: string })(null, null).toolName);
    assert.deepEqual([...names].sort(), [...LINE_DRAFT_UPDATE_TOOLS].sort());
  });

  it('wires the dependencies it was given, in the base class\'s order', () => {
    const draftUpdate = { enabled: true } as never;
    const repo = { listRecentLineCaptures: async () => [] } as never;
    for (const tool of TOOLS) {
      const instance = new (tool as never as new (a: unknown, b: unknown) => Record<string, unknown>)(draftUpdate, repo);
      assert.equal(instance['draftUpdate'], draftUpdate, `${tool.name} must pass draftUpdate through super()`);
      assert.equal(instance['repo'], repo, `${tool.name} must pass repo through super()`);
    }
  });
});

import { ExpensesModule } from '../../../expenses/expenses.module';
import { DataModelCoreModule } from '../../../data-model-core/data-model-core.module';
import { ReimbursementsModule } from '../../../reimbursements/reimbursements.module';
import { RecordExpensePaymentUseCase } from '../../../expenses/application/use-cases/expense-draft.use-case';
import { LinkAttachmentUseCase } from '../../../data-model-core/application/use-cases/link-attachment.use-case';
import { SubmitReimbursementUseCase, CancelReimbursementUseCase } from '../../../reimbursements/application/use-cases/reimbursement-request.use-case';
import { ApproveReimbursementUseCase, RejectReimbursementUseCase } from '../../../reimbursements/application/use-cases/reimbursement-approval.use-case';
it('Round 3 action and evidence dependencies are exported by their owning Nest modules', () => {
  for (const [module, providers] of [[ExpensesModule, [RecordExpensePaymentUseCase]], [DataModelCoreModule, [LinkAttachmentUseCase]], [ReimbursementsModule, [SubmitReimbursementUseCase, CancelReimbursementUseCase, ApproveReimbursementUseCase, RejectReimbursementUseCase]]] as const) {
    for (const provider of providers) assert.ok((Reflect.getMetadata('exports', module) as unknown[]).includes(provider), provider.name);
  }
});

import { TaxModule } from '../../../tax/tax.module';
import { DisbursementVoucherUseCase } from '../../../expenses/application/use-cases/disbursement-voucher.use-case';
import { IssueWhtCertificateFromHandoffUseCase } from '../../../tax/application/use-cases/issue-wht-certificate-from-handoff.use-case';
import { WhtCertificateHandoffUseCase } from '../../../tax/application/use-cases/wht-certificate-handoff.use-case';
it('Round 5 voucher and certificate actions resolve the existing business use-cases from their owning modules', () => {
  assert.ok((Reflect.getMetadata('exports', ExpensesModule) as unknown[]).includes(DisbursementVoucherUseCase));
  for (const provider of [IssueWhtCertificateFromHandoffUseCase, WhtCertificateHandoffUseCase]) assert.ok((Reflect.getMetadata('exports', TaxModule) as unknown[]).includes(provider));
});

it('boots the real Nest modules and resolves every optional dependency in LINE actions and ERP tools', () => {
  // tsx omits decorator metadata. A clean child uses the API's SWC config, exactly as the image does.
  // NestFactory.create resolves providers without init/listen, so no database or sockets are needed.
  const boot = spawnSync(process.execPath, ['-e', String.raw`
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    const path = require('node:path');
    const swc = require('@swc/core');
    require('reflect-metadata');
    const config = JSON.parse(fs.readFileSync('.swcrc', 'utf8'));
    const Module = require('node:module'), resolveFilename = Module._resolveFilename;
    Module._resolveFilename = function(request, parent, ...args) {
      if (request === '@watchdog-bms/config') request = path.resolve('../../packages/config/src/index.ts');
      if (request.startsWith('.') && request.endsWith('.js') && parent) {
        const source = path.resolve(path.dirname(parent.filename), request.slice(0, -3) + '.ts');
        if (fs.existsSync(source)) request = source;
      }
      return resolveFilename.call(this, request, parent, ...args);
    };
    require.extensions['.ts'] = (module, filename) => module._compile(swc.transformFileSync(filename, { ...config, filename }).code, filename);
    Object.assign(process.env, { APP_ENV: 'local', SERVICE_NAME: 'line-optional-di-test', S3_BUCKET: 'line-optional-di-test',
      DATABASE_URL: 'postgresql://nobody:nobody@127.0.0.1:1/nodb' });
    (async () => {
      const { NestFactory } = require('@nestjs/core');
      const { AppModule } = require('./src/app.module.ts');
      const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
      const { ProcessLineWebhookUseCase } = require('./src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts');
      const { ListExpensesUseCase } = require('./src/modules/expenses/application/use-cases/expense-draft.use-case.ts');
      const { LineVoucherActionService } = require('./src/modules/line-ai/application/line-voucher-action.service.ts');
      const { GetCounterpartyUseCase, ListCounterpartiesUseCase } = require('./src/modules/accounting-documents/application/use-cases/counterparty.use-case.ts');
      assert.equal(app.get(ProcessLineWebhookUseCase).editableExpenses, app.get(ListExpensesUseCase));
      assert.equal(app.get(LineVoucherActionService).counterparties, app.get(GetCounterpartyUseCase));
      assert.equal(app.get(LineVoucherActionService).listCounterparties, app.get(ListCounterpartiesUseCase));
      const dir = './src/modules/line-ai/application';
      const files = ['line-expense-action.service.ts', 'line-voucher-action.service.ts', 'line-package-purchase.service.ts',
        'line-counterparty.service.ts', 'line-team-action.service.ts', 'line-quoted-message.service.ts',
        ...fs.readdirSync(path.join(dir, 'use-cases')).filter(file => /^erp-.*tools.*\.ts$/.test(file) && !file.endsWith('.spec.ts')).map(file => 'use-cases/' + file)];
      files.push('../../expenses/application/use-cases/link-line-payment-evidence.use-case.ts');
      files.push('../../expenses/application/use-cases/expense-draft.use-case.ts');
      let count = 0;
      for (const file of files) for (const provider of Object.values(require(path.resolve(dir, file)))) {
        if (typeof provider !== 'function') continue;
        const optional = Reflect.getMetadata('optional:paramtypes', provider) || [];
        if (!optional.length) continue;
        const instance = app.get(provider);
        const types = Reflect.getMetadata('design:paramtypes', provider);
        for (const index of optional) {
          const token = types[index], dependency = app.get(token);
          assert.ok(dependency instanceof token, provider.name + ': ' + token.name);
          assert.ok(Object.values(instance).includes(dependency), provider.name + ' must receive ' + token.name + ', not undefined');
          count++;
        }
      }
      assert.ok(count >= 14, 'the optional dependency audit must include expense actions, expense detail and payment evidence tools');
      await app.close();
      console.log('Resolved ' + count + ' optional LINE dependencies');
      process.exit(0);
    })().catch(error => { console.error(error); process.exit(1); });
  `], { cwd: resolve(__dirname, '../../../../..'), encoding: 'utf8', timeout: 60_000, maxBuffer: 2_000_000 });
  assert.equal(boot.status, 0, `${boot.error ?? ''}\n${boot.stdout}\n${boot.stderr}`);
  assert.match(boot.stdout, /Resolved \d+ optional LINE dependencies/);
});
