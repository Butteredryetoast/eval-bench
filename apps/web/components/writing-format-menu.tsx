'use client';
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import type {Editor} from '@tiptap/core';
import {Bold,Italic,Link,List,Pencil,ChevronDown} from 'lucide-react';

type Position={left:number;top:number;from:number;to:number};
export function WritingFormatMenu({editor,onAI,onLink}:{editor:Editor|null;onAI:()=>void;onLink:()=>void}){
 const [position,setPosition]=useState<Position|null>(null),[formats,setFormats]=useState(false),ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!editor)return;let frame=0;
  const update=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
   if(editor.isDestroyed)return;const {from,to,empty}=editor.state.selection,active=document.activeElement;
   if(ref.current?.contains(active)||ref.current?.contains(document.getSelection()?.anchorNode||null))return;
   if(empty||!editor.state.doc.textBetween(from,to,'\n').trim()||!editor.isFocused){setPosition(null);setFormats(false);return;}
   const box=editor.view.dom.getBoundingClientRect(),start=editor.view.coordsAtPos(from),end=editor.view.coordsAtPos(to);
   if(end.bottom<44||start.top>window.innerHeight){setPosition(null);return;}
   const width=Math.min(348,window.innerWidth-16),left=Math.max(8,Math.min(start.left,box.right-width,window.innerWidth-width-8)),top=start.top>50?start.top-42:Math.min(end.bottom+8,window.innerHeight-44);
   setPosition({from,to,left,top});
  });};
  const focus=(event:FocusEvent)=>{if(ref.current?.contains(event.target as Node))return;update();};
  const outside=(event:PointerEvent)=>{if(!ref.current?.contains(event.target as Node)&&!editor.view.dom.contains(event.target as Node)){setPosition(null);setFormats(false);}};
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setPosition(null);setFormats(false);}};
  editor.on('selectionUpdate',update);editor.on('transaction',update);editor.on('focus',update);document.addEventListener('focusin',focus);document.addEventListener('pointerdown',outside);window.addEventListener('scroll',update,true);window.addEventListener('resize',update);window.addEventListener('keydown',escape);
  return()=>{cancelAnimationFrame(frame);editor.off('selectionUpdate',update);editor.off('transaction',update);editor.off('focus',update);document.removeEventListener('focusin',focus);document.removeEventListener('pointerdown',outside);window.removeEventListener('scroll',update,true);window.removeEventListener('resize',update);window.removeEventListener('keydown',escape);};
 },[editor]);
 if(!editor||!position)return null;
 const chain=()=>editor.chain().focus().setTextSelection({from:position.from,to:position.to}),heading=[1,2,3].find(level=>editor.isActive('heading',{level}));
 return createPortal(<div ref={ref} className="writing-bubble" role="toolbar" aria-label="选中文字工具栏" style={{left:position.left,top:position.top}} onMouseDown={event=>event.preventDefault()}>
  <div className="writing-bubble-style"><button aria-label="段落样式" aria-expanded={formats} onClick={()=>setFormats(!formats)}>{heading?`${heading} 级标题`:'正文'}<ChevronDown size={12}/></button>{formats&&<div role="menu" aria-label="段落样式菜单">{[0,1,2,3].map(level=><button role="menuitem" key={level} onClick={()=>{if(level)chain().toggleHeading({level:level as 1|2|3}).run();else chain().setParagraph().run();setFormats(false);}}>{level?`${level} 级标题`:'正文'}</button>)}</div>}</div>
  <i/>
  <button aria-label="加粗" aria-pressed={editor.isActive('bold')} onClick={()=>chain().toggleBold().run()}><Bold size={15}/></button>
  <button aria-label="斜体" aria-pressed={editor.isActive('italic')} onClick={()=>chain().toggleItalic().run()}><Italic size={15}/></button>
  <button aria-label="插入链接" onClick={()=>{onLink();setPosition(null);}}><Link size={15}/></button>
  <button aria-label="项目列表" aria-pressed={editor.isActive('bulletList')} onClick={()=>chain().toggleBulletList().run()}><List size={15}/></button><i/>
  <button className="writing-bubble-ai" onClick={()=>{onAI();setPosition(null);}}><Pencil size={14}/>AI 修改</button>
 </div>,document.body);
}
