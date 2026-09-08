// Development-only fixtures for populated and uncommon production UI surfaces.
// Not an entry in the desktop or Android build.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles.css';
import '../src/styles/apple-tokens.css';
import '../src/styles/apple-workbench.css';
import '../src/styles/apple-content.css';
import '../src/styles/apple-code-highlight.css';
import '../src/styles/apple-overlays.css';
import '../src/styles/apple-depth.css';
import '../src/styles/learner-profile.css';
import '../src/styles/call-guide.css';
import '../src/desktop/direction.css';
import '../src/desktop/direction-surfaces.css';
import '../src/desktop/direction-reader.css';
import '../src/desktop/direction-ask.css';
import '../src/desktop/direction-interface.css';
import '../src/desktop/direction-generation.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow-condensed/800-italic.css';
import '@fontsource/noto-sans-sc/400.css';
import '@fontsource/noto-sans-sc/500.css';
import TitleBar from '../src/components/TitleBar';
import ContextFilePickerDialog from '../src/components/ContextFilePickerDialog';
import OutlineQuestionnaireDialog from '../src/components/OutlineQuestionnaireDialog';
import TermActionPopover from '../src/components/TermActionPopover';
import TermFeedbackPopover from '../src/components/TermFeedbackPopover';
import SelectionQuickBar from '../src/components/SelectionQuickBar';
import MarkdownViewer from '../src/components/MarkdownViewer';
import CodeViewer from '../src/components/CodeViewer';
import CallGuideViewer from '../src/components/CallGuideViewer';
import KnowledgeGraphViewer from '../src/components/KnowledgeGraphViewer';
import AppDialog from '../src/components/AppDialog';
import EditorPaneFrame from '../src/workbench/EditorPaneFrame';
import type { CallGuide, DocumentTerm } from '../src/api/client';

const noop = () => {};
const source = `// 请求的旅程：从入口到响应\nexport async function handleRequest(request: Request) {\n  const user = await authenticate(request);\n  if (!user) throw new Error("Unauthorized");\n  return Response.json({ user, status: 200 });\n}\n`;
const markdown = '# 请求如何流经后端\n\n一次请求依次经过路由、中间件与业务处理函数。\n\n## 三个关键步骤\n\n| 阶段 | 职责 |\n| --- | --- |\n| 路由 | 找到处理函数 |\n| 身份验证 | 识别当前用户 |\n| 响应 | 返回结构化数据 |\n\n> 先理解数据流，再深入每一个函数。\n\n```typescript\n' + source + '\n```\n\n## 练习\n\n- 找到项目入口\n- 追踪身份验证失败时的路径';
const term: DocumentTerm = { id: 1, project_id: 1, source_type: 'course', source_path: 'overview.md', term_text: '依赖注入与控制反转（Dependency Injection）', detection_source: 'rule', confidence: 1, status: 'candidate', created_at: '', updated_at: '' };
const baseGuide: CallGuide = {
  id: 1, project_id: 1, title: 'handleRequest 调用链', root: { symbol_name: 'handleRequest', path: 'src/server.ts', start_line: 1, end_line: 6 },
  nodes: [
    { id: 'root', symbol_name: 'handleRequest', path: 'src/server.ts', start_line: 1, end_line: 6, content: source, direction: 'root', hop: 0 },
    { id: 'caller', symbol_name: 'route', path: 'src/router.ts', start_line: 8, end_line: 14, content: 'return handleRequest(request);', direction: 'caller', hop: 1 },
    { id: 'callee', symbol_name: 'authenticate', path: 'src/auth.ts', start_line: 2, end_line: 10, content: 'return verifyToken(request.headers.get("Authorization"));', direction: 'callee', hop: 1 },
  ],
  edges: [{ id: 'a', source: 'caller', target: 'root', relation: 'calls', verified: true }, { id: 'b', source: 'root', target: 'callee', relation: 'calls', verified: true }],
  coverage: { status: 'complete', callers_complete: true, callees_complete: true, engine: 'fixture' }, current_node_id: 'root', visited_node_ids: ['root'], stale: false, created_at: '', updated_at: '',
};

