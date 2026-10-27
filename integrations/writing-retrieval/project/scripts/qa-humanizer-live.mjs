// Manual paid verification: one DeepSeek call, using synthetic text only.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdir,writeFile} from 'node:fs/promises';
import {createApiServer} from '../server/api.mjs';
import {loadHumanizerSkill,preservesDraft} from '../server/humanizer.mjs';

try{process.loadEnvFile();}catch{/* Env may also be provided by the caller. */}
if(!process.env.DEEPSEEK_API_KEY)throw new Error('A locally configured DeepSeek key is required.');
const model=process.env.DEEPSEEK_MODEL,baseUrl=process.env.DEEPSEEK_BASE_URL,skill=await loadHumanizerSkill();
const original={
 title:'更新记录（演示素材）',structureId:'N1',sourceIds:['demo-record'],materialSlots:['补充导出失败时的复测截图'],
 markdown:'# 更新记录（演示素材）\n\n## 功能与限制\n\n在技术不断发展的时代背景下，这次更新充分彰显了团队对创新的不懈追求。这不仅是一次更新，更是效率的飞跃。它新增 CSV 导出、全文搜索和批量重命名。单个文件上限为 10 MB，仅支持导出当前页面。\n\n## 尚待验证\n\n离线编辑计划在下一版推出，目前尚未完成测试。部分试用者认为搜索更快，但团队还没有测量数据。关于性能提升，可用信息确实比较有限。现有材料没有记录正式上线日期。\n\n复测时先运行 `save --dry-run`，相关记录见[测试说明](https://example.com/v2)。\n\n【素材位：补充导出失败时的复测截图】\n\n总而言之，让我们拭目以待，期待更多可能。',
};
const calls=[];
const recordingFetch=async(url,options)=>{
 const request=JSON.parse(options.body);
 assert.ok(request.messages[0].content.includes(skill.instructions));
 const response=await fetch(url,options),copy=await response.clone().json();
 let output;try{output=JSON.parse(copy.choices?.[0]?.message?.content);}catch{output=null;}
 calls.push({stage:'revise',skillIncluded:true,usage:copy.usage,output});return response;
};
const library={templates:[{id:'N1',genre:'资讯',name:'消息与背景解释',sequence:['消息','背景','边界']}],stats:{articles:0,templates:1,independentReviews:0}};
const server=await createApiServer({library,apiKey:process.env.DEEPSEEK_API_KEY,baseUrl,model,fetchImpl:recordingFetch,maxRetries:0,timeoutMs:45000});
server.listen(0,'127.0.0.1');await once(server,'listening');
try{
 const response=await fetch(`http://127.0.0.1:${server.address().port}/api/revise`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({brief:'整理一则产品更新说明，只使用演示材料，控制在400字内，不扩写事实。',genre:'资讯',references:[{id:'demo-record',title:'演示记录',content:original.markdown}],draft:original,instruction:'保持标题和结构，整理冗余表达，保留所有功能、限制、计划、测试状态与素材位。'})});
 const result=await response.json();assert.equal(response.status,200,JSON.stringify(result.error));assert.equal(result.writingSkill?.applied,true);assert.equal(result.writingSkill.mode,'inline');assert.equal(calls.length,1);const protectedContentPreserved=preservesDraft(original,result);
 const report={synthetic:true,model,mode:'inline',protectedContentPreserved,skill:{id:skill.id,commit:skill.commit,revision:skill.revision},before:original,api:{status:response.status,calls,result}};
 await mkdir('docs/qa',{recursive:true});await writeFile('docs/qa/humanizer-inline-live.json',JSON.stringify(report,null,2)+'\n');
 await writeFile('docs/qa/humanizer-inline-comparison.md',`# Humanizer-zh 单次调用验证\n\n全部内容为演示素材，不是真实新闻。模型：${model}。完整 skill 随改稿请求送入模型，实际仅一次模型调用，未另发润色请求。\n\n## 输入稿\n\n${original.markdown}\n\n## 同一次回答的最终稿\n\n${result.markdown}\n`);
 assert.equal(protectedContentPreserved,true,'the demonstration must retain protected content; see saved QA artifact');
 console.log(JSON.stringify({ok:true,model,actualCalls:1,apiStatus:response.status,mode:result.writingSkill.mode,artifact:'docs/qa/humanizer-inline-comparison.md'}));
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
