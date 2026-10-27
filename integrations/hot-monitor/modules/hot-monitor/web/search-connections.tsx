import {InfoDialog} from "./info-dialog.tsx";
import type {MonitorData} from "../contracts.ts";
export function SearchConnections({providers,inline=false}:{providers:MonitorData["providers"];inline?:boolean}){const content=<div id="case-connections">
  <h3>X：{providers.x?"已填写凭证，真实调用结果看任务记录":"缺少SocialData Key"}</h3>
  <ol className="hm-help-steps"><li>打开<a href="https://socialdata.tools/signup" target="_blank" rel="noreferrer">SocialData注册页</a>，用你的邮箱注册或登录，在Dashboard创建API Key。本站沿用此服务，无需把X账号密码交给本站。</li><li>在本机项目的 <code>.data/credentials/collectors.env</code> 中填写下面这一行，替换为真实Key。文件在AIHOT项目目录内；不要把Key发到聊天或填入案例。</li></ol>
  <pre className="hm-rule-code">SOCIALDATA_API_KEY=你的真实Key</pre><p>保存后回复「X填好了」，让开发助手重启服务并做一次小范围测试；也可在项目目录运行 <code>node scripts/monitor-local.mjs restart</code>。已配置仅表示读到凭证，401通常需核对Key，402需核对余额，429需等待限流恢复；具体以任务结果为准。充值由你自己在服务商后台完成。</p>
  <h3>Reddit：先申请访问权限，自动搜索尚未接入</h3>
  <ol className="hm-help-steps"><li>用自己的Reddit账号打开<a href="https://support.reddithelp.com/hc/en-us/requests/new?ticket_form_id=16510899084308" target="_blank" rel="noreferrer">官方API申请表</a>；按页面选项选择数据/API访问用途，填写真实账号与邮箱。</li><li>如实说明用途是猿大侠公众号的内部选题与案例研究，可能用于面向公众的科技文章。不要选择学术研究来代替实际编辑用途；说明只读搜索公开内容、人工核对，询问适用权限与条件。</li><li>收到回复后，把不含密钥的权限说明和接口资料交给开发助手。获批前使用现有平台搜索、手动收集链接；不需要先填猜测的Reddit Key。</li></ol><p className="hm-caption">Reddit的OAuth、限流、原帖删除同步和存储要求需与获批用途一起落实。本站目前没有运行Reddit后台抓取，也不会把手动入口标成自动接通。接口申请草稿见项目内 research/2026-10-22/reddit-api-access-request.md。</p>
</div>;return inline?content:<InfoDialog label="平台接入说明" title="接通X和Reddit：需要你做什么？">{content}</InfoDialog>;}
