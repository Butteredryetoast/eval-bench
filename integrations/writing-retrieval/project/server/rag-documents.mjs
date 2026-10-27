import {createHash} from 'node:crypto';

export const RAG_DOCUMENT_VERSION='writing-passages-v2';
const hash=value=>createHash('sha256').update(value).digest('hex');
const safeString=value=>typeof value==='string'?value:'';
const analysisHead=/^(?:体裁与结构判断|分类判断|原文实际阶段|开头|中段推进与钩子|中段|结尾|钩子(?:链|设计|清单|如何接入)?|承诺与兑现|可复用方案(?:与素材要求)?|适用边界)$/;
const excludedHead=/^(?:独立复核(?:记录|结果|说明)?|复核(?:记录|发现|方法|信息|结果)?|自检(?:记录|结果)?|质量自检|质量层级|处理记录|来源说明|来源信息|留言与其他邀请|互动与推广|推广信息|导出信息|分析执行记录|审计记录)$/;
const promotion=/(?:点赞.{0,20}(?:在看|转发)|(?:在看|星标).{0,20}公众号|(?:扫码|扫描二维码).{0,12}(?:入群|加群|加微信)|关注(?:我|我们|本公众号|公众号)|加入.{0,8}交流群)/;

export function cleanRagText(value,{analysis=false}={}){
 const lines=safeString(value).split(/\r?\n/),out=[];let keep=!analysis,skipLevel=0;
 for(const line of lines){
  const heading=line.match(/^(#{1,6})\s+(.+)$/);
  if(heading){
   const level=heading[1].length,title=heading[2].replace(/\*|`/g,'').trim();
   if(skipLevel&&level>skipLevel)continue;
   skipLevel=0;
   if(excludedHead.test(title)){skipLevel=level;continue;}
   if(analysis&&level<=2)keep=analysisHead.test(title);
  }
  if(skipLevel||!keep)continue;
  if(analysis&&/^\s*(?:>|[-*])?\s*(?:\*\*)?(?:AI(?:独立)?(?:复核|自检)通过|模型|复核方法|复核发现|记录时间|执行者|分析者|复核者)[：:]/.test(line))continue;
  out.push(line);
 }
 const normalized=out.join('\n')
  .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g,'$2')
  .replace(/\[\[([^\]]+)\]\]/g,(_,target)=>target.split('/').at(-1).replace(/#.*$/,''))
  .replace(/\[([^\]]+)\]\([^\s)]+\)/g,'$1')
  .replace(/https?:\/\/\S+/g,'')
  .replace(/^\s*\^p\d+\s*$/gm,'')
  .replace(/^\s*>\s?/gm,'')
  .replace(/\*\*|`/g,'')
  .replace(/[ \t]+/g,' ');
 return normalized.split(/\n\s*\n/).filter(block=>{
  const text=block.trim();
  if(!text)return false;
  if(promotion.test(text)&&text.length<360)return false;
  if(analysis&&/^AI(?:独立)?(?:复核|自检)通过/.test(text))return false;
  return !/^(?:原文笔记|本轮总览)\s*[·|]/.test(text);
 }).join('\n\n').trim();
}

// Headings travel with passages. A small overlapping window fits the Chinese
// embedding model's 512-token input without arbitrarily mixing audit sections.
export function ragPassages(value,{maxChars=360,overlap=48}={}){
 const out=[];let heading='',buffer='';
 const push=()=>{if(buffer.trim())out.push({heading,content:buffer.trim()});buffer='';};
 for(const block of safeString(value).split(/\n\s*\n/)){
  const text=block.trim();if(!text)continue;
  const h=text.match(/^#{1,6}\s+([^\n]+)(?:\n([\s\S]*))?$/);
  if(h){push();heading=h[1].trim();if(h[2]?.trim())buffer=h[2].trim();else continue;}
  else if(buffer&&buffer.length+text.length+2<=maxChars){buffer+='\n\n'+text;continue;}
  else {push();buffer=text;}
  while(buffer.length>maxChars){
   let end=maxChars;
   for(const separator of ['\n','。','；','！','？']){const at=buffer.lastIndexOf(separator,maxChars);if(at>maxChars*.65){end=at+1;break;}}
   if(/[\uD800-\uDBFF]/.test(buffer[end-1])&&/[\uDC00-\uDFFF]/.test(buffer[end]))end--;
   let start=Math.max(1,end-overlap);
   if(/[\uDC00-\uDFFF]/.test(buffer[start])&&/[\uD800-\uDBFF]/.test(buffer[start-1]))start--;
   out.push({heading,content:buffer.slice(0,end).trim()});buffer=buffer.slice(start);
  }
 }
 push();return out;
}

export function createRagManifest(library){
 const sources=[],parents=new Map();
 const add=(item,{key,parentKey,parentId,kind,category,body,analysis=false,notePath=item.notePath,obsidianUrl=item.obsidianUrl,revisionHint=''})=>{
  const meta={key,parentKey,parentId,kind,category,title:item.title||item.id+' '+item.name,genre:item.genre||'',structureId:item.structureId||item.id||'',evidenceLevel:item.evidenceLevel||(category==='template'?'analyzed':'candidate'),reviewStatus:item.reviewStatus||'',notePath:notePath||'',obsidianUrl:obsidianUrl||''};
  const digest=hash(JSON.stringify([RAG_DOCUMENT_VERSION,meta,revisionHint]));
  sources.push({...meta,digest,chunks:()=>ragPassages(cleanRagText(typeof body==='function'?body():body,{analysis})).map((part,index)=>({...part,id:hash(key+'\n'+index+'\n'+part.content),index}))});
  parents.set(parentKey,item);
 };
 for(const a of library.articles){
  const common={parentKey:'article:'+a.id,parentId:a.id,category:'article',revisionHint:(a._notes||[]).map(n=>n.digest||'').join(':')||hash((a._sourceText||'')+'\n'+(a._analysisText||''))};
  if(a._sourceText&&a._sourceText!==a._analysisText)add(a,{...common,key:'source:'+a.id,kind:'source',body:a._sourceText,notePath:a.originalNotePath||a.notePath,obsidianUrl:a.originalObsidianUrl||a.obsidianUrl});
  if(a.evidenceLevel==='analyzed'&&a._analysisText)add(a,{...common,key:'analysis:'+a.id,kind:'analysis',body:a._analysisText,analysis:true});
 }
 for(const t of library.templates){
  const body=['## 适用任务',t.fit,'## 推进顺序',...(t.sequence||[]),'## 所需素材',t.materials,'## 使用边界',t.boundary,'## 钩子',t.hooks].filter(Boolean).join('\n\n');
  add(t,{key:'template:'+t.id,parentKey:'template:'+t.id,parentId:t.id,kind:'template',category:'template',body,revisionHint:hash(body)});
 }
 for(const b of library.blueprints||[]){
  const body=[b.name,b.fit,b.needs,b.boundary,...b.nodes.map(n=>['## '+n.title,n.readerQuestion,n.move,n.transition,...n.beats.map(beat=>[beat.type,beat.instruction,beat.role].filter(Boolean).join('：'))].filter(Boolean).join('\n\n'))].filter(Boolean).join('\n\n');
  add(b,{key:'blueprint:'+b.id,parentKey:'blueprint:'+b.id,parentId:b.id,kind:'blueprint',category:'blueprint',body,revisionHint:b.revision||hash(body)});
 }
 for(const n of library.notes||[])add(n,{key:'note:'+n.id,parentKey:'note:'+n.id,parentId:n.id,kind:'note',category:'note',body:n._text,revisionHint:hash(n._text||'')});
 return {sources,parents,manifest:sources.map(({chunks,...meta})=>meta),bySource:new Map(sources.map(source=>[source.key,source]))};
}

export function publicRagHit(hit,manifest){
 const item=manifest.parents.get(hit.parentKey);if(!item)return null;
 const passages=(hit.passages||[]).filter(p=>{
  const source=manifest.bySource.get(p.sourceKey);
  return typeof p.content==='string'&&source?.digest===p.sourceDigest&&source.parentKey===hit.parentKey;
 }).slice(0,4);
 const best=passages[0];if(!best)return null;
 const kinds=[...new Set(passages.map(p=>p.kind))];
 const channels=[...(hit.channels||[])];
 const reason=[channels.includes('lexical')?'关键词命中':'',channels.includes('vector')?'语义召回':'',hit.reranked?'中文模型重排':''].filter(Boolean).join('、')||'检索命中';
 return {item,passages,match:{channels,terms:hit.terms||[],reason,kind:best.kind==='source'?'原文':best.kind==='analysis'?'全文拆解':best.kind==='template'?'写作结构':best.kind==='blueprint'?'叙事蓝图':'笔记',notePath:best.notePath,obsidianUrl:best.obsidianUrl,snippet:best.content.slice(0,600),reranked:Boolean(hit.reranked),evidenceKinds:kinds}};
}
