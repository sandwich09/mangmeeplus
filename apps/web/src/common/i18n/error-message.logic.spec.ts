import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatMessage, localizedErrorMessage } from './error-message.logic';
import { workspaceDictionary } from './workspace-dictionary';

describe('localizedErrorMessage', () => {
  it('keeps draft-removal state errors specific in Thai and English', () => {
    const conflictCodes = {
      employee_draft_not_found: 'employee.error.draft_not_found',
      employee_draft_not_deletable: 'employee.error.draft_not_deletable',
    } as const;
    for (const locale of ['th', 'en'] as const) {
      assert.equal(localizedErrorMessage({ status: 404, code: 'employee_draft_not_found' }, locale, { conflictCodes }),
        workspaceDictionary[locale]['employee.error.draft_not_found']);
      assert.equal(localizedErrorMessage({ status: 409, code: 'employee_draft_not_deletable' }, locale, { conflictCodes }),
        workspaceDictionary[locale]['employee.error.draft_not_deletable']);
    }
  });

  it('uses a stable company-access code before the generic 403 override', () => {
    assert.equal(
      localizedErrorMessage(
        { statusCode: 403, code: 'company_access_unavailable' },
        'en',
        {
          403: 'auth.login.error.temp_expired',
          conflictCodes: { company_access_unavailable: 'auth.login.error.company_access_unavailable' },
        },
      ),
      'The company is inactive or your access was removed. Contact your administrator.',
    );
  });
  it('maps HTTP status to the locale catalog', () => {
    assert.equal(
      localizedErrorMessage({ status: 429 }, 'th'),
      workspaceDictionary.th['error.rate_limited'],
    );
    assert.equal(
      localizedErrorMessage({ statusCode: 403 }, 'en'),
      workspaceDictionary.en['error.forbidden'],
    );
  });

  it('honours per-screen overrides (401 on login = wrong password)', () => {
    assert.equal(
      localizedErrorMessage({ status: 401 }, 'th', { 401: 'auth.login.error.invalid' }),
      workspaceDictionary.th['auth.login.error.invalid'],
    );
    assert.equal(
      localizedErrorMessage({ status: 401 }, 'en'),
      workspaceDictionary.en['error.session_expired'],
    );
  });

  it('maps a stable conflict code to a field-specific message, unknown codes fall back', () => {
    const overrides = { conflictCodes: { employee_identity_conflict: 'employee.error.identity_conflict' } } as const;
    assert.equal(
      localizedErrorMessage({ status: 409, code: 'employee_identity_conflict' }, 'th', overrides),
      workspaceDictionary.th['employee.error.identity_conflict'],
    );
    assert.equal(
      localizedErrorMessage({ status: 409, code: 'something_else' }, 'en', overrides),
      workspaceDictionary.en['error.conflict'],
    );
  });

  it('detects network failures and uses the fallback otherwise', () => {
    assert.equal(localizedErrorMessage(new TypeError('fetch failed'), 'en'), workspaceDictionary.en['error.network']);
    assert.equal(
      localizedErrorMessage(new Error('mystery'), 'th', { fallback: 'error.save_failed' }),
      workspaceDictionary.th['error.save_failed'],
    );
  });
});

describe('formatMessage', () => {
  it('substitutes placeholders and leaves unknown ones intact', () => {
    assert.equal(formatMessage('รอ {seconds} วินาที ({x})', { seconds: 30 }), 'รอ 30 วินาที ({x})');
  });
});
