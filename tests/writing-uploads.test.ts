import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EditorState} from '@tiptap/pm/state';
import {writingSchema} from '../packages/core/writing-selection';
import {WritingUploads,writingUploadsKey,writingUploads,type WritingUpload} from '../apps/web/components/writing-uploads';
import {writingMediaError,writingMediaMime,WRITING_VIDEO_LIMIT,WRITING_IMAGE_LIMIT} from '../packages/contracts/writing-media';

function state(){const plugins=WritingUploads.config.addProseMirrorPlugins!.call({options:WritingUploads.options} as any);return EditorState.create({schema:writingSchema,doc:writingSchema.node('doc',null,[writingSchema.node('paragraph',null,writingSchema.text('Before. After.'))]),plugins});}
const upload=(id:string,rank:number):WritingUpload=>({id,name:id+'.png',position:8,rank,status:'queued',progress:0});

test('upload anchors follow editing and remain outside saved documents',()=>{
 let s=state();s=s.apply(s.tr.setMeta(writingUploadsKey,{add:[upload('one',0)]}));
 s=s.apply(s.tr.insertText('Prefix ',1));assert.equal(writingUploads(s)[0].position,15);
 assert.doesNotMatch(JSON.stringify(s.doc.toJSON()),/queued|one.png|writingUploads/);
 s=s.apply(s.tr.setMeta(writingUploadsKey,{remove:'one'}));assert.deepEqual(writingUploads(s),[]);
});
for(const position of [1,8,15])test(`retrying an earlier failed file preserves batch order at position ${position}`,()=>{
 let s=state();s=s.apply(s.tr.setMeta(writingUploadsKey,{add:[upload('first',0),upload('second',1),upload('third',2)].map(v=>({...v,position}))}));
 s=s.apply(s.tr.setMeta(writingUploadsKey,{update:{id:'first',status:'failed',error:'Network'}}));
 for(const id of ['second','third','first']){const at=writingUploads(s).find(v=>v.id===id)!;s=s.apply(s.tr.replaceRangeWith(at.position,at.position,writingSchema.nodes.writingMedia.create({fileId:id})).setMeta(writingUploadsKey,{complete:{id,fileId:id}}));}
 assert.deepEqual(s.doc.toJSON().content.filter((n:any)=>n.type==='writingMedia').map((n:any)=>n.attrs.fileId),['first','second','third']);
 assert.equal(writingUploads(s).length,0);assert.match(s.doc.textContent,/Before\./);assert.match(s.doc.textContent,/After\./);
});
test('media validation separates video limits and rejects document attachments',()=>{
 assert.equal(writingMediaMime('recording.mov',''),'video/quicktime');
 assert.equal(writingMediaError({name:'clip.mp4',type:'video/mp4',size:WRITING_IMAGE_LIMIT+1}),'');
 assert.match(writingMediaError({name:'clip.mp4',type:'video/mp4',size:WRITING_VIDEO_LIMIT+1}),/100 MB/);
 assert.match(writingMediaError({name:'animation.gif',type:'image/gif',size:WRITING_IMAGE_LIMIT+1}),/25 MB/);
 assert.match(writingMediaError({name:'article.html',type:'text/html',size:10}),/正文只支持/);
});
