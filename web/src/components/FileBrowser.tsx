import { useState, useEffect, useRef } from "react";
import Prism from "prismjs";
import "prismjs/components/prism-json";
import "prismjs/components/prism-python";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-toml";
import "prismjs/components/prism-markdown";
import { fmtSize } from "../lib/format";

interface FileEntry { path: string; size: number; }

const EXT_LANG: Record<string, string> = {
  json: "json", jsonl: "json", py: "python", sh: "bash", bash: "bash",
  yaml: "yaml", yml: "yaml", toml: "toml", md: "markdown",
  ts: "javascript", tsx: "javascript", js: "javascript", jsx: "javascript",
};

function getLang(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  return EXT_LANG[ext] || "";
}

export function FileBrowser({ jobId, taskName }: { jobId: string; taskName: string }) {
  const [files, setFiles] = useState<FileEntry[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const codeRef = useRef<HTMLElement>(null);

  const BASE = import.meta.env.DEV ? "http://localhost:8080" : "";

  useEffect(() => {
    setFiles(null);
    setSelected(null);
    setContent(null);
    fetch(`${BASE}/api/jobs/${jobId}/tasks/${taskName}/files`)
      .then(r => r.json())
      .then(setFiles);
  }, [jobId, taskName]);

  useEffect(() => {
    if (codeRef.current && content) {
      Prism.highlightElement(codeRef.current);
    }
  }, [content, selected]);

  const openFile = async (path: string) => {
    setSelected(path);
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/jobs/${jobId}/tasks/${taskName}/files/${path}`);
      const data = await res.json();
      setContent(data.content);
    } catch {
      setContent("Failed to load");
    }
    setLoading(false);
  };

  if (!files) return <div className="loading">Loading files…</div>;

  // Build tree structure
  const tree: Record<string, FileEntry[]> = {};
  for (const f of files) {
    const dir = f.path.includes("/") ? f.path.substring(0, f.path.lastIndexOf("/")) : ".";
    if (!tree[dir]) tree[dir] = [];
    tree[dir].push(f);
  }

  return (
    <div className="file-browser">
      <div className="file-tree">
        {Object.entries(tree).sort(([a], [b]) => a.localeCompare(b)).map(([dir, entries]) => (
          <div key={dir} className="file-dir">
            <div className="dir-name">{dir}/</div>
            {entries.map(f => {
              const name = f.path.split("/").pop()!;
              return (
                <div
                  key={f.path}
                  className={`file-item ${selected === f.path ? "active" : ""}`}
                  onClick={() => openFile(f.path)}
                >
                  <span className="file-name">{name}</span>
                  <span className="file-size">{fmtSize(f.size)}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {selected && (
        <div className="file-content">
          <div className="file-content-header">
            <span>{selected}</span>
          </div>
          {loading ? (
            <div className="loading">Loading…</div>
          ) : (
            <pre className="code-block">
              <code ref={codeRef} className={getLang(selected) ? `language-${getLang(selected)}` : ""}>
                {content}
              </code>
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
