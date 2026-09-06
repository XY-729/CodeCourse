import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Folder } from 'lucide-react';

type Props = { open: boolean; width: number; resizing: boolean; projectName?: string; children: ReactNode; onClose: () => void; onResize: (width: number) => void; onResizeStart: (x: number) => void };

export default function DirectionDocumentSidebar({ open, width, resizing, projectName, children, onClose, onResize, onResizeStart }: Props) {
  const reduced = useReducedMotion();
  return <div className={`direction-document-rail ${open ? 'open' : ''} ${resizing ? 'resizing' : ''}`} style={{ width: open ? `calc(var(--nav-width, ${width}px) + 18px)` : 0 }} inert={!open} onKeyDown={event => {
    if (event.key !== 'Escape') return;
    event.preventDefault(); event.stopPropagation(); onClose();
    document.querySelector<HTMLButtonElement>('.direction-directory-toggle')?.focus();
  }}>
    <motion.div id="direction-document-sidebar" className="direction-document-sidebar" initial={false} animate={{ opacity: open ? 1 : 0, x: open ? 0 : -22, clipPath: open ? 'inset(0)' : 'inset(0 100% 0 0)' }} transition={{ duration: reduced || resizing ? 0 : open ? .28 : .17, ease: [.16,1,.3,1] }}>
      <header className="direction-document-title"><div><b>02</b><i/>课程与源码</div><strong>READ<span>.</span></strong></header>
      <div className="direction-document-project"><Folder size={15}/><span>{projectName || 'CODECOURSE'}</span></div>
      {open && !reduced && <i className="direction-directory-flash" aria-hidden="true"/>}
      {children}
    </motion.div>
    <div className="direction-document-resizer" role="separator" tabIndex={open ? 0 : -1} aria-label="调整文档侧栏宽度" aria-orientation="vertical" aria-valuenow={width} aria-valuemin={240} aria-valuemax={360} onMouseDown={event => onResizeStart(event.clientX)} onKeyDown={event => {
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault(); onResize(event.key === 'Home' ? 240 : event.key === 'End' ? 360 : Math.min(360, Math.max(240, width + (event.key === 'ArrowLeft' ? -10 : 10))));
    }}/>
  </div>;
}
