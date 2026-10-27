import { spawn } from 'node:child_process';
import { mkdir,open } from 'node:fs/promises';
import path from 'node:path';
import { projectRoot,stateDir } from './config';
import { safeId } from './service';
import { ConversationService } from './conversations';
export async function launchConversation(service:ConversationService,turnId:string,origin:string,recover=false){
 safeId(turnId);const url=new URL(origin);if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('持续会话需要通过本机连接器执行');
 await mkdir(path.join(stateDir(),'logs'),{recursive:true});const log=await open(path.join(stateDir(),'logs',`${turnId}.log`),'a',0o600);
 try{const child=spawn(process.execPath,['--import','tsx',path.join(projectRoot(),'scripts/conversation-runner.ts'),turnId,origin,...(recover?['--recover']:[])],{cwd:projectRoot(),env:{...process.env,CASEBENCH_ROOT:projectRoot()},stdio:['ignore',log.fd,log.fd],shell:false,detached:false});child.once('error',e=>{void service.failLaunch(turnId,e.message)});child.unref();}finally{await log.close();}
}
