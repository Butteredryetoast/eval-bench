import { marked, type Token } from 'marked';
import { diffArrays } from 'diff';
import type { DocumentNode, RevisionChange, WritingArticle } from '../contracts/editorial';

export const emptyDocument = ():DocumentNode => ({type:'doc',content:[{type:'paragraph'}]});
const safeLink=(v:unknown)=>typeof v==='string'&&/^(https?:\/\/|mailto:)/i.test(v);
// Store a small, explicit document schema rather than arbitrary pasted HTML.
export function validateDocument(value:unknown, article:WritingArticle):DocumentNode {
  if(JSON.stringify(value).length>500000)throw Error('正文过长，请拆成多篇文章');
  let count=0;
  const allowed=new Set(['doc','paragraph','heading','text','hardBreak','bulletList','orderedList','listItem','blockquote','codeBlock','horizontalRule','writingReference','writingMedia']);
  function visit(raw:any,depth=0):DocumentNode {
    if(!raw||!allowed.has(raw.type)||depth>16||++count>10000)throw Error('正文格式无效');
    const n:DocumentNode={type:raw.type};
    if(raw.type==='text'){if(typeof raw.text!=='string'||!raw.text)throw Error('正文文字无效');n.text=raw.text;}
    if(raw.content){if(!Array.isArray(raw.content))throw Error('正文结构无效');n.content=raw.content.map((c:unknown)=>visit(c,depth+1));}
    if(raw.marks){if(!Array.isArray(raw.marks))throw Error('文字格式无效');n.marks=raw.marks.map((m:any)=>{if(!['bold','italic','strike','code','underline','link'].includes(m.type))throw Error('不支持的文字格式');if(m.type==='link'){if(!safeLink(m.attrs?.href))throw Error('仅支持安全的网页链接');return {type:'link',attrs:{href:m.attrs.href,target:'_blank',rel:'noopener noreferrer'}};}return {type:m.type};});}
    if(raw.type==='heading')n.attrs={level:Math.max(1,Math.min(3,Number(raw.attrs?.level)||2))};
    if(raw.type==='orderedList')n.attrs={start:Math.max(1,Number(raw.attrs?.start)||1)};
    if(raw.type==='codeBlock')n.attrs={language:String(raw.attrs?.language||'').slice(0,40)};
    if(raw.type==='writingReference'){const ref=article.references.find(r=>r.id===raw.attrs?.referenceId);if(!ref)throw Error('引用不存在，请重新选择');n.attrs={referenceId:ref.id};delete n.content;}
    if(raw.type==='writingMedia'){const file=[...article.media,...article.references.flatMap(r=>r.files)].find(f=>f.id===raw.attrs?.fileId);if(!file)throw Error('素材不存在，请重新选择');n.attrs={fileId:file.id,caption:String(raw.attrs?.caption||'').slice(0,500)};delete n.content;}
    return n;
  }
  const doc=visit(value);if(doc.type!=='doc'||!doc.content?.length)throw Error('正文结构无效');return doc;
}

