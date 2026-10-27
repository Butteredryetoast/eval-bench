// Smoke checks against the normal localhost API and current read-only Vault.
// No recommend/generate/revise request, hence no paid provider invocation.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createObsidianSource} from '../server/obsidian.mjs';
try{process.loadEnvFile();}catch{}
const base='http://127.0.0.1:'+(Number(process.env.PORT)||8787);
const get=async path=>{const response=await fetch(base+path,{signal:AbortSignal.timeout(150_000)});const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body;};
const library=await createObsidianSource().loadLibrary(),byId=new Map(library.articles.map(a=>[a.id,a]));
const before=await get('/api/health');assert.equal(before.knowledge.retrieval.engine,'haystack-fastembed-v1');assert.equal(before.knowledge.retrieval.ready,true);
assert.equal(before.knowledge.retrieval.articles,library.articles.length);assert.equal(before.knowledge.retrieval.revision,library.revision);
const cases=[];
for(const input of [
 {label:'智能体记忆资讯',q:'智能体跨会话保留长期记忆，错误记忆如何纠正，隐私授权有什么边界',genre:'资讯'},
 {label:'视频工具测评',q:'比较视频生成工具的镜头连续性、人物一致性和失败场景，说明如何选择',genre:'测评'},
 {label:'本地知识库教程',q:'如何在电脑部署私有知识库，准备条件、操作步骤、常见错误和验收',genre:'教程'},
 {label:'上下文与记忆科普',q:'大模型上下文窗口和长期记忆有什么区别，解释原理和边界',genre:'科普'},
]){
 const started=Date.now(),result=await get('/api/knowledge/search?'+new URLSearchParams({...input,limit:'6'}));
 assert.equal(result.retrieval.engine,'haystack-fastembed-v1');assert.equal(result.retrieval.rerankApplied,true);assert.equal(result.revision,library.revision);
 assert.ok(result.results.length>0,input.label);assert.equal(new Set(result.results.map(r=>r.id)).size,result.results.length);
 const articles=result.results.filter(r=>byId.has(r.id));assert.ok(articles.length>0,'must retrieve actual articles: '+input.label);
 for(const r of result.results){
  assert.ok(r.snippet);assert.match(r.obsidianUrl,/^obsidian:\/\/open/);assert.equal(r.match.reranked,true);
  assert.doesNotMatch(r.snippet,/复核方法[：:]|gpt-6-luna|独立复核记录|执行者[：:]/);
  if(byId.has(r.id)){const a=byId.get(r.id);assert.equal(a.genre,input.genre);assert.ok(!a.publishDate||a.publishDate>='2023-01-01');if(a.evidenceLevel==='candidate')assert.equal(r.evidenceLevel,'candidate');}
 }
 cases.push({input,ms:Date.now()-started,results:result.results,retrieval:result.retrieval});
 console.log(JSON.stringify({phase:'probe',label:input.label,ms:cases.at(-1).ms,articles:articles.map(r=>({id:r.id,title:r.title}))}));
}
const unrelated=await get('/api/knowledge/search?'+new URLSearchParams({q:'🦄🧠🦄ZXQNV841729月球养鲸许可证',genre:'测评'}));
const after=await get('/api/health');assert.equal(after.knowledge.retrieval.rerankerLoaded,true);assert.equal(after.knowledge.retrieval.remoteModelCalls,0);
const frontend=await fetch('http://127.0.0.1:5173/');assert.equal(frontend.status,200);
const report={at:new Date().toISOString(),scope:'Real Vault and normal localhost API; smoke scenarios, not a labelled relevance benchmark.',paidRemoteCalls:0,stats:library.stats,revision:library.revision,index:after.knowledge.retrieval,cases,unrelatedControl:{query:'🦄🧠🦄ZXQNV841729月球养鲸许可证',returned:unrelated.results.length,results:unrelated.results},frontendStatus:frontend.status};
await mkdir(resolve('docs/qa'),{recursive:true});await writeFile(resolve('docs/qa/haystack-full.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({phase:'verified',index:report.index,unrelatedReturned:unrelated.results.length,paidRemoteCalls:0}));
