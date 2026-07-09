import { BookOpen } from "lucide-react";
import type { CourseFile } from "../api/client";

type Props = {
  files: CourseFile[];
  selected: string | null;
  onSelect: (filename: string) => void;
  onDragItem?: (kind: "course", filename: string) => void;
};

export default function CourseList({ files, selected, onSelect, onDragItem }: Props) {
  return (
    <div className="course-list">
      {files.map((file) => (
        <button
          key={file.filename}
          className={`course-row ${selected === file.filename ? "selected" : ""}`}
          onClick={() => onSelect(file.filename)}
          title={`${file.filename} - 可拖拽到中间工作区`}
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData("application/codecourse-item", JSON.stringify({ kind: "course", filename: file.filename }));
            event.dataTransfer.effectAllowed = "copy";
            onDragItem?.("course", file.filename);
          }}
        >
          <BookOpen size={14} />
          <span>{file.title}</span>
        </button>
      ))}
    </div>
  );
}
