import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createStore } from '../packages/core/db';
import { seedStore } from '../packages/core/seed';
import { AppError, CasebenchService, newId } from '../packages/core/service';
import { compareMarkdown, csvCell, makeArchive } from '../packages/core/export';
import { DEMO_PROFILES, publicProfile } from '../packages/core/config';
import { collectOutputs, executeAdapter } from '../packages/adapters';
import { UNKNOWN_USAGE } from '../packages/contracts';

test('版本、运行、回传、判定与恢复遵守同一套记录规则', async () => {
  const dir = await mkdtemp('/private/tmp/casebench-test-');
  const store = await createStore(dir, ':memory:');
  const s = new CasebenchService(store);
  try {
    await seedStore(store); assert.equal((await s.listCases()).length, 8);
    assert.equal((await s.listRuns()).length, 0);
    const file = await s.putFile(Buffer.from('季度,销售\nQ1,100'), 'input.csv', 'text/csv', 'input');
    const original = await s.saveCase({ title: '带附件的文案', prompt: '根据附件写一段摘要', scene: 'writing', capabilities: ['follow'], artifactType: 'copy', executionMode: 'text', inputIds: [file.id], referenceId: null, instructions: '' });
    const body = { caseIds: [original.id, 'sample-landing'], models: [{ profileId: 'demo-a' }, { profileId: 'demo-b' }], concurrency: 2, timeoutSeconds: 600, requestKey: randomUUID() };
    const run = await s.createRun(body);
    assert.equal(run.results.length, 4); assert.equal(run.status, 'waiting_runner'); assert.equal(run.spec.timeoutSeconds, 600);
    assert.equal((await s.createRun(body)).id, run.id);
    await assert.rejects(s.createRun({ ...body, concurrency: 1 }), (e: unknown) => e instanceof AppError && e.status === 409);
    const changed = await s.saveCase({ title: '新版本', prompt: '这是新版本，历史不变', scene: 'writing', capabilities: ['follow'], artifactType: 'copy', executionMode: 'text', inputIds: [], referenceId: null, instructions: '', expectedVersion: 1 }, original.id);
    assert.equal(changed.version, 2);
    assert.equal((await s.getRun(run.id)).spec.cases[0].prompt, original.prompt);
    assert.equal((await s.getRun(run.id)).spec.cases[0].inputs[0].sha256, file.sha256);
    const device = await s.registerDevice('测试执行器');
    assert.equal(await s.authenticate(device.token), device.id);
    await assert.rejects(s.authenticate('invalid-token'), (e: unknown) => e instanceof AppError && e.status === 401);
    const claim = await s.claim(run.id, device.id);
    const other = await s.registerDevice('另一台电脑');
    await assert.rejects(s.claim(run.id, other.id), (e: unknown) => e instanceof AppError && e.status === 409);
    const r = run.results[0];
    const simultaneous = await Promise.allSettled([s.beginAttempt(run.id, r.id, device.id, claim.generation), s.beginAttempt(run.id, r.id, device.id, claim.generation)]);
    assert.equal(simultaneous.filter(x => x.status === 'fulfilled').length, 1);
    const started = (simultaneous.find(x => x.status === 'fulfilled') as PromiseFulfilledResult<{ attemptId: string }>).value;
    const fileId = newId('file'), output = Buffer.from('这是已经归档的真实文件内容');
    await s.uploadArtifact(run.id, started.attemptId, device.id, claim.generation, output, 'result.txt', 'text/plain', fileId);
    assert.equal((await s.getRun(run.id)).results.find(x => x.id === r.id)?.status, 'uploading');
    await s.uploadArtifact(run.id, started.attemptId, device.id, claim.generation, output, 'result.txt', 'text/plain', fileId);
    await assert.rejects(s.uploadArtifact(run.id, started.attemptId, device.id, claim.generation, Buffer.from('覆盖'), 'result.txt', 'text/plain', fileId), (e: unknown) => e instanceof AppError && e.status === 409);
    const completion = { status: 'succeeded', outputText: '一段可用的文案', error: null, durationMs: 123, usage: UNKNOWN_USAGE, reportedModel: null, logs: '已完成' };
    await s.completeAttempt(run.id, started.attemptId, device.id, claim.generation, completion);
    await s.completeAttempt(run.id, started.attemptId, device.id, claim.generation, completion);
    await assert.rejects(s.completeAttempt(run.id, started.attemptId, device.id, claim.generation, { ...completion, outputText: '覆盖正文' }), (e: unknown) => e instanceof AppError && e.status === 409);
    assert.equal((await s.getAttempt(started.attemptId)).result.attempt?.usage.cost, null);
    await s.annotate(started.attemptId, { verdict: 'usable', note: '可以直接取用', revision: 0 });
    await assert.rejects(s.annotate(started.attemptId, { verdict: 'unusable', note: '旧请求', revision: 0 }), (e: unknown) => e instanceof AppError && e.status === 409);
    const annotated = await s.getAttempt(started.attemptId);
    assert.equal(annotated.result.attempt?.annotation.note, '可以直接取用');
    assert.equal(annotated.result.attempt?.audit.length, 1);
    assert.equal((await s.searchResults('直接取用')).length, 1);
    await assert.rejects(s.fileBytes('../../passwd'), (e: unknown) => e instanceof AppError && e.status === 400);
    const retryResult = run.results[1];
    const first = await s.beginAttempt(run.id, retryResult.id, device.id, claim.generation);
    await s.completeAttempt(run.id, first.attemptId, device.id, claim.generation, { ...completion, status: 'failed', outputText: '', error: '第一次失败' });
    const second = await s.beginAttempt(run.id, retryResult.id, device.id, claim.generation, true);
    await s.completeAttempt(run.id, second.attemptId, device.id, claim.generation, completion);
    assert.equal((await s.getAttempt(first.attemptId)).result.attempt?.error, '第一次失败');
    assert.equal((await s.getAttempt(second.attemptId)).result.attempt?.annotation.verdict, null);
    const exported = await s.getRun(run.id);
    assert.match(compareMarkdown(exported), /演示运行/);
    assert.equal(csvCell('=1+1'), '"\'=1+1"');
    const stream = makeArchive(s, exported, 'http://127.0.0.1:43110');
    const chunks = []; for await (const chunk of stream) chunks.push(chunk);
    assert.equal(Buffer.concat(chunks).subarray(0, 2).toString(), 'PK');
    assert.equal((await s.fileBytes(fileId)).toString(), output.toString());
  } finally { await store.close(); }
});

