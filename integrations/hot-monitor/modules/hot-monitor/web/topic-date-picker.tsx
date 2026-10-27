import {topicDay as eventDay} from "../topic-dates.ts";
import {useEffect,useMemo,useRef,useState} from "react";
import {Link,useNavigate} from "react-router";
import type {Event} from "../contracts.ts";
import {InfoDialog} from "./info-dialog.tsx";
import {API} from "./shared.tsx";
import "./topic-date-picker.css";

type TopicDay={date:string;count:number};
type DayResult={events:Event[];status:"idle"|"loading"|"ready"|"error"};
type PickerProps={events:Event[];dates?:TopicDay[];currentId?:string;destination?:string;alwaysDialog?:boolean;label?:string};
const dayLabel=(day:string)=>day==="unknown"?"日期未知":day;
const searchable=(value:string)=>value.normalize("NFKC").toLocaleLowerCase();
function TopicDates({events,dates,currentId,destination="/admin/monitor/research"}:PickerProps) {
  const navigate=useNavigate();
  const initial=useMemo(()=>{
    const grouped=new Map<string,Event[]>(),seen=new Set<string>();
    for(const event of events){
      if((!event.confirmed&&event.id!==currentId)||seen.has(event.id))continue;
      seen.add(event.id);const day=eventDay(event);
      grouped.set(day,[...(grouped.get(day)??[]),event]);
    }
    return grouped;
  },[events,currentId]);
  const days=useMemo(()=>{
    const listed=new Map((dates??[]).map(day=>[day.date,{...day}]));
    for(const [day,items] of initial)if(!listed.has(day))listed.set(day,{date:day,count:items.length});
    return [...listed.values()].sort((a,b)=>a.date==="unknown"?1:b.date==="unknown"?-1:b.date.localeCompare(a.date));
  },[dates,initial]);
  const current=events.find(event=>event.id===currentId);
  const first=current?eventDay(current):days[0]?.date??"";
  const [activeDay,setActiveDay]=useState(first),[locatedDate,setLocatedDate]=useState(""),[find,setFind]=useState("");
  const [,render]=useState(0);
  const cache=useRef(new Map<string,DayResult>());
  const requests=useRef(new Map<string,AbortController>());
  const hovered=useRef<ReturnType<typeof setTimeout>|null>(null);
  const mounted=useRef(true);
  const result=cache.current.get(activeDay)??{events:initial.get(activeDay)??[],status:"idle" as const};
  const eligible=(items:Event[],day:string)=>items.filter(event=>(event.confirmed||event.id===currentId)&&eventDay(event)===day);
  const shown=eligible(result.events,activeDay);
  const words=searchable(find).trim().split(/\s+/).filter(Boolean);
  const matched=shown.filter(event=>words.every(word=>searchable(event.title+" "+event.field+" "+event.format).includes(word)));
  function cancelHover(){if(hovered.current){clearTimeout(hovered.current);hovered.current=null;}}
  async function load(day:string,retry=false) {
    if(!day||requests.current.has(day))return;
    const saved=cache.current.get(day);
    if(!retry&&(saved?.status==="ready"||saved?.status==="error"))return;
    const controller=new AbortController();requests.current.set(day,controller);
    cache.current.set(day,{events:saved?.events??initial.get(day)??[],status:"loading"});render(n=>n+1);
    const q=new URLSearchParams({date:day});if(currentId)q.set("currentId",currentId);
    try{
      const response=await fetch(API+"/topics?"+q,{signal:controller.signal});
      if(!response.ok)throw Error("topic-date-read");
      const data=await response.json() as {events:Event[]};
      if(!Array.isArray(data.events))throw Error("topic-date-format");
      if(!mounted.current||controller.signal.aborted)return;
      cache.current.set(day,{events:data.events,status:"ready"});
    }catch(error){
      if(!mounted.current||controller.signal.aborted)return;
      cache.current.set(day,{events:saved?.events??initial.get(day)??[],status:"error"});
    }finally{
      if(requests.current.get(day)===controller)requests.current.delete(day);
      if(mounted.current&&!controller.signal.aborted)render(n=>n+1);
    }
  }
  function chooseDay(day:string,hover=false) {
    cancelHover();
    const preview=()=>{if(day!==activeDay)setFind("");setActiveDay(day);void load(day);};
    if(hover)hovered.current=setTimeout(()=>{hovered.current=null;preview();},150);
    else preview();
  }
  useEffect(()=>{
    mounted.current=true;if(first)void load(first);
    return ()=>{mounted.current=false;cancelHover();for(const request of requests.current.values())request.abort();requests.current.clear();};
  },[]);
  const listedDays=locatedDate&&!days.some(day=>day.date===locatedDate)?[{date:locatedDate,count:0},...days]:days;
  const visibleDays=listedDays.map(day=>{const loaded=cache.current.get(day.date);return loaded?.status==="ready"?{...day,count:eligible(loaded.events,day.date).length}:day;});
  return <section className="hm-topic-date-picker" aria-label="按日期选择选题">
    {current&&<div className="hm-topic-date-current" aria-label="当前选题"><span>当前选题</span><strong title={current.title}>{current.title}</strong><small>{dayLabel(eventDay(current))} · {current.confirmed?"已确认":"尚未确认"}</small></div>}
    <div className="hm-topic-date-intro"><p>悬停日期预览，点击题目切换。</p><label>按日期定位<input aria-label="按日期定位选题" type="date" value={locatedDate} onChange={event=>{const day=event.target.value;setLocatedDate(day);chooseDay(day||first);}}/></label></div>
    <div className="hm-topic-date-columns">
      <div className="hm-topic-date-rail"><h3>1 · 选择日期</h3><div className="hm-topic-date-list" role="group" aria-label="选题日期">
        {visibleDays.map(day=><button key={day.date} type="button" aria-pressed={activeDay===day.date} onMouseEnter={()=>chooseDay(day.date,true)} onMouseLeave={cancelHover} onFocus={()=>chooseDay(day.date)} onClick={()=>chooseDay(day.date)}><span>{dayLabel(day.date)}</span><span className="hm-topic-day-count">{day.count}题</span></button>)}
        {!visibleDays.length&&<p className="hm-caption">暂无已确认选题日期</p>}
      </div></div>
      <div className="hm-topic-date-preview" aria-label="当天选题预览" aria-busy={result.status==="loading"}>
        <div className="hm-topic-date-heading"><h3>{activeDay?dayLabel(activeDay)+"的选题":"2 · 选择题目"}</h3>{activeDay&&<span>{result.status==="loading"&&!shown.length?"读取中":shown.length+"题"}</span>}</div>
        <label className="hm-topic-date-search"><span>查找当天选题</span><input type="search" aria-label="查找当天选题" value={find} onChange={event=>setFind(event.target.value)} placeholder="输入标题、领域或关键词"/>{find&&<button type="button" onClick={()=>setFind("")}>清空查找</button>}</label>
        {result.status==="loading"&&<p role="status" className="hm-topic-date-status">正在读取当天选题…</p>}
        {result.status==="error"&&<div className="hm-topic-date-error"><p role="status">最新列表暂时未能读取{shown.length?"，先显示本页已有题目":"，可重试"}。</p><button type="button" onClick={()=>void load(activeDay,true)}>重试读取当天选题</button></div>}
        <div className="hm-topic-date-results">
          {matched.length?<ul>{matched.map(event=><li key={event.id}><button type="button" className="hm-topic-pick" aria-label={"选用选题："+event.title} aria-current={event.id===currentId?"true":undefined} onClick={()=>{if(event.id!==currentId)navigate(destination+"?"+new URLSearchParams({eventId:event.id}));}}><span className="hm-topic-pick-copy"><strong>{event.title}</strong><span>{event.field||"领域待确认"} · {event.format||"类型待确认"}{event.id===currentId?" · 当前选题":""}{!event.confirmed?" · 尚未确认":""}</span></span><span className="hm-topic-pick-action">{event.id===currentId?"使用中":"选用 →"}</span></button></li>)}</ul>:shown.length&&find?<p className="hm-topic-date-empty">当天没有匹配的题目。<button type="button" onClick={()=>setFind("")}>清空查找</button></p>:result.status!=="loading"&&result.status!=="error"&&<p className="hm-topic-date-empty">{result.status==="ready"?"这一天暂无已确认选题。":activeDay?"悬停稍作停留、点击或聚焦日期即可读取当天选题。":"先在选题台确认想研究的题目。"}<Link to="/admin/monitor?mode=all&state=confirmed&window=all">查看已确认选题 →</Link></p>}
        </div>
      </div>
    </div>
    <p className="hm-topic-date-footnote">按北京时间的原文发布时间分组，未知日期单列。预览不切换题目；手机点击日期，键盘聚焦同样可预览。</p>
  </section>;
}
export function TopicDatePicker(props:PickerProps) {
  return props.currentId||props.alwaysDialog?<InfoDialog label={props.label??"切换选题"} title="按日期选择选题"><TopicDates {...props}/></InfoDialog>:<TopicDates {...props}/>;
}
