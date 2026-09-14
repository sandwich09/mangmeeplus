import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Only reviewed in-flight state names, never disabled/permission/validation/readonly predicates.
const PENDING = /^(busy|busyAction|busyId|busyRow|busyRuleId|busyCode|actionBusy|actionLoading|actionSaving|saving|loading|isLoading|\w+(?:Busy|Loading|Saving|Uploading|Downloading|Preparing|Processing|Submitting|Creating|Deleting|Removing|Extracting|Running|Pending|Verifying|Exporting|Reading)|creating|updating|updatingId|disablingRoleId|renewing|submitting|loggingOut|signingOut|sending|assigning|resetting|revoking|deleting|cancelling|preparing|preparingFile|preparingReceipt|exporting|processing|running|pending|applying|previewing|retrying|syncing|endingWarmup|postingExpenseId|refreshingSource|refreshing|verifying|disabling)$/;
const EXCLUDED = /\/(crm\/BroadcastPrototypePage|crm-inbox\/InboxPage|mangmee-prototype\/MangmeeModulePrototypePage)\.tsx$/;
const LOCAL_ACTION = /^(onClose|onCancel|clear|beginDraftEdit|openUpload|moveManualLine|removeManualLine|addManualLine|insertLine|removeLine|requestWorkflowFocus|navigatePreparedStep|returnToSigning)$/;

export function pendingPredicate(expression, source) {
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
    return [pendingPredicate(expression.left, source), pendingPredicate(expression.right, source)].filter(Boolean).join(' || ');
  }
  if (ts.isIdentifier(expression)) return PENDING.test(expression.text) ? expression.getText(source) : '';
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text === 'loading' ? expression.getText(source) : '';
  if (ts.isBinaryExpression(expression) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(expression.operatorToken.kind)) {
    const left = expression.left;
    if ((ts.isIdentifier(left) && PENDING.test(left.text)) || (ts.isPropertyAccessExpression(left) && left.name.text === 'id' && left.questionDotToken && ts.isIdentifier(left.expression) && PENDING.test(left.expression.text))) {
      return expression.getText(source);
    }
  }
  if (ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.ExclamationToken && ts.isPrefixUnaryExpression(expression.operand) && expression.operand.operator === ts.SyntaxKind.ExclamationToken) {
    return pendingPredicate(expression.operand.operand, source);
  }
  return '';
}

export function auditSource(text, file = 'fixture.tsx') {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const gaps = [], refinements = [];
  let covered = 0;
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      if (['button', 'Button', 'IconButton', 'ThemedFile', 'IconBtn', 'Toggle'].includes(tag)) {
        const attrs = node.attributes.properties;
        const click = attrs.find((attr) => attr.name?.getText(source) === 'onClick');
        const handler = click?.initializer && ts.isJsxExpression(click.initializer) ? click.initializer.expression : undefined;
        // Pure UI setters/cancel/navigation do not perform the operation being awaited.
        const local = handler && ts.isIdentifier(handler) && LOCAL_ACTION.test(handler.text);
        const calls = [];
        function collectCalls(n) { if (ts.isCallExpression(n)) calls.push(n.expression.getText(source)); ts.forEachChild(n, collectCalls); }
        if (handler && ts.isArrowFunction(handler)) collectCalls(handler.body);
        const settersOnly = calls.length > 0 && calls.every((name) => LOCAL_ACTION.test(name) || /^set[A-Z]|^(window\.print|.*\.(preventDefault|stopPropagation|focus)|navigateTo|router\.(push|replace))$/.test(name));
        const disabled = attrs.find((attr) => attr.name?.getText(source) === 'disabled');
        const expression = disabled?.initializer && ts.isJsxExpression(disabled.initializer) ? disabled.initializer.expression : undefined;
        const predicate = expression ? pendingPredicate(expression, source) : '';
        if (predicate && (local || settersOnly)) {
          const existing = attrs.find((attr) => attr.name?.getText(source) === 'aria-busy');
          if (existing?.getText(source) === `aria-busy={Boolean(${predicate})}`) refinements.push({ from: existing.getStart(source) - 1, to: existing.end, text: '' });
        }
        if (predicate && !local && !settersOnly) {
          const name = tag === 'button' ? 'aria-busy' : 'loading';
          const active = [];
          function labels(n) {
            if (ts.isConditionalExpression(n) && /กำลัง|loading|saving|sending|creating|downloading|uploading|processing|applying|renewing/i.test(n.whenTrue.getText(source))) {
              const value = pendingPredicate(n.condition, source);
              if (value) active.push(value);
            }
            ts.forEachChild(n, labels);
          }
          // Existing contextual labels already name the active row/action; keep sibling buttons
          // disabled without falsely presenting them as executing the same operation.
          if (ts.isJsxElement(node.parent)) for (const child of node.parent.children) labels(child);
          const visiblePredicate = [...new Set(active)].join(' || ') || predicate;
          const existing = attrs.find((attr) => attr.name?.getText(source) === name);
          if (existing) {
            covered += 1;
            if (visiblePredicate !== predicate && existing.getText(source) === `${name}={Boolean(${predicate})}`) refinements.push({ from: existing.getStart(source), to: existing.end, text: `${name}={Boolean(${visiblePredicate})}` });
          }
          else gaps.push({ line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, at: disabled.end, name, predicate });
          if (tag === 'button' && ts.isJsxElement(node.parent) && /InlineSpinner|animate-spin/.test(node.parent.children.map((child) => child.getText(source)).join('')) && !attrs.some((attr) => attr.name?.getText(source) === 'data-loading-indicator')) refinements.push({ from: node.attributes.end, to: node.attributes.end, text: ' data-loading-indicator' });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return { gaps, covered, refinements };
}

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? files(path) : path.endsWith('.tsx') && !EXCLUDED.test(path) ? [path] : [];
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  let remaining = 0, covered = 0, changed = 0;
  for (const file of files(resolve(root, 'apps/web/src'))) {
    let text = readFileSync(file, 'utf8');
    const result = auditSource(text, file);
    covered += result.covered;
    if (!result.gaps.length && !result.refinements.length) continue;
    if (process.argv.includes('--write')) {
      // Mechanical insertion only; original disabled/handler/label and formatting stay unchanged.
      const edits = [...result.refinements, ...result.gaps.map((gap) => ({ from: gap.at, to: gap.at, text: ` ${gap.name}={Boolean(${gap.predicate})}` }))].sort((a, b) => b.from - a.from);
      for (const edit of edits) text = `${text.slice(0, edit.from)}${edit.text}${text.slice(edit.to)}`;
      writeFileSync(file, text);
      changed += 1;
      covered += result.gaps.length;
    } else {
      remaining += result.gaps.length;
      for (const gap of result.gaps) console.log(`${relative(root, file)}:${gap.line} missing ${gap.name} (${gap.predicate})`);
    }
  }
  console.log(JSON.stringify({ covered, gaps: remaining, mechanicallyChangedFiles: changed }));
  process.exitCode = remaining ? 1 : 0;
}