test('演示与工具适配器实际落盘，且不会跟随输出符号链接', async () => {
  const dir = await mkdtemp('/private/tmp/casebench-adapter-');
  const store = await createStore(path.join(dir, 'store'), ':memory:');
  try {
    await seedStore(store); const s = new CasebenchService(store);
    const entry = (await s.listCases()).find(c => c.id === 'sample-landing')!;
    const output = path.join(dir, 'out'); await mkdir(output);
    const profile = DEMO_PROFILES[0];
    const task = { case: entry, model: publicProfile(profile), profile, directory: dir, outputDirectory: output, inputPaths: [], signal: AbortSignal.timeout(10000) };
    await executeAdapter(task);
    assert.match(await readFile(path.join(output, 'index.html'), 'utf8'), /本地流程演示/);
    const files = await collectOutputs(output); assert.equal(files.length, 1); assert.equal(files[0].mime, 'text/html');
    const cmdOut = path.join(dir, 'command-out'); await mkdir(cmdOut);
    const commandProfile = { ...profile, id: 'test-command', adapter: 'command' as const, program: process.execPath, args: ['--eval', 'require("node:fs").writeFileSync(require("node:path").join(process.env.CASEBENCH_OUTPUT_DIR,"actual.txt"), "工具实际生成的文件"); console.log("完成")'] };
    await executeAdapter({ ...task, profile: commandProfile, model: publicProfile(commandProfile), outputDirectory: cmdOut, case: { ...entry, artifactType: 'copy', executionMode: 'harness', prompt: '$(touch should-never-execute)' } });
    assert.equal(await readFile(path.join(cmdOut, 'actual.txt'), 'utf8'), '工具实际生成的文件');
    await writeFile(path.join(dir, 'private.txt'), '不应收集');
    await symlink(path.join(dir, 'private.txt'), path.join(output, 'escape.txt'));
    await assert.rejects(collectOutputs(output), /符号链接/);
  } finally { await store.close(); }
});

test('磁盘数据库和附件在服务重新打开后仍可读取', async () => {
  const dir = await mkdtemp('/private/tmp/casebench-persistence-');
  const first = await createStore(dir);
  let caseId = '', fileId = '';
  try {
    const s = new CasebenchService(first);
    const file = await s.putFile(Buffer.from('需要持久保存的附件'), 'source.txt', 'text/plain', 'input');
    const entry = await s.saveCase({ title: '重启恢复案例', prompt: '根据输入写摘要', scene: 'writing', capabilities: ['follow'], artifactType: 'copy', executionMode: 'text', inputIds: [file.id], referenceId: null, instructions: '' });
    caseId = entry.id; fileId = file.id;
  } finally { await first.close(); }
  const second = await createStore(dir);
  try {
    const s = new CasebenchService(second);
    const entry = (await s.listCases()).find(c => c.id === caseId);
    assert.equal(entry?.prompt, '根据输入写摘要'); assert.equal(entry?.inputs[0].id, fileId);
    assert.equal((await s.fileBytes(fileId)).toString(), '需要持久保存的附件');
  } finally { await second.close(); }
});
