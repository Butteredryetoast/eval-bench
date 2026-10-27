import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createStore} from '../packages/core/db';
import {CasebenchService} from '../packages/core/service';
import {ConversationService,conversationTotals} from '../packages/core/conversations';
import {EditorialService} from '../packages/core/editorial';
import {seedStore} from '../packages/core/seed';
import {publicProfile} from '../packages/core/config';
import {makeArchive} from '../packages/core/export';
import {UNKNOWN_USAGE,type LocalProfile,type ConversationTurn} from '../packages/contracts';
import {findAgent,usageDifference} from '../scripts/agent-runtime.mjs';
const profile:LocalProfile={id:'chatgpt-session',agentId:'gpt',name:'GPT',vendor:'OpenAI',model:'test-model',adapter:'command',program:process.execPath,args:[],color:'#242832',modes:['text'],supportsTemperature:false};
async function fixture(persistent=false){const store=await createStore(await mkdtemp('/private/tmp/casebench-conversations-'),persistent?undefined:':memory:');const s=new CasebenchService(store,async()=>[{id:'gpt',name:'GPT',profileId:profile.id,ready:true,detail:'',models:[{id:'test-model',name:'test',family:'test',isDefault:true}]}]);s.catalog=async()=>[publicProfile(profile)];await seedStore(store);const entry=(await s.listCases()).find(c=>c.executionMode==='text')!;const run=await s.createRun({caseIds:[entry.id],models:[{profileId:profile.id,model:'test-model'}],concurrency:1,timeoutSeconds:600,requestKey:randomUUID()});const device=await s.registerDevice('test'),claim=await s.claim(run.id,device.id),start=await s.beginAttempt(run.id,run.results[0].id,device.id,claim.generation);
 await s.completeAttempt(run.id,start.attemptId,device.id,claim.generation,{status:'succeeded',outputText:'不可覆盖的首轮',durationMs:1200,usage:{...UNKNOWN_USAGE,inputTokens:100,outputTokens:20,source:'reported'},metadata:{agentId:'gpt',threadId:'019a0000-1234-7123-8123-123456789abc',turnId:'native-initial',activeDurationMs:1000}});
 const c=new ConversationService(s),record=(await c.attach(start.attemptId))!;return{store,s,c,run,device,record,attemptId:start.attemptId};}
test('统一实例保留待执行与失败、汇总会话用量，引用固定选中轮次',async()=>{const{store,s,c,record,attemptId,run}=await fixture();try{
 const e=new EditorialService(s);
 await c.importNative(record.id,[{id:'native-initial',status:'completed',items:[]},{id:'followup-output',status:'completed',items:[{type:'userMessage',content:[{type:'text',text:'具体追问'}]},{type:'agentMessage',text:'第二轮的真实输出',phase:'final_answer'}]}],false);
 const session=await c.get(record.id),followup=session.turns[1].attempt;assert.equal((await c.attach(followup.id))!.id,record.id);
 const items=await e.instances(),item=items.find(i=>i.id===attemptId)!;
 assert.equal(item.metrics?.rounds,2);assert.equal(item.metrics?.inputTokens,100);assert.equal(item.metrics?.durationMs,1000);assert.equal(item.metrics?.partial,true);
 const snapshot=await e.snapshot({kind:'instance',id:followup.id,parts:['output'],includeMetrics:true});assert.equal(snapshot.output,'第二轮的真实输出');const withPrompt=await e.snapshot({kind:'instance',id:followup.id});assert.match(withPrompt.task,/具体追问/);assert.doesNotMatch(snapshot.output,/首轮/);
 const pending=await s.createRun({caseIds:[run.spec.cases[0].id],models:[{profileId:profile.id,model:'test-model'}],concurrency:1,timeoutSeconds:600,requestKey:randomUUID()});
 assert.equal((await e.instances()).find(i=>i.runId===pending.id)?.status,'pending');
 const device=await s.registerDevice('failure fixture'),claim=await s.claim(pending.id,device.id),started=await s.beginAttempt(pending.id,pending.results[0].id,device.id,claim.generation);
 await s.completeAttempt(pending.id,started.attemptId,device.id,claim.generation,{status:'failed',outputText:'',error:'fixture failure',usage:UNKNOWN_USAGE});
 const failed=(await e.instances()).find(i=>i.attemptId===started.attemptId)!;assert.equal(failed.status,'failed');assert.equal(failed.metrics?.inputTokens,null);
 await assert.rejects(e.snapshot({kind:'instance',id:started.attemptId}),/已完成/);
 }finally{await store.close();}});
