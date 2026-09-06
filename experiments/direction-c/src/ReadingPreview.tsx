import { useRef, useState, type ReactNode, type DragEvent, type KeyboardEvent } from 'react';
import { BookOpen, FileCode2, Folder, ChevronRight, Columns2, X, ArrowUpRight, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  openItem, closeItem, createGroup, findGroup, firstGroupId, updateGroup,
  splitGroup, splitMeta, removeGroupFromLayout, countGroups, applySplitRatios,
  detectDropZone, MAX_GROUPS,
  type LayoutNode, type EditorGroup, type OpenItem, type DropZone,
} from '../../../frontend/src/workbench/layout';

// This isolated preview uses sample documents and the existing layout reducer.
// No project data, editor implementation or production UI is changed here.
const chapters = ['从入口理解应用', '场景切换与状态', '组件之间的数据流'];
const courseItems: OpenItem[] = chapters.map((title, i) => ({
  id: `lesson-${i}`, type: 'course', title, path: `course/0${i + 1}.md`, content: '',
}));
const sourceItem = (name: string): OpenItem => ({
  id: `file-${name}`, type: 'file', title: name, path: `src/scenes/${name}`, content: '',
});
const initialLayout = (): LayoutNode => ({
  type: 'split', id: 'reading-split', direction: 'row', ratio: .51,
  first: { type: 'group', group: openItem(createGroup('reading-left').group, courseItems[0]) },
  second: { type: 'group', group: openItem(openItem(createGroup('reading-right').group, sourceItem('useScene.ts')), sourceItem('App.tsx')) },
});

function Lesson({ item }: { item: OpenItem }) {
  const index = courseItems.findIndex(c => c.id === item.id);
  return <article className="reading-lesson">
    <div className="lesson-kicker">CHAPTER 0{index + 1}<span>课程 / 应用结构</span></div>
    <h2>{item.title}</h2>
    <p className="lesson-lead">理解一个应用，可以先从入口开始：它组织了哪些内容，又把哪些职责交给了其他组件？</p>
    <h3>先看入口，再看细节</h3>
    <p>右侧的 <code>App.tsx</code> 是这个示例的入口。它不直接处理每一个界面的细节，而是把当前场景交给外层容器，再由内容组件决定展示什么。</p>
    <p>阅读时，可以先沿着三个名字往下看：<code>useScene</code> 保存当前场景，<code>DesktopGameShell</code> 提供外层界面，<code>SceneContent</code> 显示具体内容。</p>
    <blockquote>先弄清楚“谁负责什么”，再进入每个函数的实现。</blockquote>
    <h3>状态从哪里来？</h3>
    <p><code>useScene()</code> 返回当前的 <code>scene</code>，以及用于切换场景的 <code>navigate</code>。入口组件把它们传给外层容器，使显示状态和操作入口保持一致。</p>
    <pre><code>{'const { scene, navigate } = useScene();'}</code></pre>
    <p>打开 <code>useScene.ts</code>，可以看到这个示例用 React 的状态保存场景。点击不同入口时，更新的只是这个状态，而不是重新创建整个应用。</p>
    <h3>沿着数据流继续阅读</h3>
    <p>回到 <code>App.tsx</code>，留意 <code>scene</code> 同时传给了外层容器和内容组件。前者安排界面的外观与交互，后者负责显示与当前场景对应的内容。</p>
    <p>这种分工让界面表现和具体内容可以分别调整。阅读源码时，先确定数据的来源、传递位置和最终使用者，会比逐行记住代码更容易把握结构。</p>
    <h3>回顾这一节</h3>
    <ul><li>入口组件把状态与界面连接起来。</li><li>容器负责外层布局，内容组件负责具体展示。</li><li>沿着变量与属性的传递，可以逐步找到实现细节。</li></ul>
  </article>;
}

