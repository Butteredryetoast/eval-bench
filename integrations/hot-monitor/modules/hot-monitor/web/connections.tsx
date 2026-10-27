import {useRef,useState} from "react";
import {Form,Link,useLoaderData,type LoaderFunctionArgs} from "react-router";
import {adminGet} from "@aihot/web/lib/admin.server";
import {useAdminAction} from "@aihot/web/features/admin/action";
import type {ConnectionsData,ConnectionStatus} from "../connections-contracts.ts";
import {API,Panel,Workspace} from "./shared.tsx";
export function loader({request}:LoaderFunctionArgs){return adminGet<ConnectionsData>(request,API+"/connections");}
export const meta=()=>[{title:"API配置 · 信源管理"}];
function Connection({connection:c}:{connection:ConnectionStatus}) {
  const action=useAdminAction(),secret=useRef<HTMLInputElement>(null);
  const [message,setMessage]=useState("");
  return <Panel title={c.name}><div className="hm-meta"><span className="hm-state">{c.hasKey?"已配置密钥":"待填写密钥"}</span><span>{c.managedBy==="env"?"环境配置管理":c.managedBy==="file"?"本机文件保存":"凭据目录未配置"}</span></div>
    <p className="hm-caption">{c.capabilities.join(" · ")}</p>
    <Form className="hm-form hm-connection-form" onSubmit={async ev=>{
      ev.preventDefault();setMessage("");const f=new FormData(ev.currentTarget);
      const r=await action.run<ConnectionStatus>("POST",API+"/connections/"+c.provider,{key:String(f.get("key")??""),baseUrl:String(f.get("baseUrl")??"")},{success:"采集API配置已保存"});
      if(r){if(secret.current)secret.current.value="";setMessage("已保存。后续请求使用新配置；没有发起付费测试，也没有改变信源启停。");}
    }}>
      <div className="hm-form-row"><label>API Key<input name="key" type="password" autoComplete="new-password" ref={secret} maxLength={4096} disabled={!c.editable} placeholder={c.hasKey?"已保存，留空则保留；页面不会读回密钥":"粘贴服务商提供的API Key"}/></label>
      <label>接口地址<input name="baseUrl" type="url" defaultValue={c.baseUrl} disabled={!c.editable} maxLength={2000}/></label></div>
      <p className="hm-caption">{c.note}</p><div className="hm-actions"><button type="submit" className="hm-primary" disabled={action.busy||!c.editable}>保存API配置</button><span className="hm-caption">更换服务主机时需同时填写新主机的密钥。</span></div><p role="status" className="hm-caption">{message}</p>
    </Form>
  </Panel>;
}
export default function Connections(){const d=useLoaderData<typeof loader>();return <Workspace title="API配置" subtitle="集中配置已接入的采集服务，密钥仅在本机后端保存。">
  <p className="hm-caption">配置完成后，到来源目录选择账号并试采。这里只保存服务配置；已配置不代表接口验证成功、余额充足或来源已启用。</p>
  {d.connections.map(c=><Connection key={c.provider} connection={c}/>)}
  <Panel title="继续添加其他来源"><p className="hm-prose">公开RSS无需API Key。普通JSON接口或网页列表可在添加来源时选择相应采集方式并填写字段。Reddit、YouTube、小红书、抖音等尚未接入专用搜索API时，可先登记来源或使用浏览器采集助手保存案例。</p><div className="hm-actions"><Link className="hm-button" to="/admin/monitor/catalogue">打开来源目录 →</Link><Link to="/admin/monitor/rules#platforms">各平台支持哪些方式 →</Link></div></Panel>
</Workspace>;}
