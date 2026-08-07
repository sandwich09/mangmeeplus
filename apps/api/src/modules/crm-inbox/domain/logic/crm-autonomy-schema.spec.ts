import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CrmBookingSource, CrmMessageAuthorType } from '../../../../generated/prisma/enums';

describe('CRM autonomy schema mirror', () => {
  it('includes the generated Prisma enums needed for P2 autonomy contracts', () => {
    assert.equal(CrmMessageAuthorType.AI, 'AI');
    assert.equal(CrmBookingSource.STAFF, 'STAFF');
    assert.equal(CrmBookingSource.LINE, 'LINE');
  });
});
