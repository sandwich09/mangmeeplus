import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { employeeDateToIso, formatEmployeeDateInput } from './employee-date.logic';

describe('employee date of birth', () => {
  const today = new Date(2026, 6, 12);

  it('accepts a real Gregorian date and leap day', () => {
    assert.equal(employeeDateToIso('28/09/1998', today), '1998-09-28');
    assert.equal(employeeDateToIso('29/02/2000', today), '2000-02-29');
  });

  it('rejects invalid, future, and Buddhist-era years', () => {
    assert.equal(employeeDateToIso('31/02/1998', today), undefined);
    assert.equal(employeeDateToIso('13/07/2026', today), undefined);
    assert.equal(employeeDateToIso('28/09/2541', today), undefined);
  });

  it('formats manual numeric input as DD/MM/YYYY', () => {
    assert.equal(formatEmployeeDateInput('28091998'), '28/09/1998');
  });
});
