import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,stat} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import {createStore} from '../packages/core/db';
import {CasebenchService} from '../packages/core/service';
import {EditorialService,writingPrompt} from '../packages/core/editorial';
import {ArticleMaterialsService} from '../packages/core/article-materials';
import {MediaPreparationService} from '../packages/core/media-preparation';
import {WritingDocumentService} from '../packages/core/writing-service';
import {documentText,markdownDocument} from '../packages/core/writing-document';

test('upload registration unions files without changing text, context or pending AI messages',async()=>{
 const dir=await mkdtemp('/private/tmp/casebench-upload-register-'),store=await createStore(dir);
 try{const e=new EditorialService(new CasebenchService(store)),m=new ArticleMaterialsService(e),w=new WritingDocumentService(e),source=await e.addSource({title:'AI context',summary:'Source fact'});let a=await e.create({references:[{kind:'source',id:source.id}]});a=await w.save(a.id,{documentRevision:0,document:markdownDocument('Keep my manual prose')});
 const before=a.document,refs=a.references,rev=a.documentRevision;
 await e.mutate(a.id,'article',(current:any)=>({...current,messages:[{id:'pending',role:'assistant',text:'',createdAt:new Date().toISOString(),status:'pending'}]}));
 const one=await e.s.putFile(new Uint8Array([1]),'a.png','image/png','reference'),two=await e.s.putFile(new Uint8Array([2]),'b.gif','image/gif','reference');
 await Promise.all([m.media(a.id,{fileIds:[one.id]}),m.media(a.id,{fileIds:[two.id]})]);a=await e.get<typeof a>(a.id,'article');
 assert.deepEqual(a.media.map(f=>f.id).sort(),[one.id,two.id].sort());assert.deepEqual(a.document,before);assert.deepEqual(a.references,refs);assert.equal(a.documentRevision,rev);assert.equal(a.messages[0].status,'pending');
 const again=await m.media(a.id,{fileIds:[one.id]});assert.equal(again.revision,a.revision);
 const html=await e.s.putFile(new Uint8Array([3]),'a.html','text/html','reference');await assert.rejects(m.media(a.id,{fileIds:[html.id]}),/正文只支持/);
 const video=new Uint8Array(25*1024*1024+1);await assert.rejects(e.s.putFile(video,'too-big.png','image/png','reference'),/25 MB/);const accepted=await e.s.putFile(video,'large.mp4','video/mp4','reference',undefined,undefined,{editorialVideo:true});assert.equal(accepted.size,video.length);
 }finally{await store.close();await rm(dir,{recursive:true,force:true});}
});

