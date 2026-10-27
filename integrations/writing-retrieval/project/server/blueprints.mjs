import {createHash} from 'node:crypto';

const ID=/^[a-z][a-z0-9-]{0,79}$/;
const TYPES=new Set(['narration','material','observation','transition']);
const MATERIALS=new Set(['fact','quote','data','case','image','video']);
const fail=message=>{throw Object.assign(new Error(message),{code:'INVALID_BLUEPRINT'});};
const value=(object,key,max=2000)=>String(object[key]??'').trim().slice(0,max);
const section=(body,name)=>body.match(new RegExp('^## '+name+'\\s*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))','m'))?.[1]?.trim()||'';

export function parseBlueprint(note){
 const m=note.meta,body=note.body,id=value(m,'蓝图ID',64),structureId=value(m,'关联结构',4);
 if(m.状态==='停用')return null;
 if(!/^NEWS-[A-Z0-9-]+$/.test(id)||m.体裁!=='资讯'||!/^N[1-4]$/.test(structureId)||!['试用','启用'].includes(m.状态)||!value(m,'蓝图版本',32))fail('蓝图元信息无效');
 const sourceArticleIds=Array.isArray(m.来源文章)?m.来源文章.map(String):[];
 if(!sourceArticleIds.length||sourceArticleIds.length>8||new Set(sourceArticleIds).size!==sourceArticleIds.length)fail('蓝图缺少可追溯的来源文章');
 const nodes=[];let node,beat,target;
 for(const line of section(body,'叙事节点').split(/\r?\n/)){
  const n=line.match(/^###\s+([a-z][a-z0-9-]*)\s*·\s*(.+)$/),b=line.match(/^####\s+([a-z][a-z0-9-]*)\s*·\s*(\w+)\s*$/);
  if(n){node={id:n[1],title:n[2].trim(),fields:{},beats:[]};nodes.push(node);beat=null;target=node.fields;continue;}
  if(b){if(!node)fail('叙事片段缺少所属节点');beat={id:b[1],type:b[2],fields:{}};node.beats.push(beat);target=beat.fields;continue;}
  const field=line.match(/^([^：\n]+)：(.*)$/);if(field&&target)target[field[1].trim()]=field[2].trim();
 }
 if(nodes.length<2||nodes.length>10)fail('蓝图需要 2–10 个叙事节点');
 const seen=new Set(),nodeIds=new Set(),materials=new Set();let total=0;
 for(const n of nodes){
  if(!ID.test(n.id)||nodeIds.has(n.id)||!n.title||n.beats.length<1)fail('叙事节点重复或为空');nodeIds.add(n.id);
  n.readerQuestion=value(n.fields,'读者问题');n.move=value(n.fields,'叙事动作');n.transition=value(n.fields,'承接');n.evidence=value(n.fields,'原文依据');delete n.fields;
  if(!n.readerQuestion||!n.move||!n.transition||!n.evidence)fail('节点缺少问题、动作、承接或原文依据');
  for(const b of n.beats){
   if(!ID.test(b.id)||seen.has(b.id)||!TYPES.has(b.type)||++total>60)fail('片段 ID 重复、类型无效或数量过多');seen.add(b.id);
   b.instruction=value(b.fields,'任务');b.dependsOn=value(b.fields,'依赖').split(/[,，、]/).map(s=>s.trim()).filter(Boolean);
   if(!b.instruction||b.dependsOn.some(id=>!materials.has(id))||new Set(b.dependsOn).size!==b.dependsOn.length)fail('任务为空，或依赖了尚未出现的素材');
   if(b.type==='observation'&&!b.dependsOn.length)fail('观察必须关联素材');
   if(b.type==='material'){
    b.kind=value(b.fields,'种类',20);b.role=value(b.fields,'作用');b.required=value(b.fields,'必需',2)!=='否';
    if(!MATERIALS.has(b.kind)||!b.role||b.dependsOn.length)fail('素材种类、作用或依赖无效');materials.add(b.id);
   }
   delete b.fields;
  }
 }
 if(!materials.size)fail('蓝图没有素材节点');
 return {id,name:body.match(/^#\s+(.+)$/m)?.[1]?.trim()||id,genre:'资讯',structureId,version:value(m,'蓝图版本',32),status:m.状态,
  revision:note.digest||createHash('sha256').update(JSON.stringify(m)+body).digest('hex'),fit:section(body,'适用任务'),needs:section(body,'材料前提'),boundary:section(body,'使用边界'),observed:section(body,'原文观察'),sourceArticleIds,nodes,notePath:note.notePath,obsidianUrl:note.obsidianUrl};
}
