import { BookOpen, ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { useState } from "react";
import type { CourseFile } from "../api/client";

type Props = {
  files: CourseFile[];
  selected: string | null;
  onSelect: (filename: string) => void;
  onDragItem?: (kind: "course", filename: string) => void;
  onDelete?: (file: CourseFile) => void;
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

export default function CourseList({ files, selected, onSelect, onDragItem, onDelete }: Props) {
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
            groupFiles.map((file) => (
              <div key={file.filename} className="course-row-wrapper">
                <button
                  className={`course-row ${selected === file.filename ? "selected" : ""}`}
                  onClick={() => onSelect(file.filename)}
                  title={`${file.filename} - 可拖拽到中间工作区`}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData(
                      "application/codecourse-item",
                      JSON.stringify({ kind: "course", filename: file.filename }),
                    );
                    event.dataTransfer.effectAllowed = "copy";
                    onDragItem?.("course", file.filename);
                  }}
                >
                  <BookOpen size={14} />
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
            ))}
        </div>
      ))}
    </div>
  );
}
