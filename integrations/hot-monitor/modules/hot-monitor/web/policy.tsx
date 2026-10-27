import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import terms from "@aihot/site/pages/terms.md?raw";
import privacy from "@aihot/site/pages/privacy.md?raw";
import { prepareCopy } from "@aihot/web/lib/site-copy";
import { Workspace } from "./shared.tsx";
export function loader({params}:LoaderFunctionArgs) {
  if(params.page!=="terms" && params.page!=="privacy") throw new Response("Not found",{status:404});
  const copy=prepareCopy(params.page==="terms"?terms:privacy);
  return {title:params.page==="terms"?"使用规则":"隐私说明",html:copy.rendered};
}
export default function Policy() {
  const d=useLoaderData<typeof loader>();
  return <Workspace title={d.title} subtitle="沿用当前站点文档，运营者对外上线前需确认模板内容。" actions={<Link className="hm-button" to="/admin/monitor/help">返回使用说明</Link>}><div className="hm-panel hm-policy-copy" dangerouslySetInnerHTML={{__html:d.html}}/></Workspace>;
}
