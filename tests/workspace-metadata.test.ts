import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createStore } from '../packages/core/db';
import { seedStore } from '../packages/core/seed';
import { CasebenchService } from '../packages/core/service';

test('旧数据可升级，收藏、命名与置顶持久保存且不改动案例版本及运行快照', async () => {
  const dir = await mkdtemp('/private/tmp/casebench-metadata-');
  const old = await createStore(dir);
  let runId = '', snapshot = '';
  try {
    await seedStore(old);
    const service = new CasebenchService(old);
    const run = await service.createRun({ caseIds: ['sample-copy'], models: [{ profileId: 'demo-a' }], concurrency: 1, timeoutSeconds: 600, requestKey: randomUUID() });
    runId = run.id; snapshot = JSON.stringify(run.spec);
    // Simulate a saved database from before the additive metadata migration.
    await old.db.execute(sql`ALTER TABLE cases DROP COLUMN favorite`);
    await old.db.execute(sql`ALTER TABLE runs DROP COLUMN name`);
    await old.db.execute(sql`ALTER TABLE runs DROP COLUMN pinned`);
  } finally { await old.close(); }
  const upgraded = await createStore(dir);
  try {
    const s = new CasebenchService(upgraded);
    const entry = (await s.listCases()).find(c => c.id === 'sample-copy')!;
    assert.equal(entry.favorite, false);
    assert.equal((await s.getRun(runId)).pinned, false);
    const favorite = await s.updateCaseMetadata(entry.id, { favorite: true });
    assert.equal(favorite.version, entry.version);
    assert.equal(favorite.contentHash, entry.contentHash);
    await Promise.all([s.updateRunMetadata(runId, { name: '文案测试 · 首轮' }), s.updateRunMetadata(runId, { pinned: true })]);
    const updated = await s.getRun(runId);
    assert.equal(updated.name, '文案测试 · 首轮'); assert.equal(updated.pinned, true);
    assert.equal(JSON.stringify(updated.spec), snapshot);
    assert.equal((await s.listRuns()).length, 1);
    await assert.rejects(s.updateRunMetadata(runId, { name: '   ' }));
    await assert.rejects(s.updateRunMetadata(runId, { spec: {} }));
    await assert.rejects(s.updateCaseMetadata(entry.id, { favorite: 'yes' }));
  } finally { await upgraded.close(); }
  const reopened = await createStore(dir);
  try {
    const s = new CasebenchService(reopened);
    assert.equal((await s.listCases()).find(c => c.id === 'sample-copy')?.favorite, true);
    const run = await s.updateRunMetadata(runId, { pinned: false });
    assert.equal(run.pinned, false); assert.equal(run.name, '文案测试 · 首轮');
    assert.equal((await s.listRuns())[0].id, runId);
    assert.equal(JSON.stringify(run.spec), snapshot);
  } finally { await reopened.close(); }
});
