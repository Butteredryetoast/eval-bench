import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {saveKnowledgeConfig,knowledgeStatus} from '../packages/core/writing-knowledge';
import {EditorialService} from '../packages/core/editorial';
import {CasebenchService} from '../packages/core/service';
import {createStore} from '../packages/core/db';
import {UNKNOWN_USAGE,type LocalProfile} from '../packages/contracts';
test('writing uses the private knowledge bridge once and retains editor persistence, metrics and isolated article context',async()=>{
 const dir=await mkdtemp('/private/tmp/writing-knowledge-'),old=process.env.CASEBENCH_DATA_DIR;process.env.CASEBENCH_DATA_DIR=dir;const store=await createStore(dir);let requests:any[]=[],fail=false,calls=0,prompt='';
 const server=createServer(async(req,res)=>{assert.equal(req.headers.authorization,'Bearer test-knowledge-token-123456789');res.setHeader('content-type','application/json');if(req.url==='/health'){res.end(JSON.stringify({ready:true}));return;}let body='';for await(const c of req)body+=c;requests.push(JSON.parse(body));if(fail){res.statusCode=503;res.end('{}');return;}res.end(JSON.stringify({revision:'vault-r1',engine:'local-bm25-rrf-v1',templates:[{id:'A1',name:'叙事顺序'}],examples:[{id:'a1',contentExcerpt:'WRITING_PATTERN_ONLY',evidenceLevel:'candidate'}],writingSkill:{instructions:'INLINE_RULES'}}));});server.listen(0,'127.0.0.1');await once(server,'listening');
 const profile:LocalProfile={id:'qa-api',name:'QA writer',vendor:'QA',model:'test-model',adapter:'api',color:'#111111',modes:['text'],supportsTemperature:false,baseUrl:'http://127.0.0.1',apiKeyEnv:'QA_KEY'};
 try{
  const safe=await saveKnowledgeConfig({enabled:true,url:'http://127.0.0.1:'+(server.address() as any).port,token:'test-knowledge-token-123456789'});assert.equal('token' in safe,false);assert.equal((await stat(dir+'/writing-knowledge.json')).mode&0o777,0o600);assert.equal((await knowledgeStatus(true)).ready,true);
  const service=new EditorialService(new CasebenchService(store),{profiles:async()=>[profile],execute:async input=>{calls++;prompt=input.case.prompt;return {text:JSON.stringify({action:'discuss',text:'依据资料讨论',target:'document'}),usage:UNKNOWN_USAGE,exitCode:0,reportedModel:profile.model,logs:''};}});
  const source=await service.addSource({title:'本篇事实',summary:'CURRENT_FACTS'}),other=await service.addSource({title:'别篇资料',summary:'OTHER_ARTICLE_FACTS'});const a=await service.create({references:[{kind:'source',id:source.id}]});await service.create({references:[{kind:'source',id:other.id}]});
  async function send(revision:number){let next=await service.send(a.id,{text:'请讨论资讯的写法',profileId:profile.id,model:profile.model,requestKey:randomUUID(),revision,purpose:'auto'});for(let i=0;i<100&&next.messages.at(-1)?.status==='pending';i++){await new Promise(r=>setTimeout(r,20));next=await service.article(a.id);}return next;}
  const done=await send(0);assert.equal(done.messages.at(-1)?.status,'complete');assert.equal(calls,1);assert.equal(requests.length,1);assert.match(prompt,/WRITING_PATTERN_ONLY/);assert.match(prompt,/INLINE_RULES/);assert.match(prompt,/CURRENT_FACTS/);assert.doesNotMatch(prompt,/OTHER_ARTICLE_FACTS/);assert.equal(done.messages.at(-1)?.knowledge?.revision,'vault-r1');assert.ok(done.messages.at(-1)?.durationMs!=null);
  fail=true;const failed=await send(done.revision);assert.equal(failed.messages.at(-1)?.status,'failed');assert.equal(calls,1);assert.match(failed.messages.at(-1)?.error||'',/知识库/);assert.equal(failed.messages[1].text,done.messages[1].text);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await store.close();await rm(dir,{recursive:true,force:true});if(old===undefined)delete process.env.CASEBENCH_DATA_DIR;else process.env.CASEBENCH_DATA_DIR=old;}
});