test('会话逐轮归档、并发互斥、幂等发送、停止和版本评审，首轮保持不变',async()=>{const f=await fixture();const {store,s,c,run,device,record,attemptId}=f;try{
 assert.equal(record.turns.length,1);await s.annotate(attemptId,{verdict:'usable',note:'首轮判定',revision:0});const key=randomUUID();const sends=await Promise.all([c.enqueue(record.id,{prompt:'修改第二版',requestKey:key}),c.enqueue(record.id,{prompt:'修改第二版',requestKey:key})]);assert.equal(sends[0].turnId,sends[1].turnId);const turnId=sends[0].turnId;assert.equal((await c.get(record.id)).turns.length,2);
 await assert.rejects(c.enqueue(record.id,{prompt:'并发消息',requestKey:randomUUID()}),/仍在执行/);await assert.rejects(c.enqueue(record.id,{prompt:'改变同一请求',requestKey:key}),/其他消息/);
 const workers=await Promise.all([c.claim(turnId,device.id),c.claim(turnId,device.id)]),job=workers.find(w=>w.claimed)!;assert.equal(workers.filter(w=>w.claimed).length,1);assert.ok(job.claimed);if(!job.claimed)throw Error();
 const progress={seq:2,outputText:'较新的内容',usage:{...UNKNOWN_USAGE,inputTokens:50,outputTokens:10,source:'reported'},metadata:{agentId:'gpt',threadId:record.nativeThreadId,turnId:'native-second',activeDurationMs:400}};
 await c.progress(turnId,device.id,job.lease,progress);await c.progress(turnId,device.id,job.lease,{...progress,seq:1,outputText:'过期内容'});assert.equal((await c.get(record.id)).turns[1].attempt.outputText,'较新的内容');await assert.rejects(c.progress(turnId,device.id,'wrong',progress),/授权/);
 await c.stop(record.id);assert.equal((await c.progress(turnId,device.id,job.lease,{...progress,seq:3})).cancelRequested,true);
 const file=await c.upload(turnId,device.id,job.lease,Buffer.from('部分产物'),'partial.md','text/markdown','file_'+randomUUID().replaceAll('-',''));
 const completion={status:'cancelled',outputText:'停止前的部分产物',durationMs:500,usage:progress.usage,metadata:progress.metadata,error:'用户停止'};
 await c.complete(turnId,device.id,job.lease,completion);await c.complete(turnId,device.id,job.lease,completion);await assert.rejects(c.complete(turnId,device.id,job.lease,{...completion,outputText:'覆盖归档'}),/不可覆盖/);assert.equal((await s.fileBytes(file.id)).toString(),'部分产物');
 const failed=(await c.get(record.id)).turns[1].attempt.id;const retry=await c.enqueue(record.id,{prompt:'修改第二版',requestKey:randomUUID(),retryTurnId:turnId});assert.equal(retry.turnId,turnId);const job2=await c.claim(turnId,device.id);assert.ok(job2.claimed);if(!job2.claimed)throw Error();
 await c.complete(turnId,device.id,job2.lease,{status:'succeeded',outputText:'重试的新版本',usage:{...UNKNOWN_USAGE,inputTokens:70,outputTokens:14,source:'reported'},metadata:{agentId:'gpt',threadId:record.nativeThreadId,turnId:'native-retry',activeDurationMs:600}});
 const final=await c.get(record.id);assert.equal(final.turns.length,2);assert.equal(final.turns[1].retryCount,1);assert.equal(final.turns[1].previousAttempts?.[0].id,failed);assert.equal(final.totals.inputTokens,220);assert.equal(final.totals.outputTokens,44);assert.equal(final.totals.durationMs,2000);assert.equal(final.totals.attempts,3);assert.equal(final.totals.retries,1);
 assert.equal((await s.getAttempt(failed)).result.attempt?.outputText,'停止前的部分产物');await s.annotate(final.turns[1].attempt.id,{verdict:'pending',note:'仅第二轮',revision:0});assert.equal((await s.getAttempt(attemptId)).result.attempt?.annotation.note,'首轮判定');const base=await s.getRun(run.id);assert.equal(base.results[0].attempt?.outputText,'不可覆盖的首轮');assert.equal(base.results[0].attemptCount,1);assert.equal(base.status,'completed');
 const archive=makeArchive(s,base,'http://localhost');const chunks=[];for await(const chunk of archive)chunks.push(chunk);const bytes=Buffer.concat(chunks);assert.ok(bytes.includes(Buffer.from('conversation.json')));assert.ok(bytes.includes(Buffer.from(`round-2/${failed}`)));
 }finally{await store.close();}});
