import { lazy, memo, Suspense, useMemo, useRef } from "react";
import type { DragEvent } from "react";
import { Pencil, Save, Star, X } from "lucide-react";
import type {
  CallGuide,
  CallGuideNode,
  CourseFile,
  DocumentTerm,
  HighlightRecord,
  KnowledgeLink,
  LearningState,
} from "../api/client";
import type { SelectionSummary } from "../components/ExplainPanel";
import type { ViewerSelection } from "../components/CodeViewer";
import CodeViewer from "../components/CodeViewer";
import ReaderLearningToolbar from "../components/ReaderLearningToolbar";
import TeachingRationale from "../components/TeachingRationale";
import type { TermDisplayTier } from "../personalization/termDisplayTypes";
import EditorPaneFrame from "./EditorPaneFrame";
import type { EditorGroup, OpenItem } from "./layout";

const CallGuideViewer = __ANDROID_BUILD__ ? null : lazy(() => import("../components/CallGuideViewer"));
const KnowledgeGraphViewer = lazy(() => import("../components/KnowledgeGraphViewer"));
const MarkdownViewer = lazy(() => import("../components/MarkdownViewer"));

type SelectionAnchor = SelectionSummary & {
  range?: ViewerSelection["range"];
  anchorRect?: ViewerSelection["anchorRect"];
};

type KnowledgeFocusRef = { ref_type: string; ref_path?: string; ref_id?: number } | null;

type Props = {
  group: EditorGroup;
  activeGroupId: string;
  mobile: boolean;
  projectId: number | null;
  courses: CourseFile[];
  editingCourseItemId: string | null;
  editorMountDeferred: boolean;
  workspaceMenuOpen: boolean;
  canUndoLayout: boolean;
  canManageGroups: boolean;
  mobileCodeSearchRequestId: number;
  activeTermSourceKey: string;
  highlights: HighlightRecord[];
  knowledgeLinks: KnowledgeLink[];
  documentTerms: DocumentTerm[];
  visibleTermCandidateIds: ReadonlySet<string>;
  termDisplayTiers: ReadonlyMap<string, TermDisplayTier>;
  selectionAnchor: SelectionAnchor | null;
  qaHighlightDraft: { sourcePath: string; selectedText: string } | null;
  callGuides: CallGuide[];
  callGuideBusyId: number | null;
  knowledgeRefreshKey: number;
  knowledgeFocusRef: KnowledgeFocusRef;
  learningStates: LearningState[];
  isOutlineCourse: (path: string) => boolean;
  onActivatePane: () => void;
  onActivateItem: (item: OpenItem) => void;
  onCloseItem: (itemId: string) => void;
  onTabDragEnd: (event: DragEvent<HTMLElement>, item: OpenItem) => void;
  onToggleWorkspaceMenu: () => void;
  onUndoLayout: () => void;
  onEqualize: () => void;
  onMergeGroups: () => void;
  onCloseGroup: () => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  onMobileCodeSearch: () => void;
  onOpenCourse: (path: string) => void;
  onToggleLessonComplete: (path: string) => void;
  onSetEditingCourse: (itemId: string | null) => void;
  onSaveEditedCourse: (group: EditorGroup, item: OpenItem) => void;
  onCancelEditedCourse: (group: EditorGroup, item: OpenItem) => void;
  onUpdateItemContent: (groupId: string, itemId: string, content: string) => void;
  onSelectionChange: (selection: ViewerSelection) => void;
  onQASelectionChange: (item: OpenItem, selectedText: string | null) => void;
  onCodeJumpConsumed: (itemId: string, requestId: string) => void;
  onLearningPosition: (sourceType: LearningState["source_type"], path: string, positionKind: "line" | "scroll_ratio", value: number) => void;
  onToggleFavorite: (item: OpenItem) => void;
  onCreateHighlight: (sourceType: "course" | "qa", sourcePath: string, selectedText: string) => void;
  onSaveQA: (groupId: string, item: OpenItem) => void;
  onPersonalizationChanged: () => void;
  onOpenKnowledgeLink: (term: string, links: KnowledgeLink[]) => void;
  onOpenQAReference: (projectId: number, qaRecordId: number) => void;
  onGenerateTerm: (term: DocumentTerm, position?: { x: number; y: number }) => void;
  onTermAction: (term: DocumentTerm, position?: { x: number; y: number }) => void;
  onGenerateLesson: (lessonNumber: number, title: string, outlinePath?: string) => void;
  onCallGuideSelection: (guide: CallGuide, nodeId: string, visitedNodeIds: string[]) => void;
  onOpenCallGuideSource: (node: CallGuideNode) => void;
  onExplainCallGuide: (guide: CallGuide, node: CallGuideNode, routeNodeIds: string[]) => void;
  onRefreshCallGuide: (guide: CallGuide) => void;
  onDeleteCallGuide: (guide: CallGuide) => void;
  onRequestText: (options: { title: string; label?: string; initialValue?: string; placeholder?: string; confirmText?: string }) => Promise<string | null>;
  onConfirm: (title: string, message: string, options?: { confirmText?: string; danger?: boolean }) => Promise<boolean>;
  onKnowledgeContentChanged: () => void;
  onKnowledgeGraphChanged: () => void;
  onOpenKnowledgeQA: (qaId: number) => void;
  onOpenKnowledgeCourse: (path: string) => void;
  onOpenKnowledgeFile: (path: string) => void;
};

