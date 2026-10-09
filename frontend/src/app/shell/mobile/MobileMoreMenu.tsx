import { BrainCircuit, Download, FileArchive, Sparkles } from "lucide-react";

type Props = {
  open: boolean;
  projectAvailable: boolean;
  generationLabel: string;
  onGenerate: () => void;
  onOpenKnowledge: () => void;
  onImportRepository: () => void;
  onImportArchive: () => void;
  onClose: () => void;
};

export default function MobileMoreMenu(props: Props) {
  if (!props.open) return null;

  return (
    <div className="more-menu-layer" onMouseDown={props.onClose}>
      <div className="more-menu topbar-more-menu" role="menu" onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" role="menuitem" disabled={!props.projectAvailable} onClick={props.onGenerate}>
          <Sparkles size={15} />
          {props.generationLabel}
        </button>
        <button type="button" role="menuitem" disabled={!props.projectAvailable} onClick={props.onOpenKnowledge}>
          <BrainCircuit size={15} />
          知识网络
        </button>
        <div className="more-menu-divider" />
        <button type="button" role="menuitem" onClick={props.onImportRepository}>
          <Download size={15} />
          导入 GitHub 仓库
        </button>
        <button type="button" role="menuitem" onClick={props.onImportArchive}>
          <FileArchive size={15} />
          导入本地 ZIP
        </button>
      </div>
    </div>
  );
}
