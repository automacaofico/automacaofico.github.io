import test from 'node:test';
import assert from 'node:assert/strict';
import { DASHBOARDS } from '../src/schemas.js';
import { VersionService } from '../src/version-service.js';
import { FakeDrive, FakeGitHub, workbookBuffer } from './helpers.js';

function service({ current, drive }) {
  return new VersionService({ drive, github: new FakeGitHub(current), dashboard: DASHBOARDS.superestrutura, maxBytes: 10_000_000 });
}

test('bloqueia arquivo duplicado pelo SHA-256', async () => {
  const current = workbookBuffer();
  const drive = new FakeDrive();
  await assert.rejects(() => service({ current, drive }).update({ file: { name: 'super.xlsx' }, buffer: current, user: 'Teste' }), { code: 'DUPLICATE_FILE' });
});

test('restaura GitHub quando finalização falha', async () => {
  const current = workbookBuffer({ activityKm: 1000 });
  const drive = new FakeDrive({ failMove: true });
  const github = new FakeGitHub(current);
  const updater = new VersionService({ drive, github, dashboard: DASHBOARDS.superestrutura, maxBytes: 10_000_000 });
  await assert.rejects(() => updater.update({ file: { name: 'super.xlsx' }, buffer: workbookBuffer({ activityKm: 1200 }), user: 'Teste' }));
  assert.equal(github.updates.length, 2);
  assert.match(github.updates[1].message, /Rollback automático/);
});

test('publica normalmente mesmo com histórico anterior corrompido no Drive', async () => {
  const current = workbookBuffer({ activityKm: 1000 });
  const drive = new FakeDrive();
  const github = new FakeGitHub(current);
  const updater = new VersionService({ drive, github, dashboard: DASHBOARDS.superestrutura, maxBytes: 10_000_000 });

  await updater.update({ file: { name: 'super.xlsx' }, buffer: workbookBuffer({ activityKm: 1200 }), user: 'Teste' });
  const ctx = await updater.context();
  const currentVersion = ctx.index.versions.find((version) => version.id === ctx.index.currentVersion);
  drive.corruptIds.add(currentVersion.normalizedFileId);

  const second = await updater.update({ file: { name: 'super.xlsx' }, buffer: workbookBuffer({ activityKm: 1300 }), user: 'Teste' });
  assert.equal(second.ok, true);
  assert.equal(second.comparison.firstVersion, true);
  assert.equal(second.comparison.summary.added, 0);
});
