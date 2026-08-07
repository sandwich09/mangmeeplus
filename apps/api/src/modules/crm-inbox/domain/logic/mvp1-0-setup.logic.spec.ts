import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateMvp10Setup,
  isPdpaNoticeComplete,
  missingPdpaElements,
  PILOT_PDPA_NOTICE_TEXT,
  type Mvp10SetupState,
} from './mvp1-0-setup.logic';
import { CRM_INBOX_ENTITLEMENT_KEY, PDPA_CONSENT_NOTICE_TEXT } from '../crm-inbox.constants';

function baseState(overrides: Partial<Mvp10SetupState> = {}): Mvp10SetupState {
  return {
    companyId: 'c1',
    company: { name: 'ร้านพี่บอม', status: 'ACTIVE' },
    entitledFeatureKeys: new Set([CRM_INBOX_ENTITLEMENT_KEY]),
    crmEntitlementDisabled: false,
    channels: [{ status: 'ACTIVE' }],
    pdpaNoticeText: PDPA_CONSENT_NOTICE_TEXT,
    ...overrides,
  };
}

function check(report: ReturnType<typeof evaluateMvp10Setup>, key: string) {
  const c = report.checks.find((x) => x.key === key);
  assert.ok(c, `expected a check with key ${key}`);
  return c!;
}

describe('PDPA notice completeness', () => {
  it('the shipped pilot notice carries all five required elements', () => {
    assert.deepEqual(missingPdpaElements(PILOT_PDPA_NOTICE_TEXT), []);
    assert.equal(isPdpaNoticeComplete(PILOT_PDPA_NOTICE_TEXT), true);
  });

  it('flags every missing element and is null-safe', () => {
    assert.deepEqual(missingPdpaElements(''), ['data_controller', 'purpose', 'retention', 'rights', 'contact']);
    // @ts-expect-error null tolerated at runtime
    assert.equal(isPdpaNoticeComplete(null), false);
    assert.deepEqual(
      missingPdpaElements('ผู้ควบคุมข้อมูล วัตถุประสงค์ ระยะเวลาเก็บ สิทธิ'),
      ['contact'],
    );
  });
});

describe('evaluateMvp10Setup', () => {
  it('a fully configured pilot tenant is ready with all PASS', () => {
    const report = evaluateMvp10Setup(baseState());
    assert.equal(report.ready, true);
    assert.ok(report.checks.every((c) => c.status === 'PASS'));
  });

  it('missing company row fails', () => {
    const report = evaluateMvp10Setup(baseState({ company: null }));
    assert.equal(report.ready, false);
    assert.equal(check(report, 'company').status, 'FAIL');
  });

  it('non-active company fails', () => {
    const report = evaluateMvp10Setup(baseState({ company: { name: 'x', status: 'SUSPENDED' } }));
    assert.equal(check(report, 'company').status, 'FAIL');
  });

  it('no entitlement rows warns (fail-open) but stays ready', () => {
    const report = evaluateMvp10Setup(baseState({ entitledFeatureKeys: null }));
    assert.equal(check(report, 'entitlement').status, 'WARN');
    assert.equal(report.ready, true);
  });

  it('entitlement rows present without crm fails (permissions stripped)', () => {
    const report = evaluateMvp10Setup(baseState({ entitledFeatureKeys: new Set(['reports']) }));
    assert.equal(check(report, 'entitlement').status, 'FAIL');
    assert.equal(report.ready, false);
  });

  it('crm entitlement disabled fails with a distinct reason', () => {
    const report = evaluateMvp10Setup(
      baseState({ entitledFeatureKeys: new Set(['reports']), crmEntitlementDisabled: true }),
    );
    const c = check(report, 'entitlement');
    assert.equal(c.status, 'FAIL');
    assert.match(c.message, /ถูกปิดไว้/);
  });

  it('no active LINE channel warns but does not block readiness', () => {
    const report = evaluateMvp10Setup(baseState({ channels: [{ status: 'DISABLED' }] }));
    assert.equal(check(report, 'line_channel').status, 'WARN');
    assert.equal(report.ready, true);
  });

  it('counts only non-disabled channels as active', () => {
    const report = evaluateMvp10Setup(baseState({ channels: [{ status: 'DISABLED' }, { status: 'ACTIVE' }, { status: 'CONNECTED' }] }));
    const c = check(report, 'line_channel');
    assert.equal(c.status, 'PASS');
    assert.match(c.message, /2 รายการ/);
  });

  it('incomplete PDPA notice fails', () => {
    const report = evaluateMvp10Setup(baseState({ pdpaNoticeText: 'สวัสดี' }));
    assert.equal(check(report, 'pdpa_notice').status, 'FAIL');
    assert.equal(report.ready, false);
  });
});
