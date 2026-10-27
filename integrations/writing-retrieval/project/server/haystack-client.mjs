import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,writeFile,readFile,open,unlink,rename} from 'node:fs/promises';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const unavailable=()=>Object.assign(new Error('本地 RAG 检索暂不可用，请检查中文模型和语义索引状态。'),{code:'RAG_UNAVAILABLE'});
export function createHaystackClient({pythonPath=process.env.RAG_PYTHON||resolve(ROOT,'.venv-rag',process.platform==='win32'?'Scripts/python.exe':'bin/python'),cacheDir=process.env.RAG_CACHE_DIR||resolve(ROOT,'.rag-cache'),modelsDir=process.env.RAG_MODELS_DIR||resolve(ROOT,'.rag-cache/models'),timeoutMs=120_000,threads=Number(process.env.RAG_THREADS)||2,rankCandidates=Number(process.env.RAG_RANK_CANDIDATES)||20}={}){
 let child,sequence=0,queue=Promise.resolve(),status={engine:'haystack-fastembed-v1',phase:'starting',ready:false,vectorSearch:false,remoteModelCalls:0},lastError='';
 const pending=new Map(),lockPath=resolve(cacheDir,'indexing.lock');let persistence=Promise.resolve();
 const persist=()=>{const snapshot=JSON.stringify(status,null,2)+'\n';persistence=persistence.then(async()=>{await mkdir(cacheDir,{recursive:true,mode:0o700});const temp=resolve(cacheDir,'status.'+process.pid+'.tmp');await writeFile(temp,snapshot,{mode:0o600});await rename(temp,resolve(cacheDir,'status.json'));}).catch(()=>{});return persistence;};
 async function lockOwner(){try{const lock=JSON.parse(await readFile(lockPath,'utf8'));if(!Number.isInteger(lock.pid)||lock.pid<=0)return null;try{process.kill(lock.pid,0);return lock;}catch(error){if(error.code==='EPERM')return lock;return null;}}catch{return null;}}
 async function acquireIndexLock(){
  await mkdir(cacheDir,{recursive:true,mode:0o700});
  for(let attempt=0;attempt<2;attempt++){
   try{const file=await open(lockPath,'wx',0o600);try{await file.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));}finally{await file.close();}return;}
   catch(error){if(error.code!=='EEXIST')throw error;if(await lockOwner())throw Object.assign(new Error('知识库正在建立语义索引，请等待完成后再匹配；可在设置中查看进度。'),{code:'RAG_INDEXING'});await unlink(lockPath).catch(()=>{});}
  }
  throw unavailable();
 }
 async function releaseIndexLock(){if((await lockOwner())?.pid===process.pid)await unlink(lockPath).catch(()=>{});}
 function fail(){status={...status,phase:'error',ready:false,error:'本地检索进程不可用'};for(const entry of pending.values())entry.reject(unavailable());pending.clear();child=undefined;persist();}
 function start(){
  if(child)return;
  child=spawn(pythonPath,[resolve(ROOT,'server/rag/worker.py')],{cwd:ROOT,stdio:['pipe','pipe','pipe'],env:{...process.env,RAG_CACHE_DIR:resolve(cacheDir),RAG_MODELS_DIR:resolve(modelsDir),RAG_THREADS:String(threads),RAG_RANK_CANDIDATES:String(rankCandidates),PYTHONUNBUFFERED:'1',HAYSTACK_TELEMETRY_ENABLED:'false',HF_HUB_DISABLE_TELEMETRY:'1',TOKENIZERS_PARALLELISM:'false'}});
  const active=child,died=()=>{if(child===active)fail();};
  child.on('error',died);child.on('exit',died);
  child.stderr.on('data',chunk=>{lastError=(lastError+chunk.toString()).slice(-4000);});
  createInterface({input:child.stdout}).on('line',line=>{
   let response;try{response=JSON.parse(line);}catch{lastError='Unexpected worker output';return;}
   const entry=pending.get(response.id);if(!entry)return;pending.delete(response.id);
   if(response.error){status={...status,phase:'error',ready:false,error:'本地检索执行失败'};persist();entry.reject(unavailable());}else entry.resolve(response.result);
  });
  child.stdin.on('error',()=>{});
 }
 async function request(method,params={}){
  const work=async()=>{
   start();const id=++sequence;
   return new Promise((resolveResult,reject)=>{
    const timer=setTimeout(()=>{child?.kill();reject(unavailable());},timeoutMs);
    pending.set(id,{resolve:value=>{clearTimeout(timer);resolveResult(value);},reject:error=>{clearTimeout(timer);reject(error);}});
    // JSON permits lone UTF-16 surrogates after an upstream string limit;
    // normalize those before Python/tokenizers encode them as UTF-8.
    child.stdin.write(JSON.stringify({id,method,params},(_key,value)=>typeof value==='string'?value.toWellFormed():value)+'\n',error=>{if(error){pending.delete(id);clearTimeout(timer);reject(unavailable());}});
   });
  };
  const task=queue.then(work);queue=task.catch(()=>{});return task;
 }
 async function health(){
  const owner=await lockOwner();
  if(owner&&owner.pid!==process.pid){try{status={...JSON.parse(await readFile(resolve(cacheDir,'status.json'),'utf8')),ready:false,phase:'indexing'};}catch{status={...status,ready:false,phase:'indexing'};}return status;}
  const next=await request('health');status={...status,...next,ready:Boolean(next.revision),phase:next.revision?'ready':next.sources?'indexing':'empty'};persist();return status;
 }
 async function plan(manifest){status={...status,phase:'checking'};return request('plan',{manifest});}
 async function upsert(source,progress){status={...status,phase:'indexing',ready:false,...progress};persist();return request('upsert',{source});}
 async function commit(manifest,revision){const next=await request('commit',{manifest,revision});status={...status,...next,done:status.total||0,ready:true,phase:'ready',error:undefined};await persist();return status;}
 async function query(input){const result=await request('query',input);status={...status,...result.meta,phase:'ready',ready:true,error:undefined};persist();return result;}
 function close(){const active=child;child=undefined;active?.kill();for(const entry of pending.values())entry.reject(unavailable());pending.clear();}
 process.once('exit',close);
 return {health,plan,upsert,commit,query,acquireIndexLock,releaseIndexLock,close,info:()=>({...status}),diagnostics:()=>lastError};
}
