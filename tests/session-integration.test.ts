import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createStore} from '../packages/core/db';
import {createMockAgent} from './fixtures/mock-agent';
import type {RunRecord,ConversationRecord} from '../packages/contracts';
import {GET,POST} from '../apps/web/app/api/[...path]/route';

test('真实 HTTP → 本地执行器 → 原生协议：首轮、续聊、幂等、用量、停止和归档', {timeout:60000},async()=>{
 const previousAgents=process.env.CASEBENCH_ENABLED_AGENTS;process.env.CASEBENCH_ENABLED_AGENTS='gpt';
 const previous={data:process.env.CASEBENCH_DATA_DIR,program:process.env.CASEBENCH_GPT_PROGRAM,root:process.env.CASEBENCH_ROOT};const directory=await mkdtemp('/private/tmp/casebench-integration-');const mock=await createMockAgent(directory);process.env.CASEBENCH_DATA_DIR=directory;process.env.CASEBENCH_GPT_PROGRAM=mock.program;process.env.CASEBENCH_ROOT=process.cwd();
 const store=await createStore(directory,':memory:');const global=globalThis as any;const previousStore=global.casebenchStore;global.casebenchStore=Promise.resolve(store);
 const server=createServer(async(req,res)=>{try{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const path=req.url!.split('?')[0].split('/').slice(2).map(decodeURIComponent);const request=new Request(`http://${req.headers.host}${req.url}`,{method:req.method,headers:req.headers as Record<string,string>,...(['GET','HEAD'].includes(req.method!)?{}:{body:Buffer.concat(chunks)})});const response=await(req.method==='GET'?GET:POST)(request,{params:Promise.resolve({path})});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch(e){res.writeHead(500);res.end(JSON.stringify({error:String(e)}))}});
 try{
  server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address() as any,origin=`http://127.0.0.1:${address.port}`;
  const call=async<T=any>(route:string,body?:unknown):Promise<T>=>{const r=await fetch(`${origin}/api/${route}`,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();assert.equal(r.ok,true,JSON.stringify(data));return data};
  const wait=async<T>(fn:()=>Promise<T>,check:(x:T)=>boolean)=>{const until=Date.now()+20000;while(Date.now()<until){const data=await fn();if(check(data))return data;await new Promise(r=>setTimeout(r,100));}throw Error('等待执行结果超时')};
  const catalog=await call<any[]>('agents?refresh=1');assert.equal(catalog.find(a=>a.id==='gpt').ready,true);assert.deepEqual(catalog.find(a=>a.id==='gpt').models.map((m:any)=>m.id),['test-model']);
  const cases=await call<any[]>('cases');const entry=cases.find(c=>c.executionMode==='text'&&!c.inputs.length)!;
  const run=await call<RunRecord>('runs',{caseIds:[entry.id],models:[{profileId:'chatgpt-session',model:'test-model'}],concurrency:1,timeoutSeconds:600,requestKey:randomUUID()});await call(`runs/${run.id}/start-local`,{});
  const completed=await wait(()=>call<RunRecord>(`runs/${run.id}`),r=>r.status==='completed');const a=completed.results[0].attempt!;assert.equal(a.outputText,'最终产物 1');assert.equal(a.usage.inputTokens,100);assert.equal(a.usage.outputTokens,20);assert.equal(a.metadata?.activeDurationMs,600);
  const record=await call<ConversationRecord>(`attempts/${a.id}/conversation`);const payload={prompt:'请继续修改',requestKey:randomUUID()};const send=await call<{conversation:ConversationRecord;turnId:string}>(`conversations/${record.id}/turns`,payload);
  let conversation=await wait(()=>call<ConversationRecord>(`conversations/${record.id}`),r=>!r.busy&&r.turns.length===2);assert.equal(conversation.turns[1].attempt.outputText,'最终产物 2');assert.equal(conversation.turns[1].attempt.usage.inputTokens,150);assert.equal(conversation.turns[1].attempt.usage.outputTokens,35);assert.equal(conversation.totals.inputTokens,250);assert.equal(conversation.totals.outputTokens,55);assert.equal(conversation.turns[1].attempt.metadata?.activeDurationMs,600);assert.ok(conversation.turns[1].attempt.artifacts.some(f=>f.name==='response.md'));
  await call(`conversations/${record.id}/turns`,payload);await new Promise(r=>setTimeout(r,400));assert.equal(JSON.parse(await readFile(mock.stateFile,'utf8')).calls,2);assert.equal((await call<RunRecord>(`runs/${run.id}`)).results[0].attempt?.id,a.id);
  await call(`conversations/${record.id}/turns`,{prompt:'慢速任务，等待停止',requestKey:randomUUID()});await wait(()=>call<ConversationRecord>(`conversations/${record.id}`),r=>r.turns[2]?.attempt.outputText==='保留的实时正文');await call(`conversations/${record.id}/stop`,{});conversation=await wait(()=>call<ConversationRecord>(`conversations/${record.id}`),r=>!r.busy&&r.turns[2]?.attempt.status==='cancelled');assert.equal(conversation.turns[2].attempt.outputText,'保留的实时正文');assert.equal(conversation.turns[2].attempt.usage.inputTokens,200);assert.equal(conversation.totals.rounds,3);assert.equal(conversation.totals.inputTokens,450);
  const synced=await call<ConversationRecord>(`conversations/${record.id}/sync`,{});assert.equal(synced.turns.length,3);assert.equal(synced.turns[0].attempt.outputText,'最终产物 1');assert.equal(synced.turns[1].attempt.outputText,'最终产物 2');
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await store.close();global.casebenchStore=previousStore;if(previousAgents===undefined)delete process.env.CASEBENCH_ENABLED_AGENTS;else process.env.CASEBENCH_ENABLED_AGENTS=previousAgents;for(const[k,name]of [['data','CASEBENCH_DATA_DIR'],['program','CASEBENCH_GPT_PROGRAM'],['root','CASEBENCH_ROOT']]as const){if(previous[k]===undefined)delete process.env[name];else process.env[name]=previous[k]}}
});
