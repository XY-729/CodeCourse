import { FormEvent, useState } from "react";
import { Download } from "lucide-react";

type Props = {
  loading: boolean;
  onSubmit: (url: string) => void;
};

export default function RepositoryForm({ loading, onSubmit }: Props) {
  const [url, setUrl] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(url.trim());
  }

  return (
    <form className="repo-form" onSubmit={submit}>
      <input
        aria-label="GitHub URL"
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        placeholder="git@github.com:owner/repo.git"
      />
      <button type="submit" disabled={loading || !url.trim()} title="导入仓库">
        <Download size={16} />
        <span>{loading ? "导入中..." : "导入"}</span>
      </button>
    </form>
  );
}