function inline(tokens:Token[]|undefined):DocumentNode[]{return (tokens||[]).flatMap((t:any):DocumentNode[]=>{
  if(t.type==='br')return [{type:'hardBreak'}];
  if(['strong','em','del','link'].includes(t.type)){
    const mark=t.type==='strong'?'bold':t.type==='em'?'italic':t.type==='del'?'strike':'link';
    return inline(t.tokens).map(n=>({...n,marks:[...(n.marks||[]),...(mark==='link'&&!safeLink(t.href)?[]:[{type:mark,...(mark==='link'?{attrs:{href:t.href}}:{})}])]}));
  }
  if(t.type==='codespan')return t.text?[{type:'text',text:t.text,marks:[{type:'code'}]}]:[];
  if(t.tokens)return inline(t.tokens);const text=t.text||t.raw||'';return text?[{type:'text',text}]:[];
});}
function blocks(tokens:Token[]):DocumentNode[]{return tokens.flatMap((t:any):DocumentNode[]=>{
  if(t.type==='space')return [];
  if(t.type==='heading')return [{type:'heading',attrs:{level:Math.min(t.depth,3)},content:inline(t.tokens)}];
  if(t.type==='code')return [{type:'codeBlock',attrs:{language:t.lang||''},...(t.text?{content:[{type:'text',text:t.text}]}:{})}];
  if(t.type==='hr')return [{type:'horizontalRule'}];
  if(t.type==='blockquote')return [{type:'blockquote',content:blocks(t.tokens)}];
  if(t.type==='list')return [{type:t.ordered?'orderedList':'bulletList',...(t.ordered?{attrs:{start:t.start||1}}:{}),content:t.items.map((i:any)=>({type:'listItem',content:blocks(i.tokens)}))}];
  return [{type:'paragraph',content:inline(t.tokens||[{type:'text',text:t.text||t.raw||''}])}];
});}
export function markdownDocument(text:string):DocumentNode{const content=blocks(marked.lexer(text));return {type:'doc',content:content.length?content:[{type:'paragraph'}]};}
export function documentText(doc:DocumentNode,media:WritingArticle['media']=[]):string {
  function render(n:DocumentNode):string{const kids=()=>n.content?.map(render).join('')||'';switch(n.type){case 'text':{let t=n.text||'';for(const m of n.marks||[])t=m.type==='bold'?`**${t}**`:m.type==='italic'?`*${t}*`:m.type==='strike'?`~~${t}~~`:m.type==='code'?`\`${t}\``:m.type==='link'&&safeLink(m.attrs?.href)?`[${t}](${m.attrs!.href})`:t;return t;}case 'hardBreak':return '\n';case 'writingReference':return '';case 'writingMedia':{const f=media.find(f=>f.id===n.attrs?.fileId);return f?`\n\n${f.mime.startsWith('image/')?'!':''}[${n.attrs?.caption||f.name}](/api/files/${f.id})\n\n`:'';}case 'heading':return '#'.repeat(Number(n.attrs?.level)||2)+' '+kids()+'\n\n';case 'paragraph':return kids()+'\n\n';case 'listItem':return '- '+kids();case 'orderedList':return n.content?.map((c,i)=>`${(Number(n.attrs?.start)||1)+i}. ${c.content?.map(render).join('').trim()}\n`).join('')+'\n';case 'codeBlock':return '```\n'+kids()+'\n```\n\n';case 'horizontalRule':return '\n---\n';default:return kids();}}
  return render(doc).trim();
}
export function normalizeArticle(a:WritingArticle):WritingArticle {
  if(a.document)return {...a,documentRevision:a.documentRevision||0,versions:a.versions||[],proposal:a.proposal||null};
  const latest=[...a.messages].reverse().find(m=>m.role==='assistant'&&m.status==='complete');
  return {...a,document:latest?markdownDocument(latest.text):emptyDocument(),documentRevision:0,versions:[],proposal:null};
}
export function revisionChanges(before:DocumentNode,after:DocumentNode):RevisionChange[]{
  const changes:RevisionChange[]=[];let index=0;
  for(const part of diffArrays(before.content||[],after.content||[],{comparator:(a,b)=>JSON.stringify(a)===JSON.stringify(b)})){
    if(!part.added&&!part.removed){index+=part.value.length;continue;}
    const last=changes.at(-1);let h=last&&last.index+last.before.length===index?last:undefined;
    if(!h){h={id:'change-'+changes.length,index,before:[],after:[]};changes.push(h);}
    if(part.removed){h.before.push(...part.value);index+=part.value.length;}else h.after.push(...part.value);
  }
  return changes;
}
export function revisionDocument(a:WritingArticle,text:string,scope?:{start:number;end:number}):DocumentNode {
  const base=a.document||emptyDocument(),original=base.content||[],start=scope?.start??0,end=scope?.end??original.length;
  const replacement=markdownDocument(text).content||[];
  // Context cards and chosen media remain at their section anchors even when AI rewrites prose.
  original.slice(start,end).forEach((n,i)=>{if(n.type==='writingReference'||n.type==='writingMedia')replacement.splice(Math.min(i,replacement.length),0,n);});
  return {...base,content:[...original.slice(0,start),...replacement,...original.slice(end)]};
}
