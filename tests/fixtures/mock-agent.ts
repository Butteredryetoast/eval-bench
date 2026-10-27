import {writeFile,chmod} from 'node:fs/promises';
import path from 'node:path';
export async function createMockAgent(directory:string){
 const stateFile=path.join(directory,'native-state.json'),program=path.join(directory,'mock-codex');
 await writeFile(program,`#!${process.execPath}
const fs=require('node:fs'),readline=require('node:readline'),{randomUUID}=require('node:crypto');
const file=${JSON.stringify(stateFile)};
if(process.argv.includes('--version')){console.log('codex-cli fixture-0.4');process.exit(0);}
const save=s=>{fs.writeFileSync(file+'.tmp',JSON.stringify(s));fs.renameSync(file+'.tmp',file)};
const read=()=>{try{return JSON.parse(fs.readFileSync(file,'utf8'))}catch{return {threads:{},calls:0}}};
const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');const reply=(m,result)=>send({id:m.id,result});
const emit=(method,params)=>send({method,params});
readline.createInterface({input:process.stdin}).on('line',line=>{let m;try{m=JSON.parse(line)}catch{return;}const p=m.params||{};
try{
 if(m.method==='initialize')return reply(m,{userAgent:'fixture'});
 if(m.method==='initialized')return;
 if(m.method==='account/read')return reply(m,{account:{type:'chatgpt'}});
 if(m.method==='model/list')return reply(m,{data:[{model:'test-model',displayName:'Fixture Model',isDefault:true}],nextCursor:null});
 let s=read();
 if(m.method==='thread/start'){const id=randomUUID();s.threads[id]={id,status:{type:'idle'},turns:[],total:{inputTokens:0,outputTokens:0,cachedInputTokens:0,reasoningOutputTokens:0,totalTokens:0}};save(s);return reply(m,{thread:s.threads[id],model:'test-model'});}
 const t=s.threads[p.threadId];if(!t)return send({id:m.id,error:{message:'Unknown thread'}});
 if(m.method==='thread/name/set')return reply(m,{});
 if(m.method==='thread/read')return reply(m,{thread:{...t,...(!p.includeTurns?{turns:[]}:{} )}});
 if(m.method==='thread/turns/list')return reply(m,{data:t.turns,nextCursor:null});
 if(m.method==='thread/resume'){emit('thread/tokenUsage/updated',{threadId:t.id,turnId:t.turns.at(-1)?.id,tokenUsage:{last:t.last||t.total,total:t.total}});return reply(m,{thread:{...t,turns:[]},model:'test-model'});}
 if(m.method==='turn/start'){
  if(t.status.type==='active')return send({id:m.id,error:{message:'Thread is busy'}});
  const id=randomUUID(),slow=(p.input[0]?.text||'').includes('慢速'),agentId=randomUUID();s.calls++;const n=s.calls;const user={id:p.clientUserMessageId||randomUUID(),type:'userMessage',content:p.input};
  const agent={id:agentId,type:'agentMessage',phase:'final_answer',text:slow?'保留的实时正文':'最终产物 '+n};const turn={id,status:'inProgress',startedAt:Math.floor(Date.now()/1000),items:[user,agent]};t.turns.push(turn);t.status={type:'active'};
  const last={inputTokens:100+(n-1)*50,outputTokens:20+(n-1)*15,cachedInputTokens:10,reasoningOutputTokens:2,totalTokens:120+(n-1)*65};for(const key of Object.keys(last))t.total[key]=(t.total[key]||0)+last[key];t.last=last;save(s);
  reply(m,{turn:{...turn,items:[]}});emit('turn/started',{threadId:t.id,turn:{id,status:'inProgress'}});
  emit('item/started',{threadId:t.id,turnId:id,item:{id:'comment',type:'agentMessage',phase:'commentary',text:''}});emit('item/agentMessage/delta',{threadId:t.id,turnId:id,itemId:'comment',delta:'内部进度不应混入最终正文'});
  emit('item/started',{threadId:t.id,turnId:id,item:{...agent,text:''}});emit('item/agentMessage/delta',{threadId:t.id,turnId:id,itemId:agentId,delta:agent.text});
  for(let i=0;i<2;i++)emit('thread/tokenUsage/updated',{threadId:t.id,turnId:id,tokenUsage:{last,total:t.total}});
  if(!slow){turn.status='completed';turn.durationMs=600;turn.completedAt=Math.floor(Date.now()/1000);t.status={type:'idle'};save(s);emit('item/completed',{threadId:t.id,turnId:id,item:agent});emit('turn/completed',{threadId:t.id,turn});}
  return;
 }
 if(m.method==='turn/interrupt'){const turn=t.turns.find(x=>x.id===p.turnId);if(turn){turn.status='interrupted';turn.durationMs=800;turn.completedAt=Math.floor(Date.now()/1000);t.status={type:'idle'};save(s);emit('turn/completed',{threadId:t.id,turn});}return reply(m,{});}
 send({id:m.id,error:{message:'Unknown method '+m.method}});
}catch(e){send({id:m.id,error:{message:e.message}})}
});
`);await chmod(program,0o755);return {program,stateFile};
}
