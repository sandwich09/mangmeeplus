/** Offline P5.3 proof. Run from the gateway with node --import tsx ../../scripts/help-cards-for-owner-2026-11-04.ts. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { INPUT_VAT_RIGHT_LABEL, THAI_SYSTEM_ROLE_NAMES, type LineAiTurnResponse } from '../packages/contracts/src';
import { activeProductHelpPack, productHelpAction } from '../apps/ai-gateway/src/modules/line-ai/agents/approved-product-help';
import { renderApprovedKnowledge, type KnowledgeAccess } from '../apps/ai-gateway/src/modules/line-ai/agents/approved-knowledge';
import { PLAIN_WORDS_HELP_DRAFTS } from '../apps/ai-gateway/src/modules/line-ai/agents/product-help-draft-cards';
import { buildLineBusinessAnswerMessage, productHelpQuickReply } from '../apps/api/src/modules/line-ai/domain/logic/line-business-card.logic';

const root = resolve(__dirname, '..');
const target = 'scripts/out/help-cards-for-owner-2026-11-04.md';
const pack = activeProductHelpPack();
const original = JSON.stringify(pack);
assert.equal(pack.contentHash, '0bab85e0afa9cc83d0ab71af7d12f2110f7749f7461532c8c159711c81c008c0');
const companyId = 'owner-review';
const webBase = 'https://preview.invalid'; // Synthetic links only; no request is sent.
const access: KnowledgeAccess = {
  release: '2.4.0', member: true, language: 'th', now: new Date(),
  permissions: [...new Set(pack.cards.flatMap(card => [...card.permissionAnyOf, ...card.requiredPermissions]))],
  featureKeys: null, capabilities: [...new Set(pack.cards.flatMap(card => card.requiredCapabilities))],
};
const snapshot: { cards: Array<{ id: string; titleTh: string; answerTh: string; titleEn: string; answerEn: string }> } = JSON.parse(readFileSync(resolve(root, 'apps/web/src/features/public-home/home-help-v6.json'), 'utf8'));
const output = [
  '# คำตอบคู่มือสำหรับให้เจ้าของกิจการตรวจ — 4 พฤศจิกายน 2569',
  'ร่างเท่านั้น ยังไม่อนุมัติและยังไม่เผยแพร่ ไม่มีการเปลี่ยน pack, reviewer, revision หรือ source hash ที่ใช้อยู่',
  `ชุดที่ใช้อยู่: v${pack.version} · ${pack.contentHash}`,
  'ใช้สิทธิ์ตัวอย่างที่อ่านการ์ดเหล่านี้ได้และลิงก์ร้านสมมติ ไม่มีการเรียกโมเดล ส่ง LINE หรืออ่านข้อมูลร้านจริง',
  'ร้านฟรีแบบเก็บร่างยังใช้ทางจำกัดเดิมก่อนถึง Gateway; ตัวอย่างนี้ไม่เปิดสิทธิ์คู่มือหรือการเงินให้ร้านฟรี',
  'C71 เป็นคำตอบหน้าเว็บไซต์ด้วย จึงแสดงข้อความเว็บไซต์แยกจากคำตอบ LINE ที่ใช้อยู่',
  'ร่างแสดงด้วยตัวเรนเดอร์เดิมในหน่วยความจำ ไม่สร้าง pack ที่อ้างว่าอนุมัติร่างแล้ว',
];
const quote = (text: string) => text.split('\n').map(line => `> ${line}`).join('\n');
function collect(value: unknown, texts: string[], buttons: string[]) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { value.forEach(item => collect(item, texts, buttons)); return; }
  const node = value as Record<string, unknown>;
  if ((node.type === 'text' || node.type === 'span') && typeof node.text === 'string') texts.push(node.text);
  const action = node.action as Record<string, unknown> | undefined;
  if (action && typeof action.label === 'string') buttons.push(`${action.label} → ${String(action.uri ?? action.text ?? action.data ?? '')}`);
  Object.values(node).forEach(item => collect(item, texts, buttons));
}
for (const draft of PLAIN_WORDS_HELP_DRAFTS) {
  const card = pack.cards.find(card => card.id === draft.id);
  assert.ok(card, draft.id);
  const reviewed = renderApprovedKnowledge(pack, [card.id], access, companyId);
  assert.ok(reviewed, `Current access/time denied ${card.id}`);
  const publicCard = snapshot.cards.find(card => card.id === draft.id);
  output.push(`\n## ${draft.change} · ${draft.channel} · ${draft.id}`);
  if (draft.channel === 'PUBLIC') {
    assert.ok(publicCard);
    output.push('คำถามหน้าเว็บเดิม → ร่าง', quote(`${publicCard.titleTh} → ${draft.title ?? publicCard.titleTh}`),
      'คำตอบหน้าเว็บเดิม → ร่าง', quote(`${publicCard.answerTh}\n→ ${draft.body}`));
    if (draft.bodyEn) output.push('คำตอบภาษาอังกฤษเดิม → ร่าง', quote(`${publicCard.answerEn}\n→ ${draft.bodyEn}`));
  }
  for (const proposed of [false, true]) {
    const title = proposed ? draft.title ?? card.title : card.title;
    const body = proposed ? draft.body : card.body;
    output.push(`\n### ${proposed ? 'ร่างให้ตรวจ (ยังไม่เผยแพร่)' : 'LINE ที่อนุมัติใช้อยู่'}`, 'ชื่อคำถาม', quote(title), 'เนื้อหาการ์ด', quote(body));
    // Preserve the real guide renderer/access gate. Change only the local presentation for review.
    const help = { ...reviewed, replyText: `${title}\n${body}`,
      webLinks: reviewed.webLinks.map(link => ({ ...link, label: title })),
      sourceRefs: reviewed.sourceRefs.map(ref => ({ ...ref, label: title })),
      presentation: { kind: 'answer_cards' as const, cards: [{ title, text: body, sourceLabels: [title], webLink: { ...reviewed.webLinks[0]!, label: title } }] },
    };
    const action = productHelpAction({ text: title, selectedKnowledgeCardIds: [card.id], permissions: access.permissions, featureKeys: access.featureKeys, companyId, language: 'th' });
    if (action) output.push('เส้นทางจริงให้คำแนะนำการทำงานแทนเนื้อหาการ์ดนี้ (คงพฤติกรรมเดิม)', quote(action.replyText));
    const response: LineAiTurnResponse = {
      requestId: 'offline-owner-review', replyText: action?.replyText ?? help.replyText,
      presentation: action?.presentation ?? help.presentation,
      sourceRefs: help.sourceRefs, sourceLabels: [title], webLinks: help.webLinks,
      intent: 'capability_help', agent: 'general', refused: false, toolsInvoked: [], durationMs: 0,
    };
    const message = buildLineBusinessAnswerMessage(response, response.replyText, webBase, companyId, title, 'th');
    const texts: string[] = [], buttons: string[] = [];
    collect(message.type === 'flex' ? message.contents : message, texts, buttons);
    collect(productHelpQuickReply(response, access.permissions, null, 'th'), [], buttons);
    output.push('ข้อความจากตัวเรนเดอร์ LINE', quote(texts.join('\n')), 'ปุ่มติดตาม', ...(buttons.length ? buttons.map(button => `- ${button}`) : ['- ไม่มี']));
  }
}
output.push('\n## ประโยคคู่มือที่รอบ 1–2 เปลี่ยน: เดิม → ใหม่');
for (const file of ['expenses-guide.content.ts', 'substitute-receipt-guide.content.ts']) {
  const path = `apps/web/src/features/user-guide/${file}`;
  const diff = execFileSync('git', ['diff', '--unified=0', '69e6c12c5^', '59ea8fca3', '--', path], { cwd: root, encoding: 'utf8' });
  output.push(`\n### ${path}`);
  let before: string[] = [], after: string[] = [];
  const strings = (line: string) => {
    const rendered = line.replace(/\$\{INPUT_VAT_RIGHT_LABEL\}/g, INPUT_VAT_RIGHT_LABEL)
      .replace(/\$\{THAI_SYSTEM_ROLE_NAMES\.(\w+)\}/g, (_, role: keyof typeof THAI_SYSTEM_ROLE_NAMES) => THAI_SYSTEM_ROLE_NAMES[role]);
    return [...rendered.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)].map(match => match[2]!).filter(value => /[ก-๙]/.test(value));
  };
  const flush = () => {
    assert.equal(before.length, after.length, `Review changed sentence extraction: ${file}`);
    before.forEach((old, index) => { if (old !== after[index]) output.push(`- เดิม: ${old}\n  ใหม่: ${after[index]}`); });
    before = []; after = [];
  };
  for (const line of diff.split('\n')) {
    if (line.startsWith('@@')) flush();
    else if (line.startsWith('-') && !line.startsWith('---')) before.push(...strings(line.slice(1)));
    else if (line.startsWith('+') && !line.startsWith('+++')) after.push(...strings(line.slice(1)));
  }
  flush();
}
output.push('\n## Source hash ที่ยังรอ P5.4 (อ่านเพื่อเทียบ ไม่ได้แก้ hash ที่อนุมัติ)');
for (const file of ['expenses-guide.content.ts', 'substitute-receipt-guide.content.ts']) {
  const sourceFile = `apps/web/src/features/user-guide/${file}`;
  const card = pack.cards.find(card => card.sourceFile === sourceFile)!;
  const current = createHash('sha256').update(readFileSync(resolve(root, sourceFile))).digest('hex');
  output.push(`- ${sourceFile}\n  อนุมัติไว้: ${card.sourceHash}\n  ไฟล์ปัจจุบัน: ${current}`);
}
assert.equal(JSON.stringify(activeProductHelpPack()), original, 'Preview must not mutate the approved pack');
const markdown = `${output.join('\n\n')}\n`;
const ignored = spawnSync('git', ['check-ignore', '--quiet', target], { cwd: root });
assert.ok(ignored.status === 0 || ignored.status === 1, 'git check-ignore failed');
if (ignored.status === 0) {
  mkdirSync(dirname(resolve(root, target)), { recursive: true });
  writeFileSync(resolve(root, target), markdown);
  process.stdout.write(`Saved ignored owner-review output: ${target}\n`);
} else {
  process.stderr.write(`${target} is not ignored; printing the review to stdout without creating it.\n`);
  process.stdout.write(markdown);
}
