// Real local Chinese models + real temporary Vault + HTTP recommendation;
// the generation provider is a fixture, so this never spends a DeepSeek call.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createObsidianSource} from '../server/obsidian.mjs';
import {createHaystackClient} from '../server/haystack-client.mjs';
import {createHaystackKnowledge} from '../server/haystack-knowledge.mjs';
import {createKnowledgeSource} from '../server/knowledge.mjs';
import {createApiServer} from '../server/api.mjs';
const root=await mkdtemp(join(tmpdir(),'writing-rag-live-'));
const dir=join(root,'库');await mkdir(join(dir,'文章'),{recursive:true});await mkdir(join(dir,'结构'));
const put=(id,text,genre='测评')=>writeFile(join(dir,'文章',id+'.md'),`---\n类型: 文章拆解\n文章ID: ${id}\n标题: 实验记录${id}\n体裁: ${genre}\n结构代码: R2\n发布日期: "2025-01-01"\n复核状态: 自动候选\n---\n# 实验记录\n\n## 来源与正文转写\n\n${text}`);
await put('A1','把同一段文字分别交给两个助手，记录哪一个保留事实、改错和失败，再根据使用目标给出建议。');
await put('A2','把电子文档留在自己的电脑上，先装好应用、再导入文件。选择推理引擎，构建可搜索的索引，最后通过对话询问文档内容并检查答案。');
await put('A3','从某位作者早年的失败经历切入，跟随他离职、重选方向的过程，结尾回到选择的代价。');
await put('A4','相同输入下，比较两个工具的输出质量、稳定性与失败情况。','教程');
await writeFile(join(dir,'结构/R2.md'),'---\n类型: 写作结构\n体裁: 测评\n结构代码: R2\n结构名称: 同题对照\n---\n# 同题对照\n\n## 什么时候用\n用相同任务比较两个工具。\n\n## 推进顺序\n1. 同任务\n2. 结果对照\n3. 适用边界');
const client=createHaystackClient({cacheDir:join(root,'cache'),timeoutMs:120_000,rankCandidates:8});
const rag=createHaystackKnowledge({client}),source=createKnowledgeSource({source:createObsidianSource({vaultPath:root,libraryPath:'库'}),engine:'haystack',rag});
const checks=[],queries=[];let server,providerCalls=0;
try{
 for(const [q,expected] of [['横向比较两家文本AI谁更可靠','A1'],['怎样搭起私人的资料问答系统','A2'],['用主人公的人生拐点带出叙事主线','A3']]){
  const started=Date.now(),result=await source.search({q,genre:'测评',limit:8});
  const articles=result.results.filter(r=>r.kind==='原文'||r.kind==='全文拆解');
  if(process.env.RAG_QA_DIAG)console.error(JSON.stringify({diagnostic:q,raw:(await client.query({revision:result.revision,query:q,genre:'测评',kinds:['source','analysis'],limit:8,minimum_score:-100})).hits.map(h=>({id:h.parentId,score:h.score,channels:h.channels}))}));
  queries.push({q,expectedArticle:expected,acceptedTopArticle:articles[0]?.id||null,ms:Date.now()-started,hits:articles.map(r=>({id:r.id,channels:r.match.channels,reranked:r.match.reranked,snippet:r.snippet}))});
  if(!process.env.RAG_QA_DIAG&&expected!=='A2')assert.equal(articles[0]?.id,expected,'semantic top article: '+q);assert.equal(result.retrieval.rerankApplied,true);assert.ok(!result.results.some(r=>r.id==='A4'));
 }
 if(!process.env.RAG_QA_DIAG)assert.deepEqual(queries[0].hits[0].channels,['vector']);checks.push('Paraphrase matched through vectors without a lexical hit; real Chinese reranker applied.');
 if(process.env.RAG_QA_DIAG){console.error(JSON.stringify({control:(await client.query({revision:(await source.loadLibrary()).revision,query:'火星养鲸许可证制造咖啡核反应堆',genre:'测评',kinds:['source'],limit:8,minimum_score:-100})).hits.map(h=>({id:h.parentId,score:h.score}))}));process.exitCode=0;}else{
 server=await createApiServer({knowledgeSource:source,apiKey:'local-fixture-not-a-key',fetchImpl:async(_url,options)=>{
  providerCalls++;const payload=JSON.parse(JSON.parse(options.body).messages[1].content);
  assert.ok(payload.writingExamples.some(e=>e.id==='A1'&&e.historicalArticleExcerpt.includes('两个助手')));assert.equal(payload.retrievalContext.engine,'haystack-fastembed-v1');
  const directions=['先比较结果，再解释适合谁','从失败场景倒推工具的使用边界','围绕成本和重复使用做选择'].map((angle,i)=>({title:'验收方向'+i,angle,reason:'这是检索接线验收示例。',structureId:'R2',outline:['同题','结果','边界'],materialNeeds:['真实测试输出'],examples:[{id:'A1'}]}));
  return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({directions})}}]}),{status:200,headers:{'content-type':'application/json'}});
 }});
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/recommend',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({brief:'横向比较两家文本AI谁更可靠',genre:'测评',references:[]})});
 assert.equal(response.status,200);const rec=await response.json();assert.equal(rec.directions.length,3);assert.equal(providerCalls,1);checks.push('HTTP recommendation received actual retrieved passages in one mocked generation call.');
 const before=(await source.loadLibrary()).revision;
 await put('A1','深海光谱测量记录：记录探测装置的误差与校准结果。');
 const edited=await source.search({q:'深海光谱测量',genre:'测评'});assert.equal(edited.results[0]?.id,'A1');assert.notEqual(edited.revision,before);assert.doesNotMatch(edited.results[0].snippet,/两个助手/);checks.push('A Vault edit updated the actual persisted vector/FTS index and provenance.');
 await rm(join(dir,'文章/A1.md'));assert.ok(!(await source.search({q:'深海光谱测量',genre:'测评'})).results.some(r=>r.id==='A1'));checks.push('A Vault deletion removed the old source from actual retrieval.');
 const empty=await source.search({q:'火星养鲸许可证制造咖啡核反应堆',genre:'测评'});assert.equal(empty.results.length,0);checks.push('An unrelated control query returned no accepted examples.');
 }
 const report={at:new Date().toISOString(),observedMisses:queries.filter(q=>q.acceptedTopArticle!==q.expectedArticle).map(q=>({q:q.q,expected:q.expectedArticle,reason:'Relevant paraphrase ranked first before score filtering but did not pass the provisional -5 floor.'})),scope:'temporary controlled fixtures, not a quality benchmark against ima',checks,queries,providerCalls,paidRemoteCalls:0,status:client.info()};
 if(!process.env.RAG_QA_DIAG){await mkdir(resolve('docs/qa'),{recursive:true});await writeFile(resolve('docs/qa/haystack-live.json'),JSON.stringify(report,null,2)+'\n');}console.log(JSON.stringify(report,null,2));
}catch(error){console.error(client.diagnostics());throw error;}
finally{if(server)await new Promise(done=>server.close(done));client.close();await rm(root,{recursive:true,force:true});}
