import { useState } from "react";
import { BASE } from "../lib/api";

interface Props {
  title: string;
  jobId: string;
  taskName: string;
  logType: string;
  defaultOpen?: boolean;
}

export function LazyLog({ title, jobId, taskName, logType, defaultOpen }: Props) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);


  const load = async () => {
    if (content !== null) return;
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/jobs/${jobId}/tasks/${taskName}/logs/${logType}`);
      const data = await res.json();
      setContent(data.content || "—");
    } catch {
      setContent("Failed to load");
    }
    setLoading(false);
  };

  return (
    <details open={defaultOpen} onToggle={e => { if ((e.target as HTMLDetailsElement).open) load(); }}>
      <summary>{title}{loading && " (loading...)"}</summary>
      {content !== null ? (
        <pre className="log-content">{content}</pre>
      ) : (
        <pre className="log-content dim">Click to load...</pre>
      )}
    </details>
  );
}
