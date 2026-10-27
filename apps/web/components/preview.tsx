'use client';
import { useEffect, useState } from 'react';
import { Code2, FileText, Film, ImageIcon, LoaderCircle } from './tone-icon';
import type { AttemptRecord, CaseRecord } from '@/packages/contracts';

export function ReferencePreview({ entry }: { entry: CaseRecord }) {
  if (entry.reference) return <img src={`/api/files/${entry.reference.id}`} alt={`${entry.title}的参考效果`} className="reference-image" />;
  const kind = entry.referenceKind || entry.artifactType;
  if (kind === 'game') return <svg viewBox="0 0 400 180" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="400" height="180" fill="#252b36"/>{Array.from({ length: 28 }, (_, i) => <rect key={i} x={32 + i % 7 * 49} y={26 + Math.floor(i / 7) * 20} width="42" height="14" rx="3" fill={['#d7a26d', '#cd9080', '#a7a1b8', '#8faab6', '#91b8a6'][i % 5]} />)}<circle cx="264" cy="130" r="6" fill="#e8c27c"/><rect x="166" y="157" width="68" height="6" rx="3" fill="#ebece4"/></svg>;
  if (kind === 'voxel') return <svg viewBox="0 0 400 180" aria-hidden="true"><rect width="400" height="180" fill="#efede5"/>{[[135, 86, 45], [185, 66, 45], [235, 86, 45], [160, 117, 45], [210, 117, 45], [185, 32, 37]].map(([x, y, w], i) => <g key={i}><path d={`M${x},${y}l${w},0l0,${w * .65}l-${w},0Z`} fill="#d5ccb9"/><path d={`M${x},${y}l16,-14l${w},0l-16,14Z`} fill="#b8ab90"/><path d={`M${x + w},${y}l16,-14l0,${w * .65}l-16,14Z`} fill="#9c8e73"/></g>)}</svg>;
  if (kind === 'chart') return <svg viewBox="0 0 400 180" aria-hidden="true"><rect width="400" height="180" fill="#f7f6f1"/><path d="M30 150H370" stroke="#dedcd0"/>{[65, 100, 83, 120, 110].map((h, i) => <g key={i}><rect x={44 + i * 65} y={150 - h} width="28" height={h} rx="2" fill={i % 2 ? '#b4a184' : '#d2c4ad'}/><rect x={44 + i * 65} y={150 - h} width="28" height={h * .24} rx="2" fill="#80745f"/></g>)}<path d="M50 126L120 110L185 116L250 70L320 55" stroke="#597464" strokeWidth="3" fill="none"/></svg>;
  if (kind === 'copy' || entry.artifactType === 'copy') return <div className="copy-reference"><div className="paper-reference"><small>文案任务</small><strong>{entry.title}</strong><i/><i/><i/></div></div>;
  if (entry.artifactType === 'video') return <div className="video-reference"><Film size={32} strokeWidth={1.1}/><span>视频案例</span></div>;
  return <svg viewBox="0 0 400 180" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="400" height="180" fill="#f2f3ef"/><rect x="28" y="18" width="344" height="162" rx="7" fill="white"/><rect x="28" y="18" width="344" height="18" rx="7" fill="#e6e8e1"/>{[0, 1, 2].map(i => <circle key={i} cx={40 + i * 8} cy="27" r="2" fill="#bfc4b8"/>)}<rect x="49" y="58" width="155" height="11" rx="3" fill="#344c41"/><rect x="49" y="81" width="178" height="5" rx="2" fill="#d9ded4"/><rect x="49" y="93" width="152" height="5" rx="2" fill="#e4e7df"/><rect x="49" y="118" width="65" height="23" rx="5" fill="#687f6a"/><rect x="246" y="57" width="105" height="96" rx="8" fill="#e9eee5"/><circle cx="298" cy="104" r="25" fill="#ccd9c4"/></svg>;
}
export function ResultThumbnail({ attempt }: { attempt: AttemptRecord | null }) {
  const image = attempt?.artifacts.find(f => f.mime.startsWith('image/'));
  const video = attempt?.artifacts.find(f => f.mime.startsWith('video/'));
  const web = attempt?.artifacts.find(f => f.mime === 'text/html');
  if (image) return <img className="result-image" src={`/api/files/${image.id}`} alt={image.name}/>;
  if (video) return <div className="result-placeholder"><Film size={25}/><span>{video.name}</span></div>;
  if (web) return <div className="result-placeholder web"><Code2 size={26}/><span>{web.name}</span><small>网页已归档</small></div>;
  if (attempt?.outputText) return <div className="result-excerpt">{attempt.outputText.slice(0, 180)}</div>;
  return <div className="result-placeholder"><FileText size={22}/><span>{attempt?.error ? '执行未完成' : '等待产物'}</span></div>;
}
function InlineText({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part.startsWith('`') && part.endsWith('`') ? <code key={i}>{part.slice(1, -1)}</code> : part)}</>;
}
function ReadableText({ text }: { text: string }) {
  return <div className="artifact-text readable-output">{text.split(/(```[\s\S]*?```)/g).map((block, i) => block.startsWith('```') ? <pre key={i}><code>{block.replace(/^```[^\n]*\n?/, '').replace(/```$/, '')}</code></pre> : block.split(/\n\s*\n/).filter(Boolean).map((paragraph, j) => {
    const heading = /^(#{1,6})\s+([\s\S]+)$/.exec(paragraph);
    if (heading && !heading[2].includes('\n')) return <h3 key={`${i}-${j}`}><InlineText text={heading[2]}/></h3>;
    const lines = paragraph.split('\n');
    if (lines.every(l => /^\s*[-*]\s+/.test(l))) return <ul key={`${i}-${j}`}>{lines.map((l, k) => <li key={k}><InlineText text={l.replace(/^\s*[-*]\s+/, '')}/></li>)}</ul>;
    return <p key={`${i}-${j}`}><InlineText text={paragraph}/></p>;
  }))}</div>;
}

export function ArtifactPreview({ attempt, compact = false }: { attempt: AttemptRecord; compact?: boolean }) {
  const [html, setHtml] = useState(''), [error, setError] = useState('');
  const web = attempt.artifacts.find(f => f.mime === 'text/html');
  const image = attempt.artifacts.find(f => f.mime.startsWith('image/'));
  const video = attempt.artifacts.find(f => f.mime.startsWith('video/'));
  useEffect(() => {
    if (!web) return;
    const controller = new AbortController();
    fetch(`/api/files/${web.id}`, { signal: controller.signal }).then(r => { if (!r.ok) throw new Error('网页预览加载失败'); return r.text(); }).then(setHtml).catch(e => { if (e.name !== 'AbortError') setError(e.message); });
    return () => controller.abort();
  }, [web?.id]);
  const policy = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src \'none\'; frame-src \'none\'; form-action \'none\'; base-uri \'none\';">';
  if (web) return <div className={`artifact-web ${compact ? 'compact' : ''}`}>
    {error ? <p className="error-text">{error}</p> : html ? <iframe title={`${web.name} 静态预览`} sandbox="" referrerPolicy="no-referrer" srcDoc={`<!doctype html><head>${policy}</head>${html.replace(/<meta\b[^>]*>/gi, '')}`}/> : <div className="preview-loading"><LoaderCircle size={20} className="spin"/>加载网页…</div>}
    <small>首版提供静态预览，不执行生成脚本。完整交互请下载后在隔离环境查看。</small>
  </div>;
  if (image) return <div className="artifact-image"><img src={`/api/files/${image.id}`} alt={image.name}/></div>;
  if (video) return <video className="artifact-video" src={`/api/files/${video.id}`} controls preload="metadata"/>;
  if (attempt.outputText) return <ReadableText text={attempt.outputText}/>;
  return <div className="artifact-empty"><FileText size={27}/><p>{attempt.error || '本次没有可预览的正文，可在“产物与记录”中下载文件。'}</p></div>;
}
