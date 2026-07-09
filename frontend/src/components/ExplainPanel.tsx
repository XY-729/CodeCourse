import { RefreshCw } from "lucide-react";

type Props = {
  provider: string;
  explanation: string;
  loading: boolean;
  onRefresh: () => void;
};

export default function ExplainPanel({ provider, explanation, loading, onRefresh }: Props) {
  return (
    <aside className="explain-panel">
      <div className="panel-title">
        <span>AI 解释</span>
        <button onClick={onRefresh} disabled={loading} title="手动生成解释">
          <RefreshCw size={15} />
        </button>
      </div>
      <div className="provider">provider: {provider}</div>
      <pre>{loading ? "生成中..." : explanation || "等待选择"}</pre>
    </aside>
  );
}
