import test from 'node:test';
import assert from 'node:assert/strict';
import {createHaystackKnowledge,balancedRagQuery} from '../server/haystack-knowledge.mjs';
import {createKnowledgeSource} from '../server/knowledge.mjs';
import {createApiServer} from '../server/api.mjs';
const library=(revision='v1',body='同题实测比较人物一致性。')=>({revision,source:{type:'obsidian',connected:true,readOnly:true},stats:{articles:1},articles:[{id:'A1',title:'视频对比',genre:'测评',structureId:'R2',evidenceLevel:'candidate',_sourceText:body,_analysisText:'',notePath:'库/A1.md',obsidianUrl:'obsidian://open?file=A1'}],templates:[{id:'R2',name:'同题对比',genre:'测评',fit:'比较工具',sequence:['同题','结果','选型']}],notes:[]});
test('bounded model queries retain reference context after a long brief without cutting emoji',()=>{
 const q=balancedRagQuery([{text:'🧠'.repeat(600)},{text:'第一份资料：视频镜头一致性'},{text:'第二份资料：失败后的修正'}]);
 assert.ok(Array.from(q).length<=440);assert.ok(q.isWellFormed());assert.match(q,/镜头一致性/);assert.match(q,/失败后的修正/);
});
function fixture(){
 const sources=new Map(),calls=[];let revision='',failQuery=false,staleHit=false;
 const client={info:()=>({engine:'haystack-fastembed-v1'}),health:async()=>({}),close(){},
  plan:async manifest=>{calls.push('plan');return {changed:manifest.filter(s=>sources.get(s.key)?.digest!==s.digest).map(s=>s.key)};},
  upsert:async source=>{calls.push('upsert:'+source.key);sources.set(source.key,source);return {embedded:source.chunks.length};},
  commit:async(manifest,next)=>{calls.push('commit');for(const key of sources.keys())if(!manifest.some(s=>s.key===key))sources.delete(key);revision=next;return {};},
  query:async input=>{calls.push('query');assert.equal(input.revision,revision);if(failQuery)throw Object.assign(new Error('worker stopped'),{code:'RAG_UNAVAILABLE'});const hits=[...sources.values()].filter(s=>input.kinds.includes(s.kind)&&(!input.genre||s.genre===input.genre)).map(s=>({parentKey:s.parentKey,score:1,reranked:true,channels:['vector'],passages:s.chunks.slice(0,1).map(c=>({...c,kind:s.kind,sourceKey:s.key,sourceDigest:staleHit?'obsolete':s.digest,notePath:s.notePath,obsidianUrl:s.obsidianUrl}))}));return {hits,meta:{rerankApplied:true}};},
 };
 return {knowledge:createHaystackKnowledge({client}),calls,sources,setFail:value=>{failQuery=value;},setStale:value=>{staleHit=value;}};
}
test('Haystack adapter syncs live edits and deletions, while unreviewed examples remain candidates',async()=>{
 const f=fixture(),first=library();let result=await f.knowledge.retrieve(first,{brief:'视频稳定性',genre:'测评'});
 assert.equal(result.examples[0].evidenceLevel,'candidate');assert.equal(result.examples[0].analysisExcerpt,'');assert.equal(result.examples[0].match.reranked,true);
 assert.equal(result.retrieval.rerankApplied,true);assert.match(result.examples[0].contentExcerpt,/人物一致性/);
 f.calls.length=0;await f.knowledge.retrieve(first,{brief:'视频',genre:'测评'});assert.equal(f.calls.includes('plan'),false);
 result=await f.knowledge.retrieve(library('v2','新的运动镜头测试'),{brief:'运动镜头',genre:'测评'});assert.match(result.examples[0].contentExcerpt,/新的运动/);
 const deleted={...library('v3'),articles:[]};result=await f.knowledge.retrieve(deleted,{brief:'视频',genre:'测评'});assert.equal(result.examples.length,0);assert.equal(f.sources.has('source:A1'),false);
});
test('stale passage digests are rejected and worker failures trigger a fresh manifest check',async()=>{
 const f=fixture(),lib=library();await f.knowledge.search(lib,{q:'视频'});f.setStale(true);assert.equal((await f.knowledge.search(lib,{q:'视频'})).results.length,0);
 f.setFail(true);await assert.rejects(f.knowledge.search(lib,{q:'视频'}),{code:'RAG_UNAVAILABLE'});
 f.calls.length=0;f.setFail(false);await f.knowledge.search(lib,{q:'视频'});assert.equal(f.calls[0],'plan');
});
test('configured semantic failures return 503 without lexical fallback or a paid writing call',async()=>{
 let remoteCalls=0;const f=fixture();f.setFail(true);
 const source=createKnowledgeSource({source:{loadLibrary:async()=>library()},engine:'haystack',rag:f.knowledge});
 const server=await createApiServer({knowledgeSource:source,apiKey:'fixture',fetchImpl:async()=>{remoteCalls++;throw new Error('must not call');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 try{
  const response=await fetch(base+'/api/recommend',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({brief:'对比视频工具',genre:'测评',references:[]})});
  assert.equal(response.status,503);assert.equal((await response.json()).error.code,'RAG_UNAVAILABLE');assert.equal(remoteCalls,0);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test('news retrieval returns the complete current blueprint rather than the matched chunk',async()=>{
 const f=fixture(),b={id:'NEWS-TEST',name:'事件线索',genre:'资讯',structureId:'N1',revision:'first',fit:'解释选择',nodes:[{title:'消息',readerQuestion:'发生什么',move:'交代事实',transition:'问原因',beats:[{id:'evidence',type:'material',instruction:'公告',role:'提供依据'}]}]};
 const lib={...library(),blueprints:[b]};const result=await f.knowledge.retrieve(lib,{brief:'合作选择',genre:'资讯'});
 assert.equal(result.blueprints?.length,1);assert.equal(result.blueprints[0],b);assert.equal(result.blueprints[0].nodes[0].beats[0].role,'提供依据');
});
