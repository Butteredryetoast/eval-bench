import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createStore } from '../packages/core/db';
import { seedStore } from '../packages/core/seed';
import { CasebenchService } from '../packages/core/service';
import { publicProfile, resolveFrozenProfile } from '../packages/core/config';
import { validateLocalProfiles } from '../packages/core/demo-runner';
import type { AgentCatalog, LocalProfile } from '../packages/contracts';

test('同一 Agent 不同模型分为独立任务，型号锁定且执行时仍校验原配置', async () => {
  const store = await createStore(await mkdtemp('/private/tmp/casebench-models-'), ':memory:');
  const profile: LocalProfile = { id: 'chatgpt-session', name: 'GPT', vendor: 'OpenAI', model: 'default', adapter: 'command', program: '/trusted/agent', args: ['session'], color: '#3f5cff', modes: ['text'], supportsTemperature: false };
  const catalog: AgentCatalog[] = [{ id: 'gpt', name: 'GPT', profileId: profile.id, ready: true, detail: '', models: [{ id: 'gpt-6.1-sol', name: '6.1', family: '6.1', isDefault: true }, { id: 'gpt-6-sol', name: '6', family: '6', isDefault: false }] }];
  const s = new CasebenchService(store, async () => catalog); s.catalog = async () => [publicProfile(profile)];
  try {
    await seedStore(store); const c = (await s.listCases()).find(c => c.executionMode === 'text')!;
    const payload = { caseIds: [c.id], models: catalog[0].models.map(m => ({ profileId: profile.id, model: m.id })), concurrency: 1, timeoutSeconds: 600, requestKey: randomUUID() };
    const run = await s.createRun(payload);
    assert.equal(run.results.length, 2); assert.notEqual(run.results[0].profileId, run.results[1].profileId);
    assert.deepEqual(run.spec.models.map(m => m.model), ['gpt-6.1-sol', 'gpt-6-sol']);
    assert.ok(run.spec.models.every(m => m.baseProfileId === profile.id && resolveFrozenProfile(m, [profile]) === profile));
    assert.equal(validateLocalProfiles(run, [profile]).length, 2);
    assert.throws(() => validateLocalProfiles(run, [{ ...profile, args: ['changed'] }]), /已变化/);
    assert.equal((await s.createRun(payload)).id, run.id);
    await assert.rejects(s.createRun({ ...payload, models: [payload.models[0], payload.models[0]], requestKey: randomUUID() }), /不能重复/);
    await assert.rejects(s.createRun({ ...payload, models: [{ profileId: profile.id, model: 'invented-model' }], requestKey: randomUUID() }), /模型列表/);
    await assert.rejects(s.createRun({ ...payload, models: [payload.models[1]], requestKey: payload.requestKey }), /其他运行配置/);
    assert.deepEqual((await s.getRun(run.id)).spec.models.map(m => m.model), ['gpt-6.1-sol', 'gpt-6-sol']);
  } finally { await store.close(); }
});
