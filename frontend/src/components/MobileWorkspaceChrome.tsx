import { forwardRef, type ReactNode } from "react";
import { Plus } from "lucide-react";
import MobileBottomNavigation, { type MobilePrimaryDestination } from "./MobileBottomNavigation";
import MobileWorkspaceSheet, { type MobileWorkspaceSheetHandle } from "./MobileWorkspaceSheet";
import TaskFeedback from "./TaskFeedback";

export type MobileWorkspaceTab = "projects" | "courses" | "files" | "assistant" | "me" | "generation";
export type { MobilePrimaryDestination, MobileWorkspaceSheetHandle };

type Props = {
  activeDestination: MobilePrimaryDestination;
  tab: MobileWorkspaceTab | null;
  projectAvailable: boolean;
  coursesAvailable: boolean;
  error: string;
  busy: boolean;
  busyLabel: string;
  progressCurrent?: number;
  progressTotal?: number;
  toast: string;
  preloadContent: (tab: MobileWorkspaceTab) => void;
  renderContent: (tab: MobileWorkspaceTab) => ReactNode;
  onLearn: () => void;
  onSource: () => void;
  onAsk: () => void;
  onMe: () => void;
  onCreateLearningPlan: () => void;
  onCreateCourse: () => void;
  onDismissError: () => void;
  onMotionPhaseChange: (phase: "entering" | "open" | "exiting") => void;
  onDismiss: () => void;
};

const TITLES: Record<MobileWorkspaceTab, string> = {
  projects: "项目",
  courses: "课程",
  files: "源码",
  assistant: "AI 助手",
  me: "我的",
  generation: "生成中心",
};

const MobileWorkspaceChrome = forwardRef<MobileWorkspaceSheetHandle, Props>(function MobileWorkspaceChrome(props, ref) {
  const tab = props.tab;
  return (
    <>
      <MobileBottomNavigation
        active={props.activeDestination}
        onLearn={props.onLearn}
        onSource={props.onSource}
        onAsk={props.onAsk}
        onMe={props.onMe}
      />
      {tab ? (
        <MobileWorkspaceSheet
          ref={ref}
          tabKey={tab}
          variant={tab === "assistant" ? "assistant" : tab === "me" ? "me" : tab === "generation" ? "generation" : "standard"}
          title={TITLES[tab]}
          action={tab === "projects" ? (
            <button className="icon-button" type="button" onClick={props.onCreateLearningPlan} aria-label="新建学习计划" title="新建学习计划">
              <Plus size={17} />
            </button>
          ) : tab === "courses" && props.coursesAvailable ? (
            <button className="icon-button" type="button" onClick={props.onCreateCourse} disabled={!props.projectAvailable} aria-label="新建文档" title="新建文档">
              <Plus size={17} />
            </button>
          ) : undefined}
          feedback={props.error || props.busy || props.toast ? (
            <TaskFeedback
              inline
              error={props.error}
              busy={props.busy}
              label={props.busyLabel}
              progressCurrent={props.progressCurrent}
              progressTotal={props.progressTotal}
              toast={props.toast}
              onDismissError={props.onDismissError}
            />
          ) : undefined}
          preloadContent={() => props.preloadContent(tab)}
          renderContent={() => props.renderContent(tab)}
          onMotionPhaseChange={props.onMotionPhaseChange}
          onDismiss={props.onDismiss}
        />
      ) : null}
    </>
  );
});

export default MobileWorkspaceChrome;
