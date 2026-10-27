import {readdir,readFile,stat,realpath} from 'node:fs/promises';
import {resolve,relative,join,basename,sep} from 'node:path';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';
import {parseDocument} from 'yaml';
import {parseBlueprint} from './blueprints.mjs';

const GENRES=new Set(['资讯','教程','测评','评论','科普','故事','盘点']);
const normalize=s=>String(s??'').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu,'');
const text=v=>Array.isArray(v)?v.map(text).join('；'):v&&typeof v==='object'?Object.values(v).map(text).join('；'):String(v??'');
const clean=s=>String(s??'').replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g,'$2').replace(/\[\[([^\]]+)\]\]/g,'$1').replace(/\^p\d+/g,'').replace(/^>\s?/gm,'').replace(/\*\*/g,'').trim();
const hash=s=>createHash('sha256').update(s).digest('hex');
const within=(root,path)=>{const rel=relative(root,path);return rel!== '..'&&!rel.startsWith('..'+sep)&&!rel.startsWith(sep);};
function knowledgeError(){return Object.assign(new Error('Obsidian 知识库不可读，请检查本地路径与文件权限；未使用静态副本。'),{code:'KNOWLEDGE_UNAVAILABLE'});}
function parseNote(raw,path,vaultRelative,vaultName){
 const match=raw.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);let meta={},body=raw;
 if(match){if(match[1].length>64_000)throw new Error('frontmatter too large');const doc=parseDocument(match[1],{uniqueKeys:true});if(doc.errors.length)throw new Error('invalid YAML');meta=doc.toJS({maxAliasCount:10})||{};if(typeof meta!=='object'||Array.isArray(meta))throw new Error('invalid metadata');body=raw.slice(match[0].length);}
 const title=text(meta.标题||meta.title||body.match(/^#\s+(.+)$/m)?.[1]||basename(path,'.md')).split('\n')[0].trim();
 const uri='obsidian://open?vault='+encodeURIComponent(vaultName)+'&file='+encodeURIComponent(vaultRelative.replace(/\.md$/i,''));
 return {path,notePath:vaultRelative,obsidianUrl:uri,meta,body,title,digest:hash(raw)};
}
function section(body,names){for(const name of names){const lines=body.split(/\r?\n/);let started=false,level=0,out=[];for(const line of lines){const h=line.match(/^(#{1,6})\s+(.+)$/);if(!started){if(h&&h[2].trim()===name){started=true;level=h[1].length;}}else if(h&&h[1].length<=level)break;else out.push(line);}if(started)return out.join('\n').trim();}return '';}
function label(body,names){for(const name of names){const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const m=body.match(new RegExp('(?:^|\\n)\\*\\*'+escaped+'\\*\\*[：:]\\s*([^\\n]+)'));if(m)return clean(m[1]);}return '';}
function getTemplate(note,evidence){const m=note.meta,body=note.body;const id=text(m.结构代码||m.structureId).toUpperCase();const genre=text(m.体裁||m.genre)||body.match(/(?:^|\n)体裁[：:]\s*(\S+)/)?.[1];if(!/^[A-Z]\d{1,3}$/.test(id)||id.startsWith('X')||!GENRES.has(genre)||m.可推荐===false)return null;
 const sequenceRaw=section(body,['推进顺序','可复用推进','文章结构','结构推进']);let sequence=sequenceRaw.split(/\r?\n/).filter(x=>/^\s*(?:\d+[.、)]|[-*])\s*/.test(x)).map(x=>clean(x.replace(/^\s*(?:\d+[.、)]|[-*])\s*/,'')));
 if(!sequence.length)sequence=clean(sequenceRaw).split(/\s*(?:→|->)\s*/).filter(Boolean);
 if(!sequence.length&&Array.isArray(m.sequence))sequence=m.sequence.map(text);
 return {id,genre,name:text(m.结构名称||m.name)||note.title.replace(new RegExp('^'+id+'\\s*'),''),fit:clean(section(body,['什么时候用','适用任务']))||body.match(/(?:^|\n)适用任务[：:]\s*([^\n]+)/)?.[1]||'',sequence,materials:clean(section(body,['必须具备的素材','材料要求','所需素材'])),boundary:clean(section(body,['适用边界','使用边界'])),hooks:clean(section(body,['钩子如何接入','开头、中段与结尾'])),notePath:note.notePath,obsidianUrl:note.obsidianUrl,maturity:evidence?.meta.成熟度状态||null,evidenceCount:evidence?.meta.样本数??null};}
function isAnalysis(n){return /全文.*(?:拆解|分析)|拆解结果/.test(text(n.meta.类型));}
function sourceArticle(n){return !isAnalysis(n)&&(Boolean(n.meta.文章ID)||/^文章\//.test(n.path));}
function reviewStatus(note){const q=text(note?.meta.质量层级||note?.meta.复核状态);return q==='AI独立复核通过'?'独立复核通过':q||'未全文复核候选';}
function articleBody(raw){const body=section(raw,['来源与正文转写','正文'])||raw;const first=body.search(/^###\s+P1[ \t]*\r?$/m);return first<0?body:body.slice(first).replace(/^###\s+P\d+[ \t]*\r?$/gm,'').trim();}
function makeArticle(raw,analysis){const note=analysis||raw,m=note.meta,r=raw?.meta||{},body=analysis?.body||'',stages=section(body,['原文实际阶段']);const sourceBody=raw?articleBody(raw.body):'';const recipeSection=section(body,['可复用方案与素材要求','可复用方案']);const classification=section(body,['体裁与结构判断','分类判断']);const record={
 id:text(m.文章ID||r.文章ID)||'note-'+hash(note.notePath).slice(0,16),title:note.title||raw?.title||'',account:text(m.账号||r.账号),url:text(m.原文链接||r.原文链接),publishDate:text(m.发布日期||r.发布日期),genre:text(m.体裁||r.体裁),structureId:text(m.结构代码||r.结构代码).toUpperCase(),structureName:text(m.结构名称||r.结构名称),structureFit:clean(classification).slice(0,1400),reviewStatus:reviewStatus(analysis||raw),evidenceLevel:analysis?'analyzed':'candidate',analysisStatus:text(m.处理状态||m.复核状态),notePath:note.notePath,obsidianUrl:note.obsidianUrl,originalNotePath:raw?.notePath,originalObsidianUrl:raw?.obsidianUrl,
 recipe:{readerTask:label(recipeSection,['读者任务']),fitTopics:label(recipeSection,['适用选题']),requiredMaterials:label(recipeSection,['所需素材']),cannotUseWithout:label(recipeSection,['缺料时不能使用的条件']),boundary:label(recipeSection,['适用边界'])},
 stages:[...stages.matchAll(/^###\s+(?:\d+\s+)?([^\n·]+)(?:·[^\n]*)?$/gm)].map(x=>clean(x[1])),stageNotes:[],opening:{note:clean(section(body,['开头'])).slice(0,1600)},middle:{advance:clean(section(body,['中段推进与钩子'])).slice(0,1600)},ending:{note:clean(section(body,['结尾'])).slice(0,1600)},hookChains:[],
 // Kept in memory for retrieval only. These fields never go through /api/library.
 _text:sourceBody+'\n'+body,_analysisText:body,_sourceText:sourceBody||body,_notes:[raw,analysis].filter(Boolean),
 };
 // Legacy lexical search can compute this on demand. The passage retriever
 // never reads it, so retaining another normalized copy of every full article
 // would needlessly multiply the live Vault's memory footprint.
 Object.defineProperty(record,'_search',{enumerable:true,get:()=>normalize([record.title,record.account,record.genre,record.structureName,record._text].join(' '))});return record;}
export function queryTerms(q){const s=normalize(q);if(s.length<2)return s?[s]:[];return [...new Set(Array.from({length:s.length-1},(_,i)=>s.slice(i,i+2)))].slice(0,64);}
export function scoreText(value,terms,q=''){if(!terms.length)return 0;let count=0;for(const term of terms)if(value.includes(term))count++;return count/terms.length+(q&&value.includes(normalize(q))?1:0);}
export function excerpt(body,q='',max=1000){const source=clean(body);let offset=-1;const exact=source.toLowerCase().indexOf(String(q).trim().toLowerCase());if(q&&exact>=0)offset=exact;else for(const term of queryTerms(q)){const at=source.toLowerCase().indexOf(term);if(at>=0){offset=at;break;}}const start=Math.max(0,offset-120);return (start?'…':'')+source.slice(start,start+max)+(source.length>start+max?'…':'');}
function searchResult(item,q,terms){
 let body=item._text||'',notePath=item.notePath,obsidianUrl=item.obsidianUrl,kind=item.kind||(item.evidenceLevel==='analyzed'?'全文拆解':'原文候选');
 if(item._sourceText!==undefined){
  const useAnalysis=item._analysisText&&scoreText(normalize(item._analysisText),terms,q)>=scoreText(normalize(item._sourceText),terms,q);
  body=useAnalysis?item._analysisText:item._sourceText;
  if(!useAnalysis&&item.originalNotePath){notePath=item.originalNotePath;obsidianUrl=item.originalObsidianUrl;kind=item.evidenceLevel==='analyzed'?'原文（已关联拆解）':'原文候选';}
 }
 return {id:item.id,title:item.title,notePath,obsidianUrl,snippet:excerpt(body,q,600),kind,reviewStatus:item.reviewStatus,evidenceLevel:item.evidenceLevel};
}

export function createObsidianSource({vaultPath=process.env.OBSIDIAN_VAULT_PATH||join(homedir(),'Documents','Obsidian Vault'),libraryPath=process.env.OBSIDIAN_LIBRARY_PATH||'公众号写作结构库'}={}){
 let records=new Map(),lastRevision='',snapshot=null,inflight=null;
 async function refresh(){
  let vault,root;try{vault=await realpath(resolve(vaultPath));root=await realpath(resolve(vault,libraryPath));if(!within(vault,root)||(await stat(root)).isDirectory()!==true)throw knowledgeError();}catch{throw knowledgeError();}
  const warnings=[],files=[],rounds=[];let hasBaseStructures=false;
  async function walk(dir,rel=''){let entries;try{entries=await readdir(dir,{withFileTypes:true});}catch{if(!rel)throw knowledgeError();warnings.push('目录无法读取：'+rel);return;}
   for(const entry of entries){if(entry.name.startsWith('.'))continue;const path=(rel?rel+'/':'')+entry.name;if(entry.isSymbolicLink()){warnings.push('已跳过符号链接：'+path);continue;}if(entry.isDirectory()){if(!rel&&/^全文拆解v\d+$/.test(entry.name))rounds.push(Number(entry.name.match(/\d+$/)[0]));if(path==='结构')hasBaseStructures=true;await walk(join(dir,entry.name),path);}else if(entry.isFile()&&/\.md$/i.test(entry.name))files.push(path);}
  }
  await walk(root);const latest=rounds.length?Math.max(...rounds):null;
  const active=files.filter(p=>{const v=p.match(/^全文拆解v(\d+)\//);return !v||Number(v[1])===latest;}).sort();
  const next=new Map();let cursor=0;
  await Promise.all(Array.from({length:16},async()=>{while(cursor<active.length){const path=active[cursor++],absolute=join(root,path);try{const info=await stat(absolute,{bigint:true});if(info.size>8_000_000n){warnings.push('笔记过大，未读取：'+path);continue;}const stamp=[info.dev,info.ino,info.mtimeNs,info.ctimeNs,info.size].join(':');const old=records.get(path);if(old?.stamp===stamp){next.set(path,old);continue;}const raw=await readFile(absolute,'utf8');const note=parseNote(raw,path,relative(vault,absolute).split(sep).join('/'),basename(vault));next.set(path,{stamp,modifiedNs:info.mtimeNs,note});}catch(e){if(e.code!=='ENOENT')warnings.push('笔记格式或读取失败：'+path);}}}));
  const revision=hash([...next].sort(([a],[b])=>a.localeCompare(b)).map(([p,r])=>p+':'+r.note.digest+':'+r.modifiedNs).join('\n')+'\n'+latest);
  if(snapshot&&revision===lastRevision&&JSON.stringify(warnings.sort())===JSON.stringify(snapshot.source.warnings)){records=next;return snapshot;}
  const rawById=new Map(),analysisById=new Map(),evidenceByCode=new Map(),definitionNotes=[],ordinary=[],blueprintById=new Map();
  // Concurrent reads complete in arbitrary order. Resolve duplicate IDs by mtime,
  // with a path tie-break, so an unchanged library always yields the same note.
  const ordered=[...next].sort(([a,x],[b,y])=>x.modifiedNs<y.modifiedNs?-1:x.modifiedNs>y.modifiedNs?1:a.localeCompare(b));
  const putArticle=(map,id,n)=>{if(map.has(id))warnings.push('重复文章ID '+id+'，已采用最近编辑的笔记：'+n.path);map.set(id,n);};
  for(const [path,{note:n}] of ordered){const m=n.meta,code=text(m.结构代码).toUpperCase();
   if(m.类型==='叙事蓝图'){
    try{const b=parseBlueprint(n);if(b){if(blueprintById.has(b.id))warnings.push('重复蓝图ID '+b.id+'，已采用最近编辑的笔记：'+path);blueprintById.set(b.id,b);}}catch{warnings.push('叙事蓝图格式无效：'+path);}
    continue;
   }
   if(/^全文拆解v\d+\/结构\//.test(path)){evidenceByCode.set(code,n);if(!hasBaseStructures)definitionNotes.push(n);continue;}
   if(m.类型==='写作结构'||m.类型==='结构模板'||/^结构\//.test(path)){definitionNotes.push(n);continue;}
   if(isAnalysis(n)){putArticle(analysisById,text(m.文章ID)||'note-'+hash(n.notePath).slice(0,16),n);continue;}
   if(sourceArticle(n)){putArticle(rawById,text(m.文章ID)||'note-'+hash(n.notePath).slice(0,16),n);continue;}
   // Generated directory/round summary indexes duplicate the source notes; keep genuine guides and custom notes.
   if(/^(?:目录|体裁|账号)\//.test(path)||/^全文拆解v\d+\/(?:文章|试用)\//.test(path)||/^全文拆解v\d+\/(?:00|01|02|05)\s/.test(path))continue;
   ordinary.push(n);
  }
  const templateById=new Map();for(const n of definitionNotes){const t=getTemplate(n,evidenceByCode.get(text(n.meta.结构代码)));if(t)templateById.set(t.id,t);}
  const templates=[...templateById.values()].sort((a,b)=>a.id.localeCompare(b.id));
  const articles=[];for(const id of new Set([...rawById.keys(),...analysisById.keys()])){const r=makeArticle(rawById.get(id),analysisById.get(id));const year=r.publishDate.match(/^(\d{4})/);if(year&&Number(year[1])<2023)continue;const template=templateById.get(r.structureId);if(template)r.structureName=template.name;articles.push(r);}
  articles.sort((a,b)=>a.id.localeCompare(b.id));
  const notes=ordinary.map(n=>({id:'note-'+hash(n.notePath).slice(0,16),title:n.title,notePath:n.notePath,obsidianUrl:n.obsidianUrl,kind:'笔记',reviewStatus:'参考笔记',evidenceLevel:'candidate',_text:n.body,get _search(){return normalize(n.title+' '+n.body);}}));
  const blueprints=[...blueprintById.values()].sort((a,b)=>a.id.localeCompare(b.id));
  const stats={articles:articles.length,templates:templates.length,independentReviews:articles.filter(a=>a.reviewStatus==='独立复核通过').length,analyzedArticles:articles.filter(a=>a.evidenceLevel==='analyzed').length,notes:notes.length,blueprints:blueprints.length};
  const source={type:'obsidian',name:basename(root),vaultName:basename(vault),libraryPath:root,readOnly:true,refreshMode:'on-demand',connected:true,revision,lastIndexedAt:new Date().toISOString(),indexedFiles:next.size,warnings:warnings.sort().slice(0,30),activeAnalysisVersion:latest?`全文拆解v${latest}`:null};
  records=next;lastRevision=revision;snapshot={templates,articles,notes,blueprints,stats,source,revision};return snapshot;
 }
 async function loadLibrary(){if(inflight)return inflight;inflight=refresh();try{return await inflight;}finally{inflight=null;}}
 async function search({q='',genre='',limit=5}={}){const library=await loadLibrary(),terms=queryTerms(q),count=Math.max(1,Math.min(Number(limit)||5,30));if(!terms.length)return {source:library.source,revision:library.revision,total:0,results:[]};
  const items=[...library.articles.filter(a=>!genre||a.genre===genre),...library.notes,...library.templates.filter(t=>!genre||t.genre===genre).map(t=>({...t,title:t.id+' '+t.name,kind:'写作结构',reviewStatus:'结构定义',evidenceLevel:'analyzed',_text:[t.fit,t.sequence.join(' → '),t.materials,t.boundary,t.hooks].join('\n'),_search:normalize([t.name,t.fit,t.sequence.join(''),t.materials,t.boundary,t.hooks].join(' '))}))];
  const ranked=items.map(a=>({item:a,score:scoreText(a._search||'',terms,q)+scoreText(normalize(a.title),terms,q)*.5})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.item.id.localeCompare(b.item.id));
  return {source:library.source,revision:library.revision,total:ranked.length,results:ranked.slice(0,count).map(({item})=>searchResult(item,q,terms))};
 }
 return {loadLibrary,search};
}
