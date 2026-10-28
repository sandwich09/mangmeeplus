import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { workspaceDictionary } from '../../common/i18n/workspace-dictionary';
import {
  capturePausedReasonKey,
  captureReadAgainAllowed,
  captureReadFailed,
  captureReadIsRunning,
  captureReadJobNotice,
  captureReadNotice,
  captureReadProgressParams,
  freeAllowanceNotice,
  type ExpenseReadStatusFile,
} from './expense-capture-status.logic';
import { todayCivilDate } from '@watchdog-bms/contracts';
import { bangkokMonthKey } from './expense-upload.logic';

const statusFile = (patch: Partial<ExpenseReadStatusFile>): ExpenseReadStatusFile => ({
  fileId: 'file-1', attachmentId: 'att-1', status: 'READING',
  pagesRead: 0, pageCount: null, pausedReason: null, lastErrorCode: null,
  ...patch,
});

describe('read status → what the user is told (§17.2/§17.6)', () => {
  it('shows free usage only after the server confirms all three current-month reads', () => {
    const allowance = {
      source: 'FREE_MONTHLY_3' as const, monthKey: bangkokMonthKey(todayCivilDate()), limit: 3,
      usedCount: 2, inFlightCount: 0, remainingCount: 1,
      resetAt: new Date(Date.now() + 86_400_000).toISOString(),
    };
    assert.equal(freeAllowanceNotice(allowance, 'th'), null);
    const reached = freeAllowanceNotice({ ...allowance, usedCount: 3, remainingCount: 0 }, 'th');
    assert.match(reached ?? '', /ครบ 3 จาก 3 ใบ/);
    assert.equal(freeAllowanceNotice({ ...allowance, usedCount: 3, monthKey: '2000-01' }, 'th'), null);
  });

  it('explains that one multi-document file must be split before a free read', () => {
    const notice = captureReadNotice(statusFile({ status: 'FAILED', lastErrorCode: 'FREE_MULTI_DOCUMENT_UNSUPPORTED' }));
    assert.equal(notice?.messageKey, 'expenses.free_multi_document_unsupported');
    assert.equal(notice?.tone, 'info');
  });

  it('says the file is saved while the reading is still running', () => {
    for (const status of ['QUEUED', 'PREPARING', 'READING'] as const) {
      const notice = captureReadNotice(statusFile({ status }));
      assert.equal(notice?.messageKey, 'expenses.capture.read_stored_reading', status);
      assert.equal(notice?.tone, 'info');
      assert.ok(captureReadIsRunning(status), `${status} still owes an answer`);
    }
  });

  it('counts pages only once the reader has opened the file', () => {
    assert.equal(captureReadProgressParams({ pagesRead: 0, pageCount: null }), null);
    assert.deepEqual(captureReadProgressParams({ pagesRead: 3, pageCount: 12 }), { read: '3', total: '12' });
    const notice = captureReadNotice(statusFile({ pagesRead: 3, pageCount: 12 }));
    assert.equal(notice?.messageKey, 'expenses.capture.read_progress');
    assert.deepEqual(notice?.params, { read: '3', total: '12' });
  });

  it('maps each ending to its §17.2 case, and only the failure is an error', () => {
    assert.deepEqual(
      (['FAILED', 'PARTIAL', 'PAUSED', 'DONE'] as const).map((status) => {
        const notice = captureReadNotice(statusFile({ status }));
        return [notice?.uxe, notice?.tone];
      }),
      [['UXE-10', 'error'], ['UXE-13', 'info'], ['UXE-14', 'info'], ['DONE', 'info']],
    );
    // A cancelled job belongs to a file that is no longer current: it has nothing to say.
    assert.equal(captureReadNotice(statusFile({ status: 'CANCELLED' })), null);
    assert.equal(captureReadNotice(null), null);
  });

  it('every paused reason has Thai words a shop owner can act on — no error codes', () => {
    for (const reason of ['ai_credit', 'page_limit', 'call_budget', 'time_budget'] as const) {
      const key = capturePausedReasonKey(reason);
      assert.ok(key, reason);
      const thai = workspaceDictionary.th[key!];
      assert.ok(thai.trim().length > 0, reason);
      assert.doesNotMatch(thai, /[a-z]{3,}_[a-z]{3,}/, `${reason} leaks its own code into the message`);
      assert.ok(workspaceDictionary.en[key!].trim().length > 0, `${reason} has no English`);
    }
    assert.equal(capturePausedReasonKey(null), null);
    // §17.2 UXE-12 wording: the money is "เครดิต", never "งบ"/"โควตา".
    assert.match(workspaceDictionary.th['expenses.capture.paused_ai_credit'], /เครดิต/);
  });

  it('says the file is saved in every terminal-failure message, and points at this page', () => {
    for (const key of ['expenses.capture.read_failed', 'expenses.capture.read_partial', 'expenses.capture.read_paused'] as const) {
      assert.match(workspaceDictionary.th[key], /เก็บไฟล์ไว้แล้ว/, key);
      assert.match(workspaceDictionary.th[key], /กรอกข้อมูล/, key);
      assert.doesNotMatch(workspaceDictionary.th[key], /อ่านเอกสารอีกครั้ง|อ่านใหม่/, `${key} must not offer a reread`);
    }
  });
});

