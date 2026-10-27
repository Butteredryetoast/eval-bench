import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
const python=process.env.RAG_PYTHON||resolve('.venv-rag',process.platform==='win32'?'Scripts/python.exe':'bin/python');
const child=spawn(python,['tests/test_rag_store.py'],{stdio:'inherit',env:{...process.env,HAYSTACK_TELEMETRY_ENABLED:'false'}});
child.once('error',()=>{console.error('RAG Python environment missing. Run npm run rag:setup first.');process.exitCode=1;});
child.once('exit',code=>{process.exitCode=code||0;});