function Code({ lines }: { lines: string[] }) {
  return <pre className="reading-code">{lines.map((line, i) => <div className="code-line" key={i}>
    <span className="line-number" aria-hidden="true">{i + 1}</span><code>{line.split(/('[^']*'|\/\/.*|\b(?:import|from|export|function|const|return|type|string)\b)/g).map((part, j) => <span key={j} className={part.startsWith('//') ? 'code-comment' : part.startsWith("'") ? 'code-string' : /^(import|from|export|function|const|return|type|string)$/.test(part) ? 'code-keyword' : undefined}>{part}</span>)}{!line && '\u00a0'}</code>
  </div>)}</pre>;
}

type TabDrag = { item: OpenItem; groupId: string };
type WorkspaceActions = {
  activeGroup: string; code: Record<string, string[]>; canSplit: boolean;
  focus: (id: string) => void;
  activate: (groupId: string, itemId: string) => void;
  close: (groupId: string, itemId: string) => void;
  split: (groupId: string) => void;
  resize: (id: string, ratio: number) => void;
  drag: React.MutableRefObject<TabDrag | null>;
  drop: (groupId: string, zone: DropZone) => void;
  onAsk: () => void;
};

function ReaderGroup({ group, actions }: { group: EditorGroup; actions: WorkspaceActions }) {
  const [dropZone, setDropZone] = useState<DropZone | null>(null);
  const [selection, setSelection] = useState(false);
  const choose = (itemId: string) => { setSelection(false); actions.activate(group.id, itemId); };
  const keyTabs = (e: KeyboardEvent) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key) || (e.target as HTMLElement).getAttribute('role') !== 'tab') return;
    e.preventDefault();
    const index = group.items.findIndex(i => i.id === group.activeItemId);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? group.items.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + group.items.length) % group.items.length;
    const item = group.items[next];
    if (item) { choose(item.id); document.getElementById(`${group.id}-${item.id}-tab`)?.focus(); }
  };
  const accept = (e: DragEvent<HTMLElement>, zone: DropZone) => {
    if (!actions.drag.current) return;
    e.preventDefault(); e.stopPropagation(); actions.drop(group.id, zone); setDropZone(null);
  };
  return <section className={`reading-group ${actions.activeGroup === group.id ? 'is-active' : ''}`} data-group={group.id} aria-label="阅读分栏"
    onPointerDown={() => actions.focus(group.id)} onFocusCapture={() => actions.focus(group.id)}>
    <div className="reading-tabbar">
      <div className="reading-tabs" role="tablist" aria-label="课件与源码标签" onKeyDown={keyTabs}
        onDragOver={e => { if (actions.drag.current) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }} onDrop={e => accept(e, 'center')}>
        {group.items.map(item => <div className={`reading-tab ${group.activeItemId === item.id ? 'selected' : ''}`} key={item.id} role="presentation">
          <button role="tab" id={`${group.id}-${item.id}-tab`} aria-controls={`${group.id}-${item.id}-panel`} aria-selected={group.activeItemId === item.id} tabIndex={group.activeItemId === item.id ? 0 : -1}
            title={item.title} draggable onDragStart={e => { actions.drag.current = { item, groupId: group.id }; e.dataTransfer.setData('text/plain', item.path); e.dataTransfer.effectAllowed = 'move'; }}
            onDragEnd={() => { actions.drag.current = null; setDropZone(null); }} onClick={() => choose(item.id)}>
            {item.type === 'course' ? <BookOpen size={13}/> : <FileCode2 size={13}/>}<span>{item.title}</span>
          </button>
          <button className="reading-tab-close" aria-label={`关闭 ${item.title}`} onClick={() => { setSelection(false); actions.close(group.id, item.id); }}><X size={12}/></button>
        </div>)}
      </div>
      <button className="reading-split-button" aria-label="向右分栏" title="向右分栏" disabled={!group.activeItemId || !actions.canSplit} onClick={() => actions.split(group.id)}><Columns2 size={17}/></button>
    </div>
    <div className="reading-documents" onDragOver={e => { if (actions.drag.current) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropZone(detectDropZone(e, dropZone ?? undefined)); } }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropZone(null); }} onDrop={e => accept(e, detectDropZone(e, dropZone ?? undefined))}>
      {group.items.map(item => <div key={item.id} className="reading-document" id={`${group.id}-${item.id}-panel`} role="tabpanel" aria-labelledby={`${group.id}-${item.id}-tab`} hidden={group.activeItemId !== item.id}>
        <div className="reading-breadcrumb"><span>{item.type === 'course' ? 'course' : 'src / scenes'}</span><ChevronRight size={12}/><strong>{item.type === 'course' ? `0${courseItems.findIndex(c => c.id === item.id) + 1}` : item.title}</strong><span className="reading-kind">{item.type === 'course' ? '课件' : 'TSX'}</span></div>
        <div className="reading-scroll" tabIndex={0} aria-label={`${item.title} 正文`} onMouseUp={e => {
          const selected = window.getSelection();
          setSelection(Boolean(selected?.toString().trim() && selected.anchorNode && e.currentTarget.contains(selected.anchorNode) && e.currentTarget.contains(selected.focusNode)));
        }} onKeyUp={e => { if (e.key === 'Escape') setSelection(false); }}>
          {item.type === 'course' ? <Lesson item={item}/> : <Code lines={actions.code[item.title] ?? []}/>}
        </div>
      </div>)}
      {!group.items.length && <div className="reading-empty"><BookOpen size={26}/><p>从左侧选择课件或源码</p></div>}
      {selection && <button className="reading-selection" onMouseDown={e => e.preventDefault()} onClick={() => { setSelection(false); actions.onAsk(); }}>选区提问<ArrowUpRight size={16}/></button>}
      {dropZone && actions.drag.current && <div className={`reading-drop zone-${dropZone}`} aria-hidden="true"/>}
    </div>
  </section>;
}

