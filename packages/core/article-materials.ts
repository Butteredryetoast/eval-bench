import {z} from 'zod';
import {Slice,Fragment} from '@tiptap/pm/model';
import {Transform} from '@tiptap/pm/transform';
import type {EditorialService} from './editorial';
import type {DocumentNode,WritingArticle,WritingReference} from '../contracts/editorial';
import {AppError,now} from './service';
import {normalizeArticle,markdownDocument,validateDocument} from './writing-document';
import {writingSchema} from './writing-selection';
import {documentVersion} from './writing-service';
import {isWritingMedia} from '../contracts/writing-media';

const choice=z.object({kind:z.enum(['source','instance','media']),id:z.string().max(130),parts:z.array(z.enum(['task','output','notes'])).default(['task','output','notes']),includeFiles:z.boolean().default(true),includeMetrics:z.boolean().default(false)}).strict();
const key=(r:WritingReference)=>r.kind+':'+r.sourceId;
export class ArticleMaterialsService {
  constructor(private e:EditorialService){}
  async media(id:string,body:unknown){
    const v=z.object({fileIds:z.array(z.string().max(130)).min(1).max(20)}).strict().parse(body);
    const files=await Promise.all([...new Set(v.fileIds)].map(id=>this.e.s.file(id)));
    if(files.some(f=>!isWritingMedia(f.mime)))throw new AppError(400,'正文只支持图片、GIF 和视频');
    // Union under the article lock: registering an upload never replaces prose or AI context.
    return this.e.mutate<WritingArticle>(id,'article',raw=>{
      const a=normalizeArticle(raw),media=[...new Map([...a.media,...files].map(f=>[f.id,f])).values()];
      return media.length===a.media.length?a:{...a,media,revision:a.revision+1,updatedAt:now()};
    });
  }
  async references(id:string,body:unknown){const v=z.object({revision:z.number().int(),add:z.array(choice).max(30).default([]),remove:z.array(z.string()).max(30).default([]),enabled:z.array(z.object({id:z.string(),value:z.boolean()})).max(30).default([])}).strict().parse(body);const refs=await Promise.all(v.add.map(r=>this.e.snapshot(r)));return this.e.mutate<WritingArticle>(id,'article',raw=>{const a=normalizeArticle(raw);if(a.revision!==v.revision)throw new AppError(409,'文章资料已更新，请重新读取');if(a.messages.some(m=>m.status==='pending'))throw new AppError(409,'生成中，请稍后调整本篇资料');const references=a.references.map(r=>({...r,...(v.remove.includes(r.id)?{removed:true,enabled:false}:{}),...(v.enabled.find(e=>e.id===r.id)?{enabled:v.enabled.find(e=>e.id===r.id)!.value}:{})}));for(const ref of refs){const existing=references.find(r=>key(r)===key(ref));if(existing){existing.removed=false;existing.enabled=true;}else references.push({...ref,enabled:true});}if(references.filter(r=>!r.removed).length>30)throw new AppError(400,'每篇文章最多添加 30 条资料');return {...a,references,revision:a.revision+1,updatedAt:now()};});}
  async insert(id:string,body:unknown){const v=z.object({documentRevision:z.number().int(),position:z.number().int().nonnegative(),requestKey:z.string().uuid(),references:z.array(choice).max(20).default([]),fileIds:z.array(z.string()).max(20).default([]),caption:z.string().max(500).default('')}).strict().parse(body);const existing=normalizeArticle(await this.e.get<WritingArticle>(id,'article'));if(existing.insertions?.includes(v.requestKey))return existing;const refs=await Promise.all(v.references.map(r=>this.e.snapshot(r))),files=await Promise.all(v.fileIds.map(id=>this.e.s.file(id)));
    const instances=v.references.some(r=>r.kind==='instance')?await this.e.instances():[];
    return this.e.mutate<WritingArticle>(id,'article',raw=>{const a=normalizeArticle(raw);if(a.insertions?.includes(v.requestKey))return a;if(a.documentRevision!==v.documentRevision)throw new AppError(409,'正文已更新，请重新选择插入位置');const references=[...a.references];const nodes:DocumentNode[]=[];for(const ref of refs){const old=references.find(r=>key(r)===key(ref));if(!old)references.push({...ref,enabled:false,removed:true});const choice=v.references[refs.indexOf(ref)],instance=instances.find(i=>i.id===ref.sourceId),notes=ref.kind==='instance'?(choice.parts.includes('notes')?[instance?.preparation?.observation,instance?.notes].filter(Boolean).join('\n\n'):''):ref.notes;const text=[ref.task?`### 任务与提示词\n\n${ref.task}`:'',ref.output,notes?`### 实际观察与说明\n\n${notes}`:'',choice.includeMetrics&&instance?'执行指标：'+JSON.stringify(instance.metrics||{}):'',ref.url?`来源：[${ref.title}](${ref.url})`:''].filter(Boolean).join('\n\n');if(text)nodes.push(...markdownDocument(text).content!);}
      const media=[...new Map([...a.media,...files].map(f=>[f.id,f])).values()];for(const file of files)nodes.push({type:'writingMedia',attrs:{fileId:file.id,caption:v.caption||file.name}});if(!nodes.length)throw new AppError(400,'请至少选择一段内容或一个素材');const doc=writingSchema.nodeFromJSON(a.document);if(v.position>doc.content.size)throw new AppError(409,'插入位置已变化');const content=Fragment.fromArray(nodes.map(n=>writingSchema.nodeFromJSON(n))),document=new Transform(doc).replaceRange(v.position,v.position,new Slice(content,0,0)).doc.toJSON();validateDocument(document,{...a,references,media});return {...a,document,references,media,documentRevision:(a.documentRevision||0)+1,revision:a.revision+1,updatedAt:now(),versions:[...(a.versions||[]),documentVersion(a,'插入正文前')].slice(-30),insertions:[...(a.insertions||[]),v.requestKey].slice(-100)};});
  }
}
