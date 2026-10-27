import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApiServer } from '../server/api.mjs';
import { loadHumanizerSkill, humanizerInfo } from '../server/humanizer.mjs';
import { readFile } from 'node:fs/promises';

const refs = [{ id: 'r1', title: '现场记录', content: '今天我们测试了A，结果失败。', url: 'https://example.com/a' }];
const input = { brief: '分析A工具为什么失败', genre: '测评', references: refs, preferredStructure: 'review-1' };
const library = { templates: [{ id: 'review-1', genre: '测评', name: '实测复盘', fit: '适合实测', sequence: ['过程'], materials: ['数据'], boundary: '不编造', hooks: ['反差'] }], articles: [], stats: { articles: 1, templates: 1, independentReviews: 0 } };
const retrieval = { templates: library.templates, examples: [{ id: 'e1', title: '样文', account: '账号', url: 'https://example.com/e', reviewStatus: '复核', structureId: 'review-1', recipe: '先写过程', stages: [] }], stats: library.stats };

test('a disconnected client cannot start a paid recommendation after slow retrieval finishes',async()=>{
 let finishRetrieval,retrievalStarted,responseClosed,remoteCalls=0;
 const started=new Promise(resolve=>{retrievalStarted=resolve;}),closed=new Promise(resolve=>{responseClosed=resolve;});
 const server=await createApiServer({library,apiKey:'test-secret',retrieve:()=>{retrievalStarted();return new Promise(resolve=>{finishRetrieval=()=>resolve(retrieval);});},fetchImpl:async(...args)=>{remoteCalls++;return mockFetchFor()(...args);}});
 server.on('request',(_req,res)=>res.once('close',responseClosed));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const controller=new AbortController(),request=fetch('http://127.0.0.1:'+server.address().port+'/api/recommend',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input),signal:controller.signal}).catch(()=>{});
 try{await started;controller.abort();await closed;finishRetrieval();await request;await new Promise(resolve=>setTimeout(resolve,30));assert.equal(remoteCalls,0);}
 finally{finishRetrieval?.();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
function mockFetchFor(kind = 'good') {
  return async (_url, options) => {
    const body = JSON.parse(options.body);
    const system = body.messages[0].content;
    let content;
    if (body.messages[1].content.includes('requestedGenre')) {
      const value = kind === 'bad-ids' ? {
        directions: ['A','B','C'].map((x,i) => ({ title: x, angle: `angle ${x}`, reason: '理由', structureId: 'fake', outline: ['一','二'], materialNeeds: [], examples: [{ id: 'not-an-example' }] }))
      } : {
        directions: ['实测断点复盘','失败原因拆解','用户场景取舍'].map((x,i) => ({ title: x, angle: x, reason: '基于用户记录', structureId: 'review-1', outline: [`步骤${i+1}`, '证据'], materialNeeds: ['补充截图'], examples: [{ id: 'e1' }] }))
      };
      content = JSON.stringify(value);
      if (kind === 'truncated') content = '{"directions":[{"id":"d1"';
    } else {
      const value = { title: 'A工具实测复盘', markdown: '# A工具实测复盘\n\n记录显示【素材位：补充截图】。\n\n## 过程\n\n根据现场记录，测试失败。现有信息只能确认操作结果，无法推断产品原因，因此这里不作结论。\n\n## 结语\n\n仍需补充复测记录，再判断问题是否稳定复现。', structureId: 'review-1', sourceIds: ['r1'], materialSlots: ['补充截图'] };
      if (kind === 'no-output') value.markdown = '';
      content = JSON.stringify(value);
    }
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}
async function withServer(options, fn) {
  const server = await createApiServer({ library, retrieve: async () => retrieval, apiKey: 'test-secret', fetchImpl: mockFetchFor(), ...options });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { await new Promise(resolve => server.close(resolve)); }
}
async function post(base, path, body) { return fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); }

test('health and library expose the specified public shape', async () => withServer({}, async base => {
  const h = await (await fetch(`${base}/api/health`)).json();
  assert.deepEqual(h, { ok: true, configured: true, model: 'deepseek-flash', library: library.stats, provider: 'DeepSeek', writingSkill:humanizerInfo(await loadHumanizerSkill()) });
  assert.deepEqual(await (await fetch(`${base}/api/library`)).json(), { templates: library.templates, stats: library.stats });
}));

test('generation context excludes examples belonging only to unselected directions',async()=>{
 const calls=[];
 await withServer({retrieve:async()=>({...retrieval,examples:[...retrieval.examples,{...retrieval.examples[0],id:'unselected-example',structureId:'other-structure',evidenceLevel:'analyzed'}]}),fetchImpl:async(url,options)=>{calls.push(JSON.parse(JSON.parse(options.body).messages[1].content));return mockFetchFor()(url,options);}},async base=>{
  const rec=await(await post(base,'/api/recommend',input)).json();
  const response=await post(base,'/api/generate',{...input,recommendationId:rec.recommendationId,directionId:rec.directions[0].id});
  assert.equal(response.status,200);assert.deepEqual(calls[1].writingExamples.map(e=>e.id),['e1']);assert.equal(calls.length,2);
 });
});

test('recommend → confirm → generate → revise over mock OpenAI-compatible HTTP', async () => withServer({}, async base => {
  const recRes = await post(base, '/api/recommend', input); assert.equal(recRes.status, 200);
  const rec = await recRes.json(); assert.equal(rec.directions.length, 3); assert.equal(new Set(rec.directions.map(x => x.angle)).size, 3);
  const genRes = await post(base, '/api/generate', { ...input, recommendationId: rec.recommendationId, directionId: rec.directions[0].id }); assert.equal(genRes.status, 200);
  const draft = await genRes.json(); assert.match(draft.markdown, /素材位/); assert.deepEqual(draft.sourceIds, ['r1']);
  const rev = await post(base, '/api/revise', { draft, instruction: '让结尾更谨慎', brief: input.brief, genre: input.genre, references: refs });
  assert.equal(rev.status, 200); assert.equal((await rev.json()).structureId, 'review-1');
}));

test('changed facts or genre invalidate confirmed recommendation', async () => withServer({}, async base => {
  const rec = await (await post(base, '/api/recommend', input)).json();
  const response = await post(base, '/api/generate', { ...input, brief: '改变后的事实', recommendationId: rec.recommendationId, directionId: rec.directions[0].id });
  assert.equal(response.status, 409); assert.equal((await response.json()).error.code, 'STALE_RECOMMENDATION');
}));

test('missing key is explicit 503 and never returns a fake recommendation', async () => withServer({ apiKey: '' }, async base => {
  const response = await post(base, '/api/recommend', input); assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'MISSING_API_KEY');
}));

