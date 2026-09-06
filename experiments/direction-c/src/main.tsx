import React, { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { gsap } from 'gsap';
import { ArrowUpRight, ArrowRight, X, Plus, Search, CornerDownLeft, Square, Copy, RotateCcw, ChevronRight, FileCode2, Folder, Check, Layers, SlidersHorizontal } from 'lucide-react';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow-condensed/800-italic.css';
import '@fontsource/noto-sans-sc/400.css';
import '@fontsource/noto-sans-sc/500.css';
import './style.css';
import ReadingPreview from './ReadingPreview';
import './reading-preview.css';

const readingPreview = new URLSearchParams(location.search).get('preview') === 'reading';

type DesktopScene = 'project' | 'course' | 'source' | 'generate' | 'ask' | 'system';
type PreviewScene = Extract<DesktopScene, 'project' | 'source' | 'ask'>;
type Phase = 'idle' | 'leaving' | 'sweeping' | 'entering';
const originalScenes: { id: DesktopScene; number: string; label: string; zh: string; available: boolean }[] = [
  { id: 'project', number: '01', label: 'PROJECT', zh: '项目', available: true },
  { id: 'course', number: '02', label: 'COURSE', zh: '课程', available: false },
  { id: 'source', number: '03', label: 'SOURCE', zh: '源码', available: true },
  { id: 'generate', number: '04', label: 'GENERATE', zh: '生成', available: false },
  { id: 'ask', number: '05', label: 'ASK', zh: '提问', available: true },
  { id: 'system', number: '06', label: 'SYSTEM', zh: '设置', available: false },
];
// One display registry keeps menu, headings, commands and transition numbers aligned.
const scenes = readingPreview
  ? originalScenes.filter(s => s.id !== 'course').map((s, index) => ({
      ...s, number: String(index + 1).padStart(2, '0'),
      ...(s.id === 'source' ? { label: 'READ', zh: '阅读' } : {}),
    }))
  : originalScenes;
const projects = [
  { name: 'CodeCourse', subtitle: '从一行代码，走进整个世界。', tag: 'TYPESCRIPT / PYTHON', progress: 68, chapters: '17 / 25', branch: 'main' },
  { name: 'Moonlit Engine', subtitle: '让每一次交互，都有自己的节奏。', tag: 'TYPESCRIPT / WEBGL', progress: 34, chapters: '08 / 24', branch: 'develop' },
  { name: 'Blue Archive', subtitle: '记录那些值得再次发现的灵感。', tag: 'RUST / REACT', progress: 12, chapters: '03 / 25', branch: 'main' },
];
const answers = [
  '场景切换由一个明确的状态机控制。当前场景离开后，新场景才接管交互，因此阅读器和提问界面不会同时争夺空间。',
  '转场分为离开、扫场、进入三个阶段。背景可以移动，正文与输入框保持稳定；返回源码时保留文件、标签和阅读位置。',
  '这段回答是本地演示，用于审查逐段显现、停止、复制和重新播放的手感。原型没有连接 AI 服务，也不会读取你的项目。',
];

function GameActionButton({ children, variant = 'primary', busy = false, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; busy?: boolean }) {
  return <button {...props} className={`game-button ${variant} ${className} ${busy ? 'is-busy' : ''}`} disabled={props.disabled || busy} aria-busy={busy || undefined}>
    <span className="button-surface" aria-hidden="true"/><span className="button-copy">{children}</span><ArrowUpRight className="button-arrow" size={20} aria-hidden="true"/>
  </button>;
}

function SceneTitle({ scene, subtitle }: { scene: PreviewScene; subtitle: string }) {
  const meta = scenes.find(s => s.id === scene)!;
  return <header className={`scene-title title-${scene}`}><div className="title-eyebrow"><span>{meta.number}</span><i/>{subtitle}</div><h1 tabIndex={-1} id="scene-heading">{meta.label}<span className="title-period">.</span></h1></header>;
}

function AnimatedNumber({ value }: { value: number }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(value);
  const prev = useRef(value);
  useEffect(() => {
    const from = prev.current; prev.current = value;
    if (reduce) { setShown(value); return; }
    let frame: number; const start = performance.now();
    const step = (now: number) => { const p = Math.min((now - start) / 450, 1); setShown(Math.round(from + (value - from) * (1 - (1 - p) ** 3))); if (p < 1) frame = requestAnimationFrame(step); };
    frame = requestAnimationFrame(step); return () => cancelAnimationFrame(frame);
  }, [value, reduce]);
  return <>{shown.toString().padStart(2, '0')}</>;
}

function SceneMenu({ scene, navigate }: { scene: PreviewScene; navigate: (scene: PreviewScene) => void }) {
  const nav = useRef<HTMLElement>(null);
  return <nav ref={nav} className="scene-menu" aria-label="场景导航" onKeyDown={e => {
    const items = Array.from(nav.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const offset = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (offset || e.key === 'Home' || e.key === 'End') { e.preventDefault(); items[e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (index + offset + items.length) % items.length]?.focus(); }
  }}>{scenes.map(s => <button className={readingPreview && s.id === 'source' ? 'merged-reading-entry' : undefined} key={s.id} disabled={!s.available} aria-current={scene === s.id ? 'page' : undefined} title={s.available ? s.zh : `${s.zh}：方向确认后接入`} onClick={() => navigate(s.id as PreviewScene)}><span className="nav-number">{s.number}</span><span className="nav-label">{s.label}<small>{s.zh}</small></span><ArrowUpRight size={18}/></button>)}</nav>;
}

function GameModal({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const previousFocus = useRef(document.activeElement as HTMLElement | null);
  const reduce = useReducedMotion();
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('button,input')?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      if (e.key !== 'Tab') return;
      const elements = Array.from(panel.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input,textarea,[tabindex="0"]'));
      const first = elements[0], last = elements.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('keydown', key, true); requestAnimationFrame(() => { if (!panel.current && previousFocus.current?.isConnected) previousFocus.current.focus(); }); };
  }, [close]);
  return <motion.div className="modal-layer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? 0 : .18 }} onClick={e => { if (e.target === e.currentTarget) close(); }}>
    <motion.div ref={panel} className="game-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" initial={reduce ? false : { x: 80, y: 90, clipPath: 'polygon(0 100%,100% 100%,100% 100%,0 100%)' }} animate={{ x: 0, y: 0, clipPath: 'polygon(0 0,100% 0,100% 100%,0 100%)' }} exit={{ x: 30, y: 50 }} transition={{ duration: reduce ? 0 : .3 }}>
      <div className="modal-heading"><h2 id="modal-title">{title}</h2><button className="icon-button" aria-label="关闭弹窗" onClick={close}><X/></button></div>{children}
    </motion.div>
  </motion.div>;
}

function ProjectScene({ selected, select, navigate, openModal }: { selected: number; select: (index: number) => void; navigate: (scene: PreviewScene) => void; openModal: () => void }) {
  const project = projects[selected];
  return <section className="project-scene scene-content" aria-label="项目场景">
    <SceneTitle scene="project" subtitle="选择你的下一段旅程"/>
    <div className="project-track" role="group" aria-label="演示项目选择">{projects.map((p, i) => <button key={p.name} className={`project-choice ${selected === i ? 'selected' : ''}`} aria-pressed={selected === i} onClick={() => select(i)} style={{ '--index': i } as React.CSSProperties}><span className="project-index">0{i + 1}</span><span className="project-name">{p.name}<small>{p.tag}</small></span><ArrowUpRight className="project-arrow"/><span className="selection-word" aria-hidden="true">SELECT</span></button>)}</div>
    <div className="project-actions"><GameActionButton onClick={() => navigate('source')}>进入项目</GameActionButton><button className="text-action" onClick={openModal}><Plus size={18}/>新建 / 导入</button></div>
    <motion.div key={selected} className="project-caption" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}><span className="caption-marker">CURRENT JOURNEY</span><h2>{project.subtitle}</h2></motion.div>
    <div className="project-progress"><span className="mini-label">探索进度</span><div className="progress-number"><AnimatedNumber value={project.progress}/><small>%</small></div><div className="slash-progress" role="progressbar" aria-label="演示探索进度" aria-valuenow={project.progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${project.progress}%` }}/></div><div className="progress-meta"><span>{project.chapters} 章节</span><span>{project.branch}</span></div></div>
    <span className="giant-watermark" aria-hidden="true">01</span>
  </section>;
}

const files = ['App.tsx', 'SceneTransition.tsx', 'useScene.ts'];
const code: Record<string, string[]> = {
  'App.tsx': ["import { DesktopGameShell } from './scenes';", "import { useScene } from './useScene';", '', 'export function App() {', '  const { scene, navigate } = useScene();', '', '  return (', '    <DesktopGameShell', '      scene={scene}', '      onNavigate={navigate}', '      preserveWorkspace', '    >', '      <SceneContent scene={scene} />', '    </DesktopGameShell>', '  );', '}', '', '// Keep the content steady. Let the world move.'],
  'SceneTransition.tsx': ['export const transition = {', "  idle: 'ready for interaction',", "  leaving: 'slice the previous scene',", "  sweeping: 'reveal the scene number',", "  entering: 'restore focus and controls',", '};', '', 'export const duration = 700;', '', 'export function canNavigate(phase: string) {', "  return phase === 'idle';", '}'],
  'useScene.ts': ["import { useState } from 'react';", '', "type Scene = 'project' | 'source' | 'ask';", '', 'export function useScene() {', "  const [scene, navigate] = useState<Scene>('project');", '', '  return { scene, navigate };', '}'],
};
function CodeLine({ text }: { text: string }) {
  const parts = text.split(/('[^']*'|\/\/.*|\b(?:import|from|export|function|const|return|type|string)\b)/g);
  return <>{parts.map((part, i) => <span key={i} className={part.startsWith('//') ? 'code-comment' : part.startsWith("'") ? 'code-string' : /^(import|from|export|function|const|return|type|string)$/.test(part) ? 'code-keyword' : undefined}>{part}</span>)}</>;
}
function SourceScene({ file, setFile, split, setSplit, navigate }: { file: string; setFile: (file: string) => void; split: boolean; setSplit: (split: boolean) => void; navigate: (scene: PreviewScene) => void }) {
  return <section className="source-scene scene-content" aria-label="源码场景">
    <SceneTitle scene="source" subtitle="阅读代码的另一面"/>
    <aside className="source-files"><div className="file-root"><Folder size={16}/> CODECOURSE <span>18</span></div><div className="folder-label"><ChevronRight size={14}/> src / scenes</div>{files.map((f, i) => <button className={`file-choice ${file === f ? 'selected' : ''}`} onClick={() => setFile(f)} key={f} aria-pressed={file === f}><span>0{i + 1}</span><FileCode2 size={16}/>{f}</button>)}<div className="file-footnote"><span>READ THE LOGIC</span><p>每一行，都有迹可循。</p></div></aside>
    <div className="source-workspace"><div className="source-tabs" role="tablist" aria-label="源码标签" onKeyDown={e => { if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return; e.preventDefault(); const i = files.indexOf(file); const next = e.key === 'Home' ? 0 : e.key === 'End' ? files.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + files.length) % files.length; setFile(files[next]); document.getElementById(`tab-${next}`)?.focus(); }}>{files.map((f,i) => <button id={`tab-${i}`} key={f} role="tab" aria-selected={file === f} tabIndex={file === f ? 0 : -1} aria-controls="code-panel" onClick={() => setFile(f)}>{f}<span>TS</span></button>)}<button className="split-action" aria-label={split ? '关闭分栏演示' : '打开分栏演示'} aria-pressed={split} onClick={() => setSplit(!split)}><Layers size={18}/></button></div>
      <div className={`code-layout ${split ? 'split' : ''}`}><div className="code-pane" id="code-panel" role="tabpanel" aria-labelledby={`tab-${files.indexOf(file)}`} tabIndex={0}><div className="code-breadcrumb">src <ChevronRight size={12}/> scenes <ChevronRight size={12}/><strong>{file}</strong></div><pre aria-label={`${file} 演示源码`}>{code[file].map((line, i) => <div className={`code-line ${i === 7 ? 'current-line' : ''}`} key={i}><span className="line-number" aria-hidden="true">{i + 1}</span><code><CodeLine text={line}/>{line === '' ? '\u00a0' : ''}</code></div>)}</pre></div>{split && <div className="source-note"><span className="mini-label">STRUCTURE / 结构预览</span><h3>一个场景。<br/>一个焦点。</h3><p>转场负责连接空间，内容负责承载思考。</p><div className="structure-step">01 <span>离开当前场景</span></div><div className="structure-step">02 <span>切换活动内容</span></div><div className="structure-step">03 <span>恢复阅读位置</span></div></div>}</div>
      <div className="code-status"><span><i/> TYPESCRIPT</span><span>UTF-8</span><span>只读演示 · Monaco 尚未接入</span></div>
    </div><div className="source-bottom"><span><b>03</b> FOLLOW THE SOURCE.</span><GameActionButton onClick={() => navigate('ask')}>向 AI 提问</GameActionButton></div>
  </section>;
}

type Conversation = { id: number; question: string; count: number };
function AskScene({ question, setQuestion, conversation, history, selectHistory, send, busy, stop, clear, context, setContext, notify }: { question: string; setQuestion: (q: string) => void; conversation: Conversation | null; history: Conversation[]; selectHistory: (c: Conversation) => void; send: (q?: string) => void; busy: boolean; stop: () => void; clear: () => void; context: boolean; setContext: (v: boolean) => void; notify: (s: string) => void }) {
  const reduce = useReducedMotion();
  const answerRef = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useEffect(() => { if (follow.current && answerRef.current) answerRef.current.scrollTop = answerRef.current.scrollHeight; }, [conversation?.count]);
  return <section className="ask-scene scene-content" aria-label="提问场景">
    <SceneTitle scene="ask" subtitle="好问题，值得一个新世界"/>
    <aside className="ask-history"><div className="history-heading"><span>回响 / HISTORY</span><button aria-label="新建演示对话" className="icon-button" onClick={clear}><Plus size={18}/></button></div><div className="history-track">{history.length ? history.map((c,i) => <button key={c.id} className={`history-choice ${conversation?.id === c.id ? 'selected' : ''}`} onClick={() => selectHistory(c)} aria-pressed={conversation?.id === c.id}><span>{(i + 1).toString().padStart(2, '0')}</span><strong>{c.question}</strong><ArrowUpRight size={18}/></button>) : <div className="history-empty"><span>EMPTY ECHO</span><p>下一次灵感，从这里开始。</p></div>}</div></aside>
    <div className="ask-main"><div className="ask-context"><button className="context-toggle" aria-expanded={context} aria-controls="context-detail" onClick={() => setContext(!context)}><span className="context-diamond"/><span>当前上下文</span><strong>App.tsx</strong><Plus size={15} style={{ transform: context ? 'rotate(45deg)' : undefined }}/></button><span className="demo-badge">本地回答演示</span></div>
      <AnimatePresence>{context && <motion.div key="context" id="context-detail" className="context-detail" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: reduce ? 0 : .18 }}><p>演示上下文：src/scenes/App.tsx · 第 4–16 行。仅使用内置示例，不读取真实项目。</p></motion.div>}</AnimatePresence>
      <div className={`answer-stage ${conversation ? 'has-answer' : ''}`} ref={answerRef} onScroll={() => { const el = answerRef.current!; follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64; }} tabIndex={conversation ? 0 : -1} aria-label="回答阅读区">{conversation ? <><div className="question-echo"><span>YOU /</span><h2>{conversation.question}</h2></div><div className="answer-label"><span className={busy ? 'status-diamond busy' : 'status-diamond'}/>{busy ? '正在整理思路' : '回答已就绪'}<span className="answer-order">REPLY / 01</span></div><div className="answer-paragraphs">{answers.slice(0, conversation.count).map((p,i) => <motion.p key={`${conversation.id}-${i}`} initial={reduce ? false : { opacity: 0, y: 9, clipPath: 'inset(0 100% 0 0)' }} animate={{ opacity: 1, y: 0, clipPath: 'inset(0 0% 0 0)' }} transition={{ duration: .22 }}>{p}</motion.p>)}</div>{busy && <div className="answer-loading" aria-label="正在播放演示回答"><span/><span/><span/></div>}{!busy && conversation.count > 0 && <div className="answer-tools"><button onClick={async () => { try { await navigator.clipboard.writeText(answers.slice(0, conversation.count).join('\n\n')); notify('回答已复制'); } catch { notify('复制未完成，请选择文字后复制'); } }}><Copy size={15}/>复制</button><button onClick={() => send(conversation.question)}><RotateCcw size={15}/>重新播放</button></div>}</> : <div className="ask-invitation"><span className="invitation-kicker">A QUESTION OPENS A WORLD.</span><h2>越过表面。<br/><span>问到深处。</span></h2><p>代码的下一层意义，等你来发现。</p><button className="suggestion" onClick={() => setQuestion('场景切换如何避免界面重叠？')}><ArrowUpRight size={16}/>场景切换如何避免界面重叠？</button></div>}</div>
      <form className={`ask-composer ${busy ? 'sending' : ''}`} onSubmit={e => { e.preventDefault(); send(); }}><label htmlFor="question">YOUR QUESTION<span>提问</span></label><textarea id="question" value={question} onChange={e => setQuestion(e.target.value)} placeholder="有什么，值得再往深处问？" maxLength={2000} rows={2} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); if (!busy) send(); } }}/><div className="composer-bottom"><span><CornerDownLeft size={13}/> 发送 <i/> Shift + Enter 换行</span>{busy ? <GameActionButton type="button" variant="danger" onClick={stop}><Square size={13}/>停止</GameActionButton> : <GameActionButton type="submit" disabled={!question.trim()}>发送问题</GameActionButton>}</div></form>
    </div><div className="ask-signature" aria-hidden="true">DIVE<br/><span>DEEPER.</span></div>
  </section>;
}

function App() {
  const initial = new URLSearchParams(location.search).get('scene');
  const [scene, setScene] = useState<PreviewScene>(initial === 'source' || initial === 'ask' ? initial : 'project');
  const [phase, setPhase] = useState<Phase>('idle');
  const [target, setTarget] = useState<PreviewScene>(scene);
  const [selected, setSelected] = useState(0);
  const [file, setFile] = useState(files[0]); const [split, setSplit] = useState(false);
  const [question, setQuestion] = useState(''); const [context, setContext] = useState(false);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [history, setHistory] = useState<Conversation[]>([]); const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<'controls' | 'import' | 'commands' | null>(null);
  const [toast, setToast] = useState(''); const [command, setCommand] = useState('');
  const reduce = useReducedMotion(); const root = useRef<HTMLDivElement>(null); const view = useRef<HTMLDivElement>(null);
  const cover = useRef<HTMLDivElement>(null); const timeline = useRef<gsap.core.Timeline | null>(null);
  const locked = useRef(false); const lastScene = useRef<PreviewScene>('project'); const sequence = useRef(0);
  const toastTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const navRef = useRef<(s: PreviewScene) => void>(() => {});
  const notify = (message: string) => { clearTimeout(toastTimeout.current); setToast(message); toastTimeout.current = setTimeout(() => setToast(''), 3000); };
  const closeModal = React.useCallback(() => setModal(null), []);
  const navigate = (next: PreviewScene) => {
    if (locked.current || next === scene) return;
    lastScene.current = scene; setModal(null); setTarget(next);
    if (reduce) { setScene(next); requestAnimationFrame(() => document.getElementById('scene-heading')?.focus()); return; }
    locked.current = true; setPhase('leaving');
    timeline.current?.kill();
    const tl = gsap.timeline({ onComplete: () => { locked.current = false; setPhase('idle'); gsap.set(view.current, { clearProps: 'transform,opacity,clipPath' }); gsap.set(cover.current, { visibility: 'hidden' }); document.getElementById('scene-heading')?.focus(); } });
    timeline.current = tl;
    tl.set(cover.current, { visibility: 'visible', xPercent: -120 }).to(view.current, { x: -32, opacity: .15, duration: .18, ease: 'power3.in' }, 0)
      .call(() => setPhase('sweeping'), [], .12)
      .to(cover.current, { xPercent: 0, duration: .2, ease: 'power4.out' }, .10)
      .call(() => { setScene(next); setPhase('entering'); }, [], .32)
      .set(view.current, { x: 40, opacity: 0 }, .32)
      .to(cover.current, { xPercent: 125, duration: .28, ease: 'power3.inOut' }, .36)
      .to(view.current, { x: 0, opacity: 1, duration: .3, ease: 'power3.out' }, .40);
  };
  navRef.current = navigate;
  useEffect(() => {
    if (phase === 'idle') document.getElementById('scene-heading')?.focus({ preventScroll: true });
  }, [phase, scene]);
  useEffect(() => {
    if (!reduce || !locked.current) return;
    timeline.current?.kill(); locked.current = false; setScene(target); setPhase('idle');
    gsap.set(view.current, { clearProps: 'transform,opacity,clipPath' }); gsap.set(cover.current, { visibility: 'hidden' });
  }, [reduce, target]);
  useEffect(() => {
    if (!busy || !conversation) return;
    const id = conversation.id;
    const timer = setTimeout(() => { setConversation(c => c?.id === id ? { ...c, count: Math.min(c.count + 1, answers.length) } : c); }, conversation.count === 0 ? 550 : 1000);
    if (conversation.count >= answers.length) { clearTimeout(timer); setBusy(false); }
    return () => clearTimeout(timer);
  }, [busy, conversation]);
  useEffect(() => { if (conversation) setHistory(items => [conversation, ...items.filter(c => c.id !== conversation.id)].slice(0, 8)); }, [conversation]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || locked.current) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setModal(m => m ? null : 'commands'); return; }
      if (e.key === 'Escape' && !document.querySelector('[role="dialog"]') && !['TEXTAREA','INPUT'].includes((e.target as HTMLElement).tagName)) navRef.current(lastScene.current);
    };
    document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (reduce) { root.current?.style.setProperty('--pointer-x', '0px'); root.current?.style.setProperty('--pointer-y', '0px'); return; }
    let frame = 0;
    const move = (e: PointerEvent) => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { root.current?.style.setProperty('--pointer-x', `${(e.clientX / innerWidth - .5) * 12}px`); root.current?.style.setProperty('--pointer-y', `${(e.clientY / innerHeight - .5) * 8}px`); }); };
    window.addEventListener('pointermove', move); return () => { window.removeEventListener('pointermove', move); cancelAnimationFrame(frame); };
  }, [reduce]);
  useEffect(() => () => { timeline.current?.kill(); clearTimeout(toastTimeout.current); }, []);
  const send = (q?: string) => {
    const text = (q ?? question).trim();
    if (!text || busy) return;
    const id = q !== undefined && conversation?.question === text ? conversation.id : ++sequence.current;
    setConversation({ id, question: text, count: 0 }); setBusy(true); setQuestion('');
  };
  const commands = scenes.filter(s => s.available && `${s.label}${s.zh}${readingPreview && s.id === 'source' ? '课程课件源码' : ''}`.toLowerCase().includes(command.toLowerCase()));
  return <div ref={root} className={`game-root scene-${scene} ${readingPreview ? 'reading-merge-preview' : ''}`} data-scene={scene} data-phase={phase}>
    <div className="scene-background" aria-hidden="true" style={{ backgroundImage: `url(/candidates/${scene}.png)` }}/><div className="ink-slash" aria-hidden="true"/><div className="floating-shards" aria-hidden="true"><i/><i/><i/></div>
    <div className="application-plane" inert={modal !== null || phase !== 'idle'}>
      <div className="corner-brand">CODE<span>//</span>COURSE<small>{readingPreview ? '阅读合并预览 · 内置样本' : 'DIRECTION C · 视觉实验'}</small></div>
      <div className="corner-actions"><button className="icon-button" onClick={() => setModal('commands')} aria-label="打开命令面板"><Search size={19}/></button><button className="icon-button" onClick={() => setModal('controls')} aria-label="查看按钮与反馈样本"><SlidersHorizontal size={19}/></button></div>
      <main ref={view} className="scene-stage" aria-labelledby="scene-heading">
        {scene === 'project' && <ProjectScene selected={selected} select={setSelected} navigate={navigate} openModal={() => setModal('import')}/>}
        {!readingPreview && scene === 'source' && <SourceScene file={file} setFile={setFile} split={split} setSplit={setSplit} navigate={navigate}/>}
        {readingPreview && <div className="reading-preview-host" hidden={scene !== 'source'}>
          <ReadingPreview sceneNumber={scenes.find(s => s.id === 'source')!.number} active={scene === 'source'} code={code} onAsk={() => navigate('ask')} action={<GameActionButton onClick={() => navigate('ask')}>向 AI 提问</GameActionButton>} />
        </div>}
        {scene === 'ask' && <AskScene question={question} setQuestion={setQuestion} conversation={conversation} history={history} selectHistory={c => { setBusy(false); setConversation(c); }} send={send} busy={busy} stop={() => { setBusy(false); notify('演示已停止'); }} clear={() => { setBusy(false); setConversation(null); setQuestion(''); }} context={context} setContext={setContext} notify={notify}/>}
      </main><footer className="game-footer"><div className="footer-caption"><span>EXPLORE THE UNKNOWN</span><small><kbd>ESC</kbd> 返回 <i/> <kbd>Ctrl K</kbd> 切换场景</small></div><SceneMenu scene={scene} navigate={navigate}/></footer>
    </div>
    <div className="transition-cover" ref={cover} aria-hidden="true"><span>{scenes.find(s => s.id === target)?.number}</span><strong>{scenes.find(s => s.id === target)?.label}</strong><i/></div>
    <AnimatePresence>{modal && <GameModal key={modal} title={modal === 'controls' ? 'FEEL THE ACTION.' : modal === 'commands' ? 'GO SOMEWHERE.' : 'A NEW JOURNEY.'} close={closeModal}>
      {modal === 'controls' ? <><p className="modal-description">按钮与反馈样本。将鼠标移入，或按 Tab 检查键盘焦点。</p><div className="specimen-grid"><GameActionButton onClick={() => notify('确认动作 · 闪白 / 箭头贯穿')}>确认动作</GameActionButton><GameActionButton variant="secondary" onClick={() => notify('次级动作已触发')}>次级动作</GameActionButton><GameActionButton variant="ghost" onClick={() => notify('返回动作已触发')}>轻量操作</GameActionButton><GameActionButton variant="danger" onClick={() => notify('错误反馈演示 · 操作未完成')}>错误演示</GameActionButton><GameActionButton busy>处理中</GameActionButton><GameActionButton disabled>暂不可用</GameActionButton></div><div className="motion-note"><Check size={16}/>{reduce ? '系统减少动态效果已启用' : '跟随系统的减少动态效果设置'}<span>UI 音效：关闭</span></div></> : modal === 'commands' ? <><input className="command-input" autoFocus aria-label="搜索场景" placeholder="去往哪个场景？" value={command} onChange={e => setCommand(e.target.value)} onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); document.querySelector<HTMLButtonElement>('.command-list button')?.focus(); } if (e.key === 'Enter' && commands[0]) navigate(commands[0].id as PreviewScene); }}/><div className="command-list" onKeyDown={e => { if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return; e.preventDefault(); const list = Array.from(e.currentTarget.querySelectorAll('button')); const i = list.indexOf(document.activeElement as HTMLButtonElement); list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus(); }}>{commands.map(s => <button key={s.id} onClick={() => { if (s.id === scene) closeModal(); else navigate(s.id as PreviewScene); }}><span>{s.number}</span><strong>{s.label}</strong>{s.zh}<ArrowRight size={18}/></button>)}{!commands.length && <p>没有匹配的演示场景。</p>}</div></> : <><p className="modal-description">此处预演项目入口的弹窗与按钮手感。真实创建、导入和文件选择会在视觉方向确认后接入。</p><div className="specimen-grid"><GameActionButton onClick={() => notify('创建入口演示 · 未创建真实项目')}><Plus size={17}/>创建项目</GameActionButton><GameActionButton variant="secondary" onClick={() => notify('导入入口演示 · 未访问文件')}><Folder size={17}/>导入项目</GameActionButton></div></>}
    </GameModal>}</AnimatePresence>
    <AnimatePresence>{toast && <motion.div role="status" className="game-toast" initial={{ x: 100, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 80, opacity: 0 }} transition={{ duration: reduce ? 0 : .15 }}><span>!</span>{toast}</motion.div>}</AnimatePresence>
    <span className="sr-only" role="status">{phase !== 'idle' ? '正在切换场景' : ''}</span>
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
