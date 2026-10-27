import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createContextServer} from './context-server.mjs';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createKnowledgeSource} from './project/server/knowledge.mjs';
const token='test-only-private-bridge-123456';
test('authenticated retrieval projects current writing references without exposing local paths or making model calls',async()=>{
 let input;const server=createContextServer({token,library:async()=>({revision:'r1',stats:{articles:1}}),lookup:async v=>{input=v;return {revision:'r1',retrieval:{engine:'local-bm25-rrf-v1'},templates:[{id:'A1',name:'消息推进',notePath:'/private/vault'}],examples:[{id:'a1',title:'写法示例',notePath:'/secret',obsidianUrl:'obsidian://secret',contentExcerpt:'文本片段',evidenceLevel:'candidate'}]};},skill:async()=>({id:'humanizer-zh',revision:'skill1',instructions:'规则'})});
 server.listen(0,'127.0.0.1');await once(server,'listening');const url='http://127.0.0.1:'+server.address().port;
 try{
  assert.equal((await fetch(url+'/health')).status,401);
  const response=await fetch(url+'/context',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({brief:'写一篇资讯',genre:'资讯',references:[{id:'r1',title:'本篇消息',content:'真实事实'}]})});assert.equal(response.status,200);const body=await response.json();assert.equal(body.modelCalls,0);assert.equal(body.examples[0].evidenceLevel,'candidate');assert.equal(input.references[0].content,'真实事实');assert.doesNotMatch(JSON.stringify(body),/obsidian:|\/secret|\/private\/vault/);
  assert.equal((await fetch(url+'/generate',{method:'POST',headers:{authorization:'Bearer '+token}})).status,404);
  assert.equal((await fetch(url+'/context',{method:'POST',headers:{authorization:'Bearer '+token},body:'{}'})).status,400);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('health does not report connected when the supplied retrieval engine has failed',async()=>{
 const server=createContextServer({token,library:async()=>({revision:'r1',source:{retrieval:{engine:'haystack-fastembed-v1',phase:'error',ready:false}}})});server.listen(0,'127.0.0.1');await once(server,'listening');
 try{const response=await fetch('http://127.0.0.1:'+server.address().port+'/health',{headers:{authorization:'Bearer '+token}});assert.equal(response.status,503);assert.equal((await response.json()).ready,false);}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('bridge runs the supplied live Obsidian retriever and pinned writing rules on an isolated fixture vault',async()=>{
 const root=await mkdtemp(join(tmpdir(),'writing-bridge-vault-'));await mkdir(join(root,'库/结构'),{recursive:true});await mkdir(join(root,'库/文章'));
 await writeFile(join(root,'库/结构/N1.md'),'---\n类型: 写作结构\n体裁: 资讯\n结构代码: N1\n结构名称: 消息解释\n---\n# N1 消息解释\n\n## 推进顺序\n1. 变化\n2. 背景');
 const note=join(root,'库/文章/A1.md'),content='---\n类型: 文章拆解\n文章ID: A1\n标题: 检索接口验证\n体裁: 资讯\n结构代码: N1\n复核状态: 自动候选\n---\n# 检索接口验证\n\n## 来源与正文转写\n磁悬浮体验是此隔离样本的独有主题。';await writeFile(note,content);
 const source=createKnowledgeSource({vaultPath:root,libraryPath:'库',engine:'local'}),server=createContextServer({token,library:source.loadLibrary,lookup:source.retrieve});server.listen(0,'127.0.0.1');await once(server,'listening');const url='http://127.0.0.1:'+server.address().port,headers={authorization:'Bearer '+token};
 try{assert.equal((await fetch(url+'/health',{headers})).status,200);const result=await fetch(url+'/context',{method:'POST',headers,body:JSON.stringify({brief:'磁悬浮体验资讯',genre:'资讯',references:[]})});assert.equal(result.status,200);const data=await result.json();assert.equal(data.examples[0].id,'A1');assert.equal(data.engine,'local-bm25-rrf-v1');assert.match(data.examples[0].contentExcerpt,/磁悬浮体验/);assert.equal(data.writingSkill.id,'humanizer-zh');assert.ok(data.writingSkill.instructions.length>1000);assert.equal(data.modelCalls,0);assert.doesNotMatch(JSON.stringify(data),/obsidian:\/\/|notePath|libraryPath/);}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));source.close();await rm(root,{recursive:true,force:true});}
});
