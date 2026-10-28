import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { workspaceDictionary } from '../../common/i18n/workspace-dictionary';
import {
  appendReceiptFiles,
  captureFileRejection,
  captureMegabytes,
  entryForFile,
  runSingleFileUploads,
  type CaptureUploadEntry,
} from './expense-capture-upload.logic';

const file = (name: string, size = 10) => new File([new Uint8Array(size)], name, { type: 'image/jpeg' });

describe('multi-file upload = N ordinary single uploads (owner decision 2026-09-19)', () => {
  it('sends one file at a time and creates one expense per file', async () => {
    const order: string[] = [];
    let inFlight = 0;
    const seen: CaptureUploadEntry[][] = [];
    const files = [file('a.jpg'), file('b.jpg'), file('c.pdf')];

    const result = await runSingleFileUploads({
      entries: files.map((picked) => ({ entry: entryForFile(picked), file: picked })),
      onChange: (entries) => seen.push(entries.map((row) => ({ ...row }))),
      upload: async (picked) => {
        inFlight += 1;
        assert.equal(inFlight, 1, 'never two reads in flight: N files must cost what N uploads cost');
        order.push(picked.name);
        await Promise.resolve();
        inFlight -= 1;
        return { expenseId: `exp-${order.length}` };
      },
    });

    assert.deepEqual(order, ['a.jpg', 'b.jpg', 'c.pdf']);
    assert.deepEqual(result.created.map((row) => row.expenseId), ['exp-1', 'exp-2', 'exp-3']);
    assert.deepEqual(result.entries.map((row) => row.state), ['STORED', 'STORED', 'STORED']);
    assert.deepEqual(result.entries.map((row) => row.expenseId), ['exp-1', 'exp-2', 'exp-3']);
    // Every transition is published before the next request, so the list is never a silent spinner.
    assert.deepEqual(seen.at(0)?.map((row) => row.state), ['UPLOADING', 'PENDING', 'PENDING']);
  });

  it('a failing file does not stop the ones behind it, and only it is sent again', async () => {
    let refusals = 1;
    const sent: string[] = [];
    const upload = async (picked: File) => {
      sent.push(picked.name);
      if (picked.name === 'a.jpg' && refusals-- > 0) throw Object.assign(new Error('nope'), { status: 409 });
      return { expenseId: `exp-${picked.name}` };
    };

    const first = await runSingleFileUploads({
      entries: [file('a.jpg'), file('b.jpg')].map((picked) => ({ entry: entryForFile(picked), file: picked })),
      upload,
    });
    assert.deepEqual(first.entries.map((row) => row.state), ['FAILED', 'STORED']);
    assert.deepEqual(first.created.map((row) => row.expenseId), ['exp-b.jpg'], 'the failure created nothing');

    // "ส่งไฟล์นี้อีกครั้ง": the same call over the same rows resends only the row with no expense.
    const retry = await runSingleFileUploads({
      entries: [
        { entry: first.entries[0]!, file: file('a.jpg') },
        { entry: first.entries[1]!, file: file('b.jpg') },
      ],
      upload,
    });
    assert.deepEqual(retry.entries.map((row) => row.state), ['STORED', 'STORED']);
    assert.deepEqual(sent, ['a.jpg', 'b.jpg', 'a.jpg'], 'the stored file was never uploaded twice');
    assert.deepEqual(retry.created.map((row) => row.expenseId), ['exp-a.jpg']);
  });

  it('stops remaining files after the server refuses a free-document quota admission', async () => {
    let stop = false;
    const sent: string[] = [];
    const files = ['one.jpg', 'two.jpg', 'three.jpg', 'four.jpg', 'five.jpg'].map(file);
    const result = await runSingleFileUploads({
      entries: files.map((picked) => ({ entry: entryForFile(picked), file: picked })),
      shouldStop: () => stop,
      upload: async (picked) => {
        sent.push(picked.name);
        if (picked.name === 'four.jpg') {
          stop = true;
          throw Object.assign(new Error('limit'), { code: 'FREE_DOCUMENT_LIMIT_REACHED' });
        }
        return { expenseId: `exp-${picked.name}` };
      },
    });
    assert.deepEqual(sent, ['one.jpg', 'two.jpg', 'three.jpg', 'four.jpg']);
    assert.deepEqual(result.entries.map((entry) => entry.state), ['STORED', 'STORED', 'STORED', 'FAILED', 'PENDING']);
  });

  it('a row whose bytes this tab no longer holds is a failure to answer, not a saved file', async () => {
    const result = await runSingleFileUploads({
      entries: [{ entry: entryForFile({ name: 'gone.jpg', size: 10 }), file: null }],
      upload: async () => { throw new Error('never called'); },
    });
    assert.deepEqual(result.entries.map((row) => row.state), ['FAILED']);
    assert.deepEqual(result.created, []);
  });
});

