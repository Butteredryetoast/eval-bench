const kinds={fact:'事实',quote:'引述',data:'数据',case:'案例',image:'图片',video:'视频'};
const states={provided:'已关联资料，待核实',missing:'待补材料',omitted:'可选，暂略'};
export function NarrativePlan({plan,obsidianLink}){
 if(!plan?.nodes?.length)return null;
 const materials=new Map(plan.materials.map(m=>[m.id,m]));
 return <div className="narrative-plan">
  <div className="narrative-plan-label">叙事与素材位置 · {plan.blueprintName}</div>
  <ol>{plan.nodes.map(node=><li key={node.id}>
   <strong>{node.title}</strong><p>{node.instruction}</p>
   <div className="narrative-beats">{node.beats.map(beat=>{
    const material=materials.get(beat.id);
    if(material)return <div key={beat.id} className={'narrative-material '+material.status}><span>{kinds[material.kind]} · {states[material.status]}</span><p>{material.instruction}</p><small>作用：{material.role}</small></div>;
    return <p key={beat.id} className="narrative-beat"><span>{beat.type==='observation'?'回应':beat.type==='transition'?'转入':'铺垫'}</span>{beat.instruction}{beat.dependsOn?.some(id=>materials.get(id)?.status==='missing')&&<small>（补齐对应材料后再写）</small>}</p>;
   })}</div>
   {node.transition&&<p className="narrative-transition">承接：{node.transition}</p>}
   <details><summary>原文依据</summary><p>{node.evidence}</p><p className="muted">这是历史文章的写法依据，当前热点的事实需要另行提供。</p></details>
  </li>)}</ol>
  {obsidianLink(plan.obsidianUrl)&&<a className="text-link" href={obsidianLink(plan.obsidianUrl)}>在 Obsidian 中查看蓝图</a>}
 </div>;
}
export function NarrativeStatus({draft}){
 if(!draft?.narrative)return null;
 const n=draft.narrative;
 return <div className="narrative-status" role="status">{!n.layoutVerified?'已手动修改或沿用旧稿，请核对素材位置':n.incomplete?'待补材料初稿 · 相关判断留待补写':'已按叙事顺序起草 · 请核实材料与判断'}</div>;
}