function lessonFiles(courses: CourseFile[]) {
  return courses
    .filter((file) => /(^|\/)lesson-\d+.*\.md$/i.test(file.filename))
    .sort((a, b) => a.filename.localeCompare(b.filename));
}

function WorkbenchEditorGroupView(props: Props) {
  const {
    group,
    activeGroupId,
    mobile,
    projectId,
    courses,
    editingCourseItemId,
    editorMountDeferred,
    highlights,
    knowledgeLinks,
    documentTerms,
    visibleTermCandidateIds,
    termDisplayTiers,
    selectionAnchor,
  } = props;
  const activeItem = group.items.find((item) => item.id === group.activeItemId) ?? null;
  const activeItemLoading = activeItem?.hydrated === false;
  const lessons = lessonFiles(courses);
  const lessonIndex = activeItem?.type === "course"
    ? lessons.findIndex((file) => file.filename === activeItem.path)
    : -1;
  const learningType: LearningState["source_type"] | null = activeItem?.type === "file"
    ? "file"
    : activeItem?.type === "qa" || activeItem?.qaRecordId
      ? "qa"
      : activeItem?.type === "course"
        ? "course"
        : null;
  const learningState = activeItem && learningType
    ? props.learningStates.find((entry) => (
        entry.source_type === learningType && entry.source_path === activeItem.path
      ))
    : undefined;
  const qaHighlights = activeItem?.type === "qa"
    ? highlights.filter((highlight) => highlight.source_type === "qa" && highlight.source_path === activeItem.path)
    : [];
  const hasMarkdownActions = Boolean(
    activeItem?.type === "course"
    && (activeItem.qaRecordId || activeItem.path.startsWith("selection_answers/") || activeItem.path.startsWith("qa/")),
  );

  const markdownActions = (compact: boolean) => {
    if (!activeItem || !hasMarkdownActions) return null;
    return (
      <>
        {activeItem.qaRecordId && projectId ? (
          <TeachingRationale
            projectId={projectId}
            qaRecordId={activeItem.qaRecordId}
            onChanged={props.onPersonalizationChanged}
            compact={compact}
          />
        ) : null}
        <button
          type="button"
          className={compact ? "mobile-reader-action-button" : "secondary-button compact"}
          onClick={(event) => {
            event.stopPropagation();
            props.onSetEditingCourse(activeItem.id);
          }}
          aria-label={compact ? "编辑当前文档" : undefined}
          title={compact ? "编辑当前文档" : undefined}
        >
          {compact ? <Pencil size={17} aria-hidden="true" /> : "编辑"}
        </button>
      </>
    );
  };

  const mobileActions = activeItem?.type === "course"
    ? editingCourseItemId === activeItem.id
      ? (
          <>
            <button
              type="button"
              className="mobile-reader-action-button"
              onClick={() => props.onSaveEditedCourse(group, activeItem)}
              disabled={!activeItem.dirty}
              aria-label="保存当前文档"
              title="保存"
            ><Save size={18} aria-hidden="true" /></button>
            <button
              type="button"
              className="mobile-reader-action-button"
              onClick={() => props.onCancelEditedCourse(group, activeItem)}
              aria-label="取消编辑"
              title="取消编辑"
            ><X size={18} aria-hidden="true" /></button>
          </>
        )
      : markdownActions(true)
    : activeItem?.type === "qa"
      ? (
          <>
            {projectId && activeItem.qaRecordId ? (
              <TeachingRationale projectId={projectId} qaRecordId={activeItem.qaRecordId} onChanged={props.onPersonalizationChanged} compact />
            ) : null}
            <button
              type="button"
              className={`mobile-reader-action-button ${activeItem.favorite ? "active" : ""}`}
              onClick={() => props.onToggleFavorite(activeItem)}
              aria-label={activeItem.favorite ? "取消收藏" : "收藏当前回答"}
              aria-pressed={Boolean(activeItem.favorite)}
              title={activeItem.favorite ? "取消收藏" : "收藏"}
            ><Star size={18} className={activeItem.favorite ? "starred" : ""} aria-hidden="true" /></button>
            <button
              type="button"
              className="mobile-reader-action-button"
              onClick={() => {
                if (props.qaHighlightDraft) props.onCreateHighlight("qa", props.qaHighlightDraft.sourcePath, props.qaHighlightDraft.selectedText);
              }}
              disabled={!props.qaHighlightDraft || props.qaHighlightDraft.sourcePath !== activeItem.path}
              aria-label="标记选中的回答内容"
              title="标记选中内容"
            ><Pencil size={17} aria-hidden="true" /></button>
            <button
              type="button"
              className="mobile-reader-action-button"
              onClick={() => props.onSaveQA(group.id, activeItem)}
              disabled={!activeItem.dirty}
              aria-label="保存当前回答"
              title="保存"
            ><Save size={18} aria-hidden="true" /></button>
          </>
        )
      : undefined;

  return (
    <EditorPaneFrame
      group={group}
      active={activeGroupId === group.id}
      mobile={mobile}
      mobileLesson={activeItem?.type === "course" && lessonIndex >= 0 && editingCourseItemId !== activeItem.id ? {
        index: lessonIndex,
        total: lessons.length,
        completed: learningState?.status === "completed",
        onPrevious: lessonIndex > 0 ? () => props.onOpenCourse(lessons[lessonIndex - 1].filename) : undefined,
        onNext: lessonIndex < lessons.length - 1 ? () => props.onOpenCourse(lessons[lessonIndex + 1].filename) : undefined,
        onToggleComplete: () => props.onToggleLessonComplete(activeItem.path),
      } : undefined}
      mobileLanguage={activeItem?.type === "file" ? activeItem.language ?? "plaintext" : undefined}
      mobileActions={mobileActions}
      onMobileSearch={activeItem?.type === "file" ? props.onMobileCodeSearch : undefined}
      workspaceMenuOpen={props.workspaceMenuOpen}
      canUndoLayout={props.canUndoLayout}
      canManageGroups={props.canManageGroups}
      onActivatePane={props.onActivatePane}
      onActivateItem={props.onActivateItem}
      onCloseItem={props.onCloseItem}
      onTabDragEnd={props.onTabDragEnd}
      onToggleWorkspaceMenu={props.onToggleWorkspaceMenu}
      onUndoLayout={props.onUndoLayout}
      onEqualize={props.onEqualize}
      onMergeGroups={props.onMergeGroups}
      onCloseGroup={props.onCloseGroup}
      onDragOver={props.onDragOver}
      onDragLeave={props.onDragLeave}
      onDrop={props.onDrop}
    >
      {editorMountDeferred || activeItemLoading ? <div className="viewer-loading deferred-editor-loading">正在准备工作区…</div> : null}
      {!mobile && activeItem?.type === "course" && lessonIndex >= 0 ? (
        <ReaderLearningToolbar
          title={activeItem.title}
          index={lessonIndex}
          total={lessons.length}
          completed={learningState?.status === "completed"}
          onPrevious={lessonIndex > 0 ? () => props.onOpenCourse(lessons[lessonIndex - 1].filename) : undefined}
          onNext={lessonIndex < lessons.length - 1 ? () => props.onOpenCourse(lessons[lessonIndex + 1].filename) : undefined}
          onToggleComplete={() => props.onToggleLessonComplete(activeItem.path)}
        />
      ) : null}

      {!editorMountDeferred && !activeItemLoading && activeItem?.type === "file" ? (
        <CodeViewer
          key={activeItem.id}
          path={activeItem.path}
          language={activeItem.language ?? "plaintext"}
          content={activeItem.content}
          selectedRange={!mobile && selectionAnchor?.sourceType === "file" && selectionAnchor.sourcePath === activeItem.path
            ? selectionAnchor.range ?? null
            : null}
          onSelectionChange={props.onSelectionChange}
          restoreLine={activeItem.restoreLine ?? 1}
          jumpRequest={activeItem.jumpRequest}
          onJumpConsumed={(requestId) => props.onCodeJumpConsumed(activeItem.id, requestId)}
          onVisibleLineChange={(line) => props.onLearningPosition("file", activeItem.path, "line", line)}
          mobileSearchRequestId={mobile ? props.mobileCodeSearchRequestId : undefined}
        />
      ) : null}

      {!editorMountDeferred && !activeItemLoading && activeItem?.type === "course" ? (
        editingCourseItemId === activeItem.id ? (
          <div className="viewer qa-editor-view">
            {!mobile ? (
              <div className="viewer-header">
                <span>{activeItem.title} - 编辑 Markdown</span>
                <div className="viewer-actions">
                  <button className="secondary-button compact" onClick={() => props.onSaveEditedCourse(group, activeItem)}><Save size={14} />保存</button>
                  <button className="secondary-button compact" onClick={() => props.onCancelEditedCourse(group, activeItem)}>取消</button>
                </div>
              </div>
            ) : null}
            <textarea
              className="qa-workspace-editor"
              value={activeItem.content}
              onChange={(event) => props.onUpdateItemContent(group.id, activeItem.id, event.target.value)}
            />
          </div>
        ) : (
          <MarkdownViewer
            key={`${activeItem.qaRecordId ? "qa" : "course"}:${activeItem.id}`}
            title={activeItem.title}
            sourcePath={activeItem.path}
            sourceType={activeItem.qaRecordId ? "qa" : "course"}
            content={activeItem.content}
            embedded={mobile}
            termSourceKey={props.activeTermSourceKey}
            highlights={highlights.filter((highlight) => (
              highlight.source_type === (activeItem.qaRecordId ? "qa" : "course")
              && highlight.source_path === activeItem.path
            ))}
            knowledgeLinks={knowledgeLinks.filter((link) => link.source_type === "course" && link.source_path === activeItem.path)}
            documentTerms={documentTerms}
            visibleTermCandidateIds={visibleTermCandidateIds}
            termDisplayTiers={termDisplayTiers}
            tempSelectedText={!mobile
              && selectionAnchor?.sourceType === (activeItem.qaRecordId ? "qa" : "course")
              && selectionAnchor.sourcePath === activeItem.path
              ? selectionAnchor.selectedText
              : null}
            onSelectionChange={props.onSelectionChange}
            onOpenKnowledgeLink={props.onOpenKnowledgeLink}
            onOpenQAReference={props.onOpenQAReference}
            onGenerateTerm={props.onGenerateTerm}
            onTermAction={props.onTermAction}
            onGenerateLesson={props.isOutlineCourse(activeItem.path) ? props.onGenerateLesson : undefined}
            immersiveReading={mobile && activeGroupId === group.id}
            initialScrollRatio={learningState?.position_kind === "scroll_ratio" ? learningState.position_value : 0}
            onScrollRatioChange={(ratio) => props.onLearningPosition(
              activeItem.qaRecordId ? "qa" : "course",
              activeItem.path,
              "scroll_ratio",
              ratio,
            )}
            headerActions={mobile ? undefined : markdownActions(false)}
          />
        )
      ) : null}

      {!editorMountDeferred && !activeItemLoading && activeItem?.type === "qa" ? (
        <div className="viewer qa-editor-view">
          {!mobile ? (
            <div className="viewer-header">
              <span>{activeItem.dirty ? `${activeItem.title} *` : activeItem.title}</span>
              <div className="viewer-actions">
                {projectId && activeItem.qaRecordId ? (
                  <TeachingRationale projectId={projectId} qaRecordId={activeItem.qaRecordId} onChanged={props.onPersonalizationChanged} />
                ) : null}
                <button className="icon-button" onClick={() => props.onToggleFavorite(activeItem)} title="收藏/取消收藏">
                  <Star size={14} className={activeItem.favorite ? "starred" : ""} />
                </button>
                <button
                  className="secondary-button compact"
                  onClick={() => {
                    if (props.qaHighlightDraft) props.onCreateHighlight("qa", props.qaHighlightDraft.sourcePath, props.qaHighlightDraft.selectedText);
                  }}
                  disabled={!props.qaHighlightDraft || props.qaHighlightDraft.sourcePath !== activeItem.path}
                >标记</button>
                <button className="secondary-button compact" onClick={() => props.onSaveQA(group.id, activeItem)} disabled={!activeItem.dirty}>
                  <Save size={14} />保存
                </button>
              </div>
            </div>
          ) : null}
          <textarea
            className="qa-workspace-editor"
            value={activeItem.content}
            onChange={(event) => props.onUpdateItemContent(group.id, activeItem.id, event.target.value)}
            onSelect={(event) => {
              const target = event.currentTarget;
              const text = target.value.slice(target.selectionStart, target.selectionEnd).trim();
              props.onQASelectionChange(activeItem, text || null);
            }}
          />
          {qaHighlights.length ? (
            <div className="qa-highlight-list">
              {qaHighlights.map((highlight) => (
                <mark key={highlight.id} className="reader-highlight" style={{ backgroundColor: highlight.color }}>
                  {highlight.selected_text}
                </mark>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {CallGuideViewer && !mobile && !editorMountDeferred && !activeItemLoading && activeItem?.type === "call_guide" ? (() => {
        const guide = props.callGuides.find((entry) => entry.id === activeItem.callGuideId);
        if (!guide) return <div className="viewer-loading">正在恢复调用链导览…</div>;
        return (
          <Suspense fallback={<div className="viewer-loading">正在加载调用链导览…</div>}>
            <CallGuideViewer
              guide={guide}
              busy={props.callGuideBusyId === guide.id}
              onSelectNode={(nodeId, visitedNodeIds) => props.onCallGuideSelection(guide, nodeId, visitedNodeIds)}
              onOpenSource={props.onOpenCallGuideSource}
              onExplain={(node, routeNodeIds) => props.onExplainCallGuide(guide, node, routeNodeIds)}
              onRefresh={() => props.onRefreshCallGuide(guide)}
              onDelete={() => props.onDeleteCallGuide(guide)}
            />
          </Suspense>
        );
      })() : null}

      {!activeItem ? <div className="empty-state">点击或拖拽文件/课件到这里阅读</div> : null}

      {!editorMountDeferred && !activeItemLoading && activeItem?.type === "knowledge_graph" && projectId ? (
        <Suspense fallback={<div className="viewer-loading">正在加载知识网络…</div>}>
          <KnowledgeGraphViewer
            projectId={projectId}
            refreshKey={props.knowledgeRefreshKey}
            focusRef={props.knowledgeFocusRef}
            onRequestText={props.onRequestText}
            onConfirm={props.onConfirm}
            onContentChanged={props.onKnowledgeContentChanged}
            onGraphChanged={props.onKnowledgeGraphChanged}
            onOpenQA={props.onOpenKnowledgeQA}
            onOpenCourse={props.onOpenKnowledgeCourse}
            onOpenFile={props.onOpenKnowledgeFile}
          />
        </Suspense>
      ) : null}
    </EditorPaneFrame>
  );
}

function sameKnowledgeFocus(previous: KnowledgeFocusRef, next: KnowledgeFocusRef) {
  if (previous === next) return true;
  if (!previous || !next) return false;
  return previous.ref_type === next.ref_type
    && previous.ref_path === next.ref_path
    && previous.ref_id === next.ref_id;
}

function sameViewProps(previous: Props, next: Props) {
  const previousKeys = Object.keys(previous) as Array<keyof Props>;
  const nextKeys = Object.keys(next) as Array<keyof Props>;
  if (previousKeys.length !== nextKeys.length) return false;
  for (const key of previousKeys) {
    if (key === "knowledgeFocusRef") {
      if (!sameKnowledgeFocus(previous.knowledgeFocusRef, next.knowledgeFocusRef)) return false;
    } else if (!Object.is(previous[key], next[key])) {
      return false;
    }
  }
  return true;
}

const MemoizedWorkbenchEditorGroupView = memo(WorkbenchEditorGroupView, sameViewProps);

/**
 * App owns the workbench actions and necessarily recreates a number of small
 * closures when shell state changes (for example when a mobile drawer opens).
 * Keep those actions fresh through a ref, while presenting stable callback
 * identities to the expensive reader subtree. Data props still use normal
 * identity checks, so document, learning, term and graph changes render at
 * once without making drawer-only state repaint the reader.
 */
export default function WorkbenchEditorGroup(props: Props) {
  const latestPropsRef = useRef(props);
  latestPropsRef.current = props;

  const stableCallbacks = useMemo(() => {
    const callbacks: Partial<Props> = {};
    for (const key of Object.keys(latestPropsRef.current) as Array<keyof Props>) {
      if (typeof latestPropsRef.current[key] !== "function") continue;
      (callbacks as Record<string, unknown>)[String(key)] = (...args: unknown[]) => {
        const callback = latestPropsRef.current[key];
        if (typeof callback !== "function") return undefined;
        return (callback as (...parameters: unknown[]) => unknown)(...args);
      };
    }
    return callbacks;
  }, []);

  return <MemoizedWorkbenchEditorGroupView {...props} {...stableCallbacks} />;
}
