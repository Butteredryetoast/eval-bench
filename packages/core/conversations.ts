import { and, asc, eq, inArray, sql, or } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { findAgent, readNativeThread, normalizeUsage } from '../../scripts/agent-runtime.mjs';
import {sessionAgent,SESSION_PROFILES} from '../../scripts/native-agents.mjs';
import { continuationSchema, completionSchema, executionMetadataSchema, UNKNOWN_USAGE, type AttemptRecord, type ConversationRecord, type ConversationTurn } from '../contracts';
import { CasebenchService, AppError, newId, now, safeId } from './service';
import { loadProfiles, stateDir } from './config';
import path from 'node:path';
import { readSessionOutput } from '../adapters';
import * as t from './schema';

const terminal = (s: string) => ['succeeded','failed','cancelled','timed_out'].includes(s);
export function conversationTotals(turns: ConversationTurn[]): ConversationRecord['totals'] {
  const latest=turns.map(t=>t.attempt), attempts=turns.flatMap(t=>[...(t.previousAttempts||[]),t.attempt]), reported=attempts.filter(a=>a.usage.inputTokens!==null&&a.usage.outputTokens!==null), measured=attempts.filter(a=>(a.metadata?.activeDurationMs??a.durationMs)!==null&&(a.metadata?.activeDurationMs??a.durationMs)!==undefined);
  const sum=(key:'inputTokens'|'outputTokens')=>attempts.some(a=>a.usage[key]!==null)?attempts.reduce((n,a)=>n+(a.usage[key]??0),0):null;
  return { rounds:turns.length,completedRounds:latest.filter(a=>a.status==='succeeded').length,failedRounds:latest.filter(a=>['failed','timed_out','cancelled'].includes(a.status)).length,durationMs:measured.length?measured.reduce((n,a)=>n+(a.metadata?.activeDurationMs??a.durationMs??0),0):null,inputTokens:sum('inputTokens'),outputTokens:sum('outputTokens'),reportedRounds:reported.length,measuredRounds:measured.length,retries:turns.reduce((n,t)=>n+t.retryCount,0),attempts:attempts.length };
}
export class ConversationService {
 constructor(readonly service:CasebenchService){}
 get db(){return this.service.db}
 async attach(attemptId:string):Promise<ConversationRecord|null>{
  safeId(attemptId);const existing=(await this.db.select().from(t.conversationSessions).where(eq(t.conversationSessions.initialAttemptId,attemptId)))[0];if(existing)return this.get(existing.id);
  // A fixed follow-up/retry belongs to its existing native session, not a new conversation.
  const archived=(await this.db.select().from(t.attempts).where(eq(t.attempts.id,attemptId)))[0];
  if(archived?.conversationTurnId){const turn=(await this.db.select().from(t.conversationTurns).where(eq(t.conversationTurns.id,archived.conversationTurnId)))[0];if(turn)return this.get(turn.sessionId);}
  const fixed=await this.service.getAttempt(attemptId),a=fixed.result.attempt!;
  if(!terminal(a.status))return null;
  const agentId=sessionAgent(fixed.model);if(!agentId||!SESSION_PROFILES[agentId])return null;
  let metadata=a.metadata||{}, legacyUsage:AttemptRecord['usage']|undefined;
  if(!metadata.threadId){const file=a.artifacts.find(f=>f.name==='session.json');if(file)try{const raw=JSON.parse((await this.service.fileBytes(file.id)).toString('utf8'));legacyUsage=raw.usage?.source?completionSchema.shape.usage.parse(raw.usage):normalizeUsage(raw.usage);metadata=executionMetadataSchema.parse(raw.metadata||{agentId:'gpt',threadId:raw.threadId,...(raw.turnId?{turnId:raw.turnId}:{})});}catch{/* Legacy tasks without native session metadata stay read-only. */}}
  if(!metadata.threadId)return null;
  if (!a.metadata?.threadId || legacyUsage?.source === 'reported' && a.usage.source !== 'reported') await this.db.update(t.attempts).set({metadata,...(legacyUsage?.source === 'reported' && a.usage.source !== 'reported'?{usage:legacyUsage}:{})}).where(eq(t.attempts.id,attemptId));
  const id=newId('conversation'),at=now();
  await this.db.transaction(async tx=>{
   const lock=(await tx.select().from(t.attempts).where(eq(t.attempts.id,attemptId)).for('update'))[0];if(!lock)throw new AppError(404,'执行记录不存在');
   if((await tx.select().from(t.conversationSessions).where(eq(t.conversationSessions.initialAttemptId,attemptId)))[0])return;
   await tx.insert(t.conversationSessions).values({id,initialAttemptId:attemptId,resultId:fixed.result.id,nativeThreadId:metadata.threadId!,model:a.reportedModel||fixed.model.model,createdAt:at,updatedAt:at});
   await tx.insert(t.conversationTurns).values({id:newId('turn'),sessionId:id,number:1,prompt:fixed.case.prompt,source:'initial',nativeTurnId:metadata.turnId||null,attemptId,requestKey:`initial:${attemptId}`,createdAt:a.startedAt});
  });
  return this.get((await this.db.select().from(t.conversationSessions).where(eq(t.conversationSessions.initialAttemptId,attemptId)))[0].id);
 }
 async context(id:string){
  const session=(await this.db.select().from(t.conversationSessions).where(eq(t.conversationSessions.id,safeId(id))))[0];if(!session)throw new AppError(404,'会话不存在');
  const result=(await this.db.select().from(t.results).where(eq(t.results.id,session.resultId)))[0];const run=await this.service.getRun(result.runId);
  return {session,result,run,entry:run.spec.cases.find(c=>c.versionId===result.caseVersionId)!,model:run.spec.models.find(m=>m.id===result.profileId)!};
 }
 async get(id:string):Promise<ConversationRecord>{
  const {session,model}=await this.context(id);const rows=await this.db.select().from(t.conversationTurns).where(eq(t.conversationTurns.sessionId,id)).orderBy(asc(t.conversationTurns.number));
  const ids=rows.map(r=>r.attemptId);const attempts=ids.length?await this.db.select().from(t.attempts).where(or(inArray(t.attempts.id,ids),inArray(t.attempts.conversationTurnId,rows.map(r=>r.id)))):[];
  ids.push(...attempts.map(a=>a.id).filter(id=>!ids.includes(id)));
  const files=ids.length?await this.db.select().from(t.files).where(inArray(t.files.attemptId,ids)):[],annotations=ids.length?await this.db.select().from(t.annotations).where(inArray(t.annotations.attemptId,ids)):[];
  const asAttempt=(a:typeof t.attempts.$inferSelect):AttemptRecord=>{const ann=annotations.find(n=>n.attemptId===a.id);return {...a,artifacts:files.filter(f=>f.attemptId===a.id).map(f=>({...f,role:'output' as const})),annotation:ann||{verdict:null,note:'',revision:0,updatedAt:a.startedAt,updatedBy:''},audit:[]};};
  const turns:ConversationTurn[]=rows.map(row=>({id:row.id,number:row.number,prompt:row.prompt,source:row.source as ConversationTurn['source'],nativeTurnId:row.nativeTurnId,retryCount:row.retryCount,attempt:asAttempt(attempts.find(a=>a.id===row.attemptId)!),previousAttempts:attempts.filter(a=>a.conversationTurnId===row.id&&a.id!==row.attemptId).map(asAttempt)}));
  const agentId=sessionAgent(model)||'gpt',busy=!!session.activeTurnId||session.nativeBusy,installation=await findAgent(agentId);
  const active=rows.find(r=>r.id===session.activeTurnId),stale=active?.heartbeatAt&&Date.now()-Date.parse(active.heartbeatAt)>90000;
  return {id:session.id,initialAttemptId:session.initialAttemptId,nativeThreadId:session.nativeThreadId,model:session.model,agentId,canSyncNative:agentId==='gpt',turns,busy,canContinue:!busy&&!!installation,detail:stale?'执行器连接中断，请检查本地任务和归档。':session.syncError||(!installation?'当前电脑未发现原生 Agent，历史记录仍可查看。':session.nativeBusy?'会话正在原生 Agent 中执行。':agentId!=='gpt'?'网页追问沿用当前原生会话；桌面端新增对话暂不自动导入。':''),totals:conversationTotals(turns)};
 }
 async enqueue(id:string,raw:unknown){
  const input=continuationSchema.parse(raw);let turnId='';
  await this.db.transaction(async tx=>{
   const session=(await tx.select().from(t.conversationSessions).where(eq(t.conversationSessions.id,safeId(id))).for('update'))[0];if(!session)throw new AppError(404,'会话不存在');
   const existing=(await tx.select().from(t.conversationTurns).where(eq(t.conversationTurns.requestKey,input.requestKey)))[0];
   if(existing){if(existing.sessionId!==id||existing.prompt!==input.prompt)throw new AppError(409,'这次发送编号已用于其他消息');turnId=existing.id;return;}
   if(session.activeTurnId||session.nativeBusy)throw new AppError(409,'当前会话仍在执行，请等待或先停止');
   const result=(await tx.select().from(t.results).where(eq(t.results.id,session.resultId)).for('update'))[0];
   const rows=await tx.select().from(t.conversationTurns).where(eq(t.conversationTurns.sessionId,id));if(rows.length>=200)throw new AppError(400,'这段会话已达到 200 轮，请新建测试');
   let old= input.retryTurnId?rows.find(r=>r.id===input.retryTurnId):undefined;
   if(input.retryTurnId&&!old)throw new AppError(404,'重试轮次不存在');
   if(old){const a=(await tx.select().from(t.attempts).where(eq(t.attempts.id,old.attemptId)))[0];if(!terminal(a.status)||a.status==='succeeded'||old.source==='initial'||old.prompt!==input.prompt)throw new AppError(409,'只能重试失败的追问，首轮请使用再次测试');}
   turnId=old?.id||newId('turn');
   const all=await tx.select().from(t.attempts).where(eq(t.attempts.resultId,result.id));const attemptId=newId('attempt'),at=now();
   await tx.insert(t.attempts).values({id:attemptId,resultId:result.id,number:Math.max(0,...all.map(a=>a.number))+1,kind:'followup',conversationTurnId:turnId,status:'pending',startedAt:at,usage:{...UNKNOWN_USAGE},adapterVersion:'casebench-conversation-0.4'});
   await tx.insert(t.annotations).values({attemptId,updatedAt:at,updatedBy:'本地成员'});
   if(old)await tx.update(t.conversationTurns).set({attemptId,requestKey:input.requestKey,retryCount:old.retryCount+1,nativeTurnId:null,runnerId:null,lease:null,heartbeatAt:null}).where(eq(t.conversationTurns.id,old.id));
   else await tx.insert(t.conversationTurns).values({id:turnId,sessionId:id,number:rows.length+1,prompt:input.prompt,source:'web',attemptId,requestKey:input.requestKey,createdAt:at});
   await tx.update(t.conversationSessions).set({activeTurnId:turnId,cancelRequested:false,updatedAt:at,syncError:null}).where(eq(t.conversationSessions.id,id));
  });return {turnId,conversation:await this.get(id)};
 }
 async claim(turnId:string,runnerId:string,recover=false){
  const before=(await this.db.select().from(t.conversationTurns).where(eq(t.conversationTurns.id,safeId(turnId))))[0];if(!before)throw new AppError(404,'轮次不存在');
  const info=await this.context(before.sessionId),profile=(await loadProfiles()).find(p=>p.id===(info.model.baseProfileId||info.model.id));if(!profile)throw new AppError(409,'本机执行配置已丢失，请刷新 Agent 连接');
  let lease:string|null=null;
  await this.db.transaction(async tx=>{const row=(await tx.select().from(t.conversationTurns).where(eq(t.conversationTurns.id,safeId(turnId))).for('update'))[0];if(!row)throw new AppError(404,'轮次不存在');const a=(await tx.select().from(t.attempts).where(eq(t.attempts.id,row.attemptId)))[0];if(recover){if(row.runnerId!==runnerId||!row.lease)throw new AppError(409,'不能恢复其他设备的执行');lease=row.lease;return;}if(a.status!=='pending'||row.runnerId)return;
   lease=randomUUID();await tx.update(t.conversationTurns).set({runnerId,lease,heartbeatAt:now()}).where(eq(t.conversationTurns.id,turnId));await tx.update(t.attempts).set({status:'running',startedAt:now()}).where(eq(t.attempts.id,row.attemptId));});
  if(!lease)return {claimed:false as const};
  const row=(await this.db.select().from(t.conversationTurns).where(eq(t.conversationTurns.id,turnId)))[0],context=await this.context(row.sessionId),record=await this.get(row.sessionId);
  const prior=record.turns.flatMap(t=>[...(t.previousAttempts||[]),t.attempt]).filter(a=>terminal(a.status)&&a.metadata?.turnId).sort((a,b)=>Date.parse(b.finishedAt||b.startedAt)-Date.parse(a.finishedAt||a.startedAt))[0];
  const previous=prior?.metadata?.usageRaw?.total;
  const initial=record.turns[0]?.attempt,sessionCwd=initial?.metadata?.sessionCwd||path.join(stateDir(),'runs',context.run.id,context.result.id,initial.id);
  return {claimed:true as const,lease,turn:row,runId:context.run.id,timeoutSeconds:context.run.spec.timeoutSeconds,entry:{...context.entry,prompt:row.prompt,instructions:''},model:context.model,profile,conversation:{threadId:context.session.nativeThreadId,clientMessageId:row.id,sessionCwd,...(previous?{previousTotal:previous}:{})}};
 }
 async owned(turnId:string,runnerId:string,lease:string){
  const row=(await this.db.select().from(t.conversationTurns).where(eq(t.conversationTurns.id,safeId(turnId))))[0];if(!row||row.runnerId!==runnerId||row.lease!==lease)throw new AppError(409,'会话执行授权已失效');return row;
 }
 async progress(turnId:string,runnerId:string,lease:string,raw:unknown){
  const input=z.object({seq:z.number().int().positive(),outputText:z.string().max(2000000),usage:completionSchema.shape.usage,metadata:executionMetadataSchema}).parse(raw);const row=await this.owned(turnId,runnerId,lease);
  const a=(await this.db.select().from(t.attempts).where(eq(t.attempts.id,row.attemptId)))[0];
  if(input.metadata.threadId && input.metadata.threadId !== (await this.context(row.sessionId)).session.nativeThreadId) throw new AppError(409,'原生会话编号不一致');
  if(!terminal(a.status)){
   const updated=await this.db.update(t.attempts).set({outputText:input.outputText,usage:input.usage,metadata:input.metadata,eventSeq:input.seq}).where(and(eq(t.attempts.id,a.id),sql`${t.attempts.eventSeq} < ${input.seq}`)).returning();
   if(updated.length && input.metadata.turnId)await this.db.update(t.conversationTurns).set({nativeTurnId:input.metadata.turnId}).where(eq(t.conversationTurns.id,turnId));
  }
  await this.db.update(t.conversationTurns).set({heartbeatAt:now()}).where(eq(t.conversationTurns.id,turnId));
  const s=(await this.db.select().from(t.conversationSessions).where(eq(t.conversationSessions.id,row.sessionId)))[0];return {cancelRequested:s.cancelRequested};
 }
 async upload(turnId:string,runnerId:string,lease:string,bytes:Uint8Array,name:string,mime:string,fileId:string){
  const row=await this.owned(turnId,runnerId,lease),a=(await this.db.select().from(t.attempts).where(eq(t.attempts.id,row.attemptId)))[0];
  const files=await this.db.select().from(t.files).where(eq(t.files.attemptId,a.id));if(terminal(a.status)&&!files.some(f=>f.id===fileId))throw new AppError(409,'归档产物不能修改');
  if(!files.some(f=>f.id===fileId)&&(files.length>=30||files.reduce((n,f)=>n+f.size,0)+bytes.byteLength>100*1024*1024))throw new AppError(400,'本轮产物超过数量或大小限制');
  return this.service.putFile(bytes,name,mime,'output',a.id,fileId);
 }
 async complete(turnId:string,runnerId:string,lease:string,raw:unknown){
  const input=completionSchema.parse(raw);const row=await this.owned(turnId,runnerId,lease);
  await this.db.transaction(async tx=>{const a=(await tx.select().from(t.attempts).where(eq(t.attempts.id,row.attemptId)).for('update'))[0];
   if(terminal(a.status)){if(a.status!==input.status||a.outputText!==input.outputText)throw new AppError(409,'已归档的轮次不可覆盖');return;}
   if(input.status==='succeeded'&&!input.outputText.trim())throw new AppError(400,'成功轮次必须有产物');
   await tx.update(t.attempts).set({...input,finishedAt:now()}).where(eq(t.attempts.id,a.id));
   if(input.metadata.turnId)await tx.update(t.conversationTurns).set({nativeTurnId:input.metadata.turnId}).where(eq(t.conversationTurns.id,row.id));
   await tx.update(t.conversationSessions).set({activeTurnId:null,cancelRequested:false,updatedAt:now(),nativeBusy:false}).where(and(eq(t.conversationSessions.id,row.sessionId),eq(t.conversationSessions.activeTurnId,row.id)));
  });return {ok:true};
 }
 async stop(id:string){const {session}=await this.context(id);if(!session.activeTurnId)throw new AppError(409,'当前没有网页正在执行的轮次');await this.db.update(t.conversationSessions).set({cancelRequested:true}).where(eq(t.conversationSessions.id,id));return {ok:true};}
 async failLaunch(turnId:string,message:string){const row=(await this.db.select().from(t.conversationTurns).where(eq(t.conversationTurns.id,turnId)))[0];if(!row||row.runnerId)return;await this.db.update(t.attempts).set({status:'failed',finishedAt:now(),error:message}).where(eq(t.attempts.id,row.attemptId));await this.db.update(t.conversationSessions).set({activeTurnId:null}).where(and(eq(t.conversationSessions.id,row.sessionId),eq(t.conversationSessions.activeTurnId,turnId)));}
 async synchronize(id:string){
  const {session,run,result,model}=await this.context(id);if(sessionAgent(model)!=='gpt')return this.get(id);
  const installation=await findAgent('gpt');if(!installation)throw new AppError(400,'当前电脑没有原生 Agent，无法同步此会话');
  let snapshot;try{snapshot=await readNativeThread(session.nativeThreadId,installation);}catch(error){const message=error instanceof Error?error.message:'无法读取原生会话';await this.db.update(t.conversationSessions).set({syncError:message}).where(eq(t.conversationSessions.id,id));throw new AppError(409,`同步失败：${message}`);}
  const rows=await this.db.select().from(t.conversationTurns).where(eq(t.conversationTurns.sessionId,id));
  for(const row of rows){
    const folder=row.source==='initial'?path.join(stateDir(),'runs',run.id,result.id,row.attemptId,'out'):path.join(stateDir(),'conversations',id,row.id,row.attemptId,'out');
    const saved=await readSessionOutput(folder);
    if(saved.metadata.threadId===session.nativeThreadId&&(!row.nativeTurnId||saved.metadata.turnId===row.nativeTurnId)){
      const a=(await this.db.select().from(t.attempts).where(eq(t.attempts.id,row.attemptId)))[0];
      if(a.usage.source!=='reported'&&saved.usage.source==='reported')await this.db.update(t.attempts).set({usage:completionSchema.shape.usage.parse(saved.usage),metadata:{...a.metadata,...saved.metadata}}).where(eq(t.attempts.id,a.id));
      if(!row.nativeTurnId&&saved.metadata.turnId)await this.db.update(t.conversationTurns).set({nativeTurnId:saved.metadata.turnId}).where(eq(t.conversationTurns.id,row.id));
    }
  }
  await this.importNative(id,snapshot.turns,snapshot.thread.status?.type==='active');return this.get(id);
 }
 async importNative(id:string,nativeTurns:any[],nativeBusy:boolean){
  await this.db.transaction(async tx=>{
   const session=(await tx.select().from(t.conversationSessions).where(eq(t.conversationSessions.id,id)).for('update'))[0];if(!session)throw new AppError(404,'会话不存在');
   await tx.select().from(t.results).where(eq(t.results.id,session.resultId)).for('update');
   let rows=await tx.select().from(t.conversationTurns).where(eq(t.conversationTurns.sessionId,id));let attempts=await tx.select().from(t.attempts).where(eq(t.attempts.resultId,session.resultId));
   let activeId=session.activeTurnId;
   for(const [index,native]of nativeTurns.slice(0,200).entries()){
    if(typeof native.id!=='string'||native.id.length>150)continue;
    const userItems=(native.items||[]).filter((i:any)=>i.type==='userMessage');let row=rows.find(r=>r.nativeTurnId===native.id)||rows.find(r=>userItems.some((i:any)=>i.id===r.id));
    if(!row&&index===0){row=rows.find(r=>r.source==='initial'&&!r.nativeTurnId);if(row){await tx.update(t.conversationTurns).set({nativeTurnId:native.id}).where(eq(t.conversationTurns.id,row.id));row.nativeTurnId=native.id;}}
    const agents=(native.items||[]).filter((i:any)=>i.type==='agentMessage'),finals=agents.filter((i:any)=>i.phase==='final_answer');const output=(finals.length?finals:agents).map((i:any)=>i.text||'').join('\n\n').slice(-2000000);
    const state=native.status==='completed'?'succeeded':native.status==='interrupted'?'cancelled':native.status==='failed'?'failed':'running';
    if(!row){const prompt=userItems.flatMap((i:any)=>i.content||[]).filter((i:any)=>i.type==='text').map((i:any)=>i.text||'').join('\n').slice(0,20000);if(!prompt)continue;
     const attemptId=newId('attempt'),turnId=newId('turn'),at=now();const metadata={agentId:'gpt',threadId:session.nativeThreadId,turnId:native.id,...(typeof native.durationMs==='number'?{activeDurationMs:Math.max(0,native.durationMs)}:{})};
     const a={id:attemptId,resultId:session.resultId,number:Math.max(0,...attempts.map(a=>a.number))+1,kind:'followup',status:state as AttemptRecord['status'],startedAt:native.startedAt?new Date(native.startedAt*1000).toISOString():at,finishedAt:state==='running'?null:native.completedAt?new Date(native.completedAt*1000).toISOString():at,outputText:output,error:native.error?.message?.slice(0,10000)||null,durationMs:typeof native.durationMs==='number'?Math.max(0,native.durationMs):null,usage:{...UNKNOWN_USAGE},metadata,reportedModel:typeof native.model==='string'?native.model:null,adapterVersion:'native-history-0.4',logs:'',eventSeq:0,conversationTurnId:turnId};
     await tx.insert(t.attempts).values(a);attempts.push(a);await tx.insert(t.annotations).values({attemptId,updatedAt:at,updatedBy:'本地成员'});
     const inserted=await tx.insert(t.conversationTurns).values({id:turnId,sessionId:id,number:rows.length+1,prompt,source:'desktop',nativeTurnId:native.id,attemptId,requestKey:`native:${id}:${native.id}`,createdAt:at}).returning();row=inserted[0];rows.push(row);
    }else{
     const a=attempts.find(a=>a.id===row!.attemptId)!;
     // A live web worker owns its stream and usage; history only recovers a stale worker.
     const liveOwner=row.runnerId&&row.heartbeatAt&&Date.now()-Date.parse(row.heartbeatAt)<90000;
     if(!terminal(a.status)&&!liveOwner){await tx.update(t.attempts).set({status:state,outputText:output||a.outputText,...(state!=='running'?{finishedAt:now()}:{}),error:native.error?.message?.slice(0,10000)||null,metadata:{...a.metadata,threadId:session.nativeThreadId,turnId:native.id,...(typeof native.durationMs==='number'?{activeDurationMs:Math.max(0,native.durationMs)}:{})}}).where(eq(t.attempts.id,a.id));if(row.nativeTurnId!==native.id)await tx.update(t.conversationTurns).set({nativeTurnId:native.id}).where(eq(t.conversationTurns.id,row.id));if(state!=='running'&&activeId===row.id)activeId=null;}
    }
   }
   await tx.update(t.conversationSessions).set({nativeBusy,activeTurnId:activeId,lastSyncedAt:now(),syncError:null,updatedAt:now()}).where(eq(t.conversationSessions.id,id));
  });
 }
}
