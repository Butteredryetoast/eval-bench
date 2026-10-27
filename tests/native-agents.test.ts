import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createNativeFixture} from './fixtures/mock-native';
import {executeAdapter,readSessionOutput} from '../packages/adapters';
import {probeAcpAgent,acpModels,parseNativeUsage} from '../scripts/native-agents.mjs';
import {findAgent} from '../scripts/agent-runtime.mjs';
import type {CaseRecord,FrozenModel,LocalProfile} from '../packages/contracts';
test('三个原生适配均通过真实子进程：模型、首轮、原会话续聊、用量、失败与停止保留正文',{timeout:30000},async()=>{
 const root=await mkdtemp('/private/tmp/casebench-native-'),program=await createNativeFixture(root);
 const previousData=process.env.CASEBENCH_DATA_DIR;process.env.CASEBENCH_DATA_DIR=path.join(root,'state');
 const before=Object.fromEntries(['WORKBUDDY','DEEPSEEK','MINIMAX'].map(id=>[id,process.env[`CASEBENCH_${id}_PROGRAM`]]));
 for(const id of Object.keys(before))process.env[`CASEBENCH_${id}_PROGRAM`]=program;
 try{
  const catalog=await probeAcpAgent((await findAgent('deepseek'))!,path.join(root,'catalog'));assert.deepEqual(catalog.models.map(m=>m.id),['test-model']);
  const entry={title:'fixture',prompt:'初次',instructions:'',executionMode:'text',artifactType:'copy',inputs:[]} as unknown as CaseRecord;
  for(const agentId of ['workbuddy','deepseek','minimax']){
   const profile:LocalProfile={id:agentId+'-session',agentId,name:agentId,vendor:agentId,adapter:'command',model:'test-model',modes:['text'],supportsTemperature:false,color:'#123456',program:process.execPath,args:[path.join(process.cwd(),'scripts/native-harness.mjs'),agentId]};
   const model={...profile} as FrozenModel;const initial=path.join(root,agentId,'first'),out=path.join(initial,'out');await mkdir(out,{recursive:true});
   const task={case:entry,model,profile,directory:initial,outputDirectory:out,inputPaths:[],signal:AbortSignal.timeout(10000)};
   const result=await executeAdapter(task);assert.match(result.text,agentId==='workbuddy'?/^WorkBuddy/:/^ACP/);assert.doesNotMatch(result.text,/不应混入|Session usage|Input tokens/);assert.ok(result.metadata?.threadId);assert.equal(result.metadata?.agentId,agentId);assert.equal(result.metadata?.sessionCwd,initial);assert.equal(result.usage.inputTokens,agentId==='workbuddy'?30:20);
   const next=path.join(root,agentId,'followup');await mkdir(path.join(next,'out'),{recursive:true});
   const follow=await executeAdapter({...task,case:{...entry,prompt:'继续'},directory:next,outputDirectory:path.join(next,'out'),conversation:{threadId:result.metadata!.threadId!,clientMessageId:'turn_fixture',sessionCwd:initial,previousTotal:result.metadata?.usageRaw?.total}});assert.equal(follow.metadata?.threadId,result.metadata?.threadId);assert.notEqual(follow.text,result.text);assert.equal(follow.usage.inputTokens,agentId==='workbuddy'?30:20);assert.doesNotMatch(follow.text,/Session usage|Input tokens/);if(agentId!=='deepseek')assert.equal(follow.metadata?.usageRaw?.total?.inputTokens,agentId==='workbuddy'?60:40);
   assert.equal((await readSessionOutput(out)).text,result.text);
   if(agentId!=='workbuddy'){
    const stopDir=path.join(root,agentId,'stop');await mkdir(path.join(stopDir,'out'),{recursive:true});const promise=executeAdapter({...task,case:{...entry,prompt:'slow'},directory:stopDir,outputDirectory:path.join(stopDir,'out')});
    for(let n=0;n<50;n++){try{const live=JSON.parse(await readFile(path.join(stopDir,'live.json'),'utf8'));if(live.outputText)break;}catch{}await new Promise(r=>setTimeout(r,25));}
    await writeFile(path.join(stopDir,'cancel.json'),'{}');await assert.rejects(promise,/用户停止/);const partial=await readSessionOutput(path.join(stopDir,'out'));assert.match(partial.text,/^ACP/);assert.equal(partial.usage.inputTokens,8);
   }else{
    const failure=path.join(root,agentId,'failure');await mkdir(path.join(failure,'out'),{recursive:true});await assert.rejects(executeAdapter({...task,case:{...entry,prompt:'auth-error'},directory:failure,outputDirectory:path.join(failure,'out')}),/未获得授权/);
   }
  }
 }finally{if(previousData===undefined)delete process.env.CASEBENCH_DATA_DIR;else process.env.CASEBENCH_DATA_DIR=previousData;for(const[id,value]of Object.entries(before)){if(value===undefined)delete process.env[`CASEBENCH_${id}_PROGRAM`];else process.env[`CASEBENCH_${id}_PROGRAM`]=value;}}
});
test('ACP 分组模型保持原生精确 ID，显示名独立；缓存 token 是输入子集',()=>{
 const models=acpModels({configOptions:[{id:'model',category:'model',currentValue:'["provider","model"]',options:[{group:'provider',options:[{value:'["provider","model"]',name:'Readable Model'}]}]}]});assert.equal(models[0].name,'Readable Model');assert.equal(models[0].id,'["provider","model"]');assert.equal(models[0].isDefault,true);
});

test('MiniMax 本地用量仅接受完整的原生统计，缓存输入不重复叠加',()=>{assert.deepEqual(parseNativeUsage('Session usage:\nInput tokens: 14,943\nOutput tokens: 21\nCache read tokens: 14,494'),{inputTokens:14943,outputTokens:21,cachedInputTokens:14494});assert.equal(parseNativeUsage('No usage has been recorded for this session.'),null);assert.equal(parseNativeUsage('Session usage:\nInput tokens: 12'),null);assert.equal(parseNativeUsage('Input tokens: 1\nOutput tokens: 2'),null);});
