// Review probe only: reproduces the existing manual-renew recovery gap; no DB or Stripe calls.
// Run from repo root: node_modules/.bin/tsx --tsconfig apps/api/tsconfig.json docs/evidence/stripe-readiness-2026-09-10/manual-renew-replay.probe.ts
import assert from 'node:assert/strict';
import { RenewCompanyPlanTermUseCase } from '../../../apps/api/src/modules/system-partner-management/application/use-cases/company-plan-term.use-cases';

async function main() {
  let term: any = {
    companyId: 'billing-review-company', tierKey: 'STARTER_249',
    branchLimit: 1, employeeLimit: 2, monthlySlipLimit: 30,
    termStartAt: new Date('2026-01-01T00:00:00Z'),
    termEndsAt: new Date('2026-01-31T00:00:00Z'),
    termDisabledAt: new Date('2026-01-31T00:00:00Z'),
    warningDays: 7, renewCount: 0, lastRenewedAt: null,
  };
  const company = { status: 'DISABLED' };
  const audits: any[] = [];
  let activationCalls = 0;
  const client: any = {
    company: { findUnique: async () => ({ ...company }) },
    companyPlanTerm: {
      findUnique: async () => ({ ...term }),
      update: async ({ data }: any) => {
        term = { ...term, ...data, renewCount: term.renewCount + data.renewCount.increment };
        return { ...term };
      },
    },
    auditLog: {
      create: async ({ data }: any) => { audits.push(data); return data; },
      findFirst: async ({ where }: any) => audits.find(row =>
        row.requestId === where.requestId && row.action === where.action &&
        row.targetId === where.targetId && row.result === where.result) ?? null,
    },
    $transaction: async (fn: any) => fn(client),
  };
  const lifecycle = {
    execute: async () => {
      activationCalls++;
      if (activationCalls === 1) throw new Error('injected activation outage after term commit');
      company.status = 'ACTIVE';
    },
  };
  const useCase = new RenewCompanyPlanTermUseCase({ client } as any, lifecycle as any);
  const command = {
    companyId: term.companyId, requestingAdminUserId: 'billing-review-admin',
    requestId: 'billing-review-renew-1', days: 30,
  };
  await assert.rejects(useCase.execute(command), /injected activation outage/);
  assert.equal(term.renewCount, 1);
  assert.equal(term.termDisabledAt, null);
  assert.equal(audits[0].result, 'SUCCESS');
  const replay = await useCase.execute(command);
  assert.ok(replay.term);
  assert.equal(activationCalls, 1, 'same-request replay skips unfinished activation');
  assert.equal(company.status, 'DISABLED', 'renew has committed but company remains locked');
  console.log('REPRODUCED: term/audit committed; activation failed; replay returned without retrying activation; company remains DISABLED. This is not Stripe E2E or a passing activation acceptance test.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
