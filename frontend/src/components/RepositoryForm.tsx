import { FormEvent, useState } from "react";
import { Download } from "lucide-react";

type Props = {
  loading: boolean;
  onSubmit: (url: string) => void;
};

export default function RepositoryForm({ loading, onSubmit }: Props) {
  const [url, setUrl] = useState("git@github.com:XY-729/CPPJUDGE.git");
  const isHttpsGithub = url.startsWith("https://github.com/");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(url.trim());
  }

  return (
    <form className="repo-form" onSubmit={submit}>
      <div className="repo-input-wrap">
        <input
          aria-label="GitHub URL"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="git@github.com:owner/repo.git"
        />
        <span className={isHttpsGithub ? "input-hint warning" : "input-hint"}>
          {isHttpsGithub ? "当前 VM 建议使用 SSH 地址" : "支持 GitHub SSH / HTTPS；导入不会调用模型 API"}
        </span>
      </div>
      <button type="submit" disabled={loading || !url.trim()} title="导入仓库">
        <Download size={16} />
        <span>{loading ? "导入中..." : "导入"}</span>
      </button>
    </form>
  );
}