test('invalid model references and empty output are rejected without leaking provider text', async () => {
  await withServer({ fetchImpl: mockFetchFor('bad-ids') }, async base => {
    const response = await post(base, '/api/recommend', input); assert.equal(response.status, 502); assert.equal((await response.json()).error.code, 'INVALID_MODEL_OUTPUT');
  });
  await withServer({ fetchImpl: mockFetchFor('no-output') }, async base => {
    const rec = await (await post(base, '/api/recommend', input)).json();
    const response = await post(base, '/api/generate', { ...input, recommendationId: rec.recommendationId, directionId: rec.directions[0].id });
    assert.equal(response.status, 502); assert.equal((await response.json()).error.code, 'INVALID_MODEL_OUTPUT');
  });
});

test('truncated model output is rejected and revise only accepts user source IDs', async () => {
  await withServer({ fetchImpl: mockFetchFor('truncated') }, async base => {
    const response = await post(base, '/api/recommend', input); assert.equal(response.status, 502);
  });
  await withServer({}, async base => {
    const response = await post(base, '/api/revise', { draft: { title: 'x', markdown: 'x', structureId: 'review-1', sourceIds: ['e1'] }, instruction: 'revise', brief: input.brief, genre: input.genre, references: refs });
    assert.equal(response.status, 400); assert.equal((await response.json()).error.code, 'INVALID_INPUT');
  });
});

