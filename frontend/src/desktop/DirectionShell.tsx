import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps } from 'react';
import { gsap } from 'gsap';
import { useReducedMotion, motion } from 'framer-motion';
import { ArrowUpRight, Download, Plus, Search, RefreshCw, Trash2, Settings2, FileText, BrainCircuit, MousePointer2, FileArchive, Code2, PanelLeftOpen, PanelLeftClose } from 'lucide-react';
import type DesktopToolbar from '../components/DesktopToolbar';

export type DesktopScene = 'project' | 'reader' | 'generate' | 'ask' | 'system';
type Props = ComponentProps<typeof DesktopToolbar> & {
  scene: DesktopScene;
  onSceneChange: (scene: DesktopScene) => void;
  onPresentedSceneChange: (scene: DesktopScene) => void;
  generationIntent: 'outline' | 'lesson' | 'brief' | 'detailed';
};
const scenes: { id: DesktopScene; label: string; name: string; number: string; subtitle: string; art: string }[] = [
  { id: 'project', label: 'PROJECT', name: '项目', number: '01', subtitle: '选择你的下一段旅程', art: 'project' },
  { id: 'reader', label: 'READ', name: '阅读工作区', number: '02', subtitle: '课件与源码，同一个工作区', art: 'source' },
  { id: 'generate', label: 'GENERATE', name: '生成', number: '03', subtitle: '描绘接下来的旅程', art: 'project' },
  { id: 'ask', label: 'ASK', name: '提问', number: '04', subtitle: '好问题，值得一个新世界', art: 'ask' },
  { id: 'system', label: 'SYSTEM', name: '设置', number: '05', subtitle: '按照你的方式探索', art: 'ask' },
];

