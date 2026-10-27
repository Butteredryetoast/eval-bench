/** Exact SVG exports from the reviewed Figma components; no remote runtime URLs. */
export function TaxonomyIcon({ name, selected = false, size = 24 }: { name: string; selected?: boolean; size?: number }) {
  return <img className="taxonomy-icon" src={`/icons/taxonomy/${name}${selected ? '-selected' : ''}.svg`} width={size} height={size} alt="" aria-hidden="true" draggable={false}/>;
}
export function SidebarToggleIcon({ collapsed }: { collapsed: boolean }) {
  return <span className="sidebar-toggle-glyph"><img src={`/icons/taxonomy/sidebar-${collapsed ? 'expand' : 'collapse'}.svg`} width={17.8} height={15.8} alt="" aria-hidden="true"/></span>;
}
export function RoundedPlayIcon() {
  return <span className="rounded-play-icon"><img src="/icons/taxonomy/play.svg" width={11.85} height={12.75} alt="" aria-hidden="true"/></span>;
}
