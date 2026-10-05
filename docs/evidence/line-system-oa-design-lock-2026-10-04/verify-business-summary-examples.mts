import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from '/Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus/node_modules/typescript/lib/typescript.js';
import { ResponseComposerAgent } from '/Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus/apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.ts';

const repo = '/Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus';
const dir = '/Users/thawatchai/.codex/visualizations/2026/10/02/01a0fafe-90e8-7493-ab20-40fc97d2e2fb/system-oa-flex-assets';
const spec = 'apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.spec.ts';
function source(path: string) {
  return ts.createSourceFile(path, fs.readFileSync(repo + '/' + path, 'utf8'), ts.ScriptTarget.Latest, true);
}
function literal(path: string, name: string) {
  const file = source(path);
  let found: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === name && node.initializer) found = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(found, name);
  const js = ts.transpileModule('globalThis.value = (' + found.getText(file) + ');', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const sandbox: any = {};
  vm.runInNewContext(js, sandbox);
  return JSON.parse(JSON.stringify(sandbox.value));
}
const expenseData = literal(spec, 'expenseData');
const expenseMeta = literal(spec, 'expenseMeta');
const expenseReply = await new ResponseComposerAgent().composeAnswer('ดูค่าใช้จ่ายเดือนนี้', expenseData, literal(spec, 'expenseFallback'), {
  generateText: async () => { throw new Error('Summary must use the source without a model call'); },
}, expenseMeta);
assert.equal(expenseReply, literal(spec, 'expenseSummaryTh'));

// Execute the current adapter method with only its source helpers and a mocked read service.
// No application boot, provider request, database, cloud or financial mutation occurs.
function adapter(path: string, className: string, toolName: string) {
  const file = source(path);
  const declaration = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === className) as ts.ClassDeclaration;
  assert.ok(declaration, className);
  const method = declaration.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === 'execute');
  const helper = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'toCtx');
  assert.ok(method && helper);
  const isolated = `const now = () => fixedAsOf; ${helper.getText(file)} class ReadAdapter { ${method.getText(file)} }; globalThis.ReadAdapter = ReadAdapter;`;
  const js = ts.transpileModule(isolated, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const sandbox: any = { fixedAsOf: expenseMeta.asOf };
  vm.runInNewContext(js, sandbox);
  const instance = new sandbox.ReadAdapter();
  instance.toolName = toolName;
  return instance;
}
const alertSpec = 'apps/api/src/modules/dashboard-notifications/application/use-cases/process-due-deliveries.use-case.spec.ts';
const alertFile = source(alertSpec);
let event: any;
function findEvent(node: ts.Node) {
  if (ts.isObjectLiteralExpression(node)) {
    const properties = node.properties.filter(ts.isPropertyAssignment);
    const value = (name: string) => properties.find(p => p.name.getText(alertFile) === name)?.initializer;
    const status = value('status');
    const title = value('title');
    if (status && ts.isStringLiteral(status) && status.text === 'OPEN' && title && ts.isStringLiteral(title)
      && title.text === 'อนุมัติเบิกจ่าย: RB-202608-00002') {
      event = vm.runInNewContext('(' + node.getText(alertFile) + ')');
    }
  }
  ts.forEachChild(node, findEvent);
}
findEvent(alertFile);
assert.ok(event, 'Existing OPEN reimbursement alert fixture');
const legacyDestination = new URL(event.deepLinkHref, 'https://fixture.invalid');
const requestId = legacyDestination.searchParams.get('focus');
assert.ok(requestId, 'Request ID exists in the repository alert fixture');
const proposedDetailPath = legacyDestination.pathname + '/' + requestId;
const detailRoute = 'apps/web/app/(workspace)/companies/[companyId]/reimbursements/[requestId]/page.tsx';
assert.ok(fs.readFileSync(repo + '/' + detailRoute, 'utf8').includes('ReimbursementJourneyPage'));
const alertToolPath = 'apps/api/src/modules/line-ai/application/use-cases/erp-dashboard-tools.use-case.ts';
const alerts = adapter(alertToolPath, 'NotificationsListOpenAlertsTool', 'notifications.list_open_alerts');
const context = { companyId: 'co-1', userId: 'user-1', permissions: ['notification.read'], branchIds: [], locationIds: [] };
alerts.listNotifications = { execute: async (_ctx: any, company: string, query: any) => {
  assert.equal(company, context.companyId);
  assert.equal(query.status, 'open');
  assert.equal(query.pageSize, 10);
  return { items: [event] };
} };
const alertResult = await alerts.execute(context);
assert.equal(alertResult.status, 'ok');
assert.equal(alertResult.data.count, 1);
assert.equal(alertResult.data.items[0].title, event.title);
assert.equal(alertResult.data.items[0].severity, 'ACTION');
assert.equal((await alerts.execute({ ...context, permissions: [] })).status, 'forbidden');
alerts.listNotifications = { execute: async () => ({ items: [] }) };
const emptyAlerts = await alerts.execute(context);
assert.equal(emptyAlerts.data.count, 0);
const taskPath = 'apps/api/src/modules/line-ai/application/use-cases/erp-workflow-tools.use-case.ts';
const tasks = adapter(taskPath, 'WorkflowListAssignedTasksTool', 'workflow.list_assigned_tasks');
tasks.listTasks = { execute: async (_ctx: any, query: any) => {
  assert.equal(query.scope, 'own');
  assert.equal(query.status, 'OPEN');
  return { items: [], total: 0 };
} };
const emptyTasks = await tasks.execute({ ...context, permissions: ['workflow.task.read'] });
assert.equal(emptyTasks.status, 'ok');
assert.equal(emptyTasks.data.total, 0);
const result = {
  provenance: 'Offline current source with repository test fixtures. The OPEN alert fixture was projected through the current notification read adapter. Empty results reuse the existing ERP empty-result test inputs. This is design evidence, not live shop data or a recent LINE transcript.',
  expense: { fixture: spec, question: 'ดูค่าใช้จ่ายเดือนนี้', data: expenseData[0].data, ...expenseMeta, replyText: expenseReply },
  alerts: { fixture: alertSpec, adapter: alertToolPath, ...alertResult, design: {
    requestNumber: event.title.split(': ')[1],
    currentReadPath: alertResult.sourceRefs[0].webPath,
    legacyNotificationPath: event.deepLinkHref,
    proposedDetailPath,
    verifiedRoute: detailRoute,
    limitation: 'Proposed direct destination for the design only. The current LINE read tool projects the notification-list path and does not project a reimbursement request ID or detail link.',
  } },
  emptyAlerts: { fixture: 'apps/api/src/modules/line-ai/application/use-cases/erp-empty-result-semantics.spec.ts', ...emptyAlerts },
  emptyTasks: { fixture: 'apps/api/src/modules/line-ai/application/use-cases/erp-empty-result-semantics.spec.ts', adapter: taskPath, ...emptyTasks },
};
fs.writeFileSync(dir + '/business-summary-examples.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ status: 'PASS', expenseReply, alerts: alertResult.data, emptyAlerts: emptyAlerts.data, emptyTasks: emptyTasks.data }, null, 2));
