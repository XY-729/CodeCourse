import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";

export type CommandPaletteItem = {
  id: string;
  label: string;
  description?: string;
  section: string;
  keywords?: string;
  shortcut?: string;
  disabled?: boolean;
  disabledReason?: string;
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
  const inputRef = useRef<HTMLInputElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();
  const filtered = useMemo(
    () => items.map((item) => ({ item, score: score(item, query) })).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score).slice(0, 60),
    [items, query],
  );

  useLayoutEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement;
    const input = inputRef.current;
    setQuery("");
    setActiveIndex(0);
    input?.focus({ preventScroll: true });
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected
        && (document.activeElement === input || document.activeElement === closeRef.current || document.activeElement === document.body)) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, [open]);

  useEffect(() => setActiveIndex(0), [query]);
  useLayoutEffect(() => {
    if (!open) return;
    resultsRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest", behavior: "instant" });
  }, [open, activeIndex, filtered]);

  if (!open) return null;

  function run(item: CommandPaletteItem) {
    if (item.disabled) return;
    onClose();
    item.run();
  }

  function nextEnabled(from: number, direction: 1 | -1) {
    let i = from;
    for (let steps = 0; steps < filtered.length; steps++) {
      i = (i + direction + filtered.length) % filtered.length;
      if (!filtered[i].item.disabled) return i;
    }
    return from;
  }

  return (
    <div className="command-palette-layer is-open" onMouseDown={onClose}>
      <section className="command-palette" role="dialog" aria-modal="true" aria-label="命令面板" onMouseDown={(event) => event.stopPropagation()} onKeyDown={(event) => {
        if (event.key === "Escape" && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); onClose(); }
        if (event.key === "Tab") {
          event.preventDefault();
          if (document.activeElement === inputRef.current) closeRef.current?.focus();
          else inputRef.current?.focus();
        }
      }}>
        <div className="command-palette-search">
          <Search size={17} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索课程、源码、回答或命令"
            aria-label="搜索命令"
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-controls={listId}
            aria-activedescendant={filtered[activeIndex] ? `${listId}-${activeIndex}` : undefined}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((index) => nextEnabled(index, 1));
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((index) => nextEnabled(index, -1));
              }
              if (event.key === "Enter" && filtered[activeIndex]) {
                event.preventDefault();
                run(filtered[activeIndex].item);
              }
            }}
          />
          <button ref={closeRef} className="command-palette-close" type="button" onClick={onClose} title="关闭搜索" aria-label="关闭搜索">
            <X size={17} />
          </button>
        </div>
        <div ref={resultsRef} id={listId} className="command-palette-results" role="listbox" aria-label="搜索结果">
          {filtered.map(({ item }, index) => (
            <button
              key={item.id}
              id={`${listId}-${index}`}
              tabIndex={-1}
              className={`${index === activeIndex ? "active" : ""} ${item.disabled ? "is-disabled" : ""}`}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => run(item)}
              role="option"
              aria-selected={index === activeIndex}
              aria-disabled={item.disabled}
              style={item.disabled ? { opacity: 0.42, pointerEvents: "none" } : undefined}
            >
              <span className="command-section">{item.section}</span>
              <span className="command-copy">
                <strong>{item.label}</strong>
                {item.disabled && item.disabledReason ? <small>{item.disabledReason}</small> : item.description ? <small>{item.description}</small> : null}
              </span>
              {item.shortcut ? <kbd>{item.shortcut}</kbd> : null}
            </button>
          ))}
          {!filtered.length ? <div className="command-empty">没有匹配项</div> : null}
        </div>
      </section>
    </div>
  );
}
