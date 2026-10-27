import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {AppError} from '../service';
import {projectRoot} from '../config';
export async function collectorConfig(){
 try {return JSON.parse(await readFile(process.env.HOTSPOTS_CONFIG_FILE||path.join(projectRoot(),'integrations/hot-monitor/.data/bridge.json'),'utf8')) as {port:number;key:string};}
 catch{throw new AppError(503,'热点服务尚未启动，请运行启动脚本');}
}
export async function collectorFetch(route:string,init:RequestInit={}){
 const c=await collectorConfig();if(!/^\/(?:health|api\/admin\/monitor(?:\/|$))/.test(route)||route.includes('..')||route.includes('\\'))throw new AppError(400,'无效的热点接口');
 try{return await fetch(`http://127.0.0.1:${c.port}${route}`,{...init,cache:'no-store',headers:{'x-hotspots-bridge':c.key,...init.headers},signal:AbortSignal.timeout(60000)});}
 catch{throw new AppError(503,'热点服务暂时不可用，请检查本机服务状态');}
}
export async function collectorJson<T=any>(route:string,init:RequestInit={}):Promise<T>{
 const response=await collectorFetch('/api/admin/monitor/'+route,init);const result=await response.json();if(!response.ok)throw new AppError(response.status,result.detail||result.error||'热点操作失败');return result;
}
