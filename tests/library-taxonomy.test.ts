import { test } from 'node:test';
import assert from 'node:assert/strict';
import { caseInputSchema, type CaseRecord } from '../packages/contracts/index';
import { caseCapabilities, interpretCapabilityQuery, matchesLibraryCase, LIBRARY_SCENES } from '../packages/core/library-taxonomy';
const entry = { id: 'test-chart', title: '渠道销售图表', prompt: '分析四个季度的销售数据', scene: 'dataviz', capabilities: ['chart', 'vision', 'long'], artifactType: 'web', favorite: true } as CaseRecord;
const options = { scenes: [], artifacts: [], query: '', favorites: false, capabilities: [] };
test('旧图表标签映射为逻辑推理，持续任务不冒充能力', () => {
  assert.deepEqual(caseCapabilities(entry), ['reason', 'vision']);
  assert.deepEqual(caseCapabilities({ capabilities: ['chart', 'reason', 'coding', 'long'] }), ['reason', 'coding']);
});
test('同组内多选匹配任一项，不同分组与收藏条件同时生效', () => {
  assert.equal(matchesLibraryCase(entry, { ...options, scenes: ['dataviz'], artifacts: ['web'], favorites: true, capabilities: ['vision', 'reason'] }), true);
  assert.equal(matchesLibraryCase(entry, { ...options, capabilities: ['vision', 'coding'] }), true);
  assert.equal(matchesLibraryCase(entry, { ...options, scenes: ['game'] }), false);
  assert.equal(matchesLibraryCase(entry, { ...options, artifacts: ['image'] }), false);
});
test('任务类型、能力、产物各自取并集，再求分组交集', () => {
  const selected = { ...options, scenes: ['game', 'dataviz'], artifacts: ['image', 'web'], capabilities: ['coding', 'vision'] as const };
  assert.equal(matchesLibraryCase(entry, selected), true);
  assert.equal(matchesLibraryCase({ ...entry, scene: 'game', capabilities: ['coding'] }, selected), true);
  assert.equal(matchesLibraryCase({ ...entry, artifactType: 'image', capabilities: ['vision'] }, selected), true);
  assert.equal(matchesLibraryCase({ ...entry, scene: 'writing' }, selected), false);
  assert.equal(matchesLibraryCase({ ...entry, artifactType: 'copy' }, selected), false);
  assert.equal(matchesLibraryCase({ ...entry, capabilities: ['follow'] }, selected), false);
  assert.equal(matchesLibraryCase({ ...entry, favorite: false }, { ...selected, favorites: true }), false);
});
test('空分组不设限制，新增同组标签扩大结果，新增分组缩小结果', () => {
  const game = { ...entry, scene: 'game', capabilities: ['coding'], artifactType: 'web' } as CaseRecord;
  const writing = { ...entry, scene: 'writing', capabilities: ['follow'], artifactType: 'copy' } as CaseRecord;
  const cases = [entry, game, writing];
  const ids = (filters: Parameters<typeof matchesLibraryCase>[1]) => cases.filter(c => matchesLibraryCase(c, filters)).map(c => c.scene);
  assert.equal(ids(options).length, 3);
  assert.deepEqual(ids({ ...options, scenes: ['game'] }), ['game']);
  assert.deepEqual(ids({ ...options, scenes: ['game', 'dataviz'] }), ['dataviz', 'game']);
  assert.deepEqual(ids({ ...options, scenes: ['game', 'dataviz'], capabilities: ['vision'] }), ['dataviz']);
  assert.deepEqual(ids({ ...options, scenes: ['game', 'dataviz'], capabilities: ['vision', 'coding'] }), ['dataviz', 'game']);
  assert.equal(matchesLibraryCase(entry, { ...options, scenes: ['not-a-task'] }), false);
  assert.equal(matchesLibraryCase(entry, { ...options, artifacts: ['not-a-format'] }), false);
});
test('保留旧代码案例，合并到网页应用浏览入口', () => {
  assert.equal(matchesLibraryCase({ ...entry, scene: 'code' }, { ...options, scenes: ['landing'] }), true);
  assert.equal(LIBRARY_SCENES.length, 15);
});
test('能力意图由明确关键词识别，普通案例搜索仍匹配正文', () => {
  assert.deepEqual(interpretCapabilityQuery('想测模型读懂图表后的推理能力'), ['reason', 'vision']);
  assert.deepEqual(interpretCapabilityQuery('三关打砖块'), []);
  assert.equal(matchesLibraryCase(entry, { ...options, query: '销售 四个季度' }), true);
  assert.equal(matchesLibraryCase(entry, { ...options, query: '根本不存在' }), false);
  assert.equal(matchesLibraryCase(entry, { ...options, query: '想测模型读懂图表后的推理能力', interpreted: true, capabilities: ['reason', 'vision'] }), true);
});
test('新增场景与能力可通过真实保存接口的 schema，旧标签仍能读取', () => {
  for (const scene of LIBRARY_SCENES.filter(s => s.key)) assert.equal(caseInputSchema.safeParse({ scene: scene.key, prompt: '测试任务', capabilities: ['expression', 'extract', 'tools'], artifactType: 'copy', executionMode: 'text' }).success, true);
  assert.equal(caseInputSchema.safeParse({ scene: 'code', prompt: '测试', capabilities: ['chart', 'long'], artifactType: 'web', executionMode: 'html' }).success, true);
});
