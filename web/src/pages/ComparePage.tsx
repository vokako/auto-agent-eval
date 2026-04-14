import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useFetch } from "../hooks/useFetch";
import { Breadcrumb } from "../components/Breadcrumb";

export default function ComparePage() {
  const [params] = useSearchParams();
  const ids = (params.get("ids") || "").split(",").filter(Boolean);
  const { data, loading } = useFetch(() => api.compare(ids), [params.get("ids")]);
  const [filter, setFilter] = useState<"all" | "diff">("all");

  if (loading || !data) return <div className="loading">Loading…</div>;

  const rows = filter === "diff"
    ? data.tasks.filter(row => {
        const vals = data.jobs.map(jid => (row[jid] as any)?.passed);
        return !vals.every(v => v === vals[0]);
      })
    : data.tasks;

  const diffCount = data.tasks.filter(row => {
    const vals = data.jobs.map(jid => (row[jid] as any)?.passed);
    return !vals.every(v => v === vals[0]);
  }).length;

  return (
    <>
      <header>
        <h1 onClick={() => window.location.href = "/"}>🧪 AAE — Agent Auto Eval</h1>
        <div className="header-actions">
          <Breadcrumb items={[{ label: "Jobs", to: "/" }, { label: "Compare" }]} />
          <a href="https://github.com/vokako/auto-agent-eval" target="_blank" rel="noopener" className="github-link" title="GitHub">
            <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
          </a>
        </div>
      </header>

      <div className="cmp-cards">
        {data.jobs.map(jid => {
          const s = data.summary[jid];
          return (
            <div key={jid} className="cmp-card">
              <div className="cmp-config">{jid.split("/")[0]}</div>
              <div className="cmp-agent">{s.agent || "—"} / {s.model || "?"}</div>
              <div className="cmp-score">{s.passed}<span className="cmp-total">/{s.total}</span></div>
              <div className="cmp-rate">{s.rate}%</div>
              <div className="cmp-breakdown">
                <span className="legend-fail">Fail {s.failed - s.timeouts - s.errors}</span>
                {s.timeouts > 0 && <span className="legend-timeout">Timeout {s.timeouts}</span>}
                {s.errors > 0 && <span className="legend-err">Error {s.errors}</span>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="panel-toolbar">
        <div className="tab-group">
          <button className={`tab ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>All ({data.tasks.length})</button>
          <button className={`tab ${filter === "diff" ? "active" : ""}`} onClick={() => setFilter("diff")}>Differences ({diffCount})</button>
        </div>
      </div>

      <table className="cmp-table">
        <thead><tr>
          <th>Task</th>
          {data.jobs.map(jid => <th key={jid} className="c">{jid.split("/")[0]}</th>)}
        </tr></thead>
        <tbody>{rows.map(row => {
          const vals = data.jobs.map(jid => row[jid] as { passed: boolean; error_type?: string } | null);
          const isDiff = !vals.every(v => v?.passed === vals[0]?.passed);
          return (
            <tr key={row.name} className={isDiff ? "diff-row" : ""}>
              <td>{row.name}</td>
              {data.jobs.map(jid => {
                const v = row[jid] as { passed: boolean; error_type?: string } | null;
                if (!v) return <td key={jid} className="c dim">—</td>;
                const label = v.passed ? "✓" :
                  v.error_type === "AgentTimeoutError" ? "⏱" :
                  v.error_type ? "✗ err" : "✗";
                return <td key={jid} className={`c ${v.passed ? "cell-pass" : v.error_type ? "cell-err" : "cell-fail"}`}>{label}</td>;
              })}
            </tr>
          );
        })}</tbody>
      </table>
    </>
  );
}
