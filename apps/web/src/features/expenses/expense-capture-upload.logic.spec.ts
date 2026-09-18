import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { workspaceDictionary } from '../../common/i18n/workspace-dictionary';
import {
  allCaptureFilesStored,
  captureFileRejection,
  captureMegabytes,
  hasUnfinishedCapture,
  mergeCaptureManifest,
  readCaptureManifest,
  reconcileCaptureUpload,
  runCaptureUpload,
  writeCaptureManifest,
  type CaptureUploadApi,
  type CaptureUploadEntry,
} from './expense-capture-upload.logic';

const file = (name: string, size = 10) => new File([new Uint8Array(size)], name, { type: 'image/jpeg' });
const entry = (name: string, state: CaptureUploadEntry['state'] = 'PENDING', fileId: string | null = null): CaptureUploadEntry =>
  ({ fileId, name, size: 10, state });

/** A server that answers exactly what the test asks it to, and records what it was asked. */
function fakeApi(options: {
  addFile?: CaptureUploadApi['addFile'];
  putBytes?: CaptureUploadApi['putBytes'];
  completeFile?: CaptureUploadApi['completeFile'];
  readGroup?: CaptureUploadApi['readGroup'];
} = {}) {
  const calls: { added: string[]; put: string[]; completed: string[] } = { added: [], put: [], completed: [] };
  let revision = 1;
  const api: CaptureUploadApi = {
    addFile: options.addFile ?? (async (_groupId, body) => {
      calls.added.push(body.originalFileName);
      revision += 1;
      return {
        fileId: `file-${calls.added.length}`, attachmentId: `att-${calls.added.length}`, revision,
        uploadUrl: '/upload', uploadMethod: 'PUT', uploadHeaders: {},
      };
    }),
    putBytes: options.putBytes ?? (async (_intent, uploaded) => { calls.put.push(uploaded.name); }),
    completeFile: options.completeFile ?? (async (_groupId, fileId) => {
      calls.completed.push(fileId);
      revision += 1;
      return { revision, uploadState: 'STORED' };
    }),
    readGroup: options.readGroup ?? (async () => ({ revision, files: [] })),
  };
  return { api, calls };
}

const unknownResponse = Object.assign(new Error('boom'), { kind: 'network_error' });

