import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  autoEnableWorkflowTemplatesForCompany,
  resyncWorkflowTemplateRulesForCompany,
  WORKFLOW_AUTO_ENABLE_ACTOR_USER_ID,
} from './workflow-template.use-case';
import {
  WORKFLOW_TEMPLATE_CATALOG,
  WORKFLOW_TEMPLATE_DEFAULT_COOLDOWN_SECONDS,
  WORKFLOW_TEMPLATE_DEFAULT_TRIGGER_CONFIG,
} from '../../domain/workflow-template-catalog';

const AUTO_ENABLE_KEYS = WORKFLOW_TEMPLATE_CATALOG.filter((t) => t.autoEnable).map((t) => t.key);

type FakeRule = {
  id: string; companyId: string; templateId: string; name: string; description?: string;
  status: string; triggerType: string; triggerConfigJson: Record<string, unknown>;
  conditionJson: unknown; actionJson: unknown; recipientConfigJson: Record<string, unknown>;
  cooldownSeconds: number; timezone: string; createdByUserId: string; updatedByUserId?: string;
  currentVersion: number;
};

type SeedRule = {
  templateKey: string; companyId?: string; status?: string;
  createdByUserId?: string; updatedByUserId?: string; cooldownSeconds?: number;
  /** Defaults to the template's own action definition, so only the named field is "stale". */
  actionJson?: unknown;
};

/** Stands in for PrismaWorkflowRepository over a real (or transaction) client. */
function fakeRepo(seedRules: SeedRule[] = []) {
  const templates = WORKFLOW_TEMPLATE_CATALOG.map((t, index) => ({ ...t, id: `tpl_${index}` }));
  const versions: any[] = [];
  const rules: FakeRule[] = seedRules.map((r, index) => {
    const template = templates.find((t) => t.key === r.templateKey)!;
    return {
      id: `pre_${index}`,
      companyId: r.companyId ?? 'co_1',
      templateId: template.id,
      name: 'preexisting', status: r.status ?? 'DISABLED', triggerType: 'EVENT',
      triggerConfigJson: WORKFLOW_TEMPLATE_DEFAULT_TRIGGER_CONFIG[template.key] ?? {},
      conditionJson: template.defaultConditionJson,
      actionJson: r.actionJson ?? template.defaultActionJson,
      recipientConfigJson: {}, cooldownSeconds: r.cooldownSeconds ?? 3600,
      timezone: 'Asia/Bangkok', createdByUserId: r.createdByUserId ?? 'admin_1',
      updatedByUserId: r.updatedByUserId, currentVersion: 1,
    };
  });
  for (const rule of rules) {
    versions.push({
      ruleId: rule.id, companyId: rule.companyId, version: 1, status: rule.status,
      cooldownSeconds: rule.cooldownSeconds, triggerSnapshotJson: rule.triggerConfigJson,
      conditionSnapshotJson: rule.conditionJson, actionSnapshotJson: rule.actionJson,
    });
  }
  let nextId = 0;

  const repo = {
    rules, versions, templates,
    findTemplateByKey: async (key: string) => templates.find((t) => t.key === key) ?? null,
    listRules: async ({ companyId, templateId }: any) => rules
      .filter((r) => r.companyId === companyId && r.templateId === templateId)
      // Mirrors PrismaWorkflowRepository.toRule — callers read the mapped record, not the row.
      .map((r) => ({ ...r, createdBy: r.createdByUserId, updatedBy: r.updatedByUserId })),
    createRule: async (data: any) => {
      const rule: FakeRule = { id: `rule_${nextId++}`, status: 'DRAFT', currentVersion: 0, ...data };
      rules.push(rule);
      return rule;
    },
    createRuleVersion: async (data: any) => { versions.push(data); return data; },
    findLatestRuleVersion: async (ruleId: string) => versions.filter((v) => v.ruleId === ruleId).sort((a, b) => b.version - a.version)[0] ?? null,
    updateRule: async (companyId: string, id: string, data: any) => {
      const rule = rules.find((r) => r.id === id && r.companyId === companyId)!;
      Object.assign(rule, data);
      return rule;
    },
  };
  return repo as any;
}

