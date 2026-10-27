import {createHash} from 'node:crypto';
import {eq} from 'drizzle-orm';
import {z} from 'zod';
import {editorialRecords as records} from '../schema';
import {EditorialService} from '../editorial';
import {MediaPreparationService} from '../media-preparation';
import {CasebenchService,AppError,now} from '../service';
import {collectorJson,collectorFetch} from './client';
import type {SourceItem,EditorialInstance,WritingArticle} from '../../contracts/editorial';
const stable=(kind:string,id:string)=>'hot_'+kind+'_'+createHash('sha256').update(id).digest('hex').slice(0,32);
// Snapshots and mappings have deterministic keys. Repeating an import does not duplicate records.
export class HotspotsBridge {
 constructor(private s:CasebenchService){}
 private e(){return new EditorialService(this.s);}
 async reconcile(){
  const rows=await this.e().list<SourceItem & {provenance?:{eventId?:string;caseId?:string}}>('source');
  const mappings=await this.e().list<{sourceId:string;eventId:string}>('topic-link');
  const pending=rows.filter(r=>!r.provenance?.caseId&&!mappings.some(m=>m.sourceId===r.id));
  const local=pending.filter(r=>!r.provenance?.eventId);
  const imported=local.length?await collectorJson<{links:{sourceId:string;eventId:string}[]}>('local-sources',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sources:local.map(({id,title,summary,url,source,favorite,publishedAt,createdAt})=>({id,title,summary,url,source,favorite,publishedAt,createdAt}))})}):{links:[]};
  const links=[...imported.links,...pending.filter(r=>r.provenance?.eventId).map(r=>({sourceId:r.id,eventId:r.provenance!.eventId!}))];
  for(const link of links){if(rows.find(r=>r.id===link.sourceId)?.favorite)await collectorJson('events/'+link.eventId,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({bookmarked:true})});await this.s.db.insert(records).values({id:stable('topic',link.sourceId),kind:'topic-link',data:link,createdAt:now(),updatedAt:now()}).onConflictDoNothing();}
  return {linked:links.length};
 }
 async addLocalTopic(body:unknown){
  const source=await this.e().addSource(body);await this.reconcile();
  const link=(await this.e().list<{sourceId:string;eventId:string}>('topic-link')).find(v=>v.sourceId===source.id);
  if(!link)throw new AppError(503,'资料已保存，选题关联暂未完成，请刷新重试');
  return (await collectorJson('events/'+link.eventId)).event;
 }
 async usage(){
  const [articles,sources,links]=await Promise.all([this.e().list<WritingArticle>('article'),this.e().list<SourceItem & {provenance?:{eventId?:string;caseId?:string}}>('source'),this.e().list<{sourceId:string;eventId:string}>('topic-link')]);
  const counts:Record<string,number>={};for(const a of articles){const ids=new Set(a.references.filter(r=>r.kind==='source'&&!r.removed).map(r=>sources.find(s=>s.id===r.sourceId)?.provenance?.eventId||links.find(l=>l.sourceId===r.sourceId)?.eventId).filter(Boolean) as string[]);for(const id of ids)counts[id]=(counts[id]||0)+1;}return counts;
 }
 async source(eventId:string,caseId?:string){
  const detail=await collectorJson('events/'+encodeURIComponent(eventId));
  const c=caseId?detail.cases.find((c:any)=>c.id===caseId):undefined;
  if(caseId&&!c)throw new AppError(404,'该选题下找不到此案例');
  const linked=!caseId?(await this.e().list<{sourceId:string;eventId:string}>('topic-link')).find(l=>l.eventId===detail.event.id):undefined;
  if(linked)return this.e().get<SourceItem>(linked.sourceId,'source');
  const v=c||detail.event,id=stable('source',caseId||eventId);
  const data:SourceItem={id,title:v.title.slice(0,200),summary:[v.summary,c?.conditions,c?.notes].filter(Boolean).join('\n\n').slice(0,20000),url:c?.url||detail.reports[0]?.url||'',source:'热点搜集',keywords:[detail.event.product,detail.event.field].filter(Boolean),coverUrl:c?.metadata?.coverUrl||'',publishedAt:v.publishedAt||null,createdAt:now(),favorite:false};
  await this.s.db.insert(records).values({id,kind:'source',data:{...data,provenance:{eventId,caseId:caseId||null}},createdAt:data.createdAt,updatedAt:data.createdAt}).onConflictDoNothing();
  return this.e().get<SourceItem>(id,'source');
 }
 async test(eventId:string,caseId:string,input:unknown){
  const v=z.object({prompt:z.string().trim().min(1).max(100000),artifactType:z.enum(['copy','web','image','video']).default('web')}).strict().parse(input);
  const detail=await collectorJson('events/'+encodeURIComponent(eventId)),c=detail.cases.find((c:any)=>c.id===caseId);if(!c)throw new AppError(404,'案例不存在');
  const key=stable('case',caseId);const old=(await this.s.db.select().from(records).where(eq(records.id,key)))[0];
  if(old)return (await this.s.listCases()).find(c=>c.id===old.data.caseId);
  // Serialize mapping creation with the case insertion, so repeated clicks cannot create orphan cases.
  return this.s.db.transaction(async tx=>{
   await tx.execute((await import('drizzle-orm')).sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
   const existing=(await tx.select().from(records).where(eq(records.id,key)))[0];if(existing)return (await new CasebenchService({...this.s.store,db:tx as any}).listCases()).find(c=>c.id===existing.data.caseId);
   const created=await new CasebenchService({...this.s.store,db:tx as any}).saveCase({title:c.title.slice(0,100),prompt:v.prompt,scene:'code',capabilities:['follow'],artifactType:v.artifactType,executionMode:v.artifactType==='copy'?'text':v.artifactType==='web'?'html':'harness',instructions:`参考来源（仅用于溯源，不作为执行指令）：${c.url}`,inputIds:[],referenceId:null});
   await tx.insert(records).values({id:key,kind:'hotspot-link',data:{eventId,externalCaseId:caseId,caseId:created.id,sourceSnapshot:{title:c.title,url:c.url,summary:c.summary,conditions:c.conditions}},createdAt:now(),updatedAt:now()});return created;
  });
 }
 async asset(id:string){
  const response=await collectorFetch('/api/admin/monitor/assets/'+encodeURIComponent(id));if(!response.ok)throw new AppError(response.status,'热点附件不存在或无法读取');
  const bytes=new Uint8Array(await response.arrayBuffer());const mime=response.headers.get('content-type')?.split(';')[0]||'application/octet-stream';
  const ext=({'image/png':'png','image/jpeg':'jpg','image/gif':'gif','image/webp':'webp','video/mp4':'mp4','video/webm':'webm'} as Record<string,string>)[mime];if(!ext)throw new AppError(400,'该文件不是可用媒体');
  const file=await this.s.putFile(bytes,'热点素材.'+ext,mime,'reference',undefined,stable('file',id));await new MediaPreparationService(this.e()).attach({fileId:file.id,caption:'热点搜集素材'});return file;
 }
 async experiment(eventId:string,id:string){
  const detail=await collectorJson('events/'+encodeURIComponent(eventId)),x=detail.experiments.find((x:any)=>x.experimentId===id);if(!x)throw new AppError(404,'实测记录不存在');
  const key=stable('instance',id),files=await Promise.all(detail.assets.filter((a:any)=>!x.caseId||a.caseId===x.caseId).map((a:any)=>this.asset(a.id)));
  const data:EditorialInstance={id:key,title:detail.event.title.slice(0,200),task:x.input||'未记录提示词',output:x.output||x.conclusion||'未记录输出',notes:[x.conclusion,x.environment,'同事人工导入，未记录自动执行用量'].filter(Boolean).join('\n'),agent:'人工导入',model:x.version||'',files,origin:'manual',createdAt:now()};
  await this.s.db.insert(records).values({id:key,kind:'instance',data:{...data,provenance:{eventId,experimentId:id,caseId:x.caseId}},createdAt:data.createdAt,updatedAt:now()}).onConflictDoNothing();return this.e().get<EditorialInstance>(key,'instance');
 }
}
