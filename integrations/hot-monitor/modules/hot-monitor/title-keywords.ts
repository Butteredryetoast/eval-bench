export interface TitleToken {text:string;start:number;end:number;selectable:boolean}
export function titleTokens(title:string):TitleToken[] {
  const graphemes=[...new Intl.Segmenter("zh-CN",{granularity:"grapheme"}).segment(title)];
  const out:TitleToken[]=[];let covered=0;
  for(const part of graphemes){
    if(part.index<covered)continue;
    const word=/^[\p{Script=Latin}\p{N}]+(?:[-_.+][\p{Script=Latin}\p{N}]+)*/u.exec(title.slice(part.index))?.[0];
    const text=word??part.segment,end=part.index+text.length;covered=end;
    if(!text.trim())continue;
    out.push({text,start:part.index,end,selectable:/[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(text)});
  }
  return out;
}
export function joinTitleTokens(title:string,tokens:TitleToken[],selected:number[]) {
  const chosen=tokens.filter((t,i)=>t.selectable&&selected.includes(i));
  let value="";let previous:TitleToken|undefined;
  for(const token of chosen){if(previous&&token.start>previous.end)value+=" ";value+=token.text;previous=token;}
  return value;
}
export function tokensForKeywords(title:string,tokens:TitleToken[],keywords:string) {
  const indices=new Set<number>();
  for(const word of keywords.trim().split(/\s+/).filter(Boolean)){
    const at=title.toLocaleLowerCase().indexOf(word.toLocaleLowerCase());if(at<0)continue;
    for(const [i,t] of tokens.entries())if(t.selectable&&t.start>=at&&t.end<=at+word.length)indices.add(i);
  }
  return [...indices].sort((a,b)=>a-b);
}
