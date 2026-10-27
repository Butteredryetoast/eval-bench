'use client';
import {usePathname} from 'next/navigation';
import type {Profile} from '@/packages/contracts';
import WritingWorkspace from './writing-workspace';
import UnifiedResults from './unified-results';
/** Article creation owns only documents and the assistant. Topics and results have one home each. */
export default function Editorial(props:{profiles:Profile[];notify:(s:string)=>void}){
 const path=usePathname();return path.startsWith('/write')?<WritingWorkspace {...props}/>:<UnifiedResults notify={props.notify}/>;
}
