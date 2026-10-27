import type { FileRecord, Usage } from './index';
export type ArticleKind = 'news' | 'practice';
export interface SourceItem { id:string; title:string; summary:string; url:string; source:string; keywords:string[]; coverUrl:string; publishedAt:string|null; createdAt:string; favorite:boolean }
export interface InstanceMetrics { durationMs:number|null; inputTokens:number|null; outputTokens:number|null; rounds:number|null; partial?:boolean }
export interface InstancePreparation { id:string; instanceId:string; reviewed:boolean; observation:string; mediaIds:string[]; revision:number; createdAt:string; updatedAt:string }
export interface PreparedMedia { id:string; file:FileRecord; instanceId:string|null; parentFileId:string|null; caption:string; origin:'uploaded'|'processed'|'recorded'; operation?:{format:'gif'|'mp4';start:number;end:number;width:number;fps:number}; createdAt:string }
export interface EditorialInstance { id:string; title:string; task:string; output:string; notes:string; agent:string; model:string; files:FileRecord[]; createdAt:string; origin:'manual'|'execution'; attemptId?:string; demo?:boolean; status?:string; runId?:string; runName?:string; metrics?:InstanceMetrics; preparation?:InstancePreparation; media?:PreparedMedia[] }
export interface WritingReference { id:string; sourceId:string; kind:'source'|'instance'|'media'; title:string; task:string; output:string; notes:string; url:string; files:FileRecord[]; capturedAt:string; enabled?:boolean; removed?:boolean }
export interface WritingSelection { from:number; to:number; text:string }
export interface WritingMessage { id:string; role:'user'|'assistant'; text:string; createdAt:string; status:'complete'|'pending'|'failed'; error?:string; references?:WritingReference[]; articleKind?:ArticleKind; model?:string; profileId?:string; durationMs?:number; usage?:Usage; purpose?:'auto'|'discuss'|'draft'|'revise'; selectedPassage?:WritingSelection; knowledge?:{revision:string|null;examples:number;engine:string}; documentAction?:'inserted'|'proposed'|'discussion' }
export interface DocumentNode { type:string; text?:string; attrs?:Record<string,unknown>; marks?:{type:string;attrs?:Record<string,unknown>}[]; content?:DocumentNode[] }
export interface DocumentVersion { id:string; label:string; createdAt:string; document:DocumentNode }
export interface RevisionChange { id:string; index:number; before:DocumentNode[]; after:DocumentNode[] }
export interface DocumentProposal { id:string; messageId:string; baseRevision:number; createdAt:string; changes:RevisionChange[] }
export interface WritingArticle { id:string; title:string; kind:ArticleKind; template:string; pinned:boolean; references:WritingReference[]; media:FileRecord[]; messages:WritingMessage[]; createdAt:string; updatedAt:string; revision:number; document?:DocumentNode; documentRevision?:number; versions?:DocumentVersion[]; proposal?:DocumentProposal|null; insertions?:string[] }
