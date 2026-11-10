import {html} from 'htm/preact';

// Lightweight Preact primitives following the Card/Badge/Tabs patterns from
// Shadcn UI & Blocks. No second framework or registry credential is needed.
const paths={
  layers:['m12 3 9 5-9 5-9-5 9-5','m3 12 9 5 9-5','m3 16 9 5 9-5'],
  activity:['M3 12h4l3-8 4 16 3-8h4'],
  code:['m8 7-5 5 5 5','m16 7 5 5-5 5','m14 4-4 16'],
  screen:['M3 4h18v13H3z','M8 21h8','M12 17v4'],
  clock:['M12 8v4l3 2'],
  arrow:['M5 12h14','m13 6 6 6-6 6'],
  refresh:['M20 7v5h-5','M4 17v-5h5','M6 7a7 7 0 0 1 11-2l3 3','M4 16l3 3a7 7 0 0 0 11-2'],
  expand:['M8 3H3v5','M16 3h5v5','M3 16v5h5','M21 16v5h-5'],
  stop:['M7 7h10v10H7z'],
  journal:['M6 3h12v18H6z','M9 7h6','M9 11h6','M9 15h4'],
  search:['m16 16 5 5'],
};
export function BenchIcon({name,size=18}){return html`<svg width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${name==='clock'&&html`<circle cx="12" cy="12" r="9"/>`}${name==='search'&&html`<circle cx="10" cy="10" r="6"/>`}${(paths[name]||paths.layers).map((d,i)=>html`<path key=${i} d=${d}/>` )}</svg>`;}
export function BenchBadge({children,tone='neutral',live=false}){return html`<span class=${`bench-badge is-${tone}`}>${live&&html`<span class="bench-live-dot"/>`}${children}</span>`;}
export function BenchMetric({label,value,note,icon}){return html`<div class="bench-metric"><span>${icon&&html`<${BenchIcon} name=${icon} size=${16}/>`}${label}</span><strong>${value}</strong>${note&&html`<small>${note}</small>`}</div>`;}
