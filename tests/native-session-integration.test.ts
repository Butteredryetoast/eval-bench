import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createStore} from '../packages/core/db';
import {createNativeFixture} from './fixtures/mock-native';
import {GET,POST} from '../apps/web/app/api/[...path]/route';
import type {RunRecord,ConversationRecord} from '../packages/contracts';
test('网页 HTTP 与独立 Runner 支持三个新增 Agent，追问沿用各自会话且不改首轮',{timeout:60000},async()=>{
 const directory=await mkdtemp('/private/tmp/casebench-native-http-'),program=await createNativeFixture(directory);
 const updates={CASEBENCH_ROOT:process.cwd(),CASEBENCH_DATA_DIR:directory,CASEBENCH_ENABLED_AGENTS:'workbuddy,deepseek,minimax',CASEBENCH_WORKBUDDY_PROGRAM:program,CASEBENCH_DEEPSEEK_PROGRAM:program,CASEBENCH_MINIMAX_PROGRAM:program};
 const before=Object.fromEntries(Object.keys(updates).map(k=>[k,process.env[k]]));Object.assign(process.env,updates);
 const store=await createStore(directory,':memory:'),global=globalThis as any,oldStore=global.casebenchStore;global.casebenchStore=Promise.resolve(store);
 const server=createServer(async(req,res)=>{try{const chunks=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const body=Buffer.concat(chunks);const response=await(req.method==='GET'?GET:POST)(new Request(`http://${req.headers.host}${req.url}`,{method:req.method,headers:req.headers as any,...(req.method==='GET'?{}:{body})}),{params:Promise.resolve({path:req.url!.split('?')[0].split('/').slice(2)})});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch(e){res.writeHead(500);res.end(JSON.stringify({error:String(e)}));}});
 try{
  server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${(server.address() as any).port}`;
  const call=async<T=any>(p:string,body?:unknown):Promise<T>=>{const r=await fetch(origin+'/api/'+p,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();assert.equal(r.ok,true,JSON.stringify(data));return data;};
  const wait=async<T>(read:()=>Promise<T>,done:(v:T)=>boolean)=>{for(let i=0;i<160;i++){const data=await read();if(done(data))return data;await new Promise(r=>setTimeout(r,100));}throw Error('等待任务超时');};
  const catalog=await call<any[]>('agents?refresh=1');const entry=(await call<any[]>('cases')).find(c=>c.executionMode==='text'&&!c.inputs.length);
  for(const id of ['workbuddy','deepseek','minimax']){
   const agent=catalog.find(a=>a.id===id)!;assert.equal(agent.ready,true);const model=agent.models.find((m:any)=>m.id==='test-model');assert.ok(model);
   const run=await call<RunRecord>('runs',{caseIds:[entry.id],models:[{profileId:agent.profileId,model:model.id}],concurrency:1,timeoutSeconds:600,requestKey:randomUUID()});await call(`runs/${run.id}/start-local`,{});
   const complete=await wait(()=>call<RunRecord>(`runs/${run.id}`),r=>r.status==='completed'||r.status==='failed');assert.equal(complete.status,'completed',complete.results[0].attempt?.error||'');const a=complete.results[0].attempt!;assert.equal(a.metadata?.agentId,id);assert.ok(a.usage.inputTokens!>0);
   const record=await call<ConversationRecord>(`attempts/${a.id}/conversation`);assert.equal(record.agentId,id);assert.equal(record.canSyncNative,false);await call(`conversations/${record.id}/turns`,{prompt:'继续修改',requestKey:randomUUID()});
   const continued=await wait(()=>call<ConversationRecord>(`conversations/${record.id}`),c=>!c.busy&&c.turns.length===2);assert.equal(continued.turns[1].attempt.status,'succeeded',continued.turns[1].attempt.error||'');assert.equal(continued.turns[1].attempt.metadata?.threadId,a.metadata?.threadId);assert.equal(continued.turns[0].attempt.outputText,a.outputText);assert.equal(continued.totals.rounds,2);if(id==='workbuddy'){assert.equal(continued.totals.inputTokens,60);assert.equal(continued.totals.outputTokens,12);}assert.ok(continued.totals.inputTokens!>a.usage.inputTokens!);
   const sync=await call<ConversationRecord>(`conversations/${record.id}/sync`,{});assert.equal(sync.turns.length,2);assert.equal((await call<RunRecord>(`runs/${run.id}`)).results[0].attempt?.id,a.id);
  }
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await store.close();global.casebenchStore=oldStore;for(const[k,v]of Object.entries(before)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
