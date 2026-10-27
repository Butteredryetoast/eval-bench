import {useEffect,useMemo,useState} from "react";
import {CASE_KEYWORD_LIMIT} from "../case-search.ts";
import {titleTokens,joinTitleTokens,tokensForKeywords} from "../title-keywords.ts";
export function TitleKeywordPicker({title,value,onChange}:{title:string;value:string;onChange:(value:string)=>void}){
  const tokens=useMemo(()=>titleTokens(title),[title]);
  const [message,setMessage]=useState("");
  const [selected,setSelected]=useState(()=>tokensForKeywords(title,tokens,value));
  useEffect(()=>{setSelected(current=>joinTitleTokens(title,tokens,current)===value?current:tokensForKeywords(title,tokens,value));},[title,tokens,value]);
  function toggle(i:number){
    const next=selected.includes(i)?selected.filter(n=>n!==i):[...selected,i];
    const query=joinTitleTokens(title,tokens,next);if(query.length>CASE_KEYWORD_LIMIT){setMessage("最多"+CASE_KEYWORD_LIMIT+"字符，请减少选字。");return;}
    setMessage("");
    setSelected(next);onChange(query);
  }
  return <section className="hm-title-picker" aria-label="从标题选字组词">
    <div className="hm-title-picker-heading"><strong>点选标题组词</strong><span>中文逐字，英文和型号成词；按标题顺序拼接，分开的片段用空格。</span><button type="button" onClick={()=>{setSelected([]);setMessage("");onChange("");}}>清空选字</button></div>
    <div className="hm-title-token-grid" role="group" aria-label="选题标题字格" title={title}>{tokens.map((token,i)=>token.selectable?<button type="button" key={token.start} className="hm-title-token" aria-label={"选字："+token.text+"，第"+(i+1)+"格"} aria-pressed={selected.includes(i)} onClick={()=>toggle(i)}>{token.text}</button>:<span className="hm-title-punctuation" key={token.start}>{token.text}</span>)}</div>
    {message&&<p className="hm-caption hm-warning" role="status">{message}</p>}
    <p className="hm-caption">已选{selected.length}格，关键词已同步到下方输入框。</p>
  </section>;
}