test('同步原生历史只导入新的用户轮次，进行中与未知用量保持真实状态',async()=>{const{store,c,s,record,attemptId}=await fixture();try{
 const native=[{id:'native-initial',status:'completed',items:[{type:'userMessage',content:[{type:'text',text:'初始提示'}]},{type:'agentMessage',text:'不要覆盖本站归档',phase:'final_answer'}]},{id:'native-desktop',status:'inProgress',items:[{type:'userMessage',content:[{type:'text',text:'桌面追问'}]},{type:'agentMessage',text:'桌面实时输出',phase:'final_answer'}]}];
 await c.importNative(record.id,native,true);await c.importNative(record.id,native,true);let r=await c.get(record.id);assert.equal(r.turns.length,2);assert.equal(r.busy,true);assert.equal(r.turns[1].source,'desktop');assert.equal(r.turns[1].attempt.usage.inputTokens,null);assert.equal(r.totals.reportedRounds,1);assert.equal(r.totals.inputTokens,100);
 await assert.rejects(c.enqueue(record.id,{prompt:'不抢占桌面任务',requestKey:randomUUID()}),/仍在执行/);
 native[1].status='completed';native[1].items[1].text='桌面完成输出';await c.importNative(record.id,native,false);r=await c.get(record.id);assert.equal(r.busy,false);assert.equal(r.turns[1].attempt.status,'succeeded');assert.equal(r.turns[1].attempt.outputText,'桌面完成输出');assert.equal((await s.getAttempt(attemptId)).result.attempt?.outputText,'不可覆盖的首轮');
 }finally{await store.close();}});
test('用量事件采用累计差值，重复通知不重复计数；未知不等于零',()=>{
 assert.deepEqual(usageDifference({inputTokens:250,outputTokens:55,cachedInputTokens:20},{inputTokens:100,outputTokens:20,cachedInputTokens:10}),{...UNKNOWN_USAGE,inputTokens:150,outputTokens:35,cachedTokens:10,source:'reported'});
 assert.equal(usageDifference({inputTokens:50},{inputTokens:100}).inputTokens,null);assert.equal(usageDifference({inputTokens:10},null).inputTokens,null);
 const totals=conversationTotals([{attempt:{status:'failed',durationMs:null,usage:{...UNKNOWN_USAGE}},retryCount:0} as ConversationTurn]);assert.equal(totals.inputTokens,null);assert.equal(totals.durationMs,null);
});
test('程序位置按覆盖配置、应用安装和 PATH 发现，不依赖开发机器路径',async()=>{
 const exists=async(p:string)=>p==='/new/GPT/codex'||p==='/custom/bin/codex';const env={PATH:'/custom/bin',CASEBENCH_GPT_PROGRAM:'/new/GPT/codex'};
 assert.equal((await findAgent('gpt',{env,platform:'linux',home:'/new-user',exists}))?.path,'/new/GPT/codex');
 assert.equal((await findAgent('gpt',{env:{PATH:'/custom/bin'},platform:'linux',home:'/new-user',exists}))?.path,'/custom/bin/codex');assert.equal(await findAgent('unknown',{env,exists}),null);
 const base={...profile,discovered:true};assert.equal(publicProfile(base).configHash,publicProfile({...base,program:'/another/machine/node',args:['new/location'],harnessVersion:'updated'}).configHash);
 assert.notEqual(publicProfile(profile).configHash,publicProfile({...profile,program:'/changed'}).configHash);
});

test('重启后会话、待执行消息和原请求编号仍可恢复，不重复登记推理',async()=>{
 const f=await fixture(true);const key=randomUUID();const created=await f.c.enqueue(f.record.id,{prompt:'重启后继续',requestKey:key});const directory=f.store.directory;await f.store.close();
 const store=await createStore(directory);try{const c=new ConversationService(new CasebenchService(store));const restored=await c.get(f.record.id);assert.equal(restored.turns.length,2);assert.equal(restored.busy,true);assert.equal(restored.turns[1].attempt.status,'pending');assert.equal(restored.turns[0].attempt.outputText,'不可覆盖的首轮');const repeated=await c.enqueue(f.record.id,{prompt:'重启后继续',requestKey:key});assert.equal(repeated.turnId,created.turnId);assert.equal(repeated.conversation.turns.length,2);}finally{await store.close();}
});
