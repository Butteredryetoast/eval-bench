'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, CheckSquare, ChevronDown, Plus, Search, Star, X } from './tone-icon';
import { ARTIFACT_TYPES, type CaseRecord } from '@/packages/contracts';
import { LIBRARY_SCENES, LIBRARY_CAPABILITIES, caseCapabilities, interpretCapabilityQuery, matchesLibraryCase, type LibraryCapability } from '@/packages/core/library-taxonomy';
import { ReferencePreview } from './preview';
import {SecondaryContent,useWorkspaceMemory} from './workspace-navigation';
import { SidebarToggleIcon, TaxonomyIcon } from './taxonomy-icon';

export function CapabilityTag({ capability, selected = false, children }: { capability: LibraryCapability; selected?: boolean; children?: ReactNode }) {
  const cap = LIBRARY_CAPABILITIES[capability];
  return <span className={`capability-chip ${selected ? 'selected' : ''}`}><TaxonomyIcon name={cap.icon} selected={selected} size={15}/>{cap.label}{children}</span>;
}
export function CapabilityCoverage({ entry }: { entry: CaseRecord }) {
  const caps = caseCapabilities(entry);
  return <section className="capability-coverage"><h3>这个案例能观察什么？</h3>{caps.length ? caps.map(key => <div className="coverage-item" key={key}><h4><TaxonomyIcon name={LIBRARY_CAPABILITIES[key].icon} size={20}/>{LIBRARY_CAPABILITIES[key].label}</h4><p>{LIBRARY_CAPABILITIES[key].observe}</p></div>) : <p className="muted">尚未设置考察能力，可在编辑案例中补充。</p>}{entry.capabilities.includes('long') && <p className="field-hint">任务特征：持续任务</p>}<p className="field-hint">考察范围来自案例标签，具体要求以完整提示词为准；不代表模型的整体能力。</p><h3>评测方式</h3><p className="muted">当前可在运行结果中人工评审。自动评分服务尚未接入。</p></section>;
}
function FacetGroup({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return <section className="library-facet-group" aria-label={title}><h2>{title}{count > 0 && <span className="facet-group-count" aria-label={`已选 ${count} 项`}>{count}</span>}</h2><div className="facet-options" role="group" aria-label={title}>{children}</div></section>;
}
function FacetButton({ label, icon, selected, toggle }: { label: string; icon: string; selected: boolean; toggle: () => void }) {
  return <button className={`facet-choice ${selected ? 'selected' : ''}`} aria-pressed={selected} onClick={toggle}><TaxonomyIcon name={icon} selected={selected} size={14}/><span>{label}</span><span className="facet-check" aria-hidden="true">{selected && <Check size={12}/>}</span></button>;
}
export function CaseLibrary({ cases, selected, choose, selectVisible, open, create, favorite, favoriteBusy }: { cases: CaseRecord[]; selected: string[]; choose: (id: string) => void; selectVisible: (ids: string[]) => void; open: (entry: CaseRecord) => void; create: () => void; favorite: (entry: CaseRecord) => void; favoriteBusy: string[] }) {
  const [scenes, setScenes] = useWorkspaceMemory<string[]>('cases.scenes',[]), [artifacts, setArtifacts] = useWorkspaceMemory<string[]>('cases.artifacts',[]);
  const [query, setQuery] = useWorkspaceMemory('cases.query',''), [favorites, setFavorites] = useWorkspaceMemory('cases.favorites',false), [sort, setSort] = useWorkspaceMemory('cases.sort','recent');
  const [manualCaps, setManualCaps] = useWorkspaceMemory<LibraryCapability[]>('cases.caps',[]), [ignoredCaps, setIgnoredCaps] = useWorkspaceMemory<LibraryCapability[]>('cases.ignored',[]);
  const [showAllTypes,setShowAllTypes]=useWorkspaceMemory('cases.all-types',false);
  const inferred = interpretCapabilityQuery(query), interpreted = inferred.length > 0;
  const caps = [...new Set([...inferred, ...manualCaps])].filter(c => !ignoredCaps.includes(c));
  const list = cases.filter(c => matchesLibraryCase(c, { scenes, artifacts, favorites, query, capabilities: caps, interpreted })).sort((a, b) => sort === 'runs' ? b.runCount - a.runCount : Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const filterCount = scenes.length + artifacts.length + caps.length + Number(!!query.trim() && !interpreted) + Number(favorites);
  const types = LIBRARY_SCENES.filter(s => s.key);
  const artifactChoices = ['web', 'image', 'video', 'copy'] as const;
  const visibleTypes = showAllTypes ? types : types.filter((s, i) => i < 6 || scenes.includes(s.key));
  const toggleCap = (key: LibraryCapability) => { if (caps.includes(key)) { setManualCaps(old => old.filter(c => c !== key)); setIgnoredCaps(old => [...new Set([...old, key])]); } else { setManualCaps(old => [...new Set([...old, key])]); setIgnoredCaps(old => old.filter(c => c !== key)); } };
  const clear = () => { setScenes([]); setArtifacts([]); setQuery(''); setFavorites(false); setManualCaps([]); setIgnoredCaps([]); };
  const toggleScene = (key: string) => setScenes(old => old.includes(key) ? old.filter(s => s !== key) : [...old, key]);
  const toggleArtifact = (key: string) => setArtifacts(old => old.includes(key) ? old.filter(a => a !== key) : [...old, key]);
  return <section className="compact-library faceted-library" aria-label="案例库">
    <SecondaryContent><div className="library-facets context-facets">
      <div className="library-facets-heading"><strong>筛选</strong><button className="text-btn" disabled={!filterCount} onClick={clear}>重置</button></div>
      <div className="library-facets-body context-scroll">
        <FacetGroup title="任务类型" count={scenes.length}>{visibleTypes.map(s => <FacetButton key={s.key} label={s.label} icon={s.icon} selected={scenes.includes(s.key)} toggle={() => toggleScene(s.key)}/>)}</FacetGroup>
        {(showAllTypes || visibleTypes.length < types.length) && <button className="facet-more text-btn" aria-expanded={showAllTypes} onClick={() => setShowAllTypes(old => !old)}>{showAllTypes ? '收起类型' : `更多类型（${types.length - visibleTypes.length}）`}<ChevronDown size={13} className={showAllTypes ? 'flipped' : ''}/></button>}
        <FacetGroup title="考察能力" count={caps.length}>{(Object.keys(LIBRARY_CAPABILITIES) as LibraryCapability[]).map(key => <FacetButton key={key} label={LIBRARY_CAPABILITIES[key].label} icon={LIBRARY_CAPABILITIES[key].icon} selected={caps.includes(key)} toggle={() => toggleCap(key)}/>)}</FacetGroup>
        <FacetGroup title="产物格式" count={artifacts.length}>{artifactChoices.map(key => <FacetButton key={key} label={ARTIFACT_TYPES[key]} icon={{ web: 'page', copy: 'document', image: 'image', video: 'video' }[key]!} selected={artifacts.includes(key)} toggle={() => toggleArtifact(key)}/>)}</FacetGroup>
      </div>
    </div></SecondaryContent>
    <div className="library-results">
      <header className="faceted-library-heading collection-toolbar"><h1 className="sr-only">案例库</h1><label className="library-search collection-search"><Search size={18}/><input aria-label="搜索案例" placeholder="搜索案例名称、提示词或需求…" value={query} onChange={e => { setQuery(e.target.value); setIgnoredCaps([]); }}/>{query && <button className="icon-btn" aria-label="清空搜索" onClick={() => { setQuery(''); setIgnoredCaps([]); }}><X size={15}/></button>}</label><div className="collection-actions"><button className="btn primary" onClick={create}><Plus size={15}/>新建案例</button></div></header>
      <div className="faceted-library-tools"><div className="facet-summary" aria-live="polite"><span>{list.length} 个案例{filterCount ? ` · 已启用 ${filterCount} 项筛选` : ''}</span>{filterCount > 0 && <button className="text-btn" onClick={clear}>清空</button>}</div><div className="facet-view-actions"><button className={`btn small ${favorites ? 'on' : ''}`} aria-pressed={favorites} onClick={() => setFavorites(!favorites)}><Star size={13} fill={favorites ? 'currentColor' : 'none'}/>只看收藏</button><select aria-label="案例排序" value={sort} onChange={e => setSort(e.target.value)}><option value="recent">最近更新</option><option value="runs">运行次数最多</option></select><button className="icon-btn" aria-label="全选当前结果" title="全选或取消当前结果" disabled={!list.length} onClick={() => selectVisible(list.map(c => c.id))}><CheckSquare size={17}/></button></div></div>
    {list.length ? <div className="case-grid">{list.map(c => { const tags = caseCapabilities(c); return <article className={`case-card ${selected.includes(c.id) ? 'selected' : ''}`} key={c.id} onClick={() => open(c)}><div className="case-card-top"><input type="checkbox" aria-label={`选择${c.title}`} checked={selected.includes(c.id)} onClick={e => e.stopPropagation()} onChange={() => choose(c.id)}/><button className="case-title-button" onClick={e => { e.stopPropagation(); open(c); }}>{c.title}</button><button className={`favorite-button ${c.favorite ? 'on' : ''}`} disabled={favoriteBusy.includes(c.id)} aria-label={`${c.favorite ? '取消收藏' : '收藏'}${c.title}`} aria-pressed={!!c.favorite} onClick={e => { e.stopPropagation(); favorite(c); }}><Star size={18} fill={c.favorite ? 'currentColor' : 'none'}/></button></div><button className="case-cover-button" aria-label={`查看${c.title}详情`} onClick={e => { e.stopPropagation(); open(c); }}><ReferencePreview entry={c}/><span className="case-cover-caption">{c.prompt.slice(0, 56)}{c.prompt.length > 56 ? '…' : ''}</span></button><div className="compact-card-footer"><div className="card-capabilities">{tags.slice(0, 2).map(key => <CapabilityTag key={key} capability={key}/>)}{tags.length > 2 && <small title={tags.slice(2).map(key => LIBRARY_CAPABILITIES[key].label).join('、')}>+{tags.length - 2}</small>}{!tags.length && <span className="muted">尚未设置考察能力</span>}</div><p className="card-observe">{tags[0] ? `观察：${LIBRARY_CAPABILITIES[tags[0]].observe}` : '编辑案例以补充具体考察范围。'}</p><div className="card-task-meta"><span>{ARTIFACT_TYPES[c.artifactType]}</span><span>{c.inputs.length ? `${c.inputs.length} 个输入附件` : '无需附件'}</span><span>v{c.version}</span><span>{c.runCount ? `${c.runCount} 次运行` : '尚未运行'}</span></div></div></article>; })}</div> : <div className="library-empty"><Search size={24}/><h2>没有匹配的案例</h2><p>{caps.length ? '可以移除部分筛选条件，或清空筛选查看全部案例。' : '暂时没有匹配案例，可调整任务类型、搜索内容或新建案例。'}</p><button className="btn" onClick={clear}>清空筛选</button><button className="btn" onClick={create}>新建案例</button></div>}
    
    </div>
  </section>;
}
