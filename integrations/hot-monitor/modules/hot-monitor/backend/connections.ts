import path from "node:path";
import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { parseEnv } from "node:util";
import { config } from "@aihot/backend/config";
import { assertPublicUrl } from "@aihot/backend/lib/url";
import { DEPLOYMENT } from "@aihot/site";
import { CONNECTION_PROVIDERS, type ConnectionProvider, type ConnectionStatus, type ConnectionsData } from "../connections-contracts.ts";

const providers = {
  dajiala:{name:"极致了 · 公众号",key:"DAJIALA_KEY",base:"DAJIALA_BASE_URL",defaultBase:"https://www.dajiala.com",capabilities:["公众号账号采集","公众号文章关键词搜索","公众号正文与视频入口读取"]},
  socialdata:{name:"SocialData · X",key:"SOCIALDATA_API_KEY",base:"SOCIALDATA_BASE_URL",defaultBase:"https://api.socialdata.tools",capabilities:["X账号动态采集","X关键词搜索","X帖子文字与媒体线索"]},
} as const;

function failure(code: string, message: string) { return Object.assign(new Error(message),{statusCode:400,code}); }
function providerId(input: unknown): ConnectionProvider {
  if (typeof input !== "string" || !CONNECTION_PROVIDERS.includes(input as ConnectionProvider)) throw failure("UNKNOWN_CONNECTION_PROVIDER","不支持的采集服务，只能配置极致了或SocialData。");
  return input as ConnectionProvider;
}
function filePath() {
  if (!config.credentialsDir) return null;
  const name = DEPLOYMENT.credentialFiles.collectors ?? "collectors.env";
  if (path.basename(name) !== name) throw failure("CONNECTION_FILE_UNAVAILABLE","采集凭据文件配置不支持网页编辑，请在本机检查配置。");
  return path.join(config.credentialsDir,name);
}
async function readCollectors(): Promise<{source:string;values:Record<string,string>}> {
  const file = filePath();
  if (!file) return {source:"",values:{}};
  try {
    if ((await lstat(file)).isSymbolicLink()) throw failure("CONNECTION_FILE_UNAVAILABLE","采集凭据文件不能通过链接文件编辑，请在本机检查配置。");
    const source = await readFile(file,"utf8");
    return {source,values:parseEnv(source) as Record<string,string>};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {source:"",values:{}};
    if ((error as {statusCode?:number}).statusCode) throw error;
    throw failure("CONNECTION_FILE_UNAVAILABLE","无法读取采集凭据文件，请在本机检查文件权限与格式。");
  }
}
function displayBase(raw: string, fallback: string) {
  try {
    const url = new URL(raw);
    if (!["http:","https:"].includes(url.protocol)) return fallback;
    url.username="";url.password="";url.search="";url.hash="";
    return url.toString().replace(/\/$/,"");
  } catch { return fallback; }
}
function status(provider: ConnectionProvider, values: Record<string,string>): ConnectionStatus {
  const entry=providers[provider],overridden=[entry.key,entry.base].some(name=>process.env[name]!==undefined);
  const rawKey=process.env[entry.key]??values[entry.key]??"",rawBase=process.env[entry.base]??values[entry.base]??entry.defaultBase;
  const managedBy=overridden?"env":config.credentialsDir?"file":"unsupported";
  const hasKey=Boolean(rawKey.trim());
  return {provider,name:entry.name,hasKey,enabled:hasKey,baseUrl:displayBase(rawBase,entry.defaultBase),managedBy,editable:managedBy==="file",capabilities:[...entry.capabilities],note:managedBy==="env"?"该服务由进程环境变量管理，网页不能覆盖；请在本机修改环境配置。":managedBy==="unsupported"?"尚未配置凭据目录，网页不能保存；请在本机设置AIHOT_CREDENTIALS_DIR。":"保存后供后续采集请求使用，不会自动试调用、充值或启用信源；已配置不代表余额充足或接口验证成功。"};
}
export async function getConnections(): Promise<ConnectionsData> {
  const {values}=await readCollectors();
  return {connections:CONNECTION_PROVIDERS.map(provider=>status(provider,values))};
}
function inputFields(body: unknown): {key?:string;baseUrl?:string} {
  if (!body || typeof body!=="object" || Array.isArray(body)) throw failure("INVALID_CONNECTION_INPUT","请填写有效的服务配置。");
  const fields=body as Record<string,unknown>;
  if (Object.keys(fields).some(name=>name!=="key"&&name!=="baseUrl") || Object.values(fields).some(value=>typeof value!=="string")) throw failure("INVALID_CONNECTION_INPUT","服务配置只支持API Key和接口地址。");
  const key=(fields.key as string|undefined)?.trim(),baseUrl=(fields.baseUrl as string|undefined)?.trim();
  if (key && (key.length>4096 || /[\r\n\0]/.test(key))) throw failure("INVALID_CONNECTION_KEY","API Key格式无效，请粘贴单行密钥。");
  if (baseUrl && baseUrl.length>2000) throw failure("INVALID_CONNECTION_BASE_URL","接口地址格式无效。");
  return {...(key?{key}:{}),...(baseUrl?{baseUrl}:{})};
}
function quote(value:string) {
  for (const mark of ["'",'"',"`"]) {
    if(value.includes(mark))continue;
    const result=mark+value+mark;
    if(parseEnv("VALUE="+result).VALUE===value)return result;
  }
  throw failure("INVALID_CONNECTION_KEY","API Key格式无法安全保存，请检查是否包含多余引号。");
}
function replaceField(source:string,name:string,value:string) {
  const pattern=new RegExp("^[\\t ]*(?:export[\\t ]+)?"+name+"[\\t ]*=[\\t ]*(?:\"[^\"]*\"|'[^']*'|`[^`]*`|[^\\r\\n]*)(?:\\r?\\n|$)","gm");
  const remaining=source.replace(pattern,"");
  return remaining+(remaining&&!remaining.endsWith("\n")?"\n":"")+name+"="+quote(value)+"\n";
}
let writeTail:Promise<unknown>=Promise.resolve();
export function saveConnection(rawProvider:unknown,body:unknown):Promise<ConnectionStatus> {
  // One shared dotenv file is rewritten by both forms; serialize reads and atomic renames together.
  const saving=writeTail.then(()=>save(rawProvider,body));
  writeTail=saving.catch(()=>{});
  return saving;
}
async function save(rawProvider:unknown,body:unknown):Promise<ConnectionStatus> {
  const provider=providerId(rawProvider),entry=providers[provider],fields=inputFields(body),file=filePath();
  if ([entry.key,entry.base].some(name=>process.env[name]!==undefined)) throw failure("CONNECTION_MANAGED_BY_ENV","该服务由环境变量管理，网页无法覆盖，请在本机修改配置。");
  if (!file || !config.credentialsDir) throw failure("CONNECTION_DIRECTORY_UNSET","尚未配置凭据目录，无法在网页保存API配置。");
  const {source,values}=await readCollectors();
  const priorBase=values[entry.base]||entry.defaultBase;
  if (fields.baseUrl) {
    let url:URL;
    try { url=new URL(fields.baseUrl); } catch { throw failure("INVALID_CONNECTION_BASE_URL","请填写完整的HTTPS接口地址。"); }
    const localTest=config.allowPrivateNetworkFetch&&url.protocol==="http:"&&["localhost","127.0.0.1","[::1]"].includes(url.hostname);
    if ((url.protocol!=="https:"&&!localTest)||url.username||url.password||url.search||url.hash) throw failure("INVALID_CONNECTION_BASE_URL","接口地址必须使用HTTPS，且不能包含登录信息、查询参数或片段。");
    if(url.toString().replace(/\/$/,"")!==displayBase(priorBase,entry.defaultBase))try { await assertPublicUrl(url.toString(),config.allowPrivateNetworkFetch); } catch { throw failure("UNSAFE_CONNECTION_BASE_URL","接口地址未通过公网安全检查，请使用可访问的公开HTTPS服务地址。"); }
    fields.baseUrl=url.toString().replace(/\/$/,"");
    if (values[entry.key]?.trim()&&!fields.key) {
      let sameOrigin=false;try {sameOrigin=new URL(priorBase).origin===url.origin;}catch{}
      if(!sameOrigin)throw failure("BASE_URL_KEY_REQUIRED","更换接口主机时必须同时填写适用于新主机的API Key，不能沿用已有密钥。");
    }
  }
  let updated=source;
  if(fields.key)updated=replaceField(updated,entry.key,fields.key);
  if(fields.baseUrl)updated=replaceField(updated,entry.base,fields.baseUrl);
  if(updated===source)return status(provider,values);
  const parsed=parseEnv(updated) as Record<string,string>;
  for(const [key,value] of Object.entries(values))if(key!==entry.key&&key!==entry.base&&parsed[key]!==value)throw failure("CONNECTION_WRITE_FAILED","配置未保存，无法保持原有采集设置，请在本机检查文件格式。");
  let temporary:string|undefined;
  try {
    await mkdir(config.credentialsDir,{recursive:true,mode:0o700});await chmod(config.credentialsDir,0o700);
    temporary=path.join(config.credentialsDir,".collectors-"+randomUUID()+".tmp");
    const handle=await open(temporary,"wx",0o600);
    try {await handle.writeFile(updated,"utf8");await handle.sync();}finally{await handle.close();}
    await rename(temporary,file);temporary=undefined;
  }catch {throw failure("CONNECTION_WRITE_FAILED","采集配置保存失败，请在本机检查凭据目录权限。密钥未写入数据库或返回网页。");}
  finally {if(temporary)await unlink(temporary).catch(()=>{});}
  return status(provider,parsed);
}
