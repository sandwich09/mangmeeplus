import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SNAPSHOT_GENERATE_PERMISSION, canForceGenerateSnapshot } from './dashboard-home.logic';

describe('canForceGenerateSnapshot', () => {
  it('is true when the viewer holds the generate permission', () => {
    assert.equal(canForceGenerateSnapshot(['dashboard.read', SNAPSHOT_GENERATE_PERMISSION]), true);
  });

  it('is false for a dashboard.read-only viewer', () => {
    assert.equal(canForceGenerateSnapshot(['dashboard.read']), false);
  });

  it('is false for an empty permission list', () => {
    assert.equal(canForceGenerateSnapshot([]), false);
  });

  it('exposes the exact API permission key', () => {
    assert.equal(SNAPSHOT_GENERATE_PERMISSION, 'dashboard.snapshot.generate');
  });
});

describe('dashboard period labels', () => {
  it('labels the Monday-Sunday snapshot period as this week, not trailing seven days', () => {
    const source = readFileSync(new URL('./DashboardPages.tsx', import.meta.url), 'utf8');
    const tabs = source.slice(source.indexOf('const PERIOD_TABS'), source.indexOf('const PERIOD_LABEL_KEY'));
    assert.match(tabs, /kind: 'week', labelKey: 'dashboard\.period\.week'/);
    assert.doesNotMatch(tabs, /dashboard\.period\.last7/);
  });

  it('clears stale scope data and ignores outdated load and refresh results', () => {
    const source = readFileSync(new URL('./DashboardPages.tsx', import.meta.url), 'utf8');
    const requests = source.slice(source.indexOf('const load ='), source.indexOf('const availableWidgets'));
    assert.match(requests, /setLoading\(true\);\s*setRefreshing\(false\);\s*setSnapshot\(null\)/);
    assert.equal(requests.match(/const requestId = \+\+snapshotRequestRef\.current/g)?.length, 2);
    assert.equal(requests.match(/if \(requestId !== snapshotRequestRef\.current\) return;\s*setSnapshot\(data\)/g)?.length, 2);
    assert.equal(requests.match(/catch \(e\) \{\s*if \(requestId !== snapshotRequestRef\.current\) return;/g)?.length, 2);
    assert.match(requests, /return \(\) => \{ snapshotRequestRef\.current \+= 1; \}/);
  });
});
