import { useState, useEffect, useRef } from "react";
import Prism from "prismjs";
import "prismjs/components/prism-json";
import "prismjs/components/prism-python";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-toml";
import "prismjs/components/prism-markdown";
import { fmtSize } from "../lib/format";
import { JsonView } from "./JsonView";

interface FileEntry { path: string; size: number; }

interface TreeNode {
  name: string;
  path: string;
  size: number;
  children: Record<string, TreeNode>;
  isFile: boolean;
}

const EXT_LANG: Record<string, string> = {
  json: "json", jsonl: "json", py: "python", sh: "bash", bash: "bash",
  yaml: "yaml", yml: "yaml", toml: "toml", md: "markdown",
  ts: "javascript", tsx: "javascript", js: "javascript",
};

function buildTree(files: FileEntry[]): TreeNode {
  const root: TreeNode = { name: "", path: "", size: 0, children: {}, isFile: false };
  for (const f of files) {
    const parts = f.path.split("/");
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!node.children[part]) {
        node.children[part] = {
          name: part,
          path: parts.slice(0, i + 1).join("/"),
          size: 0,
          children: {},
          isFile: i === parts.length - 1,
        };
      }
      node = node.children[part];
    }
    node.size = f.size;
    node.isFile = true;
  }
  return root;
}

function TreeItem({ node, depth, selected, onSelect }: {
  node: TreeNode; depth: number; selected: string | null; onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(depth < 2);
  const entries = Object.values(node.children).sort((a, b) => {
    if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
    return a.name.localeCompare(b.name);
  });

  if (node.isFile && Object.keys(node.children).length === 0) {
    return (
      <div
        className={`ft-file ${selected === node.path ? "active" : ""}`}
        style={{ paddingLeft: depth * 16 + 8 }}
        onClick={() => onSelect(node.path)}
      >
        <span className="ft-icon">📄</span>
        <span className="ft-name">{node.name}</span>
        <span className="ft-size">{fmtSize(node.size)}</span>
      </div>
    );
  }

  return (
    <div>
      <div className="ft-dir" style={{ paddingLeft: depth * 16 + 8 }} onClick={() => setOpen(!open)}>
        <span className={`ft-arrow ${open ? "open" : ""}`}>▶</span>
        <span className="ft-icon">{open ? "📂" : "📁"}</span>
        <span className="ft-name">{node.name || "/"}</span>
      </div>
      {open && entries.map(child => (
        <TreeItem key={child.path} node={child} depth={depth + 1} selected={selected} onSelect={onSelect} />
      ))}
    </div>
  );
}

export function FileBrowser({ jobId, taskName }: { jobId: string; taskName: string }) {
  const [files, setFiles] = useState<FileEntry[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const codeRef = useRef<HTMLElement>(null);

  const BASE = import.meta.env.DEV ? "http://localhost:8080" : "";

  useEffect(() => {
    setFiles(null); setSelected(null); setContent(null);
    fetch(`${BASE}/api/jobs/${jobId}/tasks/${taskName}/files`).then(r => r.json()).then(setFiles);
  }, [jobId, taskName]);

  useEffect(() => {
    if (codeRef.current && content && selected && !isJson(selected)) {
      Prism.highlightElement(codeRef.current);
    }
  }, [content, selected]);

  const openFile = async (path: string) => {
    setSelected(path); setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/jobs/${jobId}/tasks/${taskName}/files/${path}`);
      setContent((await res.json()).content);
    } catch { setContent("Failed to load"); }
    setLoading(false);
  };

  if (!files) return <div className="loading">Loading files…</div>;

  const tree = buildTree(files);

  return (
    <div className="file-browser">
      <div className="file-tree">
        {Object.values(tree.children).sort((a, b) => {
          if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
          return a.name.localeCompare(b.name);
        }).map(node => (
          <TreeItem key={node.path} node={node} depth={0} selected={selected} onSelect={openFile} />
        ))}
      </div>
      {selected && (
        <div className="file-content">
          <div className="file-content-header"><span>{selected}</span></div>
          {loading ? <div className="loading">Loading…</div> :
            isJson(selected) ? <div className="file-json-wrap"><JsonView data={tryParseJson(content || "")} /></div> :
            <pre className="code-block"><code ref={codeRef} className={getLang(selected) ? `language-${getLang(selected)}` : ""}>{content}</code></pre>
          }
        </div>
      )}
    </div>
  );
}

function getLang(path: string): string { return EXT_LANG[path.split(".").pop()?.toLowerCase() || ""] || ""; }
function isJson(path: string): boolean { return path.split(".").pop()?.toLowerCase() === "json"; }
function tryParseJson(text: string): unknown { try { return JSON.parse(text); } catch { return text; } }