describe('capture size and type gate', () => {
  const capability = { maxBytes: 10_485_760, allowedMimeTypes: ['image/jpeg', 'image/png', 'application/pdf'] };

  it('takes the limit from the server capability, not from a number typed into the client', () => {
    assert.equal(captureFileRejection({ name: 'big.pdf', type: 'application/pdf', size: 10_485_761 }, capability), 'too_large');
    // The 4 MiB PDF ceiling is gone: a 9.8 เมกะไบต์ PDF is read automatically now.
    assert.equal(captureFileRejection({ name: 'scan.pdf', type: 'application/pdf', size: 9_800_000 }, capability), null);
    assert.equal(captureFileRejection({ name: 'sheet.xlsx', type: 'application/vnd.ms-excel', size: 10 }, capability), 'unsupported');
    assert.equal(captureFileRejection({ name: 'photo.jpg', type: 'image/jpeg', size: 10 }, null), null);
  });

  it('prints megabytes the way the message does, to one decimal', () => {
    assert.equal(captureMegabytes(10_485_760), '10.0 เมกะไบต์');
    assert.equal(captureMegabytes(9_800_000), '9.3 เมกะไบต์');
  });

  /**
   * Plan W02 "PDF limits/capability/error messages ตรงกันทั้งสามทาง": web NEW upload, web REPLACE
   * and LINE file share one limit, one boundary and one pair of numbers in the sentence. The API
   * half of this claim is `apps/api/src/modules/expenses/expense-capture-lane-parity.spec.ts`,
   * which asserts the SAME two strings for the LINE reply.
   */
  it('is the same boundary and the same two numbers the other two lanes print', () => {
    const limit = 10_485_760;
    for (const [name, type] of [['bill.pdf', 'application/pdf'], ['bill.jpg', 'image/jpeg']] as const) {
      assert.equal(captureFileRejection({ name, type, size: limit }, { maxBytes: limit, allowedMimeTypes: [type] }), null);
      assert.equal(captureFileRejection({ name, type, size: limit + 1 }, { maxBytes: limit, allowedMimeTypes: [type] }), 'too_large');
    }
    // `{size} เมกะไบต์ … {limit} เมกะไบต์`, the sentence the panel builds — LINE says "ขนาด 10.0 เมกะไบต์ … 10.0 เมกะไบต์".
    const sentence = workspaceDictionary.th['expenses.capture.upload_too_large']
      .replace('{size}', captureMegabytes(limit + 1))
      .replace('{limit}', captureMegabytes(limit));
    assert.match(sentence, /10\.0 เมกะไบต์/);
    assert.equal(sentence.includes('{size}') || sentence.includes('{limit}'), false);
  });

  it('uses the wave-2 credit wording when a read stops for money, as LINE does', () => {
    // `capturePausedReasonTh('ai_credit')` answers this exact sentence on the LINE side.
    assert.equal(workspaceDictionary.th['expenses.capture.paused_ai_credit'], 'เครดิตสำหรับการอ่านเอกสารไม่พอ');
  });
});

it('appends receipts and deduplicates only the same name, size and lastModified', () => {
  const a = new File(['a'], 'a.jpg', { lastModified: 10 });
  const same = new File(['a'], 'a.jpg', { lastModified: 10 });
  const newer = new File(['a'], 'a.jpg', { lastModified: 11 });
  const larger = new File(['ab'], 'a.jpg', { lastModified: 10 });
  assert.deepEqual(appendReceiptFiles([a], [same, newer, larger]), [a, newer, larger]);
});
it('a row retry sends only that failed file and keeps the other failure and stored receipt', async () => {
  const files = [file('a.jpg'), file('b.jpg'), file('c.jpg')];
  const entries: CaptureUploadEntry[] = files.map(entryForFile);
  entries[0]!.state = entries[1]!.state = 'FAILED';
  entries[2] = { ...entries[2]!, state: 'STORED', expenseId: 'saved' };
  const sent: string[] = [];
  const result = await runSingleFileUploads({ entries: entries.map((entry, i) => ({ entry, file: files[i]! })), retryIndex: 1,
    upload: async f => { sent.push(f.name); return { expenseId: 'retry' }; } });
  assert.deepEqual(sent, ['b.jpg']);
  assert.deepEqual(result.entries.map(e => e.state), ['FAILED', 'STORED', 'STORED']);
});
