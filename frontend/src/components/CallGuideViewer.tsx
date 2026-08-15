import { useMemo } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bot,
  Code2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type { CallGuide, CallGuideNode } from "../api/client";

type Props = {
  guide: CallGuide;
  busy?: boolean;
  onSelectNode: (nodeId: string, visitedNodeIds: string[]) => void;
  onOpenSource: (node: CallGuideNode) => void;
  onExplain: (node: CallGuideNode, routeNodeIds: string[]) => void;
  onRefresh: () => void;
  onDelete: () => void;
};

export function routeToRoot(guide: CallGuide, focusedId: string): string[] {
  const root = guide.nodes.find((node) => node.direction === "root");
  if (!root || focusedId === root.id) return root ? [root.id] : [];
  const adjacency = new Map<string, string[]>();
  for (const edge of guide.edges) {
    if (!edge.verified) continue;
    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
    adjacency.set(edge.target, [...(adjacency.get(edge.target) ?? []), edge.source]);
  }
  const queue: Array<{ id: string; path: string[] }> = [{ id: focusedId, path: [focusedId] }];
  const seen = new Set([focusedId]);
  while (queue.length) {
    const current = queue.shift();
    if (!current) break;
    if (current.id === root.id) return current.path;
    for (const next of adjacency.get(current.id) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push({ id: next, path: [...current.path, next] });
    }
  }
  return [];
}

function NodeButton({
  node,
  active,
  visited,
  onClick,
}: {
  node: CallGuideNode;
  active: boolean;
  visited: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`call-guide-node${active ? " is-active" : ""}${visited ? " is-visited" : ""}`}
      onClick={onClick}
    >
      <span className="call-guide-node-symbol">{node.symbol_name}</span>
      <span className="call-guide-node-meta">{node.path}:{node.start_line}</span>
      {node.hop > 0 ? <span className="call-guide-hop">{node.hop} 跳</span> : null}
    </button>
  );
}

export default function CallGuideViewer({
  guide,
  busy = false,
  onSelectNode,
  onOpenSource,
  onExplain,
  onRefresh,
  onDelete,
}: Props) {
  const root = guide.nodes.find((node) => node.direction === "root") ?? guide.nodes[0];
  const selected = guide.nodes.find((node) => node.id === guide.current_node_id) ?? root;
  const visited = useMemo(() => new Set(guide.visited_node_ids), [guide.visited_node_ids]);
  const ordered = useMemo(
    () => [...guide.nodes].sort((a, b) => a.hop - b.hop || a.symbol_name.localeCompare(b.symbol_name)),
    [guide.nodes],
  );
  const currentIndex = Math.max(0, ordered.findIndex((node) => node.id === selected?.id));
  const route = selected ? routeToRoot(guide, selected.id) : [];
  const routeNodes = route.map((id) => guide.nodes.find((node) => node.id === id)).filter(Boolean) as CallGuideNode[];
  const hasVerifiedRoute = route.length > 0;

  const selectNode = (node: CallGuideNode) => {
    onSelectNode(node.id, Array.from(new Set([...guide.visited_node_ids, node.id])));
  };
  const sections: Array<{ key: CallGuideNode["direction"]; title: string; icon: typeof ArrowUp }> = [
    { key: "caller", title: "上游调用者", icon: ArrowUp },
    { key: "root", title: "当前符号", icon: Code2 },
    { key: "callee", title: "下游调用", icon: ArrowDown },
  ];

  if (!selected) {
    return <div className="call-guide-empty">当前导览没有可显示的结构节点。</div>;
  }

  return (
    <section className="call-guide-viewer" aria-label="调用链学习导览">
      <header className="call-guide-toolbar">
        <div>
          <strong>{guide.title}</strong>
          <span>{guide.nodes.length} 个真实符号 · {guide.edges.length} 条已验证调用</span>
        </div>
        <div className="call-guide-actions">
          <button type="button" className="icon-button" onClick={onRefresh} disabled={busy} title="刷新导览"><RefreshCw size={15} /></button>
          <button type="button" className="icon-button danger" onClick={onDelete} disabled={busy} title="删除导览"><Trash2 size={15} /></button>
        </div>
      </header>

      {(guide.stale || guide.coverage.status !== "complete") ? (
        <div className={`call-guide-notice${guide.stale ? " is-stale" : ""}`}>
          <AlertTriangle size={15} />
          <span>{guide.stale ? "项目索引已变化。刷新前可以继续查看，但不能生成讲解。" : guide.coverage.reason || "部分分支无法由结构索引确认，未显示推测连线。"}</span>
        </div>
      ) : null}

      <div className="call-guide-body">
        <nav className="call-guide-map" aria-label="调用路径节点">
          {sections.map(({ key, title, icon: Icon }) => {
            const nodes = guide.nodes.filter((node) => node.direction === key)
              .sort((a, b) => a.hop - b.hop || a.symbol_name.localeCompare(b.symbol_name));
            return (
              <div className="call-guide-stage" key={key}>
                <h3><Icon size={14} />{title}<span>{nodes.length}</span></h3>
                <div className="call-guide-node-list">
                  {nodes.map((node) => (
                    <NodeButton
                      key={node.id}
                      node={node}
                      active={node.id === selected.id}
                      visited={visited.has(node.id)}
                      onClick={() => selectNode(node)}
                    />
                  ))}
                  {nodes.length === 0 ? <p>结构索引未发现已验证节点</p> : null}
                </div>
              </div>
            );
          })}
        </nav>

        <article className="call-guide-detail">
          <div className="call-guide-detail-heading">
            <div>
              <span>{selected.direction === "caller" ? "上游" : selected.direction === "callee" ? "下游" : "起点"}</span>
              <h2>{selected.qualified_name || selected.symbol_name}</h2>
              <p>{selected.signature || `${selected.path}:${selected.start_line}-${selected.end_line}`}</p>
            </div>
            <button type="button" onClick={() => onOpenSource(selected)}><Code2 size={15} />打开源码</button>
          </div>

          <div className="call-guide-route" aria-label="当前节点到起点的验证路径">
            {hasVerifiedRoute ? routeNodes.map((node, index) => (
              <span key={node.id}>{index ? <ArrowRight size={13} /> : null}{node.symbol_name}</span>
            )) : <span>结构索引没有返回这个节点到起点的完整父边，仅按跳数分组显示。</span>}
          </div>

          <pre className="call-guide-code"><code>{selected.content || "结构索引已定位符号，但源码片段暂时不可读。"}</code></pre>

          <footer className="call-guide-detail-footer">
            <div className="call-guide-stepper">
              <button type="button" disabled={currentIndex === 0} onClick={() => selectNode(ordered[currentIndex - 1])}><ArrowLeft size={15} />上一步</button>
              <span>{currentIndex + 1} / {ordered.length}</span>
              <button type="button" disabled={currentIndex >= ordered.length - 1} onClick={() => selectNode(ordered[currentIndex + 1])}>下一步<ArrowRight size={15} /></button>
            </div>
            <button
              type="button"
              className="primary call-guide-explain"
              onClick={() => onExplain(selected, route)}
              disabled={guide.stale || busy || !hasVerifiedRoute}
            >
              <Bot size={15} />讲解这条路径
            </button>
          </footer>
        </article>
      </div>
    </section>
  );
}
