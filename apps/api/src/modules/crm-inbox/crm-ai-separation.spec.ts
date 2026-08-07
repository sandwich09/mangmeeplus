import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const MODULE_DIR = __dirname;
const WEBHOOK_FILES = [
  join(MODULE_DIR, 'application/use-cases/process-inbound-line-message.use-case.ts'),
  join(MODULE_DIR, 'presentation/http/crm-line-webhook.controller.ts'),
];

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

function crmAiFiles(): string[] {
  return sourceFiles(MODULE_DIR).filter((file) => relative(MODULE_DIR, file).split('/').some((part) => part.startsWith('crm-ai-')));
}

describe('CRM AI assist API separation', () => {
  it('detects forbidden webhook AI client references', () => {
    const fixture = 'const client = new CrmAiGatewayClient(); import "./crm-ai-assist.use-case";';
    assert.equal(/crm-ai-|CrmAiGatewayClient/.test(fixture), true);
  });

  it('webhook files contain no CRM AI assist references', () => {
    for (const file of WEBHOOK_FILES) {
      const code = stripComments(readFileSync(file, 'utf8'));
      assert.equal(/crm-ai-|CrmAiGatewayClient/.test(code), false, `${file} must not reference CRM AI assist`);
    }
  });

  it('crm-ai files cannot reference send-capable inbox paths', () => {
    const forbidden = /SendCrmInboxMessageUseCase|line-messaging\.adapter/;
    assert.equal(forbidden.test('const x = SendCrmInboxMessageUseCase; import "./line-messaging.adapter";'), true);
    for (const file of crmAiFiles()) {
      const code = stripComments(readFileSync(file, 'utf8'));
      assert.equal(forbidden.test(code), false, `${file} must not reference send-capable code`);
    }
  });

  it('CrmAiGatewayClient is referenced only from crm-ai files within crm-inbox', () => {
    for (const file of sourceFiles(MODULE_DIR)) {
      if (file === join(MODULE_DIR, 'crm-inbox.module.ts')) continue;
      const code = stripComments(readFileSync(file, 'utf8'));
      if (!code.includes('CrmAiGatewayClient')) continue;
      assert.ok(relative(MODULE_DIR, file).split('/').some((part) => part.startsWith('crm-ai-')), `${file} references CrmAiGatewayClient outside crm-ai files`);
    }
  });

  it('keeps the send-message use case alive outside crm-ai files', () => {
    const code = readFileSync(join(MODULE_DIR, 'application/use-cases/crm-conversation.use-case.ts'), 'utf8');
    assert.equal(code.includes('export class SendCrmInboxMessageUseCase'), true);
  });

  it('keeps crm-ai gateway wiring alive', () => {
    assert.ok(
      crmAiFiles().some((file) => readFileSync(file, 'utf8').includes('CrmAiGatewayClient')),
      'at least one crm-ai file must reference CrmAiGatewayClient',
    );
  });
});
