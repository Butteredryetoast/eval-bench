// Real read-only Vault and local RAG; intercepted, synthetic provider only.
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createKnowledgeSource} from '../server/knowledge.mjs';
import {createApiServer} from '../server/api.mjs';
import {createQaProviderServer,QA_API_KEY} from './qa-server.mjs';
try{process.loadEnvFile();}catch{}
const source=createKnowledgeSource({engine:'haystack'}),library=await source.loadLibrary();
assert.equal(library.blueprints.length,5);assert.equal(library.stats.articles,5858);
const provider=createQaProviderServer();
await new Promise(done=>provider.listen(0,'127.0.0.1',done));
const server=await createApiServer({knowledgeSource:source,apiKey:QA_API_KEY,baseUrl:'http://127.0.0.1:'+provider.address().port,maxRetries:0});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const base='http://127.0.0.1:'+server.address().port,cases=[];
const post=async(path,body)=>{const res=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(150000)});const data=await res.json();assert.equal(res.status,200,JSON.stringify(data));return data;};
try{
 for(const brief of ['解释一项模型 API 更新：关键变化、使用取舍和行动窗口','围绕一项有争议的产品决定，区分指控、当事方回应与未知边界']){
  const input={brief,genre:'资讯',references:[{id:'qa-announcement',title:'合成验收公告',content:'这是一条合成验收材料：某产品公布了一项变化。暂无完整对照数据、独立复测或当事方回应。不得当作真实新闻。'}]},started=Date.now();
  const rec=await post('/api/recommend',input),direction=rec.directions[0];
  assert.equal(rec.directions.length,3);assert.ok(rec.directions.every(d=>d.narrativePlan.nodes.length>=2));
  const draft=await post('/api/generate',{...input,recommendationId:rec.recommendationId,directionId:direction.id});
  assert.equal(draft.narrative.layoutVerified,true);assert.ok(draft.materialSlots.length>0);
  assert.ok(draft.markdown.indexOf('【素材位：')<draft.markdown.indexOf('【待写：'));
  const revised=await post('/api/revise',{...input,draft,instruction:'缩短铺垫，保留缺失材料与依赖判断的待写位置'});
  assert.equal(revised.narrative.layoutVerified,true);assert.deepEqual(revised.materialSlots,draft.materialSlots);
  cases.push({brief,ms:Date.now()-started,blueprintId:direction.narrativePlan.blueprintId,blueprintChoices:rec.directions.map(d=>d.narrativePlan.blueprintId),missing:draft.materialSlots.length,markdown:draft.markdown,revisionLayoutVerified:revised.narrative.layoutVerified,retrieval:rec.retrieval});
 }
 const payloadText=JSON.stringify(provider.qaRequests.map(r=>r.payload));assert.ok(!payloadText.includes('/Users/'));assert.ok(!payloadText.includes('obsidian://'));
 assert.equal(provider.qaRequests.length,6);
 const report={at:new Date().toISOString(),scope:'Real live Obsidian + actual Haystack/FastEmbed retrieval + synthetic local HTTP provider. No real DeepSeek prose-quality claim.',revision:library.revision,stats:library.stats,blueprints:library.blueprints.map(b=>({id:b.id,revision:b.revision,sourceArticleIds:b.sourceArticleIds,nodes:b.nodes.length})),cases,interceptedProviderRequests:6,paidProviderRequests:0};
 await mkdir(resolve('docs/qa'),{recursive:true});await writeFile(resolve('docs/qa/news-narrative-integration.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({verified:true,blueprints:5,cases:cases.map(({markdown,retrieval,...c})=>c),interceptedProviderRequests:6,paidProviderRequests:0},null,2));
}finally{
 await new Promise(done=>server.close(done));await new Promise(done=>provider.close(done));source.close();
}
