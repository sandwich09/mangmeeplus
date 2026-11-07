import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripLineExternalBrowserParam, type LineAiTurnResponse } from '@watchdog-bms/contracts';
import {
  buildDesignedLineAnswerMessage,
  buildExpenseDraftCardMessage,
  buildExpenseDraftReviewCard,
  buildKeptReceiptCard,
  buildClaimWorkflowPicker,
  buildExpenseWorkflowPicker,
  expenseDraftCardFactsFrom,
  expenseDraftCardSubject,
  buildLineSystemTextCardMessage,
  lineAnswerCardHeader,
  type LineExpenseDraftCardFacts,
  buildAiBudgetExceededMessage,
  buildPackageRequiredMessage,
  buildSignupDoorCard,
  buildLineAssistantTextCardMessage,
  buildLineBusinessAnswerMessage,
  buildReceiptQuotaExceededMessage,
  buildReimbursementHandoffMessage,
  buildReimbursementPayerClarificationMessage,
  buildPublicPolicyCardMessage,
  isCompleteLineBusinessAnswerPresentation,
} from './line-business-card.logic';
import { resolvePublicPolicyAnswer } from './line-public-policy.logic';
import { buildContactCard, STAFF_OA_URL } from './line-staff-menu.logic';
import { ASK_PLAN_MANAGER_TH } from '../../../access-control/domain/logic/plan-manager.logic';
import { receiptQuotaExceededTextTh } from '../../../system-partner-management/domain/logic/receipt-quota.logic';
import * as cardBuilders from './line-business-card.logic';

it('CARDS-R2 reviewed workflow help keeps its reviewed bytes and offers exactly one permitted workflow', async () => {
  const { runSemanticTurnV2 } = await import('../../../../../../ai-gateway/src/modules/line-ai/agents/semantic-turn-v2');
  const { activeProductHelpPack } = await import('../../../../../../ai-gateway/src/modules/line-ai/agents/approved-product-help');
  const { LINE_CHAT_ACTIONS } = await import('@watchdog-bms/contracts');
  for (const [id, cardId, text] of [
    ['expense_submit', 'expense.confirm', 'ส่งตรวจค่าใช้จ่ายต้องทำยังไง'],
    ['expense_confirm', 'expense.confirm', 'ยืนยันค่าใช้จ่ายต้องทำยังไง'],
    ['expense_delete', 'expense.confirm', 'ลบร่างค่าใช้จ่ายต้องทำยังไง'],
    ['expense_void', 'expense.confirm', 'ยกเลิกค่าใช้จ่ายต้องทำยังไง'],
    ['expense_pay', 'payment.record', 'บันทึกจ่ายค่าใช้จ่ายต้องทำยังไง'],
    ['payment_voucher', 'voucher.create', 'สร้างใบเตรียมจ่ายต้องทำยังไง'],
    ['reimbursement_submit', 'claim.submit', 'ส่งใบเบิกอนุมัติต้องทำยังไง'],
    ['reimbursement_cancel', 'claim.cancel', 'ยกเลิกใบเบิกต้องทำยังไง'],
  ]) {
    const entry = LINE_CHAT_ACTIONS.find(action => action.id === id)!;
    const card = activeProductHelpPack().cards.find(card => card.id === cardId)!;
    assert.ok(card, cardId);
    const permissions = ['ai.tool.invoke', entry.permission, ...card.permissionAnyOf, 'expense.read', 'expense.review', 'reimbursement.read_own'];
    const result = await runSemanticTurnV2({ req: { requestId: 'cards-reviewed', webhookEventId: 'cards-reviewed', messageText: text!, messagePreviewHash: 'a'.repeat(16),
      approvedKnowledge: true, selectedKnowledgeCardIds: [cardId!], entitledFeatureKeys: ['expenses', 'reimbursement'],
      userContext: { lineUserId: 'line', internalUserId: 'user', companyId: 'company', membershipId: 'member', permissions, roles: [], locale: 'th-TH' },
      semanticSubrequests: [{ index: 0, kind: 'help', goal: text!, requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }] },
      provider: { generateText: async () => assert.fail('reviewed help cannot add a model call') }, invoke: async () => assert.fail('help cannot execute a workflow'),
      approvedKnowledgeEnabled: true, draftEditEnabled: true, reimbursementDraftEnabled: true, publicLookupEnabled: false });
    assert.equal(result.presentation?.cards[0]?.title, card.title);
    assert.equal(result.presentation?.cards[0]?.text, card.body);
    assert.equal(result.replyText, `${card.title}\n${card.body}`);
    const quick = cardBuilders.productHelpQuickReply({ ...result, refused: false } as any, permissions, new Set(['expenses', 'reimbursement']));
    assert.deepEqual(quick?.items.map(item => item.action), [{ type: 'postback', label: 'ให้น้องทำให้', data: `action=chat-action&id=${id}` }], id);
  }
});

// An explanation keeps its reviewed card's next step (PWS-LINE-HELP-ANSWER Q4); only ambiguity and access remove it.
it('CARDS-R2 reviewed help never offers two workflows, denied access or free access', async () => {
  const { productHelpAction } = await import('../../../../../../ai-gateway/src/modules/line-ai/agents/approved-product-help');
  for (const [text, cardIds, permissions, featureKeys] of [
    ['ส่งตรวจและยืนยันค่าใช้จ่ายต้องทำยังไง', ['expense.confirm'], ['expense.review', 'expense.confirm'], ['expenses']],
    ['ยกเลิกใบเบิกและส่งตรวจค่าใช้จ่ายต้องทำยังไง', ['claim.cancel', 'expense.confirm'], ['expense.review', 'reimbursement.cancel_own'], ['expenses', 'reimbursement']],
    ['ส่งตรวจค่าใช้จ่ายและสร้างใบเตรียมจ่ายต้องทำยังไง', ['expense.confirm', 'voucher.create'], ['expense.review', 'expense.confirm', 'expense.disbursement.prepare'], ['expenses']],
    ['ส่งตรวจค่าใช้จ่ายต้องทำยังไง', ['expense.confirm'], ['expense.confirm'], ['expenses']],
    ['ส่งตรวจค่าใช้จ่ายต้องทำยังไง', ['expense.confirm'], ['expense.review'], []],
  ] as const) {
    const help = productHelpAction({ text, selectedKnowledgeCardIds: cardIds, permissions, featureKeys, companyId: 'company' });
    assert.equal(cardBuilders.productHelpQuickReply({ ...help, refused: false } as any, permissions, new Set(featureKeys)), undefined, text);
  }
});

it('CARDS-1 workflow how-tos retain their postback when a reviewed card is selected and recheck R21', async () => {
  const { runSemanticTurnV2 } = await import('../../../../../../ai-gateway/src/modules/line-ai/agents/semantic-turn-v2');
  const { LINE_CHAT_ACTIONS } = await import('@watchdog-bms/contracts');
  for (const [id, cardId, question] of [
    ['expense_submit', 'expense.confirm', 'ส่งตรวจค่าใช้จ่ายต้องทำยังไง'],
    ['reimbursement_cancel', 'claim.cancel', 'ยกเลิกใบเบิกต้องทำยังไง'],
    ['payment_voucher', 'voucher.create', 'สร้างใบเตรียมจ่ายต้องทำยังไง'],
  ]) for (const allowed of [true, false]) {
    const entry = LINE_CHAT_ACTIONS.find(action => action.id === id)!;
    const permissions = allowed ? ['ai.tool.invoke', entry.permission, 'expense.read', 'reimbursement.read_own'] : [];
    const result = await runSemanticTurnV2({ req: { requestId: 'cards-howto', webhookEventId: 'cards-howto', messageText: question!, messagePreviewHash: 'a'.repeat(16),
      approvedKnowledge: true, selectedKnowledgeCardIds: [cardId!], howToActionId: entry.id, entitledFeatureKeys: ['expenses', 'reimbursement'],
      userContext: { lineUserId: 'line', internalUserId: 'user', companyId: 'company', membershipId: 'member', permissions, roles: [], locale: 'th-TH' },
      semanticSubrequests: [{ index: 0, kind: 'help', goal: question!, requiredEvidence: [], dependsOn: [], evidenceRefs: [], requestedFilters: {} }] },
      provider: { generateText: async () => assert.fail('selected how-to needs no added model call') }, invoke: async () => assert.fail('how-to cannot perform the action'),
      approvedKnowledgeEnabled: true, draftEditEnabled: true, reimbursementDraftEnabled: true, publicLookupEnabled: false });
    const quick = cardBuilders.productHelpQuickReply({ ...result, refused: false } as any, permissions, new Set(['expenses', 'reimbursement']));
    if (allowed) {
      assert.equal(result.replyText, entry.sentence);
      assert.deepEqual(quick?.items[0]?.action, { type: 'postback', label: 'ให้น้องทำให้', data: `action=chat-action&id=${id}` });
    } else {
      assert.equal(result.presentation?.cards[0]?.chatActionId, undefined);
      assert.equal(quick, undefined);
    }
  }
});

it('CARDS-1 R21 navigation accepts creator and finance rights and requires the expense feature', async () => {
  const { productHelpAction } = await import('../../../../../../ai-gateway/src/modules/line-ai/agents/approved-product-help');
  for (const [id, permission] of [['expense_submit', 'expense.update'], ['expense_delete', 'expense.update'],
    ['reimbursement_cancel', 'reimbursement.finance_review'], ['substitute_receipt', 'expense.read']]) {
    for (const featureKeys of [['expenses'], []]) {
      const help = productHelpAction({ actionId: id, permissions: [permission!], featureKeys })!;
      assert.equal(help.allowed, featureKeys.length > 0, `${id}/${featureKeys}`);
      const quick = cardBuilders.productHelpQuickReply({ ...help, refused: false } as any, [permission!], new Set(featureKeys));
      assert.equal(quick?.items[0]?.action.type, featureKeys.length ? 'postback' : undefined);
    }
  }
});

it('CARDS-2 claim action previews use Claim and Requester while expense void bytes stay pinned', async () => {
  const { buildExpenseActionCard } = await import('./line-expense-action-card.logic');
  const base: any = { token: 'preview.' + 'a'.repeat(43), previewId: 'preview', action: 'VOID', summary: 'ตรวจรายการก่อนยกเลิกค่ะ', reason: 'บันทึกซ้ำ',
    expiresAt: '2026-11-06T12:30:00Z', record: { vendorName: 'ร้านทดสอบ', amount: '170.0000', currency: 'THB', date: '2026-11-05', status: 'ยืนยันแล้ว', nextStatus: 'ยกเลิกแล้ว' } };
  const hashes = ['4d08293bf618a54e988dd1b6237aa52c592b2da2d6b8c4d9cac81043153884a6', '62c5c5b90d5bfbd5807329587d9987f0951c65a5cae2a6c122bc14e8f185ec2b',
    '8eea80ef6b5868032e4d355124612a4a75865659f0df156cf74e4f82bb9293eb', 'ccdebf7b99c308ba8c6496dc143a9b268bc8c9ce04e7c8cbe74ab9d539efac55'];
  let index = 0;
  for (const language of ['th', 'en'] as const) for (const reply of [undefined, 'ยกเลิกรายการแล้วค่ะ']) {
    const expense = buildExpenseActionCard(base, reply, language, 'https://app.example.com');
    assert.equal(createHash('sha256').update(JSON.stringify(expense)).digest('hex'), hashes[index++]);
    for (const action of ['REIMBURSEMENT_SUBMIT', 'REIMBURSEMENT_CANCEL', 'REIMBURSEMENT_APPROVE', 'REIMBURSEMENT_REJECT', 'REIMBURSEMENT_RECORD_PAYMENT']) {
      const claim = readLineSystemCard(buildExpenseActionCard({ ...base, action, record: { ...base.record, vendorName: 'สมชาย' } }, reply, language, 'https://app.example.com'));
      assert.equal(claim.header[0], language === 'th' ? 'ใบเบิก' : 'Claim');
      assert.ok(claim.rows.some(row => row[0] === (language === 'th' ? 'ผู้เบิก' : 'Requester') && row[2] === 'สมชาย'));
    }
  }
});

it('CARDS-3 declining a claim proposal uses the common label and forwards the same unsaved proposal control', async () => {
  const { buildReimbursementDraftMessages } = await import('./line-reimbursement-draft-card.logic');
  const { LineReimbursementDraftService } = await import('../../application/line-reimbursement-draft.service');
  const { LineReimbursementDraftUseCase } = await import('../../../reimbursements/application/use-cases/line-reimbursement-draft.use-case');
  const { lineControlLanguage, lineUiLabel } = await import('./line-language.logic');
  const actionId = '018fbad0-4d4e-7cc7-8e43-0123456789ac', digest = 'a'.repeat(64);
  const owner: any = { companyId: 'company', userId: 'user', membershipId: 'member', channel: 'line', channelKind: 'USER', messagingChannelId: 'oa', chatKeyHash: 'b'.repeat(64) };
  const ctx: any = { companyId: owner.companyId, userId: owner.userId, membershipId: owner.membershipId };
  const seen: any[] = [];
  const service = new LineReimbursementDraftService(new LineReimbursementDraftUseCase({ cancelDraftAction: async (input: any) => { seen.push(input); return 'cancelled'; } } as any, {} as any, {} as any));
  for (const language of ['th', 'en'] as const) {
    const preview: any = { actionId, previewRevision: 2, confirmationDigest: digest, operation: 'CREATE', warnings: [], diff: [],
      after: { requesterDisplayName: 'สมชาย', amount: '170', currency: 'THB', incurredDate: '2026-11-05', reason: 'ไปส่งเอกสาร', receiptRequirementStatus: 'ATTACHED', signatureImpact: 'NONE', lines: [] } };
    const card = readLineSystemCard(buildReimbursementDraftMessages({ status: 'preview', preview }, 'https://app.example.com', 'company', [], undefined, language)[0]!);
    const decline: any = card.actions.find(action => action.type === 'postback' && new URLSearchParams(action.data).get('action') === 'reimbursement_draft_cancel');
    assert.equal(decline?.label, lineUiLabel('ไม่ทำ', language));
    assert.deepEqual(await service.cancel({ ctx, owner, ownerEpoch: 1, control: lineControlLanguage(decline.data).data }), { status: 'cancelled', actionId });
    assert.equal(seen.at(-1).actionId, actionId);
    assert.equal(seen.at(-1).previewRevision, 2);
    assert.equal(seen.at(-1).confirmationDigest, digest);
  }
});
import type { LineReplyMessage } from '../../infrastructure/line-reply.adapter';
import { isLineSystemCard, readLineSystemBubble, readLineSystemCard } from './line-system-card.fixture';
import { lineMessagePreview } from './line-message-preview.logic';
import { receiptProgress, receiptProgressLabel } from './line-receipt-status.logic';
import { buildLineSystemCardBubble, lineSystemCardTexts, type LineSystemCard } from './line-system-card.logic';
import { drawLineSystemCard, lineFlexBodyProblems, lineSystemCardSendable } from './line-system-card-limits.logic';
import { buildDraftUpdateOutcomeCard, buildDraftUpdatePreviewCard } from './line-draft-update-card.logic';
import { lineMediaGroupAckStage, lineWaitStageMessage, lineWaitStages } from './line-message-buffer.logic';

const readSystemCard = readLineSystemCard;

const response = (cards?: NonNullable<LineAiTurnResponse['presentation']>['cards']): LineAiTurnResponse => ({
  requestId: 'r1', replyText: cards?.map(card => card.text).join('\n\n') ?? 'fallback', sourceRefs: [], sourceLabels: [], webLinks: [],
  intent: 'read_summary', agent: 'general', refused: false, toolsInvoked: ['company.get_current_context'], durationMs: 1,
  ...(cards ? { presentation: { kind: 'answer_cards', cards } } : {}),
});

describe('package-required card one-tap link (R-B2 (b))', () => {
  const firstUri = (message: ReturnType<typeof buildPackageRequiredMessage>) =>
    (message as any).contents.footer.contents[0].action.uri as string;
  const plain = 'https://app.example.test/companies/co-1/billing?channel=line';

  it('uses the lane-minted handoff link on the web origin', () => {
    assert.equal(firstUri(buildPackageRequiredMessage({ lockReason: 'no_package', companyId: 'co-1',
      webBaseUrl: 'https://app.example.test', packageUrl: 'https://app.example.test/l/tok' })), 'https://app.example.test/l/tok');
  });

  it('keeps the plain tenant link for anything that is not our own /l/<token>', () => {
    for (const packageUrl of [undefined, 'https://evil.example/l/tok', 'https://app.example.test/companies/co-1/billing',
      'https://app.example.test/l/', 'not a url']) {
      assert.equal(firstUri(buildPackageRequiredMessage({ lockReason: 'trial_ended', companyId: 'co-1',
        webBaseUrl: 'https://app.example.test', ...(packageUrl ? { packageUrl } : {}) })), plain, String(packageUrl));
    }
  });
});

describe('package-required card names the shop (review 2026-09-29 item 2)', () => {
  const canonicalText = (message: ReturnType<typeof buildPackageRequiredMessage>) => (message as any).canonicalText as string;

  it('leads the text with the shop name when one is given', () => {
    const text = canonicalText(buildPackageRequiredMessage({ lockReason: 'no_package', companyId: 'co-1', companyName: 'ร้านทดสอบ' }));
    assert.match(text, /^🏪 ร้านทดสอบ\nน้องมั่งมียังตอบไม่ได้จนกว่าจะเลือกแพ็กเกจค่ะ/);
  });

  it('trims the shop name before deciding whether to show it', () => {
    const text = canonicalText(buildPackageRequiredMessage({ lockReason: 'no_package', companyId: 'co-1', companyName: '  ร้านทดสอบ  ' }));
    assert.match(text, /^🏪 ร้านทดสอบ\n/);
  });

  it('keeps the plain text when no shop name is given', () => {
    for (const companyName of [undefined, '', '   ']) {
      const text = canonicalText(buildPackageRequiredMessage({ lockReason: 'no_package', companyId: 'co-1', ...(companyName === undefined ? {} : { companyName }) }));
      assert.equal(text, 'น้องมั่งมียังตอบไม่ได้จนกว่าจะเลือกแพ็กเกจค่ะ ข้อมูลทั้งหมดยังอยู่ครบ');
    }
  });
});

describe('signup door card (R-B1: the exit adds the escape)', () => {
  it('builds the link-required login URL without the in-app-browser param', () => {
    const buttons = (buildSignupDoorCard('1234567890-abcdef', 'https://app.example.test') as any).contents.footer.contents;
    const link = buttons.map((button: any) => button.action.uri).find((uri: string | undefined) => uri?.includes('/login'));
    assert.equal(link, 'https://app.example.test/login?line=link-required&next=%2F');
    assert.equal(stripLineExternalBrowserParam(link), link);
  });
});