test('model timeout is bounded and request body size is capped', async () => {
  await withServer({ timeoutMs: 5, maxRetries: 0, fetchImpl: (_url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))) ) }, async base => {
    const response = await post(base, '/api/recommend', input);
    assert.equal(response.status, 504); assert.equal((await response.json()).error.code, 'MODEL_TIMEOUT');
  });
  await withServer({ maxBodyBytes: 40 }, async base => {
    const response = await post(base, '/api/recommend', input);
    assert.equal(response.status, 413); assert.equal((await response.json()).error.code, 'BODY_TOO_LARGE');
  });
});

test('recommendation TTL expires before generation', async () => withServer({ cacheTtlMs: 1 }, async base => {
  const rec = await (await post(base, '/api/recommend', input)).json();
  await new Promise(resolve => setTimeout(resolve, 5));
  const response = await post(base, '/api/generate', { ...input, recommendationId: rec.recommendationId, directionId: rec.directions[0].id });
  assert.equal(response.status, 409); assert.equal((await response.json()).error.code, 'STALE_RECOMMENDATION');
}));

test('cross-site plain text requests cannot spend the local API key',async()=>withServer({},async base=>{
 const response=await fetch(base+'/api/recommend',{method:'POST',headers:{origin:'https://untrusted.example','content-type':'text/plain'},body:JSON.stringify(input)});
 assert.equal(response.status,403);
}));
test('model length finish reason is rejected even when its partial JSON parses',async()=>withServer({fetchImpl:async(url,options)=>{const res=await mockFetchFor()(url,options);const body=await res.json();body.choices[0].finish_reason='length';return Response.json(body);}},async base=>{
 const response=await post(base,'/api/recommend',input);assert.equal(response.status,502);
}));
test('parallel model calls are capped',async()=>{
 let release;const gate=new Promise(r=>{release=r;});let entered;const started=new Promise(r=>{entered=r;});
 await withServer({maxConcurrent:1,fetchImpl:async(url,options)=>{entered();await gate;return mockFetchFor()(url,options);}},async base=>{
  const first=post(base,'/api/recommend',input);await started;
  const timer=setTimeout(release,80);const second=await post(base,'/api/recommend',input);release();clearTimeout(timer);await first;assert.equal(second.status,429);
 });
});

test('configured Vite frontend origin can use the local backend through proxy',async()=>withServer({},async base=>{
 const response=await fetch(base+'/api/recommend',{method:'POST',headers:{origin:'http://127.0.0.1:5173','content-type':'application/json'},body:JSON.stringify(input)});
 assert.equal(response.status,200);
}));

