import { useMemo, useRef } from "react";
import type { CallGuide, CourseFile, Project, QARecord } from "../api/client";
import type { CommandPaletteItem } from "../components/CommandPalette";

type SourceFile = { name: string; path: string };

type Actions = {
  createCallGuide: () => void;
  openAssistant: () => void;
  openGeneration: () => void;
  openCourses: () => void;
  openFiles: () => void;
  openSettings: () => void;
  openPrompts: () => void;
  buildIndex: () => void;
  resetProgress: () => void;
  checkUpdates: () => void;
  openDiagnostics: () => void;
  openCourse: (course: CourseFile) => void;
  openFile: (file: SourceFile) => void;
  openQA: (record: QARecord) => void;
  openCallGuide: (guide: CallGuide) => void;
  deleteCallGuide: (guide: CallGuide) => void;
  openProject: (project: Project) => void;
};

type Options = {
  open: boolean;
  mobile: boolean;
  projectAvailable: boolean;
  learningPlan: boolean;
  hasLearningProgress: boolean;
  version: string;
  courses: CourseFile[];
  files: SourceFile[];
  qaHistory: QARecord[];
  callGuides: CallGuide[];
  projects: Project[];
  actions: Actions;
};

const EMPTY_ITEMS: CommandPaletteItem[] = [];

function qaTitle(record: QARecord) {
  return record.display_title?.trim() || `回答 #${record.id}`;
}

export function useCommandPaletteItems(options: Options) {
  const actionsRef = useRef(options.actions);
  actionsRef.current = options.actions;

  return useMemo(() => {
    if (!options.open) return EMPTY_ITEMS;
    const run = () => actionsRef.current;
    const items: CommandPaletteItem[] = [
      {
        id: "command:call-guide",
        label: "创建调用链学习导览",
        description: "输入函数或方法名，查看两跳真实调用路径",
        section: "命令",
        keywords: "调用链 call graph 函数 方法 上游 下游",
        disabled: !options.projectAvailable || options.mobile || options.learningPlan,
        disabledReason: !options.projectAvailable ? "需要先打开项目" : options.learningPlan ? "学习计划没有结构索引" : "桌面端功能",
        run: () => run().createCallGuide(),
      },
      { id: "command:assistant", label: "打开 AI 助手", description: "结合当前项目或文档提问", section: "命令", keywords: "ai 问答 提问", run: () => run().openAssistant() },
      { id: "command:generate", label: "生成学习内容", description: "打开总纲与课件生成抽屉", section: "命令", keywords: "生成 总纲 课件", disabled: !options.projectAvailable, disabledReason: !options.projectAvailable ? "需要先打开项目" : undefined, run: () => run().openGeneration() },
      { id: "command:courses", label: "打开课程导航", section: "命令", keywords: "课程 左栏", run: () => run().openCourses() },
      { id: "command:files", label: "打开源码导航", section: "命令", keywords: "文件 源码", run: () => run().openFiles() },
      { id: "command:settings", label: "设置", section: "命令", keywords: "deepseek key 模型 个性化 术语 隐私", run: () => run().openSettings() },
      { id: "command:prompts", label: "提示词编辑", section: "命令", keywords: "prompt 模板", run: () => run().openPrompts() },
      { id: "command:index", label: "构建项目索引", section: "命令", keywords: "rag 搜索 索引", disabled: !options.projectAvailable || options.learningPlan, disabledReason: !options.projectAvailable ? "需要先打开项目" : options.learningPlan ? "学习计划项目无需构建索引" : undefined, run: () => run().buildIndex() },
      { id: "command:reset-progress", label: "重置学习进度", section: "命令", keywords: "清除 完成 阅读位置", disabled: !options.projectAvailable || !options.hasLearningProgress, disabledReason: !options.projectAvailable ? "需要先打开项目" : "没有学习进度可重置", run: () => run().resetProgress() },
      { id: "command:check-updates", label: "检查更新", description: `当前版本 ${options.version}`, section: "命令", keywords: "版本 release 升级", run: () => run().checkUpdates() },
      { id: "command:diagnostics", label: options.mobile ? "复制诊断摘要" : "打开诊断日志", section: "命令", keywords: "日志 错误 排查", run: () => run().openDiagnostics() },
    ];

    options.courses.forEach((course) => items.push({
      id: `course:${course.filename}`,
      label: course.title,
      description: course.filename,
      section: "课程",
      keywords: course.filename,
      disabled: !options.projectAvailable,
      disabledReason: !options.projectAvailable ? "需要先打开项目" : undefined,
      run: () => run().openCourse(course),
    }));
    options.files.forEach((file) => items.push({
      id: `file:${file.path}`,
      label: file.name,
      description: file.path,
      section: "源码",
      keywords: file.path,
      run: () => run().openFile(file),
    }));
    options.qaHistory.forEach((record) => items.push({
      id: `qa:${record.id}`,
      label: qaTitle(record),
      description: record.question,
      section: "回答",
      keywords: `${record.source_path ?? ""} ${record.answer_md.slice(0, 160)}`,
      run: () => run().openQA(record),
    }));
    options.callGuides.forEach((guide) => {
      items.push({
        id: `call-guide:${guide.id}`,
        label: guide.title,
        description: guide.stale ? "索引已变化，打开后可刷新" : `${guide.nodes.length} 个符号 · ${guide.edges.length} 条已验证调用`,
        section: "最近导览",
        keywords: `${guide.root.symbol_name} ${guide.root.qualified_name ?? ""} ${guide.root.path}`,
        run: () => run().openCallGuide(guide),
      });
      items.push({
        id: `call-guide-delete:${guide.id}`,
        label: `删除 ${guide.title}`,
        description: "仅删除保存的导览",
        section: "最近导览",
        keywords: `删除 调用链 ${guide.root.symbol_name}`,
        run: () => run().deleteCallGuide(guide),
      });
    });
    options.projects.forEach((project) => items.push({
      id: `project:${project.id}`,
      label: project.name,
      description: project.project_type === "learning_plan" ? "学习计划" : project.url,
      section: "项目",
      keywords: project.url,
      run: () => run().openProject(project),
    }));
    return items;
  }, [
    options.callGuides,
    options.courses,
    options.files,
    options.hasLearningProgress,
    options.learningPlan,
    options.mobile,
    options.open,
    options.projectAvailable,
    options.projects,
    options.qaHistory,
    options.version,
  ]);
}