function WorkspaceNode({ node, actions }: { node: LayoutNode; actions: WorkspaceActions }) {
  const container = useRef<HTMLDivElement>(null);
  if (node.type === 'group') return <ReaderGroup group={node.group} actions={actions}/>;
  const row = node.direction === 'row';
  const grid = `${node.ratio}fr 7px ${1 - node.ratio}fr`;
  const dragResize = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons !== 1 || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const r = container.current!.getBoundingClientRect();
    actions.resize(node.id, row ? (e.clientX - r.left) / r.width : (e.clientY - r.top) / r.height);
  };
  return <div ref={container} className={`reading-split ${row ? 'row' : 'column'}`} style={row ? { gridTemplateColumns: grid } : { gridTemplateRows: grid }}>
    <WorkspaceNode node={node.first} actions={actions}/>
    <div className="reading-divider" role="separator" aria-label="调整分栏比例" aria-orientation={row ? 'vertical' : 'horizontal'} aria-valuenow={Math.round(node.ratio * 100)} aria-valuemin={20} aria-valuemax={80} tabIndex={0}
      onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={dragResize}
      onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
      onKeyDown={e => {
        const minus = row ? 'ArrowLeft' : 'ArrowUp', plus = row ? 'ArrowRight' : 'ArrowDown';
        if ([minus, plus, 'Home', 'End'].includes(e.key)) { e.preventDefault(); actions.resize(node.id, e.key === 'Home' ? .2 : e.key === 'End' ? .8 : node.ratio + (e.key === minus ? -.02 : .02)); }
      }}><span/></div>
    <WorkspaceNode node={node.second} actions={actions}/>
  </div>;
}

