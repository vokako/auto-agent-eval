import { useState } from "react";
import { AppHeader } from "../components/AppHeader";
import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import type { CompareRow } from "../types";

type Cell = { passed: boolean; error_type?: string };
import { useFetch } from "../hooks/useFetch";
import { Breadcrumb } from "../components/Breadcrumb";

export default function ComparePage() {
  const [params] = useSearchParams();
  const ids = (params.get("ids") || "").split(",").filter(Boolean);
  const { data, loading } = useFetch(() => api.compare(ids), [params.get("ids")]);
  const [filter, setFilter] = useState<"all" | "diff">("all");

  if (loading || !data) return <div className="loading">Loading…</div>;

  const cell = (row: CompareRow, jid: string) => row[jid] as Cell | null;
  const isDiff = (row: CompareRow) => {
    const vals = data.jobs.map(jid => cell(row, jid)?.passed);
    return !vals.every(v => v === vals[0]);
  };
  const rows = filter === "diff" ? data.tasks.filter(isDiff) : data.tasks;
  const diffCount = data.tasks.filter(isDiff).length;

  return (
    <>
      <AppHeader>
        <Breadcrumb items={[{ label: "Jobs", to: "/" }, { label: "Compare" }]} />
      </AppHeader>

      <div className="cmp-cards">
        {data.jobs.map(jid => {
          const s = data.summary[jid];
          return (
            <div key={jid} className="cmp-card">
              <div className="cmp-config">{jid.split("/")[0]}</div>
              <div className="cmp-agent">{s.agent || "—"} / {s.model || "?"}{s.effort ? ` · ${s.effort}` : ""}{s.variant ? ` · ${s.variant}` : ""}</div>
              <div className="cmp-score">{s.passed}<span className="cmp-total">/{s.total}</span></div>
              <div className="cmp-rate">{s.rate}%</div>
              <div className="cmp-meta">
                {s.cost_usd ? <span>${s.cost_usd.toFixed(2)}</span> : null}
                {s.agent_s && s.total ? <span>{(s.agent_s / 60 / s.total).toFixed(1)} min/task</span> : null}
              </div>
              <div className="cmp-breakdown">
                <span className="legend-fail">Fail {s.failed - s.timeouts - s.errors - (s.refused || 0)}</span>
                {s.timeouts > 0 && <span className="legend-timeout">Timeout {s.timeouts}</span>}
                {(s.refused || 0) > 0 && <span className="legend-refused">Refused {s.refused}</span>}
                {(s.not_run || 0) > 0 && <span className="legend-refused">Not run {s.not_run}</span>}
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
          return (
            <tr key={row.name} className={isDiff(row) ? "diff-row" : ""}>
              <td>{row.name}</td>
              {data.jobs.map(jid => {
                const v = cell(row, jid);
                if (!v) return <td key={jid} className="c dim">—</td>;
                const label = v.passed ? "✓" :
                  v.error_type === "AgentTimeoutError" ? "✗ timeout" :
                  v.error_type === "ModelRefusal" ? "✗ refused" :
                  v.error_type === "NotRun" ? "— not run" :
                  v.error_type ? "✗ error" : "✗";
                return <td key={jid} className={`c ${v.passed ? "cell-pass" : v.error_type === "NotRun" ? "dim" : v.error_type ? "cell-err" : "cell-fail"}`}>{label}</td>;
              })}
            </tr>
          );
        })}</tbody>
      </table>
    </>
  );
}
