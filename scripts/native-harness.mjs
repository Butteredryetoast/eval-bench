import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {runAcpSession,runWorkbuddySession} from './native-agents.mjs';
process.env.CASEBENCH_ROOT ||= fileURLToPath(new URL('../',import.meta.url));
const id=process.argv[2];
try{
 if(!['workbuddy','deepseek','minimax'].includes(id))throw Error('未知的本机 Agent');
 const task=JSON.parse(await readFile(process.env.CASEBENCH_TASK_FILE,'utf8'));
 if(task.case.executionMode!=='text'||task.case.artifactType!=='copy'||task.inputPaths.length)throw Error('此适配目前支持无附件文本任务');
 const prompt=`${task.case.prompt}\n${task.case.instructions||''}\n\n只返回正文；此次为文本评测，不调用工具、不读取或修改文件。`;
 const text=id==='workbuddy'?await runWorkbuddySession(task,prompt):await runAcpSession(task,prompt,id);
 process.stdout.write(text);
}catch(e){process.stderr.write(e.message+'\n');process.exitCode=1;}
