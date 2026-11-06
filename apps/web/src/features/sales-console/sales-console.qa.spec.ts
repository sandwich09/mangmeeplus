/**
 * Source-text guards for the sales console. Every page here is a client component whose behaviour
 * lives behind `useEffect`/`useState`, so nothing in a unit test renders them — these assert the
 * decisions the logic module cannot make on its own and that a reviewer would otherwise have to
 * re-check by eye on every diff.
 *
 * Same shape as `SignupQueuePage.qa.spec.ts`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { apiErrorMessage } from '../../common/api/api-error-message';

const PAGES = [
  'SalesCompaniesPage.tsx', 'SalesConsoleParts.tsx', 'SalesDealFormPage.tsx', 'SalesDealsPage.tsx',
  'SalesEventBatchForm.tsx', 'SalesEventBatchPage.tsx', 'SalesEventsPage.tsx',
  'SalesDemoLinkDialog.tsx', 'SalesMyWorkPage.tsx', 'SalesMyProfilePage.tsx', 'SalesProfileEditor.tsx', 'SalesReportsPage.tsx', 'SalesTeamPage.tsx',
  // Sales-event report view of /sales/reports (SD-E).
  'SalesEventReportSection.tsx',
];

const SHELL = join(__dirname, '../../common/components/app-shell/SalesHeader.tsx');

function source(page: string): string {
  return readFileSync(join(__dirname, page), 'utf8');
}

describe('sales console theme and copy', () => {
  // The list does the work, so a new page quietly skipping it would retire the guard rather than
  // fail it — which is exactly how an unthemed screen ships.
  it('scans every page component in the feature', () => {
    const present = readdirSync(__dirname).filter((name) => name.endsWith('.tsx') && !name.includes('.spec.'));
    assert.deepEqual([...PAGES].sort(), present.sort());
  });

  for (const page of [...PAGES, SHELL]) {
    const label = page.endsWith('SalesHeader.tsx') ? 'SalesHeader.tsx' : page;
    const text = page.endsWith('SalesHeader.tsx') ? readFileSync(page, 'utf8') : source(page);

    it(`${label} uses มั่งมี tokens, never a raw colour`, () => {
      // Tokens are redefinable per theme; a literal is not, and one hex here is how a console
      // starts drifting away from the rest of the product. Arbitrary SIZES (`text-[15px]`) are the
      // repo's existing idiom and are left alone — only arbitrary COLOURS are the drift.
      assert.doesNotMatch(text, /#[0-9a-fA-F]{3,8}\b/, `${label} hardcodes a colour`);
      assert.doesNotMatch(
        text,
        /(?:bg|text|border|ring|fill|stroke|from|via|to)-\[(?:#|rgb|hsl|color)/,
        `${label} uses an arbitrary colour utility`,
      );
    });

    it(`${label} shows no raw API diagnostic`, () => {
      // The screen a เซลล์ reads in front of a shop owner is the last place an English stack
      // message belongs; every catch routes through the reviewed Thai map.
      assert.doesNotMatch(text, /\bcatch\s*\([A-Za-z_$][\w$]*\)\s*\{[^}]*\.message\b/, `${label} displays a caught message`);
    });
  }

  it('a suspended account gets one plain notice from the shell and can only sign out (RB-36)', () => {
    // Every sales route refuses a suspended account with this code. The shell's own read runs on
    // every screen, so it is where the console stops looking broken and says what happened.
    const shell = readFileSync(SHELL, 'utf8');
    assert.match(shell, /setSuspended\(apiErrorCode\(cause\) === 'SALES_AGENT_SUSPENDED'\)/);
    assert.match(shell, /<AlertModal open=\{suspended && !signOutFailed\} title="บัญชีทีมขายถูกระงับ"[^\n]*onClose=\{\(\) => void handleSignOut\(\)\}/);
    // The pages underneath route the same refusal through the shared map, in the same words.
    assert.match(apiErrorMessage({ code: 'SALES_AGENT_SUSPENDED' }), /^บัญชีทีมขายถูกระงับ /);
  });

  it('the deal form reloads instead of retrying blindly on a version conflict (R3)', () => {
    const text = source('SalesDealFormPage.tsx');
    assert.match(text, /SALES_DEAL_STATE_CONFLICT/);
    assert.match(text, /โหลดข้อมูลล่าสุด/);
  });

  it('the deal form sends the version it read, so a concurrent edit cannot be overwritten', () => {
    const text = source('SalesDealFormPage.tsx');
    assert.match(text, /version: deal\.version/);
    assert.match(text, /version: saved\.version/);
  });

  it('approve and reject are rendered only for a holder of sales.deal.approve on a PENDING deal (D2)', () => {
    const text = source('SalesDealFormPage.tsx');
    assert.match(text, /canApprove && deal\.status === 'PENDING_APPROVAL'/);
  });

  it('the หัวหน้า can read team profiles and admin can edit them', () => {
    const text = source('SalesTeamPage.tsx');
    assert.match(text, /<div className="grid gap-4 rounded-xl border[^\n]*>\s*<p[^>]*>ข้อมูลภาษีและบัญชีธนาคาร/);
    assert.match(text, /profile: \{/);
    assert.match(text, /getSalesTeamProfile\(agent\.userId\)/);
    assert.match(text, /\{admin && <button[^\n]*onClick=\{\(\) => setProfileEditing\(true\)\}/);
  });

  it('the one-time password is shown once, with a copy button and no promise it can be fetched again (Q3/S28)', () => {
    const text = source('SalesConsoleParts.tsx');
    assert.match(text, /แสดงครั้งเดียว/);
    assert.match(text, /navigator\.clipboard\?\.writeText\(credential\.temporaryPassword\)/);
    assert.match(text, /ยังไม่ได้ผูก LINE/);
  });

  it('shows the returned temporary password above the team list after create or reset', () => {
    const team = source('SalesTeamPage.tsx');
    assert.match(team, /setCredential\(result\.credential\);[\s\S]{0,300}await load\(\)/);
    assert.match(team, /setCredential\(await \(admin \? resetSalesAgentCredential\(agent\.userId\) : resetSalesTeamCredential\(agent\.userId\)\)\)/);
    assert.ok(team.indexOf('{credential && <SalesCredentialPanel') < team.indexOf('{agents === null'));
  });

  it('reading an agent profile says on screen that the read is recorded (S10)', () => {
    assert.match(source('SalesTeamPage.tsx'), /ระบบบันทึกการเปิดดูข้อมูลนี้ไว้ทุกครั้ง/);
  });

  it('warns from the current base and catalog term while retaining saved shop usage (S31/Q5)', () => {
    const text = source('SalesDealFormPage.tsx');
    assert.match(text, /catalogMonths = values.autoRenew \? values.cadence === 'year' \? 12 : 1 : months/);
    assert.match(text, /dealCatalogPriceSatang\(values.base, catalogMonths\)/);
    assert.match(text, /company\.branchCount, employeeCount: company\.employeeCount/);
    assert.doesNotMatch(text, /จะแสดงหลังบันทึกฉบับร่าง/, 'the counts are live now — the apology is stale');
  });

  it('the referral repair on the partner page is bounded and reasoned (D6)', () => {
    const text = readFileSync(join(__dirname, '../system-partners/PartnerDetailPage.tsx'), 'utf8');
    // The credit decides a เซลล์'s numbers: it may never be changed silently, nor offered after
    // the window the API enforces.
    assert.match(text, /disabled=\{disabled \|\| !windowOpen\}/);
    assert.match(text, /disabled=\{busy \|\| !reason\.trim\(\) \|\| Boolean\(codeError\)\}/);
    assert.match(text, /salesCode: trimmedCode \|\| null/, 'an empty code must clear the credit, not send ""');
    assert.match(text, /apiErrorMessage\(\{ code: 'SALES_REFERRAL_WINDOW_CLOSED' \}\)/, 'the closed-window sentence must come from the shared map');
  });

  it('company search waits for the minimum length and debounces, because every call is audited (S33)', () => {
    for (const page of ['SalesCompaniesPage.tsx', 'SalesDealFormPage.tsx']) {
      assert.match(source(page), /SALES_COMPANY_SEARCH_MIN_CHARS/, page);
      assert.match(source(page), /setTimeout\(/, page);
    }
  });

  it('creating a deal from a searched shop preserves that exact shop (P2)', () => {
    assert.match(source('SalesCompaniesPage.tsx'), /\/sales\/deals\/new\?companyId=\$\{encodeURIComponent\(company\.companyId\)\}/);
    const form = source('SalesDealFormPage.tsx');
    assert.match(form, /searchSalesCompanies\(preselectedCompanyId\)/);
    assert.match(form, /item\.companyId === preselectedCompanyId/);
  });

  it('the console never renders a shop field the search contract does not carry (Q4/S33)', () => {
    // Revenue, receipts and owner contact are exactly what "ค้นหาได้ทุกร้าน" must not hand out, and
    // a shop object is the only place they could come from — so the guard looks for the property
    // access, not the word, which a comment would also match.
    for (const page of PAGES) {
      assert.doesNotMatch(
        source(page),
        /\b(?:company|item|shop)\.(?:ownerDisplayName|ownerName|contactEmail|phoneNumber|revenue\w*|receipt\w*|taxId)\b/,
        page,
      );
    }
  });

  it('the report never links to a financial document (§B)', () => {
    // A เซลล์ may see what a shop opened with, never its invoices or receipts — so the guard is on
    // the link, not the word, which the module's own comment about the rule would also match.
    assert.doesNotMatch(source('SalesReportsPage.tsx'), /(?:href|<Link)[^\n]*(?:billing|invoice|receipt|document)/i);
  });

  it('the report prints each deduction as its own line through the reviewed Thai wording (§17.1)', () => {
    const text = source('SalesReportsPage.tsx');
    // Every month card lists its own deductions, and every word of a line comes from the logic
    // module — the page itself never prints a kind, an id or a currency code.
    assert.match(text, /month\.deductions\.map\(\(deduction, index\) =>/);
    assert.match(text, /salesDeductionLine\(deduction,/);
    assert.doesNotMatch(text, /deduction\.(?:kind|salesUserId)\}|THB/);
    // Stacked, with the amount held to its own width: the line fits a 390 px phone.
    assert.match(text, /<li key=\{`\$\{deduction\.occurredAt\}:\$\{index\}`\} className="flex items-start justify-between gap-3">\s*<div className="min-w-0">/);
    assert.match(text, /<p className="shrink-0 text-sm font-bold text-error-700">\{line\.amount\}<\/p>/);
    // A month or an agent taken below zero is marked, never painted as a sale: the badge, the
    // phone card, the table row and the month total all go through the one rule.
    assert.match(text, /tone=\{month\.totals\.amountSatang < 0 \? 'danger' : 'brand'\}/);
    assert.match(text, /const amountClass = \(satang: number, positive: string\) => \(satang < 0 \? 'text-error-700' : positive\);/);
    assert.equal([...text.matchAll(/amountClass\((?:row|totals)\.amountSatang, /g)].length, 3);
  });

  it('the report sets a shop waiting for review apart, in the words the queue uses (§17.1, owner 2026-10-02)', () => {
    const text = source('SalesReportsPage.tsx');
    // The column, the phone card and the list title all take the word from the logic module, which
    // the queue's badge is built from too; the report never says it another way.
    assert.match(text, /\{ key: 'flaggedCount', label: SALES_WAITING \}/);
    assert.match(text, /\{SALES_WAITING\} \{row\.flaggedCount\} ร้าน · \{SALES_WAITING_NOTE\}/);
    assert.match(text, /ร้านที่\{SALES_WAITING\} · \{SALES_WAITING_NOTE\}/);
    assert.doesNotMatch(text, /ถูกธง|ตั้งธง|ติดธง/);
    // Every month card names its waiting shops, each line worded by the logic module.
    assert.match(text, /month\.waiting\.map\(\(waiting, index\) =>/);
    assert.match(text, /salesWaitingLine\(waiting,/);
    assert.doesNotMatch(text, /waiting\.(?:flags|source|salesUserId)\}/);
    // 390 px: a shop name with no place to break still wraps instead of pushing the card sideways.
    assert.match(text, /<p className="text-sm font-semibold text-gray-900 \[overflow-wrap:anywhere\]">\{line\.title\}<\/p>/);
    assert.match(text, /<p className="mt-0\.5 text-xs text-warning-700 \[overflow-wrap:anywhere\]">\{line\.detail\}<\/p>/);
    assert.match(text, /\{totals\.flaggedCount > 0 && <SalesNotice tone="warning">\{salesWaitingNotice\(totals\.flaggedCount\)\}<\/SalesNotice>\}/);
  });

  it('the flag queue says where each row stands and offers only a decision that still changes something (§17.1)', () => {
    const text = source('SalesTeamPage.tsx');
    // The standing and the open decisions come from the logic module, which reads the report's own
    // rule — the page never decides by itself whether a row is cut out.
    assert.match(text, /const review = salesFlagReview\(row\);/);
    assert.match(text, /<MangmeeBadge tone=\{review\.tone\}>\{review\.label\}<\/MangmeeBadge>/);
    assert.match(text, /\{review\.detail && <p className="mt-1 break-words text-xs text-gray-500">\{review\.detail\}<\/p>\}/);
    assert.match(text, /\{review\.canConfirm && \(\s*<button[^\n]*\n[^\n]*setFlagDecision\(\{ row, keep: false \}\); \}\}>ยืนยันว่าไม่ผิดปกติ<\/button>/);
    assert.match(text, /\{review\.canExclude && \(\s*<button[^\n]*\n[^\n]*setFlagDecision\(\{ row, keep: true \}\); \}\}>ตัดออกจากยอด<\/button>/);
    // And the Owner is told a cut-out shop stays in this list.
    assert.match(text, /ร้านที่คุณตัดออกจะไม่นับให้เซลล์ และยังอยู่ในรายการนี้ให้ตรวจย้อนหลัง/);
    // Owner 2026-10-02: a waiting shop is no opened shop either, and confirming it names the month that gains it.
    assert.match(text, /ยังไม่นับเป็นร้านที่เปิดและยังไม่นับในยอดของเซลล์จนกว่าคุณจะตรวจ/);
    assert.match(text, /: salesFlagConfirmEffect\(flagDecision\?\.row\.paidAt\)\}/);
    // 390 px: the queue and its card may shrink below a long shop name, which is then cut with an
    // ellipsis instead of pushing the page sideways (measured in a browser: 276 px before).
    assert.match(text, /<section aria-label="รายการที่ถูกธง" className="grid min-w-0 gap-3">/);
    assert.match(text, /<MangmeeCard className="min-w-0">\s*\{flags\.map\(/);
    assert.match(text, /<p className="min-w-0 truncate text-\[15px\] font-bold text-gray-900">\{row\.companyName\}<\/p>/);
  });

  it('a flagged attribution is only cleared or kept with a reason the Owner typed (D6)', () => {
    const text = source('SalesTeamPage.tsx');
    assert.match(text, /disabled=\{busy \|\| !flagReason\.trim\(\)\}/);
    assert.match(text, /reviewSalesAttributionFlag\(flagDecision\.row\.companyId, \{ keep: flagDecision\.keep/);
  });

  it('44px touch targets come from the shared button primitive, not a per-page height', () => {
    for (const page of PAGES) {
      const text = source(page);
      const buttons = [...text.matchAll(/<button\b[^>]*className="([^"]*)"/g)].map((match) => match[1]!);
      for (const className of buttons) {
        assert.ok(
          /mangmee-btn|min-h-1[12]/.test(className),
          `${page}: a button without a 44px-tall primitive: ${className}`,
        );
      }
    }
  });
});
