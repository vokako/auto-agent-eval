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
              <div className="cmp-score">{s.passed}<span className="cmp-total">/{s.total}</span></div>
              <div className="cmp-rate">{(s.passed / s.total * 100).toFixed(1)}%</div>
            </div>
          );
        })}
      </div>
      <div className="panel-toolbar">
        <div className="tab-group">
          <button className={`tab ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>All ({data.tasks.length})</button>
          <button className={`tab ${filter === "diff" ? "active" : ""}`} onClick={() => setFilter("diff")}>Differences only</button>
        </div>
      </div>
      <table className="cmp-table">
        <thead><tr>
          <th>Task</th>
          {data.jobs.map(jid => <th key={jid} className="r">{jid.split("/")[0]}</th>)}
        </tr></thead>
        <tbody>{rows.map(row => {
          const vals = data.jobs.map(jid => row[jid] as { passed: boolean; error_type?: string } | null);
          const isDiff = !vals.every(v => v?.passed === vals[0]?.passed);
          return (
            <tr key={row.name} className={isDiff ? "diff-row" : ""}>
              <td>{row.name}</td>
              {data.jobs.map(jid => {
                const v = row[jid] as { passed: boolean; error_type?: string } | null;
                if (!v) return <td key={jid} className="r dim">—</td>;
                return <td key={jid} className={`r ${v.passed ? "cell-pass" : "cell-fail"}`}>{v.passed ? "✓" : "✗"}</td>;
              })}
            </tr>
          );
        })}</tbody>
      </table>
    </>
  );
}
