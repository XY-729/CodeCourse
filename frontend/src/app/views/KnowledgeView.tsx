import { lazy, Suspense } from "react";
import type { AppViewModel } from "./appViewModel";

const KnowledgeGraphViewer = lazy(() => import("../../features/knowledge/KnowledgeGraphViewer"));

export function renderKnowledgeGraph(model: AppViewModel) {
  const {
    project,
    getActiveOpenItem,
    selectedQA,
    knowledgeRefreshKey,
    requestText,
    confirmAction,
    refreshCourses,
    refreshQAHistory,
    setKnowledgeRefreshKey,
    openQAById,
    setError,
    openCourseInActiveGroup,
    openFileInActiveGroup,
  } = model;

  if (!project) return <div className="empty small">请选择项目后查看知识网络</div>;
  const activeItem = getActiveOpenItem();
  const focusRef = activeItem
    ? activeItem.qaRecordId ? { ref_type: "qa" as const, ref_id: activeItem.qaRecordId }
      : activeItem.type === "course" ? { ref_type: "course" as const, ref_path: activeItem.path }
        : activeItem.type === "file" ? { ref_type: "file" as const, ref_path: activeItem.path }
          : null
    : selectedQA ? { ref_type: "qa" as const, ref_id: selectedQA.id }
      : null;
  return (
    <Suspense fallback={<div className="viewer-loading">正在加载知识网络…</div>}>
      <KnowledgeGraphViewer
        projectId={project.id} refreshKey={knowledgeRefreshKey} compact focusRef={focusRef}
        onRequestText={requestText} onConfirm={confirmAction}
        onContentChanged={async () => { await refreshCourses(project.id); await refreshQAHistory(project.id); }}
        onGraphChanged={() => { setKnowledgeRefreshKey((value) => value + 1); }}
        onOpenQA={(qaId) => { void openQAById(qaId).catch((caught) => { setError(caught instanceof Error ? caught.message : "打开回答失败"); }); }}
        onOpenCourse={(path) => { void openCourseInActiveGroup(project.id, path).catch((caught) => { setError(caught instanceof Error ? caught.message : "打开课件失败"); }); }}
        onOpenFile={(path) => { void openFileInActiveGroup(project.id, path).catch((caught) => { setError(caught instanceof Error ? caught.message : "打开文件失败"); }); }}
      />
    </Suspense>
  );

}
