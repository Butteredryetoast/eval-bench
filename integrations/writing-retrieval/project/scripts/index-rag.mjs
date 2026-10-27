import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {createObsidianSource} from '../server/obsidian.mjs';
import {createHaystackClient} from '../server/haystack-client.mjs';
import {createHaystackKnowledge} from '../server/haystack-knowledge.mjs';

try{process.loadEnvFile();}catch{}
const sample=Number(process.argv.find(arg=>arg.startsWith('--sample='))?.split('=')[1]||0);
const source=createObsidianSource();let library=await source.loadLibrary();
if(sample){
 const picked=new Map(),required=['A100685','A400039','A500405','A600264','A100513','A300231','A400237','A200152'];
 for(const id of required){const item=library.articles.find(a=>a.id===id);if(item)picked.set(id,item);}
 const pools=[...new Set(library.articles.map(a=>a.genre))].map(genre=>library.articles.filter(a=>a.genre===genre));
 for(let cursor=0;picked.size<sample&&pools.some(pool=>cursor<pool.length);cursor++)for(const pool of pools){if(picked.size>=sample)break;if(pool[cursor])picked.set(pool[cursor].id,pool[cursor]);}
 library={...library,articles:[...picked.values()],revision:createHash('sha256').update(library.revision+':sample:'+sample).digest('hex')};
}
const client=createHaystackClient({cacheDir:sample?resolve('.rag-cache/sample-'+sample):undefined,timeoutMs:300_000});
let last=0;
const knowledge=createHaystackKnowledge({client,onProgress:event=>{if(Date.now()-last>5000||event.done===event.total){console.log(JSON.stringify({phase:'indexing',...event}));last=Date.now();}}});
try{
 console.log(JSON.stringify({phase:'start',scope:sample?'sample':'full',articles:library.articles.length,templates:library.templates.length}));
 const started=Date.now();await knowledge.synchronize(library);console.log(JSON.stringify({phase:'ready',seconds:Math.round((Date.now()-started)/1000),...client.info()}));
 if(process.argv.includes('--probe')){
  for(const input of [
   {brief:'两款视频生成工具的实测对比，比较镜头连续性、人物一致性和失败场景，说明怎么选',genre:'测评'},
   {brief:'如何部署本地知识库，交代准备条件、操作步骤、常见错误和验收',genre:'教程'},
   {brief:'大模型上下文窗口和长期记忆有什么区别，向新手解释工作原理',genre:'科普'},
  ]){const t=Date.now(),result=await knowledge.retrieve(library,input,6);console.log(JSON.stringify({phase:'probe',input,ms:Date.now()-t,examples:result.examples.map(e=>({id:e.id,title:e.title,match:e.match})),structures:result.structureMatches}));}
 }
}catch(error){console.error(error.message);console.error(client.diagnostics());process.exitCode=1;}
finally{client.close();}