test('generate and revise each use one model call with the complete chosen skill included',async()=>{
 const calls=[],skill=await loadHumanizerSkill();
 await withServer({fetchImpl:async(url,options)=>{
  const request=JSON.parse(options.body),payload=JSON.parse(request.messages[1].content);calls.push(payload);
  if(!payload.requestedGenre)assert.ok(request.messages[0].content.includes(skill.instructions));
  if(payload.instruction)assert.deepEqual(payload.draft.materialSlots,['补充截图']);
  return mockFetchFor()(url,options);
 }},async base=>{
  const rec=await(await post(base,'/api/recommend',input)).json();assert.equal(calls.length,1);
  const response=await post(base,'/api/generate',{...input,recommendationId:rec.recommendationId,directionId:rec.directions[0].id});assert.equal(response.status,200);
  const draft=await response.json();assert.equal(draft.writingSkill.id,'humanizer-zh');assert.equal(draft.writingSkill.applied,true);assert.equal(draft.writingSkill.mode,'inline');assert.equal(calls.length,2);
  const revised=await post(base,'/api/revise',{...input,draft,instruction:'让判断更简洁'});assert.equal(revised.status,200);assert.equal((await revised.json()).writingSkill.applied,true);
  assert.deepEqual(calls.map(p=>p.instruction&&'revise'||p.requestedGenre&&'recommend'||'generate'),['recommend','generate','revise']);
 });
});
test('single-pass writing still rejects unknown factual sources without a second model request',async()=>withServer({fetchImpl:async(url,options)=>{
 const payload=JSON.parse(JSON.parse(options.body).messages[1].content);
 const response=await mockFetchFor()(url,options);
 if(payload.requestedGenre)return response;
 const envelope=await response.json(),draft=JSON.parse(envelope.choices[0].message.content);draft.sourceIds=['invented-source'];envelope.choices[0].message.content=JSON.stringify(draft);return Response.json(envelope);
}},async base=>{
 const rec=await(await post(base,'/api/recommend',input)).json();const response=await post(base,'/api/generate',{...input,recommendationId:rec.recommendationId,directionId:rec.directions[0].id});assert.equal(response.status,502);assert.equal((await response.json()).error.code,'INVALID_MODEL_OUTPUT');
}));
test('missing skill files are reported independently and stop writing before any model call',async()=>{
 let modelCalls=0;
 await withServer({writingSkillLoader:async()=>{throw Object.assign(new Error('missing'),{code:'WRITING_SKILL_UNAVAILABLE'});},fetchImpl:async(...args)=>{modelCalls++;return mockFetchFor()(...args);}},async base=>{
  const h=await(await fetch(base+'/api/health')).json();assert.equal(h.writingSkill.ready,false);assert.equal(h.configured,true);
  const rec=await(await post(base,'/api/recommend',input)).json();const before=modelCalls;
  const response=await post(base,'/api/generate',{...input,recommendationId:rec.recommendationId,directionId:rec.directions[0].id});assert.equal(response.status,503);assert.equal((await response.json()).error.code,'WRITING_SKILL_UNAVAILABLE');assert.equal(modelCalls,before);
 });
});

test('legacy news revision without a repeated Markdown title receives one heading and unverified layout',async()=>{
 const captured=JSON.parse(await readFile(new URL('./fixtures/memory-article-no-heading.json',import.meta.url),'utf8'));
 const memoryLibrary={templates:[{id:'N3',genre:'资讯',name:'事件与行业影响',sequence:['变化','影响','边界']}],stats:{articles:0,templates:1,independentReviews:0}};
 const memoryInput={brief:'智能体的记忆，应该留下什么？',genre:'资讯',references:[{id:'example-8',title:'演示资料',content:'演示选题，具体案例需要补充。'}]};
 let calls=0;
 await withServer({library:memoryLibrary,retrieve:async()=>({templates:memoryLibrary.templates,examples:[]}),fetchImpl:async(url,options)=>{
  calls++;const payload=JSON.parse(JSON.parse(options.body).messages[1].content);
  if(payload.requestedGenre){const envelope=await(await mockFetchFor()(url,options)).json();const rec=JSON.parse(envelope.choices[0].message.content);for(const d of rec.directions){d.structureId='N3';d.examples=[];}envelope.choices[0].message.content=JSON.stringify(rec);return Response.json(envelope);}
  return Response.json({choices:[{message:{content:JSON.stringify(payload.preserveDraft?{title:captured.title,structureId:captured.structureId,sourceIds:captured.sourceIds,edits:[]}:captured)},finish_reason:'stop'}]});
 }},async base=>{
  const response=await post(base,'/api/revise',{...memoryInput,instruction:'只调整承接，保留事实与素材位',draft:captured});assert.equal(response.status,200);
  const draft=await response.json();assert.equal(draft.markdown,'# '+captured.title+'\n\n'+captured.markdown.trim());assert.deepEqual(draft.sourceIds,captured.sourceIds);assert.deepEqual(draft.materialSlots,Array.from(captured.markdown.matchAll(/【素材位[：:]\s*([^】]+)】/g),m=>m[1].trim()));assert.equal(calls,1);assert.equal(draft.narrative.layoutVerified,false);
 });
});
