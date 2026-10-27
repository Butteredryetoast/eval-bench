import {spawn,spawnSync} from 'node:child_process';
import {readFile,writeFile,open,mkdir} from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
const root=path.resolve(import.meta.dirname,'..'),vendor=path.join(root,'integrations/hot-monitor'),data=path.join(vendor,'.data');
const read=async f=>JSON.parse(await readFile(path.join(data,f),'utf8'));
const c=await read('database.json'),bridge=await read('bridge.json');
const ready=port=>new Promise(resolve=>{const s=net.connect({host:'127.0.0.1',port});s.once('connect',()=>{s.destroy();resolve(true);});s.once('error',()=>resolve(false));});
const command=process.argv[2]||'start';let state={};try{state=await read('processes.json');}catch{}
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
if(command==='stop'){if(state.api&&alive(state.api))process.kill(state.api,'SIGTERM');console.log('热点服务正在停止，数据库与网站保持运行');process.exit();}
if(command==='status'){console.log(JSON.stringify({database:await ready(c.port),api:await ready(bridge.port),pid:state.api||null}));process.exit();}
if(!await ready(c.port)){
 const r=spawnSync(path.join(data,'postgres-tools/bin/pg_ctl'),['-D',path.join(data,'postgres'),'-l',path.join(data,'postgres.log'),'-o',`-h 127.0.0.1 -p ${c.port}`,'start'],{encoding:'utf8'});if(r.status!==0)throw Error('热点数据库启动失败，请查看 integrations/hot-monitor/.data/postgres.log');
}
if(await ready(bridge.port)){
 try{const r=await fetch(`http://127.0.0.1:${bridge.port}/health`,{headers:{'x-hotspots-bridge':bridge.key}});if(r.ok){console.log('热点服务已就绪');process.exit();}}catch{}
 throw Error('热点接口端口被其他服务占用');
}
await mkdir(path.join(data,'credentials'),{recursive:true});
const env={...process.env,NODE_ENV:'development',DATABASE_URL:`postgres://${c.user}:${c.password}@127.0.0.1:${c.port}/${c.database}`,API_PORT:String(bridge.port),SITE_URL:'http://127.0.0.1:43110',AIHOT_DATA_DIR:data,AIHOT_CREDENTIALS_DIR:path.join(data,'credentials'),HOTSPOTS_BRIDGE_KEY:bridge.key,COLLECT_ENABLED:'false',MODEL_CALLS_ENABLED:'false',MONITOR_SCORE_MODEL:'default',MONITOR_TRANSLATE_MODEL:'default',LLM_MODEL:'deepseek-flash'};
const fd=await open(path.join(data,'service.log'),'a',0o600);
const child=spawn(process.execPath,['apps/api/src/integrated.ts'],{cwd:vendor,env,detached:true,stdio:['ignore',fd.fd,fd.fd]});child.unref();await fd.close();
await writeFile(path.join(data,'processes.json'),JSON.stringify({api:child.pid}),{mode:0o600});
for(let i=0;i<80;i++){await new Promise(r=>setTimeout(r,250));if(await ready(bridge.port)){console.log('热点搜集服务已启动');process.exit();}if(!alive(child.pid))break;}
throw Error('热点服务未就绪，请查看 integrations/hot-monitor/.data/service.log');
