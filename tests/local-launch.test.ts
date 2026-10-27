import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLocalProfiles } from '../packages/core/demo-runner';
import { publicProfile } from '../packages/core/config';
import type { LocalProfile, RunRecord } from '../packages/contracts';

test('网页只允许启动本机已配置且与运行快照一致的命令行工具', () => {
  const profile: LocalProfile = { id: 'local-check', name: '本机测试', vendor: 'test', model: 'default', adapter: 'command', program: '/trusted/tool', args: ['--text'], color: '#3157d5', modes: ['text'], supportsTemperature: false };
  const run = { spec: { demo: false, models: [publicProfile(profile)] } } as unknown as RunRecord;
  assert.equal(validateLocalProfiles(run, [profile])[0], profile);
  assert.throws(() => validateLocalProfiles(run, []), /已变化/);
  assert.throws(() => validateLocalProfiles(run, [{ ...profile, program: '/changed/tool' }]), /已变化/);
  assert.throws(() => validateLocalProfiles({ ...run, spec: { ...run.spec, demo: true } }, [profile]), /只启动/);
  assert.throws(() => validateLocalProfiles({ ...run, spec: { ...run.spec, models: [{ ...run.spec.models[0], adapter: 'api' }] } }, [profile]), /只启动/);
});