describe('capture upload state machine', () => {
  it('stores every selected file in one group and leaves the revision the server last confirmed', async () => {
    const { api, calls } = fakeApi();
    const seen: CaptureUploadEntry[][] = [];

    const result = await runCaptureUpload({
      groupId: 'group-1', revision: 1, api, onChange: (files) => seen.push(files.map((row) => ({ ...row }))),
      entries: [{ entry: entry('a.jpg'), file: file('a.jpg') }, { entry: entry('b.jpg'), file: file('b.jpg') }],
    });

    assert.deepEqual(calls.added, ['a.jpg', 'b.jpg']);
    assert.deepEqual(calls.put, ['a.jpg', 'b.jpg']);
    assert.deepEqual(calls.completed, ['file-1', 'file-2']);
    assert.deepEqual(result.files.map((row) => row.state), ['STORED', 'STORED']);
    assert.equal(result.revision, 5, 'the caller keeps the fence the server answered with');
    assert.ok(allCaptureFilesStored(result.files));
    // Every transition is published before the next request, so the list is never a silent spinner.
    assert.deepEqual(seen.at(0)?.map((row) => row.state), ['UPLOADING', 'PENDING']);
  });

  it('a failure stops at its own file: the ones already stored are never sent again', async () => {
    let refusals = 1;
    const { api, calls } = fakeApi({
      completeFile: async (_groupId, fileId) => {
        if (fileId === 'file-1' && refusals-- > 0) throw Object.assign(new Error('nope'), { status: 409 });
        return { revision: 9, uploadState: 'STORED' };
      },
    });

    const first = await runCaptureUpload({
      groupId: 'group-1', revision: 1, api,
      entries: [{ entry: entry('a.jpg'), file: file('a.jpg') }, { entry: entry('b.jpg'), file: file('b.jpg') }],
    });
    assert.deepEqual(first.files.map((row) => row.state), ['FAILED', 'STORED']);
    assert.equal(first.files[0]?.fileId, 'file-1', 'the reserved slot is remembered for the retry');

    // "ส่งไฟล์นี้อีกครั้ง": the SAME fileId, so the group never grows a second slot for one file.
    const retry = await runCaptureUpload({
      groupId: 'group-1', revision: first.revision, api,
      entries: [{ entry: { ...first.files[0]!, state: 'PENDING' }, file: file('a.jpg') }],
    });
    assert.deepEqual(calls.added, ['a.jpg', 'b.jpg'], 'no new slot was reserved by the retry');
    assert.deepEqual(retry.files.map((row) => row.state), ['STORED']);
  });

  it('a lost response is UNKNOWN, not failed — nothing is resent until the group answers', async () => {
    const { api, calls } = fakeApi({ completeFile: async () => { throw unknownResponse; } });

    const result = await runCaptureUpload({
      groupId: 'group-1', revision: 1, api,
      entries: [{ entry: entry('a.jpg'), file: file('a.jpg') }],
    });

    assert.equal(result.files[0]?.state, 'UNKNOWN');
    assert.deepEqual(calls.put, ['a.jpg'], 'the bytes were sent exactly once');
  });

  it('ตรวจสอบสถานะ believes the group: an UNKNOWN file the server holds is stored', async () => {
    const { api } = fakeApi({
      readGroup: async () => ({ revision: 7, files: [{ fileId: 'file-1', uploadState: 'STORED' }] }),
    });

    const result = await reconcileCaptureUpload({
      groupId: 'group-1', api, files: [{ ...entry('a.jpg', 'UNKNOWN', 'file-1') }],
    });

    assert.equal(result.revision, 7);
    assert.deepEqual(result.files, [{ fileId: 'file-1', name: 'a.jpg', size: 10, state: 'STORED', needsReselect: false }]);
  });

  it('a file whose bytes never arrived asks to be picked again instead of being called saved', () => {
    const merged = mergeCaptureManifest(
      [entry('a.jpg', 'STORED', 'file-1'), entry('b.jpg', 'UPLOADING', 'file-2'), entry('c.jpg', 'PENDING')],
      [{ fileId: 'file-1', uploadState: 'STORED' }, { fileId: 'file-2', uploadState: 'PENDING_UPLOAD' }],
    );

    assert.deepEqual(merged.map((row) => [row.state, row.needsReselect ?? false]), [
      ['STORED', false],
      ['UPLOADING', true],
      ['PENDING', true],
    ]);
  });

  it('a file the tab never knew about (another tab, or LINE) still belongs to the group', () => {
    const merged = mergeCaptureManifest([], [
      { fileId: 'file-9', uploadState: 'STORED', originalFileName: 'from-line.pdf', byteSize: 2048 },
      { fileId: 'file-8', uploadState: 'DETACHED', originalFileName: 'cut.pdf', byteSize: 10 },
    ]);

    assert.deepEqual(merged, [{ fileId: 'file-9', name: 'from-line.pdf', size: 2048, state: 'STORED', needsReselect: false }]);
  });

  it('a rejected or detached file is a failure the user has to answer, not a saved file', () => {
    const merged = mergeCaptureManifest(
      [entry('a.jpg', 'STORED', 'file-1')],
      [{ fileId: 'file-1', uploadState: 'REJECTED' }],
    );
    assert.deepEqual(merged.map((row) => [row.state, row.needsReselect]), [['FAILED', true]]);
  });

  it('the manifest survives the tab and is scoped to its company', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
    };
    const manifest = { companyId: 'co-1', groupId: 'group-1', revision: 3, files: [entry('a.jpg', 'STORED', 'file-1')] };

    writeCaptureManifest(storage, manifest, 'co-1');
    assert.deepEqual(readCaptureManifest(storage, 'co-1'), manifest);
    assert.equal(readCaptureManifest(storage, 'co-2'), null, 'another company never reads this job');

    writeCaptureManifest(storage, null, 'co-1');
    assert.equal(readCaptureManifest(storage, 'co-1'), null);
  });

  it('survives storage being disabled, and refuses a manifest from another company', () => {
    const broken = {
      getItem: () => { throw new Error('disabled'); },
      setItem: () => { throw new Error('disabled'); },
      removeItem: () => { throw new Error('disabled'); },
    };
    assert.equal(readCaptureManifest(broken, 'co-1'), null);
    assert.doesNotThrow(() => writeCaptureManifest(broken, null, 'co-1'));
    assert.equal(readCaptureManifest(undefined, 'co-1'), null);
  });

  it('an unfinished group is a question, not something a new selection may discard (W07-int)', () => {
    const manifest = (files: CaptureUploadEntry[]) => ({ companyId: 'co-1', groupId: 'g-1', revision: 2, files });
    assert.equal(hasUnfinishedCapture(null), false, 'nothing stored, nothing to ask about');
    assert.equal(hasUnfinishedCapture(manifest([])), false);
    assert.equal(
      hasUnfinishedCapture(manifest([entry('a.jpg', 'STORED', 'file-1'), entry('b.jpg', 'FAILED', 'file-2')])),
      true,
      'bytes are on the server and only this manifest says which group they are in',
    );
    // A fully stored group never reaches storage (`settleCaptureUpload` clears it), but if it did
    // there is nothing left to continue.
    assert.equal(hasUnfinishedCapture(manifest([entry('a.jpg', 'STORED', 'file-1')])), false);
  });

  it('an empty selection is not "all stored"', () => {
    assert.equal(allCaptureFilesStored([]), false);
    assert.equal(allCaptureFilesStored([entry('a.jpg', 'STORED', 'file-1'), entry('b.jpg', 'FAILED', 'file-2')]), false);
  });
});

