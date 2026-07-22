import { BookOpen, Check, ChevronDown, ChevronRight, Circle, Trash2 } from "lucide-react";
import { useState, type CSSProperties } from "react";
import type { CourseFile, LearningState } from "../api/client";
import { setCodeCourseDragImage } from "../utils/dragImage";

type Props = {
  files: CourseFile[];
  selected: string | null;
  onSelect: (filename: string) => void;
  onDragItem?: (kind: "course", filename: string) => void;
  onDelete?: (file: CourseFile) => void;
  learningStates?: LearningState[];
};

function groupFiles(files: CourseFile[]): Map<string, CourseFile[]> {
  const map = new Map<string, CourseFile[]>();
  for (const file of files) {
    const group = file.group || "其他";
    if (!map.has(group)) {
      map.set(group, []);
    }
    map.get(group)!.push(file);
  }
  return map;
}

export default function CourseList({ files, selected, onSelect, onDragItem, onDelete, learningStates = [] }: Props) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const groups = groupFiles(files);

  function toggleGroup(group: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  }

  return (
    <div className="course-list">
      {Array.from(groups.entries()).map(([group, groupFiles]) => (
        <div key={group} className="course-group">
          <button className="course-group-header" onClick={() => toggleGroup(group)}>
            {collapsedGroups.has(group) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            <span>{group}</span>
            <small>({groupFiles.length})</small>
          </button>
          {!collapsedGroups.has(group) &&
            groupFiles.map((file, index) => {
              const state = learningStates.find((entry) => entry.source_type === "course" && entry.source_path === file.filename);
              const lesson = /^lessons\/lesson_\d+\.md$/i.test(file.filename);
              const stateClass = state?.status === "completed" ? "completed" : state ? "in-progress" : "not-started";
              return (
              <div key={file.filename} className={`course-row-wrapper ${lesson ? `lesson ${stateClass}` : "reference"}`} style={{ "--course-order": Math.min(index, 8) } as CSSProperties}>
                <button
                  className={`course-row ${selected === file.filename ? "selected" : ""} ${lesson ? stateClass : ""}`}
                  onClick={() => onSelect(file.filename)}
                  title={`${file.filename} - 可拖拽到中间工作区`}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData(
                      "application/codecourse-item",
                      JSON.stringify({ kind: "course", filename: file.filename }),
                    );
                    event.dataTransfer.effectAllowed = "copy";
                    setCodeCourseDragImage(event.dataTransfer, file.title);
                    onDragItem?.("course", file.filename);
                  }}
                >
                  {lesson ? (
                    state?.status === "completed" ? <Check className="course-state completed" size={14} /> : state ? <Circle className="course-state in-progress" size={11} /> : <Circle className="course-state" size={11} />
                  ) : <BookOpen size={14} />}
                  <span>{file.title}</span>
                </button>
                {onDelete ? (
                  <button
                    className="icon-button danger compact"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(file);
                    }}
                    title="删除此课件"
                  >
                    <Trash2 size={12} />
                  </button>
                ) : null}
              </div>
              );
            })}
        </div>
      ))}
    </div>
  );
}
