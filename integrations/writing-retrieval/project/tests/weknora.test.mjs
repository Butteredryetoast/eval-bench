import test from 'node:test';
import assert from 'node:assert/strict';
import {createWeKnoraClient} from '../server/weknora.mjs';

test('hybrid retrieval uses the scoped API and preserves channel/rerank diagnostics without a chat call',async()=>{
 const calls=[];
 const client=createWeKnoraClient({baseUrl:'http://127.0.0.1:18080',apiKey:'test-key',knowledgeBaseId:'kb-1',fetchImpl:async(url,options)=>{
  calls.push({url,options});return Response.json({success:true,data:[{knowledge_id:'doc-1',content:'真实片段',score:.028,match_type:0}],meta:{rerank:{applied:false,outcome:'disabled'}}});
 }});
 const result=await client.search({query:'读者要排查故障，已有错误日志',limit:30,knowledgeIds:['doc-1']});
 assert.equal(calls.length,1);assert.equal(calls[0].url,'http://127.0.0.1:18080/api/v1/knowledge-bases/kb-1/hybrid-search');
 assert.equal(calls[0].options.headers['X-API-Key'],'test-key');assert.equal(calls[0].options.redirect,'error');
 const payload=JSON.parse(calls[0].options.body);assert.equal(payload.query_text,'读者要排查故障，已有错误日志');assert.deepEqual(payload.knowledge_ids,['doc-1']);assert.equal(payload.match_count,30);assert.equal(payload.rerank,undefined);
 assert.equal(result.hits[0].match_type,0);assert.equal(result.meta.rerank.applied,false);
});
test('rerank is explicitly requested only with a configured model, without confusing fusion scores with vector thresholds',async()=>{
 let body;
 const client=createWeKnoraClient({baseUrl:'https://retrieval.example',apiKey:'test',knowledgeBaseId:'kb',rerankModelId:'rerank-1',vectorThreshold:.25,fetchImpl:async(url,options)=>{body=JSON.parse(options.body);return Response.json({success:true,data:[],meta:{rerank:{applied:true,outcome:'all_below_threshold'}}});}});
 const result=await client.search({query:'结构适配',limit:12});assert.equal(body.vector_threshold,.25);assert.equal(body.rerank.model_id,'rerank-1');assert.equal(result.hits.length,0);
});
test('manual notes can be created, updated and queued for deletion using the documented API',async()=>{
 const calls=[];const client=createWeKnoraClient({baseUrl:'http://127.0.0.1:18080',apiKey:'test',knowledgeBaseId:'kb',fetchImpl:async(url,options)=>{calls.push({url,options});return Response.json({success:true,data:{id:'doc-1'}});}});
 await client.createNote({title:'[article:A1] 标题',content:'完整正文'});await client.updateNote('doc-1',{title:'新标题',content:'已更新正文'});await client.deleteNote('doc-1');
 assert.match(calls[0].url,/\/knowledge-bases\/kb\/knowledge\/manual$/);assert.equal(JSON.parse(calls[0].options.body).content,'完整正文');assert.match(calls[1].url,/\/knowledge\/manual\/doc-1$/);assert.equal(calls[1].options.method,'PUT');assert.equal(calls[2].options.method,'DELETE');
});
test('backend errors and invalid response shapes never masquerade as empty successful retrievals or expose credentials',async()=>{
 for(const response of [new Response('secret provider details',{status:401}),Response.json({success:false,message:'sensitive provider details'}),Response.json({success:true,data:{wrong:'shape'}})]){
  const client=createWeKnoraClient({baseUrl:'https://retrieval.example',apiKey:'private-test-key',knowledgeBaseId:'kb',fetchImpl:async()=>response});
  await assert.rejects(client.search({query:'test'}),error=>error.code==='WEKNORA_UNAVAILABLE'&&!/private-test-key|provider details/.test(error.message));
 }
});