function Audit() {
  const which = new URLSearchParams(location.search).get('case') || 'markdown';
  const [menu, setMenu] = useState(which === 'workspace-menu');
  const [guide, setGuide] = useState({ ...baseGuide, stale: which === 'call-guide-stale' });
  const [dialogValue, setDialogValue] = useState('archive');
  const [confirmed, setConfirmed] = useState('');
  const mark = (value: unknown) => setConfirmed(JSON.stringify(value));
  const edgePosition = { x: innerWidth - 20, y: innerHeight - 20 };
  return <div className="app-shell direction-app" data-audit={which}>
    <TitleBar />
    <main style={{ position: 'absolute', inset: '65px 36px 36px', borderTop: '3px solid #8ce9ff', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {which.startsWith('call-guide') ? <CallGuideViewer guide={guide} onSelectNode={(id, ids) => setGuide({ ...guide, current_node_id: id, visited_node_ids: ids })} onOpenSource={noop} onExplain={noop} onRefresh={noop} onDelete={noop} />
      : which === 'graph' ? <KnowledgeGraphViewer projectId={1} onOpenQA={noop} onOpenCourse={noop} onOpenFile={noop} />
      : <EditorPaneFrame group={{ id: 'audit', activeItemId: 'doc', items: [{ id: 'doc', type: 'course', path: 'overview.md', title: '请求如何流经后端', content: markdown }] }} active mobile={false} workspaceMenuOpen={menu} canUndoLayout canManageGroups onActivatePane={noop} onActivateItem={noop} onCloseItem={noop} onTabDragEnd={noop} onToggleWorkspaceMenu={() => setMenu(!menu)} onUndoLayout={noop} onEqualize={noop} onMergeGroups={noop} onCloseGroup={noop}>
        {which === 'code' ? <CodeViewer path="src/server.ts" language="typescript" content={source.repeat(8)} /> : <MarkdownViewer title="请求如何流经后端" sourcePath="overview.md" content={markdown} />}
      </EditorPaneFrame>}
    </main>
    <div className="direction-game direction-overlays" style={{ display: 'contents' }}>
      {which === 'files' && <ContextFilePickerDialog open files={['README.md', 'src/server.ts', 'src/router.ts', 'src/auth.ts', 'src/features/authentication/adapters/一个用于检查长路径是否正确换行的文件名.ts']} selected={['src/server.ts']} currentPath="src/server.ts" onClose={noop} onConfirm={mark} />}
      {which.startsWith('questionnaire') && <OutlineQuestionnaireDialog preflight={which === 'questionnaire-error' ? null : { preflight_id: 'audit', questions: [{ question: '你希望这份课程重点帮助你解决什么问题？', question_type: 'multi_choice', dimension: 'goal', rationale: '按你的目标安排阅读顺序与练习。', options: [{ value: 'flow', label: '理解一次请求从入口到响应的数据流' }, { value: 'edit', label: '学会独立修改现有功能并定位问题' }, { value: 'base', label: '先补充必要的基础知识，再阅读项目源码' }] }] }} loading={false} error={which === 'questionnaire-error' ? '问卷生成失败，请检查模型连接后重试。' : ''} onAnswers={mark} onClose={noop} />}
      {which === 'term-action' && <TermActionPopover term={term} position={edgePosition} onGenerate={noop} onKnown={noop} onUnknown={noop} onDismiss={noop} onClose={noop} />}
      {which === 'term-feedback' && <TermFeedbackPopover conceptId="dependency-injection" conceptName={term.term_text} definition={'将对象需要的依赖从外部传入，使实现与具体依赖分离。'.repeat(5)} projectId={1} position={edgePosition} onClose={noop} />}
      {which === 'selection' && <SelectionQuickBar canHighlight highlighted={false} anchorRect={{ left: innerWidth - 80, right: innerWidth - 10, top: innerHeight - 55, bottom: innerHeight - 35, width: 70, height: 20 }} onAsk={noop} onExplainTerm={noop} onCallGuide={noop} onToggleHighlight={noop} onCopy={noop} onClose={noop} />}
      {which === 'import' && <AppDialog state={{ kind: 'choice', title: '导入项目', options: [{ value: 'archive', label: '导入 ZIP 压缩包', description: '从本机压缩包创建一个学习项目' }, { value: 'repository', label: 'GitHub 仓库', description: '通过仓库地址导入项目源码' }] }} value={dialogValue} onValueChange={setDialogValue} onCancel={noop} onConfirm={noop} />}
    </div>
    <output data-audit-result hidden>{confirmed}</output>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Audit />);
