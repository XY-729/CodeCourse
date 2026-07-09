import { BookOpen } from "lucide-react";
import type { CourseFile } from "../api/client";

type Props = {
  files: CourseFile[];
  selected: string | null;
  onSelect: (filename: string) => void;
};

export default function CourseList({ files, selected, onSelect }: Props) {
  return (
    <div className="course-list">
      {files.map((file) => (
        <button
          key={file.filename}
          className={`course-row ${selected === file.filename ? "selected" : ""}`}
          onClick={() => onSelect(file.filename)}
          title={file.filename}
        >
          <BookOpen size={14} />
          <span>{file.title}</span>
        </button>
      ))}
    </div>
  );
}
