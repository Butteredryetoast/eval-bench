import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { parseEnv } from "node:util";
import { config } from "@aihot/backend/config";
import { getConnections, saveConnection } from "../backend/connections.ts";

const names=["DAJIALA_KEY","DAJIALA_BASE_URL","SOCIALDATA_API_KEY","SOCIALDATA_BASE_URL"];
const oldEnv=Object.fromEntries(names.map(name=>[name,process.env[name]]));
const oldDirectory=config.credentialsDir,oldPrivate=config.allowPrivateNetworkFetch;
let directory:string;
before(async()=>{
  directory=await mkdtemp(path.join(os.tmpdir(),"hot-monitor-connections-"));
  config.credentialsDir=directory;config.allowPrivateNetworkFetch=true;
  for(const name of names)delete process.env[name];
});
after(async()=>{
  config.credentialsDir=oldDirectory;config.allowPrivateNetworkFetch=oldPrivate;
  for(const name of names){if(oldEnv[name]===undefined)delete process.env[name];else process.env[name]=oldEnv[name];}
  await rm(directory,{recursive:true,force:true});
});
const file=()=>path.join(directory,"collectors.env");

test("connections expose configuration booleans without any key or unsafe URL component",async()=>{
  await writeFile(file(),"# existing collectors\nDAJIALA_KEY='fixture-private-dajiala'\nDAJIALA_BASE_URL='https://name:password@www.dajiala.com/api?token=private-query#secret-fragment'\nSOCIALDATA_API_KEY='fixture-private-socialdata'\n",{mode:0o600});
  const data=await getConnections();assert.equal(data.connections.length,2);
  const wechat=data.connections.find(row=>row.provider==="dajiala")!;assert.equal(wechat.hasKey,true);assert.equal(wechat.enabled,true);assert.equal(wechat.managedBy,"file");assert.equal(wechat.editable,true);assert.equal(wechat.baseUrl,"https://www.dajiala.com/api");
  const serialized=JSON.stringify(data);for(const value of ["fixture-private-dajiala","fixture-private-socialdata","password","private-query","secret-fragment"])assert.ok(!serialized.includes(value));
  assert.equal(data.connections.find(row=>row.provider==="socialdata")!.baseUrl,"https://api.socialdata.tools");
});

test("connections retain blank keys and other multiline settings, atomically save both providers, and apply private filesystem modes",async()=>{
  await writeFile(file(),"# retain this note\nOTHER_SETTING='original'\nMULTILINE='first\nsecond'\nDAJIALA_KEY='existing-fixture-key'\nSOCIALDATA_API_KEY='existing-social-key'\n",{mode:0o644});
  await chmod(directory,0o755);
  const results=await Promise.all([saveConnection("dajiala",{key:"",baseUrl:"https://www.dajiala.com/v3"}),saveConnection("socialdata",{key:"new-fixture-social-key"})]);
  assert.equal(results[0].hasKey,true);assert.equal(results[1].hasKey,true);
  const source=await readFile(file(),"utf8"),parsed=parseEnv(source);
  assert.equal(parsed.DAJIALA_KEY,"existing-fixture-key");assert.equal(parsed.DAJIALA_BASE_URL,"https://www.dajiala.com/v3");assert.equal(parsed.SOCIALDATA_API_KEY,"new-fixture-social-key");assert.equal(parsed.OTHER_SETTING,"original");assert.equal(parsed.MULTILINE,"first\nsecond");assert.ok(source.includes("# retain this note"));
  assert.equal((await stat(file())).mode&0o777,0o600);assert.equal((await stat(directory)).mode&0o777,0o700);assert.ok(!(await readdir(directory)).some(name=>name.endsWith(".tmp")));
  const before=source;await saveConnection("dajiala",{key:"   ",baseUrl:"  "});assert.equal(await readFile(file(),"utf8"),before);
});

