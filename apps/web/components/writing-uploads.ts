import {Extension, type Editor} from '@tiptap/core';
import {Plugin,PluginKey,type EditorState} from '@tiptap/pm/state';
import {Decoration,DecorationSet} from '@tiptap/pm/view';
import type {FileRecord} from '@/packages/contracts';
import {writingMediaError,writingMediaMime} from '@/packages/contracts/writing-media';

export type WritingUpload={id:string;name:string;position:number;rank:number;progress:number;status:'queued'|'uploading'|'failed';error?:string};
type UploadAction={add?:WritingUpload[];update?:{id:string;progress?:number;status?:WritingUpload['status'];error?:string};remove?:string;complete?:{id:string;fileId:string};clear?:boolean};
export const writingUploadsKey=new PluginKey<WritingUpload[]>('writingUploads');
export const writingUploads=(state:EditorState)=>writingUploadsKey.getState(state)||[];
export function changeWritingUploads(editor:Editor,action:UploadAction){if(!editor.isDestroyed)editor.view.dispatch(editor.state.tr.setMeta(writingUploadsKey,action));}

export const WritingUploads=Extension.create<{onAction:(id:string,action:'retry'|'dismiss')=>void}>({
  name:'writingUploads',
  addOptions(){return {onAction:(_id:string,_action:'retry'|'dismiss')=>{}};},
  addProseMirrorPlugins(){const onAction=this.options.onAction;return [new Plugin<WritingUpload[]>({
    key:writingUploadsKey,
    state:{init:()=>[],apply(tr,previous){
      const action=tr.getMeta(writingUploadsKey) as UploadAction|undefined;
      if(action?.clear)return [];
      const completing=previous.find(v=>v.id===action?.complete?.id);
      let inserted:{from:number;to:number}|undefined;
      if(completing)tr.doc.descendants((node,pos)=>{if(!inserted&&node.type.name==='writingMedia'&&node.attrs.fileId===action?.complete?.fileId)inserted={from:pos,to:pos+node.nodeSize};});
      let next=previous.filter(v=>v.id!==action?.remove&&v.id!==action?.complete?.id).flatMap(v=>{
        // A block inserted at a paragraph's first text position is moved outside
        // that paragraph. Anchor its siblings to the actual media boundaries.
        if(completing&&inserted&&v.position===completing.position)return [{...v,position:v.rank<completing.rank?inserted.from:inserted.to}];
        const mapped=tr.mapping.mapResult(v.position,1);
        return mapped.deletedAcross?[]:[{...v,position:mapped.pos,...(action?.update?.id===v.id?action.update:{})}];
      });
      if(action?.add)next=[...next,...action.add];return next;
    }},
    props:{decorations(state){return DecorationSet.create(state.doc,writingUploads(state).map(item=>Decoration.widget(item.position,()=>{
      const span=document.createElement('span');span.className='wd-upload-placeholder '+item.status;span.contentEditable='false';span.dataset.uploadId=item.id;span.setAttribute('role','status');
      const label=document.createElement('span');label.className='wd-upload-name';label.textContent=item.name;span.append(label);
      const status=document.createElement('small');status.textContent=item.status==='failed'?item.error||'上传失败':item.status==='queued'?'等待上传':item.progress===100?'正在插入…':`正在上传 ${item.progress}%`;span.append(status);
      if(item.status==='uploading'){const progress=document.createElement('progress');progress.max=100;progress.value=item.progress;progress.setAttribute('aria-label',item.name+'上传进度');span.append(progress);}
      for(const [action,title]of (item.status==='failed'?[['retry','重试'],['dismiss','移除']]:[['dismiss','取消']]) as ['retry'|'dismiss',string][]){const button=document.createElement('button');button.type='button';button.textContent=title;button.setAttribute('aria-label',title+' '+item.name);button.onmousedown=e=>e.preventDefault();button.onclick=e=>{e.preventDefault();e.stopPropagation();onAction(item.id,action);};span.append(button);}
      return span;
    },{key:`${item.id}:${item.status}:${item.progress}:${item.error||''}`,side:item.rank+1})));}},
  })];},
});

export function uploadWritingMedia(file:File,onProgress:(progress:number)=>void,setAbort:(abort:()=>void)=>void):Promise<FileRecord>{
  const error=writingMediaError(file);if(error)return Promise.reject(new Error(error));
  return new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest(),body=new FormData(),mime=writingMediaMime(file.name,file.type);
    body.set('file',file.type===mime?file:new File([file],file.name,{type:mime}));
    xhr.open('POST','/api/editorial/files');xhr.timeout=180000;
    xhr.upload.onprogress=e=>{if(e.lengthComputable)onProgress(Math.min(100,Math.round(e.loaded/e.total*100)));};
    xhr.onload=()=>{let result:any;try{result=JSON.parse(xhr.responseText);}catch{reject(new Error('上传响应无效，请重试'));return;}if(xhr.status>=200&&xhr.status<300)resolve(result);else reject(new Error(result.error||'上传失败，请重试'));};
    xhr.onerror=()=>reject(new Error('网络中断，请重试'));xhr.ontimeout=()=>reject(new Error('上传超时，请重试'));xhr.onabort=()=>reject(new Error('上传已取消'));
    setAbort(()=>xhr.abort());xhr.send(body);
  });
}
