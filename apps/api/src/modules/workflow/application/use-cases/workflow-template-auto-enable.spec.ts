import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  autoEnableWorkflowTemplatesForCompany,
  closeSettledClaimTasksAtRelease,
  resyncWorkflowTemplateRulesForCompany,
  WORKFLOW_AUTO_ENABLE_ACTOR_USER_ID,
} from './workflow-template.use-case';
import {
  WORKFLOW_TEMPLATE_CATALOG,
  WORKFLOW_TEMPLATE_DEFAULT_COOLDOWN_SECONDS,
  WORKFLOW_TEMPLATE_DEFAULT_TRIGGER_CONFIG,
} from '../../domain/workflow-template-catalog';
import { nextActionHint, summarizeAction, summarizeCondition, summarizeTrigger } from '../../domain/logic/workflow-explanation.logic';
import { toTemplateSummary } from '../dto/workflow.mapper';

const AUTO_ENABLE_KEYS = WORKFLOW_TEMPLATE_CATALOG.filter((t) => t.autoEnable).map((t) => t.key);

describe('shop-facing workflow template text', () => {
  it('keeps all system template names and descriptions in Thai', () => {
    for (const template of WORKFLOW_TEMPLATE_CATALOG) {
      for (const text of [template.name, template.description, template.unavailableReason ?? '']) {
        if (!text) continue;
        const withoutAllowedTerms = text.replace(/\b(?:LINE|QR|AI|PDF|VAT|Excel|CSV)\b/g, '');
        assert.match(withoutAllowedTerms, /[\u0E00-\u0E7F]/, template.key);
        assert.doesNotMatch(withoutAllowedTerms, /[A-Za-z]/, template.key);
      }
    }
  });

  it('keeps run explanations in Thai without exposing trigger details or action keys', () => {
    const explanation = [
      summarizeTrigger('SLA_SCAN', 'inventory', 'stock.low'),
      summarizeCondition({ matched: false, errors: ['condition.invalid_key'] } as any),
      summarizeAction({ actionKey: 'send_alert_1', actionType: 'SEND_NOTIFICATION', configJson: {} } as any, 'FAILED_RETRYABLE'),
      nextActionHint('FAILED'),
    ].join(' ');
    const withoutAllowedTerms = explanation.replace(/\b(?:LINE|QR|AI|PDF|VAT|Excel|CSV)\b/g, '');
    assert.match(withoutAllowedTerms, /[\u0E00-\u0E7F]/);
    assert.doesNotMatch(withoutAllowedTerms, /[A-Za-z]/);
    assert.doesNotMatch(explanation, /inventory|stock\.low|send_alert_1|condition\.invalid_key/);
  });

  it('uses current catalogue copy if a stored template row still has the old English values', () => {
    const seed = WORKFLOW_TEMPLATE_CATALOG.find((template) => template.key === 'daily_owner_summary')!;
    const view = toTemplateSummary({
      id: 'template-1', key: seed.key, name: 'Daily owner summary', description: 'Old English description',
      unavailableReason: 'Old English reason', category: seed.category, sourceModule: seed.sourceModule,
      triggerType: seed.triggerType, defaultConditionJson: seed.defaultConditionJson, defaultActionJson: seed.defaultActionJson,
      requiredPermissions: seed.requiredPermissions, requiredSourceModules: seed.requiredSourceModules,
      defaultEnabled: seed.defaultEnabled, status: seed.status,
    } as any);
    assert.equal(view.name, seed.name);
    assert.equal(view.description, seed.description);
    assert.equal(view.unavailableReason, seed.unavailableReason);
  });
});

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
  /**
   * What the sync had pinned on the rule (its version 1), when the row no longer says the same:
   * an admin's real edit. Left out, the row is exactly what was pinned.
   */
  pinned?: { cooldownSeconds?: number; actionJson?: unknown };
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
  rules.forEach((rule, index) => {
    const pinned = seedRules[index]!.pinned;
    versions.push({
      ruleId: rule.id, companyId: rule.companyId, version: 1, status: rule.status,
      cooldownSeconds: pinned?.cooldownSeconds ?? rule.cooldownSeconds, triggerSnapshotJson: rule.triggerConfigJson,
      conditionSnapshotJson: rule.conditionJson, actionSnapshotJson: pinned?.actionJson ?? rule.actionJson,
      // Mirrors toRuleVersion: whoever created the rule wrote its first version.
      createdBy: rule.createdByUserId,
    });
  });
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
    createRuleVersion: async (data: any) => { versions.push({ ...data, createdBy: data.createdByUserId }); return data; },
    listRuleVersions: async (ruleId: string) => versions.filter((v) => v.ruleId === ruleId).sort((a, b) => a.version - b.version),
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
    const pending = repo.rules.find((r: any) => r.name === 'คำขอเบิกค่าใช้จ่ายรออนุมัติ');
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
    // One less for the rule that was there, and one for the notice that follows its switch: "a corrected
    // payout account waits for your approval" is created switched off beside it.
    assert.equal(created.includes('reimbursement_payout_correction_submitted'), false);
    assert.equal(created.length, AUTO_ENABLE_KEYS.length - 2);
    const preexisting = repo.rules.find((r: any) => r.id === 'pre_0');
    assert.equal(preexisting.status, 'DISABLED');
    assert.equal(preexisting.createdByUserId, 'admin_1');
    assert.equal(repo.rules.filter((r: any) => r.templateId === preexisting.templateId).length, 1);
  });

  // Review: a rule added in a later release was created switched on even where the company had
  // switched the notice next to it off.
  it('creates a new notice switched off where the company switched off the one it sits next to', async () => {
    const repo = fakeRepo([
      { templateKey: 'reimbursement_payment_recorded', status: 'DISABLED' },
      { templateKey: 'approval_sla_breach', status: 'DISABLED' },
    ]);

    const enabled = await autoEnableWorkflowTemplatesForCompany(repo, 'co_1');

    const ruleOf = (key: string) => repo.rules.find((r: any) => r.templateId === repo.templates.find((t: any) => t.key === key).id && r.id.startsWith('rule_'));
    for (const key of ['reimbursement_payment_voided', 'reimbursement_payment_sla_breach']) {
      assert.equal(enabled.includes(key), false, key);
      assert.equal(ruleOf(key).status, 'DISABLED', key);
      assert.equal(ruleOf(key).createdByUserId, WORKFLOW_AUTO_ENABLE_ACTOR_USER_ID, key);
      // Not enabled, so no version: the admin's own enable snapshots it.
      assert.equal(repo.versions.some((v: any) => v.ruleId === ruleOf(key).id), false, key);
    }
    // Everything else is switched on as usual, and a second run creates nothing more.
    assert.equal(ruleOf('reimbursement_ready_for_payment').status, 'ENABLED');
    assert.deepEqual(await autoEnableWorkflowTemplatesForCompany(repo, 'co_1'), []);
  });

  it('creates the new notices switched on where the one next to them is on, or was never there', async () => {
    const withSiblingsOn = fakeRepo([
      { templateKey: 'reimbursement_payment_recorded', status: 'ENABLED' },
      { templateKey: 'approval_sla_breach', status: 'ENABLED' },
    ]);
    const fresh = fakeRepo();

    for (const repo of [withSiblingsOn, fresh]) {
      const enabled = await autoEnableWorkflowTemplatesForCompany(repo, 'co_1');
      assert.ok(enabled.includes('reimbursement_payment_voided'));
      assert.ok(enabled.includes('reimbursement_payment_sla_breach'));
    }
  });

  // Payout spec §17.3: the two notices of a payout account correction arrive at a release, for companies
  // that already run the other claim notices. Each sits next to the notice it resembles and follows its switch.
  it('creates the two payout correction notices beside the notices they resemble, on or off as those are', async () => {
    const keys = ['reimbursement_payout_correction_requested', 'reimbursement_payout_correction_submitted'] as const;
    const repo = fakeRepo([
      // The company switched off "your claim needs correcting" and kept "a claim waits for your approval".
      { templateKey: 'reimbursement_correction_requester', status: 'DISABLED' },
      { templateKey: 'reimbursement_pending_approval', status: 'ENABLED' },
    ]);
    const enabled = await autoEnableWorkflowTemplatesForCompany(repo, 'co_1');
    const ruleOf = (key: string) => repo.rules.find((r: any) => r.templateId === repo.templates.find((t: any) => t.key === key).id && r.id.startsWith('rule_'));
    const [requested, submitted] = keys.map(ruleOf);
    assert.deepEqual(keys.map((key) => enabled.includes(key)), [false, true]);
    assert.deepEqual([requested.status, submitted.status], ['DISABLED', 'ENABLED']);
    for (const [key, rule] of [[keys[0], requested], [keys[1], submitted]] as const) {
      const template = WORKFLOW_TEMPLATE_CATALOG.find((t) => t.key === key)!;
      assert.deepEqual([rule.triggerType, rule.triggerConfigJson, rule.cooldownSeconds, rule.createdByUserId],
        ['EVENT', { eventType: key.replace('reimbursement_', 'reimbursement.') }, 0, WORKFLOW_AUTO_ENABLE_ACTOR_USER_ID], key);
      assert.deepEqual(rule.actionJson, template.defaultActionJson, key);
      assert.deepEqual(rule.conditionJson, template.defaultConditionJson, key);
    }
    // The enabled one is versioned, so the runner has a snapshot to read; the other waits for the admin's own enable.
    assert.deepEqual([repo.versions.some((v: any) => v.ruleId === requested.id), repo.versions.filter((v: any) => v.ruleId === submitted.id).map((v: any) => v.version)], [false, [1]]);
    assert.deepEqual(await autoEnableWorkflowTemplatesForCompany(repo, 'co_1'), []);

    // A company with neither sibling, or with both on, gets both switched on.
    for (const other of [fakeRepo(), fakeRepo([{ templateKey: 'reimbursement_correction_requester', status: 'ENABLED' }, { templateKey: 'reimbursement_pending_approval', status: 'ENABLED' }])]) {
      const created = await autoEnableWorkflowTemplatesForCompany(other, 'co_1');
      assert.deepEqual(keys.map((key) => created.includes(key)), [true, true]);
    }
  });

  it('creates the requester block notice following the requester decision switch, once per company', async () => {
    for (const status of ['ENABLED', 'DISABLED', undefined]) {
      const repo = fakeRepo(status ? [{ templateKey: 'reimbursement_decision_requester', status }] : []);
      const enabled = await autoEnableWorkflowTemplatesForCompany(repo, 'co_1');
      const template = repo.templates.find((t: any) => t.key === 'reimbursement_finance_blocked_requester');
      assert.ok(template);
      const rule = repo.rules.find((r: any) => r.templateId === template.id);
      assert.equal(rule.status, status ?? 'ENABLED');
      assert.equal(enabled.includes(template.key), status !== 'DISABLED');
      assert.deepEqual(rule.triggerConfigJson, { eventType: 'reimbursement.finance_review_updated' });
      assert.equal(rule.cooldownSeconds, 0);
      assert.deepEqual(await autoEnableWorkflowTemplatesForCompany(repo, 'co_1'), []);
    }
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
    assert.equal(repo.rules.find((r: any) => r.name === 'คำขอเบิกค่าใช้จ่ายรออนุมัติ').cooldownSeconds, 0);
    assert.equal(repo.rules.find((r: any) => r.name === 'รายการเบิกจ่ายรออนุมัติเกินกำหนด').cooldownSeconds, 3600);
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
    const adminsOwn = [{ ...before[0]!, configJson: { ...before[0]!.configJson, recipientRoles: ['FINANCE'] } }];
    const repo = fakeRepo([readyRule(), readyRule({ companyId: 'co_2', updatedByUserId: 'admin_1', actionJson: adminsOwn, pinned: { actionJson: before } })]);

    assert.deepEqual(await resyncWorkflowTemplateRulesForCompany(repo, 'co_1'), ['reimbursement_ready_for_payment']);
    assert.deepEqual(await resyncWorkflowTemplateRulesForCompany(repo, 'co_2'), []);

    const cfg = (rule: any) => rule.actionJson[0].configJson;
    const [pinned, edited] = [repo.rules.find((r: any) => r.id === 'pre_0'), repo.rules.find((r: any) => r.id === 'pre_1')];
    // In the order the claim page names whose turn it is: the finance reviewer who passed the claim first.
    assert.deepEqual(cfg(pinned).preferRecipientPayloadKeys, ['financeReviewerUserId', 'actorUserId', 'approverRecipientUserIds']);
    assert.deepEqual(cfg(pinned).neverPreferRecipientPayloadKeys, ['requesterUserId']);
    // The runner reads the version snapshot, not the row.
    const latest = repo.versions.filter((v: any) => v.ruleId === 'pre_0').sort((a: any, b: any) => b.version - a.version)[0];
    assert.deepEqual(latest.actionSnapshotJson, catalogActions('reimbursement_ready_for_payment'));
    assert.equal(cfg(edited).preferRecipientPayloadKeys, undefined);

    // A rule the sync pinned with the earlier order (the actor first) picks the new order up the same way.
    const [catalogAction] = catalogActions('reimbursement_ready_for_payment');
    const actorFirst = [{ ...catalogAction!, configJson: { ...catalogAction!.configJson, preferRecipientPayloadKeys: ['actorUserId', 'approverRecipientUserIds'] } }];
    const earlier = fakeRepo([readyRule({ actionJson: actorFirst })]);
    assert.deepEqual(await resyncWorkflowTemplateRulesForCompany(earlier, 'co_1'), ['reimbursement_ready_for_payment']);
    assert.deepEqual(cfg(earlier.rules.find((r: any) => r.id === 'pre_0')).preferRecipientPayloadKeys, ['financeReviewerUserId', 'actorUserId', 'approverRecipientUserIds']);
  });

  // Payout spec §17.3: the "paid" notice prints the sentence the payment event carries. A company whose
  // rule the sync pinned before that picks it up at the next release; a rule an admin worded keeps its
  // words, and goes on rendering from the fields the event still carries.
  it('re-pins a paid rule pinned before the event carried its sentence, and leaves an admin-worded one alone', async () => {
    const pinnedBody = 'จ่ายแล้ว {{paidAmount}} {{currency}} · เลขที่จ่าย {{paymentNo}}';
    const [catalogAction] = catalogActions('reimbursement_payment_recorded');
    const before = [{ ...catalogAction!, configJson: { ...catalogAction!.configJson, bodyTemplate: pinnedBody } }];
    const adminsOwn = [{ ...catalogAction!, configJson: { ...catalogAction!.configJson, bodyTemplate: 'โอนให้แล้ว {{paidAmount}} {{currency}}' } }];
    const paidRule = (over: Partial<SeedRule> = {}) => syncOwned({ templateKey: 'reimbursement_payment_recorded', cooldownSeconds: 0, actionJson: before, ...over });
    const repo = fakeRepo([
      paidRule(),
      paidRule({ companyId: 'co_2', updatedByUserId: 'admin_1', actionJson: adminsOwn, pinned: { actionJson: before } }),
      // Switched off by the company: brought up to date, and still off.
      paidRule({ companyId: 'co_3', status: 'DISABLED', updatedByUserId: 'admin_1' }),
    ]);

    assert.deepEqual(await resyncWorkflowTemplateRulesForCompany(repo, 'co_1'), ['reimbursement_payment_recorded']);
    assert.deepEqual(await resyncWorkflowTemplateRulesForCompany(repo, 'co_2'), []);
    assert.deepEqual(await resyncWorkflowTemplateRulesForCompany(repo, 'co_3'), ['reimbursement_payment_recorded']);

    const body = (rule: any) => rule.actionJson[0].configJson.bodyTemplate;
    const [pinned, edited, off] = ['pre_0', 'pre_1', 'pre_2'].map((id) => repo.rules.find((r: any) => r.id === id));
    assert.equal(body(pinned), '{{paidNotice}}');
    // The runner reads the version snapshot, not the row.
    const latest = repo.versions.filter((v: any) => v.ruleId === 'pre_0').sort((a: any, b: any) => b.version - a.version)[0];
    assert.deepEqual(latest.actionSnapshotJson, catalogActions('reimbursement_payment_recorded'));
    assert.equal(body(edited), 'โอนให้แล้ว {{paidAmount}} {{currency}}');
    assert.deepEqual([body(off), off.status], ['{{paidNotice}}', 'DISABLED']);
    // Who is told and where the notice leads did not change with the wording.
    const config = catalogAction!.configJson;
    assert.deepEqual([config['recipientPayloadKeys'], config['excludeRecipientPayloadKeys'], config['deepLinkPathTemplate']],
      [['requesterUserId'], ['actorUserId'], '/companies/{{companyId}}/reimbursements/{{requestId}}']);
    assert.equal(config['recipientPermissions'] ?? config['recipientRoles'], undefined);
  });

  // The release-time sync decides "an admin edited this" by content, not by who stamped the row.
  it('re-pins the payout correction notices when their words change, and leaves one an admin worded alone', async () => {
    for (const key of ['reimbursement_payout_correction_requested', 'reimbursement_payout_correction_submitted']) {
      const [catalogAction] = catalogActions(key);
      const worded = (bodyTemplate: string) => [{ ...catalogAction!, configJson: { ...catalogAction!.configJson, bodyTemplate } }];
      const before = worded('ข้อความรุ่นก่อน {{requestNo}}');
      const rule = (over: Partial<SeedRule> = {}) => syncOwned({ templateKey: key, cooldownSeconds: 0, actionJson: before, ...over });
      const repo = fakeRepo([
        rule(),
        rule({ companyId: 'co_2', updatedByUserId: 'admin_1', actionJson: worded('ผู้ดูแลเขียนเอง {{requestNo}}'), pinned: { actionJson: before } }),
        // Switched off and on by an admin, nothing in it edited: brought up to date like the first.
        rule({ companyId: 'co_3', status: 'DISABLED', updatedByUserId: 'admin_1' }),
      ]);
      assert.deepEqual(await resyncWorkflowTemplateRulesForCompany(repo, 'co_1'), [key]);
      assert.deepEqual(await resyncWorkflowTemplateRulesForCompany(repo, 'co_2'), []);
      assert.deepEqual(await resyncWorkflowTemplateRulesForCompany(repo, 'co_3'), [key]);
      const body = (id: string) => repo.rules.find((r: any) => r.id === id).actionJson[0].configJson.bodyTemplate;
      assert.deepEqual([body('pre_0'), body('pre_1'), body('pre_2')],
        [catalogAction!.configJson['bodyTemplate'], 'ผู้ดูแลเขียนเอง {{requestNo}}', catalogAction!.configJson['bodyTemplate']], key);
      assert.equal(repo.rules.find((r: any) => r.id === 'pre_2').status, 'DISABLED', key);
      const latest = repo.versions.filter((v: any) => v.ruleId === 'pre_0').sort((a: any, b: any) => b.version - a.version)[0];
      assert.deepEqual(latest.actionSnapshotJson, catalogActions(key), key);
      assert.deepEqual(await resyncWorkflowTemplateRulesForCompany(repo, 'co_1'), [], `${key}: a second run changes nothing`);
    }
  });

  // Owner decision 2026-10-02: the finance desk's arrival notice leaves the shop owner out while anyone else can
  // review. That template has shipped, so companies hold a rule of it: the next release brings up to date a rule the
  // sync pinned, also one a company only switched off; a rule an admin really changed keeps what it was given.
  it('re-pins a finance arrival rule pinned before the shop owner was left out, and leaves an admin-edited one alone', async () => {
    const key = 'reimbursement_finance_review_pending';
    const [catalogAction] = catalogActions(key);
    // As shipped: every holder of the right, and the actor of the event left out.
    const { lastResortRecipientRoles: _lastResort, webOnlyRecipientPayloadKeys: _bellOnly, ...common } = catalogAction!.configJson;
    const shippedConfig = { ...common, excludeRecipientPayloadKeys: ['actorUserId'], skipWhenAllRecipientsExcluded: true };
    const shipped = [{ ...catalogAction!, configJson: shippedConfig }];
    const adminsOwn = [{ ...catalogAction!, configJson: { ...shippedConfig, titleTemplate: 'มีใบเบิกมาถึงฝ่ายการเงิน: {{requestNo}}' } }];
    const rule = (over: Partial<SeedRule> = {}) => syncOwned({ templateKey: key, cooldownSeconds: 0, actionJson: shipped, ...over });
    const repo = fakeRepo([
      rule(),
      rule({ companyId: 'co_2', updatedByUserId: 'admin_1', actionJson: adminsOwn, pinned: { actionJson: shipped } }),
      rule({ companyId: 'co_3', status: 'DISABLED', updatedByUserId: 'admin_1' }),
    ]);

    assert.deepEqual(await resyncWorkflowTemplateRulesForCompany(repo, 'co_1'), [key]);
    assert.deepEqual(await resyncWorkflowTemplateRulesForCompany(repo, 'co_2'), []);
    assert.deepEqual(await resyncWorkflowTemplateRulesForCompany(repo, 'co_3'), [key]);

    const config = (id: string) => repo.rules.find((r: any) => r.id === id).actionJson[0].configJson;
    assert.deepEqual(['pre_0', 'pre_1', 'pre_2'].map((id) => config(id).lastResortRecipientRoles), [['OWNER'], undefined, ['OWNER']]);
    // And with it the actor's own notice in the web bell only (decided the same day), in place of leaving the actor out.
    assert.deepEqual(['pre_0', 'pre_1', 'pre_2'].map((id) => [config(id).webOnlyRecipientPayloadKeys, config(id).excludeRecipientPayloadKeys]),
      [[['actorUserId'], undefined], [undefined, ['actorUserId']], [['actorUserId'], undefined]]);
    // The admin's rule is exactly what the admin left: their title, and every holder of the right as before.
    assert.deepEqual(repo.rules.find((r: any) => r.id === 'pre_1').actionJson, adminsOwn);
    assert.equal(repo.rules.find((r: any) => r.id === 'pre_2').status, 'DISABLED');
    // The runner reads the version snapshot, not the row.
    const latest = repo.versions.filter((v: any) => v.ruleId === 'pre_0').sort((a: any, b: any) => b.version - a.version)[0];
    assert.deepEqual([latest.version, latest.actionSnapshotJson], [2, catalogActions(key)]);
    assert.deepEqual(await resyncWorkflowTemplateRulesForCompany(repo, 'co_1'), [], 'a second run changes nothing');
  });

  // Owner decision 2026-10-02: the finance desk's "blocked" notice takes the rule of the arrival notice, the shop owner
  // only as the last resort. The release pins this unshipped template with the requester excluded too.
  it('re-pins a finance "blocked" rule pinned before the shop owner was left out, and leaves an admin-edited one alone', async () => {
    const key = 'reimbursement_finance_review';
    const [catalogAction] = catalogActions(key);
    const { lastResortRecipientRoles: _lastResort, ...withoutLastResort } = catalogAction!.configJson;
    const shippedConfig = { ...withoutLastResort, excludeRecipientPayloadKeys: ['actorUserId'] };
    const shipped = [{ ...catalogAction!, configJson: shippedConfig }];
    const adminsOwn = [{ ...catalogAction!, configJson: { ...shippedConfig, bodyTemplate: 'ฝ่ายการเงินระงับใบนี้ ยอด {{amount}} {{currency}}' } }];
    const rule = (over: Partial<SeedRule> = {}) => syncOwned({ templateKey: key, cooldownSeconds: 0, actionJson: shipped, ...over });
    const repo = fakeRepo([
      rule(),
      rule({ companyId: 'co_2', updatedByUserId: 'admin_1', actionJson: adminsOwn, pinned: { actionJson: shipped } }),
      rule({ companyId: 'co_3', status: 'DISABLED', updatedByUserId: 'admin_1' }),
    ]);

    assert.deepEqual(await resyncWorkflowTemplateRulesForCompany(repo, 'co_1'), [key]);
    assert.deepEqual(await resyncWorkflowTemplateRulesForCompany(repo, 'co_2'), []);
    assert.deepEqual(await resyncWorkflowTemplateRulesForCompany(repo, 'co_3'), [key]);

    const config = (id: string) => repo.rules.find((r: any) => r.id === id).actionJson[0].configJson;
    assert.deepEqual(['pre_0', 'pre_1', 'pre_2'].map((id) => config(id).lastResortRecipientRoles), [['OWNER'], undefined, ['OWNER']]);
    // The requester gets their own notice, including when they can also review finance.
    assert.deepEqual(config('pre_0').excludeRecipientPayloadKeys, ['actorUserId', 'requesterUserId']);
    assert.deepEqual({ ...config('pre_0'), lastResortRecipientRoles: undefined, excludeRecipientPayloadKeys: undefined }, { ...shippedConfig, lastResortRecipientRoles: undefined, excludeRecipientPayloadKeys: undefined });
    assert.deepEqual(repo.rules.find((r: any) => r.id === 'pre_1').actionJson, adminsOwn);
    assert.equal(repo.rules.find((r: any) => r.id === 'pre_2').status, 'DISABLED');
    const latest = repo.versions.filter((v: any) => v.ruleId === 'pre_0').sort((a: any, b: any) => b.version - a.version)[0];
    assert.deepEqual([latest.version, latest.actionSnapshotJson], [2, catalogActions(key)]);
    assert.deepEqual(await resyncWorkflowTemplateRulesForCompany(repo, 'co_1'), [], 'a second run changes nothing');
  });

  // Owner decision 2026-10-02: the approval reminder goes to the claim's approvers and no longer adds the shop owner.
  // That template has shipped too: a rule the sync pinned stops naming the owner at the next release, the task beside
  // the notice is as it was, and a rule an admin really changed goes on naming whoever it named.
  it('re-pins an approval reminder rule pinned while it still added the shop owner, and leaves an admin-edited one alone', async () => {
    const key = 'approval_sla_breach';
    const [notice, task] = catalogActions(key);
    const shipped = [{ ...notice!, configJson: { ...notice!.configJson, recipientPayloadKeys: ['approverRecipientUserIds', 'ownerRecipientUserIds'] } }, task!];
    const adminsOwn = [{ ...shipped[0]!, configJson: { ...shipped[0]!.configJson, severity: 'action' } }, task!];
    // A scan rule keeps the default cooldown, which is what `syncOwned` seeds.
    const rule = (over: Partial<SeedRule> = {}) => syncOwned({ templateKey: key, actionJson: shipped, ...over });
    const repo = fakeRepo([
      rule(),
      rule({ companyId: 'co_2', updatedByUserId: 'admin_1', actionJson: adminsOwn, pinned: { actionJson: shipped } }),
      rule({ companyId: 'co_3', status: 'DISABLED', updatedByUserId: 'admin_1' }),
    ]);

    assert.deepEqual(await resyncWorkflowTemplateRulesForCompany(repo, 'co_1'), [key]);
    assert.deepEqual(await resyncWorkflowTemplateRulesForCompany(repo, 'co_2'), []);
    assert.deepEqual(await resyncWorkflowTemplateRulesForCompany(repo, 'co_3'), [key]);

    const named = (id: string) => repo.rules.find((r: any) => r.id === id).actionJson[0].configJson.recipientPayloadKeys;
    assert.deepEqual(['pre_0', 'pre_1', 'pre_2'].map(named),
      [['approverRecipientUserIds'], ['approverRecipientUserIds', 'ownerRecipientUserIds'], ['approverRecipientUserIds']]);
    assert.deepEqual(repo.rules.find((r: any) => r.id === 'pre_1').actionJson, adminsOwn);
    assert.equal(repo.rules.find((r: any) => r.id === 'pre_2').status, 'DISABLED');
    const latest = repo.versions.filter((v: any) => v.ruleId === 'pre_0').sort((a: any, b: any) => b.version - a.version)[0];
    assert.deepEqual([latest.version, latest.cooldownSeconds, latest.actionSnapshotJson], [2, 3600, catalogActions(key)]);
    // The task of the reminder is assigned as before.
    assert.deepEqual(latest.actionSnapshotJson[1], task);
    assert.deepEqual(await resyncWorkflowTemplateRulesForCompany(repo, 'co_1'), [], 'a second run changes nothing');
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
      // The sync pinned cooldown 0; an admin has since set it to an hour.
      syncOwned({ updatedByUserId: 'admin_1', pinned: { cooldownSeconds: 0 } }),
    ]);

    assert.deepEqual(await resyncWorkflowTemplateRulesForCompany(repo, 'co_1'), []);
    assert.ok(repo.rules.every((r: any) => r.cooldownSeconds === 3600));
  });

  // Review: enable and disable stamp the admin's id on the rule without changing anything. Read as
  // an edit, that stamp left such a company on the old definition for good.
  it('re-pins a rule an admin only switched off and on, because nothing in it was edited', async () => {
    const stale = [{ actionKey: 'notify_approver', actionType: 'SEND_NOTIFICATION', configJson: { recipientRoles: ['MANAGER'] } }];
    const repo = fakeRepo([
      // ENABLED again by the admin: their enable wrote version 2 with the very same content.
      syncOwned({ cooldownSeconds: 0, actionJson: stale, updatedByUserId: 'admin_1' }),
      // Switched off by the admin and left off.
      syncOwned({ companyId: 'co_2', cooldownSeconds: 0, actionJson: stale, updatedByUserId: 'admin_1', status: 'DISABLED' }),
    ]);
    repo.versions.push({ ...repo.versions[0], version: 2, createdBy: 'admin_1' });

    assert.deepEqual(await resyncWorkflowTemplateRulesForCompany(repo, 'co_1'), ['reimbursement_pending_approval']);
    assert.deepEqual(await resyncWorkflowTemplateRulesForCompany(repo, 'co_2'), ['reimbursement_pending_approval']);

    const [toggled, switchedOff] = [repo.rules.find((r: any) => r.id === 'pre_0'), repo.rules.find((r: any) => r.id === 'pre_1')];
    assert.deepEqual(toggled.actionJson, catalogActions('reimbursement_pending_approval'));
    assert.equal(toggled.status, 'ENABLED');
    assert.deepEqual(switchedOff.actionJson, catalogActions('reimbursement_pending_approval'));
    // The admin's switch is respected: the definition is current, the rule stays off.
    assert.equal(switchedOff.status, 'DISABLED');
  });

  it('leaves alone a rule whose action an admin really changed, however it was stamped', async () => {
    const pinnedBySync = [{ actionKey: 'notify_approver', actionType: 'SEND_NOTIFICATION', configJson: { recipientRoles: ['MANAGER'] } }];
    const adminsOwn = [{ actionKey: 'notify_approver', actionType: 'SEND_NOTIFICATION', configJson: { recipientRoles: ['OWNER'] } }];
    const repo = fakeRepo([syncOwned({ cooldownSeconds: 0, actionJson: adminsOwn, updatedByUserId: 'admin_1', pinned: { actionJson: pinnedBySync } })]);

    assert.deepEqual(await resyncWorkflowTemplateRulesForCompany(repo, 'co_1'), []);
    assert.deepEqual(repo.rules[0].actionJson, adminsOwn);
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

// Review: the sweep of stale approval tasks rides on the release's template sync. It is
// housekeeping, and a failure in it must not fail that step and with it the release.
describe('closeSettledClaimTasksAtRelease', () => {
  it('returns how many tasks it closed', async () => {
    assert.equal(await closeSettledClaimTasksAtRelease({ closeSettledClaimTasks: async () => 7 } as any), 7);
  });

  it('reports a failure and lets the release step go on', async () => {
    const reported: any[] = [];
    const repo = { closeSettledClaimTasks: async () => { throw new Error('relation "WorkflowTask" is locked'); } } as any;

    const closed = await closeSettledClaimTasksAtRelease(repo, (message, error) => { reported.push([message, (error as Error).message]); });

    assert.equal(closed, null);
    assert.equal(reported.length, 1);
    assert.match(reported[0][0], /the release continues/);
    assert.equal(reported[0][1], 'relation "WorkflowTask" is locked');
  });
});
