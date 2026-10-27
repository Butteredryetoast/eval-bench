import {spawn} from 'node:child_process';
const children=[spawn(process.execPath,['--watch','server/start.mjs'],{stdio:'inherit',env:process.env}),spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort'],{stdio:'inherit',env:process.env})];
let stopping=false;const stop=()=>{if(stopping)return;stopping=true;children.forEach(c=>c.kill());};for(const sig of ['SIGINT','SIGTERM'])process.on(sig,stop);children.forEach(c=>c.on('exit',code=>{stop();process.exitCode=code||0;}));
