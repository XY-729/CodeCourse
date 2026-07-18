import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";

export type CommandPaletteItem = {
  id: string;
  label: string;
  description?: string;
  section: string;
  keywords?: string;
  shortcut?: string;
  run: () => void;
};

type Props = {
  open: boolean;
  items: CommandPaletteItem[];
  onClose: () => void;
};

function score(item: CommandPaletteItem, query: string): number {
  if (!query) return 1;
  const haystack = `${item.label} ${item.description ?? ""} ${item.keywords ?? ""}`.toLowerCase();
  const needle = query.toLowerCase().trim();
  if (haystack.startsWith(needle)) return 100;
  if (item.label.toLowerCase().includes(needle)) return 70;
  if (haystack.includes(needle)) return 40;
  const words = needle.split(/\s+/).filter(Boolean);
  return words.every((word) => haystack.includes(word)) ? 20 : 0;
}

export default function CommandPalette({ open, items, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [present, setPresent] = useState(open);
  const [visible, setVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const filtered = useMemo(
    () => items.map((item) => ({ item, score: score(item, query) })).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score).slice(0, 60),
    [items, query],
  );

  useEffect(() => {
    let frame = 0;
    let timer = 0;
    if (open) {
      setPresent(true);
      setQuery("");
      setActiveIndex(0);
      frame = window.requestAnimationFrame(() => setVisible(true));
      timer = window.setTimeout(() => inputRef.current?.focus(), 40);
    } else if (present) {
      setVisible(false);
      timer = window.setTimeout(() => setPresent(false), 190);
    }
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [open, present]);

  useEffect(() => setActiveIndex(0), [query]);

  if (!present) return null;

  function run(item: CommandPaletteItem) {
    onClose();
    item.run();
  }

  return (
    <div className={`command-palette-layer ${visible ? "is-open" : "is-closing"}`} onMouseDown={onClose}>
      <section className="command-palette" role="dialog" aria-modal="true" aria-label="命令面板" onMouseDown={(event) => event.stopPropagation()}>
        <div className="command-palette-search">
          <Search size={17} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索课程、源码、回答或命令"
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((index) => Math.min(filtered.length - 1, index + 1));
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((index) => Math.max(0, index - 1));
              }
              if (event.key === "Enter" && filtered[activeIndex]) {
                event.preventDefault();
                run(filtered[activeIndex].item);
              }
            }}
          />
          <button className="command-palette-close" type="button" onClick={onClose} title="关闭搜索" aria-label="关闭搜索">
            <X size={17} />
          </button>
        </div>
        <div className="command-palette-results" role="listbox">
          {filtered.map(({ item }, index) => (
            <button
              key={item.id}
              className={index === activeIndex ? "active" : ""}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => run(item)}
              role="option"
              aria-selected={index === activeIndex}
            >
              <span className="command-section">{item.section}</span>
              <span className="command-copy"><strong>{item.label}</strong>{item.description ? <small>{item.description}</small> : null}</span>
              {item.shortcut ? <kbd>{item.shortcut}</kbd> : null}
            </button>
          ))}
          {!filtered.length ? <div className="command-empty">没有匹配项</div> : null}
        </div>
      </section>
    </div>
  );
}