describe('capture size and type gate', () => {
  const capability = { maxBytes: 10_485_760, allowedMimeTypes: ['image/jpeg', 'image/png', 'application/pdf'] };

  it('takes the limit from the server capability, not from a number typed into the client', () => {
    assert.equal(captureFileRejection({ name: 'big.pdf', type: 'application/pdf', size: 10_485_761 }, capability), 'too_large');
    // The 4 MiB PDF ceiling is gone: a 9.8 MB PDF is read automatically now.
    assert.equal(captureFileRejection({ name: 'scan.pdf', type: 'application/pdf', size: 9_800_000 }, capability), null);
    assert.equal(captureFileRejection({ name: 'sheet.xlsx', type: 'application/vnd.ms-excel', size: 10 }, capability), 'unsupported');
    assert.equal(captureFileRejection({ name: 'photo.jpg', type: 'image/jpeg', size: 10 }, null), null);
  });

  it('prints megabytes the way the message does, to one decimal', () => {
    assert.equal(captureMegabytes(10_485_760), '10.0 MB');
    assert.equal(captureMegabytes(9_800_000), '9.3 MB');
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
    // `{size} MB … {limit} MB`, the sentence the panel builds — LINE says "ขนาด 10.0 MB … 10.0 MB".
    const sentence = workspaceDictionary.th['expenses.capture.upload_too_large']
      .replace('{size}', captureMegabytes(limit + 1))
      .replace('{limit}', captureMegabytes(limit));
    assert.match(sentence, /10\.0 MB/);
    assert.equal(sentence.includes('{size}') || sentence.includes('{limit}'), false);
  });

  it('uses the wave-2 credit wording when a read stops for money, as LINE does', () => {
    // `capturePausedReasonTh('ai_credit')` answers this exact sentence on the LINE side.
    assert.equal(workspaceDictionary.th['expenses.capture.paused_ai_credit'], 'เครดิตสำหรับการอ่านเอกสารไม่พอ');
  });
});
