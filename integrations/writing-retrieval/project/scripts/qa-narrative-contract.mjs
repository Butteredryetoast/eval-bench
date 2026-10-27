// Validate today's narrative data contract against the real read-only Vault
// and real local RAG. Provider replies are deliberately bad local fixtures:
// this audits what the API accepts, not what DeepSeek would actually generate.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createKnowledgeSource} from '../server/knowledge.mjs';
import {createApiServer} from '../server/api.mjs';
try{process.loadEnvFile();}catch{}
const source=createKnowledgeSource({engine:'haystack'}),library=await source.loadLibrary();
const articleMap=new Map(library.articles.map(a=>[a.id,a]));
const sampleIds=['A500405','A400039','A600264','APae4085ada612','A300587'];
const samples=sampleIds.map(id=>{
 const a=articleMap.get(id);assert.ok(a,'real article missing: '+id);
 return {id,title:a.title,genre:a.genre,structureId:a.structureId,notePath:a.notePath,originalNotePath:a.originalNotePath,
  parsed:{stageTitles:a.stages,stageNotesCount:a.stageNotes.length,hookChainsCount:a.hookChains.length,openingChars:a.opening.note.length,middleChars:a.middle.advance.length,endingChars:a.ending.note.length},
  originalHasMarkdownMedia:/!\[/.test(a._sourceText),originalHasVideoText:a._sourceText.includes('▶点击观看微信视频')};
});
const captures=[],rawPayloads=[],cases=[];let server;
const badBody='这是检验后端验收边界的模拟坏稿，不是正式文章。\n\n## 已经写完的判断\n\n'+
 '这里先把分析和判断全部写完。模拟稿甚至可以在没有本轮测试材料时断言：工具A在稳定性和成本上全面占优。'+
 '接下来再重复解释这个判断对读者有什么意义，虽然用来支持它的实测材料还没有提供。'+
 '\n\n【素材位：补充本轮原始输入、输出和失败证据】';
try{
 server=await createApiServer({knowledgeSource:source,apiKey:'local-contract-fixture',fetchImpl:async(_url,options)=>{
  const messages=JSON.parse(options.body).messages,payload=JSON.parse(messages[1].content),kind=payload.requestedGenre?'recommend':'generate';
  rawPayloads.push({kind,messages});
  captures.push({kind,exampleCount:payload.writingExamples?.length||0,examples:(payload.writingExamples||[]).map(e=>{
   const a=articleMap.get(e.id);return {id:e.id,receivedKeys:Object.keys(e),stageTitleCount:e.stages?.length||0,
    missingStructuredStageNotes:!Object.hasOwn(e,'stageNotes'),missingStructuredHookChains:!Object.hasOwn(e,'hookChains'),
    missingDedicatedOpening:!Object.hasOwn(e,'opening'),missingDedicatedMiddle:!Object.hasOwn(e,'middle'),missingDedicatedEnding:!Object.hasOwn(e,'ending'),
    sourceHasFullStages:Boolean(a?._analysisText.includes('## 原文实际阶段')),historicalExcerptChars:e.historicalArticleExcerpt?.length||0,analysisExcerptChars:e.analysisExcerpt?.length||0};
  }),structures:payload.allowedStructures||[payload.structure]});
  let output;
  if(kind==='recommend'){
   const template=payload.allowedStructures.find(t=>t.id===(payload.requestedGenre==='测评'?'R2':'C4'))||payload.allowedStructures[0];
   assert.ok(template);assert.ok(payload.writingExamples.length,'actual RAG must return examples');
   const exampleId=payload.writingExamples[0].id;
   output={directions:['先看输出，再检查比较条件','抓住失败转折追问边界','顺着实际工作流程比较取舍'].map((angle,i)=>({title:'契约验收示例'+(i+1),angle,reason:'仅用于检查现有结构和素材字段。',structureId:template.id,outline:['说明问题','列出判断','追加待补材料'],materialNeeds:['本轮真实证据'],examples:[{id:exampleId}]}))};
  }else output={title:'后端验收边界模拟坏稿',markdown:badBody,structureId:payload.confirmedDirection.structureId,sourceIds:[],materialSlots:['补充本轮原始输入、输出和失败证据']};
  return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}]}),{status:200,headers:{'content-type':'application/json'}});
 }});
 await new Promise(done=>server.listen(0,'127.0.0.1',done));const base='http://127.0.0.1:'+server.address().port;
 const post=async(path,body)=>{const response=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(150_000)});return {status:response.status,body:await response.json()};};
 for(const input of [
  {brief:'视频模型到底怎么选，用相同任务对照镜头连续性、人物一致性和失败场景',genre:'测评',references:[],preferredStructure:'R2'},
  {brief:'Google Earth 接入生成式 AI 后虚构图片破坏地图信任，如何从事件讲到产品设计取舍',genre:'评论',references:[],preferredStructure:'C4'},
 ]){
  const started=Date.now(),rec=await post('/api/recommend',input);assert.equal(rec.status,200,JSON.stringify(rec.body));
  const draft=await post('/api/generate',{...input,recommendationId:rec.body.recommendationId,directionId:rec.body.directions[0].id});
  assert.equal(draft.status,200,JSON.stringify(draft.body));assert.ok(draft.body.markdown.trim().endsWith('【素材位：补充本轮原始输入、输出和失败证据】'));
  cases.push({genre:input.genre,brief:input.brief,ms:Date.now()-started,recommendStatus:rec.status,badFixtureDraftAccepted:draft.status===200,
   clarification:'Bad provider output was deliberately supplied as a fixture. This proves a validator gap, not actual DeepSeek behavior.',selectedExampleIds:rec.body.directions[0].examples.map(e=>e.id),draft: draft.body.markdown});
 }
 const report={at:new Date().toISOString(),scope:'Read-only real Vault + real local retrieval + intercepted provider requests. Product behavior unchanged.',revision:library.revision,stats:library.stats,samples,captures,cases,interceptedProviderRequests:captures.length,paidProviderRequests:0,
  conclusion:'Stage titles survive, but detailed stage/hook/placement fields do not reach the provider as structured data. Excerpts may still contain some details. A tail-placeholder bad fixture is accepted by the current validator.'};
 await mkdir(resolve('docs/qa'),{recursive:true});await writeFile(resolve('docs/qa/narrative-contract-live.json'),JSON.stringify(report,null,2)+'\n');
 await mkdir(resolve('.rag-cache/narrative-validation'),{recursive:true});await writeFile(resolve('.rag-cache/narrative-validation/provider-payloads.json'),JSON.stringify(rawPayloads,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({phase:'verified',samples:samples.length,cases,interceptedProviderRequests:captures.length,paidProviderRequests:0},null,2));
}finally{if(server)await new Promise(done=>server.close(done));source.close();}
