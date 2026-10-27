export function filterTopics(topics,{query='',tab='all',days=0,sort='newest',now=Date.now()}={}) {
 const q=query.trim().toLowerCase();
 return topics.filter(t=>(!q||[t.title,t.summary,...(t.tags||[])].join(' ').toLowerCase().includes(q))&&(tab!=='favorite'||t.favorite)&&(tab!=='unused'||!t.used)&&(!Number(days)||now-new Date(t.publishedAt).getTime()<Number(days)*86400000))
 .sort((a,b)=>sort==='oldest'?Date.parse(a.publishedAt)-Date.parse(b.publishedAt):Date.parse(b.publishedAt)-Date.parse(a.publishedAt));
}
export const toggleSelection=(ids,id)=>ids.includes(id)?ids.filter(x=>x!==id):[...ids,id];
export function makeRequestInput(c){return {brief:c.brief.trim(),genre:c.genre,preferredStructure:c.preferredStructure||undefined,references:c.references.map(r=>({id:r.id,title:r.title,content:r.content||r.summary||'',url:safeUrl(r.url)}))};}
export const inputSnapshot=c=>JSON.stringify(makeRequestInput(c));
export function createVersion(c,draft){return {...draft,references:structuredClone(draft.references??c.references??[]),genre:draft.genre||c.genre,id:crypto.randomUUID(),number:(c.versions?.length||0)+1,createdAt:new Date().toISOString()};}
export const safeUrl=url=>/^https?:\/\//i.test(url||'')?url:'';
export const escapeHtml=s=>String(s||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
export function withSources(draft,references=[]){
 const refs=(draft.sourceIds||references.map(r=>r.id)).map(id=>references.find(r=>r.id===id)).filter(Boolean);
 return draft.markdown+(refs.length?'\n\n---\n\n## 来源资料\n\n'+refs.map((r,i)=>`${i+1}. ${r.title}${safeUrl(r.url)?' — '+safeUrl(r.url):'（用户提供的资料）'}`).join('\n'):'');
}
export function bodyMarkdown(draft){const lines=draft.markdown.split('\n');if(lines[0].replace(/^#\s+/,'').trim()===draft.title.trim())lines.shift();return lines.join('\n').trim();}
function safeMarkdownHtml(markdown){
 const blocks=markdown.split(/\n\s*\n/);return blocks.map(block=>{
  const escaped=escapeHtml(block);const heading=escaped.match(/^(#{1,6})\s+([^\n]+)$/);if(heading)return `<h${heading[1].length}>${heading[2]}</h${heading[1].length}>`;
  if(escaped.split('\n').every(line=>/^[-*] /.test(line)))return '<ul>'+escaped.split('\n').map(line=>'<li>'+line.slice(2)+'</li>').join('')+'</ul>';
  if(escaped.startsWith('&gt; '))return '<blockquote>'+escaped.replace(/^&gt; ?/gm,'').replaceAll('\n','<br>')+'</blockquote>';
  return '<p>'+escaped.replaceAll('\n','<br>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')+'</p>';
 }).join('\n');
}
export function exportHtml(draft){const refs=draft.references||[];return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>'+escapeHtml(draft.title)+'</title><style>body{max-width:760px;margin:60px auto;padding:0 24px;font:16px/1.9 system-ui;color:#242832}h1{font-size:30px}h2{font-size:22px;margin-top:32px}blockquote{border-left:3px solid #b7beff;background:#f7f8fa;padding:12px 18px;margin:20px 0}a{color:#435cff}</style><h1>'+escapeHtml(draft.title)+'</h1>'+safeMarkdownHtml(bodyMarkdown(draft))+(refs.length?'<h2>来源资料</h2><ol>'+refs.map(r=>'<li>'+(safeUrl(r.url)?'<a href="'+escapeHtml(safeUrl(r.url))+'" rel="noreferrer">'+escapeHtml(r.title)+'</a>':escapeHtml(r.title))+'</li>').join('')+'</ol>':'')+'</html>';}

export function downloadFile(content,name,type){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([content],{type}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
export async function api(path,body){let res;try{res=await fetch('/api/'+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(180000)});}catch{throw new Error('连接暂时中断，请确认本地服务正在运行后重试。');}const data=await res.json();if(!res.ok)throw new Error(data.error?.message||'请求未完成，请稍后重试。');return data;}

export function buildRevisionInput(c,instruction){
 const refs=new Set(c.references.map(r=>r.id));
 const removed=(c.draft.sourceIds||[]).filter(id=>!refs.has(id));
 return {...makeRequestInput({...c,genre:c.draft.genre||c.genre}),instruction:removed.length?'当前引用已更新。请删除原稿中依赖已移除来源的论断，不再沿用当前资料不支持的事实。'+instruction:instruction,draft:{title:c.draft.title,markdown:c.draft.markdown,structureId:c.draft.structureId,materialSlots:c.draft.materialSlots,...(c.draft.narrative?{narrative:structuredClone(c.draft.narrative)}:{}),sourceIds:(c.draft.sourceIds||[]).filter(id=>refs.has(id))}};
}

export const mergePoolReferences=(existing,topics,selected)=>[...existing.filter(r=>!topics.some(t=>t.id===r.id)),...topics.filter(t=>selected.includes(t.id))];
export function appendVersion(c,draft){let versions=c.versions;if(c.dirty)versions=[...versions,createVersion(c,{...c.draft,origin:'手动编辑'})];const v=createVersion({...c,versions},draft);return {versions:[...versions,v],draft:v,dirty:false};}
export const editDraftMarkdown=(draft,markdown)=>({...draft,markdown,...(draft.narrative&&markdown!==draft.markdown?{narrative:{...draft.narrative,layoutVerified:false,renderHash:null}}:{})});
export const renameDraft=(draft,title)=>({...editDraftMarkdown(draft,draft.markdown.startsWith('# '+draft.title+'\n')?'# '+title+draft.markdown.slice(draft.title.length+2):draft.markdown),title,...(draft.narrative&&title!==draft.title?{narrative:{...draft.narrative,layoutVerified:false,renderHash:null}}:{})});
