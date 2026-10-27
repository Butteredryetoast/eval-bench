// Manual paid check: mocked direction selection, one real draft-generation call.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdir,writeFile} from 'node:fs/promises';
import {createApiServer} from '../server/api.mjs';
import {seedTopics} from '../src/seed.mjs';

process.loadEnvFile();
const input={brief:'智能体的记忆，应该留下什么？围绕跨会话记忆、长期任务、错误记忆纠正、隐私与授权写资讯解读。把未来预测保留为预测；没有的亲测与具体案例留素材位。',genre:'资讯',references:[{id:seedTopics[7].id,title:seedTopics[7].title,content:seedTopics[7].content}]};
let modelCalls=0;const trace=[];
const capture=async(url,options)=>{
 const request=JSON.parse(options.body),payload=JSON.parse(request.messages[1].content);
 if(payload.requestedGenre){
  const template=payload.allowedStructures.find(t=>t.id==='N3')||payload.allowedStructures[0];
  const directions=['日常工作变化','记忆内容取舍','隐私与纠错边界'].map(angle=>({title:angle,angle,reason:'演示选题，只按已有材料规划，需要亲测证据处保留素材位。',structureId:template.id,outline:['事件与关键变化','能力和证据','对工作与授权的影响'],materialNeeds:['跨会话记忆调用截图','错误记忆纠正的实际案例'],examples:payload.writingExamples.slice(0,2).map(e=>({id:e.id}))}));
  return Response.json({choices:[{message:{content:JSON.stringify({directions})}}]});
 }
 modelCalls++;
 const response=await fetch(url,options),copy=await response.clone().json();let output;
 try{output=JSON.parse(copy.choices?.[0]?.message?.content);}catch{output=copy.choices?.[0]?.message?.content;}
 trace.push({selectedStructure:payload.confirmedDirection?.structureId,allowedSourceIds:payload.references.map(r=>r.id),finishReason:copy.choices?.[0]?.finish_reason,output});return response;
};
const api=await createApiServer({fetchImpl:capture,maxRetries:0,timeoutMs:60000});
api.listen(0,'127.0.0.1');await once(api,'listening');
const base='http://127.0.0.1:'+api.address().port;
const post=(path,body)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
try{
 const recResponse=await post('/api/recommend',input),rec=await recResponse.json();assert.equal(recResponse.status,200);
 const response=await post('/api/generate',{...input,recommendationId:rec.recommendationId,directionId:rec.directions[0].id}),result=await response.json();
 await mkdir('docs/qa',{recursive:true});
 await writeFile('docs/qa/draft-generation-live.json',JSON.stringify({synthetic:true,recommendationFixture:true,modelCalls,status:response.status,input,result,trace},null,2)+'\n');
 assert.equal(response.status,200,JSON.stringify(result.error));assert.equal(modelCalls,1);assert.equal(result.writingSkill.mode,'inline');
 await writeFile('docs/qa/memory-generation-live.md','# 记忆选题生成验收\n\n仅使用原型演示选题，非新闻事实核验。方向选择由固定测试响应提供；生成使用实际 Obsidian 检索与一次真实 DeepSeek 调用。\n\n'+result.markdown+'\n');
 console.log(JSON.stringify({ok:true,status:response.status,modelCalls,structureId:result.structureId,sourceIds:result.sourceIds,bodyLength:result.markdown.length,skillMode:result.writingSkill.mode}));
}finally{api.closeAllConnections();await new Promise(resolve=>api.close(resolve));}