describe('autoEnableWorkflowTemplatesForCompany', () => {
  it('creates one ENABLED versioned rule per autoEnable template for a company with none', async () => {
    const repo = fakeRepo();
    const created = await autoEnableWorkflowTemplatesForCompany(repo, 'co_1');

    assert.deepEqual(created.sort(), [...AUTO_ENABLE_KEYS].sort());
    assert.equal(repo.rules.length, AUTO_ENABLE_KEYS.length);
    for (const rule of repo.rules) {
      assert.equal(rule.status, 'ENABLED');
      assert.equal(rule.currentVersion, 1);
      assert.equal(rule.createdByUserId, WORKFLOW_AUTO_ENABLE_ACTOR_USER_ID);
      assert.equal(rule.enabledByUserId, WORKFLOW_AUTO_ENABLE_ACTOR_USER_ID);
    }
    // Version snapshots exist (the runner replays from them, not from the mutable row).
    assert.equal(repo.versions.length, AUTO_ENABLE_KEYS.length);
    assert.ok(repo.versions.every((v: any) => v.status === 'ENABLED' && v.version === 1));
    // EVENT rules must carry the catalog trigger binding or they subscribe to nothing.
    const pending = repo.rules.find((r: any) => r.name === 'Reimbursement pending approval');
    assert.deepEqual(pending.triggerConfigJson, WORKFLOW_TEMPLATE_DEFAULT_TRIGGER_CONFIG['reimbursement_pending_approval']);
  });

  it('is idempotent: a second run creates nothing', async () => {
    const repo = fakeRepo();
    await autoEnableWorkflowTemplatesForCompany(repo, 'co_1');
    const countAfterFirst = repo.rules.length;

    const secondRun = await autoEnableWorkflowTemplatesForCompany(repo, 'co_1');

    assert.deepEqual(secondRun, []);
    assert.equal(repo.rules.length, countAfterFirst);
    assert.equal(repo.versions.length, countAfterFirst);
  });

  it('never touches an existing rule — an admin-disabled rule stays DISABLED and is not duplicated', async () => {
    const repo = fakeRepo([{ templateKey: 'reimbursement_pending_approval', status: 'DISABLED' }]);

    const created = await autoEnableWorkflowTemplatesForCompany(repo, 'co_1');

    assert.equal(created.includes('reimbursement_pending_approval'), false);
    assert.equal(created.length, AUTO_ENABLE_KEYS.length - 1);
    const preexisting = repo.rules.find((r: any) => r.id === 'pre_0');
    assert.equal(preexisting.status, 'DISABLED');
    assert.equal(preexisting.createdByUserId, 'admin_1');
    assert.equal(repo.rules.filter((r: any) => r.templateId === preexisting.templateId).length, 1);
  });

  it('leaves other companies alone', async () => {
    const repo = fakeRepo([{ templateKey: 'reimbursement_pending_approval', companyId: 'co_2', status: 'DISABLED' }]);
    const created = await autoEnableWorkflowTemplatesForCompany(repo, 'co_1');
    assert.equal(created.includes('reimbursement_pending_approval'), true);
    assert.equal(repo.rules.find((r: any) => r.id === 'pre_0').status, 'DISABLED');
  });

  it('skips templates whose row is not AVAILABLE', async () => {
    const repo = fakeRepo();
    repo.templates.find((t: any) => t.key === 'reimbursement_ready_for_payment').status = 'UNAVAILABLE';
    const created = await autoEnableWorkflowTemplatesForCompany(repo, 'co_1');
    assert.equal(created.includes('reimbursement_ready_for_payment'), false);
  });

  it('materializes each rule with its catalog cooldown (0 for the EVENT reimbursement chain)', async () => {
    const repo = fakeRepo();
    await autoEnableWorkflowTemplatesForCompany(repo, 'co_1');

    for (const [index, template] of repo.templates.entries()) {
      const rule = repo.rules.find((r: any) => r.templateId === `tpl_${index}`);
      if (!rule) continue;
      assert.equal(rule.cooldownSeconds, WORKFLOW_TEMPLATE_DEFAULT_COOLDOWN_SECONDS[template.key] ?? 3600, template.key);
    }
    assert.equal(repo.rules.find((r: any) => r.name === 'Reimbursement pending approval').cooldownSeconds, 0);
    assert.equal(repo.rules.find((r: any) => r.name === 'Approval SLA breach').cooldownSeconds, 3600);
  });
});