export default function ReadingPreview({ code, action, onAsk, active, sceneNumber }: { code: Record<string, string[]>; action: ReactNode; onAsk: () => void; active: boolean; sceneNumber: string }) {
  const [layout, setLayout] = useState<LayoutNode>(initialLayout);
  const [activeGroup, setActiveGroup] = useState('reading-left');
  const [directory, setDirectory] = useState<'course' | 'file'>('course');
  const [sidebarOpen, setSidebarOpen] = useState(new URLSearchParams(location.search).get('sidebar') === 'open');
  const sidebarToggle = useRef<HTMLButtonElement>(null);
  const reduce = useReducedMotion();
  const sequence = useRef(0);
  const drag = useRef<TabDrag | null>(null);
  const activeId = findGroup(layout, activeGroup)?.activeItemId;
  const directoryItems = directory === 'course' ? courseItems : Object.keys(code).map(sourceItem);
  const activate = (groupId: string, itemId: string) => { setActiveGroup(groupId); setLayout(current => updateGroup(current, groupId, g => ({ ...g, activeItemId: itemId }))); };
  const close = (groupId: string, itemId: string) => {
    let next = updateGroup(layout, groupId, g => closeItem(g, itemId));
    if (!findGroup(next, groupId)?.items.length && countGroups(next) > 1) next = removeGroupFromLayout(next, groupId)!;
    if (!findGroup(next, activeGroup)) setActiveGroup(firstGroupId(next));
    setLayout(next);
  };
  const split = (groupId: string, item?: OpenItem, zone: DropZone = 'right', sourceGroupId?: string) => {
    if (countGroups(layout) >= MAX_GROUPS) return;
    const group = findGroup(layout, groupId);
    const doc = item ?? group?.items.find(i => i.id === group.activeItemId);
    const meta = splitMeta(zone);
    if (!doc || !meta) return;
    const id = `reading-added-${++sequence.current}`;
    let next = splitGroup(layout, groupId, meta.direction, meta.placement, { type: 'group', group: openItem(createGroup(id).group, doc) }, `split-${id}`);
    if (sourceGroupId) {
      next = updateGroup(next, sourceGroupId, g => closeItem(g, doc.id));
      if (!findGroup(next, sourceGroupId)?.items.length) next = removeGroupFromLayout(next, sourceGroupId)!;
    }
    setLayout(next); setActiveGroup(id);
  };
  const drop = (groupId: string, zone: DropZone) => {
    const payload = drag.current; drag.current = null;
    if (!payload) return;
    if (zone !== 'center') { split(groupId, payload.item, zone, payload.groupId); return; }
    if (groupId === payload.groupId) return;
    let next = updateGroup(layout, groupId, g => openItem(g, payload.item));
    next = updateGroup(next, payload.groupId, g => closeItem(g, payload.item.id));
    if (!findGroup(next, payload.groupId)?.items.length) next = removeGroupFromLayout(next, payload.groupId)!;
    setLayout(next); setActiveGroup(groupId);
  };
  const actions: WorkspaceActions = { activeGroup, code, canSplit: countGroups(layout) < MAX_GROUPS, focus: setActiveGroup, activate, close, split, drag, drop, onAsk,
    resize: (id, ratio) => setLayout(current => applySplitRatios(current, new Map([[id, Math.min(.8, Math.max(.2, ratio))]]))),
  };
  return <section className={`reading-scene scene-content ${sidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`} aria-label="课程与源码阅读场景" onKeyDown={e => {
    if (e.key === 'Escape' && sidebarOpen && (e.target as HTMLElement).closest('.reading-sidebar-layer,.reading-sidebar-toggle')) {
      e.preventDefault(); setSidebarOpen(false); sidebarToggle.current?.focus();
    }
  }}>
    <h1 className="sr-only" tabIndex={-1} id={active ? 'scene-heading' : undefined}>READ.</h1>
    <button ref={sidebarToggle} className="reading-sidebar-toggle" aria-label={sidebarOpen ? '收起文档侧栏' : '展开文档侧栏'} title={sidebarOpen ? '收起文档侧栏' : '展开文档侧栏'} aria-expanded={sidebarOpen} aria-controls="reading-sidebar" onClick={() => setSidebarOpen(value => !value)}>
      {sidebarOpen ? <PanelLeftClose size={18}/> : <PanelLeftOpen size={18}/>}<span>目录</span>
    </button>
    <div id="reading-sidebar" className="reading-sidebar-layer" inert={!sidebarOpen || !active}>
    <AnimatePresence initial={false}>
    {sidebarOpen && <motion.aside key="reading-sidebar" className="reading-directory" aria-label="文档目录"
      initial={reduce ? false : { x: -28, opacity: 0, clipPath: 'polygon(0 0,0 0,0 100%,0 100%)' }}
      animate={{ x: 0, opacity: 1, clipPath: 'polygon(0 0,100% 0,100% 100%,0 100%)' }}
      exit={reduce ? { opacity: 0 } : { x: -18, opacity: 0, clipPath: 'polygon(0 0,0 0,0 100%,0 100%)', transition: { duration: .17 } }}
      transition={{ duration: reduce ? 0 : .28, ease: [.16, 1, .3, 1] }}>
      <header className="scene-title title-reading" aria-hidden="true"><div className="title-eyebrow"><span>{sceneNumber}</span><i/>课程与源码</div><h2>READ<span className="title-period">.</span></h2></header>
      {!reduce && <motion.i className="reading-sidebar-flash" aria-hidden="true" initial={{ x: '-130%' }} animate={{ x: '500%' }} transition={{ duration: .32, ease: 'easeOut' }}/>}
      <div className="file-root"><Folder size={16}/>CODECOURSE</div>
      <div className="reading-directory-switch" role="group" aria-label="选择目录类型">
        <button aria-pressed={directory === 'course'} onClick={() => setDirectory('course')}><BookOpen size={14}/>课程</button>
        <button aria-pressed={directory === 'file'} onClick={() => setDirectory('file')}><FileCode2 size={14}/>源码</button>
      </div>
      <div className="reading-directory-list" key={directory}>
        <div className="folder-label"><ChevronRight size={14}/>{directory === 'course' ? 'CHAPTERS' : 'src / scenes'}</div>
        {directoryItems.map((item, i) => <button key={item.id} className={`file-choice ${activeId === item.id ? 'selected' : ''}`} aria-pressed={activeId === item.id}
          onClick={() => setLayout(current => updateGroup(current, activeGroup, g => g.items.some(d => d.id === item.id) ? { ...g, activeItemId: item.id } : openItem(g, item)))}>
          <span>0{i + 1}</span>{item.type === 'course' ? <BookOpen size={14}/> : <FileCode2 size={14}/>}<strong>{item.title}</strong>
        </button>)}
      </div>
    </motion.aside>}
    </AnimatePresence>
    </div>
    <div className="reading-workspace" aria-label="合并阅读工作区"><WorkspaceNode node={layout} actions={actions}/></div>
    <div className="source-bottom reading-bottom"><span>READ THE COURSE. FOLLOW THE SOURCE.</span>{action}</div>
  </section>;
}
