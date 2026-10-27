import {spawn} from 'node:child_process';
import {access} from 'node:fs/promises';
import {resolve} from 'node:path';
const python=process.env.RAG_PYTHON||resolve('.venv-rag',process.platform==='win32'?'Scripts/python.exe':'bin/python');
const run=(exe,args)=>new Promise((done,reject)=>{const child=spawn(exe,args,{stdio:'inherit',env:{...process.env,HAYSTACK_TELEMETRY_ENABLED:'false'}});child.once('error',reject);child.once('exit',code=>code===0?done():reject(new Error('RAG setup failed ('+code+')')));});
try{
 try{await access(python);}catch{await run(process.env.PYTHON||'python3',['-m','venv','.venv-rag']);}
 await run(python,['-m','pip','install','--disable-pip-version-check','--timeout','180','--retries','3','-r','server/rag/requirements.txt']);
 await run(python,['scripts/setup-rag-models.py']);
 console.log('Pinned Chinese models verified. Run npm run rag:index to index the current Vault.');
}catch(error){console.error(error.message);process.exitCode=1;}