describe('LINE business answer card renderer', () => {
  it('returns a fallback card when presentation is absent', () => {
    const message = buildLineBusinessAnswerMessage({ ...response(), toolsInvoked: ['expense.list_recent'] }, 'plain fallback', 'https://app.example.com', 'c1');
    assert.equal(message.type, 'flex');
    assert.match(JSON.stringify(message), /fallback/);
    assert.doesNotMatch(JSON.stringify(message), /plain fallback/);
    assert.equal((message.contents as any).header.contents[0].text, 'Nong Mangmee’s answer');
  });

  it('keeps full cardless reply, source basis and only a safe tenant link', () => {
    const message = buildLineBusinessAnswerMessage({
      ...response(), replyText: 'ยอด 500 บาท\nยังไม่รวมรายการที่รอตรวจสอบ', sourceLabels: ['ค่าใช้จ่าย'],
      webLinks: [
        { label: 'เปิดค่าใช้จ่าย', path: '/companies/c1/expenses' },
        { label: 'ห้ามเปิด', path: '/companies/c2/expenses' },
      ],
    }, 'ignored fallback', 'https://app.example.com', 'c1');
    assert.equal(message.type, 'flex');
    assert.match(message.canonicalText ?? '', /ยังไม่รวมรายการที่รอตรวจสอบ/);
    assert.match(message.canonicalText ?? '', /แหล่งข้อมูล: ค่าใช้จ่าย/);
    assert.match(message.canonicalText ?? '', /https:\/\/app\.example\.com\/companies\/c1\/expenses/);
    assert.doesNotMatch(message.canonicalText ?? '', /companies\/c2/);
  });

  it('uses trusted contextual headings and preserves explicit titles', () => {
    for (const [tools, expected] of [
      [['expense.list_recent'], 'น้องมั่งมีสรุปค่าใช้จ่ายให้นะคะ'],
      [['expense.list_recent', 'expense.get_detail'], 'น้องมั่งมีสรุปค่าใช้จ่ายให้นะคะ'],
      [['sales.get_sales_summary'], 'น้องมั่งมีสรุปยอดขายให้นะคะ'],
      [['expense.list_recent', 'sales.get_sales_summary'], 'น้องมั่งมีสรุปให้นะคะ'],
      [['unknown.read'], 'น้องมั่งมีสรุปให้นะคะ'],
      [[], 'น้องมั่งมีสรุปให้นะคะ'],
    ] as const) {
      const result = buildLineBusinessAnswerMessage({ ...response([{ text: 'ข้อมูล 7 รายการ', title: '  ' }]), toolsInvoked: [...tools] }, 'fallback', undefined, 'c1');
      assert.equal(result.type, 'flex');
      assert.equal((result.contents as any).header.contents[0].text, expected);
    }
    const explicit = buildLineBusinessAnswerMessage(response([{ title: 'สรุปปิดร้าน', text: 'ข้อมูล' }]), 'fallback', undefined, 'c1');
    assert.equal(explicit.type, 'flex');
    assert.equal((explicit.contents as any).header.contents[0].text, 'สรุปปิดร้าน');
  });

  it('fails closed to a trusted fallback card when a refused response unexpectedly carries cards', () => {
    const refused = { ...response([{ text: 'ข้อมูลที่ห้ามแสดง' }]), replyText: 'ไม่มีสิทธิ์', refused: true };
    const message = buildLineBusinessAnswerMessage(refused, 'ไม่มีสิทธิ์', 'https://app.example.com', 'c1');
    assert.equal(message.type, 'flex');
    assert.match(JSON.stringify(message), /ไม่มีสิทธิ์/);
    assert.doesNotMatch(JSON.stringify(message), /ข้อมูลที่ห้ามแสดง/);
    assert.equal((message.contents as any).header.contents[0].text, 'น้องมั่งมีแจ้งให้ทราบนะคะ');
  });

  it('does not infer capture success from intent when no tool or a failed tool produced no presentation', () => {
    const errorReply = '⏳ เกิดข้อผิดพลาดชั่วคราว กรุณาลองใหม่อีกครั้งนะคะ';
    const capture: LineAiTurnResponse = { ...response(), intent: 'capture_accounting_evidence', refused: false, toolsInvoked: [], replyText: errorReply };
    const failed: LineAiTurnResponse = { ...capture, toolsInvoked: ['accounting.capture_receipt_evidence'], toolCalls: [{ name: 'accounting.capture_receipt_evidence', status: 'error', durationMs: 1, errorCode: 'TOOL_TIMEOUT' }] };
    for (const result of [capture, failed]) {
      const message = buildLineBusinessAnswerMessage(result, errorReply, undefined, 'c1');
      assert.equal(message.type, 'flex');
      assert.equal((message.contents as any).header.contents[0].text, 'น้องมั่งมีตอบให้นะคะ');
      assert.equal((message.contents as any).body.contents[0].text, errorReply);
      assert.doesNotMatch((message.contents as any).header.contents[0].text, /รับข้อมูลแล้ว|บันทึก.*แล้ว|สำเร็จ/);
    }
    const explicit = buildLineBusinessAnswerMessage({ ...failed, presentation: { kind: 'answer_cards', cards: [{ title: 'กรุณาตรวจสอบข้อมูล', text: errorReply }] } }, errorReply, undefined, 'c1');
    assert.equal(explicit.type, 'flex');
    assert.equal((explicit.contents as any).header.contents[0].text, 'กรุณาตรวจสอบข้อมูล');
    assert.equal((explicit.contents as any).body.contents[0].text, errorReply);
  });

  it('moves safe tenant URLs from deterministic reply text into Flex buttons', () => {
    const message = buildLineAssistantTextCardMessage(
      'บันทึกข้อมูลแล้ว\nตรวจสอบในเว็บ:\nhttps://app.example.com/companies/c1/expenses/e1',
      'https://app.example.com',
      'c1',
    );
    assert.equal(message.type, 'flex');
    const bubble = message.contents as any;
    assert.doesNotMatch(bubble.body.contents[0].text, /https?:\/\//);
    // The label line names the link, so it becomes the button and stops being stranded body text.
    assert.equal(bubble.body.contents[0].text, 'บันทึกข้อมูลแล้ว');
    assert.deepEqual(bubble.footer.contents[0].action, {
      type: 'uri', label: 'ตรวจสอบในเว็บ', uri: 'https://app.example.com/companies/c1/expenses/e1',
    });
  });

  it('never promotes cross-origin or cross-tenant text URLs to buttons', () => {
    for (const url of [
      'https://evil.example/companies/c1/expenses/e1',
      'https://app.example.com/companies/c2/expenses/e1',
    ]) {
      const message = buildLineAssistantTextCardMessage(`ตรวจสอบ ${url}`, 'https://app.example.com', 'c1');
      assert.equal(message.type, 'flex');
      assert.equal((message.contents as any).footer, undefined);
      assert.match((message.contents as any).body.contents[0].text, /https?:\/\//);
    }
  });

  it('renders one answer as one Mangmee-themed bubble with a safe tenant link', () => {
    const message = buildLineBusinessAnswerMessage(response([{
      title: 'ค่าใช้จ่ายเดือนนี้', text: 'ยังไม่มีค่าใช้จ่าย รวม 0.00 บาท', sourceLabels: ['ค่าใช้จ่าย'],
      webLink: { label: 'เปิดค่าใช้จ่าย', path: '/companies/c1/expenses?month=2026-07' },
    }]), 'fallback', 'https://app.example.com/base', 'c1');
    assert.equal(message.type, 'flex');
    const json = JSON.stringify(message);
    assert.match(json, /"type":"bubble"/);
    assert.match(json, /#15803D/);
    assert.match(json, /#1A2E22/);
    assert.match(json, /https:\/\/app\.example\.com\/companies\/c1\/expenses\?month=2026-07/);
    assert.match(json, /แหล่งข้อมูล: ค่าใช้จ่าย/);
    assert.equal(message.type === 'flex' && message.canonicalText,
      'ยังไม่มีค่าใช้จ่าย รวม 0.00 บาท\n\nค่าใช้จ่ายเดือนนี้\n\nแหล่งข้อมูล: ค่าใช้จ่าย\n\nเปิดดู: เปิดค่าใช้จ่าย https://app.example.com/companies/c1/expenses?month=2026-07');
  });

  it('uses complete text when a carousel would omit the thirteenth card', () => {
    const cards = Array.from({ length: 14 }, (_, index) => ({ title: `คำตอบ ${index + 1}`, text: `ข้อมูล ${index + 1}` }));
    const message = buildLineBusinessAnswerMessage(response(cards), 'fallback', 'https://app.example.com', 'c1');
    assert.equal(message.type, 'text');
    assert.match(message.text, /คำตอบ 14/);
    assert.match(message.text, /ข้อมูล 14/);
  });

  it('omits absolute, cross-tenant, protocol-relative, and traversing links', () => {
    const unsafe = [
      'https://evil.example/companies/c1/expenses',
      '/companies/c2/expenses',
      '//evil.example/companies/c1/expenses',
      '/companies/c1/../c2/expenses',
      '/companies/c1/%2f..%2fc2/expenses',
    ];
    for (const path of unsafe) {
      const message = buildLineBusinessAnswerMessage(response([{
        text: 'ข้อมูล', webLink: { label: 'เปิด', path },
      }]), 'fallback', 'https://app.example.com', 'c1');
      assert.doesNotMatch(JSON.stringify(message), /"type":"button"/, path);
      assert.doesNotMatch(JSON.stringify(message), /evil\.example|companies\/c2|%2f|\.\.\//i, path);
    }
  });

  it('uses complete text rather than hiding card body overflow', () => {
    const message = buildLineBusinessAnswerMessage(response([{ title: 'หัวข้อ', text: '🌱'.repeat(2_000) }]), 'fallback', undefined, 'c1');
    assert.equal(message.type, 'text');
    assert.equal(Array.from(message.text.match(/🌱/gu) ?? []).length, 2_000);
  });

  it('falls back to complete text when reply caveats are absent from the cards', () => {
    const message = buildLineBusinessAnswerMessage({
      ...response([{ title: 'ค่าใช้จ่ายเดือนนี้', text: 'รวม 500 บาท' }]),
      replyText: 'รวม 500 บาท\nยังไม่รวมรายการที่รอตรวจสอบ',
    }, 'fallback', 'https://app.example.com', 'c1');
    assert.equal(message.type, 'text');
    assert.match(message.text, /ยังไม่รวมรายการที่รอตรวจสอบ/);
    assert.match(message.text, /ค่าใช้จ่ายเดือนนี้/);
  });

  it('deduplicates only exact blocks so a short distinct card fact is retained', () => {
    const message = buildLineBusinessAnswerMessage({
      ...response([{ title: 'ยอด', text: '500 บาท' }]),
      replyText: 'ยอดรวม 1,500 บาท',
    }, 'fallback', undefined, 'c1');
    assert.equal(message.type, 'text');
    assert.match(message.text, /ยอดรวม 1,500 บาท\n\nยอด\n\n500 บาท/);
  });
});

describe('spec §13 — the state badge row', () => {
  it('renders the badge as its own row above the body, and nothing at all without one', () => {
    const withBadge = buildLineAssistantTextCardMessage('ยอด 50.00 THB', 'https://app.example.com', 'c1', '✅ ออกเอกสารแล้ว');
    const withoutBadge = buildLineAssistantTextCardMessage('ยอด 50.00 THB', 'https://app.example.com', 'c1');

    const rows = (withBadge as any).contents.body.contents;
    assert.equal(rows[0].text, '✅ ออกเอกสารแล้ว');
    assert.equal(rows[0].weight, 'bold');
    assert.equal(rows[1].text, 'ยอด 50.00 THB');
    assert.equal((withoutBadge as any).contents.body.contents[0].text, 'ยอด 50.00 THB');
  });

  it('bounds a badge the same way every other card string is bounded', () => {
    const message = buildLineAssistantTextCardMessage('ข้อมูล', undefined, 'c1', '🌱'.repeat(80));
    assert.equal(Array.from((message as any).contents.body.contents[0].text as string).length, 40);
  });
});

describe('FIX-5 — a link label becomes its button, never a dangling colon line', () => {
  const web = 'https://app.example.com/companies/c1/expenses/substitute-receipts/e1';
  const web2 = 'https://app.example.com/companies/c1/expenses/e2';

  function card(text: string) {
    const message = buildLineAssistantTextCardMessage(text, 'https://app.example.com', 'c1');
    const contents = (message as any).contents;
    return {
      body: contents.body.contents[contents.body.contents.length - 1].text as string,
      buttons: (contents.footer?.contents ?? []).map((button: any) => ({
        label: button.action.label as string, uri: button.action.uri as string,
      })),
    };
  }

  it('labels a single link from the line it sits on and drops that line from the body', () => {
    const { body, buttons } = card(`สรุปงาน\nเปิดตรวจสอบในเว็บ: ${web}`);
    assert.deepEqual(buttons, [{ label: 'เปิดตรวจสอบในเว็บ', uri: web }]);
    assert.equal(body, 'สรุปงาน');
  });

  it('falls back to the generic label when nothing names the link', () => {
    const { body, buttons } = card(`สรุปงาน ${web} จบ`);
    assert.deepEqual(buttons, [{ label: 'เปิดดูในเว็บแอป', uri: web }]);
    assert.equal(body, 'สรุปงาน  จบ');
  });

  it('labels two links independently instead of numbering them เปิดลิงก์ 1/2', () => {
    const { body, buttons } = card([
      '🔵 รอยืนยัน เลขที่ SUB-202608-00007',
      `ดูเอกสาร: ${web2}`,
      `เปิดในเว็บ: ${web}`,
    ].join('\n'));

    assert.deepEqual(buttons, [
      { label: 'ดูเอกสาร', uri: web2 },
      { label: 'เปิดในเว็บ', uri: web },
    ]);
    assert.equal(body, '🔵 รอยืนยัน เลขที่ SUB-202608-00007');
    assert.doesNotMatch(body, /:\s*$/m, 'no colon line is left behind');
  });

  // Owner 2026-10-05: "ลิ้งชื่อปุ่ม ใช้ชื่อได้เลย ไม่ต้องบอกว่าปุ่มลิ้ง 1 2 3".
  it('never numbers a button: a link nothing names says where it leads', () => {
    const { buttons } = card(`ดูรายละเอียด ${web} ก่อน\nดูเอกสาร: ${web2}`);
    assert.deepEqual(buttons, [
      { label: 'เปิดดูในเว็บแอป', uri: web },
      { label: 'ดูเอกสาร', uri: web2 },
    ]);
  });

  it('reads the name the complete answer text gives a page — "เปิดดู: <name> <url>" — and takes the line off the card', () => {
    const { body, buttons } = card([
      'ไม่มีงานค้างค่ะ',
      'แหล่งข้อมูล: ใบรับรองแทนใบเสร็จ, สรุปปิดร้าน 5 ต.ค. 2569',
      `เปิดดู: ใบรับรองแทนใบเสร็จ ${web}`,
      `เปิดดู: สรุปปิดร้าน 5 ต.ค. 2569 ${web2}`,
    ].join('\n\n'));
    assert.deepEqual(buttons, [
      { label: 'ใบรับรองแทนใบเสร็จ', uri: web },
      { label: 'สรุปปิดร้าน 5 ต.ค. 2569', uri: web2 },
    ]);
    assert.doesNotMatch(body, /เปิดดู|เปิดลิงก์/u);
    // A name longer than a button holds stays on the card, whole, and its button says where it leads.
    const long = card(`เปิดดู: ${'ก'.repeat(41)} ${web}`);
    assert.deepEqual(long.buttons, [{ label: 'เปิดดูในเว็บแอป', uri: web }]);
    assert.match(long.body, /^เปิดดู: ก{41}$/u);
  });

  it('M7: marks a truncated alt text instead of cutting it mid-word', () => {
    const long = 'ใบรับรองแทนใบเสร็จรับเงินของรายการนี้ '.repeat(40);
    const message = buildLineAssistantTextCardMessage(long, undefined, 'c1');
    assert.equal(message.type, 'flex');
    const alt = Array.from(message.type === 'flex' ? message.altText : '');

    assert.equal(alt.length, 400, 'the ellipsis is counted inside the limit');
    assert.equal(alt[alt.length - 1], '\u2026', 'a chat-list preview that stops mid-syllable reads as a broken message');
  });

  it('M7: leaves a short alt text exactly as written', () => {
    const message = buildLineAssistantTextCardMessage('สรุปยอดวันนี้ 200.00 บาท', undefined, 'c1');
    assert.equal(message.type === 'flex' && message.altText, 'สรุปยอดวันนี้ 200.00 บาท');
  });

  it('never mistakes a long sentence ending in a colon for a button label', () => {
    const sentence = 'ก'.repeat(41);
    const { body, buttons } = card(`${sentence}: ${web}`);
    assert.deepEqual(buttons, [{ label: 'เปิดดูในเว็บแอป', uri: web }]);
    assert.match(body, new RegExp(sentence));
  });

  it('gives two links on one line no name of their own, and no number either', () => {
    const { buttons } = card(`ลิงก์: ${web} ${web2}`);
    assert.deepEqual(buttons.map((button: any) => button.label), ['เปิดดูในเว็บแอป', 'เปิดดูในเว็บแอป']);
  });

  it('keeps a rejected URL and its label in the body untouched', () => {
    const { body, buttons } = card('ดาวน์โหลด: https://evil.example/d/abc');
    assert.deepEqual(buttons, []);
    assert.equal(body, 'ดาวน์โหลด: https://evil.example/d/abc');
  });
});

// ── Design lock 2026-10-04: the ONE native Flex renderer. These hold the structure the locked design
//    needs from LINE — not pixels (the preview gallery compares those), but what makes the picture:
//    two header lines, the paper over the green, the mascot above both, the colon in one column. ──
describe('locked System OA card renderer', () => {
  const WEB = 'https://app.example.com';
  const FULL: LineSystemCard = {
    mascot: 'general', header: { lines: ['การชำระเงิน', 'ชำระแล้ว'] },
    banner: { tone: 'ok', text: 'ชำระแล้ว · ยอดคงค้าง 0.00 บาท' },
    rows: [
      { label: 'เลขรายการ', value: 'EXP-1' }, { label: 'ยอดสุทธิที่ต้องจ่าย', value: '1,284.00 บาท', total: true },
      { label: 'จ่ายแล้ว', value: '1,284.00 บาท' }, { label: 'สถานะชำระเงิน', value: 'ชำระแล้ว', pill: 'ok' },
    ],
    notes: ['แสดงเฉพาะรายการของคุณ'], footnotes: ['แหล่งข้อมูล: ค่าใช้จ่าย'],
    button: { action: { type: 'uri', label: 'เปิดดูรายการในเว็บ', uri: `${WEB}/companies/c1/expenses/e1` }, icon: 'receipt' },
  };
  const bubble = (card: LineSystemCard) => buildLineSystemCardBubble(card, WEB) as any;

  it('is one body block: the green top, the white paper, and the mascot last so that it is drawn above both', () => {
    const built = bubble(FULL);
    assert.deepEqual([built.type, built.size, Object.keys(built).sort()], ['bubble', 'mega', ['body', 'size', 'type']]);
    assert.equal(built.body.paddingAll, '0px');
    const [top, paper, mascot] = built.body.contents;
    assert.equal(built.body.contents.length, 3);
    assert.deepEqual(top.background, { type: 'linearGradient', angle: '115deg', startColor: '#174e37', endColor: '#167c52' });
    assert.equal(top.height, '80px', 'the compact header of the locked picture');
    assert.equal(paper.backgroundColor, '#ffffff');
    // The mascot: 112 px wide, absolutely placed, its box ending 4 px below the green — 16 px below the
    // paper's upper edge — and never the first child (LINE forbids that) nor inside a box that would clip it.
    assert.deepEqual([mascot.position, mascot.width, mascot.height, mascot.offsetEnd, mascot.offsetTop], ['absolute', '112px', '82px', '8px', '2px']);
    assert.equal(mascot.contents[0].url, `${WEB}/assets/line/system-card-mascot-general-20261005.png`);
    assert.equal(mascot.contents[0].aspectMode, 'fit');
  });

  it('lays the paper over the green with a rounded top, without a negative offset LINE would refuse', () => {
    const [top] = bubble(FULL).body.contents;
    const cap = top.contents[1];
    // 12 px of overlap, an 18 px radius, clipped by the green top so only its upper edge shows.
    assert.deepEqual([cap.position, cap.offsetTop, cap.width, cap.height, cap.cornerRadius, cap.backgroundColor], ['absolute', '68px', '100%', '36px', '18px', '#ffffff']);
    assert.deepEqual(lineFlexBodyProblems(bubble(FULL)), [], 'every size is a positive px or %');
  });

  it('has exactly two header lines in each of its three styles, and never a brand line', () => {
    const lines = (card: LineSystemCard) => bubble(card).body.contents[0].contents[0].contents;
    const context = lines(FULL);
    assert.deepEqual(context.map((line: any) => [line.text, line.size, line.color, line.weight]), [['การชำระเงิน', '11px', '#d2e8db', undefined], ['ชำระแล้ว', '15px', '#ffffff', 'bold']]);
    const question = lines({ ...FULL, header: { lines: ['ทำอะไร', 'ได้บ้าง'], question: true } });
    assert.deepEqual(question.map((line: any) => [line.text, line.size, line.weight]), [['ทำอะไร', '15px', 'bold'], ['ได้บ้าง', '15px', 'bold']]);
    assert.equal(bubble({ ...FULL, header: { lines: ['ทำอะไร', 'ได้บ้าง'], question: true } }).body.contents[0].height, '81px');
    const quiet = lines({ ...FULL, header: { lines: ['ค่าบริการในบิล', 'ทำไมคิดแยก'], question: true, quiet: true } });
    assert.deepEqual(quiet.map((line: any) => [line.text, line.size, line.weight]), [['ค่าบริการในบิล', '14px', undefined], ['ทำไมคิดแยก', '14px', undefined]]);
    for (const card of [FULL, { ...FULL, header: { lines: ['ก', 'ข'] as const, question: true } }]) {
      assert.equal(lines(card).length, 2);
      assert.doesNotMatch(lineSystemCardTexts(bubble(card)).join('\n'), /MANGMEE PLUS|คำสั่งมั่งมี|คำตอบจากน้องมั่งมี|ถามตอบทั่วไป|น้องมั่งมีตอบให้นะคะ|คำถามของคุณ/u);
    }
  });

  it('puts every colon of a card in one column, whatever the label or the value', () => {
    const built = bubble(FULL);
    const rowBoxes = built.body.contents[1].contents.find((section: any) => section.paddingTop === '4px').contents.filter((entry: any) => entry.contents?.[0]?.layout === 'horizontal');
    assert.equal(rowBoxes.length, 4);
    for (const rowBox of rowBoxes) {
      const [label, colon, value] = rowBox.contents[0].contents;
      assert.deepEqual([label.width, colon.width, colon.contents[0].text, colon.contents[0].align], ['37%', '7.9%', ':', 'center']);
      assert.equal(rowBox.contents[0].spacing, undefined, 'the gaps are part of the colon column, so they scale with the bubble');
      assert.deepEqual([rowBox.paddingStart, rowBox.paddingEnd], ['5.4%', '5.4%']);
      assert.ok(value.flex === 1, 'the value takes what is left and wraps');
    }
    const read = readLineSystemBubble(built);
    assert.deepEqual(read.rows.map(([, colon]) => colon), [':', ':', ':', ':']);
  });

  it('draws the total on the cream band, a state as its pill, and the banner in its tone', () => {
    const read = readLineSystemBubble(bubble(FULL));
    assert.deepEqual(read.totals, ['ยอดสุทธิที่ต้องจ่าย']);
    assert.deepEqual(read.pills, { 'สถานะชำระเงิน': ['#edf3e8', '#356341'] });
    assert.equal(read.banner, 'ชำระแล้ว · ยอดคงค้าง 0.00 บาท');
    const tones = (tone: 'ok' | 'pending' | 'closed') => readLineSystemBubble(bubble({ ...FULL, rows: [{ label: 'สถานะ', value: 'x', pill: tone }] })).pills['สถานะ'];
    assert.deepEqual([tones('ok'), tones('pending'), tones('closed')], [['#edf3e8', '#356341'], ['#fbf1d8', '#755418'], ['#f5e4de', '#884838']]);
    const bannerOf = (tone: 'ok' | 'pending' | 'scanning') => bubble({ ...FULL, banner: { tone, text: 'x' } }).body.contents[1].contents[0].contents[0];
    assert.deepEqual([bannerOf('ok'), bannerOf('pending'), bannerOf('scanning')].map((box: any) => [box.backgroundColor, box.contents[1].color]),
      [['#dceadd', '#255b38'], ['#f5e8c5', '#755418'], ['#deeee8', '#286857']]);
    assert.match(bannerOf('scanning').contents[0].url, /system-card-icon-scan-\d{8}\.png$/u);
  });

  it('makes a button a box with an action: its icon, its label, its chevron — dark for the main one', () => {
    const footerOf = (card: LineSystemCard) => bubble(card).body.contents[1].contents.at(-1).contents;
    const [secondary] = footerOf(FULL);
    assert.deepEqual(secondary.action, { type: 'uri', label: 'เปิดดูรายการในเว็บ', uri: `${WEB}/companies/c1/expenses/e1` });
    assert.deepEqual([secondary.backgroundColor, secondary.cornerRadius, secondary.contents.map((part: any) => part.type)], ['#e0e8d8', '10px', ['image', 'text', 'image']]);
    assert.match(secondary.contents[0].url, /system-card-icon-receipt-\d{8}\.png$/u);
    const [primary] = footerOf({ ...FULL, button: { ...FULL.button!, icon: 'clipboard', primary: true } });
    assert.deepEqual([primary.backgroundColor, primary.contents[1].color], ['#174e37', '#ffffff']);
    assert.match(primary.contents[2].url, /system-card-icon-chevron-light-\d{8}\.png$/u);
    const [pair] = footerOf({ ...FULL, button: undefined, choice: [
      { type: 'postback', label: 'ยืนยัน', data: 'action=draft-update-confirm&previewId=p1', displayText: 'ยืนยันการแก้ไข' },
      { type: 'postback', label: 'ยกเลิก', data: 'action=draft-update-cancel&previewId=p1', displayText: 'ยกเลิกการแก้ไข' }] });
    assert.deepEqual(pair.contents.map((button: any) => [button.backgroundColor, button.action.data]),
      [['#174e37', 'action=draft-update-confirm&previewId=p1'], ['#e0e8d8', 'action=draft-update-cancel&previewId=p1']]);
  });

  it('uses only pictures served over https from the web app, each with its version in its name', () => {
    const urls = JSON.stringify(bubble({ ...FULL, mascot: 'scanning', banner: { tone: 'scanning', text: 'x' } })).match(/https:[^"]+\.png/gu) ?? [];
    assert.ok(urls.length >= 4);
    for (const url of urls) assert.match(url, /^https:\/\/app\.example\.com\/assets\/line\/system-card-(?:mascot|icon)-[a-z-]+-\d{8}\.png$/u);
    for (const mascot of ['general', 'review', 'scanning'] as const) {
      assert.match(readLineSystemBubble(bubble({ ...FULL, mascot })).mascot, new RegExp(`system-card-mascot-${mascot}-\\d{8}\\.png$`, 'u'));
    }
  });

  it('keeps the lines of a list together and paragraphs apart, and closes a card that has no button', () => {
    const prose = bubble({ mascot: 'general', header: { lines: ['ทำอะไร', 'ได้บ้าง'], question: true }, text: 'ช่วยได้ค่ะ เช่น\n• ค่าใช้จ่าย\n• งานค้าง\n\nลองถามได้เลย' });
    const lines = prose.body.contents[1].contents[0].contents;
    assert.deepEqual(lines.map((line: any) => line.text), ['ช่วยได้ค่ะ เช่น', '• ค่าใช้จ่าย', '• งานค้าง', 'ลองถามได้เลย']);
    assert.ok(parseFloat(lines[2].margin) < parseFloat(lines[1].margin), 'two bullets in a row keep only the line spacing');
    assert.equal(lines[3].margin, lines[1].margin);
    const rowsOnly = bubble({ mascot: 'general', header: FULL.header, rows: FULL.rows });
    assert.deepEqual(rowsOnly.body.contents[1].contents.at(-1), { type: 'box', layout: 'vertical', height: '18px', contents: [] });
  });
});

// ── Design lock contexts 1, 2, 3, 5 and 7: a gateway answer. The gateway sends validated rows built
//    from tool results (`layout`), or none; this side draws them, checks every link against the chat's
//    own company, and keeps `text` as the canonical answer. Model text never fills a row here either. ──
describe('gateway answers on the locked design', () => {
  const WEB = 'https://app.example.com';
  const answer = (replyText: string, layout: Record<string, unknown> | undefined, link?: { label: string; path: string }, source = 'รายการค่าใช้จ่าย'): LineAiTurnResponse => ({
    requestId: 'r1', replyText, sourceRefs: [], sourceLabels: [source], webLinks: link ? [link] : [], intent: 'read_summary', agent: 'accounting',
    refused: false, toolsInvoked: ['expense.list_recent'], durationMs: 1,
    presentation: { kind: 'answer_cards', cards: [{ text: replyText, ...(layout ? { layout: layout as any } : {}), sourceLabels: [source], ...(link ? { webLink: link } : {}) }] },
  });
  const draw = (response: LineAiTurnResponse, question = 'ดูค่าใช้จ่ายเดือนนี้', company = 'c1') =>
    buildLineBusinessAnswerMessage(response, response.replyText, WEB, company, question);
  const SUMMARY = {
    context: 'expense_summary', header: ['สรุปค่าใช้จ่าย', 'สิงหาคม 2569'],
    rows: [{ label: 'ยอดรวม', value: '85.00 บาท', emphasis: 'total' }, { label: 'จำนวนรายการ', value: '7 รายการ' },
      { label: 'ช่วงวันที่', value: '1 สิงหาคม 2569 – 31 สิงหาคม 2569' }, { label: 'ที่มา', value: 'รายการค่าใช้จ่าย' }, { label: 'ข้อมูล ณ', value: '17 กันยายน 2569' }],
    notes: ['ไม่รวมรายการที่ยกเลิกหรือถูกปฏิเสธ 1 รายการ'], linkLabel: 'ดูค่าใช้จ่ายในเว็บ',
  };
  const SENTENCE = 'ค่าใช้จ่าย: 85.00 บาท (7 รายการ)\nไม่รวมรายการที่ยกเลิกหรือถูกปฏิเสธ 1 รายการ\nช่วง: 1 สิงหาคม 2569 – 31 สิงหาคม 2569\nข้อมูล ณ 17 กันยายน 2569';
  const EXPENSES = { label: 'รายการค่าใช้จ่าย', path: '/companies/c1/expenses' };

  it('context 1 — expense summary: the layout\'s rows, its note, and the link under the layout\'s own words', () => {
    const message = draw(answer(SENTENCE, SUMMARY, EXPENSES));
    const card = readLineSystemCard(message);
    assert.deepEqual(card.header, ['สรุปค่าใช้จ่าย', 'สิงหาคม 2569']);
    assert.deepEqual(card.rows, SUMMARY.rows.map((row) => [row.label, ':', row.value]));
    assert.deepEqual(card.totals, ['ยอดรวม']);
    assert.deepEqual(card.notes, SUMMARY.notes);
    assert.deepEqual(card.actions, [{ type: 'uri', label: 'ดูค่าใช้จ่ายในเว็บ', uri: `${WEB}/companies/c1/expenses` }]);
    assert.deepEqual(card.prose, [], 'rows, not the sentence, are what a rows card shows');
    assert.match(card.mascot, /system-card-mascot-general-/u);
    // The sentence is still the canonical answer: what is stored, previewed, and sent if the card cannot be.
    assert.ok(message.type === 'flex' && message.canonicalText!.startsWith(SENTENCE));
    assert.equal(message.type === 'flex' && message.altText, lineMessagePreview(SENTENCE));
    assert.equal(isCompleteLineBusinessAnswerPresentation(message), true);
    assert.deepEqual(lineFlexBodyProblems((message as any).contents), []);
  });

  // Owner 2026-10-05, real LINE: "ดูค่าใช้จ่ายเดือนนี้" and "สรุปค่าใช้จ่ายเดือนนี้" were sentences on a prose
  // card. "อยากได้เหมือน pattern อ่านใบเสร็จ". The gateway now sends rows for both; this side draws them.
  it('context 1 — the expense list and the grouped summary: each record or group a row, one button', () => {
    const list = { context: 'expense_summary', header: ['รายการค่าใช้จ่าย', 'ตุลาคม 2569'],
      rows: [{ label: 'ยอดรวม', value: '0.00 บาท', emphasis: 'total' }, { label: 'จำนวนรายการ', value: '1 รายการ' },
        { label: '4 ต.ค.', value: 'ไม่ระบุร้าน · 0.00 บาท · รอตรวจสอบ' }, { label: 'ช่วงวันที่', value: '1–5 ต.ค. 2569' }, { label: 'ข้อมูล ณ', value: '5 ต.ค. 2569' }],
      linkLabel: 'ดูค่าใช้จ่ายในเว็บ' };
    const listSentence = 'ค่าใช้จ่าย: 0.00 บาท (1 รายการ)\n1. 4 ต.ค. ไม่ระบุร้าน 0.00 บาท (รอตรวจสอบ)\nช่วง: เดือนนี้ (1–5 ต.ค. 2569)\nข้อมูล ณ 5 ต.ค. 2569';
    const listCard = readLineSystemCard(draw(answer(listSentence, list, EXPENSES), 'ดูค่าใช้จ่ายเดือนนี้'));
    assert.deepEqual(listCard.header, ['รายการค่าใช้จ่าย', 'ตุลาคม 2569']);
    assert.deepEqual(listCard.rows, list.rows.map((row) => [row.label, ':', row.value]));
    assert.deepEqual([listCard.totals, listCard.prose, listCard.footnotes], [['ยอดรวม'], [], []]);
    assert.deepEqual(listCard.actions, [{ type: 'uri', label: 'ดูค่าใช้จ่ายในเว็บ', uri: `${WEB}/companies/c1/expenses` }]);

    const grouped = { context: 'expense_summary', header: ['สรุปค่าใช้จ่าย', 'ตุลาคม 2569'],
      rows: [{ label: 'ยอดรวม', value: '5,000.00 บาท', emphasis: 'total' }, { label: 'จำนวนรายการ', value: '10 รายการ' }, { label: 'แยกตาม', value: 'หมวด' },
        { label: 'อาหาร', value: '3,000.00 บาท (60.0%, 6 รายการ)' }, { label: 'เดินทาง', value: '1,500.00 บาท (30.0%, 3 รายการ)' }, { label: 'ค่าน้ำ', value: '500.00 บาท (10.0%, 1 รายการ)' },
        { label: 'ช่วงวันที่', value: '1–5 ต.ค. 2569' }, { label: 'ที่มา', value: 'สรุปค่าใช้จ่ายแยกกลุ่ม' }, { label: 'ข้อมูล ณ', value: '5 ต.ค. 2569' }],
      linkLabel: 'ดูค่าใช้จ่ายในเว็บ' };
    const groupedSentence = 'ค่าใช้จ่ายแยกตามหมวด\n• อาหาร: 3,000.00 บาท (60.0%, 6 รายการ)\nรวมทั้งหมด: 5,000.00 บาท (10 รายการ)';
    const message = draw(answer(groupedSentence, grouped, { label: 'สรุปค่าใช้จ่ายแยกกลุ่ม', path: '/companies/c1/expenses' }, 'สรุปค่าใช้จ่ายแยกกลุ่ม'), 'สรุปค่าใช้จ่ายเดือนนี้');
    const groupedCard = readLineSystemCard(message);
    assert.deepEqual(groupedCard.header, ['สรุปค่าใช้จ่าย', 'ตุลาคม 2569']);
    assert.deepEqual(groupedCard.rows, grouped.rows.map((row) => [row.label, ':', row.value]));
    assert.deepEqual(groupedCard.actions.map((action) => action.label), ['ดูค่าใช้จ่ายในเว็บ']);
    assert.doesNotMatch(groupedCard.texts.join('\n'), /แหล่งข้อมูล|ค่าใช้จ่ายแยกตามหมวด\n/u);
    assert.equal(isCompleteLineBusinessAnswerPresentation(message), true);
    assert.deepEqual(lineFlexBodyProblems((message as any).contents), []);
    // The most rows a layout may carry (sixteen) is still one card LINE accepts.
    const full = { ...grouped, rows: [...grouped.rows.slice(0, 3), ...Array.from({ length: 13 }, (_, index) => ({ label: `ร้าน ${index + 1}`, value: '1,100.00 บาท (16.7%, 1 รายการ)' }))] };
    const fullMessage = draw(answer(groupedSentence, full, EXPENSES), 'สรุปค่าใช้จ่ายเดือนนี้');
    assert.equal(readLineSystemCard(fullMessage).rows.length, 16);
    assert.deepEqual(lineFlexBodyProblems((fullMessage as any).contents), []);
  });

  it('context 2 — open work: a claim opens THAT claim, by the path the tool vouched for, in the chat\'s own company', () => {
    const claim = { context: 'open_work', header: ['ใบเบิกรออนุมัติ', 'พบ 1 รายการ'],
      rows: [{ label: 'เลขที่ใบเบิก', value: 'RB-202608-00002' }, { label: 'ต้องทำ', value: 'ตรวจสอบและอนุมัติใบเบิก' }, { label: 'ข้อมูล ณ', value: '17 กันยายน 2569' }],
      notes: ['ตรวจเฉพาะแจ้งเตือนที่ยังไม่ปิด ตามสิทธิ์ของคุณ'], linkLabel: 'เปิดใบเบิกเพื่ออนุมัติ' };
    const link = { label: 'อนุมัติเบิกจ่าย: RB-202608-00002', path: '/companies/c1/reimbursements/rb-1' };
    const card = readLineSystemCard(draw(answer('มีใบเบิกรออนุมัติจากคุณอยู่ค่ะ', claim, link, 'อนุมัติเบิกจ่าย: RB-202608-00002'), 'มีงานค้างไหม'));
    assert.deepEqual(card.header, ['ใบเบิกรออนุมัติ', 'พบ 1 รายการ']);
    assert.deepEqual(card.rows.map(([label, , value]) => [label, value]), [['เลขที่ใบเบิก', 'RB-202608-00002'], ['ต้องทำ', 'ตรวจสอบและอนุมัติใบเบิก'], ['ข้อมูล ณ', '17 กันยายน 2569']]);
    assert.deepEqual(card.actions, [{ type: 'uri', label: 'เปิดใบเบิกเพื่ออนุมัติ', uri: `${WEB}/companies/c1/reimbursements/rb-1` }]);
    assert.match(JSON.stringify(card.bubble), /system-card-icon-list-\d{8}\.png/u);
    // Design lock §9: neither of the two rows the owner cut.
    assert.doesNotMatch(card.texts.join('\n'), /ระดับแจ้งเตือน|ขอบเขต/u);

    // Another company's claim, a path outside the web app, or a link that is not a path: never a button
    // of this chat — and rows that promise to open a claim they cannot open are not drawn at all. What
    // is left is the answer's own sentence, under the reader's words, with nothing to tap.
    for (const path of ['/companies/c2/reimbursements/rb-1', '//evil.example/companies/c1/reimbursements/rb-1', 'https://evil.example/x', '/companies/c1/../c2/reimbursements/rb-1', 'javascript:alert(1)']) {
      const refused = draw(answer('มีใบเบิกรออนุมัติจากคุณอยู่ค่ะ', claim, { label: 'ใบเบิก', path }, 'ใบเบิก'), 'มีงานค้างไหม');
      const drawn = readLineSystemCard(refused);
      assert.deepEqual([drawn.rows, drawn.actions, drawn.prose], [[], [], ['มีใบเบิกรออนุมัติจากคุณอยู่ค่ะ']], path);
      assert.doesNotMatch(JSON.stringify(refused), /"type":"uri"|evil\.example|\/c2\//u, path);
    }
  });

  it('context 2 — nothing found: says what was checked, and its button goes to the list', () => {
    for (const [layout, path, label] of [
      [{ context: 'open_work', header: ['การแจ้งเตือน', 'ไม่พบรายการ'], rows: [{ label: 'ข้อมูล ณ', value: '17 กันยายน 2569' }], notes: ['ตรวจเฉพาะแจ้งเตือนที่ยังไม่ปิด ตามสิทธิ์ของคุณ'], linkLabel: 'ดูแจ้งเตือนในเว็บ' }, '/companies/c1/notifications', 'ดูแจ้งเตือนในเว็บ'],
      [{ context: 'open_work', header: ['งานที่มอบหมาย', 'ไม่พบงานค้าง'], rows: [{ label: 'ข้อมูล ณ', value: '17 กันยายน 2569' }], notes: ['ตรวจเฉพาะงานที่มอบหมายให้คุณและยังไม่เสร็จ'], linkLabel: 'ดูงานของฉันในเว็บ' }, '/companies/c1/workflow', 'ดูงานของฉันในเว็บ'],
    ] as const) {
      const card = readLineSystemCard(draw(answer('ตอนนี้ไม่มีค่ะ', layout, { label: 'x', path }, 'x'), 'มีงานค้างไหม'));
      assert.deepEqual(card.header, layout.header);
      assert.deepEqual(card.rows, [['ข้อมูล ณ', ':', '17 กันยายน 2569']]);
      assert.deepEqual(card.notes, layout.notes);
      assert.deepEqual(card.actions, [{ type: 'uri', label, uri: `${WEB}${path}` }]);
    }
  });

  it('contexts 5 and 7 — a record and its payment: the state as a pill, the banner in its tone, their own icons', () => {
    const record = { context: 'expense_record', header: ['รายการค่าใช้จ่าย', 'ถูกปฏิเสธ'],
      rows: [{ label: 'เลขรายการ', value: 'EXP-2' }, { label: 'ยอดรวม', value: '2,140.00 บาท', emphasis: 'total' }, { label: 'สถานะเอกสาร', value: 'ปฏิเสธ', tone: 'closed' }, { label: 'เหตุผล', value: 'เอกสารประกอบไม่ครบ' }],
      linkLabel: 'เปิดดูรายการในเว็บ' };
    const recordCard = readLineSystemCard(draw(answer('ค่าใช้จ่าย: ร้าน ก', record, { label: 'EXP-2', path: '/companies/c1/expenses/e2' }, 'EXP-2'), 'รายการที่ 2'));
    assert.deepEqual(recordCard.pills, { 'สถานะเอกสาร': ['#f5e4de', '#884838'] });
    assert.deepEqual(recordCard.rows.at(-1), ['เหตุผล', ':', 'เอกสารประกอบไม่ครบ']);
    assert.match(JSON.stringify(recordCard.bubble), /system-card-icon-file-\d{8}\.png/u);
    for (const [status, tone, bannerColour] of [['ชำระแล้ว', 'ok', '#dceadd'], ['ยังไม่ชำระ', 'pending', '#f5e8c5'], ['ชำระบางส่วน', 'pending', '#f5e8c5']] as const) {
      const payment = { context: 'payment', header: ['การชำระเงิน', status === 'ยังไม่ชำระ' ? 'รอชำระเงิน' : status], banner: { tone, text: `${status} · ยอดคงค้าง 0.00 บาท` },
        rows: [{ label: 'ยอดสุทธิที่ต้องจ่าย', value: '1,284.00 บาท', emphasis: 'total' }, { label: 'สถานะชำระเงิน', value: status, tone }], linkLabel: 'เปิดดูรายการในเว็บ' };
      const card = readLineSystemCard(draw(answer('การชำระเงิน: ร้าน ก', payment, { label: 'EXP-1', path: '/companies/c1/expenses/e1' }, 'EXP-1'), 'จ่ายหรือยัง'));
      assert.equal(card.banner, `${status} · ยอดคงค้าง 0.00 บาท`);
      assert.match(JSON.stringify(card.bubble), new RegExp(bannerColour, 'u'));
      assert.deepEqual(card.totals, ['ยอดสุทธิที่ต้องจ่าย']);
      assert.deepEqual(card.actions.map((action) => action.label), ['เปิดดูรายการในเว็บ']);
      assert.match(JSON.stringify(card.bubble), /system-card-icon-receipt-\d{8}\.png/u);
    }
  });

  it('context 3 — no layout: the answer as it was written, under the reader\'s own question', () => {
    const capability = 'น้องมั่งมีช่วยค้นและสรุปข้อมูลงานตามสิทธิ์ของคุณได้ค่ะ เช่น\n• ค่าใช้จ่ายและใบเสร็จ\n• งานค้างและการแจ้งเตือน';
    const plain: LineAiTurnResponse = { ...answer(capability, undefined), sourceLabels: [], presentation: undefined, toolsInvoked: [] };
    const message = buildDesignedLineAnswerMessage(plain, capability, WEB, 'c1', 'ทำอะไรได้บ้าง')!;
    const card = readLineSystemCard(message);
    assert.deepEqual(card.header, ['ทำอะไร', 'ได้บ้าง']);
    assert.deepEqual(card.prose, [capability]);
    assert.deepEqual([card.rows, card.notes, card.footnotes, card.actions], [[], [], [], []]);
    assert.doesNotMatch(card.texts.join('\n'), /คำตอบจากน้องมั่งมี|ถามตอบทั่วไป|น้องมั่งมีตอบให้นะคะ|คำถามของคุณ/u);
    assert.equal(message.type === 'flex' && message.canonicalText, capability);
    // No question to head it (a push with no reader's words): the reply the way it was sent before.
    assert.equal(buildDesignedLineAnswerMessage(plain, capability, WEB, 'c1', undefined), undefined);
    assert.equal(isLineSystemCard(buildLineBusinessAnswerMessage(plain, capability, WEB, 'c1')), false);
  });

  it('context 4 — the edit-command header rides the answer\'s own sentence', () => {
    const sentence = 'บิลนี้มีหลายบรรทัดค่ะ ขอทราบว่าต้องการแก้บรรทัดไหนนะคะ (เช่น "บรรทัด 2 เป็น 500")';
    const card = readLineSystemCard(draw(answer(sentence, { context: 'edit_command', header: ['แก้ไขค่าใช้จ่าย', 'ขอข้อมูลเพิ่ม'], rows: [] }, undefined, 'ร่างค่าใช้จ่าย'), 'แก้เป็น 500'));
    assert.deepEqual(card.header, ['แก้ไขค่าใช้จ่าย', 'ขอข้อมูลเพิ่ม']);
    assert.deepEqual(card.prose, [sentence]);
    assert.deepEqual(card.rows, []);
  });

  it('honours a layout only when it stands for the WHOLE reply, and only when it is one the validator accepts', () => {
    // The card's text is not the whole reply (the turn said more): rows would hide the rest → not rows.
    const more = { ...answer(SENTENCE, SUMMARY, EXPENSES), replyText: `${SENTENCE}\n\n🔒 ส่วนข้อมูลที่เหลือ คุณไม่มีสิทธิ์เข้าถึงค่ะ` };
    assert.equal(isLineSystemCard(draw(more)) && readLineSystemCard(draw(more)).rows.length > 0, false);
    // A layout that is not exactly the contract's shape is dropped: the answer is prose, never forged rows.
    for (const forged of [
      { ...SUMMARY, rows: [{ label: 'ยอดรวม', value: 'ดู https://evil.example' }] }, { ...SUMMARY, extra: true }, { ...SUMMARY, header: ['หัวเดียว'] },
      { ...SUMMARY, context: 'marketing' }, { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [] } }, 'flex', null,
    ]) {
      const card = readLineSystemCard(draw(answer(SENTENCE, forged as any, EXPENSES)));
      assert.deepEqual(card.rows, [], JSON.stringify(forged).slice(0, 60));
      assert.deepEqual(card.prose, [SENTENCE]);
      assert.deepEqual(card.header, ['ดูค่าใช้จ่าย', 'เดือนนี้']);
      assert.doesNotMatch(JSON.stringify(card.bubble), /evil\.example/u);
    }
    // Two cards: one card of prose under the question, each sentence once; a layout on one of them is not honoured.
    const two: LineAiTurnResponse = { ...answer('ก\nข', undefined), sourceLabels: [], presentation: { kind: 'answer_cards', cards: [{ text: 'ก', layout: SUMMARY as any }, { text: 'ข' }, { text: 'ค' }] } };
    const both = draw(two) as any;
    assert.equal(both.contents.type, 'bubble');
    assert.deepEqual([readLineSystemCard(both).rows, readLineSystemCard(both).prose], [[], ['ก\nข\nค']]);
    assert.deepEqual(lineFlexBodyProblems(both.contents), []);
  });

  // Owner 2026-10-05, a real answer to "มีงานค้างอะไรบ้าง" (three reads, three pages): it went out on the
  // card from before the design — "น้องมั่งมีตอบให้นะคะ", a "ขอบเขต:" line, a "แหล่งข้อมูล:" line, three
  // "เปิดดู: …" lines and buttons "เปิดลิงก์ 1 / 2 / 3". "อ่านยากมาก และลิ้งชื่อปุ่ม ใช้ชื่อได้เลย".
  describe('an answer the gateway sent no rows for', () => {
    const REPLY = '1. ใบรับรองแทนใบเสร็จที่รอให้เซ็นหรืออนุมัติ: ไม่มีค้างอยู่เลยค่ะ ✅\nขอบเขต: เฉพาะรายการที่เกี่ยวข้องกับคุณ\n\n2. รายการเบิกจ่ายที่รอให้อนุมัติ: ไม่มีค้างเช่นกันค่ะ ✅\n\n3. งานค้างปิดวัน 5 ต.ค. 2569 มีที่ต้องจัดการบนเว็บดังนี้ค่ะ\n• รอตรวจสอบ 21 รายการ';
    const PAGES = [
      { label: 'ใบรับรองแทนใบเสร็จ', path: '/companies/c1/expenses/substitute-receipts' },
      { label: 'รายการเบิกจ่ายรออนุมัติ', path: '/companies/c1/reimbursements' },
      { label: 'สรุปปิดร้าน 5 ต.ค. 2569', path: '/companies/c1/expenses' },
    ];
    const compound: LineAiTurnResponse = {
      requestId: 'r1', replyText: REPLY, sourceRefs: [], sourceLabels: PAGES.map((page) => page.label), webLinks: PAGES, intent: 'read_summary', agent: 'accounting',
      refused: false, toolsInvoked: ['expense.list_substitute_receipts_to_sign', 'reimbursement.list_pending_approvals', 'expense.get_daily_closing'], durationMs: 1,
    };

    it('is one card of the locked design: the answer, and every page it opens as a button with that page\'s name', () => {
      const message = draw(compound, 'มีงานค้างอะไรบ้าง');
      const card = readLineSystemCard(message);
      assert.deepEqual(card.header, ['มีงานค้าง', 'อะไรบ้าง']);
      assert.deepEqual(card.actions, PAGES.map((page) => ({ type: 'uri', label: page.label, uri: `${WEB}${page.path}` })));
      const paper = card.texts.join('\n');
      assert.doesNotMatch(paper, /แหล่งข้อมูล|เปิดดู:|เปิดลิงก์|ขอบเขต|น้องมั่งมีตอบให้นะคะ|https?:/u);
      assert.match(paper, /แสดงเฉพาะรายการที่เกี่ยวข้องกับคุณ/u, 'the scope is said as a plain sentence');
      assert.match(paper, /รอตรวจสอบ 21 รายการ/u);
      // Buttons under one another, 8 px apart, each in the design's light style with its icon and chevron.
      const footer = card.bubble.body.contents[1].contents.at(-1);
      assert.deepEqual([footer.layout, footer.spacing, footer.contents.length], ['vertical', '8px', 3]);
      assert.ok(footer.contents.every((button: any) => button.backgroundColor === '#e0e8d8' && button.contents.length === 3));
      // The canonical text is unchanged: it still names the sources and every page, for the fallback and the record.
      assert.ok(message.type === 'flex' && message.canonicalText!.includes('แหล่งข้อมูล: ใบรับรองแทนใบเสร็จ, รายการเบิกจ่ายรออนุมัติ, สรุปปิดร้าน 5 ต.ค. 2569'));
      assert.ok(message.type === 'flex' && message.canonicalText!.includes(`เปิดดู: สรุปปิดร้าน 5 ต.ค. 2569 ${WEB}/companies/c1/expenses`));
      assert.ok(message.type === 'flex' && message.canonicalText!.includes('ขอบเขต: เฉพาะรายการที่เกี่ยวข้องกับคุณ'));
      assert.equal(isCompleteLineBusinessAnswerPresentation(message), true);
      assert.deepEqual(lineFlexBodyProblems((message as any).contents), []);
    });

    it('and with the gateway\'s rows for those reads it is ONE row card: each kind of work a row, each page a named button', () => {
      const backlog = {
        context: 'open_work', header: ['งานค้าง', 'ณ 5 ต.ค. 2569'],
        rows: [
          { label: 'รอตรวจสอบ', value: '21 รายการ' }, { label: 'ค้างจ่าย (ยังไม่กำหนดวันจ่าย)', value: '19 รายการ รวม 26,478.24 บาท' },
          { label: 'รอตรวจหลักฐาน', value: '9 รายการ' }, { label: 'อาจเป็นรายการซ้ำ', value: '6 รายการ' },
          { label: 'ใบรับรองแทนใบเสร็จ', value: 'ไม่มีค้าง' }, { label: 'เบิกจ่ายรอคุณอนุมัติ', value: 'ไม่มีค้าง' },
        ],
        notes: ['ไม่มีรายการครบกำหนดจ่ายวันนี้หรือเกินกำหนด', 'ตรวจเฉพาะงานที่รอคุณและรายการที่คุณมีสิทธิ์ดู'],
      };
      const withRows: LineAiTurnResponse = { ...compound, presentation: { kind: 'answer_cards', cards: [{ text: REPLY, layout: backlog as any, sourceLabels: PAGES.map((page) => page.label), webLink: PAGES[0]! }] } };
      const message = draw(withRows, 'มีงานค้างอะไรบ้าง');
      const card = readLineSystemCard(message);
      assert.deepEqual(card.header, ['งานค้าง', 'ณ 5 ต.ค. 2569']);
      assert.deepEqual(card.rows, backlog.rows.map((row) => [row.label, ':', row.value]));
      assert.deepEqual(card.notes, backlog.notes);
      assert.deepEqual(card.prose, [], 'the numbered sentences are the fallback, not the card');
      assert.deepEqual(card.actions, PAGES.map((page) => ({ type: 'uri', label: page.label, uri: `${WEB}${page.path}` })));
      assert.match(JSON.stringify(card.bubble), /system-card-icon-list-\d{8}\.png/u);
      assert.doesNotMatch(card.texts.join('\n'), /ขอบเขต|แหล่งข้อมูล|เปิดดู|เปิดลิงก์|ระดับแจ้งเตือน/u);
      assert.ok(message.type === 'flex' && message.canonicalText!.startsWith(REPLY));
      assert.equal(isCompleteLineBusinessAnswerPresentation(message), true);
      assert.deepEqual(lineFlexBodyProblems((message as any).contents), []);
    });

    it('keeps the one button of an answer that read one record, under the record\'s name, and prints no source line', () => {
      const explain: LineAiTurnResponse = { ...compound, replyText: 'บิล «BHC» ยอด 1,789.04 บาทค่ะ\nสถานะตอนนี้: รอตรวจสอบ', sourceLabels: ['EXP-1'],
        webLinks: [{ label: 'EXP-1', path: '/companies/c1/expenses/exp-bhc' }], toolsInvoked: ['expense.get_detail'] };
      const card = readLineSystemCard(draw(explain, 'ทำไม service charge คิดแยกเป็นอีกรายการนึง ทำไมไม่รวมกัน ?'));
      assert.deepEqual(card.prose, ['บิล «BHC» ยอด 1,789.04 บาทค่ะ\nสถานะตอนนี้: รอตรวจสอบ']);
      assert.deepEqual(card.footnotes, []);
      assert.deepEqual(card.actions, [{ type: 'uri', label: 'EXP-1', uri: `${WEB}/companies/c1/expenses/exp-bhc` }]);
      // The same for the one card the gateway sends beside a deterministic sentence that has no rows.
      const single = readLineSystemCard(draw(answer('ค่าใช้จ่ายแยกตามหมวด\n• ไม่ระบุหมวด: 0.00 บาท', undefined, { label: 'สรุปค่าใช้จ่ายแยกกลุ่ม', path: '/companies/c1/expenses' }, 'สรุปค่าใช้จ่ายแยกกลุ่ม'), 'สรุปค่าใช้จ่ายเดือนนี้'));
      assert.deepEqual([single.footnotes, single.actions.map((action) => action.label)], [[], ['สรุปค่าใช้จ่ายแยกกลุ่ม']]);
    });

    it('never goes back to the card from before the design, whatever shape the answer has', () => {
      const shapes: Array<[string, LineAiTurnResponse]> = [
        ['several pages', compound],
        ['cards that do not cover the reply', { ...compound, presentation: { kind: 'answer_cards', cards: [{ text: 'ส่วนหนึ่งของคำตอบ', webLink: PAGES[0]! }] } }],
        ['a card with more sources than the old card showed', { ...compound, presentation: { kind: 'answer_cards', cards: [{ text: REPLY, sourceLabels: ['ก', 'ข', 'ค', 'ง', 'จ', 'ฉ'] }] } }],
        ['rows the design cannot hold', { ...compound, presentation: { kind: 'answer_cards', cards: [{ text: REPLY, layout: { ...SUMMARY, rows: Array.from({ length: 16 }, (_, index) => ({ label: `แถว ${index}`, value: 'ก'.repeat(200) })) } as any }] } }],
        ['a refusal', { ...compound, refused: true, webLinks: [], sourceLabels: [] }],
        ['a long answer', { ...compound, replyText: 'ก'.repeat(3000) }],
        ['one long unbroken word as the question', compound],
      ];
      for (const [name, response] of shapes) {
        const message = draw(response, name === 'one long unbroken word as the question' ? 'EXP-2026-000123' : 'มีงานค้างอะไรบ้าง');
        assert.equal(isLineSystemCard(message), true, name);
        assert.doesNotMatch(JSON.stringify(message), /น้องมั่งมีตอบให้นะคะ|น้องมั่งมีสรุป|ข้อมูลจากน้องมั่งมี|เปิดลิงก์/u, name);
        assert.deepEqual(lineFlexBodyProblems((message as any).contents), [], name);
      }
      assert.deepEqual(readLineSystemCard(draw(compound, 'EXP-2026-000123')).header, ['ข้อความของคุณ', 'EXP-2026-000123']);
    });

    it('a row card shows every other page of the answer under its own name, after its own button', () => {
      const withMore = { ...answer(SENTENCE, SUMMARY, EXPENSES), webLinks: [EXPENSES, { label: 'สรุปปิดร้าน 5 ต.ค. 2569', path: '/companies/c1/expenses?day=2026-10-05' }, { label: 'ของบริษัทอื่น', path: '/companies/c2/expenses' }] };
      const card = readLineSystemCard(draw(withMore));
      assert.deepEqual(card.actions.map((action) => [action.label, action.uri]), [
        ['ดูค่าใช้จ่ายในเว็บ', `${WEB}/companies/c1/expenses`], ['สรุปปิดร้าน 5 ต.ค. 2569', `${WEB}/companies/c1/expenses?day=2026-10-05`]]);
      assert.equal(card.rows.length, SUMMARY.rows.length);
    });
  });

  it('never draws a refused turn\'s cards, and falls back whole when the design cannot hold the answer', () => {
    const refused = { ...answer('🔒 คุณไม่มีสิทธิ์เข้าถึงข้อมูลนี้', SUMMARY, EXPENSES), refused: true };
    const card = readLineSystemCard(draw(refused));
    assert.deepEqual(card.rows, [], 'a refusal is never dressed as the data it refused');
    assert.match(card.prose.join('\n'), /ไม่มีสิทธิ์/u);
    // A long answer is still one card: the paper holds what one LINE text message holds…
    const long = answer(`${'ก'.repeat(1300)}\n${'ข'.repeat(1300)}`, undefined);
    assert.deepEqual(readLineSystemCard(draw(long)).prose, [`${'ก'.repeat(1300)}\n${'ข'.repeat(1300)}`]);
    assert.deepEqual(lineFlexBodyProblems((draw(long) as any).contents), []);
    // …and past that it is the previous rendering, which the delivery plan sends as its text.
    assert.equal(isLineSystemCard(draw(answer('ก'.repeat(5001), undefined))), false);
    // A row longer than the design holds: not this card.
    const wide = answer(SENTENCE, { ...SUMMARY, rows: [{ label: 'ยอดรวม', value: 'ก'.repeat(201) }] }, EXPENSES);
    assert.deepEqual(readLineSystemCard(draw(wide)).rows, [], 'the contract already refuses a 201-character value; the answer is prose');
  });
});

// ── A refused BODY is the one way a card can lose an answer. LINE refuses the whole message for one
//    empty text, one label over 40 characters, one postback over 300. No builder may hand it one. ──
describe('LINE accepts every card of the locked design, whatever the record holds', () => {
  const WEB = 'https://app.example.com';
  const LONG = 'ก'.repeat(5000);
  const NASTY = ['', '   ', '\n', LONG, 'https://evil.example/x', 'a\u0000b', '😀'.repeat(300), '<script>alert(1)</script>', '{"type":"bubble"}'];
  /** A message is fine when it is the previous rendering (not this design) or a body LINE accepts. */
  const acceptable = (message: LineReplyMessage | undefined, where: string) => {
    if (!message || message.type !== 'flex') return;
    assert.deepEqual(lineFlexBodyProblems(message.contents), [], where);
    assert.ok(message.altText.trim().length > 0 && message.altText.length <= 400, `${where}: altText`);
    if (isLineSystemCard(message)) {
      const card = readLineSystemCard(message);
      assert.equal(card.header.length, 2, where);
      for (const text of card.texts) assert.ok(text.trim().length > 0, `${where}: an empty text`);
      for (const row of card.rows) assert.ok(row.every((cell) => cell.trim().length > 0), `${where}: an empty cell`);
    }
  };

  it('review card: a missing value has no row, an over-long one is not this card, and nothing empty is ever drawn', () => {
    for (const value of NASTY) {
      const facts = expenseDraftCardFactsFrom({ expenseId: 'e1', subject: expenseDraftCardSubject('RECEIPT'), vendor: value, item: value, date: value,
        documentNumber: value, documentType: value, category: value, total: value, vat: value, withholdingTax: value, otherCharges: value,
        status: 'รอตรวจสอบ', notesBefore: [value], notesAfter: [value, null, undefined] });
      acceptable(buildExpenseDraftCardMessage('🧾 บันทึกแล้ว', facts, WEB, 'c1'), `review ${JSON.stringify(value).slice(0, 30)}`);
      // A blank value is simply left out; the state row alone still makes a card.
      if (!value.trim()) assert.deepEqual(readLineSystemCard(buildExpenseDraftReviewCard('🧾 บันทึกแล้ว', facts, WEB, 'c1')!).rows, [['สถานะเอกสาร', ':', 'รอตรวจสอบ']]);
    }
    // A blank state or subject cannot be drawn as this card: the reply is sent as it was before.
    for (const facts of [
      expenseDraftCardFactsFrom({ expenseId: 'e1', subject: 'ข้อมูลใบเสร็จ', status: '  ' }),
      expenseDraftCardFactsFrom({ expenseId: 'e1', subject: '', status: 'รอตรวจสอบ' }),
      expenseDraftCardFactsFrom({ expenseId: 'e1', subject: 'ก'.repeat(41), status: 'รอตรวจสอบ' }),
    ]) {
      assert.equal(buildExpenseDraftReviewCard('🧾 บันทึกแล้ว', facts, WEB, 'c1'), undefined);
      acceptable(buildExpenseDraftCardMessage('🧾 บันทึกแล้ว', facts, WEB, 'c1'), 'review fallback');
    }
  });

  it('answers: prose, sources, a link label and every layout field are bounded before a card is drawn', () => {
    for (const value of NASTY) {
      const cards = [{ text: value.trim() ? value : 'คำตอบ', title: value, badge: value, sourceLabels: [value], webLink: { label: value, path: '/companies/c1/expenses' } }];
      acceptable(buildLineBusinessAnswerMessage({ ...response(cards), sourceLabels: [value], webLinks: [{ label: value, path: '/companies/c1/expenses' }] }, 'fallback', WEB, 'c1', value), `answer ${JSON.stringify(value).slice(0, 30)}`);
      acceptable(buildLineBusinessAnswerMessage(response(), value.trim() ? value : 'fallback', WEB, 'c1', value), `plain ${JSON.stringify(value).slice(0, 30)}`);
      acceptable(buildLineSystemTextCardMessage({ text: value, header: { lines: ['แก้ไขค่าใช้จ่าย', 'แก้ไขแล้ว'] }, webBaseUrl: WEB, companyId: 'c1', linkLabel: value, footnotes: [value].filter((note) => note.trim()) }), 'text card');
      // A layout the gateway could never send (the validator refuses these values) still cannot break a card.
      const layout = { context: 'open_work', header: [value || 'ก', value || 'ข'], rows: [{ label: value || 'ก', value: value || 'ข' }], notes: [value || 'ก'], linkLabel: value || 'ก', banner: { tone: 'ok', text: value || 'ก' } };
      acceptable(buildLineBusinessAnswerMessage(response([{ text: 'คำตอบ', layout: layout as any, webLink: { label: 'ดู', path: '/companies/c1/notifications' } }]), 'คำตอบ', WEB, 'c1', 'มีงานค้างไหม'), 'forged layout');
    }
  });

  it('edit command: the proposal and its outcomes never carry an empty cell, an over-long label or an over-long postback', () => {
    const preview = (over: Record<string, unknown> = {}) => ({
      previewId: 'p-1', recordType: 'expense' as const, expenseId: 'exp-1', record: { vendorName: 'BHC', expenseDate: '2026-09-03', statusLabel: 'รอตรวจสอบ' },
      tool: 'expense.draft.add_charge' as const, diff: [{ field: 'charge.SERVICE_CHARGE', label: 'ค่าบริการ', kind: 'money' as const, before: null, after: '152.00' }],
      totalsBefore: { subtotalAmount: '1520', discountAmount: '0', chargesAmount: '0.00', taxableAmount: '1520', vatAmount: '106.40', grandTotalAmount: '1626.40' },
      totalsAfter: { subtotalAmount: '1520', discountAmount: '0', chargesAmount: '152.00', taxableAmount: '1672', vatAmount: '117.04', grandTotalAmount: '1789.04' },
      warnings: [] as string[], expiresAt: '2026-09-05T10:10:00.000Z', ...over,
    });
    for (const value of NASTY) {
      const built = buildDraftUpdatePreviewCard(preview({
        record: { vendorName: value, expenseDate: value, statusLabel: value },
        diff: [{ field: 'x', label: value.trim() ? value : 'ค่าบริการ', kind: 'text' as const, before: value, after: value }],
        warnings: [value], totalsAfter: { ...preview().totalsAfter, grandTotalAmount: value },
      }) as any, WEB);
      // The designed card is checked; the card it had before is what it was and is not this work's.
      if (isLineSystemCard(built)) acceptable(built, `preview ${JSON.stringify(value).slice(0, 30)}`);
      for (const state of ['applied', 'cancelled', 'needs_input', 'unchanged'] as const) acceptable(buildDraftUpdateOutcomeCard(state, value, WEB, 'c1'), `outcome ${state}`);
    }
    // The postbacks of a drawn proposal are always within LINE's 300 characters.
    const drawn = readLineSystemCard(buildDraftUpdatePreviewCard(preview({ previewId: 'x'.repeat(200) }) as any, WEB));
    assert.ok(drawn.actions.every((action) => (action.data ?? '').length <= 300));
  });

  it('waiting and scanning cards are fixed words: every stage LINE can be handed is a body it accepts', () => {
    const stages = [
      ...[['image'], ['file'], ['image', 'image'], ['file', 'file'], ['image', 'file']].map((types) => lineMediaGroupAckStage(types as Array<'image' | 'file'>)),
      ...lineWaitStages({ kind: 'text', messageText: 'ขอสรุปยอดขาย', seed: 's', loadingEnabled: false, latestAcceptedAt: 0, now: 0 }),
      ...lineWaitStages({ kind: 'text', messageText: LONG, seed: 's', loadingEnabled: true, latestAcceptedAt: 0, now: 0 }),
      ...lineWaitStages({ kind: 'media', messageText: '', seed: 's', loadingEnabled: true, latestAcceptedAt: 0, now: 0 }),
    ];
    assert.ok(stages.length >= 9);
    for (const stage of stages) {
      const message = lineWaitStageMessage(stage, WEB);
      assert.equal(message.type, 'flex');
      acceptable(message, stage.text.slice(0, 30));
      assert.equal(message.type === 'flex' && message.canonicalText, stage.text);
    }
  });

  it('the guard itself: what LINE would refuse is not drawable, and the walk names each reason', () => {
    const ok: LineSystemCard = { mascot: 'general', header: { lines: ['ก', 'ข'] }, text: 'ค' };
    assert.equal(lineSystemCardSendable(ok), true);
    for (const [why, card] of [
      ['an empty header line', { ...ok, header: { lines: ['ก', ' '] as const } }],
      ['a header line over 40', { ...ok, header: { lines: ['ก'.repeat(41), 'ข'] as const } }],
      ['an empty row value', { ...ok, rows: [{ label: 'ก', value: '' }] }],
      ['an empty row label', { ...ok, rows: [{ label: ' ', value: 'ข' }] }],
      ['an empty note', { ...ok, notes: [''] }],
      ['an empty banner', { ...ok, banner: { tone: 'ok' as const, text: '' } }],
      ['nothing under the header', { mascot: 'general' as const, header: ok.header }],
      ['a label over 40', { ...ok, button: { action: { type: 'uri' as const, label: 'ก'.repeat(41), uri: `${WEB}/x` }, icon: 'file' as const } }],
      ['an empty label', { ...ok, button: { action: { type: 'uri' as const, label: '', uri: `${WEB}/x` }, icon: 'file' as const } }],
      ['a link that is not https', { ...ok, button: { action: { type: 'uri' as const, label: 'ดู', uri: 'http://app.example.com/x' }, icon: 'file' as const } }],
      ['a link over 1000', { ...ok, button: { action: { type: 'uri' as const, label: 'ดู', uri: `${WEB}/${'x'.repeat(1000)}` }, icon: 'file' as const } }],
      ['a postback over 300', { ...ok, choice: [{ type: 'postback' as const, label: 'ก', data: 'x'.repeat(301) }, { type: 'postback' as const, label: 'ข', data: 'y' }] as const }],
      ['an empty postback', { ...ok, choice: [{ type: 'postback' as const, label: 'ก', data: '' }, { type: 'postback' as const, label: 'ข', data: 'y' }] as const }],
      ['a control character', { ...ok, rows: [{ label: 'ก', value: 'a\u0000b' }] }],
    ] as Array<[string, LineSystemCard]>) {
      assert.equal(lineSystemCardSendable(card), false, why);
      assert.equal(drawLineSystemCard(card, WEB), undefined, why);
    }
    assert.equal(drawLineSystemCard(ok, 'http://app.example.com'), undefined, 'no https base, no pictures, no card');
    assert.equal(drawLineSystemCard({ ...ok, rows: Array.from({ length: 20 }, () => ({ label: 'ก'.repeat(40), value: 'ข'.repeat(600) })), notes: Array.from({ length: 30 }, () => 'ค'.repeat(600)) }, WEB), undefined, 'a bubble past 30 KB');
    assert.deepEqual(lineFlexBodyProblems(drawLineSystemCard(ok, WEB)), []);
    assert.deepEqual(lineFlexBodyProblems({ type: 'bubble', body: { type: 'box', layout: 'vertical', paddingTop: '-4px', contents: [
      { type: 'text', text: '' }, { type: 'image', url: 'http://x/y.png' },
      { type: 'box', layout: 'vertical', contents: [], action: { type: 'postback', label: 'ก'.repeat(41), data: '' } }] } }),
      ['bubble0.body.paddingTop: -4px', 'bubble0.body.contents[0]: empty text', 'bubble0.body.contents[1]: image url',
        'bubble0.body.contents[2]: action label', 'bubble0.body.contents[2]: postback data']);
    assert.deepEqual(lineFlexBodyProblems({ type: 'carousel', contents: [] }), ['carousel of 0 bubbles']);
  });
});

// ── Design lock §7: the header of a prose answer is the reader's own words on two lines. Thai has no
//    spaces and a word list cuts finer than a reader does, so the break must never fall inside a name. ──
describe('lineAnswerCardHeader — the reader\'s own question as two header lines', () => {
  const header = (question: string) => {
    const result = lineAnswerCardHeader(question);
    return result ? `${result.lines[0]} / ${result.lines[1]}${result.quiet ? ' [quiet]' : result.question ? '' : ' [under]'}` : undefined;
  };

  it('breaks a short question where its two lines come out most even — the locked examples included', () => {
    for (const [question, expected] of [
      ['ทำอะไรได้บ้าง', 'ทำอะไร / ได้บ้าง'],
      ['วันนี้เหนื่อยจัง', 'วันนี้ / เหนื่อยจัง'],
      ['มีงานค้างอะไรบ้าง', 'มีงานค้าง / อะไรบ้าง'],
      ['กำไรขั้นต้นคืออะไร', 'กำไรขั้นต้น / คืออะไร'],
      ['รายการนี้จ่ายหรือยัง', 'รายการนี้ / จ่ายหรือยัง'],
      ['เพิ่มค่าบริการ 152 บาท', 'เพิ่มค่าบริการ / 152 บาท'],
      ['what can you do', 'what can / you do'],
    ]) assert.equal(header(question), expected, question);
  });

  it('never ends a line inside a name: ค่าใช้จ่าย, ใบเสร็จ, แจ้งเตือน, เท่าไหร่, วันนี้ stay whole', () => {
    for (const [question, expected] of [
      ['ดูค่าใช้จ่ายเดือนนี้', 'ดูค่าใช้จ่าย / เดือนนี้'],
      ['ค่าใช้จ่ายเดือนนี้เท่าไหร่', 'ค่าใช้จ่าย / เดือนนี้เท่าไหร่'],
      ['สรุปค่าใช้จ่าย', 'สรุป / ค่าใช้จ่าย'],
      ['มีแจ้งเตือนอะไรไหม', 'มีแจ้งเตือน / อะไรไหม'],
      ['ขอดูใบเสร็จล่าสุด', 'ขอดูใบเสร็จ / ล่าสุด'],
      ['ใบเบิกรออนุมัติมีไหม', 'ใบเบิก / รออนุมัติมีไหม'],
      ['ใบกำกับภาษีคืออะไร', 'ใบกำกับภาษี / คืออะไร'],
      ['รายจ่ายเดือนที่แล้ว', 'รายจ่าย / เดือนที่แล้ว'],
      ['ยอดขายวันนี้', 'ยอดขาย / วันนี้'],
      ['เบิกจ่ายรออนุมัติ', 'เบิกจ่าย / รออนุมัติ'],
      ['หัก ณ ที่จ่ายคืออะไร', 'หัก ณ ที่จ่าย / คืออะไร'],
      ['ติดต่อเจ้าหน้าที่', 'ติดต่อ / เจ้าหน้าที่'],
      ['เดือนนี้จ่ายไปเท่าไหร่คะ', 'เดือนนี้จ่ายไป / เท่าไหร่คะ'],
    ]) assert.equal(header(question), expected, question);
    // The property itself, over every example: no line ends on a word that only begins a name,
    // and none starts with one that only ends a phrase.
    for (const question of ['ดูค่าใช้จ่ายเดือนนี้', 'ค่าใช้จ่ายเดือนนี้เท่าไหร่', 'ขอดูใบเสร็จล่าสุด', 'มีแจ้งเตือนอะไรไหม', 'ยอดขายวันนี้', 'ช่วยสรุปรายจ่ายหน่อย', 'ค่าบริการคิดยังไง', 'บิลนี้ทำไมยอดไม่ตรง']) {
      const [first, second] = lineAnswerCardHeader(question)!.lines;
      assert.doesNotMatch(first, /(?:ค่า|ใบ|แจ้ง|เท่า|ราย|ยอด|ค่าใช้)$/u, question);
      assert.doesNotMatch(second, /^(?:นี้|ไหร่|ไง|หน่อย|จ่ายเดือน)/u, question);
      assert.equal(`${first}${second}`, question.replace(/\s+/gu, ''), 'nothing is rephrased, added or dropped');
    }
  });

  it('puts a message that has no place to break under ข้อความของคุณ, whole', () => {
    for (const [message, expected] of [['สวัสดีค่ะ', 'ข้อความของคุณ / สวัสดีค่ะ [under]'], ['ขอบคุณค่ะ', 'ข้อความของคุณ / ขอบคุณค่ะ [under]'],
      ['ค่าใช้จ่าย', 'ข้อความของคุณ / ค่าใช้จ่าย [under]'], ['hello', 'ข้อความของคุณ / hello [under]'], ['ok', 'ข้อความของคุณ / ok [under]']]) {
      assert.equal(header(message), expected, message);
    }
  });

  it('never breaks a number or a code written without a space, however long', () => {
    for (const [message, expected] of [
      ['ขอดูรายการ DEMO-EXP-002', 'ขอดูรายการ / DEMO-EXP-002'],
      ['EXP-2026-0009', 'ข้อความของคุณ / EXP-2026-0009 [under]'],
      // Longer than a line and with no place to break: whole under the kicker (the line shrinks to fit).
      ['EXP-2026-000123', 'ข้อความของคุณ / EXP-2026-000123 [under]'],
      ['RB-202608-00002 ถึงไหนแล้ว', 'RB-202608-00002 / ถึงไหนแล้ว [quiet]'],
    ]) assert.equal(header(message), expected, message);
  });

  it('keeps the beginning of a long question and marks the cut, in the quieter style; a Latin name is not split', () => {
    assert.equal(header('ทำไม service charge คิดแยกเป็นอีกรายการนึง ทำไมไม่รวมกัน ?'), 'ทำไม / service charge… [quiet]');
    const long = lineAnswerCardHeader('ค่าใช้จ่ายเดือนที่แล้วเทียบกับเดือนนี้เป็นยังไงบ้างคะช่วยดูให้หน่อย')!;
    assert.deepEqual([long.lines[0], long.quiet, long.lines[1].endsWith('…')], ['ค่าใช้จ่ายเดือนที่แล้ว', true, true]);
    assert.ok('ค่าใช้จ่ายเดือนที่แล้วเทียบกับเดือนนี้เป็นยังไงบ้างคะช่วยดูให้หน่อย'.startsWith(`${long.lines[0]}${long.lines[1].slice(0, -1)}`), 'the heading is the question\'s own beginning');
    // One unbroken run longer than a line is cut by letters: there is no other way, and the cut is marked.
    const run = lineAnswerCardHeader('ก'.repeat(60))!;
    assert.deepEqual([[...run.lines[0]].length, run.lines[1].endsWith('…'), run.quiet], [16, true, true]);
  });

  it('holds every line to what the header can show, and has no header for nothing', () => {
    for (const question of ['ดูค่าใช้จ่ายเดือนนี้', 'ทำไม service charge คิดแยกเป็นอีกรายการนึง ทำไมไม่รวมกัน ?', 'ก'.repeat(200), 'a b c d e f g h i j k l m n o p q r s t u v w x y z']) {
      const result = lineAnswerCardHeader(question)!;
      const limit = result.quiet ? 16 : 14;
      for (const line of result.lines) assert.ok([...new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(line)].length <= limit && line.trim().length > 0, `${question} → ${line}`);
    }
    for (const empty of [undefined, '', '   ', '\n\t']) assert.equal(lineAnswerCardHeader(empty), undefined);
  });

  it('reads only the beginning of a very long message: the heading of 5,000 characters costs no more than that of 100', () => {
    const long = `${'ขอสรุปค่าใช้จ่ายเดือนนี้แยกตามหมวดหมู่และร้านค้า '.repeat(120)}`;
    assert.ok(long.length > 5000);
    const started = process.hrtime.bigint();
    const result = lineAnswerCardHeader(long)!;
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    assert.deepEqual([result.lines[0], result.quiet, result.lines[1].endsWith('…')], ['ขอสรุปค่าใช้จ่าย', true, true]);
    assert.ok(elapsedMs < 50, `took ${elapsedMs.toFixed(1)} ms`);
  });
});

// ── §10.1 expense draft card, on the locked System OA design (context 6 "รอตรวจสอบ"): the review mascot,
//    one `label : value` row per grounded fact, the draft's notes, and the one button that opens the record. ──
describe('expense draft card (§10.1) — the locked review card', () => {
  const WEB = 'https://app.example.com';
  const CANONICAL = '🧾 บันทึกข้อมูลค่าใช้จ่ายเบื้องต้นแล้ว (รอตรวจสอบ)\n• ยอดรวม – 1,250.00';
  const FULL: LineExpenseDraftCardFacts = {
    expenseId: 'exp-1', subject: 'ข้อมูลใบเสร็จ',
    rows: [
      { label: 'ผู้ขาย / ร้านค้า', value: 'ร้านกาแฟบ้านไร่' }, { label: 'วันที่เอกสาร', value: '2 ก.ย. 2569' },
      { label: 'หมวดค่าใช้จ่าย', value: 'ค่าเดินทาง' }, { label: 'ยอดรวม', value: '1,250.00 บาท', total: true },
      { label: 'สถานะเอกสาร', value: 'รอตรวจสอบ', pill: 'pending' },
    ],
    notes: ['รายการนี้เป็นร่าง ยังไม่ได้ยืนยันรายการ'],
  };

  it('draws the review mascot, the two header lines, one row per fact in order, the note and the review button', () => {
    const message = buildExpenseDraftCardMessage(CANONICAL, FULL, WEB, 'c1');
    assert.equal(message.type, 'flex');
    const card = readSystemCard(message);
    assert.deepEqual(card.header, ['ข้อมูลใบเสร็จ', 'รอตรวจสอบ']);
    assert.equal(card.mascot, `${WEB}/assets/line/system-card-mascot-review-20261005.png`);
    assert.deepEqual(card.rows, FULL.rows.map((row) => [row.label, ':', row.value]));
    assert.deepEqual(card.notes, FULL.notes);
    assert.deepEqual(card.actions, [{ type: 'uri', label: 'เปิดดูในเว็บ', uri: 'https://app.example.com/companies/c1/expenses/exp-1' }]);
    const signed = readSystemCard(buildExpenseDraftReviewCard('บันทึกร่างแล้วค่ะ', FULL, WEB, 'c1', { token: 'preview.signed', summary: 'ตรวจยอด 170.00 บาทก่อนยืนยันค่ะ', details: ['มีหลักฐานแล้วค่ะ'] } as any)!);
    assert.equal(signed.actions[0]?.type, 'postback');
    assert.match(String((signed.actions[0] as any)?.data), /expense_action_confirm/);
    assert.ok(signed.notes.includes('ตรวจยอด 170.00 บาทก่อนยืนยันค่ะ\nมีหลักฐานแล้วค่ะ'));
    // The owner cut the yellow "รอตรวจสอบ" strip: the header and the status row already say it.
    assert.equal(card.banner, undefined);
    assert.equal(isCompleteLineBusinessAnswerPresentation(message), true, 'so a bound chat is sent the card itself');
  });

  it('omits every row the capture did not ground, and never substitutes a placeholder', () => {
    const message = buildExpenseDraftCardMessage(CANONICAL, { ...FULL, rows: [{ label: 'ผู้ขาย / ร้านค้า', value: '  ' }, { label: 'หมวดค่าใช้จ่าย', value: 'ค่าเดินทาง' }] }, WEB, 'c1');
    assert.deepEqual(readSystemCard(message).rows, [['หมวดค่าใช้จ่าย', ':', 'ค่าเดินทาง']]);
    assert.doesNotMatch(JSON.stringify((message as any).contents), /ยังไม่ระบุ|undefined|null/u);
  });

  it('degrades to the generic text card when nothing is grounded, a fact is longer than a row, or LINE could not fetch the pictures', () => {
    for (const [facts, base] of [
      [{ ...FULL, rows: [] }, WEB],
      [{ ...FULL, rows: [{ label: 'ผู้ขาย / ร้านค้า', value: 'ก'.repeat(201) }] }, WEB],
      [{ ...FULL, notes: Array.from({ length: 5 }, (_, index) => `หมายเหตุ ${index}`) }, WEB],
      [FULL, 'http://app.example.com'], [FULL, undefined],
    ] as Array<[LineExpenseDraftCardFacts, string | undefined]>) {
      const message = buildExpenseDraftCardMessage(CANONICAL, facts, base, 'c1');
      assert.equal(message.type, 'flex');
      assert.equal((message as any).contents.header.contents[0].text, 'ข้อมูลจากน้องมั่งมี');
      assert.match(JSON.stringify(message.contents), /บันทึกข้อมูลค่าใช้จ่ายเบื้องต้นแล้ว/u);
      assert.equal(buildExpenseDraftReviewCard(CANONICAL, facts, base, 'c1'), undefined);
    }
  });

  it('carries the CANONICAL reply as altText and as the text a fallback sends, with the way in as a line', () => {
    const message = buildExpenseDraftCardMessage(CANONICAL, FULL, WEB, 'c1');
    assert.equal(message.type === 'flex' && message.altText, CANONICAL);
    assert.equal(message.type === 'flex' && message.canonicalText, `${CANONICAL}\nเปิดดูรายการ: https://app.example.com/companies/c1/expenses/exp-1`);
    const linked = `${CANONICAL}\n✅ ตรวจสอบและยืนยันในเว็บแอป:\nhttps://app.example.com/companies/c1/expenses/exp-1`;
    assert.equal((buildExpenseDraftCardMessage(linked, FULL, WEB, 'c1') as any).canonicalText, linked, 'a reply that already carries the link is not given a second one');
    // Longer than the shared 400-character preview ceiling: VISIBLY marked, never silently cut.
    const marked = buildExpenseDraftCardMessage('ก'.repeat(500), FULL, WEB, 'c1');
    assert.equal(marked.type === 'flex' && Array.from(marked.altText).length, 400);
    assert.ok(marked.type === 'flex' && marked.altText.endsWith('…'));
  });

  it('opens exactly the tenant expense record — no query, no hash, no financial parameter', () => {
    const [action] = readSystemCard(buildExpenseDraftCardMessage(CANONICAL, FULL, WEB, 'c1')).actions;
    assert.equal(action!.uri, 'https://app.example.com/companies/c1/expenses/exp-1');
    assert.equal(new URL(action!.uri!).search, '');
    assert.equal(new URL(action!.uri!).hash, '');
    // An id that cannot form a tenant path gets no card of this design, and no link anywhere.
    for (const [companyId, expenseId] of [['..', 'exp-1'], ['c1', '../../c2/expenses/e9']] as Array<[string, string]>) {
      const message = buildExpenseDraftCardMessage(CANONICAL, { ...FULL, expenseId }, WEB, companyId);
      assert.equal(buildExpenseDraftReviewCard(CANONICAL, { ...FULL, expenseId }, WEB, companyId), undefined);
      assert.doesNotMatch(JSON.stringify(message), /"type":"uri"/u);
    }
  });

  it('passes Thai NFC text through byte-identically, in the rows and in the altText', () => {
    // NFC: base + tone/vowel marks as their own code points — normalising to NFKC would rewrite them.
    const item = 'ค่าน้ำมันรถ'.normalize('NFC');
    const message = buildExpenseDraftCardMessage(item, { ...FULL, rows: [{ label: 'รายการ', value: item }] }, WEB, 'c1');
    assert.equal(readSystemCard(message).rows[0]![2], item);
    assert.equal(message.type === 'flex' && message.altText, item);
    assert.equal(JSON.parse(JSON.stringify(message)).altText, item);
  });
});

// ── Owner 2026-10-05, real LINE: a photo that is a bill already kept was answered on the green card
//    from before the design ("ข้อมูลจากน้องมั่งมี" / "📷 รูปนี้ตรงกับบิลที่เก็บไว้แล้วค่ะ …"). It is a row
//    card like the receipt review card, written from the record's own facts. ──
describe('a photo that is a bill already kept — the row card', () => {
  const WEB = 'https://app.example.com';
  const LINK = `${WEB}/companies/c1/expenses/e1`;
  /** The reply exactly as the webhook composes it. */
  const reply = (vendor: string | null, total: string, status: string, verification?: string | null) => [
    '📷 รูปนี้ตรงกับบิลที่เก็บไว้แล้วค่ะ', ...(vendor ? [`ผู้ขาย – ${vendor}`] : []), `ยอดรวม – ${total}`,
    `สถานะ – ${receiptProgressLabel(status, verification)}`, `เปิดใบเสร็จเดิม: ${LINK}`].join('\n');
  const kept = (status: string, verification?: string | null, over: { vendor?: string | null; total?: string | null } = {}) => {
    const facts = { vendor: 'Starbucks Coffee', total: '170.00 บาท', ...over };
    const text = reply(facts.vendor ?? null, facts.total ?? '0.00 บาท', status, verification);
    return { text, message: buildKeptReceiptCard(text, { expenseId: 'e1', ...facts, progress: receiptProgress(status, verification) }, WEB, 'c1') };
  };
  const PILL = { ok: ['#edf3e8', '#356341'], pending: ['#fbf1d8', '#755418'], closed: ['#f5e4de', '#884838'] } as const;

  it('the case the owner saw — a draft waiting for review: seller, total on the emphasised row, the state, what is left to do, one button', () => {
    const { text, message } = kept('NEEDS_REVIEW');
    const card = readSystemCard(message!);
    assert.deepEqual(card.header, ['เอกสารที่ส่งมา', 'ตรงกับบิลที่เก็บไว้แล้ว']);
    assert.deepEqual(card.rows, [['ผู้ขาย', ':', 'Starbucks Coffee'], ['ยอดรวม', ':', '170.00 บาท'], ['สถานะ', ':', 'บันทึกแบบร่างแล้ว']]);
    assert.deepEqual(card.totals, ['ยอดรวม']);
    assert.deepEqual(card.pills, { 'สถานะ': PILL.pending });
    assert.deepEqual(card.notes, ['รอคุณตรวจสอบและยืนยัน']);
    assert.deepEqual(card.actions, [{ type: 'uri', label: 'เปิดใบเสร็จเดิม', uri: LINK }]);
    assert.deepEqual([card.prose, card.footnotes, card.banner], [[], [], undefined]);
    assert.match(card.mascot, /system-card-mascot-general-/u);
    // Nothing the card prints is an emoji, a raw link, or the title of the card from before the design.
    assert.ok(card.texts.every((line) => !/\p{Extended_Pictographic}|https?:|ข้อมูลจากน้องมั่งมี/u.test(line)), card.texts.join(' | '));
    // The reply itself is untouched: it is what is stored, and what LINE gets if it refuses the card.
    assert.equal(message!.type === 'flex' && message!.canonicalText, text);
    assert.equal(message!.type === 'flex' && message!.altText, '📷 รูปนี้ตรงกับบิลที่เก็บไว้แล้วค่ะ\nผู้ขาย – Starbucks Coffee\nยอดรวม – 170.00 บาท\nสถานะ – บันทึกแบบร่างแล้ว รอคุณตรวจสอบและยืนยัน');
    assert.equal(isCompleteLineBusinessAnswerPresentation(message!), true);
    assert.deepEqual(lineFlexBodyProblems((message as any).contents), []);
  });

  it('every state the kept bill can be in: the state row and the note are the sentence\'s own words, in the state\'s tone', () => {
    for (const [status, verification, state, pill, note] of [
      ['DRAFT', null, 'บันทึกแบบร่างแล้ว', PILL.pending, 'รอคุณตรวจสอบและยืนยัน'],
      ['NEEDS_REVIEW', 'VERIFIED', 'บันทึกแบบร่างแล้ว', PILL.pending, 'รอคุณตรวจสอบและยืนยัน'],
      ['READY_FOR_CONFIRMATION', null, 'บันทึกแบบร่างแล้ว', PILL.pending, 'รอคุณตรวจสอบและยืนยัน'],
      ['CONFIRMED', null, 'ยืนยันรายการแล้ว', PILL.ok, undefined],
      ['VOIDED', null, 'ยกเลิกรายการแล้ว', PILL.closed, undefined],
      // Longer than a pill holds on a narrow phone: printed as words, never cut.
      ['REJECTED', null, 'รายการไม่ผ่านการตรวจ', undefined, undefined],
      ['EXTRACTING', null, 'กำลังอ่านใบเสร็จ', PILL.pending, undefined],
      ['DRAFT', 'VERIFYING', 'กำลังอ่านใบเสร็จ', PILL.pending, undefined],
      ['DRAFT', 'FAILED', 'เก็บภาพแล้ว', PILL.pending, 'แต่อ่านข้อมูลไม่สำเร็จ'],
      ['A_STATE_NOT_KNOWN_HERE', null, 'ยังยืนยันสถานะไม่ได้', PILL.pending, undefined],
    ] as const) {
      const name = `${status}/${verification}`;
      const { text, message } = kept(status, verification);
      const card = readSystemCard(message!);
      assert.deepEqual(card.header, ['เอกสารที่ส่งมา', 'ตรงกับบิลที่เก็บไว้แล้ว'], name);
      assert.deepEqual(card.rows.at(-1), ['สถานะ', ':', state], name);
      assert.deepEqual(card.pills, pill ? { 'สถานะ': pill } : {}, name);
      assert.deepEqual(card.notes, note ? [note] : [], name);
      // One wording per fact: the sentence says the same state and the same follow-on, in that order.
      assert.equal(receiptProgressLabel(status, verification), note ? `${state} ${note}` : state, name);
      assert.ok(text.includes(`สถานะ – ${note ? `${state} ${note}` : state}`), name);
      assert.equal(message!.type === 'flex' && message!.canonicalText, text, name);
      assert.deepEqual(lineFlexBodyProblems((message as any).contents), [], name);
    }
  });

  it('a fact the record does not hold has no row — never an empty cell; the state alone still makes the card', () => {
    for (const vendor of [null, undefined, '', '   ']) {
      const card = readSystemCard(kept('DRAFT', null, { vendor }).message!);
      assert.deepEqual(card.rows.map(([label]) => label), ['ยอดรวม', 'สถานะ'], JSON.stringify(vendor));
    }
    for (const total of [null, undefined, '', '  ']) {
      const card = readSystemCard(kept('EXTRACTING', null, { total }).message!);
      assert.deepEqual(card.rows.map(([label]) => label), ['ผู้ขาย', 'สถานะ'], JSON.stringify(total));
      assert.deepEqual(card.totals, [], 'no emphasised row for an amount the record does not hold');
    }
    const bare = readSystemCard(kept('EXTRACTING', null, { vendor: null, total: null }).message!);
    assert.deepEqual(bare.rows, [['สถานะ', ':', 'กำลังอ่านใบเสร็จ']]);
    assert.deepEqual(bare.actions.map((action) => action.label), ['เปิดใบเสร็จเดิม']);
    for (const row of bare.rows) assert.ok(row.every((cell) => cell.trim().length > 0));
  });

  it('is not drawn where it could not be whole: the caller then sends the reply as it did before', () => {
    const facts = { expenseId: 'e1', vendor: 'Starbucks Coffee', total: '170.00 บาท', progress: receiptProgress('DRAFT') };
    for (const base of [undefined, '', 'http://localhost:3000', 'not a url']) assert.equal(buildKeptReceiptCard('reply', facts, base, 'c1'), undefined, String(base));
    assert.equal(buildKeptReceiptCard('reply', { ...facts, vendor: 'ก'.repeat(201) }, WEB, 'c1'), undefined, 'a seller longer than a row holds');
    // The button opens THIS company's own page of that bill, or there is no card: an id that is not a
    // plain id is never turned into a way out of the company's pages.
    assert.equal(buildKeptReceiptCard('reply', { ...facts, expenseId: '../../c2/expenses/x?y=1' }, WEB, 'c1'), undefined);
    assert.deepEqual(readSystemCard(buildKeptReceiptCard('reply', { ...facts, expenseId: 'exp 1' }, WEB, 'c1')!).actions.map((action) => action.uri), [`${WEB}/companies/c1/expenses/exp%201`]);
  });
});

describe('reimbursement intake cards — server-owned, never rendered from model text', () => {
  const BADGE = '📝 ยังไม่ได้สร้างรายการ';
  const bubbleOf = (message: { type: string }) => (message as any).contents;

  it('asks exactly who paid — personal pay to claim back, or the company — with no link and no amounts', () => {
    const message = buildReimbursementPayerClarificationMessage();
    assert.equal(message.type, 'flex');
    assert.ok(message.type === 'flex' && message.altText.length > 0);
    const contents = bubbleOf(message);
    assert.equal(contents.footer, undefined);
    assert.doesNotMatch(JSON.stringify(message), /"type":"uri"|https?:\/\//u);
    assert.equal(contents.body.contents.length, 1, 'one body row: no badge, no sources');
    const body = contents.body.contents[0].text as string;
    assert.match(body, /จ่ายเงินส่วนตัว.*เบิกคืน/u, 'option one: paid personally, wants it back');
    assert.match(body, /บริษัท.*จ่ายเอง/u, 'option two: the company paid');
    assert.doesNotMatch(body, /\d|บาท|THB/u, 'no financial fields');
  });

  it('hands off to the exact new-reimbursement page on the trusted origin and says no record exists yet', () => {
    const message = buildReimbursementHandoffMessage('https://app.example.com/base', 'c1');
    assert.equal(message.type, 'flex');
    const contents = bubbleOf(message);
    assert.equal(contents.body.contents[0].text, BADGE);
    assert.match(contents.body.contents[1].text, /ตรวจสอบ.*กรอก/u, 'the body sends the user to review and fill in the web');
    assert.equal(contents.footer.contents.length, 1);
    const action = contents.footer.contents[0].action;
    assert.equal(action.type, 'uri');
    assert.equal(action.uri, 'https://app.example.com/companies/c1/reimbursements/new');
    const uri = new URL(action.uri);
    assert.equal(uri.origin, 'https://app.example.com');
    assert.equal(uri.search, '', 'no query prefill');
    assert.equal(uri.hash, '', 'no hash');
  });

  it('keeps the card but drops the button when the web base is missing or untrusted', () => {
    for (const base of [undefined, '', 'not a url', 'javascript:alert(1)', 'ftp://app.example.com']) {
      const message = buildReimbursementHandoffMessage(base, 'c1');
      assert.equal(message.type, 'flex', String(base));
      const contents = bubbleOf(message);
      assert.equal(contents.footer, undefined, String(base));
      assert.equal(contents.body.contents[0].text, BADGE, String(base));
      assert.doesNotMatch(JSON.stringify(message), /"type":"uri"/u, String(base));
    }
  });

  it('cannot be steered to another tenant or another page by the company id', () => {
    const hostile = ['c1/../c2', '..', '.', 'c1/reimbursements/../../c2', 'c1\\..\\c2', 'c1%2F..%2Fc2', 'c1?x=1', 'c1#frag', 'c 1'];
    for (const companyId of hostile) {
      const action = bubbleOf(buildReimbursementHandoffMessage('https://app.example.com', companyId)).footer?.contents[0]?.action;
      if (!action) continue;
      assert.equal(action.uri, `https://app.example.com/companies/${encodeURIComponent(companyId)}/reimbursements/new`, companyId);
      assert.equal(new URL(action.uri).search, '', companyId);
      assert.equal(new URL(action.uri).hash, '', companyId);
    }
    // Traversal never gets a button at all; an odd-but-honest id gets exactly its encoded tenant path.
    for (const traversing of ['c1/../c2', '..', '.', 'c1\\..\\c2']) {
      assert.equal(bubbleOf(buildReimbursementHandoffMessage('https://app.example.com', traversing)).footer, undefined, traversing);
    }
    const spaced = bubbleOf(buildReimbursementHandoffMessage('https://app.example.com', 'c 1')).footer.contents[0].action.uri;
    assert.equal(spaced, 'https://app.example.com/companies/c%201/reimbursements/new');
  });

  it('carries the words each card shows as canonical text, and the handoff button as a link line', () => {
    const payer = buildReimbursementPayerClarificationMessage() as any;
    assert.equal(payer.canonicalText, bubbleOf(payer).body.contents[0].text);
    const handoff = buildReimbursementHandoffMessage('https://app.example.com', 'c1') as any;
    assert.equal(handoff.canonicalText,
      `${bubbleOf(handoff).body.contents[1].text}\nเปิดกรอกใบเบิกคืนในเว็บ: https://app.example.com/companies/c1/reimbursements/new`);
    // No button, no link line: the text never names a page the card itself would not open.
    const noButton = buildReimbursementHandoffMessage(undefined, 'c1') as any;
    assert.equal(noButton.canonicalText, bubbleOf(noButton).body.contents[1].text);
  });
});

describe('receipt quota card (P10-L §3.7/§7)', () => {
  it('sends the two §7 buttons as chat commands, not links out of the conversation', () => {
    const message = buildReceiptQuotaExceededMessage('ช่วงทดลองให้ AI อ่านรูปได้ 15 ครั้ง ตอนนี้ครบแล้วค่ะ (ใบเสร็จ 1 ใบ = 1 ครั้ง) ดูแพ็กเกจที่ใหญ่ขึ้นได้เลย', true);
    assert.equal(message.type, 'flex');
    const bubble = message.contents as any;
    assert.deepEqual(bubble.footer.contents.map((button: any) => button.action), [
      // `โปรโมชั่น` is the command the webhook already answers with the promotion card (pull, §3.7).
      { type: 'message', label: 'ดูแพ็กเกจ', text: 'โปรโมชั่น' },
      { type: 'message', label: 'ขอเปลี่ยนแพ็กเกจ', text: 'ขอเปลี่ยนแพ็กเกจ' },
    ]);
  });

  // Advisor spec §2.2 (Owner 2026-09-30): no purchase, package-change or view-packages button for a
  // reader without `company.plan.manage`; the sentence the caller passes already names who to ask.
  it('shows no button at all to a reader who may not buy', () => {
    const text = `ช่วงทดลองให้ AI อ่านรูปได้ 15 ครั้ง ตอนนี้ครบแล้วค่ะ (ใบเสร็จ 1 ใบ = 1 ครั้ง) ${ASK_PLAN_MANAGER_TH}`;
    const message = buildReceiptQuotaExceededMessage(text, false);
    assert.equal(message.type, 'flex');
    assert.equal((message as any).contents.footer, undefined);
    assert.equal((message as { altText: string }).altText, text);
    assert.doesNotMatch(JSON.stringify(message), /ดูแพ็กเกจ|ขอเปลี่ยนแพ็กเกจ|โปรโมชั่น/);
  });

  it('keeps the spoken sentence as altText, so the chat preview reads as the same words', () => {
    const text = 'ช่วงทดลองให้ AI อ่านรูปได้ 10 ครั้ง ตอนนี้ครบแล้วค่ะ (ใบเสร็จ 1 ใบ = 1 ครั้ง) ดูแพ็กเกจที่ใหญ่ขึ้นได้เลย';
    const message = buildReceiptQuotaExceededMessage(text, true);
    assert.equal(message.type, 'flex');
    assert.equal((message as { altText: string }).altText, text);
    assert.equal((message as { contents: any }).contents.body.contents[1].text, text);
  });

  // Production 2026-10-01: with no canonicalText the delivery plan of a bound chat refused this card
  // (LINE_PLAN_CANONICAL_TEXT_REQUIRED) and a shop at its limit was answered with silence. The text form
  // is the sentence the caller built for THIS reader, so it keeps the §2.2 rule: every wording of the
  // wall names who to ask, and never a purchase, for a reader who may not buy.
  it('carries the same sentence as canonical text, which a delivery plan requires', () => {
    for (const canManagePlan of [true, false]) {
      for (const [limit, tierKey, cadence, gift] of [[15, 'FREE_TRIAL_15', undefined, false], [30, 'STARTER_249', undefined, false],
        [null, 'STARTER_249', undefined, false], [20, null, 'PAID_GRANTS', false], [30, 'STARTER_249', undefined, true]] as const) {
        const text = receiptQuotaExceededTextTh(limit, tierKey, cadence, gift, canManagePlan);
        const message = buildReceiptQuotaExceededMessage(text, canManagePlan) as any;
        assert.equal(message.canonicalText, text);
        assert.equal(message.canonicalText, message.contents.body.contents[1].text, 'the words the card shows, nothing added');
        if (!canManagePlan) {
          assert.ok(message.canonicalText.endsWith(ASK_PLAN_MANAGER_TH), text);
          assert.doesNotMatch(message.canonicalText, /ดูแพ็กเกจ|ขอเปลี่ยนแพ็กเกจ|แพ็กเกจที่ใหญ่ขึ้น|ซื้อ|โปรโมชั่น/);
        }
      }
    }
  });

  // The buttons are the point of this card, so a delivery plan must send the card itself — with them
  // for a reader who may buy, without them for anyone else. It may only when the bubble holds the whole
  // sentence; one the body would cut is sent as its full text instead.
  it('is a complete presentation of its sentence, unless the bubble body would cut it', () => {
    for (const canManagePlan of [true, false]) {
      assert.equal(isCompleteLineBusinessAnswerPresentation(buildReceiptQuotaExceededMessage('ตอนนี้ครบแล้วค่ะ', canManagePlan)), true);
      assert.equal(isCompleteLineBusinessAnswerPresentation(buildReceiptQuotaExceededMessage('ก'.repeat(1_201), canManagePlan)), false);
    }
  });
});

/** Every refusal `buildAiBudgetExceededMessage` words differently; `undefined` is the legacy TOTAL-exhausted card. */
const BUDGET_REFUSALS = [
  undefined,
  { budgetErrorCode: 'AI_MONTHLY_BUDGET_EXCEEDED', budgetScope: 'TOTAL' as const },
  { budgetErrorCode: 'AI_BUDGET_INSUFFICIENT', budgetScope: 'TOTAL' as const },
  { budgetErrorCode: 'AI_MONTHLY_BUDGET_EXCEEDED', budgetScope: 'CHAT' as const },
  { budgetErrorCode: 'AI_BUDGET_INSUFFICIENT', budgetScope: 'CHAT' as const },
];

describe('CHAT budget refusal card', () => {
  it('does not suggest a package change as a same-month chat-credit refill', () => {
    // The staff door only, whether or not the reader may buy.
    for (const canManagePlan of [true, false]) for (const budgetErrorCode of ['AI_MONTHLY_BUDGET_EXCEEDED', 'AI_BUDGET_INSUFFICIENT']) {
      const message = buildAiBudgetExceededMessage(false, { budgetErrorCode, budgetScope: 'CHAT' }, canManagePlan);
      const rendered = JSON.stringify(message);
      assert.match(rendered, /เครดิต AI ส่วนแชต/);
      assert.match(rendered, /ไม่เติมเครดิตแชตในเดือนนี้/);
      assert.match(rendered, /ติดต่อเจ้าหน้าที่/);
      assert.doesNotMatch(rendered, /ดูแพ็กเกจ|ขอเปลี่ยนแพ็กเกจ|โปรโมชั่น/);
      assert.deepEqual(((message as any).contents).footer.contents.map((item: any) => item.action), [
        { type: 'uri', label: 'ติดต่อเจ้าหน้าที่', uri: 'https://lin.ee/6Sc38L6' },
      ]);
    }
  });

  it('keeps the existing package actions for a TOTAL refusal to a reader who may buy', () => {
    const rendered = JSON.stringify(buildAiBudgetExceededMessage(false,
      { budgetErrorCode: 'AI_MONTHLY_BUDGET_EXCEEDED', budgetScope: 'TOTAL' }, true));
    assert.match(rendered, /เปลี่ยนแพ็กเกจ/);
    assert.match(rendered, /"label":"ดูแพ็กเกจ"/);
  });

  // Advisor spec §2.2 (Owner 2026-09-30): "ถ้าไม่มีสิทธิ์ซื้อ ต้องไม่มีปุ่มนำไปซื้อ".
  it('gives a reader who may not buy no package button, only who to ask', () => {
    for (const trialTier of [true, false]) {
      for (const refusal of [undefined, { budgetErrorCode: 'AI_MONTHLY_BUDGET_EXCEEDED', budgetScope: 'TOTAL' as const },
        { budgetErrorCode: 'AI_BUDGET_INSUFFICIENT', budgetScope: 'TOTAL' as const }]) {
        const message = buildAiBudgetExceededMessage(trialTier, refusal, false) as any;
        assert.equal(message.contents.footer, undefined, 'no button at all');
        assert.ok(message.altText.endsWith(` ${ASK_PLAN_MANAGER_TH}`), message.altText);
        assert.doesNotMatch(JSON.stringify(message), /ดูแพ็กเกจ|ขอเปลี่ยนแพ็กเกจ|โปรโมชั่น/);
        assert.match(message.altText, /เดือนหน้าเริ่มใหม่/, 'still says when the credit comes back');
      }
    }
  });

  it('says the refusal once and the next step once, in Thai and English', () => {
    for (const language of ['th', 'en'] as const) for (const canManagePlan of [true, false]) for (const refusal of BUDGET_REFUSALS) {
      const message = buildAiBudgetExceededMessage(false, refusal, canManagePlan, language) as any;
      assert.equal(message.contents.body.contents.length, 1, 'one body sentence, no duplicate badge');
      const title = message.contents.header.contents[0].text, sentence = message.contents.body.contents[0].text;
      assert.equal(message.canonicalText, `${title}\n${sentence}`);
      assert.equal(isCompleteLineBusinessAnswerPresentation(message), true);
      assert.doesNotMatch(sentence, language === 'th' ? /ไม่พอเริ่มงาน|หมดแล้ว/u : /insufficient|has run out/u);
      if (refusal?.budgetScope !== 'CHAT' && canManagePlan) assert.deepEqual(message.contents.footer.contents.map((node: any) => node.action.label), [language === 'th' ? 'ดูแพ็กเกจ' : 'View packages']);
    }
  });

});

// Owner 2026-09-30 (advisor spec §2.2): a public policy question gets the staff door, never the
// public package page — not as a button, not as a line in the text a Flex downgrade would send.
// The door is the company's official staff LINE ("เปลี่ยนเป็นลิ้งไปหาไลน์ official ของบริษัท").
describe('public policy card', () => {
  it('ends with the staff door and carries no package link anywhere', () => {
    for (const question of ['ยกเลิกแพ็กเกจได้เงินคืนไหม', 'หลังหมดโปรฟรีแล้วเป็นยังไงต่อ', 'แพ็กเกจรายปีเติมสิทธิ์ทุกเดือนไหม']) {
      const message = buildPublicPolicyCardMessage(resolvePublicPolicyAnswer(question)!) as any;
      assert.deepEqual(message.contents.footer.contents.map((button: any) => button.action), [
        { type: 'uri', label: 'ติดต่อเจ้าหน้าที่', uri: STAFF_OA_URL },
      ], question);
      assert.equal(message.quickReply, undefined, 'the button is the one staff door; no quick reply repeats it');
      assert.match(message.canonicalText, /มีคำถามเพิ่มเติม กดติดต่อเจ้าหน้าที่ได้เลยค่ะ$/, question);
      assert.doesNotMatch(message.canonicalText, /https?:\/\//, question);
      assert.doesNotMatch(JSON.stringify(message), /(?:official\.)?mangmeeplus\.com\/"|ดูรายละเอียดแพ็กเกจ|"label":"ดูแพ็กเกจ"/, question);
    }
  });

  it('opens the same staff LINE as the contact card', () => {
    const contact = (buildContactCard() as any).contents.footer.contents.map((button: any) => button.action);
    assert.ok(contact.some((action: any) => action.type === 'uri' && action.label === 'ติดต่อทีมงาน' && action.uri === STAFF_OA_URL));
    assert.equal(STAFF_OA_URL, 'https://lin.ee/6Sc38L6');
  });
});

// Production 2026-10-01: a bound private chat sends every reply through the v2 delivery plan, and the
// plan refuses a Flex message with no canonicalText (LINE_PLAN_CANONICAL_TEXT_REQUIRED). The quota card
// had none. Every builder exported here must now either carry its text or be named below with the
// reason it never meets a delivery plan — a new builder fails this test until someone decides which.
describe('delivery plan guard: every card carries its text, or says why it never needs one', () => {
  const WEB = 'https://app.example.com';
  const DRAFT_FACTS: LineExpenseDraftCardFacts = { expenseId: 'e1', subject: 'ร่างค่าใช้จ่าย', rows: [{ label: 'ยอดรวม', value: '100.00 บาท', total: true }], notes: [] };
  const carriesText: Record<string, () => LineReplyMessage[]> = {
    buildWorkflowExitMessage: () => [cardBuilders.buildWorkflowExitMessage('เปิดในเว็บเพื่อทำต่อค่ะ', '/companies/c1/expenses', 'c1', WEB)],
    buildExpenseWorkflowPicker: () => [
      buildExpenseWorkflowPicker({ targets: [], total: 0, exhaustive: true }, 'expense_pay', 'secret', 'c1', 'u1', WEB),
      buildExpenseWorkflowPicker({ targets: [{ id: 'e1', label: 'ร้านทดสอบ', amount: '250', currency: 'THB' }], total: 1, exhaustive: true }, 'expense_pay', 'secret', 'c1', 'u1', WEB),
    ],
    buildClaimWorkflowPicker: () => [
      buildClaimWorkflowPicker({ targets: [], total: 0, exhaustive: true }, 'reimbursement_submit', 'secret', 'c1', 'u1', WEB),
      buildClaimWorkflowPicker({ targets: [{ id: 'claim-1', requestNo: 'RB-0001', amount: '250', currency: 'THB' } as any], total: 1, exhaustive: true }, 'reimbursement_submit', 'secret', 'c1', 'u1', WEB),
    ],
    buildPublicPolicyCardMessage: () => [buildPublicPolicyCardMessage({ topic: 'trial', title: 'หัวข้อ', text: 'คำตอบ' })],
    buildLineAssistantTextCardMessage: () => [buildLineAssistantTextCardMessage('คำตอบ', WEB, 'c1')],
    buildExpenseDraftCardMessage: () => [buildExpenseDraftCardMessage('ร่างค่าใช้จ่าย', DRAFT_FACTS, WEB, 'c1'), buildExpenseDraftCardMessage('ร่างค่าใช้จ่าย', DRAFT_FACTS, undefined, 'c1')],
    buildExpenseDraftReviewCard: () => [buildExpenseDraftReviewCard('ร่างค่าใช้จ่าย', DRAFT_FACTS, WEB, 'c1')!],
    buildKeptReceiptCard: () => [buildKeptReceiptCard('รูปนี้ตรงกับบิลที่เก็บไว้แล้วค่ะ', { expenseId: 'e1', progress: receiptProgress('DRAFT') }, WEB, 'c1')!],
    buildLineSystemTextCardMessage: () => [buildLineSystemTextCardMessage({ text: 'คำตอบ', header: { lines: ['แก้ไขค่าใช้จ่าย', 'ยกเลิกแล้ว'] }, webBaseUrl: WEB, companyId: 'c1' })!],
    buildDesignedLineAnswerMessage: () => [
      buildDesignedLineAnswerMessage(response(), 'fallback', WEB, 'c1', 'ทำอะไรได้บ้าง')!,
      buildDesignedLineAnswerMessage(response([{ text: 'คำตอบ' }]), 'fallback', WEB, 'c1', 'ทำอะไรได้บ้าง')!,
    ],
    buildReimbursementPayerClarificationMessage: () => [buildReimbursementPayerClarificationMessage()],
    buildReimbursementHandoffMessage: () => [buildReimbursementHandoffMessage(WEB, 'c1'), buildReimbursementHandoffMessage(undefined, 'c1')],
    buildAiBudgetExceededMessage: () => [true, false].flatMap((canManagePlan) => [true, false].flatMap((trialTier) =>
      BUDGET_REFUSALS.map((refusal) => buildAiBudgetExceededMessage(trialTier, refusal, canManagePlan)))),
    buildPackageRequiredMessage: () => [buildPackageRequiredMessage({ lockReason: 'no_package', companyId: 'c1' })],
    buildReceiptQuotaExceededMessage: () => [true, false].map((canManagePlan) => buildReceiptQuotaExceededMessage('ตอนนี้ครบแล้วค่ะ', canManagePlan)),
    buildLineBusinessAnswerMessage: () => [
      buildLineBusinessAnswerMessage(response(), 'fallback', WEB, 'c1'),
      buildLineBusinessAnswerMessage(response([{ text: 'คำตอบ' }]), 'fallback', WEB, 'c1'),
    ],
  };
  /** Traced callers (process-line-webhook.use-case.ts unless named). None of these is sent on a bound chat. */
  const neverPlanned: Record<string, string> = {
    buildLegalAcceptanceRequiredMessage: 'refusePendingLegalAcceptance runs before bindConversation in both lanes; the message buffer sends it through the reply adapter',
    buildSignupDoorCard: 'entryDoorMessages answers a LINE user with no account, who has no company or membership to bind',
    buildSignupStatusCard: 'entryDoorMessages answers a LINE user with no account, who has no company or membership to bind',
    buildProfileGuardNudgeCard: 'pushed by the signup outbox (line-signup-notify.service.ts) exactly as built — see the last assertion',
  };

  it('covers every exported builder exactly once', () => {
    const exported = Object.entries(cardBuilders)
      .filter(([name, value]) => typeof value === 'function' && name.startsWith('build')).map(([name]) => name).sort();
    assert.deepEqual([...Object.keys(carriesText), ...Object.keys(neverPlanned)].sort(), exported);
    for (const [name, sample] of Object.entries(carriesText)) {
      for (const message of sample()) {
        assert.ok(message.type === 'text' ? message.text.length > 0 : message.type === 'flex' && !!message.canonicalText, name);
      }
    }
    // `pushLineMessages` posts the object as written; only the reply adapter and a frozen plan strip
    // the internal field. This card must stay without one for as long as the outbox is its sender.
    assert.equal('canonicalText' in cardBuilders.buildProfileGuardNudgeCard(), false);
  });
});

it('Fix-up 22B: quick choices preserve API-built web links alongside message buttons', () => {
  const choices = cardBuilders.lineChoiceQuickReply([
    { label: 'เปิดตรวจรายการ', text: 'เปิดตรวจรายการ', uri: 'https://app.example.com/companies/company/expenses/expense?openExternalBrowser=1' },
    { label: 'บริษัท ป้ายสวย จำกัด', text: 'บริษัท ป้ายสวย จำกัด' },
  ]);
  assert.deepEqual(choices.items.map(item => item.action.type), ['uri', 'message']);
  assert.equal((choices.items[0]!.action as any).uri, 'https://app.example.com/companies/company/expenses/expense?openExternalBrowser=1');
});


it('U3 capability buttons name each permitted job within LINE limits and recheck current actor access', async () => {
  const { productHelpQuickReply } = await import('./line-business-card.logic');
  const { LINE_CHAT_ACTIONS } = await import('@watchdog-bms/contracts');
  const { ROLE_GRANTS } = await import('../../../auth/permission-registry');
  for (const language of ['th', 'en'] as const) {
    const reply: any = { refused: false, replyText: 'เลือกงานที่ทำได้ค่ะ', presentation: { kind: 'answer_cards', cards: [{ text: 'เลือกงานที่ทำได้ค่ะ', chatActionIds: LINE_CHAT_ACTIONS.map(action => action.id) }] } };
    const all = productHelpQuickReply(reply, ROLE_GRANTS.OWNER!, null, language);
    assert.ok(all?.items.length);
    for (const item of all.items) { assert.ok(Array.from(item.action.label).length <= 20, item.action.label); assert.doesNotMatch(item.action.label, /—|STARTER|ENTERPRISE/); }
    reply.presentation.cards[0].chatActionIds = ['expense_search', 'wht_certificate'];
    const narrowed = productHelpQuickReply(reply, ['expense.read'], new Set(['expenses']), language);
    assert.equal(narrowed?.items.length, 1);
    assert.equal(narrowed.items[0]!.action.label, language === 'en' ? 'Find expenses' : 'ค้นหาค่าใช้จ่าย');
    assert.equal(productHelpQuickReply(reply, [], new Set(), language), undefined);
  }
});


it('U5 current package usage uses customer names in the requested language for every paid tier', async () => {
  const { BillingGetPackageUsageTool } = await import('../../application/use-cases/erp-package-tools.use-case');
  const { BILLING_PAID_TIERS } = await import('@watchdog-bms/contracts');
  const english = ['Starter', 'Basic', 'Pro', 'Enterprise'];
  for (const [index, tierKey] of BILLING_PAID_TIERS.entries()) {
    const prisma: any = { client: { companyPlanTerm: { findUnique: async () => ({ tierKey, branchLimit: 5, employeeLimit: 10,
      capacityOverride: null, billingReceiptAccountId: null, termEndsAt: new Date('2027-01-01'), termDisabledAt: null }) },
      branch: { count: async () => 0 }, companyMembership: { count: async () => 0 }, billingReceiptGrant: { findMany: async () => [] } } };
    const billing: any = { usage: async () => ({ used: 0, limit: 100, remaining: 100, cadence: 'PAID_GRANTS', resetsAt: null, expiresAt: null }) };
    const data = (await new BillingGetPackageUsageTool(prisma, billing).execute({ companyId: 'company', userId: 'user',
      permissions: ['company.plan.manage'], locale: 'en-GB' } as any)).data as any;
    assert.equal(data.package.label, english[index]); assert.doesNotMatch(data.package.label, /—|\b(?:STARTER|BASIC|PRO|ENTERPRISE)\b/);
  }
});


it('expense confirmation and result keep signed actions on locked rows in Thai and English', async () => {
  const { buildExpenseActionCard } = await import('./line-expense-action-card.logic');
  const sample: any = { token: 'preview.' + 'a'.repeat(43), previewId: 'preview', action: 'CONFIRM', summary: 'ตรวจค่าใช้จ่ายก่อนยืนยันค่ะ', expiresAt: '2026-10-19T12:30:00Z',
    record: { vendorName: 'Starbucks Coffee', amount: '170.0000', currency: 'THB', date: '2026-10-05', status: 'ร่าง', nextStatus: 'ยืนยันแล้ว' } };
  for (const language of ['th', 'en'] as const) for (const reply of [undefined, language === 'th' ? 'ยืนยันค่าใช้จ่ายแล้วค่ะ' : 'Expense confirmed.']) {
    const legacy = buildExpenseActionCard(sample, reply, language) as any;
    const message = buildExpenseActionCard(sample, reply, language, 'https://app.example.com');
    assert.equal(isLineSystemCard(message), true);
    const card = readLineSystemCard(message);
    assert.deepEqual(card.actions, (legacy.contents.footer?.contents ?? []).map((button: any) => button.action));
    assert.ok(card.rows.some(row => row[2] === (language === 'th' ? '170.00 บาท' : '170.00 THB')));
    assert.ok(card.rows.some(row => row[2] === 'Starbucks Coffee'));
    assert.deepEqual(lineFlexBodyProblems((message as any).contents), []);
    assert.equal(isCompleteLineBusinessAnswerPresentation(message), true);
  }
});

it('every ติดต่อเจ้าหน้าที่ / Contact team button on a card opens the Official OA chat, never a typed command or postback (owner 2026-10-24)', () => {
  const source = readFileSync(join(__dirname, 'line-business-card.logic.ts'), 'utf8');
  assert.doesNotMatch(source, /text: STAFF_CONTACT_COMMAND|action=staff-contact/);
  assert.match(source, /\{ label: STAFF_CONTACT_COMMAND, uri: STAFF_OA_URL \}/);
});

it('R22 sold single-action help uses chat-action and action-specific permission alternatives', async () => {
  const { productHelpQuickReply } = await import('./line-business-card.logic');
  for (const [id, permission] of [['reimbursement_claim', 'reimbursement.create'], ['expense_submit', 'expense.review'], ['expense_delete', 'expense.delete'], ['substitute_receipt', 'expense.review']]) {
    const response: any = { refused: false, replyText: 'เลือกงานค่ะ', presentation: { kind: 'answer_cards', cards: [{ text: 'เลือกงานค่ะ', chatActionId: id }] } };
    const action: any = productHelpQuickReply(response, [permission!], new Set(['expenses']))!.items[0]!.action;
    assert.equal(action.type, 'postback');
    assert.equal(action.data, `action=chat-action&id=${id}`);
    assert.equal(productHelpQuickReply(response, [], new Set(['expenses'])), undefined);
  }
});


it('R22 substitute navigation has the named English capability button', async () => {
  const { productHelpQuickReply } = await import('./line-business-card.logic');
  const response: any = { refused: false, presentation: { cards: [{ chatActionIds: ['substitute_receipt'] }] } };
  assert.equal(productHelpQuickReply(response, ['expense.review'], new Set(['expenses']), 'en')!.items[0]!.action.label, 'Substitute receipt');
});


it('R10 exhaustive approvals state the permitted count and currency total only', () => {
  const claims: any[] = [{ id: 'one', requestNo: 'RB-1', amount: '1000.25', currency: 'THB' }, { id: 'two', requestNo: 'RB-2', amount: '1065.75', currency: 'THB' }];
  const card = (targets: any[], exhaustive = true, total = targets.length) => buildClaimWorkflowPicker({ targets, total, exhaustive }, 'approvals', 'secret', 'company', 'user', 'https://app.example.com');
  assert.match(JSON.stringify(card(claims)), /มีใบเบิกรอคุณอนุมัติ 2 ใบ รวม 2,066.00 บาท เลือกใบที่จะอนุมัติได้เลยค่ะ/);
  assert.match(JSON.stringify(card(claims, false, 301)), /มีรายการมากเกินจะค้นในแชตค่ะ/);
  assert.doesNotMatch(JSON.stringify(card(claims, false, 301)), /รวม 2,066/);
  assert.match(JSON.stringify(card([])), /ไม่มีใบเบิกรอคุณอนุมัติค่ะ/);
  const mixed = card([claims[0], { ...claims[1], currency: 'USD' }]);
  assert.match(JSON.stringify(mixed), /มีใบเบิกรอคุณอนุมัติ 2 ใบ เลือกใบที่จะอนุมัติได้เลยค่ะ/);
  assert.doesNotMatch(JSON.stringify(mixed), /รวม /);
});

it('R10 approvals totals use the existing English label map', () => {
  const card = buildClaimWorkflowPicker({ targets: [{ id: 'one', requestNo: 'RB-1', amount: '1000', currency: 'THB' } as any, { id: 'two', requestNo: 'RB-2', amount: '1066', currency: 'THB' } as any], total: 2, exhaustive: true }, 'approvals', 'secret', 'company', 'user', 'https://app.example.com', {}, 'en');
  assert.match(JSON.stringify(card), /You have 2 claims awaiting your approval, totalling 2,066.00 THB. Choose a claim to approve./);
});

it('R11 claim rows name requester reason and amount without calling pending or approved claims drafts', () => {
  for (const status of ['DRAFT', 'PENDING_APPROVAL', 'APPROVED']) {
    const card = buildClaimWorkflowPicker({ targets: [{ id: 'claim', requestNo: null, status, requesterDisplayNameSnapshot: 'สมชาย', reason: 'ค่าเดินทาง รอบ 4', amount: '1200', currency: 'THB' } as any], total: 1, exhaustive: true }, 'approvals', 'secret', 'company', 'user', 'https://app.example.com');
    const label = readLineSystemCard(card as any).actions.find((a: any) => a.type === 'postback')!.label;
    assert.ok(label.length <= 40, label); assert.match(label, /สมชาย/); assert.match(label, /รอบ 4/); assert.match(label, /1,200.00/); assert.doesNotMatch(label, /ร่าง/);
  }
});

it('CARDS-R4 empty and incomplete workflow pickers retain a persistent web button and narrowing hint', () => {
  for (const workflow of ['expense_pay', 'wht_certificate', 'reimbursement_pay'] as const) for (const incomplete of [false, true]) {
    const result = { targets: [], total: incomplete ? 301 : 0, exhaustive: !incomplete };
    const card = workflow === 'reimbursement_pay' ? buildClaimWorkflowPicker(result, workflow, 'secret', 'company', 'user', 'https://app.example.com')
      : buildExpenseWorkflowPicker(result, workflow, 'secret', 'company', 'user', 'https://app.example.com');
    assert.equal(card.type, 'flex');
    assert.match(JSON.stringify((card as any).contents), /"type":"uri"/);
    if (incomplete) assert.match(JSON.stringify(card), /เลขที่|ยอด|ผู้เบิก/);
  }
});

it('R13 shortened claim picker labels retain their round and amount', () => {
  for (const language of ['th', 'en'] as const) {
    const card = buildClaimWorkflowPicker({ targets: [{ id: 'claim', requestNo: null, requesterDisplayNameSnapshot: 'สมชัย', reason: 'ค่าออฟฟิศและอุปกรณ์สำนักงานสำหรับทุกสาขา รอบ 3', amount: '1906', currency: 'THB' } as any], total: 1, exhaustive: true }, 'approvals', 'secret', 'company', 'user', 'https://app.example.com', {}, language);
    const label = readLineSystemCard(card as any).actions.find((a: any) => a.type === 'postback')!.label;
    assert.ok(Array.from(label).length <= 40, label); assert.match(label, /รอบ 3/); assert.match(label, /1,906.00/);
  }
});