test('article context supports ten sources, isolation, deduplication and reversible disabling without inserting body cards',async()=>{
 const dir=await mkdtemp('/private/tmp/casebench-materials-'),store=await createStore(dir);
 try{const e=new EditorialService(new CasebenchService(store)),m=new ArticleMaterialsService(e),sources=await Promise.all(Array.from({length:10},(_,n)=>e.addSource({title:'Source '+n,summary:'unique_fact_'+n})));let a=await e.create({}),b=await e.create({});
 a=await m.references(a.id,{revision:0,add:sources.map(s=>({kind:'source',id:s.id}))});assert.equal(a.references.length,10);assert.equal(documentText(a.document!), '');assert.equal((await e.article(b.id)).references.length,0);
 a=await m.references(a.id,{revision:a.revision,add:[{kind:'source',id:sources[0].id}]});assert.equal(a.references.length,10);
 a=await m.references(a.id,{revision:a.revision,enabled:[{id:a.references[0].id,value:false}],remove:[a.references[1].id]});assert.doesNotMatch(writingPrompt(a,'Draft'),/unique_fact_0|unique_fact_1"/);assert.match(writingPrompt(a,'Draft'),/unique_fact_9/);
 a=await m.references(a.id,{revision:a.revision,add:[{kind:'source',id:sources[1].id}]});assert.equal(a.references.length,10);assert.match(writingPrompt(a,'Draft'),/unique_fact_1/);
 await assert.rejects(m.references(a.id,{revision:0,add:[]}),/已更新/);
 }finally{await store.close();await rm(dir,{recursive:true,force:true});}
});
test('explicit body insertion is positional, editable, idempotent and does not silently enable AI context',async()=>{
 const dir=await mkdtemp('/private/tmp/casebench-body-insert-'),store=await createStore(dir);
 try{const e=new EditorialService(new CasebenchService(store)),m=new ArticleMaterialsService(e),w=new WritingDocumentService(e),i=await e.addInstance({title:'Tutorial',task:'A task',output:'Actual result paragraph'});let a=await e.create({});a=await w.save(a.id,{documentRevision:0,document:markdownDocument('Before.\n\nAfter.')});const key=randomUUID(),body={documentRevision:a.documentRevision,position:9,requestKey:key,references:[{kind:'instance',id:i.id,parts:['output'],includeFiles:false}]};a=await m.insert(a.id,body);
 const text=documentText(a.document!);assert.match(text,/Before\.[\s\S]*Actual result paragraph[\s\S]*After\./);assert.doesNotMatch(text,/任务与提示词|尚未人工|人工导入/);assert.ok(!a.document?.content?.some(n=>n.type==='writingReference'));assert.equal(a.references.filter(r=>!r.removed&&r.enabled!==false).length,0);
 const again=await m.insert(a.id,body);assert.equal(again.documentRevision,a.documentRevision);assert.equal(documentText(again.document!),text);
 await assert.rejects(m.insert(a.id,{...body,requestKey:randomUUID()}),/正文已更新/);
 a=await w.save(a.id,{documentRevision:a.documentRevision,document:markdownDocument('User revised the inserted content')});assert.match(documentText(a.document!),/User revised/);
 }finally{await store.close();await rm(dir,{recursive:true,force:true});}
});
test('real clip processing produces GIF and MP4, keeps original bytes and persists observations separately',async()=>{
 const dir=await mkdtemp('/private/tmp/casebench-media-process-'),store=await createStore(dir);
 try{const source=dir+'/source.mp4';execFileSync(ffmpeg!,['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc=size=320x180:rate=10','-t','2','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-y',source]);const e=new EditorialService(new CasebenchService(store)),m=new MediaPreparationService(e),bytes=await readFile(source),f=await e.s.putFile(bytes,'original.mp4','video/mp4','reference'),i=await e.addInstance({title:'Recorded tutorial',task:'Try',output:'Actual result',fileIds:[f.id]});
 const p=await m.save(i.id,{revision:0,reviewed:true,observation:'Verified the real interaction'});assert.equal(p.revision,1);await assert.rejects(m.save(i.id,{revision:0,reviewed:false,observation:''}),/已更新/);
 await m.attach({fileId:f.id,instanceId:i.id,origin:'recorded'});const body={fileId:f.id,instanceId:i.id,start:.3,end:1.4,width:320,fps:8};const gif=await m.process({...body,format:'gif'}),mp4=await m.process({...body,format:'mp4'});const recompressed=await m.process({...body,fileId:gif.file.id,format:'gif',start:0,end:.6,width:160});assert.equal(recompressed.parentFileId,gif.file.id);assert.equal(recompressed.file.mime,'image/gif');assert.equal(gif.parentFileId,f.id);assert.equal(gif.file.mime,'image/gif');assert.equal((await readFile(e.s.filePath(gif.file.id))).subarray(0,3).toString(),'GIF');assert.ok((await stat(e.s.filePath(mp4.file.id))).size>1000);
 assert.equal(createHash('sha256').update(await readFile(e.s.filePath(f.id))).digest('hex'),createHash('sha256').update(bytes).digest('hex'));
 const updated=(await e.instances()).find(x=>x.id===i.id)!;assert.equal(updated.media?.length,4);assert.equal(updated.preparation?.reviewed,true);const ref=await e.snapshot({kind:'instance',id:i.id});assert.match(ref.notes,/Verified the real interaction/);
 await assert.rejects(m.process({...body,format:'gif',end:.1}),/有效片段/);await assert.rejects(m.process({...body,format:'gif',end:150}),/120 秒/);
 }finally{await store.close();await rm(dir,{recursive:true,force:true});}
});
