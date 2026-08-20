import { getCourseContent, getProjectFile } from "../api/client";
import type { CourseFile, FileContent, LearningState, QARecord } from "../api/client";
import { normalizeOutputPath, pickDefaultCourse, qaTitle } from "../app/appUtils";
import type { OpenItem } from "../workbench/layout";

type Loaders = {
  loadFile: typeof getProjectFile;
  loadCourse: typeof getCourseContent;
};

type Options = {
  projectId: number;
  courses: CourseFile[];
  learningStates: LearningState[];
  qaRecords: QARecord[] | Promise<QARecord[]>;
  loaders?: Partial<Loaders>;
};

export type RecentProjectDocument = {
  item: OpenItem | null;
  fileContent: FileContent | null;
  selectedCourse: string | null;
  selectedQA: QARecord | null;
  qaSessionId: number | null;
  termSource: { sourceType: "course" | "qa"; sourcePath: string } | null;
  source: "recent-qa" | "recent-file" | "default-course" | "empty";
};

export async function resolveRecentProjectDocument(options: Options): Promise<RecentProjectDocument> {
  const loadFile = options.loaders?.loadFile ?? getProjectFile;
  const loadCourse = options.loaders?.loadCourse ?? getCourseContent;
  const recent = [...options.learningStates].sort((a, b) => b.last_opened_at.localeCompare(a.last_opened_at))[0];
  const recentCourse = recent?.source_type === "course"
    ? options.courses.find((file) => file.filename === recent.source_path)
    : null;
  const firstCourse = pickDefaultCourse(options.courses, recentCourse);

  if (recent?.source_type === "qa") {
    const qaRecords = await options.qaRecords;
    const record = qaRecords.find((entry) => (
      normalizeOutputPath(entry.output_path, entry.id, options.projectId) === recent.source_path
    ));
    if (record) {
      const path = normalizeOutputPath(record.output_path, record.id, options.projectId);
      const course = await loadCourse(options.projectId, path).catch(() => null);
      return {
        item: course ? {
          id: `course:${path}`,
          type: "course",
          path,
          title: qaTitle(record),
          content: course.content,
          qaRecordId: record.id,
          favorite: record.favorite,
        } : {
          id: `qa:${record.id}`,
          type: "qa",
          path,
          title: qaTitle(record),
          content: record.answer_md,
          qaRecordId: record.id,
          favorite: record.favorite,
        },
        fileContent: null,
        selectedCourse: null,
        selectedQA: record,
        qaSessionId: record.session_id ?? null,
        termSource: { sourceType: "qa", sourcePath: path },
        source: "recent-qa",
      };
    }
  }

  if (recent?.source_type === "file") {
    try {
      const content = await loadFile(options.projectId, recent.source_path);
      return {
        item: {
          id: `file:${recent.source_path}`,
          type: "file",
          path: recent.source_path,
          title: recent.source_path.split("/").pop() ?? recent.source_path,
          content: content.content,
          language: content.language,
        },
        fileContent: content,
        selectedCourse: null,
        selectedQA: null,
        qaSessionId: null,
        termSource: null,
        source: "recent-file",
      };
    } catch {
      // Removed files fall through to the nearest valid course.
    }
  }

  if (firstCourse) {
    const content = await loadCourse(options.projectId, firstCourse.filename);
    return {
      item: {
        id: `course:${firstCourse.filename}`,
        type: "course",
        path: firstCourse.filename,
        title: firstCourse.title,
        content: content.content,
      },
      fileContent: null,
      selectedCourse: firstCourse.filename,
      selectedQA: null,
      qaSessionId: null,
      termSource: { sourceType: "course", sourcePath: firstCourse.filename },
      source: "default-course",
    };
  }

  return {
    item: null,
    fileContent: null,
    selectedCourse: null,
    selectedQA: null,
    qaSessionId: null,
    termSource: null,
    source: "empty",
  };
}
