/** Authenticated, retrieval-only integration of the supplied backend. No model-generation endpoint is exposed. */
import {createServer} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {loadLibrary,retrieve} from './project/server/knowledge.mjs';
import {loadHumanizerSkill} from './project/server/humanizer.mjs';
const safeText=(v,n=4000)=>typeof v==='string'?v.slice(0,n):'';
export function projectContext(found,skill){
 // Explicitly project fields. Local paths, Obsidian URLs and whole source documents never cross the bridge.
 const templates=(found.templates||[]).slice(0,8).map(t=>({id:t.id,name:t.name,genre:t.genre,fit:t.fit,sequence:t.sequence,materials:t.materials,boundary:t.boundary,hooks:t.hooks}));
 const examples=(found.examples||[]).slice(0,6).map(e=>({id:e.id,title:e.title,evidenceLevel:e.evidenceLevel,recipe:e.recipe,stages:e.stages,opening:e.opening,middle:e.middle,ending:e.ending,contentExcerpt:safeText(e.contentExcerpt,1800),analysisExcerpt:safeText(e.analysisExcerpt,1800),match:e.match?{channels:e.match.channels,terms:e.match.terms,reason:e.match.reason}:undefined}));
 const blueprints=(found.blueprints||[]).slice(0,5).map(b=>({id:b.id,title:b.title,genre:b.genre,structureId:b.structureId,fit:b.fit,needs:b.needs,nodes:(b.nodes||[]).map(n=>({id:n.id,move:n.move,role:n.role,dependsOn:n.dependsOn,materialNeeds:n.materialNeeds}))}));
 return {revision:found.revision||null,engine:found.retrieval?.engine||'unknown',templates,examples,blueprints,guidance:(found.guidance||[]).slice(0,4).map(g=>({title:g.title,excerpt:safeText(g.excerpt,1200)})),writingSkill:{id:skill.id,revision:skill.revision,instructions:skill.instructions},modelCalls:0};
}
export function createContextServer({token=process.env.WRITING_BRIDGE_TOKEN||'',library=loadLibrary,lookup=retrieve,skill=loadHumanizerSkill}={}){
 const json=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(value));};
 let inFlight=false;
 return createServer(async(req,res)=>{
  const expected=Buffer.from('Bearer '+token),given=Buffer.from(req.headers.authorization||'');
  if(token.length<24||given.length!==expected.length||!timingSafeEqual(given,expected))return json(res,401,{error:'检索服务访问凭据无效'});
  if(req.method==='GET'&&req.url==='/health'){
   try{const lib=await library(),retrieval=lib.source?.retrieval;if(retrieval?.ready===false||['error','starting','indexing','empty'].includes(retrieval?.phase))return json(res,503,{ready:false,error:'知识库或检索索引尚未就绪'});return json(res,200,{ready:true,revision:lib.revision,stats:lib.stats,readOnly:true,modelCalls:0});}catch{return json(res,503,{ready:false,error:'知识库或检索索引尚未就绪'});}
  }
  if(req.method!=='POST'||req.url!=='/context')return json(res,404,{error:'接口不存在'});
  if(inFlight)return json(res,429,{error:'检索进行中，请稍后重试'});
  let size=0,chunks=[],ownsSlot=false;
  try{
   for await(const chunk of req){size+=chunk.length;if(size>256*1024)return json(res,413,{error:'参考内容过大'});chunks.push(chunk);}
   let input;try{input=JSON.parse(Buffer.concat(chunks).toString());}catch{return json(res,400,{error:'JSON 格式无效'});}
   if(typeof input.brief!=='string'||!input.brief.trim()||input.brief.length>20000||!['资讯','教程','测评','评论','科普','故事','盘点'].includes(input.genre)||!Array.isArray(input.references)||input.references.length>30)return json(res,400,{error:'检索参数无效'});
   const references=input.references.map(r=>({id:safeText(r.id,130),title:safeText(r.title,500),content:safeText(r.content,12000)}));
   if(inFlight)return json(res,429,{error:'检索进行中，请稍后重试'});inFlight=true;ownsSlot=true;const found=await lookup({brief:input.brief,genre:input.genre,references},6);const context=projectContext(found,await skill());
   if(Buffer.byteLength(JSON.stringify(context))>220000)return json(res,502,{error:'检索响应过大，请缩小查询范围'});
   return json(res,200,context);
  }catch{return json(res,503,{error:'知识库检索失败，请检查服务端知识库与索引状态'});}finally{if(ownsSlot)inFlight=false;}
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{process.loadEnvFile?.();}catch{}
 if((process.env.WRITING_BRIDGE_TOKEN||'').length<24)throw Error('请在服务端配置至少 24 位的 WRITING_BRIDGE_TOKEN');
 createContextServer().listen(Number(process.env.PORT)||43130,process.env.HOST||'127.0.0.1',()=>console.log('Writing retrieval bridge ready'));
}
