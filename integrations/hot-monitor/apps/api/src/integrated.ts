// Local service adapter. The original engine and monitor module remain separate from Next.js.
import Fastify from 'fastify';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {config,credential} from '@aihot/backend/config';
import {sql,closeDb} from '@aihot/backend/db';
import {installModules} from '@aihot/backend/modules';
import monitor from '../../../modules/hot-monitor/server.ts';
import {getBoss,workModuleQueues,stopBoss} from '@aihot/backend/jobs/queue';
import {invalidateModelCache} from '@aihot/backend/editorial/models';
import {runModelAutomation} from '../../../modules/hot-monitor/backend/automation.ts';
import {scheduleDueSources} from '@aihot/backend/sources/collect';
import {registerSourceJobs} from '@aihot/backend/jobs/sources';
import {syncSelf} from '../../../modules/hot-monitor/backend/sync.ts';
import {submitWork} from '../../../modules/hot-monitor/backend/jobs.ts';
import {ingestReport,eventById,saveEvent} from '../../../modules/hot-monitor/backend/store.ts';
import {sharedHandler} from '../../../modules/hot-monitor/backend/access.ts';
installModules([monitor]);
const app=Fastify({logger:true,bodyLimit:37*1024*1024});
const bridgeKey=process.env.HOTSPOTS_BRIDGE_KEY;
if(!bridgeKey)throw Error('Missing local bridge key');
app.addHook('onRequest',async(req,reply)=>{if(req.headers['x-hotspots-bridge']!==bridgeKey)return reply.code(403).send({detail:'仅允许网站内部访问'});});
monitor.http!(app);
// One-time, idempotent reconciliation of the former topic pool. Original article source IDs stay intact.
app.post('/api/admin/monitor/local-sources',sharedHandler(async(req)=>{
 const input=z.object({sources:z.array(z.object({id:z.string().min(1).max(130),title:z.string().min(1).max(200),summary:z.string().max(20000),url:z.string().max(2000),source:z.string().max(200),favorite:z.boolean(),publishedAt:z.string().nullable(),createdAt:z.string()})).max(500)}).strict().parse(req.body);
 const links=[];
 for(const source of input.sources){
  const alias='casebench-source:'+source.id;
  const known=(await sql`SELECT event_id FROM hm_aliases WHERE alias=${alias}`)[0];
  let event=known?await eventById(known.event_id):null;
  if(!event){event=await ingestReport({origin:'manual',externalId:alias,title:source.title,summary:source.summary,url:source.url||config.siteUrl+'/hotspots?localSource='+encodeURIComponent(source.id),source:source.source||'手动资料',publishedAt:source.publishedAt,discoveredAt:source.createdAt});if(source.favorite){event.bookmarked=true;await saveEvent(event);}await sql`INSERT INTO hm_aliases(alias,event_id) VALUES(${alias},${event.id}) ON CONFLICT(alias) DO NOTHING`;}
  links.push({sourceId:source.id,eventId:event.id});
 }
 return {links};
}));
app.get('/health',async()=>{await sql`SELECT 1`;return {ready:true,automaticCollection:process.env.COLLECT_ENABLED==='true',modelCalls:config.modelCallsEnabled};});
app.get('/api/admin/monitor/model-connection',sharedHandler(async()=>({model:process.env.LLM_MODEL||'',baseUrl:credential('models','LLM_BASE_URL')||'https://api.deepseek.com/v1',hasKey:!!credential('models','LLM_API_KEY'),enabled:config.modelCallsEnabled})));
app.post('/api/admin/monitor/model-connection',sharedHandler(async(req)=>{
 const v=z.object({model:z.enum(['deepseek-flash','deepseek-v4-flash','deepseek-v4-flash-vision-exp']),key:z.string().max(2000).optional(),enabled:z.boolean(),baseUrl:z.literal('https://api.deepseek.com/v1')}).strict().parse(req.body);
 const directory=config.credentialsDir!;await mkdir(directory,{recursive:true});
 const secret=v.key?.trim()||credential('models','LLM_API_KEY')||'';
 // JSON quoting keeps dotenv values single-line; secret is never returned to the browser.
 await writeFile(path.join(directory,'models.env'),`LLM_API_KEY=${JSON.stringify(secret)}\nLLM_BASE_URL=${v.baseUrl}\n`,{mode:0o600});
 if(v.enabled&&!secret)throw Object.assign(new Error('请先配置模型密钥'),{statusCode:400});
 await sql`DELETE FROM settings WHERE key IN ('models.monitorScore','models.monitorTranslate')`;invalidateModelCache();
 config.modelCallsEnabled=v.enabled;process.env.LLM_MODEL=v.model;process.env.MONITOR_SCORE_MODEL='default';process.env.MONITOR_TRANSLATE_MODEL='default';
 await writeFile(path.join(config.dataDir,'model-choice.json'),JSON.stringify({model:v.model,enabled:v.enabled}),{mode:0o600});
 return {saved:true};
}));
try{const c=JSON.parse(await readFile(path.join(config.dataDir,'model-choice.json'),'utf8'));process.env.LLM_MODEL=c.model;config.modelCallsEnabled=c.enabled===true;}catch{}
// Only monitor queues are consumed. No news publication, notification, or inherited cron schedules run.
const boss=await getBoss();await workModuleQueues(boss);await registerSourceJobs(boss);
let syncUntil=0;
app.post('/api/admin/monitor/collect',sharedHandler(async()=>{syncUntil=Date.now()+10*60000;const scheduled=await scheduleDueSources();await submitWork({kind:'sync'});return scheduled;}));
let ticking=false;const timer=setInterval(async()=>{if(ticking)return;ticking=true;try{await runModelAutomation();if(Date.now()<syncUntil||(await sql`SELECT id FROM pgboss.job WHERE name LIKE 'sources.%' AND state IN ('created','active','retry') LIMIT 1`).length)await syncSelf();}catch{app.log.error('Monitor reconciliation failed');}finally{ticking=false;}},60000);
await app.listen({host:'127.0.0.1',port:config.apiPort});
let stopping=false;async function stop(){if(stopping)return;stopping=true;clearInterval(timer);await app.close();await stopBoss();await closeDb();process.exit(0);}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
