import test from 'node:test';
import assert from 'node:assert/strict';
import {createApiServer} from '../server/api.mjs';
import {newsFixture} from './fixtures/news-contract.mjs';
async function fixture(fn,{bad=false,noBlueprints=false}={}){
 const {b,references,raw}=newsFixture(),library={revision:'lib-v1',templates:[{id:'N1',genre:'资讯',name:'解释变化',sequence:['事实','边界'],notePath:'/Users/private/Vault/template.md',obsidianUrl:'obsidian://open?vault=test&file=N1'}],articles:[],blueprints:noBlueprints?[]:[b],stats:{}},calls=[];
 const server=await createApiServer({library,apiKey:'fixture',maxRetries:0,retrieve:async()=>({templates:library.templates,blueprints:library.blueprints,examples:[],revision:library.revision}),fetchImpl:async(_url,options)=>{
  const messages=JSON.parse(options.body).messages,p=JSON.parse(messages[1].content);calls.push({p,system:messages[0].content});let output;
  if(p.requestedGenre)output={directions:['先公布变化再解释边界','从读者需求推导使用取舍','以尚未解决的问题组织后续观察'].map((angle,i)=>({title:'方向'+i,angle,reason:'根据当前资料安排证据。',structureId:'N1',outline:['事实','证据与边界'],materialNeeds:['结果对照'],examples:[],narrativePlan:raw}))};
  else if(bad)output={title:'坏稿',structureId:'N1',sourceIds:[],markdown:'已经得出胜负。'.repeat(30)+'【素材位：补证据】',materialSlots:['补证据']};
  else if(p.narrativePlan){output={title:'资讯验收稿',structureId:'N1',sourceIds:['r1'],blocks:p.writableBeats.map(b=>({beatId:b.id,markdown:'当前片段 '+b.id+'，依据用户已经提供的资料组织。'}))};if(p.instruction)output.materialBindings=p.narrativePlan.materials.map(m=>({materialId:m.id,referenceIds:m.referenceIds}));}
  else output={title:'保留人工编辑',structureId:'N1',sourceIds:['r1'],edits:[{before:'作者新增的独有句子。',after:'作者新增的独有句子。修改后的承接。'}]};
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}]});
 }});
 await new Promise(done=>server.listen(0,'127.0.0.1',done));const base='http://127.0.0.1:'+server.address().port;
 const post=async(path,body)=>{const r=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 const input={brief:'解释这次更新的已知变化与证据边界',genre:'资讯',references};
 try{await fn({post,input,calls,library});}finally{await new Promise(done=>server.close(done));}
}
test('news recommend→generate→strict revise keeps material positions in one call each',async()=>fixture(async({post,input,calls})=>{
 const rec=await post('/api/recommend',input);assert.equal(rec.status,200);assert.equal(rec.body.directions[0].narrativePlan.schema,'news-narrative-v1');
 const generated=await post('/api/generate',{...input,recommendationId:rec.body.recommendationId,directionId:rec.body.directions[0].id});assert.equal(generated.status,200);
 const draft=generated.body;assert.ok(draft.markdown.indexOf('【素材位：')<draft.markdown.indexOf('【待写：'));assert.equal(draft.narrative.layoutVerified,true);
 const revised=await post('/api/revise',{...input,draft,instruction:'把承接写短一点'});assert.equal(revised.status,200);assert.equal(revised.body.narrative.layoutVerified,true);assert.equal(calls.length,3);
 assert.match(calls[1].system,/Humanizer|humanizer/);assert.ok(!JSON.stringify(calls.map(c=>c.p)).includes('库/蓝图.md'));assert.ok(!JSON.stringify(calls.map(c=>c.p)).includes('/Users/private/'));
}));
test('news has no silent old-template fallback and rejects the known tail-placeholder bad draft',async()=>{
 await fixture(async({post,input,calls})=>{const rec=await post('/api/recommend',input);assert.equal(rec.status,503);assert.equal(calls.length,0);},{noBlueprints:true});
 await fixture(async({post,input,calls})=>{const rec=await post('/api/recommend',input),r=await post('/api/generate',{...input,recommendationId:rec.body.recommendationId,directionId:rec.body.directions[0].id});assert.equal(r.status,502);assert.equal(calls.length,2);},{bad:true});
});
test('manual edits stay in the revision input and blueprint changes invalidate before another call',async()=>fixture(async({post,input,calls,library})=>{
 const rec=await post('/api/recommend',input),generated=await post('/api/generate',{...input,recommendationId:rec.body.recommendationId,directionId:rec.body.directions[0].id});
 const draft={...generated.body,markdown:generated.body.markdown+'\n\n作者新增的独有句子。'};
 const revised=await post('/api/revise',{...input,draft,instruction:'保留我新增的句子，只改承接'});assert.equal(revised.status,200);assert.match(calls.at(-1).p.draft.markdown,/作者新增/);assert.match(revised.body.markdown,/作者新增/);assert.equal(revised.body.narrative.layoutVerified,false);
 const before=calls.length;library.revision='lib-v2';const stale=await post('/api/generate',{...input,recommendationId:rec.body.recommendationId,directionId:rec.body.directions[0].id});assert.equal(stale.status,409);assert.equal(calls.length,before);
}));