test("connections refuse environment overrides and unsupported credential storage without pretending a save succeeded",async()=>{
  await writeFile(file(),"DAJIALA_KEY='file-only-fixture'\n",{mode:0o600});const before=await readFile(file(),"utf8");
  process.env.DAJIALA_BASE_URL="https://www.dajiala.com";
  try{
    const row=(await getConnections()).connections.find(row=>row.provider==="dajiala")!;assert.equal(row.managedBy,"env");assert.equal(row.editable,false);assert.match(row.note!,/环境变量/);
    await assert.rejects(saveConnection("dajiala",{key:"replacement"}),{code:"CONNECTION_MANAGED_BY_ENV",statusCode:400});assert.equal(await readFile(file(),"utf8"),before);
  }finally{delete process.env.DAJIALA_BASE_URL;}
  config.credentialsDir=null;
  try{
    assert.ok((await getConnections()).connections.every(row=>row.managedBy==="unsupported"&&!row.editable));
    await assert.rejects(saveConnection("socialdata",{key:"replacement"}),{code:"CONNECTION_DIRECTORY_UNSET",statusCode:400});
  }finally{config.credentialsDir=directory;}
});

test("connections reject unsafe addresses, unknown fields and migration of an existing key to another host",async()=>{
  await writeFile(file(),"DAJIALA_KEY='retained-fixture-key'\n",{mode:0o600});
  for(const baseUrl of ["http://api.example.org","https://user:secret@api.example.org","https://api.example.org?token=secret","https://api.example.org/#fragment","file:///private/file"]){
    await assert.rejects(saveConnection("dajiala",{baseUrl}),{code:"INVALID_CONNECTION_BASE_URL",statusCode:400});
  }
  await assert.rejects(saveConnection("dajiala",{key:"line1\nANOTHER_SETTING=bad"}),{code:"INVALID_CONNECTION_KEY",statusCode:400});
  await assert.rejects(saveConnection("unknown",{key:"private-input"}),{code:"UNKNOWN_CONNECTION_PROVIDER",statusCode:400});
  await assert.rejects(saveConnection("dajiala",{key:"private-input",headers:{authorization:"secret"}}),{code:"INVALID_CONNECTION_INPUT",statusCode:400});
  await assert.rejects(saveConnection("dajiala",{baseUrl:"https://other.example.org"}),{code:"BASE_URL_KEY_REQUIRED",statusCode:400});
  config.allowPrivateNetworkFetch=false;
  try{await assert.rejects(saveConnection("dajiala",{baseUrl:"https://127.0.0.1",key:"replacement"}),{code:"UNSAFE_CONNECTION_BASE_URL",statusCode:400});}finally{config.allowPrivateNetworkFetch=true;}
  assert.equal(parseEnv(await readFile(file(),"utf8")).DAJIALA_KEY,"retained-fixture-key");
});

test("saving local test credentials never performs a service request and write failures expose only safe messages",async()=>{
  let hits=0;const server=http.createServer((_req,res)=>{hits++;res.end("must not be called");});await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  try{
    const baseUrl="http://127.0.0.1:"+(server.address() as {port:number}).port;
    const result=await saveConnection("dajiala",{baseUrl,key:"new-host-fixture-key"});assert.equal(result.baseUrl,baseUrl);assert.equal(hits,0);assert.ok(!JSON.stringify(result).includes("new-host-fixture-key"));
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
  const invalidPath=path.join(directory,"regular-file-not-directory");await writeFile(invalidPath,"not a directory");config.credentialsDir=invalidPath;
  try{
    await assert.rejects(saveConnection("socialdata",{key:"must-not-appear-in-error"}),(error:any)=>{assert.equal(error.statusCode,400);assert.ok(!error.message.includes("must-not-appear-in-error"));assert.ok(!error.message.includes(invalidPath));return true;});
  }finally{config.credentialsDir=directory;}
});

test("credential consumers see an atomic file replacement without an API or worker restart",async()=>{
  const {credential}=await import("@aihot/backend/config");const {rename}=await import("node:fs/promises");
  await writeFile(file(),"DAJIALA_KEY='before-hot-update'\n",{mode:0o600});assert.equal(credential("collectors","DAJIALA_KEY"),"before-hot-update");
  await saveConnection("dajiala",{key:"after-hot-update"});assert.equal(credential("collectors","DAJIALA_KEY"),"after-hot-update");
  const replacement=path.join(directory,"replacement.env");await writeFile(replacement,"DAJIALA_KEY='another-process-write'\n",{mode:0o600});await rename(replacement,file());assert.equal(credential("collectors","DAJIALA_KEY"),"another-process-write");
  process.env.DAJIALA_KEY="environment-wins";assert.equal(credential("collectors","DAJIALA_KEY"),"environment-wins");delete process.env.DAJIALA_KEY;assert.equal(credential("collectors","DAJIALA_KEY"),"another-process-write");
});
