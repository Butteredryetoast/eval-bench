import {blueprintMarkdown} from './fixtures/news-blueprint.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {createApiServer} from '../server/api.mjs';
import {createKnowledgeSource} from '../server/knowledge.mjs';
import {createQaProviderServer,QA_API_KEY} from '../scripts/qa-server.mjs';
const template=name=>`---\n类型: 写作结构\n体裁: 资讯\n结构代码: N1\n结构名称: ${name}\n---\n# N1 ${name}\n\n## 推进顺序\n1. 变化\n2. 背景\n3. 边界`;
async function listen(s){s.listen(0,'127.0.0.1');await once(s,'listening');return `http://127.0.0.1:${s.address().port}`;}
async function close(s){s.closeAllConnections?.();await new Promise(r=>s.close(r));}
async function withFixture(options,fn){const root=await mkdtemp(join(tmpdir(),'vault-api-'));await mkdir(join(root,'库/结构'),{recursive:true});await mkdir(join(root,'库/文章'));const path=join(root,'库/结构/N1.md');await writeFile(path,template('消息解释'));await writeFile(join(root,'库/文章/A1.md'),'---\n类型: 文章拆解\n文章ID: A1\n标题: 星系用例\n体裁: 资讯\n结构代码: N1\n发布日期: "2025-01-01"\n---\n# 星系用例\n\n星系独有检索词。');
 await writeFile(join(root,'库/NEWS-TEST.md'),blueprintMarkdown);
 const source=createKnowledgeSource({vaultPath:root,libraryPath:'库'}),provider=createQaProviderServer();const providerUrl=await listen(provider);let api;try{api=await createApiServer({knowledgeSource:source,apiKey:QA_API_KEY,baseUrl:providerUrl,maxRetries:0,...options});await fn({base:await listen(api),provider,path,root,source});}finally{if(api)await close(api);await close(provider);await rm(root,{recursive:true,force:true});}}
const input={brief:'解释新的星系产品变化',genre:'资讯',references:[]};
const post=(base,path,body)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
test('API knowledge search works without model key and shows current note additions and edits',async()=>withFixture({apiKey:''},async({base,root,path})=>{
 const health=await(await fetch(base+'/api/health')).json();assert.equal(health.configured,false);assert.equal(health.library.articles,1);assert.equal(health.knowledge.connected,true);
 const found=await fetch(base+'/api/knowledge/search?q='+encodeURIComponent('星系独有'));assert.equal(found.status,200);const data=await found.json();assert.equal(data.results[0].id,'A1');assert.match(data.results[0].obsidianUrl,/^obsidian:/);
 await writeFile(path,template('用户刚改的模板'));const next=await(await fetch(base+'/api/library')).json();assert.equal(next.templates[0].name,'用户刚改的模板');assert.notEqual(next.revision,data.revision);
 assert.equal((await post(base,'/api/recommend',input)).status,503);
}));
test('vault edits invalidate a confirmed direction before another model call',async()=>withFixture({},async({base,path,provider})=>{
 const recResponse=await post(base,'/api/recommend',input);assert.equal(recResponse.status,200);const rec=await recResponse.json();assert.ok(rec.knowledge?.revision);
 assert.match(rec.directions[0].examples[0].obsidianUrl,/^obsidian:/);await writeFile(path,template('已更新的结构'));
 const generated=await post(base,'/api/generate',{...input,recommendationId:rec.recommendationId,directionId:rec.directions[0].id});assert.equal(generated.status,409);assert.equal((await generated.json()).error.code,'KNOWLEDGE_CHANGED');assert.equal(provider.qaRequests.length,1);
}));
test('an unavailable vault remains an explicit disconnected source without static fallback',async()=>{
 const root=await mkdtemp(join(tmpdir(),'missing-vault-'));const source=createKnowledgeSource({vaultPath:join(root,'not-there'),libraryPath:'库'});const server=await createApiServer({knowledgeSource:source,apiKey:''});try{const base=await listen(server);const h=await(await fetch(base+'/api/health')).json();assert.equal(h.knowledge.connected,false);assert.equal(h.library,null);const r=await fetch(base+'/api/library');assert.equal(r.status,503);assert.equal((await r.json()).error.code,'KNOWLEDGE_UNAVAILABLE');}finally{await close(server);await rm(root,{recursive:true,force:true});}
});
