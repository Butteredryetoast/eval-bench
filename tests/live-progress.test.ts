import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, unlink, symlink } from 'node:fs/promises';
import path from 'node:path';
import { readLiveProgress } from '../packages/core/live-progress';
import type { RunRecord } from '../packages/contracts';

test('实时进度仅返回当前尝试，拒绝伪造任务链接和符号链接', async () => {
  const previous = process.env.CASEBENCH_DATA_DIR;
  const dir = await mkdtemp('/private/tmp/casebench-live-'); process.env.CASEBENCH_DATA_DIR = dir;
  const runId = 'run_' + 'a'.repeat(32), resultId = 'result_' + 'b'.repeat(32), attemptId = 'attempt_' + 'c'.repeat(32);
  const run = { id: runId, results: [{ id: resultId, profileId: 'local', attempt: { id: attemptId } }] } as unknown as RunRecord;
  const folder = path.join(dir, 'runs', runId, resultId, attemptId), file = path.join(folder, 'live.json');
  const data = { threadId: '019a0000-1234-7123-8123-123456789abc', phase: 'running', model: 'reported-model', updatedAt: new Date().toISOString(), events: [], outputText: '实时正文' };
  try {
    assert.deepEqual(await readLiveProgress(run), []);
    await mkdir(folder, { recursive: true }); await writeFile(file, JSON.stringify(data));
    assert.equal((await readLiveProgress(run))[0].outputText, '实时正文');
    const retry = { ...run, results: [{ ...run.results[0], attempt: { ...run.results[0].attempt!, id: 'attempt_' + 'd'.repeat(32) } }] };
    assert.deepEqual(await readLiveProgress(retry), []);
    await writeFile(file, JSON.stringify({ ...data, threadId: 'javascript:alert(1)' }));
    assert.deepEqual(await readLiveProgress(run), []);
    await unlink(file); const source = path.join(dir, 'other.json'); await writeFile(source, JSON.stringify(data)); await symlink(source, file);
    assert.deepEqual(await readLiveProgress(run), []);
  } finally { if (previous === undefined) delete process.env.CASEBENCH_DATA_DIR; else process.env.CASEBENCH_DATA_DIR = previous; }
});
