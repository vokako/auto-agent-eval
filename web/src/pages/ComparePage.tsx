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
        <Breadcrumb items={[{ label: "Jobs", to: "/" }, { label: "Compare" }]} />
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
