// Pure source probes only: no application bootstrap, database, provider, or network calls.
// Run from any directory: node <repo>/docs/evidence/mangmee-ai-readiness-2026-09-26/consistency-domain-probes.cjs
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../../..');
const ts = require(path.join(root, 'apps/ai-gateway/node_modules/typescript'));
const Decimal = require(path.join(root, 'apps/api/node_modules/decimal.js'));
const baseline = 'f932b57766f5dd22c0d28aedd4bc06f210e374ef';
const sources = [];
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trimEnd();
assert.equal(git('rev-parse', `${baseline}^{commit}`), baseline);

function source(file) {
  const text = git('show', `${baseline}:${file}`);
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const record = { path: file, gitBlob: git('rev-parse', `${baseline}:${file}`), declarations: [] };
  sources.push(record);
  return {
    ast,
    declaration(name) {
      const node = ast.statements.find(statement =>
        (ts.isFunctionDeclaration(statement) && statement.name?.text === name)
        || (ts.isVariableStatement(statement) && statement.declarationList.declarations.some(item => item.name.getText(ast) === name)));
      assert.ok(node, `${file}: missing declaration ${name}`);
      record.declarations.push({ name, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1 });
      return node.getText(ast).replace(/^export\s+/, '');
    },
  };
}

function evaluate(code, dependencies = {}) {
  const context = vm.createContext(dependencies);
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInContext(js, context, { timeout: 1000 });
  return context;
}

const registry = source('packages/contracts/src/ai-tools.ts');
const toolArray = registry.ast.statements.find(statement => ts.isVariableStatement(statement)
  && statement.declarationList.declarations.some(item => item.name.getText(registry.ast) === 'LINE_TOOL_REGISTRY'))
  .declarationList.declarations.find(item => item.name.getText(registry.ast) === 'LINE_TOOL_REGISTRY').initializer;
const toolNode = toolArray.elements.find(item => ts.isObjectLiteralExpression(item)
  && item.properties.some(property => ts.isPropertyAssignment(property)
    && property.name.getText(registry.ast) === 'name' && property.initializer.text === 'ledger.get_financial_summary'));
assert.ok(toolNode);
const toolMeta = evaluate(`globalThis.tool = (${toolNode.getText(registry.ast)});`).tool;
const orchestrator = source('apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.ts');
const sanitizer = evaluate(['LOOP_DATE_PATTERN', 'LOOP_PERIOD_KEY_PATTERN', 'DATE_INPUT_FIELDS', 'PERIOD_KEY_INPUT_FIELDS', 'sanitizeToolInput']
  .map(name => orchestrator.declaration(name)).join('\n'));
const requested = { periodKey: '2026-08' };
const sanitized = sanitizer.sanitizeToolInput(toolMeta, requested, { periodKeys: new Set(['2026-08']) });
assert.equal(JSON.stringify(sanitized), '{}');
const ledgerPeriod = {
  tool: toolMeta.name,
  registryLine: registry.ast.getLineAndCharacterOfPosition(toolNode.getStart(registry.ast)).line + 1,
  declaredInputFields: [...(toolMeta.requiredInputFields ?? []), ...(toolMeta.optionalInputFields ?? [])],
  requested, sanitized,
  finding: 'Explicit periodKey is removed by the real sanitizer because the real registry entry declares no input fields.',
};

const erp = source('apps/api/src/modules/line-ai/application/use-cases/erp-tools.use-case.ts');
const period = evaluate(['DATE_PATTERN', 'resolvePeriodInput', 'isCivilDate', 'resolveExpensePeriodInput']
  .map(name => erp.declaration(name)).join('\n'), {
  // Only clock helpers are fixture stubs; both period-validation functions are extracted unchanged.
  bangkokToday: () => '2026-09-26',
  currentMonthRange: () => ({ fromDate: '2026-09-01', toDate: '2026-09-26' }),
});
const dateCases = [
  { toDate: '2026-08-31' },
  { fromDate: 'bad', toDate: 'bad' },
  { fromDate: '2026-02-30', toDate: '2026-02-30' },
].map(input => ({ input, sharedHelper: period.resolvePeriodInput(input), expenseStrictHelper: period.resolveExpensePeriodInput(input) }));
assert.equal(dateCases[0].sharedHelper.fromDate, '1970-01-01');
assert.equal(dateCases[1].sharedHelper.defaulted, true);
assert.equal(dateCases[2].sharedHelper.fromDate, '2026-02-30');
assert.ok(dateCases.every(item => item.expenseStrictHelper.invalid === true));

const ledger = source('apps/api/src/modules/ledger/domain/logic/journal-balance.logic.ts');
const balance = evaluate(['decimal', 'deriveBalance'].map(name => ledger.declaration(name)).join('\n'), { Decimal });
const amount = '90071992547409.9900';
const actual = balance.deriveBalance('CREDIT', '0', amount);
const precision = { input: amount, actual4dp: actual.toFixed(4), actual2dp: actual.toFixed(2),
  expected4dp: new Decimal(amount).toFixed(4), expected2dp: new Decimal(amount).toFixed(2),
  precondition: 'Synthetic large amount within Decimal(18,4); one CREDIT-normal balance. P&L formats this numeric return with toFixed(4).',
};
assert.equal(precision.actual4dp, '90071992547409.9844');
assert.equal(precision.actual2dp, '90071992547409.98');
assert.equal(precision.expected2dp, '90071992547409.99');

const result = {
  baseline, generatedAt: new Date().toISOString(),
  command: 'node docs/evidence/mangmee-ai-readiness-2026-09-26/consistency-domain-probes.cjs',
  mode: 'pure_pinned_source_extraction',
  dependencies: { node: process.version, typescript: ts.version },
  sources,
  fixtures: { clock: '2026-09-26', timezone: 'Asia/Bangkok' },
  checks: { ledgerPeriod, dateCases, precision },
  limitations: [
    'Source-level probes, not live runtime, natural-language end-to-end, deployment, or incident-frequency evidence.',
    'Actual pinned functions and registry object are transpiled into isolated VM contexts; application modules are not bootstrapped.',
    'Date clock helpers are deterministic fixture stubs; no database, network, cloud, or model provider is called.',
    'Precision probe covers an unusually large valid stored amount; it does not establish customer exposure.',
    'The runner writes only its adjacent JSON evidence file; no application source is changed.',
  ],
};
const output = path.join(__dirname, 'consistency-domain-probes.json');
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ baseline, output, ledgerPeriod, dateCases, precision }));