export default function DirectionShell(props: Props) {
  const [shown, setShown] = useState(props.scene);
  const [moving, setMoving] = useState(false);
  const reduced = useReducedMotion();
  const root = useRef<HTMLDivElement>(null);
  const cover = useRef<HTMLDivElement>(null);
  const previous = useRef(props.scene);
  const readerFocus = useRef<HTMLElement | null>(null);
  const frame = useRef(0);
  const meta = scenes.find(s => s.id === shown)!;
  const target = scenes.find(s => s.id === props.scene)!;
  useLayoutEffect(() => {
    const app = root.current?.closest<HTMLElement>('.direction-app');
    if (!app) return;
    const present = () => { setShown(props.scene); props.onPresentedSceneChange(props.scene); };
    if (previous.current === 'reader' && document.activeElement instanceof HTMLElement) readerFocus.current = document.activeElement;
    const restoreFocus = () => {
      const focus = props.scene === 'reader'
        ? readerFocus.current?.isConnected && readerFocus.current.getClientRects().length ? readerFocus.current : root.current?.querySelector<HTMLElement>('.direction-directory-toggle')
        : root.current?.querySelector<HTMLElement>('h1');
      focus?.focus({ preventScroll: true });
    };
    if (previous.current === props.scene || reduced) {
      const changed = previous.current !== props.scene;
      present(); setMoving(false); previous.current = props.scene;
      if (changed) { const id = requestAnimationFrame(restoreFocus); return () => cancelAnimationFrame(id); }
      return;
    }
    previous.current = props.scene;
    setMoving(true);
    app.dataset.moving = 'true';
    const block = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('.direction-overlays')) return;
      e.preventDefault(); e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', block, true);
    const timeline = gsap.timeline({ onComplete: () => {
      setMoving(false); gsap.set(cover.current, { visibility: 'hidden' });
      delete app.dataset.moving;
      window.removeEventListener('keydown', block, true);
      restoreFocus();
    } });
    timeline.set(cover.current, { visibility: 'visible', xPercent: -120 })
      .to(cover.current, { xPercent: 0, duration: .24, ease: 'power4.out' }, .08)
      .call(present, [], .32)
      .to(cover.current, { xPercent: 125, duration: .32, ease: 'power3.inOut' }, .38);
    return () => { timeline.kill(); delete app.dataset.moving; window.removeEventListener('keydown', block, true); gsap.set(cover.current, { visibility: 'hidden' }); };
  }, [props.scene, reduced, props.onPresentedSceneChange]);
  useEffect(() => {
    if (reduced || shown === 'reader') return;
    const move = (e: PointerEvent) => { cancelAnimationFrame(frame.current); frame.current = requestAnimationFrame(() => {
      root.current?.style.setProperty('--dx', `${(e.clientX / innerWidth - .5) * 12}px`);
      root.current?.style.setProperty('--dy', `${(e.clientY / innerHeight - .5) * 8}px`);
    }); };
    window.addEventListener('pointermove', move);
    return () => { window.removeEventListener('pointermove', move); cancelAnimationFrame(frame.current); };
  }, [reduced, shown]);
  const navigate = (next: DesktopScene) => { if (!moving) props.onSceneChange(next); };
  const actions = [
    { title: '模型与应用设置', subtitle: '连接模型、管理服务', icon: Settings2, click: props.onOpenSettings },
    { title: '提示词工作室', subtitle: '总纲、课件与源码分析', icon: FileText, click: props.onOpenPrompts },
    { title: '学习档案', subtitle: '偏好、知识状态与理解检查', icon: BrainCircuit, click: props.onOpenPreferences },
    { title: '鼠标手势', subtitle: '查看完整手势操作指南', icon: MousePointer2, click: props.onOpenGestureGuide },
    { title: '导出全部数据', subtitle: '备份项目与学习记录', icon: FileArchive, click: props.onExportDataArchive },
    { title: '导入数据包', subtitle: '恢复原版导出的学习数据', icon: Download, click: props.onImportDataArchive },
    { title: props.indexLabel, subtitle: '代码检索与调用链支持', icon: Code2, click: props.onBuildIndex, disabled: props.indexDisabled },
    { title: '全局搜索', subtitle: '课程、源码、回答与命令', icon: Search, click: props.onOpenCommandPalette },
  ];
  return <div className={`direction-shell ${shown === 'reader' ? 'is-reader' : ''}`} ref={root}>
    <div className="direction-stage" inert={moving}>
    <div className="direction-art" style={{ backgroundImage: `url(${import.meta.env.BASE_URL}direction/${meta.art}.png)` }} aria-hidden="true"/>
    <div className="direction-geometry" aria-hidden="true"/>
    <div className="direction-brand">CODE<span>//</span>COURSE</div>
    <div className="direction-corner"><button onClick={props.onOpenCommandPalette} aria-label="搜索课程、源码和命令"><Search size={19}/></button><button onClick={() => navigate('system')} aria-label="打开系统场景"><Settings2 size={19}/></button></div>
    {shown !== 'reader' && <header className={`direction-heading heading-${shown}`}><div><b>{meta.number}</b><i/>{meta.subtitle}</div><h1 tabIndex={-1}>{meta.label}<span>.</span></h1></header>}
    {shown === 'reader' && <>
      <button className="direction-directory-toggle" onClick={props.onToggleNavigation} aria-expanded={props.navigationOpen} aria-controls="direction-document-sidebar" aria-label={props.navigationOpen ? '收起文档侧栏' : '展开文档侧栏'}>
        {props.navigationOpen ? <PanelLeftClose size={18}/> : <PanelLeftOpen size={18}/>}<span>目录</span>
      </button>
      <div className="direction-reading-bottom"><span>READ THE COURSE. FOLLOW THE SOURCE.</span><button className="direction-button" onClick={props.onToggleAssistant} aria-label="打开 AI 助手">向 AI 提问<ArrowUpRight size={18}/></button></div>
    </>}
    {shown === 'project' && <section className="direction-projects" aria-label="项目选择">
      <div className="direction-project-track">{props.projects.length ? props.projects.map((project, index) => <div className={`direction-project-row ${project.id === props.project?.id ? 'selected' : ''}`} key={project.id}>
        <button className="direction-project-main" onClick={() => props.onSelectProject(project)} disabled={props.busyProjectId === project.id}><span>{String(index + 1).padStart(2, '0')}</span><strong>{project.name}<small>{project.project_type === 'learning_plan' ? 'LEARNING PLAN' : project.status}</small></strong><ArrowUpRight/></button>
        <div className="direction-project-tools">{project.project_type === 'repository' && <button title="重新扫描并生成规则课程" aria-label={`重新扫描 ${project.name}`} disabled={props.busyProjectId === project.id} onClick={() => props.onRegenerateProject(project)}><RefreshCw size={15}/></button>}<button title="删除项目" aria-label={`删除 ${project.name}`} disabled={props.busyProjectId === project.id} onClick={() => props.onDeleteProject(project)}><Trash2 size={15}/></button></div>
      </div>) : <div className="direction-no-project"><strong>YOUR NEXT<br/>JOURNEY.</strong><p>从一个仓库，或一个好奇的问题开始。</p></div>}</div>
      <div className="direction-project-actions"><button className="direction-button" onClick={props.onImport}><Download size={16}/>导入项目<ArrowUpRight size={19}/></button><button className="direction-text-action" onClick={props.onCreateLearningPlan}><Plus size={17}/>新建学习计划</button>{props.project && <button className="direction-text-action" onClick={() => navigate('reader')}>继续学习<ArrowUpRight size={16}/></button>}</div>
    </section>}
    {shown === 'project' && <div className="direction-project-story"><span>CURRENT JOURNEY</span><h2>{props.project?.name || '从一行代码，走进整个世界。'}</h2><p>{props.progressLabel || '每一次探索，都算数。'}</p></div>}
    {shown === 'generate' && <div className="direction-generation-modes">{([['outline','学习总纲'],['lesson','当前课件'],['brief','粗略介绍'],['detailed','详细分析']] as const).map(([intent,label],i) => <button key={intent} className={props.generationIntent === intent ? 'selected' : ''} disabled={!props.project || props.loading || (intent === 'lesson' && !props.canGenerateLesson) || ((intent === 'brief' || intent === 'detailed') && !props.canGenerateFile)} onClick={() => props.onOpenGeneration(intent)}><span>0{i + 1}</span>{label}<ArrowUpRight size={18}/></button>)}</div>}
    {shown === 'system' && <section className="direction-system" aria-label="系统功能">{actions.map((action,i) => <motion.button key={action.title} disabled={action.disabled || !action.click} onClick={action.click} initial={reduced ? false : { opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: .18, delay: reduced ? 0 : i * .025 }}><span>{String(i+1).padStart(2,'0')}</span><action.icon size={20}/><strong>{action.title}<small>{action.subtitle}</small></strong><ArrowUpRight size={20}/></motion.button>)}</section>}
    <nav className="direction-nav" aria-label="主场景" onKeyDown={e => {
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return;
      e.preventDefault(); const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button')); const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length-1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    }}><div className="direction-nav-caption"><span>EXPLORE THE UNKNOWN</span><small>Ctrl K · 搜索与命令</small></div><div>{scenes.map(s => <button key={s.id} disabled={moving} aria-current={shown === s.id ? 'page' : undefined} onClick={() => navigate(s.id)}><b>{s.number}</b><strong>{s.label}<small>{s.name}</small></strong><ArrowUpRight size={17}/></button>)}</div></nav>
    </div>
    {moving && <div className="direction-input-lock" aria-hidden="true" />}
    <div ref={cover} className="direction-transition" aria-hidden="true"><b>{target.number}</b><strong>{target.label}</strong></div>
  </div>;
}
