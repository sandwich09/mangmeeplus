import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TrimStringsPipe, deepTrimStrings } from './trim-strings.pipe';

describe('TrimStringsPipe', () => {
  it('trims nested strings in plain objects and arrays', () => {
    const input = {
      username: '  admin ',
      profile: { displayName: ' คุณนภา วงศ์ทอง ', tags: ['  a ', 'b'] },
      count: 3,
      flag: true,
      nothing: null,
    };
    assert.deepEqual(deepTrimStrings(input), {
      username: 'admin',
      profile: { displayName: 'คุณนภา วงศ์ทอง', tags: ['a', 'b'] },
      count: 3,
      flag: true,
      nothing: null,
    });
  });

  it('leaves non-plain objects (Date, Buffer) untouched', () => {
    const date = new Date(0);
    const buffer = Buffer.from('x');
    const result = deepTrimStrings({ date, buffer }) as { date: Date; buffer: Buffer };
    assert.equal(result.date, date);
    assert.equal(result.buffer, buffer);
  });

  it('only transforms body payloads', () => {
    const pipe = new TrimStringsPipe();
    assert.equal(pipe.transform(' q ', { type: 'query' } as never), ' q ');
    assert.equal(pipe.transform(' b ', { type: 'body' } as never), 'b');
  });
});
