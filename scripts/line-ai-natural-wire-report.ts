#!/usr/bin/env tsx
/** Offline review of actual synthetic LINE wire. No provider calls, link clicks, or oracle scoring. */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOutcomeMessages } from '../apps/api/src/modules/line-ai/infrastructure/line-reply.adapter';
import type { ReliabilityRuntimeManifest, RuntimeTurnEvidence } from './line-ai-reliability-runtime';
import type { ReliabilityTurnTrace } from './line-ai-reliability-fixtures';

type WebRoute = { path: string; source: string };
type LinkReview = { url: string; status: string; route?: string; source?: string };
type WireReview = { envelopeValid: boolean; issues: string[]; texts: string[]; actions: Record<string, unknown>[]; links: LinkReview[] };
type Bundle = {
  boundary: { line: string; nativeLineVerified: boolean; activationEligible: boolean };
  turnEvidence?: RuntimeTurnEvidence[];
  records?: Array<{ scenarioId: string; repeat: number; error: string | null; traces: ReliabilityTurnTrace[] }>;
  runtimeDiagnostics?: unknown[];
};
type Manifest = Pick<ReliabilityRuntimeManifest, 'corpus' | 'repeats'>;
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const json = (value: unknown) => `<pre>${escape(JSON.stringify(value ?? null, null, 2))}</pre>`;
const detail = (label: string, value: unknown) => `<details><summary>${escape(label)}</summary>${json(value)}</details>`;
const regexEscape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Actual Next page/route files; this proves source-route existence, never live authorization. */
export function repositoryWebRoutes(repoRoot: string): WebRoute[] {
  const app = resolve(repoRoot, 'apps/web/app'), routes: WebRoute[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/^(?:page|route)\.[jt]sx?$/.test(entry.name)) {
        const segments = relative(app, directory).split(sep).filter(segment => segment && !/^\(.+\)$/.test(segment) && !segment.startsWith('@'));
        routes.push({ path: `/${segments.join('/')}`, source: relative(repoRoot, path).split(sep).join('/') });
      }
    }
  };
  walk(app); return routes.sort((a, b) => (a.path.match(/\[/g)?.length ?? 0) - (b.path.match(/\[/g)?.length ?? 0) || a.path.localeCompare(b.path));
}
function matchesRoute(path: string, route: string) {
  const pattern = route.split('/').slice(1).map(segment => /^\[\[\.\.\..+\]\]$/.test(segment) ? '(?:/.*)?'
    : /^\[\.\.\..+\]$/.test(segment) ? '/.+' : /^\[.+\]$/.test(segment) ? '/[^/]+' : `/${regexEscape(segment)}`).join('');
  return new RegExp(`^${pattern || '/'}$`).test(path);
}
export function inspectWireLink(value: string, companyId: string, webBaseUrl: string | undefined, routes: WebRoute[]): LinkReview {
  let url: URL;
  try { url = new URL(value); } catch { return { url: value, status: 'invalid_url' }; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || /%2f|%5c|\\|(?:^|\/)\.\.(?:\/|$)/i.test(value)) return { url: value, status: 'invalid_url' };
  if (!webBaseUrl || !URL.canParse(webBaseUrl)) return { url: value, status: 'origin_unknown' };
  if (url.origin !== new URL(webBaseUrl).origin) return { url: value, status: 'external_not_checked' };
  let path: string;
  try { path = decodeURIComponent(url.pathname); } catch { return { url: value, status: 'invalid_url' }; }
  const tenant = path.match(/^\/companies\/([^/]+)(?:\/|$)/)?.[1];
  if (tenant && tenant !== companyId) return { url: value, status: 'cross_company' };
  const route = routes.find(item => matchesRoute(path, item.path));
  return { url: value, status: !route ? 'route_not_found' : tenant ? 'same_company_route_exists' : 'same_origin_route_exists', ...(route ? { route: route.path, source: route.source } : {}) };
}

/** Reuse the repository envelope contract. Deeper Flex rendering remains a human/native check. */
export function inspectWireMessages(messages: unknown, companyId: string, webBaseUrl: string | undefined, routes: WebRoute[]): WireReview {
  const result: WireReview = { envelopeValid: parseOutcomeMessages(messages) !== null, issues: [], texts: [], actions: [], links: [] };
  if (!result.envelopeValid) result.issues.push('invalid_repository_message_envelope');
  const visit = (value: any, key = '', depth = 0) => {
    if (!value || typeof value !== 'object') return;
    if (depth > 40) { result.issues.push('inspection_depth_exceeded'); return; }
    if ('canonicalText' in value) result.issues.push('internal_canonicalText_on_wire');
    if (value.type === 'text' && typeof value.text === 'string' && key !== 'action') result.texts.push(value.text);
    if (key === 'action') result.actions.push(value);
    for (const [childKey, child] of Object.entries(value)) {
      if (['uri', 'originalContentUrl', 'previewImageUrl', 'url'].includes(childKey) && typeof child === 'string') result.links.push(inspectWireLink(child, companyId, webBaseUrl, routes));
      visit(child, childKey, depth + 1);
    }
  };
  visit(messages);
  result.issues = [...new Set(result.issues)];
  result.links = [...new Map(result.links.map(link => [link.url, link])).values()];
  return result;
}

function renderAction(action: any) { return `<button disabled>${escape(action?.label ?? action?.type ?? 'ปุ่มไม่มี label')}</button>`; }
function renderFlex(value: any, depth = 0): string {
  if (!value || typeof value !== 'object' || depth > 40) return '';
  if (Array.isArray(value)) return value.map(item => renderFlex(item, depth + 1)).join('');
  if (value.type === 'text') return `<p>${escape(value.text)}</p>`;
  if (value.type === 'button') return renderAction(value.action);
  if (value.type === 'separator') return '<hr>';
  if (value.type === 'image') return '<p class="muted">[รูปภาพใน payload — ไม่โหลดจากเครือข่าย]</p>';
  if (value.type === 'spacer' || value.type === 'filler') return '';
  const content = ['header', 'hero', 'body', 'footer', 'contents'].map(key => renderFlex(value[key], depth + 1)).join('');
  return `<div class="${value.type === 'bubble' ? 'bubble' : value.type === 'carousel' ? 'carousel' : 'box'}">${content}</div>`;
}
function renderMessages(messages: unknown) {
  if (!Array.isArray(messages)) return '<p class="warning">messages ไม่ใช่ array</p>';
  return messages.map(message => `<div class="message">${message?.type === 'text' ? `<p>${escape(message.text)}</p>`
    : message?.type === 'flex' ? `<p class="muted">Flex · altText: ${escape(message.altText)}</p>${renderFlex(message.contents)}`
    : `<p class="muted">${escape(message?.type ?? 'unknown')} — ดู payload ด้านล่าง</p>`}
    ${Array.isArray(message?.quickReply?.items) ? `<div class="quick">${message.quickReply.items.map((item: any) => renderAction(item?.action)).join('')}</div>` : ''}</div>`).join('');
}
const milliseconds = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? `${value.toLocaleString('en-US')} ms` : 'ไม่มีหลักฐานเวลา';

export function renderNaturalWireReport(bundle: Bundle, repoRoot: string, manifestInput?: Manifest | { manifest: Manifest }): string {
  assert.ok(bundle.boundary?.line === 'synthetic_http_sink' && bundle.boundary.nativeLineVerified === false && bundle.boundary.activationEligible === false, 'WIRE_REPORT_REQUIRES_EXPLICIT_SYNTHETIC_BOUNDARY');
  const manifest = manifestInput && ('manifest' in manifestInput ? manifestInput.manifest : manifestInput);
  if (manifest) assert.ok(Number.isInteger(manifest.repeats) && manifest.repeats > 0 && Array.isArray(manifest.corpus?.fixtures), 'WIRE_REPORT_INVALID_MANIFEST');
  const routes = repositoryWebRoutes(repoRoot), evidence = bundle.turnEvidence ?? [];
  const key = (item: { scenarioId: string; repeat: number; turnIndex: number }) => `${item.scenarioId}:${item.repeat}:${item.turnIndex}`;
  const byTurn = new Map(evidence.map(item => [key(item), item]));
  assert.equal(byTurn.size, evidence.length, 'WIRE_REPORT_DUPLICATE_TURN_EVIDENCE');
  type Turn = { scenarioId: string; repeat: number; turnIndex: number; user: string; attachmentIds: string[] };
  const turns: Turn[] = manifest ? Array.from({ length: manifest.repeats }, (_, repeat) => manifest.corpus.fixtures.flatMap(row => row.turns.map((turn, turnIndex) => ({ scenarioId: row.id, repeat, turnIndex, user: turn.user, attachmentIds: turn.attachmentIds })))).flat() : [...evidence];
  const planned = new Set(turns.map(key)), extras = evidence.filter(item => !planned.has(key(item)));
  turns.push(...extras);
  const sections = turns.map(turn => {
    const observed = byTurn.get(key(turn)), record = bundle.records?.find(item => item.scenarioId === turn.scenarioId && item.repeat === turn.repeat);
    const trace = record?.traces[turn.turnIndex];
    const input = observed ?? turn;
    const inputChanged = observed && (observed.user !== turn.user || JSON.stringify(observed.attachmentIds) !== JSON.stringify(turn.attachmentIds));
    const heading = `<h2>${escape(turn.scenarioId)} · รอบ ${turn.repeat + 1} · ข้อ ${turn.turnIndex + 1}</h2><p class="question">${escape(input.user || '[ส่งไฟล์แนบ]')}</p>${input.attachmentIds.length ? `<p>ไฟล์แนบ: ${escape(input.attachmentIds.join(', '))}</p>` : ''}${inputChanged ? `<p class="warning">input ในหลักฐานไม่ตรง manifest — แสดงคำถามที่เก็บได้จริง</p>${detail('input ตาม manifest', { user: turn.user, attachmentIds: turn.attachmentIds })}` : ''}`;
    if (!observed) return `<section>${heading}<p class="warning">ไม่มีหลักฐานรอบนี้: ไม่แสดงคำตอบสมมติ และไม่นับเป็นผ่าน</p>${record?.error ? `<p>ข้อผิดพลาด: ${escape(record.error)}</p>` : ''}</section>`;
    const receipts = observed.receipts ?? [], wireReviews = receipts.map(receipt => inspectWireMessages(receipt.messages, observed.companyId, observed.webBaseUrl, routes));
    const modelTime = observed.modelWorkCompletedAtMs === null ? null : observed.modelWorkCompletedAtMs - observed.acceptedAtMs;
    const firstWire = receipts.length ? Math.min(...receipts.map(item => item.at)) - observed.acceptedAtMs : null;
    const lastWire = receipts.length ? Math.max(...receipts.map(item => item.at)) - observed.acceptedAtMs : null;
    const effects = trace?.effects;
    return `<section>${heading}
      <p>สถานะที่เก็บได้: <strong>${escape(trace?.outcome ?? 'ไม่มี trace')}</strong> · sink delivery: ${escape(observed.delivery?.status ?? 'ไม่ทราบ')}</p>
      <p>จบงานที่ runtime สังเกต: ${milliseconds(modelTime)} · wire แรก: ${milliseconds(firstWire)} · wire ล่าสุด: ${milliseconds(lastWire)}</p>
      ${receipts.length ? receipts.map((receipt, index) => `<article><p class="muted">ข้อความส่งจริงไป sink · ${escape(receipt.path)} · ${milliseconds(receipt.at - observed.acceptedAtMs)}</p>${renderMessages(receipt.messages)}
        <p>Envelope ตาม repo: ${wireReviews[index]!.envelopeValid ? 'ผ่าน' : 'ไม่ผ่าน'}${wireReviews[index]!.issues.length ? ` · ${escape(wireReviews[index]!.issues.join(', '))}` : ''}</p>
        ${wireReviews[index]!.actions.length ? detail('ชนิดปุ่ม / postback / ข้อความที่ปุ่มส่งจริง', wireReviews[index]!.actions) : ''}
        ${wireReviews[index]!.links.length ? `<p>ลิงก์ใน payload (ไม่คลิก):</p><ul>${wireReviews[index]!.links.map(link => `<li><code>${escape(link.url)}</code> — ${escape(link.status)}${link.source ? ` · <code>${escape(link.source)}</code>` : ''}</li>`).join('')}</ul>` : ''}
        ${detail('Payload จริง + receipt/hash', receipt)}</article>`).join('') : '<p class="warning">ไม่มีข้อความออกที่ sink เก็บได้</p>'}
      <p>การเปลี่ยนข้อมูลธุรกิจ: ${effects === undefined ? 'ไม่มี trace ให้ยืนยัน' : effects.length ? escape(effects.map(effect => `${effect.kind} (${effect.recordId})`).join(', ')) : 'snapshot ไม่พบการเปลี่ยนในตารางธุรกิจที่ตรวจ'}</p>
      <p>Provider usage: ${observed.providerUsage?.length ? `${observed.providerUsage.length} แถวที่บันทึกได้` : 'ไม่มีแถวที่เก็บได้ — ยังใช้ยืนยันจำนวน provider calls ไม่ได้'}</p>
      ${detail('Provider: รุ่น / token / ค่าใช้จ่าย / แหล่ง usage / reservation', { usage: observed.providerUsage, reservations: observed.reservations })}
      ${detail('ผล tool จริงสำหรับตรวจตัวเลขและแหล่งข้อมูล', observed.toolResults)}
      ${detail('ผล Gateway จริง รวม intake / semanticSubrequests / preparedPlan', observed.gatewayResponses)}
      ${detail('สถานะ preview / การยกเลิก / context / preference ก่อนและหลัง', observed.reviewState)}
      ${detail('Webhook / delivery / mutations / validation failures / source versions', { webhookEvents: observed.webhookEvents, delivery: observed.delivery, effects, validationFailures: trace?.validationFailures, criticalErrors: trace?.criticalErrors, recordError: record?.error, versions: trace?.versions })}
      <p class="muted">Snapshot ${escape(observed.sourceSnapshot)} · hash ${escape(observed.snapshotDigest)}</p></section>`;
  }).join('\n');
  const missing = turns.filter(turn => !byTurn.has(key(turn))).length;
  return `<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>NAT — ตรวจข้อความ LINE ที่ส่งจริง</title>
    <style>body{font-family:system-ui,sans-serif;color:#172438;background:#eef2f5;line-height:1.6;max-width:1100px;margin:32px auto;padding:0 18px}h1{font-size:26px}h2{font-size:20px}section{background:#fff;border:1px solid #d9e1e9;border-radius:12px;padding:22px;margin:22px 0}p{white-space:pre-wrap}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f0f3f6;padding:12px;font-size:12px}code{overflow-wrap:anywhere}.question{background:#e5f0ff;padding:12px;border-radius:8px}.message{max-width:760px;background:#eef7f1;padding:14px;margin:12px 0;border-radius:10px}.carousel{display:flex;gap:12px;overflow-x:auto}.bubble{background:white;border:1px solid #d2ddda;border-radius:12px;min-width:250px;max-width:340px;padding:14px}.bubble p{margin:8px 0}button{border:1px solid #46866a;background:#fff;color:#205f44;border-radius:7px;padding:8px 12px;margin:5px;opacity:1}.muted{color:#526174;font-size:13px}.warning{color:#8f3b15;background:#fff0de;padding:12px}details{margin:12px 0}summary{cursor:pointer;font-weight:600}article{border-top:1px solid #d9e1e9;padding:12px 0}</style>
    <h1>NAT — ตรวจข้อความ LINE ที่ส่งจริง</h1><p>จำนวนข้อในรายงาน ${turns.length} · มีหลักฐาน ${evidence.length} · ไม่มีหลักฐาน ${missing}${extras.length ? ` · หลักฐานนอก manifest ${extras.length}` : ''}</p>
    <p>สถานะการตรวจโดยคน: UNREVIEWED ทุกข้อ ใช้คำถาม/คำตอบจริงจาก artifact นี้ ไม่คำนวณคะแนนจาก golden เก่า</p>
    <p class="warning">ปลายทางเป็น synthetic LINE HTTP sink เท่านั้น ไม่ใช่ภาพจากแอป LINE และยังไม่ผ่าน native LINE acceptance ภาพการ์ดนี้จัดวางโดยประมาณ ปุ่มกดไม่ได้และไม่มีการโหลดรูปหรือเปิดลิงก์ ตรวจเพียง message envelope ของ repo และไฟล์ route ที่มีอยู่ การเข้าถึง URL / login / tenant permission / การแสดงผลจริงยังไม่ได้ทดสอบ</p>
    <p>ตัวเลข 0 ที่ปรากฏในคำตอบต้องตรวจเทียบผล tool และ source; ข้อมูลที่หายไปไม่เท่ากับ 0 แถว usage ที่ไม่มีไม่พิสูจน์ว่าไม่มี provider call การเปลี่ยน preview/context แยกจาก mutation ธุรกิจไว้ด้านล่าง ไม่มีการอนุมัติหรือเคลื่อนเงินจริงจากรายงานนี้</p>
    ${detail('ขอบเขตและข้อผิดพลาด runtime', { boundary: bundle.boundary, runtimeDiagnostics: bundle.runtimeDiagnostics })}${sections}</html>`;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const [input, output, manifestPath, repoPath] = process.argv.slice(2);
  assert.ok(input && output, 'Usage: tsx --tsconfig apps/api/tsconfig.json scripts/line-ai-natural-wire-report.ts result.json report.html [manifest.json] [repo-root]');
  const html = renderNaturalWireReport(JSON.parse(readFileSync(input, 'utf8')), resolve(repoPath ?? process.cwd()), manifestPath ? JSON.parse(readFileSync(manifestPath, 'utf8')) : undefined);
  writeFileSync(output, html, { mode: 0o600 });
  console.log(JSON.stringify({ report: resolve(output), nativeLineVerified: false, activationEligible: false }));
}