describe('resyncWorkflowTemplateRulesForCompany', () => {
  const syncOwned = (over: Partial<SeedRule> = {}): SeedRule => ({
    templateKey: 'reimbursement_pending_approval', status: 'ENABLED', cooldownSeconds: 3600,
    createdByUserId: WORKFLOW_AUTO_ENABLE_ACTOR_USER_ID, updatedByUserId: WORKFLOW_AUTO_ENABLE_ACTOR_USER_ID,
    ...over,
  });
  const catalogActions = (key: string) => WORKFLOW_TEMPLATE_CATALOG.find((t) => t.key === key)!.defaultActionJson;

  it('re-pins a sync-created ENABLED rule to the catalog cooldown and versions the change', async () => {
    const repo = fakeRepo([syncOwned()]);

    const resynced = await resyncWorkflowTemplateRulesForCompany(repo, 'co_1');

    assert.deepEqual(resynced, ['reimbursement_pending_approval']);
    const rule = repo.rules.find((r: any) => r.id === 'pre_0');
    assert.equal(rule.cooldownSeconds, 0);
    assert.equal(rule.status, 'ENABLED');
    assert.equal(rule.currentVersion, 2);
    // The runner reads the version snapshot, so the row alone would have changed nothing.
    const latest = repo.versions.filter((v: any) => v.ruleId === 'pre_0').sort((a: any, b: any) => b.version - a.version)[0];
    assert.equal(latest.version, 2);
    assert.equal(latest.cooldownSeconds, 0);
    assert.equal(latest.status, 'ENABLED');
  });

  // F16: recipients/body live in actionJson, which only autoEnable ever wrote — an existing
  // company kept notifying MANAGER-only with a body that repeated the title.
  it('re-pins a stale action definition (recipients/body) into the row and the new version', async () => {
    const stale = [{ actionKey: 'notify_approver', actionType: 'SEND_NOTIFICATION', configJson: { recipientRoles: ['MANAGER'] } }];
    const repo = fakeRepo([syncOwned({ cooldownSeconds: 0, actionJson: stale })]);

    assert.deepEqual(await resyncWorkflowTemplateRulesForCompany(repo, 'co_1'), ['reimbursement_pending_approval']);
    const rule = repo.rules.find((r: any) => r.id === 'pre_0');
    assert.deepEqual(rule.actionJson, catalogActions('reimbursement_pending_approval'));
    const latest = repo.versions.filter((v: any) => v.ruleId === 'pre_0').sort((a: any, b: any) => b.version - a.version)[0];
    assert.deepEqual(latest.actionSnapshotJson, catalogActions('reimbursement_pending_approval'));
  });

  // Owner rule 2026-10-01: the ready-to-pay notice prefers whose turn it is. A company whose rule
  // was pinned before that must pick it up at the next release, or it keeps pushing everyone.
  it('re-pins a ready-to-pay rule pinned before the recipient preference, and leaves an admin-edited one alone', async () => {
    const before = [{
      actionKey: 'notify_payer', actionType: 'SEND_NOTIFICATION',
      configJson: { triggerKey: 'workflow.reimbursement_ready_for_payment', recipientPermissions: ['reimbursement.payment.record'], severity: 'action' },
    }];
    const readyRule = (over: Partial<SeedRule> = {}) => syncOwned({ templateKey: 'reimbursement_ready_for_payment', cooldownSeconds: 0, actionJson: before, ...over });
    const repo = fakeRepo([readyRule(), readyRule({ companyId: 'co_2', updatedByUserId: 'admin_1' })]);

    assert.deepEqual(await resyncWorkflowTemplateRulesForCompany(repo, 'co_1'), ['reimbursement_ready_for_payment']);
    assert.deepEqual(await resyncWorkflowTemplateRulesForCompany(repo, 'co_2'), []);

    const cfg = (rule: any) => rule.actionJson[0].configJson;
    const [pinned, edited] = [repo.rules.find((r: any) => r.id === 'pre_0'), repo.rules.find((r: any) => r.id === 'pre_1')];
    assert.deepEqual(cfg(pinned).preferRecipientPayloadKeys, ['actorUserId', 'approverRecipientUserIds']);
    assert.deepEqual(cfg(pinned).neverPreferRecipientPayloadKeys, ['requesterUserId']);
    // The runner reads the version snapshot, not the row.
    const latest = repo.versions.filter((v: any) => v.ruleId === 'pre_0').sort((a: any, b: any) => b.version - a.version)[0];
    assert.deepEqual(latest.actionSnapshotJson, catalogActions('reimbursement_ready_for_payment'));
    assert.equal(cfg(edited).preferRecipientPayloadKeys, undefined);
  });

  it('is idempotent: a second run re-pins nothing and adds no version', async () => {
    const repo = fakeRepo([syncOwned()]);
    await resyncWorkflowTemplateRulesForCompany(repo, 'co_1');
    const versionCount = repo.versions.length;

    assert.deepEqual(await resyncWorkflowTemplateRulesForCompany(repo, 'co_1'), []);
    assert.equal(repo.versions.length, versionCount);
  });

  it('leaves rules autoEnable just created untouched', async () => {
    const repo = fakeRepo();
    await autoEnableWorkflowTemplatesForCompany(repo, 'co_1');
    const versionCount = repo.versions.length;

    assert.deepEqual(await resyncWorkflowTemplateRulesForCompany(repo, 'co_1'), []);
    assert.equal(repo.versions.length, versionCount);
  });

  it('never touches an admin-created or admin-edited rule', async () => {
    const repo = fakeRepo([
      syncOwned({ createdByUserId: 'admin_1', updatedByUserId: 'admin_1' }),
      syncOwned({ updatedByUserId: 'admin_1' }),
    ]);

    assert.deepEqual(await resyncWorkflowTemplateRulesForCompany(repo, 'co_1'), []);
    assert.ok(repo.rules.every((r: any) => r.cooldownSeconds === 3600));
  });

  it('updates a sync-owned DISABLED rule\'s row without re-enabling it', async () => {
    const repo = fakeRepo([syncOwned({ status: 'DISABLED' })]);

    assert.deepEqual(await resyncWorkflowTemplateRulesForCompany(repo, 'co_1'), ['reimbursement_pending_approval']);
    const rule = repo.rules.find((r: any) => r.id === 'pre_0');
    assert.equal(rule.status, 'DISABLED');
    assert.equal(rule.cooldownSeconds, 0);
    assert.equal(repo.versions.filter((v: any) => v.ruleId === 'pre_0').length, 1);
  });

  it('leaves an archived rule alone', async () => {
    const repo = fakeRepo([syncOwned({ status: 'ARCHIVED' })]);

    assert.deepEqual(await resyncWorkflowTemplateRulesForCompany(repo, 'co_1'), []);
    assert.equal(repo.rules.find((r: any) => r.id === 'pre_0').cooldownSeconds, 3600);
  });
});
