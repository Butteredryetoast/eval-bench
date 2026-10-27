import {blueprintMarkdown} from './fixtures/news-blueprint.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import { createApiServer } from '../server/api.mjs';
import { createQaProviderServer, QA_API_KEY } from '../scripts/qa-server.mjs';
import { createKnowledgeSource } from '../server/knowledge.mjs';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}
async function close(server) {
  server.closeAllConnections?.();
  if (server.listening) await new Promise(resolve => server.close(resolve));
}
async function post(base, path, body) {
  return fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

test('production API uses real fetch over local OpenAI-compatible HTTP for recommend, generate, and revise', async t => {
  // Keep the HTTP contract test independent of the user's private Vault and
  // macOS folder permissions. This is a real temporary Markdown Vault.
  const root=await mkdtemp(join(tmpdir(),'writing-http-vault-'));
  await mkdir(join(root,'库/结构'),{recursive:true});await mkdir(join(root,'库/文章'));
  await writeFile(join(root,'库/结构/N1.md'),'---\n类型: 写作结构\n体裁: 资讯\n结构代码: N1\n结构名称: 事实与边界\n---\n# 事实与边界\n\n## 什么时候用\n解释已核实的事实与未知边界\n\n## 推进顺序\n1. 现场记录\n2. 核实内容\n3. 证据边界');
  await writeFile(join(root,'库/文章/A1.md'),'---\n类型: 文章拆解\n文章ID: A1\n体裁: 资讯\n结构代码: N1\n发布日期: "2025-01-01"\n---\n# 记录\n\n## 正文\n现场记录核实功能结果，暂无复测。');
 await writeFile(join(root,'库/NEWS-TEST.md'),blueprintMarkdown);
  const source=createKnowledgeSource({vaultPath:root,libraryPath:'库'});
  const provider = createQaProviderServer({ apiKey: QA_API_KEY, model: 'deepseek-flash' });
  const providerBase = await listen(provider);
  const api = await createApiServer({ knowledgeSource:source,apiKey: QA_API_KEY, baseUrl: providerBase, model: 'deepseek-flash', timeoutMs: 3000, maxRetries: 0 });
  const apiBase = await listen(api);
  t.after(async () => { await close(api); await close(provider); await rm(root,{recursive:true,force:true}); });

  const library = await source.loadLibrary();
  const input = {
    brief: '归纳用户提供的记录，解释哪些内容已经核实、哪些仍需补充。', genre: '资讯',
    references: [{ id: 'user-note-1', title: '用户现场记录', content: '记录显示功能在第二步未能完成，暂无复测结果。' }],
  };
  const health = await (await fetch(`${apiBase}/api/health`)).json();
  assert.equal(health.configured, true);
  assert.equal(health.library.templates, library.templates.length);
  assert.equal(health.knowledge.type, 'obsidian');

  const recommendResponse = await post(apiBase, '/api/recommend', input);
  assert.equal(recommendResponse.status, 200);
  const recommendation = await recommendResponse.json();
  assert.equal(recommendation.retrieval.engine,'local-bm25-rrf-v1');
  assert.equal(recommendation.retrieval.modelCalls,0);
  assert.ok(recommendation.directions[0].examples[0].match.terms.length);
  assert.equal(recommendation.directions.length, 3);
  assert.equal(new Set(recommendation.directions.map(direction => direction.angle)).size, 3);
  const allowedIds = new Set(library.templates.filter(template => template.genre === input.genre).map(template => template.id));
  assert.ok(recommendation.directions.every(direction => allowedIds.has(direction.structureId)));

  const generateResponse = await post(apiBase, '/api/generate', { ...input, recommendationId: recommendation.recommendationId, directionId: recommendation.directions[0].id });
  assert.equal(generateResponse.status, 200);
  const draft = await generateResponse.json();
  assert.match(draft.title, /^\[验收示例\]/);
  assert.match(draft.markdown, /素材位/);
  assert.deepEqual(draft.sourceIds, ['user-note-1']);

  const reviseResponse = await post(apiBase, '/api/revise', { ...input, draft, instruction: '把结论边界写得更清楚' });
  assert.equal(reviseResponse.status, 200);
  const revised = await reviseResponse.json();
  assert.match(revised.title, /^\[验收示例\]/);
  assert.match(revised.markdown, /素材位/);
  assert.deepEqual(revised.sourceIds, ['user-note-1']);

  assert.equal(provider.qaRequests.length, 3, 'recommend, generate and revise each make one provider call');
  for (const { request } of provider.qaRequests) {
    assert.equal(request.model, 'deepseek-flash');
    assert.deepEqual(request.response_format, { type: 'json_object' });
    assert.deepEqual(request.thinking, { type: 'disabled' });
    assert.equal(request.stream, false);
    assert.deepEqual(request.messages.map(message => message.role), ['system', 'user']);
  }
  assert.equal(provider.qaRequests[0].payload.requestedGenre, input.genre);
  assert.equal(provider.qaRequests[0].payload.retrievalContext.engine,'local-bm25-rrf-v1');
  assert.ok(provider.qaRequests[0].payload.writingExamples[0].retrievalMatch.reason);
  assert.ok(!JSON.stringify(provider.qaRequests[0].payload).includes(root),'local file paths never enter the model prompt');
  assert.equal(provider.qaRequests[1].payload.confirmedDirection.structureId, recommendation.directions[0].structureId);
  assert.equal(provider.qaRequests[2].payload.instruction, '把结论边界写得更清楚');
  assert.equal(draft.writingSkill.applied, true);
  assert.equal(revised.writingSkill.applied, true);
  assert.equal(draft.writingSkill.mode, 'inline');
  assert.equal(revised.writingSkill.mode, 'inline');
});