describe('the reread CTA is an intent, never an error recovery (§17.6)', () => {
  it('is hidden for every terminal failure of the current file', () => {
    for (const status of ['FAILED', 'PARTIAL', 'PAUSED'] as const) {
      assert.equal(captureReadFailed(status), true, status);
      assert.equal(captureReadAgainAllowed({ canExtract: true, readStatus: status }), false, status);
    }
  });

  it('is hidden under an error notice, whatever the job says', () => {
    assert.equal(captureReadAgainAllowed({ canExtract: true, readStatus: 'DONE', noticeTone: 'error' }), false);
  });

  it('stays available for a deliberate reread when nothing has just failed', () => {
    assert.equal(captureReadAgainAllowed({ canExtract: true, readStatus: null, noticeTone: 'info' }), true);
    assert.equal(captureReadAgainAllowed({ canExtract: true, readStatus: 'DONE' }), true);
    // A cancelled job belongs to a replaced file; reading the CURRENT one is a new intent.
    assert.equal(captureReadAgainAllowed({ canExtract: true, readStatus: 'CANCELLED' }), true);
  });

  it('never appears without the authority to ask for a read', () => {
    assert.equal(captureReadAgainAllowed({ canExtract: false, readStatus: null }), false);
  });
});

describe('an extraction response that became a durable job (§3, W07-int)', () => {
  it('reads the QUEUED answer the PDF lane actually sends, field for field', () => {
    // Verbatim from `expense-extraction.use-case.ts` `queueCaptureRead`.
    const queued = { status: 'ok' as const, readJobId: 'job-1', readStatus: 'QUEUED' as const };
    assert.deepEqual(captureReadJobNotice(queued), { tone: 'info', messageKey: 'expenses.capture.read_stored_reading' });
  });

  it('answers a replay of the same file without claiming a read this response never did', () => {
    // The lane is idempotent on (expense, attachment, bytes), so pressing again returns the SAME
    // job — terminal, and with no `fields` of its own.
    assert.deepEqual(
      captureReadJobNotice({ readJobId: 'job-1', readStatus: 'DONE' }),
      { tone: 'info', messageKey: 'expenses.capture.read_done' },
    );
    assert.deepEqual(
      captureReadJobNotice({ readJobId: 'job-1', readStatus: 'FAILED' }),
      { tone: 'error', messageKey: 'expenses.capture.read_failed' },
    );
  });

  it('stays out of the way of the synchronous lane, which has no job at all', () => {
    assert.equal(captureReadJobNotice({ status: 'ok', fields: { vendorName: 'ร้าน' } } as never), null);
    assert.equal(captureReadJobNotice({ readStatus: 'DONE' }), null, 'a status with no job id is not this branch');
  });

  it('every sentence it can choose exists in both locales', () => {
    for (const key of ['expenses.capture.read_stored_reading', 'expenses.capture.read_done', 'expenses.capture.read_failed'] as const) {
      assert.ok(workspaceDictionary.th[key], key);
      assert.ok(workspaceDictionary.en[key], key);
    }
  });
});
